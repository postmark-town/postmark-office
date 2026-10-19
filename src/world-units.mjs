// world-units.mjs — THE UNIT DOOR: give, take, drop, consume and refill of
// counted units (WLD-27). The adjudication is world-stacks.mjs's, pure; this
// file reads the record, asks the reach, serializes on the hold lane's queue
// and writes the act. Reached through `world_hold` (world-hold.mjs §
// callHoldTool), because "give, take, drop" are the hold verbs whatever they
// hold (the brief: "reuse give/take/drop"), and `consume`/`refill` ride the
// same tool as `act:`.
//
// WHICH ACT A CALL IS — read off its arguments, never guessed:
//
//   act: "consume"                     one held unit used up (from your hands)
//   act: "consume", thing: <unit mark> a dropped unit consumed where it stands
//   act: "refill", chest: <chest id>   the label's creator tops a chest up
//   from: <chest>, label?, count?      take units out of a chest
//   to: <resident|chest>, label?, count?   give units
//   label (no to, no from)             set ONE unit down: it becomes a mark
//   thing: <a dropped unit's mark>     take it back into your hands
//   thing:, to: <chest>                put a whole thing into a chest
//   thing:, from: <chest>              take a whole thing out of one (a thing a
//                                      chest holds is also taken out by naming it)
//
// ⚑ THE MARK'S EXIT RETURNS STAKES THROUGH THE TOWN'S OWN UNSTAKE. When a
// dropped unit stops being a mark (taken back, or consumed in place), each
// actual staker's open position on that mark comes home as that staker's own
// unstake line — the engine's line, one per staker — so the ledger itself is
// the memory that makes it once: a retry reads positions already closed and
// plans nothing (world-stacks.mjs § returnsAtExit). This file never writes a
// ledger line of its own and never runs in a lane against a real ledger: the
// tests drive it with a synthetic one.

import {
  UNIT_ACTION, foldUnits, edgesOf, totalOf, exitedMarks, unitCount, candyLabels, labelOfCreator, labelRecord,
  capacityOf, portableOf, welcomeOf, holdingDisplay, refuseOverCarry, takenRefusal,
  planGive, planTake, planConsume, planRefill, refillerLabel, droppedUnitMark, isDroppedUnitMark, returnsAtExit, isChestId, isUnitRow,
  withdrawnMarks, ancestry, selectLabel, stockedChests,
} from "./world-stacks.mjs";
import { holdingsOf, sameHousehold, holdTurn, liveHolder, rowsFor, holdingEntry } from "./world-hold.mjs";
import { liveHolders, holdersAbove, wholeLoadOf, weightOf, refuseNesting } from "./holder-tree.mjs"; // the walks, cycle-safe; counts confer up
import { holderLawOf, refuseSecondHolder } from "./kind-holding.mjs"; // any holder's capacity; one holder in a resident's hands
import { chestRoomGuard } from "./chest-lock.mjs";
import { dropUndoGuard, undoNonce, dropSequenceGuard } from "./drop-recovery.mjs";
import { faultLogged, plainReason } from "./fault-words.mjs"; // the office's own words for its own fault (POS-578)
import { markClassOf } from "./world-grants.mjs";
import { holdingOf } from "./holding-law.mjs"; // holder, capacity, open: read from the class tree (LOGOS v2, O1)
import { snapProperty } from "./law-classes.mjs"; // the kind rung: a mark's class in both forms (LOGOS v2, O1)
import { chestsCandyOn, chestsCandyOffError } from "./chests-candy.mjs"; // WLD-27 ships dark until LOGOS v2's doors replace it

// ── SLOTS HELD FOR AN ACT STILL IN FLIGHT (Bevel's review, finding 3) ───────
//
// A set-down takes the unit out of the hands, then files its mark on another
// pen, outside the hold queue; if the filing fails the unit comes back. While
// that filing is in flight the slot is RESERVED for the unit, and every carry
// check reads it as carried — so another hold cannot take the freed slot and
// leave a 25th unit behind when the compensation lands. One process writes
// holds (the read workers refuse), so this map is the whole of the in-flight set.
const reserved = new Map();
export const reservedFor = (handle) => reserved.get(String(handle)) ?? 0;

/**
 * Units a resident has set down that are NOT YET KNOWN to be on the ground or
 * back in hand — counted against their carry cap as if still held (Wright's
 * independent review, F0). The in-memory reservation covers this process's own
 * filings; the store's count (drop-recovery.mjs § dropsStillOut) covers a
 * restart, a crashed filing, a failed undo. They name the same drops, so the
 * larger stands.
 *
 * READ IT BEFORE THE HELD UNITS (Bevel's follow-up review, B). The tick's
 * recovery turns an out unit into a held one between any two reads. Read out
 * first and held second, and a recovery between them is counted twice — a
 * take refused that would have fit, never a 25th admitted. The other order
 * counts it nowhere: 23 held (old) + 0 out (new) admitted a 25th.
 */
export async function inFlightFor(handle, deps) {
  const durable = deps?.dropsOut ? await deps.dropsOut(String(handle)) : 0;
  return Math.max(reservedFor(handle), Number(durable) || 0);
}
const reserve = (handle, n) => reserved.set(String(handle), reservedFor(handle) + n);
const release = (handle, n) => { const left = reservedFor(handle) - n; if (left > 0) reserved.set(String(handle), left); else reserved.delete(String(handle)); };
/** The id of the act that recorded this mark's exit, read back for a retry. */
/**
 * The exit act the record holds for a dropped unit's mark, as the cause of its
 * withdrawal: its own id, its actor and its route (Bevel's revised review, D —
 * a cleanup retry by another resident, by another route, used to name ITSELF
 * as the exit while pointing at the original act). Null when there is none.
 */
const ROUTE_OF_EXIT = { [UNIT_ACTION.takeBack]: "take-back", [UNIT_ACTION.consumeInPlace]: "consume-in-place" };
const exitCauseOf = (units, id) => {
  const r = units.find((x) => ROUTE_OF_EXIT[x.action] && String(x.object) === id);
  return r ? { exit: ROUTE_OF_EXIT[r.action], by: r.actor == null ? null : String(r.actor), act: r.id ?? null } : null;
};
/** Things held whole by this resident (a chest's contents are the chest's, not its carrier's). */
const thingsCarried = (attachments, handle) => holdingsOf(attachments, handle).length;

const bounce = (code, defect, hint, extra = {}) => {
  const e = new Error(defect);
  Object.assign(e, { code, defect, hint, ...extra });
  return e;
};

/** Which unit act this call is, or null when it is the thing door's (a thing changing hands). */
export function unitRouteOf(args = {}, { thingMark = null } = {}) {
  const a = args.act == null ? null : String(args.act);
  if (a === "consume") return args.thing != null ? "consume-in-place" : "consume";
  if (a === "refill") return "refill";
  if (a != null) throw bounce(422, `act is consume or refill — got "${a}"`, "give, take and drop are read off to:/from:/label:, as they always were");
  if (args.from != null) return args.thing != null ? "thing-from-chest" : "take";
  if (args.thing != null && args.to != null && isChestId(String(args.to))) return "thing-into-chest";
  if (args.label != null || args.count != null) return args.to != null ? "give" : "drop";
  if (args.to != null && isChestId(String(args.to)) && args.thing == null) return "give";
  if (args.thing != null && args.to == null && isDroppedUnitMark(thingMark)) return "take-back";
  return null;
}

