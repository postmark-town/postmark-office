// media-sweep.mjs — the daily sweep that frees media nothing hangs any more
// (POS-737), and the operator's takedown beside it.
//
// THE RULING (Darko, 2026-10-21 08:26 EDT, "737 agreed"): a daily office sweep
// deletes an upload that no current surface references (marks, profiles, home
// pictures, posts, events) after a 30-day grace, with its -96/-256 copies. The
// ledger row moves to a deleted state and its bytes leave the household's wall.
// It runs report-only first. An operator takedown verb (immediate, with a
// receipt) ships with it.
//
// RULED (Darko, 2026-11-25 08:34 EST, POS-737/b, "1 as rec"): history counts as
// in use. "Before freeing anything, the sweep must also read the World's logs
// (STATE/log/*) and the public replays (/world-engine/replay/*.json)." So there
// is no replay gap: a file the world's record or a public replay still shows is
// in use, for the sweep and for the household's own delete alike, since both
// read this one reference set.
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
//             STATE/log/ (which is its own source, next)
//   world-history  STATE/log/ at those same two refs: the world's record, every
//             crossing's emissions and journal (POS-737/b). The directory must
//             exist at each ref: a ref without it is unreadable, never empty.
//   replays   the public replays, `<dir>/*.json`, `dir` being the operator's
//             binding (MEDIA_SWEEP_REPLAY_DIR: the site's served
//             world-engine/replay directory). Resolved once at the start of a
//             run, so a refresh that swaps the webroot mid-run cannot split the
//             read. Not configured, missing, unreadable or holding no replay
//             file is unreadable (POS-737/b).
//   drafts    every draft/<household> ref in the world clone, the same paths
//             (STATE/log/ stays out: a draft's log is main's, which world-history
//             has read)
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
//             threads and bulletin. Never a store history table (acts, mark
//             versions, snapshots, the town log): the history the ruling names
//             is the world's STATE/log and the public replays, above.
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
//
// ── THE HOUSEHOLD'S OWN DELETE (POS-737/c) ──────────────────────────────────
//
// RULED (Darko, 2026-11-21 21:18 EST, POS-737/c, "Yes, both"), on the call
// "give a household a delete for its own pictures that nothing uses, with a
// receipt. Deletion is permanent; a picture still in use can't be deleted."
// Wright's return (02:21Z): "a door on the household's media that deletes an
// upload nothing references, using the sweep's own reference check. It's
// refused while anything still uses the picture, and it leaves a receipt. The
// bytes leave the household's 200 MB wall at once."
//
// THE SWEEP'S SAFETY, WITHOUT ITS GRACE. One reference set (referenceSet, every
// source, fail closed), one storage delete (deleteObjects) and one conditional
// claim, the sweep's own three. What the grace gives the sweep (a file a door
// has hung since cannot be claimed) the claim keeps here through the same
// clock: `deleteOwnUpload` stamps `unreferenced_since` BEFORE it reads the
// sources (unless a clock already runs) and claims only while that stamp still
// stands. A hanging door clears the clock before it hangs (media.mjs §
// mediaHeldRefusal), so a hang checked after the stamp makes the claim miss and
// nothing is deleted. A stamp of its own that ends in a refusal is taken back.
//
// WHAT IT IS NOT: moderation. A takedown is an operator's, holds in every
// household and refuses the same bytes again; this is a household's own file,
// freed because nothing uses it, and the same bytes uploaded again live again.
// It frees nothing of another household's, never a small copy alone, and never
// on a source it could not read. Its cause is 'household' (102), and its
// `deleted_by` is the resident who asked.

