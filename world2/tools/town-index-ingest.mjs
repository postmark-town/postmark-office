#!/usr/bin/env node
// town-index-ingest.mjs — the `law_ingester` pen, the town's third projection:
// office.db's tables, kept in the store (POS-268; 033_town_index.sql).
//
// ── THE LAW THIS IMPLEMENTS (Keemin 2026-09-27, POS-277) ─────────────────────
//
//   "let's aim to have essentially everything snapshotted per
//    settlement/clearing, and only live compute the delta between settlement
//    snapshots."
//
// The town's clearing is the CROSSING, closed by the Postmark Pen's
// `seal: re-seal at the crossing` commit (00:0x and 12:0x UTC). So:
//
//   --seed        once, at install: the whole derivation (the one history walk
//                 there will ever be), every table written in one transaction,
//                 recorded as the `seed` snapshot.
//   (default)     the commits since the head only. Tables are re-derived where
//                 that is cheap, and only for the touched keys where it is not;
//                 every row whose digest did not move is left alone. Appends only
//                 to the history and the mail ledger. The stamp folds are added,
//                 not refolded.
//   --snapshot    the checkout stands on a crossing's seal: after the delta,
//                 record it in `town_index_snapshots` with each table's count and
//                 digest.
//   --seals-to R  print the seal commits between the head and R, oldest first:
//                 the steps a runner checks out and ingests with --snapshot
//                 before it ingests R itself.
//
// ── THE STATELESS CONTRACT (law-ingest's and stamp-ingest's) ─────────────────
//
// The caller supplies the checkout; this tool never creates, fetches, moves or
// cleans one. It reads git (rev-parse, log, diff, show), never writes it.
//
// ── ONE DERIVATION ───────────────────────────────────────────────────────────
//
// Every row comes from src/town-index.mjs, the same code hydrate.mjs writes
// office.db from. This file decides only WHICH rows to re-derive and which to
// write.
//
// ── USAGE ────────────────────────────────────────────────────────────────────
//
//   PGHOST=… PGDATABASE=world2_dev PGUSER=law_ingester PGPASSWORD=… \
//     node world2/tools/town-index-ingest.mjs --town-repo <checkout> --sha <sha> [--seed] [--snapshot] [--json]
//   node world2/tools/town-index-ingest.mjs --town-repo <checkout> --seals-to <ref>

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertSha } from "./law-ingest.mjs";
import { readTown, parseLedger } from "../../vendor/tools/lib/town.mjs";
import {
  TOWN_TABLES, deriveTownIndex, readHistory, residentRows, letterRows, threadRows, bulletinRows, townDocsValue,
  ledgerLines, mailStateRows, stampFold, stampTipOf, fundingRows, questRows, atlasRows,
} from "../../src/town-index.mjs";
import { isResidentHandle } from "../../src/residency.mjs";
import { writeMintInputs, keyBaseVia, takesKeyBase } from "../../src/mint-inputs.mjs";
import { stampLinesOn, welcomeLinesVia } from "../../src/stamp-lines.mjs";
import { CROSSING_SEAL_SUBJECT } from "../../src/crossings.mjs";

export const HEAD_KEY = "town-index";                     // projection_heads.repo
// The crossing's seal, spelled once in src/crossings.mjs: the doorstep names the
// crossing its copy holds by the same subject this ingest snapshots at (POS-332).
export const SEAL_SUBJECT = CROSSING_SEAL_SUBJECT;
const CHUNK = 500;
const quiet = { log() {}, warn() {} };

const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const tableOf = (name) => `town_${name}`;
const hasDigest = (name) => name !== "repo_log";
export const digestOf = (row) => createHash("md5").update(JSON.stringify(row)).digest("hex");

/** A row's key, as one string, from the table's own key (or seq) columns. */
function keyOf(name) {
  const { cols, key, seq } = TOWN_TABLES[name];
  const at = (seq ? ["seq"] : key).map((k) => cols.indexOf(k));
  return (row) => JSON.stringify(at.map((i) => row[i]));
}
const keyCols = (name) => (TOWN_TABLES[name].seq ? ["seq"] : TOWN_TABLES[name].key);

// ── reading the store ────────────────────────────────────────────────────────

export async function readHead(client) {
  const r = await client.query("SELECT sha FROM projection_heads WHERE repo = $1", [HEAD_KEY]);
  return r.rows[0]?.sha ?? null;
}

/** key -> digest for a table, or (one-column keys) for the given key values only. */
async function storedDigests(client, name, only = null) {
  const cols = keyCols(name);
  if (only && cols.length !== 1) throw new Error(`storedDigests: ${name} has a composite key`);
  const r = only
    ? await client.query(`SELECT ${cols[0]}, digest FROM ${tableOf(name)} WHERE ${cols[0]} = ANY($1::text[])`, [[...only]])
    : await client.query(`SELECT ${cols.join(", ")}, digest FROM ${tableOf(name)}`);
  const out = new Map();
  for (const row of r.rows) out.set(JSON.stringify(cols.map((c) => row[c])), row.digest);
  return out;
}

// ── writing the store ────────────────────────────────────────────────────────

/**
 * repo_log's rows with `n`, each file's place in its own commit. A commit's
 * rows arrive contiguous (git log's name-status block), so the count restarts at
 * each new sha; the store keeps the order sqlite gave by rowid.
 */
