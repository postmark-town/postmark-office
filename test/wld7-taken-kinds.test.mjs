// wld7-taken-kinds.test.mjs — a class taken by the town's own act, at every kind door (WLD-7).
//
// While a class's record says `dials.stolen: true`, every act that makes, moves or
// uses up something of that class (or of a class under it) refuses with the class's
// own clue (423) and records nothing; when the record stops saying so, the same acts
// work again. One question for every door (world-stacks.mjs § stolenClassRefusal),
// asked INSIDE the turn of the law of that moment. Built from Jetto's refit
// (58b633b8), ported to the kind doors of LOGOS v2 part 2.
//
// The fixture's taken class is a stub, `trinket`, with a synthetic clue. The rig is
// kind-door.test.mjs's: `callKinds` with every collaborator injected.
//
// THE CAN-FAIL FLIPS (each reds a case below): drop the make guard; drop the take
// guard's draw; judge a whole thing by its own class only (not what it carries);
// read `taken` as stolen; ask the door's view instead of the turn's law.

import { test } from "node:test";
import assert from "node:assert/strict";
import { callKinds } from "../src/world-kinds.mjs";
import { classViewOf } from "../src/world-units.mjs";
import { UNIT_ACTION, foldUnits, kindEdgesOf, stolenRefusal, stolenClassRefusal } from "../src/world-stacks.mjs";
import { lawSnapshotFromRows } from "../src/law-classes.mjs";

const SHA = "c".repeat(40);
const CLUE = "Not a single trinket is left in town.";
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property",
  key: parent ? `${klass}/${parent}/${name}` : `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const BOWL_ACTIONS = [{ action: "refill", who: "maker", from: "reach", effect: "leave-mark { kind, count, to: this bowl }", residue: "the-town/leave-mark" }];
/** The law, with `trinket` carrying `dials` (taken, or not). */
const lawWith = (trinketDials = {}) => lawSnapshotFromRows([
  cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }),
  cls("thing", { extends: "sited" }), cls("consumable", { extends: "thing" }),
  cls("trinket", { extends: "consumable", dials: trinketDials }), cls("glass-bead", { extends: "trinket" }),
  cls("biscuit", { extends: "consumable" }), cls("toaster", { extends: "thing" }),
  cls("entity", { extends: "postmark-node" }), cls("resident", { extends: "entity" }),
  cls("satchel", { extends: "thing" }), cls("bowl", { extends: "thing", actions: JSON.stringify(BOWL_ACTIONS) }),
  prop("postmark-node", "makers", false, "constitution"), prop("sited", "makers", true, "constitution"), prop("thing", "makers", true, "constitution"),
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"),
  prop("thing", "min", 1, "constitution", "capacity"), prop("thing", "max", 120, "constitution", "capacity"),
  prop("thing", "open", true, "sovereign", "holder"), prop("thing", "portable", true, "sovereign"),
  prop("satchel", "holder", true, "constitution"), prop("bowl", "holder", true, "constitution"),
]);
const ORDINARY = lawWith({});
const TAKEN = lawWith({ stolen: true, clue: CLUE });

const BOWL = "sbx-ana/the-bowl", SATCHEL = "sbx-cy/a-satchel", BEAD = "sbx-cy/a-bead", TOASTER = "sbx-cy/a-toaster";
const MARKS = {
  [BOWL]: { id: BOWL, by: "sbx-ana", kind: "bowl", at: { x: 8, y: 6 } },
  [SATCHEL]: { id: SATCHEL, by: "sbx-cy", kind: "satchel", at: { x: 5, y: 6 } },
  [BEAD]: { id: BEAD, by: "sbx-cy", kind: "glass-bead", at: { x: 5, y: 6 } },
  [TOASTER]: { id: TOASTER, by: "sbx-cy", kind: "toaster", at: { x: 5, y: 6 } },
};

/** The kind door's rig; `law` is a function, read at every call, so a test can move the law between the door and the turn. */
function world({ things = [], law = () => ORDINARY } = {}) {
  const acts = [];
  const deps = {
    classes: () => classViewOf(law()),
    readRows: async () => ({ units: acts.slice(), attachments: things }),
    markById: async (id) => MARKS[id] ?? null,
    reachTake: async () => ({ reach: { stands: true } }),
    reachGive: async () => ({ stands: true }),
    standpoint: async () => ({ x: 5, y: 6 }),
    householdOf: (h) => ({ key: `hh:${h}`, house: `hh:${h}` }),
    append: async (entry, { also = [] } = {}) => { const id = acts.length + 100; for (const e of [entry, ...also]) acts.push({ id: acts.length + 100, class: e.cls, action: e.action, object: e.object, actor: e.actor, at: e.at, payload: e.payload, effect: e.effect }); return { actId: id }; },
    stamp: async (actor) => ({ at: `2026-10-21T06:00:00Z@${actor}#${acts.length}`, witnesses: [] }),
    crossing: () => 265,
    household: () => "hh:test",
  };
  const seed = (moves) => acts.push({ id: acts.length + 100, class: "holding", action: UNIT_ACTION.make, object: null, payload: { units: true, moves } });
  return { deps, acts, seed, fold: () => foldUnits(acts) };
}
const KEY = (h) => ({ handles: new Set([h]) });
const go = (w, route, args, actor = "sbx-cy") => callKinds(route, args, KEY(actor), actor, w.deps);
const refusedTaken = (klass) => (e) => e.code === 423 && e.defect === CLUE
  && e.hint === `the ${klass} has been stolen; nothing moves until it is returned. Nothing was recorded.` && e.stolen === klass;

