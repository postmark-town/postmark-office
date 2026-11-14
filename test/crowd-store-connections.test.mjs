// crowd-store-connections.test.mjs — POS-1048: a crowd acting at once does not queue the office's store pools into their acquire timeout.
//
// WHAT HAPPENED. La Cave's opening, 2026-11-14 20:10Z: about 70 residents acting at the doors, and the office logged "timeout exceeded when trying to
// connect" 25 times while the store sat at 4.6 load on four cores with every read fast. The store was not out of connections: the office's pools are
// capped (pen 3, acts 2, serve 3, claims 2) and a crowd cannot raise them. The ACTS pool is two, and every act door read the enter/exit record on it up
// to six times (an orient and an eyes, each a `count(*)` over every passage ever made, then the whole table whenever a passage had landed): seventy acts
// queued four hundred scans on two connections, so a request waited its ten seconds in the pool's line and failed, and the act it belonged to landed
// late. The act door also read the resident's note through the PEN (two checkouts, one of them a write-mode transaction) for an answer that never
// carries it. The cause and the 100-person numbers are on POS-1048.
//
// THE REGRESSION is the door itself: invented residents act through the real apex at once, over a real Postgres, on the office's own pool options
// (store-pool.mjs § storePoolOptions), and the test counts what the act door asked of each pool. It fails when the faulty call-site behaviour is put
// back (the flips are recorded at the foot of this file).
//
//   node --test test/crowd-store-connections.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { markRecord } from "../src/mark-record.mjs";
import { trailingFlight, storePoolOptions, watchPoolErrors } from "../src/store-pool.mjs";

const WORLD = worldClone();
const store = await startStore({ db: "crowd_store_connections" });
const skip = store.skip ?? ((!WORLD && NO_WORLD) || false);

const CROWD = 60;
const HANDLES = Array.from({ length: CROWD }, (_, i) => `sbx-c${String(i).padStart(2, "0")}`);
const AT = (i) => ({ x: 1000 + (i % 10) * 6, y: 1000 + Math.floor(i / 10) * 6 }); // a venue's floor: sixty residents within a few paces of each other
const repo = mkdtempSync(join(tmpdir(), "pos1048-"));
const NO_TOWN = mkdtempSync(join(tmpdir(), "pos1048-no-town-"));
const put = (p, content) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); };
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "WORLD2_PG_ACQUIRE_MS", "W2_PEN", "W2_GUARDS", "WORLD_CLONE", "WORLD_SINGLE_LOG", "WORLD_POOL", "TOWN_CLONE"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
let penPool, actsPool, servePool, pen, acts;

