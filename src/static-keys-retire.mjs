// static-keys-retire.mjs — retire ONE hand-issued static key, by household and
// handle, and keep the import from bringing it back (POS-604).
//
// Until now removing a static key was hand SQL, and nothing recorded that it had
// happened: `importStaticKeys` saw a missing row and wrote it again from
// OFFICE_KEYS (static-keys.mjs § importStaticKeys). A retirement is now a ROW:
// the `static` row is deleted and a `retired` row takes its place in the same
// table (`oauth_tokens`, no migration, no grant change: office_api already holds
// SELECT, INSERT and DELETE, and nothing here UPDATEs). The tombstone keeps the
// retired row's token_hash (so the import can refuse that hash) and its nonsecret
// selector metadata: household, handles, gh_id. Every bearer reader filters on
// its own kind, so a `retired` row resolves nothing, and the sweep
// (`DELETE ... WHERE expires < now`) never reaches it: its expires is NULL.
//
// ── NO KEY, NO HASH, IN OR OUT ──────────────────────────────────────────────
//
// The operator names a household and a handle. The tool finds the row; it is
// never handed a key or a hash and it never prints one. Dry runs and receipts
// say counts, households, handles and the KIND of cover found. A hash is held in
// memory between the DELETE's RETURNING and the tombstone INSERT and the mirror.
//
// ── THE STORE FIRST: ONE TRANSACTION, UNDER A TABLE LOCK ────────────────────
//
//   1. SET LOCAL lock_timeout = '2s', then LOCK TABLE oauth_tokens IN SHARE ROW
//      EXCLUSIVE MODE (Wright, POS-604, 2026-10-12). That mode blocks every
//      other WRITER of the table (a mint, a rotation, the sweep, an import, a
//      hand DELETE) and lets READERS through, so bearer lookups keep answering.
//      office_api may take it: the mode needs UPDATE, DELETE or TRUNCATE on the
//      table and office_api holds DELETE (031). No grant, no migration. SELECT
//      ... FOR UPDATE would need UPDATE, which office_api does not hold. If the
//      lock is not granted within 2s the transaction rolls back and the result
//      is `busy`: nothing changed, run it again.
//   2. only AFTER the lock: read the registry (registryRowsVia, the canonical
//      SQL and fold in THIS transaction) and the household's static rows and the
//      human household keys of the account the registry pins this handle to;
//   3. prove the selector is still exactly one row and that ANOTHER working key
//      still covers THIS household AND handle (below). Unproved, unreadable, or
//      the count changed since the dry run: ROLLBACK;
//   4. the counted DELETE (a CTE; it must delete exactly one row), then the
//      tombstone INSERT, two statements, one transaction.
//
// Once the lock is held, SET LOCAL statement_timeout = '5s': no statement may hold
// the table longer than that; one that does is cancelled, the transaction rolls
// back and the result says so (nothing written).
//
// THE TOMBSTONE KEEPS THE KEY'S OWN `created` (when it was imported), not the
// moment it was retired: the row still describes the key. The retirement's own
// instant is in the result (`retired_at`), not stored; storing it would need a
// column, and this change adds none.
//
// NOTHING BUT THE DATABASE HAPPENS WHILE THE TABLE IS LOCKED: no file, no
// mirror, no network. The result reports `lock_held_ms`, the time from the lock
// being granted to the COMMIT's acknowledgment, so a run can say what it cost.
//
// A COMMIT whose acknowledgment never arrives is reported as exactly that
// (`commit_unknown`): the store may or may not hold the retirement, and the tool
// says so rather than claiming either.
//
// ── TWO KEYS, ONE HANDLE: --gh-id (POS-805) ─────────────────────────────────
//
// When two static rows hold exactly this handle (an old key and its replacement),
// the selector refuses as ambiguous. `ghId` picks among those EXACT rows by the
// gh_id each stores (a number, or null for "none"); zero or several matches
// refuse and write nothing. Without it nothing changes. The cover below needs no
// change: it is computed over every row EXCEPT the target's own hash, so the
// OTHER exact row (the new key) is "another static key for this household and
// handle" and stands as the cover.
//
// ── THE COVER, FAIL CLOSED ──────────────────────────────────────────────────
//
// Retiring the last working key for a household/handle would lock it out, so one
// other key must stand. A cover is either
//   · another `static` row of the SAME household whose handles include the
//     handle (static rows do not expire), or
//   · a live `household` key (expires >= now) of the account the registry pins
//     this handle to, where the registry also proves that account belongs to
//     THIS household and the handle is its resident, held EITHER in the human's
//     hand (held_by IS NULL) OR in a resident's own hand whose claimed_handle is
//     EXACTLY this handle (oauth.mjs § mintHouseholdKey's custody grain; Wright,
//     POS-604, 2026-10-12). A resident key claimed for another handle, or with no
//     claimed handle, is not a cover.
//     Pinned to the account alone is not enough, and nothing here falls back to
//     the login index householdFor adds at request time: a cover that only that
//     fallback would resolve is refused. Fail closed.
// A static household string that is not a registry slug can be covered only by
// another static row.
//
// ── THE FILE, SECOND, EXPLICITLY ────────────────────────────────────────────
//
// The mirror (paperwork.mjs ⚑ THE MIRROR IS TEMPORARY) is the rollback's bridge:
// a file that still holds the live static row would let a rolled-back office let
// the retired key back in. So the retirement is replayed into the file here, in
// the tool's own sqlite transaction with sqlite statements, and READ BACK. A
// file that is missing, a write that fails, or a read-back that differs is NOT a
// success: the result says the store committed and the file is not verified, and
// names the command that repairs it (`--mirror-only`). When the mirror is deleted
// with oauth.db, this step goes in the same change.
//
// `--mirror-only` reads the recorded tombstones for the household and handle and
// replays them into the file. It writes and deletes NOTHING in the store, never
// selects a `static` row (a fresh key for the same household and handle, added
// since, is counted and left alone), and refuses when no tombstone is recorded.

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { RETIRED_KIND, STATIC_KIND } from "./static-keys.mjs";
import { oauthSchema } from "./oauth.mjs";
import { registryRowsVia } from "./registry-store.mjs";
import { registryFromRows, pinsFromRows } from "./registry-rows.mjs";
import { resolveHouse, VIA } from "./household-deriver.mjs";

