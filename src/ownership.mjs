// ownership.mjs — MAKER AND OWNER; THE THREE WORDS (POS-688, ruled by Darko
// 2026-10-19 16:39–16:45, and D-O1..D-O6 as recommended at 17:14).
//
// "Maker is fixed forever. Owner (the one with the say) starts as the maker,
// and ownership passes only by the owner's own act: give; putting it in an open
// holder (the candy bowl: whoever takes from it owns it); saying welcomed on
// someone's take ('keep it'), which is final." Borrowing is just taking: a take
// moves the holding, never the ownership.
//
// "The owner's word on their thing, while someone outside the house holds it or
// has set it down, works like a mark stance: silence or neutral = borrowed;
// welcomed = yours, and final; opposed = bring it back." Neutral and opposed are
// revisable forever, the latest wins, and opposed returns it at the next
// settlement (world2/tools/hold-through.mjs § the return).
//
// ── ONE RULE, FOLDED FROM THE RECORD ────────────────────────────────────────
//
// Nothing new is stored. The owner is a fold over `acts`: the holding acts
// (class holding: take, give, drop) and the owner's words (class stance, with
// `payload.act` naming the take or set-down it answers). This file is that fold,
// PURE, and every reader calls it: the office's kept hold record
// (world-kinds.mjs § holdRecordNow), the stance door for one thing
// (world-stance.mjs § the word arm), and the clearing (hold-through.mjs).
//
// THE GRAIN IS THE HOUSEHOLD, as everywhere in the town: "the owner's own act"
// is any act by the owner's household (one human, their residents), and the
// word is spoken by the owner's house. `houseOf(handle)` is handed in, sync.
//
// AN OUTING is the thing's time outside the owner's house: it opens at the first
// take or set-down by someone outside the house, collects every take and
// set-down while it lasts, and closes when the thing comes back (taken, given or
// returned to the owner's house) or changes owner. A word answers one act of the
// current outing; the latest word across the outing is the owner's word. A word
// from an earlier outing never reaches a later one.

/** The record's field for the owner, when not the maker (world mark-kind.mjs § OWNED_BY: one name). */
export const OWNED_BY = "owned_by";

/** The acts a word answers, as the stance payload names them. */
export const ANSWERS_TAKE = "take";
export const ANSWERS_SET_DOWN = "set-down";

