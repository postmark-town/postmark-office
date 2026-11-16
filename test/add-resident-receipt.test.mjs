// add-resident-receipt.test.mjs — THE ANSWER THAT DOES NOT WAIT, AND ITS RETRY KEY (POS-1038, town #4688).
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/add-resident-receipt.test.mjs
//
// FILED FROM (town #4688, Kogane's report with Micah's kept session): add-resident
// went out at 20:49:14Z, the client gave up at 60.009 s with "The operation timed
// out.", and the resident was in fact added (standing at 20:50:20Z). Wright's
// disposition, 2026-11-14: "a door that has already done the act shouldn't hold
// the answer past a common client timeout ... and `add-resident` takes no retry
// key, so a cautious retry could try to add the same resident twice."
//
// LAW (POS-1038, Done when): "a slow binding no longer delays the receipt, and a
// retry with the same nonce answers with the first receipt".
//
// The door is the REAL `requestResidency` (and, for § 6, the real household
// apex); the town log is a real sqlite paper with TOWN_SINGLE_LOG on; the bind
// is the real locked writer run in-process, held behind a gate where a test needs
// it slow. Same harness as join-pr-at-the-cosign.test.mjs.
//
//   1. a slow bind: the answer goes out BEFORE the bind lands, says
//      binding: "pending", and has recorded the act; the bind then lands (the
//      control that the writer was live and slow, not absent)
//   2. a fast bind answers exactly what it did, no `binding` key; a bind that
//      refuses inside the bound answers its refusal and records NOTHING
//   3. the retry key: the same nonce twice (after a pending first call, after a
//      landed one, and overlapping) is ONE bind and ONE row; the first receipt
//   4. the key's walls: another account's same nonce is its own call; a
//      different nonce is a different call; a malformed nonce is refused
//   5. no town log: nothing is promised early and the key is disclosed as not kept
//   6. the doors: the household apex and the plain API's contract take the nonce

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

import { fixtureTown } from "./fixture.mjs";
import { makePool } from "./registry-pool-stub.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { requestResidency, REGISTRY_PATH, PINS_PATH, serializeRegistry, serializePins } from "../src/residency.mjs";
import { bindUnderLock } from "../src/join-bind.mjs";
import { rowsFromRegistry } from "../src/registry-rows.mjs";
import { pendingRows, appendTownJournal } from "../src/town-journal.mjs";
import { DOOR_FIELDS, judgeActFields } from "../src/one-contract.mjs";
import { householdApex } from "../src/household-apex.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { TOOLS } from "../src/mcp.mjs";

const SCHEMAS = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.properties ?? {}]));
const REQUIRED = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.required ?? []]));

const ENV_ON = { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://stub/none" };
const REGISTRY = () => ({
  schema_version: 1, note: "fixture registry",
  households: {
    "the-trueing-house": { name: "The Trueing House", human: "Keemin", accounts: [{ login: "keeminlee", id: 999 }], residents: ["wright"], since: "2026-08-07" },
    "the-rookery": { name: "The Rookery", accounts: [{ login: "rookery-human", id: 777 }], residents: ["rook"], since: "2026-08-09" },
  },
});
const PINS = () => ({ wright: { login: "keeminlee", id: 999, pinned: "2026-07-05" } });

let GH_PORT = null;
let server;
before(async () => {
  server = createServer((req, res) => { res.writeHead(418, { connection: "close" }); res.end("{}"); });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  GH_PORT = server.address().port;
});
after(async () => { await new Promise((ok) => server.close(ok)); });
const PEN = () => ({ apiBase: `http://127.0.0.1:${GH_PORT}`, token: "a-mock-pen-token", owner: "postmark-town", repo: "postmark", baseBranch: "main" });

const db = fixtureTown();
const IX = await indexStore(db);
const IX_RESTORE = await IX.useInProcess();
test.after(async () => { await IX_RESTORE(); await IX.stop(); });

const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
const clones = [];
function town() {
  const dir = mkdtempSync(join(tmpdir(), "add-res-"));
  clones.push(dir);
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), serializeRegistry(REGISTRY()));
  writeFileSync(join(dir, PINS_PATH), serializePins(PINS()));
  git(dir, "init", "-q"); git(dir, "config", "core.autocrlf", "false"); git(dir, "add", "-A");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "seed");
  return dir;
}
after(() => { for (const d of clones) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });

const logDb = () => { const d = new DatabaseSync(":memory:"); d.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)"); return d; };
const HOUSE_KEY = { household: "the-trueing-house", ghId: 999, ghLogin: "keeminlee", handles: new Set(["wright"]) };
const ROOKERY_KEY = { household: "the-rookery", ghId: 777, ghLogin: "rookery-human", handles: new Set(["rook"]) };

/** A bind the test holds open: `release()` lets the real locked writer run. */
function gatedBind() {
  const g = { binds: 0, release: null };
  const gate = new Promise((ok) => { g.release = ok; });
  g.bind = async (payload, { clone }) => {
    g.binds += 1;
    await gate;
    return bindUnderLock({ ...payload, clone, db, date: "2026-11-16" });
  };
  return g;
}
const liveBind = () => { const g = { binds: 0 }; g.bind = (payload, { clone }) => { g.binds += 1; return bindUnderLock({ ...payload, clone, db, date: "2026-11-16" }); }; return g; };

/** Run `fn` with the record seeded, the pool stubbed and the town log on (or off). */
async function withTown(fn, { log = true } = {}) {
  const pool = makePool(rowsFromRegistry(REGISTRY(), PINS()));
  __setPoolForTest(pool);
  Object.assign(process.env, ENV_ON);
  if (log) process.env.TOWN_SINGLE_LOG = "1"; else delete process.env.TOWN_SINGLE_LOG;
  try { return await fn({ clone: town(), odb: logDb() }); }
  finally { __setPoolForTest(null); delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; delete process.env.TOWN_SINGLE_LOG; }
}
const ask = (args, key, { clone, odb, bind, bindWaitMs = 40 }) => requestResidency(args, key, db, PEN(), { clone, odb, bind, bindWaitMs });
const stands = (clone, h) => existsSync(join(clone, "WHITE_PAGES", h, "ADDRESS.md"));
const waitFor = async (pred, ms = 5000) => { const t0 = Date.now(); while (!(await pred())) { if (Date.now() - t0 > ms) throw new Error("waitFor timed out"); await new Promise((r) => setTimeout(r, 10)); } };

// ── 1. a slow bind ──────────────────────────────────────────────────────────

test('1 · LAW POS-1038 "a slow binding no longer delays the receipt": the answer goes out while the bind is still held, says pending, and the act is recorded', async () => {
  await withTown(async ({ clone, odb }) => {
    const g = gatedBind();
    const out = await ask({ handle: "tulip", card: "Second agent of this house.", agent: "Tulip" }, HOUSE_KEY, { clone, odb, bind: g.bind });
    assert.equal(out.admitted, "tulip");
    assert.equal(out.binding, "pending", "the answer says the binding has not settled");
    assert.equal(out.commit, undefined, "no commit is claimed: none has landed");
    assert.equal(stands(clone, "tulip"), false, "NOT YET BOUND when the answer went out: this is what 'does not wait' means");
    assert.equal(g.binds, 1);
    assert.match(out.note, /binding settles on the office's own pass/);
    const rows = await pendingRows(odb);
    assert.equal(rows.length, 1, "the act is recorded");
    assert.equal(rows[0].act, "request-residency");
    assert.equal(rows[0].handle, "tulip");
    assert.equal(rows[0].payload.pending_bind, true);
    assert.equal(out.logged.seq, rows[0].seq);
    // the control: the bind was slow, not missing — released, the real writer lands the resident
    g.release();
    await waitFor(() => stands(clone, "tulip"));
    assert.match(git(clone, "log", "-1", "--format=%s"), /tulip joins · bound to the-trueing-house at admission/);
  });
});

// ── 2. a fast bind, and a refusal ───────────────────────────────────────────

test('2a · a bind that lands inside the bound answers exactly what it did: a commit, no `binding` key, a row carrying the commit', async () => {
  await withTown(async ({ clone, odb }) => {
    const g = liveBind();
    const out = await ask({ handle: "tulip", card: "Second agent of this house." }, HOUSE_KEY, { clone, odb, bind: g.bind, bindWaitMs: 20_000 });
    assert.equal(out.admitted, "tulip");
    assert.match(out.commit, /^[0-9a-f]{7,40}$/);
    assert.equal("binding" in out, false, "the settled answer is byte-for-byte what it was");
    const rows = await pendingRows(odb);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.commit, out.commit);
    assert.equal(rows[0].payload.pending_bind, undefined);
  });
});

