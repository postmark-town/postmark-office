// creature-tick.mjs — the creatures' own clock: each window's seed, its spawns,
// their fades and the window's reveal, written by `the-town` (WLD-56 part 3).
//
// RULED (Darko, 2026-10-15 12:09 EDT, WLD-56 D1–D6, as recommended): per 12 h
// window a wolf 2, a raven 4 and a bat 3, each at its own seeded minute, in the
// 400 m fringe on the clear side of the Mists' wall, open country only. Each
// lasts 12 h from its own spawn minute, then fades (withdraw, reason `faded`),
// or leaves early if it flees (`fled`, the creature's own row, POS-637). So
// creatures overlap across a crossing rather than turning over at once. No
// movement in w44: a creature stands where it spawned.
//
// Engineering settled by Wright on WLD-56 (W1–W8, from the gap read):
//
//   · W3  THE WRITER, NOT THE SWEEP. Spawns fall at set minutes through a 12 h
//         window, so a twice-a-day sweep cannot make them. This tick runs in the
//         writer process beside the arrival tick, every CREATURE_TICK_MS.
//   · W2  THE SEED: COMMIT, THEN REVEAL. At the window's first tick `the-town`
//         writes a `seed` act: the blessed world sha the window is pinned to, and
//         sha256(secret_N | sha). After the window closes it writes a `reveal`
//         act carrying secret_N, and anyone re-derives the whole window with the
//         world's `auditWindow`. secret_N = HMAC(CREATURE_SEED_KEY, N), and the
//         key is the box's alone (the office unit's env).
//   · W4  NO NEW TABLE. Every row is an `acts` row of class `creature` (R6):
//           seed     the-town · object window-<N> · { crossing, world_sha, commitment }
//           spawn    the-town · object <creature id> · { kind, crossing, x, y, at, fades_at, moods, flags }
//           withdraw the-town · object <creature id> · { reason: "faded", fades_at }
//           reveal   the-town · object window-<N> · { crossing, secret }
//         `at` on a spawn is its scheduled minute; the row is dated when it was
//         written (the log is never back-dated, world tools/creatures.mjs).
//   · W6  OFF UNTIL THE TOWN SAYS SO. The creature class's `from_crossing`
//         dial, read at the blessed sha, is null: no seed, no spawn. A window
//         that would spawn nothing (off, out of the Mists' season) is not seeded.
//
// EVERYTHING ABOUT A WINDOW IS READ AT ITS SEED'S SHA: the world's own code
// (`tools/creatures.mjs`, `tools/creature-kind.mjs`), the creature law (the class
// marks under CREATURE_LAW_DIR), the skeleton's Mists and the town's marks (the
// keep-out). A blessing that lands mid-window moves nothing already committed
// to. The world's code is never read from the working tree.
//
// NEVER TWICE. Each write takes an advisory lock on (action, object) and looks
// for the row first, inside one transaction, so a restart, a crash between two
// writes, or two offices overlapping at a deploy cannot write a row twice.
//
// A WRONG KEY WRITES NOTHING. Before a window's spawns or its reveal, the
// secret the key derives must hash, with the seed's sha, to the seed's
// commitment. If it does not (the key was changed mid-window), the window is
// left alone and the operator is told: a spawn the commitment does not cover
// would fail the audit, and so would a reveal.
//
// Env: CREATURE_SEED_KEY (the box's master key; absent, the tick does not
// start), CREATURE_TICK=off (the operator's door).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { actsQuery, world2Enabled } from "./world2-acts.mjs";
import { blessedSha, materializeAtRef, pathAtRef, readAtRef } from "./world-branches.mjs";
import { WORLD_CLONE } from "./world-store.mjs";
import { normalizeRow, WORLD_ANCHOR } from "./world-journal.mjs";
import { currentCrossing } from "./crossings.mjs";
import { errorSaid, faultLogged } from "./fault-words.mjs";
import { CREATURE_CLASS, SPAWN_ACTION, WITHDRAW_ACTION } from "./creatures.mjs";

export const CREATURE_TICK_MS = 30_000;
export const SEED_ACTION = "seed";
export const REVEAL_ACTION = "reveal";
export const TICK_ACTIONS = Object.freeze([SEED_ACTION, SPAWN_ACTION, WITHDRAW_ACTION, REVEAL_ACTION]);
/** How far back the tick reads its own rows: a window's seed and spawns, and a
 *  fade still unwritten after an outage. Older rows are the record's, not the tick's. */
