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
import { holdingsOf, sameHousehold, holdTurn, liveHolder } from "./world-hold.mjs";
import { liveHolders, weightOf, refuseNesting } from "./holder-tree.mjs"; // the walks, cycle-safe; counts confer up
import { chestRoomGuard } from "./chest-lock.mjs";
import { inFlightFor, writeThingHolding, thingHoldingEntry, wholeLoadIn, heldLoadOf, refuseOverRoomAbove, refuseIfStolenNow, refuseIfAnyStolenNow, carriedClasses } from "./world-units.mjs";
import { markClassOf, lineageOf } from "./world-grants.mjs";
import { standsWithin, EARSHOT_M } from "./reach.mjs";
import {
  makeableKind, holderLawOf, roomIn, refuseOverRoom, blurOf, planMake, planTakeKinds, planGiveKinds,
  oneHolderOf, drawSeed, affordedActions, selectKind, refuseSecondHolder,
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
  if (args.act != null) {
    if (String(args.act) === "refill") return "refill";
    // consume { kind } (12:36): one held mark of a consumable kind; a set-down's mark (thing:) is #499's consume-in-place
    if (String(args.act) === "consume" && args.thing == null) return "consume";
    return null;
  }
  if (args.thing != null && args.from != null) return "thing-from-holder";   // a whole mark out of a holder
  if (args.thing != null && isHolderId(args.to)) return "thing-into-holder";  // a whole mark into one
  if (args.thing != null) return null;                                 // the thing door's
  if (args.from != null) return "take";
  // a give that names no thing is a give of what you hold by kind (G7: one kind, or the kinds listed)
  if (args.kind == null && args.count == null) return args.to != null ? "give" : null;
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
async function writeKinds(deps, key, actor, plan, { stamp = null, guard = null, words, also = [], instant = false }) {
  const { at, witnesses } = stamp ?? await deps.stamp(actor);
  const entry = {
    crossing: deps.crossing(), actor, action: plan.action, object: String(plan.object), at, witnesses,
    cls: "holding", household: deps.household(key),
    payload: { units: true, kinds: true, moves: plan.moves, edge: plan.edge, ...(plan.via ? { via: plan.via } : {}), ...(plan.draw ? { draw: plan.draw, seed: plan.seed, things: plan.things ?? [] } : {}) },
    effect: words,
  };
  const row = await deps.append(entry, { ...(guard ? { guard } : {}), ...(also.length ? { also } : {}) });
  // `instant` (POS-672): an offer's row is a creature's trigger, and the d20 reads its own instant
  return { seq: row?.actId ?? row?.seq ?? null, effect: entry.effect, ...(instant && row?.written_at ? { written_at: row.written_at } : {}) };
}

/**
 * What a holder shows, after an act and at the close look: its kinds and its
 * whole things, at the nearest common class.
 *
 * COUNTS CONFER UP ON THE READ TOO (hotfix w43.1; Darko, 2026-10-17 23:29: "one
 * holder and counts confer up"). A holder that is a mark counts each whole
 * thing in it as 1 plus everything that thing holds, so `count` here is
 * heldLoadOf, the very number the door's room is judged by (capacity less it).
 * A bowl with 8 candies and a bag of 8 reads 17, not 9. When something inside
 * holds things, `shows` names it ("8 candies and A Candy Bag holding 8"),
 * `whole` lists each whole thing with what it holds and what it counts, and
 * `counting` says the sum in plain words. A resident's hands are unchanged:
 * each top-level thing counts 1 (the ruled blur).
 */
async function shownIn(fold, holder, attachments, view, deps, { sharp = false } = {}) {
  const ids = holdingsOf(attachments, String(holder));
  const things = [];
  for (const id of ids) things.push(markClassOf(await deps.markById(id).catch(() => null)) ?? "thing");
  const edges = kindEdgesOf(fold, holder);
  const blur = blurOf({ edges, things, extendsOf: view.extendsOf, sharp });
  if (!isHolderId(String(holder))) return { holder: String(holder), ...blur };
  const count = heldLoadOf(attachments, fold, holder);
  // THE FIELD CONTRACT (the World page, w2-final 15e19217 holderLines): one `whole` row per whole thing
  // inside, { thing, name, holds }, its own conferred count; the page prints "<name> holding <holds>"
  const nameOf = async (id) => { try { return (await deps.nameOf?.(id)) ?? String(id); } catch { return String(id); } };
  const whole = [];
  for (const id of ids) {
    const holds = heldLoadOf(attachments, fold, id);
    whole.push({ thing: id, name: await nameOf(id), holds, counts: 1 + holds });
  }
  if (count === blur.count) return { holder: String(holder), ...blur, ...(whole.length ? { whole } : {}) };
  // something inside holds things (or units the kinds do not name): the count confers up
  const kindWords = edges.length ? blurOf({ edges, things: [], extendsOf: view.extendsOf }).shows : null;
  const wholeWords = whole.map((w) => (w.holds ? `${w.name} holding ${w.holds}` : w.name));
  const parts = [...(kindWords ? [kindWords] : []), ...wholeWords];
  const shows = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] ?? `${count} things`;
  const sum = [...(kindWords ? [kindWords] : []), ...whole.map((w) => (w.holds ? `${w.name} as 1 and the ${w.holds} it holds` : `${w.name} as 1`))];
  return { holder: String(holder), ...blur, count, shows, whole,
    counting: `${sum.join(", ")}: ${count} counted, as the room counts it (a holder counts 1 and everything it holds)` };
}

