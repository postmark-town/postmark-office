// interior-sweep.test.mjs — WLD-74: NOTHING inside a dungeon reaches anyone who has not entered it.
//
// RULED (Darko, 2026-10-26 13:45 and 13:54 EDT): "there needs to be no visibility whatsoever. Zero paths through
// the office that reveal a creature that is within a dungeon's room unless you too are within that dungeon's room",
// and "there is NOTHING inside the dungeon you can see" until a way in is found.
//
// This sweep drives every route the audit table in the PR names, from OUTSIDE the dungeon (a keyless reader, or a
// resident who exited it) and from a NEIGHBOURING room, and reads each answer whole: no interior mark id, name or
// body, no creature id, name or kind, and no label naming a room, may appear in it. The control in each case is the
// reader who ENTERED the room, who must still see it (a sweep that hides everything proves nothing).
//
// The fixture is invented: a keep (a dungeon) with a hall and a vault, a statue in the hall, a wolf standing in the hall.

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import * as apex from "../world2/tools/apex-reads.mjs";
import { LivingSet, loadCreatureLaw, reactTo, ringRosterNow } from "../src/creatures.mjs";
import { creaturePairs, worldCreature } from "../src/creature-verbs.mjs";
import { worldEncounter, encounterPairs } from "../src/encounter-verbs.mjs";
import { creaturesForRead, creaturesInWho, creatureHappening, creatureToYou, findCreatures, investigateCreature } from "../src/creatures-read.mjs";
import { __setOccupancyForTest } from "../src/creature-sight.mjs";
import { NO_WORLD, worldClone, worldModuleUrl } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);
process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL ??= "postgres://interior-sweep/none";

// ── the world: rows as the store holds them ─────────────────────────────────
const row = ({ id, slug, kind = "sited", owner, body = "", at = null, extent = null, data = {}, parent = null }) => ({
  id, slug, kind, owner, household: `solo:${owner}`, body,
  geometry: at ? { at, ...(extent ? { extent } : {}) } : null, data, status: "standing", parent,
});
const KEEP = "fortholders/the-fort", HALL = "fortholders/the-great-room", VAULT = "fortholders/the-cellar", STATUE = "fortholders/the-statue", GATE = "fortholders/the-gatehouse";
const ROWS = [
  row({ id: "u0", slug: "the-town/let-there-be-light", owner: "the-town", body: "the light", at: { x: 0, y: 0 }, extent: { w: 320000, h: 320000 }, data: { tier: "constitution", date: "2026-07-22" } }),
  row({ id: "u1", slug: KEEP, owner: "fortholders", body: "a fort with rooms inside it", at: { x: 2000, y: 2000 }, extent: { w: 400, h: 400 }, data: { tier: "market", date: "2026-09-01", class: "dungeon" } }),
  row({ id: "u2", slug: HALL, owner: "fortholders", body: "the great room of the fort", at: { x: 2000, y: 2000 }, extent: { w: 60, h: 60 }, data: { tier: "market", date: "2026-09-02" } }),
  row({ id: "u3", slug: VAULT, owner: "fortholders", body: "the cellar of the fort", at: { x: 2150, y: 2150 }, extent: { w: 60, h: 60 }, data: { tier: "market", date: "2026-09-02" } }),
  row({ id: "u4", slug: STATUE, owner: "fortholders", body: "a statue standing in the great room", at: { x: 2005, y: 2005 }, extent: { w: 2, h: 2 }, data: { tier: "market", date: "2026-09-03" } }),
  row({ id: "u5", slug: "townsfolk/a-bench", owner: "townsfolk", body: "a bench in the open", at: { x: 100, y: 100 }, extent: { w: 2, h: 1 }, data: { tier: "market", date: "2026-09-03" } }),
];
const INTERIOR = [HALL, VAULT, STATUE];
const HALL_AT = { x: 2000, y: 2000 };
const LAW_SHA = "a23a8d174776db4d325631a3b9ecf9380cecb722";
let SKELETON = null, WHY = null;
const RESIDENT_CLASS = { kind: "class", key: "resident", path: "WORLD/marks/the-town/resident/mark.md", data: {
  id: "the-town/resident", kind: "class", by: "the-town", household: "the-town", tier: "constitution", date: "2026-08-09", parent: "the-town/entity",
  class: "resident", class_version: 3, ambient: "true", dials: { pace_km_per_crossing: 60 }, body: "A household's living voice.",
  actions: [{ action: "say", residue: "the-town/say" }, { action: "walk", residue: "the-town/depart" }] } };
function pool() {
  return { query: async (sql) => {
    if (/FROM windows/i.test(sql)) return { rows: /status = 'open'/.test(sql) ? [] : [{ id: 194, law_sha: LAW_SHA }] };
    if (/FROM projection_heads/i.test(sql)) return { rows: [{ sha: LAW_SHA }] };
    if (/FROM law_projection/i.test(sql)) return { rows: [...(SKELETON ?? []), RESIDENT_CLASS] };
    if (/FROM marks WHERE slug/i.test(sql)) return { rows: [] };
    if (/FROM marks/i.test(sql)) return { rows: ROWS };
    return { rows: [] };
  } };
}
let world2Serve = null, world2Apex = null;
nodeTest.before(async () => {
  try {
    const clone = worldClone();
    const branches = await import("../src/world-branches.mjs");
    const ref = branches.freshestMainRef(clone);
    const doc = JSON.parse(execFileSync("git", ["-C", clone, "show", `${ref}:WORLD/skeleton.json`], { encoding: "utf8", maxBuffer: 64 << 20 }));
    SKELETON = Object.entries(doc).map(([key, data]) => ({ kind: "skeleton", key, path: "WORLD/skeleton.json", data }));
    ({ world2Serve, world2Apex } = await import("../src/world2-serve.mjs"));
  } catch (e) { WHY = String(e?.message ?? e); }
});

