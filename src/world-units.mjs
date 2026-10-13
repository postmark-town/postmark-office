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
  capacityOf, portableOf, welcomeOf, holdingDisplay, refuseOverCarry, stolenRefusal,
  planGive, planTake, planConsume, planRefill, refillerLabel, droppedUnitMark, isDroppedUnitMark, returnsAtExit, isChestId, isUnitRow,
  withdrawnMarks, ancestry, selectLabel, stockedChests,
} from "./world-stacks.mjs";
import { holdingsOf, sameHousehold, holdTurn, liveHolder, rowsFor, holdingEntry } from "./world-hold.mjs";
import { chestRoomGuard } from "./chest-lock.mjs";
import { dropUndoGuard, undoNonce } from "./drop-recovery.mjs";

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
    labels: () => candyLabels(rec("candy")),
    readable: Boolean(snap?.classes?.size),
    // every class the snapshot says is stolen (WLD-7): a whole thing whose own
    // class could not be read is only safe to move while this is empty
    stolenAny: () => [...(snap?.classes?.keys() ?? [])].some((n) => dialsOf(n).stolen === true),
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
    reachTake: async (thing, actor) => hold.refuseOutOfReach({ thing, to: null, actor, act: "take", holder: null }),
    // A give of units is a take at arm's length, clause 3's measure in its one home.
    reachGive: async (to, actor) => {
      const s = await world.residentStandpoint(String(actor)).catch(() => null);
      return hold.armsLengthOrThrow({ thing: "units", to, here: s?.placed ? { x: s.x, y: s.y } : null, actor });
    },
    standpoint: async (actor) => { const s = await world.residentStandpoint(String(actor)).catch(() => null); return s?.placed ? { x: s.x, y: s.y } : null; },
    householdOf: await (async () => { try { return await (await import("./households.mjs")).householdLookup(); } catch { return null; } })(),
    append: (entry, opts = {}) => journal.appendActFlipped(null, entry, opts),
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
    dropsOut: async (actor) => pen.officeRead(async (c) => (await import("./drop-recovery.mjs")).dropsStillOut(c, actor), { by: "dropsOut" }),
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
  for (const id of holdingsOf(attachments, String(holder))) out.push({ thing: id, class: (await markById(id).catch(() => null))?.class ?? "thing" });
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

// ── THE STOLEN CLASS, ASKED OF THE TURN'S OWN LAW (WLD-7) ───────────────────
//
// `view` is the class layer as it stood when the call came in, and a call can
// wait — behind other holds in the queue, on its reach lookups — while a new
// law snapshot is published (law-snapshot.mjs § THE PUBLISH: one assignment).
// So the stolen question is asked INSIDE the hold turn, of the snapshot
// published at that moment, after the turn's own refusals and before its first
// write. That read is the linearisation point: a publication that lands before
// it governs the act (stolen refuses, returned admits); one that lands after it
// finds the act already admitted, and an admitted act is not undone.
const classesNow = (deps) => {
  const now = deps.classes();
  if (!now.readable) throw bounce(503, "the class layer could not be read, so the office cannot tell candy from anything else",
    "counted units read the candy, chest and thing classes from the record; nothing was recorded — try again when the law is loaded");
  return now;
};
const refuseIfStolenNow = (deps, klassOf, what) => { const now = classesNow(deps); const r = stolenClassRefusal(klassOf(now), now, what); if (r) throw r; };

/**
 * THE STOLEN QUESTION, ONE ANSWER FOR EVERY DOOR (WLD-7; Wright, AUTHORITY
 * 2026-10-13T10:11:01.510Z). `klass` is what the act is judged by: a class
 * name; `null` for a thing whose canon mark was READ and carries no class (it
 * is a `thing`); `undefined` when it cannot be told — no mark, canon unread, a
 * label the law does not register. `what` names it in the refusal.
 *
 *   no class stolen     inert: nothing here refuses, whatever is unknown
 *   a class stolen      the class and every ancestor must be in the law; then
 *                       `stolenRefusal` answers (423 with the clue, or null). A
 *                       class that cannot be told, or a chain with a class the
 *                       law does not hold, is refused by name and retryable —
 *                       unknown is never unstolen while a heist runs
 *   no law loaded       inert here — THE COLD-START WINDOW, accepted and
 *                       disclosed (Wright 10:36:28.315Z): before a process's
 *                       first law snapshot nothing can be known stolen, and a
 *                       published snapshot is never replaced by none, so this
 *                       is only that window. No second flag stands in for it.
 *                       The unit door's own "class layer could not be read"
 *                       refusal (which predates WLD-7) is unchanged
 */
