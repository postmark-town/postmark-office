// encounter.mjs — an encounter with a finishable creature, the office half:
// nerve, resolve, ease and the press.
//
// RULED (Darko 2026-10-19 19:56–20:03, 2026-10-20 22:47, 2026-10-21 08:34 and
// 08:39; shape B with the house split and the creature knowing the dyad):
//
//   · TWO ROADS. A finishable creature (its kind says `finishable: yes`) carries
//     RESOLVE, worn down by force, and EASE, built by its own peaceful test.
//     Resolve at 0 finishes it by the strike that got it there; ease full
//     finishes it for the resident whose act filled it. Either road writes the
//     one finish row (creatures.mjs § recordFinish), and the settlement ends it.
//   · NERVE is the action economy: NERVE_MAX per resident, refilled whole at each
//     settlement. Every act made inside a finishable creature's ring costs
//     ACT_COST on either road; a strike costs STRIKE_COST. At 0 the resident
//     flees through the exit lock and stays out until the next settlement.
//   · THE PRESS. Any reaction of a finishable creature may carry a nerve cost
//     aimed at one resident in its ring. Code resolves the menu (the actor, the
//     last striker, a shielder, the loudest, one alone) and Jev picks among it;
//     the kind bounds the amount (1..2). A shield takes it first; housemates in
//     the ring split what lands (D2, the payer paying the larger half).
//   · HELPING IS A MOVE. Steady gives a resident in the ring STEADY_GIVES nerve
//     for its own act's cost; shield takes the next press aimed at them.
//
// ONE CLOCK (Wright 2026-10-21, reading "resets at each crossing"): everything
// here runs on the settlement window, 06:00/18:00Z (world-forecast §
// settlementAtOrBefore), the clock the exit lock and the ending read. Nerve
// refills, resolve and ease reset and shields lapse at the same instant. A
// recorded finish is never undone by the reset.
//
// THE RECORD (every row class `creature`, so the living set folds them):
//   strike   actor the resident, object the creature   { kind, cost, damage, window }
//   steady   actor the resident, object the resident   { creature, cost, gives, window }
//   shield   actor the resident, object the resident   { creature, cost, window }
//   nerve    actor the creature, object the resident   { by, why, act, creature, window, shield?, split_of? }
// Each row carries its own numbers, so a resident's nerve re-derives from the
// record alone, whatever the dials say later. Nothing here names a place, a
// thing or a creature's role: the numbers and the lines are the kind file's.

import { settlementAtOrBefore, nextSettlement } from "./world-forecast.mjs";
import { faultLogged } from "./fault-words.mjs";

export const STRIKE_ACTION = "strike";
export const STEADY_ACTION = "steady";
export const SHIELD_ACTION = "shield";
export const NERVE_ACTION = "nerve";
/** The encounter's verbs, as the world's ENCOUNTER_VERBS names them (read at the blessed ref; this is the office's list for its doors). */
export const ENCOUNTER_VERBS = Object.freeze([STRIKE_ACTION, STEADY_ACTION, SHIELD_ACTION]);

const ruled = (value, call) => Object.freeze({ value, ruled: call });
/** THE NERVE DIALS, each Darko's number. Changing one is a one-line PR; the record keeps the number each row used. */
export const ENCOUNTER_DIALS = Object.freeze({
  nerve_max: ruled(10, "Darko 2026-10-20 22:47 (shape B: 10 per resident, refilled at each settlement)"),
  act_cost: ruled(1, "Darko 2026-10-20 22:47 (every act in a key creature's ring costs 1, on either road)"),
  strike_cost: ruled(2, "Darko 2026-10-21 08:34 (the build plan: strike costs 2)"),
  steady_gives: ruled(2, "Darko 2026-10-21 08:34 (steady gives 2 for 1 of yours)"),
});
export const encounterDial = (name) => ENCOUNTER_DIALS[name].value;

