// drop-recovery.mjs — A SET-DOWN UNIT IS NEVER LOST AND NEVER COUNTED TWICE (WLD-27, F0).
//
// Wright's independent review (AUTHORITY 2026-10-13T03:01:29Z): a unit set down
// is a `units:drop` act, then its mark is filed. If the office dies between the
// two, or the compensation's own write fails, the act stands alone: the unit has
// left the dropper's hands and is on no ground. And `leaveMarkViaOffice` can
// throw AFTER its claim committed, so "the call threw" is not "nothing was
// filed". The ruling: "the office tick reconciles a committed `units:drop` older
// than one tick with neither a claim for that act nor `drop-undone`, by
// recording `drop-undone` back to the original dropper, with a receipt line" —
// and the immediate compensation asks what actually committed before it undoes.
//
// ── ONE DECISION PER DROP, TAKEN ONCE ───────────────────────────────────────
//
// Three writers decide a drop's fate: the mark's filing (its claim), the door's
// immediate compensation, and the tick's recovery. All three take the same
// transaction-scoped advisory lock for that drop act, `wld27-drop:<act id>`,
// and decide under it:
//   · the filing refuses when an undo is already on the record (dropLiveGuard);
//   · an undo refuses when the mark is filed — a claim whose own record names
//     this drop act (data.dropped = act:<id>, the dropper, the label), in any
//     status including a private draft, or a mark act whose payload names it;
//   · an undo carries the nonce `drop-undone:<act id>` under the dropper's own
//     actor and household, so `acts_world_nonce_once` (052) keeps a second one
//     out even past the lock — replay, two ticks, compensation beside recovery.
// No second provenance store: the drop act, its claim and its undo are the
// record. The ids stay exact decimal text end to end.
//
// ── ONLY THE DELTA, EVERY TICK (Wright, AUTHORITY 2026-10-13T05:20:23Z, C) ───
//
// "F0 must compute only the delta": the first cut reopened every filed drop on
// every tick, forever, and found undos by scanning payloads. Now a drop leaves
// the tick's work set once it is resolved, and stays out:
//   · undone — its undo act, found by its nonce under the dropper's own actor
//     (`acts_actor_nonce_idx`, 027), never by `payload->>'undoes'`;
//   · filed — the tick records ONE `units:drop-resolved` act for it, under the
//     dropper's actor and the drop's household, with the nonce
//     `units:drop-resolved:<act id>` (052 keeps it to one);
//   · and a LOW-WATER CURSOR: a `units:drop-sweep` act by the town's pen whose
//     nonce names the newest drop id below which every drop is resolved. The
//     next tick starts above it. It moves only past drops that are resolved,
//     and only past ids that are FINAL — the tick reads the newest drop id
//     under an exclusive lock that every set-down's own write shares
//     (`dropSequenceGuard`), so no drop still being written can hold an id
//     beneath it (the "busy drop lost behind a high-water cursor").
// A drop the tick cannot decide (an unreadable claim, a failed write) stays
// unresolved, holds the cursor below it, and is asked again next tick.

import { UNIT_ACTION } from "./world-stacks.mjs";
import { TOWN_PEN, TOWN_HOUSEHOLD } from "../world2/tools/chest-stock.mjs";

/** The drop's lock key text (hashed by Postgres to the advisory key). */
export const dropLockKey = (actId) => `wld27-drop:${String(actId)}`;
const LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext($1))";

/** The undo's nonce: one per drop act, ever. */
export const undoNonce = (actId) => `${UNIT_ACTION.dropUndone}:${String(actId)}`;

/** The filed drop's resolution nonce: one per drop act, ever. */
export const resolvedNonce = (actId) => `${UNIT_ACTION.dropResolved}:${String(actId)}`;

// THE SET-DOWNS' SEQUENCE LOCK. Every set-down's write takes it SHARED (so
// set-downs never wait on each other); the tick takes it EXCLUSIVE for one
// read of the newest drop id. Held exclusively, no drop write is in flight, so
// every drop id at or below that read is committed — final.
const DROPS_LOCK = "wld27-drops";
export const dropSequenceGuard = async (client) => { await client.query("SELECT pg_advisory_xact_lock_shared(hashtext($1))", [DROPS_LOCK]); };

/** The mark a drop files is `<dropper>/<label>-<act id>` (world-stacks.mjs § droppedUnitMark). */
export const dropMarkId = ({ actor, label, actId }) => `${actor}/${label}-${String(actId)}`;

