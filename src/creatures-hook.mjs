// creatures-hook.mjs — the creatures in the writer process (POS-637 PR-B, part 3 of 4).
//
// RULED (Darko, Sitting E 2026-10-14; C1–C6 2026-10-15 12:09 EDT, as
// recommended). The core (creatures.mjs) judges one act for every creature
// whose ring holds it. This file is what puts it to work:
//
//   · THE PROCESS'S CREATURES. One LivingSet, folded from `acts` every
//     REFRESH_MS beside the arrival tick, under the world's law at the blessed
//     ref (creatureLaw). A new blessing builds a new set under the new law.
//     While no creature is living, act-watch.mjs is told so, and every act door
//     is its plain self.
//   · THE ACT DOORS (W1). act-watch.mjs § perceived hands this file the rows an
//     act wrote. The trigger is the last row whose action the world's law
//     perceives (RING_VERBS), so a walk that exits first is one walk, and a
//     stake that releases a draft's leave-mark is that leave-mark. Where the
//     actor stood is the row's own witnessed point, else (an enter or exit,
//     which carries none) the actor's standpoint. The act's instant is its
//     row's own `at` (carry 2): a row read back without one is no trigger.
//   · THE ANSWER WAITS AT MOST ANSWER_WAIT_MS (W2). The creatures' turns run
//     outside the door's retry key and outside the watched act (carry 3), so
//     their rows are never taken for the act's. A turn still running at the
//     deadline finishes on its own: its row lands and stands in
//     happening_here; the answer goes out without it.
//   · THE ARRIVAL (C1, RULED: "the walk is seen both when it's declared and
//     when it lands"). The same tick reads every walk act by a cursor, works
//     out where and when it lands (the engine's own positionAt), and at that
//     instant judges it for any creature whose ring holds the landing point.
//     A later walk by the same walker replaces it, as a later departure
//     replaces an arrival's entry (Darko's G4 on WLD-5). The reaction's row
//     names the walk act and the moment, so a creature answers a walk at most
//     once when it is declared and once when it lands.
//   · THE PATH-CROSSING TRIGGER (POS-637 call 6, RULED 2026-10-16 18:06: "a
//     creature notices you the moment your walk's path enters its ring";
//     POS-672 W7, settled by Wright). The same tick asks, for every walk still
//     on its way or landing now, the one line-against-circle question per
//     living creature: where does the path first cross into its ring? A walk
//     that set out inside the ring has no entry (its declaration was the
//     moment). At that instant it is judged for that creature alone, as
//     moment `entry`: its own key beside the act and the arrival, so a walk
//     that crosses a ring and lands in it is seen at both, and the 10 s window
//     (C2) still makes two moments inside 10 s one reaction. A creature that came
//     out after the crossing, or a crossing past ARRIVAL_STALE_MS, is let go.
//   · THE CREATURE'S OWN WORLD READ (W9, Darko 21:32). `aroundCreature` asks
//     the resident read's own doors at the creature's point, as a spectator
//     (nobody's body, nobody's note): presence and who acted (who), the field
//     of view with its bodies (view), the shared ear that marks nobody present
//     (heard, office#564), the air, the hour, and what the actor last did.
//     One reader for residents and creatures.
//   · A CREATURE'S VIEW IS KEPT, NOT RE-SEEN ON THE ACT (play row 51,
//     2026-10-15). The field of view is the expensive part of that read: the
//     engine's line of sight over the whole world, about 270 ms of synchronous
//     work per standpoint, plus ~110 ms of a blocking `git` in markRecords,
//     measured in the playground. A creature does not move (WLD-56 D3), and
//     what it can see changes only with the published world or the crossing, so
//     the tick sees for each living creature once per (published sha,
//     crossing), off the act's path, and the act reads what it saw. Three
//     creatures seeing on the act's path held the thread 1.2–1.7 s, so the
//     1 s answer had no time left for Jev and code judged every reaction.
//
// TWO OFFICES AT ONCE (a deploy's overlap): both fold the same rows and both
// may judge one arrival. creatures.mjs § writeReaction locks on (creature,
// trigger, moment) inside its transaction, so the second finds the first's row.

