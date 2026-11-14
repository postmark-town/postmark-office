// settlement-receipt.mjs — the crossing's receipt, composed rather than printf'd.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
//
// The receipt used to be six `printf` fields in settlement-auto.sh, and on
// 2026-08-26 a crossing left 42 marks drafted and reported nothing. The rule this
// file has kept since (the founder's 2026-08-27 mandate, "RECEIPTS LIE BY
// OMISSION"):
//
//   A CROSSING NAMES EVERY STEP IT HAS A WORD FOR, INCLUDING THE EMPTY ONES.
//
// "0 removed" is a fact about this crossing, and its ABSENCE is indistinguishable
// from a crossing that never looked.
//
// ── SINCE POS-1025: THE RECEIPT OF A PRINTOUT ────────────────────────────────
//
// The settlement decides inside the clearing and seals; the crossing prints the
// sealed snapshot, tags it and records it (settlement-auto.sh § THE PRINTOUT).
// So this receipt names the settlement's NUMBER, the docket it printed, what the
// printout wrote and removed (`printout`), the tag (`tag`) and the store's record
// (`record`), and the two report-only checks after the seal (`harm`, `suite`).
// The sweep's blocks (surveyed, quarantined, refused, isolated, refusal class),
// the drain's, the store write-down's and the retire step's went with those
// steps. `channels` stays, derived from the printout, because the history line
// and the roll-call count `published` from it.
//
// Input is env, not argv, because settlement-auto.sh calls this from a `report`
// shell function where every value may legitimately be empty.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const env = (name) => {
  const v = process.env[name];
  return v === undefined || v === "" ? null : v;
};

/** A JSON file that may not exist, may be half-written, or may never have been produced. */
const readJson = (path) => {
  if (!path) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return null; }
};

// The dry leg's withheld acts, one per line, written by settlement-auto.sh's
// `withheld`. Absent is "none yet", not an error.
const DRY = env("SETTLEMENT_DRY") === "1";
const withheldLines = (() => {
  const p = env("SETTLEMENT_WITHHELD");
  if (!p) return [];
  try { return readFileSync(p, "utf8").split("\n").map((l) => l.trim()).filter(Boolean); }
  catch { return []; }
})();

const docket = readJson(env("SETTLEMENT_DOCKET_JSON"));
const printout = readJson(env("SETTLEMENT_PRINTOUT_JSON"));
const tag = readJson(env("SETTLEMENT_TAG_JSON"));
const record = readJson(env("SETTLEMENT_RECORD_JSON"));
// THE HARM GATE, REPORTED (POS-1025/c): five data-shaped checks over the printed
// tree, each naming its marks. Null when the crossing printed nothing to judge.
const harm = readJson(env("SETTLEMENT_HARM_JSON"));
// THE GRAMMAR SUITE, run AFTER the push as a checker: `red: true` is a warning.
const suite = readJson(env("SETTLEMENT_SUITE_JSON"));
// THE HOUSEHOLD REGISTRY REFRESH (2026-09-09), named on every crossing.
const registry = readJson(env("SETTLEMENT_REGISTRY_JSON"));
// POS-155: `--check` writes a verdict and `--write` writes a report.
const stateLog = readJson(env("SETTLEMENT_STATE_LOG_JSON"));
const STATE_LOG_MODE = env("SETTLEMENT_STATE_LOG_MODE") || null;

// a written or re-framed mark carries `id`; a removed one carries `slug` (the printout's own shapes), and both are the mark's id
const ids = (rows) => (Array.isArray(rows) ? rows : []).map((r) => (typeof r === "string" ? r : r?.id ?? r?.slug ?? null)).filter(Boolean);
const printed = printout && !printout.refused && printout.status !== "refused";
const written = printed ? ids(printout.written) : [];
// a removal the printout found nothing on main to remove for (`path: null`) removed nothing
const removed = printed ? ids((printout.removed ?? []).filter((g) => g?.path)) : [];
const reframed = printed ? ids(printout.reframed) : [];