/** Who owns this record, as printed, or null when its maker does. */
export const ownedBy = (m) => {
  const v = m?.[OWNED_BY];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

const isMarkId = (v) => typeof v === "string" && v.includes("/");
const numOf = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
/** A thing's maker: the record's `by`, which is the id's first segment. */
export const makerOf = (thing) => String(thing).split("/")[0];

/** The act a word answers: `payload.act` (`{ act_id, by }`), or null for any other stance. */
export function answeredAct(payload) {
  const p = payload ?? {};
  if (p.answers !== ANSWERS_TAKE && p.answers !== ANSWERS_SET_DOWN) return null;
  const id = p.act?.act_id;
  return id == null ? null : { act_id: String(id), by: p.act?.by ?? null, kind: p.answers };
}

/**
 * The events the fold reads, in the record's order (act id). `holding` are hold
 * rows as guard-reads § holdingRowOf gives them (`seq`, `actor`, `action`,
 * `object`, `payload`); `stances` are stance acts (`seq` or `id`, `actor`,
 * `object`, `payload`). Counted units (`units:*`) and frozen-era rows are not a
 * thing's ownership and are left out.
 */
export function ownershipEvents(holding = [], stances = []) {
  const out = [];
  for (const r of holding) {
    if (!["take", "give", "drop"].includes(r?.action)) continue;
    const thing = r.object ?? r.payload?.thing;
    const seq = numOf(r.seq ?? r.id);
    if (!isMarkId(thing) || seq == null) continue;
    out.push({ seq, kind: "hold", thing: String(thing), actor: r.actor == null ? null : String(r.actor), action: r.action, payload: r.payload ?? {} });
  }
  for (const s of stances) {
    const act = answeredAct(s?.payload);
    const seq = numOf(s?.seq ?? s?.id);
    if (!act || seq == null || !isMarkId(s.object)) continue;
    out.push({ seq, kind: "word", thing: String(s.object), actor: String(s.actor), stance: s.payload.stance, act });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

const fresh = (thing) => ({ owner: makerOf(thing), outing: null, putIn: null });
const copyOf = (st) => ({ owner: st.owner, putIn: st.putIn, outing: st.outing ? { acts: [...st.outing.acts], word: st.outing.word } : null });

/**
 * THE FOLD. `events` from `ownershipEvents`, applied in order on top of `state`
 * (a `Map(thing → { owner, outing, putIn })`, copied, never mutated), so a kept
 * base and a window fold the same way a whole read does. PURE.
 *
 * `houseOf(handle)` → the handle's household key (sync); `opts.isHolder(id)`
 * says a holder id from a resident's handle (default: it is a mark id).
 */
export function foldOwners(events = [], { houseOf = (h) => h, state = null } = {}) {
  const out = new Map(state ?? []);
  const same = (a, b) => a != null && b != null && houseOf(String(a)) === houseOf(String(b));
  const get = (thing) => {
    const st = out.get(thing);
    const next = st ? copyOf(st) : fresh(thing);
    out.set(thing, next);
    return next;
  };
  for (const e of events) {
    const st = get(e.thing);
    if (e.kind === "word") {
      // only the owner's house speaks, and only on an act of the thing's current outing
      if (!st.outing || !same(e.actor, st.owner)) continue;
      const act = st.outing.acts.find((a) => a.act_id === e.act.act_id);
      if (!act) continue;
      if (e.stance === "welcomed") { st.owner = act.by; st.outing = null; continue; } // "keep it": final
      if (e.stance === "opposed" || e.stance === "neutral")
        st.outing.word = { stance: e.stance, stance_act: String(e.seq), act_id: act.act_id };
      continue;
    }
    const p = e.payload ?? {};
    // THE TOWN'S RETURN closes the outing: the thing is back in the owner's hands or on their ground
    if (p.returned) { st.outing = null; st.putIn = null; continue; }
    const into = p.holder == null ? null : String(p.holder);
    if (e.action === "give") {
      if (isMarkId(into)) { st.putIn = { holder: into, by: e.actor }; continue; } // into a holder: who put it there
      st.putIn = null;
      if (same(e.actor, st.owner) && into != null && !same(into, st.owner)) { st.owner = into; st.outing = null; continue; } // the owner's give
      if (into != null && same(into, st.owner)) st.outing = null; // given back home
      continue;
    }
    if (e.action === "take") {
      const from = p.previous_holder == null ? null : String(p.previous_holder);
      // OUT OF AN OPEN HOLDER THE OWNER PUT IT IN: the taker owns it. The door that wrote the take
      // decided it (`payload.owns`, world-kinds.mjs § thingFromHolder: the holder open, the put-in the owner's)
      if (p.owns === true && isMarkId(from) && !same(e.actor, st.owner)) { st.owner = e.actor; st.outing = null; st.putIn = null; continue; }
      st.putIn = null;
      if (same(e.actor, st.owner)) { st.outing = null; continue; } // back in the house
      st.outing ??= { acts: [], word: null };
      st.outing.acts.push({ act_id: String(e.seq), by: e.actor, kind: ANSWERS_TAKE });
      continue;
    }
    if (e.action === "drop") {
      st.putIn = null;
      if (same(e.actor, st.owner)) { st.outing = null; continue; } // the owner's house set it down
      st.outing ??= { acts: [], word: null };
      st.outing.acts.push({ act_id: String(e.seq), by: e.actor, kind: ANSWERS_SET_DOWN });
    }
  }
  return out;
}

/**
 * OUT OF AN OPEN HOLDER THE OWNER PUT IT IN, the taker owns it ("the candy bowl:
 * whoever takes from it owns it"). True only when the holder is open, the thing
 * went into THIS holder by the owner's house's own act, and the taker is outside
 * that house. A thing a borrower put in a bowl is still lent. PURE: the take door
 * asks it and writes the answer on the act (`payload.owns`), so every fold reads
 * the door's decision and never needs the holder's law.
 */
export function takeOwns(st, { from, actor, open = true, houseOf = (h) => h } = {}) {
  if (open === false || !st?.putIn || st.putIn.holder !== String(from)) return false;
  const same = (a, b) => a != null && b != null && houseOf(String(a)) === houseOf(String(b));
  return same(st.putIn.by, st.owner) && !same(actor, st.owner);
}

/** One thing's answer from a fold: `{ owner, outing }`, the maker and no outing when the record says nothing. */
export const ownershipOf = (owners, thing) => {
  const st = owners?.get?.(String(thing));
  return st ? { owner: st.owner, outing: st.outing } : { owner: makerOf(thing), outing: null };
};

/** The act a word would answer now: the latest take or set-down of the current outing, or null. */
export const latestOutingAct = (st) => (st?.outing?.acts?.length ? st.outing.acts[st.outing.acts.length - 1] : null);

/** Does this outing wait on the owner's word? Silence waits; a declared neutral or opposed does not. */
export const awaitsWord = (st) => !!st?.outing && st.outing.word == null;

/** Is the owner's latest word "bring it back"? */
export const opposedNow = (st) => st?.outing?.word?.stance === "opposed";
