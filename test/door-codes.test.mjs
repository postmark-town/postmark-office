// door-codes.test.mjs — a door answers its own codes (POS-544, POS-520).
//
// POS-544: since POS-484 a store restart no longer crashes the office, but the
// one request in flight when its session ends got 500 ("the drafts door
// tripped") at /world2/my-drafts and /world2/my-marks, while every request made
// during the outage got the bearer check's 503 with Retry-After. The in-flight
// request is an outage too, and now says so.
//
// POS-520: GET /world/apex answered 500 ("the world door tripped") for an error
// carrying its own HTTP code that escaped the apex, where POST /world/apex and
// the MCP door rebuild it with that code. Now GET answers the error's own code,
// and `refused: true` (POS-427) rides with it.
//
// THE RIG. One office on a store (test/helpers/office-under-test.mjs), a static
// key, and, for the apex, a test-only module hook (`--import`) that adds one
// line at the top of world-apex.mjs § worldApexAnswer: a `find:` that starts
// "synthetic-" throws the named synthetic error. Nothing in src/ knows about it.
// The store cases end a REAL session: a lock on `claims` holds the door's query
// inside its transaction, and pg_terminate_backend ends that backend with the
// FATAL 57P01 a restart's fast shutdown sends.
//
//   node --test test/door-codes.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtureDb } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs";
import { removeTempDir, tempDir } from "./helpers/temp-dir.mjs";
import { isStoreUnreachable, StoreAcquireTimeout, NestedStoreError } from "../src/store-pool.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = tempDir("door-codes-");
const KEY = "pos544-door-codes-test-key";
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ── the classifier, alone ────────────────────────────────────────────────────

const coded = (code, message = "x") => Object.assign(new Error(message), { code });

test("isStoreUnreachable: the ways pg, pg-pool and Node say the store is gone", () => {
  for (const [what, e] of [
    ["a restart's fast shutdown (57P01)", coded("57P01", "terminating connection due to administrator command")],
    ["a crash shutdown (57P02)", coded("57P02")],
    ["a store starting up or in recovery (57P03)", coded("57P03", "the database system is starting up")],
    ["a connection exception (08006)", coded("08006")],
    ["too many connections (53300)", coded("53300", "sorry, too many clients already")],
    ["a refused dial", coded("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:5432")],
    ["a reset socket", coded("ECONNRESET")],
    ["pg: a session ended under the client", new Error("Connection terminated unexpectedly")],
    ["pg: a client whose connection failed", new Error("Client has encountered a connection error and is not queryable")],
    ["pg: the client's connect timeout", new Error("timeout expired")],
    ["pg-pool: the acquire timeout", new Error("timeout exceeded when trying to connect")],
    ["pg-pool: the dial timeout", new Error("Connection terminated due to connection timeout")],
    ["store-pool's own acquire timeout", new StoreAcquireTimeout("pen", 3, 10_000)],
    ["a dial that tried two addresses", new AggregateError([coded("ECONNREFUSED"), coded("ECONNREFUSED")], "connect failed")],
    ["a wrapper whose cause is the lost session", new Error("the record cannot be reached", { cause: coded("57P01") })],
  ]) assert.equal(isStoreUnreachable(e), true, what);
});

test("isStoreUnreachable: the work's own failures are not an outage", () => {
  for (const [what, e] of [
    ["a unique violation (23505)", coded("23505", "duplicate key value violates unique constraint")],
    ["a missing table (42P01)", coded("42P01")],
    ["a row policy refusal (42501)", coded("42501")],
    ["a plain fault", new Error("the door's own work failed")],
    ["a coded refusal (an HTTP number)", Object.assign(new Error("no"), { code: 409, defect: "no" })],
    ["the nested pen refusal", new NestedStoreError("a", "b")],
    ["nothing", null],
    ["a string", "Connection terminated"],
  ]) assert.equal(isStoreUnreachable(e), false, what);
});

// ── one office, with the synthetic-throw hook ───────────────────────────────