function withOrdinal(rows) {
  let sha = null, n = 0;
  return rows.map((r) => { if (r[0] !== sha) { sha = r[0]; n = 0; } return [...r, ++n]; });
}

async function insertRows(client, name, rowsIn, tally) {
  if (!rowsIn.length) return;
  const rows = name === "repo_log" ? withOrdinal(rowsIn) : rowsIn;
  const cols = [...TOWN_TABLES[name].cols, ...(hasDigest(name) ? ["digest"] : []), ...(name === "repo_log" ? ["n"] : [])];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params = [];
    const tuples = chunk.map((row) => {
      const vals = hasDigest(name) ? [...row, digestOf(row)] : row;
      return `(${vals.map((v) => { params.push(v); return `$${params.length}`; }).join(", ")})`;
    });
    await client.query(`INSERT INTO ${tableOf(name)} (${cols.join(", ")}) VALUES ${tuples.join(", ")}`, params);
  }
  tally[name] ??= { inserted: 0, deleted: 0 };
  tally[name].inserted += rowsIn.length;
}

async function deleteKeys(client, name, keys, tally) {
  if (!keys.length) return;
  const cols = keyCols(name);
  const parsed = keys.map((k) => JSON.parse(k));
  for (let i = 0; i < parsed.length; i += CHUNK) {
    const chunk = parsed.slice(i, i + CHUNK);
    const arrays = cols.map((_, j) => chunk.map((k) => k[j]));
    const types = cols.map((c) => (c === "seq" ? "integer[]" : "text[]"));
    const r = await client.query(
      `DELETE FROM ${tableOf(name)} WHERE (${cols.join(", ")}) IN (SELECT * FROM unnest(${arrays.map((_, j) => `$${j + 1}::${types[j]}`).join(", ")}))`,
      arrays);
    tally[name] ??= { inserted: 0, deleted: 0 };
    tally[name].deleted += r.rowCount;
  }
}

/**
 * Write the difference between the candidate rows and the stored ones. With
 * `scope` (a Set of key strings), only those keys are in play: a stored key in
 * scope with no candidate is deleted, and nothing outside scope is read as gone.
 * Answers the keys whose row changed or went (the delta's "touched" set).
 */
async function diffTable(client, name, candidates, tally, { scope = null, stored = null } = {}) {
  const key = keyOf(name);
  stored ??= await storedDigests(client, name);
  const want = new Map(candidates.map((r) => [key(r), r]));
  const gone = [], put = [];
  for (const [k, d] of stored) {
    if (scope && !scope.has(k)) continue;
    const c = want.get(k);
    if (!c) gone.push(k);
    else if (digestOf(c) !== d) { gone.push(k); put.push(c); }
  }
  for (const [k, c] of want) if (!stored.has(k)) put.push(c);
  await deleteKeys(client, name, gone, tally);
  await insertRows(client, name, put, tally);
  tally[name] ??= { inserted: 0, deleted: 0 };
  return new Set([...gone, ...put.map(key)]);
}

async function setHead(client, sha) {
  await client.query(
    `INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ($1, $2, now())
     ON CONFLICT (repo) DO UPDATE SET sha = EXCLUDED.sha, ingested_at = EXCLUDED.ingested_at`, [HEAD_KEY, sha]);
}

/** Each table's row count and content digest, computed in the store. */
export async function tableFingerprints(client) {
  const counts = {}, digests = {};
  for (const name of Object.keys(TOWN_TABLES)) {
    const t = tableOf(name);
    const q = hasDigest(name)
      ? `SELECT count(*)::int n, md5(coalesce(string_agg(digest, '' ORDER BY ${keyCols(name).map((c) => (c === "seq" ? c : `${c} COLLATE "C"`)).join(", ")}), '')) d FROM ${t}`
      : `SELECT count(*)::int n, md5(coalesce(string_agg(sha || op || coalesce(path, ''), '|' ORDER BY sha COLLATE "C", path COLLATE "C", op COLLATE "C"), '')) d FROM ${t}`;
    const r = (await client.query(q)).rows[0];
    counts[name] = r.n; digests[name] = r.d;
  }
  return { counts, digests };
}

/**
 * The snapshot row: each table's count and digest, and at a crossing the seal's
 * `audit` (POS-523) beside the digests, so the record keeps what the deltas
 * missed (the state file holds it only until the next run): `digests.audit` =
 * { letters, threads, ledger, mail_lines }. No migration: digests is jsonb.
 */
async function recordSnapshot(client, repo, sha, kind, audit = null) {
  const { counts, digests: tables } = await tableFingerprints(client);
  const digests = audit ? { ...tables, audit } : tables;
  const crossedAt = kind === "crossing" ? git(repo, "log", "-1", "--format=%cI", sha).trim() : null;
  await client.query(
    `INSERT INTO town_index_snapshots (sha, kind, crossed_at, counts, digests) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (sha) DO NOTHING`, [sha, kind, crossedAt, JSON.stringify(counts), JSON.stringify(digests)]);
  return counts;
}

// ── the mint's inputs (067, POS-341) ─────────────────────────────────────────

/**
 * town_rooms and town_mail_lines, written in the index's own transaction from
 * the same checkout (src/mint-inputs.mjs § writeMintInputs). `whole` replaces
 * both, as the seed replaces every table. A store without 067 is skipped and
 * logged, so the index never stops on a migration not yet applied; the mint
 * runner refuses on its own when the tables are absent. `appended` is the
 * delta's proven ledger append (writeLedger), the raw lines cut from it; with
 * `audit` the whole check runs after, and its count comes back (POS-523).
 */
