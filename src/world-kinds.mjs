// world-kinds.mjs — THE KIND DOOR: marks made into a holder, and taken and given
// by kind (LOGOS v2 part 2, lane O2). It replaces #499's label doors
// (world-units.mjs, which #608 ships dark): the same hold lane, the same queue,
// the same `units:*` acts, but every move names its `kind` — a class id — and
// never a `label`, so the fold keeps the two apart (world-stacks § foldUnits).
// The adjudication is kind-holding.mjs's, pure; this file reads the record,
// asks the reach, serializes on the hold queue and writes the act.
//
// WHICH ACT A CALL IS — read off its arguments (and, from the apex, its verb):
//
//   leave-mark { kind, count, to }           make: n marks of the kind into a holder
//   take { from?, kind?, count }             take by kind, or pot luck with no kind;
//                                            `from` omitted: the one holder in reach
//   give { kind?, count, to }                give: to a resident or into a holder
//   refill { thing: <holder>, kind, count }  a class's afforded action, where its
//                                            class declares one (the Candy Bowl)
//
// THE TRANSFER IS ONE EDGE (11:12–11:14; 16:02 item 7): a give and a take are
// one act each, with two ends (`payload.edge`: giver and receiver), and both
// ends must permit it — the giver holds it, the receiver has room, and a holder
// that is not `open` refuses another household at the door.

import { foldUnits, kindEdgesOf, totalOf, unitCount, refuseOverCarry, UNIT_ACTION } from "./world-stacks.mjs";
import { holdingsOf, sameHousehold, holdTurn } from "./world-hold.mjs";
import { chestRoomGuard } from "./chest-lock.mjs";
import { inFlightFor } from "./world-units.mjs";
import { markClassOf } from "./world-grants.mjs";
import {
  makeableKind, holderLawOf, roomIn, refuseOverRoom, blurOf, planMake, planTakeKinds, planGiveKinds,
  oneHolderOf, drawSeed, affordedActions,
} from "./kind-holding.mjs";

const bounce = (code, defect, hint, extra = {}) => {
  const e = new Error(defect);
  Object.assign(e, { code, defect, hint, ...extra });
  return e;
};

const isHolderId = (h) => typeof h === "string" && h.includes("/");
const ownerOf = (mark, id) => String(mark?.by ?? String(id).split("/")[0]);

/**
 * Which kind act this hold call is, or null when it is another door's: a
 * `label:` is #499's (dark), a bare `thing:` is the thing door's. `verb` is the
 * apex's word when it has one (take, give, drop, refill).
 */
export function kindRouteOf(args = {}, verb = null) {
  if (args.label != null || args.chest != null) return null;          // #499's label door (dark, #608)
  if (args.act != null) return String(args.act) === "refill" ? "refill" : null;
  if (args.thing != null) return null;                                 // the thing door's
  if (args.from != null) return "take";
  if (args.kind == null && args.count == null) return isHolderId(args.to) ? "give" : null; // a holder names no thing
  if (args.to != null) return "give";
  return verb === "drop" ? "drop" : "take";
}

const sentence = {
  make: (p) => `${p.actor} made ${p.n} ${p.kind} into ${p.to}`,
  refill: (p) => `${p.actor} refilled ${p.to} with ${p.n} ${p.kind}`,
  take: (p) => `${p.actor} took ${p.n} from ${p.from}`,
  give: (p) => `${p.actor} gave ${p.n} ${p.kind} to ${p.to}`,
};

/** The act, written once on the hold lane; `stamp` is read before the plan when the plan needs it (the draw). */
async function writeKinds(deps, key, actor, plan, { stamp = null, guard = null, words }) {
  const { at, witnesses } = stamp ?? await deps.stamp(actor);
  const entry = {
    crossing: deps.crossing(), actor, action: plan.action, object: String(plan.object), at, witnesses,
    cls: "holding", household: deps.household(key),
    payload: { units: true, kinds: true, moves: plan.moves, edge: plan.edge, ...(plan.via ? { via: plan.via } : {}), ...(plan.draw ? { draw: plan.draw, seed: plan.seed } : {}) },
    effect: words,
  };
  const row = await deps.append(entry, guard ? { guard } : {});
  return { seq: row?.actId ?? row?.seq ?? null, effect: entry.effect };
}

/** What a holder shows after an act: its kinds and its whole things, at the nearest common class. */
async function shownIn(fold, holder, attachments, view, deps, { sharp = false } = {}) {
  const things = [];
  for (const id of holdingsOf(attachments, String(holder))) things.push(markClassOf(await deps.markById(id).catch(() => null)) ?? "thing");
  return { holder: String(holder), ...blurOf({ edges: kindEdgesOf(fold, holder), things, extendsOf: view.extendsOf, sharp }) };
}

