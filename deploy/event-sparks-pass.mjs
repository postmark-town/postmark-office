// event-sparks-pass.mjs — the keeping tick's step that turns a staked event that has ended into its spark (POS-1035; call 22).
//
//   node deploy/event-sparks-pass.mjs --town <clone> --key <pem> [--world <clone>] [--registry <file>] [--drafts-from <UTC instant>]
//   node deploy/event-sparks-pass.mjs --town <clone> --dry-run
//
// ── WHAT IT DOES ─────────────────────────────────────────────────────────────
//
// Every event that was posted with its 20-stamp stake, has ended, was not cancelled and is not yet complete is completed by
// src/event-sparks.mjs § completeEvent: one put-forward spark per room (at most 20; one on the locked circle if nobody spoke)
// through the mark road, its whole stake home and 1 of it backing each spark (one room: 19 home, 1 kept), in one signed batch and
// one store transaction — or not at all. This file decides nothing about money or sparks; it finds the due events and asks, once
// each. A free event's sparks are its host's private drafts: its line here names the event and that it completed, never a draft.
//
// ── WHERE IT RUNS ────────────────────────────────────────────────────────────
//
// In deploy/office-keep.sh, under the town lock, AFTER the mint step has committed, pushed and synced: a completion signs its own
// two ledger lines, lands them in its own store transaction and commits them itself, and when it cannot land, penTransaction puts
// its lines back — which is only true on a clean ledger. So a ledger with lines nobody committed is not touched: the pass says so
// (exit 3) and the next tick asks again. No new scheduler, unit or signing authority: the tick's own key, the tick's own lock.
//
// ── NEVER TWICE, AND NEVER A GUESS ───────────────────────────────────────────
//
// The event's receipt (fields.completed) is written in the same transaction as the spark and the ledger's landing, read FOR
// UPDATE, so a second tick finds it complete and does nothing. An event whose rooms cannot be told is HELD (unknown is never
// silence): named in the output, nothing moved, asked again next tick.
//
// ── NEVER ONTO A RED LEDGER ──────────────────────────────────────────────────
//
// Every completion first asks the mint's own arrival predicate (src/event-sparks.mjs § ledgerArrivalRed, the same
// tools/stamp-verify-owed.mjs call the mint makes: owed mints and settlements are not red), before anything is signed — at the
// completion's own boundary, so neither this pass nor any other caller of completeEvent can bypass it. A red ledger is the mint's
// refusal too: the pass stops at the first one (exit 4). With nothing due no completion runs, so a quiet tick costs no verify.
//
// Exit: 0 every due event completed or held; 1 a completion was refused (non-fatal, the tick goes on); 2 usage; 3 a dirty ledger;
// 4 a red ledger.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// THE FREE EVENTS' CUTOFF (Wright 04:58:48Z, reading the 04:17Z ruling prospectively): a free event (no stake) is due only when
// its OWN end is after the one configured instant (`--drafts-from`, from the keep's existing config) — never the tick's clock,
// so a late tick admits no history. With no cutoff configured, no free event is due. Its value is the deploy's (POS-1035/e).
export const DUE_EVENTS_SQL = `SELECT id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act
  FROM posts WHERE class = 'event' AND state <> 'cancelled' AND ends <= $1 AND NOT (fields ? 'completed')
   AND ((fields ? 'stake' AND NOT (fields->'stake' ? 'returned'))
        OR (NOT (fields ? 'stake') AND $2::timestamptz IS NOT NULL AND ends > $2::timestamptz))
   ORDER BY ends, id`;

/** The configured cutoff instant (ms), or null when none is configured; `{ invalid }` when it does not read as one instant. */
export function draftsCutoffOf(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const s = String(raw).trim();
  const t = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(s) ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : { invalid: s };
}

/**
 * THE SETTLEMENTS A COMPLETION READS ITS EVENT'S ROOMS WITH (POS-1203): every one world main published (`hearing.recorded()`), not the ear's newest sixty
 * (`settlements()`). A completion reads the event's WINDOW, a historical read; an event whose window opened before the sixtieth-newest settlement (CORE-163's
 * season runs 37 days) would otherwise answer "rooms unknown" and be held, waiting on the archive producer. Nothing about what is due, the ledger, the
 * backing, the return or the free-event cutoff reads these. Unreadable answers [] and the completion is held, as ever.
 */
