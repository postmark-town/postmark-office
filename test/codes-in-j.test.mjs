// codes-in-j.test.mjs — every status the office writes is an HTTP status
// (POS-544, the seam review of #469).
//
// About twenty catches in server.mjs rebuild a handler's error as
// `bounce(res, e.code, e.defect, e.hint)`. A refusal's own number belongs there;
// pg's SQLSTATE ("57P01", a restart ending the session), store-pool's
// "store-acquire-timeout" and every other string code did not: writeHead threw
// inside the async handler, and the body-read catch answered 400 "could not
// read the body". server.mjs § j now classifies the code once, where every REST
// answer is written: a status passes, a lost store is 503 with Retry-After, and
// anything else is 500. And the town index's 503 (index-probe.mjs §
// UNREACHABLE_DEFECT) now says when to ask again.
//
// THE RIG. One office on a store, a static key, and a test-only module hook
// (`--import`) that adds one line to the top of three functions as they load,
// so each door's own catch is the one that answers:
//
//   town-apex.mjs § townApexAnswer        POST /town/apex, args.synthetic
//   world.mjs § worldNoteViaOffice        POST /world/notes (a write), body "synthetic:<name>"
//   town-index-store.mjs § storeAnswer    the town index refuses while a marker file exists
//
// Nothing in src/ knows about it, and the hook refuses to load a module whose
// anchor is not there exactly once, so a moved function fails this file loudly.
//
//   node --test test/codes-in-j.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtureDb } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs";
import { removeTempDir, tempDir } from "./helpers/temp-dir.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = tempDir("codes-in-j-");
const KEY = "pos544-codes-in-j-test-key";
const TOWN_DOWN = join(tmp, "town-index-down");

// The errors a handler throws past a door's catch, by name.
const SYNTHETIC = {
  "lost-session": { code: "57P01", message: "terminating connection due to administrator command" },
  "acquire-timeout": { code: "store-acquire-timeout", message: "the store's pen pool had no free connection within 10000 ms (it holds 3)" },
  "not-a-status": { code: "nested-store", message: "a asked the store's pen for a connection while this call already holds one (b)" },
  "refusal-409": { code: 409, message: "a synthetic refusal", defect: "a synthetic refusal", hint: "the fixture's own hint" },
  // the status check's edges (the seam review of #473): none of these is a refusal status
  "status-99": { code: 99, message: "synthetic edge: status 99" },
  "status-600": { code: 600, message: "synthetic edge: status 600" },
  "string-409": { code: "409", message: "synthetic edge: the string 409" },
  "status-0": { code: 0, message: "synthetic edge: status 0" },
  "status-200": { code: 200, message: "synthetic edge: status 200", defect: "a refusal that carried 200" },
};

const HOOKS = `
import { existsSync } from "node:fs";
const SYNTHETIC = ${JSON.stringify(SYNTHETIC)};
const THROW = (name) => "throw Object.assign(new Error(SYNTHETIC_THROWS[" + name + "].message), SYNTHETIC_THROWS[" + name + "]);";
const EDITS = {
  "/src/town-apex.mjs": ["async function townApexAnswer(args, key, ctx) {",
    "if (args?.args?.synthetic != null && Object.hasOwn(SYNTHETIC_THROWS, args.args.synthetic)) " + THROW("args.args.synthetic")],
  "/src/world.mjs": ["export async function worldNoteViaOffice(worldClone, payload = {}, key = null) {",
    "if (typeof payload?.body === 'string' && payload.body.startsWith('synthetic:') && Object.hasOwn(SYNTHETIC_THROWS, payload.body.slice(10))) " + THROW("payload.body.slice(10)")],
  "/src/world-settlement.mjs": ["export async function settlementOrFile({ asked = null, fileAnswer, engaged, pool, worldRepo, townRepo = null }) {",
    "if (typeof asked === 'string' && asked.startsWith('synthetic:') && Object.hasOwn(SYNTHETIC_THROWS, asked.slice(10))) " + THROW("asked.slice(10)")],
  "/src/town-index-store.mjs": ["export async function storeAnswer(fn, { env = process.env, then = null } = {}) {",
    "if (process.env.SYNTHETIC_TOWN_DOWN && (await import('node:fs')).existsSync(process.env.SYNTHETIC_TOWN_DOWN)) return { refused: UNREACHABLE };"],
};
export async function load(url, context, nextLoad) {
  const r = await nextLoad(url, context);
  const at = Object.keys(EDITS).find((k) => url.endsWith(k));
  if (!at) return r;
  const [anchor, line] = EDITS[at];
  const src = String(r.source);
  if (src.split(anchor).length !== 2) throw new Error("codes-in-j hook: the anchor is not in " + at + " exactly once: " + anchor);
  return { ...r, source: src.replace(anchor, () => anchor + " " + line) + "\\nconst SYNTHETIC_THROWS = " + JSON.stringify(SYNTHETIC) + ";\\n", shortCircuit: true };
}
`;

let ix = null, office = null;