async function mintInputs(client, townRepo, tally, { whole = false, appended = null, audit = false } = {}) {
  const has = (await client.query("SELECT to_regclass('town_rooms') AS r, to_regclass('town_mail_lines') AS m")).rows[0];
  if (!has.r || !has.m) { console.error("[town-index] 067_town_mint_inputs.sql is not applied: the mint's rooms and mail lines were not written"); return; }
  let deleted = { rooms: 0, mail_lines: 0 };
  if (whole) {
    deleted.rooms = (await client.query("DELETE FROM town_rooms")).rowCount;
    deleted.mail_lines = (await client.query("DELETE FROM town_mail_lines")).rowCount;
  }
  const w = await writeMintInputs(client, townRepo, { appended });
  tally.rooms = { inserted: w.rooms.inserted, deleted: w.rooms.deleted + deleted.rooms };
  tally.mail_lines = { inserted: w.mail_lines.inserted, deleted: deleted.mail_lines };
  if (!audit) return null;
  const missed = (await writeMintInputs(client, townRepo)).mail_lines.inserted;
  tally.mail_lines.inserted += missed;
  return missed;
}

/**
 * The key base the quest rows fold on (POS-341 part 4). With STAMP_LINES=store
 * (the switch the mint runner honours; the timer's unit reads it from
 * /etc/postmark-office.env, deploy/town-index-ingest.sh), the store's:
 * keyBaseVia over household_pins, town_rooms and stamp_lines, an empty one a
 * refusal by name. Unset, null: the town reads its printouts, as before. A town
 * checkout whose engine cannot take a base is a refusal too, as the welcome
 * pass and the snapshot runner refuse it (Wright's review of #435): with the
 * switch on, a quest fold on the printouts would be the store not read.
 */
async function questKeyBase(client, townRepo) {
  if (!stampLinesOn(process.env)) return null;
  const engine = await import(pathToFileURL(resolve(townRepo, "tools", "stamp-mint.mjs")));
  if (!takesKeyBase(engine, townRepo))
    throw new Error("STAMP_LINES=store, but this town checkout's engine takes no key base (town #3540): nothing was written");
  return keyBaseVia(client, engine);
}

/**
 * The store's welcome rows, which date the welcome quest row (POS-495). Read on
 * EVERY ingest, behind no switch: the date is the store's line whatever
 * STAMP_LINES says, and who counts as welcomed stays the town's fold. The read
 * sits in a savepoint because the ingest is one transaction: a failed read must
 * leave the rows undated, never abort the ingest. Null on any failure.
 */
async function questWelcomeLines(client, log) {
  await client.query("SAVEPOINT welcome_lines");
  try {
    const lines = await welcomeLinesVia(client);
    await client.query("RELEASE SAVEPOINT welcome_lines");
    return lines;
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT welcome_lines");
    log.warn(`  quests: the store's welcome lines could not be read (${e?.message ?? e}); the welcome row stays undated`);
    return null;
  }
}

// ── the seed ─────────────────────────────────────────────────────────────────

/** The whole derivation, every table replaced, the seed snapshot. The one history walk. */
export async function seed(client, { townRepo, sha, log = quiet }) {
  const tally = {};
  const ms = {};
  let t0 = Date.now();
  // The mint inputs first: with STAMP_LINES=store the seed's quest rows fold on
  // the store's key base too (POS-341 part 4), which reads this sha's rooms.
  await mintInputs(client, townRepo, tally, { whole: true });
  const base = await questKeyBase(client, townRepo);
  const welcomeLines = await questWelcomeLines(client, log);
  const { tables } = await deriveTownIndex(townRepo, { log, base, welcomeLines });
  ms.derive = Date.now() - t0; t0 = Date.now();
  for (const name of Object.keys(TOWN_TABLES)) {
    const r = await client.query(`DELETE FROM ${tableOf(name)}`);
    tally[name] = { inserted: 0, deleted: r.rowCount };
    await insertRows(client, name, tables[name], tally);
  }
  ms.write = Date.now() - t0; t0 = Date.now();
  const counts = await recordSnapshot(client, townRepo, sha, "seed");
  ms.snapshot = Date.now() - t0;
  await setHead(client, sha);
  return { mode: "seed", head: null, sha, tally, counts, ms };
}

// ── the delta ────────────────────────────────────────────────────────────────

const partiesOfLetter = (json) => {
  try { const l = JSON.parse(json); return [l.from, l.to, ...(l.toList ?? [])].filter(Boolean); }
  catch { return []; }
};
const participantsOf = (json) => { try { return JSON.parse(json).participants ?? []; } catch { return []; } };

/** Rows of a table for the given keys, as the store holds them. */
async function storedRows(client, name, keys, cols) {
  if (!keys.length) return [];
  const kc = keyCols(name);
  if (kc.length !== 1) throw new Error(`storedRows: ${name} has a composite key`);
  const r = await client.query(`SELECT ${cols.join(", ")} FROM ${tableOf(name)} WHERE ${kc[0]} = ANY($1::text[])`, [keys.map((k) => JSON.parse(k)[0])]);
  return r.rows;
}

