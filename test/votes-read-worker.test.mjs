// votes-read-worker.test.mjs — the ballot box is a READ, and a read worker
// answers it (postmark-town/postmark#3383).
//
// Since POS-266 every GET on prod is answered by a read worker, which boots as
// `--role read` and is never `canWrite` (server.mjs § canWrite). GET /votes and
// the doorstep's votes garnish both asked for `canWrite`, so on prod the Ballot
// Box answered `409 not-yet-open` to the whole town and every doorstep dropped
// its votes block, while the worker's own town clone held the engine. Nothing
// went red because no test asked a worker for either.
//
// These legs boot a REAL read worker the way the pool boots one (`--role read`,
// the writer's town clone in TOWN_CLONE) and ask over HTTP:
//
//   § 1  GET /votes and GET /votes/{topic} answer 200 with the town's closed
//        ballot, read from the real town clone through its own engine
//   § 2  a /doorstep served by a worker carries the votes block for an open
//        topic (a small clone of the engine with one staking ballot)
//   § 3  the stake is still a write: a read worker refuses POST /votes/stake
//
// THE FLIP: put `!canWrite ||` back on the GET /votes gate and § 1 reds with
// 409; put `canWrite &&` back on the doorstep garnish and § 2 reds.
//
// SINCE POS-349 the ballot is a post and each stake its vote, so the worker
// reads the office's record: the suite's store (a real Postgres), filled the
// way the box fills it — the town's real ballot backfilled from the real town
// clone's file and ledger (tools/ballots-backfill.mjs), the open one ingested.
// § 1's 77 for Iris is then the store's, and --check holds it equal to the
// ledger's own count.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, copyFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { testIndex } from "./helpers/office-under-test.mjs";
import { copyIndexToStore } from "./helpers/index-to-store.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs"; // POS-352: static keys are store rows

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOWN = join(ROOT, "town-clone");
const KEY = "votes-read-worker-key";
const WRITER = "https://postmark.town/api";
const FETCH_MS = 20_000;
const HAVE_TOWN = existsSync(join(TOWN, "tools", "ballot.mjs"))
  && existsSync(join(TOWN, "WHITE_PAGES", "ballot-illuminator-name.json"));

let tmp;
const workers = [];

