// town-index-writes.test.mjs — group 4 of POS-268: the write path's questions
// of the index (index-probe.mjs) answer from the store exactly as office.db's
// probe answered them.
//
//   EMBEDDED_PG_DIR=<dir with embedded-postgres> node --test test/town-index-writes.test.mjs
//
// test/fixture.mjs's town plus what the ports had to get right: a handle the
// door could never admit (`_archived`), two handles bound to one GitHub login
// by the two spellings (the card's and the top level), a JSON-null `github`
// that falls through to the card's, an empty one that does not, and a pinned
// handle the roll does not hold (the harbor stamp). The store is seeded from
// those rows. Then: every check, compared as what it answers or throws to what
// it answered over office.db's probe on the same rows, recorded in the last tree
// that had office.db (helpers/twin-golden.mjs, POS-656); the refusing probe; the
// out-of-process pens (join-bind-exec) over the store and a store that is gone;
// and the keyless desks and POST /letters over an office and one whose store is
// gone.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { tempClone, fixtureTown, putValues } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { seedTownIndex } from "./helpers/index-to-store.mjs";
import { twinGolden } from "./helpers/twin-golden.mjs";
import { seedRegistry, recordInProcess } from "./helpers/office-under-test.mjs";
import { holdStoreProbe, UNREACHABLE_DEFECT } from "../src/index-probe.mjs";
import { STANDING_UNREADABLE } from "../src/standing.mjs";
import * as store from "../src/town-index-store.mjs";
import { validateLetter } from "../src/write.mjs";
import { validateResidencyRequest } from "../src/residency.mjs";
import { handleTaken } from "../src/declare.mjs";
import { householdFor } from "../src/oauth.mjs";
import { threadlessReplyHint } from "../src/mail-thread.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs"; // POS-352: static keys are store rows

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TWINS = twinGolden("town-index-writes");
const tmp = mkdtempSync(join(tmpdir(), "town-index-writes-"));
const KEY = "writes-test-key";
let s = null, skip = false, api, db, rows, clone, unrecord = null;
const offices = {};