/** What must never appear in any answer to a reader who has not entered the keep's rooms. */
const SECRETS = [...INTERIOR, "the great room of the fort", "the cellar of the fort", "a statue standing in the great room", "The Great Room", "The Cellar", "The Statue",
  "creature:wolf-1", "grey wolf", "wolf"];
/** What an answer names beyond the asker's own words: a refusal may quote the id it was asked about, and nothing else. */
const leaks = (answer, asked = null) => { const s = (asked ? JSON.stringify(answer).split(asked).join("") : JSON.stringify(answer)); return SECRETS.filter((x) => s.includes(x)); };

// ── the store's keyless routes ──────────────────────────────────────────────

test("keyless store routes list nothing inside the keep: marks (placed, all, full), mark, investigate, and the apex read from the hall's own spot", async (t) => {
  if (WHY) return t.skip(WHY);
  const p = pool();
  for (const q of ["", "?all=true", "?full=true", "?all=true&full=true"]) {
    const r = await world2Serve("/world2/marks", new URLSearchParams(q), { p });
    assert.equal(r.code, 200);
    const slugs = r.body.marks.map((m) => m.slug);
    assert.ok(slugs.includes(KEEP), `the keep itself is a mark (${q})`);
    assert.ok(slugs.includes("townsfolk/a-bench"), "the open ground is untouched");
    assert.deepEqual(slugs.filter((s) => INTERIOR.includes(s)), [], `/world2/marks${q}`);
    assert.deepEqual(leaks(r.body.marks).filter((x) => !x.startsWith("creature") && x !== "wolf" && x !== "grey wolf"), [], "no interior body either");
  }
  const unknown = await world2Serve("/world2/mark", new URLSearchParams({ slug: "nobody/never-was" }), { p: { query: async () => ({ rows: [] }) } });
  for (const slug of INTERIOR) {
    const pi = { query: async (sql, args) => (/FROM marks WHERE slug/i.test(sql) ? { rows: ROWS.filter((r) => r.slug === args[0]) } : pool().query(sql, args)) };
    const r = await world2Serve("/world2/mark", new URLSearchParams({ slug }), { p: pi });
    assert.equal(r.code, 404, `/world2/mark?slug=${slug}`);
    assert.deepEqual(r.body, { error: "bounce", defect: `no mark "${slug}"` }, "the words of a mark that was never there");
    assert.deepEqual(leaks(r.body, slug), [], "a refusal quotes only what was asked");
    const inv = await world2Serve("/world2/investigate", new URLSearchParams({ mark: slug }), { p });
    assert.equal(inv.code, 404, `/world2/investigate?mark=${slug}`);
    assert.deepEqual(leaks(inv.body, slug), [], "only the asker's own word comes back");
  }
  assert.equal(unknown.code, 404);
  const keep = await world2Serve("/world2/investigate", new URLSearchParams({ mark: KEEP }), { p });
  assert.equal(keep.code, 200, "the keep itself is investigable, as a mark with nothing inside it");
  // the keyless apex, from the hall's own spot and from over the vault
  for (const at of [HALL_AT, { x: 2150, y: 2150 }, { x: 2005, y: 2005 }]) {
    const r = await world2Apex(new URLSearchParams({ x: String(at.x), y: String(at.y), crossing: "1" }), { p });
    assert.ok(!r.error, JSON.stringify(r.error?.body));
    assert.deepEqual(leaks(r.body), [], `/world2/apex at ${at.x},${at.y} names nothing inside`);
    assert.ok(r.body.within.some((m) => m.id === KEEP), "it stands in the keep, which is all of it a stranger may name");
  }
});

// ── the labels: where a spot is, to whom ─────────────────────────────────────

test("a label names a room only to one who entered it: the same spot reads as the keep from outside and from a neighbouring room", async () => {
  const { bothWords, sightedWorld } = await import("../src/world.mjs");
  const verbs = await import(worldModuleUrl("tools", "world-verbs.mjs"));
  const marks = ROWS.map((r) => ({ id: r.slug, by: r.owner, household: r.owner, kind: "sited", tier: "market", at: r.geometry.at, extent: r.geometry.extent, body: r.body,
    ...(r.data.class ? { class: r.data.class } : {}), date: "2026-09-02T00:00:00Z" }));
  const both = bothWords({ marks }, HALL_AT, verbs);
  assert.match(both.inside, /Great Room/, "the whole world names the hall");
  assert.doesNotMatch(both.outside, /Great Room|Cellar|Statue/i, "the shared label never does");
  assert.match(both.outside, /Fort/i, "it names the keep");
  // the one who entered the hall is told its name; one who entered the vault is not told the hall's
  const named = (stack) => { const w = sightedWorld({ marks }, { verbs, handle: "ann", stack }); const { placeWordsFrom } = import.meta; return w.marks.map((m) => m.id); };
  assert.ok(named([KEEP, HALL]).includes(HALL));
  assert.ok(!named([KEEP, VAULT]).includes(HALL), "a neighbouring room hides the hall");
  assert.ok(!named([]).includes(HALL));
  void pathToFileURL;
});

