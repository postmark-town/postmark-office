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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PROD_DB, databaseOf, githubStub, parseEnvFile, storeGuard, treeTables } from "../tools/dev-rehearsal.mjs";

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
