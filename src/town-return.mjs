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
// ── THE GATE: NO MARK LEAVES WHILE STAMPS STAND ON IT ────────────────────────
//
// The return is the progress; the gate is the safety, and it does not trust
// the return. A town return leaves (git, and the served World) only when every
// mark it takes has no open position in the LIVE ledger. A return that was not
// written, failed, was refused by the pin, or could not land leaves its stakes
// open, so the mark stays where it stands and the next settlement asks again.
// When the live ledger cannot be read at all, the fold's own stakes (the
// snapshot's ledger position) decide instead: a staked return waits and an
// unstaked one leaves, which is exactly what the settlement did before this.
//
// ── A STAKE THAT ARRIVES LATE ────────────────────────────────────────────────
//
// The stake door asks published canon, so a stake can still land on a mark
// between its return and the World that drops it. Such a mark is no longer in
// the settlement's sources, so no town return names it again; the ledger does.
// Every mark the ledger shows the town has returned, that the settlement no
// longer holds and that has stamps open, is returned again under its own
// removal (§ lateTownReturns): the late stake goes home at the next crossing.

import { execUnderTownLock, lockTimedOut, withTownLockHeld, LOCK_BUSY } from "./town-lock.mjs";
import { importTownTool, isPinStop } from "./town-tool.mjs";
import { faultLogged } from "./fault-words.mjs"; // the office's own words for its own fault (POS-578)
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The authority consent.mjs writes on a return the town's word made. */
export const TOWN_AUTHORITY = "the town (absolute)";

/** Today in town time, the date a ledger line carries (TOWN_TZ, as every pen act's). */
export const townDate = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(now);

/** A removal is named by its settlement: `S<n>`, as the Town's line carries it. */
export const removalOf = (n) => {
  const k = Number(n);
  if (!Number.isInteger(k) || k < 1) throw new Error(`a removal is named by its settlement number, got ${JSON.stringify(n)}`);
  return `S${k}`;
};

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

/** Stamps open per mark from stake rows (`{ mark, n }`), the fold's own input. PURE. */
export function openFromStakes(stakes) {
  const open = new Map();
  for (const s of stakes ?? []) {
    const n = Number(s?.n ?? 0);
    if (n > 0) open.set(String(s.mark), (open.get(String(s.mark)) ?? 0) + n);
  }
  return open;
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
 * THE LIVE LEDGER, READ SETTLED: `{ open, returnedBy }` from the town clone's
 * HEAD through the office's pinned engine, under town.lock SHARED, so every
 * writer (they hold it exclusively for their append and its landing) has
 * finished. `open` is stamps open per mark; `returnedBy` maps each mark the
 * ledger shows the town has returned to the newest removal that returned it.
 * Throws when the clone, the pin or the lock does not answer; the caller then
 * falls back to the fold's own stakes.
 */
export async function liveLedgerOpen(townClone, { held = withTownLockHeld, waitSec = 10 } = {}) {
  if (!townClone) throw new Error("no town clone to read the ledger in");
  return held(async ({ signal }) => {
    const { worldStakeState } = await importTownTool(townClone, "world-stake.mjs");
    const { classifyEntry } = await importTownTool(townClone, "stamp-mint.mjs");
    if (signal?.aborted) throw new Error("the town lock was let go before the ledger was read");
    const state = worldStakeState(townClone);
    const open = new Map();
    for (const [key, n] of state.positions) {
      const mark = key.slice(0, key.lastIndexOf("|"));
      if (n > 0) open.set(mark, (open.get(mark) ?? 0) + n);
    }
    const returnedBy = new Map();
    for (const e of state.entries) {
      const c = classifyEntry(e.canonical);
      if (c.kind === "world-town-return") returnedBy.set(c.mark, c.removal);
    }
    return { open, returnedBy };
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
 * The gate's reading: the live ledger when it answers, the fold's own stakes
 * when it does not (`unread` says why). `{ open, returnedBy, source, unread? }`.
 */
export async function townReturnOpen({ townClone, stakes, read = liveLedgerOpen }) {
  try {
    const live = await read(townClone);
    return { ...live, source: "live" };
  } catch (e) {
    return {
      open: openFromStakes(stakes), returnedBy: new Map(), source: "snapshot",
      unread: unreadSaid(e),
    };
  }
}

/**
 * Marks the town returned before, that the settlement no longer holds and that
 * carry open stamps again: `[{ removal, marks }]` by removal. PURE.
 */
export function lateTownReturns({ open, returnedBy }, holds) {
  const byRemoval = new Map();
  for (const [mark, removal] of returnedBy) {
    if (holds.has(mark) || !((open.get(mark) ?? 0) > 0)) continue;
    if (!byRemoval.has(removal)) byRemoval.set(removal, []);
    byRemoval.get(removal).push(mark);
  }
  return [...byRemoval].map(([removal, marks]) => ({ removal, marks: marks.sort() }))
    .sort((a, b) => a.removal.localeCompare(b.removal, undefined, { numeric: true }));
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
 * THE SETTLEMENT'S RETURNS AND ITS GATE, in that order. `targets` are the
 * settlement's town returns, `removal` its `S<n>`, `holds` every mark its
 * sources hold. With `write` (the crossing that removes them) each removal is
 * returned first: this settlement's, then any late one. Then the ledger is read
 * and every target still carrying stamps is held. `write: null` returns
 * nothing and only reads (a rehearsal, a reader). → `{ removal, receipts, held,
 * source, unread? }`; `receipts` are the exec's answers, one per removal.
 */
export async function settleTownReturns({ targets, removal, date, holds = new Set(), townClone, stakes = [], write = null, read = liveLedgerOpen }) {
  const receipts = [];
  if (write) {
    const before = await townReturnOpen({ townClone, stakes, read });
    const runs = [];
    if (targets.length) runs.push({ removal, marks: [...new Set(targets.flatMap((t) => t.leaving))].sort() });
    if (before.source === "live") for (const late of lateTownReturns(before, holds)) runs.push({ ...late, late: true });
    for (const r of runs) {
      const answer = await write({ marks: r.marks, removal: r.removal, date });
      receipts.push({ removal: r.removal, ...(r.late ? { late: true } : {}), marks: r.marks, ...answer });
    }
  }
  const after = await townReturnOpen({ townClone, stakes, read });
  return {
    removal, receipts,
    held: heldTownReturns(targets, after.open),
    source: after.source,
    ...(after.unread ? { unread: after.unread } : {}),
  };
}
