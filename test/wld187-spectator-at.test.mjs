// wld187-spectator-at.test.mjs — WLD-187: world { at: <mark | place | "x,y"> }, the bare v2 read as nobody standing there
// (POS-844 call 4, ruled by Darko 2026-11-16: "It's invisible: not in who, nothing recorded, no can.").
//
// THE RIG is world-read-shape.test.mjs's: the real world clone hydrated to rows and published as the world graph snapshot, and a
// record that holds no acts (its pool answers only the reads the apex makes, and every statement it is shown is kept, so "nothing
// recorded" is a thing this file can look at). kogane is the caller the key names; every other record is the clone's own.
//
// Run: WORLD_CLONE=<a world checkout> node --import ./test/helpers/sparse-guard.mjs --test test/wld187-spectator-at.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_WORLD, OFFICE_ROOT, worldClone } from "./fixture-paths.mjs";
import { publishWorld } from "./helpers/world-rows.mjs";

const CLONE = worldClone();
const HAVE_CLONE = Boolean(CLONE) && existsSync(join(CLONE, "WORLD", "world-state.json"));
const WHY_NOT = CLONE ? `the world clone at ${CLONE} is missing world-state.json` : NO_WORLD;
const ENV = { WORLD_MOVEMENT_V2: undefined, WORLD_PRESENCE: undefined, WORLD_APEX: "1", WORLD2_PG: "1", WORLD2_PG_URL: "postgres://wld187/none", WORLD_READ_SHAPE: undefined };
const saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
const setEnv = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
for (const [k, v] of Object.entries(ENV)) setEnv(k, v);

const { worldApex, APEX_TOOL, spectatorLook } = await import("../src/world-apex.mjs");
const { __setPoolForTest } = await import("../src/world2-acts.mjs");
const { validateArgs } = await import("../src/validate-args.mjs");

const WHO = "kogane";
const KEY = { handles: new Set([WHO]) };
const KOGANE_PARCEL = "kogane/the-well-house-parcel";
const SEEN = []; // every statement the record was shown, in order
let dir;