if (!skip) {
  mkdirSync(join(repo, "tools"), { recursive: true });
  for (const f of readdirSync(join(WORLD, "tools")).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")))
    copyFileSync(join(WORLD, "tools", f), join(repo, "tools", f));
  const homes = Object.fromEntries(HANDLES.map((h, i) => [h, AT(i)]));
  put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export const QUAY_MARK_ID = "the-town/the-quay";
const HOMES = ${JSON.stringify(homes)};
export function homeOf(handle) { const h = HOMES[handle]; return h ? { ...h, mark_id: handle + "/home", placed: true, source: "home", parcel: { id: handle + "/home", at: { x: h.x, y: h.y }, extent: { w: 4, h: 4 } } } : NOWHERE; }
export function whereIs(handle) { const h = homeOf(handle); return h.placed ? { ...h, position: null } : NOWHERE; }
export function publicResidents() { return []; }
export function porchOf() { return null; }
export function householdOf() { return null; }
export function parcelsFor() { return []; }
export function parcelFor() { return null; }
export function sourceLabel() { return "home"; }
`);
  const root = { id: "the-town/let-there-be-light", by: "the-town", slug: "let-there-be-light", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10000, h: 10000 } };
  const ms = HANDLES.map((h, i) => ({ rec: { id: `${h}/home`, by: h, slug: "home", kind: "parcel", at: AT(i), extent: { w: 4, h: 4 } }, body: `${h}'s home ground.` }));
  put("WORLD/marks/let-there-be-light/mark.md", markRecord(root, "Synthetic world frame."));
  for (const m of ms) put(`WORLD/marks/${m.rec.id}/mark.md`, markRecord(m.rec, m.body));
  put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: [root, ...ms.map((m) => m.rec)] }));
  copyFileSync(join(WORLD, "WORLD", "skeleton.json"), join(repo, "WORLD", "skeleton.json"));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "add", "-A", "WORLD", "tools"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qm", "synthetic canon"]);
  Object.assign(process.env, { WORLD_CLONE: repo, WORLD_SINGLE_LOG: "", WORLD_POOL: "0", WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"),
    WORLD2_PG_ACQUIRE_MS: "2500", W2_PEN: "hold", W2_GUARDS: "1", TOWN_CLONE: NO_TOWN });
  const { default: pg } = await import("pg");
  // the office's own pools, at the office's own sizes (pen 3, acts 2, serve 3), counted by what is asked of them
  const own = (name, max) => watchPoolErrors(new pg.Pool(storePoolOptions({ ...process.env }, { name, max })), name);
  penPool = own("pen", 3);
  actsPool = own("acts", 2);
  servePool = own("serve", 3);
  pen = await import("../src/world2-pen.mjs");
  acts = await import("../src/world2-acts.mjs");
  pen.__setPoolForTest(penPool);
  acts.__setPoolForTest(actsPool);
}
after(async () => {
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  if (!skip) { pen.__setPoolForTest(null); acts.__setPoolForTest(null); }
  for (const p of [penPool, actsPool, servePool]) await p?.end().catch(() => {});
  await store.stop();
  rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(NO_TOWN, { recursive: true, force: true });
});

/** Count every checkout of a pool and every statement run through it (Pool.query, or a held client's), and the deepest line it saw. */
function watch(pool) {
  const seen = { checkouts: 0, peakWaiting: 0, errors: 0, sql: [] };
  const note = (t) => seen.sql.push(String(typeof t === "string" ? t : t?.text).replace(/\s+/g, " "));
  const query = pool.query.bind(pool);
  pool.query = (text, ...rest) => { note(text); return query(text, ...rest); };
  const connect = pool.connect.bind(pool);
  pool.connect = (...a) => {
    seen.checkouts += 1;
    seen.peakWaiting = Math.max(seen.peakWaiting, pool.waitingCount);
    const hold = (c) => {
      if (c && !c.__watched) { c.__watched = true; const q = c.query.bind(c); c.query = (t, ...r) => { note(t); return q(t, ...r); }; }
      return c;
    };
    // pg-pool has two acquire styles and Pool.query uses the CALLBACK one (pg-pool/index.js § query: this.connect((err, client) => …)): a failed acquire
    // arrives as `err` there and as a rejection here, and both are counted
    if (typeof a[0] === "function") {
      const cb = a[0];
      return connect((err, client, done) => { if (err) seen.errors += 1; cb(err, client, done); }); // Pool.query's statement is noted by the pool.query wrapper above
    }
    return connect(...a).then(hold, (e) => { seen.errors += 1; throw e; });
  };
  return seen;
}

// ── the shape of the fix, on its own ────────────────────────────────────────

test("the instrument counts an acquire timeout in BOTH of pg-pool's styles (the control for the zero it is asked for below)", async () => {
  const { default: pg } = await import("pg");
  const tiny = new pg.Pool({ connectionString: store.url("office_api"), max: 1, connectionTimeoutMillis: 150 });
  tiny.on("error", () => {});
  const seen = watch(tiny);
  const held = await tiny.connect();                                   // the pool's one connection is out
  await assert.rejects(tiny.query("SELECT 1"), /timeout exceeded when trying to connect/); // Pool.query: the callback style
  await assert.rejects(tiny.connect(), /timeout exceeded when trying to connect/);         // the promise style
  assert.equal(seen.errors, 2, "one callback-style and one promise-style acquire failure, both seen");
  held.release();
  await tiny.query("SELECT 1");
  assert.equal(seen.errors, 2, "a good acquire adds none");
  await tiny.end();
});

