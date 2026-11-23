#!/usr/bin/env node
// settlement-seal.mjs — THE SETTLEMENT CROSSING PAYS EACH SAVED DECISION'S RETURNS, THEN SEALS IT, IN NUMBER ORDER (POS-1025/d).
//
//   node world2/tools/settlement-seal.mjs --through <window> --town-clone <clone> [--town-returns] [--dry-run]
//   env: WORLD2_CLEARING_URL = postgres://clearing_job:… (reads the decisions, writes the seals), the office pen's env for the
//        town's return (STAMP_KEY, TOWN_LOCK, …; src/town-return.mjs § runTownReturn)
//
//   EXIT: 0 sealed (or nothing to seal, or dry) · 1 BLOCKED or refused (by name, nothing sealed past it) · 2 cannot run
//
// ── THE RULINGS ─────────────────────────────────────────────────────────────
//
// Darko 2026-11-21 21:17 EST, POS-1025/d: "Save first, then pay." Wright 02:20Z: "Before any stamps move, the settlement durably
// records what it decided, so a retry repeats the same removals. Each payback carries a town-owned once-only id. Stakers are paid
// at the same moment as today, and POS-1138's rule is unchanged." Wright 03:26Z: "Windows keep closing (the candle stays
// independent), and the office seals the saved decisions in number order, so a blocked return holds the later seals until it
// clears", and "A held seal is a blocked settlement, and it alarms like one."
//
// ── WHAT IT DOES ────────────────────────────────────────────────────────────
//
// The clearing saves each window's decision (095 § 4, settlement_decisions): the header exactly as it will be sealed, the
// removal's day, and the town returns its removal makes. This tool, in the settlement crossing (the office's unit, which holds the
// town pen and the shared clearing pen), takes the saved decisions not sealed yet, lowest number first, up to `--through`:
//
//   1 · PAY. A decision with town returns pays them through POS-1138's writer (src/town-return.mjs § settleTownReturns →
//       runTownReturn → town-return-exec.mjs → the town's worldTownReturnApply), naming the SAVED removal `S<n>` and the SAVED
//       day, never this run's clock. The town's writer is once-only per removal (POS-1175: a repeat writes nothing and names the
//       first), so a retry after a failed seal pays nobody twice. Only with `--town-returns` and SETTLEMENT_DRY absent from the
//       environment (§ townReturnWrite, Wright 2026-11-19: "only on a real, non-dry crossing").
//   2 · THE GATE, unchanged (POS-1138): the live ledger is read after the return, and a mark still carrying stamps, or a ledger
//       that cannot be read with no write of this run reading the marks closed, HOLDS the return. A held return is a BLOCKED
//       settlement (Rivet 2026-11-22 03:47Z: "town-return held/unknown blocks the header; it does NOT become a different sealed
//       held-list removal outcome"): nothing is sealed for it or after it, the answer names its removal, its stakers and the
//       reason, and the next crossing retries the same decision. The decision is never changed and nothing is saved twice.
//   3 · SEAL. The saved header copied into world_snapshots, nothing read live (world-snapshot-seal.mjs § sealDecision), in its own
//       transaction, refused if an earlier decision is still unsealed.
//
// While a decision with town returns waits for its seal, the stake door refuses new stakes on the marks it removes (POS-1177/a,
// Darko 2026-11-21 23:46 EST: "Yes, refuse them"; mark-stake-lock.mjs § pendingRemovalOf), so the one return pays every stake
// there is, and the gate reads them home.
//
// DRY (`--dry-run`, or no `--town-returns`): nothing is paid, so nothing is sealed. The answer names what each decision would pay
// and seal; a decision with returns and no writer is never sealed.

import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { removalOf, settleTownReturns, liveLedgerOpen, townReturnWrite, runTownReturn } from "../../src/town-return.mjs";
import { sealDecision, UNSEALED_DECISIONS_SQL } from "./world-snapshot-seal.mjs";

export class SealRefusal extends Error {
  constructor(reason, detail, fields = {}) { super(`${reason}: ${detail}`); this.reason = reason; this.detail = detail; Object.assign(this, fields); }
}

const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

/** Why a held return blocks its seal, in one sentence, from the gate's own answer. PURE. */
export function blockedReason(settled) {
  const err = settled?.receipt?.error;
  if (err) return `the town's return did not land (${err.code ?? "?"}: ${err.defect ?? "no defect named"}), so its stamps are not home`;
  const marks = (settled?.held ?? []).flatMap((h) => Object.entries(h.open ?? {}).map(([m, n]) => `${m} (${n}✦)`));
  const standing = `stamps still stand on ${marks.join(", ") || "its marks"}, so the mark cannot leave yet (POS-1138)`;
  if (settled?.not_written) return `${settled.not_written}; ${settled.source === "unknown" ? settled.unknown : standing}`;
  if (settled?.source === "unknown") return settled.unknown;
  return `${standing} after the return`;
}

/**
 * Pay and seal the saved decisions through window `through`, in number order. `client` is the clearing pen's connection
 * (`query`); each seal is its own transaction. `write` is the town's writer (null: this run pays nothing); `read` the gate's
 * ledger read. → `{ status: "sealed"|"nothing-to-seal"|"dry"|"blocked", sealed: [...], blocked?, waiting? }`.
 */