/** The words a resident reads about their nerve: the tools teach the residents. */
export const NERVE_NOTE = "Nerve is what an encounter costs you. Every act you make near a creature that can be finished costs 1, a strike 2. At 0 you flee and stay out until the settlement, when your nerve fills again.";

// ── the window ──────────────────────────────────────────────────────────────

/** The settlement window holding `ms`: { id (its start, ISO), start, ends } (epoch ms). */
export function windowAt(ms = Date.now()) {
  const id = settlementAtOrBefore(new Date(ms));
  return { id, start: Date.parse(id), ends: Date.parse(nextSettlement(new Date(ms))) };
}

const asPayload = (p) => (typeof p === "string" ? (() => { try { return JSON.parse(p); } catch { return {}; } })() : (p ?? {}));
const msOf = (t) => (t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t));
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export const isFinishable = (kind) => kind?.finishable === true;
export const isStrikable = (kind) => isFinishable(kind) && ((Number(kind.resolve) > 0 && Number(kind.strike) > 0) || isTempter(kind));
/** A creature that tempts (temptation.mjs): struck for damage, never worn down. */
export const isTempter = (kind) => isFinishable(kind) && typeof kind?.tempts === "string" && !!kind?.who;
/** A creature with a resolve to wear down. */
export const hasResolve = (kind) => isFinishable(kind) && Number(kind.resolve) > 0 && Number(kind.strike) > 0;

// ── nerve: a fold of the record ─────────────────────────────────────────────

/**
 * What one row does to `handle`'s nerve: a strike, a steady given or a shield
 * costs the actor its own `cost`; a steady received gives its `gives`; a nerve
 * row is its `by`. Anything else, 0.
 */
export function nerveDelta(row, handle) {
  const p = asPayload(row.payload);
  const h = String(handle);
  if (row.action === NERVE_ACTION) return row.object === h ? num(p.by) : 0;
  if (row.action === STRIKE_ACTION || row.action === SHIELD_ACTION) return row.actor === h ? -num(p.cost) : 0;
  if (row.action === STEADY_ACTION) return (row.actor === h ? -num(p.cost) : 0) + (row.object === h ? num(p.gives) : 0);
  return 0;
}

/** A resident's nerve after `rows` (any order; folded by id), clamped to 0..max at every step. */
export function foldNerve(rows, handle, { max = encounterDial("nerve_max") } = {}) {
  let n = max;
  for (const r of [...rows].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))) n = Math.max(0, Math.min(max, n + nerveDelta(r, handle)));
  return n;
}

/** Every row that can touch a resident's nerve in a window, from the store (the doors' truth, under their lock). */
export const NERVE_ROWS_SQL = `SELECT id::text AS id, actor, action, object, payload FROM acts
  WHERE class = 'creature' AND at >= $2::timestamptz AND (
    (object = $1 AND action IN ('${NERVE_ACTION}', '${STEADY_ACTION}'))
    OR (actor = $1 AND action IN ('${STRIKE_ACTION}', '${STEADY_ACTION}', '${SHIELD_ACTION}')))
  ORDER BY acts.id`;

/** A resident's nerve as the store holds it, inside a transaction. */
export async function nerveInStore(client, handle, { now = Date.now() } = {}) {
  const { rows } = await client.query(NERVE_ROWS_SQL, [String(handle), new Date(windowAt(now).start).toISOString()]);
  return foldNerve(rows, handle);
}

/** The strikes on a creature in a window, from the store, oldest first. */
export const STRIKES_SQL = `SELECT id::text AS id, actor, at, payload FROM acts
  WHERE class = 'creature' AND object = $1 AND action = '${STRIKE_ACTION}' AND at >= $2::timestamptz ORDER BY acts.id`; // the bigint, never the text alias

/** Resolve left after `strikes` (each carries its own damage): never below 0. */
export const resolveAfter = (resolveMax, strikes) =>
  Math.max(0, num(resolveMax) - strikes.reduce((s, r) => s + num(asPayload(r.payload).damage), 0));