before(async () => {
  const dbPath = join(tmp, "office.db");
  fixtureDb(dbPath).close();
  ix = await indexStore(dbPath, { db: "codes_in_j" });
  const hooks = join(tmp, "hooks.mjs");
  writeFileSync(hooks, HOOKS);
  const register = join(tmp, "register.mjs");
  writeFileSync(register, `import { register } from "node:module";\nregister(${JSON.stringify(pathToFileURL(hooks).href)});\n`);
  const child = spawn(process.execPath, ["--import", pathToFileURL(register).href, join(ROOT, "src", "server.mjs"), "--port", "0", "--db", dbPath,
    "--oauth-db", seedStaticKeys(join(tmp, "oauth.db"), `${KEY}=fixture-house:wright`), "--roles-db", join(tmp, "roles.db")], {
    env: { ...process.env, TOWN_CLONE: join(tmp, "no-clone-here"), WORLD_CLONE: join(tmp, "no-world-clone"), VOICES_LOG: join(tmp, "voices.jsonl"),
      TOWN_PUSH: "", WORLD_APEX: "1", WORLD_STORE_DB: join(tmp, "no-world.db"), SYNTHETIC_TOWN_DOWN: TOWN_DOWN, ...ix.env },
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
  if (child && child.exitCode === null) child.kill();
  await ix?.stop();
  await removeTempDir(tmp, { children: [child] });
});

const answer = async (res) => ({ status: res.status, retryAfter: res.headers.get("retry-after"), body: await res.json() });
const post = (path, body) => fetch(`${office.base}${path}`, {
  method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: JSON.stringify(body) }).then(answer);

const DOORS = [
  { door: "POST /town/apex", ask: (name) => post("/town/apex", { args: { synthetic: name } }) },
  { door: "POST /world/notes", ask: (name) => post("/world/notes", { body: `synthetic:${name}` }) },
];

const EXPECT = {
  "lost-session": (r) => {
    assert.equal(r.status, 503, "a lost store is an outage");
    assert.equal(r.retryAfter, "30", "and says when to ask again");
    assert.match(r.body.defect, /store went away mid-request/);
    assert.match(r.body.hint, /may not have been recorded/, "an act is told to read before it re-sends");
  },
  "acquire-timeout": (r) => {
    assert.equal(r.status, 503);
    assert.equal(r.retryAfter, "30");
    assert.match(r.body.defect, /store went away mid-request/);
  },
  "not-a-status": (r) => {
    assert.equal(r.status, 500, "a code that is neither a status nor a lost store is the office's own fault");
    assert.equal(r.retryAfter, null);
    assert.match(r.body.hint, /"nested-store", which is not an HTTP status/);
  },
  "refusal-409": (r) => {
    assert.equal(r.status, 409, "a refusal's own number passes through untouched");
    assert.equal(r.body.defect, "a synthetic refusal");
    assert.equal(r.body.hint, "the fixture's own hint");
  },
};

for (const { door, ask } of DOORS) {
  for (const [name, expect] of Object.entries(EXPECT)) {
    test(`${door}: a handler error with code ${JSON.stringify(SYNTHETIC[name].code)} (${name})`, async (t) => {
      const r = await ask(name);
      t.diagnostic(`the door answered ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
      expect(r);
      assert.equal(r.body.refused, true, "every refusal says so (POS-427)");
      assert.equal(r.body.code, r.status, "the body's code is the status line's");
      assert.equal(office.child.exitCode, null, `the office is still up: ${office.stderr().slice(-300)}`);
    });
  }
}

// ── the status check's edges, at one door ───────────────────────────────────
//
// Each is 500, and the log names the error's message as well as its code, so the
// 500 can be read back. 99, 600 and "409" are not statuses (j's check); 0 is
// falsy, so the catch's own 500 answers it; 200 is a status but no refusal (the
// floor in bounce).
for (const name of ["status-99", "status-600", "string-409", "status-0", "status-200"]) {
  test(`POST /town/apex: a handler error with code ${JSON.stringify(SYNTHETIC[name].code)} is the office's own 500, and the log says what failed`, async (t) => {
    const r = await post("/town/apex", { args: { synthetic: name } });
    t.diagnostic(`the door answered ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    assert.equal(r.status, 500);
    assert.equal(r.body.refused, true);
    assert.equal(r.body.code, 500, "the body's code is the status line's");
    assert.equal(r.retryAfter, null);
    assert.ok(r.body.defect, "the 500 names what tripped");
    if (name === "status-0") {
      // the catch's own 500 path, which has always put the message in the hint
      assert.equal(r.body.hint, SYNTHETIC[name].message);
      return;
    }
    // stderr is written as the answer is, but read here on another stream
    for (let i = 0; i < 40 && !office.stderr().includes(SYNTHETIC[name].message); i++) await new Promise((ok) => setTimeout(ok, 25));
    assert.ok(office.stderr().includes(SYNTHETIC[name].message), `the office's log names the error's message (${SYNTHETIC[name].message})`);
  });
}

// ── a GET door through notAStatus: the read's words ─────────────────────────

test("GET /world/state: a lost-store code answers 503 with Retry-After, and tells a read it is safe to repeat", async (t) => {
  const r = await answer(await fetch(`${office.base}/world/state?settlement=synthetic:lost-session`));
  t.diagnostic(`the door answered ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
  assert.equal(r.status, 503);
  assert.equal(r.retryAfter, "30");
  assert.match(r.body.defect, /store went away mid-request/);
  assert.match(r.body.hint, /A read is safe to repeat/);
  assert.doesNotMatch(r.body.hint, /may not have been recorded/);
});

test("the town index's 503 carries Retry-After (GET /residents while the index cannot be read)", async () => {
  writeFileSync(TOWN_DOWN, "down");
  let r;
  try { r = await answer(await fetch(`${office.base}/residents`)); }
  finally { rmSync(TOWN_DOWN, { force: true }); }
  assert.equal(r.status, 503, JSON.stringify(r.body).slice(0, 300));
  assert.match(r.body.defect, /town index \(the store\) cannot be reached/);
  assert.equal(r.retryAfter, "30", "the refusal says ask again shortly, and the header says when");
  const back = await answer(await fetch(`${office.base}/residents`));
  assert.equal(back.status, 200, `the door answers once the index reads: ${JSON.stringify(back.body).slice(0, 200)}`);
  assert.equal(back.retryAfter, null);
});
