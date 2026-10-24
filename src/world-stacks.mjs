// world-stacks.mjs — THE COUNTED HOLDING (WLD-27, for the w43 ship).
//
// `holds(holder → label, count)`: a live edge, ONE PER LABEL, whose holder is a
// resident or a chest. A stack is a count on an edge, not a crowd of marks
// (LOGOS/classes.md § Stacks, chests and candy). The rulings this file builds:
//
//   · Sitting A's build specification on WLD-27 (the issue's description).
//   · Wright, 2026-10-12T23:59Z and 2026-10-13T00:01Z: capacity 30 by default,
//     1..120; first stock min(30, capacity), once; refill is the creator's,
//     tops up to capacity, one act line, a full chest is a no-op; one edge per
//     label; a take or consume names its label when more than one is present,
//     otherwise refuses listing labels and counts — no draw, no implicit pick;
//     a counted unit carries no stakes.
//   · Wright, 2026-10-13T00:09Z: the identity field is `label`, never the mark's
//     `kind`; the candy class carries `labels: [{label, name, creator}]`, read
//     both ways; a chest whose maker has no label is admitted UNSTOCKED and
//     stocked once at the next settlement that finds the label.
//
// ── WHERE THE EDGE LIVES ────────────────────────────────────────────────────
//
// In `acts`, on the hold lane: class `holding`, actions `units:*`. The hold
// lane is already the record for who holds what (hold-edge.mjs), so a counted
// unit moving is one more face of the same act and needs no lane of its own,
// no new table and no migration. Every unit act carries `payload.moves`, a list
// of `{ from, to, label, n }` where `from`/`to` is a holder (a resident handle,
// or a chest's mark id `<by>/<slug>`) or null (a unit made by the town's stock
// or refill, or one that left the counts: consumed, or set down as a mark).
// The counts are the FOLD of those moves — derived, never stored, and never a
// second display count (the brief: "not … a second stored display count").
//
// `units:*` is outside guard-reads' ATTACHMENT_ACTIONS, so the who-holds-which-
// thing fold (`liveHolder`) never reads a unit act as a thing changing hands,
// and `latestDrop` (action === "drop") never reads a unit's set-down as a thing's.
//
// EVERYTHING HERE IS PURE: rows in, answers out. The door (world-hold.mjs) and
// the settlement tick (world2/tools/chest-stock.mjs) read the record and hand
// it in, for the reason world-hold.mjs gives for `declareHolding`: a falsifier
// must be able to put a chest at 27 without a store.

import { markClassOf } from "./world-grants.mjs"; // the kind rung: a mark's class in both forms (LOGOS v2, O1)

export const UNIT_ACTION = Object.freeze({
  make: "units:make",              // LOGOS v2: leave-mark { kind, count, to } makes marks into a holder (refill is its shorthand)
  stock: "units:stock",            // the town stocks a chest at its admitting settlement
  refill: "units:refill",          // the label's creator tops a chest up
  give: "units:give",              // holder → resident or chest
  take: "units:take",              // chest → the taker
  consume: "units:consume",        // a held unit used up
  offer: "units:offer",            // a held unit held out to a creature and used up, whatever it does (POS-672, call 2)
  drop: "units:drop",              // a held unit set down: it becomes a mark
  dropUndone: "units:drop-undone", // the set-down's mark could not be filed: the unit comes back
  takeBack: "units:take-back",     // a dropped unit's mark taken back into a holding
  consumeInPlace: "units:consume-in-place", // a dropped unit's mark consumed where it stands
  exitWithdrawn: "units:exit-withdrawn", // that mark's withdrawal landed — the exit's terminal work is done
  dropResolved: "units:drop-resolved", // the tick found a set-down's mark filed: settled, never asked again (moves nothing)
  dropSweep: "units:drop-sweep",   // the tick's low-water cursor: every set-down through this id is settled (moves nothing)
});
const UNIT_ACTIONS = new Set(Object.values(UNIT_ACTION));
export const UNIT_PREFIX = "units:";

export const isUnitRow = (r) => r?.class === "holding" && String(r?.action ?? "").startsWith(UNIT_PREFIX);
export const isChestId = (holder) => typeof holder === "string" && holder.includes("/");