test("trailingFlight: a burst of callers shares two runs, each begun after its callers asked; errors reach the sharers and nothing sticks", async () => {
  let reads = 0, state = 0;
  const gate = [];
  const flight = trailingFlight(async () => { reads += 1; const seen = state; await new Promise((ok) => gate.push(ok)); return seen; });
  const first = flight();                       // starts run 1, which has read state 0
  state = 1;                                    // something lands while run 1 is in flight
  const burst = Array.from({ length: 50 }, () => flight());
  gate.shift()();                               // run 1 ends
  assert.equal(await first, 0);
  await new Promise((ok) => setImmediate(ok));
  gate.shift()();                               // the one run the burst shares begins after it asked, so it sees what landed
  assert.deepEqual([...new Set(await Promise.all(burst))], [1], "no caller takes an answer older than its own ask");
  assert.equal(reads, 2, "fifty-one callers, two reads");

  let boom = true;
  const flaky = trailingFlight(async () => { if (boom) throw new Error("the store did not answer"); return "ok"; });
  const both = await Promise.allSettled([flaky(), flaky()]);
  assert.ok(both.every((r) => r.status === "rejected"), "callers that shared a failing run each get its error");
  boom = false;
  assert.equal(await flaky(), "ok", "a failed run is forgotten: the next ask reads again");
});

// ── the crowd at the door ───────────────────────────────────────────────────

async function seedPassages(n) {
  const owner = await store.connect("world2_owner");
  try {
    await owner.query("TRUNCATE acts, claims, marks, windows, settlements, households, household_pins CASCADE");
    await owner.query("INSERT INTO windows (id,opens_at,closes_at,status) VALUES (1,now()-interval '1 day',now()+interval '1 day','open')");
    await owner.query(`INSERT INTO acts (crossing, actor, action, object, class, payload, effect, at)
                       SELECT 1, 'h' || (g % 50), CASE WHEN g % 2 = 0 THEN 'enter' ELSE 'exit' END, 'sbx-c00/home', 'holding', '{}'::jsonb, 'invented', now()
                         FROM generate_series(1, $1) g`, [n]);
  } finally { await owner.end(); }
}

const passageScans = (seen) => seen.sql.filter((q) => /count\(\*\)/i.test(q) && /payload->>'_ledger' IS NULL/.test(q)).length;
const passageReads = (seen) => seen.sql.filter((q) => /SELECT id, at, crossing, actor, action, payload FROM acts WHERE action = ANY/.test(q)).length;
const idle = (pool) => pool.totalCount === pool.idleCount && pool.waitingCount === 0;

test("a crowd acting at once: the act doors scan the passage record a handful of times, not once per act, and read no resident's note", { skip }, async () => {
  await seedPassages(3000);
  const { __forgetPassages } = await import("../src/enter-exit-ledger.mjs");
  __forgetPassages();
  const { worldApex } = await (async () => { process.env.WORLD_APEX = "1"; return import("../src/world-apex.mjs"); })();
  const onActs = watch(actsPool), onPen = watch(penPool);
  try {
    const answers = await Promise.all(HANDLES.map((h) => worldApex({ do: "take", args: { mark: "sbx-c00/home" }, handle: h }, { household: "sbx-crowd", handles: new Set(HANDLES) })));
    assert.equal(answers.length, CROWD);
    // PREFLIGHT / RESOURCE COVERAGE, NOT ACT THROUGHPUT: this fixture has no law graph loaded, so each act door does its orient and eyes (the gather this
    // test measures) and then refuses at the law, by name. Nothing here claims an act was admitted or landed.
    for (const a of answers) assert.ok(a?.code === 503 && /the law that binds this act cannot be read/.test(String(a.defect)), `every act door reached its law gate: ${JSON.stringify(a).slice(0, 160)}`);
    // the act door's first step is orient and eyes (it cannot judge an act without them); each asks who is inside what
    assert.ok(passageScans(onActs) <= 4, `${passageScans(onActs)} count(*) scans of the passage record for ${CROWD} acts at once (it was one per orient and eyes: about ${CROWD * 4})`);
    assert.ok(passageReads(onActs) <= 4, `${passageReads(onActs)} whole-record reads`);
    assert.equal(onActs.errors, 0, "no acts-pool checkout ran out its acquire timeout");
    const notes = onPen.sql.filter((q) => /resident_notes/.test(q)).length;
    assert.equal(notes, 0, `the act door read the resident's note ${notes} times through the pen for an answer that never carries it (a write-mode transaction and a second checkout per act)`);
  } finally { delete process.env.WORLD_APEX; }
  assert.ok(idle(actsPool) && idle(penPool), "every connection came home after the burst");
});

