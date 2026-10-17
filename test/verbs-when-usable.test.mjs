// verbs-when-usable.test.mjs — LOGOS v2 part 2, lane O2: take, give, drop,
// consume and refill show only when usable, and investigate's `can` is the
// matrix's column.
//
// SITTING 2026-10-16 10:30–10:36 and 12:01, ruled: "`can` is the verbs alone,
// each listed once … object agnostic"; "investigate(m).can = the verbs in the
// bare `can` that apply to m"; the verbs in `can` equal the object-less verbs
// plus the union of investigate(m).can over every mark in view. Falsifiers
// 22–26 of O2's list.
//
// THE DIFFERENTIAL (review-610 B3): the matrix is held to the DOORS. Over
// generated rooms, every (verb, object) the matrix shows is driven through the
// kind door and must land, and every one it hides must be refused — with the
// real reach (reach.mjs § standsWithin, withinArmsLength), never an admit-all.
//
// AND THE MATRIX SEES WHAT THE APEX HANDS IT (the playground's QA, PART2-MCP-QA fail 4). The
// differential used to hand the matrix every mark in the room, while the apex handed it only what
// the eyes see (`nearby`). A bowl you stand ON is in your spine (`within`), never in `nearby`,
// so the bowl's take, give and refill landed at their doors while the read hid them, and 120 rooms
// never put a holder under the reader's feet. Now the rooms do, and the differential's matrix is
// handed the apex's own gathering (usable-verbs § viewMarkIds over the room's spine and its eyes).

import { test } from "node:test";
import assert from "node:assert/strict";
import { usablePairs, canVerbs, canOn, objectlessVerbs, onlyUsable, HOLD_VERBS, portableOf, viewMarkIds } from "../src/usable-verbs.mjs";
import { callKinds } from "../src/world-kinds.mjs";
import { classViewOf } from "../src/world-units.mjs";
import { foldUnits, UNIT_ACTION } from "../src/world-stacks.mjs";
import { lawSnapshotFromRows } from "../src/law-classes.mjs";
import { liveHolder } from "../src/world-hold.mjs";
import { standsWithin, withinArmsLength } from "../src/reach.mjs";