const handlesOf = (row) => { try { const h = JSON.parse(row.handles); return Array.isArray(h) ? h : []; } catch { return []; } };
const num = (v) => (v == null ? null : Number(v));
const byHash = (a, b) => (a.token_hash < b.token_hash ? -1 : a.token_hash > b.token_hash ? 1 : 0);
const lockedColumns = "token_hash, kind, household, handles, gh_id, gh_login, expires, held_by, claimed_handle, created";

/** Every result carries `status`; none carries a key or a hash. */
/** An error's words with any "(column)=(value)" detail struck, so a driver message can never carry a hash. */
const safe = (e, n = 160) => String(e?.message ?? e).replace(/\([^)]*\)=\([^)]*\)/g, "(…)").slice(0, n);

/** The words for a lock that was not granted in time. */
const busy = (household, handle, ms) => ({ status: "busy", household, handle,
  message: `table busy: another writer held oauth_tokens for ${ms} ms, so the retirement of ${household}/${handle} was not attempted. Nothing changed. Run it again.` });

export const LOCK_TIMEOUT_MS = 2000;
export const STATEMENT_TIMEOUT_MS = 5000;

const iso = (s) => (s == null ? null : new Date(Number(s) * 1000).toISOString());

/** Nonsecret facts about the row a selector found, for dry runs and receipts. */
const targetFacts = (row, staticCount) => ({
  target_created: iso(row.created), target_has_gh_id: row.gh_id != null,
  household_static_keys_now: staticCount, household_static_keys_left: staticCount - 1,
});

const refuse = (reason, extra = {}) => ({ status: "refused", reason, ...extra });