// ── the creatures: every reader and every door ───────────────────────────────

const LAW_DIR = "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/entity/creature";
const lawRecords = async () => {
  const { parseRecord } = await import(worldModuleUrl("tools", "marks-fold.mjs"));
  const root = join(worldClone(), LAW_DIR);
  return readdirSync(root, { recursive: true }).map(String).filter((p) => /(^|[\\/])mark\.md$/.test(p))
    .map((p) => parseRecord(readFileSync(join(root, p), "utf8"), `${LAW_DIR}/${p}`));
};
const LAW = NO_WORLD ? null : await loadCreatureLaw({ ref: "the pinned clone", importTool: (f) => import(worldModuleUrl("tools", f)),
  readText: (path) => readFileSync(join(worldClone(), path), "utf8"), lawRecords });
const { occupancyAt } = NO_WORLD ? {} : await import(worldModuleUrl("tools", "enter-exit.mjs"));
const ledger = (rows) => occupancyAt(rows.map(([handle, act, mark, at]) => ({ handle, act, mark, at })), Infinity);
const NOW = Date.parse("2026-10-26T17:40:00Z");
const iso = (ms) => new Date(ms).toISOString();
const WOLF = "creature:wolf-1";
const HALL_MARK = { id: HALL, at: HALL_AT, extent: { w: 60, h: 60 } };
const livingWith = () => {
  const l = new LivingSet({ law: LAW }).fold([{ id: "1", at: iso(NOW - 3600_000), actor: "the-town", action: "spawn", object: WOLF,
    payload: { kind: "wolf", at: iso(NOW - 3600_000), fades_at: iso(NOW + 12 * 3600_000), x: 2000, y: 2000 } }]);
  l.byId.get(WOLF).room = HALL_MARK;
  // a record of it answering someone, which no outsider's read may quote
  l.fold([{ id: "2", at: iso(NOW - 60_000), actor: WOLF, action: "react", object: "70", payload: { to: "ann", verb: "walk", reaction: "stalk", roll: 3 } }], { advance: false });
  return l;
};
const OUTSIDE = ledger([["ann", "enters", KEEP, 1], ["ann", "exits", KEEP, 2]]);
const NEXT_DOOR = ledger([["ann", "enters", KEEP, 1], ["ann", "enters", VAULT, 2]]);
const INSIDE = ledger([["ann", "enters", KEEP, 1], ["ann", "enters", HALL, 2]]);
const KEY = { handles: new Set(["ann"]), household: "hh:ann" };
const creatureSecrets = (a) => { const s = JSON.stringify(a).split("creature:wolf-1").join(a?.code === 404 ? "" : "creature:wolf-1"); return ["creature:wolf-1", "grey wolf", "wolf", "stalk"].filter((x) => s.includes(x)); };

async function everyCreatureRoute(occupancy, label) {
  const living = livingWith();
  const cur = await creaturesForRead({ hook: { living, law: LAW }, as: "ann", occupancy });
  const seen = cur.living;
  const out = {
    "find: creature": findCreatures({ living: seen, law: LAW }, "creature", HALL_AT, { nowMs: NOW }),
    "find: wolf": findCreatures({ living: seen, law: LAW }, "wolf", HALL_AT, { nowMs: NOW }),
    "who": creaturesInWho({ living: seen, law: LAW }, HALL_AT, { nowMs: NOW, radiusM: 100_000 }),
    "happening_here": creatureHappening({ living: seen, law: LAW }, HALL_AT, { nowMs: NOW }),
    "to_you": creatureToYou({ living: seen, law: LAW }, "ann", { sinceMs: NOW - 3600_000, nowMs: NOW }),
    "matrix / can": creaturePairs({ here: HALL_AT, living: seen, law: LAW, now: NOW, env: { TYPESAFE_API_KEY: "k" } }),
    "encounter matrix": encounterPairs({ here: HALL_AT, actor: "ann", living: seen, law: LAW, residents: [], now: NOW }),
    "investigate: creature": await investigateCreature(WOLF, { creatures: cur, from: HALL_AT, rows: async () => [{ id: "2", at: iso(NOW - 60_000), object: "70", payload: { to: "ann", verb: "walk", reaction: "stalk", roll: 3 } }], saved: () => ({ row: { kind: "wolf" } }), nowMs: NOW }),
  };
  const deps = (l) => ({ now: () => NOW, clock: () => NOW, env: { TYPESAFE_API_KEY: "k" }, freeze: () => null, creatures: async () => ({ living: l, law: LAW }),
    standpoint: async () => HALL_AT, carryingConsumable: async () => false, write: async () => ({ actId: "9", written_at: iso(NOW) }), say: async () => ({}),
    answer: async () => [], others: async () => [], roster: async () => [] });
  for (const verb of ["watch", "approach", "shoo", "call", "offer", "whisper"]) {
    out[`do: ${verb}`] = await worldCreature({ act: verb, creature: WOLF, words: "hi", kind: "x" }, KEY, deps(livingWith())).then((r) => r, (e) => ({ code: e.code, defect: e.defect, hint: e.hint }));
  }
  for (const verb of ["strike"]) out[`do: ${verb}`] = await worldEncounter({ act: verb, creature: WOLF }, KEY, deps(livingWith())).then((r) => r, (e) => ({ code: e.code, defect: e.defect, hint: e.hint }));
  const wrote = [];
  out["the hook: a walk onto its spot"] = await reactTo({ actor: "ann", verb: "walk", actId: "7", atIso: iso(NOW), point: HALL_AT },
    { living: livingWith(), law: LAW, occupancy, env: { TYPESAFE_API_KEY: "k" }, now: NOW, clock: () => NOW, around: async () => ({}), heardFor: async () => null,
      ask: async () => ({ response: { answers: { reaction: { probabilities: { stalk: 1 } } } } }), write: async (rows) => { wrote.push(...rows); return { prior: false, rows: rows.map((r, i) => ({ id: String(8000 + i), ...r, at: r.written_at })) }; } });
  out["the hook: rows written"] = wrote;
  out["the ring and the pack"] = await ringRosterNow(livingWith().byId.get(WOLF), { law: LAW, living: livingWith(), now: NOW,
    present: async () => ({ residents: [{ handle: "ann", distance_m: 0, at: HALL_AT }] }), households: async () => (h) => ({ key: `solo:${h}` }) }).catch(() => []);
  return { out, label };
}

