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
// THE SHAPE (the independent review of #1073 at 021242d2, findings 1 and 2): the
// first build wrote a town-log row for a pending bind and for a held join. The
// ferry's drain settles those rows with nobody deciding: it admitted a held join,
// and it settled a pending bind whatever the bind later did, with the card's
// words lost. So THE DOORS WRITE NOTHING: no `odb` reaches requestResidency from
// any door, the pending answer is not an admission, and the key is kept in the
// process until the bind settles. The tests that matter run the CROSSING over
// what the door wrote (§ 5), with a control that the drain would have settled the
// row the first build wrote.
//
// The door is the REAL `requestResidency` (and, for § 5 and 6, the real household
// apex); the bind is the real locked writer run in-process, held behind a gate
// where a test needs it slow. Same harness as join-pr-at-the-cosign.test.mjs.
//
//   1. a slow bind: the answer goes out BEFORE the bind lands, is not an
//      admission, and carries nothing the bind has not done
//   2. the fast answer is exactly the base's, whole; a refusal inside the bound
//      answers itself and spends no key
//   3. the retry key: held pending, then settled, a same-nonce retry is ONE bind
//      and the FINAL receipt, admitted or refused
//   4. the key's walls: another account's same nonce is its own call; a different
//      nonce is a different call; a malformed nonce is refused
//   5. the crossing over what the doors wrote: a held join, a late refusal and a
//      slow success each leave the log empty and the crossing settling nothing
//   6. the contract and the apex take the nonce

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
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
import { planTownDrain } from "../src/town-drain.mjs";
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