// ── only the delta (POS-523) ─────────────────────────────────────────────────
//
// "Snapshot per settlement, compute only the delta" (ruled 09-27, POS-277). The
// letters, the threads and both mail-ledger tables are derived from what the
// commits head..sha changed, never from the whole record; the seal's --snapshot
// run then carries the whole derivation of those four as its audit, writes what
// the deltas missed, and reports how many rows that was (`audit`).
//
// What is still whole on a delta, and said so (Wright's ruling on POS-523, Part
// A): readTown reads the tree, because mail_state (the town's own law walks every
// letter per handle), the residents, the quests, the atlas and meta's counts all
// read the whole parsed town. The stamps fold and the rooms are whole too.

const LETTER_PATH = /^(WHITE_PAGES\/[^/]+\/(?:inbox|outbox)\/)([^/]+)(\/.*)?$/;

/**
 * The letter file a changed path belongs to, as the reader names it: a lone
 * file is itself, and anything inside a folder letter (its letter.md or an
 * attachment, which the letter's row lists) is that folder's letter.md.
 */
export function letterPathOf(path) {
  const m = LETTER_PATH.exec(path);
  if (!m) return null;
  return m[3] ? `${m[1]}${m[2]}/letter.md` : `${m[1]}${m[2]}`;
}

/**
 * The letters a delta re-derives, and only those. The ids in play are the
 * stored rows at a changed letter path and the reader's letters at one; the
 * candidates are the READER'S winning copies of those ids, so the inbox copy
 * still beats the outbox and a surviving duplicate still stands when the
 * winning copy goes. delivered_at as ever: the store's value for that path
 * wins, else the delta's first add. `ids` null is the whole table (the audit).
 */
async function writeLetters(client, town, history, tally, ids = null) {
  const key = keyOf("letters");
  const pick = ids ? town.letters.filter((l) => ids.has(l.id)) : town.letters;
  const heldAt = new Map((ids
    ? await client.query("SELECT path, delivered_at FROM town_letters WHERE path = ANY($1::text[])", [pick.map((l) => l.path).filter(Boolean)])
    : await client.query("SELECT path, delivered_at FROM town_letters WHERE path IS NOT NULL")).rows
    .filter((r) => r.delivered_at).map((r) => [r.path, r.delivered_at]));
  // A path the store never held a row for (a duplicate copy that has just come
  // to win) and the delta never added: its first add is in the store's own
  // history, which the seed walked whole (hydrate's oldest add, by its path index).
  const unheld = pick.map((l) => l.path).filter((p) => p && !heldAt.has(p) && !history.deliveredAt.has(p));
  const firstAdd = new Map(unheld.length ? (await client.query(
    "SELECT path, min(committed_at) AS at FROM town_repo_log WHERE op = 'A' AND path = ANY($1::text[]) GROUP BY path", [unheld])).rows
    .map((r) => [r.path, r.at]) : []);
  const cands = letterRows({ letters: pick }, (p) => heldAt.get(p) ?? history.deliveredAt.get(p) ?? firstAdd.get(p) ?? null);
  const stored = await storedDigests(client, "letters", ids);
  const want = new Map(cands.map((r) => [key(r), r]));
  const touched = [];
  for (const [k, d] of stored) { const c = want.get(k); if (!c || digestOf(c) !== d) touched.push(k); }
  for (const k of want.keys()) if (!stored.has(k)) touched.push(k);
  const oldRows = await storedRows(client, "letters", touched, ["id", "json"]);
  const scope = ids ? new Set([...ids].map((id) => JSON.stringify([id]))) : null;
  await diffTable(client, "letters", cands, tally, { scope, stored });
  return { cands, touched, oldRows, derived: cands.length };
}

/**
 * The threads a delta re-derives: every stored thread holding a letter in play
 * (each stored row's letterIds asked as jsonb, one pass over town_threads per
 * round: there is no reverse index, and the pass is measured on POS-523), and
 * every thread of the reader's holding one of those threads' letters or a
 * letter in play. That closure carries a merge (a parent that arrives) and a
 * split (a bridge that goes). `ids` null is the whole table.
 */