test("from outside, and from a neighbouring room, no creature route names the wolf; from inside the hall they do (the control)", async () => {
  __setOccupancyForTest(() => OUTSIDE);
  try {
    for (const [label, occ] of [["exited the keep", OUTSIDE], ["in the vault", NEXT_DOOR]]) {
      __setOccupancyForTest(() => occ);
      const { out } = await everyCreatureRoute(occ, label);
      for (const [route, answer] of Object.entries(out)) {
        const said = creatureSecrets(answer);
        assert.deepEqual(said, [], `${label}: ${route} named ${JSON.stringify(said)}: ${JSON.stringify(answer).slice(0, 200)}`);
      }
      for (const verb of ["watch", "approach", "shoo", "call", "offer", "whisper", "strike"])
        assert.equal(out[`do: ${verb}`]?.code, 404, `${label}: do: ${verb} is refused as no creature`);
      assert.deepEqual(out["the hook: rows written"], [], `${label}: the hook wrote nothing`);
      assert.deepEqual(out["the ring and the pack"], [], `${label}: the ring counts no one`);
    }
    __setOccupancyForTest(() => INSIDE);
    const { out } = await everyCreatureRoute(INSIDE, "in the hall");
    assert.ok(creatureSecrets(out["find: creature"]).length, "the control: one who entered the hall finds the wolf");
    assert.ok(out["matrix / can"].some((p) => p.object === WOLF));
    assert.equal((out["the hook: a walk onto its spot"] ?? []).length, 1);
  } finally { __setOccupancyForTest(null); }
});

// ── the public record of movement: walks, positions, occupancy ───────────────

test("keyless walks and occupancy name no room: a walk's target, its ledger line, and the stacks and manifest", async (t) => {
  if (WHY) return t.skip(WHY);
  const walkRow = { id: 1, at: new Date("2026-10-26T16:42:00Z"), crossing: "300", actor: "ann", action: "walk",
    payload: { from: { x: 1900, y: 2000 }, toward: HALL_AT, within: { w: 60, h: 60 }, to: HALL, pace: 60 } };
  const plainWalk = { id: 2, at: new Date("2026-10-26T16:43:00Z"), crossing: "300", actor: "cy", action: "walk",
    payload: { from: { x: 0, y: 0 }, toward: { x: 100, y: 100 }, within: { w: 2, h: 1 }, to: "townsfolk/a-bench", pace: 60 } };
  const enter = (id, handle, mark, act) => ({ id, at: new Date("2026-10-26T16:30:00Z"), crossing: null, actor: handle, action: act === "enters" ? "legacy:enter" : "legacy:exit",
    payload: { _ledger: "WORLD/enter-exit-ledger.md", iso: "2026-10-26T16:30:00.000Z", handle, act, mark, at: 1, word: "neutral" } });
  const acts = [enter(10, "ann", KEEP, "enters"), enter(11, "ann", HALL, "enters"), enter(12, "bo", KEEP, "enters")];
  const p = { query: async (sql, args) => {
    if (/FROM acts/i.test(sql) && /walk|departure/i.test(JSON.stringify(args ?? []))) return { rows: [walkRow, plainWalk] };
    if (/FROM acts/i.test(sql)) return { rows: acts };
    return pool().query(sql, args);
  } };
  const walks = await world2Serve("/world2/walks", new URLSearchParams(""), { p });
  assert.equal(walks.code, 200, JSON.stringify(walks.body).slice(0, 300));
  assert.deepEqual(leaks(walks.body), [], "/world2/walks");
  assert.ok(!walks.body.walks.some((w) => w.handle === "ann"), "ann entered the great room, so her walk is not on a keyless read at all (and so neither is its target)");
  assert.equal(walks.body.walks.find((w) => w.handle === "cy").to, "townsfolk/a-bench", "an open-ground target is untouched");
  const occ = await world2Serve("/world2/occupancy", new URLSearchParams(""), { p });
  assert.equal(occ.code, 200, JSON.stringify(occ.body).slice(0, 300));
  assert.deepEqual(leaks(occ.body), [], "/world2/occupancy");
  assert.deepEqual(occ.body.inside, {}, "ann (the hall) and bo (the keep itself) have entered, so are inside and not listed");
  assert.deepEqual(occ.body.occupants, {});
  const one = await world2Serve("/world2/occupancy", new URLSearchParams({ handle: "ann" }), { p });
  assert.deepEqual(one.body.stack, []);
});