import {
  ANSWER_WAIT_MS, ARRIVAL, ENTRY, LivingSet, REFRESH_MS, creatureLaw, distanceM, heardWords, publishedMarks, reactTo,
} from "./creatures.mjs";
import { setCreaturesAwake } from "./act-watch.mjs";
import { outsideRetryKey } from "./act-nonce.mjs";
import { actsQuery, world2Enabled } from "./world2-acts.mjs";
import { faultLogged } from "./fault-words.mjs";
import { CLASS_MOVE, composeAnchor } from "./world-journal.mjs";
import { CROSSING_EPOCH_UTC, CROSSING_MS, currentCrossing } from "./crossings.mjs";
import { importEngineAt, publishedState } from "./world-branches.mjs";
import { WORLD_CLONE } from "./world-store.mjs";
import { departureRecordOf } from "../world2/tools/live-reads.mjs";
import { PUBLIC_ACTS, activeOf, ago, hourZ, viewBlock, whoBlock } from "./world-read-v2.mjs";

const state = { ref: null, living: null, running: false, last: null, testDeps: null };
const lawReady = (law) => !!law && !law.unavailable && !!law.kindMod;

/** This process's creatures and their law, or null while the law cannot be read. Tests set it. */
export const creaturesNow = () => (state.living ? { living: state.living, law: state.living.law } : null);
export function __setCreaturesForTest(living, deps = null) {
  state.living = living;
  state.testDeps = deps; // what an act door's hook is handed in place of the office's own reads, judge and pen
  state.ref = living?.law?.ref ?? null;
  setCreaturesAwake(!!living?.living().length);
}

/** The world's law at the blessed ref, and the set folded under it. A new ref folds afresh. */
export async function refreshCreatures({ query = actsQuery, law: given = null, now = Date.now() } = {}) {
  const law = given ?? await creatureLaw();
  if (!lawReady(law)) {
    state.living = null;
    state.ref = null;
    setCreaturesAwake(false);
    return { ok: false, why: law?.unavailable ?? "the creature law is not read here" };
  }
  if (law.ref !== state.ref || !state.living) {
    state.ref = law.ref;
    state.living = new LivingSet({ law, hideUnwarmed: true }); // WLD-74: a creature whose room is not yet known is seen by no one
  }
  const r = await state.living.refresh({ query, now });
  // each creature's room, so its ring stops at the walls (world#268): once per creature per published sha
  if (r.ok && typeof law.ringRoomOf === "function" && query === actsQuery) {
    const pub = await publishedMarks();
    if (pub) state.living.warmRooms(pub.marks, pub.key);
  }
  setCreaturesAwake(state.living.living(now).length > 0);
  return r;
}

// ── the act doors ───────────────────────────────────────────────────────────

const ACT_ROW_SQL = `SELECT id::text AS id, at, actor, action, at_anchor, at_dx, at_dy, payload FROM acts WHERE id = $1::bigint`;
const asPayload = (p) => (typeof p === "string" ? (() => { try { return JSON.parse(p); } catch { return {}; } })() : (p ?? {}));
const isoOf = (t) => { const ms = t instanceof Date ? t.getTime() : Date.parse(t ?? ""); return Number.isFinite(ms) ? new Date(ms).toISOString() : null; };
const pointOf = (p) => (Number.isFinite(Number(p?.x)) && Number.isFinite(Number(p?.y)) ? { x: Number(p.x), y: Number(p.y) } : null);

// The marks' centres, for composing a row's witnessed point: read again at most
// every REFRESH_MS, so an act door pays a Map lookup, never a pass over the marks.
const centres = { at: 0, fn: null };
async function centreOfNow() {
  if (!centres.fn || Date.now() - centres.at >= REFRESH_MS) {
    centres.fn = await (await import("./world.mjs")).markCentreOf();
    centres.at = Date.now();
  }
  return centres.fn;
}

