#!/usr/bin/env node
// spire-forward-reconcile.mjs — THE SPIRE'S STORE INPUTS CARRY NO `rooms` (POS-1179, WLD-237's leaf; WLD-260's cause). ONCE.
//
//   WORLD2_CLEARING_URL=postgres://clearing_job:…@localhost/world2 \
//   node world2/tools/spire-forward-reconcile.mjs --claim <re-kind claim uuid> --dry-run [--json]
//   SPIRE_RECONCILE=1 WORLD2_CLEARING_URL=… \
//   node world2/tools/spire-forward-reconcile.mjs --claim <uuid> --apply --expect <the dry run's digest> [--json]
//
// EXIT: 0 the plan is printed / the one write landed / nothing to do · 1 REFUSED, with the reasons, nothing written · 2 bad arguments.
//
// ── THE RULED JOB (Wright 2026-11-27, on Darko's go on WLD-260; Rivet's lead FIX at 21:48Z) ──────────────────────────────────
//
// "The store's row for `wright/the-starforge-spire`, and its door claim from WLD-253's re-kind, carry no `rooms`. Preserve every
// later legitimate change (the door class, `into`, `lands_at`, `points`)." Then a crossing writes the line out of Git (that is the
// goal; this tool does not itself make it happen: see § PUBLICATION IS A SEPARATE SELECTION STEP). "No hand edit
// of `WORLD/` data, no bulk import, no historical snapshot rewrite." WLD-135 (5aacbe95) deleted the 22 rooms from the Spire's file;
// WLD-253's re-kind built the Spire's door claim from the store's older body, which still held them, and the 18:00Z sweep of
// 2026-11-27 wrote them back (S197). Both inputs say it: this removes the one field from BOTH, and nothing else.
//
// ── WHY THIS TOOL, MEASURED BEFORE IT WAS WRITTEN (POS-1179's route measurement, /var/tmp/POS-1179-measure/) ──────────────────
//
//   · An ordinary amend (the author's `leave-mark`) removes `rooms` from the mark and files a new claim on top, but it leaves the
//     re-kind claim carrying them (which the commission names), restamps `date`, and makes the claim chain "whole", so the file
//     gains `claimed_at` and a three-entry `footprints`. It is a successor, not a correction of the named claim.
//   · The claim is a locked row. `claims_update_guard` (002/007) refuses every role but `clearing_job`, which it exempts whole, and
//     `claims_delete_guard` forbids deleting one. `clearing_job` holds UPDATE on `claims` and INSERT/UPDATE on `marks`
//     (002_grants.sql) and is the pen a reviewed operator tool already uses for a claim's row (review-rule.mjs § WHY AN OPERATOR
//     TOOL AND NOT A DOOR: env WORLD2_CLEARING_URL, one transaction, the open window FOR UPDATE). So the writer boundary is that
//     pen, and no grant, role or trigger changes. A resident door or `world2_owner` cannot do this: the guard refuses them (the
//     test proves it).
//   · PUBLICATION IS A SEPARATE SELECTION STEP. The docket chain the S198 receipt matched is the w48 release's deployed source
//     frame (fa2fc329; the same deploy/settlement-auto.sh `main` and `train/2026-w48` carry): deploy/settlement-auto.sh →
//     fold-input-cli.mjs → fold-delta.mjs::foldDelta, which selects rows by the closed window's `marks.locked_window`, then
//     renders (renderedMark) and writes them (the store write-down). That is the frame this paragraph is anchored to, not an
//     account of this w49 tree: `train/2026-w49`'s deploy/settlement-auto.sh instead runs settlement-printout.mjs print (the
//     sealed-version delta), and this comment neither transfers the docket rule onto that producer nor claims its runtime selection
//     was measured. On the S198 frame, this tool changes neither that lock nor the claim chain, so its data correction alone does
//     not offer an already-published mark locked in an earlier window. A sealed-version printout can notice changed data, but code
//     on a train is not evidence that it is the running publisher. The store row and named claim can therefore be clean while Git
//     still carries `rooms`. Record those two store facts separately; the Git witness requires the separately agreed
//     publication route and its crossing (POS-1179). The claim's `data` is not itself printed. The open window is read here only
//     to be named in the marker.
//
// ── WHAT IT WRITES, EXACTLY ─────────────────────────────────────────────────────────────────────────────────────────────────
//
//   claims   the named re-kind claim's `data`: `rooms` removed, and `_forward_reconciled` (what was removed, its digest, when)
//   marks    the Spire's row `data`: `rooms` removed and the same marker (its `locked_window` is not touched)
//
// Everything else is untouched: `geometry` (so the ring's 22 `points` stay on the row, which is what the write-down prints),
// `locked_window` (the row's recorded lock stays the window that ruled on it), `kind` (the later door class), `into`, `lands_at`, `image`, `body`, `date`, `tier`, the claim chain, the origin claim (a version
// that was true when it was made), `claims.window_id` and every sealed snapshot (`mark_versions`, `world_snapshot_*` are digests of
// rows the clearing sealed; the next seal writes the corrected row as a NEW version beside the old one). `_`-prefixed keys never reach
// a file (mark-record.mjs), so the marker costs the file nothing.
//
// ── WHAT IT CHECKS FIRST, AND REFUSES ON (nothing is written on any refusal; both writes are one transaction) ─────────────────
//
//   IDENTITY   the row is the standing `wright/the-starforge-spire`, owner wright, kind door; the claim is the one NAMED on the
//              command line, locked, class door, its slug, window 337, superseding the row's id, the HEAD of its chain (nothing
//              later locked on the slug), and stamped by WLD-253's re-kind (`data._ingested_from` carries 6f05ce68)
//   OLD INPUTS each input that holds `rooms` holds exactly the 22 ids the authorised deletion (5aacbe95) removed, in order: any
//              other list is a later change this tool does not know, so it STOPS
//   AGREEMENT  apart from `rooms`, `tier` and its own internals, the row and the claim agree key for key (the row IS the claim's
//              materialization), so nothing legitimate is lost by editing both
//   THE RING   the row carries its `points` (a ring of 3 or more), because the file prints them from the row
//   THE FILE   the write-down's own renderer (mark-render.mjs § renderRecord) prints the row before and after: the ONLY difference
//              is the one `rooms:` line gone. A `date` restamp, `claimed_at`, `footprints` or a lost `points` line refuses
//   THE WINDOW exactly one window is open (named in the marker) and none is clearing (a seal in flight reads the rows this writes)
//   THE PLAN   `--apply` takes `--expect <digest>`, the digest of the inputs the dry run printed, re-read under row locks inside
//              the transaction: a store that moved since the dry run refuses
//   THE PEN    the connection is `clearing_job`
//
// IDEMPOTENT: a second run finds no `rooms` on either input and writes nothing (exit 0, "nothing to do"). A half-finished earlier
// run (one input clean) finishes the other under the same checks.
//
// ── THE EXACT APPLICATION AND READ-BACK (for review; no production invocation is authorised by this file) ───────────────────
//
//   0  the claim id, read-only:  SELECT id, status, window_id, supersedes, class, data ? 'rooms' AS rooms,
//                                       data->>'_ingested_from' AS stamp FROM claims WHERE slug = 'wright/the-starforge-spire'
//                                 ORDER BY decided_at;   -- the re-kind claim is the window-337 row stamped 6f05ce68
//   1  --dry-run                 prints both inputs, the checks, the file diff (one line) and the DIGEST. Darko looks here.
//   2  --apply --expect <digest> the one transaction. It prints the receipt (claim id, rooms removed, window, digest).
//   3  read-back:                SELECT m.data ? 'rooms', m.locked_window, jsonb_array_length(m.geometry->'points'),
//                                       (SELECT data ? 'rooms' FROM claims WHERE id = '<claim>') FROM marks m
//                                 WHERE slug = 'wright/the-starforge-spire';   -- false, 337 (unchanged), 22, false
//   4  publication (POS-1179): use the separately agreed route that offers the clean row to the active crossing's selector. A
//      new sealed version alone does not select an earlier-locked, already-published row on the S198 frame's docket path. After that route and crossing,
//      read the actual published commit's `WORLD/marks/wright/the-starforge-spire/mark.md`: it must have no `rooms:` line.
//      Name any other file changes that the chosen route introduces; do not infer the Git witness from a seal digest alone.
//   5  then, and only then, the World's assertion (POS-1263) after the actual crossing witness.

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { MARK_COLUMNS, renderRecord } from "./mark-render.mjs";

