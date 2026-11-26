// door-class.test.mjs — A DOOR IS THE TOWN'S, AT THE OFFICE'S OWN LEAVE AND AMEND (POS-1238; WLD-253, CORE-129 layer 1).
//
// Wright, POS-1238: "the class gate does the work"; "they refuse into, lands_at and requires on any other class, by name"; "an ordinary
// amend of any mark never deletes or rewrites a door's fields"; "explain names door as the town's". And: "No new carrier in layer 1:
// refuse destination writes by name, and preserve an existing entry on amendment, with no new write surface for the welcome words."
//
// THE WORLD'S OWN LAW AND GRAPH, NOT A STAND-IN. The suite's pinned world clone predates World #444, so the throwaway world below is the
// pinned clone's tools with the LANDED door law laid over them (test/fixtures/world-door-law-b775: tools/door-law.mjs and its imports, byte
// for byte from b775f797, held to the manifest's sha256), loaded by the office's own worldToolModule exactly as production loads it. The
// class layer is the landed Keeping Works chain (postmark-node, mark, sited, thing, door and their properties), read by the office's own
// law-ingest (deriveLaw) into the law snapshot the makers gate already reads. Nothing here is a permissive helper: the verdict, the field
// spellings and the 44 are the World's.
//
// Every resident, house and mark is INVENTED except the one re-kinded door, whose id is the World's own (wright/spire-servants-door, one of
// the 44), with invented geometry.
//
//   D0  the seed is the landed World, byte for byte
//   D1  the graph: the office's class layer declares door under sited with makers false, and thing's entry none; a layer without door is
//       unread, and refuses only a write that touches a door
//   D2  THE LEAVE DOOR REFUSES BY NAME, before the permissive filter could drop the field: into, lands_at and requires on a thing, in any
//       spelling, at the top level, in properties or inside entry; a resident's new door; nothing written
//   D3  THE RE-KINDED DOOR: its maker's amend of its words lands (the makers gate does not refuse an unchanged door) and the written record
//       keeps into, lands_at and entry; changing where it leads, or making it no longer a door, is refused by name, the 44 no exception
//   D4  the town (the operator acting as the town) may change a door; a resident whose handle spells the town is a resident
//   D5  EVERY AMEND KEEPS AN ENTRY: a mark's welcome word survives an amend that sends none, on the journal road and the git road
//   D6  explain names door, and what extends it, as the town's
//   D7  (the FIX at b4b43884) the makers exemption is a door amended into its own door class only: a gate re-classed as a town-only
//       vault meets the makers gate
//   D8  an unread answer never erases a class it cannot place (a gate amended to a bare sited mark); a known non-door still passes
//   D9  a live layer that cannot be read is the record unreachable (503), never "no draft" judged against canon
//
//   node --import ./test/helpers/sparse-guard.mjs --import ./test/helpers/town-pins-env.mjs --test --test-concurrency=1 test/door-class.test.mjs

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { tempDir } from "./helpers/temp-dir.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { markRecord } from "../src/mark-record.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, "fixtures", "world-door-law-b775");
const MANIFEST = JSON.parse(readFileSync(join(SEED, "MANIFEST.json"), "utf8"));
const WORLD = worldClone();
const SKIP = (!WORLD && NO_WORLD) || false;

// ── the throwaway world: the pinned tools, the landed door law over them, the landed class chain, and three instance marks ───────────
const DOOR = { id: "wright/spire-servants-door", by: "wright", slug: "spire-servants-door", kind: "door", at: { x: 400, y: 300 }, extent: { w: 2, h: 2 },
  into: "wright/a-back-stair", lands_at: { x: 404, y: 300 }, entry: { word: "welcomed" }, body: "A narrow door for the servants, painted green." };
const TOWN_DOOR = { id: "the-town/the-quay-gate", by: "the-town", slug: "the-quay-gate", kind: "door", at: { x: 500, y: 300 }, extent: { w: 2, h: 2 },
  into: "the-town/the-quay", body: "The quay gate." };
