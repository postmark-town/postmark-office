// source-act.test.mjs — WLD-146: the Worldkeeper reads one source act, read-only.
//
// RULED (Darko, 2026-11-13): "Yes." — a read-only door that shows the payload of
// the act behind a log seq, for the Worldkeeper. Queued (Wright, 2026-11-14):
// "No write path."
//
// The read runs against a real store (the suite's Postgres): jsonb is what
// decides which values and types come back, and "nothing was written" is only
// worth something counted in the database the read reads. The acts are written
// by `office_api`, the role the door writes them with; the window and the
// published mark beside them are seeded as the owner, as the suite's other
// store files do.
//
//   node --test test/source-act.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { fixtureTown } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs";
import { removeTempDir, tempDir } from "./helpers/temp-dir.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { stateLogFromStore } from "../src/state-log-from-store.mjs";
import { DRAIN_LAST_CROSSING, SEQ_CONTRACT, SOURCE_ACT_HAND, readSourceAct, sourceActRefusal } from "../src/source-act.mjs";
import { worldApex } from "../src/world-apex.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = tempDir("source-act-");

// ── the keys, in the shapes oauth.mjs § keyLookup and the claim mint build ───
const HOUSE = Object.freeze(["worldkeeper", "lamplighter"]);
const keys = {
  // the household key the human minted: every handle it lists (named-hand.mjs)
  keeperHousehold: { household: "hh:keepers", handles: new Set(HOUSE), keyKind: "household" },
  // the Worldkeeper's own key, in its own hand
  keeperOwn: { household: "hh:keepers", handles: new Set(HOUSE), keyKind: "household", heldBy: "resident", claimedHandle: "worldkeeper" },
  // a housemate's own key: its house lists worldkeeper, but the key is lamplighter's
  housemate: { household: "hh:keepers", handles: new Set(HOUSE), keyKind: "household", heldBy: "resident", claimedHandle: "lamplighter" },
  // a berth's self-mint whose house lists worldkeeper: it names no hand
  berth: { household: "hh:keepers", handles: new Set(HOUSE), keyKind: "berth-upgraded" },
  // another household's key
  other: { household: "hh:elsewhere", handles: new Set(["glitch"]), keyKind: "household" },
  // another of the town's hands (town-stance.mjs § TOWN_HANDS): not this read's
  wright: { household: "hh:founders", handles: new Set(["wright"]), keyKind: "household" },
};

// ── the fixture acts ─────────────────────────────────────────────────────────
// Window 400 closed at 17:45:40Z and cleared at 18:00:34Z (the WLD-137 gap).
// THE SOURCE was filed between the two: after the close, before the clearing.
const WINDOW = { id: 400, opens_at: "2026-11-13T05:45:40.000Z", closes_at: "2026-11-13T17:45:40.000Z", cleared_at: "2026-11-13T18:00:34.000Z" };
const MARK = "sbx-ana/lamp-post";
const PUBLISHED_BODY = "The lamp post, as the settlement published it.";
const act = (over) => ({
  actor: "sbx-ana", action: "leave-mark", object: MARK, class: "mark", household: "gh:4242",
  at_anchor: "sbx-ana/home", at_dx: 1.5, at_dy: -2, witnesses: { source: "earshot", list: [{ handle: "sbx-bo", anchor: "sbx-ana/home", dx: 3, dy: 0 }] },
  effect: null, ...over,
});
const FIXTURE = {
  before: act({ at: "2026-11-13T17:44:59.120Z", crossing: "400.0812", payload: { mark: { slug: MARK, body: "The neighbour before." }, stamps: 1 } }),
  source: act({ at: "2026-11-13T17:50:12.345Z", crossing: "400.0915", payload: {
    mark: {
      slug: MARK, body: "The act's own words, as the resident filed them.",
      geometry: { type: "Point", coordinates: [12.5, -3] },
      tags: ["lamp", "post", { deep: [1, null, true, { deeper: "✦" }] }],
    },
    stamps: 3, ratio: 0.25, flag: false, nothing: null, code: "007", unicode: "café ✦", empty: {}, none: [],
  } }),
  after: act({ at: "2026-11-13T18:01:02.000Z", crossing: "400.1003", payload: { mark: { slug: MARK, body: "The neighbour after." }, stamps: 2 } }),
  drainEra: act({ at: "2026-09-10T05:44:00.000Z", crossing: "182.2538", payload: { mark: { slug: MARK, body: "Photographed by the drain." } } }),
  noCrossing: act({ at: "2026-11-13T17:51:00.000Z", crossing: null, payload: { mark: { slug: MARK, body: "Never photographed." } } }),
};
const ids = {};