/**
 * The act a row records, as the core takes it: { actor, verb, actId, atIso,
 * point, from?, toward? }, or null when the record cannot say where or when,
 * or when `near(point)` says no creature could perceive it there.
 *
 * Where: the row's own witnessed point; a row with none (an enter or exit) is
 * placed where its actor stands. When: the row's own `at` (carry 2). A row the
 * act door only knows the id of (the crossing pass writes in a child process)
 * is read back for it, and only once `near` has said yes, so an enter far
 * from every creature costs no read.
 */
export async function actOfRow(row, { query = actsQuery, centreOf = null, standpointOf = null, near = () => true } = {}) {
  let r = row;
  const p0 = asPayload(r.payload);
  let point = composeAnchor({ anchor: r.at_anchor, dx: r.at_dx, dy: r.at_dy }, centreOf ?? await centreOfNow());
  if (!point) {
    standpointOf ??= async (h) => (await import("./world.mjs")).residentStandpoint(h);
    const here = await standpointOf(r.actor).catch(() => null);
    point = here?.placed === false ? null : pointOf(here);
  }
  if (!point || !near(point)) return null;
  if (r.written_at == null && r.at == null) {
    const [back] = (await query(ACT_ROW_SQL, [String(r.id)])) ?? [];
    if (!back) return null;
    r = { ...back, written_at: back.at };
  }
  const atIso = isoOf(r.written_at ?? r.at);
  if (!atIso) return null; // carry 2: no instant, no d20, no trigger
  const p = r === row ? p0 : asPayload(r.payload);
  const act = { actor: r.actor, verb: r.action, actId: String(r.id), atIso, point };
  if (r.action === "walk") {
    const from = pointOf(p.from), toward = pointOf(p.toward);
    if (from) act.from = from;
    if (toward) act.toward = toward;
  }
  return act;
}

/**
 * What act-watch.mjs § perceived calls once an act implementation has
 * answered: the creatures' answers ride the act's own answer as `creatures`
 * (C4), or the answer goes out as it was. Never throws.
 */
export async function creaturesAnswer(rows, result, deps = state.testDeps ?? {}) {
  // `deps.except` (POS-672): a creature already answering this act as the one it
  // was aimed at (an approach's walk), so the others answer it and it does not twice
  const now = creaturesNow();
  if (!now || result == null || typeof result !== "object" || Array.isArray(result) || result.error) return result;
  // THE BOUND STARTS HERE (review-571 B1): the actor's standpoint, the marks'
  // centres and the crossing row's read-back are inside ANSWER_WAIT_MS with the
  // turns, so nothing the hook reads can hold the act's answer past it. What
  // the turns finished by then rides; a turn still running finishes on its own.
  const clock = deps.clock ?? Date.now;
  const deadline = clock() + ANSWER_WAIT_MS;
  const partial = [];
  const work = (async () => {
    try {
      const ring = now.law.kindMod.RING_VERBS;
      // a visitor's act is never a creature's to answer (POS-739: no fights for visitors, so no ring holds one)
      const trigger = [...rows].reverse().find((r) => ring.includes(r.action) && !String(r.actor ?? "").startsWith("berth-"));
      if (!trigger) return [];
      // near: a ring holds the point, or a creature already answered this act (a retry, F6)
      const act = await actOfRow(trigger, { ...deps,
        near: (pt) => now.living.inRing(pt).length > 0 || now.living.answered.has(String(trigger.id)) });
      if (!act) return [];
      return await answerWithin(act, { ...now, ...deps, clock, deadline, partial });
    } catch (e) {
      faultLogged("the creatures could not answer an act; it answered without them", e);
      return [];
    }
  })();
  const answers = await byDeadline(work, deadline, clock, partial);
  if (answers.length) result.creatures = answers;
  return result;
}

