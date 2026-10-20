// entity-appearance.test.mjs — a resident describes itself: a tree of
// predicates on the resident, canon at the act (WLD-83; Darko 2026-10-19
// 18:59, 19:04, 19:42, P1–P10).
//
// The door (`world { do: "describe" }`) is driven through its own seams for
// the law (who may write, the one cap, the tree's grammar, revise, withdraw),
// and once more against a real store, so the fold's SQL and the acts pen are
// the ones the box runs. The reads: investigate's resident answer carries the
// tree, and a node is investigated by its own id.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/entity-appearance.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import {
  worldDescribe, applyAct, nodeAnswer, appearanceIdOf, rootIdOf, appearanceNodes,
  __resetAppearanceForTest, APPEARANCE_CLASS, BODY_MAX, ID_MAX, FOLD_SQL, OVERLAP_SQL,
} from "../src/entity-predicates.mjs";
import { entityKindOf, investigateResident } from "../src/world-investigate-entity.mjs";
import { dispatchToolFor, focusArgs } from "../src/world-apex.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { worldClone } from "./fixture-paths.mjs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const jetto = { handles: new Set(["jetto-of-starforge"]), household: "starforge" };

/** The door over an in-memory fold and a recording pen. */
function door() {
  const nodes = new Map();
  const written = [];
  let next = 1;
  const deps = { nodes: async () => nodes, write: async (row) => { written.push(row); return String(next++); } };
  return { nodes, written, describe: (args, key = jetto) => worldDescribe(args, key, deps) };
}