/**
 * The strike that wore the creature down this window: the first whose running
 * damage reaches its resolve. Null while resolve is left. Derived from the
 * record alone, so it is the same answer however often it is asked.
 */
export function wornBy(resolveMax, strikes) {
  let worn = 0;
  for (const r of [...strikes].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))) {
    worn += num(asPayload(r.payload).damage);
    if (worn >= num(resolveMax)) return { actor: r.actor, actId: String(r.id) };
  }
  return null;
}

// ── the living set's half (creatures.mjs § LivingSet folds the rows here) ───

/** How long an encounter row stays in RAM: two windows and an hour (the reads ask the current one). */
export const ENCOUNTER_KEEP_MS = 25 * 3600_000;

/** A row the living set keeps for the encounter, or null. */
/** The actions of a creature that tempts (temptation.mjs), kept beside the encounter's own. */
const TEMPTING_ACTIONS = ["tempt", "tempted", "tally", "line"];
/** The actions of a fight in set pieces (set-pieces.mjs § FIGHT_ACTIONS; named here, which it imports). */
const FIGHT_ACTIONS = ["phase", "hurl", "hurled", "sanity", "unmasked", "persuade"];
export function encounterRowOf(r) {
  if (![NERVE_ACTION, STRIKE_ACTION, STEADY_ACTION, SHIELD_ACTION, ...TEMPTING_ACTIONS, ...FIGHT_ACTIONS].includes(r.action)) return null;
  return { id: String(r.id), at: msOf(r.at ?? r.written_at), actor: r.actor, action: r.action, object: r.object, payload: asPayload(r.payload) };
}

/** The rows of the window holding `now`. */
const inWindow = (rows, now) => { const w = windowAt(now); return rows.filter((r) => r.at >= w.start && r.at < w.ends); };

/** `handle`'s nerve now, from the living set's rows. */
export const nerveOf = (living, handle, now = Date.now()) => foldNerve(inWindow(living.encounter ?? [], now), handle);

/** The creature's strikes this window, from the living set. */
export const strikesOn = (living, creatureId, now = Date.now()) =>
  inWindow(living.encounter ?? [], now).filter((r) => r.action === STRIKE_ACTION && r.object === creatureId);

/** Resolve left this window (a creature with none, one that tempts, reads null). */
export const resolveOf = (living, creature, kind, now = Date.now()) => (hasResolve(kind) ? resolveAfter(kind.resolve, strikesOn(living, creature.id, now)) : null);

/**
 * The live shield on `handle`: the newest shield this window aimed at them that
 * no press has used, whose shielder's newest shield it still is (a new shield
 * replaces your old one). Null when none.
 */
export function liveShieldOn(living, handle, now = Date.now()) {
  const rows = inWindow(living.encounter ?? [], now);
  const used = new Set(rows.filter((r) => r.action === NERVE_ACTION && r.payload.shield).map((r) => String(r.payload.shield)));
  const newestBy = new Map();
  for (const r of rows) if (r.action === SHIELD_ACTION) newestBy.set(r.actor, r);
  const live = [...newestBy.values()].filter((r) => r.object === String(handle) && !used.has(r.id));
  return live.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1))[0] ?? null;
}

// ── ease ────────────────────────────────────────────────────────────────────

/** The creature's ease as its rows left it, this window: { mine: { h: { n, first_at } }, households: { key: { by, at } } }. */
export function easeState(creature, now = Date.now()) {
  const e = creature.ease;
  return e && e.window === windowAt(now).id ? e : { window: windowAt(now).id, mine: {}, households: {} };
}