/** A published holder, or the refusal: a draft holds nothing yet; a mark that does not hold, says so. */
async function holderOrThrow(deps, id, view) {
  const mark = await deps.markById(id);
  if (!mark) throw bounce(404, `${id} does not stand on the world`, "a holder is a published mark; a draft holds nothing yet. Nothing was changed.");
  const law = holderLawOf({ holder: id, mark, view });
  if (!law.holder) throw bounce(422, `${id} holds nothing`, `it is ${law.className ? `a ${law.className}` : "a mark of no thing class"} whose holder is false; a holder is a thing its maker made with holder: true. Nothing was changed.`);
  if (law.capacity_refused) throw bounce(422, `${id}'s own capacity is refused`, `${law.capacity_refused}; until its maker sets one within them, nothing goes in or comes out by count. Nothing was changed.`);
  if (!Number.isInteger(law.capacity)) throw bounce(503, `${id}'s capacity could not be read`, "no class in its lineage states one; nothing was changed — the class tree says what a holder holds");
  return { mark, law };
}

/** Another household at a holder that is not open: refused at the door (16:02 item 7). */
function refuseIfClosed({ mark, id, law, actor, deps, verb }) {
  if (law.open !== false) return;
  const same = sameHousehold(ownerOf(mark, id), actor, deps.householdOf);
  if (!same.same) throw bounce(403, `${id} is not open to other households`, `its open is false: only its maker's household may ${verb} it. Nothing was changed.`);
}

/** A holder that names what it takes in (`accepts`, WLD-5 B): anything else is refused at the
 *  door, and a count of a kind is never one of the marks it names. */
function refuseIfNotAccepted({ id, law, thing = null }) {
  if (!Array.isArray(law?.accepts)) return;
  if (thing != null && law.accepts.includes(String(thing))) return;
  throw bounce(403, thing != null ? `${id} does not take ${thing}` : `${id} takes in only the marks it names`,
    `its maker made it take in only these, by id: ${law.accepts.join(", ")}${thing != null ? "" : "; a count of a kind is none of them"}. Nothing was changed.`,
    { accepts: [...law.accepts] });
}

/** A holder that keeps what goes in (`keeps`, WLD-5 B): nothing comes back out, by anyone. */
function refuseIfKept({ id, law }) {
  if (law?.keeps !== true) return;
  throw bounce(403, `${id} keeps what it holds`,
    "its maker made it keep what goes in: nothing is taken back out of it, by anyone, its maker included. Nothing was changed.");
}

const carryOf = (view) => holderLawOf({ holder: "resident", view }).capacity;

/**
 * THE REACH OF A HOLDER, where it is NOW (review-610 B1): "refill: at, or
 * carrying" (10:30); the Bag's "fill it at chests, share from it" (12:34). A
 * holder in your own hands is in reach wherever you stand. One in another
 * resident's hands is at them: you give into it at arm's length, and you do not
 * take out of it — they give from it. One inside another holder is reached by
 * taking it out first. One set down is judged where it was set down (the hold
 * lane's drop act), never where it was made; one never moved is judged by the
 * thing door's own reach at its canon place. `deps.holderPlace` answers
 * `{ holder, at, moved }`; absent (a test's hand-built record), the canon reach stands.
 */
async function reachHolder(id, mark, actor, deps, { verb = "take" } = {}) {
  const place = deps.holderPlace ? await deps.holderPlace(String(id), mark) : { holder: null, at: mark?.at ?? null, moved: false };
  const me = String(actor);
  if (place.holder === me) return { stands: true, how: "in hand" };
  if (place.holder != null && isHolderId(place.holder))
    throw bounce(409, `${id} is inside ${place.holder}`, `take ${id} out of ${place.holder} first. Nothing was changed.`);
  if (place.holder != null) {
    // SETTLED (the lead, 2026-10-17): making into another resident's carried holder is refused, as making
    // into another resident is — make into yourself, then give. A give into it at arm's length stands.
    if (verb === "make") throw bounce(422, `${id} is in ${place.holder}'s hands: make into yourself, then give`,
      `leave-mark { kind, count, to } makes into you or a holder at hand; one another resident carries is given into, at arm's length. Nothing was made.`);
    // FOR DARKO'S CALL (new law, the conservative reading): never take out of a holder in another's hands, even an open one
    if (verb !== "give") throw bounce(409, `${id} is in ${place.holder}'s hands`, `a holder someone carries is theirs to give from; ask them, or give into it at arm's length. Nothing was changed.`);
    return deps.reachGive(place.holder, actor);
  }
  if (!place.moved || !place.at) return deps.reachTake(String(id), actor);
  const here = await deps.standpoint(actor);
  if (!here) throw bounce(409, "the record does not place you anywhere", `a holder is reached where it stands, and the walk ledger has no position for ${me}: walk somewhere first. Nothing was changed.`);
  const r = standsWithin(here, { ...mark, at: place.at });
  if (!r.stands) throw bounce(409, `you are not standing where ${id} stands: it was set down ${r.distance_round} m${r.bearing ? ` ${r.bearing}` : ""} of you`,
    `a holder is reached within its reach (the-town/the-reach), where it was set down, not where it was made. Walk there first. Nothing was changed.`);
  return r;
}