let ix = null, office = null, owner = null, pool = null;
const saved = { apex: process.env.WORLD_APEX, pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };

before(async () => {
  ix = await indexStore(fixtureTown(), { db: "source_act" });
  owner = await ix.store.connect("world2_owner");
  await owner.query("INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES ($1, $2, $3, 'closed', $4)",
    [WINDOW.id, WINDOW.opens_at, WINDOW.closes_at, WINDOW.cleared_at]);
  await owner.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
    VALUES (gen_random_uuid(), $1, 'thing', 'sbx-ana', 'hh:ana', $2, $3, '((12,-3.5),(13,-2.5))'::box, 'standing', $4, $5)`,
    [MARK, PUBLISHED_BODY, JSON.stringify({ type: "Point", coordinates: [12.5, -3] }), WINDOW.id, JSON.stringify({ tier: "market" })]);
  const pen = await ix.store.connect("office_api");
  try {
    for (const [name, a] of Object.entries(FIXTURE)) {
      const { rows } = await pen.query(`INSERT INTO acts (at, crossing, actor, action, object, at_anchor, at_dx, at_dy, witnesses, class, payload, effect, household)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [a.at, a.crossing, a.actor, a.action, a.object, a.at_anchor, a.at_dx, a.at_dy, JSON.stringify(a.witnesses), a.class, JSON.stringify(a.payload), a.effect, a.household]);
      ids[name] = Number(rows[0].id);
    }
  } finally { await pen.end(); }

  process.env.WORLD_APEX = "1";
  process.env.WORLD2_PG = ix.env.WORLD2_PG;
  process.env.WORLD2_PG_URL = ix.env.WORLD2_PG_URL;
  pool = new pg.Pool({ connectionString: ix.env.WORLD2_PG_URL, max: 2 });
  pool.on("error", () => {});
  __setPoolForTest(pool);
});

after(async () => {
  __setPoolForTest(null);
  await pool?.end().catch(() => {});
  for (const [k, v] of [["WORLD_APEX", saved.apex], ["WORLD2_PG", saved.pg], ["WORLD2_PG_URL", saved.url]]) {
    if (v == null) delete process.env[k]; else process.env[k] = v;
  }
  const child = office?.child;
  if (child && child.exitCode === null) child.kill();
  await owner?.end().catch(() => {});
  await ix?.stop();
  await removeTempDir(tmp, { children: [child] });
});

const read = (seq, key = keys.keeperOwn, extra = {}) => worldApex({ read: "source-act", args: { seq }, ...extra }, key);
const storedPayload = async (id) => (await owner.query("SELECT payload FROM acts WHERE id = $1", [id])).rows[0].payload;

// THE INSTRUMENT FOR "NOTHING WAS WRITTEN": every table's row count in the store,
// and where the acts sequence stands, read as the owner.
async function storeCounts() {
  const { rows: tables } = await owner.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name");
  const out = {};
  for (const { table_name: t } of tables) out[t] = Number((await owner.query(`SELECT count(*) AS n FROM "${t}"`)).rows[0].n);
  const { rows: [s] } = await owner.query(`SELECT last_value, is_called FROM ${(await owner.query("SELECT pg_get_serial_sequence('acts', 'id') AS s")).rows[0].s}`);
  out["(acts id sequence)"] = `${s.last_value}/${s.is_called}`;
  return out;
}

// ── the keeper reads the act ─────────────────────────────────────────────────

test("WLD-146: the Worldkeeper reads the exact stored payload of the act behind the seq, a post-close/pre-clearing act", async () => {
  const r = await read(ids.source);
  assert.equal(r.error, undefined, `the keeper's read answered: ${JSON.stringify(r).slice(0, 300)}`);
  assert.equal(r.read, "source-act");
  assert.equal(r.seq, ids.source);
  // it is the act filed after its window's recorded close and before its clearing
  assert.ok(Date.parse(r.act.at) > Date.parse(WINDOW.closes_at) && Date.parse(r.act.at) < Date.parse(WINDOW.cleared_at),
    `the source act sits in the close-to-clearing gap: ${r.act.at}`);
  // the identity that tells it apart
  assert.deepEqual(
    { seq: r.act.seq, at: r.act.at, type: r.act.type, actor: r.act.actor, class: r.act.class, object: r.act.object, crossing: r.act.crossing },
    { seq: ids.source, at: FIXTURE.source.at, type: "leave-mark", actor: "sbx-ana", class: "mark", object: MARK, crossing: 400.0915 });
  // the payload: equal to the store's own row, and to what was filed
  assert.deepStrictEqual(r.act.payload, await storedPayload(ids.source), "the payload is the stored row's, value for value");
  assert.deepStrictEqual(r.act.payload, FIXTURE.source.payload, "and that is what the resident filed");
  assert.match(r.payload_key_order, /not recoverable from jsonb/, "the answer says key order is not kept, rather than promising it");
  assert.equal(r.seq_contract, SEQ_CONTRACT);
});

