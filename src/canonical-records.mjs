// canonical-records.mjs — THE CANONICAL RESIDENT AND HUMAN RECORDS: ONE
// TRANSACTION FOR THE RECORD AND ITS RENDER INTENT (POS-721 / POS-583; POS-726 B).
//
// INERT. Nothing in the office imports this file yet: no door, MCP tool, reader,
// selector, import, render or activation calls it. It is the transaction core
// the two writers (`patchCanonicalResident`, `patchCanonicalHuman`) will share
// once a later, separately authorized phase wires them behind their gates, and
// it is proven here on a real store (test/canonical-records-store.test.mjs).
//
// THE RULES IT CARRIES (Rivet's kit marks 2026-11-04, on Darko's POS-845 and
// POS-583 rulings; world2/schema/090_canonical_records.sql has the tables):
//
//   ONE TRANSACTION. The record's change and its intent's journal row are
//   written by the SAME checked-out client, inside `Paper.tx` (paperwork.mjs):
//   any failure rolls back both. The intent is appended with the transaction's
//   own `t.append`, never `appendTownJournal(db, …)`, whose `asPaper` cannot
//   take a transaction's verbs, and never through paperDoor's file-first path.
//   A paper on the FILE cannot share a Postgres transaction with these tables,
//   so it is UNAVAILABLE here: there is no second, best-effort write.
//
//   THE NONCE, SERIALIZED IN THE DATABASE. A write names a nonce (a retry key,
//   at most NONCE_MAX bytes, refused rather than trimmed). Under a transaction
//   advisory lock on the subject's scope (the hash narrows the LOCK only), the
//   persisted receipt is looked up BEFORE the revision check: the same nonce
//   with the same normalized request answers its first receipt and changes
//   nothing; the same nonce with a different request conflicts. The full nonce
//   and the full request are compared; 090's partial unique index is the
//   database's backstop that a scope spends a nonce once.
//
//   THE REVISION. `expectedRevision` must equal the record's revision (0 for a
//   human with no record yet), and the UPDATE repeats it in its WHERE: a
//   conflict changes nothing and answers the current public view. A human's
//   first change creates revision 1 with a fresh opaque `subject_id`, minted
//   only after the house's lock is held.
//
//   A NO-OP (nothing changes) writes no record, no act and no intent, and keeps
//   no retry history: a retried no-op is simply judged again.
//
// NOT HERE (later phases): the actor gate and `resolveVerifiedHumanHouse`
// (this core takes an already resolved house or handle); field caps and text
// rules (the doors' validation); public selectors; render and replay; a
// resident row's creation (import/join). A canonical intent row must not reach
// a live town log before the drain can replay it (town-bridge.mjs): with this
// core unwired, none can.

import { NONCE_MAX } from "./town-journal.mjs";

/** The town-log act a canonical intent is written under (class `update`). */
export const CANONICAL_ACT = "canonical-profile";
/** The intent's shape version. */
export const INTENT_VERSION = 1;

/** The record's declared fields, per kind: exactly 090's columns, nothing else. */
export const RECORD_FIELDS = Object.freeze({
  human: Object.freeze(["town_name", "short_line", "pronouns"]),
  resident: Object.freeze([
    "display_name", "pronouns", "avatar_url", "color", "color_name", "bio", "model", "platform",
    "legacy_runtime", "legacy_architecture", "address_note", "address_body", "profile_body", "household_display",
  ]),
});

const TABLE = { human: "human_records", resident: "resident_records" };

/** A field's value as the record holds it: a string, or null for absent/cleared (null, empty or whitespace). */
const normalize = (v) => (v === null || (typeof v === "string" && v.trim() === "") ? null : v);

/**
 * The present keys of a patch, checked and normalized, or a refusal. Omitted
 * keys are unchanged; an unknown key or a non-string value refuses the whole
 * write before anything is opened.
 */
function readPatch(kind, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { why: "the patch is not an object" };
  const allowed = RECORD_FIELDS[kind];
  const keys = Object.keys(patch).sort();
  const unknown = keys.filter((k) => !allowed.includes(k));
  if (unknown.length) return { why: `unknown field(s): ${unknown.join(", ")}` };
  const fields = {};
  for (const k of keys) {
    const v = patch[k];
    if (v !== null && typeof v !== "string") return { why: `${k} is not a string or null` };
    fields[k] = normalize(v);
  }
  return { fields, request: JSON.stringify(fields) };
}

/** The explicit public view of a record: its declared fields that are set, and nothing else. */
const publicSnapshot = (kind, row) => {
  const out = {};
  for (const k of RECORD_FIELDS[kind]) if (row?.[k] != null) out[k] = row[k];
  return out;
};

/**
 * Append one canonical intent to the EXISTING town log through the caller's
 * transaction `t` (Paper.tx's verbs on its one client): no other connection
 * is opened, committed or released. Private to the writers; exported for the
 * store proof only. `receipt` is the private retry comparison (nonce and
 * normalized request), never render input.
 */
export async function appendCanonicalProfileIntent(t, { household, handle = null, intent, receipt }) {
  return t.append(
    `INSERT INTO town_journal (class, act, household, handle, gh_id, gh_login, cosigned_gh_id, payload, written_at, channel)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL)`,
    ["update", CANONICAL_ACT, String(household), handle == null ? null : String(handle),
      JSON.stringify({ intent, receipt }), new Date().toISOString()],
    "seq");
}