export function stolenClassRefusal(klass, view, what) {
  if (!view.readable || !view.stolenAny()) return null;
  const c = klass === null ? "thing" : klass;
  if (c === undefined || ancestry(c, view.extendsOf).some((n) => !view.record(n)))
    return bounce(503, `the office can't tell whether ${what} is of a stolen class right now`,
      "a class is stolen, and this one's class (or a class it extends) is not on the record the office reads, so it is not moved on a guess. Nothing was recorded — try again.",
      { reason: "stolen-class-unknown" });
  return stolenRefusal(c, view.record, view.extendsOf);
}

/** What canon says a thing is, for `stolenClassRefusal`: its class, null when read and unclassed, undefined when not read. */
export const markClassFor = (mark) => (mark && typeof mark === "object" ? (mark.class == null ? null : String(mark.class)) : undefined);

/** A counted unit is judged by its OWN label: registered candy, or not known. */
const labelClassIn = (view) => (label) => (labelRecord(view.labels(), label) ? "candy" : undefined);

const carryOf = (view) => { const cap = view.dials("thing")?.carry_cap; return Number.isInteger(cap) ? cap : null; };

async function chestOrThrow(deps, id, view) {
  const mark = await deps.markById(id);
  if (!mark) throw bounce(404, `${id} does not stand on the world`, "a chest is a published mark; a private draft holds nothing yet. Nothing was recorded.");
  if (mark.class !== "chest") throw bounce(422, `${id} is not a chest`, `it is ${mark.class ? `a ${mark.class}` : "an unclassed mark"}; units go into chests and residents' hands. Nothing was recorded.`);
  return { mark, capacity: capacityOf(mark, view.dials("chest")) };
}

/**
 * THE UNIT DOOR. `route` is `unitRouteOf`'s answer; `actor` is already the
 * key's own resident (callHoldTool § actingHandle); the freeze was asked.
 */
