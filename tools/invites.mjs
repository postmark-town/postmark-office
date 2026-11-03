#!/usr/bin/env node
// invites.mjs — Bring a neighbour, the operator's read (POS-576, POS-816).
//
//   node tools/invites.mjs [--town <town-clone>] [--since <ISO instant>] [--json]
//
//   env: WORLD2_PG_URL (or PG*), the office's own store; TOWN_CLONE stands in for
//        --town. Reads households (085's invited_by), ashore (071),
//        town_letters, marks/windows and invite_holds (087), and the town's
//        ledger; writes nothing.
//
// ── WHAT IT IS NOW ──────────────────────────────────────────────────────────
// Until 2026-11-03 this was the list Wright minted from by hand at each
// settlement. Since POS-816 the office pays both sides by rule
// (deploy/invite-pass.mjs), and this is the SAME plan the pass pays from
// (src/invite-pay.mjs § planInvitePay), read against the town's ledger: per
// invitation, whether the invited household's 5 more is paid, owed or waiting
// for its welcome, and whether its inviter's 10 is paid, owed, in its week,
// held, cancelled, over this month's cap, or still waiting for the first
// letter or home. So the report and the ledger agree by construction: a side
// the ledger pays reads PAID here, from the ledger's own line.
//
// Without a town clone it cannot see what is paid, and it says so on every run.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { planInvitePay, currentSlugOf, settlementAtOrAfter, activationOf, INVITE_CAP_PER_MONTH } from "../src/invite-pay.mjs";
import { inviteStoreFacts, townInviteLedger } from "../src/invite-facts.mjs";

export { currentSlugOf, activationOf };
/** The settlement that closes the window an instant falls in: the next 06:00 or 18:00 UTC, at or after it. */
export const windowOf = settlementAtOrAfter;

/** A ledger with nothing read: what the plan stands on when no town clone was given. */
export const UNREAD_LEDGER = () => ({ welcomes: new Map(), invitedPaid: new Map(), inviterPaid: new Map(), paidInMonth: new Map() });

/** The plan, with whether the ledger was read beside it. */
export function readInvites(store, { ledger = null, now = new Date(), since = null } = {}) {
  const plan = planInvitePay({ rows: store.rows, houses: store.houses, facts: store.facts, ledger: ledger ?? UNREAD_LEDGER(), holds: store.holds ?? new Map(), now });
  return { ...plan, ledger_read: ledger != null, holds_read: store.holds != null,
    invitations: since ? plan.invitations.filter((p) => p.at >= since) : plan.invitations };
}

const SIDE = {
  invited: (s) => ({
    paid: `PAID 5 to ${s.to} on ${s.on}`,
    owed: `OWED 5 to ${s.to}, its welcome's own recipient: the next tick pays it`,
    waiting: `WAITING: ${s.why}`,
    refused: "REFUSED (founders): nothing is owed to either side; the invitee has the ordinary bundle",
  }[s.status]),
  inviter: (s, p) => ({
    paid: `PAID 10 to ${s.to} on ${s.on}`,
    owed: `OWED 10 to ${s.to}, ${p.invited_by}'s paid invitation ${s.nth_this_month} in ${p.month ?? ""}: the next tick pays it`,
    "in-week": `IN ITS WEEK: due at the settlement of ${s.due}`,
    held: `HELD by the hands: due ${s.due}, it waits until it is lifted`,
    cancelled: "CANCELLED by the hands: never paid, and no place in the cap",
    "over-cap": `OVER THE CAP: ${p.invited_by} has been paid ${s.paid_this_month} in ${s.month}, at most ${INVITE_CAP_PER_MONTH} a month; it waits for a month with room`,
    waiting: s.due ? `WAITING: ${s.why}` : "WAITING: no first letter and no home yet, the 30 days still running",
    late: "LATE: the first letter or home came after the 30 days: nothing is owed",
    lapsed: "LAPSED: no first letter and no home within the 30 days: nothing is owed",
    refused: "REFUSED (founders): nothing is owed",
  }[s.status]),
};

export function printInvites(read) {
  const head = [
    read.ledger_read ? null : "NOT READ AGAINST THE LEDGER (no --town and no TOWN_CLONE): no side can read PAID, so OWED here may already be paid.",
    read.holds_read ? null : "THE HOLDS COULD NOT BE READ (migration 087): no inviter side is paid by the pass until they can be.",
  ].filter(Boolean);
  if (!read.invitations.length) return [...head, "no household has joined with an invitation in this range."].join("\n") + "\n";
  const lines = [...head];
  for (const p of read.invitations) {
    const named = p.named && p.named !== p.invited_by && p.named !== `hh:${p.invited_by}` ? ` (named ${p.named})` : "";
    const was = p.invited_by_was ? ` (credited as ${p.invited_by_was}, renamed since)` : "";
    lines.push(`${p.invitation}${p.name ? ` "${p.name}"` : ""} · invited by ${p.invited_by}${was}${named} · at ${p.at}${p.ashore ? ` · ashore ${p.ashore}` : ""}`);
    lines.push(`    the invited side: ${SIDE.invited(p.invited_side)}`);
    const a = p.activation;
    lines.push(`    first letter ${a.first_letter ?? "none"} · first home ${a.first_home ?? "none"} · ${a.status.toUpperCase()}${a.at ? ` ${a.at} (${a.through})` : a.status === "waiting" ? ` until ${a.by}` : ""}`);
    lines.push(`    the inviter side: ${SIDE.inviter(p.inviter_side, { ...p, month: read.month })}`);
    for (const m of p.hold?.moves ?? []) lines.push(`      ${m.at} ${m.hand}: ${m.from} → ${m.to} · ${m.note}`);
  }
  return lines.join("\n") + `\n\n${read.invitations.length} invitation(s), read at ${read.at} for the town day ${read.pay_day}. The invited household's 5 more is paid the tick after its welcome; its inviter's 10 at the first settlement a week after its first letter or home within 30 days, unless held, at most ${INVITE_CAP_PER_MONTH} a month counted in the month paid.\n`;
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
  const since = arg("--since");
  if (since && Number.isNaN(Date.parse(since))) { console.error(`--since takes an ISO instant, not "${since}"`); process.exit(2); }
  const { actsQuery } = await import("../src/world2-acts.mjs");
  const store = await inviteStoreFacts((sql, params) => actsQuery(sql, params));
  if (store === null) { console.error("the office is not pointed at the record (WORLD2_PG_URL)"); process.exit(2); }
  const town = arg("--town") ?? process.env.TOWN_CLONE ?? null;
  let ledger = null;
  if (town) {
    const { loadRegistryRows } = await import("../src/registry-store.mjs");
    const { registryFromRows } = await import("../src/registry-rows.mjs");
    const regRows = await loadRegistryRows();
    ledger = (await townInviteLedger(town, regRows ? (registryFromRows(regRows).households ?? {}) : {})).ledger;
  }
  const read = readInvites(store, { ledger, since: since ? new Date(since).toISOString() : null });
  const json = (_k, v) => (v instanceof Map ? Object.fromEntries(v) : v);
  process.stdout.write(process.argv.includes("--json") ? JSON.stringify(read, json, 1) + "\n" : printInvites(read));
  process.exit(0);
}
