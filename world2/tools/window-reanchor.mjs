#!/usr/bin/env node
// window-reanchor.mjs — MOVE THE OPEN WINDOW'S CLOSE ONTO THE LAW'S MARK. ONCE.
//
//   node world2/tools/window-reanchor.mjs --dry-run
//   WINDOW_REANCHOR=1 node world2/tools/window-reanchor.mjs --apply
//
//   env: WORLD2_PG=1 and WORLD2_PG_URL — the same pair every tool in this
//        directory reads, consumed at `src/world2-acts.mjs:255`
//        (`env.WORLD2_PG === "1" && !!env.WORLD2_PG_URL`).
//        WINDOW_REANCHOR=1 — consent for `--apply`, consumed HERE and nowhere
//        else in this repo. Same grammar as `LEDGER_FREEZE=1` and `TOWN_PUSH=1`,
//        and for the same reason: the dangerous step needs a deliberate second
//        sentence, in a different grammar, that no typo and no shell history can
//        supply by accident. Every read-only path runs without it.
//
// EXIT: 0 the plan is printed, or the one write landed · 1 REFUSED with the
//       reason · 2 a bad argument or a missing store.
//
// ── WHY A TOOL AND NOT A TIMER CHANGE ───────────────────────────────────────
//
// The town's law says the candle closes windows at 06:00Z and 18:00Z. The box
// has closed them at 05:45Z and 17:45Z since the cadence was set. The timers are
// moving to the law's marks in the same ship — and MOVING THE TIMERS ALONE
// CHANGES NOTHING ABOUT WHERE THE WINDOWS SIT, forever, because the candle does
// not take its marks from the clock. It chains them:
//
//     -- world2/tools/clearing-job.mjs:389-393
//     INSERT INTO windows (id, opens_at, closes_at, status)
//     VALUES ($1, $2, $2::timestamptz + interval '12 hours', 'open')
//     ON CONFLICT (id) DO NOTHING
//     [windowId + 1, win.closes_at]
//
// The successor opens at the CLOSED window's stored `closes_at`, never at
// `now()`, and closes twelve hours after that. The runner then picks up "the
// open window whose closes_at has passed" (deploy/world2-clearing.sh:157) — so
// a timer at :00 finds a window due at :45, closes it fifteen minutes after its
// own boundary, and writes a successor due at :45 again. The store's rows would
// say 05:45Z / 17:45Z forever while the law said 06:00Z / 18:00Z.
//
// That is deliberate, and world2-clearing.sh's own header says why: "a window
// closed eight hours late still leaves its successor on the marks. A late run
// costs lateness, never alignment." The property that makes the cadence immune
// to a late box is exactly the property that makes a DELIBERATE move impossible
// without one write. This is that write.
//
// ── THE MARK IT MOVES TO, AND WHY ONLY FORWARD ──────────────────────────────
//
// The next 06:00Z or 18:00Z AT OR AFTER the window's current `closes_at`. Only
// forward, and that is not a preference: a close moved into the past is a window
// the runner's own `closes_at <= now()` finds immediately, so the "one careful
// write" would be followed within the minute by an unplanned crossing. Forward
// costs the open window a few extra minutes and nothing else.
//
// A window already sitting on a mark is NOT moved — the tool says so and exits
// 0 without a write. That is what makes a second apply safe, and the falsifier
// drives it rather than assuming it.
//
// ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────
//
// It does not touch the chaining rule. The `+ 12 hours` stays exactly as it is;
// this moves ONE row's `closes_at` ONCE and lets the chain carry the new mark
// forward on its own. It does not close a window, open one, or write anything
// but that single column on that single row. The prod apply is the founder's, by
// hand, on ship day — its receipt is the next window opening at the :00 mark
// with `closes_at` twelve hours later, in the store's own rows.

// The law's two marks, UTC. The line is `LOGOS/classes.md § crossing ②` on world
// main — the keeper's settlement, amended 2026-09-17 by keeminlee/postmark-world#96
// to "S1, S2, … at 06:00 and 18:00 UTC from the w39 ship (2026-09-21), 05:45 and
// 17:45 UTC until then". NOT `census.md Decision 3`, which earlier drafts cited:
// that is the postmark-world-2 gold plan in Starstory PULSE, absent from the
// world tree, and still reading 05:45Z / 17:45Z unamended.
const MARK_HOURS = [6, 18];

/**
 * The next law mark at or after `iso`. PURE.
 *
 * Returns the instant unchanged when it is already exactly on a mark, which is
 * how "a second apply refuses" is decided — by the value, not by a memory of
 * having run.
 */
export function nextMarkAtOrAfter(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) throw new Error(`window-reanchor: unparseable timestamp ${JSON.stringify(iso)}`);
  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    for (const h of MARK_HOURS) {
      const mark = new Date(Date.UTC(
        t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + dayOffset, h, 0, 0, 0));
      if (mark.getTime() >= t.getTime()) return mark;
    }
  }
  // Unreachable: 06:00 of the following day is always at or after any instant on
  // the current day. Thrown rather than returned so a future edit to MARK_HOURS
  // that breaks the property fails loudly instead of returning undefined.
  throw new Error(`window-reanchor: no mark found at or after ${iso} — MARK_HOURS is not a full-day cover`);
}

/** `true` when the instant is exactly on one of the law's marks. PURE. */
export const onTheMark = (iso) => nextMarkAtOrAfter(iso).getTime() === new Date(iso).getTime();

/**
 * What the chain will derive from a given close — clearing-job.mjs's rule, READ
 * and never changed: the successor opens at this close and shuts twelve hours
 * later. Here so the plan can show the operator the NEXT window too, and so a
 * falsifier can assert the move actually lands the chain on the marks rather
 * than merely moving one row.
 */