test('2b · a bind that refuses inside the bound answers its own refusal and records NOTHING (control: 2a wrote a row, so the writer is live)', async () => {
  await withTown(async ({ clone, odb }) => {
    const refusing = async () => { throw Object.assign(new Error("the house key refuses"), { code: 409, defect: "the house key refuses", hint: "nothing was written" }); };
    await assert.rejects(
      () => ask({ handle: "tulip", card: "x" }, HOUSE_KEY, { clone, odb, bind: refusing, bindWaitMs: 20_000 }),
      (e) => e.code === 409 && e.defect === "the house key refuses");
    assert.equal((await pendingRows(odb)).length, 0, "a refused bind leaves no act for a crossing to settle against the refusal");
  });
});

// ── 3. the retry key ────────────────────────────────────────────────────────

test('3a · LAW POS-1038 "a retry with the same nonce answers with the first receipt": a retry after a pending first call is ONE bind, ONE row, the first receipt', async () => {
  await withTown(async ({ clone, odb }) => {
    const g = gatedBind();
    const args = { handle: "tulip", card: "Second agent of this house.", nonce: "try-1" };
    const first = await ask(args, HOUSE_KEY, { clone, odb, bind: g.bind });
    assert.equal(first.binding, "pending");
    assert.equal(first.nonce, "try-1");
    assert.match(first.idempotent, /same nonce/);
    const second = await ask(args, HOUSE_KEY, { clone, odb, bind: g.bind });
    assert.equal(second.duplicate, true);
    assert.equal(second.nonce, "try-1");
    assert.equal(second.admitted, "tulip");
    assert.equal(second.binding, "pending", "still binding when the retry reads it");
    assert.equal(second.logged.seq, first.logged.seq, "the FIRST call's row, not a new one");
    assert.equal(g.binds, 1, "NOTHING WAS BOUND A SECOND TIME");
    assert.equal((await pendingRows(odb)).length, 1);
    // once the bind lands, the same retry reads settled
    g.release();
    await waitFor(() => stands(clone, "tulip"));
    const third = await ask(args, HOUSE_KEY, { clone, odb, bind: g.bind });
    assert.equal(third.duplicate, true);
    assert.equal(third.binding, "settled");
    assert.equal(g.binds, 1);
  });
});

test('3b · a retry after a landed first call answers the first receipt, commit and all; WITHOUT the nonce the same call is refused as a taken handle (the control)', async () => {
  await withTown(async ({ clone, odb }) => {
    const g = liveBind();
    const first = await ask({ handle: "tulip", card: "Second agent of this house.", nonce: "try-2" }, HOUSE_KEY, { clone, odb, bind: g.bind, bindWaitMs: 20_000 });
    const second = await ask({ handle: "tulip", card: "Second agent of this house.", nonce: "try-2" }, HOUSE_KEY, { clone, odb, bind: g.bind, bindWaitMs: 20_000 });
    assert.equal(second.duplicate, true);
    assert.equal(second.commit, first.commit);
    assert.equal(g.binds, 1);
    await assert.rejects(
      () => ask({ handle: "tulip", card: "Second agent of this house." }, HOUSE_KEY, { clone, odb, bind: g.bind, bindWaitMs: 20_000 }),
      (e) => e.code === 409 && /taken/.test(e.defect));
  });
});

test('3c · two overlapping calls with one nonce are ONE bind: the second waits for the first and answers its receipt', async () => {
  await withTown(async ({ clone, odb }) => {
    const g = gatedBind();
    const args = { handle: "tulip", card: "Second agent of this house.", nonce: "try-3" };
    const a = ask(args, HOUSE_KEY, { clone, odb, bind: g.bind, bindWaitMs: 150 });
    const b = ask(args, HOUSE_KEY, { clone, odb, bind: g.bind, bindWaitMs: 150 });
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(g.binds, 1);
    assert.equal(ra.duplicate, undefined);
    assert.equal(rb.duplicate, true);
    assert.equal(rb.logged.seq, ra.logged.seq);
    assert.equal((await pendingRows(odb)).length, 1);
    g.release();
    await waitFor(() => stands(clone, "tulip"));
  });
});

// ── 4. the key's walls ──────────────────────────────────────────────────────