export const SLUG = "wright/the-starforge-spire";
export const OWNER = "wright";
export const KIND = "door";
export const REKIND_WINDOW = 337;
export const REKIND_STAMP = "6f05ce68";            // WLD-253's re-kind commit, as `data._ingested_from` carries it
export const MARKER = "_forward_reconciled";
export const CONSENT_ENV = "SPIRE_RECONCILE";
export const PEN = "clearing_job";
export const CAUSE = "POS-1179";

/** The 22 rooms 5aacbe957cd9db2ba9aee36fd4a9a2e8cdcd1f17 (WLD-135) removed from the Spire's file: the exact old list. */
export const OLD_ROOMS = Object.freeze(["wright/spire-blue-room", "wright/spire-cold-landing", "wright/spire-dining-hall", "wright/spire-gilded-vestibule",
  "wright/spire-guests-walk", "wright/spire-hall-of-keepers", "wright/spire-heart-tower", "wright/spire-little-stair", "wright/spire-lumber-room",
  "wright/spire-mirror-room", "wright/spire-north-arch", "wright/spire-north-turret", "wright/spire-north-walk", "wright/spire-red-stair-hall",
  "wright/spire-register-room", "wright/spire-rose-hall", "wright/spire-round-court", "wright/spire-south-arch", "wright/spire-south-turret",
  "wright/spire-south-walk", "wright/spire-star-chapel", "wright/spire-well-stair"]);