/** The class layer the unit door reads, from one law snapshot. */
export function classViewOf(snap) {
  const rec = (name) => (snap?.classes?.get(String(name)) ?? null);
  const dialsOf = (name) => {
    const d = rec(name)?.dials;
    const v = typeof d === "string" ? (() => { try { return JSON.parse(d); } catch { return null; } })() : d;
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  };
  return {
    record: (name) => { const r = rec(name); return r ? { ...r, dials: dialsOf(name) } : null; },
    extendsOf: (name) => (rec(name)?.extends ? String(rec(name).extends) : null),
    dials: dialsOf,
    property: (name, prop) => snapProperty(snap, name, prop),
    labels: () => candyLabels(rec("candy")),
    readable: Boolean(snap?.classes?.size),
  };
}

/** The live collaborators. Every one is injectable; a falsifier hands in its own. */
export async function liveUnitDeps() {
  const [{ lawSnapshot }, world, guards, journal, pen, hold, stake, branches, crossings] = await Promise.all([
    import("./law-snapshot.mjs"), import("./world.mjs"), import("./world2-guards.mjs"), import("./world-journal.mjs"),
    import("./world2-pen.mjs"), import("./world-hold.mjs"), import("./world-stake.mjs"), import("./world-branches.mjs"), import("./crossings.mjs"),
  ]);
  const { WORLD_CLONE } = await import("./world-store.mjs");
  return {
    classes: () => classViewOf(lawSnapshot()),
    readRows: async () => {
      const [units, attachments] = await Promise.all([guards.storeHoldingRows(), guards.guardedAttachments()]);
      return { units: units.filter(isUnitRow), attachments };
    },
    markById: async (id) => (await world.worldMarkById(String(id))).mark,
    nameOf: async (id) => (await world.markRows([String(id)]))[0]?.name ?? null, // a whole thing's name, where a holding is told (hotfix w43.1)
    reachTake: async (thing, actor) => hold.refuseOutOfReach({ thing, to: null, actor, act: "take", holder: null }),
    // A give of units is a take at arm's length, clause 3's measure in its one home.
    reachGive: async (to, actor) => {
      const s = await world.residentStandpoint(String(actor)).catch(() => null);
      return hold.armsLengthOrThrow({ thing: "units", to, here: s?.placed ? { x: s.x, y: s.y } : null, actor });
    },
    // WHERE A HOLDER IS NOW (LOGOS v2, O2; review-610 B1): in someone's hands, set down, or where it was made.
    // The one answer (held.mjs § placeOf, POS-688): this was its own fourth copy of holder → set-down → canon.
    holderPlace: async (id, mark) => {
      const [{ heldView }, { placeOf, HELD_BY }] = await Promise.all([import("./held-view.mjs"), import("./held.mjs")]);
      const p = placeOf(String(id), await heldView(), mark);
      if (p?.[HELD_BY] != null) return { holder: String(p[HELD_BY]), at: null, moved: false };
      if (p?.source === "set-down") return { holder: null, at: p.at, moved: true };
      return { holder: null, at: mark?.at ?? null, moved: false };
    },
    standpoint: async (actor) => { const s = await world.residentStandpoint(String(actor)).catch(() => null); return s?.placed ? { x: s.x, y: s.y } : null; },
    householdOf: await (async () => { try { return await (await import("./households.mjs")).householdLookup(); } catch { return null; } })(),
    // `also`: further acts that commit in the SAME transaction as this one, or none of them do (O2; review-610 S4)
    append: async (entry, { guard = null, also = [] } = {}) => {
      if (!also.length) return journal.appendActFlipped(null, entry, guard ? { guard } : {});
      const { insertAct } = pen;
      const rows = also.map((e) => journal.normalizeRow(e));
      return journal.appendActFlipped(null, entry, { guard: async (client) => { if (guard) await guard(client); for (const r of rows) await insertAct(client, r, null); } });
    },
    stamp: (actor) => world.witnessStamp(actor),
    crossing: () => crossings.currentCrossing(),
    household: (key) => branches.resolvedWorldHousehold(key),
    leave: (payload, key, opts) => world.leaveMarkViaOffice(WORLD_CLONE, payload, key, opts),
    holders: async (mark) => {
      const sr = await stake.callWorldStakeTool("world_stake_read", { mark });
      if (sr?.error) throw bounce(503, "the stakes on this mark could not be read", String(sr.defect ?? sr.error));
      return sr?.holders ?? [];
    },
    unstake: (r) => stake.runExec({ verb: "unstake", handle: r.handle, mark: r.mark, n: r.stamps, date: new Date().toISOString().slice(0, 10) }),
    withdraw: (m) => world.journalWithdraw(m),
    markTurn: async (mark, fn) => (await import("./mark-stake-lock.mjs")).withMarkHeld(mark, () => fn(),
      { refusal: "nothing moved: the stakes on this mark could not be read settled", connection: "pool" }),
    dropsOut: async (actor) => pen.officeRead(async (c) => (await import("./drop-recovery.mjs")).dropsStillOut(c, actor), { by: "dropsOut" }),
    // a read of the docket under the WITHDRAWING household — the live layer the withdrawal will act on (D)
    droppedUnit: async ({ mark, by, household }, read) => {
      const { claimHouseholdFor } = await import("./world2-claims.mjs");
      const hh = await claimHouseholdFor({ actor: by, household });
      return pen.officeWrite((c) => read(c, { mark, by }), { household: hh });
    },
    onActs: () => pen.laneFlipped("hold"),
  };
}

const sentenceOf = {
  [UNIT_ACTION.give]: (r, p) => `${r.actor} gave ${p.n} ${p.label} to ${p.to}`,
  [UNIT_ACTION.take]: (r, p) => `${r.actor} took ${p.n} ${p.label} from ${p.from}`,
  [UNIT_ACTION.consume]: (r, p) => `${r.actor} consumed 1 ${p.label}; a held unit carries no stakes, so nothing was returned`,
  [UNIT_ACTION.refill]: (r, p) => `${r.actor} refilled ${p.to} with ${p.n} ${p.label}`,
  [UNIT_ACTION.drop]: (r, p) => `${r.actor} set 1 ${p.label} down; it is filed as a sited mark and stands at the next crossing`,
  [UNIT_ACTION.dropUndone]: (r, p) => `the set-down's mark could not be filed, so 1 ${p.label} came back to ${p.to}`,
  [UNIT_ACTION.takeBack]: (r, p) => `${r.actor} took the set-down ${p.label} back into a holding; the mark it was leaves at the next crossing`,
  [UNIT_ACTION.consumeInPlace]: (r) => `${r.actor} consumed the set-down unit where it stood; the mark it was leaves at the next crossing`,
};

async function writeUnits(deps, key, actor, { action, object, moves, payload = {}, nonce = null }, { guard = null } = {}) {
  const { at, witnesses } = await deps.stamp(actor);
  const m = moves[0] ?? {};
  const entry = {
    crossing: deps.crossing(), actor, action, object: object == null ? null : String(object), at, witnesses,
    cls: "holding", household: deps.household(key),
    payload: { units: true, moves, ...payload },
    effect: (sentenceOf[action] ?? (() => action))({ actor }, { ...m, ...payload, n: m.n, label: m.label ?? payload.label, from: m.from, to: m.to }),
    ...(nonce ? { nonce } : {}),
  };
  const row = await deps.append(entry, guard ? { guard } : {});
  return { seq: row?.actId ?? row?.seq ?? null, effect: entry.effect };
}

