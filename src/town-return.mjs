// town-return.mjs — THE TOWN HANDS BACK THE STAMPS ON A MARK IT REMOVES (POS-1138).
//
// Darko, 2026-11-18 15:0x EST: stamps staked on a town-opposed mark go "Back to
// each staker" when it leaves, the owner included. 16:3x: "Town-authored
// return", a new act by the town's hand, recorded as the town's. The Town's half
// is POS-1139: the ledger line `for: town-return:S<n>`, its verifier law, and
// `tools/world-stake.mjs § worldTownReturnApply(repo, { marks, removal, date },
// keyPem)`, which reads every open position on the named marks AT THE CALL and
// appends one signed batch returning each staker their whole raw principal, or
// nothing when nothing is open. This file is the settlement's side of it.
//
// ── WHICH RETURNS ARE THE TOWN'S ─────────────────────────────────────────────
//
// A town STANCE return, and nothing else: an entry of the World's `returned`
// whose authority is the town's (consent.mjs names a town veto "the town
// (absolute)") and which cites no law. A limit is the town's opposition too,
// but it cites its law (world-settlement.mjs § foldWithWords) and leaves
// whatever its escrow, by the limits' own rule; a holder's or the commons'
// return keeps the escrow guard and stands while staked. Neither is a town
// return here. What leaves with a town return is the mark and the engine's
// `subtree` (ruling B: the mark continued), so those are the marks whose stamps
// go home; a child in `stays` stands with its own stakes.
//
// ── ONLY THE REAL CROSSING WRITES (Wright, 2026-11-19 00:35Z, A) ─────────────
//
// "only on a real, non-dry crossing: it checks that SETTLEMENT_DRY is unset and
// passes an explicit write flag from the real path, never inferred from the
// script's name." Both, literally (§ townReturnWrite): the flag, and no
// SETTLEMENT_DRY in the environment at all, whatever its value. The shadow and
// every rehearsal call the same tool without the flag, so they never pay.
//
// ── THE GATE: THE CROSSING DOES NOT TAKE A MARK AWAY WHILE STAMPS STAND ON IT ─
//
// The return is the progress; the gate is the crossing's write boundary, and it
// does not trust the return. A town return leaves git only when every mark it
// takes has no open position in the LIVE ledger, read after the return. A
// return that was not written, failed, was refused by the pin, or could not
// land leaves its stakes open, so this crossing does not take the mark away and
// says why on its receipt. When the live ledger cannot be read at all, a target
// leaves only if this crossing's own successful write read every mark closed
// under its locks; otherwise nothing leaves, whether or not a write was asked
// for (reviews of #1143, F1 and F2). A zero at the snapshot is no evidence:
// stamps may have been staked since, and a run that writes no return may still
// publish (SETTLEMENT_DRY=0 or empty).

import { execUnderTownLock, lockTimedOut, withTownLockHeld, LOCK_BUSY } from "./town-lock.mjs";
import { importTownTool, isPinStop } from "./town-tool.mjs";
import { faultLogged } from "./fault-words.mjs"; // the office's own words for its own fault (POS-578)
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The authority consent.mjs writes on a return the town's word made. */
export const TOWN_AUTHORITY = "the town (absolute)";

