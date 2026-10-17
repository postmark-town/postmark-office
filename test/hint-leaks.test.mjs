// hint-leaks.test.mjs — a tripped step keeps its error in the office's log, and
// the resident reads the office's own words (POS-573, POS-578; POS-568's rule,
// office #483, carried to the MCP door and to the modules that build their own
// 5xx answers).
//
// Every leg hands a step an error that carries what a resident must never read:
// a SQL fragment, a path on the box, pg's own hint, a child's stack on stderr.
// Each asserts the answer is the door's own sentence with fault-words.mjs §
// FAULT_LOGGED (or the store's outage words), that none of it reaches the
// answer, and that the office's log names it.
//
// THE RIG. In process, no office and no store. A test-only module hook
// (`register`) edits a few modules as they load, each behind an env flag nothing
// else sets:
//
//   town-lock.mjs § execUnderTownLock   rejects as a crashed exec does (exit 1, a stack on stderr)
//   gangway-door / settle-join / standing-door   export their private runUnderTownLock
//   world-apex.mjs § worldApex, votes.mjs § voteList   throw the synthetic error
//   votes.mjs § votesAvailable          says yes, so read_votes reaches its catch
//   world.mjs § worldSay (a berth)      throws inside the say's own try
//   world.mjs § callWorldTool           throws (a read domain's tool call)
//   world.mjs § worldSay / worldSayHuman throw inside the say's own try (a resident, a human)
//   world-apex.mjs § worldApex          returns a foreign bounce that still carries pg's hint
//   declare-exec.mjs                    exports mintRefusal, and its main() is commented out
//   fund-exec / gift-exec               export classifyFatal, and their main() is commented out
//
// The hook refuses to load a module whose anchor is not there exactly once, so a
// moved function fails this file loudly. Nothing in src/ knows about it.
//
// THE FLIPS, one per module (the PR body lists the red line of each): put the
// error text back where each answer had it, and that module's legs go red.
//
//   node --test test/hint-leaks.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { Readable } from "node:stream";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "postmark-hint-leaks-"));
after(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* litter */ } });

// What a resident must never read.
const SECRET_STDERR = "Error: relation \"stamp_lines\" does not exist\n    at /srv/postmark-office/src/gangway-exec.mjs:41:13 (synthetic stack, POS-578)";
const SECRET_MESSAGE = "connect ECONNREFUSED /run/postgresql/.s.PGSQL.5432 (synthetic, POS-578)";
const SYNTHETIC = {
  "pg-hint": { code: "42P01", message: "relation \"household_pins\" does not exist (synthetic, POS-573)",
    hint: "Perhaps you meant to reference the table \"public.household_pins_old\". (synthetic pg hint, POS-573)" },
  "codeless": { message: "ENOENT: no such file or directory, open '/srv/postmark-office/telemetry/x.json' (synthetic, POS-573)" },
  "lost-session": { code: "57P01", message: "terminating connection due to administrator command (synthetic, POS-573)" },
  "refusal-409": { code: 409, message: "a synthetic refusal", defect: "a synthetic refusal", hint: "the fixture's own hint" },
};
const secretsOf = (s) => [s.message, s.hint].filter(Boolean);