// The hook adds one line at the top of worldApexAnswer. It refuses to load the
// module if the anchor is not there exactly once, so a moved function fails
// this file loudly instead of letting every apex case pass on an unhooked office.
const HOOKS = `
const ANCHOR = "async function worldApexAnswer(args, key, ctx) {";
const SYNTHETIC = ${JSON.stringify({
  "synthetic-409": { code: 409, message: "a synthetic refusal", defect: "a synthetic refusal, thrown past the apex (POS-520)", hint: "the fixture's own hint" },
  "synthetic-plain": { message: "a synthetic fault, carrying no code" },
  "synthetic-store-lost": { code: "57P01", message: "terminating connection due to administrator command" },
})};
const LINE = "if (typeof args?.find === 'string' && Object.hasOwn(SYNTHETIC_THROWS, args.find)) throw Object.assign(new Error(SYNTHETIC_THROWS[args.find].message), SYNTHETIC_THROWS[args.find]);";
export async function load(url, context, nextLoad) {
  const r = await nextLoad(url, context);
  if (!url.endsWith("/src/world-apex.mjs")) return r;
  const src = String(r.source);
  if (src.split(ANCHOR).length !== 2) throw new Error("door-codes hook: worldApexAnswer's opening line is not in world-apex.mjs exactly once");
  return { ...r, source: src.replace(ANCHOR, () => ANCHOR + " " + LINE) + "\\nconst SYNTHETIC_THROWS = " + JSON.stringify(SYNTHETIC) + ";\\n", shortCircuit: true };
}
`;

let ix = null, office = null, admin = null;

before(async () => {
  const dbPath = join(tmp, "office.db");
  fixtureDb(dbPath).close();
  ix = await indexStore(dbPath, { db: "door_codes" });
  admin = await ix.store.connect("office_api"); // the office's own role, so it may see and end the office's sessions
  admin.on("error", () => {});
  const hooks = join(tmp, "hooks.mjs");
  writeFileSync(hooks, HOOKS);
  const register = join(tmp, "register.mjs");
  writeFileSync(register, `import { register } from "node:module";\nregister(${JSON.stringify(pathToFileURL(hooks).href)});\n`);
  const child = spawn(process.execPath, ["--import", pathToFileURL(register).href, join(ROOT, "src", "server.mjs"), "--port", "0", "--db", dbPath,
    "--oauth-db", seedStaticKeys(join(tmp, "oauth.db"), `${KEY}=fixture-house:wright`), "--roles-db", join(tmp, "roles.db")], {
    env: { ...process.env, TOWN_CLONE: join(tmp, "no-clone-here"), WORLD_CLONE: join(tmp, "no-world-clone"), VOICES_LOG: join(tmp, "voices.jsonl"),
      TOWN_PUSH: "", WORLD_APEX: "1", WORLD_STORE_DB: join(tmp, "no-world.db"), ...ix.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error(`the office never listened: ${stderr.slice(-600)}`)), 30_000);
    child.stdout.on("data", (d) => { const m = /listening on :(\d+)/.exec(String(d)); if (m) { clearTimeout(t); office = { child, base: `http://127.0.0.1:${m[1]}`, stderr: () => stderr }; ok(); } });
    child.on("exit", (c) => no(new Error(`the office exited early (${c}): ${stderr.slice(-600)}`)));
  });
});

after(async () => {
  const child = office?.child;
  if (child && child.exitCode === null) { child.kill(); }
  await admin?.end().catch(() => {});
  await ix?.stop();
  await removeTempDir(tmp, { children: [child] });
});

const get = (path, { key = KEY } = {}) =>
  fetch(`${office.base}${path}`, { headers: key ? { authorization: `Bearer ${key}` } : {} });
const post = (path, body) =>
  fetch(`${office.base}${path}`, { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: JSON.stringify(body) });
const answer = async (res) => ({ status: res.status, retryAfter: res.headers.get("retry-after"), body: await res.json() });

// ── POS-520: GET /world/apex answers a coded error's own code ────────────────

test("POS-520 GET /world/apex: a coded error thrown past the apex answers its own code, refused, with its own words", async () => {
  const r = await answer(await get("/world/apex?find=synthetic-409", { key: null }));
  assert.equal(r.status, 409, `GET answers the error's own code, not the door's 500: ${JSON.stringify(r.body).slice(0, 300)}`);
  assert.equal(r.body.refused, true, "the refusal says so (POS-427)");
  assert.equal(r.body.defect, "a synthetic refusal, thrown past the apex (POS-520)");
  assert.equal(r.body.hint, "the fixture's own hint");
});

