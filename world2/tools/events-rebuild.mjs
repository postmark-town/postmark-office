#!/usr/bin/env node
// events-rebuild.mjs — the calendar's tables, rebuilt from the act log alone,
// and compared with what is stored (POS-207).
//
//   node world2/tools/events-rebuild.mjs --dry-run
//        [--json]               machine-readable receipt on stdout
//
//   env: WORLD2_PG_URL (the office's own connection), or PG* as `w2_pgenv`
//        exports them, or --pg-url. It needs only SELECT; it writes nothing.
//
//   EXIT: 0 equal · 1 DRIFT (a stored row the acts do not derive, or the
//         reverse) · 2 cannot run (no store, no table).
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// Wright's shape (2026-09-24): "The record is the act log; the table is its
// projection ... rebuildable from the acts alone (write that rebuild as a tool
// ... and make the equality between a rebuild and the tables a test)." The pen
// (src/events-store.mjs) and this tool take every row from ONE pure function,
// `applyEventAct` (src/events.mjs), so a drift here means something wrote the
// tables that was not the pen — or an act was written that the pen did not
// project — and never that the two disagree about what an act means.
//
// ── THE ONE COLUMN IT CANNOT RESTORE ────────────────────────────────────────
//
// `event_rsvps.address` — the webhook url or Letta conversation — is not in the
// act, on purpose: `acts` leaves the box through the notary's public export and
// an address is a household's private fact (026_events.sql). So the rebuild
// leaves it null and the comparison skips it, and this receipt says so rather
// than reporting a column it never checked as equal.
//
// ── ONLY A DRY RUN ──────────────────────────────────────────────────────────
//
// There is no --apply. A drift is a finding for a person, and the repair is
// theirs: an UPDATE over `events` from a rebuild would overwrite the one column
// a rebuild cannot know. Until a drift has been seen once, no automatic repair
// is proposed.

import { foldEventActs, rsvpKey } from "../../src/events.mjs";

export const NOT_RESTORED = Object.freeze({ event_rsvps: ["address"] });

const EVENT_FIELDS = ["id", "title", "invitation", "host", "household", "place_mark", "place_x", "place_y",
  "doors_open", "starts", "ends", "revised", "cancelled", "hosted_act", "last_act"];
const RSVP_FIELDS = ["event", "handle", "household", "harness", "budget", "fell_back", "act"];

const iso = (v) => (v == null ? null : new Date(v).toISOString());
const normEvent = (r) => ({ ...Object.fromEntries(EVENT_FIELDS.map((k) => [k, r[k] ?? null])),
  place_x: Number(r.place_x), place_y: Number(r.place_y), revised: Number(r.revised),
  hosted_act: Number(r.hosted_act), last_act: Number(r.last_act), cancelled: r.cancelled === true,
  doors_open: iso(r.doors_open), starts: iso(r.starts), ends: iso(r.ends) });
const normRsvp = (r) => ({ ...Object.fromEntries(RSVP_FIELDS.map((k) => [k, r[k] ?? null])),
  budget: Number(r.budget), act: Number(r.act) });

/**
 * THE EQUALITY. `stored` is `{ events: [rows], rsvps: [rows] }` as the tables
 * hold them; `acts` is every class-`event` act, oldest first. Returns
 * `{ equal, drift: [sentences], counts }`.
 */
export function compareRebuild(stored, acts) {
  const rebuilt = foldEventActs(acts);
  const drift = [];
  const pairs = [
    ["events", new Map(stored.events.map((r) => [r.id, normEvent(r)])), new Map([...rebuilt.events].map(([k, r]) => [k, normEvent(r)]))],
    ["event_rsvps", new Map(stored.rsvps.map((r) => [rsvpKey(r.event, r.handle), normRsvp(r)])), new Map([...rebuilt.rsvps].map(([k, r]) => [k, normRsvp(r)]))],
  ];
  for (const [table, have, want] of pairs) {
    for (const [k, w] of want) {
      const h = have.get(k);
      if (!h) { drift.push(`${table} ${k}: the acts derive this row and the table does not hold it`); continue; }
      for (const f of Object.keys(w)) if (JSON.stringify(h[f]) !== JSON.stringify(w[f]))
        drift.push(`${table} ${k}.${f}: stored ${JSON.stringify(h[f])}, the acts derive ${JSON.stringify(w[f])}`);
    }
    for (const k of have.keys()) if (!want.has(k)) drift.push(`${table} ${k}: the table holds this row and no act derives it`);
  }
  return { equal: drift.length === 0, drift,
    counts: { acts: acts.length, events: rebuilt.events.size, event_rsvps: rebuilt.rsvps.size },
    not_restored: NOT_RESTORED };
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
  if (!argv.includes("--dry-run")) {
    console.error("events-rebuild: only --dry-run exists — it reads and compares, and writes nothing");
    process.exit(2);
  }
  const url = arg("pg-url") ?? (process.env.PGUSER ? null : process.env.WORLD2_PG_URL);
  if (!url && !process.env.PGDATABASE) { console.error("events-rebuild: no store (WORLD2_PG_URL, PG*, or --pg-url)"); process.exit(2); }
  const { default: pg } = await import("pg");
  const client = url ? new pg.Client({ connectionString: url }) : new pg.Client();
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const { eventActs } = await import("../../src/events-store.mjs");
    const acts = await eventActs(client);
    const { rows: events } = await client.query("SELECT * FROM events ORDER BY id");
    const { rows: rsvps } = await client.query("SELECT * FROM event_rsvps ORDER BY event, handle");
    await client.query("COMMIT");
    const out = compareRebuild({ events, rsvps }, acts);
    if (argv.includes("--json")) console.log(JSON.stringify(out, null, 2));
    else {
      console.log(`${out.equal ? "equal" : "DRIFT"} · ${out.counts.acts} event acts → ${out.counts.events} events, ${out.counts.event_rsvps} rsvps · not restored by a rebuild, and not compared: event_rsvps.address`);
      for (const d of out.drift) console.log(`  ${d}`);
    }
    process.exit(out.equal ? 0 : 1);
  } catch (e) {
    console.error(`events-rebuild: cannot run — ${String(e?.message ?? e).slice(0, 200)}`);
    process.exit(2);
  } finally { await client.end().catch(() => {}); }
}

// Run as a script, never on import (the equality test imports compareRebuild).
if (process.argv[1]?.replace(/\\/g, "/").endsWith("world2/tools/events-rebuild.mjs")) main();