async function writeThreads(client, town, tally, ids = null) {
  const key = keyOf("threads");
  if (!ids) {
    const cands = threadRows(town);
    const stored = await storedDigests(client, "threads");
    const touched = [];
    const want = new Map(cands.map((r) => [key(r), r]));
    for (const [k, d] of stored) { const c = want.get(k); if (!c || digestOf(c) !== d) touched.push(k); }
    for (const k of want.keys()) if (!stored.has(k)) touched.push(k);
    const oldRows = await storedRows(client, "threads", touched, ["root", "json"]);
    await diffTable(client, "threads", cands, tally, { stored });
    return { cands, touched, oldRows, derived: cands.length, scanned: 0 };
  }
  // The closure, to a fixed point: a letter in play reaches its new thread (a
  // reply joins the thread it answers), every letter of that thread reaches the
  // stored thread it sat in, and every letter of that one reaches its new thread
  // (a split's other half), until no letter is added.
  const newOf = new Map();
  for (const t of town.threads) for (const x of t.letterIds ?? []) newOf.set(x, t);
  const members = new Set(ids), asked = new Set(), picked = new Set(), heldBy = new Map();
  let scanMs = 0, queue = [...ids];
  while (queue.length) {
    const grew = [];
    const add = (x) => { if (!members.has(x)) { members.add(x); grew.push(x); } };
    for (const x of queue) {
      const t = newOf.get(x);
      if (t && !picked.has(t)) { picked.add(t); for (const y of t.letterIds) add(y); }
    }
    const ask = [...members].filter((x) => !asked.has(x));
    ask.forEach((x) => asked.add(x));
    if (ask.length) {
      const t0 = Date.now();
      // One pass over the table per round, whatever the number of ids: each
      // row's letterIds read as jsonb and asked `?|` (a LIKE per id was one pass
      // PER id: 1.2 s for a 19-commit delta on the real town, POS-523).
      const rows = (await client.query(
        "SELECT root, json, digest FROM town_threads WHERE (json::jsonb -> 'letterIds') ?| $1::text[]", [ask])).rows;
      scanMs += Date.now() - t0;
      for (const r of rows) {
        if (heldBy.has(r.root)) continue;
        heldBy.set(r.root, r);
        for (const y of JSON.parse(r.json).letterIds ?? []) add(y);
      }
    }
    queue = grew;
  }
  const held = [...heldBy.values()];
  const cands = threadRows({ threads: [...picked] });
  const stored = new Map(held.map((r) => [JSON.stringify([r.root]), r.digest]));
  const want = new Map(cands.map((r) => [key(r), r]));
  const touched = [];
  for (const [k, d] of stored) { const c = want.get(k); if (!c || digestOf(c) !== d) touched.push(k); }
  for (const k of want.keys()) if (!stored.has(k)) touched.push(k);
  const oldRows = held.filter((r) => touched.includes(JSON.stringify([r.root])));
  await diffTable(client, "threads", cands, tally, { scope: new Set(stored.keys()), stored });
  return { cands, touched, oldRows, derived: cands.length, scanned: held.length, scanMs };
}

export const LEDGER_PATH = "WHITE_PAGES/mail-ledger.md";

/**
 * THE APPEND PROOF (POS-523 G2): the mail ledger between head and sha, from
 * git's own blobs. The same blob is no change at all, and nothing is read. Else
 * the old text (CRLF read as LF) must be a prefix of the new one, ending on a
 * line boundary, and the answer is the appended text. Anything else answers
 * null, and the caller takes the whole check, which refuses a changed past by
 * the line (an edit to the ledger's prose, which no entry carries, passes there
 * as it always has). No digest is stored: the head is the store's word that it
 * holds the ledger at head, and the seal's audit checks that word whole.
 */
export function ledgerAppend(townRepo, head, sha, changed = null) {
  // A delta whose diff does not name the ledger read nothing (most do not: the
  // ferry writes it twice a day). Else both blobs, in ONE git process.
  if (changed && !changed.includes(LEDGER_PATH)) return { text: "", bytes: 0 };
  const raw = execFileSync("git", ["-C", townRepo, "cat-file", "--batch"],
    { input: `${head}:${LEDGER_PATH}\n${sha}:${LEDGER_PATH}\n`, maxBuffer: 512 * 1024 * 1024 });
  const blobs = [];
  for (let at = 0; blobs.length < 2;) {
    const eol = raw.indexOf(10, at);
    const [oid, type, size] = raw.subarray(at, eol).toString("utf8").split(" ");
    if (type !== "blob") { blobs.push({ oid: null, text: "" }); at = eol + 1; continue; }   // "<name> missing": no ledger there
    const n = Number(size);
    blobs.push({ oid, text: raw.subarray(eol + 1, eol + 1 + n).toString("utf8").replace(/\r\n/g, "\n") });
    at = eol + 1 + n + 1;
  }
  const [was, now] = blobs;
  if (was.oid === now.oid) return { text: "", bytes: 0 };
  const a = was.text, b = now.text;
  const onBoundary = a === "" || a.endsWith("\n") || b.length === a.length || b[a.length] === "\n";
  if (!b.startsWith(a) || !onBoundary) return null;
  return { text: b.slice(a.length), bytes: a.length + b.length };
}

/** The whole check: every held line against the checkout, then the lines past them. Today's rule, kept for the audit and the fallback. */
async function ledgerWhole(client, town, tally) {
  const lines = ledgerLines(town);
  const held = (await client.query("SELECT count(*)::int n FROM town_ledger")).rows[0].n;
  if (lines.length < held) throw new Error(`the mail ledger shrank (${held} lines held, ${lines.length} now): it is append-only by town law. Nothing was written.`);
  // Every held line is checked, not only the last: an edit to line 1 of 10,000
  // is exactly the change a last-line check cannot see. (seq, digest) pairs only.
  for (const { seq, digest } of (await client.query("SELECT seq, digest FROM town_ledger ORDER BY seq")).rows) {
    if (digest !== digestOf([seq, ...lines[seq - 1]]))
      throw new Error(`the mail ledger's line ${seq} is not the line the index holds: its past changed, and it is append-only by town law. Nothing was written.`);
  }
  const newLines = lines.slice(held).map((l, i) => [held + i + 1, ...l]);
  await insertRows(client, "ledger", newLines, tally);
  return newLines;
}

/**
 * The delta's mail ledger: appended past the held count when the append proof
 * holds and the reader's count agrees with it, else the whole check. Answers
 * the new lines, which proof was taken, and the appended text (the mint's raw
 * lines are cut from the same text, src/mint-inputs.mjs).
 */