const THROW = "{ const s = JSON.parse(process.env.SYNTH_THROW); throw Object.assign(new Error(s.message), s); }";
const HOOKS = `
const EDITS = {
  "/src/town-lock.mjs": [["export function execUnderTownLock(exec, payload, env, { note = \\"\\", ...lock } = {}) {",
    "if (process.env.SYNTH_LOCK_STDERR) return Promise.reject(Object.assign(new Error('Command failed: node ' + exec + ' ' + process.env.SYNTH_LOCK_MESSAGE), { code: 1, status: 1, stderr: process.env.SYNTH_LOCK_STDERR }));"]],
  "/src/gangway-door.mjs": [[null, "export { runUnderTownLock as __runUnderTownLock };"]],
  "/src/settle-join.mjs": [[null, "export { runUnderTownLock as __runUnderTownLock };"]],
  "/src/standing-door.mjs": [[null, "export { runUnderTownLock as __runUnderTownLock };"]],
  "/src/world-apex.mjs": [["export async function worldApex(args = {}, key = null, ctx = {}) {",
    "if (process.env.SYNTH_THROW) ${THROW} if (process.env.SYNTH_RETURN) return JSON.parse(process.env.SYNTH_RETURN);"]],
  "/src/declare-exec.mjs": [["main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });", "export { mintRefusal }; //", "replace"]],
  "/src/votes.mjs": [["export function votesAvailable(clone) {", "if (process.env.SYNTH_THROW) return true;"],
    ["export async function voteList(clone, { env = process.env } = {}) {", "if (process.env.SYNTH_THROW) ${THROW}"]],
  // the two children whose last word is classifyFatal's: loaded as modules, not run
  "/src/fund-exec.mjs": [["main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });", "export { classifyFatal }; //", "replace"]],
  "/src/gift-exec.mjs": [["main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });", "export { classifyFatal }; //", "replace"]],
  "/src/world.mjs": [["const rulesFirst = await visitorRulesGate(key, args, { speaking: Boolean(text.trim()) });",
    "if (process.env.SYNTH_THROW) ${THROW}", "before"],
    ["export async function callWorldTool(name, args = {}, key = null, ctx = {}) {", "if (process.env.SYNTH_WORLD_TOOL) ${THROW.replace("SYNTH_THROW", "SYNTH_WORLD_TOOL")}"],
    ["const r = text.trim() ? await voices.say(choice.handle, text,", "if (process.env.SYNTH_SAY) ${THROW.replace("SYNTH_THROW", "SYNTH_SAY")}", "before"],
    ["const r = text.trim() ? await voices.say(speaker, text, { standAs,", "if (process.env.SYNTH_SAY) ${THROW.replace("SYNTH_THROW", "SYNTH_SAY")}", "before"]],
};
export async function load(url, context, nextLoad) {
  const r = await nextLoad(url, context);
  const at = Object.keys(EDITS).find((k) => url.endsWith(k));
  if (!at) return r;
  let src = String(r.source);
  for (const [anchor, line, where] of EDITS[at]) {
    if (anchor === null) { src += "\\n" + line + "\\n"; continue; }
    if (src.split(anchor).length !== 2) throw new Error("hint-leaks hook: the anchor is not in " + at + " exactly once: " + anchor);
    src = src.replace(anchor, () => where === "before" ? line + " " + anchor : where === "replace" ? line + " " + anchor : anchor + " " + line);
  }
  return { ...r, source: src, shortCircuit: true };
}
`;
const hooks = join(tmp, "hooks.mjs");
writeFileSync(hooks, HOOKS);
register(pathToFileURL(hooks).href);

process.env.WORLD_APEX = "1"; // the `world` verb is listed (world-apex.mjs § apexEnabled)
const load = (rel) => import(pathToFileURL(join(OFFICE, rel)).href);
const { FAULT_LOGGED, STORE_LOST, READ_RETRY, caughtBounce, foreignAnswer, faultLogged, trippedError } = await load("src/fault-words.mjs");