/** What the registry says about THIS handle: its pinned account and the house of that account. */
function registryView(rows, household, handle) {
  const registry = registryFromRows(rows);
  const pins = pinsFromRows(rows);
  const pinned = pins[handle]?.id ?? null;
  const house = registry.households?.[household] ?? null;
  return { registry, pinnedId: pinned == null ? null : Number(pinned), house };
}

/** The proof, over rows already read (on apply: read after the household lock). */
function proveCover({ rows, target, household, handle, view, now }) {
  const others = rows.filter((r) => r.token_hash !== target.token_hash);
  const statics = others.filter((r) => r.kind === STATIC_KIND && r.household === household && handlesOf(r).includes(handle));
  if (statics.length) return { ok: true, by: "another static key for this household and handle", count: statics.length };
  if (view.pinnedId == null || !view.house) return { ok: false, why: view.house ? "the registry pins this handle to no account" : "the household is not a registry household, so only another static key could cover it" };
  const slugOf = resolveHouse({ ghId: view.pinnedId }, { households: view.registry.households }, {}, { via: VIA.ACCOUNT }).slug;
  if (slugOf !== household) return { ok: false, why: "the account the registry pins this handle to does not belong to this household" };
  if (!(view.house.residents ?? []).includes(handle)) return { ok: false, why: "the registry does not list this handle as a resident of the household" };
  const live = others.filter((r) => r.kind === "household" && num(r.gh_id) === view.pinnedId
    && r.expires != null && Number(r.expires) >= now);
  const human = live.filter((r) => r.held_by == null);
  if (human.length) return { ok: true, by: "a live household key of the account the registry pins this handle to", count: human.length };
  const resident = live.filter((r) => r.held_by === "resident" && r.claimed_handle === handle);
  if (resident.length) return { ok: true, by: "a live resident-held household key claimed for exactly this handle", count: resident.length };
  return { ok: false, why: "no live household key of the pinned account in the human's hand, nor one in a resident's hand claimed for exactly this handle" };
}

/**
 * The selector over the household's static rows: exactly one row that holds
 * THIS handle and only this handle. A second exact row is ambiguous. A row that
 * holds this handle among others is never retired (that would widen past the
 * handle (that would widen past the handle named), but it is a cover for the exact row, so it is not ambiguity.
 *
 * `ghId` (POS-805) narrows ONLY the exact rows, and only when the operator gave
 * --gh-id: undefined = no flag (behaviour unchanged, ambiguity included); null =
 * "none" (the exact row whose stored gh_id is null); a number = the exact row whose
 * stored gh_id equals it. Zero or several matches refuse. gh_id is nonsecret
 * metadata; it is the only thing the flag compares, and no key or hash is involved.
 */
function selectorOf(staticRows, handle, ghId = undefined) {
  const holding = staticRows.filter((r) => handlesOf(r).includes(handle));
  const exact = holding.filter((r) => handlesOf(r).length === 1);
  if (ghId !== undefined && exact.length) {
    const hit = exact.filter((r) => num(r.gh_id) === ghId);
    const said = ghId === null ? "no gh_id" : "that gh_id";
    if (hit.length === 1) return { ok: true, row: hit[0] };
    if (hit.length > 1) return { ok: false, reason: `${hit.length} of the ${exact.length} static rows holding exactly this handle have ${said} (still ambiguous)` };
    return { ok: false, reason: `none of the ${exact.length} static row${exact.length === 1 ? "" : "s"} holding exactly this handle has ${said}` };
  }
  if (exact.length === 1) return { ok: true, row: exact[0] };
  if (exact.length > 1) return { ok: false, reason: `${exact.length} static rows hold exactly this handle (ambiguous)` };
  if (!holding.length) return { ok: false, reason: "no matching static row" };
  const others = [...new Set(holding.flatMap((r) => handlesOf(r)).filter((x) => x !== handle))];
  return { ok: false, reason: `the matching static key also holds other handles (${others.join(", ")}), so retiring it would widen past ${handle}` };
}

async function registryOrNull(q) {
  try { return await registryRowsVia(q); } catch { return null; }
}