before(async () => {
  s = await startStore();
  if (s.skip) { skip = s.skip; return; }
  db = fixtureTown();
  const R = (...v) => putValues(db, "residents", v);
  R("Zed", JSON.stringify({ handle: "Zed", address: { data: { joined: "2026-07-13", github: "Zed-GH" } } }));
  R("_archived", JSON.stringify({ handle: "_archived", address: { data: { joined: "2026-07-13" } } }));
  R("nullgh", JSON.stringify({ handle: "nullgh", github: null, address: { data: { github: "fallback" } } }));
  R("emptygh", JSON.stringify({ handle: "emptygh", github: "", address: { data: { github: "never-read" } } }));
  R("zed-two", JSON.stringify({ handle: "zed-two", github: "zed-gh", address: { data: {} } }));
  // the rows in bytewise order, as the vendored readTown's sorted listing gives them
  db.residents.sort((a, b) => Buffer.compare(Buffer.from(a.handle), Buffer.from(b.handle)));
  const w = await s.connect("law_ingester");
  await seedTownIndex(w, db);
  await w.end();
  api = await s.connect("office_api");
  rows = await store.probeRows(api);

  clone = tempClone();
  mkdirSync(join(clone, "tools"), { recursive: true });
  writeFileSync(join(clone, "tools", "github-ids.json"), JSON.stringify({ ghost: { id: 999 } }));
  // sign-in's pins are the STORE's (POS-343): the same pin, in household_pins,
  // and this process's record pointed at it for the in-process checks below
  await seedRegistry(s, null, { ghost: { login: "ghost-gh", id: 999 } });
  unrecord = await recordInProcess(s);

  for (const [name, env] of [["switched", { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") }],
    ["cut-off", { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://office_api:x@127.0.0.1:9/none" }]]) {
    const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0",
      "--oauth-db", seedStaticKeys(join(tmp, `${name}-oauth.db`), `${KEY}=keemin:limen`), "--roles-db", join(tmp, `${name}-roles.db`)], {
      env: { ...process.env, TOWN_CLONE: clone, WORLD_CLONE: join(tmp, "no-world-clone"), VOICES_LOG: join(tmp, `${name}-voices.jsonl`),
        TOWN_PUSH: "", WORLD_STORE_DB: join(tmp, "no-world.db"), OFFICE_READ_WORKERS: "0",
        WORLD2_PG: undefined, WORLD2_PG_URL: undefined, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error(`${name}: the office never listened`)), 20_000);
      child.stdout.on("data", (d) => { const m = /listening on :(\d+)/.exec(String(d)); if (m) { clearTimeout(t); offices[name] = { child, base: `http://127.0.0.1:${m[1]}` }; ok(); } });
      child.on("exit", (c) => no(new Error(`${name}: the office exited early (${c})`)));
    });
  }
  // the switched office loads its probe at boot; wait for it rather than race it
  for (let i = 0; i < 100; i++) {
    const r = await post("switched", "/keys/claim", { handle: "nobody" }); // the berth desk counts every ask against its hourly five
    if (r.status !== 503) break;
    await new Promise((ok) => setTimeout(ok, 100));
  }
});

after(async () => {
  if (unrecord) await unrecord();
  for (const { child } of Object.values(offices)) if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
  if (api) await api.end().catch(() => {});
  if (s?.stop) await s.stop();
  for (const d of [tmp, clone]) if (d) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function post(office, path, body, auth = null) {
  return fetch(offices[office].base + path, { method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) } });
}

// what a check answers, or what it throws in the bounce vocabulary
// Async since householdFor reads the store's pins (POS-343); a sync check is awaited the same.
const outcome = async (fn) => {
  try { const v = await fn(); return JSON.stringify(v instanceof Set ? [...v] : v, (k, x) => (x instanceof Set ? [...x] : x)); }
  catch (e) { return JSON.stringify({ threw: e?.code ?? e?.name, defect: e?.defect ?? e?.message, hint: e?.hint ?? null }); }
};

// a check run with `probe` as this process's held probe (null: none loaded, the refusing probe)
async function withProbe(probe, fn) {
  holdStoreProbe(probe);
  try { return await fn(); } finally { holdStoreProbe(null); }
}

test("the store's probe answers every question as office.db's did", async (t) => {
  if (skip) return t.skip(skip);
  const st = store.probeOver(rows);
  const handles = db.residents.map((r) => r.handle);
  for (const h of [...handles, "nobody", "WRIGHT", "zed", "", "wright "]) TWINS.equal(`hasResident ${JSON.stringify(h)}`, JSON.stringify(st.hasResident(h)));
  const ids = db.letters.map((r) => r.id);
  for (const id of [...ids, "nope", ids[0].toUpperCase(), `${ids[0]} `]) TWINS.equal(`hasLetter ${id}`, JSON.stringify(st.hasLetter(id)));
  TWINS.equal("loginRows", JSON.stringify(st.loginRows()), "the GitHub lines, in the same order");
  const mail = new Map();
  for (const h of ["wright", "limen", "nobody"]) mail.set(h, (await api.query("SELECT json FROM town_mail_state WHERE handle = $1", [h])).rows[0]?.json ?? null);
  const withMail = store.probeOver(rows, { mail });
  for (const h of mail.keys()) TWINS.equal(`mail_state ${h}`, JSON.stringify(withMail.mailStateJson(h)));
  assert.match(st.loginStamp(), /^store:/, "the login memo keys on the store's head");
});

// Each check, as a door calls it, with no probe handed in: the answers can only
// have come from the store's held probe.
const LIMEN = { household: "keemin", handles: new Set(["limen"]) };
const RETURN = { id: "limen-2026-07-03-to-wright-the-return", file: "WHITE_PAGES/limen/outbox/letter-2026-07-03-to-wright-the-return.md" };
const runAll = async (fns) => { const out = []; for (const fn of fns) out.push(await outcome(fn)); return out; };
const checks = (ix) => [
  () => validateLetter({ from: "limen", to: "nobody", title: "Hi", body: "x" }, LIMEN, ix),
  () => validateLetter({ from: "limen", to: "wright", title: "Hi", body: "x", thread: "no-such-letter" }, LIMEN, ix),
  () => validateLetter({ from: "limen", to: "wright", title: "Hi", body: "x", thread: "limen-2026-07-01-to-wright-the-gap" }, LIMEN, ix),
  () => validateLetter({ from: "limen", to: "wright", title: "The return", body: "x", thread: "new" }, LIMEN, ix, RETURN),
  () => validateLetter({ from: "limen", to: "Zed", title: "Hi", body: "x" }, LIMEN, ix),
  () => validateResidencyRequest({ handle: "wright", card: "me" }, ix),
  () => validateResidencyRequest({ handle: "Nullgh", card: "me" }, ix),
  () => validateResidencyRequest({ handle: "newcomer", card: "me" }, ix),
  () => handleTaken("zed-two", { db: ix, registry: null, clone }),
  () => handleTaken("newcomer", { db: ix, registry: null, clone }),
  () => householdFor(ix, 1, "ZED-gh"),
  () => householdFor(ix, 2, "keeminlee"),
  () => householdFor(ix, 3, "fallback"),
  () => householdFor(ix, 4, "never-read"),
  () => householdFor(ix, 999, null),
  () => householdFor(ix, 5, "stranger"),
];

test("every check answers over the store as it did over office.db", async (t) => {
  if (skip) return t.skip(skip);
  const got = await withProbe(store.probeOver(rows), async () => await runAll(checks(null)));
  assert.ok(got.some((o) => o.includes('"threw":409')) && got.some((o) => o.includes('"threw":422')), "the asks exercise both refusals");
  assert.ok(got.some((o) => o.includes('"harbor":true')), "and the harbor stamp");
  for (const [i, o] of got.entries()) TWINS.equal(`check ${i}`, o, `check ${i}`);
  // the reply hint, off the row the send read
  const mail = new Map([["wright", (await api.query("SELECT json FROM town_mail_state WHERE handle = 'wright'")).rows[0].json]]);
  const hint = await withProbe(store.probeOver(rows), () => threadlessReplyHint(store.probeOver(rows, { mail }), { from: "wright", to: "limen" }));
  assert.ok(hint, "the fixture's wright has an unanswered letter from limen");
  TWINS.equal("hint", JSON.stringify(hint));
});

test("with no snapshot, every check refuses with the store's 503, and the hint says nothing", async (t) => {
  if (skip) return t.skip(skip);
  const outs = await withProbe(null, async () => await runAll(checks(null)));
  for (const [i, o] of outs.entries()) {
    if (i === 14) continue; // below
    const r = JSON.parse(o);
    assert.equal(r.threw, 503, `check ${i}: ${o}`);
    assert.equal(r.defect, UNREACHABLE_DEFECT, `check ${i}`);
  }
  // a pinned household whose settled test cannot be read is never stamped harbor: an unreadable index never widens the gate
  assert.equal(outs[14], JSON.stringify({ household: "999", handles: ["ghost"] }));
  assert.equal(await withProbe(null, () => threadlessReplyHint(null, { from: "wright", to: "limen" })), null);
  assert.equal(await store.refreshStoreProbe({ env: { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://office_api:x@127.0.0.1:9/none" } }), false);
});

test("a send draws the same reply hint from the store's row, and a store gone after the send only loses the hint", async (t) => {
  if (skip) return t.skip(skip);
  const { sendAtDoor } = await import("../src/send-at-door.mjs");
  const WRIGHT = { household: "keemin", handles: new Set(["wright"]) };
  const send = (title) => sendAtDoor({ from: "wright", to: "limen", title, body: "x" }, WRIGHT, { clone, odb: null });
  const keep = { WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 2 });
  const pen = await import("../src/world2-pen.mjs");
  try {
    Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
    pen.__setPoolForTest(pool);
    assert.equal(await store.refreshStoreProbe(), true);
    const switched = (await send("Switched ask")).result;
    assert.ok(switched.hint, "the send carries the hint");
    TWINS.equal("send hint", JSON.stringify(switched.hint), "the hint office.db's send carried");
    pen.__setPoolForTest({ connect: async () => { throw new Error("ECONNREFUSED"); } });
    const gone = (await send("Gone ask")).result;
    assert.ok(gone.letter_id, "the letter went");
    assert.equal(gone.hint, undefined, "and no hint rode it");
  } finally {
    pen.__setPoolForTest(null); await pool.end(); holdStoreProbe(null);
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

function joinBind(env) {
  const payload = JSON.stringify({ args: { handle: "wright", card: "me" }, key: { ghId: 7, ghLogin: "someone", handles: [] } });
  const r = spawnSync(process.execPath, [join(ROOT, "src", "join-bind-exec.mjs"), payload], {
    env: { ...process.env, TOWN_CLONE: clone, TOWN_PUSH: "", ...env }, encoding: "utf8", timeout: 30_000 });
  return JSON.parse(r.stdout.trim().split("\n").pop());
}

test("the join pen reads the store under the lock, as it read office.db, and refuses when the store is gone", async (t) => {
  if (skip) return t.skip(skip);
  const got = joinBind({ WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
  assert.equal(got.error?.code, 409, JSON.stringify(got));
  TWINS.equal("join", JSON.stringify(got));
  const gone = joinBind({ WORLD2_PG: "1", WORLD2_PG_URL: "postgres://office_api:x@127.0.0.1:9/none" });
  assert.equal(gone.error?.code, 503, JSON.stringify(gone));
  assert.equal(gone.error?.defect, UNREACHABLE_DEFECT);
});

test("the drain stops before a row when the store cannot answer", async (t) => {
  if (skip) return t.skip(skip);
  // no --db: the flag is retired (POS-268 5b) and refused with exit 2, before the store is asked
  const r = spawnSync(process.execPath, [join(ROOT, "tools", "town-drain-run.mjs"), "--clone", clone, "--oauth-db", join(tmp, "drain-oauth.db"), "--dry-run"], {
    env: { ...process.env, WORLD2_PG: "1", WORLD2_PG_URL: "postgres://office_api:x@127.0.0.1:9/none" }, encoding: "utf8", timeout: 30_000 });
  assert.equal(r.status, 1, r.stderr);
  assert.ok(r.stderr.includes(UNREACHABLE_DEFECT), r.stderr);
});

const ASKS = [
  ["/berth", { slug: "wright" }],
  ["/berth", { slug: "zed-two" }],
  ["/keys/claim", { handle: "nobody" }],
  ["/letters", { from: "limen", to: "nobody", title: "Hi", body: "x" }, KEY],
  // (A thread the index does not hold was a refusal here until POS-332; it is
  // accepted now, so a POST of it WRITES and two offices sharing one town log
  // cannot both send it. It is held at `checks` above, where validateLetter
  // answers as it did over office.db, and in test/stale-copy.test.mjs.)
];

test("the keyless desks and POST /letters answer as the unswitched office did", async (t) => {
  if (skip) return t.skip(skip);
  for (const [path, body, auth] of ASKS)
    await TWINS.equalResponse(`POST ${path} ${JSON.stringify(body)}`, await post("switched", path, body, auth), `${path} ${JSON.stringify(body)}: status and body`);
});

test("a door whose store is gone answers the store's 503", async (t) => {
  if (skip) return t.skip(skip);
  for (const [path, body, auth] of ASKS) {
    const r = await post("cut-off", path, body, auth);
    assert.equal(r.status, 503, `${path} ${JSON.stringify(body)}`);
    // A KEYED write meets the standing gate first (POS-347): standing is read
    // from the same store before any write, so its 503 is the store's 503 and
    // says nothing was written. The keyless desks never reach that gate.
    assert.equal((await r.json()).defect, auth ? STANDING_UNREADABLE.defect : UNREACHABLE_DEFECT, path);
  }
});