// ── the log, read back ──────────────────────────────────────────────────────
// console.error is the office's log; each leg reads what was written during it.
async function logged(fn) {
  const lines = [];
  const was = console.error;
  console.error = (...args) => { lines.push(args.map(String).join(" ")); };
  let value, thrown = null;
  try { value = await fn(); } catch (e) { thrown = e; } finally { console.error = was; }
  return { value, thrown, log: lines.join("\n") };
}
const withEnv = async (vars, fn) => {
  const was = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return await fn(); }
  finally { for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const keepsOut = (answer, secrets, label) => {
  const text = JSON.stringify(answer, Object.getOwnPropertyNames(answer ?? {}));
  for (const s of secrets) assert.ok(!text.includes(s.slice(0, 40)), `${label}: the answer does not carry "${s.slice(0, 50)}…": ${text.slice(0, 400)}`);
};
const logSays = (log, secrets, label) => {
  for (const s of secrets) assert.ok(log.includes(s.slice(0, 40)), `${label}: the office's log names "${s.slice(0, 50)}…"`);
};

// ── fault-words.mjs itself ──────────────────────────────────────────────────

test("fault-words: faultLogged logs what failed and hands back the fixed hint", async () => {
  const { value, log } = await logged(() => faultLogged("the gangway act tripped", { stderr: SECRET_STDERR, message: SECRET_MESSAGE }));
  assert.equal(value, FAULT_LOGGED);
  assert.match(log, /the gangway act tripped/);
  logSays(log, [SECRET_STDERR], "a child's stderr is preferred to its message");
  const pg = await logged(() => faultLogged("the office tripped", SYNTHETIC["pg-hint"]));
  logSays(pg.log, secretsOf(SYNTHETIC["pg-hint"]), "pg's message and its hint");
});

test("fault-words: a caught refusal is rebuilt as it was; a foreign code keeps only its code", async () => {
  const refusal = SYNTHETIC["refusal-409"];
  assert.deepEqual(caughtBounce(refusal, { code: refusal.code, defect: refusal.defect, hint: refusal.hint }),
    { error: "bounce", code: 409, defect: "a synthetic refusal", hint: "the fixture's own hint" });
  const { value, log } = await logged(() => caughtBounce(SYNTHETIC["pg-hint"], { defect: undefined, hint: SYNTHETIC["pg-hint"].hint }));
  assert.deepEqual(value, { error: "bounce", code: "42P01" });
  logSays(log, secretsOf(SYNTHETIC["pg-hint"]), "caughtBounce");
});

test("fault-words: a foreign code is the store's outage or the office's own 500, never its words", () => {
  assert.deepEqual(foreignAnswer("57P01", {}, { read: true }), { status: 503, body: { error: "bounce", defect: STORE_LOST, hint: READ_RETRY } });
  const own = foreignAnswer("42P01", { hint: SYNTHETIC["pg-hint"].hint });
  assert.equal(own.status, 500);
  assert.match(own.body.hint, /What failed is in the office's log, not in this answer/);
  keepsOut(own.body, [SYNTHETIC["pg-hint"].hint], "foreignAnswer");
});

// ── the MCP door (POS-573) ──────────────────────────────────────────────────
//
// THE FLIPS: (1) the tool catches back to `{ error: "bounce", …, hint: e.hint }`;
// (2) the answer's classification out; (3) the last resort's hint back to the
// raw message. The world read reaches mcp.mjs's apex catch, read_votes a flat
// tool catch, and a codeless error the last resort.
const { callTool, handleMcp } = await load("src/mcp.mjs");

async function mcpCall(name, args) {
  const raw = JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } });
  const req = Object.assign(Readable.from([Buffer.from(raw)]), { method: "POST", headers: { "content-type": "application/json" } });
  let status = null, body = "";
  const done = new Promise((ok) => {
    const res = {
      headersSent: false, setHeader() {}, hasHeader() { return false; }, getHeader() { return undefined; },
      writeHead(code) { status = code; this.headersSent = true; return this; },
      end(chunk) { if (chunk) body += chunk; ok(); },
    };
    handleMcp(req, res, { key: null, canWrite: false, asOf: "test" });
  });
  await done;
  const rpc = JSON.parse(body);
  const result = rpc.result;
  return { status, isError: result?.isError, answer: result ? JSON.parse(result.content[0].text) : rpc };
}