/** A day in town time, the date a ledger line carries (TOWN_TZ, as every pen act's). */
export const townDate = (at = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(at);

/** A removal is named by its settlement: `S<n>`, as the Town's line carries it. */
export const removalOf = (n) => {
  const k = Number(n);
  if (!Number.isInteger(k) || k < 1) throw new Error(`a removal is named by its settlement number, got ${JSON.stringify(n)}`);
  return `S${k}`;
};

/**
 * MAY THIS RUN WRITE THE TOWN'S RETURN? `{ write: true }` only when the real
 * path asked for it (`flag`) AND the environment carries no SETTLEMENT_DRY at
 * all: "unset", literally, so "1", "0" and "" all refuse. Otherwise
 * `{ write: false, why }`. PURE over its arguments; never reads a script name.
 */
export function townReturnWrite({ flag, env = process.env }) {
  if (!flag) return { write: false, why: "this run did not ask to write the town's return (no --town-returns), so nothing was written: the gate alone decided" };
  if (Object.prototype.hasOwnProperty.call(env, "SETTLEMENT_DRY"))
    return { write: false, why: `SETTLEMENT_DRY is set (${JSON.stringify(env.SETTLEMENT_DRY)}), so this is no real crossing and nothing was written: the gate alone decided` };
  return { write: true };
}

/**
 * The town's stance returns in a World: `[{ mark, leaving }]`, sorted, where
 * `leaving` is the mark and the subtree the engine named. PURE. A return still
 * `pending-escrow` (an engine that keeps the escrow guard for the town) is not
 * leaving, so it is not here.
 */
export function townReturnTargets(state) {
  const out = [];
  for (const r of state?.returned ?? []) {
    if (r?.state !== "returned" || r.law || r.authority !== TOWN_AUTHORITY) continue;
    const mark = String(r.mark);
    out.push({ mark, leaving: [...new Set([mark, ...(r.subtree ?? []).map(String)])].sort() });
  }
  return out.sort((a, b) => a.mark.localeCompare(b.mark));
}

/**
 * The returns that wait: each target with a mark it takes still carrying open
 * stamps, `[{ mark, leaving, open: { <mark>: n } }]`. PURE.
 */
export function heldTownReturns(targets, open) {
  const held = [];
  for (const t of targets) {
    const standing = t.leaving.filter((m) => (open.get(m) ?? 0) > 0);
    if (standing.length) held.push({ ...t, open: Object.fromEntries(standing.map((m) => [m, open.get(m)])) });
  }
  return held;
}

/**
 * THE LIVE LEDGER, READ SETTLED: `{ open }`, stamps open per mark, from the
 * town clone's HEAD through the office's pinned engine, under town.lock
 * SHARED, so every writer (they hold it exclusively for their append and its
 * landing) has finished. Throws when the clone, the pin or the lock does not
 * answer; the caller then knows nothing of what is open.
 */
export async function liveLedgerOpen(townClone, { held = withTownLockHeld, waitSec = 10 } = {}) {
  if (!townClone) throw new Error("no town clone to read the ledger in");
  return held(async ({ signal }) => {
    const { worldStakeState } = await importTownTool(townClone, "world-stake.mjs");
    if (signal?.aborted) throw new Error("the town lock was let go before the ledger was read");
    const open = new Map();
    for (const [key, n] of worldStakeState(townClone).positions) {
      const mark = key.slice(0, key.lastIndexOf("|"));
      if (n > 0) open.set(mark, (open.get(mark) ?? 0) + n);
    }
    return { open };
  }, { shared: true, waitSec });
}

/**
 * Why the live ledger did not answer, in the office's own words: the pin's
 * stop, a refusal's own defect (a busy or untakeable lock), or a fault, whose
 * text goes to the office's log (POS-578), never into an answer.
 */
export function unreadSaid(e) {
  if (isPinStop(e)) return "the town's engine is not the one the office pinned";
  if (e?.defect) return String(e.defect);
  faultLogged("the live ledger could not be read", e);
  return "the live ledger could not be read (the office's log says why)";
}

/**
 * The gate's reading: the live ledger when it answers; when it does not,
 * nothing (`open: null`, `unread` says why). `{ open, source, unread? }`.
 */
export async function townReturnOpen({ townClone, read = liveLedgerOpen }) {
  try {
    const live = await read(townClone);
    return { ...live, source: "live" };
  } catch (e) {
    return { open: null, source: "unread", unread: unreadSaid(e) };
  }
}

/**
 * ONE REMOVAL'S RETURN, written by the office pen: town-return-exec.mjs under
 * the town lock (exclusive, as every ledger write), its one JSON answer. Never
 * throws: a refusal, a busy lock or a tripped exec is `{ error }`, and the gate
 * reads the stakes as they stand.
 */
export async function runTownReturn({ marks, removal, date }, { townClone, exec = execUnderTownLock, env = process.env } = {}) {
  let out;
  try {
    out = await exec(join(HERE, "town-return-exec.mjs"), JSON.stringify({ marks, removal, date }), { ...env, ...(townClone ? { TOWN_CLONE: townClone } : {}) });
  } catch (e) {
    if (lockTimedOut(e)) return { error: { code: LOCK_BUSY.code, defect: LOCK_BUSY.defect } };
    return { error: { code: 500, defect: "the town's return could not be run", hint: faultLogged("the town's return could not be run", e) } };
  }
  try { return JSON.parse(String(out).trim().split("\n").pop()); }
  catch { return { error: { code: 500, defect: "the town's return answered nothing readable" } }; }
}

/**
 * What a write's own answer establishes: stamps open per mark as the exec read
 * them under the same locks as its append, right after it landed, when the
 * write SUCCEEDED and named every mark the targets take; otherwise null (it
 * establishes nothing). PURE.
 */
export function closedByReceipt(receipt, targets) {
  if (!receipt || receipt.error || typeof receipt.open_after !== "object" || receipt.open_after == null) return null;
  const open = new Map();
  for (const m of new Set(targets.flatMap((t) => t.leaving))) {
    const n = receipt.open_after[m];
    if (!Number.isInteger(n) || n < 0) return null;
    if (n > 0) open.set(m, n);
  }
  return open;
}

/**
 * THE CROSSING'S RETURN AND ITS GATE, in that order. `targets` are this
 * settlement's town returns; `removal` and `date` its seal's (the caller's to
 * establish, never a receipt's). With `write` (the real crossing) the removal
 * is returned first, all its marks in one signed batch; then the ledger is read
 * and every target still carrying stamps is held. `write: null` returns nothing
 * and only reads. → `{ removal, date, receipt?, held, source, unread? }`;
 * `receipt` is the exec's answer as it gave it.
 *
 * THE SNAPSHOT NEVER RELEASES A TARGET (reviews of #1143, F1 and F2): a zero
 * at the snapshot's ledger position says nothing of stamps staked since, and a
 * run that writes no return may still publish. When the live ledger cannot be
 * read, a target leaves only if this run's own successful write establishes it
 * closed (§ closedByReceipt); otherwise every target is held, `open: null`, as
 * unknown, whether or not a write was asked for.
 */
export async function settleTownReturns({ targets, removal, date, townClone, write = null, read = liveLedgerOpen }) {
  let receipt = null;
  if (write && targets.length)
    receipt = await write({ marks: [...new Set(targets.flatMap((t) => t.leaving))].sort(), removal, date });
  const after = await townReturnOpen({ townClone, read });
  let held, source = after.source;
  if (after.source === "live") held = heldTownReturns(targets, after.open);
  else {
    const closed = closedByReceipt(receipt, targets);
    if (closed) { held = heldTownReturns(targets, closed); source = "receipt"; }
    else {
      held = targets.map((t) => ({ ...t, open: null }));
      source = "unknown";
    }
  }
  return {
    removal, date,
    ...(receipt ? { receipt } : {}),
    held, source,
    ...(after.unread ? { unread: after.unread } : {}),
    ...(source === "unknown" ? { unknown: "the live ledger could not be read and no write of this run read the marks closed, so no town return is known to be closed and none is taken away" } : {}),
  };
}