const SHA = "c".repeat(40);
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property",
  key: `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const VIEW = classViewOf(lawSnapshotFromRows([
  cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }), cls("thing", { extends: "sited" }),
  cls("consumable", { extends: "thing" }), cls("candy", { extends: "consumable" }), cls("pocket-comet", { extends: "candy" }),
  cls("entity", { extends: "postmark-node" }), cls("resident", { extends: "entity" }),
  cls("halloween-candy-bowl", { extends: "thing", actions: [{ action: "refill", who: "maker", from: "reach" }] }),
  prop("postmark-node", "makers", false, "constitution"), prop("thing", "makers", true, "constitution"),
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"),
  prop("thing", "min", 1, "constitution", "capacity"), prop("thing", "max", 120, "constitution", "capacity"),
  prop("thing", "open", true, "sovereign", "holder"),
  prop("thing", "portable", true, "sovereign"), prop("halloween-candy-bowl", "holder", true, "constitution"),
]));

const HERE = { x: 0, y: 0 };
const mk = (id, over = {}) => ({ id, by: id.split("/")[0], kind: "thing", at: { x: 1, y: 1 }, extent: { w: 2, h: 2 }, ...over });
const make = (to, n, kind = "pocket-comet") => ({ class: "holding", action: UNIT_ACTION.make, payload: { moves: [{ from: null, to, kind, n }] } });
const held = (thing, entity) => ({ entity, target: thing, policy: "cascade", born_at: "2026-10-17T00:00:00Z" });
const house = (h) => ({ key: h, house: h });
// PRESENCE-SHAPED ROWS for the matrix (F4): the bare read hands it presence's `{ handle, distance_m }`; the doors measure positions
const presenceOf = (residents = []) => residents.map((r) => (Number.isFinite(Number(r.x)) ? { handle: r.handle, distance_m: Math.round(Math.hypot(Number(r.x) - HERE.x, Number(r.y) - HERE.y)) } : r));
const pairsOf = (o) => usablePairs({ actor: "cy", here: HERE, view: VIEW, householdOf: house, fold: foldUnits(o.units ?? []), attachments: o.attachments ?? [], marks: o.marks ?? [], residents: presenceOf(o.residents), places: o.places ?? null });

test("22 · take shows only with a takeable in reach and a slot to carry it", () => {
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
  // B3: a full carry shows no take at all
  assert.deepEqual(canVerbs(pairsOf({ marks: [fixedBowl, mk("ana/a-lamp")], units: [make("ana/bowl", 3), make("cy", 24, "thing")] })), ["give"], "24 of 24 carried: nothing more is taken (the bowl may still be given into)");
});

test("22 · B3: a whole mark inside an open holder in reach carries its own take (11:55)", () => {
  const bowl = mk("ana/bowl", { kind: "halloween-candy-bowl", portable: false });
  const p = pairsOf({ marks: [bowl, mk("ana/a-lamp", { at: { x: 900, y: 900 } })], attachments: [held("ana/a-lamp", "ana/bowl")] });
  assert.deepEqual(canOn(p, "ana/a-lamp"), ["take"]);
  assert.deepEqual(canOn(p, "ana/bowl"), ["take"]);
});

test("22 · give shows only while carrying with a receiver in reach that has a slot or room; drop only with a whole thing in hand", () => {
  const kinds = { units: [make("cy", 2, "thing")] };
  assert.deepEqual(canVerbs(pairsOf({ ...kinds })), [], "counted kinds in hand and nobody to give to: no drop (a set-down by kind is not built)");
  assert.deepEqual(canVerbs(pairsOf({ ...kinds, residents: [{ handle: "dee", x: 3, y: 0 }] })), ["give"]);
  assert.deepEqual(canVerbs(pairsOf({ ...kinds, residents: [{ handle: "dee", x: 300, y: 0 }] })), [], "beyond arm's length");
  assert.deepEqual(canVerbs(pairsOf({ ...kinds, residents: [{ handle: "dee", x: 3, y: 0 }], units: [...kinds.units, make("dee", 24, "thing")] })), [], "the receiver carries 24");
  assert.deepEqual(canVerbs(pairsOf({ residents: [{ handle: "dee", x: 3, y: 0 }] })), [], "nothing carried: no give, no drop");
  const lampInHand = { marks: [mk("cy/a-lamp")], attachments: [held("cy/a-lamp", "cy")] };
  assert.deepEqual(canVerbs(pairsOf(lampInHand)), ["drop"], "a whole thing in hand drops");
  const bowl = mk("ana/bowl", { kind: "halloween-candy-bowl", portable: false });
  assert.deepEqual(canVerbs(pairsOf({ ...kinds, marks: [bowl] })), ["give"], "a holder with room in reach receives");
  assert.deepEqual(canVerbs(pairsOf({ ...kinds, marks: [bowl], units: [...kinds.units, make("ana/bowl", 30)] })), ["take"], "a full holder takes no give");
});

test("22 · refill shows only at, or carrying, a holder you made whose class affords it, and with room", () => {
  const mine = mk("cy/bowl", { kind: "halloween-candy-bowl", portable: false });
  assert.deepEqual(canVerbs(pairsOf({ marks: [mine] })), ["refill"]);
  assert.deepEqual(canVerbs(pairsOf({ marks: [mine], units: [make("cy/bowl", 30)] })), ["take"], "B3: a full bowl shows no refill");
  assert.deepEqual(canVerbs(pairsOf({ marks: [mk("ana/bowl", { kind: "halloween-candy-bowl", portable: false })] })), [], "another's bowl: not its maker");
  assert.deepEqual(canVerbs(pairsOf({ marks: [mk("cy/crate", { holder: true, portable: false })] })), [], "a holder whose class declares no refill");
  const carried = mk("cy/bowl", { kind: "halloween-candy-bowl", at: { x: 900, y: 900 } });
  assert.ok(canVerbs(pairsOf({ marks: [carried], attachments: [held("cy/bowl", "cy")] })).includes("refill"), "carrying it is at it");
});

test("22 · consume shows only with a consumable kind in your own hands", () => {
  assert.ok(canVerbs(pairsOf({ units: [make("cy", 1, "pocket-comet")] })).includes("consume"));
  assert.ok(!canVerbs(pairsOf({ units: [make("cy", 1, "thing")] })).includes("consume"), "a thing that is not a consumable");
  assert.ok(!canVerbs(pairsOf({})).includes("consume"));
});

test("23 · investigate(m).can is m's column", () => {
  const p = pairsOf({ units: [make("cy", 1), make("cy/bowl", 2)], marks: [mk("cy/bowl", { kind: "halloween-candy-bowl", portable: false }), mk("ana/a-lamp")], residents: [{ handle: "dee", x: 2, y: 0 }] });
  assert.deepEqual(canOn(p, "cy/bowl"), ["take", "give", "refill"]);
  assert.deepEqual(canOn(p, "ana/a-lamp"), ["take"]);
  assert.deepEqual(canOn(p, "dee"), ["give"]);
  assert.deepEqual(canOn(p, "nowhere/at-all"), []);
});

// ── the generated rooms ─────────────────────────────────────────────────────
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function busyRoom(seed) {
  const r = lcg(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const marks = [], units = [], attachments = [];
  const holders = [];
  for (let i = 0; i < 8; i++) {
    const by = pick(["cy", "ana", "bo"]);
    const id = `${by}/h${i}`;
    // holders are fixed (portable: false), so a shown take on one is its contents', the kind door's
    const over = r() < 0.5 ? { kind: "halloween-candy-bowl" } : { kind: "thing", holder: true, capacity: 1 + Math.floor(r() * 6), open: r() < 0.5 };
    marks.push(mk(id, { ...over, portable: false, at: { x: Math.round(r() * 40) - 20, y: Math.round(r() * 40) - 20 } }));
    holders.push(id);
    if (r() < 0.5) units.push(make(id, 1 + Math.floor(r() * 5), pick(["pocket-comet", "thing"])));
  }
  // whole marks: in a holder, or in cy's hands (never on the ground: the ground take is the thing door's)
  for (let i = 0; i < 5; i++) {
    const id = `${pick(["cy", "ana"])}/w${i}`;
    marks.push(mk(id, { at: { x: 500, y: 500 } }));
    attachments.push(held(id, r() < 0.4 ? "cy" : pick(holders)));
  }
  // a holder in cy's hands, sometimes; one in another's hands, sometimes
  if (r() < 0.4) attachments.push(held(holders[0], "cy"));
  if (r() < 0.4) attachments.push(held(holders[1], "dee"));
  if (r() < 0.4) units.push(make(holders[2], 30)); // a full one: no give into it, no refill of it
  // SET-DOWN HOLDERS (F3): made far off and set down near, or made near and set down far — judged where they were set down
  const places = new Map();
  if (r() < 0.5) { marks.find((m) => m.id === holders[3]).at = { x: 600, y: 600 }; places.set(holders[3], { x: Math.round(r() * 8), y: 0 }); }
  if (r() < 0.5) { marks.find((m) => m.id === holders[4]).at = { x: 1, y: 1 }; places.set(holders[4], { x: 700, y: 0 }); }
  if (r() < 0.6) units.push(make("cy", 1 + Math.floor(r() * 4), pick(["pocket-comet", "thing"])));
  if (r() < 0.2) units.push(make("cy", 20, "thing"));
  const residents = ["dee", "eli"].map((handle) => ({ handle, x: Math.round(r() * 30), y: 0 }));
  if (r() < 0.3) units.push(make("eli", 24, "thing"));
  // A HOLDER UNDER THE READER'S FEET, sometimes (QA fail 4): it stands in the spine, not in the eyes
  if (r() < 0.5) marks.find((m) => m.id === holders[5]).at = { x: 0, y: 0 };
  return { marks, units, attachments, residents, places };
}

test("24 · THE INVARIANT over busy rooms: can = the object-less verbs ∪ every investigate(m).can; investigate(m).can ⊆ can", () => {
  let shown = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const room = busyRoom(seed);
    const p = pairsOf(room);
    const can = canVerbs(p);
    const objects = [...room.marks.map((m) => m.id), ...room.residents.map((x) => x.handle)];
    const union = new Set(objectlessVerbs(p));
    for (const o of objects) for (const v of canOn(p, o)) { assert.ok(can.includes(v), `seed ${seed}: ${v} on ${o}`); union.add(v); }
    assert.deepEqual(HOLD_VERBS.filter((v) => union.has(v)), can, `seed ${seed}`);
    assert.equal(new Set(can).size, can.length);
    shown += can.length;
  }
  assert.ok(shown > 200, "the rooms are busy enough to show verbs");
});

// THE APEX'S GATHERING over a room: the marks whose footprint holds the reader are the spine (`within`),
// the rest are what the eyes see (`nearby`), and the matrix gets the marks viewMarkIds names, plus the
// things in the reader's hands (world-kinds § usableAt) — never the room handed over whole.
function gathered(room) {
  const where = (m) => room.places?.get?.(m.id) ?? m.at;
  // the footprint holds the reader (a mark's `at` is its centre), never the looser reach of standsWithin
  const under = (m) => { const a = where(m), e = m.extent ?? { w: 0, h: 0 }; return Math.abs(HERE.x - a.x) <= e.w / 2 && Math.abs(HERE.y - a.y) <= e.h / 2; };
  const within = room.marks.filter((m) => liveHolder(room.attachments, m.id) == null && under(m));
  const nearby = room.marks.filter((m) => !within.includes(m));
  const ids = new Set([...viewMarkIds({ within, nearby }), ...room.attachments.filter((a) => liveHolder(room.attachments, a.target) === "cy").map((a) => a.target)]);
  return { ...room, marks: room.marks.filter((m) => ids.has(m.id)), within };
}

test("QA fail 4 · the apex's gathering hands the matrix the spine as well as the eyes", () => {
  const bowl = mk("ana/bowl", { kind: "halloween-candy-bowl", portable: false, at: { x: 0, y: 0 } });
  assert.deepEqual(viewMarkIds({ within: [{ id: "the-town/root" }, bowl], nearby: [{ id: "ana/a-lamp" }, bowl] }), ["the-town/root", "ana/bowl", "ana/a-lamp"], "each id once, the spine first");
  assert.deepEqual(viewMarkIds({}), []);
  const room = { marks: [bowl], units: [make("ana/bowl", 2), make("cy", 1)], attachments: [] };
  const g = gathered(room);
  assert.deepEqual(g.within.map((m) => m.id), ["ana/bowl"], "standing on the bowl: it is the spine's");
  assert.deepEqual(canOn(pairsOf(g), "ana/bowl"), ["take", "give"], "and the matrix still sees it");
  let standingOn = 0;
  for (let seed = 1; seed <= 120; seed++) if (gathered(busyRoom(seed)).within.some((m) => m.id.includes("/h"))) standingOn++;
  assert.ok(standingOn >= 30, `the differential's rooms put a holder under the reader's feet (${standingOn} of 120)`);
});

// ── THE DIFFERENTIAL: what the matrix shows, the door admits; what it hides, the door refuses ──
function doorsOf(room) {
  const acts = [...room.units];
  const byId = Object.fromEntries(room.marks.map((m) => [m.id, m]));
  const posOf = (h) => room.residents.find((x) => x.handle === h) ?? null;
  return {
    classes: () => VIEW,
    readRows: async () => ({ units: acts.slice(), attachments: room.attachments }),
    markById: async (id) => byId[id] ?? null,
    // THE REAL REACH: the thing door's measures, over the room's own geometry
    reachTake: async (id) => { const r = standsWithin(HERE, byId[id]); if (!r.stands) throw Object.assign(new Error("out of reach"), { code: 409, defect: `${id} is out of reach` }); return r; },
    reachGive: async (to) => { const p = posOf(to); const r = p ? withinArmsLength(HERE, p) : { stands: false }; if (!r.stands) throw Object.assign(new Error("not beside"), { code: 409, defect: `${to} is not within arm's length` }); return r; },
    holderPlace: async (id) => {
      const h = liveHolder(room.attachments, id);
      if (h != null) return { holder: String(h), at: null, moved: false };
      const set = room.places?.get?.(id);
      return set ? { holder: null, at: set, moved: true } : { holder: null, at: byId[id]?.at ?? null, moved: false };
    },
    standpoint: async () => HERE, householdOf: house, dropsOut: async () => 0,
    append: async (entry) => { acts.push({ id: acts.length + 100, class: entry.cls, action: entry.action, payload: entry.payload }); return { actId: acts.length + 99 }; },
    stamp: async () => ({ at: "t", witnesses: [] }), crossing: () => 260, household: () => "hh:test",
  };
}
const KEY = { handles: new Set(["cy"]) };
// A REFUSAL IS A DOOR'S ANSWER (a code and a defect); anything else is a crash, and a crash fails the test (F4)
const lands = async (route, args, room) => {
  try { await callKinds(route, args, KEY, "cy", doorsOf(room)); return true; }
  catch (e) { if (Number.isInteger(e?.code) && typeof e?.defect === "string") return false; throw e; }
};