for (const [name, expect] of Object.entries({
  "pg-hint": (a) => { assert.equal(a.code, 500); assert.match(a.hint, /"42P01", which is not an HTTP status/); assert.match(a.hint, /What failed is in the office's log/); },
  "codeless": (a) => { assert.equal(a.defect, "the office tripped"); assert.equal(a.hint, FAULT_LOGGED); },
  "lost-session": (a) => { assert.equal(a.code, 503); assert.equal(a.defect, STORE_LOST); assert.equal(a.hint, READ_RETRY, "a read is told it is safe to repeat");
    assert.equal(a.retry_after, 30, "a JSON-RPC answer has no Retry-After header, so the body says it"); },
})) {
  test(`POS-573 MCP world (read): a ${name} error stays out of the answer, and in the log`, async () => {
    const { value: r, log } = await logged(() => withEnv({ SYNTH_THROW: JSON.stringify(SYNTHETIC[name]) }, () => mcpCall("world", {})));
    assert.equal(r.status, 200, "a tool's refusal rides JSON-RPC");
    assert.equal(r.isError, true);
    assert.equal(r.answer.refused, true, "every refusal says so (POS-427)");
    expect(r.answer);
    keepsOut(r.answer, secretsOf(SYNTHETIC[name]), `world ${name}`);
    logSays(log, secretsOf(SYNTHETIC[name]), `world ${name}`);
  });
}

test("POS-573 MCP world (read): a refusal's own words pass untouched", async () => {
  const { value: r } = await logged(() => withEnv({ SYNTH_THROW: JSON.stringify(SYNTHETIC["refusal-409"]) }, () => mcpCall("world", {})));
  assert.equal(r.answer.defect, "a synthetic refusal");
  assert.equal(r.answer.hint, "the fixture's own hint");
  assert.equal(r.answer.code, 409);
});

test("POS-573 MCP read_votes: the flat tool catch keeps pg's hint and message out", async () => {
  const s = SYNTHETIC["pg-hint"];
  const { value, log } = await logged(() => withEnv({ SYNTH_THROW: JSON.stringify(s) }, () => callTool("read_votes", {}, { canWrite: true, clone: tmp })));
  assert.deepEqual(value, { error: "bounce", code: "42P01" }, "the code rides on for the door to classify; nothing else of pg's does");
  keepsOut(value, secretsOf(s), "read_votes");
  logSays(log, secretsOf(s), "read_votes");
});

// ── the say doors (POS-578, G3) ─────────────────────────────────────────────
// THE FLIP: the hint back to the message. And the status: a fault the resident
// did not cause carries 500, so REST's `result.code ?? 422` answers 500.
const { worldSay } = await load("src/world.mjs");

test("POS-578 world.mjs § worldSay (a berth): the error goes to the log, and the bounce is the office's 500", async () => {
  const s = SYNTHETIC["codeless"];
  const { value, log } = await logged(() => withEnv({ SYNTH_THROW: JSON.stringify(s) }, () => worldSay({ text: "hello" }, { berth: true, slug: "hint-leaks" })));
  assert.equal(value.error, "bounce");
  assert.equal(value.defect, "the world door tripped");
  assert.equal(value.code, 500, "not the request's 422");
  assert.equal(value.hint, FAULT_LOGGED);
  keepsOut(value, secretsOf(s), "worldSay");
  logSays(log, secretsOf(s), "worldSay");
});

// ── the steps that run an exec under the town lock (POS-578) ────────────────
// A crashed exec rejects with exit 1 and its stack on stderr. THE FLIP: each
// module's `hint:` back to `String(e.stderr ?? e.message ?? e)`.
const lockFail = { SYNTH_LOCK_STDERR: SECRET_STDERR, SYNTH_LOCK_MESSAGE: SECRET_MESSAGE };
const STEPS = [
  ["gangway-door.mjs", "the gangway act tripped", async () => (await load("src/gangway-door.mjs")).__runUnderTownLock({}, { clone: tmp })],
  ["join-bind.mjs", "the join pass tripped", async () => (await load("src/join-bind.mjs")).runBindUnderTownLock({}, { clone: tmp })],
  ["settle-join.mjs", "the settle-join pass tripped", async () => (await load("src/settle-join.mjs")).__runUnderTownLock({}, { clone: tmp })],
  ["standing-door.mjs", "the standing act tripped", async () => (await load("src/standing-door.mjs")).__runUnderTownLock({}, { clone: tmp })],
  ["world-apex.mjs § crossingDeps().record", "the crossing pass tripped", async () => (await load("src/world-apex.mjs")).crossingDeps().record({ handle: "x", act: "enter" })],
  ["world-stake.mjs § runExec", "the stake could not be recorded", async () => (await load("src/world-stake.mjs")).runExec({})],
  ["fund.mjs § penRecorder", "the receipt pass tripped", async () => {
    const lock = await load("src/town-lock.mjs");
    const record = (await load("src/fund.mjs")).penRecorder(tmp, { ...lock, townDay: () => "2026-10-14", execPath: "fund-exec.mjs" });
    return record({ pot: "p", usd: 1, from: "x", ref: "r" });
  }],
];
for (const [where, defect, run] of STEPS) {
  test(`POS-578 ${where}: a crashed exec's stderr goes to the log, never the answer`, async () => {
    const { value, thrown, log } = await logged(() => withEnv(lockFail, run));
    const answer = thrown ?? value;
    assert.ok(answer, "the step answered or threw");
    assert.equal(answer.code, 500);
    assert.equal(answer.defect, defect);
    assert.equal(answer.hint, FAULT_LOGGED);
    keepsOut(answer, [SECRET_STDERR, SECRET_MESSAGE], where);
    logSays(log, [SECRET_STDERR], where);
  });
}

test("fault-words: trippedError is a refusal-shaped error every door's catch sends", async () => {
  const { value: e } = await logged(() => trippedError("the walk pass tripped", { stderr: SECRET_STDERR }));
  assert.equal(e.message, "the walk pass tripped");
  assert.deepEqual({ code: e.code, defect: e.defect, hint: e.hint }, { code: 500, defect: "the walk pass tripped", hint: FAULT_LOGGED });
});

// ── world-settlement.mjs: a named settlement the store could not read ──────
// THE FLIP: the 503's hint back to the message.
test("POS-578 world-settlement.mjs § settlementOrFile: a named settlement's 503 keeps the store's error in the log", async () => {
  const { settlementOrFile } = await load("src/world-settlement.mjs");
  const { thrown, log } = await logged(() => settlementOrFile({ asked: "S12", engaged: true, fileAnswer: () => ({}),
    pool: async () => { throw new Error(SECRET_MESSAGE); }, worldRepo: tmp }));
  assert.ok(thrown, "a named settlement refuses");
  assert.equal(thrown.code, 503);
  assert.equal(thrown.hint, FAULT_LOGGED);
  keepsOut(thrown, [SECRET_MESSAGE], "settlementOrFile");
  logSays(log, [SECRET_MESSAGE], "settlementOrFile");
});

// ── world2-serve.mjs: an act the register cannot read ───────────────────────
// THE FLIP: the 500's hint back to `String(e.message)`, which quoted the act.
test("POS-578 world2-serve.mjs: an act that matches no known era is the office's 500, and the act is in the log", async () => {
  const { world2Serve } = await load("src/world2-serve.mjs");
  const row = { id: 991, at: "2026-10-13T12:00:00Z", crossing: 1, actor: "x", action: "enters", payload: { synthetic: SECRET_MESSAGE } };
  const p = { query: async () => ({ rows: [row] }) };
  const { value, log } = await logged(() => withEnv({ WORLD2_PG: "1", WORLD2_PG_URL: "postgres://hint-leaks/none" },
    () => world2Serve("/world2/occupancy", new URLSearchParams(), { p })));
  assert.equal(value.code, 500, JSON.stringify(value).slice(0, 300));
  assert.equal(value.body.defect, "a passage act matches no known era");
  assert.equal(value.body.hint, FAULT_LOGGED);
  assert.match(log, /match no known era/, "the register's own sentence, with the act, is in the log");
});

// ── world-apex.mjs § readDomainFor: a read's domain answered inside a 200 ───
// A tool's foreign error is nested in the read, where no door classifies it,
// so the rebuild itself must keep pg's words out. THE FLIP: the catch back to
// `return { error: "bounce", code: e.code, defect: e.defect, hint: e.hint }`.
test("POS-573 world-apex.mjs § readDomainFor: a tool's foreign error in a read's domain keeps only its code", async () => {
  const { readDomainFor } = await load("src/world-apex.mjs");
  const s = SYNTHETIC["pg-hint"];
  const { value, log } = await logged(() => withEnv({ SYNTH_WORLD_TOOL: JSON.stringify(s) },
    () => readDomainFor("give", {}, { household: "h", handles: new Set(["x"]) }, {})));
  assert.deepEqual(value.holdings, { error: "bounce", code: "42P01" });
  keepsOut(value, secretsOf(s), "readDomainFor");
  logSays(log, secretsOf(s), "readDomainFor");
});

// ── fund-exec / gift-exec: classifyFatal's last word ─────────────────────────
// An unclassified fatal was a 500 whose hint was the stderr's first line. THE
// FLIP: that line back as the hint.
for (const [child, defect] of [["src/fund-exec.mjs", "the receipt refused"], ["src/gift-exec.mjs", "the mint refused"]]) {
  test(`POS-578 ${child} § classifyFatal: an unclassified fatal is the office's 500, its stderr in the log`, async () => {
    const { classifyFatal } = await load(child);
    const { value, log } = await logged(() => classifyFatal(SECRET_STDERR));
    assert.deepEqual(value, { code: 500, defect, hint: FAULT_LOGGED });
    logSays(log, [SECRET_STDERR], child);
    assert.equal(classifyFatal("FATAL: the ledger is behind the mail").code, 409, "a classified fatal still answers in its own words");
  });
}

// ── fund-exec: the receipt verb's close-at-fill refusals (POS-653, review-3896) ──
// THE FLIP: drop either row and the town's own sentence (a path, "appended
// locally") reaches the payer as an unclassified 500.
test("POS-653 src/fund-exec.mjs § classifyFatal: a pot that closed in the same minute is a 409 in plain words; a pot that could not be closed is a fixed 500, its words in the log", async () => {
  const { classifyFatal } = await load("src/fund-exec.mjs");
  for (const stderr of [
    `FATAL: pot "meeps-home" is closed, not open — a draft or closed pot takes no dollars; opening one is the founder's word`,
    `FATAL: pot "meeps-home" is draft, not open — a draft or closed pot takes no dollars; opening one is the founder's word`,
    `FATAL: pot "meeps-home" takes its need once and has already closed — it takes its need once, ever`,
  ]) {
    const { value, log } = await logged(() => classifyFatal(stderr));
    assert.deepEqual(value, { code: 409, defect: "this pot has what it asked for", hint: "nothing was recorded; your payment is untouched" }, stderr);
    keepsOut(value, ["meeps-home", "founder"], "a closed pot's refusal");
    assert.equal(log.length, 0, "an ordinary race is not a fault");
  }
  const PATH = "/srv/postmark-office/town-clone/WHITE_PAGES/pot-meeps-home.json";
  const stderr = `FATAL: the receipt was appended locally and took pot "meeps-home" to its need, but its file could not be closed (EACCES: permission denied, open '${PATH}'); under the office's recorder nothing lands, and by hand set its status to closed before any other dollar`;
  const { value, log } = await logged(() => classifyFatal(stderr));
  assert.deepEqual(value, { code: 500, defect: "the receipt refused", hint: "nothing was recorded; your payment is untouched" });
  keepsOut(value, [PATH, "appended locally", "is on the ledger"], "a pot that could not be closed");
  logSays(log, [PATH], "a pot that could not be closed");
});

// ── the review of #525 ──────────────────────────────────────────────────────

// THE FLIP: drop the hint from the answer's log line.
test("POS-573 MCP: a foreign bounce's own hint stays out of the answer and goes to the log, as REST's notAStatus does", async () => {
  const s = SYNTHETIC["pg-hint"];
  const { value: r, log } = await logged(() => withEnv({ SYNTH_RETURN: JSON.stringify({ error: "bounce", code: s.code, hint: s.hint }) }, () => mcpCall("world", {})));
  assert.equal(r.answer.code, 500);
  keepsOut(r.answer, [s.hint], "a returned foreign bounce");
  logSays(log, [s.hint], "a returned foreign bounce");
});

// THE FLIP: say's resident and human bounces back to no code (REST answered them 422).
for (const [who, run] of [
  ["worldSay (a resident)", async () => (await load("src/world.mjs")).worldSay({ text: "hello", handle: "hintleaks" }, { household: "hh:hint-leaks", handles: new Set(["hintleaks"]) })],
  ["worldSayHuman", async () => (await load("src/world.mjs")).worldSayHuman({ text: "hello", human: true }, { household: "hh:hint-leaks", handles: new Set(["hintleaks"]), human: "hint-leaks" })],
]) {
  test(`POS-578 world.mjs § ${who}: a tripped say is the office's 500, its error in the log`, async () => {
    const s = SYNTHETIC["codeless"];
    const { value, log } = await logged(() => withEnv({ SYNTH_SAY: JSON.stringify(s) }, run));
    assert.equal(value.error, "bounce", JSON.stringify(value).slice(0, 300));
    assert.equal(value.defect, "the world door tripped", JSON.stringify(value).slice(0, 300));
    assert.equal(value.code, 500, "not the request's 422");
    assert.equal(value.hint, FAULT_LOGGED);
    keepsOut(value, secretsOf(s), who);
    logSays(log, secretsOf(s), who);
  });
}

// THE FLIPS: each rebuild's foreign-code line out.
for (const [where, mod, fn] of [["world-apex.mjs § actCaught", "src/world-apex.mjs", "actCaught"], ["household-apex.mjs § householdActCaught", "src/household-apex.mjs", "householdActCaught"]]) {
  test(`POS-573 ${where}: an act's foreign error keeps only its code; a refusal keeps its words`, async () => {
    const caught = (await load(mod))[fn];
    const s = SYNTHETIC["pg-hint"];
    const { value, log } = await logged(() => caught(Object.assign(new Error(s.message), s), { did: "an act" }));
    assert.deepEqual(value, { error: "bounce", code: "42P01", did: "an act" });
    logSays(log, secretsOf(s), where);
    const refusal = SYNTHETIC["refusal-409"];
    const kept = caught(Object.assign(new Error(refusal.message), refusal), {});
    assert.equal(kept.defect, "a synthetic refusal");
    assert.equal(kept.hint, "the fixture's own hint");
  });
}

// THE FLIP: mintRefusal back to rebuilding any error that is not a foreign code.
test("POS-578 declare-exec.mjs § mintRefusal: a codeless throw in the mint path is the office's 500, never its message", async () => {
  const { mintRefusal } = await load("src/declare-exec.mjs");
  for (const e of [new TypeError("Cannot read properties of undefined (reading 'slug') at /srv/postmark-office/src/ceremony.mjs:88 (synthetic)"),
    new Error("Connection terminated unexpectedly (synthetic)")]) {
    const { value, log } = await logged(() => mintRefusal(e));
    assert.deepEqual(value, { error: { code: 500, field: null, defect: "the declaration pass tripped", hint: FAULT_LOGGED } });
    keepsOut(value, [e.message], "mintRefusal");
    logSays(log, [e.message], "mintRefusal");
  }
  const refusal = SYNTHETIC["refusal-409"];
  assert.deepEqual(mintRefusal(Object.assign(new Error(refusal.message), refusal)),
    { error: { code: 409, field: null, defect: "a synthetic refusal", hint: "the fixture's own hint" } });
});