/** What a holder holds now, as a resident reads it. */
export function holdsBlock(fold, holder, view, things = []) {
  const labels = view.labels();
  const components = [
    ...edgesOf(fold, holder).map((e) => ({ class: labelRecord(labels, e.label) ? "candy" : null, label: e.label, name: labelRecord(labels, e.label)?.name ?? e.label, count: e.count })),
    // WHOLE THINGS a chest holds (Bevel's review: "a chest takes any things" —
    // 101 candies and a toaster read as 102 things). Each is one, by its class.
    ...things.map((t) => ({ class: t.class ?? "thing", thing: t.thing, count: 1 })),
  ];
  const shown = holdingDisplay(components, view.extendsOf);
  return { holder: String(holder), edges: edgesOf(fold, holder), ...(things.length ? { things: things.map((t) => ({ thing: t.thing, class: t.class ?? "thing" })) } : {}),
    count: shown.count, class: shown.class, shows: shown.text };
}

/** The whole things a holder holds, each with its class from the record. */
async function thingsHeldBy(attachments, holder, markById) {
  const out = [];
  for (const id of holdingsOf(attachments, String(holder))) out.push({ thing: id, class: markClassOf(await markById(id).catch(() => null)) ?? "thing" });
  return out;
}

/**
 * A chest's summary in a unit act's receipt: its units after the act AND the
 * whole things in it (Bevel's revised review, B: a refill's receipt called a
 * chest of 29 candies and a toaster "29 candy" while the chests read said "30
 * things"). A unit act moves no whole thing, so the attachments read in the
 * act's turn are the post-act contents.
 */
const chestBlock = async (after, chest, view, attachments, deps) =>
  holdsBlock(after, chest, view, await thingsHeldBy(attachments, chest, deps.markById));

const classOfLabelIn = (view) => (label) => (labelRecord(view.labels(), label) ? "candy" : null);

/** The holding's top class, for the taken-class hook. */
function topClassOf(fold, holder, view, label = null) {
  const labels = view.labels();
  const edges = edgesOf(fold, holder).filter((e) => label == null || e.label === label);
  const comps = edges.map((e) => ({ class: labelRecord(labels, e.label) ? "candy" : null, label: e.label, count: e.count }));
  return holdingDisplay(comps, view.extendsOf).class;
}
const refuseIfTaken = (klass, view) => { const r = takenRefusal(klass, view.record, view.extendsOf); if (r) throw r; };

// THE CARRY is the resident's own capacity (LOGOS v2: "On `resident`: `holder:
// true` and `capacity: 24`, both constitution and locked", ruled 16:03–16:05),
// read from the class tree first and the thing class's older `carry_cap` dial
// second (G4). Constitution, so no resident's own field moves it.
const carryOf = (view) => holdingOf({ className: "resident", classProperty: (n, p) => view.property?.(n, p) ?? null, legacy: { capacity: view.dials("thing")?.carry_cap } }).capacity;
// A holder's dials, in the chest door's shape, PROPERTY FIRST: capacity and its
// bounds, and open (the chest's `welcome`), from the mark's class lineage and
// the mark's own sovereign fields; the chest class's older dials second (G4).
function chestDialsFor(view, mark) {
  const legacy = view.dials("chest");
  const className = markClassOf(mark) ?? "chest";
  const h = holdingOf({ mark, className, classProperty: (n, p) => view.property?.(n, p) ?? null,
    legacy: { capacity: legacy.capacity, capacity_min: legacy.capacity_min, capacity_max: legacy.capacity_max } });
  const classCap = holdingOf({ className, classProperty: (n, p) => view.property?.(n, p) ?? null, legacy: { capacity: legacy.capacity } }).capacity;
  const out = { ...legacy };
  if (classCap != null) out.capacity = classCap;
  if (h.min != null) out.capacity_min = h.min;
  if (h.max != null) out.capacity_max = h.max;
  if (h.open != null) out.welcome = h.open ? "open" : "closed";
  return out;
}

/** Any holder's capacity from its mark: a #499 chest by its chest dials, any other thing by the holder property (holding-law § holdingOf). */
export function holderCapacityOf(mark, view) {
  if (markClassOf(mark) === "chest") return capacityOf(mark, chestDialsFor(view, mark));
  const law = holderLawOf({ holder: String(mark.id), mark, view });
  return law.holder && !law.capacity_refused ? law.capacity : null;
}

/** Everything inside `holder` past its own units, as its room counts it: each whole thing at any depth is 1 plus what it holds (holder-tree § wholeLoadOf). */
export const wholeLoadIn = (attachments, fold, holder) => wholeLoadOf({ up: liveHolders(attachments), holder, unitsOf: (h) => totalOf(fold, h) });

/** Everything `holder` holds as its room counts it: its units, and each whole thing as 1 and all it holds. The door's room is capacity less this; the read's count is this (hotfix w43.1). */
export const heldLoadOf = (attachments, fold, holder) => totalOf(fold, holder) + wholeLoadIn(attachments, fold, holder);

/**
 * COUNTS CONFER UP, ABOVE THE HOLDER (Darko, 2026-10-17 23:29; holder-tree.mjs
 * § THE LAW): adding `n` to `holder` adds `n` to every holder it sits inside, up
 * to but not including a resident's hands, and each must have the room. The
 * holder's own room is its door's to judge (refuseOverRoom, with wholeLoadIn).
 * Returns `[{ holder, capacity }]`, for the pen guard to judge again under each
 * one's lock (chest-lock § chestRoomGuard `above`).
 */
export async function refuseOverRoomAbove({ deps, view, fold, attachments, holder, n, nothing = "Nothing was changed." }) {
  const up = liveHolders(attachments);
  const { above, loop } = holdersAbove(up, String(holder));
  if (loop) throw bounce(422, `the record holds a loop above ${holder}`, `its holders lead back to themselves, so the room above it cannot be told. ${nothing}`);
  const out = [];
  for (const a of above) {
    const mark = await deps.markById(a).catch(() => null);
    const capacity = mark ? holderCapacityOf(mark, view) : null;
    if (!Number.isInteger(capacity))
      throw bounce(503, `the room of ${a}, which ${holder} is inside, could not be read`, `a count confers up to every holder above it, and this one's capacity is unread. ${nothing}`);
    const load = totalOf(fold, a) + wholeLoadOf({ up, holder: a, unitsOf: (h) => totalOf(fold, h) });
    if (load + n > capacity)
      throw bounce(409, `${a} has room for ${Math.max(capacity - load, 0)}, not ${n}`,
        `${holder} is inside it, and a holder counts 1 and everything it holds: ${a} holds ${load} of ${capacity}. ${nothing}`,
        { room: Math.max(capacity - load, 0), capacity, at: a });
    out.push({ holder: a, capacity });
  }
  return out;
}

async function chestOrThrow(deps, id, view) {
  const mark = await deps.markById(id);
  if (!mark) throw bounce(404, `${id} does not stand on the world`, "a chest is a published mark; a private draft holds nothing yet. Nothing was recorded.");
  if (markClassOf(mark) !== "chest") throw bounce(422, `${id} is not a chest`, `it is ${markClassOf(mark) ? `a ${markClassOf(mark)}` : "an unclassed mark"}; units go into chests and residents' hands. Nothing was recorded.`);
  return { mark, capacity: capacityOf(mark, chestDialsFor(view, mark)) };
}

/**
 * THE UNIT DOOR. `route` is `unitRouteOf`'s answer; `actor` is already the
 * key's own resident (callHoldTool § actingHandle); the freeze was asked.
 */