/** What a condition reads of the ease for this actor: { mine, all, first_m }. */
export function easeScope(creature, kind, actor, householdKey, now = Date.now()) {
  if (!kind?.ease) return { mine: 0, all: 0, first_m: 0 };
  const s = easeState(creature, now);
  const minutes = (at) => (Number.isFinite(at) ? Math.floor((now - at) / 60_000) : 0);
  if (kind.ease.by === "households") {
    const pts = Object.values(s.households);
    const first = pts.reduce((m, p) => Math.min(m, p.at), Infinity);
    return { mine: s.households[householdKey] ? 1 : 0, all: pts.length, first_m: minutes(first) };
  }
  const mine = s.mine[actor];
  return { mine: mine?.n ?? 0, all: mine?.n ?? 0, first_m: minutes(mine?.first_at) };
}

/**
 * A reaction's ease effects applied for this actor: { ease (the state to store,
 * stamped with its window), filled (this act brought the ease to its target) }.
 * Pure. `mine`: the actor's own count, capped at the target. `households`: one
 * point per household per window, whatever `+n` says.
 */
export function applyEase(creature, kind, effects, actor, householdKey, now = Date.now()) {
  const before = easeState(creature, now);
  const out = { window: before.window, mine: { ...before.mine }, households: { ...before.households } };
  const ease = (effects ?? []).filter((e) => e?.do === "ease");
  if (!kind?.ease || !ease.length) return { ease: null, filled: false };
  const full = (s) => (kind.ease.by === "households" ? Object.keys(s.households).length : s.mine[actor]?.n ?? 0) >= kind.ease.target;
  const wasFull = full(before);
  for (const e of ease) {
    if (e.reset) {
      if (kind.ease.by === "households") out.households = {};
      else delete out.mine[actor];
    } else if (kind.ease.by === "households") {
      if (!out.households[householdKey]) out.households[householdKey] = { by: actor, at: now };
    } else {
      const had = out.mine[actor];
      out.mine[actor] = { n: Math.min(kind.ease.target, (had?.n ?? 0) + num(e.by, 1)), first_at: had?.first_at ?? now };
    }
  }
  return { ease: out, filled: !wasFull && full(out) };
}

/** Would this reaction fill the ease for this actor? (W4 extended: such a reaction finishes, so code takes it.) */
export const fillsEase = (creature, kind, reaction, actor, householdKey, now = Date.now()) =>
  applyEase(creature, kind, reaction?.effects, actor, householdKey, now).filled;

// ── the ring and the press ──────────────────────────────────────────────────

/**
 * Who stands in a finishable creature's ring now: [{ handle, distance_m,
 * household (its key), slug, human, nerve }], nearest first. `present` is
 * presence's own read at the creature's point (dynamic-presence.mjs § near:
 * { residents: [{ handle, distance_m }] }), `lookup` households.mjs §
 * householdLookup's. A resident at 0 nerve is in the ring, spent.
 */
export function ringRoster(present, { ring, lookup = null, living = null, now = Date.now(), holds = null } = {}) {
  // `holds`: the creature's own ring (creatures.mjs § ringHolds, its room's walls included); else the circle
  const rows = (present?.residents ?? []).filter((r) => r?.handle && Number.isFinite(r.distance_m) && (holds ? holds(r) : r.distance_m <= ring));
  return rows.sort((a, b) => a.distance_m - b.distance_m).map((r) => {
    let hh = null;
    try { hh = lookup?.(r.handle) ?? null; } catch { hh = null; }
    return {
      handle: r.handle, distance_m: r.distance_m,
      household: hh?.key ?? `solo:${r.handle}`, slug: hh?.slug ?? null,
      human: `human-of-${hh?.slug ?? r.handle}`, // the household's human, as the town names them (households.mjs § humanHandFor)
      nerve: living ? nerveOf(living, r.handle, now) : encounterDial("nerve_max"),
    };
  });
}

/** The words Jev reads for each menu entry. */
const PRESS_SENTENCES = Object.freeze({
  actor: (h) => `${h}, who just acted`,
  striker: (h) => `${h}, the last to strike it`,
  shielder: (h) => `${h}, who is shielding someone`,
  loudest: (h) => `${h}, the one who has done the most in its ring`,
  alone: (h) => `${h}, who has no housemate here`,
});

