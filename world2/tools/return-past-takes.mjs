#!/usr/bin/env node
// return-past-takes.mjs — THE ONE-TIME RETURN OF PAST SWEEP TAKES TO DRAFTS
// (WLD-51; Darko, 2026-10-15 19:06).
//
//   node world2/tools/return-past-takes.mjs --dry-run [--world <world clone>]
//   node world2/tools/return-past-takes.mjs --apply   [--world <world clone>]
//
//   env: WORLD2_CLEARING_URL = postgres://clearing_job:…@localhost/world2_dev
//
// EXIT CODES: 0 the plan (dry run) or the return (apply) · 1 REFUSED: a listed
// mark did not verify, and NOTHING was written · 2 a bad argument or a missing
// credential.
//
// RULED (Darko, 19:06): "The 66 past sweep takes: yes, return them quietly as
// private drafts at ✦0 (16 owners, no note, the 6 non-takes, current-the-
// reader's 10 and quibble's mooncakes excluded), by the same pen." G1 (13:00)
// made a take write the mark back to its household's drafts; before the store
// port, the git sweep did it by returning the file to the house's draft
// branch. The store era wrote only a retired row, and so did nothing for the
// marks it took before G1, nor for the git-era takes, whose draft branches the
// store's my-drafts never reads. This tool writes those drafts once.
//
// ── THE LIST IS THE REVIEW ──────────────────────────────────────────────────
//
// PAST_TAKES below is every mark this returns, each with the world commit
// that took it (a `settlement:` sweep commit on main whose parent's
// publication registry holds the mark's row and whose own does not). It was
// derived 2026-10-15 19:4x EDT, read-only, from prod's store (the 82 retired
// marks) and world main at daef8487 (the 11 registry-removing sweep commits),
// and it is the 66 proven sweep takes with no withdraw act MINUS the two that a
// resident is carrying now:
//
//   little-bird/a-box-of-nine-mooncakes        quibble's last act on it: take
//   little-bird/a-box-of-nine-at-the-snug-mooring  milo's last act on it: take
//
// Darko named the mooncakes; the snug-mooring box is the same case found by the
// same read (a held thing is not returned to a sketchbook while someone carries
// it), so it is left out by the rule and named in the report. Also out, as
// ruled: the 6 retirements that were not sweep takes (the-town/pledges, a law
// commit; three marks that never published; two stale twins) and
// current-the-reader's 10, each withdrawn by its own author's act.
//
// ── WHAT IT WRITES, AND WITH WHICH PEN ──────────────────────────────────────
//
// Per mark, in ONE transaction under `clearing_job` (the retire step's pen):
//   1. `marks.retired_cause = 'settlement-unpublish'` where it is NULL (every
//      past take predates 076's column), naming the door it left by;
//   2. materialize.mjs § returnToDrafts, the take's own writer, at the window
//      the mark was retired at: a private draft at ✦0, its owner the claimant,
//      in the house the mark stood in, carrying `data._returned`. 076's trigger
//      holds every clause in SQL (the house, the take's window, once).
// No alert: the mark-taken alert lasts 14 settlements from the take, and every
// one of these was taken weeks ago (src/alerts.mjs § markTakenAlerts).
//
// ── IT VERIFIES BEFORE IT WRITES, AND REFUSES WHOLE ─────────────────────────
//
// Every listed mark must, at run time: be retired; carry no cause, or the
// sweep's; have no withdraw act; be held by no one (its last holding act is
// not a give or a take); have no live claim (pending or locked in the open
// window). With --world, its commit must also prove the take. One mark that
// fails refuses the whole run with its name and nothing is written: the list
// was reviewed as a whole. A mark its house already holds a draft of is
// `kept` by returnToDrafts, as at the take.
//
// Running it on prod is a box step for Wright, after the w43 ship and 076;
// never a lane's.

import { execFileSync } from "node:child_process";

import { returnToDrafts } from "./materialize.mjs";

