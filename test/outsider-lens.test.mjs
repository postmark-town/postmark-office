// outsider-lens.test.mjs — WLD-26 (ruled in Sitting B, 2026-10-19 17:48): the
// outsider lens. `lens: "outsider"` reads the world as if the reading household
// owned nothing, so an author can see what a stranger sees. It is ONE switch on
// the one owner rule (sightedWorld's `keep`, "a household's own marks are always
// its own to see"), never a second copy of sight: the world tools' one function,
// standpointSight, answers both. Read-only: it rides the bare read and its
// focuses, never an act.
//
// It leans on the REAL clone's verbs (as wld5-portals.test.mjs does), so a drift
// between the two repos reds here, and it skips (saying why) on a clone that
// predates the dungeon class.
// Run: node --test test/outsider-lens.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const CLONE = worldClone();
const HAVE = !!CLONE && existsSync(join(CLONE, "tools", "portals.mjs"));
const SKIP = !HAVE && (CLONE ? `the world clone at ${CLONE} predates WLD-5 (no tools/portals.mjs)` : NO_WORLD);
const verbsOf = async () => import(pathToFileURL(join(CLONE, "tools", "world-verbs.mjs")).href);

// a closed place (a dungeon) made by the household `mason`, with a room and a thing inside
const TOWER = "mason/the-tower";
const marks = () => [
  { id: "mason/yard", kind: "sited", by: "mason", at: { x: 1000, y: 1000 }, extent: { w: 500, h: 400 }, body: "An open yard." },
  { id: TOWER, kind: "sited", by: "mason", class: "dungeon", at: { x: 1000, y: 1000 }, extent: { w: 300, h: 300 }, body: "A tower." },
  { id: "mason/hall", kind: "sited", by: "mason", at: { x: 1030, y: 1000 }, extent: { w: 200, h: 200 }, body: "A hall." },
  { id: "mason/lamp", kind: "sited", by: "mason", at: { x: 1040, y: 1010 }, extent: { w: 2, h: 2 }, body: "A lamp." },
];
const key = (...h) => ({ handles: new Set(h) });
const ids = (x) => x.marks.map((m) => m.id).sort();

test("the owner's own sight is unchanged without the lens: the household that made the closed place reads inside it", { skip: SKIP }, async () => {
  const { sightedWorld } = await import("../src/world.mjs");
  const verbs = await verbsOf();
  const own = sightedWorld({ marks: marks() }, { verbs, handle: "mason", stack: [], key: key("mason") });
  assert.ok(ids(own).includes("mason/hall") && ids(own).includes("mason/lamp"), "a household's own marks are its own to see");
});

test("with lens: \"outsider\" the owner sees exactly what a stranger sees: the closed place alone", { skip: SKIP }, async () => {
  const { sightedWorld } = await import("../src/world.mjs");
  const verbs = await verbsOf();
  const w = { marks: marks() };
  const stranger = sightedWorld(w, { verbs, handle: "ann", stack: [], key: key("ann") });
  const outsider = sightedWorld(w, { verbs, handle: "mason", stack: [], key: key("mason"), lens: "outsider" });
  // ⚑ THE FLIP: keep `keep` on under the lens in sightedWorld → the owner reads the hall again and this reds
  assert.deepEqual(ids(outsider), ids(stranger), "the same marks a stranger is told");
  assert.ok(!ids(outsider).includes("mason/hall") && !ids(outsider).includes("mason/lamp"), "nothing inside, at any depth");
  assert.ok(ids(outsider).includes(TOWER), "the closed place itself stands, as it does for anyone");
  // standing inside is not owning: an outsider who has entered sees the room they are in, as a stranger inside would
  const inHall = sightedWorld(w, { verbs, handle: "mason", stack: [TOWER, "mason/hall"], key: key("mason"), lens: "outsider" });
  const strangerIn = sightedWorld(w, { verbs, handle: "ann", stack: [TOWER, "mason/hall"], key: key("ann") });
  assert.deepEqual(ids(inHall), ids(strangerIn));
  // any other word is no lens: the door's own schema refuses it (enum), and the sight is the owner's
  const other = sightedWorld(w, { verbs, handle: "mason", stack: [], key: key("mason"), lens: "insider" });
  assert.ok(ids(other).includes("mason/hall"));
});

