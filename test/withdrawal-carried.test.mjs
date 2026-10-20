// withdrawal-carried.test.mjs — A PUBLISHED MARK ITS AUTHOR WITHDRAWS LEAVES
// CANON AT THE NEXT CROSSING (WLD-88).
//
//   node --test test/withdrawal-carried.test.mjs
//
// The door's promise, src/world.mjs § journalWithdraw: "your sketchbook lets it
// go now; canon lets it go at the next crossing — the settlement unpublishes
// it". From G1 (2026-09-08) the store crossing never kept it: the write-down
// wrote no removal, the sweep's `withdrawn` channel read 0 on every crossing,
// and Current's bed (act 18087, S250) stood in canon ten settlements on.
//
// THE RIG is the crossing's own chain, each link real: a Postgres with the
// whole schema (test/helpers/embedded-store.mjs), `foldDelta` over it with a
// register read by `canonRegisterAtSha`, `storeWriteDown` into a world checkout
// that carries the world's OWN tools (crossing-registry-real-sweep.test.mjs's
// fixture), the world's own `settlement-sweep.mjs` as settlement-auto.sh runs
// it, and the real `retire-unpublished.mjs` under the `clearing_job` pen.
//
// The fixture:
//   · current's bed: left at 249, published, withdrawn at 250. Owed.
//   · mari's garland: published, withdrawn, LEFT AGAIN. Its latest word is the
//     leave, so it is never removed.
//   · current's draft: withdrawn before it ever crossed. No row, nothing to do.
//   · kino's fireplace: published, and a withdraw by `the-town` on it (the
//     shape replay-ingest synthesises). The town is not its author, so it is
//     never owed (Wright's review of #672).

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { startStore } from "./helpers/embedded-store.mjs";
import { foldDelta } from "../world2/tools/fold-delta.mjs";
import { canonRegisterAtSha } from "../world2/tools/canon-register.mjs";
import { storeWriteDown } from "../src/store-writedown.mjs";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const RETIRE = join(OFFICE, "world2", "tools", "retire-unpublished.mjs");

function findWorldCheckout() {
  const candidates = [process.env.POSTMARK_WORLD_CLONE, process.env.WORLD_CLONE, join(OFFICE, "world-clone")].filter(Boolean);
  for (const c of candidates) if (existsSync(join(c, "tools", "settlement-sweep.mjs"))) return c;
  return null;
}
const WORLD = findWorldCheckout();
const WHY_SKIP = WORLD ? false : "no world checkout found (set POSTMARK_WORLD_CLONE)";