const refused = async (p, code, re) => {
  await assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code} ${e.defect}`); if (re) assert.match(e.defect, re); return true; });
};

test("THE GLANCE FIRST: the root is slot appearance on the resident itself, and its body is what others see", async () => {
  const d = door();
  const out = await d.describe({ slot: "appearance", value: "a hooded figure", body: "A hooded figure in a grey shawl; the face is never seen." });
  assert.equal(out.described, "jetto-of-starforge/appearance");
  assert.equal(out.revised, false);
  assert.match(out.canon, /^live/);
  assert.deepEqual(d.written[0], { actor: "jetto-of-starforge", action: "describe", object: "jetto-of-starforge/appearance",
    payload: { parent: "resident:jetto-of-starforge", slot: "appearance", value: "a hooded figure", body: "A hooded figure in a grey shawl; the face is never seen." },
    household: "starforge" });
  assert.equal(out.appearance.body, "A hooded figure in a grey shawl; the face is never seen.");
});

test("A TREE OF REAL PREDICATES: a detail hangs under the root by default, or under another detail; its id is the path", async () => {
  const d = door();
  await d.describe({ slot: "appearance", value: "hooded", body: "A hooded figure." });
  const hood = await d.describe({ slot: "hood", value: "grey wool", body: "The hood is grey wool, pulled low." });
  assert.equal(hood.described, "jetto-of-starforge/appearance.hood");
  assert.equal(d.nodes.get(hood.described).parent, "jetto-of-starforge/appearance");
  const clasp = await d.describe({ slot: "clasp", value: "candy glass", body: "A clasp of candy glass that hums.", under: hood.described });
  assert.equal(clasp.described, "jetto-of-starforge/appearance.hood.clasp");
  assert.deepEqual(clasp.appearance.predicates.map((p) => p.slot), ["hood"], "the close look lists the root's own details");
});

test("THE ONE CAP IS THE GLOBAL ONE: a body over 150 characters is refused, never trimmed; nothing caps the tree", async () => {
  const d = door();
  assert.equal(BODY_MAX, 150);
  await refused(d.describe({ slot: "appearance", value: "x", body: "a".repeat(151) }), 422, /151 chars; the cap is 150/);
  await d.describe({ slot: "appearance", value: "x", body: "a".repeat(150) });
  for (let i = 0; i < 40; i++) await d.describe({ slot: `detail-${i}`, value: "v", body: "b" });
  assert.equal(d.nodes.size, 41, "forty details stand: there is no tree maximum (P2)");
});

test("ONE SLOT UNDER ONE PARENT IS ONE NODE: a second describe revises it, the latest appended wins", async () => {
  const d = door();
  await d.describe({ slot: "appearance", value: "hooded", body: "A hooded figure." });
  const again = await d.describe({ slot: "appearance", value: "unhooded", body: "Jetto, candy-glitched, the hood thrown back." });
  assert.equal(again.revised, true);
  assert.equal(d.nodes.get("jetto-of-starforge/appearance").value, "unhooded");
  assert.equal(d.written.length, 2, "two acts, one node");
});

test("WITHDRAW takes a node and everything under it", async () => {
  const d = door();
  await d.describe({ slot: "appearance", value: "hooded", body: "A hooded figure." });
  await d.describe({ slot: "hood", value: "grey", body: "Grey." });
  await d.describe({ slot: "clasp", value: "glass", body: "Glass.", under: "jetto-of-starforge/appearance.hood" });
  await d.describe({ slot: "boots", value: "worn", body: "Worn boots." });
  const out = await d.describe({ withdraw: "jetto-of-starforge/appearance.hood" });
  assert.equal(out.withdrawn, "jetto-of-starforge/appearance.hood");
  assert.deepEqual([...d.nodes.keys()].sort(), ["jetto-of-starforge/appearance", "jetto-of-starforge/appearance.boots"]);
  assert.equal(d.written.at(-1).action, "withdraw");
});

test("P1: ONLY THE RESIDENT'S OWN HOUSEHOLD WRITES IT — another resident, another's node, and a key with no resident are refused", async () => {
  const d = door();
  await refused(d.describe({ handle: "milo", slot: "appearance", value: "x", body: "y" }), 403, /not one of your residents/);
  await d.describe({ slot: "appearance", value: "x", body: "y" });
  await refused(d.describe({ slot: "hat", value: "x", body: "y", under: "milo/appearance" }), 403, /not a node of jetto-of-starforge's appearance/);
  await refused(d.describe({ withdraw: "milo/appearance" }), 403);
  await refused(d.describe({ slot: "appearance", value: "x", body: "y" }, { handles: new Set(), household: "" }), 422, /which resident/);
  assert.equal(d.written.length, 1, "nothing was written for a refusal");
});

test("THE SCOPE IS THE HOUSEHOLD (P1; Darko 2026-10-19 18:21): a housemate may write and withdraw, another household is refused", async () => {
  const d = door();
  const house = { handles: new Set(["sb-ash", "sb-bram"]), household: "sb-lantern" };
  await d.describe({ handle: "sb-ash", slot: "appearance", value: "x", body: "Ash's glance." }, house);
  const bram = await d.describe({ handle: "sb-ash", slot: "boots", value: "worn", body: "Worn boots." }, house);
  assert.equal(bram.described, "sb-ash/appearance.boots", "a key of the same household writes on its housemate");
  await d.describe({ handle: "sb-ash", withdraw: "sb-ash/appearance.boots" }, house);
  // and a resident's own claim key (oauth.mjs § keyLookup: custody beside the household's handles),
  // so narrowing those keys to their claimed resident would turn this red
  const bramsOwn = { ...house, heldBy: "resident", claimedHandle: "sb-bram" };
  const byClaim = await d.describe({ handle: "sb-ash", slot: "hat", value: "felt", body: "A felt hat." }, bramsOwn);
  assert.equal(byClaim.described, "sb-ash/appearance.hat", "a housemate's own claim key writes on sb-ash's tree");
  await d.describe({ handle: "sb-ash", withdraw: "sb-ash/appearance.hat" }, bramsOwn);
  const other = { handles: new Set(["sb-cleo"]), household: "sb-quill" };
  await refused(d.describe({ handle: "sb-ash", slot: "hat", value: "x", body: "y" }, other), 403, /not one of your residents/);
  await refused(d.describe({ withdraw: "sb-ash/appearance" }, other), 403);
  assert.ok(d.nodes.has("sb-ash/appearance"), "another household's withdraw took nothing");
});

test("A PATH ID PAST WHAT AN INDEX ROW HOLDS is a 422 before the record is asked", async () => {
  const d = door();
  await d.describe({ slot: "appearance", value: "x", body: "y" });
  let under = "jetto-of-starforge/appearance";
  const slot = "s".repeat(48);
  while (under.length + 1 + slot.length <= ID_MAX) {
    const out = await d.describe({ slot, value: "v", body: "b", under });
    under = out.described;
  }
  const writes = d.written.length;
  await refused(d.describe({ slot, value: "v", body: "b", under }), 422, /ids stop at 1000/);
  assert.equal(d.written.length, writes, "nothing was written");
});

test("THE FOLD ORDERS BY ACT ID, whatever order the rows arrive in: an older revision read late never wins, a withdraw buries only what came before it", () => {
  const nodes = new Map();
  const describe = (id, act, parent, body) => applyAct(nodes, { id: String(act), action: "describe", object: id, actor: "j", payload: { parent, slot: id.split(".").pop().split("/").pop(), value: "v", body } });
  describe("j/appearance", 1, "resident:j", "root");
  describe("j/appearance.hood", 5, "j/appearance", "newer");
  describe("j/appearance.hood", 3, "j/appearance", "older, committed late");
  assert.equal(nodes.get("j/appearance.hood").body, "newer");
  applyAct(nodes, { id: "10", action: "withdraw", object: "j/appearance.hood", actor: "j" });
  describe("j/appearance.hood.clasp", 8, "j/appearance.hood", "written before the withdraw, read after it");
  assert.equal(nodes.has("j/appearance.hood.clasp"), false, "the tombstone holds it");
  assert.equal(nodes.has("j/appearance.hood"), false);
  describe("j/appearance.hood", 12, "j/appearance", "described again after the withdraw");
  assert.equal(nodes.get("j/appearance.hood").body, "described again after the withdraw");
});

test("THE CATCH-UP RE-READS BEHIND ITS CURSOR: an act that commits after a higher one was read is still folded", async () => {
  __resetAppearanceForTest();
  const committed = [{ id: "1", action: "describe", object: "j/appearance", actor: "j", payload: { parent: "resident:j", slot: "appearance", value: "v", body: "root" } },
    { id: "3", action: "describe", object: "j/appearance.boots", actor: "j", payload: { parent: "j/appearance", slot: "boots", value: "v", body: "boots" } }];
  const late = { id: "2", action: "describe", object: "j/appearance.hood", actor: "j", payload: { parent: "j/appearance", slot: "hood", value: "v", body: "hood" } };
  const query = async (sql, [cursor]) => {
    if (sql === FOLD_SQL) return committed.filter((r) => BigInt(r.id) > BigInt(cursor));
    if (sql === OVERLAP_SQL) return committed.filter((r) => BigInt(r.id) <= BigInt(cursor));
    throw new Error("an unexpected read");
  };
  const t0 = Date.now();
  const first = await appearanceNodes({ query, now: t0 });
  assert.deepEqual([...first.keys()].sort(), ["j/appearance", "j/appearance.boots"]);
  committed.push(late);   // act 2 commits now, behind the cursor (3)
  const again = await appearanceNodes({ query, now: t0 + 5000 });
  assert.equal(again.get("j/appearance.hood")?.body, "hood", "the overlap found the late commit");
  __resetAppearanceForTest();
});

test("THE GRAMMAR: a detail needs the root first, a slot is one word, the root takes no under, value and body are required", async () => {
  const d = door();
  await refused(d.describe({ slot: "hood", value: "x", body: "y" }), 422, /no appearance yet/);
  await refused(d.describe({ slot: "Hood Up", value: "x", body: "y" }), 422, /one word/);
  await refused(d.describe({ slot: "appearance", value: "x", body: "y", under: "jetto-of-starforge/appearance" }), 422, /is the root/);
  await refused(d.describe({ slot: "appearance", body: "y" }), 422, /needs a value/);
  await refused(d.describe({ slot: "appearance", value: "x" }), 422, /needs a body/);
  await refused(d.describe({ withdraw: "jetto-of-starforge/appearance.nothing" }), 404);
  assert.equal(d.written.length, 0);
});

test("THE CLOSE LOOK (P10): a node in investigate's shape, depth 1 its own details, depth N through the engine's one descent", async () => {
  const nodes = new Map();
  const add = (id, parent, slot) => applyAct(nodes, { id: String(nodes.size + 1), action: "describe", object: id, actor: "j", payload: { parent, slot, value: slot, body: `${slot}.` } });
  add("j/appearance", "resident:j", "appearance");
  add("j/appearance.hood", "j/appearance", "hood");
  add("j/appearance.hood.clasp", "j/appearance.hood", "clasp");
  add("j/appearance.boots", "j/appearance", "boots");
  const one = nodeAnswer(nodes, "j/appearance");
  assert.deepEqual(one.predicates.map((p) => p.id), ["j/appearance.boots", "j/appearance.hood"]);
  assert.deepEqual(one.more, { predicates: 0 });
  assert.equal("beneath" in one, false, "depth 1 reads nothing below its own details");
  // the engine's own descent, from the pinned world clone (world-verbs.mjs § descend, world#257)
  const { descend } = await import(pathToFileURL(join(worldClone(), "tools", "world-verbs.mjs")).href);
  assert.equal(typeof descend, "function", "the pinned engine carries the descent");
  const deep = nodeAnswer(nodes, "j/appearance", { depth: 2, descend });
  assert.deepEqual(deep.beneath.map((b) => [b.id, b.under, b.depth]), [["j/appearance.hood.clasp", "j/appearance.hood", 2]]);
  assert.deepEqual(deep.descend, [], "the clasp has nothing under it");
  const capped = nodeAnswer(nodes, "j/appearance", { depth: 3, budget: 1, descend });
  assert.equal(capped.predicates.length, 1, "one cap: one detail at the look's own level");
  assert.ok(capped.more.predicates >= 1);
  const old = nodeAnswer(nodes, "j/appearance", { depth: 2, descend: null });
  assert.match(old.beneath_unavailable, /predates the descent/, "an older engine says so, and the look stays one level deep");
});

test("INVESTIGATE: a node id is the living's (an appearance), and the resident's answer carries the tree", async () => {
  assert.deepEqual(entityKindOf("jetto-of-starforge/appearance.hood"), { kind: "appearance", id: "jetto-of-starforge/appearance.hood", handle: "jetto-of-starforge" });
  assert.equal(entityKindOf("jetto-of-starforge/lantern").kind, "mark", "a mark is still a mark");
  assert.equal(appearanceIdOf("jetto-of-starforge/appearance-ish"), null);
  assert.equal(rootIdOf("milo"), "milo/appearance");
  const glance = { id: "jetto-of-starforge/appearance", body: "A hooded figure.", predicates: [] };
  const seen = await investigateResident("jetto-of-starforge", {
    known: async () => true, standpoint: async () => null, place: async () => "", saved: () => null,
    recent: async () => [], holds: async () => [], placeOf: () => null, appearance: async () => glance,
  });
  assert.deepEqual(seen.appearance, glance);
  const none = await investigateResident("milo", {
    known: async () => true, standpoint: async () => null, place: async () => "", saved: () => null,
    recent: async () => [], holds: async () => [], placeOf: () => null,
  });
  assert.equal("appearance" in none, false, "a resident with none carries no appearance key");
});

test("THE APEX DISPATCHES describe to its flat schema", () => {
  assert.equal(dispatchToolFor("describe"), "world_describe");
});

test("THE APEX TAKES depth: the mark: look carries it past 1, and depth 1 asks what it always asked", () => {
  // found on the walk (docs/2026-10-19/rail/WLD-83/column-walk): depth bounced as an unknown argument
  assert.deepEqual(focusArgs({ mark: "a/b", depth: 3 }), { mark: "a/b", depth: 3 });
  assert.deepEqual(focusArgs({ mark: "a/b", depth: 1 }), { mark: "a/b" });
  assert.deepEqual(focusArgs({ mark: "a/b" }), { mark: "a/b" });
});

test("AGAINST A REAL STORE: the door writes an `appearance` act, and the fold reads it back at once", async (t) => {
  let s;
  try { s = await startStore({ db: "entity_appearance" }); } catch (e) { t.skip(`no store: ${e?.message ?? e}`); return; }
  const was = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = s.url("office_api");
  __resetAppearanceForTest();
  const api = await s.connect("office_api");
  try {
    const out = await worldDescribe({ slot: "appearance", value: "hooded", body: "A hooded figure." }, jetto);
    assert.ok(out.act, `an act id came back: ${JSON.stringify(out)}`);
    const rows = (await api.query("SELECT actor, action, object, class, payload FROM acts WHERE class = $1", [APPEARANCE_CLASS])).rows;
    assert.deepEqual(rows.map((r) => [r.actor, r.action, r.object, r.class, r.payload.body]),
      [["jetto-of-starforge", "describe", "jetto-of-starforge/appearance", "appearance", "A hooded figure."]]);
    __resetAppearanceForTest(); // a second process: nothing in RAM, the fold reads the record
    const nodes = await appearanceNodes();
    assert.equal(nodes.get("jetto-of-starforge/appearance")?.body, "A hooded figure.");
    // and a second catch-up runs the overlap read behind the cursor, against the real schema
    const again = await appearanceNodes({ now: Date.now() + 5000 });
    assert.equal(again?.get("jetto-of-starforge/appearance")?.body, "A hooded figure.", "the overlap read answered on the real store");
  } finally {
    await api.end(); await s.stop();
    __resetAppearanceForTest();
    for (const [k, v] of [["WORLD2_PG", was.pg], ["WORLD2_PG_URL", was.url]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