/** A published holder, or the refusal: a draft holds nothing yet; a mark that does not hold, says so. */
async function holderOrThrow(deps, id, view) {
  const mark = await deps.markById(id);
  if (!mark) throw bounce(404, `${id} does not stand on the world`, "a holder is a published mark; a private draft holds nothing yet. Nothing was changed.");
  const law = holderLawOf({ holder: id, mark, view });
  if (!law.holder) throw bounce(422, `${id} holds nothing`, `it is ${law.className ? `a ${law.className}` : "a mark of no thing class"} whose holder is false; a holder is a thing its maker made with holder: true. Nothing was changed.`);
  return { mark, law };
}

/** Another household at a holder that is not open: refused at the door (16:02 item 7). */
function refuseIfClosed({ mark, id, law, actor, deps, verb }) {
  if (law.open !== false) return;
  const same = sameHousehold(ownerOf(mark, id), actor, deps.householdOf);
  if (!same.same) throw bounce(403, `${id} is not open to other households`, `its open is false: only its maker's household may ${verb} it. Nothing was changed.`);
}

const carryOf = (view) => holderLawOf({ holder: "resident", view }).capacity;

/**
 * Every holder in reach that holds the kind (or anything, with no kind): the
 * candidates for a take that names no `from` — each with its owner and its
 * distance from where the actor stands.
 */
async function holdersInReach(fold, actor, kind, deps) {
  const here = await deps.standpoint(actor);
  const out = [];
  for (const [holder, kinds] of fold.kinds ?? []) {
    if (!isHolderId(holder) || (kind != null && !kinds.has(String(kind)))) continue;
    const mark = await deps.markById(holder).catch(() => null);
    if (!mark) continue;
    try { await deps.reachTake(holder, actor); } catch { continue; }
    const d = here && mark.at ? Math.round(Math.hypot(Number(mark.at.x) - here.x, Number(mark.at.y) - here.y)) : null;
    out.push({ id: holder, owner: ownerOf(mark, holder), distance_m: d ?? 0 });
  }
  return out;
}

/** Make n marks of a kind into a holder — leave-mark's `to:`, and refill's effect. */
async function makeInto({ args, key, actor, deps, view, via = "leave-mark" }) {
  const { kind } = makeableKind(args.kind, view);
  const n = unitCount(args.count);
  const to = String(args.to);
  let mark = null, law;
  if (!isHolderId(to)) {
    if (to !== String(actor)) throw bounce(422, `make into ${to}? make it into yourself, then give`,
      "leave-mark { kind, count, to } makes into you or a holder; a resident is handed things by a give. Nothing was made.");
    law = holderLawOf({ holder: to, view });
  } else {
    ({ mark, law } = await holderOrThrow(deps, to, view));
    refuseIfClosed({ mark, id: to, law, actor, deps, verb: "make into" });
    await deps.reachTake(to, actor);
  }
  return holdTurn(async () => {
    const inFlight = law.resident ? await inFlightFor(to, deps) : 0; // BEFORE the rows (world-units § inFlightFor)
    const { units, attachments } = await deps.readRows();
    const fold = foldUnits(units);
    const things = holdingsOf(attachments, to).length;
    const room = roomIn({ capacity: law.capacity, fold, holder: to, things, inFlight });
    refuseOverRoom({ n, room, name: law.resident ? to : `the ${law.className ?? "holder"} ${to}`, capacity: law.capacity, holding: totalOf(fold, to) + things + inFlight });
    const plan = planMake({ actor, kind, n, to, via });
    const w = await writeKinds(deps, key, actor, plan, {
      guard: law.resident ? null : chestRoomGuard({ chest: to, capacity: law.capacity, adding: n }),
      words: sentence[via === "refill" ? "refill" : "make"]({ actor, n, kind, to }),
    });
    const after = foldUnits([...units, { class: "holding", action: plan.action, payload: { moves: plan.moves } }]);
    return { did: via === "refill" ? "refill" : "make", kind, count: n, to, ...w, live: true,
      live_note: law.resident ? "made into your hands, live: a resident is a holder" : "made into a published holder, live: a holder confers its state on what it holds",
      holds: await shownIn(after, to, attachments, view, deps) };
  });
}