export const chainNextClose = (closesAtIso) => new Date(new Date(closesAtIso).getTime() + 12 * 3600 * 1000);

/**
 * The plan for one open window. PURE — the whole decision, so the falsifiers
 * drive the real rule and the impure half below is only a query and a write.
 */
export function reanchorPlan(win) {
  if (!win) return { ok: false, reason: "no window is open — nothing to re-anchor" };
  const from = new Date(win.closes_at).toISOString();
  const to = nextMarkAtOrAfter(win.closes_at).toISOString();
  const already = from === to;
  return {
    ok: true,
    id: win.id,
    from,
    to,
    already,
    moves_ms: new Date(to).getTime() - new Date(from).getTime(),
    chain_next_close: chainNextClose(to).toISOString(),
  };
}

/** The consent gate: `--apply` needs `WINDOW_REANCHOR=1` beside it; nothing else does. */
export const reanchorConsented = () => process.env.WINDOW_REANCHOR === "1";

const has = (name, argv) => argv.includes(name);

/**
 * `query` is a seam, not a parameter anyone passes in anger: the tool resolves
 * its own Postgres client below. It exists so the falsifiers can drive THIS
 * function — the real argument handling, the real consent gate, the real
 * statements — and observe exactly which SQL a run would send. There is no
 * non-prod world2 store to point a test at (`/srv/world2-lab` IS prod's
 * Postgres), and a test that reached a real store to prove a write is careful
 * would be the least careful thing in this file.
 */
export async function main(argv = process.argv.slice(2), { query, log = console.log, err = console.error } = {}) {
  const dryRun = has("--dry-run", argv);
  const apply = has("--apply", argv);
  if (dryRun === apply) {
    err("usage: window-reanchor.mjs --dry-run | --apply   (exactly one; --apply also needs WINDOW_REANCHOR=1)");
    return 2;
  }
  if (apply && !reanchorConsented()) {
    err('REFUSED · --apply moves a row in the live world store and needs WINDOW_REANCHOR=1 in the environment. '
      + 'Run --dry-run first; it needs no consent and writes nothing.');
    return 1;
  }

  const rows = await query("SELECT id, opens_at, closes_at FROM windows WHERE status = 'open' ORDER BY id");
  if (rows.length !== 1) {
    err(`REFUSED · expected exactly one open window, the store has ${rows.length}`
      + (rows.length ? ` (${rows.map((r) => r.id).join(", ")})` : "")
      + " — this tool moves one row once and will not choose between windows");
    return 1;
  }

  const plan = reanchorPlan(rows[0]);
  const mins = Math.round(plan.moves_ms / 60000);
  log(`window ${plan.id}: closes_at ${plan.from}`);
  if (plan.already) {
    log(`  already on the law's mark — nothing to move`);
    return 0;
  }
  log(`  -> ${plan.to}   (+${mins} minute(s))`);
  log(`  the chain then derives window ${plan.id + 1}: opens ${plan.to}, closes ${plan.chain_next_close}`);

  if (dryRun) {
    log("dry run — nothing written");
    return 0;
  }

  // THE ONE WRITE. One column, one row, and the id and the expected old value
  // are both in the WHERE so a store that moved under us updates nothing rather
  // than the wrong thing.
  const updated = await query(
    "UPDATE windows SET closes_at = $1 WHERE id = $2 AND closes_at = $3 AND status = 'open' RETURNING id, closes_at",
    [plan.to, plan.id, plan.from]);
  if (updated.length !== 1) {
    err(`REFUSED · the update matched ${updated.length} row(s) — window ${plan.id} is no longer open at ${plan.from}; nothing was written`);
    return 1;
  }
  log(`RE-ANCHORED window ${updated[0].id}: closes_at is now ${new Date(updated[0].closes_at).toISOString()}`);
  log(`  receipt: the next window must open on that mark and close ${plan.chain_next_close}`);
  return 0;
}

/**
 * The store, resolved the way every tool in this directory resolves it.
 *
 * Opened LAZILY by the entry block below — a usage refusal, a missing consent
 * key or a `--dry-run` that never gets that far must not open a connection to
 * prod's Postgres just to be told it was a typo.
 */
async function pgQuery() {
  if (process.env.WORLD2_PG !== "1" || !process.env.WORLD2_PG_URL) {
    throw new Error('WORLD2_PG is not "1" or WORLD2_PG_URL is unset — this tool cannot see the candle. '
      + "The consuming line is src/world2-acts.mjs:255 (`env.WORLD2_PG === \"1\" && !!env.WORLD2_PG_URL`).");
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.WORLD2_PG_URL });
  await client.connect();
  return {
    query: async (sql, params) => (await client.query(sql, params)).rows,
    close: () => client.end(),
  };
}

// ── entry guard ──────────────────────────────────────────────────────────────
// settlement-history.mjs's idiom; the realpath compare is the junction lesson
// (2026-09-05): the URL compare is FALSE when the entry reaches this file through
// a Windows junction, and the tool then exits 0 having done nothing — which for
// a one-shot an operator runs once, by hand, on ship day, would read as "already
// on the mark". test/cli-guard.test.mjs spawns it both ways.
const { realpathSync } = await import("node:fs");
const { fileURLToPath, pathToFileURL } = await import("node:url");
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();

if (isMain) {
  let store = null;
  const query = async (sql, params) => {
    if (!store) {
      try { store = await pgQuery(); }
      catch (e) { console.error(`REFUSED · ${e.message}`); process.exit(2); }
    }
    return store.query(sql, params);
  };
  try {
    process.exitCode = await main(process.argv.slice(2), { query });
  } finally {
    if (store) await store.close();
  }
}
