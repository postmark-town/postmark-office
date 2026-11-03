// town-index-store.mjs — the office's town index readers, over the store's
// town_* tables (033_town_index.sql). Each was ported from its office.db reader
// in queries.mjs (POS-268), answering exactly what that reader answered; those
// readers went with office.db (POS-656), and their answers over the suites'
// fixture are kept as the record the readers are still held to (test/golden/office-db-twins,
// test/town-index-reads.test.mjs and its siblings). The SQL lives here; the
// answer shapes it fills are queries.mjs's exports.
//
// A door that cannot reach the store says so (the pen's 503); there is no other
// index to answer from (`the-town/the-disclosure`).
//
// ── WHAT A PORT HAS TO CARRY ─────────────────────────────────────────────────
//
// Three sqlite behaviours the doors' answers depended on without saying so, and
// still do:
//   · text compares and sorts BYTEWISE. Postgres' default collation does not, so
//     every comparison and ORDER BY on text here is `COLLATE "C"`.
//   · LIKE ignores ASCII case, and only ASCII case. `ilike` would fold more
//     than that, so both sides are folded with `translate` over A–Z alone.
//   · rows come back in insert order where nothing orders them (a commit's files
//     by rowid). The store keeps that order as `n` (town_repo_log).
// And one it did say: `GROUP BY sha ORDER BY committed_at DESC` breaks ties by
// sha ascending (measured on the live index: 47 tied timestamps, 0 positions
// that differ from that order), so the port names the tiebreak.
//
// Every reader takes a client (anything with pg's `query`), so a caller runs it
// inside `officeRead`'s READ ONLY transaction and a test runs it on its own.

import { wholeNumber } from "./whole-number.mjs";
// The row SHAPES (pages, cards, entries) are queries.mjs's own exported
// functions; only the SQL is written here. A reader that restated a shape
// would be the private copy that drifts.
import {
  repoLogPage, repoLogCommit, regionListing, regionPage, regionWhole,
  bulletinListing, bulletinTeaserOf, bulletinEntryOf,
  stampsRosterPage, stampsDetailOf, stampParties,
  potBoardOf, questBoardWith, withGivers,
  excerpt, LETTER_READING_LAW_LINE, withWhole, MAIL_PAGE, SEARCH_LETTERS, SEARCH_RESIDENTS,
  mailListOf, letterListNoRegion, letterListPage, letterPageCap, correspondentsOf, mailAwaitingOf, searchPage, metricsMailOf,
  rollEntry, residentPageOf, townSummaryOf, residentOf, windowReadOf, psaFoldOf, doorstepOf, DOORSTEP_SIZES, PSA_SLUG, CARD_MAIL,
} from "./queries.mjs";
import { isResidentHandle } from "./residency.mjs"; // the door's admission grammar, as readRoll filters by it
import { lastActiveFor } from "./last-active.mjs"; // a resident's newest act, from acts and town_letters (POS-481)
import { CROSSING_SEAL_SUBJECT, copyCrossing, notInCopyDefect } from "./crossings.mjs"; // the crossing's closing commit, and its words (POS-332)
import { holdStoreProbe, UNREACHABLE_DEFECT, UNREACHABLE_HINT } from "./index-probe.mjs";
import { discoveryAsk, readCursor, textBoundOf, discoveryPage, discoveryTablesIn, generationOf, DISCOVERY_LIMITS, PAST_EVERY_KEY,
  NOT_INSTALLED, NOT_BUILT, noResident, resetNote } from "./town-discovery.mjs"; // POS-497: discovery's bounds, cursor and words

import { freshnessFor, composeHome, composeFoundedHome } from "./paper-fresh.mjs"; // the freshness ladder, as home below uses it

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", LOWER = "abcdefghijklmnopqrstuvwxyz";
/** sqlite's LIKE: ASCII case folded on both sides, nothing else. */
const likeAscii = (col, param, escape = "\\") => `translate(${col}, '${UPPER}', '${LOWER}') LIKE translate(${param}, '${UPPER}', '${LOWER}') ESCAPE '${escape}'`;

/**
 * The town's mail ledger, every event in ledger order (POS-351: the site's
 * ledger.json comes through the office). Each entry is the vendored reader's
 * own object, stored whole in `town_ledger.json`.
 */
export async function townLedger(q) {
  const asOf = await townIndexAsOf(q);
  const entries = (await q.query("SELECT json FROM town_ledger ORDER BY seq")).rows.map((r) => JSON.parse(r.json));
  return { as_of: asOf, total: entries.length, entries };
}

/** The town's docs (POS-351), from town_meta `docs`; `{}` when the index predates the key. */
export async function townDocs(q) {
  const asOf = await townIndexAsOf(q);
  const r = (await q.query("SELECT value FROM town_meta WHERE key = 'docs'")).rows[0];
  return { as_of: asOf, docs: r?.value ? JSON.parse(r.value) : {} };
}

/** The sha the store's index was last ingested at (town_meta `as_of`), or null. */
export async function townIndexAsOf(q) {
  const r = await q.query("SELECT value FROM town_meta WHERE key = 'as_of'");
  return r.rows[0]?.value ?? null;
}

/** The copy the index holds: the newest commit time and the newest crossing seal in town_repo_log. */
export async function indexCopy(q) {
  const newest = (await q.query("SELECT MAX(committed_at COLLATE \"C\") AS at FROM town_repo_log")).rows[0]?.at ?? null;
  const seal = (await q.query(`SELECT sha, committed_at AS at FROM town_repo_log WHERE subject = $1
      ORDER BY committed_at COLLATE "C" DESC, sha COLLATE "C" LIMIT 1`, [CROSSING_SEAL_SUBJECT])).rows[0];
  return { newest, seal: seal ? { sha: seal.sha, at: seal.at } : null };
}

/**
 * The 404 for a letter id the door's index does not hold (POS-332): the copy
 * that was read, and the crossing it has caught up to, from the store's
 * repo_log, the index the lookup asked. A history that cannot be read is said;
 * it never turns the 404 into a 500.
 */
export async function letterNotInCopy({ env = process.env } = {}) {
  let copy;
  try {
    const r = await storeAnswer((c) => indexCopy(c), { env });
    copy = r.refused ? undefined : r.out;
  } catch { copy = undefined; }
  return notInCopyDefect(copy === undefined ? undefined : copyCrossing(copy.seal));
}