export async function callUnits(route, args, key, actor, deps) {
  const view = deps.classes();
  if (!view.readable) throw bounce(503, "the class layer could not be read, so the office cannot tell candy from anything else",
    "counted units read the candy, chest and thing classes from the record; nothing was recorded — try again when the law is loaded");
  const cap = carryOf(view);

  switch (route) {
    case "take": {
      const from = String(args.from);
      const { mark } = await chestOrThrow(deps, from, view);
      if (welcomeOf(mark, view.dials("chest")) !== "open") {
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
        refuseIfStolenNow(deps, (now) => labelClassIn(now)(plan.label), plan.label);
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
        // the chest's one capacity is shared by its counted units and the whole things in it
        const capacityOfTo = chestCap == null ? null : chestCap - holdingsOf(attachments, to).length;
        const plan = planGive({ fold, actor, to, label: args.label ?? null, n, capacityOfTo });
        refuseIfStolenNow(deps, (now) => labelClassIn(now)(plan.label), plan.label);
        if (!isChestId(to)) refuseOverCarry({ who: to, units: totalOf(fold, to) + inFlight, things: thingsCarried(attachments, to), adding: n, cap });
        // INTO A CHEST, the room is judged again under the chest's own lock inside
        // the write's transaction — the tick's stock is another process (finding 6)
        const w = await writeUnits(deps, key, actor, plan, isChestId(to) ? { guard: chestRoomGuard({ chest: to, capacity: chestCap, adding: n }) } : {});
        const after = foldUnits([...units, { class: "holding", action: plan.action, payload: { moves: plan.moves } }]);
        return { did: "give", units: true, label: plan.label, count: n, to, ...w, holds: holdsBlock(after, actor, view),
          receiver: isChestId(to) ? await chestBlock(after, to, view, attachments, deps) : holdsBlock(after, to, view) };
      });
    }
    case "consume": {
      return holdTurn(async () => {
        const { units } = await deps.readRows();
        const fold = foldUnits(units);
        // the selection first (what you hold, which label), then the stolen
        // question, THEN whether it is consumable: while a class is stolen an
        // unregistered label is not proven non-consumable (Wright 10:36:28.315Z)
        const edge = selectLabel(edgesOf(fold, actor), args.label ?? null, { where: "your hands", verb: "consume" });
        refuseIfStolenNow(deps, (now) => labelClassIn(now)(edge.label), edge.label);
        const plan = planConsume({ fold, actor, label: edge.label, classOfLabel: classOfLabelIn(view), extendsOf: view.extendsOf });
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
        const plan = planRefill({ fold, actor, chest, capacity: capacity - holdingsOf(attachments, chest).length, labels: view.labels(), maker });
        if (plan.noop) return { did: "refill", units: true, noop: true, note: plan.note, chest: await chestBlock(fold, chest, view, attachments, deps) };
        refuseIfStolenNow(deps, (now) => labelClassIn(now)(plan.label), plan.label);
        const w = await writeUnits(deps, key, actor, { ...plan, payload: { label: plan.label, capacity } },
          { guard: chestRoomGuard({ chest, capacity, adding: plan.moves[0].n }) });
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
        refuseIfStolenNow(deps, (now) => labelClassIn(now)(edge.label), edge.label);
        const moves = [{ from: actor, to: null, label: edge.label, n: 1 }];
        const w = await writeUnits(deps, key, actor, { action: UNIT_ACTION.drop, object: actor, moves, payload: { label: edge.label, at: stood } });
        reserve(actor, 1); // the slot is held until the filing settles (finding 3)
        return { label: edge.label, ...w };
      });
      const name = labelRecord(view.labels(), dropped.label)?.name ?? dropped.label;
      const payload = droppedUnitMark({ actor, label: dropped.label, name, actId: dropped.seq, at: stood });
      let filed = null, why = null;
      try {
        filed = await deps.leave(payload, key, { dropUnit: { actId: dropped.seq, label: dropped.label } });
        if (filed?.error) { why = filed.defect ?? filed.error; filed = null; }
      } catch (e) { why = String(e?.defect ?? e?.message ?? e).slice(0, 200); }
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
            else stuck = String(e?.defect ?? e?.message ?? e).slice(0, 200);
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
async function lateReturns(id, deps) {
  const returned = [];
  for (let pass = 0; pass < LATE_PASSES; pass++) {
    const plan = returnsAtExit({ mark: id, holders: await deps.holders(id) });
    if (!plan.length) return returned;
    for (const r of plan) {
      const out = await deps.unstake(r);
      if (out?.error) throw bounce(503, `a late stake by ${r.handle} could not be returned: ${out.defect ?? out.error}`,
        "the mark stands and its withdrawal waits; ask again — what was returned is not returned twice", { returned });
      const n = Number(out?.applied ?? r.stamps);
      if (n > 0) returned.push({ handle: r.handle, stamps: n, line: out?.line ?? null });
    }
  }
  throw bounce(409, `stakes kept arriving on ${id} while it was leaving`,
    "the mark stands and its withdrawal waits; ask again — every stake returned so far stays returned", { returned });
}

async function markExit(route, args, key, actor, deps, view, cap) {
  const id = String(args.thing);
  const mark = await deps.markById(id);
  // no mark to read is an unknown class, not a proven non-unit, while a class is stolen
  if (!mark) refuseIfStolenNow(deps, () => undefined, id);
  if (!isDroppedUnitMark(mark)) throw bounce(422, `${id} is not a unit that was set down`, "only a dropped unit's mark goes back into a holding or is consumed where it stands. Nothing was recorded.");
  const label = String(mark.label);
  if (route === "consume-in-place") {
    const klass = classOfLabelIn(view)(label) ?? String(mark.class);
    if (!ancestry(klass, view.extendsOf).includes("consumable"))
      throw bounce(422, `${label} is not a consumable`, "Nothing was recorded.");
  }
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
    // before the carry slot and before any stake is returned: a stolen candy
    // set down stays a mark, and nobody's position on it moves
    refuseIfStolenNow(deps, () => markClassFor(mark), id);
    const fold = foldUnits(units);
    if (route === "take-back")
      refuseOverCarry({ who: actor, units: totalOf(fold, actor) + inFlight, things: thingsCarried(attachments, actor), adding: 1, cap });
    const plan = returnsAtExit({ mark: id, holders: await deps.holders(id) });
    const returned = [];
    for (const r of plan) {
      const out = await deps.unstake(r);
      if (out?.error) throw bounce(503, `the return to ${r.handle} could not be recorded: ${out.defect ?? out.error}`,
        `${returned.length} of ${plan.length} returns are recorded; the mark stands and nothing else moved. Ask again: the returns already made are not made twice.`, { returned });
      returned.push({ handle: r.handle, stamps: Number(out?.applied ?? r.stamps), line: out?.line ?? null });
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
      withdrawn = { withdrawn: false, why: String(e?.defect ?? e?.message ?? e).slice(0, 200),
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
  try { capacity = capacityOf(mark, view.dials("chest")); } catch { capacity = null; }
  const unstocked = !stocked.has(id) && !labelOfCreator(labels, by);
  return {
    chest: id, by, at: mark.at ?? null, extent: mark.extent ?? null,
    capacity, portable: portableOf(mark, view.dials("chest")), welcome: welcomeOf(mark, view.dials("chest")),
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
  const classOf = new Map(marks.map((m) => [String(m.id), m.class ?? "thing"]));
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
  const chests = marks.filter((m) => m?.class === "chest")
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
  const chests = marks.filter((m) => m?.class === "chest"
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
  await deps.reachTake(chestId, actor);
  return holdTurn(async () => {
    const { units, attachments } = await deps.readRows();
    const holder = liveHolder(attachments, thing);
    if (holder !== actor) throw bounce(409, `you are not holding ${thing} — ${holder ?? "nobody"} is`, "a thing goes into a chest from your hands. Nothing was recorded.");
    // yours first, then the stolen question, THEN whether canon holds it: while a
    // class is stolen a thing canon does not show is an unknown class (Wright 10:36:28.315Z)
    refuseIfStolenNow(deps, () => markClassFor(mark), thing);
    if (!mark) throw bounce(409, `${thing} does not stand on the world`, "only a published thing goes into a chest; a private draft changes no hands. Nothing was recorded.");
    // NO CHEST INSIDE ITSELF, however deep: walk the chest's own holders.
    for (let h = liveHolder(attachments, chestId), hops = 0; h && hops < 64; h = liveHolder(attachments, h), hops++)
      if (h === thing) throw bounce(422, `${chestId} is inside ${thing}`, "a chest cannot be put inside what it is carried in. Nothing was recorded.");
    const fold = foldUnits(units);
    const used = totalOf(fold, chestId) + holdingsOf(attachments, chestId).length;
    if (used + 1 > capacity) throw bounce(409, `${chestId} has no room — ${used} of ${capacity}`, "its one capacity holds units and whole things alike. Nothing was recorded.");
    const w = await writeThingHolding(deps, key, actor, attachments, { did: "give", thing, holder: chestId, previous: actor, madeBy: String(mark.by ?? thing.split("/")[0]) },
      { guard: chestRoomGuard({ chest: chestId, capacity, adding: 1 }) });
    const after = [...attachments, { entity: chestId, target: thing, policy: "cascade", born_at: w.at }];
    return { did: "give", thing, to: chestId, into_chest: true, ...w,
      chest: holdsBlock(fold, chestId, view, await thingsHeldBy(after, chestId, deps.markById)) };
  });
}

/** A WHOLE THING OUT OF A CHEST: a take aimed at a holder other than yourself — reach, welcome, the carry cap. */
async function thingFromChest(args, key, actor, deps, view, cap) {
  const thing = String(args.thing), chestId = String(args.from);
  const { mark: chest } = await chestOrThrow(deps, chestId, view);
  if (welcomeOf(chest, view.dials("chest")) !== "open") {
    const same = sameHousehold(String(chest.by ?? chestId.split("/")[0]), actor, deps.householdOf);
    if (!same.same) throw bounce(403, `${chestId} is closed to other households`, "its welcome is closed: only its maker's household takes from it. Nothing was recorded.");
  }
  const mark = await deps.markById(thing);
  await deps.reachTake(chestId, actor);
  return holdTurn(async () => {
    const inFlight = await inFlightFor(actor, deps); // BEFORE the rows: see inFlightFor
    const { units, attachments } = await deps.readRows();
    const holder = liveHolder(attachments, thing);
    if (holder !== chestId) throw bounce(409, `${chestId} is not holding ${thing}`, holder ? `${holder} is. Nothing was recorded.` : "it stands on the ground. Nothing was recorded.");
    refuseIfStolenNow(deps, () => markClassFor(mark), thing);
    refuseOverCarry({ who: actor, units: totalOf(foldUnits(units), actor) + inFlight, things: thingsCarried(attachments, actor), adding: 1, cap });
    const w = await writeThingHolding(deps, key, actor, attachments, { did: "take", thing, holder: actor, previous: chestId, madeBy: String(mark?.by ?? thing.split("/")[0]) });
    return { did: "take", thing, from: chestId, holder: actor, ...w };
  });
}

/**
 * The hold lane's own act for a thing changing hands, in `holdingEntry`'s one
 * shape — stamped strictly after the thing's newest holding row, the same
 * guard `declareHolding` keeps against the same-millisecond swallow.
 */
async function writeThingHolding(deps, key, actor, attachments, { did, thing, holder, previous, madeBy }, { guard = null } = {}) {
  const prior = rowsFor(attachments, thing);
  const newest = prior.length ? Date.parse(prior[prior.length - 1].born_at) : NaN;
  const now = Date.now();
  const at = new Date(Number.isFinite(newest) && newest >= now ? newest + 1 : now).toISOString();
  const { at: anchor, witnesses } = await deps.stamp(actor);
  const entry = holdingEntry({ did, thing, holder, previous_holder: previous, made_by: madeBy, policy: "cascade", declared_by: actor, at },
    { crossing: deps.crossing(), at: anchor, witnesses, cls: "holding", household: deps.household(key) });
  const row = await deps.append(entry, guard ? { guard } : {});
  return { seq: row?.actId ?? row?.seq ?? null, at, effect: entry.effect };
}