/**
 * THE MENU: each of `on` resolved to one resident in the ring who still has
 * nerve, or dropped. The striker and the shielder are one resident each; the
 * loudest and the one alone are ranked, and each takes the first of its rank
 * not already on the menu, so the menu offers Jev as many residents as it can.
 * Answers [{ who, handle, sentence }].
 */
export function pressMenu(on, { actor, roster, living, creatureId, now = Date.now() }) {
  const inRing = new Map(roster.filter((r) => r.nerve > 0).map((r) => [r.handle, r]));
  const rows = inWindow(living?.encounter ?? [], now);
  const newest = (list) => list.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1))[0] ?? null;
  // acts in its ring this window, per resident: what its nerve rows charged, and its own strikes
  const counted = rows.filter((r) => (r.action === NERVE_ACTION && r.payload.why === "act" && r.payload.creature === creatureId)
    || (r.action === STRIKE_ACTION && r.object === creatureId)
    || ((r.action === STEADY_ACTION || r.action === SHIELD_ACTION) && r.payload.creature === creatureId));
  const doer = (r) => (r.action === NERVE_ACTION ? r.object : r.actor);
  const tally = new Map(); // handle -> { n, last }
  for (const r of counted) { const h = doer(r); const t = tally.get(h) ?? { n: 0, last: 0n }; t.n += 1; if (BigInt(r.id) > t.last) t.last = BigInt(r.id); tally.set(h, t); }
  const one = (h) => (h ? [h] : []);
  const ranked = {
    actor: () => one(inRing.has(actor) ? actor : null),
    striker: () => one(newest(rows.filter((r) => r.action === STRIKE_ACTION && r.object === creatureId && inRing.has(r.actor)))?.actor),
    shielder: () => one(newest(rows.filter((r) => r.action === SHIELD_ACTION && inRing.has(r.actor) && liveShieldOn(living, r.object, now)?.id === r.id))?.actor),
    // the most acts in its ring this window, the newest act breaking a tie
    loudest: () => [...inRing.keys()].filter((h) => tally.has(h))
      .sort((a, b) => tally.get(b).n - tally.get(a).n || (tally.get(b).last > tally.get(a).last ? 1 : -1)),
    // no housemate in the ring; the newest to act first, then the nearest
    alone: () => {
      const homes = new Map();
      for (const r of inRing.values()) homes.set(r.household, (homes.get(r.household) ?? 0) + 1);
      return [...inRing.values()].filter((r) => homes.get(r.household) === 1)
        .sort((a, b) => Number((tally.get(b.handle)?.last ?? -1n) - (tally.get(a.handle)?.last ?? -1n)) || a.distance_m - b.distance_m)
        .map((r) => r.handle);
    },
  };
  // the loudest and the one alone rank the actor LAST when anyone else fits (eval round 1, F1: the one who just
  // acted is always the newest, so "alone" was the actor every time, and Jev never had a choice)
  const actorLast = (list) => (list.length > 1 ? [...list.filter((h) => h !== actor), ...list.filter((h) => h === actor)] : list);
  for (const k of ["loudest", "alone"]) { const f = ranked[k]; ranked[k] = () => actorLast(f()); }
  const out = [];
  for (const who of on ?? []) {
    const h = (ranked[who]?.() ?? []).find((x) => !out.some((e) => e.handle === x));
    if (h) out.push({ who, handle: h, sentence: PRESS_SENTENCES[who](h) });
  }
  return out;
}

/**
 * WHERE A PRESS LANDS: `n` aimed at `target`. A live shield on the target moves
 * the whole press onto its shielder (and is used up); then the payer's
 * housemates in the ring split it (D2), the payer paying the larger half.
 * Answers [{ on, by (negative), shield?, split_of? }], no zero shares.
 */