export async function sealSaved(client, { through, townClone = null, write = null, why = null, read = liveLedgerOpen, dryRun = false } = {}) {
  const q = (t, a) => client.query(t, a);
  const { rows } = await q(UNSEALED_DECISIONS_SQL);
  const due = rows.filter((d) => through == null || Number(d.window_id) <= Number(through));
  if (dryRun) {
    return { status: "dry", sealed: [], would: due.map((d) => {
      const returns = parse(d.town_returns) ?? [];
      return { window: Number(d.window_id), settlement: Number(d.settlement), day: d.day, digest: parse(d.header).digest,
        ...(returns.length ? { would_pay: { removal: removalOf(d.settlement), date: d.day, marks: [...new Set(returns.flatMap((r) => r.leaving))].sort() } } : {}) };
    }) };
  }
  const sealed = [];
  for (const d of due) {
    const returns = parse(d.town_returns) ?? [];
    let paid = null;
    if (returns.length) {
      // Without a writer (SETTLEMENT_DRY set to anything, or no --town-returns) nothing is paid and the gate alone decides, as on
      // w48: a mark with stamps still on it holds the return, and its seal waits. Refund before removal (POS-1138).
      const settled = await settleTownReturns({ targets: returns, removal: removalOf(d.settlement), date: d.day, townClone, write, read });
      if (settled.held.length) {
        return { status: "blocked", sealed, blocked: blockedOf(d, { ...settled, ...(write ? {} : { not_written: why ?? "this run writes no town return" }) }),
          waiting: due.filter((x) => Number(x.settlement) > Number(d.settlement)).map((x) => ({ window: Number(x.window_id), settlement: Number(x.settlement) })) };
      }
      paid = paidOf(settled);
    }
    sealed.push({ ...(await sealOne(q, d)), ...(paid ? { town_return: paid } : {}) });
  }
  return { status: sealed.length ? "sealed" : "nothing-to-seal", sealed };
}

/** One seal, in its own transaction. */
async function sealOne(q, d) {
  await q("BEGIN");
  try {
    const h = await sealDecision(q, { windowId: Number(d.window_id) });
    await q("COMMIT");
    return { window: Number(d.window_id), settlement: Number(h.sealed_settlement), digest: h.digest, snapshot: Number(h.id), sealed_now: h.sealed_now };
  } catch (e) {
    await q("ROLLBACK").catch(() => {});
    throw new SealRefusal(e.reason ?? "seal-failed", `S${d.settlement} (window ${d.window_id}) could not be sealed: ${String(e?.message ?? e).slice(0, 400)}`);
  }
}

/** What the town's return paid, from its own receipt: the once-only id, and the first return when this was a repeat. */
function paidOf(settled) {
  const r = settled.receipt ?? null;
  return {
    removal: settled.removal, date: settled.date, source: settled.source,
    ...(r?.id ? { id: r.id } : {}),
    ...(r && "already_returned" in r ? { already_returned: r.already_returned === true } : {}),
    ...(r?.first ? { first: r.first } : {}),
    returned: r?.returned ?? [], total: r?.total ?? 0,
    ...(r?.commit ? { commit: r.commit } : {}),
  };
}

/** The blocked settlement, as the receipt and the alarm name it: its removal, each held mark with its stakers, and the reason. */
function blockedOf(d, settled) {
  return {
    settlement: Number(d.settlement), window: Number(d.window_id), removal: removalOf(d.settlement), day: d.day,
    held: (settled.held ?? []).map((h) => ({ mark: h.mark, leaving: h.leaving, open: h.open ?? null, ...(h.stakers ? { stakers: h.stakers } : {}) })),
    reason: blockedReason(settled),
    source: settled.source ?? null,
    ...(settled.unread ? { unread: settled.unread } : {}),
    ...(settled.receipt ? { receipt: settled.receipt } : {}),
  };
}

// ── the CLI ─────────────────────────────────────────────────────────────────

const argOf = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };

async function main() {
  const throughArg = argOf("--through");
  const through = throughArg == null ? null : Number(throughArg);
  const townClone = argOf("--town-clone");
  const dryRun = process.argv.includes("--dry-run");
  if (throughArg == null || !Number.isInteger(through)) {
    console.error("usage: settlement-seal.mjs --through <window> --town-clone <clone> [--town-returns] [--dry-run]"); process.exit(2);
  }
  if (!process.env.WORLD2_CLEARING_URL) { console.error("WORLD2_CLEARING_URL missing (role clearing_job)"); process.exit(2); }
  // THE WRITER, ONLY ON A REAL CROSSING (POS-1138; Wright 2026-11-19 00:35Z, A): the flag, and no SETTLEMENT_DRY at all.
  const asked = townReturnWrite({ flag: process.argv.includes("--town-returns"), env: process.env });
  const write = asked.write && !dryRun ? (a) => runTownReturn(a, { townClone, env: process.env }) : null;
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.WORLD2_CLEARING_URL });
  await client.connect();
  let out;
  try {
    out = await sealSaved(client, { through, townClone, write, why: asked.why, dryRun });
  } catch (e) {
    out = e instanceof SealRefusal
      ? { status: "refused", refused: e.reason, detail: e.detail }
      : { status: "refused", refused: "seal-tripped", detail: String(e?.message ?? e).slice(0, 600) };
  } finally {
    await client.end().catch(() => {});
  }
  console.log(JSON.stringify(out, null, 1));
  process.exit(out.status === "refused" || out.status === "blocked" ? 1 : 0);
}

const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (invokedDirectly) await main();
