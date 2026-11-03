// invite-pass.mjs — the office drain that pays Bring a neighbour at a crossing (POS-816).
//
//   node deploy/invite-pass.mjs --town <clone> --key <pem> [--date YYYY-MM-DD]
//   node deploy/invite-pass.mjs --town <clone> --dry-run
//
// ── WHY ─────────────────────────────────────────────────────────────────────
//
// Darko, 2026-10-28 23:07 (CORE-26, POS-816): the invite mint is deterministic,
// "otherwise little bird will drown". Until now it was a hand mint from
// tools/invites.mjs, and on 2026-11-03 the one invitation so far (The Keep,
// invited by Castle Solange on 10-27) had paid neither side. This pass pays by
// rule, on the keeping tick, with no meep and no human in the paying path:
//
//   · the invited household's 5 more (its join bundle is 10: the welcome's 5 and
//     this), to its welcome's own recipient, the tick after its welcome lands;
//   · its inviter's 10, at the first settlement a week after the invited house
//     sends its first letter or claims its home within 30 days, unless the
//     hands hold it (src/invite-hold-store.mjs), at most 10 a month per inviting
//     household counted in the month paid.
//
// The plan is src/invite-pay.mjs § planInvitePay, the one the hands' view and
// the operator's report read. This file decides NOTHING about amounts: it asks
// the town's own verb, `stamp-mint.mjs --invite-mint`, once per owed line, and
// the town's one judge (judgeInviteLine, shared by that verb and stamp-verify)
// holds every term again. Its refusal is the household waiting a tick, never a
// line written.
//
// ── NEVER TWICE ─────────────────────────────────────────────────────────────
//
// What is paid is read off the town's ledger with the town's own classifier,
// every run: a side with a line is never planned again. And the town's verb
// refuses a second line per invited house and side on its own, so a second pass
// writes nothing twice over. A line the town has NOT written (a gift, a hand
// line) is not an invite line, and the plan cannot see it: pay the owed first
// invitation through this pass or the verb, never both.
//
// ── FAILS CLOSED ────────────────────────────────────────────────────────────
//
//   · a store it cannot read, or a registry, or a key base the switch asks for:
//     nothing planned, nothing paid (welcome-pass's rule);
//   · a town clone with no invite grammar: nothing paid;
//   · holds it cannot read (086 not landed): the inviter sides wait, because a
//     hold it cannot see is never assumed absent. The invited sides do not wait
//     on holds, so they are still paid.
//
// ── ORDER ───────────────────────────────────────────────────────────────────
//
// deploy/office-keep.sh runs it AFTER the welcome pass (the 5 more follows its
// welcome on the ledger; the town refuses it otherwise) and BEFORE the verify
// and the commit, inside the same flock and with the same key and registry
// file, so its lines are verified and pushed by the commit already there. Its
// exit is swallowed there like the welcome pass's: a refusal is a household
// waiting a tick.
//
// EXIT: 0 when every owed line was written (or none was owed), 1 when any refused.

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { planInvitePay, owedLines, townDay } from "../src/invite-pay.mjs";
import { inviteStoreFacts, townInviteLedger } from "../src/invite-facts.mjs";
import { storeRegistry, storeKeyBase } from "./welcome-pass.mjs";
import { keyBaseJson } from "../src/mint-inputs.mjs";

/** The town's own verb for one owed line, by absolute path and with --repo (welcome-pass.mjs § mintArgv's reasons). */
export function inviteMintArgv(town, l, { date, keyPath, registryFile, baseArgs = [] }) {
  return [join(town, "tools", "stamp-mint.mjs"), "--invite-mint", l.handle, "--side", l.side,
    "--invited", l.invited, "--inviter", l.inviter, ...(l.side === "inviter" ? ["--activated", l.activated] : []),
    "--date", date, "--key", keyPath, "--registry", registryFile, ...baseArgs, "--repo", town];
}