export const LOOKBACK_MS = 7 * 24 * 3600 * 1000;
export const windowObject = (crossing) => `window-${crossing | 0}`;

export const TICK_ROWS_SQL = `SELECT id::text AS id, at, actor, action, object, payload FROM acts
  WHERE class = '${CREATURE_CLASS}' AND action = ANY($1::text[]) AND at > $2::timestamptz ORDER BY id`;
export const PRIOR_ROW_SQL = `SELECT id::text AS id, at, actor, action, object, payload FROM acts
  WHERE class = '${CREATURE_CLASS}' AND action = $1 AND object = $2 ORDER BY id LIMIT 1`;

const asPayload = (p) => (typeof p === "string" ? (() => { try { return JSON.parse(p); } catch { return {}; } })() : (p ?? {}));
const isoOf = (t) => (t instanceof Date ? t.toISOString() : typeof t === "number" ? new Date(t).toISOString() : String(t));
/** A store row as the world's fold reads it: `at` an ISO string, `payload` an object. */
export const rowOf = (r) => ({ id: r.id == null ? null : String(r.id), at: isoOf(r.at), actor: r.actor, action: r.action, object: r.object, payload: asPayload(r.payload) });

// ── the window's inputs, at a sha ───────────────────────────────────────────

/**
 * Everything a window is derived from, at one world sha: the world's creature
 * code, the creature law (null when the sha carries no creature class), the
 * schedule's inputs and each kind's start state. Throws when the sha cannot
 * supply the code; a sha with code and no class is `law: null` (off).
 */
export async function windowInputsAt(sha, { repo = WORLD_CLONE } = {}) {
  const tools = materializeAtRef(repo, sha, "tools");
  const imp = (f) => import(pathToFileURL(join(tools, "tools", f)).href);
  const [creaturesMod, kindMod, marksFold] = await Promise.all([imp("creatures.mjs"), imp("creature-kind.mjs"), imp("marks-fold.mjs")]);
  for (const name of ["creatureLaw", "scheduleFor", "dueSpawns", "dueFades", "secretFor", "commitmentOf"])
    if (typeof creaturesMod[name] !== "function") return { sha, creaturesMod, law: null, why: `tools/creatures.mjs at ${sha} has no ${name}` };
  const dir = creaturesMod.CREATURE_LAW_DIR;
  if (!dir || !pathAtRef(repo, sha, `${dir}/mark.md`)) return { sha, creaturesMod, law: null, why: `no creature class at ${sha}` };
  const root = materializeAtRef(repo, sha, dir);
  const files = readdirSync(join(root, dir), { recursive: true }).map(String).filter((p) => /(^|[\\/])mark\.md$/.test(p));
  const law = creaturesMod.creatureLaw(files.map((p) => marksFold.parseRecord(readFileSync(join(root, dir, p), "utf8"), `${dir}/${p}`)));
  if (!law) return { sha, creaturesMod, law: null, why: `no creature class at ${sha}` };
  const skeleton = JSON.parse(readAtRef(repo, sha, "WORLD/skeleton.json"));
  const marks = JSON.parse(readAtRef(repo, sha, "WORLD/world-state.json")).marks ?? [];
  const starts = {};
  for (const { kind, kind_file } of law.kinds)
    starts[kind] = kindMod.startState(kindMod.parseKind(readAtRef(repo, sha, kind_file), { source: `${kind_file} at ${sha}` }));
  return {
    sha, creaturesMod, law, starts,
    inputs: { mists: skeleton.mists, marks, dials: law.dials, fromCrossing: law.fromCrossing, world_sha: sha },
  };
}

// One load per sha, the PROMISE cached (two ticks never race one sha's load);
// a failed load is dropped, so the next tick tries again.
const inputsCache = new Map();
const INPUTS_KEPT = 4;
export function cachedInputsAt(sha, opts = {}, load = windowInputsAt) {
  if (!inputsCache.has(sha)) {
    const p = load(sha, opts);
    inputsCache.set(sha, p);
    p.catch(() => { if (inputsCache.get(sha) === p) inputsCache.delete(sha); });
    while (inputsCache.size > INPUTS_KEPT) inputsCache.delete(inputsCache.keys().next().value);
  }
  return inputsCache.get(sha);
}
export function __resetInputsForTest() { inputsCache.clear(); }

// ── the write: once, under a lock ───────────────────────────────────────────

/** The row the tick writes, as the pen takes it. Files in the open window; the
 *  window it belongs to rides in `payload.crossing`. */