/**
 * THE TICK'S CADENCE. The live office tick is `postmark-office-keep.timer`
 * (deploy/), `OnCalendar=*:07,22,37,52` — every 15 minutes — running
 * office-keep.sh, whose settlements-backfill `--apply` step calls the recovery
 * (settlements-backfill.mjs § dropsRecoveredOnTick). "Older than one tick" is
 * this interval; test/drop-recovery.test.mjs pins it to the timer file.
 */
export const TICK_MS = 15 * 60 * 1000;

// A SPENT NONCE, under one actor: `acts_actor_nonce_idx (actor, nonce) WHERE
// nonce IS NOT NULL` (027) — `nonce = $2` implies the predicate.
const SPENT_SQL = `SELECT id::text FROM acts WHERE actor = $1 AND nonce = $2 LIMIT 1`;
const spentBy = async (client, actor, nonce) => (await client.query(SPENT_SQL, [String(actor), nonce])).rows[0]?.id ?? null;
// THE MARK IS KNOWN BY THE ACT IT NAMES (Bevel's follow-up review, A): a claim
// is this drop's mark when its own record says so — `data.dropped` is exactly
// `act:<id>`, its claimant is the dropper, its label the drop's label — in ANY
// status. Never by a slug predicted from the act: a mark filed under another
// name is still this unit, and an unrelated mark that happens to carry the
// predicted name is not. A mark act counts only on the same proof in its own
// payload (the leave's declaration carries `dropped` and `label`).
const CLAIM_SQL = `
  SELECT id::text, slug, status FROM claims
   WHERE data->>'dropped' = $1 AND claimant = $2 AND data->>'label' = $3
   ORDER BY submitted_at LIMIT 1`;
const MARK_ACT_SQL = `
  SELECT id::text, object FROM acts
   WHERE class = 'mark' AND action IN ('leave-mark', 'amend')
     AND payload->>'dropped' = $1 AND actor = $2 AND payload->>'label' = $3
   ORDER BY id LIMIT 1`;

// THE DROP'S OWN HOUSEHOLD (Bevel's follow-up review, C). A private draft is
// visible only under its household's spellings (007/024 row policy). The house
// to declare is the one the DROP was recorded under — `acts.household` on the
// committed drop, append-only — never the dropper's present membership, which
// can have moved since and would hide the draft and refund a filed unit. Nor a
// caller's word: the guard reads the drop act itself.
const DROP_ROW_SQL = `SELECT actor, household, payload FROM acts WHERE id = $1::bigint AND action = $2 AND class = 'holding'`;

/** Declare `household` (and its known spellings) for this transaction. */
async function declareHousehold(client, household) {
  if (household == null || household === "") return;
  const { sessionKeysVia, sessionKeyString } = await import("./household-deriver.mjs");
  const keys = await sessionKeysVia(client, household).catch(() => []);
  const all = [...new Set([String(household), ...keys])];
  await client.query("SELECT set_config('app.household', $1, true)", [String(household)]);
  await client.query("SELECT set_config('app.household_keys', $1, true)", [sessionKeyString(all)]);
}

/**
 * Inside a transaction: is this drop's mark filed? The drop act is read first
 * — its actor, label and ORIGINAL household are the record's, not the
 * caller's — and that household is declared, so a private draft filed there is
 * seen. Then a claim whose own record names this drop act (CLAIM_SQL) in ANY
 * status, or a mark act whose payload names it. Answers `{ slug, claim, status }`
 * (the slug the mark ACTUALLY has) or null. A drop id that is not a drop act
 * answers null for nothing — it throws, since nothing should be undone for it.
 */
export async function filedMarkOf(client, { actId }) {
  const d = await dropOf(client, actId);
  const { actor, label } = d;
  const ref = `act:${String(actId)}`;
  await declareHousehold(client, d.household);
  const { rows: [c] } = await client.query(CLAIM_SQL, [ref, actor, label]);
  if (c) return { slug: c.slug, claim: c.id, status: c.status };
  const { rows: [a] } = await client.query(MARK_ACT_SQL, [ref, actor, label]);
  return a ? { slug: a.object, mark_act: a.id, status: "acted" } : null;
}

const bounce = (code, defect, hint, extra = {}) => Object.assign(new Error(defect), { code, defect, hint, ...extra });