before(() => {
  if (!HAVE_CLONE) return;
  dir = mkdtempSync(join(tmpdir(), "wld187-"));
  execFileSync(process.execPath, [join(OFFICE_ROOT, "src", "world-hydrate.mjs"), "--world", CLONE, "--no-db", "--rows-out", join(dir, "rows.json"), "--no-gexf", "--no-lints"],
    { stdio: "ignore", env: { ...process.env, TMP: dir, TEMP: dir, TMPDIR: dir } });
  publishWorld(join(dir, "rows.json"), "the world clone's head");
  __setPoolForTest({ async query(sql) {
    const text = String(sql).replace(/\s+/g, " ");
    SEEN.push(text);
    if (/max\(id\) AS hw, count\(\*\) AS n FROM acts/.test(text)) return { rows: [{ hw: null, n: "0" }] };
    if (/SELECT id, at, crossing, actor, action, payload FROM acts/.test(text)) return { rows: [] };
    if (/CROSS JOIN LATERAL \(SELECT action, at FROM acts/.test(text)) return { rows: [] };
    if (/^SELECT max\(id\)::text AS hw FROM acts$/.test(text)) return { rows: [{ hw: null }] };
    if (/^SELECT action, at, at_anchor, at_dx, at_dy FROM acts WHERE actor = \$1/.test(text))
      return { rows: [{ action: "say", at: new Date(Date.now() - 4 * 60000), at_anchor: KOGANE_PARCEL, at_dx: 0, at_dy: 0 }] };
    if (/FROM acts WHERE id > \$1::bigint AND action = ANY/.test(text)) return { rows: [] };
    if (/FROM acts WHERE action = ANY\(\$1::text\[\]\) ORDER BY acts\.id DESC/.test(text)) return { rows: [] };
    if (/^SELECT handle, household FROM identities/.test(text)) return { rows: [] };
    throw new Error(`the record was asked something it does not answer: ${text.slice(0, 160)}`);
  } });
});
after(() => {
  __setPoolForTest(null);
  for (const [k, v] of Object.entries(saved)) setEnv(k, v);
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const strip = (a) => { const { cursor, ...rest } = a; return rest; }; // a cursor is minted from the clock; nothing else varies
const BLOCKS = ["now", "view", "who", "heard"];

test("a coordinate: the four blocks of the v2 read, at that point, and nothing else of the caller's", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const a = await worldApex({ at: "0,0" }, null, {});
  assert.equal(a.error, undefined, JSON.stringify(a).slice(0, 200));
  assert.equal(a.read_shape, "v2");
  for (const b of BLOCKS) assert.ok(b in a, `${b} is answered`);
  assert.deepEqual({ x: a.at.x, y: a.at.y, query: a.at.query }, { x: 0, y: 0, query: "0,0" }, "the frame the look was taken in is named");
  assert.match(a.at.as, /nobody/);
  for (const absent of ["can", "you", "cards", "law", "cursor", "more", "within", "nearby", "actions", "handle", "standpoint"])
    assert.ok(!(absent in a), `a look as nobody carries no ${absent}`);
  assert.ok(Object.keys(a.view).length > 0, "the town centre's own view is not empty");
  assert.ok(JSON.stringify(a).length < 10_000, `the bare-read ceiling (~10K) holds: ${JSON.stringify(a).length}`);
});

test("x,y spells: a spaced pair, negatives and decimals, and an object with x and y", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const base = strip(await worldApex({ at: "220,95" }, null, {}));
  for (const at of ["220, 95", " 220 95 ", "220.0,95.0", { x: 220, y: 95 }, { x: "220", y: "95" }])
    assert.deepEqual(strip(await worldApex({ at }, null, {})).view, base.view, `${JSON.stringify(at)} looks at the same point`);
  const neg = await worldApex({ at: "-100.5, -40" }, null, {});
  assert.deepEqual([neg.at.x, neg.at.y], [-100.5, -40]);
  const bad = await worldApex({ at: { x: "far", y: 1 } }, null, {});
  assert.equal(bad.error, "bounce");
  assert.equal(bad.view, undefined, "an unusable object is refused, never read from the origin");
});

test("a place name resolves as find: does, to that mark's own point; an id works too", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const byName = await worldApex({ at: "the town centre" }, null, {});
  assert.equal(byName.error, undefined, JSON.stringify(byName).slice(0, 240));
  assert.equal(byName.at.mark.id, "the-town/the-town-centre");
  const byId = await worldApex({ at: "the-town/the-town-centre" }, null, {});
  assert.deepEqual([byId.at.x, byId.at.y], [byName.at.x, byName.at.y]);
  const atCoords = await worldApex({ at: `${byName.at.x},${byName.at.y}` }, null, {});
  assert.deepEqual(strip(atCoords).view, strip(byName).view, "the name's look is the coordinate's look at that mark's point");
  assert.ok(byName.at.here, "the look says where it stands, in the read's own words");
});

test("an unknown or ambiguous place answers find:'s hits and no guessed location", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const none = await worldApex({ at: "a place nobody ever named qzxv" }, null, {});
  assert.equal(none.error, "bounce");
  assert.equal(none.found.matches, 0);
  for (const b of BLOCKS) assert.ok(!(b in none), `no ${b}: nothing was looked at`);
  const many = await worldApex({ at: "house" }, null, {});
  assert.equal(many.error, "bounce");
  assert.ok(many.found.matches > 1, "a word several marks carry is ambiguous");
  assert.ok(many.found.hits.length > 1 && many.found.hits.every((h) => h.at), "the hits name the candidates with their points");
  for (const b of BLOCKS) assert.ok(!(b in many), `no ${b}: nothing was looked at`);
});