const GATE = { id: "dw/a-garden-gate", by: "dw", slug: "a-garden-gate", kind: "sited", at: { x: 600, y: 300 }, extent: { w: 2, h: 2 },
  entry: { word: "welcomed", terms: "close it behind you" }, body: "A low garden gate." };
// THE FIX AT b4b43884: a resident's mark of an invented town subclass of door (`gate`, extends door, makers true) with no door
// fields, and a thing, for the class-leaving amends (the classes are published only in the legs that need them)
const WICKET = { id: "dw/a-wicket", by: "dw", slug: "a-wicket", kind: "gate", at: { x: 800, y: 300 }, extent: { w: 2, h: 2 }, body: "A wicket in the hedge." };
const STOOL = { id: "dw/a-stool", by: "dw", slug: "a-stool", kind: "thing", at: { x: 850, y: 300 }, extent: { w: 1, h: 1 }, body: "A three-legged stool." };
const ROOT = { id: "the-town/let-there-be-light", by: "the-town", slug: "let-there-be-light", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 320000, h: 320000 } };

const repo = tempDir("pos1238-door-class-");
let store = null;
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN", "W2_GUARDS", "WORLD_CLONE", "WORLD_SINGLE_LOG", "WORLD_POOL", "TOWN_CLONE", "TOWN_PUSH", "BOT_NAME", "BOT_EMAIL"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
if (!SKIP) {
  mkdirSync(join(repo, "tools"), { recursive: true });
  for (const f of readdirSync(join(WORLD, "tools")).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")))
    copyFileSync(join(WORLD, "tools", f), join(repo, "tools", f));
  for (const p of Object.keys(MANIFEST.files)) { mkdirSync(dirname(join(repo, p)), { recursive: true }); copyFileSync(join(SEED, p), join(repo, p)); }
  for (const m of [DOOR, TOWN_DOOR, GATE, WICKET, STOOL]) {
    const { id: _id, body, ...rec } = m;
    mkdirSync(join(repo, "WORLD", "marks", m.by, m.slug), { recursive: true });
    writeFileSync(join(repo, "WORLD", "marks", m.by, m.slug, "mark.md"), markRecord(rec, body));
  }
  writeFileSync(join(repo, "WORLD", "world-state.json"), JSON.stringify({ tick: 0, dials: {}, marks: [ROOT, DOOR, TOWN_DOOR, GATE, WICKET, STOOL] }));
  copyFileSync(join(WORLD, "WORLD", "skeleton.json"), join(repo, "WORLD", "skeleton.json"));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "add", "-A", "WORLD", "tools"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qm", "the landed door law over a synthetic canon"]);
  store = await startStore({ db: "pos1238_door_class" });
  // THE JOURNAL ROAD, prod's flags (mark-footprint-caps.test.mjs's): D5 also runs the git road, by the flag
  Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), W2_PEN: "mark", W2_GUARDS: "1", WORLD_CLONE: repo, WORLD_SINGLE_LOG: "1",
    WORLD_POOL: "0", TOWN_CLONE: join(repo, "no-town"), TOWN_PUSH: "", BOT_NAME: "fixture", BOT_EMAIL: "fixture@test.invalid" });
}

const { leaveMarkViaOffice } = await import("../src/world.mjs");
const { reloadLawSnapshot, resetLawSnapshot, LAW_REFRESH_SQLS } = await import("../src/law-snapshot.mjs");
const { resetClassRosterCache } = await import("../src/world-classes.mjs");
const dc = await import("../src/door-class.mjs");
after(async () => {
  resetLawSnapshot();
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  await store?.stop();
});