/**
 * THE FILING'S GUARD (the claim side): under the drop's lock, refuse to file
 * the mark of a drop that was already undone — the unit is back in hands.
 */
/** The drop act itself, as the record holds it — its actor, ORIGINAL household and label. */
export async function dropOf(client, actId) {
  const { rows: [d] } = await client.query(DROP_ROW_SQL, [String(actId), UNIT_ACTION.drop]);
  if (!d) throw bounce(404, `act ${actId} is not a set-down`, "only a units:drop act has a mark to look for. Nothing was recorded.");
  const p = typeof d.payload === "string" ? JSON.parse(d.payload) : (d.payload ?? {});
  return { id: String(actId), actor: String(d.actor), household: d.household, label: String(p.label ?? p.moves?.[0]?.label ?? "") };
}

export const dropLiveGuard = ({ actId }) => async (client) => {
  await client.query(LOCK_SQL, [dropLockKey(actId)]);
  const d = await dropOf(client, actId);
  if (await spentBy(client, d.actor, undoNonce(actId))) throw bounce(409, `the set-down of act ${actId} was already undone`,
    "the unit came back to your hands before this mark was filed; set it down again. Nothing was recorded.");
};

/**
 * THE UNDO'S GUARD (the compensation and the recovery): under the drop's lock,
 * refuse when the mark is filed or the drop is already undone. `undoneAlready`
 * and `filed` ride the refusal so the caller can say what actually committed.
 */
export const dropUndoGuard = ({ actId }) => async (client) => {
  await client.query(LOCK_SQL, [dropLockKey(actId)]);
  const d = await dropOf(client, actId);
  const undone = await spentBy(client, d.actor, undoNonce(actId));
  if (undone) throw bounce(409, `the set-down of act ${actId} is already undone`, "the unit is already back. Nothing was recorded.", { undoneAlready: undone });
  const filed = await filedMarkOf(client, { actId });
  if (filed) throw bounce(409, `the set-down of act ${actId} was filed as ${filed.slug} (${filed.status})`,
    "its mark committed, so the unit is on the ground, not back in hands. Nothing was recorded.", { filed });
};

/** The undo act's row, in the hold lane's unit shape, for either writer. */
export function undoEntry({ actId, actor, label, household, why, by = "door" }) {
  return {
    actor, action: UNIT_ACTION.dropUndone, object: null, cls: "holding", household,
    nonce: undoNonce(actId),
    payload: { units: true, moves: [{ from: null, to: actor, label, n: 1 }], label, undoes: String(actId), why: String(why).slice(0, 300), by },
    effect: by === "tick"
      ? `the set-down of act ${actId} was never filed, so 1 ${label} came back to ${actor} (the office tick found it orphaned)`
      : `the set-down's mark could not be filed, so 1 ${label} came back to ${actor}`,
  };
}

// ── THE TICK ─────────────────────────────────────────────────────────────────

// THE CURSOR'S OWN ACT, found by `acts_world_nonce_once` (052): its leading
// columns (COALESCE(household, ''), actor, action) are given exactly — and the
// action as a literal, so the planner can see the index's `action <> 'say'`.
// The nonce carries the low-water id zero-padded, so the greatest nonce is the
// newest cursor in every collation.
const SWEEP_ACTION = UNIT_ACTION.dropSweep;
const pad = (id) => String(id).padStart(20, "0");
export const sweepNonce = (through) => `${SWEEP_ACTION}:${pad(through)}`;
const CURSOR_SQL = `
  SELECT nonce FROM acts
   WHERE COALESCE(household, '') = $1 AND actor = $2 AND action = '${SWEEP_ACTION}' AND action <> 'say' AND nonce IS NOT NULL
   ORDER BY nonce DESC LIMIT 1`;

/** Every drop id at or below this is resolved (filed or undone). "0" before the first sweep. */
export async function dropCursor(client) {
  const { rows: [r] } = await client.query(CURSOR_SQL, [TOWN_HOUSEHOLD, TOWN_PEN]);
  const m = r ? /:(\d+)$/.exec(r.nonce) : null;
  return m ? String(BigInt(m[1])) : "0";
}