const bounce = (code, defect, hint, extra = {}) => {
  const e = new Error(defect);
  Object.assign(e, { code, defect, hint, ...extra });
  return e;
};

const movesOf = (r) => {
  const p = r?.payload && typeof r.payload === "object" ? r.payload : {};
  return Array.isArray(p.moves) ? p.moves : [];
};

// ── THE FOLD ────────────────────────────────────────────────────────────────

/**
 * Every holder's counts: `Map(holder → Map(label → count))`, from the unit acts
 * in the record's order. A move that would take a count below zero is NOT
 * applied and is named in `anomalies` — the doors refuse such a move before it
 * is written, so an anomaly is a record a door did not write, and the fold says
 * so rather than inventing negative candy.
 *
 * KINDS (LOGOS v2, lane O2): a move that names `kind` (a class id, "counts are
 * blur", ruled 15:46) folds into `kinds`, `Map(holder → Map(kind → count))`,
 * and one that names `label` into `counts`, as #499 wrote it. The two maps
 * never mix: no label act is ever read as a kind holding, nor the reverse. A
 * holder's room and carry count both (`totalOf`), because both are held.
 */
export function foldUnits(rows = [], from = null) {
  // `from`: a fold to continue (a kept base, hold-record.mjs), copied, never mutated — the fold is additive
  const copy = (m) => new Map([...(m ?? new Map())].map(([h, inner]) => [h, new Map(inner)]));
  const counts = from ? copy(from.counts) : new Map();
  const kinds = from ? copy(from.kinds) : new Map();
  const anomalies = from ? [...(from.anomalies ?? [])] : [];
  const bump = (map, holder, key, n) => {
    if (!map.has(holder)) map.set(holder, new Map());
    const m = map.get(holder);
    const next = (m.get(key) ?? 0) + n;
    if (next === 0) m.delete(key); else m.set(key, next);
    if (!m.size) map.delete(holder);
  };
  for (const r of rows) {
    if (!isUnitRow(r)) continue;
    for (const mv of movesOf(r)) {
      const n = Number(mv?.n);
      const byKind = mv?.kind != null && mv?.label == null;
      const key = byKind ? String(mv.kind) : mv?.label == null ? null : String(mv.label);
      const map = byKind ? kinds : counts;
      if (!key || !Number.isInteger(n) || n < 1) { anomalies.push({ act: r.id ?? r.seq ?? null, why: "a move with no label or kind, or no whole count" }); continue; }
      if (mv.from != null && countOf(map, String(mv.from), key) < n) {
        anomalies.push({ act: r.id ?? r.seq ?? null, why: `${mv.from} held fewer than ${n} ${key}` });
        continue;
      }
      if (mv.from != null) bump(map, String(mv.from), key, -n);
      if (mv.to != null) bump(map, String(mv.to), key, n);
    }
  }
  return { counts, kinds, anomalies };
}

const countOf = (counts, holder, label) => counts.get(holder)?.get(label) ?? 0;

/** One holder's edges, label-sorted: `[{ label, count }]`. */
export function edgesOf(fold, holder) {
  const m = fold.counts.get(String(holder));
  return m ? [...m].map(([label, count]) => ({ label, count })).sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)) : [];
}

/** One holder's kinds, kind-sorted: `[{ kind, count }]` (LOGOS v2, O2). */
export function kindEdgesOf(fold, holder) {
  const m = fold.kinds?.get(String(holder));
  return m ? [...m].map(([kind, count]) => ({ kind, count })).sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)) : [];
}

/** Everything one holder holds, summed over its labels and its kinds. */
export const totalOf = (fold, holder) => edgesOf(fold, holder).reduce((s, e) => s + e.count, 0)
  + kindEdgesOf(fold, holder).reduce((s, e) => s + e.count, 0);

/** Has the town stocked this chest? (the first stock is once, ever) */
export const stockedChests = (rows = []) =>
  new Set(rows.filter((r) => isUnitRow(r) && r.action === UNIT_ACTION.stock).map((r) => String(r.object)));

/** The exited marks whose withdrawal has landed (finding 2 of Bevel's review: a failed one is retried). */
export const withdrawnMarks = (rows = []) =>
  new Set(rows.filter((r) => isUnitRow(r) && r.action === UNIT_ACTION.exitWithdrawn).map((r) => String(r.object)));

