#!/usr/bin/env node
// amend-carried.mjs — WHICH SETTLEMENT CARRIED EACH DOOR AMEND (POS-612, 075).
//
//   node world2/tools/amend-carried.mjs --world-repo <checkout> [--apply [--prod] | --verify] [--list] [--json]
//
//   --list   also prints every PROVEN row, one line each: the settlement, the
//            mark and the claim (dry run: the rows --apply would write; with
//            --apply: the rows it wrote). The dry run's other lines name only
//            the amends that get no row, so --list is what a person audits
//            before --apply --prod (DEPLOY.md § 075). With --json, `proposed`.
//
//   env: PG* or --pg-url or WORLD2_PG_URL, the office's own connection (075's pen
//        is `office_api`, as 049's is).
//
//   EXIT: 0 · 1 under --verify, DRIFT (a row git no longer proves, or a POS-446
//         amend with no row) · 2 cannot run (no checkout, no store, no table).
//
// ── THE FINDING THIS CLOSES ─────────────────────────────────────────────────
//
// A mark's receipt named only the settlement that FIRST carried it, so keith's
// stool, amended at S104, read "published at S65 (fc74bf68)" and was misread as
// an amend that never landed. Nothing in the town recorded which settlement
// carried a LATER version. This writes it, once per amend, and the receipt
// reads it as `last_amended` (src/world2-claims.mjs § lastAmendedRow).
//
// ── WHAT IS AN AMEND (G1, Wright 2026-10-14) ────────────────────────────────
//
// A `locked` claim with `supersedes` set and no `data._ingested_from`: the
// resident's own act at the door. marks-ingest's amends are file-side changes
// (migrations, hand commits) written at the window open AFTER the bless that
// carried them, so their window would name the wrong settlement; they are not
// planned. Seed and backfill rows have `supersedes` null and are not amends.
//
// ── WHICH SETTLEMENT, AND THE PROOF (G2, G8) ────────────────────────────────
//
// The candidate is the lowest settlement whose `window_id` is at or after the
// amend's window: the crossing that closed it, or the first one past a window
// no settlement closed (S104 closed 244; window 229 had none, so S94 is its
// candidate). The candidate is written only when GIT PROVES IT CARRIED THIS
// AMEND: the mark's file, at its filed path on each side (world-journal.mjs §
// filedPathOfAt), differs between the settlement before it and the candidate,
// AND the candidate's file holds the amend's own content: its frontmatter `date`
// is the amend's (every door amend restamps it), or, for an undated amend, its
// body is the claim's (review-612 F1: a migration that rewrites a file carries
// nobody's amend). Measured on 10-14: keith's stool at S104 carries `date:
// 2026-10-12T04:05:28.542Z`, his amend's, proven; berthillon's cone did not
// change in S93..S94 (0 commits), so the rule writes no row for it. The
// sweep never carried POS-446's five door amends; a hand commit did, at S100,
// and 075 writes those five itself. A row is never a guess.
//
//   new        proven, no row — --apply writes it
//   unproven   the candidate settlement did not change the file — no row, named
//   hand       one of POS-446's five with no row — 075 owes it; --verify reds
//   unsettled  no settlement has closed the amend's window yet
//
// ── WHAT IT REFUSES ─────────────────────────────────────────────────────────
//
//   · a row is never rewritten: the plan covers only amends with no row, and
//     INSERT is the only write any pen holds on the table.
//   · --apply on a database whose name says neither `lab` nor `scratch` without
//     --prod beside it (settlements-backfill's guard, for the same reason).
//   · a checkout that is not the top of a work tree.

import pg from "pg";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { filedPathOfAt } from "../../src/world-journal.mjs";
import { isRepoRoot } from "../../src/settlements.mjs";

/** The tick's ceiling, as mark_carried's: the one-time --apply writes history. */
export const TICK_CAP = 200;