test("a walker's target mark is dropped when it is inside (the positions and walkers rows), and every one when the interior cannot be told", async () => {
  const { hideInteriorTargets } = await import("../src/world.mjs");
  const rows = [{ handle: "a", mark_id: HALL }, { handle: "b", mark_id: "townsfolk/a-bench" }, { handle: "c", mark_id: null }];
  assert.deepEqual(hideInteriorTargets(rows, new Set([HALL])).map((r) => r.mark_id), [null, "townsfolk/a-bench", null]);
  assert.deepEqual(hideInteriorTargets(rows, null).map((r) => r.mark_id), [null, null, null], "fail closed");
});

// ── a creature whose room is not known yet ───────────────────────────────────

test("a creature whose room is not known yet is hidden from everyone, inside the hall too; known outdoors it is seen again", async () => {
  const mk = () => {
    const l = new LivingSet({ law: LAW, hideUnwarmed: true }).fold([{ id: "1", at: iso(NOW - 3600_000), actor: "the-town", action: "spawn", object: WOLF,
      payload: { kind: "wolf", at: iso(NOW - 3600_000), fades_at: iso(NOW + 12 * 3600_000), x: 2000, y: 2000 } }]);
    return l;
  };
  for (const occ of [OUTSIDE, NEXT_DOOR, INSIDE]) {
    const cur = await creaturesForRead({ hook: { living: mk(), law: LAW }, as: "ann", occupancy: occ });
    assert.ok(!cur.living.byId.has(WOLF), "no room yet, so no one sees it");
    assert.deepEqual(findCreatures({ living: cur.living, law: LAW }, "creature", HALL_AT, { nowMs: NOW }), null);
  }
  const l = mk();
  l.warmRooms([], "sha-1"); // looked up: outdoors
  assert.ok((await creaturesForRead({ hook: { living: l, law: LAW }, as: "ann", occupancy: OUTSIDE })).living.byId.has(WOLF));
  const l2 = mk();
  Object.assign(l2.byId.get(WOLF), { room: HALL_MARK, roomKey: "sha-1" }); // looked up: in the hall
  assert.ok(!(await creaturesForRead({ hook: { living: l2, law: LAW }, as: "ann", occupancy: OUTSIDE })).living.byId.has(WOLF));
  assert.ok((await creaturesForRead({ hook: { living: l2, law: LAW }, as: "ann", occupancy: INSIDE })).living.byId.has(WOLF));
});

// ── a creature just out, before its room is looked up ────────────────────────

test("boot state: a creature whose room is unknown and which stands inside a dungeon's extent is hidden from an outsider; one outside every dungeon is seen from its first tick", async () => {
  const verbs = await import(worldModuleUrl("tools", "world-verbs.mjs"));
  void verbs;
  const marks = ROWS.map((r) => ({ id: r.slug, by: r.owner, household: r.owner, kind: "sited", tier: "market", at: r.geometry.at, extent: r.geometry.extent, body: r.body,
    ...(r.data.class ? { class: r.data.class } : {}), date: "2026-09-02T00:00:00Z" }));
  const spawn = (id, x, y, n) => ({ id: String(n), at: iso(NOW - 3600_000), actor: "the-town", action: "spawn", object: id,
    payload: { kind: "wolf", at: iso(NOW - 3600_000), fades_at: iso(NOW + 12 * 3600_000), x, y } });
  const set = new LivingSet({ law: LAW, hideUnwarmed: true });
  // never warmed (a boot before the published marks are read): nothing is placed, so nothing is seen
  set.fold([spawn("creature:wolf-1", 2000, 2000, 1), spawn("creature:wolf-2", 100, 100, 2)]);
  const cold = await creaturesForRead({ hook: { living: set, law: LAW }, as: "ann", occupancy: OUTSIDE });
  assert.deepEqual([...cold.living.byId.keys()], [], "before the first read of the marks nobody can tell, so nothing appears");
  // the marks are read once, for no creature in particular; the next creatures out are placed in them AT ONCE, before any tick warms them
  set.warmRooms(marks, "sha-1");
  set.fold([spawn("creature:wolf-3", 2020, 2020, 3), spawn("creature:wolf-4", 150, 150, 4)]);
  for (const occ of [OUTSIDE, NEXT_DOOR, new Map()]) {
    const cur = await creaturesForRead({ hook: { living: set, law: LAW }, as: "ann", occupancy: occ });
    const ids = [...cur.living.byId.keys()].sort();
    assert.deepEqual(ids, ["creature:wolf-2", "creature:wolf-4"], "the ones outside every dungeon, and only those, for a reader outside the hall");
  }
  const hallEntered = ledger([["ann", "enters", KEEP, 1], ["ann", "enters", HALL, 2]]);
  const inside = await creaturesForRead({ hook: { living: set, law: LAW }, as: "ann", occupancy: hallEntered });
  assert.ok(inside.living.byId.has("creature:wolf-1") && inside.living.byId.has("creature:wolf-3"), "the control: one who entered the hall sees what stands in it");
});