const parsed = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** Canonical JSON: object keys sorted, so a jsonb round trip cannot change a digest. */
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
export const roomsDigest = (rooms) => sha256(canon(rooms ?? null));

const MARK_SQL = `SELECT ${MARK_COLUMNS} FROM marks WHERE slug = $1`;
const MARK_LOCK_SQL = "SELECT id::text AS id FROM marks WHERE slug = $1 AND status = 'standing' FOR UPDATE";
const CLAIMS_SQL = `SELECT id::text AS id, slug, status, window_id, supersedes::text AS supersedes, class, claimant, data, geometry, decided_at
                      FROM claims WHERE slug = $1 AND status = 'locked' ORDER BY decided_at, id`;
const CLAIM_LOCK_SQL = "SELECT id::text AS id FROM claims WHERE id = $1 FOR UPDATE";
const WINDOWS_SQL = "SELECT id, status FROM windows WHERE status IN ('open', 'clearing') ORDER BY id";

/** The row's lines, and what the plan may change in them: only the `rooms:` line goes. PURE. */
export function lineDiff(before, after) {
  const count = (t) => { const m = new Map(); for (const l of String(t).split("\n")) m.set(l, (m.get(l) ?? 0) + 1); return m; };
  const b = count(before), a = count(after);
  const gone = [], added = [];
  for (const [l, n] of b) for (let i = 0; i < n - (a.get(l) ?? 0); i++) gone.push(l);
  for (const [l, n] of a) for (let i = 0; i < n - (b.get(l) ?? 0); i++) added.push(l);
  return { gone, added };
}

const without = (data, ...keys) => Object.fromEntries(Object.entries(data ?? {}).filter(([k]) => !keys.includes(k)));
const INTERNAL = (k) => k.startsWith("_");

/**
 * THE PLAN, PURE. `mark` is the marks row as `MARK_COLUMNS` reads it (it renders the file), `claims` the slug's locked claims,
 * `windows` the open and clearing windows. Answers `{ refusals, steps, digest, diff, noop }`: never throws, and a plan with
 * any refusal carries no steps.
 */