async function writeLedger(client, townRepo, town, head, sha, changed, tally) {
  const append = ledgerAppend(townRepo, head, sha, changed);
  const held = (await client.query("SELECT coalesce(max(seq), 0)::int n FROM town_ledger")).rows[0].n;
  if (append && town.ledger.length - held === parseLedger(append.text).length) {
    const newLines = ledgerLines({ ledger: town.ledger.slice(held) }).map((l, i) => [held + i + 1, ...l]);
    await insertRows(client, "ledger", newLines, tally);
    return { newLines, proof: append.text ? "append" : "unchanged", appended: append.text, bytes: append.bytes };
  }
  return { newLines: await ledgerWhole(client, town, tally), proof: "whole", appended: null, bytes: 0 };
}

/**
 * The commits `head..sha`, applied. Every table is written only where its rows
 * moved; the counts of what was written come back in `tally`, per table.
 */
export async function applyDelta(client, { townRepo, head, sha, log = quiet, audit: auditing = false }) {
  const tally = Object.fromEntries(Object.keys(TOWN_TABLES).map((n) => [n, { inserted: 0, deleted: 0 }]));
  if (head === sha && !auditing) return { mode: "delta", head, sha, tally, commits: 0 };
  // Where the time goes, per phase, in the result: the delta's cost is a claim
  // the report makes, so the tool measures it rather than the report guessing.
  const ms = {};
  let t0 = Date.now();
  const lap = (name) => { const t = Date.now(); ms[name] = t - t0; t0 = t; };
  try { git(townRepo, "merge-base", "--is-ancestor", head, sha); }
  catch {
    throw new Error(`the head ${head} is not an ancestor of ${sha}: the town's history was rewritten under the index. ` +
      `Nothing was written. Re-seed (--seed --reseed) once the rewrite is understood.`);
  }
  const commits = Number(git(townRepo, "rev-list", "--count", `${head}..${sha}`).trim());
  // NUL-separated: a path is the resident's to name, a newline included
  const changed = git(townRepo, "diff", "--name-only", "-z", "--no-renames", head, sha).split("\0").filter(Boolean);
  const history = readHistory(townRepo, { range: `${head}..${sha}`, log });
  lap("git");
  const town = readTown(townRepo);
  lap("readTown");

  // history: appended, never re-walked
  await insertRows(client, "repo_log", history.rows, tally);
  lap("repo_log");

  // the mail ledger first (POS-523): its new deliveries place letters in their
  // threads, so their ids are in play below. Append-only; a changed past refuses.
  const ledger = await writeLedger(client, townRepo, town, head, sha, changed, tally);
  const newLines = ledger.newLines;
  lap("ledger");

  // letters: only those at a changed path (writeLetters)
  const letterPaths = new Set(changed.map(letterPathOf).filter(Boolean));
  const letterIds = new Set();
  if (letterPaths.size) {
    for (const r of (await client.query("SELECT id FROM town_letters WHERE path = ANY($1::text[])", [[...letterPaths]])).rows) letterIds.add(r.id);
    for (const l of town.letters) if (l.path && letterPaths.has(l.path)) letterIds.add(l.id);
  }
  const letters = await writeLetters(client, town, history, tally, letterIds);
  lap("letters");

  // threads: the closure of the letters in play and the new deliveries (writeThreads)
  const inPlay = new Set(letterIds);
  for (const l of newLines) if (l[1] === "delivery" && l[3]) inPlay.add(l[3]);
  const threads = await writeThreads(client, town, tally, inPlay);
  lap("threads");

  // the seal's audit (POS-523 G3): the whole derivation of the four, written
  // where the deltas missed a row, and counted. A changed ledger past refuses.
  let audit = null;
  const auditLetters = [], auditThreads = [];
  if (auditing) {
    const al = await writeLetters(client, town, history, tally);
    const at = await writeThreads(client, town, tally);
    const ledgerMissed = await ledgerWhole(client, town, tally);
    newLines.push(...ledgerMissed);
    auditLetters.push(al); auditThreads.push(at);
    audit = { letters: al.touched.length, threads: at.touched.length, ledger: ledgerMissed.length };
    lap("audit");
  }
  const letterSets = [letters, ...auditLetters];
  const threadSets = [threads, ...auditThreads];

  // residents: only the handles whose own pages the delta touched, or whose
  // history moved; a handle whose directory went is deleted.
  const nowHandles = new Set(town.residents.map((r) => r.handle).filter(isResidentHandle));
  const storedResidents = await storedDigests(client, "residents");
  const affected = new Set();
  for (const p of changed) { const m = /^WHITE_PAGES\/([^/]+)\//.exec(p); if (m) affected.add(m[1]); }
  for (const h of history.lastActive.keys()) affected.add(h);
  const scopeResidents = new Set([...affected].map((h) => JSON.stringify([h])));
  for (const k of storedResidents.keys()) if (!nowHandles.has(JSON.parse(k)[0])) scopeResidents.add(k);
  const heldActive = new Map((await storedRows(client, "residents", [...scopeResidents], ["handle", "json"]))
    .map((r) => { try { return [r.handle, JSON.parse(r.json).last_active ?? null]; } catch { return [r.handle, null]; } }));
  const resCands = residentRows(townRepo, town, (h) => history.lastActive.get(h) ?? heldActive.get(h) ?? null,
    { log, only: new Set([...affected].filter((h) => nowHandles.has(h))) });
  await diffTable(client, "residents", resCands, tally, { scope: scopeResidents, stored: storedResidents });
  lap("residents");

  // mail_state: recomputed only for the parties of what moved — every letter
  // that changed (before and after), every thread that changed (before and
  // after), every new ledger line. The town's mailState walks the whole record
  // per resident; this is where the delta earns its keep.
  const parties = new Set();
  const letterKey = keyOf("letters"), threadKey = keyOf("threads");
  for (const s of letterSets) {
    for (const r of s.oldRows) partiesOfLetter(r.json).forEach((h) => parties.add(h));
    const touched = new Set(s.touched);
    for (const r of s.cands) if (touched.has(letterKey(r))) partiesOfLetter(r[8]).forEach((h) => parties.add(h));
  }
  for (const s of threadSets) {
    for (const r of s.oldRows) participantsOf(r.json).forEach((h) => parties.add(h));
    const touched = new Set(s.touched);
    for (const r of s.cands) if (touched.has(threadKey(r))) participantsOf(r[1]).forEach((h) => parties.add(h));
  }
  for (const l of newLines) { const e = JSON.parse(l[6]); for (const h of [e.from, e.to]) if (h) parties.add(h); }
  const townHandles = new Set(town.residents.map((r) => r.handle));
  const storedMail = await storedDigests(client, "mail_state");
  for (const h of townHandles) if (!storedMail.has(JSON.stringify([h]))) parties.add(h);
  const scopeMail = new Set([...parties].map((h) => JSON.stringify([h])));
  for (const k of storedMail.keys()) if (!townHandles.has(JSON.parse(k)[0])) scopeMail.add(k);
  const mailCands = await mailStateRows(townRepo, town, { log, only: new Set([...parties].filter((h) => townHandles.has(h))) });
  if (mailCands) await diffTable(client, "mail_state", mailCands, tally, { scope: scopeMail, stored: storedMail });
  lap("mail_state");

  // stamps: the town's folds are additive (docs/town-index-store.md), so the
  // lines past the head are folded and ADDED to what the store holds. The
  // ledger's past must be the past the head saw.
  const meta = new Map((await client.query("SELECT key, value FROM town_meta")).rows.map((r) => [r.key, r.value]));
  let minted = meta.get("stamps_minted") ?? null;
  let tip = meta.get("stamps_tip") ?? "";
  const hasStamps = existsSync(join(townRepo, "tools", "stamp-mint.mjs")) && existsSync(join(townRepo, "WHITE_PAGES", "stamp-ledger.md"));
  if (hasStamps) {
    const { parseStampLedger } = await import(pathToFileURL(resolve(townRepo, "tools", "stamp-mint.mjs")));
    let before = [];
    try { before = parseStampLedger(git(townRepo, "show", `${head}:WHITE_PAGES/stamp-ledger.md`)); } catch { before = []; }
    const all = parseStampLedger(execFileSync("git", ["-C", townRepo, "show", `${sha}:WHITE_PAGES/stamp-ledger.md`], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }));
    if (JSON.stringify(all.slice(0, before.length)) !== JSON.stringify(before))
      throw new Error("the stamp ledger's past changed since the head: it is append-only by town law. Nothing was written.");
    const d = await stampFold(townRepo, { entries: all.slice(before.length) });
    const rowsHeld = new Map((await client.query("SELECT handle, balance, mint_count, staked FROM town_stamps")).rows
      .map((r) => [r.handle, [r.handle, r.balance, r.mint_count, r.staked]]));
    const accts = new Set([...d.balance.keys(), ...d.mintCount.keys(), ...d.staked.keys()].filter((a) => a !== "MINT" && a !== "BURN"));
    const cands = [...accts].map((a) => {
      const h = rowsHeld.get(a) ?? [a, 0, 0, 0];
      return [a, h[1] + (d.balance.get(a) ?? 0), h[2] + (d.mintCount.get(a) ?? 0), h[3] + (d.staked.get(a) ?? 0)];
    });
    await diffTable(client, "stamps", cands, tally, { scope: new Set([...accts].map((a) => JSON.stringify([a]))) });
    minted = String(Number(minted ?? 0) + -(d.balance.get("MINT") ?? 0));
    tip = stampTipOf(all);
  }
  lap("stamps");

  // the small folds: re-derived whole (each under half a second), written where moved
  const funding = await fundingRows(townRepo, { log });
  for (const name of ["pots", "funding_roll", "funding_holo", "funding_keeping_mint", "pot_receipts", "pot_escrow", "pot_stakers", "funding_invalid"])
    await diffTable(client, name, funding[name], tally);
  lap("funding");
  // The mint inputs before the quests: with STAMP_LINES=store the quests fold
  // on the store's key base (POS-341 part 4), which reads this sha's rooms.
  const mailMissed = await mintInputs(client, townRepo, tally, { appended: ledger.appended, audit: auditing });
  if (audit) audit.mail_lines = mailMissed ?? 0;
  lap("mint inputs");
  const base = await questKeyBase(client, townRepo);
  const welcomeLines = await questWelcomeLines(client, log);
  const q = await questRows(townRepo, town, { log, base, welcomeLines });
  if (q) {
    await diffTable(client, "quest_progress", q.progress, tally);
    if (q.standing) await diffTable(client, "quest_standing", q.standing, tally);
  }
  lap("quests");
  await diffTable(client, "bulletin", bulletinRows(town), tally);
  const atlas = atlasRows(townRepo, town, { log });
  if (atlas) { await diffTable(client, "regions", atlas.regions, tally); await diffTable(client, "homes", atlas.homes, tally); }

  // meta, in hydrate's order
  const metaRows = [
    ["as_of", sha],
    ["town_path", resolve(townRepo)],
    ["hydrated_counts", JSON.stringify({
      residents: town.residents.length, letters: town.letters.length,
      threads: town.threads.length, ledger: town.ledger.length,
      bulletin: (town.bulletin ?? []).length,
    })],
    ["docs", townDocsValue(town, townRepo)], // POS-351, in the seed's position (src/town-index.mjs)
  ];
  if (hasStamps) metaRows.push(["stamps_minted", minted], ["stamps_tip", tip]);
  if (q) metaRows.push(["quest_day", q.questDay], ["quest_registry", q.questRegistry]);
  await diffTable(client, "meta", metaRows, tally);
  lap("bulletin+atlas+meta");

  await setHead(client, sha);
  // what the four scoped phases did, by count: the stable measure of "only the
  // delta" (the ms corroborate it). bytes: the two ledger blobs git read.
  const work = { letter_paths: letterPaths.size, letters: letters.derived, threads: threads.derived,
    threads_scanned: threads.scanned, threads_scan_ms: threads.scanMs, ledger: ledger.proof, ledger_bytes: ledger.bytes };
  return { mode: "delta", head, sha, tally, commits, changed: changed.length, ms, work, ...(audit ? { audit } : {}) };
}

