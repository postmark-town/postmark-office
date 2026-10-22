// media-sweep.mjs — the daily sweep that frees media nothing hangs any more
// (POS-737), and the operator's takedown beside it.
//
// THE RULING (Darko, 2026-10-21 08:26 EDT, "737 agreed"): a daily office sweep
// deletes an upload that no current surface references (marks, profiles, home
// pictures, posts, events) after a 30-day grace, with its -96/-256 copies. The
// ledger row moves to a deleted state and its bytes leave the household's wall.
// It runs report-only first. An operator takedown verb (immediate, with a
// receipt) ships with it. The replay gap is accepted: old records keep the
// pointer, never the bytes.
//
// WHY A SWEEP AND NOT A HOOK. The bytes are content-addressed per household, so
// one file can hang on a mark, a face, a house picture and a bug post at once,
// and a fresh upload hangs on nothing yet. A withdrawal cannot tell by itself
// whether the bytes are still in use. The sweep asks every place at once.
//
// ── WHAT "REFERENCED" MEANS: THE SOURCES ────────────────────────────────────
//
// The live reference set is the union of the sources below. A URL found in any
// of them keeps its file, and a URL to a -96 or -256 copy keeps its original.
//
//   world     the world clone's tree at the blessed ref AND at main (main can
//             carry a candidate ahead of the blessing), every path but
//             STATE/log/ (the history: the accepted replay gap)
//   drafts    every draft/<household> ref in the world clone, the same paths
//   town      the town clone's tree at HEAD and origin/main: letters,
//             PROFILE.md, WINDOW, HOME, households.json, MEEPS, everything.
//             `git grep` on the commit, so a sparse checkout cannot hide a file
//   extra     any further clone the operator names (MEDIA_SWEEP_EXTRA_CLONES),
//             every branch it holds: work that hangs a picture before it is
//             published anywhere the sources above read. A source that only
//             keeps files, never frees them.
//   store     the store's current-state tables (STORE_SOURCES), each row read
//             as text: standing marks, posts, responses, the households'
//             home_images and the town index's homes, residents, letters,
//             threads and bulletin. Never a history table: acts, mark versions,
//             snapshots and the town log keep pointers to files the record has
//             let go of, and that is the replay gap, accepted.
//
// FAIL CLOSED. Deletion is irreversible, so a source that cannot answer is never
// read as "found nothing": if any source fails, the run writes nothing at all
// and its report names the source (the-town/the-disclosure: "could not look" is
// not "not there"). The same holds for two quieter failures:
//   - a store table under row-level security with no policy for the sweep's
//     role answers zero rows without an error, so it is refused as unreadable;
//   - a source that is expected to hold pictures (the world, the town) and
//     finds none is refused as unreadable, because the likeliest reason for a
//     sudden empty world is a wrong ref, not a town with no pictures.
//
// ── THE CLOCK ───────────────────────────────────────────────────────────────
//
// `unreferenced_since` is stamped the first time a sweep finds a live row
// unhung, and cleared whenever a sweep or a hanging door finds it hung
// (media.mjs § mediaHeldRefusal). A row is due when its clock is older than the
// grace. So nothing is freed until a file has been seen unhung, every day, for
// 30 days: the grace counts from the sweep's first sight, never from a history
// nobody read.
//
// DRY BY DEFAULT. A dry run keeps the clock (stamps and clears, which is
// bookkeeping: without it the grace would never start) and NAMES what it would
// free. It never claims, deletes or purges. A live run needs `apply`.
//
// ── FREEING ONE FILE ────────────────────────────────────────────────────────
//
//   1. CLAIM the row: one conditional UPDATE (live, clock still older than the
//      grace). A door that hung the file since has cleared the clock, and the
//      claim misses. From the claim on, the file is no longer held and its
//      bytes leave the wall.
//   2. DELETE the original and its copies from storage.
//   3. PURGED: stamp `purged_at`. A row claimed but not purged (storage
//      refused) is retried by the next run and named in its report.
//
// A RUN THAT WOULD FREE MORE THAN `maxDelete` FILES FREES NONE and says so.
// A sudden flood of due files is a broken source until a person reads it.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { asPaper } from "./paperwork.mjs";
import { blessed, freshestMainRef } from "./world-branches.mjs";
import {
  MEDIA_BASE, MEDIA_GRACE_DAYS, ensureMediaTable, mediaLedgerHasStates, mediaObjectKeysOf, mediaUrlFor, mediaUrlParts, r2Delete,
} from "./media.mjs";