test("B3 · THE DIFFERENTIAL over busy rooms: every verb the matrix shows lands at its door, and every verb it hides is refused there", async () => {
  let driven = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const room = busyRoom(seed);
    const p = pairsOf(gathered(room));
    const fold = foldUnits(room.units);
    const kinds = [...(fold.kinds.get("cy") ?? new Map()).keys()];
    const things = room.attachments.filter((a) => liveHolder(room.attachments, a.target) === "cy").map((a) => a.target);
    const holderIds = new Set(room.marks.filter((m) => m.id.includes("/h")).map((m) => m.id));
    for (const m of room.marks) {
      const container = liveHolder(room.attachments, m.id);
      // take: from a holder (the kind door), or a whole mark out of the holder it is in
      const take = holderIds.has(m.id) ? await lands("take", { from: m.id }, room)
        : container && container.includes("/") ? await lands("thing-from-holder", { thing: m.id, from: container }, room) : null;
      if (take !== null) { assert.equal(take, canOn(p, m.id).includes("take"), `seed ${seed}: take on ${m.id}`); driven++; }
      if (holderIds.has(m.id)) {
        const giveArgs = kinds.length ? ["give", { to: m.id, kind: kinds[0], count: 1 }] : things.find((t) => t !== m.id) ? ["thing-into-holder", { thing: things.find((t) => t !== m.id), to: m.id }] : null;
        if (giveArgs) { assert.equal(await lands(...giveArgs, room), canOn(p, m.id).includes("give"), `seed ${seed}: give into ${m.id}`); driven++; }
        assert.equal(await lands("refill", { act: "refill", thing: m.id, kind: "pocket-comet", count: 1 }, room), canOn(p, m.id).includes("refill"), `seed ${seed}: refill ${m.id}`);
        driven++;
      }
    }
    if (kinds.length) for (const r of room.residents) {
      assert.equal(await lands("give", { to: r.handle, kind: kinds[0], count: 1 }, room), canOn(p, r.handle).includes("give"), `seed ${seed}: give to ${r.handle}`);
      driven++;
    }
    assert.equal(await lands("consume", { act: "consume", kind: kinds.includes("pocket-comet") ? "pocket-comet" : undefined }, room), canVerbs(p).includes("consume"), `seed ${seed}: consume`);
    driven++;
  }
  assert.ok(driven > 1000, `the differential drove ${driven} doors`);
});

test("25 + 26 · the read's actions are trimmed to what is usable; the always-on roster and every other act pass untouched", () => {
  const entries = ["walk", "say", "note-to-self", "leave-mark", "take", "give", "drop", "consume", "refill", "enter", "stake"].map((action) => ({ action }));
  assert.deepEqual(onlyUsable(entries, []).map((e) => e.action), ["walk", "say", "note-to-self", "leave-mark", "enter", "stake"]);
  const p = pairsOf({ marks: [mk("cy/a-lamp")], attachments: [held("cy/a-lamp", "cy")] });
  assert.deepEqual(onlyUsable(entries, p).map((e) => e.action), ["walk", "say", "note-to-self", "leave-mark", "drop", "enter", "stake"]);
});
