// stamp-lines.mjs — THE STAMP LEDGER'S CHAIN LIVES IN THE STORE (POS-341, Q1).
//
// Ruled by Darko, 2026-10-04: the signed append-only chain that proves the town's
// economy lives in the store (066, stamp_lines), appended by the pen IN THE SAME
// TRANSACTION as the act that writes it, and the town repo's
// WHITE_PAGES/stamp-ledger.md becomes its signed public export. This file is the
// writer, the reader and the verifier.
//
// ── THE PEN'S TRANSACTION ────────────────────────────────────────────────────
//
// Every ledger line is still signed by the town's own engine (appendSigned, the
// CLIs, the mint runner) into the clone's file under the town lock. What changes
// is the commit: `stampedCommit` opens ONE store transaction, records every line
// the file now holds past the store's last row (each one's seal recomputed and
// its signature verified), then runs the pen's git ceremony inside it. Git
// refuses (a push that can't land, a commit that fails), and the transaction
// rolls back with it: the store never holds a line the export lost. The store
// refuses (a forged or unsigned line, a changed past), and the commit never
// runs. The one window left is a git landing whose COMMIT then fails, which
// leaves the store BEHIND its export; the next stamped write or
// `stamp-lines.mjs --sync` records those lines (the store reads git), and the
// verifier says so until it does.
//
// ── THE SWITCH ───────────────────────────────────────────────────────────────
//
// `STAMP_LINES=store` turns the store write on. Unset, `stampedCommit` is the
// plain pen commit, exactly as before 066, and the rollback is unsetting it.
// Apply 066 before setting it.
//
// ── ONE ROW VOUCHES FOR THE WHOLE PAST ──────────────────────────────────────
//
// A line's signature is over its seal, and a seal is sha256(previous seal +
// canonical) from the town's genesis. So a file whose line N carries the same
// canonical and signature as the store's row N has the same N lines the store
// has, and only the lines after it are new. The verifier still walks the whole
// chain; the writer needs one row.