// THE DELTA: the drops above the cursor, each with its two resolutions asked
// by nonce. `acts_class_idx (class, id)` ranges from the cursor; nothing at or
// below it is read.
const NEWEST_DROP_SQL = `SELECT max(id)::text AS id FROM acts WHERE class = 'holding' AND action = $1 AND id > $2::bigint`;
const DELTA_SQL = `
  SELECT d.id::text AS id, d.actor, d.household, d.at, d.payload,
         EXISTS (SELECT 1 FROM acts u WHERE u.actor = d.actor AND u.nonce IS NOT NULL AND u.nonce = $4 || ':' || d.id::text) AS undone,
         EXISTS (SELECT 1 FROM acts r WHERE r.actor = d.actor AND r.nonce IS NOT NULL AND r.nonce = $5 || ':' || d.id::text) AS resolved
    FROM acts d
   WHERE d.class = 'holding' AND d.action = $1 AND d.id > $2::bigint AND d.id <= $3::bigint
   ORDER BY d.id`;
const INSERT_UNDO_SQL = `
  INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect, household, nonce)
  VALUES (now(), $1, $2, $3, NULL, 'holding', $4::jsonb, $5, $6, $7)
  ON CONFLICT DO NOTHING
  RETURNING id::text`;

const INSERT_WITHDRAW_UNDO_SQL = `
  INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect, household, nonce)
  VALUES (now(), $1, $2, $3, $4, 'holding', $5::jsonb, $6, $7, $8)
  ON CONFLICT DO NOTHING
  RETURNING id::text`;

const labelOf = (p) => p?.label ?? (Array.isArray(p?.moves) ? p.moves[0]?.label : null) ?? null;

/** The filed drop's one resolution act, in the hold lane's unit shape (no move: the unit is on the ground). */
export function resolvedEntry({ actId, actor, household }) {
  return {
    actor, action: UNIT_ACTION.dropResolved, object: null, cls: "holding", household,
    nonce: resolvedNonce(actId),
    // no slug and no claim status: the act log leaves the box, and a private draft is the household's own
    payload: { units: true, moves: [], resolves: String(actId), as: "filed" },
    effect: `the set-down of act ${actId} is filed as its mark; the office tick has settled it`,
  };
}

/**
 * THE TICK'S RECOVERY: only the delta. The drops above the cursor (ids final,
 * read under the drops' exclusive lock); among them each one NOT YET RESOLVED
 * and older than one tick is decided once, in its own transaction under its
 * own lock: not filed → undone back to its dropper by the undo's nonce; filed
 * → its one `units:drop-resolved` act, so no later tick asks again or names it
 * again. A drop that cannot be decided stays unresolved and is asked next
 * tick. Then the cursor moves up to just below the oldest drop still
 * unresolved (or to the newest drop read), never past one. `now` is
 * injectable. Answers `{ restored, filed, skipped, held, failed, line, work }` —
 * `work` counts what this tick actually read and decided.
 */
