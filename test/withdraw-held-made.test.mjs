// withdraw-held-made.test.mjs — POS-992 (postmark#4559): a maker withdraws a named thing it made and
// still holds (Darko 2026-11-11 09:21 EST, POS-992/a: "withdraw owns it"; Wright's specification: "The
// holding ends the way an eaten thing's does; the make record stays; the id is never reused"; Wright
// 14:47Z: its own hold face, `withdraw`, "each hold face names the act that happened").
//
// Driven through the real hold writer (world-kinds.mjs § withdrawHeldMade, and the kind door's make and
// consume) over an in-memory act log whose hold rows are derived by the store's own reader
// (guard-reads § attachmentRowOf), whose made record is the made fold (named-making.mjs § foldMade), and
// whose marks are read through the one overlay every resident read asks (held.mjs § unplaceHeld). The
// door's route and the store's own transaction are proved on a real store in
// withdraw-held-made-store.test.mjs. Everything here is invented: little-bird, five-five, a pebble.

import { test } from "node:test";
import assert from "node:assert/strict";
import { callKinds, withdrawHeldMade } from "../src/world-kinds.mjs";
import { classViewOf } from "../src/world-units.mjs";
import { lawSnapshotFromRows } from "../src/law-classes.mjs";
import { attachmentRowOf, ATTACHMENT_ACTIONS, HOLD_FACES } from "../world2/tools/guard-reads.mjs";
import { viewOf, unplaceHeld } from "../src/held.mjs";
import { foldMade, WITHDRAW_FACE, CONSUME_FACE, withdrawnWords } from "../src/named-making.mjs";
import { holdEffectsFrom } from "../src/world-hold.mjs";

const SHA = "e".repeat(40);
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property",
  key: parent ? `${klass}/${parent}/${name}` : `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const VIEW = classViewOf(lawSnapshotFromRows([
  cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }),
  cls("thing", { extends: "sited" }), cls("consumable", { extends: "thing" }), cls("candy", { extends: "consumable" }),
  cls("pocket-comet", { extends: "candy" }), cls("halloween-candy-bag", { extends: "thing" }),
  cls("entity", { extends: "postmark-node" }), cls("resident", { extends: "entity" }),
  prop("postmark-node", "makers", false, "constitution"), prop("sited", "makers", true, "constitution"), prop("thing", "makers", true, "constitution"),
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"),
  prop("thing", "min", 1, "constitution", "capacity"), prop("thing", "max", 120, "constitution", "capacity"),
  prop("thing", "open", true, "sovereign", "holder"), prop("thing", "portable", true, "sovereign"),
  prop("halloween-candy-bag", "holder", true, "constitution"),
]));
const LB = "little-bird", FIVE = "five-five";

/** An office in memory: the act log, its hold rows by the store's own reader, its marks by the one overlay. */
function office() {
  const acts = [];
  let clock = Date.parse("2026-11-11T15:00:00Z");
  const holdRows = () => acts.filter((a) => ATTACHMENT_ACTIONS.includes(a.action)).map((a) => attachmentRowOf(a)).filter((r) => !r.refused).map((r) => r.row);
  const holding = () => acts.filter((a) => a.class === "holding").map((a) => ({ seq: a.id, actor: a.actor, action: a.action, object: a.object, payload: a.payload }));
  const made = () => foldMade(holding());
  const world = () => unplaceHeld({ marks: [] }, viewOf({ record: { attachments: holdRows(), made: made() } }));
  const deps = {
    classes: () => VIEW,
    readRows: async () => ({ units: acts.filter((a) => String(a.action).startsWith("units:")), attachments: holdRows() }),
    markById: async (id) => world().marks.find((m) => m.id === id) ?? null,
    nameOf: async (id) => id,
    reachTake: async () => ({ stands: true }), reachGive: async () => ({ stands: true }),
    standpoint: async () => ({ x: 5, y: 6 }),
    holderPlace: async (id) => {
      const r = holdRows().filter((x) => x.target === id).at(-1);
      return r?.policy === "cascade" ? { holder: String(r.entity), at: null, moved: false } : { holder: null, at: null, moved: false };
    },
    householdOf: (h) => ({ key: `hh:${h}` }),
    append: async (entry, { also = [] } = {}) => {
      const first = acts.length + 100;
      for (const e of [entry, ...also]) { clock += 1; acts.push({ id: acts.length + 100, class: e.cls, action: e.action, object: e.object, actor: e.actor, at: new Date(clock).toISOString(), crossing: 262, payload: e.payload, effect: e.effect }); }
      return { actId: first };
    },
    stamp: async (actor) => ({ at: `2026-11-11T15:00:00Z@${actor}#${acts.length}`, witnesses: [] }),
    crossing: () => 262,
    household: () => "hh:test",
    dropsOut: async () => 0,
    made: async () => made(),
  };
  return { acts, deps, world, holdRows, made };
}
const KEY = (h) => ({ handles: new Set([h]), household: `hh:${h}` });
const thing = (by, slug, extra = {}) => ({ id: `${by}/${slug}`, by, slug, kind: "thing", body: `A ${slug}.`, ...extra });
const makeInto = (o, by, made, to = by) => callKinds("make", { to, made }, KEY(by), by, o.deps);
const withdraw = (o, id, maker) => withdrawHeldMade({ thing: id, maker, key: KEY(maker), deps: o.deps });