export function planReconcile({ mark, claims = [], windows = [], claimId = null }) {
  const refusals = [];
  const refuse = (s) => refusals.push(s);
  if (!mark) return { refusals: [`no mark "${SLUG}" in the store`], steps: [], digest: null, diff: null, noop: false };
  if (mark.slug !== SLUG) refuse(`the row is ${mark.slug}, not ${SLUG}`);
  if (mark.status !== "standing") refuse(`the row is ${mark.status}, not standing`);
  if (mark.owner !== OWNER) refuse(`the row's owner is ${mark.owner}, not ${OWNER}`);
  if (mark.kind !== KIND) refuse(`the row's kind is ${JSON.stringify(mark.kind)}, not the door class "${KIND}" this correction was reviewed against`);
  const data = parsed(mark.data) ?? {};
  const geometry = parsed(mark.geometry) ?? null;

  const claim = claims.find((c) => String(c.id) === String(claimId)) ?? null;
  if (!claimId) refuse("no --claim: name the re-kind claim (the window-337 row stamped 6f05ce68)");
  else if (!claim) refuse(`claim ${claimId} is not a locked claim on ${SLUG}`);
  const cdata = claim ? parsed(claim.data) ?? {} : {};
  if (claim) {
    if (claim.class !== KIND) refuse(`the claim's class is ${JSON.stringify(claim.class)}, not "${KIND}"`);
    if (claim.claimant !== OWNER) refuse(`the claim's claimant is ${claim.claimant}, not ${OWNER}`);
    if (Number(claim.window_id) !== REKIND_WINDOW) refuse(`the claim is window ${claim.window_id}, not WLD-253's re-kind window ${REKIND_WINDOW}`);
    if (String(claim.supersedes) !== String(mark.id)) refuse("the claim does not supersede the standing row's id");
    if (!String(JSON.stringify(cdata._ingested_from ?? "")).includes(REKIND_STAMP)) refuse(`the claim is not stamped by WLD-253's re-kind (${REKIND_STAMP}) in data._ingested_from`);
    const later = claims.filter((c) => String(c.id) !== String(claim.id) && String(c.supersedes) === String(mark.id)
      && (new Date(c.decided_at).getTime() > new Date(claim.decided_at).getTime()
        || (new Date(c.decided_at).getTime() === new Date(claim.decided_at).getTime() && String(c.id) > String(claim.id))));
    if (later.length) refuse(`a later locked claim stands on the slug (${later.map((c) => String(c.id).slice(0, 8)).join(", ")}): the named claim is not the head of its chain, so there are later legitimate changes this tool does not know`);
  }

  // the old inputs: each input that holds rooms holds exactly the authorised list
  const rowHas = Object.hasOwn(data, "rooms"), claimHas = Object.hasOwn(cdata, "rooms");
  if (rowHas && !same(data.rooms, OLD_ROOMS)) refuse(`the row's rooms are not the 22 the authorised deletion removed (${Array.isArray(data.rooms) ? `${data.rooms.length} entries` : typeof data.rooms}): a later change this tool does not know`);
  if (claimHas && !same(cdata.rooms, OLD_ROOMS)) refuse(`the claim's rooms are not the 22 the authorised deletion removed (${Array.isArray(cdata.rooms) ? `${cdata.rooms.length} entries` : typeof cdata.rooms}): a later change this tool does not know`);

  // agreement: the row is the claim's materialization, so nothing but rooms, tier and internals may differ
  if (claim) {
    const strip = (d) => Object.fromEntries(Object.entries(without(d, "rooms", "tier")).filter(([k]) => !INTERNAL(k)));
    if (!same(strip(data), strip(cdata))) {
      const keys = [...new Set([...Object.keys(strip(data)), ...Object.keys(strip(cdata))])].filter((k) => !same(strip(data)[k], strip(cdata)[k]));
      refuse(`the row and the claim disagree beyond rooms and tier (${keys.join(", ")}): the row is not the claim's materialization, and a later legitimate change may be in either`);
    }
  }

  // the ring stays on the row: the file prints it from there
  const points = geometry?.points;
  if (!(Array.isArray(points) && points.length >= 3)) refuse("the row carries no `points` ring: a write-down would print the box without it, so the ring must be on the row first");

  const noop = !rowHas && !claimHas && refusals.length === 0;

  // the file: before and after, by the write-down's own renderer
  let diff = null;
  if (mark && !noop) {
    try {
      const before = renderRecord(mark);
      const after = renderRecord({ ...mark, data: without(data, "rooms") });
      diff = lineDiff(before, after);
      const roomsLine = diff.gone.filter((l) => l.startsWith("rooms: "));
      if (rowHas && (diff.gone.length !== 1 || roomsLine.length !== 1 || diff.added.length !== 0))
        refuse(`the file would change by more than the one rooms line (gone: ${JSON.stringify(diff.gone.map((l) => l.slice(0, 40)))}, new: ${JSON.stringify(diff.added.map((l) => l.slice(0, 40)))})`);
    } catch (e) { refuse(`the row could not be rendered: ${e?.message ?? e}`); }
  }

  const open = windows.filter((w) => w.status === "open"), clearing = windows.filter((w) => w.status === "clearing");
  if (!noop) {
    if (clearing.length) refuse(`window ${clearing.map((w) => w.id).join(", ")} is clearing: a seal in flight reads the rows this writes`);
    if (open.length !== 1) refuse(`${open.length} windows are open, not one: a version is ruled at the one open window`);
  }

  const digest = sha256(canon({ slug: SLUG, mark: { id: mark.id, kind: mark.kind, data, geometry, locked_window: mark.locked_window }, claim: claim ? { id: claim.id, data: cdata, geometry: parsed(claim.geometry) } : null }));
  const steps = [];
  if (!refusals.length && !noop) {
    if (claimHas) steps.push({ table: "claims", id: String(claim.id), remove: "rooms" });
    if (rowHas) steps.push({ table: "marks", id: String(mark.id), remove: "rooms" });
  }
  return { refusals, steps, digest, diff, noop, rowHas, claimHas, window: open[0]?.id ?? null, claimId: claim?.id ?? null, rooms: rowHas ? data.rooms : cdata.rooms };
}