const store = await startStore({ db: "withdrawal_carried_test" });
after(() => store.stop());
const skip = store.skip ?? WHY_SKIP;
const scratch = mkdtempSync(join(tmpdir(), "withdrawal-carried-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* litter */ } });

const TOWN_SHA = "t".repeat(40);
const BED = "current/the-bed-under-the-moons-road";
const GARLAND = "mari/first-night-garland";
const DRAFT = "current/a-draft-that-never-crossed";
const FIREPLACE = "kino/the-fireplace";
const IDS = { bed: "d0000000-0000-4000-8000-000000000001", garland: "d0000000-0000-4000-8000-000000000002", fireplace: "d0000000-0000-4000-8000-000000000003" };
const REGISTRY = {
  households: { current: "gh:7", mari: "gh:8", kino: "gh:9" },
  logins: { "current-hub": "gh:7", "mari-hub": "gh:8", "kino-hub": "gh:9" },
};
const record = (by, x, body) =>
  `---\nkind: sited\nby: ${by}\ndate: 2026-10-14\nat: { x: ${x}, y: 10 }\nextent: { w: 3, h: 3 }\n---\n\n${body}\n`;

async function owner(fn) {
  const c = await store.connect("world2_owner");
  try { return await fn(c); } finally { await c.end(); }
}
const read = (sql, args = []) => owner(async (c) => (await c.query(sql, args)).rows);

async function seed() {
  await owner(async (c) => {
    await c.query("TRUNCATE escrow_projection, claims, marks, windows, acts CASCADE");
    const opened = Date.UTC(2026, 9, 14, 5, 45, 40);
    for (const [id, status] of [[249, "closed"], [250, "closed"], [251, "open"]]) {
      const opens = new Date(opened + (id - 249) * 12 * 3600e3).toISOString();
      await c.query(
        `INSERT INTO windows (id, opens_at, closes_at, status, cleared_at, town_sha)
         VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4, $5)`,
        [id, opens, status, status === "closed" ? opens : null, status === "closed" ? TOWN_SHA : null]);
    }
    // stakesFromStore refuses an empty escrow read; the escrow is on no mark here.
    await c.query(
      `INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k)
       VALUES ($1, 'someone/elsewhere', 'mari', 'gh:8', 'gh:9', 1, 5)`, [TOWN_SHA]);
    const mark = (id, slug, owner, household, x) => c.query(
      `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
       VALUES ($1, $2, 'sited', $3, $4, $5, $6, $7::box, 'standing', 249, $8)`,
      [id, slug, owner, household, `${slug}, as it stood.`,
        JSON.stringify({ at: { x, y: 10 }, extent: { w: 3, h: 3 } }), `((${x - 1.5},8.5),(${x + 1.5},11.5))`,
        JSON.stringify({ by: owner, date: "2026-10-14" })]);
    await mark(IDS.bed, BED, "current", "gh:7", 10);
    await mark(IDS.garland, GARLAND, "mari", "gh:8", 30);
    await mark(IDS.fireplace, FIREPLACE, "kino", "gh:9", 50);
    const act = (id, crossing, actor, action, object, household, payload) => c.query(
      `INSERT INTO acts (at, crossing, actor, action, object, class, payload, household)
       VALUES ($1, $2, $3, $4, $5, 'mark', $6, $7)`,
      [new Date(opened + id * 1000).toISOString(), crossing, actor, action, object, JSON.stringify(payload), household]);
    await act(1, 249, "current", "leave-mark", BED, "gh:7", { by: "current", slug: "the-bed-under-the-moons-road" });
    await act(2, 249, "mari", "leave-mark", GARLAND, "gh:8", { by: "mari", slug: "first-night-garland" });
    await act(3, 250, "current", "withdraw", BED, "gh:7", { by: "current", slug: "the-bed-under-the-moons-road", was_published: true });
    await act(4, 250, "mari", "withdraw", GARLAND, "gh:8", { by: "mari", slug: "first-night-garland", was_published: true });
    await act(5, 250, "mari", "leave-mark", GARLAND, "gh:8", { by: "mari", slug: "first-night-garland" });
    await act(6, 250, "current", "withdraw", DRAFT, "gh:7", { by: "current", slug: "a-draft-that-never-crossed", was_published: false });
    await act(7, 249, "kino", "leave-mark", FIREPLACE, "gh:9", { by: "kino", slug: "the-fireplace" });
    await act(8, 250, "the-town", "withdraw", FIREPLACE, null, { type: "withdraw", actor: "the-town", object: FIREPLACE, _synthesised: "replay-ingest DEC-15 case (b)" });
  });
}

/** A world the real sweep will accept: its own tools, the frame, and both published marks. */
function world(t) {
  const repo = mkdtempSync(join(scratch, "world-"));
  cpSync(join(WORLD, "tools"), join(repo, "tools"), { recursive: true });
  const put = (p, text) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); };
  put("WORLD/skeleton.json", `${JSON.stringify({ features: [], physics_registry: {} }, null, 2)}\n`);
  put("WORLD/marks/let-there-be-light/mark.md",
    "---\nkind: sited\nby: the-town\ntier: constitution\nat: { x: 0, y: 0 }\n"
    + "extent: { w: 320000, h: 320000 }\ndate: 2026-07-01\n---\n\nthe frame\n");
  put(`WORLD/marks/${BED}/mark.md`, record("current", 10, "The flat's bed under the eaves, never made."));
  put(`WORLD/marks/${GARLAND}/mark.md`, record("mari", 30, "A garland for the first night."));
  put(`WORLD/marks/${FIREPLACE}/mark.md`, record("kino", 50, "A fireplace with a kettle on the hob."));
  put("WORLD/households.json", `${JSON.stringify(REGISTRY, null, 2)}\n`);
  put("package.json", JSON.stringify({ name: "world-fixture", type: "module" }));
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "-b", "main");
  execFileSync(process.execPath, [join(repo, "tools", "marks-fold.mjs")], { cwd: repo });
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=f@test.invalid", "commit", "-q", "-m", "canon");
  return { repo, git, main: () => git("rev-parse", "main") };
}

