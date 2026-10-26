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
const KEEP = "keepers/the-keep", HALL = "keepers/the-hall", VAULT = "keepers/the-vault", STATUE = "keepers/the-statue", GATE = "keepers/the-gatehouse";
const ROWS = [
  row({ id: "u0", slug: "the-town/let-there-be-light", owner: "the-town", body: "the light", at: { x: 0, y: 0 }, extent: { w: 320000, h: 320000 }, data: { tier: "constitution", date: "2026-07-22" } }),
  row({ id: "u1", slug: KEEP, owner: "keepers", body: "a keep with rooms inside it", at: { x: 2000, y: 2000 }, extent: { w: 400, h: 400 }, data: { tier: "market", date: "2026-09-01", class: "dungeon" } }),
  row({ id: "u2", slug: HALL, owner: "keepers", body: "the hall of the keep", at: { x: 2000, y: 2000 }, extent: { w: 60, h: 60 }, data: { tier: "market", date: "2026-09-02" } }),
  row({ id: "u3", slug: VAULT, owner: "keepers", body: "the vault of the keep", at: { x: 2150, y: 2150 }, extent: { w: 60, h: 60 }, data: { tier: "market", date: "2026-09-02" } }),
  row({ id: "u4", slug: STATUE, owner: "keepers", body: "a statue standing in the hall", at: { x: 2005, y: 2005 }, extent: { w: 2, h: 2 }, data: { tier: "market", date: "2026-09-03" } }),
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
const SECRETS = [...INTERIOR, "the hall of the keep", "the vault of the keep", "a statue standing in the hall", "The Hall", "The Vault", "The Statue",
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
  assert.match(both.inside, /Hall/, "the whole world names the hall");
  assert.doesNotMatch(both.outside, /Hall|Vault|Statue/i, "the shared label never does");
  assert.match(both.outside, /Keep/i, "it names the keep");
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