export const DAY_MS = 86_400_000;
export const GRACE_MS = MEDIA_GRACE_DAYS * DAY_MS;
export const MAX_DELETE_DEFAULT = 50;
export const SWEEP_HAND = "media-sweep";

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A door-minted media URL, for `git grep -E` and for a JS scan alike: originals and copies. */
export const MEDIA_URL_ERE = `${esc(MEDIA_BASE)}/media/[A-Za-z0-9][A-Za-z0-9._-]*/[0-9a-f]{64}(-[0-9]+)?\\.[a-z0-9]+`;

/** A row's identity, which a copy's URL shares with its original. */
export const rowKey = ({ household, sha, ext }) => `${household}/${sha}.${ext}`;

/** Every ledger row a text names: the keys of the originals it points at. */
export function keysIn(text, into = new Set()) {
  for (const m of String(text ?? "").matchAll(new RegExp(MEDIA_URL_ERE, "g"))) {
    const p = mediaUrlParts(m[0]);
    if (p) into.add(rowKey(p));
  }
  return into;
}

// ── the git sources ─────────────────────────────────────────────────────────

const gitOut = (repo, args) => execFileSync("git", ["-C", repo, ...args],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });

/**
 * Every media key on the trees of `refs` in `repo`, minus `exclude` paths. One
 * `git grep` over the commits: exit 1 is "no match", anything else is a refusal.
 */
export function gitKeys(repo, refs, { exclude = [] } = {}) {
  const keys = new Set();
  if (!refs.length) return keys;
  let out;
  try {
    out = gitOut(repo, ["grep", "-h", "-o", "-I", "-E", MEDIA_URL_ERE, ...refs, "--", ".", ...exclude.map((p) => `:(exclude)${p}`)]);
  } catch (e) {
    if (e.status === 1) return keys; // no line matched
    throw new Error(`git grep in ${repo} failed: ${String(e.stderr ?? e.message).trim().slice(0, 200)}`);
  }
  return keysIn(out, keys);
}

const refsLike = (repo, pattern) =>
  gitOut(repo, ["for-each-ref", "--format=%(refname)", pattern]).split("\n").filter(Boolean);

/** The world's current refs: the blessing and main, deduplicated. */
export function worldRefs(repo) {
  const b = blessed(repo);
  return [...new Set([b.ref, freshestMainRef(repo)])];
}

/** Every draft ref the world clone holds, local and fetched. */
export const draftRefs = (repo) => [...new Set([...refsLike(repo, "refs/heads/draft/"), ...refsLike(repo, "refs/remotes/origin/draft/")])];

/** The town's current refs: the checkout and, when fetched, origin/main. */
export function townRefs(repo) {
  const refs = ["HEAD"];
  if (refsLike(repo, "refs/remotes/origin/main").length) refs.push("refs/remotes/origin/main");
  return refs;
}

export const WORLD_HISTORY = Object.freeze(["STATE/log"]);

// ── the store sources ───────────────────────────────────────────────────────

/** The office's own file that hangs media (WLD-83's likeness gallery). */
export const OFFICE_GALLERY = new URL("./likeness-gallery.json", import.meta.url);

/** The store's current-state tables a media URL can hang in, read whole as text. */
export const STORE_SOURCES = Object.freeze([
  { table: "marks", where: "status = 'standing'", why: "standing marks (a retired mark's picture is the accepted replay gap)" },
  { table: "posts", why: "posts: bug reveals, events, notices" },
  { table: "responses", why: "answers to posts" },
  { table: "households", why: "home pictures (home_images)" },
  { table: "town_homes", why: "the town index's homes" },
  { table: "town_residents", why: "the town index's residents: profiles and faces" },
  { table: "town_letters", why: "letters" },
  { table: "town_threads", why: "letter threads" },
  { table: "town_bulletin", why: "the bulletin" },
  // WLD-83: every six-panel sheet made of a resident (the household's own, the town's seeds), kept whole
  { table: "depictions", why: "the six-panel sheets (WLD-83)" },
]);

/**
 * Every office door that HANGS a media URL (POS-738's check), and the sources
 * this sweep reads that hang back. A door added with no source here would hang
 * pictures the sweep cannot see, and free them under it:
 * test/media-sweep.test.mjs reds on any caller of the check not named here.
 */