test("a crowd entering at once: the crossing's ledger reads share the same scans", { skip }, async () => {
  await seedPassages(3000);
  const { __forgetPassages } = await import("../src/enter-exit-ledger.mjs");
  __forgetPassages();
  process.env.WORLD_APEX = "1";
  const { crossingDeps } = await import("../src/world-apex.mjs");
  const onActs = watch(actsPool);
  try {
    const ledgers = await Promise.all(Array.from({ length: CROWD }, () => crossingDeps().ledger()));
    assert.equal(new Set(ledgers).size, 1, "every enterer reads the one ledger");
    assert.ok(passageScans(onActs) <= 4, `${passageScans(onActs)} count(*) scans for ${CROWD} ledger reads at once`);
  } finally { delete process.env.WORLD_APEX; }
  assert.ok(idle(actsPool));
});

test("the same crowd, with the record unreadable: every act still answers, every connection comes home, and the next burst reads again", async () => {
  if (skip) return;
  await seedPassages(10);
  const { __forgetPassages } = await import("../src/enter-exit-ledger.mjs");
  __forgetPassages();
  process.env.WORLD_APEX = "1";
  const { worldApex } = await import("../src/world-apex.mjs");
  const realQuery = actsPool.query.bind(actsPool);
  let failing = true;
  actsPool.query = (text, ...rest) => (failing && /_ledger/.test(typeof text === "string" ? text : text?.text) ? Promise.reject(new Error("the record did not answer")) : realQuery(text, ...rest));
  try {
    const key = { household: "sbx-crowd", handles: new Set(HANDLES) };
    const answers = await Promise.all(HANDLES.slice(0, 30).map((h) => worldApex({ do: "take", args: { mark: "sbx-c00/home" }, handle: h }, key)));
    assert.equal(answers.length, 30, "a failing record is each act's own refusal, never a hang");
    assert.ok(idle(actsPool) && idle(penPool), "connections come home on the error path as on success");
    failing = false;
    const again = await worldApex({ do: "take", args: { mark: "sbx-c00/home" }, handle: HANDLES[0] }, key);
    assert.ok(again && typeof again === "object", "the next ask reads the record afresh");
  } finally { actsPool.query = realQuery; delete process.env.WORLD_APEX; }
});

// THE FLIPS (each run by hand on a committed tree, one at a time, the source put back after each):
//   F1 world.mjs § enteredNow reads `servedEnterExitLedger(WORLD_CLONE)` per call again (not `servedLedgerNow`) → the scans test reds
//   F2 world-apex.mjs § crossingDeps().ledger reads `servedEnterExitLedger` per call again                       → the scans test reds
//   F3 world-apex.mjs § apexDo's `worldOrient(…, { note: false })` loses `note: false`                              → the pen test reds (two checkouts per act)
//   F4 store-pool.mjs § trailingFlight answers every caller the run already in flight                              → the first test reds (a caller takes an older answer)
