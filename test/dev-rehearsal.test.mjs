// dev-rehearsal.test.mjs — the dev rehearsal's own refusals can fail (POS-354).
//
// tools/dev-rehearsal.mjs writes a store, so the check that decides WHICH store
// is the one that must never be a probe that cannot go red. Each refusal is
// driven here: PROD's database named by the dev office's env, a pen pointed at
// another database, the first line of output in both directions, and a CLI run
// that refuses before it connects anywhere. The parts the whole run leans on
// (the table census, the GitHub stub) are checked too.
//
// The whole rehearsal, end to end on an embedded Postgres with this tree's
// office booted on it, is test/dev-rehearsal-local.test.mjs (minutes; a heavy run).

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CROSSING, PROD_DB, SANDBOX_CHECK, carried, databaseOf, findGround, githubStub, mistsSafeBox, parseEnvFile, sandboxProblems, sandboxVerdictFromGitHub, storeGuard, treeTables } from "../tools/dev-rehearsal.mjs";

const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(OFFICE, "tools", "dev-rehearsal.mjs");
const url = (role, db, port = 5432) => `postgres://${role}:pw@127.0.0.1:${port}/${db}`;
const DEV = "w2_devsandbox_20260925";

test("the env file parses as systemd reads it, and a URL names its database", () => {
  const env = parseEnvFile(`# a comment\nA=1\n\nB="two words"\nWORLD2_PG_URL=${url("office_api", DEV)}\nC='x=y'\n`);
  assert.deepEqual(env, { A: "1", B: "two words", WORLD2_PG_URL: url("office_api", DEV), C: "x=y" });
  assert.equal(databaseOf(env.WORLD2_PG_URL), DEV);
  assert.equal(databaseOf("not a url"), null);
});

test("the guard passes only the dev office's own database, and says so on its first line", () => {
  const g = storeGuard({ configuredUrl: url("office_api", DEV), urls: { office_api: url("office_api", DEV), clearing_job: url("clearing_job", DEV) }, source: "/etc/postmark-office-dev.env" });
  assert.equal(g.ok, true, g.problems.join("; "));
  assert.equal(g.db, DEV);
  assert.equal(g.line, `dev-rehearsal: target store ${DEV} (the dev office's, from /etc/postmark-office-dev.env); not ${PROD_DB}`);
});