export function townRow({ action, object, payload, place = null, now, effect }) {
  return normalizeRow({
    crossing: currentCrossing(now),
    at: place ? { anchor: WORLD_ANCHOR, dx: place.x, dy: place.y } : null,
    cls: CREATURE_CLASS, writtenAt: new Date(now).toISOString(),
    actor: "the-town", action, object, payload, effect,
  });
}

/**
 * Write one row unless the record already holds (action, object): one
 * transaction, an advisory lock on the pair, the look and the insert inside it.
 * Answers { prior, row } with the row as the fold reads it.
 */
export async function writeOnce(row, { officeWrite: ow = null, insertAct: ins = null } = {}) {
  const pen = ow && ins ? null : await import("./world2-pen.mjs");
  const officeWrite = ow ?? pen.officeWrite;
  const insertAct = ins ?? pen.insertAct;
  return officeWrite(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`creature-tick:${row.action}:${row.object}`]);
    const { rows: before } = await client.query(PRIOR_ROW_SQL, [row.action, row.object]);
    if (before.length) return { prior: true, row: rowOf(before[0]) };
    const id = await insertAct(client, row);
    return { prior: false, row: rowOf({ id, at: row.written_at, actor: row.actor, action: row.action, object: row.object, payload: row.payload }) };
  });
}

// ── one tick ────────────────────────────────────────────────────────────────

/**
 * One run of the clock at `now`. Seeds the open window if the law at the
 * blessed sha would spawn in it; writes every seeded window's due spawns; reveals
 * each closed window once its spawns are all written; writes every due fade.
 * Answers { wrote: { seed, spawn, fade, reveal }, held: [why], line }.
 *
 * Seams a test drives: `query`, `write` (writeOnce's shape), `inputsAt(sha)`,
 * `blessed()` (the blessed sha).
 */
export async function creatureTick({
  now = Date.now(), key = process.env.CREATURE_SEED_KEY, query = actsQuery, write = writeOnce,
  inputsAt = (sha) => cachedInputsAt(sha), blessed = () => blessedSha(WORLD_CLONE),
} = {}) {
  const wrote = { seed: 0, spawn: 0, fade: 0, reveal: 0 }, held = [];
  const said = () => `seed ${wrote.seed} · spawn ${wrote.spawn} · fade ${wrote.fade} · reveal ${wrote.reveal}${held.length ? ` · held: ${held.join("; ")}` : ""}`;
  if (!key) return { wrote, held: ["no CREATURE_SEED_KEY"], line: "no CREATURE_SEED_KEY: the creatures' clock is stopped" };
  const got = await query(TICK_ROWS_SQL, [[...TICK_ACTIONS], new Date(now - LOOKBACK_MS).toISOString()]);
  if (got == null) return { wrote, held: ["the store is not switched on here"], line: "the store is not switched on here" };
  const rows = got.map(rowOf);
  const put = async (row) => {
    const r = await write(row);
    if (!r.prior) rows.push(r.row);
    return r;
  };
  const town = (a) => a.actor === "the-town";
  const N = currentCrossing(now);

  // 1. the open window's seed, from the law at the blessed sha
  const seedOf = (M) => rows.find((r) => town(r) && r.action === SEED_ACTION && Number(r.payload.crossing) === M);
  if (!seedOf(N)) {
    const sha = blessed();
    const w = await inputsAt(sha);
    if (w.law) {
      const secret = w.creaturesMod.secretFor(key, N);
      const s = w.creaturesMod.scheduleFor(N, secret, w.inputs);
      if (s.spawns.length + s.unplaced.length > 0) {
        const r = await put(townRow({ action: SEED_ACTION, object: windowObject(N), now,
          payload: { crossing: N, world_sha: sha, commitment: w.creaturesMod.commitmentOf(secret, sha) },
          effect: `the town commits to crossing ${N}'s creatures` }));
        if (!r.prior) wrote.seed += 1;
      }
    }
  }

  // 2. every seeded window not yet revealed: its due spawns, then (once closed) its reveal
  const revealed = new Set(rows.filter((r) => town(r) && r.action === REVEAL_ACTION).map((r) => Number(r.payload.crossing)));
  const seeds = rows.filter((r) => town(r) && r.action === SEED_ACTION && !revealed.has(Number(r.payload.crossing)))
    .sort((a, b) => Number(a.payload.crossing) - Number(b.payload.crossing));
  for (const seed of seeds) {
    const M = Number(seed.payload.crossing);
    let w;
    try { w = await inputsAt(seed.payload.world_sha); }
    catch (e) { held.push(`crossing ${M}: its seed's world ${seed.payload.world_sha} cannot be read (${errorSaid(e).slice(0, 120)})`); continue; }
    if (!w.law) { held.push(`crossing ${M}: ${w.why}`); continue; }
    const secret = w.creaturesMod.secretFor(key, M);
    if (w.creaturesMod.commitmentOf(secret, seed.payload.world_sha) !== seed.payload.commitment) {
      held.push(`crossing ${M}: this key's secret does not match the seed's commitment (was CREATURE_SEED_KEY changed?)`);
      continue;
    }
    const sched = w.creaturesMod.scheduleFor(M, secret, w.inputs);
    const spawned = new Set(rows.filter((r) => town(r) && r.action === SPAWN_ACTION).map((r) => r.object));
    for (const s of w.creaturesMod.dueSpawns(sched, now)) {
      if (spawned.has(s.id)) continue;
      const r = await put(townRow({ action: SPAWN_ACTION, object: s.id, place: s, now,
        payload: { kind: s.kind, crossing: M, x: s.x, y: s.y, at: s.at, fades_at: s.fades_at,
          moods: { ...(w.starts[s.kind]?.moods ?? {}) }, flags: [] },
        effect: `a ${s.kind} comes out of the Mists` }));
      if (!r.prior) wrote.spawn += 1;
    }
    if (M < N && sched.spawns.every((s) => rows.some((r) => town(r) && r.action === SPAWN_ACTION && r.object === s.id))) {
      const r = await put(townRow({ action: REVEAL_ACTION, object: windowObject(M), now,
        payload: { crossing: M, secret }, effect: `the town reveals crossing ${M}'s seed` }));
      if (!r.prior) wrote.reveal += 1;
    }
  }

  // 3. the fades: every creature past its span whose withdraw is not yet written
  const fold = (await inputsAt(blessed())).creaturesMod;
  for (const f of fold.dueFades(null, rows, now)) {
    const c = rows.find((r) => r.action === SPAWN_ACTION && r.object === f.id);
    const r = await put(townRow({ action: WITHDRAW_ACTION, object: f.id, place: c?.payload, now,
      payload: { reason: "faded", fades_at: f.fades_at }, effect: `the ${c?.payload?.kind ?? "creature"} fades back into the Mists` }));
    if (!r.prior) wrote.fade += 1;
  }
  return { wrote, held, line: said() };
}

