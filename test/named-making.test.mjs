// named-making.test.mjs — POS-766 part 1 of 2 (ruled by Darko 2026-10-22 21:55
// and 2026-10-23 00:15): leave-mark { slug, body, kind?, to } makes ONE named
// thing straight into your hands or a holder you're at, held, free and live.
//
// Driven through the kind door (world-kinds.mjs § callKinds) over an in-memory
// act log whose hold rows are derived by the store's own reader
// (guard-reads § attachmentRowOf), and whose marks are read through the one
// overlay every resident read asks (held.mjs § unplaceHeld): so the record a
// make writes is the record every reader sees. The raffle is the case that
// asked for it (Little Bird and 5.5, 2026-10-22): a bag of numbered tickets,
// drawn pot luck.

import { test } from "node:test";
import assert from "node:assert/strict";
import { callKinds } from "../src/world-kinds.mjs";
import { classViewOf } from "../src/world-units.mjs";
import { foldUnits, UNIT_ACTION } from "../src/world-stacks.mjs";
import { lawSnapshotFromRows } from "../src/law-classes.mjs";
import { attachmentRowOf, ATTACHMENT_ACTIONS } from "../world2/tools/guard-reads.mjs";
import { viewOf, unplaceHeld, heldMadeMarks, HELD_BY } from "../src/held.mjs";
import { foldOwners, ownershipEvents, takeOwns } from "../src/ownership.mjs";
import { holdRecordKeeper } from "../src/hold-record.mjs";
import {
  isNamedForm, namedFormRefusal, madeRecordOf, foldMade, setDownNotYet, madeIdTaken, MAKE_FACE, CONSUME_FACE,
} from "../src/named-making.mjs";

const SHA = "e".repeat(40);
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property",
  key: parent ? `${klass}/${parent}/${name}` : `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const SNAP = lawSnapshotFromRows([
  cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }), cls("note", { extends: "sited" }),
  cls("thing", { extends: "sited" }), cls("consumable", { extends: "thing" }), cls("candy", { extends: "consumable" }),
  cls("pocket-comet", { extends: "candy" }), cls("halloween-candy-bag", { extends: "thing" }), cls("vehicle", { extends: "sited" }),
  cls("entity", { extends: "postmark-node" }), cls("resident", { extends: "entity" }),
  prop("postmark-node", "makers", false, "constitution"), prop("sited", "makers", true, "constitution"), prop("thing", "makers", true, "constitution"), prop("vehicle", "makers", false, "constitution"),
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"),
  prop("thing", "min", 1, "constitution", "capacity"), prop("thing", "max", 120, "constitution", "capacity"),
  prop("thing", "open", true, "sovereign", "holder"), prop("thing", "portable", true, "sovereign"),
  prop("halloween-candy-bag", "holder", true, "constitution"),
]);
const VIEW = classViewOf(SNAP);
const LB = "little-bird", FIVE = "five-five";

/** An office in memory: the act log, its hold rows by the store's own reader, its marks by the one overlay. */
function office({ canon = [] } = {}) {
  const acts = [];
  let clock = Date.parse("2026-10-23T05:00:00Z");
  const holdRows = () => acts.filter((a) => ATTACHMENT_ACTIONS.includes(a.action)).map((a) => attachmentRowOf(a)).filter((r) => !r.refused).map((r) => r.row);
  const holding = () => acts.filter((a) => a.class === "holding").map((a) => ({ seq: a.id, actor: a.actor, action: a.action, object: a.object, payload: a.payload }));
  const made = () => foldMade(holding());
  const world = () => unplaceHeld({ marks: canon }, viewOf({ record: { attachments: holdRows(), made: made() } }));
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
      for (const e of [entry, ...also]) { clock += 1; acts.push({ id: acts.length + 100, class: e.cls, action: e.action, object: e.object, actor: e.actor, at: new Date(clock).toISOString(), payload: e.payload, effect: e.effect }); }
      return { actId: first };
    },
    stamp: async (actor) => ({ at: `2026-10-23T05:00:00Z@${actor}#${acts.length}`, witnesses: [] }),
    crossing: () => 262,
    household: () => "hh:test",
    dropsOut: async () => 0,
    made: async () => made(),
  };
  return { acts, deps, world, holdRows, made };
}
const KEY = (h) => ({ handles: new Set([h]), household: `hh:${h}` });
const thing = (by, slug, body, extra = {}) => ({ made: madeRecordOf({ by, slug, kind: extra.kind ?? "thing", body, holderFields: extra.holder ?? null }) });
const make = (o, actor, to, slug, body, extra = {}) => callKinds("make", { to, ...thing(actor, slug, body, extra), ...(extra.preview ? { preview: true } : {}) }, KEY(actor), actor, o.deps);