test("the guard refuses PROD's store when the dev office's env names it", () => {
  const g = storeGuard({ configuredUrl: url("office_api", PROD_DB), urls: { office_api: url("office_api", PROD_DB) }, source: "dev.env" });
  assert.equal(g.ok, false);
  assert.match(g.line, /^dev-rehearsal: REFUSED/);
  assert.ok(g.problems.some((p) => /world2_dev, which is PROD's store/.test(p)), g.problems.join("; "));
});

test("the guard refuses a pen that names any database but the dev office's", () => {
  // the roles file is a second source: a clearing URL copied from prod's env names world2_dev
  const g = storeGuard({ configuredUrl: url("office_api", DEV), urls: { office_api: url("office_api", DEV), clearing_job: url("clearing_job", PROD_DB) }, source: "dev.env" });
  assert.equal(g.ok, false);
  assert.ok(g.problems.some((p) => /clearing_job names world2_dev, PROD's store/.test(p)), g.problems.join("; "));
  const other = storeGuard({ configuredUrl: url("office_api", DEV), urls: { office_api: url("office_api", DEV), law_ingester: url("law_ingester", "world2_rehearsal") }, source: "dev.env" });
  assert.equal(other.ok, false);
  assert.ok(other.problems.some((p) => /law_ingester names the database world2_rehearsal, not the dev office's/.test(p)), other.problems.join("; "));
  const none = storeGuard({ configuredUrl: null, urls: {}, source: "dev.env" });
  assert.equal(none.ok, false);
});

test("the CLI refuses before it connects, and its first line says why", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-rehearsal-cli-"));
  try {
    // port 1: a connection attempt would answer ECONNREFUSED, so its absence proves none was made
    writeFileSync(join(dir, "dev.env"), `WORLD2_PG_URL=${url("office_api", PROD_DB, 1)}\nTOWN_PUSH=0\n`);
    writeFileSync(join(dir, "roles.env"), `WORLD2_INGEST_URL=${url("law_ingester", PROD_DB, 1)}\nWORLD2_CLEARING_URL=${url("clearing_job", PROD_DB, 1)}\n`);
    const r = spawnSync(process.execPath, [TOOL, "--env-file", join(dir, "dev.env"), "--roles-file", join(dir, "roles.env"), "--office", "http://127.0.0.1:1"], { encoding: "utf8" });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout.split("\n")[0], /^dev-rehearsal: REFUSED, the target store is not the dev office's own: .*world2_dev, which is PROD's store/);
    assert.doesNotMatch(r.stdout + r.stderr, /ECONNREFUSED|connect/i);

    // the dev office's own database: the first line names it, then the (absent) store refuses the start
    writeFileSync(join(dir, "dev.env"), `WORLD2_PG_URL=${url("office_api", DEV, 1)}\nTOWN_PUSH=0\n`);
    writeFileSync(join(dir, "roles.env"), `WORLD2_INGEST_URL=${url("law_ingester", DEV, 1)}\nWORLD2_CLEARING_URL=${url("clearing_job", DEV, 1)}\n`);
    const ok = spawnSync(process.execPath, [TOOL, "--env-file", join(dir, "dev.env"), "--roles-file", join(dir, "roles.env"), "--office", "http://127.0.0.1:1"], { encoding: "utf8" });
    assert.equal(ok.stdout.split("\n")[0], `dev-rehearsal: target store ${DEV} (the dev office's, from ${join(dir, "dev.env")}); not ${PROD_DB}`);
    assert.equal(ok.status, 2, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /COULD NOT START/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the table census reads this tree's migrations, drops included", () => {
  const names = treeTables(OFFICE);
  for (const t of ["windows", "claims", "marks", "settlements", "crossing_receipts", "resident_notes", "household_pins", "oauth_tokens", "office_town_journal"])
    assert.ok(names.has(t), `the census misses ${t}`);
  assert.ok(names.size > 40, `only ${names.size} tables`);
});

test("the GitHub stub answers the pen's join road and records the PR's files, never another repo", async () => {
  const town = mkdtempSync(join(tmpdir(), "dev-rehearsal-stub-"));
  try {
    const g = (...a) => execFileSync("git", ["-C", town, ...a], { encoding: "utf8" }).trim();
    g("init", "-q", "-b", "main");
    writeFileSync(join(town, "README.md"), "town\n");
    g("add", "-A"); g("-c", "user.name=t", "-c", "user.email=t@x.invalid", "commit", "-qm", "town");
    const stub = githubStub({ owner: "postmark-town", repo: "postmark", townClone: town });
    const port = await stub.listen(0);
    const api = async (method, path, body) => {
      const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json() };
    };
    try {
      const base = "/repos/postmark-town/postmark";
      assert.equal((await api("GET", `${base}/git/ref/heads/main`)).body.object.sha, g("rev-parse", "HEAD"));
      const tree = await api("POST", `${base}/git/trees`, { base_tree: "x", tree: [{ path: "WHITE_PAGES/b/ADDRESS.md", mode: "100644", type: "blob", content: "card\n" }] });
      const commit = await api("POST", `${base}/git/commits`, { message: "join b", tree: tree.body.sha, parents: [] });
      await api("POST", `${base}/git/refs`, { ref: "refs/heads/residency/b", sha: commit.body.sha });
      const pr = await api("POST", `${base}/pulls`, { title: "join b", head: "residency/b", base: "main", body: "" });
      assert.equal(pr.status, 201);
      assert.deepEqual(stub.filesOf(stub.prs[0]), [{ path: "WHITE_PAGES/b/ADDRESS.md", content: "card\n" }]);
      assert.equal((await api("GET", `${base}/pulls?state=open`)).body.length, 1);
      stub.merged(stub.prs[0]);
      assert.equal((await api("GET", `${base}/pulls?state=closed`)).body[0].merged_at != null, true);
      assert.equal((await api("GET", `${base}/contents/README.md`)).body.content, Buffer.from("town\n").toString("base64"));
      const other = await api("GET", "/repos/keeminlee/postmark/pulls");
      assert.equal(other.status, 404);
      assert.equal(other.body.message, "the rehearsal's stub answers only the town repo", "the stub answers only the town repo it was given");
    } finally { await stub.close(); }
  } finally { rmSync(town, { recursive: true, force: true }); }
});

// ── THE CROSSING IS THE BOX'S (POS-354, 10-09) ───────────────────────────────
//
// The rehearsal's crossing step runs CROSSING, a list of the jobs the box runs:
// postmark-ferry.service's ExecStart, then the keep tick's locked section
// (deploy/office-keep.sh). On 10-07 it was written by hand, and by 10-09 the box
// had moved to the store's mint and the office's ballot pass while the
// rehearsal still ran the town's. This census reads both box files and holds
// the list to them: a job the box adds, or one the rehearsal drops, is red here.
//
// THE CAN-FAIL FLIP: delete the `ballot` entry from CROSSING; the ferry census
// goes red naming tools/ballot-pass-run.mjs.

/** Every job a box shell text runs: office scripts as office-relative paths, the town's (run from the clone) as `town:`. */
function jobsIn(text) {
  const out = new Set();
  for (const m of text.matchAll(/(?:\/usr\/bin\/node|\bnode|\/bin\/bash)\s+("?)(\/srv\/postmark-office\/)?([A-Za-z0-9_./-]+\.(?:mjs|sh))\1/g)) {
    if (m[3].startsWith("$")) continue;
    out.add(m[2] ? m[3] : `town:${m[3]}`);
  }
  return out;
}
const boxFile = (rel) => readFileSync(join(OFFICE, rel), "utf8");
const crossingJobs = (phase) => new Set(CROSSING.filter((j) => j.phase === phase).map((j) => j.box));
const diff = (a, b) => [...a].filter((x) => !b.has(x)).sort();

test("the rehearsal's crossing runs every job postmark-ferry.service runs, and no other", () => {
  const unit = boxFile("deploy/postmark-ferry.service");
  const exec = unit.slice(unit.indexOf("ExecStart="), unit.indexOf("NoNewPrivileges"));
  const box = jobsIn(exec);
  assert.ok(box.size >= 10, `the census found only ${[...box].join(", ")} in the unit`);
  const mine = crossingJobs("ferry");
  assert.deepEqual(diff(box, mine), [], "the box's ferry runs jobs the rehearsal does not");
  assert.deepEqual(diff(mine, box), [], "the rehearsal runs ferry jobs the box does not");
});

test("the rehearsal's tick runs every job the keep tick runs under its lock, and no other", () => {
  const keep = boxFile("deploy/office-keep.sh");
  const from = keep.indexOf("flock -w 300 9"), to = keep.indexOf("mint catch-up FAILED");
  assert.ok(from > 0 && to > from, "the keep tick's locked section moved: re-anchor this census");
  const box = jobsIn(keep.slice(from, to));
  const mine = crossingJobs("keep");
  assert.deepEqual(diff(box, mine), [], "the keep tick runs jobs the rehearsal does not");
  assert.deepEqual(diff(mine, box), [], "the rehearsal runs tick jobs the keep tick does not");
});

test("both arms of the stamp switch are listed, so the census holds the whole unit (only the store arm runs: the preflight requires STAMP_LINES=store)", () => {
  for (const name of ["mint", "quests", "tick-mint"]) {
    const sides = CROSSING.filter((j) => j.name === name).map((j) => j.when).sort();
    assert.deepEqual(sides, ["git", "store"], `${name} must have a store side and a git side`);
  }
});

// ── THE SANDBOX ON THE CARRIED SHA (POS-366 part 3) ──────────────────────────
//
// The sandbox cannot run on the dev box (the carry omits devDependencies), so
// the rehearsal's last step gates on CI's `stamp sandbox` check for the sha the
// dev office was carried with. Every road to a verdict other than a completed
// success is red, and the newest run is the one judged.
//
// THE CAN-FAIL FLIP: make sandboxProblems answer [] for any conclusion; "a
// failed or missing run is red" goes red.

const runsAt = (runs) => async () => ({ ok: true, status: 200, json: async () => ({ check_runs: runs }) });
const run = (conclusion, started_at, extra = {}) => ({ name: SANDBOX_CHECK, status: "completed", conclusion, started_at, html_url: `https://ci.invalid/${started_at}`, head_sha: "abc1234ffff", ...extra });

test("the sandbox verdict: the newest run of the named check is the one judged", async () => {
  const v = await sandboxVerdictFromGitHub("abc1234", { fetchImpl: runsAt([run("failure", "2026-10-09T10:00:00Z"), run("success", "2026-10-09T12:00:00Z"), { ...run("success", "2026-10-09T13:00:00Z"), name: "office suite verdict" }]) });
  assert.deepEqual(v, { runs: 2, not_run: 0, status: "completed", conclusion: "success", url: "https://ci.invalid/2026-10-09T12:00:00Z", head_sha: "abc1234ffff" });
  assert.deepEqual(sandboxProblems("abc1234", v), []);
});

test("a failed, running or missing sandbox run is red, and so is a GitHub that did not answer", async () => {
  // every red names the sha and the train carried, so the reader knows what to dispatch (Wright, 10-09)
  const red = async (runs) => sandboxProblems("abc1234", await sandboxVerdictFromGitHub("abc1234", { fetchImpl: runsAt(runs) }), "train/2026-w42");
  assert.match((await red([run("failure", "2026-10-09T12:00:00Z")]))[0], /on abc1234 \(train\/2026-w42\) concluded failure .* fix it on train\/2026-w42, re-carry/);
  assert.match((await red([run(null, "2026-10-09T12:00:00Z", { status: "in_progress" })]))[0], /on abc1234 \(train\/2026-w42\) is in_progress .* wait for its verdict/);
  assert.match((await red([]))[0], /no "stamp sandbox" run on abc1234 \(train\/2026-w42\): label the ship PR from train\/2026-w42 into main `stamp-sandbox`.*--ref train\/2026-w42`/);
  const down = await sandboxVerdictFromGitHub("abc1234", { fetchImpl: async () => ({ ok: false, status: 403 }) });
  assert.match(sandboxProblems("abc1234", down, "train/2026-w42")[0], /GitHub answered 403.*abc1234 \(train\/2026-w42\)/);
  assert.match(sandboxProblems(null, {})[0], /names no carried sha/);
});

test("what was carried is release.json's sha and tag (the carry writes both), else the tree's HEAD and branch", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-rehearsal-sha-"));
  try {
    writeFileSync(join(dir, "release.json"), JSON.stringify({ tag: "train/2026-w42", sha: "65c5e6d", target: "dev" }));
    assert.deepEqual(carried(dir), { sha: "65c5e6d", ref: "train/2026-w42" });
    assert.equal(carried(OFFICE).sha, execFileSync("git", ["-C", OFFICE, "rev-parse", "HEAD"], { encoding: "utf8" }).trim());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a skipped or cancelled run never shadows a verdict, and alone it asks for a re-run (#453 review F3)", async () => {
  // THE CAN-FAIL FLIP: drop the skipped/cancelled filter in sandboxVerdictFromGitHub; this goes red
  const v = await sandboxVerdictFromGitHub("abc1234", { fetchImpl: runsAt([run("success", "2026-10-09T12:00:00Z"), run("skipped", "2026-10-09T13:00:00Z")]) });
  assert.equal(v.conclusion, "success");
  assert.equal(v.not_run, 1);
  assert.deepEqual(sandboxProblems("abc1234", v, "train/2026-w42"), []);
  const only = await sandboxVerdictFromGitHub("abc1234", { fetchImpl: runsAt([run("cancelled", "2026-10-09T13:00:00Z"), run("skipped", "2026-10-09T14:00:00Z")]) });
  const [why] = sandboxProblems("abc1234", only, "train/2026-w42");
  assert.match(why, /every "stamp sandbox" run on abc1234 \(train\/2026-w42\) was skipped or cancelled \(2\), so none judged the code: re-run the sandbox/);
  assert.doesNotMatch(why, /a stamp event is red/);
});

// ── the rehearsal's ground (POS-595) ─────────────────────────────────────────
//
// Until crossing 244 the rehearsal stood at x 30000, y 30000, outside the Mists'
// border, and the door refused its claim 422 at the wall. These hold the search
// that replaced the fixed ground: the box it searches is clear at every keyframe,
// it refuses by name when nothing in the box is free, and it never falls back.

const WORLD = join(OFFICE, "world-clone");
const { publishedSkeleton } = await import("../src/world-branches.mjs");
const engine = () => import(pathToFileURL(join(WORLD, "tools", "world-engine.mjs")).href);
const corners = (f) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([dx, dy]) => ({ x: f.at.x + (dx * f.extent.w) / 2, y: f.at.y + (dy * f.extent.h) / 2 }));

test("ground chosen at crossing 244 is still clear of the wall and its fringe at the last keyframe, and long after it", async () => {
  const { mistsAt, mistsHere } = await engine();
  const { skeleton } = publishedSkeleton(WORLD);
  assert.ok(skeleton?.mists?.schedule?.length, "the pinned world's blessed skeleton carries the Mists (POS-466)");
  const safe = mistsSafeBox(skeleton.mists, mistsAt);
  assert.deepEqual(safe.keyframes, skeleton.mists.schedule.map((k) => k.crossing));
  const last = skeleton.mists.schedule.at(-1).crossing;
  // the old ground, the control: behind the wall from the first keyframe on
  assert.equal(mistsHere({ x: 30000, y: 30000 }, mistsAt(244, skeleton.mists)).inWall, true);
  // many runs' ground, the run id's walk from several starts, every corner of all four footprints
  for (const run of ["0", "1", "abc1", "zzzz", "gm3k2"]) {
    const g = await findGround({ run, safe, parcelM: 25, taken: async () => null });
    for (const crossing of [244, 260, 272, last, 400]) {
      const m = mistsAt(crossing, skeleton.mists);
      for (const f of g.footprints) for (const q of corners(f)) {
        const h = mistsHere(q, m);
        assert.equal(h.inWall, false, `run ${run}: ${f.name}'s corner (${q.x}, ${q.y}) is behind the wall at crossing ${crossing}`);
        assert.ok(h.wallM >= m.fringeM, `run ${run}: ${f.name}'s corner (${q.x}, ${q.y}) stands in the fringe at crossing ${crossing} (${h.wallM} m from the wall)`);
      }
    }
  }
});

test("a safe box filled with standing parcels refuses by name, with the box and the count of places tried, and never falls back to fixed ground", async () => {
  const { mistsAt } = await engine();
  // a small world: a 1200 m border, the pinned world's fringe, the wall at the border
  const mists = { border_m: { minX: 0, minY: 0, maxX: 1200, maxY: 1200 }, fringe_m: 400, schedule: [{ crossing: 244, front_m: 0, veil: 0.1 }] };
  const safe = mistsSafeBox(mists, mistsAt);
  assert.deepEqual(safe.box, { minX: 500, maxX: 700, minY: 500, maxY: 700 });
  const asked = [];
  const full = async (footprints) => { asked.push(footprints[0].at); return `the standing parcel "rh-old/ground-${asked.length}"`; };
  await assert.rejects(findGround({ run: "abc1", safe, parcelM: 25, taken: full }), (e) => {
    assert.equal(e.refusal, true);
    assert.match(e.message, /^no free ground for the rehearsal inside the Mists' safe box x 500\.\.700, y 500\.\.700 \(clear at keyframes 244, inset 500 m\): 3 of 3 places tried, each covered \(the last by the standing parcel "rh-old\/ground-3"\)$/);
    return true;
  });
  assert.equal(asked.length, 3);
  assert.ok(asked.every((at) => at.x < 1200 && at.y < 1200), `every place asked stands in the box: ${JSON.stringify(asked)}`);
  // a box too small for the two parcels refuses before it asks anything
  const tight = mistsSafeBox({ ...mists, border_m: { minX: 0, minY: 0, maxX: 1100, maxY: 1100 } }, mistsAt);
  await assert.rejects(findGround({ run: "abc1", safe: tight, parcelM: 25, taken: full }), /no ground for the rehearsal inside the Mists' safe box x 500\.\.600, y 500\.\.600 .*: the box holds no place for its two 25 m parcels 100 m apart \(0 places tried\)/);
  // a bounded search: at most maxTries places asked
  asked.length = 0;
  await assert.rejects(findGround({ run: "abc1", safe: mistsSafeBox(skeletonMists(), mistsAt), parcelM: 25, taken: full, maxTries: 7 }), /: 7 of \d+ places tried, each covered/);
  assert.equal(asked.length, 7);
});

const skeletonMists = () => publishedSkeleton(WORLD).skeleton.mists;

test("the run id picks where the walk starts, so two runs a minute apart stand on different ground; the first free place is taken", async () => {
  const { mistsAt } = await engine();
  const safe = mistsSafeBox(skeletonMists(), mistsAt);
  const free = async () => null;
  const a = await findGround({ run: (1000).toString(36), safe, parcelM: 25, taken: free });
  const b = await findGround({ run: (1001).toString(36), safe, parcelM: 25, taken: free });
  assert.notDeepEqual(a.parcelAt, b.parcelAt);
  assert.ok(Math.abs(a.parcelAt.x - b.parcelAt.x) >= 25 || Math.abs(a.parcelAt.y - b.parcelAt.y) >= 25, "their parcels do not meet");
  // the two parcels of one run stand apart, and the lamp and the planted copy stand on the first
  const [p1, p2, lamp, copy] = a.footprints;
  assert.ok(p2.at.y - p1.at.y > 25, "the by-hand parcel does not meet the first");
  for (const f of [lamp, copy]) assert.ok(Math.abs(f.at.x - p1.at.x) + f.extent.w / 2 <= 12.5 && Math.abs(f.at.y - p1.at.y) + f.extent.h / 2 <= 12.5, `${f.name} stands on the first parcel`);
  // covered places are walked past, in order, and the first free one is the answer
  let n = 0;
  const twoCovered = async () => (++n <= 2 ? "the pending parcel claim \"x\"" : null);
  const c = await findGround({ run: (1000).toString(36), safe, parcelM: 25, taken: twoCovered });
  assert.equal(c.tried, 3);
  assert.deepEqual(c.parcelAt, { x: a.parcelAt.x + 120, y: a.parcelAt.y });
});

test("a world with no Mists keeps the old strip of ground, still asked for free ground", async () => {
  const g = await findGround({ run: "abc1", safe: null, parcelM: 25, taken: async () => null });
  assert.equal(g.parcelAt.y, 30000);
  assert.equal(g.parcelAt2.y, 30100);
  assert.equal(g.parcelAt.x, 30000 + (parseInt("abc1", 36) % 400) * 60);
  assert.match(g.where, /the world has no Mists/);
  assert.equal(mistsSafeBox(undefined, () => null), null);
  assert.equal(mistsSafeBox({ schedule: [] }, () => null), null);
});