test("#4559 · the reported case: a plain thing made in hand is no consumable, and its maker withdraws it: ONE `withdraw` hold act ends the holding, the overlay drops it, the make stays and its name stays taken", async () => {
  const o = office();
  const id = `${LB}/pebble`;
  await makeInto(o, LB, thing(LB, "pebble"));
  assert.equal((await o.deps.markById(id))?.held_by, LB, "made in hand: held, live, on the world");
  // consume still refuses it, exactly as before: a plain thing is not becoming edible. Its maker is pointed at withdraw (#4559's step 2)
  await assert.rejects(callKinds("consume", { thing: id }, KEY(LB), LB, o.deps),
    (e) => /a thing is not a consumable/.test(e.defect) && e.hint.includes(`You made it and hold it, so you can withdraw it for good instead: withdraw { mark: "${id}" }.`));

  const before = o.acts.length;
  const r = await withdraw(o, id, LB);
  assert.deepEqual([r.id, r.withdrawn, r.made_in_hand, r.kind], [id, true, true, "thing"]);
  assert.equal(r.effect, withdrawnWords({ actor: LB, id }));
  assert.match(r.effect, /withdrawn by its maker/);
  assert.doesNotMatch(r.effect, /eat|consum/i, "never said as eaten");
  assert.equal(o.acts.length, before + 1, "one act");
  const w = o.acts.at(-1);
  assert.deepEqual([w.class, w.action, w.object, w.actor], ["holding", WITHDRAW_FACE, id, LB], "the hold lane's own withdraw face, never consume");
  assert.deepEqual([w.payload.thing, w.payload.holder, w.payload.previous_holder, w.payload.policy, w.payload.consumed], [id, null, LB, "detach", undefined]);

  assert.equal(await o.deps.markById(id), null, "the overlay drops it: no longer on the world");
  assert.equal(o.holdRows().filter((x) => x.target === id).at(-1).policy, "detach", "its holding ended, with no place");
  assert.ok(o.made().has(id), "the made record keeps the make");
  await assert.rejects(makeInto(o, LB, thing(LB, "pebble")), (e) => e.code === 409 && /taken for good/.test(e.defect), "its name is never made again");
});

