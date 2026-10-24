// creature-tick.mjs — the creatures' own clock: each window's seed, its spawns
// and the window's reveal, written by `the-town` (WLD-56 part 3).
//
// RULED (Darko, 2026-10-15 12:09 EDT, WLD-56 D1–D6, as recommended): per 12 h
// window a wolf 2, a raven 4 and a bat 3, each at its own seeded minute, in the
// 400 m fringe on the clear side of the Mists' wall, open country only. Each
// lasts 12 h from its own spawn minute, then fades (withdraw, reason `faded`),
// or leaves early if it flees (`fled`, the creature's own row, POS-637). So
// creatures overlap across a crossing rather than turning over at once. No
// movement in w44: a creature stands where it spawned.
//
// THE FADE IS GONE: THE MISTS CREATURES GATHER (WLD-96; RULED, Darko 2026-10-21
// 19:39 and 19:41 EDT). A spawn carries no `fades_at` and the tick writes no
// `faded` withdraw, for a creature out before this deployed too
// (creatures.mjs § NEVER_FADES). Flee still ends one; the rest go back at the
// season's end, on his word then. The world's `auditWindow` re-derives a window
// from each spawn's id, kind, minute and place, never its fade, so it still passes.
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
//           spawn    the-town · object <creature id> · { kind, crossing, x, y, at, moods, flags }
//                    (before WLD-96 it also carried fades_at, and a withdraw { reason: "faded", fades_at } followed)
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
// THE KEY IS SEEN IN THE RECORD, NEVER SHOWN (review of #572, L1–L3).
//   · Every seed carries `key_fingerprint` (sha256 of HMAC(key, "creatures/
//     fingerprint")), so a key changed between windows shows in the log as two
//     fingerprints, though neither tells the key.
//   · A WRONG KEY WRITES NOTHING FOR A WINDOW IT DID NOT COMMIT. Before a window's
//     spawns or its reveal, the secret the key derives must hash, with the seed's
//     sha, to the seed's commitment: a spawn the commitment does not cover would
//     fail the audit, and so would a reveal. If it does not (the key was rotated
//     mid-window), the tick writes ONE `abandon` row for that window, by the-town,
//     with both fingerprints, and logs a fault once. The window is then closed:
//     no more spawns and no reveal. It is not held for ever with a line every 30 s.
//
// Env: CREATURE_SEED_KEY (the box's master key; absent, no window is seeded),
// CREATURE_TICK=off (the operator's door).