/** `work`'s answers if it settles by `deadline`; else the turns that had finished (nearest first). A held timer. */
async function byDeadline(work, deadline, clock, partial) {
  let timer;
  const late = new Promise((r) => { timer = setTimeout(() => r(null), Math.max(0, deadline - clock())); });
  const got = await Promise.race([work, late]).finally(() => clearTimeout(timer));
  return got ?? partial.filter(Boolean);
}

/**
 * The creatures' turns for one act, outside the door's key (act-watch.mjs runs
 * this after the watched act), bounded by `deadline` (default ANSWER_WAIT_MS
 * from now). A turn late at the deadline drops only its own line (review-571
 * note 3): the turns that finished ride, nearest first. The deadline's timer
 * is held, never unref'd: on node 22 an unref'd one let a test's event loop
 * end under a hung turn (CI 38770755044).
 */
export function answerWithin(act, { living, law, around = aroundCreature, heardFor = creatureHeard, ask, write, env, only = null, except = null, aimed = null, jevMs = null,
  present = null, households = null, flee = null, writeCost = null, clock = Date.now, deadline = null, partial = [] } = {}) {
  const until = deadline ?? clock() + ANSWER_WAIT_MS;
  // `present`, `households`, `flee`, `writeCost`: an encounter's seams (creatures.mjs § encounterOf), the office's own when absent
  const turns = outsideRetryKey(() =>
    reactTo(act, { living, law, around, heardFor, ...(ask ? { ask } : {}), ...(write ? { write } : {}), ...(env ? { env } : {}), ...(only != null ? { only } : {}),
      ...(except != null ? { except } : {}), ...(aimed ? { aimed } : {}), ...(jevMs != null ? { jevMs } : {}),
      ...(present ? { present } : {}), ...(households ? { households } : {}), ...(flee ? { flee } : {}), ...(writeCost ? { writeCost } : {}),
      clock, deadline: until, partial }));
  return byDeadline(turns, until, clock, partial);
}

// ── what a creature could repeat (POS-672 D5) ───────────────────────────────

/** How far back a creature's ear reaches for words to repeat (how many: creatures.mjs § HEARD_WORDS_MAX). */
export const HEARD_WINDOW_MS = 30 * 60_000;

/**
 * The words a creature could repeat (D5, ruled 2026-10-20 22:37): the last few
 * words of the newest public say (a call's words are one) heard at its point in
 * the last HEARD_WINDOW_MS, through the shared ear that marks nobody present.
 * A whisper is never in the ear, so it is never repeated. Null when nothing was.
 */
export async function creatureHeard(creature, act, { heardAt = null, nowMs = Date.now() } = {}) {
  const hear = heardAt ?? (await import("./world.mjs")).heardAt;
  const rows = await hear({ x: creature.x, y: creature.y }, { cap: 3 });
  const fresh = (rows ?? []).filter((h) => Number.isFinite(h.at_ms) ? nowMs - h.at_ms <= HEARD_WINDOW_MS : true);
  const newest = fresh.at(-1);
  return newest ? heardWords(newest.said) : null;
}

// ── the creature's own world read (W9) ──────────────────────────────────────

const ACTOR_LAST_SQL = `SELECT action, at FROM acts
  WHERE actor = $1 AND action = ANY($2::text[]) AND id <> $3::bigint ORDER BY id DESC LIMIT 3`;

/**
 * The world read at the creature's point, in the blocks creatures.mjs §
 * buildSlice projects: { who, view, bodies, heard, air, hour, actor_last }.
 * Each part that cannot be read is left out; the slice is then smaller, never
 * wrong. `reads` are the seams a test drives.
 */