export async function recoverOrphanDrops(client, { now = Date.now(), crossing = null, olderThanMs = TICK_MS } = {}) {
  const cutoff = Date.parse(new Date(now - olderThanMs).toISOString());
  const from = await dropCursor(client);
  // the newest drop id, FINAL: no set-down's write is in flight while it is read
  await client.query("BEGIN");
  let upTo;
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [DROPS_LOCK]);
    upTo = (await client.query(NEWEST_DROP_SQL, [UNIT_ACTION.drop, from])).rows[0]?.id ?? null;
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  // `held` is a guard's designed bounce (an `err.defect`): undecided, asked
  // again next tick. `failed` is a write the store would not take (a raw
  // error, or a filed drop whose resolution could not be recorded): it stops the
  // cursor too, but a write that fails every tick is a failure, not a pending
  // decision, and the keep tick reads its segment as refused (POS-627, Wright
  // 10-14, review-612 F2).
  const restored = [], filed = [], skipped = [], held = [], failed = [];
  const work = { from, to: upTo ?? from, read: 0, decided: 0 };
  if (upTo == null) return finish({ client, from, through: from, restored, filed, skipped, held, failed, work, crossing });
  const { rows } = await client.query(DELTA_SQL, [UNIT_ACTION.drop, from, upTo, UNIT_ACTION.dropUndone, UNIT_ACTION.dropResolved]);
  work.read = rows.length;
  let lowest = null; // the oldest drop still unresolved after this tick
  const stillOpen = (id) => { if (lowest == null || BigInt(id) < BigInt(lowest)) lowest = id; };
  for (const d of rows) {
    if (d.undone || d.resolved) continue;
    if (!(Date.parse(new Date(d.at).toISOString()) < cutoff)) { stillOpen(d.id); continue; }   // younger than one tick
    const p = typeof d.payload === "string" ? JSON.parse(d.payload) : (d.payload ?? {});
    const label = labelOf(p);
    // no label: nothing the tick could ever return, so it is named once and the cursor passes it
    if (!label) { skipped.push({ act: d.id, why: "the drop names no label" }); continue; }
    work.decided += 1;
    await client.query("BEGIN");
    try {
      await dropUndoGuard({ actId: d.id })(client);
      const e = undoEntry({ actId: d.id, actor: String(d.actor), label, household: d.household, why: "orphaned: no claim and no undo after one tick", by: "tick" });
      const { rows: ins } = await client.query(INSERT_UNDO_SQL, [crossing, e.actor, e.action, JSON.stringify(e.payload), e.effect, e.household, e.nonce]);
      await client.query("COMMIT");
      if (ins.length) restored.push({ act: d.id, actor: e.actor, label, undo: ins[0].id });
      else skipped.push({ act: d.id, why: "already undone (the nonce was spent)" });
    } catch (err) {
      if (err?.filed) {
        // FILED: its one resolution act, in the transaction that still holds the drop's lock
        try {
          const r = resolvedEntry({ actId: d.id, actor: String(d.actor), household: d.household });
          const { rows: ins } = await client.query(INSERT_UNDO_SQL, [crossing, r.actor, r.action, JSON.stringify(r.payload), r.effect, r.household, r.nonce]);
          await client.query("COMMIT");
          filed.push({ act: d.id, ...err.filed, resolution: ins[0]?.id ?? null });
        } catch (e2) {
          await client.query("ROLLBACK").catch(() => {});
          failed.push({ act: d.id, why: `filed, but its resolution could not be recorded: ${String(e2?.message ?? e2).slice(0, 120)}` });
          stillOpen(d.id);
        }
        continue;
      }
      await client.query("ROLLBACK").catch(() => {});
      if (err?.undoneAlready) { skipped.push({ act: d.id, why: "already undone" }); continue; }
      if (err?.defect) held.push({ act: d.id, why: String(err.defect).slice(0, 160) });
      else failed.push({ act: d.id, why: String(err?.message ?? err).slice(0, 160) });
      stillOpen(d.id);
    }
  }
  const through = lowest == null ? upTo : String(BigInt(lowest) - 1n);
  return finish({ client, from, through, restored, filed, skipped, held, failed, work, crossing });
}

async function finish({ client, from, through, restored, filed, skipped, held, failed = [], work, crossing }) {
  work.cursor = from;
  if (BigInt(through) > BigInt(from)) {
    const effect = `the office tick has settled every set-down through act ${through}`;
    const payload = { units: true, moves: [], through: String(through), from: String(from) };
    await client.query(INSERT_UNDO_SQL, [crossing, TOWN_PEN, SWEEP_ACTION, JSON.stringify(payload), effect, TOWN_HOUSEHOLD, sweepNonce(through)]);
    work.cursor = String(through);
  }
  const line = [
    `drops: restored ${restored.length}${restored.length ? ` (${restored.map((r) => `act ${r.act} → 1 ${r.label} back to ${r.actor}`).join(", ")})` : ""}`,
    ...(filed.length ? [`${filed.length} resolved as filed (${filed.map((f) => `act ${f.act}`).join(", ")})`] : []),
    ...(skipped.length ? [`${skipped.length} skipped (${skipped.map((s) => `act ${s.act}: ${s.why}`).join("; ")})`] : []),
    ...(held.length ? [`${held.length} undecided, asked again next tick (${held.map((h) => `act ${h.act}: ${h.why}`).join("; ")})`] : []),
    ...(failed.length ? [`${failed.length} failed (${failed.map((h) => `act ${h.act}: ${h.why}`).join("; ")})`] : []),
  ].join(" · ");
  return { restored, filed, skipped, held, failed, line, work };
}

// ── THE CARRY COUNT, DURABLY ────────────────────────────────────────────────