/** THE KIND DOOR. `actor` is already the key's own resident; the freeze was asked. */
export async function callKinds(route, args, key, actor, deps) {
  const view = deps.classes();
  if (!view.readable) throw bounce(503, "the class layer could not be read, so the office cannot tell one kind from another",
    "kinds, holders and their capacities are read from the class tree; nothing was changed — try again when the law is loaded");
  switch (route) {
    case "make":
      if (args.to == null) throw bounce(422, "make into what?", "to: yourself, or a holder's id <by>/<slug>");
      return makeInto({ args, key, actor, deps, view });
    case "refill": {
      // NO GENERAL REFILL VERB (18:44 item 3): refill is a class's own afforded
      // action, and only the Halloween Candy Bowl declares one. It means exactly
      // leave-mark { kind, count, to: <the bowl> }, by its maker.
      const id = String(args.thing ?? args.to ?? "");
      if (!isHolderId(id)) throw bounce(422, "refill what?", "thing: the holder's id, <by>/<slug>");
      const mark = await deps.markById(id);
      if (!mark) throw bounce(404, `${id} does not stand on the world`, "Nothing was changed.");
      const className = markClassOf(mark);
      const action = affordedActions(className, view).find((a) => a.action === "refill");
      if (!action) throw bounce(422, `refill is not an action of ${className ? `a ${className}` : id}`,
        `refill is the Halloween Candy Bowl's own action; to make into any holder, leave-mark { kind, count, to: "${id}" }. Nothing was changed.`);
      if (action.who === "maker" && ownerOf(mark, id) !== String(actor))
        throw bounce(403, `${actor} did not make ${id}`, `only its maker, ${ownerOf(mark, id)}, refills it; you can give into it instead. Nothing was changed.`);
      return makeInto({ args: { ...args, to: id }, key, actor, deps, view, via: "refill" });
    }
    case "take": {
      const n = unitCount(args.count);
      const kind = args.kind == null || args.kind === "" ? null : String(args.kind);
      const cap = carryOf(view);
      let from = args.from == null ? null : String(args.from);
      if (from != null && !isHolderId(from))
        throw bounce(422, `${from}'s hands are their own`, "a take is from a holder, <by>/<slug>; a resident hands things over with a give. Nothing was changed.");
      if (from != null) {
        const { mark, law } = await holderOrThrow(deps, from, view);
        refuseIfClosed({ mark, id: from, law, actor, deps, verb: "take from" });
        await deps.reachTake(from, actor);
      }
      return holdTurn(async () => {
        const inFlight = await inFlightFor(actor, deps); // BEFORE the rows
        const { units, attachments } = await deps.readRows();
        const fold = foldUnits(units);
        if (from == null) {
          from = oneHolderOf(await holdersInReach(fold, actor, kind, deps), { kind, verb: "take" });
          const { mark, law } = await holderOrThrow(deps, from, view);
          refuseIfClosed({ mark, id: from, law, actor, deps, verb: "take from" });
        }
        const stamp = await deps.stamp(actor);
        const seed = drawSeed({ actor, from, at: stamp.at });
        const plan = { ...planTakeKinds({ fold, actor, from, kind, n, seed }), seed };
        refuseOverCarry({ who: actor, units: totalOf(fold, actor) + inFlight, things: holdingsOf(attachments, actor).length, adding: n, cap });
        const w = await writeKinds(deps, key, actor, plan, { stamp, words: sentence.take({ actor, n, from }) });
        const after = foldUnits([...units, { class: "holding", action: plan.action, payload: { moves: plan.moves } }]);
        return { did: "take", count: n, from, draw: plan.draw, ...w,
          took: blurOf({ edges: plan.moves.map((m) => ({ kind: m.kind, count: m.n })), extendsOf: view.extendsOf }),
          holds: await shownIn(after, actor, attachments, view, deps), holder: await shownIn(after, from, attachments, view, deps) };
      });
    }
    case "give": {
      const n = unitCount(args.count);
      const to = String(args.to);
      const cap = carryOf(view);
      let mark = null, law;
      if (isHolderId(to)) {
        ({ mark, law } = await holderOrThrow(deps, to, view));
        refuseIfClosed({ mark, id: to, law, actor, deps, verb: "give into" });
        await deps.reachTake(to, actor);
      } else {
        law = holderLawOf({ holder: to, view });
        await deps.reachGive(to, actor);
      }
      return holdTurn(async () => {
        const inFlight = law.resident ? await inFlightFor(to, deps) : 0; // BEFORE the rows
        const { units, attachments } = await deps.readRows();
        const fold = foldUnits(units);
        const plan = planGiveKinds({ fold, actor, to, kind: args.kind ?? null, n });
        if (law.resident) refuseOverCarry({ who: to, units: totalOf(fold, to) + inFlight, things: holdingsOf(attachments, to).length, adding: n, cap });
        else {
          const things = holdingsOf(attachments, to).length;
          refuseOverRoom({ n, room: roomIn({ capacity: law.capacity, fold, holder: to, things }), name: `the ${law.className ?? "holder"} ${to}`,
            capacity: law.capacity, holding: totalOf(fold, to) + things, verb: "changed" });
        }
        const kind = plan.moves[0].kind;
        const w = await writeKinds(deps, key, actor, plan, {
          guard: law.resident ? null : chestRoomGuard({ chest: to, capacity: law.capacity, adding: n }),
          words: sentence.give({ actor, n, kind, to }),
        });
        const after = foldUnits([...units, { class: "holding", action: plan.action, payload: { moves: plan.moves } }]);
        return { did: "give", kind, count: n, to, ...w, holds: await shownIn(after, actor, attachments, view, deps),
          receiver: await shownIn(after, to, attachments, view, deps),
          ...(law.resident ? { stands: "neutral: a give between residents needs no consent to land, so it is theirs now" } : {}) };
      });
    }
    case "drop":
      throw bounce(501, "setting a kind down is not built yet",
        "give it into a holder, or to a resident; a set-down by kind lands with its own change (one mark, one stamp). Nothing was changed.");
    default:
      throw bounce(422, "not a kind act", "leave-mark { kind, count, to }, take, give, or a class's own action");
  }
}