/**
 * Every holder in reach that holds the kind (or anything, with no kind): the
 * candidates for a take that names no `from` — each with its owner and its
 * distance from where the actor stands.
 */
async function holdersInReach(fold, attachments, actor, kind, deps, extendsOf = () => null, { view = null } = {}) {
  const here = await deps.standpoint(actor);
  const out = [];
  // the whole marks each holder holds, in ONE pass over the hold rows (the last row per thing decides)
  const last = new Map();
  for (const r of attachments) last.set(String(r.target), r);
  const inside = new Map();
  for (const [t, r] of last) if (r.policy === "cascade" && isHolderId(String(r.entity))) {
    if (!inside.has(String(r.entity))) inside.set(String(r.entity), []);
    inside.get(String(r.entity)).push(t);
  }
  const holders = new Set([...(fold.kinds ?? new Map()).keys(), ...inside.keys()].filter(isHolderId));
  const is = (c) => kind == null || (c != null && lineageOf(c, extendsOf).includes(String(kind)));
  for (const holder of holders) {
    // the kind, among its counted kinds or its whole marks (as potLuck draws)
    let holds = [...(fold.kinds?.get(holder)?.keys() ?? [])].some(is);
    if (!holds) for (const t of inside.get(holder) ?? []) if (is(markClassOf(await deps.markById(t).catch(() => null)) ?? "thing")) { holds = true; break; }
    if (!holds) continue;
    const mark = await deps.markById(holder).catch(() => null);
    if (!mark) continue;
    // A HOLDER THAT KEEPS WHAT IT HOLDS is never a source (WLD-5 B): nothing comes back out of it
    if (view && holderLawOf({ holder, mark, view }).keeps === true) continue;
    // CHEAP FIRST: a holder far past the reach is never asked (its own hands, or a set-down, are asked anyway)
    const d = here && mark.at ? Math.round(Math.hypot(Number(mark.at.x) - here.x, Number(mark.at.y) - here.y)) : null;
    const span = Math.max(Number(mark.extent?.w ?? 0), Number(mark.extent?.h ?? 0));
    const near = d == null || d <= EARSHOT_M + span;
    const place = deps.holderPlace ? await deps.holderPlace(holder, mark) : null;
    if (!near && !(place?.holder === String(actor)) && !place?.moved) continue;
    try { await reachHolder(holder, mark, actor, deps, { verb: "take" }); } catch { continue; }
    out.push({ id: holder, owner: ownerOf(mark, holder), distance_m: place?.holder === String(actor) ? 0 : d ?? 0 });
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
    refuseIfNotAccepted({ id: to, law });
    await reachHolder(to, mark, actor, deps, { verb: "make" });
  }
  return holdTurn(async () => {
    const inFlight = law.resident ? await inFlightFor(to, deps) : 0; // BEFORE the rows (world-units § inFlightFor)
    const { units, attachments } = await deps.readRows();
    const fold = foldUnits(units);
    // a resident's hands count each thing 1; a holder counts each holder in it 1 and all it holds (counts confer up)
    const things = law.resident ? holdingsOf(attachments, to).length : wholeLoadIn(attachments, fold, to);
    const room = roomIn({ capacity: law.capacity, fold, holder: to, things, inFlight });
    refuseOverRoom({ n, room, name: law.resident ? to : `the ${law.className ?? "holder"} ${to}`, capacity: law.capacity, holding: totalOf(fold, to) + things + inFlight });
    const above = law.resident ? [] : await refuseOverRoomAbove({ deps, view, fold, attachments, holder: to, n, nothing: "Nothing was made." });
    // MAKING A KIND OF A CLASS TAKEN BY THE TOWN'S OWN ACT REFUSES TOO (WLD-7; Darko 2026-10-17, ruling (2)): the refill with it
    refuseIfStolenNow(deps, () => kind);
    const plan = planMake({ actor, kind, n, to, via });
    const w = await writeKinds(deps, key, actor, plan, {
      guard: law.resident ? null : chestRoomGuard({ chest: to, capacity: law.capacity, adding: n, above }),
      words: sentence[via === "refill" ? "refill" : "make"]({ actor, n, kind, to }),
    });
    const after = foldUnits([...units, { class: "holding", action: plan.action, payload: { moves: plan.moves } }]);
    return { did: via === "refill" ? "refill" : "make", kind, count: n, to, ...w, live: true,
      live_note: law.resident ? "made into your hands, live: a resident is a holder" : "made into a published holder, live: a holder confers its state on what it holds",
      holds: await shownIn(after, to, attachments, view, deps) };
  });
}