test("POS-520 POST /world/apex: the same coded error answers the same code (the twin GET now matches)", async () => {
  const r = await answer(await post("/world/apex", { find: "synthetic-409" }));
  assert.equal(r.status, 409, JSON.stringify(r.body).slice(0, 300));
  assert.equal(r.body.refused, true);
  assert.equal(r.body.defect, "a synthetic refusal, thrown past the apex (POS-520)");
});

test("GET /world/apex: an error with no code is still the door's own fault, 500", async () => {
  const r = await answer(await get("/world/apex?find=synthetic-plain", { key: null }));
  assert.equal(r.status, 500);
  assert.equal(r.body.defect, "the world door tripped");
  assert.equal(r.body.refused, true);
});

test("POS-544 at the apex: a store lost under GET or POST /world/apex answers 503 with Retry-After", async () => {
  const g = await answer(await get("/world/apex?find=synthetic-store-lost", { key: null }));
  assert.equal(g.status, 503, `GET: ${JSON.stringify(g.body).slice(0, 300)}`);
  assert.equal(g.retryAfter, "30");
  assert.match(g.body.hint, /A read is safe to repeat/);
  const p = await answer(await post("/world/apex", { find: "synthetic-store-lost" }));
  assert.equal(p.status, 503, `POST: ${JSON.stringify(p.body).slice(0, 300)}`);
  assert.equal(p.retryAfter, "30");
  assert.match(p.body.hint, /may not have been recorded/);
  assert.equal(p.body.refused, true);
});

// ── POS-544: a session ended mid-request at the two keyed doors ──────────────

/**
 * Hold `path` inside its store query with a lock on `claims`, end that session
 * the way a restart does, and answer what the door said; then let the lock go.
 */
async function endSessionMidRequest(path) {
  const owner = await ix.store.connect("world2_owner");
  owner.on("error", () => {});
  let ended = [];
  try {
    await owner.query("BEGIN");
    await owner.query("LOCK TABLE claims IN ACCESS EXCLUSIVE MODE");
    const pending = get(path).then(answer);
    let waiters = [];
    for (let i = 0; i < 300 && !waiters.length; i++) {
      ({ rows: waiters } = await admin.query(
        `SELECT pid, query FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock' AND query ILIKE '%claims%'`));
      if (!waiters.length) await wait(50);
    }
    assert.ok(waiters.length, `${path} reached a query on claims and waited on the lock`);
    for (const w of waiters) await admin.query("SELECT pg_terminate_backend($1)", [w.pid]);
    ended = waiters.map((w) => w.query.replace(/\s+/g, " ").slice(0, 120));
    return { ...(await pending), ended };
  } finally {
    await owner.query("ROLLBACK").catch(() => {});
    await owner.end().catch(() => {});
  }
}

for (const door of ["/world2/my-drafts", "/world2/my-marks"]) {
  test(`POS-544 ${door}: a session ended mid-request answers 503 with Retry-After, never 500; the office stays up, and the same request answers 200 after`, async (t) => {
    const before = await answer(await get(door));
    assert.equal(before.status, 200, `the door answers before the outage: ${JSON.stringify(before.body).slice(0, 300)}`);

    const r = await endSessionMidRequest(door);
    t.diagnostic(`the session ended mid-request was waiting in: ${r.ended.join(" | ")}`);
    assert.equal(r.status, 503, `the in-flight request is an outage, not the door's fault (ended: ${JSON.stringify(r.ended)}): ${JSON.stringify(r.body).slice(0, 300)}`);
    assert.equal(r.retryAfter, "30", "it says when to ask again");
    assert.equal(r.body.refused, true);
    assert.match(r.body.defect, /store went away mid-request/);
    assert.match(r.body.hint, /A read is safe to repeat/);

    assert.equal(office.child.exitCode, null, `the office is still up: ${office.stderr().slice(-400)}`);
    const again = await answer(await get(door));
    assert.equal(again.status, 200, `the same request answers once the store is back: ${JSON.stringify(again.body).slice(0, 300)}`);
  });
}