/** The marker both rows carry: what was removed, how to recognise it, when. Auditable, and never written to a file (`_`). */
export const markerOf = ({ rooms, window, at }) => ({ issue: CAUSE, cause: "WLD-260", removed: ["rooms"], was: { entries: rooms?.length ?? 0, sha256: roomsDigest(rooms) }, window, at });

async function read(q, { claimId }) {
  const { rows: [mark] } = await q(MARK_SQL, [SLUG]);
  const { rows: claims } = await q(CLAIMS_SQL, [SLUG]);
  const { rows: windows } = await q(WINDOWS_SQL);
  return { mark, claims, windows, claimId };
}

/**
 * The tool. `client` is a pg client connected as clearing_job. `apply` false is the dry run: BEGIN READ ONLY, so Postgres itself
 * refuses any write. `expect` is the dry run's digest. Never throws on a refusal. Returns `{ status, plan, receipt }`.
 */
export async function reconcileSpire(client, { claimId, apply = false, expect = null, now = () => new Date() } = {}) {
  const q = (t, a) => client.query(t, a);
  const { rows: [who] } = await q("SELECT current_user::text AS u");
  if (who?.u !== PEN) return { status: "refused", plan: null, receipt: `REFUSED: the connection is \`${who?.u}\`, not \`${PEN}\`. Only the clearing's pen may edit a locked claim (claims_update_guard exempts exactly it), and a resident door or the owner role is refused by that guard. Connect with WORLD2_CLEARING_URL.` };

  if (!apply) {
    await q("BEGIN READ ONLY");
    try {
      const plan = planReconcile(await read(q, { claimId }));
      return { status: plan.refusals.length ? "refused" : plan.noop ? "noop" : "dry-run", plan, receipt: render(plan, { apply: false }) };
    } finally { await q("ROLLBACK"); }
  }

  await q("BEGIN");
  try {
    // the open window first, then the rows, each FOR UPDATE: a clearing that starts after these locks waits for this transaction
    await q("SELECT id FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1 FOR UPDATE");
    await q(MARK_LOCK_SQL, [SLUG]);
    if (claimId) await q(CLAIM_LOCK_SQL, [claimId]);
    const inputs = await read(q, { claimId });
    const plan = planReconcile(inputs);
    if (plan.refusals.length) { await q("ROLLBACK"); return { status: "refused", plan, receipt: render(plan, { apply: true }) }; }
    if (plan.noop) { await q("ROLLBACK"); return { status: "noop", plan, receipt: render(plan, { apply: true }) }; }
    if (!expect) { await q("ROLLBACK"); return { status: "refused", plan, receipt: `${render(plan, { apply: true })}\n\nREFUSED: --apply needs --expect <digest>, the digest the dry run printed (${plan.digest}).` }; }
    if (expect !== plan.digest) { await q("ROLLBACK"); return { status: "refused", plan, receipt: `${render(plan, { apply: true })}\n\nREFUSED: the store is not what the dry run read (expected ${expect}, now ${plan.digest}). Nothing was written; run the dry run again.` }; }

    const at = now().toISOString();
    const marker = markerOf({ rooms: plan.rooms, window: plan.window, at });
    const old = JSON.stringify(plan.rooms);
    for (const s of plan.steps) {
      const r = s.table === "claims"
        ? await q(`UPDATE claims SET data = (data - 'rooms') || jsonb_build_object('${MARKER}', $3::jsonb)
                    WHERE id = $1 AND status = 'locked' AND slug = $4 AND data->'rooms' = $2::jsonb`, [s.id, old, JSON.stringify(marker), SLUG])
        : await q(`UPDATE marks SET data = (data - 'rooms') || jsonb_build_object('${MARKER}', $3::jsonb)
                    WHERE id = $1 AND status = 'standing' AND slug = $4 AND data->'rooms' = $2::jsonb`, [s.id, old, JSON.stringify(marker), SLUG]);
      if (r.rowCount !== 1) throw new Error(`${s.table} ${s.id}: the guarded UPDATE changed ${r.rowCount} rows, not 1 (the inputs moved under the lock)`);
    }
    // the file, re-read after the write, inside the transaction: the one rooms line gone, nothing else
    const { rows: [row] } = await q(MARK_SQL, [SLUG]);
    const { rows: claimsAfter } = await q(CLAIMS_SQL, [SLUG]);
    const after = renderRecord(row);
    const expected = renderRecord({ ...inputs.mark, data: without(parsed(inputs.mark.data), "rooms") });
    if (after !== expected) throw new Error("the file the row now renders is not the file the plan promised");
    if (claimsAfter.some((c) => Object.hasOwn(parsed(c.data) ?? {}, "rooms") && String(c.id) === String(plan.claimId))) throw new Error("the claim still carries rooms after the write");
    await q("COMMIT");
    return { status: "applied", plan, receipt: `${render(plan, { apply: true })}\n\nAPPLIED at ${at} in window ${plan.window}: ${plan.steps.map((s) => `${s.table} ${s.id}`).join(" · ")} · marker ${MARKER}` };
  } catch (e) {
    await q("ROLLBACK").catch(() => {});
    return { status: "refused", plan: null, receipt: `REFUSED, rolled back whole: ${e?.message ?? e}` };
  }
}