const LABEL_OF_DROP = `COALESCE(d.payload->>'label', d.payload->'moves'->0->>'label')`;
// Above the cursor only (`acts_actor_id_idx (actor, id)`): at or below it every
// drop is resolved. Undo and resolution by nonce; the claim and mark-act
// lookups run only for a drop that has neither.
const STILL_OUT_SQL = `
  SELECT count(*)::int AS n FROM acts d
   WHERE d.actor = $2 AND d.id > $5::bigint AND d.class = 'holding' AND d.action = $1 AND d.household IS NOT DISTINCT FROM $4
     AND NOT EXISTS (SELECT 1 FROM acts u WHERE u.actor = d.actor AND u.nonce IS NOT NULL AND u.nonce = $3 || ':' || d.id::text)
     AND NOT EXISTS (SELECT 1 FROM acts r WHERE r.actor = d.actor AND r.nonce IS NOT NULL AND r.nonce = $6 || ':' || d.id::text)
     AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.data->>'dropped' = 'act:' || d.id::text
                       AND c.claimant = d.actor AND c.data->>'label' = ${LABEL_OF_DROP})
     AND NOT EXISTS (SELECT 1 FROM acts m WHERE m.class = 'mark' AND m.action IN ('leave-mark', 'amend')
                       AND m.payload->>'dropped' = 'act:' || d.id::text AND m.actor = d.actor
                       AND m.payload->>'label' = ${LABEL_OF_DROP})`;

/**
 * How many of `actor`'s set-downs are still OUT — neither filed nor undone —
 * read from the store (the dropper's household declared so a private draft
 * counts as filed). Each may yet come back, so the carry cap counts it as held
 * until it is known: the in-memory reservation dies with the process, this
 * does not. Only drops above the tick's cursor are read.
 */
export async function dropsStillOut(client, actor) {
  const from = await dropCursor(client);
  // one count per ORIGINAL household the dropper's drops were recorded under,
  // each read with exactly that house declared (C) — a newer membership does
  // not hide an older house's private draft, and no read sees two houses at once
  const { rows: houses } = await client.query(
    `SELECT DISTINCT household FROM acts WHERE actor = $2 AND id > $3::bigint AND class = 'holding' AND action = $1`, [UNIT_ACTION.drop, String(actor), from]);
  let n = 0;
  for (const { household } of houses) {
    await declareHousehold(client, household);
    const { rows: [r] } = await client.query(STILL_OUT_SQL, [UNIT_ACTION.drop, String(actor), UNIT_ACTION.dropUndone, household, from, UNIT_ACTION.dropResolved]);
    n += r?.n ?? 0;
  }
  return n;
}

// ── A PREPUBLICATION WITHDRAWAL BRINGS THE UNIT BACK (Wright, WLD-27 D) ──────
//
// "Withdrawing a dropped unit before it's published returns the unit to the
// dropper, whether it was a draft or pending … After publication, getting it
// back is a take-back, never a withdraw." And, ruled 2026-10-13T06:44:41Z: the
// return is an ADD to the dropper's hands and obeys the carry cap like every
// add — a full dropper's withdrawal is refused before anything is written
// (world-units.mjs § withdrawDroppedUnit holds the cap, in the hold queue).
//
// The return is the drop's own undo: the same nonce, so it is made once
// whoever comes first — this withdrawal, the door's compensation or the tick —
// and it is written in the WITHDRAWAL'S OWN TRANSACTION, by its guard, before
// the deed and the docket half: the unit comes back exactly when the claim
// goes, or neither happens. A drop the tick already resolved as filed needs no
// fresh tick work: the withdrawal itself is the restoration.

// What a dropped unit's mark IS on the docket: the newest claim at this id by
// this claimant naming a drop act, read under the caller's own household (the
// one whose live layer the withdrawal acts on). `marks` and a locked claim are
// the publication history: either means it crossed, whatever it is now.
const DROP_CLAIM_SQL = `
  SELECT id::text, status, window_id, data->>'dropped' AS dropped, data->>'label' AS label FROM claims
   WHERE slug = $1 AND claimant = $2 AND data->>'dropped' ~ '^act:[1-9][0-9]*$'
   ORDER BY submitted_at DESC LIMIT 1`;
const PUBLISHED_SQL = `
  SELECT EXISTS (SELECT 1 FROM marks WHERE slug = $1)
      OR EXISTS (SELECT 1 FROM claims WHERE slug = $1 AND status = 'locked') AS published`;
const EXITED_SQL = `SELECT id::text FROM acts WHERE object = $1 AND class = 'holding' AND action IN ($2, $3) ORDER BY id LIMIT 1`;