test("WLD-146: nested values keep their types: numbers, booleans, null, a numeric-looking string, unicode, empty containers", async () => {
  const p = (await read(ids.source)).act.payload;
  assert.equal(p.stamps, 3); assert.equal(typeof p.stamps, "number");
  assert.equal(p.ratio, 0.25);
  assert.equal(p.flag, false);
  assert.equal(p.nothing, null); assert.ok(Object.hasOwn(p, "nothing"), "a null value is kept, not dropped");
  assert.equal(p.code, "007"); assert.equal(typeof p.code, "string", "a numeric-looking string stays a string");
  assert.equal(p.unicode, "café ✦");
  assert.deepStrictEqual(p.empty, {}); assert.deepStrictEqual(p.none, []);
  assert.deepStrictEqual(p.mark.geometry, { type: "Point", coordinates: [12.5, -3] });
  assert.deepStrictEqual(p.mark.tags, ["lamp", "post", { deep: [1, null, true, { deeper: "✦" }] }]);
});

test("WLD-146: the requested act, not its neighbours: the acts either side on the same mark answer their own payloads", async () => {
  assert.ok(ids.before === ids.source - 1 && ids.after === ids.source + 1, `the neighbours are adjacent seqs: ${JSON.stringify(ids)}`);
  const [b, s, a] = await Promise.all([read(ids.before), read(ids.source), read(ids.after)]);
  assert.equal(s.act.payload.mark.body, "The act's own words, as the resident filed them.");
  assert.equal(b.act.payload.mark.body, "The neighbour before.");
  assert.equal(a.act.payload.mark.body, "The neighbour after.");
  assert.notDeepStrictEqual(s.act.payload, b.act.payload);
  assert.notDeepStrictEqual(s.act.payload, a.act.payload);
  assert.deepEqual([b.seq, s.seq, a.seq], [ids.before, ids.source, ids.after]);
});

test("WLD-146: the act, not the published projection: the published mark's body is not the act's", async () => {
  const published = (await owner.query("SELECT body FROM marks WHERE slug = $1", [MARK])).rows[0].body;
  assert.equal(published, PUBLISHED_BODY, "control: the published mark stands, with its own body");
  const r = await read(ids.source);
  assert.notEqual(r.act.payload.mark.body, published, "the read answers the act's words, never the published mark's");
  assert.ok(!JSON.stringify(r).includes(PUBLISHED_BODY), "the published body appears nowhere in the answer");
});

test("WLD-146: the answer is the photograph's own line for that seq, less the household key", async () => {
  const photo = await stateLogFromStore(owner, { window: 400.0915, upto: WINDOW.cleared_at });
  const line = photo.lines.find((l) => l.seq === ids.source);
  assert.ok(line, "control: the store pen's photograph carries this seq");
  const { household, ...rest } = line;
  assert.equal(household, "gh:4242", "control: the photograph's line carries the household key");
  const r = await read(ids.source);
  assert.deepStrictEqual(r.act, rest, "the read and the photograph build one line from one row");
  assert.ok(!Object.hasOwn(r.act, "household"), "the read leaves the household key out");
});

// ── nothing is written ───────────────────────────────────────────────────────

test("WLD-146: a read writes nothing: no row in any table, no step of the acts sequence", async () => {
  const before = await storeCounts();
  await read(ids.source);
  await read(ids.before, keys.keeperHousehold);
  await read(999_999_999);
  await read(ids.source, keys.other);
  assert.deepStrictEqual(await storeCounts(), before, "the store is exactly as it was");
});