export function pressLanding(target, n, { roster, living, now = Date.now() }) {
  const inRing = new Map(roster.filter((r) => r.nerve > 0).map((r) => [r.handle, r]));
  const shield = liveShieldOn(living, target, now);
  const payer = shield && inRing.has(shield.actor) ? shield.actor : target;
  const viaShield = payer !== target ? shield.id : null;
  const home = inRing.get(payer)?.household ?? null;
  const mates = home ? [...inRing.values()].filter((r) => r.household === home && r.handle !== payer) : [];
  const k = 1 + mates.length;
  const base = Math.floor(n / k), rest = n % k;
  const shares = [{ on: payer, n: base + (rest > 0 ? 1 : 0) }, ...mates.map((m, i) => ({ on: m.handle, n: base + (i + 1 < rest ? 1 : 0) }))];
  return shares.filter((s) => s.n > 0).map((s) => ({
    on: s.on, by: -s.n,
    ...(viaShield && s.on === payer ? { shield: viaShield, shielded: target } : {}),
    ...(k > 1 ? { split_of: n } : {}),
  }));
}

// ── flee at 0 ───────────────────────────────────────────────────────────────

const fleeing = new Map(); // handle -> the flee in flight
/**
 * A resident at 0 nerve flees through the exit lock: the office makes their
 * confirmed exit of the dungeon they stand in, keyed to them and their
 * household as the arrival tick's enter is (arrival-entries.mjs §
 * enterAtArrival). Outside a dungeon nothing is written (D5: spent, not fled).
 * One flight per resident at a time; a fault is logged and the tick tries again.
 */
export function queueFlee(handle, { household = null, exit = null } = {}) {
  if (fleeing.has(handle)) return fleeing.get(handle);
  const run = (async () => {
    try {
      const go = exit ?? (async (h, hh) => {
        const [{ exitViaOffice }, { crossingDeps }, { WORLD_CLONE }] = await Promise.all([
          import("./world-crossings.mjs"), import("./world-apex.mjs"), import("./world.mjs")]);
        return exitViaOffice(WORLD_CLONE, { handle: h, confirm: true }, { handles: new Set([h]), household: hh }, { ...crossingDeps(), flee: true });
      });
      return await go(handle, household);
    } catch (e) {
      faultLogged(`a resident at 0 nerve could not be set outside (${handle}); the tick tries again`, e);
      return null;
    } finally { fleeing.delete(handle); }
  })();
  fleeing.set(handle, run);
  return run;
}

// ── what a resident reads ───────────────────────────────────────────────────

/**
 * `you.nerve` in the glance: { left, of, fills_at, note }, shown whenever it is
 * below full or you stand in a finishable creature's ring (the tools teach the
 * residents: the number, when it fills, and one plain line on what it is). Null
 * otherwise, so the glance stays lean when no encounter is near.
 */
export function nerveRead({ living, law }, handle, at, now = Date.now(), { holds = null } = {}) {
  if (!living || !law?.kindOf || !handle) return null;
  const left = nerveOf(living, handle, now);
  const max = encounterDial("nerve_max");
  // `holds(c, at)`: the creature's ring (creatures.mjs § ringHolds); else the circle
  const inRing = holds ?? ((c, p) => Math.hypot(p.x - c.x, p.y - c.y) <= Number(law.kindOf(c.kind)?.ring_m));
  const near = at && Number.isFinite(at.x) && Number.isFinite(at.y) && living.living(now).some((c) => isFinishable(law.kindOf(c.kind)) && inRing(c, at));
  if (left >= max && !near) return null;
  return { left, of: max, fills_at: new Date(windowAt(now).ends).toISOString(), note: NERVE_NOTE };
}