/**
 * The drop behind a mark being withdrawn, proven both ways — the claim names
 * `act:<id>` and that act is a set-down by this mark's own author, of this
 * label — with what the record says of it now. Null for any other mark
 * (a bogus reference, another resident's act, another label: no refund).
 */
export async function droppedUnitOf(client, { mark, by }) {
  const { rows: [c] } = await client.query(DROP_CLAIM_SQL, [String(mark), String(by)]);
  if (!c) return null;
  const actId = c.dropped.slice(4);
  let d;
  try { d = await dropOf(client, actId); } catch { return null; }
  if (d.actor !== String(by) || d.label !== String(c.label) || !d.label) return null;
  const { rows: [p] } = await client.query(PUBLISHED_SQL, [String(mark)]);
  const undone = await spentBy(client, d.actor, undoNonce(actId));
  const { rows: [x] } = await client.query(EXITED_SQL, [String(mark), UNIT_ACTION.takeBack, UNIT_ACTION.consumeInPlace]);
  const { rows: [w] } = await client.query("SELECT id FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1");
  return { mark: String(mark), actId, dropper: d.actor, household: d.household, label: d.label,
    claim: c.id, status: c.status, window: c.window_id, open: w?.id ?? null, published: p.published === true, undone, exited: x?.id ?? null };
}

// THE WITHDRAWAL'S OWN RECORD OF A RETURN (Bevel's first review, R2): the
// undo a withdrawal writes names the mark as its `object` (the door's and the
// tick's undos name none), so a replay finds it by `acts_object_idx (object,
// id)` — whatever the mark is called. A mark filed under another name than
// `<label>-<act id>` is still this unit (CLAIM_SQL's exact `dropped` proof),
// and its replay must not depend on predicting the name.
const WITHDRAW_UNDO_SQL = `
  SELECT id::text, nonce, payload FROM acts
   WHERE object = $1 AND class = 'holding' AND action = $2 AND actor = $3
   ORDER BY id DESC LIMIT 1`;
// A later GENERATION of the same id — a mark left again under it — is not this
// withdrawal's to answer for: its deed after the undo, or a claim that still
// stands (a draft has no deed, by law, so its claim is what says it exists).
const LATER_DEED_SQL = `SELECT 1 FROM acts WHERE object = $1 AND class = 'mark' AND action IN ('leave-mark', 'amend') AND id > $2::bigint LIMIT 1`;
// A CLAIM THAT STILL STANDS: a draft, a pending claim, one the candle has
// locked, or one held for review. A refused claim and a retracted one never
// publish. ONE definition of "your draft" (POS-689, Darko 2026-10-18): the hold
// door's in-house check reads this same set through `standingClaim`.
export const STANDING_CLAIM_STATUSES = Object.freeze(["draft", "pending", "locked", "held_review"]);
export const standingClaim = (row) => STANDING_CLAIM_STATUSES.includes(row?.status);
const STANDING_CLAIM_SQL = `SELECT 1 FROM claims WHERE slug = $1 AND claimant = $2 AND status IN (${STANDING_CLAIM_STATUSES.map((s) => `'${s}'`).join(", ")}) LIMIT 1`;

/**
 * A WITHDRAWAL ALREADY MADE, ASKED AGAIN: the undo this mark's own withdrawal
 * wrote, found by the mark it names, and proved back to its drop — the undo's
 * nonce is that drop's, the drop is this author's, of this label. Nothing is
 * read off the mark's name. Null when there is none, or when the id has since
 * been left again (another generation). `{ act, label }` or null.
 */
export async function returnedByWithdrawal(client, { mark, by }) {
  const { rows: [u] } = await client.query(WITHDRAW_UNDO_SQL, [String(mark), UNIT_ACTION.dropUndone, String(by)]);
  if (!u) return null;
  const p = typeof u.payload === "string" ? JSON.parse(u.payload) : (u.payload ?? {});
  if (p.by !== "withdraw" || p.mark !== String(mark) || !/^[1-9][0-9]*$/.test(String(p.undoes ?? ""))) return null;
  if (u.nonce !== undoNonce(p.undoes)) return null;
  let d;
  try { d = await dropOf(client, p.undoes); } catch { return null; }
  if (d.actor !== String(by) || d.label !== String(p.label)) return null;
  if ((await client.query(LATER_DEED_SQL, [String(mark), u.id])).rows.length) return null;
  if ((await client.query(STANDING_CLAIM_SQL, [String(mark), String(by)])).rows.length) return null;
  return { act: u.id, label: d.label, drop: d.id };
}