/** A WHOLE MARK INTO A HOLDER: `give { thing, to: <holder> }`, from your hands, its room counting kinds and whole marks alike. */
async function thingIntoHolder({ args, key, actor, deps, view }) {
  const thing = String(args.thing), to = String(args.to);
  if (thing === to) throw bounce(422, "a holder cannot hold itself", "Nothing was changed.");
  const { mark: holderMark, law } = await holderOrThrow(deps, to, view);
  refuseIfClosed({ mark: holderMark, id: to, law, actor, deps, verb: "give into" });
  refuseIfNotAccepted({ id: to, law, thing });
  const mark = await deps.markById(thing);
  if (!mark) throw bounce(409, `${thing} does not stand on the world`, "only a published thing goes into a holder; a draft changes no hands. Nothing was changed.");
  await reachHolder(to, holderMark, actor, deps, { verb: "give" });
  return holdTurn(async () => {
    const { units, attachments } = await deps.readRows();
    const holder = liveHolder(attachments, thing);
    if (holder !== String(actor)) throw bounce(409, `you are not holding ${thing}: ${holder ?? "nobody"} is`, "a thing goes into a holder from your hands. Nothing was changed.");
    refuseIfAnyStolenNow(deps, await carriedClasses({ thing, mark, fold: foldUnits(units), attachments, markById: deps.markById }));
    refuseNesting({ rows: attachments, thing, into: to }); // however deep, and a loop already in the rows is refused, never followed
    const fold = foldUnits(units);
    // COUNTS CONFER UP (Darko 2026-10-17 23:29): the thing takes 1 and everything it holds, here and in every holder above
    const n = weightOf({ up: liveHolders(attachments), thing, unitsOf: (h) => totalOf(fold, h) });
    const things = wholeLoadIn(attachments, fold, to);
    refuseOverRoom({ n, room: roomIn({ capacity: law.capacity, fold, holder: to, things }), name: `the ${law.className ?? "holder"} ${to}`,
      capacity: law.capacity, holding: totalOf(fold, to) + things, verb: "changed" });
    const above = await refuseOverRoomAbove({ deps, view, fold, attachments, holder: to, n });
    const w = await writeThingHolding(deps, key, actor, attachments, { did: "give", thing, holder: to, previous: String(actor), madeBy: ownerOf(mark, thing) },
      { guard: chestRoomGuard({ chest: to, capacity: law.capacity, adding: n, above }) });
    const after = [...attachments, { entity: to, target: thing, policy: "cascade", born_at: w.at }];
    return { did: "give", thing, to, ...w, edge: { giver: String(actor), receiver: to }, receiver: await shownIn(fold, to, after, view, deps) };
  });
}

/**
 * Does this take out of `from` pass ownership (POS-688)? The holder open, and the
 * thing put in it by its owner's house: the kept record's fold says who put it in.
 * False when the record or the household map cannot say: a take is a borrow
 * unless the record proves the bowl.
 */
async function takeOwnsNow(thing, from, actor, law) {
  try {
    const [{ ownershipOf, takeOwns }, { householdLookup }] = await Promise.all([import("./ownership.mjs"), import("./households.mjs")]);
    const rec = await holdRecordNow();
    const st = rec?.owners?.get(String(thing));
    if (!st) return false;
    const look = await householdLookup().catch(() => null);
    return takeOwns({ ...ownershipOf(rec.owners, thing), putIn: st.putIn }, { from, actor, open: law?.open, houseOf: (h) => look?.(h)?.key ?? `solo:${h}` });
  } catch { return false; }
}