import { execFile } from "node:child_process";
import { readdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";

import { asPaper } from "./paperwork.mjs";
import { faultLogged } from "./fault-words.mjs"; // a storage refusal's own words go to the log; the resident reads the office's (POS-578)
import { blessed, freshestMainRef } from "./world-branches.mjs";
import {
  MEDIA_BASE, MEDIA_GRACE_DAYS, MEDIA_HOUSEHOLD_CAUSE, ensureMediaTable, mediaLedgerHasStates, mediaObjectKeysOf, mediaUrlFor, mediaUrlParts, r2Delete,
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

// ASYNC ON PURPOSE (POS-737 FIX, Rivet's review). The household's delete runs this
// inside the office's own process, on `POST /household`, and `git grep` over the
// world's 37,000 log files takes seconds: a synchronous child freezes every other
// request for that long. So every costly read here (git, the replay files, the
// gallery) is a promise and the event loop keeps turning while it runs. The only
// synchronous git left is world-branches.mjs's `blessed` and `freshestMainRef`,
// the office's own memoized ref reads (a few cheap spawns, answered from memory
// while the refresher runs), kept so the world's refs are chosen exactly as every
// other reader chooses them.
const gitOut = (repo, args) => new Promise((resolve, reject) => {
  execFile("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true }, (e, stdout) => {
    if (e) reject(e); else resolve(stdout); // a failed child's error already carries its stderr and its exit status in `code`
  });
});

/**
 * Every media key on the trees of `refs` in `repo`, minus `exclude` paths. One
 * `git grep` over the commits: exit 1 is "no match", anything else is a refusal.
 */
export async function gitKeys(repo, refs, { exclude = [], only = null } = {}) {
  const keys = new Set();
  if (!refs.length) return keys;
  let out;
  try {
    out = await gitOut(repo, ["grep", "-h", "-o", "-I", "-E", MEDIA_URL_ERE, ...refs, "--", ...(only ?? ["."]), ...exclude.map((p) => `:(exclude)${p}`)]);
  } catch (e) {
    if (e.code === 1) return keys; // no line matched (the child's exit status; a spawn failure's code is a string)
    throw new Error(`git grep in ${repo} failed: ${String(e.stderr || e.message).trim().slice(0, 200)}`);
  }
  return keysIn(out, keys);
}

const refsLike = async (repo, pattern) =>
  (await gitOut(repo, ["for-each-ref", "--format=%(refname)", pattern])).split("\n").filter(Boolean);

/** The world's current refs: the blessing and main, deduplicated. */
export async function worldRefs(repo) {
  const b = blessed(repo);
  return [...new Set([b.ref, freshestMainRef(repo)])];
}

/** Every draft ref the world clone holds, local and fetched. */
export const draftRefs = async (repo) => [...new Set([...await refsLike(repo, "refs/heads/draft/"), ...await refsLike(repo, "refs/remotes/origin/draft/")])];

/** The town's current refs: the checkout and, when fetched, origin/main. */
export async function townRefs(repo) {
  const refs = ["HEAD"];
  if ((await refsLike(repo, "refs/remotes/origin/main")).length) refs.push("refs/remotes/origin/main");
  return refs;
}

export const WORLD_HISTORY = Object.freeze(["STATE/log"]);

/**
 * Every media key in the world's history (`STATE/log/`) at `refs` (POS-737/b).
 * `git grep` over a pathspec that matches nothing answers "no match", the same
 * as a history with no picture, so each ref's history directory is asked for
 * first: a ref that does not hold it is a refusal, never an empty history.
 */
export async function historyKeys(repo, refs, paths = WORLD_HISTORY) {
  for (const ref of refs) for (const p of paths) {
    try { await gitOut(repo, ["cat-file", "-e", `${ref}:${p}`]); }
    catch { throw new Error(`${repo} holds no ${p}/ at ${ref}, so the world's history cannot be read`); }
  }
  return gitKeys(repo, refs, { only: paths });
}

/**
 * Every media key in the public replays: `*.json` in `root`, an already
 * resolved directory. No replay file at all is a refusal, never an empty
 * history, and so is any file that cannot be read.
 */
export async function replayKeys(root) {
  const files = (await readdir(root)).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`${root} holds no replay file (*.json), so the public replays cannot be read`);
  const keys = new Set();
  // an escaped slash in a JSON value reads as one, as the store's rows do
  for (const f of files) keysIn((await readFile(join(root, f), "utf8")).replace(/\\+\//g, "/"), keys);
  return { keys, files: files.length };
}

// ── the store sources ───────────────────────────────────────────────────────

/** The office's own file that hangs media (WLD-83's likeness gallery). */
export const OFFICE_GALLERY = new URL("./likeness-gallery.json", import.meta.url);

/** The store's current-state tables a media URL can hang in, read whole as text. */
export const STORE_SOURCES = Object.freeze([
  { table: "marks", where: "status = 'standing'", why: "standing marks (a retired mark's picture is still held by the world's log and the public replays, the history sources above)" },
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
 * `locate`, a row's key, marks each source that names it with `holds: true`
 * (the household's own delete says where a file is in use); the set itself
 * does not change.
 */
export async function referenceSet({ worldClone, townClone, replayDir = null, pool, storeSources = STORE_SOURCES, extraClones = [], officeFiles = [OFFICE_GALLERY], locate = null }) {
  // The replays' directory is resolved ONCE, here, before any source is read: the
  // site's webroot is a symlink the refresh swaps, and a run reads one release of it.
  let replayRoot = null, replayWhy = null;
  try { replayRoot = replayDir ? await realpath(replayDir) : null; } catch (e) { replayWhy = e; }
  const keys = new Set();
  const sources = [];
  const take = async (name, expectSome, fn) => {
    try {
      if (!fn) throw new Error("not configured");
      const { found, ...extra } = await fn();
      if (expectSome && found.size === 0) throw new Error("found no picture at all, which a real town never answers: a wrong ref or an empty clone");
      for (const k of found) keys.add(k);
      sources.push({ name, found: found.size, ...(locate != null && found.has(locate) ? { holds: true } : {}), ...extra });
    } catch (e) {
      sources.push({ name, error: String(e?.message ?? e).slice(0, 300) });
    }
  };
  await take("world", true, worldClone && (async () => {
    const refs = await worldRefs(worldClone);
    return { found: await gitKeys(worldClone, refs, { exclude: WORLD_HISTORY }), refs };
  }));
  // POS-737/b: the world's own record counts as in use
  await take("world-history", false, worldClone && (async () => {
    const refs = await worldRefs(worldClone);
    return { found: await historyKeys(worldClone, refs), refs };
  }));
  await take("drafts", false, worldClone && (async () => {
    const refs = await draftRefs(worldClone);
    return { found: await gitKeys(worldClone, refs, { exclude: WORLD_HISTORY }), refs: refs.length };
  }));
  await take("town", true, townClone && (async () => {
    const refs = await townRefs(townClone);
    return { found: await gitKeys(townClone, refs), refs };
  }));
  // WLD-83: the office's own likeness gallery (src/likeness-gallery.json) hangs
  // pictures no town or store source names; they are kept like any hung picture.
  for (const file of officeFiles)
    await take(`office:${String(file).split(/[\\/]/).pop()}`, false, async () => ({ found: keysIn(await readFile(file, "utf8")) }));
  for (const clone of extraClones)
    await take(`extra:${clone}`, false, async () => {
      const refs = [...new Set([...await refsLike(clone, "refs/heads/"), ...await refsLike(clone, "refs/remotes/")])].filter((r) => !r.endsWith("/HEAD"));
      return { found: await gitKeys(clone, refs), refs: refs.length };
    });
  for (const src of storeSources)
    await take(`store:${src.table}`, false, pool && (async () => ({ found: await storeKeys(pool, src) })));
  // POS-737/b: the public replays, read from the directory resolved at the top. Last, so the slow
  // sources have all run and the one read that a webroot swap could split is the one the top pinned.
  await take("replays", false, async () => {
    if (replayWhy) throw replayWhy;
    if (!replayRoot) throw new Error("not configured: the public replays' directory is MEDIA_SWEEP_REPLAY_DIR, and nothing is freed without it");
    const { keys: found, files } = await replayKeys(replayRoot);
    return { found, files };
  });
  return { keys, sources, ok: sources.every((s) => !s.error) };
}

/**
 * The clones every reader of the reference set takes from the office's env
 * (/etc/postmark-office.env, which the sweep's unit and the office both load),
 * so the sweep and the household's own delete read the same places.
 */
export const sweepClonesFrom = (env = process.env) => ({
  worldClone: env.WORLD_CLONE || null,
  townClone: env.TOWN_CLONE || null,
  // the site's served `world-engine/replay` directory (POS-737/b), a path the
  // office's user can read; unset, the replays are an unread source and nothing is freed
  replayDir: env.MEDIA_SWEEP_REPLAY_DIR || null,
  extraClones: String(env.MEDIA_SWEEP_EXTRA_CLONES ?? "").split(",").map((p) => p.trim()).filter(Boolean),
});

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
  odb, worldClone, townClone, replayDir = null, pool, apply = false, now = Date.now(), graceMs = GRACE_MS,
  maxDelete = MAX_DELETE_DEFAULT, del = r2Delete, storeSources, extraClones = [], officeFiles = undefined,
}) {
  const paper = asPaper(odb);
  const report = { at: new Date(now).toISOString(), mode: apply ? "apply" : "dry", grace_days: graceMs / DAY_MS };
  ensureMediaTable(paper);
  if (!(await mediaLedgerHasStates(paper))) {
    return { ...report, refused: "the ledger has no states: the store has not taken 080_media_freed.sql, so nothing can be freed or recorded" };
  }
  const refs = await referenceSet({ worldClone, townClone, replayDir, pool, storeSources, extraClones, officeFiles });
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

// ── the household's own delete ──────────────────────────────────────────────

export const HOUSEHOLD_DELETE_REASON = "deleted by its household: nothing in the town used it";
const ROW_COLUMNS = "household, sha, ext, bytes, by_handle, unreferenced_since, deleted_at, deleted_cause, deleted_by, purged_at";
const refusal = (code, defect, hint, extra = {}) => ({ refused: { code, defect, hint, ...extra } });

/** The receipt a row carries: the file, who uploaded it, and how it was freed. Who freed it is named only
 *  when its household did: a takedown's operator and reason stay the operator's receipt (`takedown`). */
const receiptOf = (r, extra = {}) => ({
  url: mediaUrlFor(r.household, r.sha, r.ext), household: r.household, bytes: Number(r.bytes), uploaded_by: r.by_handle,
  cause: r.deleted_cause, ...(r.deleted_cause === MEDIA_HOUSEHOLD_CAUSE ? { deleted_by: r.deleted_by } : {}),
  objects: mediaObjectKeysOf(r), ...extra,
});

/**
 * A household deletes one upload of its own that nothing references (§ THE
 * HOUSEHOLD'S OWN DELETE, above). The caller has judged the key and names the
 * acting resident (`by`); the sources are the sweep's own.
 *
 * Answers one of:
 *   { refused: { code, defect, hint, ...extra } }   nothing was written
 *   { deleted: true, purged, freed_bytes, receipt, storage_failed? }
 *       a fresh claim (freed_bytes is the file's, given back once) or the
 *       finish of one storage had not confirmed (freed_bytes 0)
 *   { already: true, purged: true, freed_bytes: 0, receipt }   freed before
 */
export async function deleteOwnUpload({
  odb, household, by, url, worldClone, townClone, replayDir = null, pool, storeSources, extraClones = [], officeFiles = undefined,
  now = Date.now(), del = r2Delete, log = console.log,
}) {
  const paper = asPaper(odb);
  const p = mediaUrlParts(url);
  if (!p)
    return refusal(422, "the town holds no file at that URL",
      `${String(url ?? "").slice(0, 140)} is not an address the media door mints (${MEDIA_BASE}/media/<household>/<sha256>.<ext>) — household { read: "media" } lists your uploads`);
  if (p.size != null)
    return refusal(422, "that is a small copy, not an upload",
      `name the upload's own URL (without -${p.size}), as household { read: "media" } lists it — its small copies go with it`);
  // THE OWNER, read off the URL the door minted: no other house writes on your wall (the-household-grain)
  if (p.household !== household)
    return refusal(403, "that file is another household's",
      "a household deletes only its own uploads; a picture another household uploaded is theirs to keep or delete");
  ensureMediaTable(paper);
  if (!(await mediaLedgerHasStates(paper)))
    return refusal(503, "the media ledger cannot record a deletion yet", "the store has not taken 080_media_freed.sql; nothing was deleted");
  const read = () => paper.get(`SELECT ${ROW_COLUMNS} FROM media WHERE ${KEY_WHERE}`, p.household, p.sha, p.ext);
  let row = await read();
  if (!row)
    return refusal(404, "your household holds no file at that URL", 'household { read: "media" } lists every upload your household holds');
  if (row.deleted_at != null) return finishClaimed(paper, row, { now, del, log });

  // THE TOKEN: a clock that runs is the claim's condition, as in the sweep. If
  // none runs, this stamps one now, and it is taken back on any refusal.
  const stamped = (await paper.run(
    `UPDATE media SET unreferenced_since = ? WHERE ${KEY_WHERE} AND deleted_at IS NULL AND unreferenced_since IS NULL`, now, ...keyArgs(row))).changes === 1;
  const unstamp = async () => {
    if (stamped) await paper.run(`UPDATE media SET unreferenced_since = NULL WHERE ${KEY_WHERE} AND deleted_at IS NULL AND unreferenced_since = ?`, ...keyArgs(row), now);
  };
  row = await read();
  if (row.deleted_at != null) return finishClaimed(paper, row, { now, del, log }); // the sweep claimed it first
  const token = row.unreferenced_since;
  // POS-737/b: the town's past record counts as in use, and a record is not edited, so that part never goes
  const REMEMBERED = new Set(["world-history", "replays"]);
  // The words never advise taking a past record down: the record is kept as it was, so what it shows stays.
  const inUse = (holders) => {
    const past = holders.some((h) => REMEMBERED.has(h)), live = holders.some((h) => !REMEMBERED.has(h));
    return refusal(409, "that file is still in use",
      !past ? "it hangs somewhere in the town, so it cannot be deleted: take it down from there first, then ask again. A mark's picture is in use until the change is published at a settlement"
      : !live ? "the town's record of a past crossing (a log or a public replay) shows it, and that record is kept as it was, so a picture it shows stays and cannot be deleted"
      : "it hangs somewhere in the town, and the town's record of a past crossing (a log or a public replay) shows it too. That record is kept as it was, so a picture it shows stays and cannot be deleted, whatever is taken down elsewhere",
      { in_use: holders });
  };
  const hungMeanwhile = () => refusal(409, "that file is still in use",
    "a door hung it while the town was checking, so nothing was deleted: take it down from there first, then ask again");
  if (token == null) return hungMeanwhile(); // a hanging door cleared the clock between the stamp and this read

  const key = rowKey(row);
  const refs = await referenceSet({ worldClone, townClone, replayDir, pool, storeSources, extraClones, officeFiles, locate: key });
  if (!refs.ok) {
    await unstamp();
    const failed = refs.sources.filter((s) => s.error);
    log(`[media] delete-media ${household}/${by} ${p.sha.slice(0, 12)}: refused, could not read ${failed.map((s) => `${s.name} (${s.error})`).join("; ")}`);
    return refusal(503, "the town could not check every place this file could hang, so nothing was deleted",
      '"could not look" is never "not used" — try again later; if it repeats, tell the office (a letter to wright works)',
      { unread: failed.map((s) => s.name) });
  }
  if (refs.keys.has(key)) {
    // hung: its clock says so too, exactly as the sweep's own read would
    await paper.run(`UPDATE media SET unreferenced_since = NULL WHERE ${KEY_WHERE} AND deleted_at IS NULL`, ...keyArgs(row));
    return inUse(refs.sources.filter((s) => s.holds).map((s) => s.name));
  }

  // THE CLAIM, conditional on the token: a door that hung the file since the
  // stamp cleared the clock, and the claim misses.
  let claimed;
  try {
    claimed = await paper.run(
      `UPDATE media SET deleted_at = ?, deleted_cause = ?, deleted_by = ?, deleted_reason = ? WHERE ${KEY_WHERE} AND deleted_at IS NULL AND unreferenced_since = ?`,
      now, MEDIA_HOUSEHOLD_CAUSE, by, HOUSEHOLD_DELETE_REASON, ...keyArgs(row), token);
  } catch (e) {
    // the store's check on the cause, before 102: nothing was claimed
    if (e?.code === "23514") {
      await unstamp();
      return refusal(503, "the store cannot record a household's delete yet", "the store has not taken 102_media_deleted_by_household.sql; nothing was deleted");
    }
    throw e;
  }
  if (claimed.changes !== 1) {
    const now2 = await read();
    if (now2?.deleted_at != null) return finishClaimed(paper, now2, { now, del, log }); // another hand freed it meanwhile
    await unstamp();
    return hungMeanwhile();
  }

  // FROM THE CLAIM ON its bytes are off the wall and no door can hang it.
  const receipt = receiptOf({ ...row, deleted_by: by, deleted_cause: MEDIA_HOUSEHOLD_CAUSE }, { at: new Date(now).toISOString() });
  try { await deleteObjects(row, del); }
  catch (e) {
    return { deleted: true, purged: false, freed_bytes: Number(row.bytes), receipt,
      storage_failed: faultLogged(`delete-media ${household}/${by} ${p.sha.slice(0, 12)}: claimed, storage refused`, e) };
  }
  await paper.run(`UPDATE media SET purged_at = ? WHERE ${KEY_WHERE} AND deleted_at IS NOT NULL AND purged_at IS NULL`, now, ...keyArgs(row));
  log(`[media] delete-media ${household}/${by} ${p.sha.slice(0, 12)}.${p.ext} ${row.bytes}B freed`);
  return { deleted: true, purged: true, freed_bytes: Number(row.bytes), receipt };
}

/** A row already claimed: freed before (nothing to do), or owed storage's DELETE, which is retried here. */
async function finishClaimed(paper, row, { now, del, log }) {
  const receipt = receiptOf(row, { at: new Date(Number(row.deleted_at)).toISOString() });
  if (row.purged_at != null) return { already: true, purged: true, freed_bytes: 0, receipt };
  try { await deleteObjects(row, del); }
  catch (e) {
    return { deleted: true, purged: false, freed_bytes: 0, receipt,
      storage_failed: faultLogged(`delete-media retry ${row.household} ${String(row.sha).slice(0, 12)}: storage refused again`, e) };
  }
  await paper.run(`UPDATE media SET purged_at = ? WHERE ${KEY_WHERE} AND deleted_at IS NOT NULL AND purged_at IS NULL`, now, ...keyArgs(row));
  return { deleted: true, purged: true, freed_bytes: 0, retried: true, receipt };
}