// ── presence: a resident inside a dungeon room ───────────────────────────────

test("a resident entered in a dungeon room is seen only by readers entered in the same room; houses and the open are untouched", async () => {
  const { hiddenInsiders, hideInsiders } = await import("../src/world.mjs");
  const interior = new Set([HALL, VAULT, STATUE]);
  const occ = ledger([["ann", "enters", KEEP, 1], ["ann", "enters", HALL, 2], ["bo", "enters", KEEP, 1], ["cy", "enters", KEEP, 1], ["cy", "enters", VAULT, 2],
    ["di", "enters", "townsfolk/a-house", 1]]);
  assert.deepEqual([...hiddenInsiders(occ, interior, null)].sort(), ["ann", "cy"], "a keyless reader: those in rooms; bo (only in the keep) and di (a house) stay");
  assert.deepEqual([...hiddenInsiders(occ, interior, "ann")].sort(), ["cy"], "ann, in the hall, sees no one in the vault, and no one sees her hall but her");
  assert.deepEqual([...hiddenInsiders(occ, interior, "bo")].sort(), ["ann", "cy"], "bo, in the keep, sees neither room");
  assert.deepEqual([...hiddenInsiders(occ, interior, "cy")].sort(), ["ann"]);
  // the dungeon itself counts as entered (WLD-74): the keep is the room when it is the innermost entry on a stack
  const withKeep = new Set([...interior, KEEP]);
  assert.deepEqual([...hiddenInsiders(occ, withKeep, null)].sort(), ["ann", "bo", "cy"], "a keyless reader sees neither the rooms nor those who entered the keep; di (a house) stays");
  assert.deepEqual([...hiddenInsiders(occ, withKeep, "bo")].sort(), ["ann", "cy"], "bo, in the keep, sees only those whose innermost entry is the keep too");
  assert.deepEqual([...hiddenInsiders(occ, withKeep, "ann")].sort(), ["cy"], "ann, in the hall, still sees bo (the keep is on her stack)");
  const withEv = ledger([["ann", "enters", KEEP, 1], ["ann", "enters", HALL, 2], ["bo", "enters", KEEP, 1], ["ev", "enters", KEEP, 1]]);
  assert.deepEqual([...hiddenInsiders(withEv, withKeep, "bo")], ["ann"], "stack [keep] only: ev (the same stack) is present to bo, and absent from a stranger");
  assert.deepEqual([...hiddenInsiders(withEv, withKeep, "zed")].sort(), ["ann", "bo", "ev"], "a reader who entered nothing sees none of them");
  assert.deepEqual(hideInsiders([{ handle: "ann" }, { handle: "bo" }], new Set(["ann"])), [{ handle: "bo" }]);
});

test("the keyless store presence routes leave out a resident entered in a room: /world2/present, /world2/positions and the apex's present", async (t) => {
  if (WHY) return t.skip(WHY);
  const { insiderHandles } = await import("../src/world2-serve.mjs");
  const enter = (id, handle, mark, act) => ({ id, at: new Date("2026-10-26T16:30:00Z"), crossing: null, actor: handle, action: act === "enters" ? "legacy:enter" : "legacy:exit",
    payload: { _ledger: "WORLD/enter-exit-ledger.md", iso: "2026-10-26T16:30:00.000Z", handle, act, mark, at: 1, word: "neutral" } });
  const acts = [enter(10, "ann", KEEP, "enters"), enter(11, "ann", HALL, "enters"), enter(12, "bo", KEEP, "enters"), enter(13, "cy", HALL, "enters"), enter(14, "cy", HALL, "exits")];
  const p = { query: async (sql, args) => (/FROM acts/i.test(sql) ? { rows: acts } : pool().query(sql, args)) };
  assert.deepEqual([...await insiderHandles(p)].sort(), ["ann", "bo"], "ann is in the hall and bo has entered the keep itself (inside); cy came out");
});