export async function aroundCreature(creature, act, reads = {}) {
  const at = { x: creature.x, y: creature.y };
  const nowMs = reads.nowMs ?? Date.now();
  const w = reads.world ?? await import("./world.mjs");
  const query = reads.query ?? actsQuery;
  const part = (p) => Promise.resolve().then(p).catch(() => null);
  // KEPT vs FRESH (row 51). KEPT: only the view the tick saw for this
  // creature: the published marks in its sight, their names and bodies,
  // through the terrain and the Mists of this crossing. It is the spectator's
  // field of view (no residents in it), and nothing in it can change within
  // (published sha, crossing). FRESH on every act: everything about residents,
  // namely who is near and what each last did (presence + activeOf), what was
  // heard (the shared ear), the actor's own last acts, and the air. A creature
  // with no kept view yet (out since the last tick) goes without its marks,
  // never a line of sight on the act's path.
  const seen = (reads.views ?? views).get(creature.id) ?? null;
  const [oriented, heardRows, lastRows] = await Promise.all([
    part(() => w.worldOrient({ x: at.x, y: at.y }, null, { crowd: true })),
    // the shared ear (office#564): touching nobody, newest last, the actor's own words left out
    part(() => w.heardAt(at, { cap: 3, exclude: act.actor })),
    part(() => query(ACTOR_LAST_SQL, [act.actor, Object.keys(PUBLIC_ACTS), String(act.actId)])),
  ]);
  const out = { hour: hourZ(new Date(nowMs).toISOString()) };
  const crowd = oriented?.present?.residents ?? [];
  if (oriented && !oriented.error) {
    const { active } = await activeOf(crowd.map((r) => r.handle), { query });
    out.who = whoBlock(crowd, active, { nowMs });
    const air = await part(() => w.worldAir(oriented));
    if (air) out.air = air;
  }
  // never seen (or every try failed): no view, so the slice leaves its marks out rather than saying "none" (review-588 F2)
  if (seen?.view !== undefined) { out.view = seen.view; out.bodies = seen.bodies; }
  if (Array.isArray(heardRows)) out.heard = heardRows.slice(-3).map((h) => ({ who: h.handle, said: h.said, ...(h.ago ? { ago: h.ago } : {}) }));
  if (Array.isArray(lastRows))
    out.actor_last = lastRows.map((r) => `${PUBLIC_ACTS[r.action] ?? r.action}, ${ago(r.at instanceof Date ? r.at.getTime() : Date.parse(r.at), nowMs)}`);
  return out;
}

// ── a creature's view, seen by the tick (play row 51) ────────────────────────

/** creature id → { key, view, bodies }: what the tick saw from where it stands. */
export const views = new Map();
export function __resetViewsForTest() { views.clear(); }
/** At most this many creatures see per tick: one line of sight holds the thread ~0.3–0.5 s (measured), so a tick holds it for one. */
export const VIEWS_PER_TICK = 1;
/** A sighting that failed is tried again after this, or at the next key, whichever is first (review-588 F1). */
export const VIEW_RETRY_MS = 5 * 60_000;

/** What a creature's view depends on besides where it stands: the published world and the crossing. */
export function viewKeyNow({ repo = WORLD_CLONE, now = Date.now() } = {}) {
  let sha = "?";
  try { sha = publishedState(repo).sha ?? "?"; } catch { /* an unreadable ref keys as "?" and is seen again once it reads */ }
  return `${sha}:${currentCrossing(now)}`;
}

/** One creature's view, in the blocks buildSlice reads: { view, bodies }, or null when the eyes could not see. */
export async function seeFrom(creature, { world = null } = {}) {
  const w = world ?? await import("./world.mjs");
  // no porch lights (WLD-29): a creature reads no `lit`, so it never waits on the activity batch
  const seen = await w.worldEyes({ x: creature.x, y: creature.y }, null, { v2: true, lights: false });
  // and the orient the act will ask, once, so its first call after a boot (about 1 s cold, measured) is not on an act
  await Promise.resolve(w.worldOrient?.({ x: creature.x, y: creature.y }, null, { crowd: true })).catch(() => null);
  const rows = seen?._fov?.rows;
  if (!Array.isArray(rows)) return null;
  // a view seen as empty (the Mists' wall, open country) is a view: the slice says no marks, which is true
  return { view: viewBlock(rows), bodies: Object.fromEntries(rows.filter((r) => r.body).map((r) => [r.id, r.body])) };
}