/** The dropped-unit marks that have already stopped being marks — taken back or consumed in place. */
export const exitedMarks = (rows = []) =>
  new Set(rows.filter((r) => isUnitRow(r) && (r.action === UNIT_ACTION.takeBack || r.action === UNIT_ACTION.consumeInPlace))
    .map((r) => String(r.object)));

// ── AMOUNTS ─────────────────────────────────────────────────────────────────

/** A count a resident asked for: a whole number ≥ 1, default 1. Never rounded, never clipped. */
export function unitCount(raw) {
  if (raw === undefined || raw === null) return 1;
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1)
    throw bounce(422, "count must be a whole number of units, 1 or more",
      `got ${JSON.stringify(raw)} — a unit is never split, and nothing is moved by a count of zero or less. Nothing was recorded.`);
  return n;
}

// ── THE LABELS (Wright, 2026-10-13T00:09Z) ──────────────────────────────────
//
// THE CANDY CLASS RECORD'S `labels`, the one registry of candy identities:
//
//   labels: [{ "label": "<slug>", "name": "<the resident's declared name>", "creator": "<handle>" }]
//
// on `the-town/candy` in the Keeping Works (world: WORLD/marks/let-there-be-
// light/the-town-centre/the-keeping-works/postmark-node/mark/thing/consumable/
// candy/mark.md). Read both ways: creator → label to stock, label → creator to
// refill. Nothing here holds a copy.

export function candyLabels(candyRecord) {
  const raw = candyRecord?.labels;
  const list = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : raw;
  return (Array.isArray(list) ? list : [])
    .filter((l) => l && typeof l.label === "string" && l.label && typeof l.creator === "string" && l.creator)
    .map((l) => ({ label: l.label, name: typeof l.name === "string" && l.name ? l.name : l.label, creator: l.creator }));
}

/** creator → their label, or null. One label per creator; a second listing is ignored (the first stands). */
export const labelOfCreator = (labels, handle) => labels.find((l) => l.creator === String(handle)) ?? null;
/** label → its record (and so its creator), or null. */
export const labelRecord = (labels, label) => labels.find((l) => l.label === String(label)) ?? null;

// ── THE CHEST'S OWN DIALS ───────────────────────────────────────────────────

/** The chest class's dials, with the ruled defaults standing in only for an absent record. */
export function chestDials(dials = {}) {
  const d = dials && typeof dials === "object" ? dials : {};
  return {
    capacity: Number.isInteger(d.capacity) ? d.capacity : 30,
    capacity_min: Number.isInteger(d.capacity_min) ? d.capacity_min : 1,
    capacity_max: Number.isInteger(d.capacity_max) ? d.capacity_max : 120,
    first_stock: Number.isInteger(d.first_stock) ? d.first_stock : 30,
    portable: d.portable !== false,
    welcome: typeof d.welcome === "string" ? d.welcome : "open",
  };
}

/**
 * A chest's capacity as its mark declares it, or the class default. A value
 * outside the class's range, or not a whole number, is REFUSED — at the
 * placement door that is the resident's error, and on a canon record it is a
 * chest this door will not guess the size of.
 */
export function capacityOf(markOrValue, dials = {}) {
  const d = chestDials(dials);
  const v = markOrValue && typeof markOrValue === "object" ? markOrValue.capacity : markOrValue;
  if (v === undefined || v === null) return d.capacity;
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < d.capacity_min || n > d.capacity_max)
    throw bounce(422, `a chest's capacity is a whole number from ${d.capacity_min} to ${d.capacity_max}`,
      `got ${JSON.stringify(v)}; leave capacity off for the default ${d.capacity}`);
  return n;
}

/** Is this chest portable? A fixed chest — a bowl — is not. */
export const portableOf = (mark, dials = {}) => (mark && typeof mark.portable === "boolean" ? mark.portable : chestDials(dials).portable);
/** The chest's welcome: "open" unless it says otherwise. */
export const welcomeOf = (mark, dials = {}) => (mark && typeof mark.welcome === "string" ? mark.welcome : chestDials(dials).welcome);
export const WELCOMES = Object.freeze(["open", "closed"]);

// ── THE NEAREST COMMON CLASS (display only) ─────────────────────────────────