export async function callUnits(route, args, key, actor, deps) {
  // DARK BY DEFAULT (chests-candy.mjs): every counted-unit route, before any read
  if (!chestsCandyOn()) throw chestsCandyOffError();
  const view = deps.classes();
  if (!view.readable) throw bounce(503, "the class layer could not be read, so the office cannot tell candy from anything else",
    "counted units read the candy, chest and thing classes from the record; nothing was recorded — try again when the law is loaded");
  const cap = carryOf(view);

  switch (route) {
    case "take": {
      const from = String(args.from);
      const { mark } = await chestOrThrow(deps, from, view);
      if (welcomeOf(mark, chestDialsFor(view, mark)) !== "open") {
        const same = sameHousehold(String(mark.by ?? from.split("/")[0]), actor, deps.householdOf);
        if (!same.same) throw bounce(403, `${from} is closed to other households`, "its welcome is closed: only its maker's household takes from it. Nothing was recorded.");
      }
      const n = unitCount(args.count);
      await deps.reachTake(from, actor);
      return holdTurn(async () => {
        const inFlight = await inFlightFor(actor, deps); // BEFORE the rows: see inFlightFor
        const { units, attachments } = await deps.readRows();
        const fold = foldUnits(units);
        const plan = planTake({ fold, actor, from, label: args.label ?? null, n });
        refuseIfTaken(topClassOf(fold, from, view), view);
        refuseOverCarry({ who: actor, units: totalOf(fold, actor) + inFlight, things: thingsCarried(attachments, actor), adding: n, cap });
        const w = await writeUnits(deps, key, actor, plan);
        const after = foldUnits([...units, { class: "holding", action: plan.action, payload: { moves: plan.moves } }]);
        return { did: "take", units: true, label: plan.label, count: n, from, ...w, holds: holdsBlock(after, actor, view), chest: await chestBlock(after, from, view, attachments, deps) };
      });
    }
    case "give": {
      const to = String(args.to);
      const n = unitCount(args.count);
      let chestCap = null;
      if (isChestId(to)) { chestCap = (await chestOrThrow(deps, to, view)).capacity; await deps.reachTake(to, actor); }
      else await deps.reachGive(to, actor);
      return holdTurn(async () => {
        const inFlight = (!isChestId(to) ? await inFlightFor(to, deps) : 0); // BEFORE the rows: see inFlightFor
        const { units, attachments } = await deps.readRows();
        const fold = foldUnits(units);
        // the chest's one capacity is shared by its counted units and the whole things in it, each holder 1 and all it holds
        const capacityOfTo = chestCap == null ? null : chestCap - wholeLoadIn(attachments, fold, to);
        const plan = planGive({ fold, actor, to, label: args.label ?? null, n, capacityOfTo });
        refuseIfTaken(topClassOf(fold, actor, view, plan.label), view);
        if (!isChestId(to)) refuseOverCarry({ who: to, units: totalOf(fold, to) + inFlight, things: thingsCarried(attachments, to), adding: n, cap });
        const above = isChestId(to) ? await refuseOverRoomAbove({ deps, view, fold, attachments, holder: to, n, nothing: "Nothing was recorded." }) : [];
        // INTO A CHEST, the room is judged again under the chest's own lock inside
        // the write's transaction — the tick's stock is another process (finding 6)
        const w = await writeUnits(deps, key, actor, plan, isChestId(to) ? { guard: chestRoomGuard({ chest: to, capacity: chestCap, adding: n, above }) } : {});
        const after = foldUnits([...units, { class: "holding", action: plan.action, payload: { moves: plan.moves } }]);
        return { did: "give", units: true, label: plan.label, count: n, to, ...w, holds: holdsBlock(after, actor, view),
          receiver: isChestId(to) ? await chestBlock(after, to, view, attachments, deps) : holdsBlock(after, to, view) };
      });
    }
    case "consume": {
      return holdTurn(async () => {
        const { units } = await deps.readRows();
        const fold = foldUnits(units);
        const plan = planConsume({ fold, actor, label: args.label ?? null, classOfLabel: classOfLabelIn(view), extendsOf: view.extendsOf });
        refuseIfTaken(topClassOf(fold, actor, view, plan.label), view);
        const w = await writeUnits(deps, key, actor, { ...plan, payload: { label: plan.label, returns: [], returns_note: plan.returns_note } });
        const after = foldUnits([...units, { class: "holding", action: plan.action, payload: { moves: plan.moves } }]);
        return { did: "consume", units: true, label: plan.label, count: 1, returns: [], returns_note: plan.returns_note, ...w, holds: holdsBlock(after, actor, view) };
      });
    }
    case "refill": {
      const chest = String(args.chest ?? args.thing ?? "");
      if (!isChestId(chest)) throw bounce(422, "refill which chest?", "chest: its id, <by>/<slug>");
      const { mark: chestMark, capacity } = await chestOrThrow(deps, chest, view);
      const maker = String(chestMark.by ?? chest.split("/")[0]);
      // the maker-and-creator rule is the first thing asked, before reach (F2)
      refillerLabel({ actor, chest, labels: view.labels(), maker });
      await deps.reachTake(chest, actor);
      return holdTurn(async () => {
        const { units, attachments } = await deps.readRows();
        const fold = foldUnits(units);
        // refill fills the room left by EVERYTHING in the chest — units of every label and whole things
        const plan = planRefill({ fold, actor, chest, capacity: capacity - wholeLoadIn(attachments, fold, chest), labels: view.labels(), maker });
        if (plan.noop) return { did: "refill", units: true, noop: true, note: plan.note, chest: await chestBlock(fold, chest, view, attachments, deps) };
        refuseIfTaken(topClassOf(fold, chest, view) ?? "candy", view);
        const above = await refuseOverRoomAbove({ deps, view, fold, attachments, holder: chest, n: plan.moves[0].n, nothing: "Nothing was recorded." });
        const w = await writeUnits(deps, key, actor, { ...plan, payload: { label: plan.label, capacity } },
          { guard: chestRoomGuard({ chest, capacity, adding: plan.moves[0].n, above }) });
        const after = foldUnits([...units, { class: "holding", action: plan.action, payload: { moves: plan.moves } }]);
        return { did: "refill", units: true, label: plan.label, count: plan.moves[0].n, ...w, chest: await chestBlock(after, chest, view, attachments, deps) };
      });
    }
    case "drop": {
      // ONE UNIT, ONE MARK, ONE STAMP. Each unit set down is its own sited mark
      // under the standard 1-stamp rule, so a count above one is refused rather
      // than filed as one mark standing for several units.
      const n = args.count == null ? 1 : unitCount(args.count);
      if (n !== 1) throw bounce(422, "set units down one at a time", "each unit set down becomes its own mark with its own stamp — count: 1. Nothing was recorded.");
      if (args.to != null) throw bounce(422, "a set-down names no one", "to hand units over, give them; to set one down, name only its label");
      const stood = await deps.standpoint(actor);
      if (!stood) throw bounce(409, "the record does not place you anywhere", `a unit set down stands where you stood, and the walk ledger has no position for ${actor} — walk somewhere first. Nothing was recorded.`);
      const dropped = await holdTurn(async () => {
        const { units } = await deps.readRows();
        const fold = foldUnits(units);
        const edge = selectLabel(edgesOf(fold, actor), args.label ?? null, { where: "your hands", verb: "set down" });
        refuseIfTaken(topClassOf(fold, actor, view, edge.label), view);
        const moves = [{ from: actor, to: null, label: edge.label, n: 1 }];
        // the set-downs' sequence lock, shared: the tick's cursor never passes a drop still being written (drop-recovery.mjs)
        const w = await writeUnits(deps, key, actor, { action: UNIT_ACTION.drop, object: actor, moves, payload: { label: edge.label, at: stood } }, { guard: dropSequenceGuard });
        reserve(actor, 1); // the slot is held until the filing settles (finding 3)
        return { label: edge.label, ...w };
      });
      const name = labelRecord(view.labels(), dropped.label)?.name ?? dropped.label;
      const payload = droppedUnitMark({ actor, label: dropped.label, name, actId: dropped.seq, at: stood });
      let filed = null, why = null;
      try {
        filed = await deps.leave(payload, key, { dropUnit: { actId: dropped.seq, label: dropped.label } });
        if (filed?.error) { why = filed.defect ?? filed.error; filed = null; }
      } catch (e) { why = String(e?.defect ?? plainReason(e, "record", "a dropped unit's filing")).slice(0, 200); }
      if (!filed) {
        // THE CALL FAILED; WHAT COMMITTED? (Wright's independent review, F0.)
        // `leaveMarkViaOffice` can throw after its claim committed, so the
        // undo is decided under the drop's own lock by what the record holds:
        // the mark filed → the unit is on the ground and NOTHING is undone; not
        // filed → the unit comes back, once (the undo's nonce), into the slot
        // held for it. If even the undo cannot be written, the unit stays out
        // and the office tick returns it after one tick.
        let back = null, committed = null, stuck = null;
        await holdTurn(async () => {
          try {
            back = await writeUnits(deps, key, actor, { action: UNIT_ACTION.dropUndone, object: actor, nonce: undoNonce(dropped.seq),
              moves: [{ from: null, to: actor, label: dropped.label, n: 1 }], payload: { label: dropped.label, undoes: String(dropped.seq), why, by: "door" } },
              { guard: dropUndoGuard({ actId: dropped.seq, actor, label: dropped.label }) });
          } catch (e) {
            if (e?.filed) committed = e.filed;
            else if (e?.undoneAlready) back = { seq: e.undoneAlready, already: true };
            else stuck = String(e?.defect ?? plainReason(e, "record", "a unit's undo")).slice(0, 200);
          } finally { release(actor, 1); }
        });
        if (committed)
          return { did: "drop", units: true, label: dropped.label, count: 1, seq: dropped.seq, effect: dropped.effect,
            mark: committed.slug, stands_at: stood, filed: { id: committed.slug, status: committed.status },
            office_error_after_filing: why,
            stands_note: `the mark WAS filed (${committed.status}) though the office answered with an error after filing it (${why}); the unit is on the ground as that mark, not back in your hands, and nothing was undone` };
        if (back)
          throw bounce(409, `the set-down's mark could not be filed: ${why}`, `your ${dropped.label} is back in your hands (act ${back.seq}); nothing stands on the ground.`);
        throw bounce(503, `the set-down's mark could not be filed, and the unit could not be returned yet: ${why}; ${stuck}`,
          `your ${dropped.label} is in neither your hands nor on the ground for now — the set-down (act ${dropped.seq}) stands in the record with no mark, and the office tick returns it to you after one tick. It still counts against what you can carry.`);
      }
      release(actor, 1);
      return { did: "drop", units: true, label: dropped.label, count: 1, seq: dropped.seq, effect: dropped.effect,
        mark: `${payload.by}/${payload.slug}`, stands_at: stood, put_forward: filed.put_forward === true,
        filed: { id: filed.id ?? `${payload.by}/${payload.slug}`, put_forward: filed.put_forward ?? null, ...(filed.to_publish ? { to_publish: filed.to_publish } : {}) },
        stands_note: filed.put_forward === true
          ? "it is a sited mark at the next crossing, staked with your one stamp; until then it is on no public map"
          : "it is filed as your private draft (no stamp stood behind it), so it is on no public map until it is staked and crosses" };
    }
    case "take-back":
    case "consume-in-place":
      return markExit(route, args, key, actor, deps, view, cap);
    case "thing-into-chest":
      return thingIntoChest(args, key, actor, deps, view);
    case "thing-from-chest":
      return thingFromChest(args, key, actor, deps, view, cap);
    default:
      throw bounce(422, "not a unit act", "give, take, drop, consume or refill");
  }
}