/**
 * The tick's part: each living creature whose view is missing or was seen
 * for another (sha, crossing) sees again, at most VIEWS_PER_TICK a tick,
 * newest-spawned first (a creature just out has none). The ended leave the
 * map. Answers how many saw.
 */
export async function warmViews(living, { key = viewKeyNow(), see = seeFrom, now = Date.now(), most = VIEWS_PER_TICK } = {}) {
  const alive = living.living(now);
  const ids = new Set(alive.map((c) => c.id));
  for (const id of views.keys()) if (!ids.has(id)) views.delete(id);
  // due: never seen, seen for another key, or a failed try past its retry time.
  // A FAILED TRY IS RECORDED (review-588 F1): it answers its key until the
  // retry, so a creature whose eyes keep failing never holds the head of the
  // queue and every other creature is still seen. Its last good view, if any,
  // still answers the act meanwhile.
  const isDue = (e) => !e || e.key !== key || (e.failed && now - e.tried_at >= VIEW_RETRY_MS);
  const due = alive.filter((c) => isDue(views.get(c.id)))
    .sort((a, b) => (views.has(a.id) ? 1 : 0) - (views.has(b.id) ? 1 : 0) || b.spawned_at - a.spawned_at)
    .slice(0, most);
  let saw = 0;
  for (const c of due) {
    const had = views.get(c.id);
    let v = null;
    try { v = await see(c); }
    catch (e) { if (!(had?.failed && had.key === key)) faultLogged(`a creature's view could not be seen (${c.id})`, e); }
    if (v) { views.set(c.id, { key, ...v }); saw += 1; }
    else {
      if (v === null && !(had?.failed && had.key === key)) console.error(`[creatures] ${c.id}: its eyes answered no view at ${key}; tried again in ${VIEW_RETRY_MS / 60_000} min`);
      views.set(c.id, { ...(had?.view !== undefined ? { view: had.view, bodies: had.bodies } : {}), key, failed: true, tried_at: now });
    }
    await new Promise((r) => setImmediate(r)); // let the acts waiting on the thread through between two
  }
  return saw;
}

// ── the arrival (C1) ────────────────────────────────────────────────────────

export const WALKS_SQL = `SELECT id::text AS id, at, crossing, actor, action, payload FROM acts
  WHERE class = '${CLASS_MOVE}' AND id > $1::bigint ORDER BY acts.id LIMIT $2`;
// The first read of a process: the walks of the last two windows, by the crossing index.
export const WALKS_BOOT_SQL = `SELECT id::text AS id, at, crossing, actor, action, payload FROM acts
  WHERE crossing >= $1 AND class = '${CLASS_MOVE}' ORDER BY acts.id`;
const WALKS_BATCH = 2000;
/** An arrival this long past when a tick first could judge it (a restart's catch-up) is let go. */
export const ARRIVAL_STALE_MS = 3600_000;

/** Every walker's newest walk, until it lands: actor → { walk, actor, from, at (landing point), startMs, dueMs, seen }.
 *  `seen` holds the creatures whose ring this walk has entered or can never enter (call 6). */
export const arrivals = { byActor: new Map(), cursor: "0", booted: false };
export function __resetArrivalsForTest() { Object.assign(arrivals, { byActor: new Map(), cursor: "0", booted: false }); }

/**
 * Where and when a walk act lands, by the engine's own positionAt: the
 * landing point, and the instant the remaining metres run out at its pace.
 * Null for a walk that cannot be read back, or a zero-length one (a stop: it
 * stands where it was declared, and the declaration was the moment).
 */
