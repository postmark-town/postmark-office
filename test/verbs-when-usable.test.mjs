// verbs-when-usable.test.mjs — LOGOS v2 part 2, lane O2: take, give, drop and
// refill show only when usable, and investigate's `can` is the matrix's column.
//
// SITTING 2026-10-16 10:30–10:36 and 12:01, ruled: "`can` is the verbs alone,
// each listed once … object agnostic"; "investigate(m).can = the verbs in the
// bare `can` that apply to m". THE INVARIANT, restated at 10:36: the verbs in
// `can` equal the object-less verbs plus the union of investigate(m).can over
// every mark in view. Falsifiers 22–26 of O2's list.

import { test } from "node:test";
import assert from "node:assert/strict";
import { usablePairs, canVerbs, canOn, objectlessVerbs, onlyUsable, HOLD_VERBS, portableOf } from "../src/usable-verbs.mjs";
import { classViewOf } from "../src/world-units.mjs";
import { foldUnits, UNIT_ACTION } from "../src/world-stacks.mjs";
import { lawSnapshotFromRows } from "../src/law-classes.mjs";

const SHA = "c".repeat(40);
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property",
  key: `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const VIEW = classViewOf(lawSnapshotFromRows([
  cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }), cls("thing", { extends: "sited" }),
  cls("consumable", { extends: "thing" }), cls("candy", { extends: "consumable" }), cls("pocket-comet", { extends: "candy" }), cls("entity", { extends: "postmark-node" }), cls("resident", { extends: "entity" }),
  cls("halloween-candy-bowl", { extends: "thing", actions: [{ action: "refill", who: "maker", from: "reach" }] }),
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"), prop("thing", "open", true, "sovereign", "holder"),
  prop("thing", "portable", true, "sovereign"), prop("halloween-candy-bowl", "holder", true, "constitution"),
]));

const HERE = { x: 0, y: 0 };
const mk = (id, over = {}) => ({ id, by: id.split("/")[0], kind: "thing", at: { x: 1, y: 1 }, extent: { w: 2, h: 2 }, ...over });
const make = (to, n, kind = "pocket-comet") => ({ class: "holding", action: UNIT_ACTION.make, payload: { moves: [{ from: null, to, kind, n }] } });
const held = (thing, entity) => ({ entity, target: thing, policy: "cascade" });
const pairsOf = (o) => usablePairs({ actor: "cy", here: HERE, view: VIEW, householdOf: (h) => ({ key: h, house: h }), fold: foldUnits(o.units ?? []), attachments: o.attachments ?? [], marks: o.marks ?? [], residents: o.residents ?? [] });

test("22 · take shows only with a takeable in reach: a portable thing on the ground, or a holder holding something it lets you take from", () => {
  assert.deepEqual(canVerbs(pairsOf({})), [], "nothing in view, nothing carried: no hold verb");
  assert.deepEqual(canVerbs(pairsOf({ marks: [mk("ana/a-lamp")] })), ["take"]);
  assert.deepEqual(canVerbs(pairsOf({ marks: [mk("ana/a-lamp", { at: { x: 400, y: 0 } })] })), [], "out of reach");
  assert.deepEqual(canVerbs(pairsOf({ marks: [mk("ana/a-lamp", { portable: false })] })), [], "a thing its maker made not portable");
  assert.equal(portableOf(mk("ana/a-lamp"), VIEW), true, "portable is sovereign, default true");
  const fixedBowl = mk("ana/bowl", { kind: "halloween-candy-bowl", portable: false });
  assert.deepEqual(canVerbs(pairsOf({ marks: [fixedBowl] })), [], "an empty fixed bowl: nothing to take");
  assert.deepEqual(canVerbs(pairsOf({ marks: [fixedBowl], units: [make("ana/bowl", 3)] })), ["take"]);
  const shut = mk("ana/crate", { holder: true, open: false, portable: false });
  assert.deepEqual(canVerbs(pairsOf({ marks: [shut], units: [make("ana/crate", 3)] })), [], "not open to another household");
});

test("22 · give shows only while carrying with a receiver in reach; drop only while carrying", () => {
  const carrying = { units: [make("cy", 2, "thing")] }; // a thing that is not a consumable, so consume stays out of view
  assert.deepEqual(canVerbs(pairsOf({ ...carrying })), ["drop"], "carrying, nobody to give to");
  assert.deepEqual(canVerbs(pairsOf({ ...carrying, residents: [{ handle: "dee", distance_m: 3 }] })), ["give", "drop"]);
  assert.deepEqual(canVerbs(pairsOf({ ...carrying, residents: [{ handle: "dee", distance_m: 300 }] })), ["drop"], "beyond arm's length");
  assert.deepEqual(canVerbs(pairsOf({ residents: [{ handle: "dee", distance_m: 3 }] })), [], "nothing carried: no give, no drop");
  const bowl = mk("ana/bowl", { kind: "halloween-candy-bowl", portable: false });
  assert.deepEqual(canVerbs(pairsOf({ ...carrying, marks: [bowl] })), ["give", "drop"], "a holder with room in reach receives");
  assert.deepEqual(canVerbs(pairsOf({ ...carrying, marks: [bowl], units: [...carrying.units, make("ana/bowl", 30)] })), ["take", "drop"], "a full holder takes no give");
});

test("22 · refill shows only at, or carrying, a holder you made whose class affords it", () => {
  const mine = mk("cy/bowl", { kind: "halloween-candy-bowl", portable: false });
  assert.deepEqual(canVerbs(pairsOf({ marks: [mine] })), ["refill"]);
  assert.deepEqual(canVerbs(pairsOf({ marks: [mk("ana/bowl", { kind: "halloween-candy-bowl", portable: false })] })), [], "another's bowl: not its maker");
  assert.deepEqual(canVerbs(pairsOf({ marks: [mk("cy/crate", { holder: true, portable: false })] })), [], "a holder whose class declares no refill");
  const carried = mk("cy/bowl", { kind: "halloween-candy-bowl", at: { x: 900, y: 900 } });
  assert.ok(canVerbs(pairsOf({ marks: [carried], attachments: [held("cy/bowl", "cy")] })).includes("refill"), "carrying it is at it");
});

test("23 · investigate(m).can is m's column", () => {
  const p = pairsOf({ units: [make("cy", 1), make("cy/bowl", 2)], marks: [mk("cy/bowl", { kind: "halloween-candy-bowl", portable: false }), mk("ana/a-lamp")], residents: [{ handle: "dee", distance_m: 2 }] });
  assert.deepEqual(canOn(p, "cy/bowl"), ["take", "give", "refill"]);
  assert.deepEqual(canOn(p, "ana/a-lamp"), ["take"]);
  assert.deepEqual(canOn(p, "dee"), ["give"]);
  assert.deepEqual(canOn(p, "nowhere/at-all"), []);
});

// a small deterministic generator: busy rooms, each a different mix
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function busyRoom(seed) {
  const r = lcg(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const marks = [], units = [], attachments = [];
  for (let i = 0; i < 12; i++) {
    const by = pick(["cy", "ana", "bo"]);
    const id = `${by}/m${i}`;
    const kind = pick(["thing", "halloween-candy-bowl", "thing", "candy"]);
    const over = { kind, at: { x: Math.round(r() * 60) - 30, y: Math.round(r() * 60) - 30 } };
    if (r() < 0.3) over.portable = false;
    if (kind === "thing" && r() < 0.4) Object.assign(over, { holder: true, capacity: 1 + Math.floor(r() * 6), open: r() < 0.5 });
    marks.push(mk(id, over));
    if (r() < 0.5) units.push(make(id, 1 + Math.floor(r() * 5)));
    if (r() < 0.15) attachments.push(held(id, pick(["cy", "ana"])));
  }
  if (r() < 0.6) units.push(make("cy", 1 + Math.floor(r() * 4)));
  const residents = ["dee", "eli", "fay"].map((handle) => ({ handle, distance_m: Math.round(r() * 40) }));
  return { marks, units, attachments, residents };
}

test("24 · THE INVARIANT over busy rooms: can = the object-less verbs ∪ every investigate(m).can over the marks and residents in view; investigate(m).can ⊆ can", () => {
  let shown = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const room = busyRoom(seed);
    const p = pairsOf(room);
    const can = canVerbs(p);
    const objects = [...room.marks.map((m) => m.id), ...room.residents.map((x) => x.handle)];
    const union = new Set(objectlessVerbs(p));
    for (const o of objects) {
      const col = canOn(p, o);
      for (const v of col) { assert.ok(can.includes(v), `seed ${seed}: ${v} on ${o} is in investigate's can but not the read's`); union.add(v); }
    }
    assert.deepEqual(HOLD_VERBS.filter((v) => union.has(v)), can, `seed ${seed}: the read's can and the union of the columns differ`);
    // each verb once
    assert.equal(new Set(can).size, can.length);
    shown += can.length;
  }
  assert.ok(shown > 200, "the rooms are busy enough to show verbs");
});

test("25 + 26 · the read's actions are trimmed to what is usable; the always-on roster and every other act pass untouched", () => {
  const entries = ["walk", "say", "note-to-self", "leave-mark", "take", "give", "drop", "refill", "enter", "stake"].map((action) => ({ action }));
  assert.deepEqual(onlyUsable(entries, []).map((e) => e.action), ["walk", "say", "note-to-self", "leave-mark", "enter", "stake"]);
  const p = pairsOf({ units: [make("cy", 1)] });
  assert.deepEqual(onlyUsable(entries, p).map((e) => e.action), ["walk", "say", "note-to-self", "leave-mark", "drop", "enter", "stake"]);
});

test("22 · consume shows only with a consumable kind in your own hands", () => {
  assert.ok(canVerbs(pairsOf({ units: [make("cy", 1, "pocket-comet")] })).includes("consume"));
  assert.ok(!canVerbs(pairsOf({ units: [make("cy", 1, "thing")] })).includes("consume"), "a thing that is not a consumable");
  assert.ok(!canVerbs(pairsOf({})).includes("consume"));
});
