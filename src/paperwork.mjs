// paperwork.mjs — the office's paperwork, one door: sign-in, roles, the media
// ledger and the town log (POS-271, w41 "retire sqlite", Keemin 2026-09-29).
//
// Until this file, `odb` (oauth.db) and `rdb` (roles.db) were node:sqlite
// handles, and a dozen modules called `.prepare(sql).get()` on them directly.
// Now every one of those modules asks a PAPER: an object with four async verbs
// (`get`, `all`, `run`, `append`) and a transaction (`tx`). A paper answers
// from one of two places:
//
//   THE FILE   (the default, and every office before the switch) — the same
//              node:sqlite handle, the same SQL, the same rows. Nothing moves.
//
//   THE STORE  (OFFICE_PAPERWORK_STORE=1, THE SWITCH) — Postgres, the tables
//              031 and 032 create, as office_api. Reads come from the store.
//              Writes go to the store FIRST and are awaited; a store that
//              refuses is a refusal, never a quiet fall back to the file.
//
// ── COPY, THEN SWITCH; THE FILES ARE GONE ───────────────────────────────────
//
// world2/tools/paperwork-import.mjs copied the files into the store and
// committed only when every row was equal; the flag then switched reads. Until
// the switch's clean week closed, every write that committed on the store was
// also written to the file (the rollback's mirror, Wright 2026-09-30), so the
// flag off was a lossless rollback. That mirror, and oauth.db and roles.db on
// the box, are DELETED in the same change (POS-271): a switched paper holds no
// file and writes only the store. There is no rollback to the files after it.
// The file road below is the unswitched office's (a suite, a dev office), and
// a switched office never opens either file.
//
// ── ONE SPELLING OF THE SQL ─────────────────────────────────────────────────
//
// The callers keep writing the file's SQL: bare table names and `?` marks.
// `toStoreSql` renames the eleven tables to their store names and numbers the
// marks, and that is the whole dialect gap for the statements the office runs
// (read off oauth.mjs, roles.mjs, media.mjs and town-journal.mjs). Two
// statements that were SQLite-only (`INSERT OR REPLACE INTO meta`) are now
// written as the upsert both engines speak. A statement the rename cannot carry
// is a bug in that statement; test/paperwork.test.mjs holds each one.
//
// ── NUMBERS ─────────────────────────────────────────────────────────────────
//
// node-postgres hands int8 back as a STRING. node:sqlite handed these columns
// back as numbers, and the callers compare them (`row.expires < now()`) and
// pass them on (`ghId` reaches roles and `householdFor`'s `rec.id === ghId`).
// So this pool parses int8 to a Number: every int8 here is an epoch second (or,
// on the media ledger, millisecond), a GitHub id, a byte count or a seq, all far inside 2^53. A SUM comes back as
// numeric, and its one caller (media.mjs § mediaQuota) says Number() itself.

import { DatabaseSync } from "node:sqlite";

// THIS MODULE IMPORTS NOTHING BUT NODE BUILTINS (and pg, lazily), ON PURPOSE:
// roles.mjs reaches the store through it, and the registry's boundary is that
// it has no edge into world code (test/roles.test.mjs § THE BOUNDARY). So the
// store's two switches are read here in world2-acts.mjs § world2Enabled's own
// words rather than imported from it — one line of env, not a domain rule.
const storeConfigured = (env) => env.WORLD2_PG === "1" && !!env.WORLD2_PG_URL;

/** The switch. Off, every paper answers from its file, exactly as before. */
export const paperworkStoreOn = (env = process.env) => env.OFFICE_PAPERWORK_STORE === "1";

/** File table -> store table (031, 032). Exported for the import and the suite. */
export const STORE_TABLES = Object.freeze({
  clients: "oauth_clients", pending: "oauth_pending", codes: "oauth_codes", tokens: "oauth_tokens",
  berths: "oauth_berths", key_claims: "oauth_key_claims",
  roles: "office_roles", role_audit: "office_role_audit",
  media: "office_media", town_journal: "office_town_journal", meta: "office_meta",
});
const TABLE_RE = new RegExp(`\\b(${Object.keys(STORE_TABLES).join("|")})\\b`, "g");

/** The file's statement, as the store takes it: tables renamed, `?` numbered. */
export function toStoreSql(sql) {
  let n = 0;
  return sql.replace(TABLE_RE, (t) => STORE_TABLES[t]).replace(/\?/g, () => `$${++n}`);
}

const INT8 = 20;
const storeTypes = (pg) => ({
  getTypeParser: (oid, format) => (oid === INT8 ? (v) => (v == null ? null : Number(v)) : pg.types.getTypeParser(oid, format)),
});

// ── the file ────────────────────────────────────────────────────────────────

function fileVerbs(db) {
  return {
    async get(sql, ...args) { return db.prepare(sql).get(...args); },
    async all(sql, ...args) { return db.prepare(sql).all(...args); },
    async run(sql, ...args) { const i = db.prepare(sql).run(...args); return { changes: Number(i.changes) }; },
    async append(sql, args) { return Number(db.prepare(sql).run(...args).lastInsertRowid); },
  };
}

// ── the paper ───────────────────────────────────────────────────────────────

class Paper {
  constructor({ file = null, pool = null, readOnly = false }) {
    this.file = file;
    this.pool = pool;
    this.readOnly = readOnly;
  }

  get onStore() { return this.pool != null; }

  #refuseWrite() { if (this.readOnly) throw new Error("paperwork: this handle is read-only (a read worker holds no pen)"); }


  async get(sql, ...args) {
    if (!this.onStore) return this.file.prepare(sql).get(...args);
    return (await this.pool.query(toStoreSql(sql), args)).rows[0];
  }