async function bootWorker(townClone) {
  const env = {
    ...process.env,
    WORLD_GRAPH_NONE: "1",
    // the town index is the record's own store too, seeded from the fixture below (POS-268)
    ...(testIndex() === "store" ? { TOWN_INDEX_READS: "store" } : {}),
    WORLD_DYNAMIC_DB: join(tmp, "dynamic.db"),
    TOWN_CLONE: townClone,
    WORLD_CLONE: join(tmp, "no-world-clone"),
    WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"),
  };
  const { child, port } = await bootOnFreePort((port) => spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"),
    "--port", String(port),
    "--db", join(tmp, "fixture.db"),
    "--oauth-db", join(tmp, "oauth.db"),
    "--roles-db", join(tmp, "roles.db"),
    "--role", "read", "--writer", WRITER,
  ], { env, stdio: ["ignore", "pipe", "pipe"] }), { budgetMs: 20_000 });
  workers.push(child);
  const base = `http://127.0.0.1:${port}`;
  return (path, init = {}) => fetch(`${base}${path}`, {
    signal: AbortSignal.timeout(FETCH_MS),
    ...init,
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

// A town clone holding only the engine and one OPEN ballot: the doorstep's
// garnish names open topics only, and the town's one real ballot is closed.
function engineClone() {
  const dir = join(tmp, "engine-clone");
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  for (const f of ["ballot.mjs", "stamp-mint.mjs"]) copyFileSync(join(TOWN, "tools", f), join(dir, "tools", f));
  writeFileSync(join(dir, "WHITE_PAGES", "ballot-w42-open.json"), JSON.stringify({
    topic: "w42-open", status: "staking", cap_per_household_per_candidate: 20,
    candidates: ["Postmark", "Ferry"],
  }));
  return dir;
}

let onTown, onEngine, store, checked;

before(async () => {
  if (!HAVE_TOWN) return;
  store = await startStore({ db: "votes_worker_test" });
  const env = { ...process.env, WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api") };
  const { backfill, check } = await import("../tools/ballots-backfill.mjs");
  const { ingestBallotFiles } = await import("../src/ballots-store.mjs");
  tmp = mkdtempSync(join(tmpdir(), "postmark-votes-worker-"));
  await backfill(TOWN, { hand: "keemin", apply: true, env });
  checked = await check(TOWN, { env });
  const engine = engineClone();
  await ingestBallotFiles(engine, { hand: "keemin", env });
  const fixture = fixtureDb(join(tmp, "fixture.db"));
  // the town index, in the same store the ballots are in, seeded from this fixture (POS-268)
  if (testIndex() === "store") {
    const w = await store.connect("law_ingester");
    try { await copyIndexToStore(w, fixture); } finally { await w.end(); }
  }
  fixture.close();
  const { openDynamic } = await import("../src/dynamic-store.mjs");
  openDynamic(join(tmp, "dynamic.db")).close();
  const { openOauthDb } = await import("../src/oauth.mjs");
  openOauthDb(join(tmp, "oauth.db")).close();
  seedStaticKeys(join(tmp, "oauth.db"), `${KEY}=keemin:wright`); // POS-352: the static row the worker reads
  onTown = await bootWorker(TOWN);
  onEngine = await bootWorker(engine);
});

after(async () => {
  for (const c of workers) {
    if (c.exitCode !== null) continue;
    const gone = new Promise((ok) => c.on("exit", ok));
    c.kill();
    await gone;
  }
  if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (store) await store.stop();
});

const skip = HAVE_TOWN ? false : "needs the pool's town-clone with tools/ballot.mjs";

test("§1 a read worker answers GET /votes with the town's ballot (#3383)", { skip }, async () => {
  const rel = await (await onTown("/release")).json();
  assert.equal(rel.role, "read", "the office under test is a read worker");

  const res = await onTown("/votes");
  const body = await res.json();
  assert.equal(res.status, 200, `the Ballot Box must load on a worker: ${JSON.stringify(body).slice(0, 200)}`);
  const t = body.topics.find((x) => x.topic === "illuminator-name");
  assert.ok(t, `the town's ballot is listed: ${JSON.stringify(body.topics.map((x) => x.topic))}`);
  assert.equal(t.status, "closed");
  const iris = t.candidates.find((c) => c.candidate === "Iris");
  assert.equal(iris?.staked, 77, "the tally is the ballot post's votes, backfilled from the real ledger");
  assert.equal(checked.equal, true, `--check holds the store equal to the ledger: ${checked.differences.join("; ")}`);

  const one = await onTown("/votes/illuminator-name");
  const full = await one.json();
  assert.equal(one.status, 200, `GET /votes/{topic} too: ${JSON.stringify(full).slice(0, 200)}`);
  assert.equal(full.topic, "illuminator-name");
});

test("§2 a /doorstep served by a read worker carries the votes block (#3383)", { skip }, async () => {
  const res = await onEngine("/doorstep/wright");
  const d = await res.json();
  assert.equal(res.status, 200, `the doorstep answers: ${JSON.stringify(d).slice(0, 200)}`);
  assert.ok(Array.isArray(d.votes), `the votes garnish is present on a worker: votes=${JSON.stringify(d.votes)}`);
  const open = d.votes.find((v) => v.topic === "w42-open");
  assert.ok(open, "the open topic is named");
  assert.equal(open.status, "staking");
  assert.deepEqual(Object.keys(open.candidates).sort(), ["Ferry", "Postmark"]);
});

test("§3 the stake is still a write: a read worker refuses POST /votes/stake", { skip }, async () => {
  for (const call of [onTown, onEngine]) {
    const res = await call("/votes/stake", {
      method: "POST",
      body: JSON.stringify({ from: "wright", topic: "w42-open", candidate: "Ferry", stamps: 1 }),
    });
    const body = await res.json().catch(() => ({}));
    assert.equal(res.status, 405, `a worker never takes a stake: ${JSON.stringify(body).slice(0, 200)}`);
    assert.equal(body.defect, "this office reads only");
  }
});