/** A dropped unit's claim the withdrawal will delete (a draft) or retract (pending in the open window). */
export const prepublication = (u, openWindow = u?.open) => Boolean(u) && !u.published && (u.status === "draft" || (u.status === "pending" && openWindow != null && Number(u.window) === Number(openWindow)));

export const takeBackRefusal = (mark) => bounce(409, `"${mark}" is a set-down unit that has been published — it is taken back, not withdrawn`,
  `a published unit comes back into your hands by taking it back: world_hold { thing: "${mark}" } (or consume it where it stands). Withdrawing it would leave the unit nowhere. Nothing was recorded.`);

/**
 * THE WITHDRAWAL'S GUARD for a dropped unit's mark: in the withdrawal's own
 * transaction, under the candle (shared, as every docket write: a clearing
 * either published it first or waits for this to commit) and the drop's lock,
 * the record is read again and decides — published → refused, take-back;
 * a draft or a pending claim on the open window, not undone, not exited → the
 * drop's undo is written back to its ORIGINAL dropper, under the drop's own
 * household, once by its nonce. `out` receives what happened, for the receipt.
 */
// THE CLAIM THE WITHDRAWAL'S DOCKET HALF WILL REMOVE, asked with that half's
// own predicates (world2-claims.mjs § claimTxFromJournal, withdraw): a draft by
// its slug, claimant and declared house keys (it is DELETED); a pending claim
// on the open window by `geometry->>'slug'` and claimant (it is RETRACTED).
// The unit comes back only when the very statement that follows in this
// transaction removes this drop's claim — never beside a claim left standing.
const REMOVED_DRAFT_SQL = `
  SELECT 1 FROM claims WHERE status = 'draft' AND slug = $1 AND claimant = $2 AND household = ANY($3) AND data->>'dropped' = $4 LIMIT 1`;
const RETRACTED_PENDING_SQL = `
  SELECT 1 FROM claims WHERE window_id = $1 AND status = 'pending' AND geometry->>'slug' = $2 AND claimant = $3 AND data->>'dropped' = $4 LIMIT 1`;
async function docketHalfRemoves(client, u) {
  const ref = `act:${u.actId}`;
  if (u.status === "draft") {
    const { declaredKeys } = await import("./world2-claims.mjs");
    return (await client.query(REMOVED_DRAFT_SQL, [u.mark, u.dropper, await declaredKeys(client, null), ref])).rows.length > 0;
  }
  return u.open != null && (await client.query(RETRACTED_PENDING_SQL, [u.open, u.mark, u.dropper, ref])).rows.length > 0;
}

export const withdrawRestoreGuard = ({ mark, by, crossing = null, withdrawnBy = null, out = {} }) => async (client) => {
  const { DOOR_SHARES_THE_CANDLE } = await import("../world2/tools/candle-lock.mjs");
  await client.query(DOOR_SHARES_THE_CANDLE);
  const first = await droppedUnitOf(client, { mark, by });
  if (!first) { out.restored = 0; return; }
  await client.query(LOCK_SQL, [dropLockKey(first.actId)]);
  const u = await droppedUnitOf(client, { mark, by }); // again, now that the drop is ours
  if (u.published) throw takeBackRefusal(mark);
  if (!prepublication(u) || u.undone || u.exited || !(await docketHalfRemoves(client, u))) { out.restored = 0; out.unit = u; return; }
  const payload = { units: true, moves: [{ from: null, to: u.dropper, label: u.label, n: 1 }], label: u.label, undoes: u.actId,
    why: `withdrawn before publication (${u.status})`, by: "withdraw", mark: u.mark, ...(withdrawnBy ? { withdrawn_by: String(withdrawnBy) } : {}) };
  const effect = `${u.mark} was withdrawn before it was published, so 1 ${u.label} came back to ${u.dropper}`;
  // the undo names the mark it came back from (`object`), so a replay finds it by the mark, not by its name (R2)
  const { rows: ins } = await client.query(INSERT_WITHDRAW_UNDO_SQL,
    [crossing, u.dropper, UNIT_ACTION.dropUndone, u.mark, JSON.stringify(payload), effect, u.household, undoNonce(u.actId)]);
  out.restored = ins.length ? 1 : 0;
  out.act = ins[0]?.id ?? null;
  out.unit = u;
};