// ── WHY A MARK WENT: THE RECORDED STAKE WITHDRAWAL (POS-937/a) ───────────────
//
// S156 was held forty minutes because the receipt hid the one fact the keeper
// needed about three unpublished candles: a stake of theirs had been withdrawn.
// Wright, 2026-11-07 15:53:23Z: for each mark the receipt reports as gone, read
// the town's WHITE_PAGES/stamp-ledger.md for that mark's NEWEST `for: unstake`
// line and name its date, its line number and who withdrew; with none, say "no
// stake withdrawal on the ledger". No judgment. Since the printout, the marks
// that went are the printout's `removed` (the clearing retired them before the
// seal, settlement-decides.mjs), listed as `removed`.
//
// WHICH LEDGER: the crossing's own checkout of its `$TOWN_SHA`, handed here as
// SETTLEMENT_TOWN_SNAPSHOT, never the long-lived clone's working tree. AN UNREAD
// LEDGER IS NOT AN EMPTY ONE: an unread file says so on each mark (`found: null`).
const WITHDRAWAL_LEDGER = "WHITE_PAGES/stamp-ledger.md";
const LEDGER_MAX_BYTES = 64 * 1024 * 1024;
// stamp-mint.mjs § WORLD_UNSTAKE_RE, plus the line's own trailing signature
const UNSTAKE_LINE = /^- (\d{4}-\d{2}-\d{2}) · stake:world-mark\/([a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*) → (\S+) · [1-9]\d* · for: unstake(?: · sig: \S+)?$/;

const stakeWithdrawals = (() => {
  if (!removed.length) return [];
  const listed = new Set(removed);
  const ledger = (() => {
    const dir = env("SETTLEMENT_TOWN_SNAPSHOT");
    if (!dir) return { why: "this crossing has no town snapshot to read the ledger from" };
    const path = join(dir, WITHDRAWAL_LEDGER);
    let text;
    try {
      const size = statSync(path).size;
      if (size > LEDGER_MAX_BYTES) return { why: `${WITHDRAWAL_LEDGER} is ${size} bytes, over the ${LEDGER_MAX_BYTES}-byte bound` };
      text = readFileSync(path, "utf8");
    } catch (e) { return { why: `${WITHDRAWAL_LEDGER} could not be read in the town snapshot (${e?.code ?? "error"})` }; }
    // append-only: the newest line for a mark is its last, and the line number is the file's own physical 1-based line
    const found = new Map();
    let n = 0;
    for (const line of text.split("\n")) {
      n += 1;
      const m = UNSTAKE_LINE.exec(line.endsWith("\r") ? line.slice(0, -1) : line);
      if (m && listed.has(m[2])) found.set(m[2], { date: m[1], line: n, by: m[3] });
    }
    return { found };
  })();
  return removed.map((mark) => {
    const hit = ledger.found?.get(mark) ?? null;
    return {
      mark, listed_as: "removed",
      found: ledger.found ? hit !== null : null,
      date: hit?.date ?? null, line: hit?.line ?? null, by: hit?.by ?? null,
      said: !ledger.found ? `could not read the stake ledger: ${ledger.why}`
        : hit ? `stake withdrawn ${hit.date} by ${hit.by} (stamp-ledger.md line ${hit.line})`
        : "no stake withdrawal on the ledger",
    };
  });
})();

const receipt = {
  at: env("SETTLEMENT_AT"),
  status: env("SETTLEMENT_STATUS"),
  town_sha: env("SETTLEMENT_TOWN_SHA") ?? "",
  world_from: env("SETTLEMENT_WORLD_FROM") ?? "",
  world_to: env("SETTLEMENT_WORLD_TO") ?? "",

  // THE SETTLEMENT'S NUMBER (POS-1025/a: every seal is numbered, a retry keeps
  // its number). Null only when the crossing refused before it reached a seal.
  settlement: printout?.settlement ?? null,

  // `true` only when the operator door was used (postmark#2786). On every
  // receipt, `false` included: absence must never read as "scheduled".
  by_hand: env("SETTLEMENT_BY_HAND") === "1",

  // `true` when SETTLEMENT_DRY=1, with every withheld act named in order.
  dry: DRY,
  withheld: DRY ? withheldLines : [],

  // THE WINDOW THIS CROSSING PRINTED, as the candle sealed it.
  docket: docket && docket.window != null
    ? { window: docket.window, cleared_at: docket.cleared_at ?? null, by_hand: docket.by_hand === true, waited_s: docket.waited_s ?? null }
    : null,

  // ── THE PRINTOUT ───────────────────────────────────────────────────────────
  //
  // What the settlement printed onto world main: the sealed snapshot it read
  // (id, digest, town), the last printout it was measured from (`base`), and
  // every mark it wrote, removed and re-framed, BY NAME — a count would make a
  // resident's mark and a stranger's look the same. A refused printout names
  // its reason, and the settlement stays sealed and unprinted.
  printout: printout
    ? (printout.status === "refused" || printout.refused
        ? { ran: true, status: "refused", refused: printout.refused ?? null, detail: printout.detail ?? null, ...(printout.reframe ? { reframe: printout.reframe } : {}) }
        : {
            ran: true,
            status: printout.status ?? null,
            window: printout.window ?? null,
            snapshot: printout.snapshot ?? null,
            base: printout.base ?? null,
            commit: printout.commit ?? null,
            written: (printout.written ?? []).map((w) => ({ id: w?.id ?? null, path: w?.path ?? null })),
            removed: (printout.removed ?? []).map((g) => ({ id: g?.id ?? g?.slug ?? null, path: g?.path ?? null, ...(g?.note ? { note: g.note } : {}) })),
            reframed: printout.reframed ?? [],
            // the world-framed records carried into a nested frozen filing, both numbers (postmark#2865)
            framed: printout.framed ?? [],
            // WORLD/settlement-publications.json as sealed: admitted, reclassed, removed by name
            registry: printout.registry ?? null,
            summary: printout.summary ?? null,
          })
    : { ran: false, reason: "the crossing ended before its printout" },

  // THE TAG: `settlement/S<n>` at the pushed printout, never moved. `refused`
  // names a tag that already stands elsewhere, or a push origin turned away.
  tag: tag
    ? (tag.status === "refused" || tag.refused
        ? { status: "refused", refused: tag.refused ?? null, detail: tag.detail ?? null, tag: tag.tag ?? null, existing: tag.existing ?? null }
        : { status: tag.status ?? null, tag: tag.tag ?? null, commit: tag.commit ?? null, digest: tag.digest ?? null })
    : null,

  // THE STORE'S RECORD (095 § record_printout): the printout's sha kept once,
  // and whether this settlement moved the world-marks head (only the highest
  // printed one does). Null when it was not reached; `refused` when it failed.
  record: record
    ? (record.status === "refused" || record.refused
        ? { status: "refused", refused: record.refused ?? null, detail: record.detail ?? null }
        : { status: record.status ?? null, settlement: record.settlement ?? null, commit: record.commit ?? null, head_advanced: record.head_advanced ?? null })
    : null,

  // ── THE ARCHIVE'S EVENT LOG, AND WHETHER THIS CROSSING WROTE IT (POS-155) ──
  //
  // `mode` is which pen ran — `store` wrote, `sqlite` only looked. `clean` is the
  // CHECK's verdict and null under `store`; `would_write` is the size of the hole.
  state_log: stateLog
    ? (stateLog.refused
        ? { ran: true, mode: STATE_LOG_MODE, refused: stateLog.refused, detail: stateLog.detail ?? null }
        : {
            ran: true,
            mode: STATE_LOG_MODE,
            window: stateLog.window ?? null,
            files: (stateLog.crossings ?? stateLog.windows ?? []).map((c) => c.crossing),
            clean: STATE_LOG_MODE === "store" ? null : (stateLog.clean ?? false),
            lines: (stateLog.windows ?? []).reduce((n, c) => n + (c.lines ?? 0), 0) || null,
            state_commit: stateLog.state_commit ?? null,
            classes: STATE_LOG_MODE === "store" ? null : (stateLog.crossings ?? []).reduce((acc, c) => {
              for (const [k, v] of Object.entries(c.classes ?? {})) acc[k] = (acc[k] ?? 0) + v;
              return acc;
            }, {}),
            would_write: STATE_LOG_MODE === "store" ? null
              : (stateLog.crossings ?? []).reduce((n, c) => n + (c.derived_lines ?? 0), 0),
            first_difference: STATE_LOG_MODE === "store" ? null
              : ((stateLog.crossings ?? []).find((c) => !c.byte_equal)?.first_difference ?? null),
            unnamed_households: [...new Set((stateLog.crossings ?? stateLog.windows ?? [])
              .flatMap((c) => c.unnamed_households ?? []))],
          })
    : { ran: false },

  // ── THE HOUSEHOLD REGISTRY THIS CROSSING PRINTED ON ─────────────────────────
  //
  // `verified_at` is the sha it was checked against, `town_sha` the file's own
  // stamp; `added`, `removed` and `rekeyed` by name, because a re-keyed handle
  // moves marks between households and a count would hide it.
  registry: registry
    ? (registry.refused
        ? { ran: true, verified: false, refused: registry.refused, detail: registry.detail ?? null }
        : registry.ran === false
          ? {
              ran: false,
              verified: false,
              bypass: registry.bypass === true,
              reason: registry.reason ?? "the registry refresh did not run for this crossing",
            }
          : {
              ran: true,
              verified: true,
              verified_at: registry.verified_at ?? null,
              changed: registry.changed === true,
              commit: env("SETTLEMENT_REGISTRY_COMMIT") ?? null,
              town_sha: registry.town_sha ?? null,
              generated_at: registry.generated_at ?? null,
              previous_generated_at: registry.previous_generated_at ?? null,
              previous_town_sha: registry.previous_town_sha ?? null,
              handles: registry.handles ?? null,
              households: registry.households ?? null,
              logins: registry.logins ?? null,
              added: registry.added ?? [],
              removed: registry.removed ?? [],
              rekeyed: registry.rekeyed ?? [],
            })
    : { ran: false, verified: false, bypass: false, reason: "the registry refresh did not run for this crossing" },

  // POS-937/a: why each removed mark went, from the ledger's own recorded unstake. Present only when the printout removed a mark.
  ...(stakeWithdrawals.length ? { stake_withdrawals: stakeWithdrawals } : {}),

  // THE COUNTS THE HISTORY AND THE ROLL-CALL READ, from the printout: `published`
  // is the marks it wrote, `unpublished` the marks it removed. Null when nothing
  // was printed, so a refusal never reads as a quiet zero.
  channels: printed ? { published: written.length, unpublished: removed.length, reframed: reframed.length } : null,

  harm: harm
    ? (harm.ran === false
        ? { ok: false, ran: false, could_not_gate: harm.could_not_gate ?? "the gate did not run" }
        : {
            ok: harm.ok === true,
            base: harm.base ?? null,
            checks: (harm.checks ?? []).map((c) => ({
              name: c.name ?? null, ok: c.ok === true, count: c.count ?? 0, rows: c.rows ?? [], note: c.note ?? null,
            })),
          })
    : null,
  suite: suite
    ? {
        ran: suite.ran === true,
        red: suite.red === true,
        reds: suite.reds ?? [],
        reds_total: suite.reds_total ?? (suite.reds ?? []).length,
        log: suite.log ?? null,
      }
    : null,

  // WHOSE NIGHT IS THIS: a refused printout is the record's or the machinery's
  // to repair (a rerun prints the same refusal), so it carries a class the
  // history and the roll-call count; anything else is null.
  class: printout && (printout.status === "refused" || printout.refused) ? "printout-refused" : null,

  detail: DRY ? `DRY RUN, nothing written — ${env("SETTLEMENT_DETAIL") ?? ""}` : (env("SETTLEMENT_DETAIL") ?? ""),
};

process.stdout.write(`${JSON.stringify(receipt, null, 1)}\n`);