/** The repo log, newest commit first: filtered by path prefix, author, since and until, paged, with the total (the commit and page shapes are queries.mjs § repoLogCommit and repoLogPage). */
export async function repoLog(q, opts = {}) {
  const limit = Math.min(Math.max(wholeNumber(opts.limit) || 30, 1), 200);
  const offset = Math.max(wholeNumber(opts.offset) || 0, 0);
  const where = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const likePrefix = opts.path ? String(opts.path).replace(/[\\%_]/g, (c) => "\\" + c) + "%" : null;
  if (likePrefix) where.push(likeAscii("path", p(likePrefix)));
  if (opts.author) where.push(likeAscii("author", p(`%${opts.author}%`), "")); // sqlite's author LIKE has no escape at all
  if (opts.since) where.push(`committed_at COLLATE "C" >= ${p(String(opts.since))}`);
  if (opts.until) {
    const u = String(opts.until);
    where.push(`committed_at COLLATE "C" <= ${p(u.length === 10 ? `${u}T23:59:59.999Z` : u)}`);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const fixed = params.slice();
  // One commit's rows share its time, author and subject, so min() is that value.
  const commits = (await q.query(
    `SELECT sha, min(committed_at) AS committed_at, min(author) AS author, min(subject) AS subject
       FROM town_repo_log ${clause} GROUP BY sha
      ORDER BY min(committed_at) COLLATE "C" DESC, sha COLLATE "C" LIMIT ${p(limit)} OFFSET ${p(offset)}`, params)).rows;
  const total = Number((await q.query(`SELECT COUNT(DISTINCT sha) AS n FROM town_repo_log ${clause}`, fixed)).rows[0].n);
  const filesWhere = likePrefix ? `sha = $1 AND ${likeAscii("path", "$2")}` : "sha = $1";
  const filesArgs = (sha) => (likePrefix ? [sha, likePrefix] : [sha]);
  const out = [];
  for (const c of commits) {
    const files = (await q.query(`SELECT op, path FROM town_repo_log WHERE ${filesWhere} ORDER BY n LIMIT 100`, filesArgs(c.sha))).rows
      .map((r) => ({ op: r.op, path: r.path }));
    const ft = files.length === 100
      ? Number((await q.query(`SELECT COUNT(*) AS n FROM town_repo_log WHERE ${filesWhere}`, filesArgs(c.sha))).rows[0].n)
      : files.length;
    out.push(repoLogCommit(c, files, ft));
  }
  return repoLogPage({ total, limit, offset }, out);
}

const REGIONS_PAGE = 25;

/** The atlas's regions, by id, paged (listing and page shapes: queries.mjs § regionListing, regionPage). */
export async function regionList(q, { limit, offset } = {}) {
  const n = Math.min(Math.max(wholeNumber(limit) || REGIONS_PAGE, 1), 200);
  const start = Math.max(wholeNumber(offset) || 0, 0);
  const total = Number((await q.query("SELECT COUNT(*) AS n FROM town_regions")).rows[0].n);
  const rows = (await q.query(`SELECT id, name, json FROM town_regions ORDER BY id COLLATE "C" LIMIT $1 OFFSET $2`, [n, start])).rows;
  return regionPage({ total, n, start }, rows.map(regionListing));
}

/**
 * One region whole, by id or name, or null. sqlite's `.get()` on `id = ? OR name = ?`
 * answered the first row in table order; a slug that is one region's id and
 * another's name is not a case the atlas has, and the id match is taken first.
 */
export async function regionOne(q, slug) {
  const row = (await q.query(
    `SELECT id, name, json FROM town_regions WHERE id = $1 OR name = $1 ORDER BY (id = $1) DESC, id COLLATE "C" LIMIT 1`, [slug])).rows[0];
  return row ? regionWhole(row) : null;
}

/** The bulletin's listing: every posting's listing line, by slug, bytewise. */
export async function bulletinList(q) {
  return (await q.query(`SELECT slug, json FROM town_bulletin ORDER BY slug COLLATE "C"`)).rows.map(bulletinListing);
}

/** The bulletin's teaser page (read_bulletin's paged answer, and the doorstep's teaser). */
export async function bulletinTeaser(q, opts = {}) {
  return bulletinTeaserOf(await bulletinList(q), opts);
}

/** One bulletin posting whole, or null. */
export async function bulletinEntry(q, slug) {
  const row = (await q.query("SELECT json FROM town_bulletin WHERE slug = $1", [slug])).rows[0];
  return row ? bulletinEntryOf(row.json) : null;
}

// The stamps roster page a caller who names no size gets. ✎ A proposal: the top
// of the table is what a roster read is for, and the whole table was 256 rows
// when this was first written (more than the town's 131 people then, because
// escrow accounts are rows too) and grows with every household.
const STAMPS_PAGE = 50;

/** The stamps roster, richest first, paged; the minted total is the store's own meta. */
export async function stampsRoster(q, { limit, offset } = {}) {
  const n = Math.min(Math.max(wholeNumber(limit) || STAMPS_PAGE, 1), 200);
  const start = Math.max(wholeNumber(offset) || 0, 0);
  const accounts = Number((await q.query("SELECT COUNT(*) AS n FROM town_stamps")).rows[0].n);
  const balances = (await q.query(
    `SELECT handle, balance FROM town_stamps ORDER BY balance DESC, handle COLLATE "C" LIMIT $1 OFFSET $2`, [n, start])).rows;
  const minted = (await q.query("SELECT value FROM town_meta WHERE key = 'stamps_minted'")).rows[0]?.value;
  return stampsRosterPage({ minted, accounts, n, start }, balances);
}

/** One handle's stamps detail: its balance row, with the funding and keeping rows of its parties. */
export async function stampsDetail(q, handle) {
  const row = (await q.query("SELECT balance, mint_count, staked FROM town_stamps WHERE handle = $1", [handle])).rows[0];
  const parties = await stampParties(handle);
  const holoRows = (await q.query(
    `SELECT h.party, h.pot, h.holo, h.epoch, h.date, h.receipt, r.usd AS usd
       FROM town_funding_holo h LEFT JOIN town_pot_receipts r ON r.receipt = h.receipt
      WHERE h.party = ANY($1::text[]) ORDER BY h.date COLLATE "C", h.seq, r.seq`, [parties])).rows;
  const keepingRows = (await q.query(
    `SELECT pot, n, epoch, date FROM town_funding_keeping_mint WHERE party = ANY($1::text[]) ORDER BY date COLLATE "C", seq`, [parties])).rows;
  return stampsDetailOf(row, { holoRows, keepingRows });
}

/** The pot board's rows: each pot with its roll, receipts, escrow and stakers, by id (bytewise where sqlite compared text), and the funding ledger's invalid lines. */
export async function potBoardRows(q) {
  const pots = (await q.query(`SELECT id, json FROM town_pots ORDER BY id COLLATE "C"`)).rows;
  const out = [];
  for (const r of pots) {
    out.push({
      id: r.id, json: r.json,
      roll: (await q.query(`SELECT patron, usd, date, receipt, holo FROM town_funding_roll WHERE pot = $1 ORDER BY date COLLATE "C", seq`, [r.id])).rows,
      receipts: (await q.query(`SELECT rail, usd, date, receipt, payer FROM town_pot_receipts WHERE pot = $1 ORDER BY date COLLATE "C", seq`, [r.id])).rows,
      staked: (await q.query("SELECT staked FROM town_pot_escrow WHERE pot = $1", [r.id])).rows[0]?.staked ?? 0,
      stakers: (await q.query(`SELECT handle, staked FROM town_pot_stakers WHERE pot = $1 ORDER BY staked DESC, handle COLLATE "C"`, [r.id])).rows,
    });
  }
  return { pots: out, invalid: (await q.query("SELECT row_kind, line, reason FROM town_funding_invalid ORDER BY seq")).rows };
}

/**
 * Each handle's open pot stakes, from the store: Map(handle -> Map(pot -> staked)).
 * town_pot_stakers is funding.mjs § foldFunding's own `potEscrowByHandle` (town-index.mjs
 * writes it, zeros dropped), re-derived by the ingest whenever the ledger moves, so
 * the estate reads the fold the index already ran instead of folding the whole
 * ledger on every call (POS-718).
 */
export async function potStakes(q, handles = []) {
  const rows = (await q.query(`SELECT handle, pot, staked FROM town_pot_stakers WHERE handle = ANY($1::text[])`, [handles])).rows;
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.handle)) out.set(r.handle, new Map());
    out.get(r.handle).set(r.pot, r.staked);
  }
  return out;
}

/** The pot board (queries.mjs § potBoardOf) over potBoardRows. */
export async function potBoard(q, extraInvalid = []) {
  return potBoardOf(await potBoardRows(q), extraInvalid);
}

/** A handle's standing row, or null. */
export async function standingFor(q, handle) {
  const row = (await q.query("SELECT json FROM town_quest_standing WHERE handle = $1", [handle])).rows[0];
  // a bent row (json that does not parse) is null, not a throw
  try { return row?.json ? JSON.parse(row.json) : null; } catch { return null; }
}