/** [slug, the world sweep commit that took it]. The list is the review; see the header. */
export const PAST_TAKES = Object.freeze([
  ["aion-solare/dusk-light", "1984062faa76"],
  ["aion-solare/night-bloom", "1984062faa76"],
  ["aion-solare/return", "1984062faa76"],
  ["aion-solare/wild-architecture", "1984062faa76"],
  ["berthillon/pistache-cone-for-julian", "49e0fe89f05b"],
  ["caelum/border", "1984062faa76"],
  ["caelum/grass", "1984062faa76"],
  ["caelum/the-groves", "1984062faa76"],
  ["caelum/the-still-lake", "1984062faa76"],
  ["caelum/the-swing", "1984062faa76"],
  ["carta/canal-facing-doors", "1984062faa76"],
  ["carta/function-over-ornament", "1984062faa76"],
  ["carta/logbooks-and-tide-tables", "1984062faa76"],
  ["carta/october-morning-light", "1984062faa76"],
  ["carta/the-logged-route", "1984062faa76"],
  ["claude-of-dregg/the-grey-box", "1984062faa76"],
  ["east-facing-window/letters-and-hospitality", "1984062faa76"],
  ["east-facing-window/soft-ground", "1984062faa76"],
  ["east-facing-window/the-low-hills", "1984062faa76"],
  ["east-facing-window/the-worn-path", "1984062faa76"],
  ["limen/fog-on-the-lower-terrace", "9b280104a4c2"],
  ["limen/footpath-becomes-a-suggestion", "9b280104a4c2"],
  ["limen/the-descending-terraces", "9b280104a4c2"],
  ["limen/water-against-stone", "1984062faa76"],
  ["limen/wide-spaced-lanterns", "9b280104a4c2"],
  ["little-bird/a-box-of-nine-at-grove-wharf", "2afd0dab243e"],
  ["little-bird/snug-beef-shin-braise", "52c71a3a951c"],
  ["little-bird/snug-flaming-ice", "52c71a3a951c"],
  ["little-bird/snug-mint-and-soda", "52c71a3a951c"],
  ["little-bird/snug-radish-cake", "52c71a3a951c"],
  ["little-bird/snug-roof-radish-slaw", "52c71a3a951c"],
  ["little-bird/snug-sour-plum-drink", "52c71a3a951c"],
  ["little-bird/the-second-test-pebble", "ff2c50b843b0"],
  ["lysander/the-jetty", "1984062faa76"],
  ["lysander/the-workshop", "1984062faa76"],
  ["merrick-nocturne/blackwater-bend-footbridge", "1984062faa76"],
  ["merrick-nocturne/blackwater-bend-grove", "1984062faa76"],
  ["merrick-nocturne/blackwater-bend-stone-path", "1984062faa76"],
  ["orion-by-the-fire/eelgrass-coves", "1984062faa76"],
  ["orion-by-the-fire/the-guillemot-cliff", "1984062faa76"],
  ["orion-by-the-fire/the-pier", "1984062faa76"],
  ["orion-by-the-fire/the-shingle-beach", "1984062faa76"],
  ["orion-by-the-fire/the-signal-rule", "1984062faa76"],
  ["orion-by-the-fire/the-tidal-race", "1984062faa76"],
  ["rei/curving-paths", "1984062faa76"],
  ["rei/garden-growing-law", "1984062faa76"],
  ["rei/handmade-signs", "1984062faa76"],
  ["rei/leave-a-path-back", "1984062faa76"],
  ["rei/the-experiment-garden", "9b280104a4c2"],
  ["rei/the-local-courtesy", "1984062faa76"],
  ["rei/the-low-lanterns", "1984062faa76"],
  ["sage-reeves/no-grand-facades", "1984062faa76"],
  ["sage-reeves/quiet-streets", "1984062faa76"],
  ["sage-reeves/the-vista", "1984062faa76"],
  ["sage-reeves/worn-stone-steps", "1984062faa76"],
  ["sol-of-garrison/tactical-perimeter", "1984062faa76"],
  ["spar/the-open-shore", "1984062faa76"],
  ["spar/the-paired-tide", "1984062faa76"],
  ["spar/the-twin-sun", "1984062faa76"],
  ["wright/bench-wood", "1984062faa76"],
  ["wright/the-doorway-custom", "1984062faa76"],
  ["wright/the-honesty-covenant", "1984062faa76"],
  ["wright/the-makers-quarter", "1984062faa76"],
  ["wright/the-retaining-walls", "1984062faa76"],
]);

const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const has = (n) => process.argv.includes(n);

/** One row per listed slug the store holds, with every fact the verdict reads. Read under the pen that writes. */
export const VERIFY_SQL = `
  SELECT m.id::text AS id, m.slug, m.owner, m.household, m.status, m.retired_window, m.retired_cause,
         EXISTS (SELECT 1 FROM acts a WHERE a.class = 'mark' AND a.action = 'withdraw'
                  AND (a.object = m.slug OR (a.payload->>'by') || '/' || (a.payload->>'slug') = m.slug)) AS withdrawn,
         (SELECT a.action || ':' || coalesce(a.payload->>'holder', a.actor) FROM acts a
           WHERE a.class = 'holding' AND a.payload->>'thing' = m.slug ORDER BY a.id DESC LIMIT 1) AS last_holding,
         EXISTS (SELECT 1 FROM claims c JOIN windows w ON w.id = c.window_id
                  WHERE c.slug = m.slug AND (c.status = 'pending' OR (c.status = 'locked' AND w.status = 'open'))) AS live
    FROM marks m WHERE m.slug = ANY($1)`;

/**
 * The verdict for one listed mark, PURE: `row` is VERIFY_SQL's (or undefined),
 * `proven` the world commit's answer (true / false / null = not asked).
 * Returns null when it may be returned, else the sentence why not.
 */
export function refusalFor(row, proven = null) {
  if (!row) return "the store holds no mark of this slug";
  if (row.status !== "retired") return `it is ${row.status}, not retired`;
  if (row.retired_cause && row.retired_cause !== "settlement-unpublish") return `it was retired by ${row.retired_cause}, not by the sweep`;
  if (row.withdrawn) return "its author withdrew it: it left at their own act, not a take";
  if (/^(take|give):/.test(row.last_holding ?? "")) return `someone carries it now (${row.last_holding})`;
  if (row.live) return "it has a live claim: it is being put forward";
  if (proven === false) return "the world commit named for it does not show the sweep taking it";
  return null;
}

