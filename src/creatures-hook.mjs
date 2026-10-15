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
//   · THE CREATURE'S OWN WORLD READ (W9, Darko 21:32). `aroundCreature` asks
//     the resident read's own doors at the creature's point, as a spectator
//     (nobody's body, nobody's note): presence and who acted (who), the field
//     of view with its bodies (view), the shared ear that marks nobody present
//     (heard, office#564), the air, the hour, and what the actor last did.
//     One reader for residents and creatures.
//
// TWO OFFICES AT ONCE (a deploy's overlap): both fold the same rows and both
// may judge one arrival. creatures.mjs § writeReaction locks on (creature,
// trigger, moment) inside its transaction, so the second finds the first's row.

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import {
  ANSWER_WAIT_MS, ARRIVAL, LivingSet, REFRESH_MS, creatureLaw, reactTo,
} from "./creatures.mjs";
import { outsideWatch, setCreaturesAwake } from "./act-watch.mjs";
import { outsideRetryKey } from "./act-nonce.mjs";
import { actsQuery, world2Enabled } from "./world2-acts.mjs";
import { faultLogged } from "./fault-words.mjs";
import { CLASS_MOVE, composeAnchor } from "./world-journal.mjs";
import { CROSSING_EPOCH_UTC, CROSSING_MS, currentCrossing } from "./crossings.mjs";
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
    state.living = new LivingSet({ law });
  }
  const r = await state.living.refresh({ query, now });
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
  try {
    const now = creaturesNow();
    if (!now || result == null || typeof result !== "object" || Array.isArray(result) || result.error) return result;
    const ring = now.law.kindMod.RING_VERBS;
    const trigger = [...rows].reverse().find((r) => ring.includes(r.action));
    if (!trigger) return result;
    // near: a ring holds the point, or a creature already answered this act (a retry, F6)
    const act = await actOfRow(trigger, { ...deps,
      near: (pt) => now.living.inRing(pt).length > 0 || now.living.answered.has(String(trigger.id)) });
    if (!act) return result;
    const answers = await answerWithin(act, { ...now, ...deps });
    if (!answers.length) return result;
    result.creatures = answers;
    return result;
  } catch (e) {
    faultLogged("the creatures could not answer an act; it answered without them", e);
    return result;
  }
}

/** The creatures' turns for one act, outside the door's key and the watched act, bounded by ANSWER_WAIT_MS. */
export function answerWithin(act, { living, law, around = aroundCreature, ask, write, env, clock = Date.now } = {}) {
  const deadline = clock() + ANSWER_WAIT_MS;
  const turns = outsideRetryKey(() => outsideWatch(() =>
    reactTo(act, { living, law, around, ...(ask ? { ask } : {}), ...(write ? { write } : {}), ...(env ? { env } : {}), clock, deadline })));
  let timer;
  const late = new Promise((r) => { timer = setTimeout(() => r([]), Math.max(0, deadline - clock())); timer.unref?.(); });
  return Promise.race([turns, late]).finally(() => clearTimeout(timer));
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
  const [oriented, seen, heardRows, lastRows] = await Promise.all([
    part(() => w.worldOrient({ x: at.x, y: at.y }, null, { crowd: true })),
    part(() => w.worldEyes({ x: at.x, y: at.y }, null, { v2: true })),
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
  const rows = seen?._fov?.rows ?? [];
  if (rows.length) {
    out.view = viewBlock(rows);
    out.bodies = Object.fromEntries(rows.filter((r) => r.body).map((r) => [r.id, r.body]));
  }
  if (Array.isArray(heardRows)) out.heard = heardRows.slice(-3).map((h) => ({ who: h.handle, said: h.said, ...(h.ago ? { ago: h.ago } : {}) }));
  if (Array.isArray(lastRows))
    out.actor_last = lastRows.map((r) => `${PUBLIC_ACTS[r.action] ?? r.action}, ${ago(r.at instanceof Date ? r.at.getTime() : Date.parse(r.at), nowMs)}`);
  return out;
}

// ── the arrival (C1) ────────────────────────────────────────────────────────

const WALKS_SQL = `SELECT id::text AS id, at, crossing, actor, action, payload FROM acts
  WHERE class = '${CLASS_MOVE}' AND id > $1::bigint ORDER BY id LIMIT $2`;
// The first read of a process: the walks of the last two windows, by the crossing index.
const WALKS_BOOT_SQL = `SELECT id::text AS id, at, crossing, actor, action, payload FROM acts
  WHERE crossing >= $1 AND class = '${CLASS_MOVE}' ORDER BY id`;
const WALKS_BATCH = 2000;
/** An arrival this long past when a tick first could judge it (a restart's catch-up) is let go. */
export const ARRIVAL_STALE_MS = 3600_000;

/** Every walker's newest walk, until it lands: walk act id → { actor, from, at (landing point), dueMs }. */
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
  const dueMs = Math.round(CROSSING_EPOCH_UTC + (Number(rec.at) + at0.remainingM / paceM) * CROSSING_MS);
  return { from: pointOf(rec.from), at: pointOf(landed), dueMs };
}

/** Fold walk rows: each walker's newest walk replaces any earlier one still on its way. */
export function foldWalks(rows, walkMod) {
  for (const r of rows) {
    if (BigInt(r.id) <= BigInt(arrivals.cursor)) continue;
    arrivals.cursor = String(r.id);
    if (r.action !== "walk") continue;
    const land = landingOf(r, walkMod);
    if (!land) { arrivals.byActor.delete(r.actor); continue; } // a stop replaces the walk before it too
    arrivals.byActor.set(r.actor, { walk: String(r.id), actor: r.actor, ...land });
  }
}

/**
 * One arrival tick: read the new walks, then judge each walk that has landed
 * for the creatures whose ring holds its landing point, at the landing instant.
 * The walker is not waiting on this answer, so the line reaches them through
 * the reaction's row (happening_here, and their own happened).
 */
export async function arrivalTick({ query = actsQuery, now = Date.now(), walkMod = null, judge = answerWithin } = {}) {
  walkMod ??= await import(pathToFileURL(join((await import("./world.mjs")).WORLD_CLONE, "tools", "walk.mjs")));
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
  const out = { landed: 0, judged: 0, answered: 0 };
  const cur = creaturesNow();
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