test("refused, writing nothing: a made thing in another's hands, one in a holder, and one already withdrawn", async () => {
  const o = office();
  const given = `${LB}/gift`, bagged = `${LB}/marble`, bag = `${LB}/bag`;
  await makeInto(o, LB, thing(LB, "gift"));
  await callKinds("give", { thing: given, to: FIVE }, KEY(LB), LB, o.deps).catch(async () => {
    // the whole-thing give between residents is the hold door's; write its row the way that door does
    const { thingHoldingEntry } = await import("../src/world-units.mjs");
    const { entry } = await thingHoldingEntry(o.deps, KEY(LB), LB, o.holdRows(), { did: "give", thing: given, holder: FIVE, previous: LB, madeBy: LB });
    await o.deps.append(entry);
  });
  await makeInto(o, LB, thing(LB, "bag", { kind: "halloween-candy-bag" }));
  await makeInto(o, LB, thing(LB, "marble"), bag);

  const n = o.acts.length;
  await assert.rejects(withdraw(o, given, LB), (e) => e.code === 409 && e.defect === `you are not holding ${given}: ${FIVE} is`);
  await assert.rejects(withdraw(o, bagged, LB), (e) => e.code === 409 && e.defect === `you are not holding ${bagged}: ${bag} is` && e.hint.includes(`take it out of ${bag} first`));
  await assert.rejects(withdraw(o, given, FIVE), (e) => e.code === 403 && e.defect === `${given} was made by ${LB}, and a thing made in hand is withdrawn only by its maker`, "the one who holds it did not make it");
  assert.equal(o.acts.length, n, "nothing was written");
  assert.equal((await o.deps.markById(given))?.held_by, FIVE, "still where it was");
  // holding a plain thing another made, consume is refused with no pointer to a door that would refuse its holder
  await assert.rejects(callKinds("consume", { thing: given }, KEY(FIVE), FIVE, o.deps),
    (e) => /a thing is not a consumable/.test(e.defect) && !e.hint.includes("withdraw"));

  const own = `${LB}/once`;
  await makeInto(o, LB, thing(LB, "once"));
  await withdraw(o, own, LB);
  const m = o.acts.length;
  await assert.rejects(withdraw(o, own, LB), (e) => e.code === 409 && /is gone: it was eaten or withdrawn, and it stays gone/.test(e.defect), "withdrawn once, for good");
  await assert.rejects(callKinds("consume", { thing: own }, KEY(LB), LB, o.deps), (e) => e.code === 409 && /is gone/.test(e.defect));
  assert.equal(o.acts.length, m, "nothing was written");
});

test("an eaten thing stays eaten: withdraw refuses it and writes nothing, and the eat is still the record's last word", async () => {
  const o = office();
  const id = `${LB}/comet`;
  await makeInto(o, LB, thing(LB, "comet", { kind: "pocket-comet" }));
  await callKinds("consume", { thing: id }, KEY(LB), LB, o.deps);
  const eat = o.acts.at(-1);
  assert.equal(eat.action, CONSUME_FACE);
  const n = o.acts.length;
  await assert.rejects(withdraw(o, id, LB), (e) => e.code === 409 && /is gone: it was eaten or withdrawn/.test(e.defect));
  assert.equal(o.acts.length, n, "nothing written");
  assert.equal(o.acts.at(-1), eat, "the eat stands as the last act; nothing revived it");
  assert.equal(await o.deps.markById(id), null);
});

test("a name never made in hand is no business of this act: 404, nothing written", async () => {
  const o = office();
  await assert.rejects(withdraw(o, `${LB}/never-made`, LB), (e) => e.code === 404 && /no mark/.test(e.defect));
  assert.equal(o.acts.length, 0);
});

test("the withdraw door teaches it: its tool says a thing made in hand goes at once and for good, unlike canon at the next crossing", async () => {
  const { WORLD_TOOLS } = await import("../src/world.mjs");
  const tool = WORLD_TOOLS.find((t) => t.name === "world_withdraw_mark");
  assert.match(tool.description, /canon at the next crossing/, "a published mark is unpublished at the crossing, as before");
  assert.match(tool.description, /A thing you made in hand \(leave-mark \{ slug, body, to \}\) and still hold is withdrawn at once and for good: its holding ends, it leaves the world now, the record keeps its making, and its name is never made again; a holder goes only empty\./);
});

test("the store's reader and the history: a withdraw is a hold face, read as the end of the holding, and told as withdrawn by its maker, never eaten", () => {
  assert.ok(HOLD_FACES.includes(WITHDRAW_FACE) && ATTACHMENT_ACTIONS.includes(WITHDRAW_FACE));
  const at = "2026-11-11T15:00:01.000Z";
  const row = { id: 9, at, actor: LB, action: WITHDRAW_FACE, class: "holding", crossing: 262, object: `${LB}/p`, payload: { thing: `${LB}/p`, holder: null, previous_holder: LB, made_by: LB, policy: "detach" } };
  const r = attachmentRowOf(row);
  assert.equal(r.refused, undefined, JSON.stringify(r));
  assert.deepEqual([r.era, r.row.target, r.row.policy, r.row.entity], ["live", `${LB}/p`, "detach", LB]);
  const told = holdEffectsFrom({ rows: [row], handles: [LB], sinceCrossing: 260, nowCrossing: 263 });
  assert.equal(told.length, 1);
  assert.equal(told[0].kind, "hold-withdraw");
  assert.match(told[0].summary, /withdrawn by its maker/);
  assert.doesNotMatch(told[0].summary, /eat|consum|handed/i);
});