export async function completionEdges(world, createHearingWindow) {
  try { const h = createHearingWindow({ repo: world }); await h.refresh(); return h.recorded() ?? []; } catch { return []; }
}

function arg(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; }

export async function main(argv = process.argv.slice(2), env = process.env) {
  const town = arg(argv, "--town");
  const keyPath = arg(argv, "--key");
  const dry = argv.includes("--dry-run");
  if (!town || (!keyPath && !dry)) {
    console.error("usage: node deploy/event-sparks-pass.mjs --town <clone> --key <pem> [--world <clone>] [--registry <file>] [--drafts-from <UTC instant>] | --town <clone> --dry-run [--drafts-from <UTC instant>]");
    return 2;
  }
  if (!existsSync(join(town, "WHITE_PAGES", "stamp-ledger.md"))) { console.error(`no stamp ledger under ${town}`); return 2; }
  const dirty = execFileSync("git", ["-C", town, "status", "--porcelain", "--", "WHITE_PAGES/stamp-ledger.md"], { encoding: "utf8" }).trim();
  if (dirty) {
    console.error("[event-sparks] the stamp ledger holds lines nobody committed — no completion runs on a ledger it could not put back; the next tick asks again");
    return 3;
  }
  // a cutoff that does not read as one UTC instant admits no free event, and the pass says so (exit 1); staked events go on
  let draftsFrom = draftsCutoffOf(arg(argv, "--drafts-from"));
  let misconfigured = false;
  if (draftsFrom?.invalid !== undefined) {
    console.error(`[event-sparks] --drafts-from ${JSON.stringify(draftsFrom.invalid)} is not one UTC instant (YYYY-MM-DDTHH:MM[:SS]Z) — no free event is due until it is`);
    draftsFrom = null; misconfigured = true;
  }
  // unset is UNCONFIGURED, not "no free event qualifies": say so every run, so a quiet log is never read as an empty cohort
  if (draftsFrom == null && !misconfigured)
    console.error("[event-sparks] free events' drafts are UNCONFIGURED (no --drafts-from / EVENT_DRAFTS_FROM): every free event is held, not found ineligible — the cutoff is set once at deploy (POS-1035/e)");
  const { officeRead } = await import("../src/world2-pen.mjs");
  const { rowOf } = await import("../src/events-store.mjs");
  const now = Date.now();
  const due = (await officeRead((q) => q.query(DUE_EVENTS_SQL, [new Date(now).toISOString(), draftsFrom == null ? null : new Date(draftsFrom).toISOString()]), { env })).rows.map(rowOf);
  if (dry) { for (const r of due) console.log(JSON.stringify({ event: r.id, due: true, ends: r.ends, ...(r.fields?.stake ? {} : { free: true }) })); return misconfigured ? 1 : 0; }
  if (!due.length) return misconfigured ? 1 : 0;
  const registry = arg(argv, "--registry");

  const { completeEvent } = await import("../src/event-sparks.mjs");
  const { penTransaction } = await import("../src/write.mjs");
  const { townDay } = await import("../src/votes.mjs");
  const { createHearingWindow } = await import("../src/hearing-window.mjs");
  const world = arg(argv, "--world") ?? env.WORLD_CLONE ?? resolve(HERE, "..", "world-clone");
  const edges = await completionEdges(world, createHearingWindow);
  const keyPem = readFileSync(keyPath, "utf8");
  let refused = 0;
  for (const row of due) {
    const out = await penTransaction(town, () => completeEvent(row, { clone: town, keyPem, env, now, date: townDay(), edges, registry, draftsFrom }));
    // a free event's drafts are its host's private ones: the tick's log names none of them
    console.log(JSON.stringify(out?.free ? { event: out.event, completed: out.completed, free: true, act_id: out.act_id } : out));
    if (out?.error?.reason === "ledger-red") {
      console.error(`[event-sparks] the stamp ledger is red — ${due.length} due event(s) wait; no completion signs onto it`);
      return 4;
    }
    if (out?.error) refused += 1;
  }
  return refused || misconfigured ? 1 : 0;
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (isMain) main().then((code) => process.exit(code), (e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