test("the keyless routes themselves: /world2/present, /world2/positions and the apex's present list no resident entered in a room, and no coordinates of one", async (t) => {
  if (WHY) return t.skip(WHY);
  const walk = (id, handle, to) => ({ id, at: new Date("2026-10-26T16:40:00Z"), crossing: "300", actor: handle, action: "walk",
    payload: { from: { x: 2000, y: 2000 }, toward: { x: 2000, y: 2000 }, within: null, to, pace: 60 } });
  const enter = (id, handle, mark, act) => ({ id, at: new Date("2026-10-26T16:30:00Z"), crossing: null, actor: handle, action: act === "enters" ? "legacy:enter" : "legacy:exit",
    payload: { _ledger: "WORLD/enter-exit-ledger.md", iso: "2026-10-26T16:30:00.000Z", handle, act, mark, at: 1, word: "neutral" } });
  const departures = [walk(1, "ann", null), walk(2, "bo", null), walk(3, "cy", null)];
  const passages = [enter(10, "ann", KEEP, "enters"), enter(11, "ann", HALL, "enters"), enter(12, "bo", KEEP, "enters")];
  const p = { query: async (sql, args) => {
    if (/FROM acts/i.test(sql)) return { rows: (args?.[0] ?? []).includes("legacy:enter") ? passages : departures };
    if (/FROM town_roll/i.test(sql)) return { rows: [{ handle: "ann" }, { handle: "bo" }, { handle: "cy" }] };
    if (/FROM identities/i.test(sql)) return { rows: [] };
    if (/FROM marks WHERE status/i.test(sql)) return { rows: ROWS };
    return pool().query(sql, args);
  } };
  const handlesOf = (list) => (list ?? []).map((r) => r.handle).sort();
  const present = await world2Serve("/world2/present", new URLSearchParams(""), { p });
  assert.equal(present.code, 200, JSON.stringify(present.body).slice(0, 300));
  assert.deepEqual(handlesOf(present.body.residents), ["cy"], "ann (the great room) and bo (the keep itself) have entered, so are not listed");
  assert.equal(present.body.count, 1);
  const positions = await world2Serve("/world2/positions", new URLSearchParams(""), { p });
  assert.equal(positions.code, 200, JSON.stringify(positions.body).slice(0, 300));
  assert.deepEqual(handlesOf(positions.body.walkers), ["cy"]);
  const apexed = await world2Apex(new URLSearchParams({ x: String(HALL_AT.x), y: String(HALL_AT.y), crossing: "1" }), { p });
  assert.ok(!apexed.error, JSON.stringify(apexed.error?.body));
  assert.deepEqual(handlesOf(apexed.body.present?.residents), ["cy"], "the apex's present at the room's own spot");
});

// ── hearing stops at a dungeon room's walls, both ways ───────────────────────

test("one say traced end to end: spoken inside a room it is heard only in that room, its record and its log line say so, an outside say is not heard inside", async () => {
  const { mkdtempSync, readFileSync: readF } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { createVoices, EARSHOT_M } = await import("../src/voices.mjs");
  const dir = mkdtempSync(join(tmpdir(), "postmark-interior-say-"));
  const T0 = Date.UTC(2026, 9, 26, 17, 0, 0);
  const clock = { t: T0 };
  const where = { ann: { x: 2000, y: 2000 }, cy: { x: 2001, y: 2000 }, bo: { x: 2000, y: 2001 } }; // all at the same spot: bo only stands on it
  const roomOf = { ann: HALL, cy: HALL, bo: null };
  const make = (logPath) => createVoices({
    standpoint: async (h) => ({ handle: h, placed: true, x: where[h].x, y: where[h].y, aboard: false, moving: false }),
    place: async () => "the spot", logPath, now: () => clock.t,
    hearingWindow: () => ({ since: T0 - 3_600_000, source: "bench", disclosure: null }),
    roomOf: async (h) => roomOf[h] ?? null,
    // the presence layer's answer, with the world's rule: only those in the voice's own room (null: the open) are within earshot
    nearby: async (point, { room = null } = {}) => Object.keys(where).filter((h) => (roomOf[h] ?? null) === (room ?? null)
      && Math.hypot(where[h].x - point.x, where[h].y - point.y) <= EARSHOT_M).sort(),
  });
  const log = join(dir, "voices.jsonl");
  const v = make(log);
  const said = await v.say("ann", "the secret of the room");
  assert.ok(!said.error, JSON.stringify(said).slice(0, 200));
  assert.deepEqual(said.listeners, ["cy"], "the speaker's reply: only the one in the same room is a listener, bo (on the spot outside) is not");
  clock.t += 20_000;
  const outsider = await v.hear("bo", {});
  assert.deepEqual(outsider.voices, [], "bo, standing on the spot outside the room, hears nothing");
  assert.ok(!JSON.stringify(outsider).includes("secret"), "nor reads it in the room's record");
  assert.deepEqual(outsider.listeners, [], "and ann is not a listener to bo");
  const mate = await v.hear("cy", {});
  assert.deepEqual(mate.voices.map((x) => x.said), ["the secret of the room"], "cy, in the room, hears it");
  assert.deepEqual(mate.listeners, ["ann"]);
  // the log line carries the room, so a restart keeps it
  assert.equal(JSON.parse(readF(log, "utf8").trim().split("\n")[0]).room, HALL);
  const reborn = make(log);
  assert.deepEqual((await reborn.hear("bo", {})).voices, [], "after a restart too");
  assert.equal((await reborn.hear("cy", {})).voices.length, 1);
  // the page's record (keyless) has no such voice
  assert.deepEqual([...reborn.conversations().live, ...reborn.conversations().closed], [], "the conversations page lists nothing of it");
  // an outside say is not heard inside
  clock.t += 20_000;
  await reborn.say("bo", "hello from the spot");
  clock.t += 20_000;
  const inside = await reborn.hear("cy", {});
  assert.ok(!JSON.stringify(inside).includes("hello from the spot"), "a say made outside is not heard inside the room");
  const listed = reborn.conversations();
  assert.equal([...listed.live, ...listed.closed].flatMap((c) => c.record ?? c.voices ?? []).length > 0, true, "the outside say is on the page");
  assert.ok(!JSON.stringify(listed).includes("secret"));
});