export const HANGING_DOORS = Object.freeze({
  "world.mjs": { door: "a mark's image (leave-mark, amend, post)", sources: ["world", "drafts", "store:marks"] },
  "edit.mjs": { door: "the profile picture, the house picture and the resident's sheet", sources: ["town", "store:town_residents", "store:households", "store:town_homes", "store:depictions"] },
  "events-store.mjs": { door: "a bug reveal's candidates", sources: ["store:posts"] },
});

/** Refuses (throws) a table the sweep's role could read as empty without an error. */
async function readableOrThrow(pool, table) {
  const r = (await pool.query(
    `SELECT c.relrowsecurity AS rls,
            has_table_privilege(current_user, c.oid, 'SELECT') AS can,
            EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname
                     AND p.cmd IN ('SELECT', 'ALL') AND (p.roles && ARRAY[current_user::name, 'public'::name])) AS policy
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = $1`, [table])).rows[0];
  if (!r) throw new Error(`the store has no table ${table}`);
  if (!r.can) throw new Error(`the sweep's role cannot read ${table}`);
  if (r.rls && !r.policy) throw new Error(`${table} is under row-level security with no policy for the sweep's role, so it would read as empty`);
}

/** Every media key in one store table's rows. */
export async function storeKeys(pool, { table, where = null }) {
  await readableOrThrow(pool, table);
  // The host alone narrows the scan: a path test here would miss an escaped slash.
  const like = `%${MEDIA_BASE.replace(/^https?:\/\//, "")}%`;
  const { rows } = await pool.query(
    // The alias is the whole row only while no column shares its name (a column
    // wins), so it is one no table of the town's would choose.
    `SELECT media_sweep_row::text AS r FROM ${table} media_sweep_row WHERE ${where ? `(${where}) AND ` : ""}media_sweep_row::text LIKE $1`, [like]);
  const keys = new Set();
  // A row as text doubles every backslash (the record's own quoting), so an
  // escaped slash arrives as one or more backslashes before it.
  for (const { r } of rows) keysIn(r.replace(/\\+\//g, "/"), keys);
  return keys;
}

// ── the reference set ───────────────────────────────────────────────────────

/**
 * The union of every source, or the sources that failed. `ok` is false when
 * any one failed; the keys are then not to be trusted for a deletion.
 */
export async function referenceSet({ worldClone, townClone, pool, storeSources = STORE_SOURCES, extraClones = [], officeFiles = [OFFICE_GALLERY] }) {
  const keys = new Set();
  const sources = [];
  const take = async (name, expectSome, fn) => {
    try {
      if (!fn) throw new Error("not configured");
      const { found, ...extra } = await fn();
      if (expectSome && found.size === 0) throw new Error("found no picture at all, which a real town never answers: a wrong ref or an empty clone");
      for (const k of found) keys.add(k);
      sources.push({ name, found: found.size, ...extra });
    } catch (e) {
      sources.push({ name, error: String(e?.message ?? e).slice(0, 300) });
    }
  };
  await take("world", true, worldClone && (() => {
    const refs = worldRefs(worldClone);
    return { found: gitKeys(worldClone, refs, { exclude: WORLD_HISTORY }), refs };
  }));
  await take("drafts", false, worldClone && (() => {
    const refs = draftRefs(worldClone);
    return { found: gitKeys(worldClone, refs, { exclude: WORLD_HISTORY }), refs: refs.length };
  }));
  await take("town", true, townClone && (() => {
    const refs = townRefs(townClone);
    return { found: gitKeys(townClone, refs), refs };
  }));
  // WLD-83: the office's own likeness gallery (src/likeness-gallery.json) hangs
  // pictures no town or store source names; they are kept like any hung picture.
  for (const file of officeFiles)
    await take(`office:${String(file).split(/[\\/]/).pop()}`, false, () => ({ found: keysIn(readFileSync(file, "utf8")) }));
  for (const clone of extraClones)
    await take(`extra:${clone}`, false, () => {
      const refs = [...new Set([...refsLike(clone, "refs/heads/"), ...refsLike(clone, "refs/remotes/")])].filter((r) => !r.endsWith("/HEAD"));
      return { found: gitKeys(clone, refs), refs: refs.length };
    });
  for (const src of storeSources)
    await take(`store:${src.table}`, false, pool && (async () => ({ found: await storeKeys(pool, src) })));
  return { keys, sources, ok: sources.every((s) => !s.error) };
}

// ── the plan ────────────────────────────────────────────────────────────────

/**
 * What one run does to each live row, PURE: clear a clock that a hang answered,
 * stamp a clock for a file found unhung, and name the rows due for freeing.
 */
export function planSweep(rows, keys, { now, graceMs = GRACE_MS }) {
  const plan = { live: 0, hung: 0, clear: [], stamp: [], due: [], waiting: [], unpurged: [] };
  for (const row of rows) {
    if (row.deleted_at != null) {
      if (row.purged_at == null) plan.unpurged.push(row);
      continue;
    }
    plan.live += 1;
    if (keys.has(rowKey(row))) {
      plan.hung += 1;
      if (row.unreferenced_since != null) plan.clear.push(row);
    } else if (row.unreferenced_since == null) {
      plan.stamp.push(row);
    } else if (Number(row.unreferenced_since) <= now - graceMs) {
      plan.due.push(row);
    } else {
      plan.waiting.push(row);
    }
  }
  return plan;
}

const KEY_WHERE = "household = ? AND sha = ? AND ext = ?";
const keyArgs = (r) => [r.household, r.sha, r.ext];
const brief = (r) => ({
  url: mediaUrlFor(r.household, r.sha, r.ext), household: r.household, bytes: Number(r.bytes), by: r.by_handle,
  ...(r.unreferenced_since != null ? { unhung_since: new Date(Number(r.unreferenced_since)).toISOString() } : {}),
});
const sumBytes = (rows) => rows.reduce((n, r) => n + Number(r.bytes), 0);

/** Delete one row's objects from storage, original first. Throws naming the key that failed. */
export async function deleteObjects(row, del = r2Delete) {
  for (const key of mediaObjectKeysOf(row)) await del(key);
}

/**
 * One sweep. `apply: false` (the default) keeps the clock and names what it
 * would free; `apply: true` frees what is due. Returns the report, which is
 * also the run's receipt.
 */
export async function runSweep({
  odb, worldClone, townClone, pool, apply = false, now = Date.now(), graceMs = GRACE_MS,
  maxDelete = MAX_DELETE_DEFAULT, del = r2Delete, storeSources, extraClones = [], officeFiles = undefined,
}) {
  const paper = asPaper(odb);
  const report = { at: new Date(now).toISOString(), mode: apply ? "apply" : "dry", grace_days: graceMs / DAY_MS };
  ensureMediaTable(paper);
  if (!(await mediaLedgerHasStates(paper))) {
    return { ...report, refused: "the ledger has no states: the store has not taken 080_media_freed.sql, so nothing can be freed or recorded" };
  }
  const refs = await referenceSet({ worldClone, townClone, pool, storeSources, extraClones, officeFiles });
  report.sources = refs.sources;
  if (!refs.ok) {
    return { ...report, refused: `a source could not be read (${refs.sources.filter((s) => s.error).map((s) => s.name).join(", ")}), so nothing was written: "could not look" is never "not hung"` };
  }

  const rows = await paper.all("SELECT household, sha, ext, bytes, by_handle, created, unreferenced_since, deleted_at, purged_at FROM media");
  const plan = planSweep(rows, refs.keys, { now, graceMs });
  report.ledger = { rows: rows.length, live: plan.live, hung: plan.hung, unhung: plan.live - plan.hung };

  // THE CLOCK, dry or live: bookkeeping, never a deletion.
  for (const r of plan.clear)
    await paper.run(`UPDATE media SET unreferenced_since = NULL WHERE ${KEY_WHERE} AND deleted_at IS NULL`, ...keyArgs(r));
  for (const r of plan.stamp)
    await paper.run(`UPDATE media SET unreferenced_since = ? WHERE ${KEY_WHERE} AND deleted_at IS NULL AND unreferenced_since IS NULL`, now, ...keyArgs(r));
  report.clock = { cleared: plan.clear.length, stamped: plan.stamp.length, waiting: plan.waiting.length };

  report.due = { files: plan.due.length, bytes: sumBytes(plan.due), rows: plan.due.map(brief) };
  report.unpurged = plan.unpurged.map(brief);
  if (!apply) return { ...report, would_free: report.due };

  if (plan.due.length > maxDelete) {
    return { ...report, refused: `${plan.due.length} files are due, more than this run's limit of ${maxDelete}: a flood of due files is a broken source until a person reads this report; nothing was freed (raise --max-delete to free them)` };
  }

  const freed = [], failed = [];
  // Claimed-but-unpurged rows from an earlier run first: storage owes them a DELETE.
  for (const r of plan.unpurged) {
    try { await deleteObjects(r, del); await paper.run(`UPDATE media SET purged_at = ? WHERE ${KEY_WHERE} AND deleted_at IS NOT NULL AND purged_at IS NULL`, now, ...keyArgs(r)); freed.push({ ...brief(r), retried: true }); }
    catch (e) { failed.push({ ...brief(r), error: String(e?.message ?? e).slice(0, 200) }); }
  }
  for (const r of plan.due) {
    const claimed = await paper.run(
      `UPDATE media SET deleted_at = ?, deleted_cause = 'sweep', deleted_by = ?, deleted_reason = ? WHERE ${KEY_WHERE} AND deleted_at IS NULL AND unreferenced_since IS NOT NULL AND unreferenced_since <= ?`,
      now, SWEEP_HAND, `hung nowhere for ${graceMs / DAY_MS} days`, ...keyArgs(r), now - graceMs);
    if (claimed.changes !== 1) continue; // hung again since the plan was read: kept
    try { await deleteObjects(r, del); await paper.run(`UPDATE media SET purged_at = ? WHERE ${KEY_WHERE} AND deleted_at = ?`, now, ...keyArgs(r), now); freed.push(brief(r)); }
    catch (e) { failed.push({ ...brief(r), error: String(e?.message ?? e).slice(0, 200) }); }
  }
  return { ...report, freed: { files: freed.length, bytes: sumBytes(freed), rows: freed }, ...(failed.length ? { storage_failed: failed } : {}) };
}

// ── the takedown ────────────────────────────────────────────────────────────

/**
 * Take one file down at once (moderation), original and copies, with a receipt.
 * Not judged against any surface: it is an operator's act, and the file may
 * well be hung. `apply: false` names what it would do and touches nothing.
 */
export async function takedown({ odb, url, reason, by, apply = false, now = Date.now(), del = r2Delete }) {
  const paper = asPaper(odb);
  const p = mediaUrlParts(url);
  if (!p) return { refused: `${String(url).slice(0, 140)} is not an address the media door mints (${MEDIA_BASE}/media/<household>/<sha256>.<ext>)` };
  if (!String(reason ?? "").trim()) return { refused: "a takedown names its reason (--reason): it is the receipt" };
  if (!String(by ?? "").trim()) return { refused: "a takedown names the operator who took it (--by)" };
  ensureMediaTable(paper);
  if (!(await mediaLedgerHasStates(paper))) return { refused: "the ledger has no states: the store has not taken 080_media_freed.sql" };
  const row = await paper.get(`SELECT household, sha, ext, bytes, by_handle, deleted_at, deleted_cause, purged_at FROM media WHERE ${KEY_WHERE}`, p.household, p.sha, p.ext);
  if (!row) return { refused: `the ledger holds no file at ${mediaUrlFor(p.household, p.sha, p.ext)}; nothing was taken down` };
  const receipt = { url: mediaUrlFor(row.household, row.sha, row.ext), household: row.household, bytes: Number(row.bytes), uploaded_by: row.by_handle,
    objects: mediaObjectKeysOf(row), reason: String(reason).trim(), by: String(by).trim(), at: new Date(now).toISOString() };
  if (row.deleted_cause === "takedown" && row.purged_at != null) return { already: true, receipt };
  if (!apply) return { dry: true, would: receipt, ...(row.deleted_at != null ? { note: `already freed by the ${row.deleted_cause}; a takedown keeps it down in every household` } : {}) };
  await paper.run(`UPDATE media SET deleted_at = COALESCE(deleted_at, ?), deleted_cause = 'takedown', deleted_by = ?, deleted_reason = ?, unreferenced_since = NULL WHERE ${KEY_WHERE}`,
    now, receipt.by, receipt.reason, ...keyArgs(row));
  try { await deleteObjects(row, del); }
  catch (e) { return { taken_down: true, purged: false, receipt, storage_failed: String(e?.message ?? e).slice(0, 200) }; }
  await paper.run(`UPDATE media SET purged_at = ? WHERE ${KEY_WHERE}`, now, ...keyArgs(row));
  return { taken_down: true, purged: true, receipt };
}