// ── the one question ────────────────────────────────────────────────────────

test("the question: only `stolen: true` takes a class; its sub-classes with it; an unknown class is never refused; nothing taken, nothing refused", () => {
  const view = classViewOf(TAKEN);
  assert.equal(view.stolenAny(), true);
  assert.ok(refusedTaken("trinket")(stolenClassRefusal("glass-bead", view)), "a glass bead is a trinket");
  assert.equal(stolenClassRefusal("biscuit", view), null);
  assert.equal(stolenClassRefusal(undefined, view), null, "cannot be told: its ordinary day's answer (Darko 2026-10-13 17:57)");
  assert.equal(stolenClassRefusal("no-such-class", view), null);
  assert.equal(stolenClassRefusal(null, view), null, "a plain thing");
  for (const dials of [{ taken: true, clue: CLUE }, { stolen: "true", clue: CLUE }, { stolen: false }, {}])
    assert.equal(stolenClassRefusal("glass-bead", classViewOf(lawWith(dials))), null, JSON.stringify(dials));
  const up = (c) => ({ "glass-bead": "trinket" }[c] ?? null);
  assert.equal(stolenRefusal("glass-bead", (c) => (c === "trinket" ? { dials: { stolen: true } } : { dials: {} }), up).defect,
    "the trinket has been stolen.", "no clue: the class's own name in the fallback");
  // NO ALIAS, asked of the hook itself: `taken` is not stolen, and only the boolean is
  for (const dials of [{ taken: true }, { stolen: "true" }, { stolen: 1 }])
    assert.equal(stolenRefusal("glass-bead", (c) => (c === "trinket" ? { dials } : { dials: {} }), up), null, JSON.stringify(dials));
});

// ── making ──────────────────────────────────────────────────────────────────

test("make into yourself or a holder refuses while taken, records nothing, and works once returned; another kind is made as usual", async () => {
  let law = TAKEN;
  const w = world({ law: () => law });
  await assert.rejects(go(w, "make", { kind: "glass-bead", count: 2, to: "sbx-cy" }), refusedTaken("trinket"));
  await assert.rejects(go(w, "make", { kind: "glass-bead", count: 2, to: BOWL }, "sbx-ana"), refusedTaken("trinket"));
  assert.equal(w.acts.length, 0, "nothing was recorded");
  await go(w, "make", { kind: "biscuit", count: 2, to: "sbx-cy" });
  law = ORDINARY;
  await go(w, "make", { kind: "glass-bead", count: 2, to: "sbx-cy" });
  assert.deepEqual(kindEdgesOf(w.fold(), "sbx-cy"), [{ kind: "biscuit", count: 2 }, { kind: "glass-bead", count: 2 }]);
});

test("the bowl's refill is a make: it refuses while the kind's class is taken", async () => {
  const w = world({ law: () => TAKEN });
  await assert.rejects(go(w, "refill", { kind: "glass-bead", count: 3, thing: BOWL }, "sbx-ana"), refusedTaken("trinket"));
  await go(w, "refill", { kind: "biscuit", count: 3, thing: BOWL }, "sbx-ana");
});