const run = (town, argv) => spawnSync(process.execPath, argv, { cwd: town, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const arg = (name, argv) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };

/** The store's facts through the office's own read (actsQuery's pool). */
async function storeFacts(env) {
  const { actsQuery } = await import("../src/world2-acts.mjs");
  return inviteStoreFacts((sql, params) => actsQuery(sql, params, env));
}

/**
 * The whole pass. `store`, `registry` (or `registryRows`), `keyBase`, `spawn`
 * and `now` are injectable, so a suite drives the same path in-process against
 * an invented store and registry and a real town.
 */
export async function main(argv = process.argv.slice(2), { store = undefined, registry: givenRegistry = undefined, registryRows = undefined, keyBase = undefined, spawn = run, now = new Date(), log = console.log, err = console.error, env = process.env } = {}) {
  const town = arg("--town", argv);
  const keyPath = arg("--key", argv);
  const dryRun = argv.includes("--dry-run");
  if (!town || !existsSync(town)) { err("invite-pass: --town <town-clone> is required and must exist"); return 1; }
  if (!dryRun && (!keyPath || !existsSync(keyPath))) { err("invite-pass: --key <ed25519-private-pem> is required (or --dry-run)"); return 1; }

  let registry, facts, base, town_;
  try {
    registry = givenRegistry ?? await storeRegistry(registryRows);
    if (!registry) throw new Error("the store's registry could not be read");
    facts = store === undefined ? await storeFacts(env) : store;
    if (!facts) throw new Error("the office is not pointed at its record (WORLD2_PG_URL)");
    base = await storeKeyBase(town, { env, base: keyBase });
    town_ = await townInviteLedger(town, registry.households);
  } catch (e) {
    err(`invite-pass: ${e?.message ?? e} — nothing planned, nothing paid; every invitation keeps its claim for the next tick`);
    return 1;
  }
  const holdsReadable = facts.holds !== null;
  const plan = planInvitePay({ rows: facts.rows, houses: facts.houses, facts: facts.facts, ledger: town_.ledger, holds: facts.holds ?? new Map(), now });
  let lines = owedLines(plan);
  if (!holdsReadable) {
    const waiting = lines.filter((l) => l.side === "inviter").length;
    lines = lines.filter((l) => l.side !== "inviter");
    if (waiting) err(`invite-pass: the hands' holds cannot be read (migration 086 has not landed), so ${waiting} inviter payout(s) wait — a hold it cannot see is never assumed absent`);
  }
  if (!lines.length) { log(`[invite-pass] nothing owed — ${plan.invitations.length} invitation(s) on record`); return 0; }
  const date = arg("--date", argv) ?? townDay(now);
  log(`[invite-pass] ${lines.length} line(s) owed, date ${date}`);
  if (dryRun) {
    for (const l of lines) log(`[invite-pass] would mint ${l.side === "invited" ? 5 : 10} → ${l.handle} · invite:${l.invited}/${l.inviter}/${l.side}${l.activated ? `/${l.activated}` : ""}`);
    log("[invite-pass] dry run — nothing written, nothing signed");
    return 0;
  }
  const scratch = mkdtempSync(join(tmpdir(), "invite-pass-"));
  const registryFile = join(scratch, "registry.json");
  writeFileSync(registryFile, JSON.stringify(registry));
  const baseArgs = [];
  if (base) { const f = join(scratch, "base.json"); writeFileSync(f, keyBaseJson(base)); baseArgs.push("--base", f); }
  const refused = [];
  try {
    for (const l of lines) {
      // ONLY the lines the plan named, one call each, through the town's own verb.
      const out = spawn(town, inviteMintArgv(town, l, { date, keyPath, registryFile, baseArgs }));
      if (out.status === 0) log(`[invite-pass] minted ${l.side === "invited" ? 5 : 10} → ${l.handle} · invite:${l.invited}/${l.inviter}/${l.side}`);
      else {
        const why = (out.stderr ?? "").trim().split(/\r?\n/)[0] || `exit ${out.status}`;
        err(`[invite-pass] REFUSED ${l.side} · ${l.handle} · invite:${l.invited}/${l.inviter} — ${why}`);
        refused.push(l);
      }
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  if (refused.length) {
    err(`[invite-pass] ${lines.length - refused.length} of ${lines.length} written; ${refused.length} refused — each is the town declining, and each keeps its claim for the next tick`);
    return 1;
  }
  log(`[invite-pass] ${lines.length} line(s) written`);
  return 0;
}

// Script only when run as one (welcome-pass.mjs § entry guard, the junction lesson).
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exit(await main());