/** One store crossing at window 250, link by link, as settlement-auto.sh runs it. */
async function cross(w) {
  const sha = w.main();
  const canonRegister = await canonRegisterAtSha({ worldRepo: w.repo, sha });
  const client = await store.connect("world2_owner");
  let input;
  try { input = await foldDelta(client, { window: 250, worldSha: sha, canonRegister }); }
  finally { await client.end(); }
  const writeDown = storeWriteDown({ repo: w.repo, input, at: Date.UTC(2026, 9, 15, 18, 0, 0) });
  const inputPath = join(scratch, `fold-input-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(inputPath, JSON.stringify(input));
  const stakes = join(scratch, `stakes-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(stakes, JSON.stringify(input.stakes));
  const r = spawnSync(process.execPath, [join(w.repo, "tools", "settlement-sweep.mjs"), "--stakes", stakes, "--json"],
    { cwd: w.repo, encoding: "utf8" });
  assert.equal(r.status, 0, `the world's sweep refused:\n${r.stdout}\n${r.stderr}`);
  const sweepPath = join(scratch, `sweep-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(sweepPath, r.stdout);
  return { input, inputPath, writeDown, sweep: JSON.parse(r.stdout), sweepPath };
}

function retire(sweepPath, { foldInput = null, url = store.url("clearing_job") } = {}) {
  const r = spawnSync(process.execPath, [RETIRE, "--sweep", sweepPath, ...(foldInput ? ["--fold-input", foldInput] : [])], {
    cwd: OFFICE, encoding: "utf8", timeout: 60_000,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: url },
  });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* the assertion prints it */ }
  return { code: r.status, out, raw: `${r.stdout}\n${r.stderr}` };
}

const ids = (rows) => (rows ?? []).map((r) => r.id);
const onMain = (w, slug) => w.git("ls-tree", "-r", "--name-only", "main", "--", "WORLD/marks").split("\n").includes(`WORLD/marks/${slug}/mark.md`);

test("THE PROMISE · a published mark withdrawn at crossing N is out of canon after N's sweep, and retired in the store, with no act from its author", { skip }, async (t) => {
  await seed();
  const w = world(t);
  const one = await cross(w);

  assert.deepEqual(one.input.selection.withdrawn_owed.slugs, [BED], "the bed is owed; the re-left garland and the draft are not");
  assert.deepEqual(one.input.selection.withdrawn_owed.acts, [{ slug: BED, act: one.input.selection.withdrawn_owed.acts[0].act, crossing: 250 }]);
  assert.deepEqual(one.writeDown.withdrawals, [{ id: BED, household_key: "gh:7" }]);

  assert.deepEqual(ids(one.sweep.withdrawn), [BED], `the sweep's withdrawal law carried it: ${JSON.stringify(one.sweep.left_drafted)}`);
  assert.deepEqual(ids(one.sweep.unpublished), [], "and it left by the withdrawn channel, not by an escrow unpublish");
  assert.equal(onMain(w, BED), false, "canon let it go");
  assert.equal(onMain(w, GARLAND), true, "a mark whose latest word is a leave stays");
  assert.match(w.git("log", "-1", "--format=%s", "main"), /1 withdrawn/);

  const run = retire(one.sweepPath);
  assert.equal(run.code, 0, run.raw);
  assert.deepEqual(run.out.withdrawn.retired.map((r) => [r.slug, r.window, r.cause]), [[BED, 251, "settlement-withdraw"]]);
  assert.equal(run.out.count, 0, "the unpublish door retired nothing");
  const [bed] = await read("SELECT status, retired_window, retired_cause FROM marks WHERE slug = $1", [BED]);
  assert.deepEqual(bed, { status: "retired", retired_window: 251, retired_cause: "settlement-withdraw" });
  assert.deepEqual(await read("SELECT id FROM claims WHERE slug = $1", [BED]), [], "a withdrawn mark goes back to no one's drafts");

  // The next crossing owes nothing and carries nothing back.
  const two = await cross(w);
  assert.equal(two.input.selection.withdrawn_owed.count, 0);
  assert.equal(two.input.selection.carried_absent.count, 0);
  assert.deepEqual(ids(two.sweep.withdrawn), []);
  assert.equal(onMain(w, BED), false);
});

test("THE RETRY · a retire that refused at N leaves the row owed, the carry never republishes it, and N+1 retires it", { skip }, async (t) => {
  await seed();
  const w = world(t);
  const one = await cross(w);
  assert.deepEqual(ids(one.sweep.withdrawn), [BED]);
  // The retire step refuses at N: the store cannot be reached. The world is
  // already published, so the row stands with no file in canon.
  const refused = retire(one.sweepPath, { foldInput: one.inputPath, url: "postgres://clearing_job:x@127.0.0.1:1/nowhere" });
  assert.notEqual(refused.code, 0, refused.raw);
  assert.equal((await read("SELECT status FROM marks WHERE slug = $1", [BED]))[0].status, "standing");

  // N+1: that row is the carry's set (standing, canon-absent), and the carry
  // must leave it alone; the fold names its retirement as owed instead.
  const two = await cross(w);
  assert.equal(two.input.selection.carried_absent.count, 0, JSON.stringify(two.input.selection.carried_absent));
  assert.equal(two.input.selection.withdrawn_owed.count, 0, "nothing left to remove");
  assert.deepEqual(two.input.selection.withdrawn_owed.retire_only, [BED]);
  assert.deepEqual(ids(two.sweep.published), []);
  assert.equal(onMain(w, BED), false, "the bed must not come back");

  const run = retire(two.sweepPath, { foldInput: two.inputPath });
  assert.equal(run.code, 0, run.raw);
  assert.deepEqual(run.out.withdrawn.retire_only, [BED]);
  assert.deepEqual(run.out.withdrawn.retired.map((r) => [r.slug, r.cause]), [[BED, "settlement-withdraw"]]);
  const [bed] = await read("SELECT status, retired_cause FROM marks WHERE slug = $1", [BED]);
  assert.deepEqual(bed, { status: "retired", retired_cause: "settlement-withdraw" });
  assert.deepEqual(await read("SELECT id FROM claims WHERE slug = $1", [BED]), [], "and goes back to no one's drafts");

  const three = await cross(w);
  assert.deepEqual(three.input.selection.withdrawn_owed.retire_only, [], "owed once, retired once");
});

test("THE AUTHOR'S WORD ONLY · a withdraw by the town on a resident's standing mark is not owed, and the mark stays in canon", { skip }, async (t) => {
  await seed();
  const w = world(t);
  const one = await cross(w);
  const owed = one.input.selection.withdrawn_owed;
  assert.ok(!owed.slugs.includes(FIREPLACE) && !owed.retire_only.includes(FIREPLACE), JSON.stringify(owed));
  assert.ok(!ids(one.sweep.withdrawn).includes(FIREPLACE));
  assert.equal(onMain(w, FIREPLACE), true);
  assert.equal((await read("SELECT status FROM marks WHERE slug = $1", [FIREPLACE]))[0].status, "standing");
});