// ── moving and using up ─────────────────────────────────────────────────────

test("take by kind, give by kind, consume and offer refuse while taken and write nothing; the same holding moves once returned", async () => {
  let law = ORDINARY;
  const w = world({ law: () => law });
  w.seed([{ from: null, to: BOWL, kind: "glass-bead", n: 5 }, { from: null, to: "sbx-cy", kind: "glass-bead", n: 4 }, { from: null, to: "sbx-cy", kind: "biscuit", n: 4 }]);
  law = TAKEN;
  const before = w.acts.length;
  await assert.rejects(go(w, "take", { from: BOWL, kind: "glass-bead", count: 1 }), refusedTaken("trinket"));
  await assert.rejects(go(w, "take", { from: BOWL, count: 1 }), refusedTaken("trinket"), "pot luck over a bowl of nothing else draws a taken kind");
  await assert.rejects(go(w, "give", { to: BOWL, kind: "glass-bead", count: 1 }), refusedTaken("trinket"));
  await assert.rejects(go(w, "give", { to: "sbx-dee", kind: "glass-bead", count: 1 }), refusedTaken("trinket"));
  await assert.rejects(go(w, "consume", { kind: "glass-bead" }), refusedTaken("trinket"));
  await assert.rejects(go(w, "offer", { kind: "glass-bead", creature: "creature:wolf-265-1" }), refusedTaken("trinket"));
  assert.equal(w.acts.length, before, "nothing was recorded");
  // another kind moves as on any day
  await go(w, "give", { to: BOWL, kind: "biscuit", count: 1 });
  await go(w, "consume", { kind: "biscuit" });
  law = ORDINARY;
  await go(w, "take", { from: BOWL, kind: "glass-bead", count: 1 });
  await go(w, "consume", { kind: "glass-bead" });
  await go(w, "offer", { kind: "glass-bead", creature: "creature:wolf-265-1" });
});

// ── whole things ────────────────────────────────────────────────────────────

test("a whole thing of a taken class neither goes into a holder nor comes out; a satchel CARRYING one is refused with it; a toaster passes", async () => {
  const inHand = (t) => ({ entity: "sbx-cy", target: t, policy: "cascade", born_at: "2026-10-20T00:00:00Z" });
  const w = world({ law: () => TAKEN, things: [inHand(BEAD), inHand(TOASTER), inHand(SATCHEL)] });
  await assert.rejects(go(w, "thing-into-holder", { thing: BEAD, to: BOWL }), refusedTaken("trinket"));
  await go(w, "thing-into-holder", { thing: TOASTER, to: BOWL });
  // a satchel holding glass beads (a kind) is refused whole: moving it moves them
  const s = world({ law: () => TAKEN, things: [inHand(SATCHEL)] });
  s.seed([{ from: null, to: SATCHEL, kind: "glass-bead", n: 2 }]);
  await assert.rejects(go(s, "thing-into-holder", { thing: SATCHEL, to: BOWL }), refusedTaken("trinket"));
  // and out of a holder
  const out = world({ law: () => TAKEN, things: [{ entity: BOWL, target: BEAD, policy: "cascade", born_at: "2026-10-20T00:00:00Z" }] });
  await assert.rejects(go(out, "thing-from-holder", { thing: BEAD, from: BOWL }), refusedTaken("trinket"));
});

// ── the turn's own law ──────────────────────────────────────────────────────

test("asked of the turn's law, not the door's: a make that came in before the take is refused in its turn; one that came in while taken, after the return, goes through", async () => {
  // the door reads the law once (callKinds' view), the turn reads it again: move the law between them
  let calls = 0;
  const w = world({ law: () => (calls++ === 0 ? ORDINARY : TAKEN) });
  await assert.rejects(go(w, "make", { kind: "glass-bead", count: 1, to: "sbx-cy" }), refusedTaken("trinket"));
  let calls2 = 0;
  const v = world({ law: () => (calls2++ === 0 ? TAKEN : ORDINARY) });
  await go(v, "make", { kind: "glass-bead", count: 1, to: "sbx-cy" });
  assert.deepEqual(kindEdgesOf(v.fold(), "sbx-cy"), [{ kind: "glass-bead", count: 1 }]);
});