/**
 * A DROPPED UNIT STOPS BEING A MARK (Wright, 2026-10-13T00:01Z): taken back
 * into a holding, or consumed where it stands. Its escrow and every stake on it
 * go home to their stakers first — one unstake line each, the engine's own —
 * then the act, then the mark's withdrawal. Once on retry, by construction: the
 * returns read the positions still open, and the act is refused for a mark the
 * record already shows leaving (`exitedMarks`) — the retry still finishes any
 * return a first attempt left open.
 */
/**
 * The stakes still open on an exiting mark, returned — F4. Reads the holders,
 * returns each open position through the engine's unstake, and reads again,
 * until a read finds nothing open (a few passes; a stake still arriving after
 * them refuses the withdrawal this time, and a retry finishes it). Each return
 * is recorded once, as the engine applied it. Throws, with what was returned,
 * when a return fails or the stakes do not settle.
 */
const LATE_PASSES = 3;

/**
 * WHAT A RETURN RECORDED, AS THE ENGINE SAID IT (Wright, 2026-10-13T05:20Z, B).
 * The exec answers `{ applied, commit, verb }` (world-stake-exec.mjs): `applied`
 * is what the town's unstake actually moved, clipped to the position still
 * open, and `commit` is the ledger commit that carries the line — present only
 * when something was applied. The receipt carries exactly those: no requested
 * count standing in for an applied one, and no id for a call that recorded
 * nothing. (It read `out.line`, a field the exec never answers, so every
 * receipt's line was null on the real path.)
 */
/** The mark's holders, read under its lock: the ledger as settled, no change half-landed (mark-stake-lock.mjs § withMarkHeld). */
const settledHolders = (id, deps) => deps.markTurn(id, () => deps.holders(id));

const appliedOf = (out) => { const n = Number(out?.applied); return Number.isFinite(n) && n > 0 ? n : 0; };
const receiptOf = (r, out) => {
  const stamps = appliedOf(out);
  return { handle: r.handle, stamps, commit: stamps > 0 && typeof out?.commit === "string" && out.commit ? out.commit : null };
};
async function lateReturns(id, deps) {
  // THE NO-NEW-STAKES BOUNDARY, READ SETTLED (WLD-27 A; Bevel's first review
  // R1). The exit act has committed, so a stake asking now is refused; each
  // read below is taken under the mark's lock, which every stake and unstake
  // holds until it has landed or rolled back (mark-stake-lock.mjs). So a read
  // sees every stake there will ever be on this mark, and never an unstake's
  // zero that a failed landing then undoes. Nothing is held while the returns run.
  const returned = [];
  for (let pass = 0; pass < LATE_PASSES; pass++) {
    const plan = returnsAtExit({ mark: id, holders: await settledHolders(id, deps) });
    if (!plan.length) return returned;
    for (const r of plan) {
      const out = await deps.unstake(r);
      if (out?.error) throw bounce(503, `a late stake by ${r.handle} could not be returned: ${out.defect ?? out.error}`,
        "the mark stands and its withdrawal waits; ask again — what was returned is not returned twice", { returned });
      const n = appliedOf(out);
      if (n > 0) returned.push(receiptOf(r, out));
    }
  }
  throw bounce(409, `stakes kept arriving on ${id} while it was leaving`,
    "the mark stands and its withdrawal waits; ask again — every stake returned so far stays returned", { returned });
}