// THE LAW SNAPSHOT, from the landed records by the office's own ingester
const SHA = "b".repeat(40);
let LAW = [];
async function publishLaw(rows) {
  await reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === LAW_REFRESH_SQLS.pin ? [{ newest: 400, pinned: 400 }] : rows }) });
  resetClassRosterCache();
}
if (!SKIP) {
  const { deriveLaw } = await import("../world2/tools/law-ingest.mjs");
  const { rows } = await deriveLaw({ lawRepo: repo });
  LAW = rows.filter((r) => ["class", "predicate", "property"].includes(r.kind)).map((r) => ({ number: 400, tag_sha: SHA, newest: 400, kind: r.kind, key: r.key, data: r.data }));
  await publishLaw(LAW);
}

const WRIGHT = { household: "starforge-fixture", handles: new Set(["wright"]) };
const DW = { household: "dw-fixture", handles: new Set(["dw"]) };
const outcome = async (payload, key, opts) => {
  try { const r = await leaveMarkViaOffice(repo, payload, key, opts); return r?.error ? { code: r.code, defect: String(r.defect) } : { landed: r }; }
  catch (e) { return { code: e.code, defect: String(e.defect ?? e.message), hint: e.hint }; }
};
const actsFor = async (id) => {
  const { default: pg } = await import("pg");
  const c = new pg.Client({ connectionString: store.url("office_api") });
  await c.connect();
  try { return (await c.query("SELECT payload FROM acts WHERE object = $1 ORDER BY id", [id])).rows.map((r) => r.payload); }
  finally { await c.end(); }
};
let n = 0;
const thing = (over = {}) => ({ slug: `a-crate-${++n}`, kind: "thing", at: { x: 700 + n, y: 300 }, extent: { w: 1, h: 1 }, body: "A crate.", by: "dw", ...over });

// ── D0 ──────────────────────────────────────────────────────────────────────

test("D0 · the seed is World b775f797's own door law and class chain, byte for byte", { skip: SKIP }, () => {
  assert.equal(MANIFEST.sha, "b775f7975fe221ab2377d1260a22366a0033a500");
  for (const [p, want] of Object.entries(MANIFEST.files))
    assert.equal(createHash("sha256").update(readFileSync(join(SEED, p))).digest("hex"), want, `${p} is not the landed file`);
  assert.equal(Object.keys(MANIFEST.files).length, 22);
});

// ── D1 ──────────────────────────────────────────────────────────────────────

test("D1 · the office's class layer, as the World's verdict reads it: door under sited, makers false; thing's entry none", { skip: SKIP }, async () => {
  const law = await dc.doorLaw();
  assert.equal(typeof law?.doorWriteVerdict, "function", "the landed module, through the office's own tool loader");
  const g = await dc.officeDoorGraph();
  assert.equal(g.byName.get("door")?.extends, "sited");
  assert.equal(law.isDoorClass("door", g), true);
  assert.equal(law.isDoorClass("thing", g), false);
  assert.equal(law.classHasNoWayIn("thing", g), true, "thing's own entry: none");
  const { mayMake } = await import(pathToFileURL(join(repo, "tools", "admin-makers.mjs")).href);
  assert.deepEqual([mayMake({ klass: "door", by: "dw", marks: g }).may, mayMake({ klass: "thing", by: "dw", marks: g }).may], [false, true]);
});