  async all(sql, ...args) {
    if (!this.onStore) return this.file.prepare(sql).all(...args);
    return (await this.pool.query(toStoreSql(sql), args)).rows;
  }

  async run(sql, ...args) {
    this.#refuseWrite();
    if (!this.onStore) return fileVerbs(this.file).run(sql, ...args);
    const r = await this.pool.query(toStoreSql(sql), args);
    return { changes: r.rowCount ?? 0 };
  }

  /** An INSERT into a table with an identity column; answers the new id. */
  async append(sql, args, idCol) {
    this.#refuseWrite();
    if (!this.onStore) return fileVerbs(this.file).append(sql, args);
    return Number((await this.pool.query(`${toStoreSql(sql)} RETURNING ${idCol}`, args)).rows[0][idCol]);
  }

  /**
   * `fn(t)` in one transaction, `t` carrying the same four verbs. On the file
   * it is BEGIN/COMMIT on the handle, as roles.mjs always did. On the store it
   * is one client.
   */
  async tx(fn) {
    this.#refuseWrite();
    if (!this.onStore) {
      this.file.exec("BEGIN");
      try { const out = await fn(fileVerbs(this.file)); this.file.exec("COMMIT"); return out; }
      catch (e) { try { this.file.exec("ROLLBACK"); } catch { /* already gone */ } throw e; }
    }
    const client = await this.pool.connect();
    const t = {
      get: async (sql, ...args) => (await client.query(toStoreSql(sql), args)).rows[0],
      all: async (sql, ...args) => (await client.query(toStoreSql(sql), args)).rows,
      run: async (sql, ...args) => ({ changes: (await client.query(toStoreSql(sql), args)).rowCount ?? 0 }),
      append: async (sql, args, idCol) => Number((await client.query(`${toStoreSql(sql)} RETURNING ${idCol}`, args)).rows[0][idCol]),
    };
    // A ROLLBACK that fails may leave the connection inside the transaction; it
    // is discarded, never handed to the next caller (POS-370, the pen's rule).
    let discard = false;
    // A STORE THAT GOES AWAY MID-TRANSACTION (POS-480). pg-pool listens for a
    // client's 'error' only while it is idle. A checked-out client whose server
    // ends the session between two statements emits 'error' with no listener,
    // an uncaught exception that takes the whole office down (measured: a fast
    // shutdown right after the token rotation's DELETE). Heard here, the next
    // statement carries the failure to the caller, the transaction is rolled
    // back by the server, and the client is discarded.
    const lost = () => { discard = true; };
    client.on("error", lost);
    try {
      await client.query("BEGIN");
      const out = await fn(t);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch { discard = true; }
      throw e;
    } finally { client.removeListener("error", lost); client.release(discard ? true : undefined); }
  }

  /** The file's own DDL, on the file only. The store's shape is 031/032's. */
  exec(ddl) { if (this.file && !this.readOnly) this.file.exec(ddl); }

  close() { try { this.file?.close(); } catch { /* read-only or already closed */ } }
}

// A node:sqlite handle a caller (a suite, a tool) still hands in is a paper on
// its file. One wrapper per handle, so a module that asks twice gets one paper.
const wrapped = new WeakMap();

/** Anything paper-shaped -> a Paper. null stays null. */
export function asPaper(h) {
  if (h == null || h instanceof Paper) return h ?? null;
  if (typeof h.prepare !== "function") throw new Error("paperwork: not a paper and not a sqlite handle");
  let p = wrapped.get(h);
  if (!p) { p = new Paper({ file: h }); wrapped.set(h, p); }
  return p;
}

/**
 * The office's paper for one file. `schema(db)` builds the file's own tables
 * (the writer owns them) and runs only when the file is opened for writing.
 *
 * Switched, the paper is the store's and `path` is never opened: the files
 * were deleted with the mirror (POS-271), so nothing here may create one.
 */
export async function openPaper(path, { readOnly = false, schema = null, env = process.env, pool = null } = {}) {
  if (!paperworkStoreOn(env)) {
    const db = readOnly ? new DatabaseSync(path, { readOnly: true }) : new DatabaseSync(path);
    if (!readOnly && schema) schema(db);
    return new Paper({ file: db, readOnly });
  }
  return new Paper({ pool: pool ?? await storePool(env), readOnly });
}

const pools = new Map(); // url -> pool: every paper in a process shares one
async function storePool(env) {
  if (!storeConfigured(env))
    throw new Error("OFFICE_PAPERWORK_STORE=1 needs the store (WORLD2_PG=1 and WORLD2_PG_URL): a switched office with no store could sign nobody in");
  const url = env.WORLD2_PG_URL;
  if (!pools.has(url)) {
    const { default: pg } = await import("pg");
    // POS-370: the acquire timeout and the server's idle-transaction limit, as every office pool
    const { storePoolOptions } = await import("./store-pool.mjs");
    const pool = new pg.Pool(storePoolOptions(env, { name: "paperwork", max: 4, connectionString: url, types: storeTypes(pg) }));
    pool.on("error", (e) => console.error(`[paperwork] idle store client: ${e.message}`));
    pools.set(url, pool);
  }
  return pools.get(url);
}

/** Close every store pool this process opened (a tool's exit, a suite's end). */
export async function closePaperworkPools() {
  const all = [...pools.values()];
  pools.clear();
  await Promise.all(all.map((p) => p.end().catch(() => {})));
}

/** A store paper on a pool the caller owns — the suite's seam, and the proof's. */
export function paperOnPool(pool, { file = null, readOnly = false } = {}) {
  return new Paper({ file, pool, readOnly });
}

/** The int8-as-Number types for a pool a caller builds (the suite, the proof). */
export const paperworkPoolTypes = storeTypes;