// ── the timer ───────────────────────────────────────────────────────────────

const timer = { handle: null, running: false, last: null };

/**
 * Start the clock: the writer process only, pointed at a store, never on port 0
 * (a suite's office), not when the operator says CREATURE_TICK=off, and not
 * without the box's key. One run now (the restart's catch-up), then every
 * CREATURE_TICK_MS, serial. Unref'd. Idempotent.
 */
export function startCreatureTick({ port, env = process.env, log = console, tick = creatureTick } = {}) {
  if (timer.handle) return false;
  if (String(env.CREATURE_TICK ?? "").toLowerCase() === "off") { log.log?.("[creatures] CREATURE_TICK=off: no creature is seeded, spawned, faded or revealed until it is on"); return false; }
  if (!world2Enabled(env) || Number(port) === 0) return false;
  if (!env.CREATURE_SEED_KEY) { log.log?.("[creatures] no CREATURE_SEED_KEY in this office's env: the creatures' clock is not started"); return false; }
  const run = async () => {
    if (timer.running) return;
    timer.running = true;
    try {
      const r = await tick({ key: env.CREATURE_SEED_KEY });
      timer.last = { at: new Date().toISOString(), line: r.line };
      const n = Object.values(r.wrote).reduce((a, b) => a + b, 0);
      if (n || r.held.length) log.log?.(`[creatures] ${r.line}`);
    } catch (e) {
      timer.last = { at: new Date().toISOString(), error: errorSaid(e).slice(0, 200) };
      faultLogged("the creatures' clock tripped", e);
    } finally { timer.running = false; }
  };
  run();
  timer.handle = setInterval(run, CREATURE_TICK_MS);
  timer.handle.unref?.();
  return true;
}

/** Tests only: stop the timer. */
export function stopCreatureTick() { if (timer.handle) clearInterval(timer.handle); Object.assign(timer, { handle: null, running: false, last: null }); }

/** The clock's last run, for an operator. */
export const creatureTickLast = () => timer.last;