test("the keyless store says and conversations leave out a say spoken inside a room", async (t) => {
  if (WHY) return t.skip(WHY);
  const { spokenInRoom } = await import("../src/world2-serve.mjs");
  assert.equal(spokenInRoom({ payload: { text: "x", room: HALL } }), true);
  assert.equal(spokenInRoom({ payload: JSON.stringify({ text: "x", room: HALL }) }), true);
  assert.equal(spokenInRoom({ payload: { text: "x" } }), false);
  const say = (id, text, room) => ({ id, at: new Date("2026-10-26T17:00:00Z"), crossing: "300", actor: "ann", action: "say", at_anchor: null, at_dx: 2000, at_dy: 2000,
    payload: { text, place: "the spot", ...(room ? { room } : {}) }, class: "voice" });
  const p = { query: async (sql, args) => {
    if (/FROM acts/i.test(sql)) return { rows: [say(1, "an open word"), say(2, "the secret of the room", HALL)] };
    return pool().query(sql, args);
  } };
  const conv = await world2Serve("/world2/conversations", new URLSearchParams(""), { p });
  assert.ok(conv.code === 200 || conv.code === 500, JSON.stringify(conv.body).slice(0, 200));
  assert.ok(!JSON.stringify(conv.body).includes("secret of the room"), "/world2/conversations");
  const air = await world2Serve("/world2/say", new URLSearchParams(""), { p });
  assert.ok(!JSON.stringify(air.body).includes("secret of the room"), "/world2/say");
});

test("the world's wiring: say listeners, the witness stamp and the ears all ask the room, and a walk row of an insider is not on /world2/walks", async () => {
  const { readFileSync: readF } = await import("node:fs");
  const src = readF(new URL("../src/world.mjs", import.meta.url), "utf8");
  assert.match(src, /const voices = createVoices\(\{\s*roomOf: roomOfNow/, "the voices know whose room a speaker and an ear are in");
  assert.match(src, /export async function projectedNearby\(at, \{ room = null \} = \{\}\) \{\s*const hide = await hearersHiddenFrom\(room\)/, "the say's listeners by position");
  assert.match(src, /hide: await hearersHiddenFrom\(await roomOfNow\(handle\)\)/, "the witness stamp");
  assert.match(src, /\.filter\(\(r\) => !of \|\| of\(r\.handle\) === \(room \?\? null\)\)/, "the push's listeners");
  if (WHY) return;
  const walk = (id, handle) => ({ id, at: new Date("2026-10-26T16:40:00Z"), crossing: "300", actor: handle, action: "walk", payload: { from: { x: 2000, y: 2000 }, toward: { x: 2000, y: 2000 }, within: null, to: null, pace: 60 } });
  const enter = (id, handle, mark, act) => ({ id, at: new Date("2026-10-26T16:30:00Z"), crossing: null, actor: handle, action: act === "enters" ? "legacy:enter" : "legacy:exit",
    payload: { _ledger: "WORLD/enter-exit-ledger.md", iso: "2026-10-26T16:30:00.000Z", handle, act, mark, at: 1, word: "neutral" } });
  const p = { query: async (sql, args) => {
    if (/FROM acts/i.test(sql)) return { rows: (args?.[0] ?? []).includes("legacy:enter") ? [enter(10, "ann", KEEP, "enters"), enter(11, "ann", HALL, "enters")] : [walk(1, "ann"), walk(2, "bo")] };
    return pool().query(sql, args);
  } };
  const walks = await world2Serve("/world2/walks", new URLSearchParams(""), { p });
  assert.equal(walks.code, 200, JSON.stringify(walks.body).slice(0, 200));
  assert.deepEqual(walks.body.walks.map((w) => w.handle), ["bo"], "ann, entered in the great room, has no walk here, and no coordinates");
});

test("the enter ledger is folded once a second, not once a call, and an enter or exit forgets it at once", async () => {
  const { occupancyAll, folds, forgetOccupancy, OCCUPANCY_TTL_MS, __setOccupancyReaderForTest } = await import("../src/creature-sight.mjs");
  __setOccupancyForTest(null);
  __setOccupancyReaderForTest(async () => { await new Promise((r) => setTimeout(r, 30)); return new Map([["ann", [HALL]]]); });
  forgetOccupancy();
  const before = folds.n;
  await Promise.all([occupancyAll(), occupancyAll(), occupancyAll(), occupancyAll()]);
  await occupancyAll();
  assert.equal(folds.n - before, 1, "nine callers in one read share one fold");
  assert.equal(OCCUPANCY_TTL_MS, 1000);
  forgetOccupancy();
  await occupancyAll();
  assert.equal(folds.n - before, 2, "forgotten at once by a passage");
  __setOccupancyReaderForTest(null); forgetOccupancy();
  const crossings = (await import("node:fs")).readFileSync(new URL("../src/world-crossings.mjs", import.meta.url), "utf8");
  assert.match(crossings, /enterAct\(worldClone, payload, key, deps\)\.finally\(forgetOccupancy\)/);
  assert.match(crossings, /exitAct\(worldClone, payload, key, deps\)\.finally\(forgetOccupancy\)/);
});