/** A WHOLE MARK OUT OF A HOLDER: `take { thing, from: <holder> }`, or naming a thing a holder holds: reach, open, the carry. */
export async function thingFromHolder({ args, key, actor, deps, view }) {
  const thing = String(args.thing), from = String(args.from);
  const { mark: holderMark, law } = await holderOrThrow(deps, from, view);
  refuseIfClosed({ mark: holderMark, id: from, law, actor, deps, verb: "take from" });
  refuseIfKept({ id: from, law });
  const mark = await deps.markById(thing);
  await reachHolder(from, holderMark, actor, deps, { verb: "take" });
  return holdTurn(async () => {
    const inFlight = await inFlightFor(actor, deps); // BEFORE the rows
    const { units, attachments } = await deps.readRows();
    const holder = liveHolder(attachments, thing);
    if (holder !== from) throw bounce(409, `${from} is not holding ${thing}`, holder ? `${holder} is. Nothing was changed.` : "it stands on the ground. Nothing was changed.");
    refuseIfAnyStolenNow(deps, await carriedClasses({ thing, mark, fold: foldUnits(units), attachments, markById: deps.markById }));
    refuseOverCarry({ who: actor, units: totalOf(foldUnits(units), actor) + inFlight, things: holdingsOf(attachments, actor).length, adding: 1, cap: carryOf(view) });
    await refuseSecondHolder({ who: actor, actor, adding: [thing], held: holdingsOf(attachments, actor), markById: deps.markById, view });
    const owns = await takeOwnsNow(thing, from, actor, law);
    const w = await writeThingHolding(deps, key, actor, attachments, { did: "take", thing, holder: String(actor), previous: from, madeBy: ownerOf(mark, thing), owns });
    return { did: "take", thing, from, holder: String(actor), ...w, edge: { giver: from, receiver: String(actor) } };
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
        refuseIfKept({ id: from, law });
        await reachHolder(from, mark, actor, deps, { verb: "take" });
      }
      return holdTurn(async () => {
        const inFlight = await inFlightFor(actor, deps); // BEFORE the rows
        const { units, attachments } = await deps.readRows();
        const fold = foldUnits(units);
        if (from == null) {
          from = oneHolderOf(await holdersInReach(fold, attachments, actor, kind, deps, view.extendsOf, { view }), { kind, verb: "take" });
          const { mark, law } = await holderOrThrow(deps, from, view);
          refuseIfClosed({ mark, id: from, law, actor, deps, verb: "take from" });
          refuseIfKept({ id: from, law });
        }
        const stamp = await deps.stamp(actor);
        const seed = drawSeed({ actor, from, crossing: deps.crossing(), at: stamp.at, ordinal: units.length });
        const inside = [];
        for (const t of holdingsOf(attachments, from)) inside.push({ thing: t, class: markClassOf(await deps.markById(t).catch(() => null)) ?? "thing" });
        const plan = { ...planTakeKinds({ fold, actor, from, kind, n, seed, things: inside, extendsOf: view.extendsOf }), seed };
        // what the draw moves, each kind and each whole thing with all it carries, of the law of this moment (WLD-7)
        const drawn = [];
        for (const t of plan.things ?? []) drawn.push(await carriedClasses({ thing: t, mark: await deps.markById(t).catch(() => null), fold, attachments, markById: deps.markById }));
        refuseIfAnyStolenNow(deps, (now) => [...plan.moves.filter((m) => m.n > 0).map((m) => m.kind), ...drawn.flatMap((f) => f(now))]);
        try {
          refuseOverCarry({ who: actor, units: totalOf(fold, actor) + inFlight, things: holdingsOf(attachments, actor).length, adding: n, cap });
        } catch (e) {
          // WHAT THE DRAW FELL ON, when your hands have no slots for it (POS-679 B; Darko 2026-10-18 12:04 and 12:17):
          // a holder the draw lands on comes over whole, with what it holds, and takes 1 slot. Words only.
          if (e?.code !== 409 || e.carried == null || !plan.things?.length) throw e;
          const named = [];
          for (const t of plan.things) { try { named.push((await deps.nameOf?.(t)) ?? t); } catch { named.push(t); } }
          const counted = plan.moves.filter((m) => m.n > 0).map((m) => blurOf({ edges: [{ kind: m.kind, count: m.n }], things: [], extendsOf: view.extendsOf }).shows);
          const hands = e.carried >= e.cap ? `your hands are full, ${e.carried} of ${e.cap}` : `your hands have ${e.cap - e.carried} of ${e.cap} slots free, not ${n}`;
          throw bounce(409, `the draw fell on ${[...named, ...counted].join(" and ")}; ${hands}`,
            `pot luck draws over everything ${from} holds, and a holder it lands on comes into your hands whole, with what it holds, taking 1 slot. Set something down first. Nothing was changed.`,
            { carried: e.carried, cap: e.cap, drew: plan.things });
        }
        try {
          await refuseSecondHolder({ who: actor, actor, adding: plan.things, held: holdingsOf(attachments, actor), markById: deps.markById, view });
        } catch (e) {
          // WHY THE DRAW WAS DECLINED, in words (hotfix w43.1; Darko 2026-10-18 12:04: "make it clear WHY the
          // potluck draw resulted in a decline"). Words only: the draw, its seed and the one-holder rule are unchanged.
          if (e?.code !== 409 || !Array.isArray(e.coming)) throw e;
          const there = [...kindEdgesOf(fold, from).map((k) => blurOf({ edges: [k], things: [], extendsOf: view.extendsOf }).shows), ...inside.map((x) => `${x.thing} (a ${x.class})`)].join(", ");
          const drew = `${e.coming.join(", ")}, ${e.coming.length === 1 ? "a holder" : "holders"}`;
          const carrying = e.holders.some((h) => !e.coming.includes(h));
          throw bounce(409, `the draw fell on ${drew}, and ${e.defect}`,
            `${kind == null ? "pot luck draws" : `a draw within ${kind} draws`} over everything ${from} holds, whole things included, and a draw that lands on a holder you cannot carry is refused whole. kind: narrows the draw to what you name; ${from} holds ${there}. ${carrying ? `Or ${e.hint}` : e.hint.charAt(0).toUpperCase() + e.hint.slice(1)}`,
            { holders: e.holders, drew: e.coming, limit: e.limit });
        }
        // ONE EDGE, ONE TRANSACTION (review-610 S4): the draw's record (its seed, its kinds, the whole
        // marks it took) and each whole mark's own holding act commit together, or nothing moves
        const also = [];
        let rows = attachments;
        for (const t of plan.things) {
          const m = await deps.markById(t).catch(() => null);
          const owns = await takeOwnsNow(t, from, actor, (await holderOrThrow(deps, from, view).catch(() => null))?.law ?? null);
          const { entry, at } = await thingHoldingEntry(deps, key, actor, rows, { did: "take", thing: t, holder: String(actor), previous: from, madeBy: ownerOf(m, t), owns }, stamp);
          also.push(entry);
          rows = [...rows, { entity: String(actor), target: t, policy: "cascade", born_at: at }];
        }
        const w = await writeKinds(deps, key, actor, plan, { stamp, words: sentence.take({ actor, n, from }), also });
        const moved = plan.things.map((t) => ({ thing: t, with: w.seq }));
        const after = foldUnits([...units, { class: "holding", action: plan.action, payload: { moves: plan.moves } }]);
        return { did: "take", count: n, from, draw: plan.draw, ...w, ...(moved.length ? { whole: moved } : {}),
          took: blurOf({ edges: plan.moves.map((m) => ({ kind: m.kind, count: m.n })), things: inside.filter((x) => plan.things.includes(x.thing)).map((x) => x.class), extendsOf: view.extendsOf }),
          holds: await shownIn(after, actor, rows, view, deps), holder: await shownIn(after, from, rows, view, deps) };
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
        refuseIfNotAccepted({ id: to, law });
        await reachHolder(to, mark, actor, deps, { verb: "give" });
      } else {
        law = holderLawOf({ holder: to, view });
        await deps.reachGive(to, actor);
      }
      return holdTurn(async () => {
        const inFlight = law.resident ? await inFlightFor(to, deps) : 0; // BEFORE the rows
        const { units, attachments } = await deps.readRows();
        const fold = foldUnits(units);
        const plan = planGiveKinds({ fold, actor, to, kind: args.kind ?? null, n });
        refuseIfStolenNow(deps, () => plan.moves[0].kind);
        if (law.resident) refuseOverCarry({ who: to, units: totalOf(fold, to) + inFlight, things: holdingsOf(attachments, to).length, adding: n, cap });
        let above = [];
        if (!law.resident) {
          const things = wholeLoadIn(attachments, fold, to); // each holder in it 1 and all it holds (counts confer up)
          refuseOverRoom({ n, room: roomIn({ capacity: law.capacity, fold, holder: to, things }), name: `the ${law.className ?? "holder"} ${to}`,
            capacity: law.capacity, holding: totalOf(fold, to) + things, verb: "changed" });
          above = await refuseOverRoomAbove({ deps, view, fold, attachments, holder: to, n });
        }
        const kind = plan.moves[0].kind;
        const w = await writeKinds(deps, key, actor, plan, {
          guard: law.resident ? null : chestRoomGuard({ chest: to, capacity: law.capacity, adding: n, above }),
          words: sentence.give({ actor, n, kind, to }),
        });
        const after = foldUnits([...units, { class: "holding", action: plan.action, payload: { moves: plan.moves } }]);
        return { did: "give", kind, count: n, to, ...w, holds: await shownIn(after, actor, attachments, view, deps),
          receiver: await shownIn(after, to, attachments, view, deps),
          ...(law.resident ? { stands: "neutral: a give between residents needs no consent to land, so it is theirs now" } : {}) };
      });
    }
    case "consume": {
      // CONSUME { kind } (ruled 12:36): one mark of a consumable kind, from your
      // own hands, used up. A count names no unit, so the one consumed is one of
      // the kind; with one kind in hand it may be omitted, with several it is named.
      const n = unitCount(args.count);
      if (n !== 1) throw bounce(422, "consume one at a time", "consume uses up one mark of a kind; call again for another. Nothing was changed.");
      return holdTurn(async () => {
        const { units, attachments } = await deps.readRows();
        const fold = foldUnits(units);
        const edible = kindEdgesOf(fold, actor).filter((e) => lineageOf(e.kind, view.extendsOf).includes("consumable"));
        if (args.kind != null && !edible.some((e) => e.kind === String(args.kind))) {
          // WORDS ONLY (hotfix w43.1, XH2): a kind that is no consumable is told so, by its class line, and
          // the consumables you do hold are named; "no thing in your hands" with candies in them read as false
          const held = kindEdgesOf(fold, actor).some((e) => e.kind === String(args.kind));
          const consumable = lineageOf(String(args.kind), view.extendsOf).includes("consumable");
          const yours = edible.length ? `you hold ${edible.map((e) => blurOf({ edges: [e], things: [], extendsOf: view.extendsOf }).shows).join(", ")} to consume: consume { kind: "${edible[0].kind}" }` : "you hold nothing to consume";
          throw bounce(held || !consumable ? 422 : 409, held || !consumable ? `a ${args.kind} is not a consumable` : `no ${args.kind} in your hands`,
            held || !consumable ? `consume uses up what is made to be used up (a consumable, as candy is); ${yours}. Nothing was changed.` : `${yours}. Nothing was changed.`);
        }
        const edge = selectKind(edible, args.kind ?? null, { where: "your hands", verb: "consume" });
        refuseIfStolenNow(deps, () => edge.kind);
        const plan = { action: UNIT_ACTION.consume, object: String(actor), moves: [{ from: String(actor), to: null, kind: edge.kind, n: 1 }], edge: { giver: String(actor), receiver: null } };
        const w = await writeKinds(deps, key, actor, plan, { words: `${actor} consumed 1 ${edge.kind}` });
        const after = foldUnits([...units, { class: "holding", action: plan.action, payload: { moves: plan.moves } }]);
        return { did: "consume", kind: edge.kind, count: 1, ...w, holds: await shownIn(after, actor, attachments, view, deps) };
      });
    }
    case "offer": {
      // OFFER { kind, creature } (POS-672, call 2: "offer uses up what you are
      // carrying … it absolutely does"; D3: one of a consumable kind in your
      // hands). Consume's own rule for which kind, and the unit is used up the
      // same way, toward the creature: `units:offer`, object the creature, which
      // holds nothing. This row is the trigger the creature answers. The door
      // (creature-verbs.mjs) has already judged the creature, its reach and the
      // window; here only the hands are judged, so a refusal changes nothing.
      const creature = String(args.creature ?? "");
      if (!creature.startsWith("creature:")) throw bounce(422, "offer to which creature?", "creature: its id, creature:<kind>-<crossing>-<n>. Nothing was changed.");
      return holdTurn(async () => {
        const { units, attachments } = await deps.readRows();
        const fold = foldUnits(units);
        const edible = kindEdgesOf(fold, actor).filter((e) => lineageOf(e.kind, view.extendsOf).includes("consumable"));
        if (args.kind != null && !edible.some((e) => e.kind === String(args.kind))) {
          const consumable = lineageOf(String(args.kind), view.extendsOf).includes("consumable");
          const yours = edible.length ? `you hold ${edible.map((e) => e.kind).join(", ")} to offer` : "you hold nothing to offer";
          throw bounce(consumable ? 409 : 422, consumable ? `no ${args.kind} in your hands` : `a ${args.kind} is not a consumable`,
            `an offer is one of a consumable kind you carry (candy is); ${yours}. leave-mark { kind, count: 1, to: "${actor}" } makes one into your hands. Nothing was changed.`);
        }
        if (!edible.length) throw bounce(409, "you carry nothing to offer",
          `an offer is one of a consumable kind you carry; leave-mark { kind, count: 1, to: "${actor}" } makes one into your hands (explain: "candy" lists the kinds). Nothing was changed.`);
        const edge = selectKind(edible, args.kind ?? null, { where: "your hands", verb: "offer" });
        refuseIfStolenNow(deps, () => edge.kind);
        const plan = { action: UNIT_ACTION.offer, object: creature, moves: [{ from: String(actor), to: null, kind: edge.kind, n: 1 }], edge: { giver: String(actor), receiver: null } };
        // `guard`: the creature door's half of D6 in this write's own transaction (creature-verbs § aimGuard)
        const w = await writeKinds(deps, key, actor, plan, { words: `${actor} held out 1 ${edge.kind} to ${creature}, and it was used up`, instant: true,
          ...(typeof args.guard === "function" ? { guard: args.guard } : {}) });
        const after = foldUnits([...units, { class: "holding", action: plan.action, payload: { moves: plan.moves } }]);
        const rec = view.record(edge.kind);
        return { did: "offer", kind: edge.kind, count: 1, ...w, holds: await shownIn(after, actor, attachments, view, deps),
          offered: { kind: edge.kind, name: rec?.name ?? edge.kind.replace(/-/g, " "), ...(rec?.body ? { body: String(rec.body).split(/\n\s*\n/)[0].slice(0, 300) } : {}) } };
      });
    }
    case "thing-into-holder": return thingIntoHolder({ args, key, actor, deps, view });
    case "thing-from-holder": return thingFromHolder({ args, key, actor, deps, view });
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
  const [{ lawSnapshot }, world, { usablePairs }, { classViewOf }] = await Promise.all([
    import("./law-snapshot.mjs"), import("./world.mjs"), import("./usable-verbs.mjs"), import("./world-units.mjs"),
  ]);
  const { fold, attachments, places } = await holdRecordNow();
  const ids = [...new Set([...markIds.map(String), ...holdingsOf(attachments, String(actor))])];
  const marks = (await Promise.all(ids.map((id) => world.worldMarkById(id).then((r) => r.mark, () => null)))).filter(Boolean);
  let householdOf = null;
  try { householdOf = await (await import("./households.mjs")).householdLookup(); } catch { householdOf = null; }
  const pointWithinMark = await world.pointWithinMarkFn().catch(() => null);
  return usablePairs({ actor, here, marks, residents, fold, attachments, places,
    view: classViewOf(lawSnapshot()), householdOf, pointWithinMark });
}

// ── THE HOLD RECORD, KEPT AND MOVED BY ITS DELTA (review-610 S5, F1) ───────
//
// hold-record.mjs keeps the hold lane's fold as a base plus a re-read window
// above it: a bare read between two hold acts reuses it, a change applies only
// the acts above the cutoff (late commits inside the window included), and one
// rebuild serves every read that arrives while it runs. The keeper's own header
// says why there is no table.
let _keeper = null;
async function keeper() {
  if (_keeper) return _keeper;
  const [guards, { actsQuery }, journal, world, { holdRecordKeeper, HOLD_TOP_SQL }] = await Promise.all([
    import("./world2-guards.mjs"), import("./world2-acts.mjs"), import("./world-journal.mjs"), import("./world.mjs"), import("./hold-record.mjs"),
  ]);
  const { OWNER_WORDS_SQL, KEEPER_TOP_SQL } = await import("./hold-record.mjs");
  _keeper = holdRecordKeeper({
    readTop: async () => (await actsQuery(KEEPER_TOP_SQL, []).catch(() => null))?.[0]?.top ?? null,
    // the settlement window the office counts by: one full read per settlement (hold-record § ONE FULL READ PER SETTLEMENT)
    readEpoch: async () => { try { return (await import("./crossings.mjs")).currentCrossing(); } catch { return null; } },
    readHolding: ({ afterId = null } = {}) => guards.storeHoldingRows(afterId != null ? { afterId } : {}),
    readAttachments: ({ afterId = null } = {}) => guards.storeAttachmentRows(afterId != null ? { afterId } : {}),
    // the owner's words (POS-688), and the household map they are folded by
    readWords: async ({ afterId = null } = {}) => (await actsQuery(OWNER_WORDS_SQL, [afterId == null ? null : Number(afterId)]).catch(() => null)) ?? [],
    houses: async () => {
      const look = await (await import("./households.mjs")).householdLookup().catch(() => null);
      return (h) => look?.(h)?.key ?? `solo:${h}`;
    },
    // where each set-down thing stands now: its latest drop act's witnessed line, by the anchor it names
    placesOf: async (drops) => {
      const places = new Map();
      if (!drops.size) return places;
      // the one centre reader: canon's, or where a held anchor last stood (POS-688, W4)
      const centreOf = await world.markCentreOf().catch(() => () => null);
      for (const [id, r] of drops) {
        const at = journal.composeAnchor(r.at ?? {}, centreOf);
        if (at) places.set(id, at);
      }
      return places;
    },
  });
  return _keeper;
}
export async function holdRecordNow() { return (await keeper()).now(); }
/** The production keeper's own counters (rebuilds, full reads, the epoch it stands in), for the falsifier that pins its wiring. */
export async function holdRecordStats() { return (await keeper()).stats(); }

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
  if (!mark) return { mark: String(id), stands: false, note: "no mark by that id stands on the world (a draft is not the town's canon; it lives only in its own household's reading of the world)", ...can };
  const view = classViewOf(lawSnapshot());
  const law = holderLawOf({ holder: String(id), mark, view });
  const out = { mark: String(id), class: markClassOf(mark), by: ownerOf(mark, id), ...can };
  if (!law.holder) return out;
  const { fold, attachments } = await holdRecordNow();
  return { ...out, holder: { capacity: law.capacity, open: law.open }, holds: await shownIn(fold, id, attachments, view,
    { markById: async (m) => (await world.worldMarkById(m)).mark, nameOf: async (m) => (await world.markRows([String(m)]))[0]?.name ?? null }, { sharp: true }) };
}