/**
 * THE (VERB, OBJECT) MATRIX AT A STANDPOINT, read live (usable-verbs.mjs §
 * usablePairs): the bare read's `can` and investigate's `can` both project
 * this one answer, so they cannot diverge. `markIds` are the marks in view;
 * every thing in the actor's hands joins them (a carried bowl is at you).
 */
export async function usableAt({ actor, here, markIds = [], residents = [] }) {
  const [guards, { lawSnapshot }, world, { usablePairs }, { classViewOf }, { isUnitRow }] = await Promise.all([
    import("./world2-guards.mjs"), import("./law-snapshot.mjs"), import("./world.mjs"), import("./usable-verbs.mjs"),
    import("./world-units.mjs"), import("./world-stacks.mjs"),
  ]);
  const [units, attachments] = await Promise.all([guards.storeHoldingRows(), guards.storeAttachmentRows()]);
  const ids = [...new Set([...markIds.map(String), ...holdingsOf(attachments, String(actor))])];
  const marks = (await Promise.all(ids.map((id) => world.worldMarkById(id).then((r) => r.mark, () => null)))).filter(Boolean);
  let householdOf = null;
  try { householdOf = await (await import("./households.mjs")).householdLookup(); } catch { householdOf = null; }
  const pointWithinMark = await world.pointWithinMarkFn().catch(() => null);
  return usablePairs({ actor, here, marks, residents, fold: foldUnits(units.filter(isUnitRow)), attachments,
    view: classViewOf(lawSnapshot()), householdOf, pointWithinMark });
}

/**
 * `investigate: "<by>/<slug>"` on a mark: its column of the matrix (`can`, the
 * verbs you can do to it now) and, for a holder, what it holds, sharpened to
 * its kinds — a class and a number each, never a unit (15:46; 18:44 item 4).
 */
export async function investigateMark(id, usable = null) {
  const [world, guards, { lawSnapshot }, { canOn }, { classViewOf }, { isUnitRow }] = await Promise.all([
    import("./world.mjs"), import("./world2-guards.mjs"), import("./law-snapshot.mjs"), import("./usable-verbs.mjs"),
    import("./world-units.mjs"), import("./world-stacks.mjs"),
  ]);
  const mark = (await world.worldMarkById(String(id))).mark;
  const can = usable ? { can: canOn(usable, id) } : {};
  if (!mark) return { mark: String(id), stands: false, note: "no mark by that id stands on the world (a private draft is its household's alone)", ...can };
  const view = classViewOf(lawSnapshot());
  const law = holderLawOf({ holder: String(id), mark, view });
  const out = { mark: String(id), class: markClassOf(mark), by: ownerOf(mark, id), ...can };
  if (!law.holder) return out;
  const [units, attachments] = await Promise.all([guards.storeHoldingRows(), guards.storeAttachmentRows()]);
  const fold = foldUnits(units.filter(isUnitRow));
  return { ...out, holder: { capacity: law.capacity, open: law.open }, holds: await shownIn(fold, id, attachments, view,
    { markById: async (m) => (await world.worldMarkById(m)).mark }, { sharp: true }) };
}