/**
 * POS-446's five, which 075 writes by hand at S100 (world 10e5b194). Listed
 * here so the plan never offers them to the window rule and the verify reds
 * when a store holds their claims and not their rows. test/amend-carried.test.mjs
 * holds this list and 075's to each other.
 */
export const HAND_CARRIED = Object.freeze([
  { mark: "berthillon/cone-peche-de-vigne-2026-08-27", window: 229 },
  { mark: "berthillon/cone-poire-williams-2026-09-15", window: 229 },
  { mark: "vermillion/pagani-huayra", window: 212 },
  { mark: "vermillion/pagani-zonda", window: 212 },
  { mark: "lupi/the-unworn-step", window: 207 },
].map(Object.freeze));
const isHand = (a) => HAND_CARRIED.some((h) => h.mark === String(a.slug) && h.window === Number(a.window_id));

// ── the pure half ────────────────────────────────────────────────────────────

/** A door amend: the resident's own act, never a marks-ingest row or a seed. */
export const isDoorAmend = (c) => c?.status === "locked" && c.supersedes != null && c.slug != null && !c.ingested;

/**
 * The plan for the amends with no row.
 *
 *   amends       claim rows `{ id, slug, status, window_id, supersedes, ingested }`
 *   have         claim ids that already have a row
 *   settlements  `{ number, window_id }` rows
 *   proof        (mark, n, prev, claim) → true | false: does S<n> hold THIS
 *                amend (proofFrom below)
 */
export function planAmendsCarried({ amends = [], have = new Set(), settlements = [], proof }) {
  const settled = settlements
    .filter((s) => s.window_id != null)
    .map((s) => ({ n: Number(s.number), w: Number(s.window_id) }))
    .sort((a, b) => a.n - b.n);
  const numbers = settlements.map((s) => Number(s.number)).sort((a, b) => a - b);
  const plan = [];
  for (const a of amends) {
    if (!isDoorAmend(a) || have.has(String(a.id))) continue;
    const base = { claim: String(a.id), mark: String(a.slug), window: Number(a.window_id) };
    if (isHand(a)) { plan.push({ ...base, state: "hand" }); continue; }
    const hit = settled.find((s) => s.w >= base.window);
    if (!hit) { plan.push({ ...base, state: "unsettled" }); continue; }
    const prev = numbers.filter((n) => n < hit.n).pop() ?? null;
    const ok = prev != null && proof(base.mark, hit.n, prev, { date: a.date ?? null, body: a.body ?? null }) === true;
    plan.push(ok ? { ...base, state: "new", settlement: hit.n } : { ...base, state: "unproven", candidate: hit.n, prev });
  }
  return plan;
}

// ── the git half ─────────────────────────────────────────────────────────────

const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024,
}).trim();

/**
 * A mark file's frontmatter `date` and its body, or null when the text has no
 * frontmatter. PURE. Line endings are normalised; quotes around the date go.
 */