export function landingOf(row, walkMod) {
  const p = asPayload(row.payload);
  const rec = departureRecordOf({ ...row, payload: p })?.record ?? null;
  if (!rec || !pointOf(rec.from) || !pointOf(rec.toward) || !Number.isFinite(Number(rec.at))) return null;
  const at0 = walkMod.positionAt(rec, Number(rec.at));
  if (!at0 || !(at0.legM > 0)) return null;
  const paceM = rec.pace > 0 ? rec.pace * 1000 : walkMod.WALK_M_PER_CROSSING;
  const landed = walkMod.positionAt(rec, Number(rec.at) + 1e6);
  const startMs = Math.round(CROSSING_EPOCH_UTC + Number(rec.at) * CROSSING_MS);
  const dueMs = Math.round(CROSSING_EPOCH_UTC + (Number(rec.at) + at0.remainingM / paceM) * CROSSING_MS);
  return { from: pointOf(rec.from), at: pointOf(landed), startMs, dueMs };
}

/** Fold walk rows: each walker's newest walk replaces any earlier one still on its way. */
export function foldWalks(rows, walkMod) {
  for (const r of rows) {
    if (BigInt(r.id) <= BigInt(arrivals.cursor)) continue;
    arrivals.cursor = String(r.id);
    // a landing replaces the walk before it, as a stop does: you were placed
    // (WLD-63 row 68 B), so no arrival of that walk is still to come
    if (r.action === "land") { arrivals.byActor.delete(r.actor); continue; }
    if (r.action !== "walk") continue;
    const land = landingOf(r, walkMod);
    if (!land) { arrivals.byActor.delete(r.actor); continue; } // a stop replaces the walk before it too
    arrivals.byActor.set(r.actor, { walk: String(r.id), actor: r.actor, ...land, seen: new Set() });
  }
}

/**
 * One arrival tick: read the new walks, then judge each walk that has landed
 * for the creatures whose ring holds its landing point, at the landing instant.
 * The walker is not waiting on this answer, so the line reaches them through
 * the reaction's row (happening_here, and their own happened).
 */
export async function arrivalTick({ query = actsQuery, now = Date.now(), walkMod = null, judge = answerWithin } = {}) {
  walkMod ??= await importEngineAt((await import("./world.mjs")).WORLD_CLONE, "walk.mjs");
  if (!arrivals.booted) {
    const rows = await query(WALKS_BOOT_SQL, [Math.floor(currentCrossing(now)) - 1]);
    if (rows == null) return { ok: false, why: "the store is not switched on here" };
    foldWalks(rows, walkMod);
    if (!rows.length) {
      const [top] = (await query(`SELECT max(id)::text AS id FROM acts WHERE class = '${CLASS_MOVE}'`, [])) ?? [];
      if (top?.id != null && BigInt(top.id) > BigInt(arrivals.cursor)) arrivals.cursor = String(top.id);
    }
    arrivals.booted = true;
  } else {
    for (;;) {
      const rows = await query(WALKS_SQL, [arrivals.cursor, WALKS_BATCH]);
      if (rows == null) return { ok: false, why: "the store is not switched on here" };
      foldWalks(rows, walkMod);
      if (rows.length < WALKS_BATCH) break;
    }
  }
  const out = { landed: 0, judged: 0, answered: 0, entered: 0 };
  const cur = creaturesNow();
  // call 6 first: a path crosses into a ring before it lands
  if (cur) for (const a of arrivals.byActor.values()) {
    for (const c of cur.living.living(now)) {
      if (a.seen.has(c.id)) continue;
      const e = entryOf(a, c, Number(cur.law.kindOf(c.kind)?.ring_m));
      if (e === null) { a.seen.add(c.id); continue; } // this path never crosses into its ring: a creature does not move
      if (e.ms > now) continue; // not there yet
      a.seen.add(c.id);
      if (now - e.ms > ARRIVAL_STALE_MS || c.spawned_at > e.ms) continue;
      out.entered += 1;
      const answers = await judge({ actor: a.actor, verb: "walk", actId: a.walk, atIso: new Date(e.ms).toISOString(),
        point: e.point, from: a.from, toward: a.at, approaching: true, moment: ENTRY }, { ...cur, only: c.id });
      out.answered += answers.length;
    }
  }
  for (const [actor, a] of arrivals.byActor) {
    if (a.dueMs > now) continue;
    arrivals.byActor.delete(actor);
    out.landed += 1;
    if (!cur || now - a.dueMs > ARRIVAL_STALE_MS) continue;
    if (!cur.living.inRing(a.at, { now, bornBy: a.dueMs }).length) continue;
    out.judged += 1;
    const answers = await judge({ actor, verb: "walk", actId: a.walk, atIso: new Date(a.dueMs).toISOString(),
      point: a.at, from: a.from, toward: a.at, moment: ARRIVAL }, cur);
    out.answered += answers.length;
  }
  return { ok: true, ...out };
}