import { createPublicKey, verify as edVerify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { NOT_LANDED, penCommit } from "./write.mjs";

const LEDGER_REL = join("WHITE_PAGES", "stamp-ledger.md");
const ledgerOf = (clone) => join(clone, LEDGER_REL);
const isLedger = (clone, p) => /(^|[\\/])WHITE_PAGES[\\/]stamp-ledger\.md$/.test(String(p));

/** Is the store write on? Only the exact value `store` turns it on. */
export const stampLinesOn = (env = process.env) => env.STAMP_LINES === "store";

/** The town's engine, from the clone (the one grammar, the one seal). */
export async function engineOf(clone) {
  return import(pathToFileURL(join(clone, "tools", "stamp-mint.mjs")).href);
}

/** The town's public key, from the clone. */
export function pubkeyOf(clone) {
  const p = join(clone, "tools", "stamp-pubkey.pem");
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

const rawOf = (r) => `${r.canonical} · sig: ${r.sig}`;

/** Every row, in ledger order, as parseStampLedger entries: `{ seq, canonical, sig, seal, raw }`. */
export async function stampLinesVia(q) {
  const { rows } = await q.query("SELECT seq, canonical, sig, seal FROM stamp_lines ORDER BY seq");
  return rows.map((r) => ({ ...r, raw: rawOf(r) }));
}

/** The seal a line takes after `prev` (null for the first line), by the town's own construction. */
export function sealAfter(engine, prev, canonical) {
  return prev == null ? engine.sealChain([canonical])[0] : engine.sha256hex(prev + canonical);
}

const sigOk = (key, seal, sig) => {
  try { return edVerify(null, Buffer.from(seal, "utf8"), key, Buffer.from(sig, "base64url")); }
  catch { return false; }
};

/** The store's last row, `{ seq, canonical, sig, seal }` or null: one SQL read. */
export async function stampHeadVia(q) {
  const { rows: [head] } = await q.query("SELECT seq, canonical, sig, seal FROM stamp_lines ORDER BY seq DESC LIMIT 1");
  return head ? { ...head, seq: Number(head.seq) } : null;
}

/**
 * The rows the clone's ledger holds past `head` (the store's last row, or
 * null), each `[seq, canonical, sig, seal]`, with every seal recomputed and
 * every signature verified. PURE CPU over the file: no store, so a caller can
 * do it before it opens a transaction (Wright's review of #415: a write
 * transaction never spans non-SQL work). Throws, naming the line, on: a file
 * shorter than the store, a file whose line at the head is not the head (the
 * past moved), an unsigned line, or a signature that does not verify.
 */
export function stampRowsPast(clone, head, { engine, pubkeyPem = null }) {
  const pem = pubkeyPem ?? pubkeyOf(clone);
  if (!pem) throw new Error("no tools/stamp-pubkey.pem in the clone: a line's signature cannot be checked, so none is recorded");
  const key = createPublicKey(pem);
  const path = ledgerOf(clone);
  const entries = existsSync(path) ? engine.parseStampLedger(readFileSync(path, "utf8")) : [];
  const held = head ? Number(head.seq) : 0;
  if (entries.length < held)
    throw new Error(`the stamp ledger's export holds ${entries.length} lines and the store ${held}: the export lost lines the store recorded. Nothing was written.`);
  if (head) {
    const at = entries[held - 1];
    if (at.canonical !== head.canonical || at.sig !== head.sig)
      throw new Error(`the stamp ledger's line ${held} is not the line the store holds: its past changed, and it is append-only by town law. Nothing was written.`);
  }
  let prev = head?.seal ?? null;
  const fresh = [];
  for (let i = held; i < entries.length; i++) {
    const e = entries[i];
    if (!e.sig) throw new Error(`the stamp ledger's line ${i + 1} is UNSIGNED: the store records only signed lines. Nothing was written.`);
    const seal = sealAfter(engine, prev, e.canonical);
    if (!sigOk(key, seal, e.sig)) throw new Error(`the stamp ledger's line ${i + 1}: its signature does not verify over its seal. Nothing was written.`);
    fresh.push([i + 1, e.canonical, e.sig, seal]);
    prev = seal;
  }
  return fresh;
}

/** The serialising lock every stamp_lines writer takes first, inside its transaction. */
export const lockStampLinesVia = (client) => client.query("SELECT pg_advisory_xact_lock(hashtext('stamp_lines'))");

/** Insert rows `stampRowsPast` computed: SQL only. */
export async function insertStampRowsVia(client, fresh) {
  for (let i = 0; i < fresh.length; i += 1000) {
    const c = fresh.slice(i, i + 1000);
    await client.query(
      `INSERT INTO stamp_lines (seq, canonical, sig, seal)
       SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::text[])`,
      [c.map((r) => r[0]), c.map((r) => r[1]), c.map((r) => r[2]), c.map((r) => r[3])]);
  }
}

/**
 * Record every line the clone's ledger holds past the store's last row, inside
 * the caller's transaction: the lock, the head, `stampRowsPast`, the insert.
 * Refuses, writing nothing, as `stampRowsPast` does. Returns `{ held, inserted }`.
 * The rows are computed INSIDE the transaction here, which is right for the few
 * lines a pen commit carries; a caller with many lines (the mint) computes them
 * first with `stampRowsPast` and only inserts inside.
 */
export async function syncStampLinesVia(client, clone, { engine = null, pubkeyPem = null } = {}) {
  const eng = engine ?? await engineOf(clone);
  await lockStampLinesVia(client);
  const head = await stampHeadVia(client);
  const fresh = stampRowsPast(clone, head, { engine: eng, pubkeyPem });
  await insertStampRowsVia(client, fresh);
  return { held: head ? head.seq : 0, inserted: fresh.length };
}

/**
 * THE VERIFIER: the store's chain on its own (every seal recomputed from the
 * town's genesis, every signature verified), and the export byte for byte (the
 * file's entry lines, each exactly `canonical · sig: sig` of the row at its
 * position, no more and no fewer). `{ ok, problems, held, exported }`.
 */
export async function verifyStampLinesVia(q, clone, { engine = null, pubkeyPem = null } = {}) {
  const eng = engine ?? await engineOf(clone);
  const pem = pubkeyPem ?? pubkeyOf(clone);
  const problems = [];
  const rows = await stampLinesVia(q);
  if (!pem) problems.push("no tools/stamp-pubkey.pem: the store's signatures were not checked");
  const key = pem ? createPublicKey(pem) : null;
  let prev = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (Number(r.seq) !== i + 1) { problems.push(`store: row ${i + 1} carries seq ${r.seq}: the chain has a gap`); break; }
    const seal = sealAfter(eng, prev, r.canonical);
    if (seal !== r.seal) { problems.push(`store: line ${r.seq}'s seal is not the chain's`); break; }
    if (key && !sigOk(key, seal, r.sig)) { problems.push(`store: line ${r.seq}'s signature does not verify`); break; }
    prev = seal;
  }
  const path = ledgerOf(clone);
  const exported = existsSync(path) ? eng.parseStampLedger(readFileSync(path, "utf8")) : [];
  const n = Math.min(rows.length, exported.length);
  for (let i = 0; i < n; i++)
    if (exported[i].raw !== rows[i].raw) { problems.push(`export: line ${i + 1} differs from the store's\n  store : ${rows[i].raw}\n  export: ${exported[i].raw}`); break; }
  if (exported.length > rows.length) problems.push(`export: ${exported.length - rows.length} line(s) past the store's ${rows.length} (the store is behind its export: run stamp-lines.mjs --sync)`);
  if (exported.length < rows.length) problems.push(`export: ${rows.length - exported.length} line(s) the store holds are missing from the export`);
  return { ok: problems.length === 0, problems, held: rows.length, exported: exported.length };
}

/**
 * THE PEN'S COMMIT WHEN IT CARRIES LEDGER LINES. With the switch on and the
 * ledger among `addPaths`: one store transaction records the new lines, then
 * the git ceremony runs inside it, and either both land or neither does (see
 * the header). Otherwise it is `penCommit`. Async: callers await it.
 */
export async function stampedCommit(clone, addPaths, message, { env = process.env, engine = null } = {}) {
  if (!stampLinesOn(env) || !addPaths.some((p) => isLedger(clone, p))) return penCommit(clone, addPaths, message);
  const { officeWrite } = await import("./world2-pen.mjs");
  const eng = engine ?? await engineOf(clone);
  return officeWrite(async (client) => {
    await syncStampLinesVia(client, clone, { engine: eng });
    const commit = penCommit(clone, addPaths, message);
    // A lost race rebases the commit onto the remote: every line it carries is
    // recorded again here (a no-op when the rebase brought none).
    await syncStampLinesVia(client, clone, { engine: eng });
    return commit;
  }, { env });
}

/** landOrRefuse for a stamped commit: a push that cannot land is the exec's answer, not a trip. */
export async function landStamped(clone, addPaths, message, opts = {}) {
  try { return await stampedCommit(clone, addPaths, message, opts); }
  catch (e) {
    if (e?.pen !== NOT_LANDED) throw e;
    return { error: { code: e.code, defect: e.defect, hint: e.hint } };
  }
}

// ── A STAMPED COMMIT PLANNED OUTSIDE THE TRANSACTION (POS-349) ──────────────
//
// A ballot stake writes its vote and records its ledger lines in ONE store
// transaction, and a write transaction never spans non-SQL work (Wright's
// review of #415, after the 30 s idle budget killed the mint pass that held
// one across its verify). So the rows are computed first, with no transaction
// open (`planStampedCommit`: the store's head, one read, then every seal and
// signature over the export past it), and the caller's transaction only
// re-reads the head, inserts and lands (`landPlannedVia`). A head that moved
// in between answers `{ moved: true }` and the caller decides again.

/** The plan, or null with the switch off: `{ head, rows }`. Reads the store once; computes outside any transaction. */
export async function planStampedCommit(clone, { env = process.env, engine = null } = {}) {
  if (!stampLinesOn(env)) return null;
  const { officeRead } = await import("./world2-pen.mjs");
  const eng = engine ?? await engineOf(clone);
  const head = await officeRead((q) => stampHeadVia(q), { env });
  return { head, rows: stampRowsPast(clone, head, { engine: eng }), engine: eng };
}

// The push is the one non-SQL step inside: the store commits only after git
// lands, so a push that cannot land rolls the store back (§ the header). A
// slow network can outlast the store's idle budget, so the landing
// transaction names its own (WORLD2_PG_LAND_TX_MS, as the mint runner does).
const LAND_TX_MS_DEFAULT = 120_000;
const landTxMs = (env) => { const n = Number(env.WORLD2_PG_LAND_TX_MS); return Number.isFinite(n) && n > 0 ? n : LAND_TX_MS_DEFAULT; };

/**
 * Land a planned commit on the CALLER's transaction: the lock, the head
 * re-read (moved: `{ moved: true }`, nothing done), the rows, the push.
 * `{ commit }`, or `{ error }` for a push that cannot land (the caller rolls
 * back). With no plan (the switch off) it is the plain pen commit.
 */
export async function landPlannedVia(client, clone, plan, addPaths, message, { env = process.env } = {}) {
  if (plan) {
    await lockStampLinesVia(client);
    const now = await stampHeadVia(client);
    if ((now?.seq ?? 0) !== (plan.head?.seq ?? 0) || (now?.sig ?? null) !== (plan.head?.sig ?? null)) return { moved: true };
    await insertStampRowsVia(client, plan.rows);
  }
  await client.query("SELECT set_config('idle_in_transaction_session_timeout', $1, true)", [String(landTxMs(env))]);
  const base = gitIn(clone, "rev-parse", "HEAD");
  let commit;
  try { commit = penCommit(clone, addPaths, message); } catch (e) { return notLanded(e); }
  // A lost push race rebases the commit onto the remote's: the lines it brought
  // in are recorded too (none, in the town lock's ordinary case).
  if (plan && commit && gitIn(clone, "rev-parse", `${commit}^`) !== base) await syncStampLinesVia(client, clone, { engine: plan.engine });
  return { commit };
}

const gitIn = (repo, ...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
const notLanded = (e) => {
  if (e?.pen !== NOT_LANDED) throw e;
  return { error: { code: e.code, defect: e.defect, hint: e.hint } };
};