/**
 * One ingest, one transaction, under the pen's advisory lock: seed when asked
 * (or refuse a seed over a head), else the delta; then the snapshot if the
 * checkout stands on a seal.
 */
export async function ingest(client, { townRepo, sha, seed: seeding = false, reseed = false, snapshot = false, log = quiet }) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`town-index-ingest`]);
    const head = await readHead(client);
    let out;
    if (seeding) {
      if (head && !reseed) throw new Error(`the index already has a head (${head}); a seed would replace every row. Pass --reseed to mean it.`);
      out = await seed(client, { townRepo, sha, log });
    } else {
      if (!head) throw new Error("the index has no head yet: seed it first (--seed). A delta needs somewhere to start.");
      out = await applyDelta(client, { townRepo, head, sha, log, audit: snapshot });
      if (snapshot) {
        const subject = git(townRepo, "log", "-1", "--format=%s", sha).trim();
        if (subject !== SEAL_SUBJECT) throw new Error(`--snapshot: ${sha} is not a crossing's seal ("${subject}")`);
        out.counts = await recordSnapshot(client, townRepo, sha, "crossing", out.audit ?? null);
      }
    }
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

/** The crossing seals between `head` and `ref`, oldest first. */
export function sealsBetween(townRepo, head, ref) {
  const out = git(townRepo, "log", "--reverse", "--format=%H%x1f%s", `${head}..${ref}`);
  return out.split("\n").filter(Boolean).map((l) => l.split("\x1f")).filter(([, s]) => s === SEAL_SUBJECT).map(([h]) => h);
}