/** A retire that writes nothing: what apply would try, from the store as it is now. ADVISORY. */
export async function planRetire(pool, { household, handle, ghId = undefined, now = Math.floor(Date.now() / 1000), file = null }) {
  const statics = (await pool.query(`SELECT ${lockedColumns} FROM oauth_tokens WHERE kind = 'static' AND household = $1 ORDER BY token_hash`, [household])).rows;
  const sel = selectorOf(statics, handle, ghId);
  const tombstones = (await pool.query(`SELECT ${lockedColumns} FROM oauth_tokens WHERE kind = 'retired' AND household = $1 ORDER BY token_hash`, [household])).rows
    .filter((r) => handlesOf(r).includes(handle));
  if (!sel.ok) {
    const hint = sel.reason === "no matching static row" && tombstones.length
      ? "already retired; use --mirror-only to repair the file" : null;
    return refuse(sel.reason, { dry: true, retired_recorded: tombstones.length, ...(hint ? { hint } : {}) });
  }
  const rows = await registryOrNull(pool);
  if (rows === null) return refuse("the registry could not be read, so coverage is unproved", { dry: true });
  const view = registryView(rows, household, handle);
  const minted = view.pinnedId == null ? [] : (await pool.query(
    `SELECT ${lockedColumns} FROM oauth_tokens WHERE kind = 'household' AND gh_id = $1 ORDER BY token_hash`, [view.pinnedId])).rows;
  const cover = proveCover({ rows: [...statics, ...minted], target: sel.row, household, handle, view, now });
  if (!cover.ok) return refuse(`no other working key covers ${household}/${handle}: ${cover.why}`, { dry: true });
  return { status: "dry", dry: true, household, handle, matched: 1, cover: cover.by, cover_count: cover.count,
    ...targetFacts(sel.row, statics.length),
    retired_recorded: tombstones.length, file: file == null ? "not named" : existsSync(file) ? "found" : "MISSING (an apply would exit 4)" };
}

// ── the file side ───────────────────────────────────────────────────────────

/** The retired row the file must hold, replayed in its own sqlite transaction and read back. */
function mirrorTombstone(filePath, t) {
  if (!filePath || !existsSync(filePath)) return { ok: false, why: "the oauth.db file is missing" };
  let db;
  try {
    db = new DatabaseSync(filePath);
    db.exec("PRAGMA busy_timeout = 2000"); // a writer holding the file waits us up to 2 s, not an instant SQLITE_BUSY
    oauthSchema(db); // the writer's additive columns (household, handles); no data is touched
    const held = db.prepare("SELECT kind FROM tokens WHERE token_hash = ?").get(t.token_hash);
    if (held && held.kind !== STATIC_KIND && held.kind !== RETIRED_KIND)
      return { ok: false, why: "the file holds that credential as another kind of token, so it was left alone" };
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM tokens WHERE token_hash = ? AND kind IN ('static', 'retired')").run(t.token_hash);
      db.prepare("INSERT INTO tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created, household, handles)"
        + " VALUES (?, 'retired', ?, NULL, NULL, NULL, ?, ?, ?)")
        .run(t.token_hash, num(t.gh_id), num(t.created), t.household, t.handles);
      db.exec("COMMIT");
    } catch (e) { try { db.exec("ROLLBACK"); } catch { /* gone */ } throw e; }
    const back = db.prepare("SELECT kind, household, handles, gh_id, created FROM tokens WHERE token_hash = ?").get(t.token_hash);
    const same = back && back.kind === RETIRED_KIND && back.household === t.household && back.handles === t.handles
      && num(back.gh_id) === num(t.gh_id) && num(back.created) === num(t.created);
    return same ? { ok: true } : { ok: false, why: "the file's row does not read back as the retirement" };
  } catch (e) {
    return { ok: false, why: `the file write failed: ${safe(e)}` };
  } finally { try { db?.close(); } catch { /* already closed */ } }
}

const REPAIR = (household, handle) => `rerun with --mirror-only: static-keys-retire --household ${household} --handle ${handle} --mirror-only`;