// ── THE FORM ────────────────────────────────────────────────────────────────

test("the form: anything of its own with to: is the named form; a place, or a count beside its own, is refused by name", () => {
  assert.equal(isNamedForm({ to: LB, kind: "candy", count: 3 }), false, "kind + count is the batch form");
  assert.equal(isNamedForm({ to: LB, slug: "ticket-1", body: "No. 1" }), true);
  assert.equal(isNamedForm({ to: LB, holder: true }), true, "a holder field is the thing's own");
  assert.equal(namedFormRefusal({ to: LB, slug: "a", body: "b" }), null);
  assert.match(namedFormRefusal({ to: LB, kind: "candy", count: 2, at: { x: 1, y: 1 } }).defect, /has no place: at is for a mark on the ground/);
  assert.match(namedFormRefusal({ to: LB, slug: "a", body: "b", extent: { w: 1, h: 1 }, points: [] }).defect, /extent, points are for a mark on the ground/);
  const both = namedFormRefusal({ to: LB, kind: "candy", count: 2, slug: "a", body: "b" });
  assert.match(both.defect, /count makes that many alike, with nothing of their own, and slug, body are one thing's own/);
  assert.match(both.hint, /leave-mark \{ kind, count, to \}.*leave-mark \{ slug, body, kind\?, to \}/);
  assert.match(namedFormRefusal({ to: LB, slug: "a", body: "b", parent_id: "x/y" }).hint, /its own predicated mark/);
  assert.match(namedFormRefusal({ to: LB, slug: "a", body: "b", amend: true }).defect, /carries no amend/);
  assert.match(namedFormRefusal({ to: LB, slug: "a", body: "b", stamps: 1 }).defect, /costs nothing, so there is nothing to stake/);
  assert.equal(namedFormRefusal({ to: LB, slug: "a", body: "b", stamps: 0 }), null, "stamps: 0 says nothing to refuse");
});

// ── MAKING ONE ──────────────────────────────────────────────────────────────

test("make into your own hands: ONE `make` act carrying the mark whole, held from that act, live and free", async () => {
  const o = office();
  const r = await make(o, LB, LB, "lucky-pebble", "A smooth grey pebble with a white ring around it.");
  assert.deepEqual([r.did, r.made, r.kind, r.to, r.live, r.stamps], ["make", `${LB}/lucky-pebble`, "thing", LB, true, 0]);
  assert.match(r.live_note, /made into your hands, live and free/);
  assert.equal(o.acts.length, 1);
  assert.deepEqual([o.acts[0].action, o.acts[0].object, o.acts[0].class], [MAKE_FACE, `${LB}/lucky-pebble`, "holding"]);
  assert.deepEqual(o.acts[0].payload.made, { id: `${LB}/lucky-pebble`, by: LB, slug: "lucky-pebble", kind: "thing", body: "A smooth grey pebble with a white ring around it." });
  assert.equal(o.acts[0].payload.policy, "cascade");
  assert.equal(o.acts[0].payload.previous_holder, null);
  // every reader: the hold row, and the one world the overlay lays it into, held and unplaced
  assert.deepEqual(o.holdRows().map((x) => [x.entity, x.target, x.policy]), [[LB, `${LB}/lucky-pebble`, "cascade"]]);
  const m = o.world().marks.find((x) => x.id === `${LB}/lucky-pebble`);
  assert.equal(m[HELD_BY], LB);
  assert.equal(m.at, undefined, "a held thing has no place");
  assert.equal(r.holds.count, 1);
});

test("a preview writes nothing and says what the make would be", async () => {
  const o = office();
  const r = await make(o, LB, LB, "maybe", "Not yet.", { preview: true });
  assert.equal(r.preview, true);
  assert.deepEqual([r.would.did, r.would.made, r.would.live], ["make", `${LB}/maybe`, true]);
  assert.equal(o.acts.length, 0);
});

test("THE RAFFLE: a named bag into your hands, numbered tickets into the bag, and the holder's draw from it lands on one ticket by name", async () => {
  const o = office();
  const bag = `${LB}/raffle-bag`;
  await make(o, LB, LB, "raffle-bag", "A paper bag of numbered raffle tickets.", { holder: { holder: true, capacity: 10 } });
  for (const n of [1, 2, 3]) {
    const r = await make(o, LB, bag, `ticket-${n}`, `Raffle ticket No. ${n}.`);
    assert.equal(r.to, bag);
    assert.match(r.live_note, /a holder confers its state on what it holds/);
  }
  assert.equal(o.world().marks.find((x) => x.id === `${LB}/ticket-2`)[HELD_BY], bag);
  // another resident does not take out of a holder someone carries (the standing law): the holder draws
  await assert.rejects(callKinds("take", { from: bag, count: 1 }, KEY(FIVE), FIVE, o.deps), (e) => /is in little-bird's hands/.test(e.defect));
  const r = await callKinds("take", { from: bag, count: 1 }, KEY(LB), LB, o.deps);
  assert.equal(r.whole.length, 1);
  const drawn = r.whole[0].thing;
  assert.match(drawn, new RegExp(`^${LB}/ticket-[123]$`), "the draw names the ticket");
  assert.equal(o.world().marks.find((x) => x.id === drawn)[HELD_BY], LB, "the drawn ticket is in the drawer's hands");
  assert.equal(o.holdRows().filter((x) => x.target !== bag && x.policy === "cascade").length, 4, "three makes into the bag, one take out");
});

test("G2 · a name is never reused: a second make of the same slug is refused, and so is one after the first is eaten", async () => {
  const o = office();
  await make(o, LB, LB, "comet", "A pocket comet of my own.", { kind: "pocket-comet" });
  await assert.rejects(make(o, LB, LB, "comet", "Again."), (e) => e.code === 409 && /made in hand, and its name is taken for good/.test(e.defect));
  await callKinds("consume", { thing: `${LB}/comet` }, KEY(LB), LB, o.deps);
  await assert.rejects(make(o, LB, LB, "comet", "Again, after eating."), (e) => e.code === 409);
  // a published thing once held carries its name too
  const p = office({ canon: [{ id: `${LB}/lamp`, by: LB, kind: "thing", at: { x: 1, y: 1 } }] });
  await p.deps.append({ cls: "holding", action: "take", object: `${LB}/lamp`, actor: LB, payload: { thing: `${LB}/lamp`, holder: LB, policy: "cascade" } });
  await assert.rejects(make(p, LB, LB, "lamp", "A second lamp."), (e) => e.code === 409);
});

test("the kind: a kind of thing its makers allow, a holder kind included; a non-thing or a town-only kind is refused, nothing made", async () => {
  const o = office();
  await assert.rejects(make(o, LB, LB, "a-note", "x", { kind: "note" }), (e) => /a note is not a thing/.test(e.defect) && /with to: off/.test(e.hint));
  await assert.rejects(make(o, LB, LB, "a-cart", "x", { kind: "vehicle" }), (e) => /the town's to make/.test(e.defect));
  assert.equal(o.acts.length, 0);
  const r = await make(o, LB, LB, "candy-bag", "My trick-or-treat bag.", { kind: "halloween-candy-bag" });
  assert.equal(r.kind, "halloween-candy-bag", "a holder kind is made named, so what it holds has somewhere to be");
});

test("G8 · hands hold 24: a named thing counts 1, and the 25th is refused whole", async () => {
  const o = office();
  await o.deps.append({ cls: "holding", action: UNIT_ACTION.make, object: LB, actor: LB, payload: { units: true, kinds: true, moves: [{ from: null, to: LB, kind: "pocket-comet", n: 23 }] } });
  await make(o, LB, LB, "the-24th", "The last one that fits.");
  await assert.rejects(make(o, LB, LB, "the-25th", "One too many."), (e) => e.code === 409);
  assert.equal(o.acts.filter((a) => a.action === MAKE_FACE).length, 1);
});

test("the holder: another resident is handed things by a give, and a holder in another's hands is not made into", async () => {
  const o = office();
  await assert.rejects(make(o, LB, FIVE, "gift", "For you."), (e) => /make it into yourself, then give/.test(e.defect));
  await make(o, FIVE, FIVE, "their-bag", "Five's bag.", { holder: { holder: true } });
  await assert.rejects(make(o, LB, `${FIVE}/their-bag`, "slip", "A slip of paper."), (e) => /in five-five's hands: make into yourself, then give/.test(e.defect));
  await assert.rejects(make(o, LB, `${LB}/nowhere`, "x", "y"), (e) => e.code === 404);
});

// ── EATING ONE (POS-766/f) ──────────────────────────────────────────────────

test("consume { thing } eats that one: its holding ends with no place, the overlay drops it, and it cannot be eaten twice", async () => {
  const o = office();
  await make(o, LB, LB, "ghost-drop", "A ghost-shaped sweet that tastes of mint.", { kind: "pocket-comet" });
  const r = await callKinds("consume", { thing: `${LB}/ghost-drop` }, KEY(LB), LB, o.deps);
  assert.deepEqual([r.did, r.thing, r.kind], ["consume", `${LB}/ghost-drop`, "pocket-comet"]);
  const eat = o.acts.at(-1);
  assert.deepEqual([eat.action, eat.payload.policy, eat.payload.consumed, eat.payload.holder], [CONSUME_FACE, "detach", true, null]);
  assert.equal(o.world().marks.some((x) => x.id === `${LB}/ghost-drop`), false, "eaten: gone from the world");
  await assert.rejects(callKinds("consume", { thing: `${LB}/ghost-drop` }, KEY(LB), LB, o.deps), (e) => /is gone: it was eaten/.test(e.defect));
});

test("consume { thing } refuses what was not made in hand, what is not a consumable, and what is not in your hands", async () => {
  const o = office();
  await make(o, LB, LB, "pebble", "Just a pebble.");
  await assert.rejects(callKinds("consume", { thing: `${LB}/pebble` }, KEY(LB), LB, o.deps), (e) => /a thing is not a consumable/.test(e.defect));
  await assert.rejects(callKinds("consume", { thing: `${LB}/not-made` }, KEY(LB), LB, o.deps), (e) => /was not made in hand/.test(e.defect));
  await make(o, LB, LB, "sweet", "A sweet.", { kind: "pocket-comet" });
  await assert.rejects(callKinds("consume", { thing: `${LB}/sweet` }, KEY(FIVE), FIVE, o.deps), (e) => /you are not holding .* little-bird is/.test(e.defect));
  assert.equal(o.acts.filter((a) => a.action === CONSUME_FACE).length, 0);
});

test("consume { kind } draws pot luck over the counted and the named alike: with only named ones in hand, a named one is eaten", async () => {
  const o = office();
  await make(o, LB, LB, "comet-a", "Mine, A.", { kind: "pocket-comet" });
  await make(o, LB, LB, "comet-b", "Mine, B.", { kind: "pocket-comet" });
  const r = await callKinds("consume", { kind: "pocket-comet" }, KEY(LB), LB, o.deps);
  assert.match(r.thing, /^little-bird\/comet-[ab]$/);
  assert.equal(r.draw, "pot luck within pocket-comet");
  // with counted ones beside them, every draw eats exactly one mark of the kind, counted or named
  await o.deps.append({ cls: "holding", action: UNIT_ACTION.make, object: LB, actor: LB, payload: { units: true, kinds: true, moves: [{ from: null, to: LB, kind: "pocket-comet", n: 3 }] } });
  const before = o.acts.length;
  for (let i = 0; i < 4; i++) await callKinds("consume", { kind: "pocket-comet" }, KEY(LB), LB, o.deps);
  const eats = o.acts.slice(before);
  assert.equal(eats.length, 4);
  assert.equal(eats.filter((a) => a.action === CONSUME_FACE).length, 1, "the one named left is eaten exactly once");
  assert.equal(eats.filter((a) => a.action === UNIT_ACTION.consume).length, 3);
  await assert.rejects(callKinds("consume", { kind: "pocket-comet" }, KEY(LB), LB, o.deps), (e) => e.code === 409);
});

// ── THE RECORD THE READERS SHARE ────────────────────────────────────────────

test("the store's reader: a make is a hold row (held), a consume ends it (detach); the frozen faces are unchanged", () => {
  assert.deepEqual(ATTACHMENT_ACTIONS, ["legacy:attachment", "give", "drop", "take", "make", "consume"]);
  const at = "2026-10-23T05:00:00.000Z";
  const m = attachmentRowOf({ id: 7, at, actor: LB, action: "make", payload: { thing: `${LB}/t`, holder: `${LB}/bag`, policy: "cascade", made: { id: `${LB}/t` } } });
  assert.deepEqual([m.era, m.row.entity, m.row.target, m.row.policy], ["live", `${LB}/bag`, `${LB}/t`, "cascade"]);
  const c = attachmentRowOf({ id: 8, at, actor: LB, action: "consume", payload: { thing: `${LB}/t`, holder: null, policy: "detach", consumed: true } });
  assert.deepEqual([c.row.entity, c.row.policy], [LB, "detach"]);
  assert.equal(attachmentRowOf({ id: 9, at, actor: LB, action: "make", payload: {} }).refused, true, "a make naming no thing is refused, as a give is");
});

test("the overlay: a held made mark is laid in with held_by and no place; an eaten one, or one canon holds, is not", () => {
  const made = new Map([[`${LB}/a`, { id: `${LB}/a`, by: LB, kind: "thing", body: "a" }], [`${LB}/b`, { id: `${LB}/b`, by: LB, kind: "thing", body: "b" }],
    [`${LB}/c`, { id: `${LB}/c`, by: LB, kind: "thing", body: "c" }]]);
  const attachments = [
    { entity: LB, target: `${LB}/a`, policy: "cascade", born_at: "2026-10-23T05:00:00Z" },
    { entity: LB, target: `${LB}/b`, policy: "cascade", born_at: "2026-10-23T05:00:01Z" },
    { entity: LB, target: `${LB}/b`, policy: "detach", born_at: "2026-10-23T05:00:02Z" },
    { entity: LB, target: `${LB}/c`, policy: "cascade", born_at: "2026-10-23T05:00:03Z" },
  ];
  const view = viewOf({ record: { attachments, made } });
  const canon = [{ id: `${LB}/c`, by: LB, kind: "thing", at: { x: 1, y: 1 } }];
  assert.deepEqual(heldMadeMarks(view, canon).map((m) => [m.id, m[HELD_BY]]), [[`${LB}/a`, LB]]);
  const w = unplaceHeld({ marks: canon }, view);
  assert.deepEqual(w.marks.map((m) => m.id).sort(), [`${LB}/a`, `${LB}/c`]);
  assert.equal(unplaceHeld({ marks: [] }, viewOf({ record: { attachments: [] } })).marks.length, 0, "no made record: nothing laid in");
});

test("the fold keeps every make, eaten or not, and only a make whose record names its own id", () => {
  const rows = [
    { seq: 1, action: "make", object: `${LB}/a`, payload: { thing: `${LB}/a`, made: { id: `${LB}/a`, kind: "thing" } } },
    { seq: 2, action: "consume", object: `${LB}/a`, payload: { thing: `${LB}/a`, consumed: true } },
    { seq: 3, action: "make", object: `${LB}/b`, payload: { thing: `${LB}/b`, made: { id: `${LB}/other`, kind: "thing" } } },
    { seq: 4, action: "give", object: `${LB}/c`, payload: { thing: `${LB}/c`, made: { id: `${LB}/c` } } },
  ];
  assert.deepEqual([...foldMade(rows).keys()], [`${LB}/a`]);
  const base = foldMade(rows.slice(0, 1));
  assert.deepEqual([...foldMade([{ seq: 5, action: "make", object: `${LB}/d`, payload: { made: { id: `${LB}/d` } } }], base).keys()], [`${LB}/a`, `${LB}/d`]);
  assert.equal(base.size, 1, "the base is copied, never mutated");
});

test("the kept hold record carries the made record through its base and its window", async () => {
  const holding = [];
  let top = 0;
  const keeper = holdRecordKeeper({ readTop: async () => top, readHolding: async ({ afterId = null } = {}) => holding.filter((r) => afterId == null || r.seq > afterId),
    readAttachments: async () => [], width: 1 });
  const add = (slug) => { top += 1; holding.push({ seq: top, action: "make", object: `${LB}/${slug}`, payload: { thing: `${LB}/${slug}`, made: { id: `${LB}/${slug}` } } }); };
  add("a"); add("b");
  assert.deepEqual([...(await keeper.now()).made.keys()].sort(), [`${LB}/a`, `${LB}/b`]);
  add("c"); add("d"); add("e");
  assert.deepEqual([...(await keeper.now()).made.keys()].sort(), ["a", "b", "c", "d", "e"].map((s) => `${LB}/${s}`), "the window moved into the base and nothing was lost");
});

test("ownership: a make into an open holder is its maker's put-in, so a draw from it passes ownership (the candy bowl's rule)", () => {
  const bag = `${LB}/raffle-bag`, t = `${LB}/ticket-1`;
  const events = ownershipEvents([
    { seq: 1, actor: LB, action: "make", object: t, payload: { thing: t, holder: bag, policy: "cascade" } },
  ]);
  const owners = foldOwners(events, { houseOf: (h) => `hh:${h}` });
  assert.deepEqual(owners.get(t).putIn, { holder: bag, by: LB });
  assert.equal(takeOwns(owners.get(t), { from: bag, actor: FIVE, open: true, houseOf: (h) => `hh:${h}` }), true);
});

test("the words: the set-down waits for part 2, and a taken name says it is taken for good", () => {
  const s = setDownNotYet(`${LB}/x`);
  assert.equal(s.code, 501);
  assert.match(s.hint, /give it to a resident or into a holder.*consume \{ thing: "little-bird\/x" \}.*Nothing was changed\./);
  assert.match(madeIdTaken(`${LB}/x`).hint, /keeps its name forever, eaten or not/);
  assert.deepEqual(madeRecordOf({ by: LB, slug: "bag", kind: "thing", body: " A bag. ", holderFields: { holder: true, capacity: 10 } }),
    { id: `${LB}/bag`, by: LB, slug: "bag", kind: "thing", body: "A bag.", holder: true, capacity: 10 });
});

test("the can-matrix teaches only what works: a thing made in hand is never offered a set-down (part 2), and a consumable one offers consume", async () => {
  const { usablePairs } = await import("../src/usable-verbs.mjs");
  const id = `${LB}/sweet`, plain = `${LB}/pebble`;
  const made = new Map([[id, { id, by: LB, kind: "pocket-comet", body: "a sweet" }], [plain, { id: plain, by: LB, kind: "thing", body: "a pebble" }]]);
  const attachments = [{ entity: LB, target: id, policy: "cascade", born_at: "2026-10-23T05:00:00Z" }, { entity: LB, target: plain, policy: "cascade", born_at: "2026-10-23T05:00:01Z" }];
  const marks = [...made.values()].map((m) => ({ ...m, [HELD_BY]: LB }));
  const verbs = (over = {}) => usablePairs({ actor: LB, here: { x: 0, y: 0 }, marks, fold: foldUnits([]), attachments, view: VIEW, made, ...over }).map((p) => p.verb);
  assert.equal(verbs().includes("drop"), false, "nothing in hand can be set down yet");
  assert.equal(verbs().includes("consume"), true, "the made sweet is eaten by consume");
  assert.equal(verbs({ made: new Map([[plain, made.get(plain)]]), attachments: attachments.slice(1), marks: marks.slice(1) }).includes("consume"), false, "a made pebble is not eaten");
  assert.equal(verbs({ made: null }).includes("drop"), true, "without the made record, a held thing offers its set-down as before");
});

test("#759 review C · a holder's room: making a named thing past its capacity is refused whole, nothing made", async () => {
  const o = office();
  const bag = `${LB}/small-bag`;
  await make(o, LB, LB, "small-bag", "A bag with room for two.", { holder: { holder: true, capacity: 2 } });
  await make(o, LB, bag, "slip-1", "Slip one.");
  await make(o, LB, bag, "slip-2", "Slip two.");
  const before = o.acts.length;
  await assert.rejects(make(o, LB, bag, "slip-3", "Slip three."), (e) => e.code === 409 && /has room for 0, not 1/.test(e.defect));
  assert.equal(o.acts.length, before, "nothing made");
  assert.equal(o.holdRows().filter((x) => x.entity === bag).length, 2);
});

test("#759 review A · the made names fail closed: an unread record is a refusal, never 'no such name'; where no hold record is kept, nothing was made", async () => {
  const { madeNamesRead, madeNamesUnread, MADE_NAMES_SQL, madeNamesParams } = await import("../src/named-making.mjs");
  const never = async () => { throw new Error("never asked"); };
  assert.deepEqual(await madeNamesRead({ ids: ["a/b"], edgeOn: () => false, query: never }), { made: new Map() });
  assert.deepEqual(await madeNamesRead({ ids: [], edgeOn: () => true, query: never }), { made: new Map() }, "no name, no read");
  let asked = null;
  const r = await madeNamesRead({ ids: ["a/b", "a/b", null], edgeOn: () => true, query: async (sql, params) => { asked = [sql, params];
    return [{ id: 7, action: "make", object: "a/b", payload: { thing: "a/b", made: { id: "a/b", kind: "thing" } } }]; } });
  assert.deepEqual([...r.made.keys()], ["a/b"]);
  assert.deepEqual(asked, [MADE_NAMES_SQL, madeNamesParams(["a/b"])]);
  assert.match((await madeNamesRead({ ids: ["a/b"], edgeOn: () => true, query: async () => { throw new Error("connection refused"); } })).unread, /the record did not answer/);
  assert.equal((await madeNamesRead({ ids: ["a/b"], edgeOn: () => true, query: async () => { throw new Error("x"); }, reasonOf: () => "said by the caller" })).unread, "said by the caller");
  assert.match((await madeNamesRead({ ids: ["a/b"], edgeOn: () => true, query: async () => null })).unread, /not pointed at the record/);
  const u = madeNamesUnread("the record could not be reached");
  assert.equal(u.code, 503);
  assert.match(u.hint, /nothing was written/);
});
