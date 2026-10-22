#!/usr/bin/env node
// settlements-backfill.mjs — the store learns which settlements have landed,
// one row per `settlement/S<n>` tag, from a world checkout (postmark#2897).
//
//   node world2/tools/settlements-backfill.mjs --world-repo <checkout>
//        [--dry-run]            the default: derive, compare, print the plan, write nothing
//        [--apply [--prod]]     INSERT the rows the table lacks, one transaction
//        [--verify]             the table against the checkout's tags, both ways; exit 1 on drift
//        [--json]               machine-readable receipt on stdout
//        [--quiet]              no plan table — the one receipt line only (the tick's mode)
//
//   env: WORLD2_PG_URL (the office's own connection — `office_api`, the pen
//        018_settlements.sql grants INSERT to), or PG* as `w2_pgenv` exports
//        them, or --pg-url. The dry run and the verify need only SELECT.
//
//   EXIT: 0 · 1 a CONFLICT (a row already present disagrees with its tag) or,
//         under --verify, DRIFT · 2 cannot run (no checkout, no store, no table).
//
// ── THE WRITER, WITHOUT ITS CALLER ──────────────────────────────────────────
//
// The brief placed the row's writer "in the same script that pushes the tag,
// after the push succeeds". Measured: no office script pushes the tag.
// `deploy/settlement-auto.sh` publishes world main and says "NO TAGS from
// here"; the tag is an ANNOTATED object the Worldkeeper mints from his own
// clone at his heartbeat, ~20 minutes after the crossing, and only on a clean
// judgment — three publishes sit between S70 and S71. So the row can follow the
// tag only by READING the tag, and this tool is that reader: run it after any
// bless and it writes exactly the tags the table lacks; run it at the ship and
// it writes S1 through S71. WHO RUNS IT (Wright-ruled 2026-09-17, on the lane's
// stop on shape): `deploy/office-tick.sh`, every 15 minutes, right after the
// world fetch that carries the tag in — `--apply --prod --quiet`, non-fatal,
// its one receipt line in the tick's journal. So the table is as current as
// the office's tick, at most ~15 minutes behind a bless, and the twin says so.
//
// THE DRY RUN AND THE WRITE DERIVE THEIR ROWS FROM THE SAME FUNCTION. There is
// no second path that could disagree with the rehearsal (backfill-register.mjs's
// rule, kept). The verify compares the SAME derivation against the table.
//
// ── EVERY COLUMN FROM THE TAG, AND ONE FROM THE STORE ───────────────────────
//
//   number        <n> of `settlement/S<n>`. 1.0's own regex (SETTLEMENT_TAG).
//   tag_sha       the COMMIT the tag blesses — `%(*objectname)` for an annotated
//                 tag, the ref itself for a lightweight one. NEVER the tag
//                 object's sha (replay-ingest.mjs:236 names that trap).
//   published_at  that commit's committer date: when the crossing pushed. This
//                 is the instant 1.0 prints as `date`.
//   blessed_at    the tag object's tagger date: the keeper's bless. NULL for a
//                 lightweight tag, which has no date of its own.
//   window_id     the ONE field that needs the store: the newest `windows` row
//                 whose `closes_at` is at or before `published_at` — the window
//                 that crossing closed. Checked against the crossing's own
//                 journal line for S71 ("docket: window 194 locked at
//                 2026-09-17T05:45:45.550Z"; the sweep committed at 05:46:08Z;
//                 window 194 closes_at 05:45:40Z → 194). NULL when no window
//                 has closed by then — every tag before the store's first
//                 window (150, opened 2026-08-26): S1–S46. S47 closed 150 to
//                 the second; the rehearsal over the real clone and prod's 47
//                 rows is in the lane's day doc.
//
// ── WHAT IT REFUSES ─────────────────────────────────────────────────────────
//
//   · a present row whose `tag_sha` is not the tag's — a MOVED TAG. "A bad
//     blessing is canon" (the keeper's standing rule); a tag that moved is a
//     finding for a person, and this tool will not paper over it. The whole
//     apply refuses, nothing partial lands.
//   · --apply on a database whose name says neither `lab` nor `scratch`
//     without --prod beside it. On the box there is no separate lab store
//     (/srv/world2-lab/lab.env and /etc/postmark-office.env both name
//     `world2_dev`), so the name trips the guard there, which is correct: the
//     prod apply is a person's hand, typed twice.
//   · a checkout that is not the TOP of a work tree. `git -C` ascends, and a
//     directory standing inside somebody else's repo would answer with that
//     repo's tags (settlements.mjs measured it: a temp dir under a home
//     directory that is a repo returned forty real settlement tags).
//
// Nothing here updates or deletes a row. INSERT is the only write, and it is
// the only write any runtime pen holds on this table.
//
// ── AND THEN THE MARKS EACH SETTLEMENT CARRIED (049, POS-142 Proposal B) ────
//
// --apply goes on to record, in `mark_carried`, which settlement first carried
// each published mark the store has no row for yet: mark-carried-backfill.mjs §
// recordCarried, the same function as the one-time backfill, capped at its
// TICK_CAP so the tick never runs the whole backfill. Its line follows the
// settlements line. A refusal there (a row disagreeing with 1.0's receipt) rolls
// back only the carried rows and exits 1; the settlement rows are committed
// first and stand.