const mirrorFailure = (household, handle, why, extra = {}) => ({
  status: "mirror_failed", household, handle, why,
  repair: REPAIR(household, handle),
  message: `STORE COMMITTED: ${household}/${handle} is retired in the store. The file is NOT verified (${why}). Until the file is repaired a rollback to the file would let the key back in. Repair: ${REPAIR(household, handle)}`,
  ...extra,
});

// ── apply ───────────────────────────────────────────────────────────────────

/**
 * Retire the one static key for `household`/`handle`.
 *   pool   a pg Pool (or anything with .connect()) as office_api
 *   file   the oauth.db path to mirror into (a missing file is NON-success)
 *   hooks  { afterLock(client), beforeDelete(client), afterDelete(client) }: the suite's seams, not the CLI's
 *          (afterLock: holding the table lock, nothing read yet; afterDelete: proved and deleted, not committed)
 *   lockTimeoutMs  how long to wait for the table lock (default LOCK_TIMEOUT_MS = 2000)
 */
export async function retireStaticKey(pool, { household, handle, ghId = undefined, file, now = Math.floor(Date.now() / 1000), hooks = {},
  lockTimeoutMs = LOCK_TIMEOUT_MS, statementTimeoutMs = STATEMENT_TIMEOUT_MS }) {
  const client = await pool.connect();
  let discard = false;
  client.on("error", () => { discard = true; });
  let tomb = null;
  let coverBy = null;
  let facts = null;
  let lockedAt = null;
  let heldMs = null;
  let began = false;
  try {
    await client.query("BEGIN"); began = true;
    // 1. the table lock, before anything is read; a bounded wait
    await client.query(`SET LOCAL lock_timeout = '${Math.max(1, Math.trunc(lockTimeoutMs))}ms'`);
    try { await client.query("LOCK TABLE oauth_tokens IN SHARE ROW EXCLUSIVE MODE"); }
    catch (e) {
      if (e?.code === "55P03") { await client.query("ROLLBACK").catch(() => { discard = true; }); return busy(household, handle, Math.trunc(lockTimeoutMs)); }
      throw e;
    }
    lockedAt = performance.now();
    await client.query(`SET LOCAL statement_timeout = '${Math.max(1, Math.trunc(statementTimeoutMs))}ms'`);
    await hooks.afterLock?.(client);
    // 2. everything is read AFTER the lock
    const view = registryView(await registryRowsVia(client), household, handle);
    const rowsNow = (await client.query(
      `SELECT ${lockedColumns} FROM oauth_tokens WHERE (kind = 'static' AND household = $1)`
      + ` OR (kind = 'household' AND gh_id = $2) ORDER BY token_hash`,
      [household, view.pinnedId])).rows.sort(byHash);
    // 3. the selector and the cover, proved over the rows just read
    const sel = selectorOf(rowsNow.filter((r) => r.kind === STATIC_KIND && r.household === household), handle, ghId);
    if (!sel.ok) {
      // no static row but a recorded retirement: say where the repair is (the file may be what is behind)
      const recorded = sel.reason === "no matching static row"
        && (await client.query("SELECT handles FROM oauth_tokens WHERE kind = 'retired' AND household = $1", [household])).rows
          .some((r) => handlesOf(r).includes(handle));
      await client.query("ROLLBACK");
      return refuse(sel.reason, recorded ? { hint: `already retired; to repair the file: ${REPAIR(household, handle)}` } : {});
    }
    const cover = proveCover({ rows: rowsNow, target: sel.row, household, handle, view, now });
    if (!cover.ok) { await client.query("ROLLBACK"); return refuse(`no other working key covers ${household}/${handle}: ${cover.why}`); }
    coverBy = cover.by;
    facts = targetFacts(sel.row, rowsNow.filter((r) => r.kind === STATIC_KIND && r.household === household).length);
    await hooks.beforeDelete?.(client);
    // 4. the counted DELETE, then the tombstone
    const gone = (await client.query(
      "WITH d AS (DELETE FROM oauth_tokens WHERE token_hash = $1 AND kind = 'static' RETURNING token_hash, household, handles, gh_id, created)"
      + " SELECT token_hash, household, handles, gh_id, created, count(*) OVER () AS n FROM d", [sel.row.token_hash])).rows;
    await hooks.afterDelete?.(client);
    if (gone.length !== 1 || Number(gone[0].n) !== 1) {
      await client.query("ROLLBACK");
      return refuse(`the delete removed ${gone.length ? Number(gone[0].n) : 0} rows, not 1, so nothing was changed`);
    }
    const g = gone[0];
    // the key's own created, kept (header § THE TOMBSTONE KEEPS THE KEY'S OWN created)
    tomb = { token_hash: g.token_hash, household: g.household, handles: g.handles, gh_id: num(g.gh_id), created: g.created == null ? null : Number(g.created) };
    await client.query(
      "INSERT INTO oauth_tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created, household, handles)"
      + " VALUES ($1, 'retired', $2, NULL, NULL, NULL, $3, $4, $5)",
      [tomb.token_hash, tomb.gh_id, tomb.created, tomb.household, tomb.handles]);
    try { await client.query("COMMIT"); heldMs = Math.round((performance.now() - lockedAt) * 10) / 10; }
    catch (e) {
      discard = true;
      return { status: "commit_unknown", household, handle,
        message: `COMMIT was not acknowledged (${safe(e, 120)}): the store may or may not hold the retirement of ${household}/${handle}. Check with --dry, then rerun --mirror-only if it is recorded.` };
    }
  } catch (e) {
    if (began) { try { await client.query("ROLLBACK"); } catch { discard = true; } }
    if (e?.code === "57014")
      return refuse(`a statement outlasted the ${Math.trunc(statementTimeoutMs)} ms bound (statement_timeout) while oauth_tokens was locked; rolled back, nothing was written`, { timed_out: true });
    return refuse(`an error before commit, so nothing was committed: ${safe(e)}`);
  } finally { client.release(discard ? true : undefined); }

  const m = mirrorTombstone(file, tomb);
  const receipt = { ...facts, retired_at: iso(now), lock_held_ms: heldMs };
  if (!m.ok) return mirrorFailure(household, handle, m.why, receipt);
  return { status: "retired", household, handle, cover: coverBy, ...receipt, message: `retired ${household}/${handle}: the store and the file agree.` };
}