export function markFileParts(text) {
  const t = String(text ?? "").replace(/\r\n/g, "\n");
  if (!t.startsWith("---\n")) return null;
  const end = t.indexOf("\n---", 4);
  if (end === -1) return null;
  const front = t.slice(4, end);
  const body = t.slice(end + 4).replace(/^[^\n]*\n?/, "");
  const m = /^date:\s*(.+?)\s*$/m.exec(front);
  return { date: m ? m[1].replace(/^["']|["']$/g, "") : null, body };
}

/**
 * Does a file's text hold THIS amend? PURE. A dated amend (every door amend
 * restamps `date`, mark-render.mjs) is proven by its own date in the file's
 * frontmatter, compared as an instant; an undated one by its body, trimmed.
 * Anything else is no proof.
 */
export function holdsAmend(text, { date = null, body = null } = {}) {
  const parts = markFileParts(text);
  if (!parts) return false;
  if (date != null && date !== "") {
    const a = Date.parse(String(date)), b = Date.parse(String(parts.date ?? ""));
    return Number.isFinite(a) && Number.isFinite(b) ? a === b : String(date) === String(parts.date);
  }
  return body != null && String(body).trim() === parts.body.trim();
}

/**
 * THE PROOF that S<n> carried THIS amend, not merely that it changed the file
 * (review-612 F1). Two things must hold:
 *
 *   · the mark's file changed between S<prev> and S<n>, each at the path the
 *     mark is filed at on that side (a move between them is still one mark);
 *   · the file at S<n> holds the amend's own content (`holdsAmend`).
 *
 * The second is what refuses the false-positive classes measured on 10-14: the
 * household un-nesting at S99 (857dc401) rewrote ~100 mark files' content, the
 * canonical key order at S64 (a0c779a0) 36 more, and S100's sweep 45+ parcels
 * with no door amend. Each changes a file without carrying anybody's amend, and
 * a row written on such a change would be permanent (the table is insert-only).
 * A missing tag or an unreadable path or blob is false, never a pass.
 */
export function proofFrom(repo) {
  const commits = new Map();
  const commitOf = (n) => {
    if (!commits.has(n)) {
      let sha = null;
      try { sha = git(repo, ["rev-parse", "--verify", "-q", `refs/tags/settlement/S${n}^{commit}`]) || null; } catch { sha = null; }
      commits.set(n, sha);
    }
    return commits.get(n);
  };
  const blobOf = (sha, mark) => {
    if (!sha) return null;
    const path = filedPathOfAt(repo, sha)(mark);
    if (!path) return null;
    try { return git(repo, ["rev-parse", "--verify", "-q", `${sha}:${path}`]) || null; } catch { return null; }
  };
  return (mark, n, prev, claim = {}) => {
    const now = blobOf(commitOf(n), mark);
    if (!now || now === blobOf(commitOf(prev), mark)) return false;
    let text;
    try { text = git(repo, ["cat-file", "blob", now]); } catch { return false; }
    return holdsAmend(text, claim);
  };
}

// ── the store half ───────────────────────────────────────────────────────────

const AMENDS_SQL = `SELECT c.id, c.slug, c.status, c.window_id, c.supersedes, c.body, c.data->>'date' AS date,
                           (coalesce(c.data, '{}'::jsonb) ? '_ingested_from') AS ingested
                      FROM claims c
                     WHERE c.status = 'locked' AND c.supersedes IS NOT NULL AND c.slug IS NOT NULL
                       AND NOT EXISTS (SELECT 1 FROM amend_carried a WHERE a.claim = c.id)
                     ORDER BY c.window_id, c.id`;

/**
 * The write, shared by this tool's --apply and settlements-backfill's tick.
 * Plans the door amends with no row and INSERTs the proven ones in one
 * transaction. Returns a receipt; throws only when it cannot run.
 */
export async function recordAmendsCarried(client, repo, { apply = false, cap = Infinity, proof = null } = {}) {
  if (!isRepoRoot(repo)) throw new Error(`${repo} is not the top of a git work tree — refusing to read another repo's history`);
  const { rows: amends } = await client.query(AMENDS_SQL);
  const { rows: settlements } = await client.query("SELECT number, window_id FROM settlements ORDER BY number");
  const { rows: [{ n: rows }] } = await client.query("SELECT count(*)::int AS n FROM amend_carried");
  const doors = amends.filter(isDoorAmend);
  const receipt = { rows, amends: doors.length, wrote: 0, verdict: "ok" };
  const plan = planAmendsCarried({ amends: doors, settlements, proof: proof ?? proofFrom(repo) });
  const count = (s) => plan.filter((p) => p.state === s).length;
  Object.assign(receipt, { new: count("new"), unproven: count("unproven"), hand: count("hand"), unsettled: count("unsettled"), plan });
  const fresh = plan.filter((p) => p.state === "new");
  // THE CAP COUNTS THE ROWS A TICK WOULD WRITE (review-612 F3): unproven,
  // unsettled and POS-446's amends never get a row from here, so counting them
  // would let a pile that can never shrink hold the tick at SKIPPED for good.
  if (fresh.length > cap) return { ...receipt, verdict: "skipped", why: `${fresh.length} proven amends have no row, more than one tick carries (cap ${cap}): the one-time history has not run — world2/tools/amend-carried.mjs --apply` };
  if (!apply || !fresh.length) return receipt;
  await client.query("BEGIN");
  try {
    for (const p of fresh)
      await client.query(
        "INSERT INTO amend_carried (claim, mark, settlement) VALUES ($1, $2, $3) ON CONFLICT (claim) DO NOTHING",
        [p.claim, p.mark, p.settlement]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  }
  const by = new Map();
  for (const p of fresh) by.set(p.settlement, (by.get(p.settlement) ?? 0) + 1);
  return { ...receipt, wrote: fresh.length, by_settlement: Object.fromEntries([...by].sort((a, b) => a[0] - b[0])) };
}

/**
 * Every row git can re-prove, re-proved; and every POS-446 amend a store holds
 * with no row. Rows carried by hand are counted, not re-proved: the sweep's
 * settlement never changed their files, which is why a person carried them.
 */
export async function verifyAmendsCarried(client, repo, { proof = null } = {}) {
  if (!isRepoRoot(repo)) throw new Error(`${repo} is not the top of a git work tree — refusing to read another repo's history`);
  const prove = proof ?? proofFrom(repo);
  const { rows } = await client.query(
    `SELECT a.claim, a.mark, a.settlement, a.by_hand, c.body, c.data->>'date' AS date
       FROM amend_carried a JOIN claims c ON c.id = a.claim ORDER BY a.mark, a.settlement`);
  const { rows: settlements } = await client.query("SELECT number FROM settlements ORDER BY number");
  const numbers = settlements.map((s) => Number(s.number));
  const disagree = [];
  let compared = 0;
  for (const r of rows) {
    if (r.by_hand) continue;
    compared++;
    const n = Number(r.settlement);
    const prev = numbers.filter((x) => x < n).pop() ?? null;
    if (prev == null || prove(r.mark, n, prev, { date: r.date, body: r.body }) !== true) disagree.push({ mark: r.mark, why: [`row S${n}: git does not prove S${n} carried this amend`] });
  }
  const { rows: amends } = await client.query(AMENDS_SQL);
  for (const a of amends.filter(isDoorAmend).filter(isHand))
    disagree.push({ mark: a.slug, why: [`POS-446's hand carriage at candle ${a.window_id} has no row: 075 owes it`] });
  return { rows: rows.length, hand: rows.length - compared, compared, verdict: disagree.length ? "DRIFT" : "ok", disagree };
}

/** The proven rows of a plan, one audit line each: what --apply writes (or wrote). */
export function proposedLines(plan = []) {
  return plan.filter((p) => p.state === "new")
    .sort((a, b) => a.settlement - b.settlement || (a.mark < b.mark ? -1 : a.mark > b.mark ? 1 : 0))
    .map((p) => `  new        S${p.settlement}  ${p.mark}  claim ${p.claim}  candle ${p.window}`);
}

/** The one line a tick journals. */
export function amendsLine(r) {
  if (r.verdict === "skipped") return `amends: SKIPPED — ${r.why}`;
  const by = r.by_settlement ? ` (${Object.entries(r.by_settlement).map(([s, c]) => `S${s}: ${c}`).join(", ")})` : "";
  const unproven = (r.plan ?? []).filter((p) => p.state === "unproven");
  return `amends: wrote ${r.wrote}${by}; the table holds ${r.rows + r.wrote}`
    + ` · no row: unproven ${r.unproven ?? 0}, unsettled ${r.unsettled ?? 0}, POS-446 owed ${r.hand ?? 0}`
    + (unproven.length ? ` — unproven: ${unproven.slice(0, 5).map((p) => `${p.mark} (candle ${p.window} → S${p.candidate})`).join(", ")}${unproven.length > 5 ? ", …" : ""}` : "");
}

// ── the arm ──────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i === -1 ? d : process.argv[i + 1]; };
  const flag = (k) => process.argv.includes(`--${k}`);
  const apply = flag("apply"), verify = flag("verify"), json = flag("json"), list = flag("list");
  if (apply && verify) { console.error("--apply and --verify are two different questions; ask one"); process.exit(2); }
  if (list && verify) { console.error("--list names the rows a plan proves; --verify re-proves the table: ask one"); process.exit(2); }
  const mode = apply ? "APPLY" : verify ? "VERIFY" : "dry-run";

  const repoArg = arg("world-repo");
  if (!repoArg) { console.error("--world-repo <checkout> is required"); process.exit(2); }
  const repo = resolve(repoArg);

  const url = arg("pg-url") ?? (process.env.PGUSER ? null : process.env.WORLD2_PG_URL);
  if (!url && !process.env.PGDATABASE) {
    console.error("no --pg-url, no PG* environment, and no WORLD2_PG_URL (the office's own connection is the pen 075 grants)");
    process.exit(2);
  }
  const dbName = url ? decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) : process.env.PGDATABASE;
  if (apply && !/lab|scratch/i.test(dbName) && !flag("prod")) {
    console.error(`--apply refuses database "${dbName}": its name says neither "lab" nor "scratch". Pass --prod as WELL if this is the ship.`);
    process.exit(2);
  }

  const client = url ? new pg.Client({ connectionString: url }) : new pg.Client();
  try { await client.connect(); }
  catch (e) { console.error(`cannot reach ${dbName}: ${String(e?.message ?? e)}`); process.exit(2); }

  const t0 = Date.now();
  let out, code = 0;
  try {
    const { rows: [who] } = await client.query("SELECT current_user AS u, current_database() AS d");
    try { await client.query("SELECT 1 FROM amend_carried LIMIT 0"); }
    catch (e) {
      if (e?.code === "42P01") { console.error(`no \`amend_carried\` table in ${who.d} — apply world2/schema/075_amend_carried.sql first`); process.exit(2); }
      throw e;
    }
    if (!json) console.log(`amend-carried · ${mode} · ${repo} → ${who.d} as ${who.u}`);
    if (verify) {
      out = await verifyAmendsCarried(client, repo);
      if (!json) {
        if (out.verdict === "ok") console.log(`EQUAL: ${out.compared} row(s) re-proved by git; ${out.hand} carried by hand (the table holds ${out.rows})`);
        else console.error(`DRIFT: ${out.disagree.length} — ${out.disagree.slice(0, 20).map((d) => `${d.mark} (${d.why.join("; ")})`).join(", ")}`);
      }
      code = out.verdict === "ok" ? 0 : 1;
    } else {
      out = await recordAmendsCarried(client, repo, { apply });
      if (!json) {
        if (list) for (const line of proposedLines(out.plan)) console.log(line);
        for (const p of (out.plan ?? []).filter((x) => x.state !== "new"))
          console.log(`  ${p.state.padEnd(10)} ${p.mark} candle ${p.window}${p.candidate != null ? ` → S${p.candidate} (S${p.prev}..S${p.candidate} did not change the file)` : ""}`);
        console.log(amendsLine(out));
      }
    }
  } finally {
    await client.end();
  }
  const proposed = list && out?.plan ? out.plan.filter((p) => p.state === "new").map(({ settlement, mark, claim, window }) => ({ settlement, mark, claim, window })) : undefined;
  if (json) console.log(JSON.stringify({ mode, ...out, plan: undefined, proposed, ms: Date.now() - t0 }, null, 1));
  else console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  process.exit(code);
}