test("the focuses carry the lens only when it was asked, so a read without it is byte-identical", async () => {
  const { focusArgs, findFocusArgs } = await import("../src/world-apex.mjs");
  assert.deepEqual(focusArgs({ mark: "a/b" }), { mark: "a/b" });
  assert.deepEqual(focusArgs({ mark: "a/b", lens: "outsider" }), { mark: "a/b", lens: "outsider" });
  assert.deepEqual(findFocusArgs({ find: "lamp" }), { q: "lamp" });
  assert.deepEqual(findFocusArgs({ find: "lamp", lens: "outsider" }), { q: "lamp", lens: "outsider" });
});

test("the lens is a way of looking: with do: or read: it is refused, naming the call to make instead", async () => {
  const before = process.env.WORLD_APEX;
  process.env.WORLD_APEX = "1";
  try {
    const { worldApex } = await import("../src/world-apex.mjs");
    const acted = await worldApex({ do: "say", args: { text: "hi" }, lens: "outsider" }, key("mason"));
    assert.equal(acted.error, "bounce");
    assert.equal(acted.code, 422);
    assert.match(acted.defect, /lens: rides the bare read — an act is always your own/);
    const read = await worldApex({ read: "walk", lens: "outsider" }, key("mason"));
    assert.match(read.defect, /lens: rides the bare read — a read: of an action is your own act's shadow/);
  } finally {
    if (before === undefined) delete process.env.WORLD_APEX; else process.env.WORLD_APEX = before;
  }
});

test("the v2 blocks read whole are the bare read's own parts: the lens rides them", async () => {
  const { lensRefusal } = await import("../src/world-apex.mjs");
  const { BLOCK_READS } = await import("../src/world-read-v2.mjs");
  // ⚑ THE FLIP: refuse every read: under the lens again (drop the BLOCK_READS exemption) → this reds
  for (const block of Object.keys(BLOCK_READS)) assert.equal(lensRefusal({ read: block, lens: "outsider" }), null, `read: "${block}" takes the lens`);
  assert.equal(lensRefusal({ read: "walk", lens: "outsider" }).code, 422, "an action's shadow does not");
  assert.equal(lensRefusal({ do: "say", lens: "outsider" }).code, 422, "nor an act");
  assert.equal(lensRefusal({ read: "walk" }), null, "no lens, no refusal");
});

test("explain: \"lens\" says only sight and reach change, and what is yours stays yours", async () => {
  const { explainAnswer } = await import("../src/read-grammar.mjs");
  const e = explainAnswer("world", "lens");
  assert.match(e.detail, /Only sight and reach change/);
  assert.match(e.detail, /your note, your stances, your holdings and what happened to you/);
});

test("the read names itself: the door's schema declares lens (one word, outsider), and explain: \"lens\" answers", async () => {
  const { APEX_TOOL } = await import("../src/world-apex.mjs");
  const spec = APEX_TOOL.inputSchema.properties.lens;
  assert.deepEqual(spec.enum, ["outsider"]);
  assert.match(spec.description, /as if your household owned nothing/);
  const { explainAnswer } = await import("../src/read-grammar.mjs");
  const e = explainAnswer("world", "lens");
  assert.equal(e.explains, "lens");
  assert.match(e.what, /outsider lens/);
});

test("[pin] the four resident reads pass the lens to sightFor, and sightFor to the one owner rule", () => {
  const src = readFileSync(new URL("../src/world.mjs", import.meta.url), "utf8");
  for (const fn of ["worldOrient", "worldEyes", "worldInvestigate", "worldFind"]) {
    const start = src.indexOf(`export async function ${fn}(`);
    assert.match(src.slice(start, start + 900), /const w = await sightFor\(await world\(\), [^\n]*, key, \{ lens: args\.lens \}\);/, `${fn} carries the lens`);
  }
  assert.match(src, /keep: isOutsiderLens\(lens\) \? null : \(m\) => own\.has\(m\.by\),/, "one switch on the owner rule");
  const apex = readFileSync(new URL("../src/world-apex.mjs", import.meta.url), "utf8");
  assert.match(apex, /if \(isOutsiderLens\(args\.lens\) && answer && !answer\.error\) answer = \{ \.\.\.answer, lens: OUTSIDER_LENS \};/, "the answer says it is the outsider's");
});