async function markExit(route, args, key, actor, deps, view, cap) {
  const id = String(args.thing);
  const mark = await deps.markById(id);
  if (!isDroppedUnitMark(mark)) throw bounce(422, `${id} is not a unit that was set down`, "only a dropped unit's mark goes back into a holding or is consumed where it stands. Nothing was recorded.");
  const label = String(mark.label);
  if (route === "consume-in-place") {
    const klass = classOfLabelIn(view)(label) ?? String(markClassOf(mark));
    if (!ancestry(klass, view.extendsOf).includes("consumable"))
      throw bounce(422, `${label} is not a consumable`, "Nothing was recorded.");
  }
  refuseIfTaken(String(markClassOf(mark)), view);
  await deps.reachTake(id, actor);
  const by = String(mark.by ?? id.split("/")[0]);
  const slug = id.slice(id.indexOf("/") + 1);
  const household = mark.household ?? deps.householdOf?.(by)?.key ?? null;

  // ── ONE TURN: ELIGIBILITY, THEN THE RETURNS, THEN THE ACT (Bevel's review,
  // 2026-10-13, finding 1). The first cut returned the stakes BEFORE asking
  // whether the act could happen at all, so a take-back refused for want of a
  // carry slot had already emptied other residents' positions on a mark that
  // never stopped being a mark. Now nothing moves until the act is known to be
  // admissible — exit-once and the carry slot, both read inside the queue's
  // turn — and the slot cannot be taken by another hold while the returns run,
  // because no other hold runs until this turn ends. The returns are the
  // engine's own unstake lines, so a run that stopped halfway resumes from the
  // positions still open and never pays twice.
  const acted = await holdTurn(async () => {
    const inFlight = route === "take-back" ? await inFlightFor(actor, deps) : 0; // BEFORE the rows: see inFlightFor
    const { units, attachments } = await deps.readRows();
    if (exitedMarks(units).has(id)) return { already: true, units };
    const fold = foldUnits(units);
    if (route === "take-back")
      refuseOverCarry({ who: actor, units: totalOf(fold, actor) + inFlight, things: thingsCarried(attachments, actor), adding: 1, cap });
    const plan = returnsAtExit({ mark: id, holders: await settledHolders(id, deps) });
    const returned = [];
    for (const r of plan) {
      const out = await deps.unstake(r);
      if (out?.error) throw bounce(503, `the return to ${r.handle} could not be recorded: ${out.defect ?? out.error}`,
        `${returned.length} of ${plan.length} returns are recorded; the mark stands and nothing else moved. Ask again: the returns already made are not made twice.`, { returned });
      if (appliedOf(out) > 0) returned.push(receiptOf(r, out)); // a position already closed returned nothing, and is not a receipt
    }
    const moves = route === "take-back" ? [{ from: null, to: actor, label, n: 1 }] : [];
    const action = route === "take-back" ? UNIT_ACTION.takeBack : UNIT_ACTION.consumeInPlace;
    const w = await writeUnits(deps, key, actor, { action, object: id, moves, payload: { label, mark: id, returns: returned } });
    const after = [...units, { class: "holding", action, object: id, payload: { moves } }];
    return { ...w, returned, after: foldUnits(after), units: after };
  });

  // ── THE MARK LEAVES, AND A FAILED WITHDRAWAL IS FINISHED ON RETRY (finding 2).
  // The withdrawal is recorded as done by its own unit act
  // (`units:exit-withdrawn`), so a retry of an exit the record already shows —
  // which gains no unit and returns nothing — still reaches the pen when that
  // act is missing, and stops asking once it is there.
  const withdrawnBefore = withdrawnMarks(acted.units).has(id);
  let withdrawn = withdrawnBefore ? { withdrawn: true, already: true } : null;
  let late = [];
  if (!withdrawnBefore) {
    try {
      // ── EVERY STAKE IS RETURNED BEFORE THE MARK LEAVES (Wright's independent
      // review, F4). A stake can land after the exit read its holders; the
      // withdrawal below goes straight to the journal, past the door that
      // refuses to withdraw a staked mark. So the holders are read AGAIN right
      // before it, and any open position is returned through the same engine
      // unstake (clipped to what is open, so a staker already repaid is not
      // repaid again) — on a fresh exit and on a cleanup retry alike. A return
      // that fails, or stakes that keep arriving, leave the withdrawal pending
      // and say so; it is finished only when it actually completes.
      late = await holdTurn(() => lateReturns(id, deps));
      // the cause is the exit itself: this call's act when it made one, else the
      // ORIGINAL exit on the record, with its own actor and route — whoever asks
      // again only finishes that exit's withdrawal, and is named as such
      const cause = acted.already ? exitCauseOf(acted.units, id) : { exit: route, by: actor, act: acted.seq ?? null };
      withdrawn = await deps.withdraw({ by, slug, household, cause });
      if (withdrawn?.withdrawn !== false)
        await holdTurn(() => writeUnits(deps, key, actor, { action: UNIT_ACTION.exitWithdrawn, object: id, moves: [],
          payload: { mark: id, by, exit: cause, ...(acted.already ? { finished_by: actor } : {}), ...(late.length ? { late_returns: late } : {}) } }));
    } catch (e) {
      late = e?.returned ?? late;
      withdrawn = { withdrawn: false, why: String(e?.defect ?? plainReason(e, "record", "a unit's withdrawal")).slice(0, 200),
        retry: "ask again: the unit is not gained and no stake is returned a second time; only the withdrawal is tried again, after any stake still open on the mark is returned" };
    }
  }

  if (acted.already)
    return { did: route, units: true, mark: id, label, duplicate: true, returns: [], ...(late.length ? { late_returns: late } : {}), withdrawn,
      note: `${id} already left the counts; nothing was gained or returned a second time${withdrawnBefore ? "" : ", and the mark's withdrawal was tried again"}` };
  return { did: route, units: true, mark: id, label, seq: acted.seq, effect: acted.effect, returns: acted.returned, ...(late.length ? { late_returns: late } : {}),
    returns_note: acted.returned.length ? `${acted.returned.length} staker(s) had their stamps on this mark returned, one line each` : "no stake stood on this mark, so nothing was returned",
    withdrawn, ...(route === "take-back" ? { holds: holdsBlock(acted.after, actor, view) } : {}) };
}

// ── A DROPPED UNIT'S MARK, WITHDRAWN BEFORE PUBLICATION (WLD-27 D) ─────────
//
// Wright (AUTHORITY 2026-10-13T05:20:23Z, D): "withdrawing a dropped unit
// before it's published returns the unit to the dropper, whether it was a
// draft or pending … After publication, getting it back is a take-back, never
// a withdraw." And the carry case, ruled 06:44:41Z: "it's an ADD to their
// hands and obeys the carry cap of 24 like every add. If the dropper has no
// free slot, the withdraw is refused before anything is retracted or written …
// 'your hands are full (24/24): drop, give or consume one, then withdraw'.
// There's no pending-return state and no over-cap exception."
//
// So the withdrawal of such a mark runs IN THE HOLD QUEUE'S TURN, as every add
// does: the dropper's room is read there (in-flight first, then the held rows,
// § inFlightFor) and the withdrawal — deed, docket half, and the unit's return
// in its one transaction (drop-recovery.mjs § withdrawRestoreGuard) — is
// written before the turn ends, so no other add can take the slot between the
// check and the write. The tick runs in another process, but it only ever
// returns a drop still OUT, which the in-flight count already holds a slot for.

const handsFull = (dropper, caller, e) => bounce(409, `${dropper}'s hands are full (${e.carried}/${e.cap}) — the unit this mark is would come back to them`,
  `${caller === dropper ? "your hands are full" : `${dropper}'s hands are full`} (${e.carried}/${e.cap}): drop, give or consume one, then withdraw. Nothing was withdrawn and nothing was recorded.`,
  { carried: e.carried, cap: e.cap });

/**
 * The public withdrawal of `mark` (by its author `by`), when it is a dropped
 * unit's mark: null for any other mark (the ordinary withdrawal runs). `withdraw`
 * is the door's journalWithdraw, given the guards it must hold in its write.
 */