// ── a mock GitHub, exactly as wide as the pen's PR dance (the held join's door) ──
let GH_PORT = null;
let server;
let pulls = [];
const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(body)); };
before(async () => {
  server = createServer((req, res) => {
    const p = new URL(req.url, "http://x").pathname;
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      if (req.method === "GET" && p.endsWith("/pulls")) return json(res, 200, []);
      if (req.method === "GET" && /\/git\/ref\/heads\//.test(p)) return json(res, 200, { object: { sha: "basesha" } });
      if (req.method === "GET" && /\/git\/commits\//.test(p)) return json(res, 200, { tree: { sha: "basetree" } });
      if (req.method === "POST" && p.endsWith("/git/trees")) return json(res, 201, { sha: "treesha" });
      if (req.method === "POST" && p.endsWith("/git/commits")) return json(res, 201, { sha: "commitsha" });
      if (req.method === "POST" && p.endsWith("/git/refs")) return json(res, 201, {});
      if (req.method === "POST" && p.endsWith("/pulls")) { pulls.push(JSON.parse(raw)); return json(res, 201, { html_url: "https://example.invalid/pr/1", number: 1 }); }
      return json(res, 418, { message: `unexpected ${req.method} ${p}` });
    });
  });
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
const STRANGER = { household: null, ghId: 424242, ghLogin: "some-stranger", handles: new Set() };

/** A bind the test holds open: `release()` lets the real locked writer run; `refuse(e)` fails it instead. */
function gatedBind() {
  const g = { binds: 0, release: null, refuse: null };
  const gate = new Promise((ok, no) => { g.release = ok; g.refuse = no; });
  g.bind = async (payload, { clone }) => {
    g.binds += 1;
    await gate;
    return bindUnderLock({ ...payload, clone, db, date: "2026-11-16" });
  };
  return g;
}
const liveBind = () => { const g = { binds: 0 }; g.bind = (payload, { clone }) => { g.binds += 1; return bindUnderLock({ ...payload, clone, db, date: "2026-11-16" }); }; return g; };
const MOVED = () => Object.assign(new Error("the account no longer speaks for the house"), { code: 409, defect: "the account no longer speaks for the house", hint: "ask again as the house's own account" });

/** Run `fn` with the record seeded, the pool stubbed and the town log's flag ON (as the box has it). */
async function withTown(fn) {
  const pool = makePool(rowsFromRegistry(REGISTRY(), PINS()));
  __setPoolForTest(pool);
  Object.assign(process.env, ENV_ON);
  process.env.TOWN_SINGLE_LOG = "1";
  try { return await fn({ clone: town(), odb: logDb() }); }
  finally { __setPoolForTest(null); delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; delete process.env.TOWN_SINGLE_LOG; }
}
// THE DOORS' OWN CALL: no `odb` (the three doors hand requestResidency none).
const ask = (args, key, { clone, bind, bindWaitMs = 40 }) => requestResidency(args, key, db, PEN(), { clone, bind, bindWaitMs });
const stands = (clone, h) => existsSync(join(clone, "WHITE_PAGES", h, "ADDRESS.md"));
const waitFor = async (pred, ms = 8000) => { const t0 = Date.now(); while (!(await pred())) { if (Date.now() - t0 > ms) throw new Error("waitFor timed out"); await new Promise((r) => setTimeout(r, 10)); } };
const ids = (c) => Math.random().toString(36).slice(2, 8) + c; // a nonce unique per test: the key map is the process's

/** What the crossing would do over this log, with nobody deciding. */
const crossing = (odb, clone) => planTownDrain(odb, clone, { date: "2026-11-17" });

// ── 1. a slow bind ──────────────────────────────────────────────────────────

test('1 · LAW POS-1038 "a slow binding no longer delays the receipt": the answer goes out while the bind is held, and it is NOT an admission', async () => {
  await withTown(async ({ clone }) => {
    const g = gatedBind();
    const out = await ask({ handle: "tulip", card: "Second agent of this house." }, HOUSE_KEY, { clone, bind: g.bind });
    assert.equal(out.binding, "pending");
    assert.equal(out.handle, "tulip");
    assert.deepEqual(Object.keys(out).sort(), ["binding", "handle", "note", "verified_github"], "nothing the bind has not done: no admitted, no commit, no address, no household, no log");
    assert.match(out.note, /is not an admission/);
    assert.doesNotMatch(out.note, /nonce/, "finding 4: a caller who sent no nonce is not told to resend one");
    assert.equal(stands(clone, "tulip"), false, "NOT YET BOUND when the answer went out: this is what 'does not wait' means");
    assert.equal(g.binds, 1);
    // the control: the bind was slow, not missing — released, the real writer lands the resident
    g.release();
    await waitFor(() => stands(clone, "tulip"));
    assert.match(git(clone, "log", "-1", "--format=%s"), /tulip joins · bound to the-trueing-house at admission/);
  });
});

test('1b · a pending answer to a call that sent a nonce says what the nonce does', async () => {
  await withTown(async ({ clone }) => {
    const g = gatedBind();
    const out = await ask({ handle: "tulip", card: "x", nonce: ids("1b") }, HOUSE_KEY, { clone, bind: g.bind });
    assert.equal(out.binding, "pending");
    assert.match(out.note, /same nonce and you get the final receipt, whether it was admitted or refused/);
    g.release();
    await waitFor(() => stands(clone, "tulip"));
  });
});

// ── 2. the fast answer, and a refusal ───────────────────────────────────────

test('2a · FINDING 3: a bind that lands inside the bound answers the base\'s whole answer, byte for byte (no `logged`, no `binding`, no nonce keys)', async () => {
  await withTown(async ({ clone }) => {
    const g = liveBind();
    const out = await ask({ handle: "tulip", card: "Second agent of this house.", agent: "Tulip" }, HOUSE_KEY, { clone, bind: g.bind, bindWaitMs: 20_000 });
    // The expected answer, written out from the base's own return (residency.mjs at 5495180f2, § ADMISSION IS THE BIND).
    const expected = {
      admitted: "tulip",
      address: "WHITE_PAGES/tulip/ADDRESS.md",
      household: { slug: "the-trueing-house", name: "The Trueing House", action: "appended", lane: "bound at admission" },
      commit: out.commit,
      verified_github: { login: "keeminlee", id: 999 },
      note: "Admitted to The Trueing House. Your account already speaks for this house, so the office bound tulip to it in the same act that wrote the address: the pin and the membership are in the town's record as of this commit. Nobody reviewed this and nothing is pending. The office index and the public site rebuild on their own short cadences, so tulip's page comes up within minutes.",
    };
    assert.match(out.commit, /^[0-9a-f]{7,40}$/);
    assert.equal(JSON.stringify(out), JSON.stringify(expected), "the whole door answer, keys and order");
    assert.equal(git(clone, "rev-parse", "HEAD").startsWith(out.commit.slice(0, 7)), true);
  });
});

test('2b · a bind that refuses inside the bound answers its own refusal and spends no key: the same nonce then runs again and lands', async () => {
  await withTown(async ({ clone }) => {
    const nonce = ids("2b");
    let calls = 0;
    const live = liveBind();
    const flaky = async (p, o) => { calls += 1; if (calls === 1) throw MOVED(); return live.bind(p, o); };
    await assert.rejects(
      () => ask({ handle: "tulip", card: "x", nonce }, HOUSE_KEY, { clone, bind: flaky, bindWaitMs: 20_000 }),
      (e) => e.code === 409 && e.defect === "the account no longer speaks for the house");
    const again = await ask({ handle: "tulip", card: "x", nonce }, HOUSE_KEY, { clone, bind: flaky, bindWaitMs: 20_000 });
    assert.equal(again.admitted, "tulip");
    assert.equal(again.duplicate, undefined, "a refused first call spent nothing: this is a fresh call");
    assert.equal(calls, 2);
  });
});

// ── 3. the retry key ────────────────────────────────────────────────────────

test('3a · LAW POS-1038 "a retry with the same nonce answers with the first receipt": held pending, the retry is pending too; once the bind lands, the retry is the FINAL receipt; ONE bind throughout', async () => {
  await withTown(async ({ clone }) => {
    const g = gatedBind();
    const args = { handle: "tulip", card: "Second agent of this house.", nonce: ids("3a") };
    const first = await ask(args, HOUSE_KEY, { clone, bind: g.bind });
    assert.equal(first.binding, "pending");
    const second = await ask(args, HOUSE_KEY, { clone, bind: g.bind });
    assert.equal(second.binding, "pending");
    assert.equal(second.duplicate, true);
    assert.equal(g.binds, 1, "NOTHING WAS BOUND A SECOND TIME");
    g.release();
    await waitFor(() => stands(clone, "tulip"));
    const third = await ask(args, HOUSE_KEY, { clone, bind: g.bind, bindWaitMs: 20_000 });
    assert.equal(third.duplicate, true);
    assert.equal(third.admitted, "tulip");
    assert.match(third.commit, /^[0-9a-f]{7,40}$/);
    assert.equal(g.binds, 1);
  });
});

test('3b · a retry after a landed first call answers the first receipt, commit and all; WITHOUT the nonce the same call is refused as a taken handle (the control)', async () => {
  await withTown(async ({ clone }) => {
    const g = liveBind();
    const nonce = ids("3b");
    const first = await ask({ handle: "tulip", card: "x", nonce }, HOUSE_KEY, { clone, bind: g.bind, bindWaitMs: 20_000 });
    const second = await ask({ handle: "tulip", card: "x", nonce }, HOUSE_KEY, { clone, bind: g.bind, bindWaitMs: 20_000 });
    assert.equal(second.duplicate, true);
    assert.equal(second.commit, first.commit);
    assert.equal(g.binds, 1);
    await assert.rejects(
      () => ask({ handle: "tulip", card: "x" }, HOUSE_KEY, { clone, bind: g.bind, bindWaitMs: 20_000 }),
      (e) => e.code === 409 && /taken/.test(e.defect));
  });
});

test('3c · two overlapping calls with one nonce are ONE bind', async () => {
  await withTown(async ({ clone }) => {
    const g = gatedBind();
    const args = { handle: "tulip", card: "x", nonce: ids("3c") };
    const [ra, rb] = await Promise.all([ask(args, HOUSE_KEY, { clone, bind: g.bind, bindWaitMs: 150 }), ask(args, HOUSE_KEY, { clone, bind: g.bind, bindWaitMs: 150 })]);
    assert.equal(g.binds, 1);
    assert.equal(ra.binding, "pending");
    assert.equal(rb.duplicate, true);
    g.release();
    await waitFor(() => stands(clone, "tulip"));
  });
});

test('3d · FINDING 2(c): a bind that refuses AFTER the pending answer: the retry with the nonce gets the REFUSAL, not an admission; nothing lands', async () => {
  await withTown(async ({ clone }) => {
    const g = gatedBind();
    const args = { handle: "tulip", card: "Second agent of this house. My own words.", nonce: ids("3d") };
    const first = await ask(args, HOUSE_KEY, { clone, bind: g.bind });
    assert.equal(first.binding, "pending");
    assert.equal("admitted" in first, false, "the pending answer promised no admission");
    const was = console.error; console.error = () => {};
    try { g.refuse(MOVED()); await new Promise((r) => setTimeout(r, 60)); } finally { console.error = was; }
    await assert.rejects(
      () => ask(args, HOUSE_KEY, { clone, bind: g.bind, bindWaitMs: 20_000 }),
      (e) => e.code === 409 && e.defect === "the account no longer speaks for the house",
      "the final receipt is the refusal");
    assert.equal(g.binds, 1);
    assert.equal(stands(clone, "tulip"), false);
  });
});

// ── 4. the key's walls ──────────────────────────────────────────────────────

test('4 · the key is the account\'s own: another house\'s same nonce is its own call; a different nonce is a different call; a malformed nonce is refused', async () => {
  await withTown(async ({ clone }) => {
    const g = liveBind();
    const o = { clone, bind: g.bind, bindWaitMs: 20_000 };
    const nonce = ids("4");
    const first = await ask({ handle: "tulip", card: "x", nonce }, HOUSE_KEY, o);
    assert.equal(first.admitted, "tulip");
    const other = await ask({ handle: "willow", card: "x", nonce }, ROOKERY_KEY, o);
    assert.notEqual(other.duplicate, true, "another account cannot spend this house's nonce");
    assert.equal(other.admitted, "willow");
    const probe = await ask({ handle: "tulip", card: "x", nonce }, ROOKERY_KEY, o).catch((e) => e);
    assert.notEqual(probe.duplicate, true, "nor read this house's receipt by naming its handle");
    const fresh = await ask({ handle: "daisy", card: "x", nonce: ids("4b") }, HOUSE_KEY, o);
    assert.notEqual(fresh.duplicate, true);
    assert.equal(fresh.admitted, "daisy");
    for (const bad of ["", "   ", 7, "x".repeat(201)])
      await assert.rejects(() => ask({ handle: "ivy", card: "x", nonce: bad }, HOUSE_KEY, o),
        (e) => e.code === 422 && /nonce/.test(e.defect), `nonce ${JSON.stringify(bad).slice(0, 12)} is refused by name`);
  });
});

// ── 5. the crossing over what the doors wrote ───────────────────────────────
//
// FINDINGS 1 AND 2. The first build wrote a row for a held join and for a pending
// bind, and the drain settled them. The control is that drain, over the rows the
// first build wrote by hand; the probes are the doors, then the same drain.

test('5a · FINDING 1: a held join through the REAL apex leaves the log empty and the crossing settling nothing (control: the row the first build wrote IS settled)', async () => {
  await withTown(async ({ clone, odb }) => {
    pulls = [];
    const worldBlock = async () => ({ sited: true, unreadable: false });
    const ctx = { worldBlock, odb, clone, db, pen: PEN(), canWrite: true, slim: true, schemas: SCHEMAS, schemaRequired: REQUIRED };
    const out = await householdApex({ do: "add-resident", args: { handle: "fledgling", card: "hello", household: "The Rookery", nonce: ids("5a") } }, STRANGER, ctx);
    assert.equal(out.result?.requested, "fledgling", JSON.stringify(out).slice(0, 300));
    assert.equal(pulls.length, 1, "the hold PR opened: a person decides");
    assert.equal(out.result.nonce_honoured, false, "a held join's guard is its PR, and the answer says so");
    assert.equal((await pendingRows(odb)).length, 0, "the door wrote NO row");
    const plan = await crossing(odb, clone);
    assert.deepEqual(plan.settle, [], "and the crossing admits nobody");
    // the control: the row the first build wrote (vouched: false, verified id) is one the same crossing settles
    await appendTownJournal(odb, { act: "request-residency", household: "the-rookery", handle: "fledgling", ghId: "424242", ghLogin: "some-stranger",
      payload: { pr_url: "https://example.invalid/pr/1", pr_number: 1, vouched: false } });
    const control = await crossing(odb, clone);
    assert.equal(control.settle.length, 1, "CONTROL: a row like that WOULD be admitted by the crossing, with nobody deciding");
    assert.equal(control.settle[0].handle, "fledgling");
  });
});

test('5b · FINDING 2: a late refusal and a slow success, from the doors\' own call, leave the log empty and the crossing settling nothing', async () => {
  await withTown(async ({ clone, odb }) => {
    // the doors hand requestResidency no log (5c pins it), so what a door-shaped call writes is what `odb` holds
    const refused = gatedBind();
    const a = await ask({ handle: "tulip", card: "Second agent of this house. My own words." }, HOUSE_KEY, { clone, bind: refused.bind });
    assert.equal(a.binding, "pending");
    const was = console.error; console.error = () => {};
    try { refused.refuse(MOVED()); await new Promise((r) => setTimeout(r, 60)); } finally { console.error = was; }
    const slow = gatedBind();
    const b = await ask({ handle: "daisy", card: "Another agent. My own words." }, HOUSE_KEY, { clone, bind: slow.bind });
    assert.equal(b.binding, "pending");
    slow.release();
    await waitFor(() => stands(clone, "daisy"));
    assert.equal(stands(clone, "tulip"), false, "the late refusal landed nothing");
    assert.match(readFileSync(join(clone, "WHITE_PAGES", "daisy", "ADDRESS.md"), "utf8"), /Another agent\. My own words\./, "the success's card carries the resident's own words");
    assert.equal((await pendingRows(odb)).length, 0);
    const plan = await crossing(odb, clone);
    assert.deepEqual(plan.settle, []);
    // the control: the pending row the first build wrote for the refused bind WOULD be settled, and its card would be empty
    await appendTownJournal(odb, { act: "request-residency", household: "the-trueing-house", handle: "tulip", ghId: "999", ghLogin: "keeminlee",
      payload: { admitted: true, pending_bind: true } });
    const control = await crossing(odb, clone);
    assert.equal(control.settle.length, 1, "CONTROL: the first build's pending row is settled over the refusal");
  });
});

test('5c · WIRING: no door hands requestResidency the town log (the apex, the flat tool and POST /residency)', () => {
  const calls = (file) => [...readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8").matchAll(/requestResidency\(([^)]*)\)/g)].map((m) => m[1]);
  for (const f of ["household-apex.mjs", "mcp.mjs", "server.mjs"]) {
    const found = calls(f).filter((c) => /key/.test(c));
    assert.ok(found.length >= 1, `${f} calls requestResidency (the scan sees it)`);
    for (const c of found) assert.doesNotMatch(c, /odb/, `${f}: requestResidency(${c}) must not carry the town log`);
  }
  // the control: the scan can see an odb where a door does pass one
  const declare = readFileSync(new URL("../src/household-apex.mjs", import.meta.url), "utf8");
  assert.match(declare, /declareViaOffice\(clone, fields, key, \{ db, odb \}\)/);
});

// ── 6. the doors take the nonce ─────────────────────────────────────────────

test('6a · the contract: request_residency takes the nonce for the apex and POST /residency alike, and still names a stranger field', () => {
  assert.deepEqual([...DOOR_FIELDS.request_residency], ["nonce"]);
  const declared = { handle: {}, card: {} };
  const ok = judgeActFields({ tool: "request_residency", declared, fields: { handle: "a", card: "b", nonce: "n" }, exempt: ["handle"] });
  assert.equal(ok.bounce, undefined);
  assert.equal(ok.fields.nonce, "n");
  const bad = judgeActFields({ tool: "request_residency", declared, fields: { handle: "a", card: "b", bogus: 1 }, exempt: ["handle"] });
  assert.deepEqual(bad.bounce.unknown_fields, ["bogus"], "the control: the judgement still runs");
});

test('6b · the household apex lets the nonce through to the act, and still refuses a stranger field by name', async () => {
  await withTown(async ({ clone, odb }) => {
    const worldBlock = async () => ({ sited: true, unreadable: false });
    const ctx = { worldBlock, odb, clone, db, pen: PEN(), canWrite: true, slim: true, schemas: SCHEMAS, schemaRequired: REQUIRED };
    const withNonce = await householdApex({ do: "add-resident", args: { handle: "fledgling2", card: "hi", household: "The Rookery", nonce: ids("6b") } }, STRANGER, ctx);
    assert.doesNotMatch(JSON.stringify(withNonce), /does not take/, "the nonce is a field of this act");
    const stray = await householdApex({ do: "add-resident", args: { handle: "fledgling3", card: "hi", bogus: 1 } }, STRANGER, ctx);
    assert.match(JSON.stringify(stray), /does not take: bogus/);
  });
});