/** Does `commit` (a `settlement:` commit on world main) remove `slug`'s registry row? */
export function sweepTookIt(world, commit, slug) {
  const git = (...a) => execFileSync("git", ["-C", world, ...a], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
  const reg = (ref) => { try { return JSON.parse(git("show", `${ref}:WORLD/settlement-publications.json`)).published ?? {}; } catch { return null; } };
  if (!/^settlement: /.test(git("log", "-1", "--format=%s", commit))) return false;
  const before = reg(`${commit}^`), after = reg(commit);
  return !!before && !!after && slug in before && !(slug in after);
}

async function main() {
  const apply = has("--apply");
  if (!apply && !has("--dry-run")) {
    console.error("usage: return-past-takes.mjs --dry-run | --apply [--world <world clone>]   (WORLD2_CLEARING_URL, the clearing pen)");
    process.exit(2);
  }
  const url = process.env.WORLD2_CLEARING_URL;
  if (!url) { console.error("WORLD2_CLEARING_URL missing (role clearing_job): the return reads and writes under the take's own pen"); process.exit(2); }
  const world = arg("--world");

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const out = await returnPastTakes((text, args) => client.query(text, args), { list: PAST_TAKES, apply, world });
    process.stdout.write(`${JSON.stringify(out, null, 1)}
`);
    if (out.ran === false) {
      console.error(`RETURN REFUSED: ${out.refused.length} of ${out.listed} listed marks did not verify; nothing was written`);
      process.exitCode = 1;
    }
  } catch (e) {
    console.error(`RETURN REFUSED, nothing was written: ${e.message}`);
    process.exitCode = 1;
  } finally {
    try { await client.end(); } catch { /* already closed */ }
  }
}

/**
 * The run, on the caller's connection: `q` is (text, args) => Promise<{rows}>.
 * It opens and ends its own transaction: READ ONLY for the plan, and for
 * --apply one transaction that verifies, writes and commits, or rolls back
 * whole. Returns the plan (`dry_run`), the refusal (`ran: false`) or the report.
 */
export async function returnPastTakes(q, { list = PAST_TAKES, apply = false, world = null } = {}) {
  await q(apply ? "BEGIN" : "BEGIN READ ONLY");
  try {
    const slugs = list.map(([slug]) => slug);
    const rows = new Map((await q(VERIFY_SQL, [slugs])).rows.map((r) => [r.slug, r]));
    const plan = list.map(([slug, commit]) => {
      const row = rows.get(slug);
      const proven = world ? sweepTookIt(world, commit, slug) : null;
      return { slug, commit, owner: row?.owner ?? null, household: row?.household ?? null, window: row?.retired_window ?? null,
        ...(proven === null ? {} : { proven }), refused: refusalFor(row, proven) };
    });
    const refused = plan.filter((p) => p.refused);
    const owners = new Set(plan.map((p) => p.owner).filter(Boolean));
    if (refused.length) {
      await q("ROLLBACK");
      return { ran: false, refused: refused.map(({ slug, refused: why }) => ({ slug, why })), listed: plan.length };
    }
    if (!apply) {
      await q("ROLLBACK");
      return { dry_run: true, would_return: plan.length, owners: owners.size, marks: plan.map(({ refused: _r, ...p }) => p) };
    }
    await q("UPDATE marks SET retired_cause = 'settlement-unpublish' WHERE slug = ANY($1) AND status = 'retired' AND retired_cause IS NULL", [slugs]);
    const byWindow = new Map();
    for (const p of plan) byWindow.set(p.window, [...(byWindow.get(p.window) ?? []), p.slug]);
    const report = { returned: [], kept: [], unreturned: [] };
    for (const [windowId, inWindow] of [...byWindow].sort(([x], [y]) => x - y)) {
      const r = await returnToDrafts(q, { slugs: inWindow, windowId: Number(windowId) });
      report.returned.push(...r.returned); report.kept.push(...r.kept); report.unreturned.push(...r.unreturned);
    }
    if (report.unreturned.length) throw new Error(`${report.unreturned.length} listed mark(s) could not be returned: ${report.unreturned.map((u) => `${u.slug} (${u.why})`).join("; ")}`);
    await q("COMMIT");
    return { ran: true, ...report, count: report.returned.length, owners: owners.size };
  } catch (e) {
    try { await q("ROLLBACK"); } catch { /* the connection is already gone */ }
    throw e;
  }
}

// The junction lesson (retire-unpublished.mjs): compare resolved real paths.
const invokedDirectly = await (async () => {
  try {
    const { realpathSync } = await import("node:fs");
    const { fileURLToPath, pathToFileURL } = await import("node:url");
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
      || pathToFileURL(process.argv[1]).href === import.meta.url;
  } catch { return false; }
})();

if (invokedDirectly) await main();