export async function withdrawDroppedUnit({ mark, by, household, caller = null, guard = null, withdraw }, deps) {
  const { droppedUnitOf, returnedByWithdrawal, prepublication, takeBackRefusal, withdrawRestoreGuard } = await import("./drop-recovery.mjs");
  const unit = await deps.droppedUnit({ mark, by, household }, droppedUnitOf);
  if (!unit || !prepublication(unit) || unit.exited) {
    if (unit?.published && !unit.exited) throw takeBackRefusal(mark);
    // A REPLAY of a withdrawal that already brought the unit back answers as
    // what it is — done, nothing returned now — and is never read as a fresh
    // add (the carry ruling: "do not confuse a replay … with a fresh add").
    const before = await deps.droppedUnit({ mark, by, household }, returnedByWithdrawal); // by the mark's own record, not its name (R2)
    if (before) return { id: mark, withdrawn: true, already: true, unit_returned: 0, returned_before: before.act,
      note: `${mark} was already withdrawn and its unit already came back (act ${before.act}); nothing was written now` };
    return null;
  }
  const view = deps.classes();
  if (!view.readable) throw bounce(503, "the class layer could not be read, so the carry cap cannot be asked",
    "withdrawing a set-down unit's mark brings the unit back to its dropper's hands, and that add is judged against the carry cap; nothing was withdrawn — try again when the law is loaded");
  const cap = carryOf(view);
  return holdTurn(async () => {
    const inFlight = await inFlightFor(unit.dropper, deps); // BEFORE the rows: see inFlightFor
    const { units, attachments } = await deps.readRows();
    try {
      refuseOverCarry({ who: unit.dropper, units: totalOf(foldUnits(units), unit.dropper) + inFlight, things: thingsCarried(attachments, unit.dropper), adding: 1, cap });
    } catch (e) { if (e?.cap != null) throw handsFull(unit.dropper, caller, e); throw e; }
    const out = {};
    const restore = withdrawRestoreGuard({ mark, by, crossing: deps.crossing(), withdrawnBy: caller, out });
    // the candle and the drop's lock first, then the mark's (mark-stake-lock.mjs § LOCK ORDER)
    const both = guard ? async (c) => { await restore(c); await guard(c); } : restore;
    const r = await withdraw({ guard: both });
    return { ...r, unit_returned: out.restored ?? 0,
      ...(out.restored ? { unit: { label: unit.label, to: unit.dropper, act: out.act },
        unit_note: `withdrawn before it was published (${unit.status}), so the 1 ${unit.label} it was came back to ${unit.dropper}` } : {}) };
  });
}

export const STORE_ONLY = "dropped-unit-withdraw-store-only";

/**
 * On the git (non-single-log) withdraw lane: the named refusal for a dropped
 * unit's mark, or null for any other mark (Wright, 2026-10-13T07:52:24.868Z).
 * Known from the store when the office has one — the claim's own exact drop
 * reference, as D reads it — else from the mark's own record on the world. A
 * store that cannot be asked refuses too: a set-down unit cannot be told apart
 * there, and this lane must not withdraw one unknowingly.
 */