/** A class's chain, itself first: candy → consumable → thing → mark … */
export function ancestry(name, extendsOf) {
  const out = [];
  const seen = new Set();
  for (let c = name == null ? null : String(name); c && !seen.has(c); c = extendsOf(c)) { seen.add(c); out.push(c); }
  return out;
}

/** The nearest class every one of `names` is (or extends), or null. */
export function nearestCommonClass(names, extendsOf) {
  const list = [...new Set([...(names ?? [])].map(String))];
  if (!list.length) return null;
  const [first, ...rest] = list.map((n) => ancestry(n, extendsOf));
  return first.find((c) => rest.every((chain) => chain.includes(c))) ?? null;
}

/**
 * A kind's name for a count, the one plural the hold lane speaks (POS-741, POS-743).
 * One stays as it is; a name that already ends in s is already its plural
 * ("hoard-coins", "lanternchews"), so it is left alone, never "hoard-coinss";
 * a consonant and y becomes ies ("candy" → "candies"); anything else takes an s.
 */
export const plural = (word, n) => (n === 1 || /s$/i.test(word) ? word : /[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`);

/**
 * WHAT A HOLDING SHOWS — its labelled components kept whole, plus the nearest
 * common class and the summed count, which are display only (no common-class
 * unit exists anywhere). `components` are `{ class, label?, name?, count }`:
 * a counted label, or a thing held whole (a toaster: `{ class: "thing", count: 1 }`).
 *
 *   one label        "Pocket Comets: 18"
 *   mixed            "101 candies" · "102 things"
 */
export function holdingDisplay(components, extendsOf) {
  const parts = [...(components ?? [])].filter((c) => Number(c?.count) > 0);
  const count = parts.reduce((s, c) => s + Number(c.count), 0);
  if (!parts.length) return { count: 0, class: null, components: [], text: "empty" };
  const klass = nearestCommonClass(parts.map((c) => c.class), extendsOf);
  const one = parts.length === 1 && parts[0].label;
  return {
    count, class: klass, components: parts.map((c) => ({ ...c })),
    text: one ? `${parts[0].name ?? parts[0].label}: ${count}` : `${count} ${plural(klass ?? "thing", count)}`,
  };
}

// ── SELECTION (Wright, 2026-10-13T00:01Z) ───────────────────────────────────

/**
 * Which label an act moves. Named: it must be held there. Omitted: only when
 * exactly one label is present. Anything else REFUSES, listing what is there,
 * so the actor can ask again — no draw, no default, nothing implicit.
 */
export function selectLabel(edges, label, { where = "there", verb = "take" } = {}) {
  if (label != null && label !== "") {
    const hit = edges.find((e) => e.label === String(label));
    if (!hit) throw bounce(409, `no ${label} ${where}`,
      edges.length ? `${where} holds ${listing(edges)}. Nothing was recorded.` : `${where} holds nothing. Nothing was recorded.`,
      { holds: edges });
    return hit;
  }
  if (edges.length === 1) return edges[0];
  if (!edges.length) throw bounce(409, `nothing to ${verb} — ${where} holds nothing`, "Nothing was recorded.", { holds: [] });
  throw bounce(409, `name a label: ${where} holds ${edges.length} labels`,
    `${where} holds ${listing(edges)} — say which with label: "<label>". Nothing is chosen for you. Nothing was recorded.`,
    { holds: edges });
}
const listing = (edges) => edges.map((e) => `${e.count} ${e.label}`).join(", ");

// ── THE CARRY (the thing class's carry_cap) ─────────────────────────────────

/**
 * What a resident carries: every held unit costs one slot, every thing they
 * hold whole costs one — and a portable chest is a thing held whole, so it
 * costs ONE whatever it holds (its contents are the chest's edges, not the
 * carrier's). The cap is the resident's `capacity` (LOGOS v2; the thing class's older `carry_cap` second), read by the
 * caller from the record and handed in; there is no copy of 24 here.
 */
export const carryLoad = ({ units = 0, things = 0 } = {}) => Number(units) + Number(things);

export function refuseOverCarry({ who, units, things, adding, cap }) {
  if (!Number.isInteger(cap) || cap < 0) return null; // the record gave no cap: nothing to enforce, and the door says so
  const now = carryLoad({ units, things });
  if (now + adding > cap)
    throw bounce(409, `${who} cannot carry ${adding} more — ${now} of ${cap} carried`,
      `a resident carries ${cap} (the resident class's capacity): every unit is one slot, every thing held whole is one, a portable chest is one whatever it holds. ${cap - now > 0 ? `${cap - now} more fit.` : "Nothing more fits."} Set something down first. Nothing was recorded.`,
      { carried: now, cap });
  return { carried: now + adding, cap };
}

// ── A CLASS TAKEN BY THE TOWN'S OWN ACT (WLD-7) ─────────────────────────────
//
// The town can take a class away for a while: its record says `dials.stolen:
// true` (the boolean, nothing else; a record saying `taken: true` is not read
// as stolen, and there is no alias), with a sentence in `dials.clue`. While it
// says so, every act that moves, makes or uses up a thing or a unit OF that
// class, or of a class extending it, refuses with that sentence (423), and
// nothing is recorded. When the record stops saying so, the same acts work
// again. Removing the dial reverses it whole: the class was never deleted, so
// nothing it made is orphaned. No class says so today, so this refuses nothing.
// Built from Jetto's refit (58b633b8).

export function stolenRefusal(klass, classRecord, extendsOf, { restored = () => false } = {}) {
  if (!klass) return null;
  for (const c of ancestry(klass, extendsOf)) {
    const rec = classRecord(c);
    const d = rec?.dials && typeof rec.dials === "object" ? rec.dials : {};
    // GIVEN BACK IN THE RECORD (WLD-25/j): the town's own restore act since the dial went
    // on lifts it, though the dial still stands (restored-classes.mjs)
    if (d.stolen === true && !restored(c)) {
      const clue = typeof d.clue === "string" && d.clue.trim() ? d.clue.trim() : `the ${c} has been stolen.`;
      return bounce(423, clue, `the ${c} has been stolen; nothing moves until it is returned. Nothing was recorded.`, { stolen: c });
    }
  }
  return null;
}

/**
 * THE ONE QUESTION, FOR EVERY DOOR (WLD-7). `klass` is what the act is judged
 * by: a class name; `null` for a thing whose mark was READ and names no class
 * (a `thing`); `undefined` when it cannot be told (no mark, canon unread, a
 * label the law does not register). `view` is the class layer of THIS moment.
 *
 *   no class stolen   inert: nothing refuses, whatever is unknown
 *   a class stolen    ONLY WHAT IS KNOWN TO BE OF IT IS REFUSED (Darko 2026-10-13
 *                     17:57: "collateral breakage is a platform bug"). A thing whose
 *                     class cannot be told, or a class the law lacks, gets exactly
 *                     its ordinary day's answer
 *   no law loaded     inert (a process's cold start: nothing can be known stolen,
 *                     and a published snapshot is never replaced by none)
 *   given back        a taken class the town has restored by its own act since the
 *                     dial went on is not refused (view.restored; restored-classes.mjs)
 */
export function stolenClassRefusal(klass, view) {
  if (!view?.readable || !view.stolenAny?.()) return null;
  if (klass === undefined) return null;
  return stolenRefusal(klass === null ? "thing" : klass, view.record, view.extendsOf, { restored: view.restored ?? (() => false) });
}

// ── THE MOVES, ADJUDICATED ──────────────────────────────────────────────────
//
// Each returns the act row's `{ action, object, moves, ... }` or throws the
// door's bounce; nothing here writes. `fold` is `foldUnits(rows)` over the
// record as read INSIDE the hold queue's turn (world-hold.mjs § THE FLIPPED
// HOLD): the check and the write see the same state.

/** A resident hands units to another resident or into a chest. */
export function planGive({ fold, actor, to, label, n, capacityOfTo = null }) {
  if (to == null || to === "") throw bounce(422, "give to whom?", "to: a resident's handle, or a chest's id <by>/<slug>");
  if (String(to) === String(actor)) throw bounce(422, "you are already holding them", "give names another resident or a chest");
  const edge = selectLabel(edgesOf(fold, actor), label, { where: "your hands", verb: "give" });
  if (edge.count < n) throw bounce(409, `you hold ${edge.count} ${edge.label}, not ${n}`, "give at most what you hold. Nothing was recorded.");
  if (isChestId(to) && Number.isInteger(capacityOfTo)) {
    const room = capacityOfTo - totalOf(fold, to);
    if (n > room) throw bounce(409, `${to} has room for ${Math.max(room, 0)}, not ${n}`,
      `its capacity is ${capacityOfTo} and it holds ${totalOf(fold, to)} (every label counted). Nothing was recorded.`, { room: Math.max(room, 0) });
  }
  return { action: UNIT_ACTION.give, object: String(to), label: edge.label, moves: [{ from: String(actor), to: String(to), label: edge.label, n }] };
}

/** A resident takes units out of a chest. */
export function planTake({ fold, actor, from, label, n }) {
  if (!isChestId(from)) throw bounce(422, "take from which chest?", "from: the chest's id, <by>/<slug>");
  const edge = selectLabel(edgesOf(fold, from), label, { where: from, verb: "take" });
  if (edge.count < n) throw bounce(409, `${from} holds ${edge.count} ${edge.label}, not ${n}`, "take at most what it holds. Nothing was recorded.");
  return { action: UNIT_ACTION.take, object: String(from), label: edge.label, moves: [{ from: String(from), to: String(actor), label: edge.label, n }] };
}

/**
 * One held unit used up. Only a consumable: the label's class is asked, and a
 * label that is not a consumable (or a holding that is not candy at all) is
 * refused. NO STAKES: a counted unit is not staked, so nothing returns, and
 * the act line says so (Wright, 2026-10-13T00:01Z).
 */
export function planConsume({ fold, actor, from = null, label, classOfLabel, extendsOf }) {
  const holder = from == null ? String(actor) : String(from);
  const edge = selectLabel(edgesOf(fold, holder), label, { where: from == null ? "your hands" : holder, verb: "consume" });
  const klass = classOfLabel(edge.label);
  if (!ancestry(klass, extendsOf).includes("consumable"))
    throw bounce(422, `${edge.label} is not a consumable`, `consume takes only what is made to be used up (${klass ?? "an unknown class"} is not). Nothing was recorded.`);
  return { action: UNIT_ACTION.consume, object: holder, label: edge.label,
    moves: [{ from: holder, to: null, label: edge.label, n: 1 }],
    returns: [], returns_note: "a held unit is a count, not a staked mark: consuming it returns nothing" };
}

/** Who may refill `chest`, and with which label — or a refusal. */
export function refillerLabel({ actor, chest, labels, maker }) {
  // MAKER AND LABEL CREATOR, BOTH (Wright, 2026-10-13T03:01:29Z, F2): refill is
  // for the one who made THIS chest, with the label they created. Authorship is
  // not possession or household — a resident who carries the chest, shares its
  // maker's house or has a label of their own does not refill another's chest,
  // even an emptied one, even when the refill would add nothing. Giving into it
  // stays open.
  if (maker == null || String(maker) !== String(actor))
    throw bounce(403, `${actor} did not make ${chest}`, `only its maker${maker == null ? "" : `, ${maker},`} refills a chest, with their own candy label; you can give into it instead. Nothing was recorded.`);
  const mine = labelOfCreator(labels, actor);
  if (!mine) throw bounce(403, `${actor} has no candy label`, "only the creator of a candy label may refill a chest, and only with their own. Nothing was recorded.");
  return mine;
}

/**
 * Refill (Wright, 2026-10-13T00:01Z; eligibility 03:01Z): the chest's maker,
 * who created the label, tops the chest up to its capacity with that OWN label
 * — exactly the remaining room, every label counted. A full chest is a no-op,
 * not an act.
 */
export function planRefill({ fold, actor, chest, capacity, labels, maker }) {
  const mine = refillerLabel({ actor, chest, labels, maker });
  // No third condition (Wright, 2026-10-13T03:38:35Z): the maker refills her
  // own chest with her own label whatever else it holds — another resident's
  // gifts beside it read as their nearest common class.
  const held = edgesOf(fold, chest);
  const room = capacity - totalOf(fold, chest);
  if (room <= 0) return { noop: true, chest, label: mine.label, capacity, holds: held, note: `${chest} is full (${capacity} of ${capacity}); nothing was added and nothing was recorded` };
  return { action: UNIT_ACTION.refill, object: String(chest), label: mine.label, capacity,
    moves: [{ from: null, to: String(chest), label: mine.label, n: room }] };
}

/**
 * THE FIRST STOCK, planned for the settlement tick. A chest is stocked ONCE,
 * ever: `stocked` is the set of chests the record already shows a stock act
 * for. A maker with no label is admitted UNSTOCKED — named, not held, not
 * failed, and never counted as stocked, so a later settlement that finds the
 * label stocks it then (Wright, 2026-10-13T00:09Z).
 */
export function planChestStock({ chests = [], labels = [], stocked = new Set(), fold = null, dials = {}, thingsIn = new Map() }) {
  const d = chestDials(dials);
  const stock = [], unstocked = [], refused = [];
  for (const c of chests) {
    const id = String(c.id);
    if (stocked.has(id)) continue;
    let capacity;
    try { capacity = capacityOf(c.capacity ?? null, dials); }
    catch (e) { refused.push({ chest: id, line: `chest-unstocked: ${id} declares a capacity outside ${d.capacity_min}..${d.capacity_max} (${JSON.stringify(c.capacity)})` }); continue; }
    const maker = String(c.by ?? id.split("/")[0]);
    const mine = labelOfCreator(labels, maker);
    if (!mine) { unstocked.push({ chest: id, handle: maker, line: `chest-unstocked: ${maker} has no candy label` }); continue; }
    // PRESERVE WHAT IS THERE: units given into an unstocked chest stay, and the
    // stock fills toward min(first_stock, capacity) without overfilling it.
    const target = Math.min(d.first_stock, capacity);
    // every label's units AND the whole things already inside share the one capacity
    const held = (fold ? totalOf(fold, id) : 0) + Number(thingsIn.get(id) ?? 0);
    const n = Math.max(0, Math.min(target, capacity - held));
    stock.push({ chest: id, handle: maker, label: mine.label, n, capacity });
  }
  return { stock, unstocked, refused };
}

// ── THE DROPPED UNIT'S MARK (Wright, 2026-10-13T00:09Z) ─────────────────────

/** The leave-mark payload a set-down files: sited candy, its label, the drop act named. */
export function droppedUnitMark({ actor, label, name = null, actId, at, extent = { w: 1, h: 1 } }) {
  if (actId == null) throw new Error("a dropped unit names the drop act that set it down — no act id");
  return {
    by: String(actor), slug: `${label}-${actId}`, kind: "sited", at: { x: Number(at.x), y: Number(at.y) }, extent,
    body: `One ${name ?? label}, set down here.`.slice(0, 150),
    class: "candy", label: String(label), dropped: `act:${actId}`, stamps: 1,
  };
}

/** Is this canon record a dropped unit (a candy mark naming its drop act)? */
export const isDroppedUnitMark = (mark) =>
  markClassOf(mark) === "candy" && typeof mark?.label === "string" && /^act:[1-9][0-9]*$/.test(String(mark?.dropped ?? ""));

// ── THE RETURNS AT A MARK'S EXIT (Wright, 2026-10-13T00:01Z) ────────────────
//
// "Auto-return is at the transition where a unit stops being a MARK: a
// previously dropped, sited unit is taken back into a holding OR consumed where
// it stands. Return its 1-stamp escrow and all stakes to their actual stakers,
// one receipt line each, exactly once on retry."
//
// THE PLAN IS THE ESCROW AS IT STANDS NOW, which is what makes it once: each
// return is the staker's own open position on the mark, so after the first run
// every position is zero and a retry plans nothing. A run that stopped halfway
// resumes with exactly the positions still open. No memory of "already
// returned" is kept beside the ledger, because the ledger is that memory.

/** `[{ handle, stamps }]` (the stake read's holders) → one return per staker with a position. */
export function returnsAtExit({ mark, holders = [] }) {
  const byHandle = new Map();
  for (const h of holders ?? []) {
    const n = Number(h?.stamps);
    if (!h?.handle || !Number.isInteger(n) || n <= 0) continue;
    byHandle.set(String(h.handle), (byHandle.get(String(h.handle)) ?? 0) + n);
  }
  return [...byHandle].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([handle, stamps]) => ({ mark: String(mark), handle, stamps }));
}

/** The receipt line each return leaves, in the town ledger's unstake shape. */
export const returnLine = ({ date, mark, handle, stamps, why }) =>
  `- ${date} · ${handle} ← stake:world-mark/${mark} · ${stamps} · for: ${why}`;