/** An entry is judged this far inside the ring's edge, so the ring holds its point however the metres round. */
export const ENTRY_INSIDE_M = 0.01;

/**
 * Call 6's one line-against-circle test: where and when a walk's straight path
 * from `from` to its landing `at` (at its own pace, from startMs to dueMs)
 * first crosses into a circle of `ring` metres round the creature. Null when it
 * never does, or when it set out inside the ring (its declaration was the moment).
 */
export function entryOf(a, creature, ring) {
  if (!(ring > ENTRY_INSIDE_M) || !a?.from || !a?.at) return null;
  if (distanceM(a.from, creature) <= ring) return null;
  const r = ring - ENTRY_INSIDE_M;
  const dx = a.at.x - a.from.x, dy = a.at.y - a.from.y;
  const fx = a.from.x - creature.x, fy = a.from.y - creature.y;
  const A = dx * dx + dy * dy;
  if (A === 0) return null;
  const B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const t = (-B - Math.sqrt(disc)) / (2 * A); // the nearer root: where the path goes in
  if (!(t >= 0 && t <= 1)) return null;
  return { ms: Math.round(a.startMs + t * (a.dueMs - a.startMs)), point: { x: a.from.x + t * dx, y: a.from.y + t * dy } };
}

// ── the tick ────────────────────────────────────────────────────────────────

let timer = null;

/**
 * Start the creatures in the writer process: never a read worker, never a
 * suite's office (port 0), and only beside a store. One run now, then every
 * REFRESH_MS, serial. CREATURE_JUDGE=off still folds (so the switch back is
 * instant) but nothing reacts (creatures.mjs § judgeMode).
 */
export function startCreatures({ port, env = process.env, log = console } = {}) {
  if (timer) return false;
  if (!world2Enabled(env) || Number(port) === 0) return false;
  const run = async () => {
    if (state.running) return;
    state.running = true;
    try {
      const r = await refreshCreatures();
      const a = r.ok ? await arrivalTick() : null;
      if (r.ok && state.living) await warmViews(state.living);
      // presence at each finishable creature's point, and the household lookup, kept for the acts (eval round 1, F1–F3)
      if (r.ok && state.living) await (await import("./creatures.mjs")).warmRosters(state.living).catch((e) => faultLogged("the encounter's rings could not be read", e));
      // an encounter's repair (encounter-verbs.mjs § encounterTick): a missed finish, a missed flee
      if (r.ok && state.living) await (await import("./encounter-verbs.mjs")).encounterTick({ living: state.living, law: state.living.law }).catch((e) => faultLogged("the encounter's tick tripped", e));
      state.last = { at: new Date().toISOString(), living: state.living?.living().length ?? 0, ...(r.ok ? {} : { why: r.why }), ...(a?.judged ? { arrivals: a } : {}) };
      if (a?.judged) log.log?.(`[creatures] arrivals: ${a.landed} landed · ${a.judged} judged · ${a.answered} answered`);
    } catch (e) {
      state.last = { at: new Date().toISOString(), error: faultLogged("the creatures' tick tripped", e) };
    } finally { state.running = false; }
  };
  run();
  timer = setInterval(run, REFRESH_MS);
  timer.unref?.();
  return true;
}

export function stopCreatures() { if (timer) clearInterval(timer); timer = null; }

/** The tick's last run, for an operator. */
export const creaturesTickLast = () => state.last;