function render(plan, { apply }) {
  const L = [`spire-forward-reconcile · ${SLUG} · ${apply ? "apply" : "dry run"} (POS-1179)`];
  if (plan.claimId) L.push(`  the re-kind claim: ${plan.claimId}`);
  L.push(`  row carries rooms:   ${plan.rowHas ? `yes (${plan.rooms?.length ?? "?"}, the authorised list)` : "no"}`);
  L.push(`  claim carries rooms: ${plan.claimHas ? "yes (the authorised list)" : "no"}`);
  if (plan.diff) L.push(`  the file, before → after: gone ${JSON.stringify(plan.diff.gone.map((l) => l.slice(0, 44) + (l.length > 44 ? "…" : "")))} · new ${JSON.stringify(plan.diff.added)}`);
  if (plan.window != null) L.push(`  the open window: ${plan.window} (named in the marker only; no lock window is written)`);
  for (const s of plan.steps ?? []) L.push(`  will write: ${s.table} ${s.id} — remove ${s.remove}`);
  if (plan.digest) L.push(`  digest: ${plan.digest}`);
  if (plan.noop) L.push("  nothing to do: neither input carries rooms");
  for (const r of plan.refusals ?? []) L.push(`  REFUSED: ${r}`);
  if (plan.refusals?.length) L.push("  nothing was written");
  return L.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const argOf = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const has = (n) => process.argv.includes(n);

async function main() {
  const dry = has("--dry-run"), apply = has("--apply");
  const claim = argOf("--claim"), expect = argOf("--expect");
  if (dry === apply || !claim) {
    console.error("spire-forward-reconcile.mjs: pass --claim <re-kind claim uuid> and exactly one of --dry-run or --apply\n  --apply --expect <digest> [env SPIRE_RECONCILE=1, WORLD2_CLEARING_URL]");
    process.exit(2);
  }
  if (!process.env.WORLD2_CLEARING_URL) { console.error("WORLD2_CLEARING_URL missing (role clearing_job)"); process.exit(2); }
  if (apply && process.env[CONSENT_ENV] !== "1") { console.error(`${CONSENT_ENV}=1 is the second sentence --apply needs`); process.exit(2); }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.WORLD2_CLEARING_URL });
  await client.connect();
  try {
    const r = await reconcileSpire(client, { claimId: claim, apply, expect });
    console.log(has("--json") ? JSON.stringify({ status: r.status, digest: r.plan?.digest ?? null, refusals: r.plan?.refusals ?? [], steps: r.plan?.steps ?? [], window: r.plan?.window ?? null }) : r.receipt);
    process.exitCode = r.status === "refused" ? 1 : 0;
  } catch (e) { console.error(`SPIRE-FORWARD-RECONCILE FAILED: ${e?.message ?? e}`); process.exitCode = 1; }
  finally { try { await client.end(); } catch { /* closed */ } }
}

const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (invokedDirectly) await main();