// ── the CLI ──────────────────────────────────────────────────────────────────

const argOf = (name) => { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1] ?? null; };
const flag = (name) => process.argv.includes(name);

async function main() {
  const townRepo = argOf("--town-repo");
  const declared = argOf("--sha");
  const sealsTo = argOf("--seals-to");
  if (!townRepo || (!declared && !sealsTo)) {
    console.error("usage: town-index-ingest.mjs --town-repo <checkout> (--sha <sha> [--seed [--reseed]] [--snapshot] [--json] | --seals-to <ref>)");
    process.exit(2);
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client();
  await client.connect();
  try {
    if (sealsTo) {
      const head = await readHead(client);
      if (!head) { console.error("the index has no head yet: seed it first"); process.exit(3); }
      for (const s of sealsBetween(townRepo, head, sealsTo)) console.log(s);
      return;
    }
    const sha = assertSha(townRepo, declared);
    const t0 = Date.now();
    const out = await ingest(client, { townRepo, sha, seed: flag("--seed"), reseed: flag("--reseed"), snapshot: flag("--snapshot"), log: console });
    out.total_ms = Date.now() - t0;   // out.ms stays the phases (POS-523: the box's receipts carry them)
    if (flag("--json")) { console.log(JSON.stringify(out, null, 2)); return; }
    const writes = Object.entries(out.tally).filter(([, t]) => t.inserted || t.deleted)
      .map(([n, t]) => `${n} +${t.inserted}/-${t.deleted}`).join(", ") || "nothing";
    console.log(`${out.mode} ${sha.slice(0, 12)}${out.head ? ` from ${out.head.slice(0, 12)} (${out.commits} commits)` : ""} in ${out.total_ms} ms — wrote ${writes}` +
      (out.counts && out.mode !== "seed" ? " · snapshot recorded" : "") +
      (out.audit ? ` · audit ${JSON.stringify(out.audit)}` : "") +
      (out.ms ? ` · ms ${JSON.stringify(out.ms)}` : ""));
  } finally { await client.end(); }
}

// Entry guard: real paths, the junction lesson (stamp-ingest.mjs § entry guard).
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
}