import { createHash, createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { actsQuery, world2Enabled } from "./world2-acts.mjs";
import { blessedSha, materializeAtRef, pathAtRef, readAtRef } from "./world-branches.mjs";
import { WORLD_CLONE } from "./world-store.mjs";
import { RECORD_FILE_RE, recordFileIn } from "./world-law-shape.mjs"; // WLD-116: node.md in the law tree, mark.md where a class is still filed as a mark
import { normalizeRow, WORLD_ANCHOR } from "./world-journal.mjs";
import { currentCrossing } from "./crossings.mjs";
import { errorSaid, faultLogged } from "./fault-words.mjs";
import { CREATURE_CLASS, SPAWN_ACTION, WITHDRAW_ACTION, TELL_ACTION, UNSEAL_ACTION } from "./creatures.mjs";
import { scopeSecret } from "./sealed.mjs";

export const CREATURE_TICK_MS = 30_000;
export const SEED_ACTION = "seed";
export const REVEAL_ACTION = "reveal";
export const ABANDON_ACTION = "abandon";
export const TICK_ACTIONS = Object.freeze([SEED_ACTION, SPAWN_ACTION, WITHDRAW_ACTION, REVEAL_ACTION, ABANDON_ACTION]);
/** A key's public fingerprint: it names which key seeded a window and tells nothing of it. Hex. */
export const keyFingerprint = (key) => createHash("sha256").update(createHmac("sha256", String(key)).update("creatures/fingerprint").digest()).digest("hex");
/** How far back the tick reads its own rows: a window's seed and spawns. Older
 *  rows are the record's, not the tick's. */
export const LOOKBACK_MS = 7 * 24 * 3600 * 1000;
export const windowObject = (crossing) => `window-${crossing | 0}`;

export const TICK_ROWS_SQL = `SELECT id::text AS id, at, actor, action, object, payload FROM acts
  WHERE class = '${CREATURE_CLASS}' AND action = ANY($1::text[]) AND at > $2::timestamptz ORDER BY acts.id`;
export const PRIOR_ROW_SQL = `SELECT id::text AS id, at, actor, action, object, payload FROM acts
  WHERE class = '${CREATURE_CLASS}' AND action = $1 AND object = $2 ORDER BY acts.id LIMIT 1`;

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
  for (const name of ["creatureLaw", "scheduleFor", "dueSpawns", "secretFor", "commitmentOf"])
    if (typeof creaturesMod[name] !== "function") return { sha, creaturesMod, law: null, why: `tools/creatures.mjs at ${sha} has no ${name}` };
  const dir = creaturesMod.CREATURE_LAW_DIR;
  // (the class is a law node since WLD-116: `node.md` in the law tree, `mark.md` where the world still files it as a mark)
  if (!dir || !recordFileIn(dir, (p) => pathAtRef(repo, sha, p))) return { sha, creaturesMod, law: null, why: `no creature class at ${sha}` };
  const root = materializeAtRef(repo, sha, dir);
  const files = readdirSync(join(root, dir), { recursive: true }).map(String).filter((p) => RECORD_FILE_RE.test(p));
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
 * One run of the clock at `now`. With the key: seeds the open window if the law
 * at the blessed sha would spawn in it; writes every seeded window's due spawns;
 * reveals each closed window once its spawns are all written; abandons a window
 * the key did not commit. No fade is written (WLD-96): a Mists creature gathers.
 * Answers { wrote: { seed, spawn, reveal, abandon }, held: [why], line }.
 *
 * Seams a test drives: `query`, `write` (writeOnce's shape), `inputsAt(sha)`,
 * `blessed()` (the blessed sha), `hold` (holdTown's shape).
 */
export async function creatureTick({
  now = Date.now(), key = process.env.CREATURE_SEED_KEY, query = actsQuery, write = writeOnce,
  inputsAt = (sha) => cachedInputsAt(sha), blessed = () => blessedSha(WORLD_CLONE), hold = holdTown,
} = {}) {
  const wrote = { seed: 0, spawn: 0, reveal: 0, abandon: 0, unseal: 0 }, held = [];
  const said = () => `${key ? "" : "no key (no window is seeded) · "}seed ${wrote.seed} · spawn ${wrote.spawn} · reveal ${wrote.reveal}${wrote.abandon ? ` · abandon ${wrote.abandon}` : ""}${wrote.unseal ? ` · unseal ${wrote.unseal}` : ""}${held.length ? ` · held: ${held.join("; ")}` : ""}`;
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

  // 1. the open window's seed, from the law at the blessed sha (the key's work)
  const seedOf = (M) => rows.find((r) => town(r) && r.action === SEED_ACTION && Number(r.payload.crossing) === M);
  if (key && !seedOf(N)) {
    const sha = blessed();
    const w = await inputsAt(sha);
    if (w.law) {
      const secret = w.creaturesMod.secretFor(key, N);
      const s = w.creaturesMod.scheduleFor(N, secret, w.inputs);
      if (s.spawns.length + s.unplaced.length > 0) {
        const r = await put(townRow({ action: SEED_ACTION, object: windowObject(N), now,
          payload: { crossing: N, world_sha: sha, commitment: w.creaturesMod.commitmentOf(secret, sha), key_fingerprint: keyFingerprint(key) },
          effect: `the town commits to crossing ${N}'s creatures` }));
        if (!r.prior) wrote.seed += 1;
      }
    }
  }

  // 2. every seeded window not yet revealed or abandoned: its due spawns, then (once closed) its reveal
  const closed = new Set(rows.filter((r) => town(r) && (r.action === REVEAL_ACTION || r.action === ABANDON_ACTION)).map((r) => Number(r.payload.crossing)));
  const seeds = !key ? [] : rows.filter((r) => town(r) && r.action === SEED_ACTION && !closed.has(Number(r.payload.crossing)))
    .sort((a, b) => Number(a.payload.crossing) - Number(b.payload.crossing));
  for (const seed of seeds) {
    const M = Number(seed.payload.crossing);
    let w;
    try { w = await inputsAt(seed.payload.world_sha); }
    catch (e) { held.push(`crossing ${M}: its seed's world ${seed.payload.world_sha} cannot be read (${errorSaid(e).slice(0, 120)})`); continue; }
    if (!w.law) { held.push(`crossing ${M}: ${w.why}`); continue; }
    const secret = w.creaturesMod.secretFor(key, M);
    if (w.creaturesMod.commitmentOf(secret, seed.payload.world_sha) !== seed.payload.commitment) {
      const why = `crossing ${M}: this key's secret does not match the seed's commitment (CREATURE_SEED_KEY was changed mid-window), so the window is abandoned: no more spawns and no reveal`;
      const r = await put(townRow({ action: ABANDON_ACTION, object: windowObject(M), now,
        payload: { crossing: M, reason: "the seed key changed mid-window", seed_key_fingerprint: seed.payload.key_fingerprint ?? null, key_fingerprint: keyFingerprint(key) },
        effect: `the town abandons crossing ${M}'s creatures: its key changed` }));
      if (!r.prior) { wrote.abandon += 1; held.push(why); faultLogged(why, new Error("the seed key changed")); }
      continue;
    }
    const sched = w.creaturesMod.scheduleFor(M, secret, w.inputs);
    const spawned = new Set(rows.filter((r) => town(r) && r.action === SPAWN_ACTION).map((r) => r.object));
    for (const s of w.creaturesMod.dueSpawns(sched, now)) {
      if (spawned.has(s.id)) continue;
      const r = await put(townRow({ action: SPAWN_ACTION, object: s.id, place: s, now,
        payload: { kind: s.kind, crossing: M, x: s.x, y: s.y, at: s.at,
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

  // 3. no fades (WLD-96): a Mists creature gathers until it flees or the season ends

  // 4. the named creatures, with the seed key or without (WLD-25): each declaration spawns ONCE EVER
  // at its own place, from its own crossing on, whatever the Mists' season, and
  // stays until its settlement ends it. writeOnce's look is unbounded in time, so
  // a creature spawned or ended weeks ago is never spawned again (one per declaration).
  const named = await namedSpawns({ now, N, inputsAt, blessed, held, query });
  for (const n of named) {
    const r = await put(townRow({ action: SPAWN_ACTION, object: n.id, place: n, now,
      payload: { kind: n.kind, crossing: N, x: n.x, y: n.y, at: new Date(now).toISOString(), stays: true,
        ...(n.carries ? { carries: n.carries } : {}), ...(n.declared ? { declared: n.declared } : {}), moods: { ...n.moods }, flags: [] },
      effect: `a ${n.kind} is found here` }));
    if (!r.prior) wrote.spawn += 1;
    if (n.carries) {
      const h = await hold(n.carries, n.id, { query, now });
      if (h.held) held.push(h.held);
    }
  }

  // 5. the unseal (POS-712): a creature that told fragments, once its settlement has
  // ended it, publishes its sealed secret, so anyone checks every tell's commitment
  // (src/sealed.mjs § verifySealed). The key's work: without it, held and said.
  for (const { id } of (await query(UNSEAL_DUE_SQL, [])) ?? []) {
    if (!key) { held.push(`${id}: its sealed secret waits for the key to be published`); continue; }
    const r = await put(townRow({ action: UNSEAL_ACTION, object: id, now,
      payload: { scope: id, secret: scopeSecret(key, id) }, effect: `the town opens what ${id} told, now that it has ended` }));
    if (!r.prior) wrote.unseal += 1;
  }
  return { wrote, held, line: said() };
}

/** The ended creatures that told fragments and whose secret is not yet published (POS-712). */
export const UNSEAL_DUE_SQL = `SELECT DISTINCT t.actor AS id FROM acts t
  WHERE t.class = '${CREATURE_CLASS}' AND t.action = '${TELL_ACTION}'
    AND EXISTS (SELECT 1 FROM acts w WHERE w.class = '${CREATURE_CLASS}' AND w.action = '${WITHDRAW_ACTION}' AND w.object = t.actor AND w.payload->>'reason' = 'ended')
    AND NOT EXISTS (SELECT 1 FROM acts u WHERE u.class = '${CREATURE_CLASS}' AND u.action = '${UNSEAL_ACTION}' AND u.object = t.actor)`;

/**
 * The named creatures the law at the blessed sha declares and whose crossing
 * has come: [{ id, kind, x, y, carries, declared, moods }]. The world's side is
 * `creatureLaw(...).named`, each { id, kind, x, y, carries?, from_crossing?, after?, after_door?,
 * declared? }; a law without it declares none. A declaration this office cannot
 * spawn (a bad id, no place, a kind the law has no start for) is a `held` line.
 */
/** Which of these named creatures have ended (their settlement's withdraw): a declaration's `after` waits on them all. */
export const ENDED_OF_SQL = `SELECT DISTINCT object FROM acts WHERE class = '${CREATURE_CLASS}' AND action = '${WITHDRAW_ACTION}'
  AND payload->>'reason' = 'ended' AND object = ANY($1::text[])`;

export async function namedSpawns({ now, N = currentCrossing(now), inputsAt, blessed, held = [], query = null }) {
  let w;
  try { w = await inputsAt(blessed()); } catch (e) { held.push(`the named creatures: the blessed world cannot be read (${errorSaid(e).slice(0, 120)})`); return []; }
  const decl = Array.isArray(w?.law?.named) ? w.law.named : [];
  const out = [];
  for (const d of decl) {
    const from = d.from_crossing ?? w.law.fromCrossing;
    if (!w.creaturesMod.creaturesOn(N, from)) continue;
    const bad = !w.creaturesMod.isCreatureId(d.id) ? "its id is not a creature's"
      : !Number.isFinite(Number(d.x)) || !Number.isFinite(Number(d.y)) ? "it has no place"
        : !w.starts?.[d.kind] ? `the law has no kind ${d.kind}` : null;
    if (bad) { held.push(`the named creature ${d.id ?? "(no id)"}: ${bad}`); continue; }
    // AFTER (a creature that tempts, its fight's opening): it comes out only once every one it names has ended
    if (Array.isArray(d.after) && d.after.length) {
      let ended = null;
      try { ended = query ? new Set(((await query(ENDED_OF_SQL, [d.after])) ?? []).map((r) => r.object)) : null; } catch { ended = null; }
      if (!ended || !d.after.every((a) => ended.has(a))) continue;
    }
    // AFTER A DOOR (`after_door`, WLD-25/k): it comes out at the first settlement whose blessed
    // world shows its door open, the door's own `requires` read from the printed `held_by` by the
    // world's afterDoorOpen, so the door and the creature open together. Fail closed: an engine
    // that cannot ask holds it, saying why; a shut door is no line, only a wait.
    if (d.after_door != null) {
      if (typeof w.creaturesMod.afterDoorOpen !== "function") { held.push(`the named creature ${d.id}: it waits on the door ${d.after_door}, and the engine at this blessing cannot read a door`); continue; }
      let door;
      try { door = w.creaturesMod.afterDoorOpen(d, w.inputs?.marks ?? []); } catch (e) { door = { open: false, why: `its door could not be read (${errorSaid(e).slice(0, 120)})` }; }
      if (!door?.open) { if (!door?.shut) held.push(`the named creature ${d.id}: ${door?.why ?? "its door cannot be read"}`); continue; }
    }
    out.push({ id: d.id, kind: d.kind, x: Number(d.x), y: Number(d.y), carries: typeof d.carries === "string" ? d.carries : null,
      declared: d.declared ?? null, moods: w.starts[d.kind].moods ?? {} });
  }
  return out;
}

export const THING_STANDING_SQL = `SELECT 1 AS here FROM marks WHERE slug = $1 AND status = 'standing' LIMIT 1`;
export const THING_HOLD_ROWS_SQL = `SELECT 1 AS here FROM acts WHERE class = 'holding' AND object = $1 LIMIT 1`;

/**
 * What a named creature carries waits, unseen, in the town's own hands until
 * its ending gives it to the first finisher (WLD-25 D3, the lane's rec, awaiting
 * Darko's word). Once: when the record holds no hold row for the thing at all,
 * the town's `give` to itself is that first row, so the hold record and the
 * thing's printed `held_by: the-town` agree. Answers { wrote } or { held }.
 */
export async function holdTown(thing, creatureId, { query = actsQuery, now = Date.now(), officeWrite: ow = null } = {}) {
  const [standing] = (await query(THING_STANDING_SQL, [thing])) ?? [];
  if (!standing) return { wrote: false, held: `the named creature ${creatureId}: what it carries, ${thing}, is not standing yet` };
  const officeWrite = ow ?? (await import("./world2-pen.mjs")).officeWrite;
  return officeWrite(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`creature-tick:hold:${thing}`]);
    const { rows: before } = await client.query(THING_HOLD_ROWS_SQL, [thing]);
    if (before.length) return { wrote: false };
    await client.query(
      `INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect)
       VALUES (now(), $1, 'the-town', 'give', $2, 'holding', $3::jsonb, $4)`,
      [currentCrossing(now), thing, JSON.stringify({ thing, holder: "the-town", policy: "cascade", previous_holder: null, carried_by: creatureId }),
        `the town keeps ${thing} until it is won`]);
    return { wrote: true };
  });
}

// ── the timer ───────────────────────────────────────────────────────────────

const timer = { handle: null, running: false, last: null };

/**
 * Start the clock: the writer process only, pointed at a store, never on port 0
 * (a suite's office), and not when the operator says CREATURE_TICK=off. Without
 * the box's key it seeds no window, and says so once. One run now (the
 * restart's catch-up), then every
 * CREATURE_TICK_MS, serial. Unref'd. Idempotent.
 */
export function startCreatureTick({ port, env = process.env, log = console, tick = creatureTick } = {}) {
  if (timer.handle) return false;
  if (String(env.CREATURE_TICK ?? "").toLowerCase() === "off") { log.log?.("[creatures] CREATURE_TICK=off: no creature is seeded, spawned or revealed until it is on"); return false; }
  if (!world2Enabled(env) || Number(port) === 0) return false;
  if (!env.CREATURE_SEED_KEY) log.log?.("[creatures] no CREATURE_SEED_KEY in this office's env: no window's creatures are seeded, spawned or revealed");
  const run = async () => {
    if (timer.running) return;
    timer.running = true;
    try {
      const r = await tick({ key: env.CREATURE_SEED_KEY || null });
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