test('4 · the key is the account\'s own: another house\'s same nonce is its own call; a different nonce is a different call; a malformed nonce is refused', async () => {
  await withTown(async ({ clone, odb }) => {
    const g = liveBind();
    const o = { clone, odb, bind: g.bind, bindWaitMs: 20_000 };
    const first = await ask({ handle: "tulip", card: "x", nonce: "shared" }, HOUSE_KEY, o);
    assert.equal(first.admitted, "tulip");
    const other = await ask({ handle: "willow", card: "x", nonce: "shared" }, ROOKERY_KEY, o);
    assert.notEqual(other.duplicate, true, "another account cannot spend this house's nonce");
    assert.equal(other.admitted, "willow");
    const probe = await ask({ handle: "tulip", card: "x", nonce: "shared" }, ROOKERY_KEY, o).catch((e) => e);
    assert.notEqual(probe.duplicate, true, "nor read this house's receipt by naming its handle");
    // a different nonce, a different handle: a fresh request
    const fresh = await ask({ handle: "daisy", card: "x", nonce: "other" }, HOUSE_KEY, o);
    assert.notEqual(fresh.duplicate, true);
    assert.equal(fresh.admitted, "daisy");
    for (const bad of ["", "   ", 7, "x".repeat(201)])
      await assert.rejects(() => ask({ handle: "ivy", card: "x", nonce: bad }, HOUSE_KEY, { clone, odb, bind: g.bind }),
        (e) => e.code === 422 && /nonce/.test(e.defect), `nonce ${JSON.stringify(bad).slice(0, 12)} is refused by name`);
  });
});

// ── 5. no town log ──────────────────────────────────────────────────────────

test('5 · with no town log nothing is promised early: the door waits the bind out, and a nonce is disclosed as not kept', async () => {
  await withTown(async ({ clone, odb }) => {
    const g = gatedBind();
    const p = ask({ handle: "tulip", card: "x", nonce: "n-1" }, HOUSE_KEY, { clone, odb, bind: g.bind, bindWaitMs: 20 });
    let answered = false; p.then(() => { answered = true; }, () => { answered = true; });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(answered, false, "past the bound, and still waiting: there is nowhere to record the act");
    g.release();
    const out = await p;
    assert.equal(out.admitted, "tulip");
    assert.equal(out.nonce_honoured, false);
    assert.match(out.nonce_note, /NOT idempotent/);
    assert.equal("binding" in out, false);
    assert.equal((await pendingRows(odb)).length, 0);
  }, { log: false });
});

// ── 6. the doors ────────────────────────────────────────────────────────────

test('6a · the contract: request_residency takes the nonce for the apex and POST /residency alike, and still names a stranger field', () => {
  assert.deepEqual([...DOOR_FIELDS.request_residency], ["nonce"]);
  const declared = { handle: {}, card: {} };
  const ok = judgeActFields({ tool: "request_residency", declared, fields: { handle: "a", card: "b", nonce: "n" }, exempt: ["handle"] });
  assert.equal(ok.bounce, undefined);
  assert.equal(ok.fields.nonce, "n");
  const bad = judgeActFields({ tool: "request_residency", declared, fields: { handle: "a", card: "b", bogus: 1 }, exempt: ["handle"] });
  assert.deepEqual(bad.bounce.unknown_fields, ["bogus"], "the control: the judgement still runs");
});

test('6b · the household apex hands the log to add-resident: a nonce already spent in the log answers its first receipt, with no pen and no bind', async () => {
  await withTown(async ({ clone, odb }) => {
    await appendTownJournal(odb, { act: "request-residency", household: "the-trueing-house", handle: "tulip", ghId: "999", ghLogin: "keeminlee",
      payload: { admitted: true, commit: "abc1234", args: { handle: "tulip", nonce: "apex-1" } } });
    const key = { ...HOUSE_KEY, slug: "the-trueing-house" };
    const worldBlock = async () => ({ sited: true, unreadable: false });
    const out = await householdApex({ do: "add-resident", args: { handle: "tulip", card: "x", nonce: "apex-1" } }, key,
      { worldBlock, odb, clone, db, pen: PEN(), canWrite: true, slim: true, schemas: SCHEMAS, schemaRequired: REQUIRED });
    assert.equal(out.result?.duplicate, true, JSON.stringify(out).slice(0, 300));
    assert.equal(out.result.commit, "abc1234");
    // the control: an unknown field is still refused by name, so the nonce was let through, not the check skipped
    const stray = await householdApex({ do: "add-resident", args: { handle: "tulip", card: "x", bogus: 1 } }, key,
      { worldBlock, odb, clone, db, pen: PEN(), canWrite: true, slim: true, schemas: SCHEMAS, schemaRequired: REQUIRED });
    assert.match(JSON.stringify(stray), /does not take: bogus/);
  });
});