test("D1 · ALLOWED: NULL IS UNREAD: a layer that does not declare door refuses a write that touches a door, and stops nothing else", { skip: SKIP }, async () => {
  await publishLaw(LAW.filter((r) => !(r.kind === "class" && r.key === "door") && r.data?.class !== "door"));
  try {
    const touched = await outcome(thing({ into: "dw/somewhere" }), DW);
    assert.equal(touched.code, 503);
    assert.match(touched.defect, /the town's door law could not be read/);
    assert.match(touched.hint, /does not declare door yet/);
    const plain = await outcome(thing(), DW);
    assert.ok(plain.landed, `a thing that touches no door is not the door law's to judge: ${plain.defect}`);
    // the verdict itself said null, and null was never read as a yes
    const v = (await dc.doorLaw()).doorWriteVerdict({ by: "dw", before: null, after: { id: "dw/x", kind: "thing", into: "a" }, marks: await dc.officeDoorGraph() });
    assert.deepEqual([v.allowed, v.why], [null, "classes-unread"]);
  } finally { await publishLaw(LAW); }
});

test("D1 · an unreadable door law refuses only a write that names a door (the strict direction)", async () => {
  const r = await dc.doorWriteRefusal({ payload: { into: "x" }, klass: "thing", kind: "sited", id: "dw/x", by: "dw", law: null, graph: null });
  assert.equal(r.refusal.code, 503);
  assert.equal((await dc.doorWriteRefusal({ payload: { body: "words" }, klass: "thing", kind: "sited", id: "dw/x", by: "dw", law: null, graph: null })).refusal, null);
});

// ── D2 ──────────────────────────────────────────────────────────────────────

test("D2 · A DOOR'S FIELDS ON A THING ARE REFUSED BY NAME, in any spelling and wherever they are sent, and nothing is written", { skip: SKIP }, async () => {
  const cases = [
    [{ into: "dw/the-cellar" }, /^into on a thing — into, lands_at and requires are door's alone/],
    [{ lands_at: { x: 1, y: 2 } }, /^lands_at on a thing — /],
    [{ "Lands-At": "dw/the-cellar" }, /^Lands-At on a thing — /],
    [{ requires: { holds: ["dw/a-key"] } }, /^requires on a thing — /],
    [{ properties: { into: "dw/the-cellar" } }, /^into on a thing — /],
    [{ entry: { word: "welcomed", into: "dw/the-cellar" } }, /^entry\.into on a thing — /],
    [{ into: null }, /^into on a thing — /],
  ];
  for (const [over, want] of cases) {
    const p = thing(over);
    const r = await outcome(p, DW);
    assert.equal(r.code, 422, JSON.stringify(over));
    assert.match(r.defect, want, JSON.stringify(over));
    assert.match(r.hint, /Nothing was written\.$/);
    assert.deepEqual(await actsFor(`dw/${p.slug}`), [], `${JSON.stringify(over)}: no act`);
  }
});

test("D2 · THE FILTER WOULD HAVE HIDDEN IT: the same thing without the field lands, so the refusal above is the door law's and not an unknown field's", { skip: SKIP }, async () => {
  const r = await outcome(thing(), DW);
  assert.ok(r.landed, r.defect);
});

test("D2 · a resident's new door is refused (door answers makers: false), with the door law's words", { skip: SKIP }, async () => {
  const r = await outcome({ slug: "my-own-door", kind: "door", at: { x: 900, y: 300 }, extent: { w: 2, h: 2 }, body: "A door of mine.", by: "dw" }, DW);
  assert.equal(r.code, 422);
  assert.match(r.defect, /^a new door — into, lands_at and requires are door's alone, and door answers makers: false/);
  const v = await outcome({ slug: "my-other-door", kind: "door", into: "dw/x", at: { x: 910, y: 300 }, extent: { w: 2, h: 2 }, body: "Another.", by: "dw" }, DW);
  assert.equal(v.code, 422);
});

// ── D3 ──────────────────────────────────────────────────────────────────────

const amendDoor = (over = {}) => ({ slug: DOOR.slug, kind: "door", at: DOOR.at, extent: DOOR.extent, body: "A narrow door for the servants, painted blue now.", by: "wright", amend: true, ...over });

test("D3 · THE RE-KINDED DOOR: its maker's amend of the words lands, and the written record keeps into, lands_at and entry exactly", { skip: SKIP }, async () => {
  const r = await outcome(amendDoor(), WRIGHT);
  assert.ok(r.landed, `an amend that leaves every door field as it was stands (no-door-change): ${r.defect}`);
  const [written] = (await actsFor(DOOR.id)).slice(-1);
  assert.equal(written.body, "A narrow door for the servants, painted blue now.");
  assert.equal(written.kind, "door");
  assert.equal(written.into, DOOR.into, "where it leads is kept");
  assert.deepEqual(written.lands_at, DOOR.lands_at, "where it sets you down is kept");
  assert.deepEqual(written.entry, DOOR.entry, "its entry is kept");
});

test("D3 · changing where the re-kinded door leads, or what it requires, or its class, is refused by name: being one of the 44 grants no write", { skip: SKIP }, async () => {
  const cases = [
    [{ into: "wright/the-wine-cellar" }, /^into of wright\/spire-servants-door — /],
    [{ lands_at: { x: 1, y: 1 } }, /^lands_at of wright\/spire-servants-door — /],
    [{ properties: { requires: { holds: ["wright/a-key"] } } }, /^requires of wright\/spire-servants-door — /],
    // re-classed, the door's kept fields would ride a non-door: the World names them first
    [{ kind: "thing" }, /^into and lands_at on a thing — /],
    [{ kind: "sited" }, /^into and lands_at on a mark of no class — /],
    [{ entry: { into: "wright/the-wine-cellar" } }, /^entry\.into: a door writes into:, lands_at: and requires: as its own fields/],
  ];
  const before = (await actsFor(DOOR.id)).length;
  for (const [over, want] of cases) {
    const r = await outcome(amendDoor(over), WRIGHT);
    assert.equal(r.code, 422, JSON.stringify(over));
    assert.match(r.defect, want, JSON.stringify(over));
  }
  assert.equal((await actsFor(DOOR.id)).length, before, "nothing written");
  // the same value it already has is no change
  assert.ok((await outcome(amendDoor({ into: DOOR.into }), WRIGHT)).landed);
});

// ── D4 ──────────────────────────────────────────────────────────────────────

test("D4 · THE TOWN may change a door: the operator acting as the town, never a by a caller sends", { skip: SKIP }, async () => {
  // a door's own fields arrive as its class's declared properties, the one road any class's properties take
  const town = { slug: TOWN_DOOR.slug, kind: "door", at: TOWN_DOOR.at, extent: TOWN_DOOR.extent, body: "The quay gate, rehung.", by: "the-town", amend: true,
    properties: { into: "the-town/the-new-quay" } };
  const r = await outcome(town, null, { operator: { hand: "fixture-operator", reason: "POS-1238 fixture: the town rehangs its gate", household: "the-town", asTown: true } });
  assert.ok(r.landed, r.defect);
  assert.equal((await actsFor(TOWN_DOOR.id)).slice(-1)[0].into, "the-town/the-new-quay");
  // the same write by a resident who merely NAMES the town is a resident's
  const g = await dc.officeDoorGraph();
  const law = await dc.doorLaw();
  const v = await dc.doorWriteRefusal({ payload: { into: "the-town/the-new-quay" }, before: TOWN_DOOR, klass: "door", kind: "sited", id: TOWN_DOOR.id, by: "the-town", town: false, law, graph: g });
  assert.equal(v.refusal?.code, 422, "a handle that spells the town is not the town");
  assert.equal((await dc.doorWriteRefusal({ payload: { into: "the-town/the-new-quay" }, before: TOWN_DOOR, klass: "door", kind: "sited", id: TOWN_DOOR.id, by: "the-town", town: true, law, graph: g })).refusal, null);
});

// ── D5 ──────────────────────────────────────────────────────────────────────

const amendGate = (over = {}) => ({ slug: GATE.slug, kind: "sited", at: GATE.at, extent: GATE.extent, body: "A low garden gate, oiled.", by: "dw", amend: true, ...over });

test("D5 · EVERY AMEND KEEPS AN ENTRY (the journal road): a mark's welcome word and terms survive an amend that sends none", { skip: SKIP }, async () => {
  const r = await outcome(amendGate(), DW);
  assert.ok(r.landed, r.defect);
  const written = (await actsFor(GATE.id)).slice(-1)[0];
  assert.equal(written.body, "A low garden gate, oiled.");
  assert.deepEqual(written.entry, GATE.entry, "the entry the amend did not send is the prior record's");
  // and an entry it sends is not written (no carrier for the welcome words, layer 1): the prior one stays
  const r2 = await outcome(amendGate({ body: "A low garden gate.", entry: { word: "opposed" } }), DW);
  assert.ok(r2.landed, r2.defect);
  assert.deepEqual((await actsFor(GATE.id)).slice(-1)[0].entry, GATE.entry);
});

test("D5 · EVERY AMEND KEEPS AN ENTRY AND A DOOR'S FIELDS (the git road): the draft file still carries them", { skip: SKIP }, async () => {
  const prev = process.env.WORLD_SINGLE_LOG;
  delete process.env.WORLD_SINGLE_LOG;
  try {
    const d = await outcome(amendDoor({ body: "A narrow door, newly varnished." }), WRIGHT);
    assert.ok(d.landed, d.defect);
    const door = execFileSync("git", ["-C", repo, "show", `draft/${WRIGHT.household}:WORLD/marks/${d.landed.dir}/mark.md`], { encoding: "utf8" });
    assert.match(door, /^into: wright\/a-back-stair$/m, "where it leads is kept");
    assert.match(door, /^lands_at: /m);
    assert.match(door, /^entry: /m);
    assert.match(door, /newly varnished/);
    const g = await outcome(amendGate({ body: "A low garden gate, newly hung." }), DW);
    assert.ok(g.landed, g.defect);
    const gate = execFileSync("git", ["-C", repo, "show", `draft/${DW.household}:WORLD/marks/${g.landed.dir}/mark.md`], { encoding: "utf8" });
    assert.match(gate, /^entry: /m, "the gate's entry is kept");
  } finally { if (prev == null) delete process.env.WORLD_SINGLE_LOG; else process.env.WORLD_SINGLE_LOG = prev; }
});

test("D5 · keptDoorFields, pure: what an amend does not send is kept; what it sends is its own", async () => {
  const law = SKIP ? null : await dc.doorLaw();
  const prior = { id: "x/y", kind: "door", into: "x/z", lands_at: { x: 1, y: 2 }, entry: { word: "welcomed" }, body: "b" };
  assert.deepEqual(dc.keptDoorFields({ body: "new" }, prior, { law }), { entry: { word: "welcomed" }, into: "x/z", lands_at: { x: 1, y: 2 } });
  assert.deepEqual(dc.keptDoorFields({ body: "new", into: "x/z" }, prior, { law }), { entry: { word: "welcomed" }, lands_at: { x: 1, y: 2 } });
  assert.deepEqual(dc.keptDoorFields({ body: "new" }, null, { law }), {});
  assert.deepEqual(dc.keptDoorFields({ body: "new" }, { body: "b" }, { law }), {}, "nothing to keep when the prior carries neither");
});

// ── D6 ──────────────────────────────────────────────────────────────────────

test("D6 · explain names door as the town's, for making and for amending; thing is left as it reads", { skip: SKIP }, async () => {
  const door = await dc.withDoorMakers({ explains: "door", makers: { value: false, from: "door" } });
  assert.match(door.makers.who, /^false: the town's, for making and for amending\. A door's into, lands_at and requires are door's alone/);
  const thingAnswer = { explains: "thing", makers: { value: true, from: "thing" } };
  assert.deepEqual(await dc.withDoorMakers(thingAnswer), thingAnswer);
  // A TOWN SUBCLASS THAT LOOSENS MAKERS keeps its own true answer (the lead's FIX at 6261511d): the writer honours D7's gate,
  // and explain teaches the same law, not a stricter one
  await publishLaw([...LAW, ...GATE_AND_VAULT]);
  try {
    const g = await dc.officeDoorGraph();
    assert.equal((await dc.doorLaw()).isDoorClass("gate", g), true, "control: gate is a door's subclass in this graph");
    const gate = { explains: "gate", makers: { value: true, from: "gate" } };
    assert.deepEqual(await dc.withDoorMakers(gate), gate, "makers: true stays true, with no town-only words");
    const lockedGate = { explains: "gate", makers: { value: false, from: "door", inherited: true } };
    assert.match((await dc.withDoorMakers(lockedGate)).makers.who, /^false: the town's/, "a subclass that inherits door's false is the town's");
  } finally { await publishLaw(LAW); }
});

// ── D7–D9 · THE FIX AT b4b43884 (Rivet's combined FIX; Truey's independent FIX) ───────────────────────────────────────────

// two invented town classes over the landed chain: `gate` extends door and loosens makers (the override rule), `vault` is town-only
const townClass = (key, ext) => ({ number: 400, tag_sha: SHA, newest: 400, kind: "class", key, data: { class: key, extends: ext, id: `the-town/${key}`, by: "the-town", kind: "class" } });
const townMakers = (key, v) => ({ number: 400, tag_sha: SHA, newest: 400, kind: "property", key: `${key}/makers`,
  data: { class: key, parent: null, name: "makers", tier: "constitution", default: v, id: `the-town/${key}-makers` } });
const GATE_AND_VAULT = [townClass("gate", "door"), townMakers("gate", true), townClass("vault", "sited"), townMakers("vault", false)];
const amendWicket = (over = {}) => ({ slug: WICKET.slug, kind: "gate", at: WICKET.at, extent: WICKET.extent, body: "A wicket in the hedge, mended.", by: "dw", amend: true, ...over });

test("D7 · THE MAKERS EXEMPTION IS A DOOR AMENDED INTO ITS OWN DOOR CLASS, nothing wider: a gate re-classed as a town-only vault meets the makers gate", { skip: SKIP }, async () => {
  await publishLaw([...LAW, ...GATE_AND_VAULT]);
  try {
    // the World says no-door-change for leaving the door class when the writer may make the OLD class (its exit branch asks
    // gate's makers only); the target class, vault, is the office's makers gate to judge
    const g = await dc.officeDoorGraph();
    const law = await dc.doorLaw();
    const ask = (klass) => dc.doorWriteRefusal({ payload: { kind: klass }, before: WICKET, klass, kind: "sited", id: WICKET.id, by: "dw", law, graph: g });
    const [same, toThing, toVault] = [await ask("gate"), await ask("thing"), await ask("vault")];
    assert.deepEqual([same.verdict.why, toThing.verdict.why, toVault.verdict.why], ["no-door-change", "no-door-change", "no-door-change"], "the World's own answers, as the review measured them");
    assert.deepEqual([same.doorAmend, toThing.doorAmend, toVault.doorAmend], [true, false, false], "only gate → gate is the door's own amend");
    // THE ROAD: the vault is the town's to make, and the makers gate says so
    const r = await outcome(amendWicket({ kind: "vault" }), DW);
    assert.equal(r.code, 422, `a resident's gate amended into a vault is a vault made by a resident: ${r.defect}`);
    assert.match(r.defect, /^class "vault" is town-only$/);
    assert.deepEqual((await actsFor(WICKET.id)), [], "nothing written");
    // and the gate amended as a gate still lands, and into a thing (makers: true) as before
    assert.ok((await outcome(amendWicket(), DW)).landed);
    assert.ok((await outcome(amendWicket({ kind: "thing", body: "A wicket in the hedge, now just wood." }), DW)).landed);
  } finally { await publishLaw(LAW); }
});

test("D8 · AN UNREAD ANSWER DOES NOT ERASE A CLASS IT CANNOT PLACE: a gate amended to a bare sited mark while the graph cannot say what a gate is refuses (503)", { skip: SKIP }, async () => {
  // the gate class is unknown to this law (as every door class is before the blessing that carries World #444)
  await publishLaw(LAW.filter((r) => !(r.kind === "class" && r.key === "door") && r.data?.class !== "door"));
  try {
    const r = await outcome(amendWicket({ kind: "sited", body: "A gap in the hedge." }), DW);
    assert.equal(r.code, 503, `the target names no class, so no target gate can judge it: ${r.defect}`);
    assert.match(r.hint, /dw\/a-wicket is a gate, which may be a door's subclass/);
    assert.match(r.hint, /amend it keeping the class it has\.$/);
    // a KNOWN non-door leaving its class is not this rule's: the graph proves a thing is no door, whatever door's own state
    const stool = await outcome({ slug: STOOL.slug, kind: "sited", at: STOOL.at, extent: STOOL.extent, body: "A stool, or just a block now.", by: "dw", amend: true }, DW);
    assert.ok(stool.landed, `a thing's chain reaches the root with no door on it: ${stool.defect}`);
  } finally { await publishLaw(LAW); }
  // THE PIN on the named-target side (the independent review's note): a write that NAMES a door's subclass while the graph
  // lacks door is refused by the makers gate's own lineage check (gate's lineage dangles at door), never passed as no door
  await publishLaw([...LAW.filter((r) => !(r.kind === "class" && r.key === "door") && r.data?.class !== "door"), ...GATE_AND_VAULT]);
  try {
    const named = await outcome({ slug: "another-wicket", kind: "gate", at: { x: 820, y: 300 }, extent: { w: 2, h: 2 }, body: "Another wicket.", by: "dw" }, DW);
    assert.equal(named.code, 503);
    assert.match(named.defect, /^who may make a "gate" could not be read$/);
  } finally { await publishLaw(LAW); }
  // with the World's law unreadable too, the same transition is unread, and a known non-door still passes
  const g = await dc.officeDoorGraph();
  const unreadable = await dc.doorWriteRefusal({ payload: { kind: "sited" }, before: WICKET, klass: undefined, kind: "sited", id: WICKET.id, by: "dw", law: null, graph: g });
  assert.equal(unreadable.refusal?.code, 503, "gate is not in this graph, so it is not proved no door");
  assert.equal((await dc.doorWriteRefusal({ payload: { kind: "sited" }, before: STOOL, klass: undefined, kind: "sited", id: STOOL.id, by: "dw", law: null, graph: g })).refusal, null);
  // a parcel amended as a parcel keeps its class: the leave door keeps `parcel` as a standing kind, and both sides are read alike
  const parcel = { id: "dw/a-plot", by: "dw", slug: "a-plot", kind: "parcel", at: { x: 900, y: 900 } };
  assert.equal((await dc.doorWriteRefusal({ payload: { kind: "parcel" }, before: parcel, klass: undefined, kind: "parcel", id: parcel.id, by: "dw", law: null, graph: null })).refusal, null);
});

test("D9 · A LIVE LAYER THAT CANNOT BE READ IS THE RECORD UNREACHABLE (503), never a mark with no draft judged against canon", { skip: SKIP }, async () => {
  const { useGuardReader } = await import("../src/world2-guards.mjs");
  const undo = useGuardReader(async () => { throw new Error("the store is down (fixture)"); });
  try {
    // judged against canon, this would be the door law's 422 (into of the door); the read failed, so nothing is judged
    const r = await outcome(amendDoor({ properties: { into: "wright/the-wine-cellar" } }), WRIGHT);
    assert.equal(r.code, 503, `${r.defect}`);
    assert.match(r.defect, /^the office's record cannot be reached/);
  } finally { undo(); }
  assert.equal((await outcome(amendDoor({ properties: { into: "wright/the-wine-cellar" } }), WRIGHT)).code, 422, "control: with the record readable, the door law answers");
});