/** The words for both roads (F9): force (strike, its cost and what it takes) and its own test (the ease). */
export function roadsOf(kind, { nerve = null } = {}) {
  const act = encounterDial("act_cost"), cost = encounterDial("strike_cost");
  const force = hasResolve(kind) ? `strike it from inside its ring: ${cost} nerve a strike, and each takes ${kind.strike} of its ${kind.resolve} resolve`
    : isTempter(kind) ? `strike it from inside its ring: ${cost} nerve a strike, and each is damage` : null;
  const peace = kind.ease ? (kind.ease.by === "households"
      ? `its own test, which ${kind.ease.target} households fill together, one point each`
      : `its own test, which you fill yourself: ${kind.ease.target} points${kind.ease.only ? `, only by ${kind.ease.only}; any other act of yours near it empties them` : ""}`)
    : isTempter(kind) ? "answer what it asks of you plainly, and refuse it" : "its own test, as it answers you";
  return { ...(force ? { force } : {}), peace,
    nerve: `every act you make inside its ring costs ${act} nerve${force ? `, a strike ${cost}` : ""}${nerve != null ? `; you have ${nerve}` : ""}. At 0 you flee until the settlement` };
}

/**
 * WHAT A FINISH PAYS (F8): once it has been finished, { first, at, carries?, note }.
 * The first to finish it by record order (the lowest act id) is who what it carries
 * goes to, at the next settlement, and everyone it answered is named there.
 */
export function endingSaid(creature, now = Date.now()) {
  const fs = (creature?.finishes ?? []).filter((f) => /^\d+$/.test(String(f.act)));
  if (!fs.length || creature.gone) return null;
  const first = fs.sort((a, b) => (BigInt(a.act) < BigInt(b.act) ? -1 : 1))[0];
  const at = new Date(windowAt(now).ends).toISOString();
  const what = creature.carries ? `what it carries (${creature.carries})` : "its ending";
  return { first: first.by, at, ...(creature.carries ? { carries: creature.carries } : {}),
    note: `At the settlement (${at.slice(11, 16)}Z), ${what} goes to ${first.by}, the first to finish it, and everyone it answered is named.` };
}

/**
 * WHAT YOU ARE OWED AT THE SETTLEMENT (F8): each creature you finished first, still
 * waiting for its settlement. [{ creature, at, carries?, note }] or [].
 */
export function pendingFor(living, handle, now = Date.now()) {
  const out = [];
  for (const c of living?.living?.(now) ?? []) {
    const e = endingSaid(c, now);
    if (e?.first === handle) out.push({ creature: c.id, at: e.at, ...(e.carries ? { carries: e.carries } : {}), note: e.note });
  }
  return out;
}

/**
 * A finishable creature's encounter, as investigate shows it (D3: the numbers,
 * so the puzzle is legible): its resolve this window and when it fills, its
 * ease (yours, or the households'), and whom it has been finished by is the
 * ending's to say. Null for a kind that is not finishable.
 */
export function encounterRead({ living }, creature, kind, { handle = null, household = null, now = Date.now() } = {}) {
  if (!isFinishable(kind)) return null;
  const w = windowAt(now);
  const ease = kind.ease ? easeScope(creature, kind, handle, household, now) : null;
  const ending = endingSaid(creature, now);
  return {
    // BOTH ROADS AND WHAT EACH COSTS (eval round 1, F9: force was invisible from the door)
    roads: roadsOf(kind, { nerve: handle ? nerveOf(living, handle, now) : null }),
    // A FINISH PAYS OUT AT THE SETTLEMENT (F8): who it goes to, and when
    ...(ending ? { ending } : {}),
    ...(hasResolve(kind) ? { resolve: { left: resolveOf(living, creature, kind, now), of: kind.resolve, a_strike_takes: kind.strike, fills_at: new Date(w.ends).toISOString() } } : {}),
    ...(ease ? { ease: kind.ease.by === "households"
      ? { households: ease.all, of: kind.ease.target, note: "one point per household this window" }
      : { yours: ease.mine, of: kind.ease.target, note: "each resident fills their own this window" } } : {}),
    note: "It can be finished by either road. Both cost nerve, and both reset at the settlement; a finish already made stays.",
  };
}