import pg from "pg";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { SETTLEMENT_TAG, isRepoRoot } from "../../src/settlements.mjs";
import { recordCarried, receiptLine, TICK_CAP } from "./mark-carried-backfill.mjs";
import { recordAmendsCarried, amendsLine, TICK_CAP as AMENDS_CAP } from "./amend-carried.mjs";
import { stockChests } from "./chest-stock.mjs";
import { recoverOrphanDrops } from "../../src/drop-recovery.mjs";
import { endCreatures } from "./creature-endings.mjs";
import { currentCrossing } from "../../src/crossings.mjs";

const NL = String.fromCharCode(10);
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const flag = (n) => process.argv.includes(`--${n}`);

// ── the pure half ────────────────────────────────────────────────────────────

/**
 * The checkout's settlement tags, one line per ref, in the shape the rest of
 * this file derives from. `git for-each-ref` rather than `git tag --list` plus
 * per-tag lookups, because one call answers every field for every tag and
 * peels annotated tags itself (`%(*…)`).
 */
export function readTagLines(repo) {
  if (!isRepoRoot(repo)) throw new Error(`${repo} is not the top of a git work tree — refusing to read another repo's tags`);
  const out = execFileSync("git", ["-C", repo, "for-each-ref", "refs/tags/settlement/",
    "--format=%(refname:short)%09%(objecttype)%09%(objectname)%09%(*objectname)%09%(committerdate:iso-strict)%09%(*committerdate:iso-strict)%09%(taggerdate:iso-strict)"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return out.split(/\r?\n/).filter(Boolean).map((line) => {
    const [tag, type, sha, peeled, cdate, pcdate, tdate] = line.split("\t");
    return { tag, type, sha, peeled: peeled || null, cdate: cdate || null, pcdate: pcdate || null, tdate: tdate || null };
  });
}

/** One derived row per settlement tag; anything that is not a settlement tag contributes nothing. */
export function settlementRowsFrom(tagLines) {
  const rows = [];
  for (const l of tagLines) {
    const m = SETTLEMENT_TAG.exec(String(l.tag ?? "").trim());
    if (!m) continue;
    const number = Number(m[1]);
    if (!Number.isInteger(number) || number < 0) continue;
    const annotated = l.type === "tag";
    const tag_sha = annotated ? l.peeled : l.sha;
    const published_at = annotated ? l.pcdate : l.cdate;
    if (!tag_sha || !published_at) continue;              // a tag that peels to nothing is not a settlement
    rows.push({
      number, tag_sha,
      published_at: new Date(published_at),
      blessed_at: annotated && l.tdate ? new Date(l.tdate) : null,
      lightweight: !annotated,
    });
  }
  rows.sort((a, b) => a.number - b.number);
  return rows;
}

/** The window a crossing closed: the newest whose close is at or before the publish; null before the first. */
export function windowFor(publishedAt, windows) {
  const t = new Date(publishedAt).getTime();
  let best = null;
  for (const w of windows) {
    const c = new Date(w.closes_at).getTime();
    if (c <= t && (best == null || c > new Date(best.closes_at).getTime())) best = w;
  }
  return best ? Number(best.id) : null;
}

const sameInstant = (a, b) => (a == null && b == null) || (a != null && b != null && new Date(a).getTime() === new Date(b).getTime());

/**
 * The plan: every derived row classified against what the table holds.
 *   new       absent from the table — --apply writes it
 *   present   in the table and equal on every column
 *   CONFLICT  in the table with a different tag_sha — a moved tag; refuses the apply
 *   DRIFT     in the table, same sha, some other column differs — verify reds, apply skips
 * plus `extra`: table rows no tag stands behind (verify reds on them).
 */
export function planFrom(derived, existing, windows) {
  const byNumber = new Map(existing.map((r) => [Number(r.number), r]));
  const plan = derived.map((d) => {
    const window_id = windowFor(d.published_at, windows);
    const row = { ...d, window_id };
    const have = byNumber.get(d.number);
    if (!have) return { ...row, state: "new" };
    if (have.tag_sha !== d.tag_sha) return { ...row, state: "CONFLICT", have: { tag_sha: have.tag_sha } };
    const drift = [];
    if (!sameInstant(have.published_at, d.published_at)) drift.push("published_at");
    if (!sameInstant(have.blessed_at, d.blessed_at)) drift.push("blessed_at");
    if ((have.window_id == null ? null : Number(have.window_id)) !== window_id) drift.push("window_id");
    return drift.length ? { ...row, state: "DRIFT", drift } : { ...row, state: "present" };
  });
  const seen = new Set(derived.map((d) => d.number));
  const extra = existing.filter((r) => !seen.has(Number(r.number))).map((r) => Number(r.number));
  return { plan, extra };
}

/**
 * The carried step of an apply. Its own failures are named in its line and
 * never undo the settlement rows above, which are already committed: a store
 * without 049 says so, and a git or store error is one line, not a stack.
 */
export async function carriedOnTick(client, repo) {
  try {
    const r = await recordCarried(client, repo, { apply: true, cap: TICK_CAP });
    return { verdict: r.verdict, line: receiptLine(r) };
  } catch (e) {
    if (e?.code === "42P01") return { verdict: "absent", line: "carried: no `mark_carried` table yet (049 not applied) — nothing recorded" };
    return { verdict: "error", line: `carried: NOT recorded (non-fatal) — ${String(e?.message ?? e).slice(0, 200)}` };
  }
}

/**
 * A SOFT STEP'S KEEP STATUS, read from this tool's own output (POS-612 and
 * POS-627, review-612). The carried, amends, chests and drops steps are
 * non-fatal by design: rows already committed stay committed and the tool exits
 * 0. But a step that fails on every tick must still reach the one alarm route,
 * so office-keep.sh records each as its own keep step (`keep_step <step>
 * <status> [reason]`), and box-rollcall alarms on N consecutive scheduled ticks
 * that are not ok (deploy/keep-history.mjs § SOFT_STEPS). PURE.
 *
 * Each step's own lines, first match wins:
 *
 *   carried, amends  `wrote …`                         ok
 *                    `SKIPPED …` (the cap)             refused prereq:history
 *                    `no \`…\` table yet` (absent)     refused prereq:migration
 *   chests           `stocked N …`                     ok
 *                    `not stocked — the law at S<n>
 *                     declares no chest class —
 *                     nothing to stock` (a CURRENT
 *                     law)                             ok prereq:chest_class: nothing to stock
 *                                                      yet; the reason keeps it visible, so the
 *                                                      step reads `stocked N` once the class lands
 *                    `… declares no chest class, and
 *                     S<newest>'s law is not ingested
 *                     yet` (a stalled ingest)          refused prereq:law
 *                    `not stocked — the store holds
 *                     no settlement whose law is
 *                     ingested`                        refused prereq:law
 *                    `not stocked this tick — the
 *                     carried step did not settle`     refused prereq:carried
 *   drops            `… · N failed (…)` (a write the
 *                     store would not take; it fails
 *                     again every tick)                refused write-failed
 *                    `restored N …` (undecided drops,
 *                     a guard's designed bounces, are
 *                     asked again: the design)         ok
 *   endings          `… · N failed (…)` (an ending the
 *                     store would not take)            refused write-failed
 *                    `ended N …` (one waiting for what
 *                     it carries to stand: the design) ok
 *                    `none ended — the creature law
 *                     cannot be read`                  refused prereq:law
 *                    `none ended — no creature stays`,
 *                     no settlement yet, or no "ended"
 *                     in the blessed law yet           ok (WLD-25)
 *   any step         `NOT recorded/stocked/reconciled/ended`,
 *                    `REFUSED …`, or a line this does
 *                    not know                          refused write-failed
 *                    no `<step>:` line at all          notrun (it never ran)
 *
 * Returns the words office-keep.sh hands keep_step: "ok", "refused <reason>"
 * or "notrun". The reasons are keep-history's fixed vocabulary (REASON_RE).
 */
const ROWS_STEP = [[/^wrote /, "ok"], [/^SKIPPED/, "refused prereq:history"], [/^no `/, "refused prereq:migration"]];
export const SOFT_STEP_RULES = Object.freeze({
  carried: ROWS_STEP,
  amends: ROWS_STEP,
  chests: [
    [/^stocked \d+/, "ok"],
    [/^not stocked — the law at S\d+ declares no chest class — nothing to stock$/, "ok prereq:chest_class"],
    [/^not stocked — the law at S\d+ declares no chest class, and S\d+'s law is not ingested yet/, "refused prereq:law"],
    [/^not stocked — the store holds no settlement whose law is ingested/, "refused prereq:law"],
    [/^not stocked this tick — the carried step did not settle/, "refused prereq:carried"],
    // the doors ship dark (src/chests-candy.mjs): a switch, not a failure, so the roll-call stays quiet
    [/^not stocked — chests and candy are off at this office/, "ok switch-off"],
    // a class taken by the town's own act (WLD-7): the first stock waits for its return, by design
    [/^not stocked — a class is taken by the town's own act/, "ok switch-off"],
  ],
  drops: [[/ · \d+ failed \(/, "refused write-failed"], [/^restored \d+/, "ok"]],
  // WLD-25: a failed ending fails again every tick, so it alarms; one waiting for
  // what it carries to stand, a law without "ended" yet, or no creature staying is the design
  endings: [
    [/ · \d+ failed \(/, "refused write-failed"],
    [/^ended \d+/, "ok"],
    [/^none ended — the creature law cannot be read/, "refused prereq:law"],
    [/^none ended — (no creature stays|no settlement has landed|the blessed law has no "ended" reason yet)/, "ok"],
  ],
});
export function softStepStatus(text, step) {
  const line = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith(`${step}: `));
  if (!line) return "notrun";
  const rest = line.slice(step.length + 2);
  const hit = (SOFT_STEP_RULES[step] ?? []).find(([re]) => re.test(rest));
  return hit ? hit[1] : "refused write-failed";
}

/**
 * WHICH SETTLEMENT CARRIED EACH DOOR AMEND (POS-612, 075): amend-carried.mjs §
 * recordAmendsCarried on the same connection and clone, capped like the carried
 * step. Its own failures are one named line and never undo the rows above; a
 * store without 075 says so. It reads claims and settlements, not mark_carried,
 * so it does not wait on the carried step.
 */
export async function amendsOnTick(client, repo, { record = recordAmendsCarried } = {}) {
  try {
    const r = await record(client, repo, { apply: true, cap: AMENDS_CAP });
    return { verdict: r.verdict, line: amendsLine(r) };
  } catch (e) {
    if (e?.code === "42P01") return { verdict: "absent", line: "amends: no `amend_carried` table yet (075 not applied) — nothing recorded" };
    return { verdict: "error", line: `amends: NOT recorded (non-fatal) — ${String(e?.message ?? e).slice(0, 200)}` };
  }
}

/**
 * THE FIRST STOCK OF EVERY CHEST THE SETTLEMENTS ADMITTED (WLD-27,
 * chest-stock.mjs): once per chest, ever, by the plan and by the nonce. Like
 * the carried step, its failure is one named line and never undoes the
 * settlement rows already committed; a store without the unit acts or the law
 * says so. An unstocked chest is a line, not a failure.
 */
export async function stockedOnTick(client, { stock = stockChests, crossing = currentCrossing, on = null } = {}) {
  // dark by default (src/chests-candy.mjs): the first stock writes nothing
  const open = on ?? (await import("../../src/chests-candy.mjs")).chestsCandyOn();
  if (!open) return { verdict: "ok", line: "chests: not stocked — chests and candy are off at this office (WORLD_CHESTS_CANDY unset)" };
  try {
    const r = await stock(client, { crossing: crossing() });
    return { verdict: "ok", line: r.line, result: r };
  } catch (e) {
    return { verdict: "error", line: `chests: NOT stocked (non-fatal) — ${String(e?.message ?? e).slice(0, 200)}` };
  }
}

/**
 * ORPHANED SET-DOWNS COME BACK (WLD-27 F0, drop-recovery.mjs): every
 * `units:drop` older than one tick with neither a mark filed for it nor an
 * undo is returned to its dropper, once, with a line. Not gated on the carried
 * step — it reads acts and claims, not settlements. Non-fatal like its
 * neighbours: an error is one named line and the next tick tries again.
 */
export async function dropsRecoveredOnTick(client, { recover = recoverOrphanDrops, now = Date.now, crossing = currentCrossing } = {}) {
  try {
    const r = await recover(client, { now: now(), crossing: crossing() });
    return { verdict: "ok", line: r.line, result: r };
  } catch (e) {
    return { verdict: "error", line: `drops: NOT reconciled (non-fatal) — ${String(e?.message ?? e).slice(0, 200)}` };
  }
}

/**
 * A NAMED CREATURE'S ENDING (WLD-25, creature-endings.mjs): every creature that
 * stays and was finished before the newest landed settlement's instant is
 * ended, and what it carries goes to its first finisher, once. On every --apply
 * tick, like the drops: it reads acts and the settlements table, never the
 * carried rows. Non-fatal like its neighbours: an error is one named line and
 * the next tick tries again. The law is the creatures' at the blessed ref of
 * the tick's own world checkout.
 */
export async function endingsOnTick(client, repo, { end = endCreatures, loadLaw = null, now = Date.now } = {}) {
  try {
    const law = loadLaw ? await loadLaw() : await (await import("../../src/creatures.mjs")).loadCreatureLaw({ repo });
    const r = await end(client, { law, now: now() });
    return { verdict: "ok", line: r.line, result: r };
  } catch (e) {
    return { verdict: "error", line: `endings: NOT ended (non-fatal) — ${String(e?.message ?? e).slice(0, 200)}` };
  }
}

/** The stock step, gated on the carried step that proves admission (finding 7). */
export async function chestsAfterCarried(client, carried, { stock = stockedOnTick } = {}) {
  if (carried?.verdict !== "ok")
    return { verdict: "held", line: `chests: not stocked this tick — the carried step did not settle (${carried?.verdict ?? "not run"}), and a chest is stocked only on the settlement that carried it` };
  return stock(client);
}

// ── the arm ──────────────────────────────────────────────────────────────────

const iso = (d) => (d == null ? "—" : new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z"));

function render(plan, extra, { dbName, user, repo, mode }) {
  const count = (s) => plan.filter((r) => r.state === s).length;
  const lines = [
    `settlements-backfill · ${mode} · ${repo} → ${dbName} as ${user}`,
    `tags ${plan.length} · new ${count("new")} · present ${count("present")} · DRIFT ${count("DRIFT")} · CONFLICT ${count("CONFLICT")} · extra rows ${extra.length}`,
    "",
    "  S     state     tag_sha   published_at          window  blessed_at",
  ];
  for (const r of plan) {
    lines.push(`  ${String(r.number).padStart(4)}  ${r.state.padEnd(8)}  ${r.tag_sha.slice(0, 8)}  ${iso(r.published_at)}  ${String(r.window_id ?? "—").padStart(6)}  ${iso(r.blessed_at)}`
      + (r.lightweight ? "  (lightweight tag: no bless date)" : "")
      + (r.state === "CONFLICT" ? `  ← table holds ${r.have.tag_sha.slice(0, 8)}` : "")
      + (r.state === "DRIFT" ? `  ← differs on ${r.drift.join(", ")}` : ""));
  }
  if (extra.length) lines.push("", `rows in the table with no tag behind them: ${extra.map((n) => `S${n}`).join(", ")}`);
  return lines.join(NL);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  // `--soft-step <carried|amends|chests|drops|endings>`: read a previous run's output on stdin and
  // print that step's keep status (softStepStatus). office-keep.sh's use; it
  // opens no checkout and no connection.
  if (flag("soft-step")) {
    const step = arg("soft-step");
    if (!Object.hasOwn(SOFT_STEP_RULES, step)) { console.error(`--soft-step takes ${Object.keys(SOFT_STEP_RULES).join(", ")}`); process.exit(2); }
    const { readFileSync } = await import("node:fs");
    let text = "";
    try { text = readFileSync(0, "utf8"); } catch { text = ""; }
    console.log(softStepStatus(text, step));
    process.exit(0);
  }
  const apply = flag("apply"), verify = flag("verify"), json = flag("json"), quiet = flag("quiet");
  if (apply && verify) { console.error("--apply and --verify are two different questions; ask one"); process.exit(2); }
  const mode = apply ? "APPLY" : verify ? "VERIFY" : "dry-run";

  const repoArg = arg("world-repo");
  if (!repoArg) { console.error("--world-repo <checkout> is required"); process.exit(2); }
  const repo = resolve(repoArg);

  const url = arg("pg-url") ?? (process.env.PGUSER ? null : process.env.WORLD2_PG_URL);
  if (!url && !process.env.PGDATABASE) {
    console.error("no --pg-url, no PG* environment, and no WORLD2_PG_URL (the office's own connection is the pen 018 grants)");
    process.exit(2);
  }
  const dbName = url ? decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) : process.env.PGDATABASE;
  if (apply && !/lab|scratch/i.test(dbName) && !flag("prod")) {
    console.error(`--apply refuses database "${dbName}": its name says neither "lab" nor "scratch". Pass --prod as WELL if this is the ship. ` +
      "(On the box there is no separate lab store: /srv/world2-lab/lab.env and /etc/postmark-office.env both name world2_dev.)");
    process.exit(2);
  }

  let tagLines;
  try { tagLines = readTagLines(repo); }
  catch (e) { console.error(String(e?.message ?? e)); process.exit(2); }
  const derived = settlementRowsFrom(tagLines);
  if (!derived.length) { console.error(`${repo} carries no settlement/S<n> tag at all — a shallow or unfetched clone answers nothing, not zero`); process.exit(2); }

  const client = url ? new pg.Client({ connectionString: url }) : new pg.Client();
  try { await client.connect(); }
  catch (e) {
    // A wrong role, a wrong host, a store that is down: say so in one line and
    // exit 2 (cannot run). A stack trace here would name the driver, not the store.
    console.error(`cannot reach ${dbName}: ${String(e?.message ?? e)}`);
    process.exit(2);
  }
  let receipt;
  try {
    const { rows: [who] } = await client.query("SELECT current_user AS u, current_database() AS d");
    const { rows: windows } = await client.query("SELECT id, closes_at FROM windows ORDER BY id");
    let existing;
    try { ({ rows: existing } = await client.query("SELECT number, tag_sha, published_at, window_id, blessed_at FROM settlements ORDER BY number")); }
    catch (e) {
      if (e?.code === "42P01") { console.error(`no \`settlements\` table in ${who.d} — apply world2/schema/018_settlements.sql first`); process.exit(2); }
      throw e;
    }
    const { plan, extra } = planFrom(derived, existing, windows);
    const conflicts = plan.filter((r) => r.state === "CONFLICT");
    const drift = plan.filter((r) => r.state === "DRIFT");
    const fresh = plan.filter((r) => r.state === "new");

    const text = render(plan, extra, { dbName: who.d, user: who.u, repo, mode });
    if (!json && !quiet) console.log(text);

    let wrote = 0, verdict = "ok", carried = null, drops = null, amends = null, endings = null;
    if (quiet && !apply && !verify) console.log(text.split(NL)[1]);   // the census line, nothing else
    if (conflicts.length) {
      verdict = "CONFLICT";
      console.error(`${NL}REFUSED: ${conflicts.length} tag(s) moved — ${conflicts.map((r) => `S${r.number}`).join(", ")}. A blessing is canon; a moved tag is a person's finding, not a row to rewrite.`);
    } else if (apply) {
      // THE SETTLEMENT NAMES ITS SNAPSHOT (POS-358, 065): the snapshot the seal
      // took at the window this crossing closed, written with the row, since no
      // pen may UPDATE a settlement. A store without 065 has no column, and the
      // row is written exactly as before.
      const { rows: [linkable] } = await client.query(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'settlements' AND column_name = 'snapshot_id') AS ok");
      await client.query("BEGIN");
      for (const r of fresh) {
        if (linkable.ok) {
          await client.query(
            `INSERT INTO settlements (number, tag_sha, published_at, window_id, blessed_at, snapshot_id)
             VALUES ($1, $2, $3, $4, $5, (SELECT id FROM world_snapshots WHERE window_id = $4)) ON CONFLICT (number) DO NOTHING`,
            [r.number, r.tag_sha, r.published_at, r.window_id, r.blessed_at]);
        } else {
          await client.query(
            "INSERT INTO settlements (number, tag_sha, published_at, window_id, blessed_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (number) DO NOTHING",
            [r.number, r.tag_sha, r.published_at, r.window_id, r.blessed_at]);
        }
        wrote++;
      }
      await client.query("COMMIT");
      const { rows: [{ n }] } = await client.query("SELECT count(*)::int AS n FROM settlements");
      // The receipt names what moved AND what stands, so a tick that wrote
      // nothing still says so with the number the table is at.
      console.log(`${quiet ? "" : NL}wrote ${wrote} row(s)${wrote ? ` — ${fresh.map((r) => `S${r.number}`).join(", ")}` : ""}; the table now holds ${n} (tags in the checkout: ${derived.length})`);
      if (drift.length) console.error(`${NL}${drift.length} present row(s) differ from their tag on a non-sha column and were LEFT ALONE (this tool never updates): ${drift.map((r) => `S${r.number}`).join(", ")}`);
      // WHICH SETTLEMENT CARRIED EACH MARK (049, POS-142 Proposal B): with the
      // settlement rows in, the published marks the store has no row for are
      // asked of 1.0 and recorded, checked against its receipt before commit.
      // After the one-time backfill that is a bless's own new marks plus the few
      // git cannot answer. Before it, the cap skips and says so.
      carried = await carriedOnTick(client, repo);
      if (!json) console.log(carried.line);
      // THE FIRST STOCK (WLD-27), after the settlement rows: a chest the newest
      // settlement admitted is stocked by the tick that first sees it.
      // ONLY ON A SETTLED CARRIED STEP (Bevel's review, finding 7): the stock's proof
      // of admission IS the carried rows, so a tick whose carried step erred,
      // refused or skipped stocks nothing and says why; the next tick tries again.
      const chests = await chestsAfterCarried(client, carried);
      if (!json) console.log(chests.line);
      // WHICH SETTLEMENT CARRIED EACH DOOR AMEND (POS-612, 075): the receipt's
      // `last_amended`. Non-fatal; an unproven amend is named, never written.
      amends = await amendsOnTick(client, repo);
      if (!json) console.log(amends.line);
      if (carried.verdict === "DISAGREE") verdict = "CONFLICT";
    } else if (verify) {
      const missing = fresh.map((r) => r.number);
      if (missing.length || drift.length || extra.length) {
        verdict = "DRIFT";
        console.error(`${NL}DRIFT: ` + [
          missing.length ? `${missing.length} tag(s) with no row — ${missing.map((n) => `S${n}`).join(", ")}` : null,
          drift.length ? `${drift.length} row(s) differing from their tag — ${drift.map((r) => `S${r.number} (${r.drift.join(", ")})`).join(", ")}` : null,
          extra.length ? `${extra.length} row(s) with no tag — ${extra.map((n) => `S${n}`).join(", ")}` : null,
        ].filter(Boolean).join("; "));
      } else {
        console.log(`${NL}EQUAL: ${plan.length} tag(s), ${plan.length} row(s), every column agrees (compared ${plan.length})`);
      }
    }
    // ORPHANED SET-DOWNS (WLD-27 F0), on EVERY --apply tick — a new settlement
    // or none, a refused tag or not: it reads acts and claims, not the tags.
    // This is the office tick's one live step (postmark-office-keep.timer →
    // office-keep.sh → here, every 15 minutes), so "older than one tick" is
    // measured against that cadence (drop-recovery.mjs § TICK_MS).
    if (apply) {
      drops = await dropsRecoveredOnTick(client);
      if (!json) console.log(drops.line);
      // A NAMED CREATURE'S ENDING (WLD-25), on every --apply tick after the
      // settlement rows: it reads the newest landed settlement, whether this
      // tick wrote it or an earlier one did.
      endings = await endingsOnTick(client, repo);
      if (!json) console.log(endings.line);
    }
    receipt = { mode, verdict, db: who.d, user: who.u, repo, tags: derived.length, new: fresh.length, present: plan.filter((r) => r.state === "present").length,
      drift: drift.map((r) => r.number), conflict: conflicts.map((r) => r.number), extra, wrote, compared: plan.length,
      rows: plan.map((r) => ({ number: r.number, state: r.state, tag_sha: r.tag_sha, published_at: iso(r.published_at), window_id: r.window_id, blessed_at: iso(r.blessed_at) })),
      ...(carried ? { carried: carried.line } : {}), ...(amends ? { amends: amends.line } : {}), ...(drops ? { drops: drops.line } : {}), ...(endings ? { endings: endings.line } : {}) };
  } finally {
    await client.end();
  }
  if (json) console.log(JSON.stringify(receipt, null, 1));
  process.exit(receipt.verdict === "ok" ? 0 : 1);
}