test("WLD-146 control: the counting instrument sees a write when one happens", async () => {
  const before = await storeCounts();
  const pen = await ix.store.connect("office_api");
  try {
    await pen.query("INSERT INTO acts (at, crossing, actor, action, class, payload) VALUES (now(), 401, 'sbx-control', 'say', 'voice', '{}'::jsonb)");
  } finally { await pen.end(); }
  const after = await storeCounts();
  assert.equal(after.acts, before.acts + 1, "one act more");
  assert.notEqual(after["(acts id sequence)"], before["(acts id sequence)"], "the sequence stepped");
});

// ── who may read it ──────────────────────────────────────────────────────────

test("WLD-146: the Worldkeeper's own key and its household's human key read it (named-hand.mjs semantics)", async () => {
  for (const name of ["keeperOwn", "keeperHousehold"]) {
    const r = await read(ids.source, keys[name]);
    assert.equal(r.error, undefined, `${name} reads: ${JSON.stringify(r).slice(0, 200)}`);
    assert.equal(r.act.seq, ids.source);
  }
});

test("WLD-146: refused: no key, another household's key, a spoofed handle, a housemate's own key, a berth, another town hand", async () => {
  const cases = [
    ["no key", null, {}, 401, /the Worldkeeper's/],
    ["another household's key", keys.other, {}, 403, /the Worldkeeper's alone/],
    ["a spoofed handle", keys.other, { handle: "worldkeeper" }, 403, /the Worldkeeper's alone/],
    ["a housemate's own key", keys.housemate, {}, 403, /"worldkeeper" is not this key's own hand/],
    ["a housemate's own key naming worldkeeper", keys.housemate, { handle: "worldkeeper" }, 403, /"worldkeeper" is not this key's own hand/],
    ["a berth's self-mint", keys.berth, {}, 403, /"worldkeeper" is not this key's own hand/],
    ["another of the town's hands", keys.wright, {}, 403, /the Worldkeeper's alone/],
    ["the keeper's key naming another hand", keys.keeperHousehold, { handle: "lamplighter" }, 403, /read as worldkeeper, not lamplighter/],
  ];
  const verdicts = {};
  for (const [name, key, extra] of cases) {
    const r = await read(ids.source, key, extra);
    verdicts[name] = { code: r.code, refused: r.error === "bounce", defect: r.defect, leaked: JSON.stringify(r).includes("The act's own words") };
  }
  const want = Object.fromEntries(cases.map(([name, , , code]) => [name, code]));
  assert.deepStrictEqual(Object.fromEntries(Object.entries(verdicts).map(([n, v]) => [n, v.code])), want, `the whole verdict map: ${JSON.stringify(verdicts)}`);
  for (const [name, , , , words] of cases) {
    assert.ok(verdicts[name].refused, `${name}: refused`);
    assert.match(verdicts[name].defect, words, `${name}: says why`);
    assert.equal(verdicts[name].leaked, false, `${name}: no payload rides the refusal`);
  }
});

test("WLD-146: the gate itself: holdsHand on the one hand, and nothing else answers", () => {
  assert.equal(SOURCE_ACT_HAND, "worldkeeper");
  assert.equal(sourceActRefusal(keys.keeperOwn), null);
  assert.equal(sourceActRefusal(keys.keeperHousehold), null);
  assert.equal(sourceActRefusal(keys.housemate)?.code, 403);
  assert.equal(sourceActRefusal(keys.other, "worldkeeper")?.code, 403);
  assert.equal(sourceActRefusal(null)?.code, 401);
});

// ── the distinct answers that are not a payload ──────────────────────────────

test("WLD-146: an invalid seq is a 422, never a read", async () => {
  let asked = 0;
  const query = async () => { asked += 1; return []; };
  for (const [what, args] of [["no seq", {}], ["zero", { seq: 0 }], ["negative", { seq: -3 }], ["a fraction", { seq: 1.5 }],
    ["words", { seq: "the lamp" }], ["past a safe integer", { seq: 2 ** 60 }], ["a stray field", { seq: 1, handle: "worldkeeper" }]]) {
    const r = await readSourceAct(args, keys.keeperOwn, { query });
    assert.equal(r.code, 422, `${what}: 422 (${r.defect})`);
  }
  assert.equal(asked, 0, "no invalid seq reached the store");
  const coerced = await readSourceAct({ seq: String(ids.source) }, keys.keeperOwn);
  assert.equal(coerced.act?.seq, ids.source, "a seq sent as a numeric string reads as the number (the read validator's coercion)");
});

test("WLD-146: a seq no act carries is a 404 that says so, not an empty payload", async () => {
  const r = await read(ids.after + 1000);
  assert.equal(r.code, 404);
  assert.match(r.defect, /no act carries seq \d+ in the world's record/);
  assert.equal(r.act, undefined);
  assert.equal(r.payload, undefined);
});

test("WLD-146: a drain-era act or one with no crossing answers as no store-era line, never as the act its id happens to be", async () => {
  assert.equal(DRAIN_LAST_CROSSING, 182.2538);
  for (const name of ["drainEra", "noCrossing"]) {
    const r = await read(ids[name]);
    assert.equal(r.code, 404, `${name}: 404`);
    assert.match(r.defect, /no store-era log line carries seq/, `${name}: says which kind of absence`);
    assert.ok(!JSON.stringify(r).includes("Photographed by the drain") && !JSON.stringify(r).includes("Never photographed"), `${name}: no payload rides it`);
  }
  // control: the same store holds both rows, so the refusal is the boundary's, not a missing row
  const { rows } = await owner.query("SELECT count(*) AS n FROM acts WHERE id = ANY($1)", [[ids.drainEra, ids.noCrossing]]);
  assert.equal(Number(rows[0].n), 2);
});

test("WLD-146: an unreadable store is a 503, distinct from not-found: unconfigured, and a store that throws", async () => {
  const flag = process.env.WORLD2_PG;
  delete process.env.WORLD2_PG;
  try {
    const r = await read(ids.source);
    assert.equal(r.code, 503, "no store configured: 503");
    assert.match(r.defect, /cannot be reached/);
  } finally { process.env.WORLD2_PG = flag; }
  __setPoolForTest({ async query() { throw Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" }); } });
  try {
    const r = await read(ids.source);
    assert.equal(r.code, 503, "a store that throws: 503");
    assert.equal(r.act, undefined);
  } finally { __setPoolForTest(pool); }
  assert.equal((await read(ids.source)).act?.seq, ids.source, "control: the same read answers once the store is back");
});

// ── the plain twin: GET /world/apex, the same dispatcher ─────────────────────

const KEEPER_KEY = "pmk_static_worldkeeper_source_act_0001";
const OTHER_KEY = "pmk_static_glitch_source_act_0002";

test("WLD-146: GET /world/apex?read=source-act: the keeper's key reads it, another key and no key are refused", async () => {
  const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0",
    "--oauth-db", seedStaticKeys(join(tmp, "oauth.db"), `${KEEPER_KEY}=keeper-house:worldkeeper;${OTHER_KEY}=other-house:glitch`),
    "--roles-db", join(tmp, "roles.db")], {
    env: { ...process.env, TOWN_CLONE: join(tmp, "no-clone-here"), WORLD_CLONE: join(tmp, "no-world-clone"), VOICES_LOG: join(tmp, "voices.jsonl"),
      TOWN_PUSH: "", WORLD_APEX: "1", WORLD_STORE_DB: join(tmp, "no-world.db"), ...ix.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error(`the office never listened: ${stderr.slice(-600)}`)), 30_000);
    child.stdout.on("data", (d) => { const m = /listening on :(\d+)/.exec(String(d)); if (m) { clearTimeout(t); office = { child, base: `http://127.0.0.1:${m[1]}` }; ok(); } });
    child.on("exit", (c) => no(new Error(`the office exited early (${c}): ${stderr.slice(-600)}`)));
  });
  const get = (key) => fetch(`${office.base}/world/apex?read=source-act&args=${encodeURIComponent(JSON.stringify({ seq: ids.source }))}`,
    { headers: key ? { authorization: `Bearer ${key}` } : {} });

  const countBefore = (await owner.query("SELECT count(*) AS n, max(id) AS m FROM acts")).rows[0];
  const ok = await get(KEEPER_KEY);
  const body = await ok.json();
  assert.equal(ok.status, 200, `the keeper's key: ${JSON.stringify(body).slice(0, 300)}`);
  assert.equal(body.act.seq, ids.source);
  assert.deepStrictEqual(body.act.payload, FIXTURE.source.payload);
  const other = await get(OTHER_KEY);
  assert.equal(other.status, 403, "another household's key");
  assert.ok(!JSON.stringify(await other.json()).includes("The act's own words"));
  const none = await get(null);
  assert.equal(none.status, 401, "no key");
  assert.deepEqual((await owner.query("SELECT count(*) AS n, max(id) AS m FROM acts")).rows[0], countBefore, "no act was written through the plain door");
});