export async function droppedUnitOnGitLane({ mark, by, household }, deps = null) {
  const refusal = (why) => ({ code: 409, reason: STORE_ONLY,
    defect: `"${mark}" is a set-down unit's mark, and it is withdrawn only on the store's path (${STORE_ONLY})`,
    hint: `${why} Withdrawing it returns the unit to its dropper, and only the single-log store path (WORLD_SINGLE_LOG=1) makes that return; this office writes marks on the git lane, so nothing was written. Once it is published it is taken back instead: world_hold { thing: "${mark}" }.` });
  const { world2Enabled } = await import("./world2-acts.mjs");
  if (world2Enabled()) {
    const d = deps ?? await liveUnitDeps();
    let unit;
    try { unit = await d.droppedUnit({ mark, by, household }, (await import("./drop-recovery.mjs")).droppedUnitOf); }
    catch (e) {
      return { code: 503, reason: STORE_ONLY, defect: `the store could not say whether "${mark}" is a set-down unit's mark`,
        hint: `a set-down unit's mark is withdrawn only on the store's path, and this lane cannot tell without asking it; nothing was written — try again; ${faultLogged(`the store could not say whether "${mark}" is a set-down unit's mark`, e)}` };
    }
    if (unit) return refusal("Its claim names the set-down it is.");
  }
  const record = await (await import("./world.mjs")).worldMarkById(String(mark)).then((r) => r.mark).catch(() => null);
  return isDroppedUnitMark(record) ? refusal("The world's record names the set-down it is.") : null;
}

// ── THE READS: a holder's card and doorstep, and the map's chests ───────────
//
// "Held stacks appear on the holder's card and doorstep, NOT as free map pips.
// Supply World viewer and site rendering from the authoritative reads, not
// generated JSON edits or a second stored display count." Every number below is
// the fold of the record's unit acts, at the moment of the read.

/** One chest as a reader sees it — its counts, what it shows, and why it is empty when that needs saying. */
export function chestFace({ mark, fold, stocked, labels, view, heldBy = null, things = [] }) {
  const id = String(mark.id);
  const block = holdsBlock(fold, id, view, things);
  const by = String(mark.by ?? id.split("/")[0]);
  let capacity = null;
  try { capacity = capacityOf(mark, chestDialsFor(view, mark)); } catch { capacity = null; }
  const unstocked = !stocked.has(id) && !labelOfCreator(labels, by);
  return {
    chest: id, by, at: mark.at ?? null, extent: mark.extent ?? null,
    capacity, portable: portableOf(mark, view.dials("chest")), welcome: welcomeOf(mark, chestDialsFor(view, mark)),
    count: block.count, class: block.class, shows: block.count ? block.shows : "empty", edges: block.edges,
    ...(block.things ? { things: block.things } : {}),
    ...(heldBy ? { held_by: heldBy, carried_note: `${heldBy} is carrying it; it rides its holder and is drawn on their card, not as a pip of its own` } : {}),
    ...(unstocked && block.count === 0
      ? { empty_because: `no candy was registered for ${by}, so the town has not stocked it; it is stocked at the first settlement after ${by}'s candy label is registered` }
      : {}),
  };
}

/** The live collaborators the reads need. */
async function liveReadDeps() {
  const [{ lawSnapshot }, world, guards] = await Promise.all([import("./law-snapshot.mjs"), import("./world.mjs"), import("./world2-guards.mjs")]);
  return {
    classes: () => classViewOf(lawSnapshot()),
    units: async () => (await guards.storeHoldingRows()).filter(isUnitRow),
    attachments: () => guards.storeAttachmentRows(),
    marks: () => world.worldMarksAll(),
  };
}

/** The whole things inside each chest, by chest id, with their classes from the marks in hand. */
function thingsInChests(attachments, marks) {
  const classOf = new Map(marks.map((m) => [String(m.id), markClassOf(m) ?? "thing"]));
  const out = new Map();
  for (const t of new Set(attachments.map((r) => String(r.target)))) {
    const h = liveHolder(attachments, t);
    if (!isChestId(h)) continue;
    if (!out.has(h)) out.set(h, []);
    out.get(h).push({ thing: t, class: classOf.get(t) ?? "thing" });
  }
  return out;
}

/** Every chest on the map, with its live count — GET /world/chests, keyless. */
export async function chestsRead(deps = null) {
  const d = deps ?? await liveReadDeps();
  const view = d.classes();
  const [units, attachments, marks] = await Promise.all([d.units(), d.attachments(), d.marks()]);
  const fold = foldUnits(units);
  const stocked = stockedChests(units);
  const labels = view.labels();
  const inside = thingsInChests(attachments, marks);
  const chests = marks.filter((m) => markClassOf(m) === "chest")
    .map((mark) => chestFace({ mark, fold, stocked, labels, view, heldBy: liveHolder(attachments, String(mark.id)), things: inside.get(String(mark.id)) ?? [] }));
  return { chests, count: chests.length,
    reading_law: "a chest shows its label (or its contents' nearest common class) and its live count, folded from the record's acts at this read — never a stored number" };
}

/**
 * What one resident holds and the chests that are theirs to show — the card's
 * and the doorstep's block. A chest is on this card when the resident MADE it
 * or is CARRYING it (Bevel's review, finding 4: the map hid a carried bag's pip
 * and no card showed it). Authorship never moves: each row says `by` and, when
 * someone carries it, `held_by`.
 */
export async function residentHolds(handle, deps = null) {
  const d = deps ?? await liveReadDeps();
  const view = d.classes();
  const [units, attachments, marks] = await Promise.all([d.units(), d.attachments(), d.marks()]);
  const fold = foldUnits(units);
  const stocked = stockedChests(units);
  const labels = view.labels();
  const mine = labelOfCreator(labels, handle);
  const inside = thingsInChests(attachments, marks);
  const h = String(handle);
  const chests = marks.filter((m) => markClassOf(m) === "chest"
      && (String(m.by ?? String(m.id).split("/")[0]) === h || liveHolder(attachments, String(m.id)) === h))
    .map((mark) => chestFace({ mark, fold, stocked, labels, view, heldBy: liveHolder(attachments, String(mark.id)), things: inside.get(String(mark.id)) ?? [] }));
  return {
    holds: holdsBlock(fold, handle, view),
    ...(mine ? { label: mine } : {}),
    chests,
  };
}

/**
 * A WHOLE THING INTO A CHEST (Bevel's review: the specification's chest takes
 * any things — a toaster beside 101 candies makes 102 things). The thing's
 * holding edge moves from the resident to the chest, by the hold lane's own act
 * (`give`, holder = the chest's id), so who-holds-which-thing stays one fold.
 * It takes one slot of the chest's one capacity; it leaves the carrier's load.
 */
async function thingIntoChest(args, key, actor, deps, view) {
  const thing = String(args.thing), chestId = String(args.to);
  if (thing === chestId) throw bounce(422, "a chest cannot hold itself", "Nothing was recorded.");
  const { capacity } = await chestOrThrow(deps, chestId, view);
  const mark = await deps.markById(thing);
  if (!mark) throw bounce(409, `${thing} does not stand on the world`, "only a published thing goes into a chest; a private draft changes no hands. Nothing was recorded.");
  refuseIfTaken(String(markClassOf(mark) ?? "thing"), view);
  await deps.reachTake(chestId, actor);
  return holdTurn(async () => {
    const { units, attachments } = await deps.readRows();
    const holder = liveHolder(attachments, thing);
    if (holder !== actor) throw bounce(409, `you are not holding ${thing} — ${holder ?? "nobody"} is`, "a thing goes into a chest from your hands. Nothing was recorded.");
    // NO CHEST INSIDE ITSELF, however deep, and no loop followed: the hold lane's one check (holder-tree.mjs)
    refuseNesting({ rows: attachments, thing, into: chestId, noun: "chest", nothing: "Nothing was recorded." });
    const fold = foldUnits(units);
    // COUNTS CONFER UP (Darko 2026-10-17 23:29): the thing takes 1 and everything it holds, here and in every holder above
    const adding = weightOf({ up: liveHolders(attachments), thing, unitsOf: (h) => totalOf(fold, h) });
    const used = totalOf(fold, chestId) + wholeLoadIn(attachments, fold, chestId);
    if (used + adding > capacity) throw bounce(409, `${chestId} has no room — ${used} of ${capacity}${adding > 1 ? `, and ${thing} takes ${adding}` : ""}`,
      "its one capacity holds units and whole things alike, a holder counting 1 and everything it holds. Nothing was recorded.");
    const above = await refuseOverRoomAbove({ deps, view, fold, attachments, holder: chestId, n: adding, nothing: "Nothing was recorded." });
    const w = await writeThingHolding(deps, key, actor, attachments, { did: "give", thing, holder: chestId, previous: actor, madeBy: String(mark.by ?? thing.split("/")[0]) },
      { guard: chestRoomGuard({ chest: chestId, capacity, adding, above }) });
    const after = [...attachments, { entity: chestId, target: thing, policy: "cascade", born_at: w.at }];
    return { did: "give", thing, to: chestId, into_chest: true, ...w,
      chest: holdsBlock(fold, chestId, view, await thingsHeldBy(after, chestId, deps.markById)) };
  });
}

/** A WHOLE THING OUT OF A CHEST: a take aimed at a holder other than yourself — reach, welcome, the carry cap. */
async function thingFromChest(args, key, actor, deps, view, cap) {
  const thing = String(args.thing), chestId = String(args.from);
  const { mark: chest } = await chestOrThrow(deps, chestId, view);
  if (welcomeOf(chest, chestDialsFor(view, chest)) !== "open") {
    const same = sameHousehold(String(chest.by ?? chestId.split("/")[0]), actor, deps.householdOf);
    if (!same.same) throw bounce(403, `${chestId} is closed to other households`, "its welcome is closed: only its maker's household takes from it. Nothing was recorded.");
  }
  const mark = await deps.markById(thing);
  refuseIfTaken(String(markClassOf(mark) ?? "thing"), view);
  await deps.reachTake(chestId, actor);
  return holdTurn(async () => {
    const inFlight = await inFlightFor(actor, deps); // BEFORE the rows: see inFlightFor
    const { units, attachments } = await deps.readRows();
    const holder = liveHolder(attachments, thing);
    if (holder !== chestId) throw bounce(409, `${chestId} is not holding ${thing}`, holder ? `${holder} is. Nothing was recorded.` : "it stands on the ground. Nothing was recorded.");
    refuseOverCarry({ who: actor, units: totalOf(foldUnits(units), actor) + inFlight, things: thingsCarried(attachments, actor), adding: 1, cap });
    await refuseSecondHolder({ who: actor, actor, adding: [thing], held: holdingsOf(attachments, actor), markById: deps.markById, view, nothing: "Nothing was recorded." });
    const w = await writeThingHolding(deps, key, actor, attachments, { did: "take", thing, holder: actor, previous: chestId, madeBy: String(mark?.by ?? thing.split("/")[0]) });
    return { did: "take", thing, from: chestId, holder: actor, ...w };
  });
}

/**
 * The hold lane's own act for a thing changing hands, in `holdingEntry`'s one
 * shape — stamped strictly after the thing's newest holding row, the same
 * guard `declareHolding` keeps against the same-millisecond swallow.
 */
export async function writeThingHolding(deps, key, actor, attachments, change, { guard = null } = {}) {
  const { entry, at } = await thingHoldingEntry(deps, key, actor, attachments, change);
  const row = await deps.append(entry, guard ? { guard } : {});
  return { seq: row?.actId ?? row?.seq ?? null, at, effect: entry.effect };
}

/** The holding act for a thing changing hands, composed and not written: `{ entry, at }` (LOGOS v2, O2: one transaction may carry several). */
export async function thingHoldingEntry(deps, key, actor, attachments, { did, thing, holder, previous, madeBy, owns = false }, stamp = null) {
  const prior = rowsFor(attachments, thing);
  const newest = prior.length ? Date.parse(prior[prior.length - 1].born_at) : NaN;
  const now = Date.now();
  const at = new Date(Number.isFinite(newest) && newest >= now ? newest + 1 : now).toISOString();
  const { at: anchor, witnesses } = stamp ?? await deps.stamp(actor);
  const entry = holdingEntry({ did, thing, holder, previous_holder: previous, made_by: madeBy, policy: "cascade", declared_by: actor, at, owns },
    { crossing: deps.crossing(), at: anchor, witnesses, cls: "holding", household: deps.household(key) });
  return { entry, at };
}