test("it is nobody: a keyed caller gets the keyless answer, never their own home, handle or standing", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const own = await worldApex({ handle: WHO }, KEY, {});
  assert.ok(own.within || own.you, "the caller's own bare read is untouched and is theirs");
  const far = "5000,5000";
  const keyed = await worldApex({ at: far }, KEY, {}), keyless = await worldApex({ at: far }, null, {});
  assert.deepEqual(strip(keyed), strip(keyless), "the key changes nothing: the look is taken as nobody");
  assert.equal(keyed.at.x, 5000);
  assert.ok(!JSON.stringify(keyed).includes(`"${WHO}"`), "the caller's own handle is nowhere in the look: not in who, not standing, not named");
  assert.notDeepEqual(strip(keyed).view, strip(own).view, "the actor's home view is not mixed into the requested one");
});

test("nothing is recorded: the look asks the record only to read", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  SEEN.length = 0;
  await worldApex({ at: "the town centre" }, KEY, {});
  await worldApex({ at: "10,10" }, KEY, {});
  assert.ok(SEEN.length > 0, "the look did read the record (so this is a real control)");
  for (const s of SEEN) assert.doesNotMatch(s, /^\s*(insert|update|delete|create|alter|drop|truncate|merge|upsert)\b/i, `a write: ${s.slice(0, 140)}`);
});

test("it stands alone: no act, no shadow, no focus, no other standpoint, no other shape rides with it", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  for (const extra of [{ do: "say", args: { text: "hi" } }, { read: "say" }, { read: "view" }, { mark: "the-town/the-town-centre" }, { find: "snug" }, { investigate: "kogane" },
    { handle: WHO }, { as: "human" }, { beside: WHO }, { lens: "outsider" }, { cards: "names" }, { telling: true }, { diagnostics: true }, { since: "c1.1.2." }, { crossing: 3 }]) {
    const r = await worldApex({ at: "10,10", ...extra }, KEY, {});
    assert.equal(r.error, "bounce", `${JSON.stringify(extra)} is refused with at:`);
    for (const b of BLOCKS) assert.ok(!(b in r), `${JSON.stringify(extra)}: nothing was read`);
  }
  const doing = await worldApex({ at: "10,10", do: "say" }, KEY, {});
  assert.match(doing.defect, /embodied/, "an act from a named place is the spectator decouple's own refusal");
  assert.equal((await worldApex({ at: "10,10", read_shape: "v1" }, KEY, {})).error, "bounce", "the look is v2 only");
  assert.equal((await worldApex({ at: "10,10", read_shape: "v2" }, KEY, {})).error, undefined, "v2 is its own shape");
  assert.equal((await worldApex({ at: "" }, KEY, { })).error, undefined, "an empty at: is no at: (the caller's own read)");
});

test("an action's own args.at is that action's field; the ordinary calls and the REST read are as they were", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // an act that carries its own `at` inside args is dispatched as it always was, never taken for a look
  const act = await worldApex({ handle: WHO, do: "a-verb-that-does-not-exist", args: { at: { x: 1, y: 2 } } }, KEY, {});
  assert.equal(act.error, "bounce");
  assert.doesNotMatch(String(act.defect), /stands alone|look as nobody/, "args.at is not the look's at:");
  assert.equal(act.view, undefined);
  // the REST page read (x, y, no key) and the caller's own read answer as they did: an at: touches neither
  const rest = await worldApex({ x: 0, y: 0 }, null, {});
  assert.ok(rest.within && rest.nearby, "GET /world/apex?x=&y= still answers the v0 read");
  assert.ok(!("at" in rest), "the REST read carries no look frame");
  const decoupled = await worldApex({ x: 0, y: 0, do: "say" }, null, {});
  assert.equal(decoupled.error, "bounce", "a do: from a coordinate is still the decouple's refusal");
  assert.match(decoupled.defect, /embodied/);
});

test("the door declares at:, and takes it through the closed schema", () => {
  const spec = APEX_TOOL.inputSchema.properties.at;
  assert.ok(spec, "at: is a field of the world verb");
  assert.match(spec.description, /nobody/);
  assert.match(spec.description, /no can/);
  assert.equal(validateArgs(APEX_TOOL, { at: "the town centre" }), null);
  assert.equal(validateArgs(APEX_TOOL, { at: { x: 1, y: 2 } }), null);
  assert.equal(typeof spectatorLook, "function");
});