/**
 * A RESIDENT'S HANDS, BOTH NUMBERS (POS-679 D; Darko 2026-10-18 12:17): the slots
 * used of the capacity (each top-level thing 1, each counted unit 1: the number
 * the carry cap is judged by, world-stacks § refuseOverCarry), and the things in
 * all, counting each carried holder and everything inside it (heldLoadOf, the
 * holders' own count). "7 of 24 slots · 21 things in all".
 */
export function handsCount({ fold, attachments, handle, cap }) {
  const h = String(handle);
  const used = totalOf(fold, h) + holdingsOf(attachments, h).length;
  const inAll = heldLoadOf(attachments, fold, h);
  const of = Number.isInteger(cap) ? cap : null;
  return { slots: { used, of }, in_all: inAll,
    shows: `${of == null ? `${used} slots` : `${used} of ${of} slots`} · ${inAll} ${inAll === 1 ? "thing" : "things"} in all` };
}

/**
 * WHAT A RESIDENT HOLDS BY KIND (review-610 S1): a class and a number, and
 * sharpened, each kind with its count — never a unit. For world_holdings and
 * investigate on a resident. Null when the hold record cannot be read.
 */
export async function kindsHeldBy(handle) {
  try {
    const [guards, { lawSnapshot }, { classViewOf }, { isUnitRow }] = await Promise.all([
      import("./world2-guards.mjs"), import("./law-snapshot.mjs"), import("./world-units.mjs"), import("./world-stacks.mjs")]);
    const { fold, attachments } = await holdRecordNow();
    const view = classViewOf(lawSnapshot());
    return { holder: String(handle), ...blurOf({ edges: kindEdgesOf(fold, String(handle)), extendsOf: view.extendsOf, sharp: true }),
      hands: handsCount({ fold, attachments, handle, cap: carryOf(view) }) };
  } catch { return null; }
}