// ── repair ──────────────────────────────────────────────────────────────────

/** `--mirror-only`: make the file match the store's recorded retirements. Never writes the store. */
export async function mirrorOnly(pool, { household, handle, ghId = undefined, file }) {
  const tombs = (await pool.query(`SELECT ${lockedColumns} FROM oauth_tokens WHERE kind = 'retired' AND household = $1 ORDER BY token_hash`, [household])).rows
    .filter((r) => handlesOf(r).includes(handle))
    .filter((r) => ghId === undefined || num(r.gh_id) === ghId); // --gh-id (POS-805) picks among the recorded tombstones
  if (!tombs.length) return refuse(`no retirement is recorded for ${household}/${handle}${ghId === undefined ? "" : ghId === null ? " with no gh_id" : " with that gh_id"}`);
  const statics = (await pool.query("SELECT handles FROM oauth_tokens WHERE kind = 'static' AND household = $1", [household])).rows
    .filter((r) => handlesOf(r).includes(handle)).length;
  for (const t of tombs) {
    const m = mirrorTombstone(file, { ...t, gh_id: num(t.gh_id), created: num(t.created) });
    if (!m.ok) return mirrorFailure(household, handle, m.why, { newer_static_untouched: statics });
  }
  return { status: "repaired", household, handle, repaired: tombs.length, newer_static_untouched: statics,
    message: `the file now matches the store for ${household}/${handle} (${tombs.length} recorded retirement${tombs.length === 1 ? "" : "s"})`
      + (statics ? `; ${statics} newer static key${statics === 1 ? "" : "s"} for the same household and handle ${statics === 1 ? "exists" : "exist"} and ${statics === 1 ? "was" : "were"} not touched` : "") };
}