// The receipt a scope already spent this nonce on, or null. The predicate and
// expressions repeat 090's partial index, so the lookup is bounded by it.
async function spentReceipt(t, { household, handle, nonce }) {
  const row = await t.get(
    `SELECT seq, payload FROM town_journal
      WHERE class = 'update' AND act = ? AND household = ? AND coalesce(handle, '') = ?
        AND (payload::jsonb #>> '{receipt,nonce}') = ?`,
    CANONICAL_ACT, household, handle ?? "", nonce);
  return row ? { seq: Number(row.seq), ...JSON.parse(row.payload) } : null;
}

/**
 * The writers' shared transaction core. `target` is already resolved by the
 * caller's gate: `{ household }` for a human, `{ handle }` for a resident.
 * `provenance` is the trusted act provenance the gate supplies (a string,
 * e.g. `human-of-<slug>`), never a credential or context object.
 *
 * Answers one of:
 *   { ok: true, applied: true, subject_id, revision, seq, public_snapshot }
 *   { ok: true, replayed: true, subject_id, revision, seq, public_snapshot }   (the nonce's first receipt)
 *   { ok: true, noop: true, revision, public_snapshot }
 *   { ok: false, refused: "conflict", why: "revision" | "nonce-reused", revision?, public_snapshot? }
 *   { ok: false, refused: "invalid" | "no-target" | "unavailable", why }
 */
export async function writeCanonicalRecord(paper, { kind, target = {}, patch, expectedRevision, nonce, provenance }) {
  if (!TABLE[kind]) return { ok: false, refused: "invalid", why: "kind is human or resident" };
  if (!paper?.onStore) return { ok: false, refused: "unavailable", why: "the canonical record and its intent need the store's one transaction; a file paper cannot give it" };
  if (typeof nonce !== "string" || !nonce || Buffer.byteLength(nonce, "utf8") > NONCE_MAX)
    return { ok: false, refused: "invalid", why: `a nonce of 1 to ${NONCE_MAX} bytes is required` };
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    return { ok: false, refused: "invalid", why: "expectedRevision is a whole number (0 for no record yet)" };
  if (typeof provenance !== "string" || !provenance) return { ok: false, refused: "invalid", why: "provenance is the gate's string" };
  const key = kind === "human" ? target.household : target.handle;
  if (typeof key !== "string" || !key) return { ok: false, refused: "invalid", why: kind === "human" ? "target.household is required" : "target.handle is required" };
  const read = readPatch(kind, patch);
  if (read.why) return { ok: false, refused: "invalid", why: read.why };

  return paper.tx(async (t) => {
    // the subject's scope, serialized: the hash only narrows the lock
    await t.get("SELECT pg_advisory_xact_lock(hashtextextended(?, 0)) AS locked", `${CANONICAL_ACT}:${kind}:${key}`);

    let current, household, handle;
    if (kind === "human") {
      const house = await t.get("SELECT slug FROM households WHERE slug = ?", key);
      if (!house) return { ok: false, refused: "no-target", why: "no such household" };
      household = key; handle = null;
      current = await t.get("SELECT * FROM human_records WHERE household_slug = ?", key);
    } else {
      current = await t.get("SELECT * FROM resident_records WHERE resident_handle = ?", key);
      if (!current) return { ok: false, refused: "no-target", why: "no canonical record for this resident" };
      household = current.household_slug; handle = key;
    }

    // the receipt BEFORE the revision check
    const spent = await spentReceipt(t, { household, handle, nonce });
    if (spent) {
      if (spent.receipt?.nonce !== nonce || spent.receipt?.request !== read.request)
        return { ok: false, refused: "conflict", why: "nonce-reused" };
      return { ok: true, replayed: true, subject_id: spent.intent.subject_id, revision: spent.intent.record_revision,
        seq: spent.seq, public_snapshot: spent.intent.public_snapshot };
    }

    const revision = current ? Number(current.revision) : 0;
    if (expectedRevision !== revision)
      return { ok: false, refused: "conflict", why: "revision", revision, public_snapshot: publicSnapshot(kind, current) };

    const changed = Object.keys(read.fields).filter((k) => read.fields[k] !== (current?.[k] ?? null));
    if (!changed.length) return { ok: true, noop: true, revision, public_snapshot: publicSnapshot(kind, current) };

    let row;
    if (!current) {
      // a human's first change: the house is locked above, so one subject is minted
      row = await t.get(
        `INSERT INTO human_records (subject_id, household_slug, revision, ${changed.join(", ")})
         VALUES (gen_random_uuid(), ?, 1, ${changed.map(() => "?").join(", ")}) RETURNING *`,
        household, ...changed.map((k) => read.fields[k]));
    } else {
      row = await t.get(
        `UPDATE ${TABLE[kind]} SET ${changed.map((k) => `${k} = ?`).join(", ")}, revision = revision + 1
          WHERE subject_id = ? AND revision = ? RETURNING *`,
        ...changed.map((k) => read.fields[k]), current.subject_id, expectedRevision);
      if (!row) return { ok: false, refused: "conflict", why: "revision", revision, public_snapshot: publicSnapshot(kind, current) };
    }

    const intent = {
      version: INTENT_VERSION, kind, subject_id: row.subject_id, record_revision: Number(row.revision),
      public_snapshot: publicSnapshot(kind, row), trusted_provenance: provenance,
    };
    const seq = await appendCanonicalProfileIntent(t, { household, handle, intent, receipt: { nonce, request: read.request } });
    return { ok: true, applied: true, subject_id: intent.subject_id, revision: intent.record_revision, seq, public_snapshot: intent.public_snapshot };
  });
}