/** The index meta a quest board reads (quest_registry, quest_day), from the store's own town_meta. */
async function questMeta(q) {
  const rows = (await q.query("SELECT key, value FROM town_meta WHERE key IN ('quest_registry', 'quest_day')")).rows;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ── THE QUEST BOARD: ITS ROWS IN THE TRANSACTION, THE BOARD AFTER IT (POS-370) ──
//
// The board is more than its index rows. Between reading the resident's
// progress and their standing, questBoardWith loads the town's quest tools from
// the clone and asks the WORLD whether their home stands (worldSitedFor), and
// with the kept positions on that world read rebuilds the positions projection
// through the pen. Composed inside the transaction, the board held one pen
// connection while that rebuild waited for another from the same pool of three:
// on 2026-10-04 three boards per worker held all three, the rebuild waited for a
// fourth forever, and the office stalled for an hour (nine sessions idle in
// transaction, every one last running the progress read below).
//
// So the store half is ONLY reads: every row the board can ask for, read in the
// caller's transaction (questIndexRows), and the board is composed from those
// rows once the connection is back (questBoardOfRows). A door runs the two
// together itself (server.mjs /quests/:handle, mcp.mjs read_quests).

const PROGRESS_SQL = "SELECT handle, send, receive, house_size, house_send, house_receive, sent_to, heard_from FROM town_quest_progress WHERE handle = $1";

/**
 * Every index row a quest board can read, from one client, and nothing else.
 *
 * Each read's failure is KEPT and handed back where the board asks for that row,
 * so the board fails exactly where it failed when it read the store itself (a
 * pot table it cannot read is the pots section's own degrade, not the whole
 * board's). The progress row is read whatever its day: the board decides
 * freshness from the town's own clock, and one row it does not use costs nothing.
 */
export async function questIndexRows(q, handle) {
  const named = !(handle == null || String(handle).trim() === "");
  const kept = async (fn) => { try { return { v: await fn() }; } catch (e) { return { e }; } };
  const rows = { handle, meta: await questMeta(q) };
  if (named) {
    rows.progress = await kept(async () => (await q.query(PROGRESS_SQL, [handle])).rows[0]);
    rows.standing = await kept(() => standingFor(q, handle));
  }
  rows.potIds = await kept(async () => (await q.query("SELECT id FROM town_pots")).rows.map((r) => r.id));
  rows.potRows = await kept(() => potBoardRows(q));
  return rows;
}

/** questBoardWith's reads, answered from rows already read. A handle the rows were not read for is a programming error, named. */
function heldQuestSource(rows) {
  const take = (r) => { if (r.e) throw r.e; return r.v; };
  const ours = (h, what) => {
    if (h !== rows.handle) throw new Error(`the quest board's ${what} was read for ${JSON.stringify(rows.handle)}, not ${JSON.stringify(h)}`);
  };
  return {
    progressRow: async (h) => { ours(h, "progress"); return take(rows.progress); },
    standing: async (h) => { ours(h, "standing"); return take(rows.standing); },
    pots: async (extraInvalid) => potBoardOf(take(rows.potRows), extraInvalid),
    potIds: async () => take(rows.potIds),
  };
}

/**
 * The quest board (queries.mjs § questBoardWith) composed from rows the store
 * answered. Its meta (the registry and the day the progress was folded on) is
 * the store's own, never a caller's: the progress rows and the day they are
 * good for come from one index. Holds no connection: call it after the
 * transaction has ended.
 */
export async function questBoardOfRows(rows, clone, opts = {}) {
  return questBoardWith(heldQuestSource(rows), rows.meta, rows.handle, clone, opts);
}

/**
 * The reads household-stamps makes, over one client (the door's one READ ONLY
 * transaction): stampsDetail, potStakes, lastActiveFor, questBoard and potBoard.
 */
export const storeIndex = (q, clone) => ({
  stampsDetail: (handle) => stampsDetail(q, handle),
  potStakes: (handles) => potStakes(q, handles),
  lastActiveFor: (handles) => lastActiveFor(q, handles),
  // rows first, then the board: a caller holding `q` inside a pen transaction
  // would still be holding it while the board asks the world (see above), and
  // the pen refuses that by name (store-pool.mjs § NestedStoreError)
  questBoard: async (handle, opts) => questBoardOfRows(await questIndexRows(q, handle), clone, opts),
  // the index's board only: the gifts' households (POS-550) are a second read,
  // and a caller holding `q` must not ask the pool for one. The door's
  // storeIndexPooled adds them once its connection is back.
  potBoard: (extraInvalid) => potBoard(q, extraInvalid),
});

/** Thrown by a pooled index method when the store cannot be reached; a door turns it into its 503. */
export class TownIndexUnreachable extends Error {
  constructor(refused = UNREACHABLE) { super(refused.defect); this.name = "TownIndexUnreachable"; this.refused = refused; }
}

/**
 * The same methods as storeIndex, each in its OWN short READ ONLY transaction.
 *
 * THIS IS THE ONE A DOOR USES. A composed read (the estate, a doorstep) does
 * more than read the index between its reads: the world's siting, the quest
 * tools, a household's store writes. Holding one pooled connection across all
 * of that while other work asks the same small pool (max 3) for another is how
 * three concurrent readers each hold one connection and wait forever for a
 * second. So each method takes a connection, reads, and gives it back. A store
 * that cannot be reached throws TownIndexUnreachable, never an empty answer.
 */
export function storeIndexPooled(clone, { env = process.env } = {}) {
  // `then` is the half of a read that is not the index: it runs after the
  // connection is back (storeAnswer § then), with the same arguments.
  const via = (fn, then = null) => async (...args) => {
    const r = await storeAnswer((c) => fn(c, ...args), { env, then: then && ((out) => then(out, ...args)) });
    if (r.refused) throw new TownIndexUnreachable(r.refused);
    return r.out;
  };
  return {
    stampsDetail: via((c, handle) => stampsDetail(c, handle)),
    // the estate's escrow split: each resident's open pot stakes (POS-718)
    potStakes: via((c, handles) => potStakes(c, handles)),
    questBoard: via((c, handle) => questIndexRows(c, handle), (rows, _handle, opts) => questBoardOfRows(rows, clone, opts)),
    // the givers' households after the connection is back (queries.mjs § withGivers)
    potBoard: via((c, extraInvalid) => potBoard(c, extraInvalid), (board) => withGivers(board)),
    // the doorstep's and the house's reads (group 3)
    asOf: via((c) => townIndexAsOf(c)),
    copy: via((c) => indexCopy(c)),
    doorstep: via((c, handle, asOf, opts) => doorstep(c, handle, asOf, opts)),
    residentSegments: via((c, handle, fresh, standing) => residentSegments(c, handle, fresh, standing)),
    hasResident: via((c, handle) => hasResident(c, handle)),
    // the house's last_active, every resident in one statement (POS-481)
    lastActiveFor: via((c, handles) => lastActiveFor(c, handles)),
    // the household read v2's deep reads (POS-633 part 2): the house's acts, its letters, its ledger lines
    houseActs: via((c, household, opts) => houseActs(c, household, opts)),
    lettersAround: via((c, handles, sinceDay, opts) => lettersAround(c, handles, sinceDay, opts)),
    stampLinesSince: via((c, sinceIso, opts) => stampLinesSince(c, sinceIso, opts)),
    // the household glance's mail window (POS-633): letters in, and the house's letters out
    mailWindow: via((c, handles, house, sinceDay) => mailWindow(c, handles, house, sinceDay)),
    mailAwaiting: via((c, handle, opts) => mailAwaiting(c, handle, opts)),
    standing: via((c, handle) => standingFor(c, handle)),
    // the town's quest registry (town_meta `quest_registry`), as the doorstep's next steps read it; null when the index has none
    questRegistry: via(async (c) => (await questMeta(c)).quest_registry ?? null),
    home: via((c, handle, fresh) => home(c, handle, fresh)),
    deliveredTo: via((c, handle) => deliveredTo(c, handle)),
    resident: via((c, handle, fresh) => resident(c, handle, fresh)),
    windowRead: via((c, handle, fresh) => windowRead(c, handle, fresh)),
  };
}

// ── letters and mail (group 2) ───────────────────────────────────────────────

// A letter row as the shapes read it: the table's columns, never `digest` (the ingest's change stamp; readers do not select it).
const LETTER_COLS = "id, from_h, to_h, date, thread, box, owner, path, json, delivered_at";
// Newest first, bytewise: real timestamps (delivered_at) win over a bare same-day date.
const NEWEST = `COALESCE(delivered_at, date) COLLATE "C" DESC, id COLLATE "C"`;
// (NEWEST above: delivered_at is UTC ISO, so bytewise string order IS time
// order, and a bare `date` sorts as that day's midnight, before any timestamped
// same-day letter. Ties break on id.)
const count = async (q, sql, params = []) => Number((await q.query(sql, params)).rows[0].n);

/** One letter whole, or null. */
export async function letter(q, id) {
  const row = (await q.query("SELECT json FROM town_letters WHERE id = $1", [id])).rows[0];
  return row ? withWhole(JSON.parse(row.json), { asOf: await townIndexAsOf(q) }) : null; // withWhole: queries.mjs § A COPY CARRIES PROOF IT'S WHOLE (POS-334)
}

/** The letter as the doors answer it: the letter whole with the reading-law line first (queries.mjs § LETTER_READING_LAW_LINE), or null. */
export async function letterAnswer(q, id) {
  const l = await letter(q, id);
  return l ? { reading_law: LETTER_READING_LAW_LINE, ...l } : null;
}

/** One box, newest first, paged (the list shape is queries.mjs § mailListOf). */
export async function mailList(q, handle, box = "inbox", opts = {}) {
  return mailListOf(handle, box, await mailPage(q, handle, box, opts));
}

/** One box's page: { total, limit, offset, letters }. */
export async function mailPage(q, handle, box, { since, until, limit, offset } = {}) {
  const where = [`${box === "outbox" ? "from_h" : "to_h"} = $1`];
  if (box !== "outbox") where.push("(box = 'inbox' OR box IS NULL)");
  const params = [handle];
  if (since) { params.push(since); where.push(`date COLLATE "C" >= $${params.length}`); }
  if (until) { params.push(until); where.push(`date COLLATE "C" <= $${params.length}`); }
  const clause = `WHERE ${where.join(" AND ")}`;
  const n = Math.min(Math.max(wholeNumber(limit) || MAIL_PAGE, 1), 200);
  const start = Math.max(wholeNumber(offset) || 0, 0);
  const total = await count(q, `SELECT COUNT(*) AS n FROM town_letters ${clause}`, params);
  const rows = (await q.query(`SELECT ${LETTER_COLS} FROM town_letters ${clause} ORDER BY ${NEWEST} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, n, start])).rows;
  return { total, limit: n, offset: start, letters: rows.map(excerpt) };
}

/** How many letters sit in a resident's outbox. */
export async function outboxSettled(q, handle) {
  return count(q, "SELECT COUNT(*) AS n FROM town_letters WHERE from_h = $1 AND box = 'outbox'", [handle]);
}

/** A region's roll, by slug or display name. */
export async function regionResidents(q, slugOrName) {
  const row = (await q.query(`SELECT json FROM town_regions WHERE id = $1 OR name = $1 ORDER BY (id = $1) DESC, id COLLATE "C" LIMIT 1`, [slugOrName])).rows[0];
  return row ? (JSON.parse(row.json).residents ?? []) : [];
}

/** Every resident whose card says office (the roster's flag). */
export async function officeHandles(q) {
  return (await roster(q)).filter((e) => e.is_office).map((e) => e.handle);
}

// ── THE ROSTER, READ ONCE PER INGEST (group 3) ──────────────────────────────
//
// Every resident's card is ~125 KB (it carries their boxes), 26 MB in all, and
// half the office wants only the roll's line from each: the roll memo behind
// the position doors, the roster, the town card's offices, the doorstep's
// arrivals. So the lines are kept, keyed on the store's own head (town_meta
// as_of, one row): a new ingest moves the head and the next read re-reads the
// cards once. (The office.db roll memo this replaced keyed on that file's change
// stamp for the same reason; this one keys on the store's clock.)
// Entries hold rollEntry's line for EVERY row (the admission grammar is applied
// by the readers that want it, residentList for one), never a card.
let _roster = { asOf: undefined, entries: null };
export async function roster(q) {
  const asOf = await townIndexAsOf(q);
  if (_roster.entries && _roster.asOf === asOf) return _roster.entries;
  const rows = (await q.query(`SELECT handle, json FROM town_residents ORDER BY handle COLLATE "C"`)).rows;
  const entries = rows.map((r) => rollEntry(r.handle, JSON.parse(r.json)));
  _roster = { asOf, entries };
  return entries;
}
// THE ROLL'S HANDLES, HELD FOR THE SYNC READERS. The position doors
// (server.mjs § townRoll) and the MCP roll (mcp.mjs § rollOf) ask for the roll
// synchronously, on every call. They read this (every door reads the store; no
// TOWN_INDEX_READS switch is left): the store's
// roll as the office last loaded it, refreshed by the office's own reload poll
// (refreshStoreRoll) and at boot. Null until the first load, and null is what
// those readers already disclose as "the roll could not be read", never an
// empty town.
let _rollHandles = null;
export const storeRollHandles = () => _rollHandles;
export async function refreshStoreRoll({ env = process.env, statementTimeoutMs = null } = {}) {
  const r = await storeAnswer((c) => residentList(c), { env, statementTimeoutMs }).catch(() => ({ refused: UNREACHABLE }));
  if (!r.refused) _rollHandles = r.out.map((e) => e.handle);
  return _rollHandles;
}

// THE WRITE PATH'S PROBE (group 4; index-probe.mjs says what it answers). The
// resident handles (every row, as office.db's `SELECT 1 FROM residents` saw
// every row), the letter ids, and each resident's GitHub line in the order
// office.db's rowid kept, which is the vendored readTown's sorted listing:
// bytewise. The GitHub line is picked in JS from the two jsonb values, with
// `??` as office.db's reader did, so a JSON null and a missing key read alike.
export async function probeRows(q, { letters = true, logins = true } = {}) {
  const rows = (await q.query(logins
    ? `SELECT handle, json::jsonb -> 'github' AS g1, json::jsonb -> 'address' -> 'data' -> 'github' AS g2 FROM town_residents ORDER BY handle COLLATE "C"`
    : `SELECT handle FROM town_residents`)).rows;
  return {
    asOf: await townIndexAsOf(q),
    handles: new Set(rows.map((r) => r.handle)),
    letters: letters ? new Set((await q.query("SELECT id FROM town_letters")).rows.map((r) => r.id)) : null,
    logins: logins ? rows.map((r) => ({ handle: r.handle, github: r.g1 ?? r.g2 ?? "" })) : null,
  };
}

// A question the snapshot was not loaded to answer is a programming error, named.
const notLoaded = (what) => { throw new Error(`the store's probe was loaded without ${what}`); };

/** The probe over a snapshot. `mail` holds the mail_state rows a caller read for this call (handle -> json|null);
 *  `standing` the sender's own standing letters with their roots (handle -> [{ letter_id, thread, root }]). */
export function probeOver(rows, { mail = null, standing = null } = {}) {
  return Object.freeze({
    hasResident: (h) => rows.handles.has(h),
    hasLetter: (id) => (rows.letters ?? notLoaded("letter ids")).has(id),
    loginStamp: () => `store:${rows.asOf}`,
    loginRows: () => rows.logins ?? notLoaded("GitHub lines"),
    mailStateJson: (h) => (mail?.has(h) ? mail.get(h) : notLoaded(`${h}'s mail_state`)),
    mailStanding: (h) => standing?.get(h) ?? [],
  });
}

// THE OFFICE'S HELD SNAPSHOT: loaded at boot and on the reload poll beside the
// roll, and re-read only when the store's head moved. A refresh that cannot
// reach the store keeps the last snapshot (as a failed office.db reload once kept
// the file it had); a process that never loaded one refuses every check (503).
let _probeRows = null;
export async function refreshStoreProbe({ env = process.env, letters = true, logins = true, statementTimeoutMs = null } = {}) {
  const r = await storeAnswer(async (c) => {
    if (_probeRows && _probeRows.asOf === await townIndexAsOf(c)) return _probeRows;
    return probeRows(c, { letters, logins });
  }, { env, statementTimeoutMs }).catch(() => ({ refused: UNREACHABLE }));
  if (!r.refused) { _probeRows = r.out; holdStoreProbe(probeOver(_probeRows)); }
  return !r.refused;
}

/** The store's as-of (town_meta `as_of`) the held probe was read at, or null before the first load. */
export const storeProbeAsOf = () => _probeRows?.asOf ?? null;

/**
 * The held probe with one resident's mail_state row read now, for the reply
 * hint a send draws. Throws when the store cannot answer; the send has already
 * gone by then, so its caller says nothing rather than refuse a sent letter.
 * `standing` is the sender's own standing letters (a key that holds the
 * sender only), rooted here so the hint reads them as replies (POS-375).
 */
export async function probeWithMailState(handle, { env = process.env, standing = null } = {}) {
  if (!_probeRows) throw new TownIndexUnreachable();
  const r = await storeAnswer(async (c) => ({
    json: (await c.query("SELECT json FROM town_mail_state WHERE handle = $1", [handle])).rows[0]?.json ?? null,
    standing: await standingRoots(c, standing),
  }), { env });
  if (r.refused) throw new TownIndexUnreachable();
  return probeOver(_probeRows, { mail: new Map([[handle, r.out.json]]), standing: new Map([[handle, r.out.standing]]) });
}

/** Test seam: forget the roster memo (a suite that rewrites rows under one head). */
export function __resetRosterForTest() { _roster = { asOf: undefined, entries: null }; }
/** Test seam: forget the held probe (a suite whose stores share one head, the fixture's). */
export function __resetProbeForTest() { _probeRows = null; holdStoreProbe(null); }

/** The roll, admission grammar applied, each caller its own copies. */
export async function residentList(q) {
  return (await roster(q)).filter((e) => isResidentHandle(e.handle)).map((e) => ({ ...e }));
}

/** The roster page over residentList (the page shape is queries.mjs § residentPageOf). */
export async function residentPage(q, opts = {}) {
  return residentPageOf(await residentList(q), opts);
}

/** The index meta the town card reads, from the store's own town_meta. */
async function storeMeta(q) {
  return Object.fromEntries((await q.query("SELECT key, value FROM town_meta")).rows.map((r) => [r.key, r.value]));
}

/** The town card (queries.mjs § townSummaryOf): the store's own meta, never a caller's. */
export async function townSummary(q) {
  const all = (await roster(q)).filter((e) => e.is_office).map((e) => e.handle).sort();
  return townSummaryOf(await storeMeta(q), all, (await residentList(q)).length);
}

/** A resident's stored card, parsed, or null. */
async function card(q, handle) {
  const row = (await q.query("SELECT json FROM town_residents WHERE handle = $1", [handle])).rows[0];
  return row ? JSON.parse(row.json) : null;
}

/** The freshness context for a row the STORE answered: dated by the store's head (home's rule). */
async function storeFresh(q, handle, fresh) {
  return freshnessFor(handle, { ...fresh, asOf: await townIndexAsOf(q) });
}

/** The composed address card (queries.mjs § residentOf), or null. */
export async function resident(q, handle, fresh = null) {
  const d = await card(q, handle);
  if (!d) return null;
  const ctx = await storeFresh(q, handle, fresh);
  const pages = {};
  for (const box of ["inbox", "outbox"]) pages[box] = await mailPage(q, handle, box, { limit: CARD_MAIL });
  return residentOf(d, pages, handle, ctx);
}

/** A resident's window read (queries.mjs § windowReadOf), or null. */
export async function windowRead(q, handle, fresh = null) {
  const d = await card(q, handle);
  if (!d) return null;
  return windowReadOf(d.window_state ?? null, handle, await storeFresh(q, handle, fresh));
}

/** The public-service-announcements fold over the PSA posting (queries.mjs § psaFoldOf). */
export async function psaFold(q, opts = {}) {
  const row = (await q.query("SELECT json FROM town_bulletin WHERE slug = $1", [PSA_SLUG])).rows[0];
  return psaFoldOf(row?.json ?? null, opts);
}

// ── the household read v2's deep reads (POS-633 part 2) ──────────────────────

/** How many rows a deep read takes from the store at most, whatever the window. */
export const DEEP_ROWS = 500;
/** How far back read: "closer" scans for letters to several (no index reaches a letter's toList), whatever `days` asks. */
export const MULTI_DAYS = 14;

/**
 * The house's own acts, newest first: every act the record files under the
 * house's key (`hh:<slug>`, acts_household_idx). After `afterId` (the
 * cursor's high-water mark) when one is given, else since `sinceIso`. Also
 * answers the store's act high-water mark, for the next cursor.
 */
export async function houseActs(q, household, { afterId = null, sinceIso = null, beforeId = null, limit = DEEP_ROWS, actors = null } = {}) {
  const n = Math.min(Math.max(Number(limit) || DEEP_ROWS, 1), DEEP_ROWS);
  const hw = (await q.query("SELECT max(id)::text AS hw FROM acts")).rows[0]?.hw ?? null;
  const id = (v) => (v != null && /^\d+$/.test(String(v)) ? String(v) : null);
  // A TIME WINDOW BECOMES AN ID WINDOW FIRST (review of #678, item 1): acts are indexed (household, id) and not by
  // `at`, so `at >= since` alone walked the house's whole history. The window's first id is found by point lookups
  // on the primary key (actsIdSince), and the read is an index range from there; `at >= since` still filters it.
  const after = id(afterId);
  const from = after ? null : sinceIso ? await actsIdSince(q, sinceIso) : null;
  const before = id(beforeId);
  // `actors`: the residents the key holds and the house's own human hand (review of #679, item 7)
  const who = Array.isArray(actors) ? actors.map(String) : null;
  const params = [household];
  const where = ["household = $1"];
  const add = (sql, v) => { params.push(v); where.push(sql.replace("$?", `$${params.length}`)); };
  if (after) add("id > $?::bigint", after);
  if (from) add("id >= $?::bigint", from);
  if (sinceIso && !after) add("at >= $?::timestamptz", sinceIso);
  if (before) add("id < $?::bigint", before);
  if (who) add("actor = ANY($?::text[])", who);
  // 079's columns, when the store has them (POS-633 part 3): the recorded hand, for and route
  const { actsHaveProvenance } = await import("./act-provenance.mjs");
  const recorded = (await actsHaveProvenance(q)) ? ", hand, for_handle, route" : "";
  const rows = (await q.query(`SELECT id::text AS id, at, actor, action, object, at_anchor, payload->>'as_human' AS as_human${recorded}
      FROM acts WHERE ${where.join(" AND ")} ORDER BY acts.id DESC LIMIT ${n + 1}`, params)).rows;
  const kept = rows.slice(0, n);
  // past the cut, the read goes on below the last id it kept (review of #678, item 4)
  return { hw, rows: kept, cut: rows.length > n, ...(rows.length > n ? { next_before: kept.at(-1)?.id ?? null } : {}) };
}

/**
 * The first act id at or after `sinceIso`, by a binary search of point lookups on the primary key (about 15 for
 * 21,000 acts), the way stampLinesSince finds its first seq. Acts are appended in time, so their `at` rises with
 * their id; the few that arrive late (a pen that files a crossing's act after the fact) can sit a little out of
 * order, and the caller filters `at >= since` again over the range, so the bound only narrows the read. Null when
 * the record holds no act.
 */
export async function actsIdSince(q, sinceIso) {
  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) return null;
  const ends = (await q.query("SELECT min(id)::text AS lo, max(id)::text AS hi FROM acts")).rows[0];
  if (!ends?.lo) return null;
  let lo = BigInt(ends.lo), hi = BigInt(ends.hi) + 1n;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const r = (await q.query("SELECT id::text AS id, at FROM acts WHERE id >= $1::bigint ORDER BY acts.id LIMIT 1", [String(mid)])).rows[0];
    if (!r || new Date(r.at).getTime() >= since) hi = mid;
    else lo = BigInt(r.id) + 1n;
  }
  return String(lo);
}

/**
 * The letters between `handles` and anyone, DELIVERED (a letter that never
 * arrived is no correspondence), written since `sinceDay`. The indexes
 * (to_h, date) and (from_h, date) serve it: one range per side.
 *
 * `multi: true` adds the letters where one of `handles` was among several
 * recipients but not the first. No index reaches into a letter's toList, so
 * that query scans the table, filtering by `date` before it opens any letter's
 * json; an index on `date` would be a migration, named here and not added.
 * read: "closer" asks for it; the glance does not.
 */
export async function lettersAround(q, handles, sinceDay, { multi = false, multiSinceDay = sinceDay } = {}) {
  const cols = `id, from_h, to_h, date, delivered_at, CASE WHEN strpos(json, '"toList"') > 0 THEN json ELSE NULL END AS multi`;
  const list = [...handles];
  const byIndex = (await q.query(`SELECT ${cols} FROM town_letters WHERE from_h = ANY($1::text[]) AND date >= $2 AND delivered_at IS NOT NULL
    UNION SELECT ${cols} FROM town_letters WHERE to_h = ANY($1::text[]) AND date >= $2 AND delivered_at IS NOT NULL`, [list, sinceDay])).rows;
  if (!multi) return byIndex;
  const seen = new Set(byIndex.map((r) => r.id));
  // the scan's window is its own (review of #678, item 3): read: "closer" caps it at MULTI_DAYS whatever `days` asks
  const many = (await q.query(`SELECT ${cols} FROM town_letters
     WHERE date >= $1 AND delivered_at IS NOT NULL AND strpos(json, '"toList"') > 0`, [multiSinceDay > sinceDay ? multiSinceDay : sinceDay])).rows;
  return [...byIndex, ...many.filter((r) => !seen.has(r.id))];
}

/**
 * The stamp ledger's lines written since `sinceIso`, newest first (stamp_lines,
 * 066). stamp_lines has no index on written_at, and its seq is the ledger's
 * append order, so the window's first seq is found by a binary search of point
 * lookups on the primary key (about 15 for 23,000 lines), and the read is the
 * seq range from there. Never a walk of the whole ledger.
 */
export async function stampLinesSince(q, sinceIso, { limit = 5000, beforeSeq = null } = {}) {
  const cap = Math.max(1, Math.min(Number(limit) || 5000, 20000));
  const top = Number((await q.query("SELECT max(seq) AS s FROM stamp_lines")).rows[0]?.s ?? 0);
  if (!top) return { rows: [], cut: false };
  const since = Date.parse(sinceIso);
  const at = async (seq) => {
    const r = (await q.query("SELECT written_at FROM stamp_lines WHERE seq = $1", [seq])).rows[0];
    return r ? new Date(r.written_at).getTime() : null;
  };
  // the first seq written at or after `since`: [lo, hi], seq 1..top
  let lo = 1, hi = top + 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const t = await at(mid);
    if (t == null || t >= since) hi = mid; else lo = mid + 1;
  }
  // past the cut, the read goes on below the last seq it kept (review of #678, item 4)
  const below = beforeSeq != null && /^\d+$/.test(String(beforeSeq)) ? Number(beforeSeq) : null;
  const rows = (await q.query(`SELECT seq, canonical, written_at FROM stamp_lines WHERE seq >= $1${below ? " AND seq < $2" : ""} ORDER BY seq DESC LIMIT ${cap + 1}`, below ? [lo, below] : [lo])).rows
    .filter((r) => new Date(r.written_at).getTime() >= since);
  const kept = rows.slice(0, cap);
  return { rows: kept, cut: rows.length > cap, ...(rows.length > cap ? { next_before: String(kept.at(-1)?.seq ?? "") } : {}) };
}

/**
 * The household glance's mail window (POS-633; Darko 2026-10-20): letters
 * delivered to `handles` since `sinceDay`, and every letter the house wrote
 * since then (delivered or not: an answer counts the day it is written). Both
 * halves ride the (to_h, date) and (from_h, date) indexes.
 */
export async function mailWindow(q, handles, house, sinceDay) {
  const cols = "id, from_h, to_h, thread, date, delivered_at";
  return (await q.query(`SELECT ${cols} FROM town_letters WHERE to_h = ANY($1::text[]) AND date >= $3 AND delivered_at IS NOT NULL
    UNION SELECT ${cols} FROM town_letters WHERE from_h = ANY($2::text[]) AND date >= $3`, [[...handles], [...house], sinceDay])).rows;
}

/** One resident's own segments, at the house read's bounds (composed by house-bundle.mjs § residentSegmentsOf). */
export async function residentSegments(q, handle, fresh, standing = null) {
  const { residentSegmentsOf, DOORSTEP_INBOX: HOUSE_INBOX } = await import("./house-bundle.mjs");
  const one = (sql, params) => count(q, sql, params);
  return residentSegmentsOf({
    mail: await mailList(q, handle, "inbox", { limit: HOUSE_INBOX }),
    awaiting: await mailAwaiting(q, handle, { offset: 0, standing }),
    stamps: await stampsDetail(q, handle),
    window: await windowRead(q, handle, fresh),
    pendingOutbox: await outboxSettled(q, handle),
    counts: {
      received: await one("SELECT COUNT(*) AS n FROM town_ledger WHERE kind = 'delivery' AND to_h = $1", [handle]),
      sent: await one("SELECT COUNT(*) AS n FROM town_ledger WHERE kind = 'delivery' AND from_h = $1", [handle]),
    },
  }, handle);
}

/** Is there a resident row for this handle? (house-bundle's ashore test) */
export async function hasResident(q, handle) {
  return (await q.query("SELECT 1 FROM town_residents WHERE handle = $1", [handle])).rows.length > 0;
}

/** The ferry's delivery rows to `handle`, newest first (the ledger's own order), each with the letter's `delivered_at` where the index has it. */
export async function deliveredTo(q, handle) {
  return (await q.query(`SELECT d.id, d.from_h AS "from", d.date, l.delivered_at
       FROM town_ledger d LEFT JOIN town_letters l ON l.id = d.id
      WHERE d.kind = 'delivery' AND d.to_h = $1
      ORDER BY d.seq DESC`, [handle])).rows;
}

/**
 * The doorstep: every segment read here by its own reader and composed by
 * queries.mjs § doorstepOf. The bundle's `as_of` is the STORE's head,
 * whatever the caller passes: the segments came from this index.
 */
export async function doorstep(q, handle, _asOf, opts = {}) {
  // `nowMs` is injected only so the PSA window is testable against a fixed day —
  // the doorstep is a page generated fresh each morning, so its default clock is
  // the wall clock, exactly as "the last week" reads.
  // `fresh` rides through to the window segment for one reason and it is a hard
  // one: the bundle falsifier dispatches every segment's `serves` pointer through
  // the real apex and deep-equals the answer. A window composed at
  // `household read: "window"` and not composed here would fail that test — which
  // is the falsifier doing exactly its job, and the reason to thread the context
  // rather than to compose at the doors.
  // `slim` is the CONNECTOR SKIN's bound and only mcp.mjs passes it — see
  // queries.mjs's bounds note above DOORSTEP_INBOX_SLIM, and its slimAwaiting,
  // slimPsa and slimStamps helpers.
  const { nowMs = Date.now(), conversationsOffset = 0, fresh = null, slim = false, standing = null } = opts;
  if (!(await hasResident(q, handle))) return null;
  const asOf = await townIndexAsOf(q);
  const offset = Math.max(wholeNumber(conversationsOffset) || 0, 0);
  const one = (sql, params = []) => count(q, sql, params);
  const parts = {
    arrivals: (await roster(q)).map((e) => ({ handle: e.handle, joined: e.joined, is_office: e.is_office })),
    awaiting: await mailAwaiting(q, handle, { offset, standing }),
    mail: await mailList(q, handle, "inbox", { limit: slim ? DOORSTEP_SIZES.inboxSlim : DOORSTEP_SIZES.inbox }),
    stamps: await stampsDetail(q, handle),
    bulletin: await bulletinTeaser(q, { limit: DOORSTEP_SIZES.bulletin }),
    pulse: await metricsMail(q, { days: DOORSTEP_SIZES.pulseDays }),
    window: await windowRead(q, handle, fresh),
    psa: await psaFold(q, { now: nowMs }),
    pendingOutbox: await outboxSettled(q, handle),
    counts: {
      received: await one("SELECT COUNT(*) AS n FROM town_ledger WHERE kind = 'delivery' AND to_h = $1", [handle]),
      sent: await one("SELECT COUNT(*) AS n FROM town_ledger WHERE kind = 'delivery' AND from_h = $1", [handle]),
    },
    town: {
      residents: await one("SELECT COUNT(*) AS n FROM town_residents"),
      deliveries: await one("SELECT COUNT(*) AS n FROM town_ledger WHERE kind = 'delivery'"),
      lastDelivery: (await q.query(`SELECT MAX(date COLLATE "C") AS d FROM town_ledger WHERE kind = 'delivery'`)).rows[0]?.d ?? null,
    },
  };
  return doorstepOf(parts, handle, asOf, opts);
}

/** The filtered letter list, newest first, paged (page shape: queries.mjs § letterListPage). */
export async function letterList(q, opts = {}) {
  const limit = Math.min(Math.max(wholeNumber(opts.limit) || 50, 1), letterPageCap(opts));
  const offset = Math.max(wholeNumber(opts.offset) || 0, 0);
  const asOf = await townIndexAsOf(q);
  const where = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (opts.ids?.length) where.push(`id = ANY(${p(opts.ids)}::text[])`);
  if (opts.resident) { const r = p(opts.resident); where.push(`(from_h = ${r} OR to_h = ${r})`); }
  if (opts.region) {
    const handles = await regionResidents(q, opts.region);
    if (!handles.length) return letterListNoRegion({ limit, offset, asOf, region: opts.region });
    const h = p(handles);
    where.push(`(from_h = ANY(${h}::text[]) OR to_h = ANY(${h}::text[]))`);
  }
  if (opts.since) where.push(`date COLLATE "C" >= ${p(opts.since)}`);
  if (opts.until) where.push(`date COLLATE "C" <= ${p(opts.until)}`);
  if (opts.excludeOffice) {
    const off = await officeHandles(q);
    if (off.length) { const o = p(off); where.push(`NOT (from_h = ANY(${o}::text[])) AND NOT (to_h = ANY(${o}::text[]))`); }
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const fixed = params.slice();
  const rows = (await q.query(`SELECT ${LETTER_COLS} FROM town_letters ${clause} ORDER BY ${NEWEST} LIMIT ${p(limit)} OFFSET ${p(offset)}`, params)).rows;
  const total = await count(q, `SELECT COUNT(*) AS n FROM town_letters ${clause}`, fixed);
  return letterListPage({ total, rows, limit, offset, full: opts.full, digests: opts.digests, asOf });
}

/** A handle's correspondents (queries.mjs § correspondentsOf) over every letter's row. */
export async function mailCorrespondents(q, handle, opts = {}) {
  // `multi` is the letter's json only where a toList may stand in it (the
  // `strpos` test below); the list's answer does not depend on the test
  // (a json without a toList array keeps the column's own recipient either way).
  const rows = (await q.query(`SELECT id, from_h, to_h, date, delivered_at,
      CASE WHEN strpos(json, '"toList"') > 0 THEN json ELSE NULL END AS multi
    FROM town_letters`)).rows;
  return correspondentsOf(rows, handle, opts);
}

/** The newest day the mail ledger holds (bytewise, as sqlite's MAX over text), or null. */
async function ledgerNewest(q) {
  return (await q.query(`SELECT MAX(date COLLATE "C") AS d FROM town_ledger WHERE date IS NOT NULL`)).rows[0]?.d ?? null;
}

// How far up a thread chain the root walk goes before it calls the chain bent.
const THREAD_WALK_MAX = 500;

/**
 * The conversation a letter's thread chain ends at, as the town's law roots it
 * (tools/mail-state.mjs § rootOf): follow `thread` while it names a letter; the
 * last letter is the root, or, when the last `thread` names no letter, that
 * name is (the law's broken edge). null when the chain does not end inside the
 * walk (a cycle), which the caller leaves alone rather than guessing a root.
 */
async function threadRoot(q, id) {
  const last = (await q.query(`WITH RECURSIVE up(id, thread, n) AS (
      SELECT id, thread, 0 FROM town_letters WHERE id = $1
      UNION ALL
      SELECT l.id, l.thread, up.n + 1 FROM town_letters l JOIN up ON l.id = up.thread WHERE up.n < $2)
    SELECT id, thread, n FROM up ORDER BY n DESC LIMIT 1`, [id, THREAD_WALK_MAX])).rows[0];
  if (!last) return id;
  if (Number(last.n) >= THREAD_WALK_MAX) return null;
  return last.thread && last.thread !== "new" ? last.thread : last.id;
}

/**
 * The awaiting view (queries.mjs § mailAwaitingOf). `opts.standing` is the sender's own
 * standing letters (town-mail.mjs § hotMailBlock's `standing`), passed only on
 * a read by a key that holds `handle`: each is given its conversation root here
 * and the view reads them as the law reads a queued reply (queries.mjs § A
 * WRITTEN REPLY IS A QUEUED REPLY, POS-375).
 */
export async function mailAwaiting(q, handle, opts = {}) {
  const row = (await q.query("SELECT json FROM town_mail_state WHERE handle = $1", [handle])).rows[0];
  // a bent law (json that does not parse) is no law: null
  let law = null;
  try { law = row ? JSON.parse(row.json) : null; } catch { law = null; }
  const standing = law ? await standingRoots(q, opts.standing) : [];
  return mailAwaitingOf(law, await ledgerNewest(q), handle, { ...opts, standing });
}

/** The sender's standing letters (hotMailBlock's `standing`), each with the conversation root its thread chain ends at. */
async function standingRoots(q, standing) {
  const mine = new Map((standing ?? []).filter((s) => s?.letter_id).map((s) => [s.letter_id, s]));
  const roots = new Map();
  // A reply to your own standing reply (#446 review, finding 3): the letter it
  // names is a log row, not in town_letters, so it roots through that letter,
  // as the law roots an outbox letter through another. A loop among them roots
  // nowhere (null), as threadRoot leaves a cycle.
  const rootOf = async (s, seen = new Set()) => {
    if (roots.has(s.letter_id)) return roots.get(s.letter_id);
    const thread = s.thread && s.thread !== "new" ? s.thread : null;
    let root;
    if (!thread) root = s.letter_id;
    else if (mine.has(thread)) root = seen.has(thread) ? null : await rootOf(mine.get(thread), seen.add(s.letter_id));
    else root = await threadRoot(q, thread);
    roots.set(s.letter_id, root);
    return root;
  };
  const out = [];
  for (const s of mine.values()) {
    const thread = s.thread && s.thread !== "new" ? s.thread : null;
    out.push({ letter_id: s.letter_id, thread, root: await rootOf(s) });
  }
  return out;
}

// sqlite's LIKE with no ESCAPE clause: ASCII case folded, no escape character
const like = (col, param) => likeAscii(col, param, "");

/** Search over letters and residents (page shape: queries.mjs § searchPage). */
export async function search(q, term, { limit, offset } = {}) {
  const pattern = `%${term}%`;
  const n = Math.min(Math.max(wholeNumber(limit) || SEARCH_LETTERS, 1), 200);
  const start = Math.max(wholeNumber(offset) || 0, 0);
  const lettersTotal = await count(q, `SELECT COUNT(*) AS n FROM town_letters WHERE ${like("id", "$1")} OR ${like("json", "$1")}`, [pattern]);
  const residentsTotal = await count(q, `SELECT COUNT(*) AS n FROM town_residents WHERE ${like("handle", "$1")} OR ${like("json", "$1")}`, [pattern]);
  const residents = (await q.query(`SELECT handle FROM town_residents
      WHERE ${like("handle", "$1")} OR ${like("json", "$1")}
      ORDER BY CASE
        WHEN handle = $2        THEN 0
        WHEN ${like("handle", "$3")} THEN 1
        WHEN ${like("handle", "$1")} THEN 2
        ELSE 3 END, handle COLLATE "C"
      LIMIT $4`, [pattern, term, `${term}%`, SEARCH_RESIDENTS])).rows.map((r) => r.handle);
  const letters = (await q.query(`SELECT ${LETTER_COLS} FROM town_letters WHERE ${like("id", "$1")} OR ${like("json", "$1")} ORDER BY ${NEWEST} LIMIT $2 OFFSET $3`,
    [pattern, n, start])).rows.map(excerpt);
  return searchPage({ q: term, n, start, lettersTotal, residentsTotal, residents, letters });
}

// ── DISCOVERY (POS-497, slice one) ───────────────────────────────────────────
//
// Two bounded walks over 087's tables, each ONE statement, so the generation it
// is tagged with and the rows it read come from one snapshot (`BEGIN READ ONLY`
// is READ COMMITTED: two statements could see two ingests). Each step of a walk
// is one index seek that reads one row, and the walk stops at its bound, so a
// page's work does not grow with the record: no count, no sort, no json read.
//
//   text     walks the pieces in (author, kind, source, ordinal) order, C
//            collation. An author is emitted once, at their first piece that
//            holds the literal, and the next seek jumps past the rest of their
//            pieces; an author not on the roll is jumped past the same way, and
//            a source kind the ask did not select by its group. `past` names
//            which jump the row took, and the cursor carries it.
//   common   walks the distinct recipients the first person writes to, C order,
//            one seek each, so a run of a million letters to one resident is one
//            step. Each is a hit when it is on the roll and the second person
//            writes to it too (one probe each).

const foldSql = (expr) => `translate(${expr}, '${UPPER}', '${LOWER}')`;
const WALK_KEY = `t.author COLLATE "C", t.source_kind COLLATE "C", t.source_id COLLATE "C", t.ordinal`;
const DISCOVERY_GEN = `SELECT (SELECT value FROM town_meta WHERE key = 'discovery_epoch') AS epoch,
    (SELECT value FROM town_meta WHERE key = 'discovery_revision') AS revision`;

const TEXT_WALK = `WITH RECURSIVE
  gen AS (${DISCOVERY_GEN}),
  walk AS (
    SELECT 0 AS step, NULL::text AS author, NULL::text AS source_kind, NULL::text AS source_id, NULL::integer AS ordinal,
           NULL::text AS piece, NULL::boolean AS eligible, false AS emitted, NULL::text AS past, 0 AS hits,
           $3::text AS nb_author, $4::text AS nb_kind, $5::text AS nb_source, $6::integer AS nb_ordinal
    UNION ALL
    SELECT w.step + 1, n.author, n.source_kind, n.source_id, n.ordinal, n.piece, e.eligible, h.hit,
           CASE WHEN h.hit OR NOT e.eligible THEN 'author' WHEN NOT s.selected THEN 'kind' ELSE 'row' END,
           w.hits + h.hit::int,
           n.author,
           CASE WHEN h.hit OR NOT e.eligible THEN $9::text ELSE n.source_kind END,
           CASE WHEN h.hit OR NOT e.eligible OR NOT s.selected THEN $9::text ELSE n.source_id END,
           CASE WHEN h.hit OR NOT e.eligible OR NOT s.selected THEN 2147483647 ELSE n.ordinal END
      FROM walk w
      CROSS JOIN LATERAL (
        SELECT t.author, t.source_kind, t.source_id, t.ordinal, t.piece FROM town_discovery_chunks t
         WHERE (${WALK_KEY}) > (w.nb_author, w.nb_kind, w.nb_source, w.nb_ordinal)
         ORDER BY ${WALK_KEY} LIMIT 1) n
      CROSS JOIN LATERAL (SELECT CASE WHEN w.step > 0 AND n.author = w.author THEN w.eligible
        ELSE EXISTS (SELECT 1 FROM town_residents r WHERE r.handle = n.author) END AS eligible) e
      CROSS JOIN LATERAL (SELECT n.source_kind = ANY($2::text[]) AS selected) s
      CROSS JOIN LATERAL (SELECT e.eligible AND s.selected AND strpos(${foldSql("n.piece")}, ${foldSql("$1::text")}) > 0 AS hit) h
     WHERE w.step < $7 AND w.hits < $8
  )
  SELECT g.epoch, g.revision, w.step, w.author, w.source_kind, w.source_id, w.ordinal, w.emitted, w.past,
         CASE WHEN w.emitted THEN w.piece END AS piece,
         (SELECT EXISTS (SELECT 1 FROM town_discovery_chunks t WHERE (${WALK_KEY}) > (l.nb_author, l.nb_kind, l.nb_source, l.nb_ordinal))
            FROM (SELECT * FROM walk ORDER BY step DESC LIMIT 1) l) AS more
    FROM gen g LEFT JOIN walk w ON w.step > 0
   ORDER BY w.step`;

const COMMON_WALK = `WITH RECURSIVE
  gen AS (${DISCOVERY_GEN}),
  people AS (SELECT EXISTS (SELECT 1 FROM town_residents WHERE handle = $1::text) AS a,
                    EXISTS (SELECT 1 FROM town_residents WHERE handle = $2::text) AS b),
  walk AS (
    SELECT 0 AS step, $3::text AS recipient, false AS emitted, 0 AS hits
    UNION ALL
    SELECT w.step + 1, n.recipient, c.common, w.hits + c.common::int
      FROM walk w
      CROSS JOIN LATERAL (
        SELECT e.recipient FROM town_letter_edges e
         WHERE e.sender COLLATE "C" = $1::text AND e.recipient COLLATE "C" > w.recipient
         ORDER BY e.sender COLLATE "C", e.recipient COLLATE "C" LIMIT 1) n
      CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM town_residents r WHERE r.handle = n.recipient)
        AND EXISTS (SELECT 1 FROM town_letter_edges b WHERE b.sender COLLATE "C" = $2::text AND b.recipient COLLATE "C" = n.recipient) AS common) c
     WHERE w.step < $4 AND w.hits < $5
  )
  SELECT g.epoch, g.revision, p.a, p.b, w.step, w.recipient, w.emitted,
         (SELECT EXISTS (SELECT 1 FROM town_letter_edges e WHERE e.sender COLLATE "C" = $1::text AND e.recipient COLLATE "C" > l.recipient)
            FROM (SELECT recipient FROM walk ORDER BY step DESC LIMIT 1) l) AS more
    FROM gen g CROSS JOIN people p LEFT JOIN walk w ON w.step > 0
   ORDER BY w.step`;

/** One page's walk, from `at` (null: the start): its generation, its rows in step order, and whether the record goes on past them. */
async function discoveryWalk(q, ask, at) {
  const L = DISCOVERY_LIMITS;
  if (ask.mode === "text") {
    const { rows } = await q.query(TEXT_WALK, [ask.q, ask.kinds, ...textBoundOf(at), L.pieces_per_page, ask.limit, PAST_EVERY_KEY]);
    return { generation: generationOf(rows[0]?.epoch, rows[0]?.revision), more: rows[0]?.more === true,
      rows: rows.filter((r) => r.step != null).map(({ author, source_kind, source_id, ordinal, emitted, past, piece }) => ({ author, source_kind, source_id, ordinal, emitted, past, piece })) };
  }
  const { rows } = await q.query(COMMON_WALK, [ask.people[0], ask.people[1], at ? at[0] : "", L.candidates_per_page, ask.limit]);
  return { generation: generationOf(rows[0]?.epoch, rows[0]?.revision), more: rows[0]?.more === true,
    missing: ask.people.filter((_, i) => rows[0]?.[i === 0 ? "a" : "b"] !== true),
    rows: rows.filter((r) => r.step != null).map(({ recipient, emitted }) => ({ recipient, emitted })) };
}

/**
 * town { read: "discover" } (MCP `discover_town`): one bounded page, or the
 * door's refusal. A cursor from another generation is an explicit reset: the
 * page starts the walk again and says so (`reset`), never a page stitched
 * across two records.
 */
export async function discover(q, args = {}) {
  const v = discoveryAsk(args);
  if (v.bounce) return v.bounce;
  const { ask } = v;
  const c = readCursor(ask);
  if (c.bounce) return c.bounce;
  if (!(await discoveryTablesIn(q))) return NOT_INSTALLED;
  let walked = await discoveryWalk(q, ask, c.at);
  if (walked.generation == null) return NOT_BUILT;
  if (walked.missing?.length) return noResident(walked.missing[0]);
  let reset = null;
  if (c.generation && c.generation !== walked.generation) {
    walked = await discoveryWalk(q, ask, null);
    if (walked.generation == null) return NOT_BUILT;
    if (walked.missing?.length) return noResident(walked.missing[0]);
    reset = resetNote(c.generation, walked.generation);
  }
  return discoveryPage(ask, { ...walked, reset, start: reset ? null : c.at });
}

/** The mail pulse from the ledger, letters and threads (queries.mjs § metricsMailOf). */
export async function metricsMail(q, opts = {}) {
  const newest = await ledgerNewest(q);
  const dayCounts = (await q.query("SELECT date, kind, COUNT(*) AS n FROM town_ledger WHERE date IS NOT NULL GROUP BY date, kind")).rows
    .map((r) => ({ date: r.date, kind: r.kind, n: Number(r.n) }));
  const totals = {
    deliveries: await count(q, "SELECT COUNT(*) AS n FROM town_ledger WHERE kind = 'delivery'"),
    bounces: await count(q, "SELECT COUNT(*) AS n FROM town_ledger WHERE kind = 'bounce'"),
    letters: await count(q, "SELECT COUNT(*) AS n FROM town_letters"),
    threads: await count(q, "SELECT COUNT(*) AS n FROM town_threads"),
    residents: await count(q, "SELECT COUNT(*) AS n FROM town_residents"),
  };
  const threadJsons = newest ? (await q.query("SELECT json FROM town_threads")).rows.map((t) => t.json) : [];
  return metricsMailOf({ newest, dayCounts, totals, threadJsons: () => threadJsons }, opts);
}

/**
 * A resident's home page, or null. The freshness ladder (paper-fresh.mjs §
 * composeHome) composes over the row, and its `asOf` is the STORE's head, never
 * a caller's.
 * The ladder asks "has the pen written this since the index this row came
 * from", and the row came from the store; a caller's own as-of would date a
 * store row by some other index's clock. (`fresh.asOf` is ignored here for that
 * reason.) `fresh` is paper-fresh's `freshFor` context, pending rows already
 * read, as the door hands it over.
 */
export async function home(q, handle, fresh = null) {
  const row = (await q.query("SELECT json FROM town_homes WHERE handle = $1", [handle])).rows[0];
  if (!row) {
    // A page founded since this index was built (POS-603, paper-fresh.mjs §
    // composeFoundedHome): only for a resident the store's index holds, and only
    // with a checkout. An unreachable store throws from these queries, as before.
    if (!fresh?.clone || !(await hasResident(q, handle))) return null;
    return composeFoundedHome(handle, freshnessFor(handle, { ...fresh, asOf: await townIndexAsOf(q) }));
  }
  const asOf = await townIndexAsOf(q);
  // One resident's home: description body, region, image paths (repo-relative).
  // `region` is deliberately NOT composed (composeHome leaves it as stored).
  // Placement is the atlas ledger's — a social act in the town, never a door
  // parameter (edit.mjs § the home founds UNPLACED) — so no paper act can move
  // it and there is no pen for it to be ahead of. Composing it would invent a
  // tense for a field that has none.
  return composeHome(JSON.parse(row.json), freshnessFor(handle, { ...fresh, asOf }));
}

/**
 * Run one store reader in the pen's READ ONLY transaction, with the index's
 * as-of from the same snapshot. A caller that cannot reach the store gets the
 * pen's own error, which its door turns into the 503.
 */
export async function readTownIndex(fn, { env = process.env, statementTimeoutMs = null } = {}) {
  const read = async (client) => ({ out: await fn(client), asOf: await townIndexAsOf(client) });
  const { officeRead } = await import("./world2-pen.mjs");
  // the test seam's pool takes the pen's own shape, its one-connection-per-chain
  // guard included, so a suite on it sees what the office would
  if (_indexPoolForTest) return officeRead(read, { pool: _indexPoolForTest, by: "readTownIndex", statementTimeoutMs });
  return officeRead(read, { env, statementTimeoutMs });
}

// TEST SEAM: the town index's own pool. A suite that stubs the record's pen (a
// JS stand-in for the acts tables, test/acts-pen-stub.mjs) still reads its town
// index from a real Postgres through this; the office never sets it, and with
// it unset every read goes through the pen exactly as above.
let _indexPoolForTest = null;
export function __setTownIndexPoolForTest(pool) { _indexPoolForTest = pool; }

/** The refusal a door gives when the store cannot answer. Fixed words, never the driver's message. */
export const UNREACHABLE = Object.freeze({ error: "bounce", defect: UNREACHABLE_DEFECT, hint: UNREACHABLE_HINT });

/**
 * A door's answer: `{ out, asOf }` from the store, or `{ refused }`
 * (UNREACHABLE) when it cannot be read. Doors turn the refusal into their 503.
 */
export async function storeAnswer(fn, { env = process.env, then = null, statementTimeoutMs = null } = {}) {
  // Only a store that cannot be reached is the refusal. An error the reader
  // itself throws (a clone with no quest tools, say) is that reader's own, and
  // goes to the door's own catch, not to the refusal: calling
  // it "the store cannot be reached" would name the wrong thing.
  let own = null, r;
  try { r = await readTownIndex(async (c) => { try { return await fn(c); } catch (e) { own = e; throw e; } }, { env, statementTimeoutMs }); }
  catch (e) { if (own && e === own) throw e; return { refused: UNREACHABLE }; }
  // THE REST OF THE ANSWER, AFTER THE CONNECTION IS BACK (POS-370). `then` is
  // whatever the read needs that is not the index (the quest board's quest tools
  // and its world read): it runs here, holding nothing, and its errors are the
  // reader's own, never the store's absence.
  return then ? { ...r, out: await then(r.out) } : r;
}
