// moment-export-core.mjs — the reusable CORE of the founder moment export (POS-780, step 1 of the author work).
//
// PARTIAL. This is the archive reader, the raw eligibility check and the consent filter, and
// nothing else: no CLI, no positions, no world sampling, no R2, no output writer, no bundle.
// Every function here returns data or throws a NAMED error (ExportCoreError.code); none writes
// a file, opens a socket or reads a store. The caller hands in the directory, the registry text
// and the window.
//
// WHAT IT ANSWERS TO (all settled by the content keeper, POS-780 comments):
//   coverage  09:14  complete ONLY within the certified archive snapshot; scan every declared,
//                    digest-checked archive by act.at; say plainly that held-back acts are not
//                    reported and that outside the certificate is unknown; refuse a window that
//                    ends after the certificate's exported_at.
//   consent   08:35  the household's ONE likeness answer, yes only; no, unset, unknown, unread are
//                    no. Words included. Registry = the town repo's tools/households.json at a
//                    pinned sha, recorded as consent_source {repo:"town", sha, file}.
//   roles     09:14  a party to an act (counterpart, holder, speech source) takes the whole act
//                    out; a witness (bystander) loses only the reference; an unclassified role is
//                    a party. 10:03: a maker named in an id / made_by / _set_down.by / _placed_by
//                    is provenance, not a party.
//   acts      10:03  the nine are reached only through the source-qualified table
//                    (moment-export-table.mjs). Anything else is out and counted by STORED NAME.
//
// ORDER (the privacy filter's law): window by act.at -> alias table -> RAW private eligibility on
// the outer and inner classifiers -> consent roles -> only then a projection. The projection never
// existed before the decision, so no classifier is stripped first.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// The notary's own recipe, imported rather than copied: `contentDigest` is the aggregate over the
// archives and `canonical` the line spelling. Import-time is safe (only node builtins and
// src/crossings.mjs are pulled in; main() is behind an isMain guard).
import { contentDigest } from "../world2/tools/snapshot-export.mjs";
import { ACTION_ALIASES, EMISSION_INNER, EMISSION_SOUND_CLASS, SYSTEM_ACTORS, UNITS_DROP_MOVE, UNITS_MOVE } from "./moment-export-table.mjs";

export const COVERAGE = "certified-snapshot";
export const HELD_BACK_LINE = "held-back acts are not reported by the certificate: no count, and never a zero";
export const OUTSIDE_CERTIFICATE_LINE = "outside the certificate is unknown";
const CERT_FILE = "CERTIFICATION.json";            // O world2/tools/snapshot-export.mjs:454
const ARCHIVE_DIR = path.join("archives", "acts");  // O world2/tools/snapshot-export.mjs:31

export class ExportCoreError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = "ExportCoreError"; this.code = code; }
}

/** Why an act or a reference left. Disjoint, and none of them says a household refused unless the registry said so. */
export const REASONS = Object.freeze({
  household: "household_not_yes",      // the registry maps the handle to a household whose answer is no or unset
  identity: "identity_unresolved",     // no household for the handle (unmapped, ambiguous, a chest or mark, not a handle)
  type: "type_mismatch",               // a slot holds a value of the wrong type
  field: "unclassified_field",         // a key the table does not list for this stored name
});
/** The precedence an act with several reasons is counted under: the non-household reasons first, so the household count is never overstated. */
const REASON_ORDER = Object.freeze([REASONS.field, REASONS.type, REASONS.identity, REASONS.household]);
/** A stored name (arbitrary text, "__proto__" included) counted without ever being an object key on the way. */
const tally = (m) => Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const refusalOf = (consent, handle) => (consent.decide(handle).decision === "unknown" ? REASONS.identity : REASONS.household);

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// ── 1. the certified archive reader ──────────────────────────────────────────

/**
 * Read EVERY declared archive of a notary checkout, verify it, and return the acts whose `at`
 * falls in [fromMs, toMs]. Nothing is returned unless every check passed.
 *
 * It checks, in the notary's own terms (snapshot-export.mjs certification/runVerify): each
 * declared window's file exists, its bytes hash to the declared sha256, its line count is the
 * declared `lines`, and the declared set binds to `archives_sha` by the notary's contentDigest.
 * It does not use acts_cursor arithmetic or the first/last act times, and an archive the
 * certificate does not declare is not read.
 */
export function readCertifiedArchives(dir, { fromMs, toMs }) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs)
    throw new ExportCoreError("WINDOW_INVALID", "the moment window needs finite from <= to");
  const certPath = path.join(dir, CERT_FILE);
  if (!existsSync(certPath)) throw new ExportCoreError("CERT_MISSING", `${CERT_FILE} is not in the notary checkout`);
  let cert;
  try { cert = JSON.parse(readFileSync(certPath, "utf8")); }
  catch { throw new ExportCoreError("CERT_UNREADABLE", `${CERT_FILE} is not JSON`); }
  if (!isObj(cert) || !Array.isArray(cert.archives) || typeof cert.archives_sha !== "string"
      || cert.window_cursor === undefined || cert.acts_cursor === undefined || typeof cert.exported_at !== "string")
    throw new ExportCoreError("CERT_SHAPE", `${CERT_FILE} lacks window_cursor / acts_cursor / archives / archives_sha / exported_at`);
  const certifiedAtMs = Date.parse(cert.exported_at);
  if (!Number.isFinite(certifiedAtMs)) throw new ExportCoreError("CERT_SHAPE", "exported_at is not an instant");
  // The certificate's time is the bound, and it is not a heartbeat (Wright 09:14).
  if (toMs > certifiedAtMs)
    throw new ExportCoreError("WINDOW_AFTER_CERTIFICATE", `the window ends ${new Date(toMs).toISOString()}, after the certificate's exported_at ${new Date(certifiedAtMs).toISOString()}`);

  const seen = new Set();
  const loaded = [];
  for (const a of cert.archives) {
    if (!isObj(a) || !Number.isInteger(Number(a.window)) || !Number.isInteger(a.lines) || typeof a.sha256 !== "string")
      throw new ExportCoreError("CERT_SHAPE", "an archives entry lacks window / lines / sha256");
    if (seen.has(Number(a.window))) throw new ExportCoreError("CERT_SHAPE", `window ${a.window} is declared twice`);
    seen.add(Number(a.window));
    const file = path.join(dir, ARCHIVE_DIR, `${a.window}.jsonl`);
    if (!existsSync(file)) throw new ExportCoreError("ARCHIVE_MISSING", `declared archive ${a.window} is not on disk`);
    const bytes = readFileSync(file, "utf8");
    if (sha256(bytes) !== a.sha256) throw new ExportCoreError("ARCHIVE_DIGEST", `archive ${a.window} does not hash to its declared sha256`);
    const body = bytes.replace(/\n$/, "");
    const lines = body.length ? body.split("\n") : [];
    if (lines.length !== a.lines) throw new ExportCoreError("ARCHIVE_LINES", `archive ${a.window} has ${lines.length} line(s), declared ${a.lines}`);
    loaded.push({ window: Number(a.window), sha256: a.sha256, lines: a.lines, bytes, rows: lines });
  }
  // the aggregate binding, the notary's own recipe (snapshot-export.mjs:471)
  const aggregate = contentDigest(loaded.map((a) => ({ key: String(a.window), bytes: a.bytes })));
  if (aggregate !== cert.archives_sha)
    throw new ExportCoreError("ARCHIVES_AGGREGATE", "the declared archives do not bind to archives_sha");

  const rows = [];
  for (const a of loaded.sort((x, y) => x.window - y.window)) {
    for (const [i, line] of a.rows.entries()) {
      let row;
      try { row = JSON.parse(line); } catch { throw new ExportCoreError("ARCHIVE_LINE", `archive ${a.window} line ${i + 1} is not JSON`); }
      const atMs = Date.parse(row?.at);
      if (!Number.isFinite(atMs)) throw new ExportCoreError("ARCHIVE_LINE", `archive ${a.window} line ${i + 1} has no readable at`);
      if (atMs >= fromMs && atMs <= toMs) rows.push({ row, atMs, window: a.window });
    }
  }
  rows.sort((x, y) => x.atMs - y.atMs || Number(x.row.id) - Number(y.row.id));
  return {
    coverage: {
      coverage: COVERAGE,
      window_cursor: cert.window_cursor, acts_cursor: cert.acts_cursor,
      archives: loaded.map(({ window, lines, sha256: s }) => ({ window, lines, sha256: s })),
      archives_sha: cert.archives_sha, exported_at: cert.exported_at,
      held_back: HELD_BACK_LINE, outside_certificate: OUTSIDE_CERTIFICATE_LINE,
    },
    rows: rows.map((r) => r.row),
  };
}

// ── 2. the consent registry ──────────────────────────────────────────────────

/**
 * The town repo's tools/households.json as text -> a decision per handle. Only the household's one
 * likeness answer is read (src/likeness.mjs likenessOfHouse); a handle reaches a house only through
 * that house's `residents` list (the RESIDENT road of src/household-deriver.mjs resolveHouse), and a
 * handle found in two houses or none is unknown. Accounts, gh ids and `by` are never carried out.
 * Unreadable text is a named error, not a quiet "no": the export has no consent input without it.
 */
export function loadConsentRegistry({ text, sha, file }) {
  if (typeof sha !== "string" || !sha || typeof file !== "string" || !file)
    throw new ExportCoreError("REGISTRY_SOURCE", "consent_source needs the pinned sha and the file");
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new ExportCoreError("REGISTRY_UNREADABLE", "the registry is not JSON"); }
  const houses = parsed?.households ?? parsed;
  if (!isObj(houses) || !Object.keys(houses).length) throw new ExportCoreError("REGISTRY_UNREADABLE", "the registry holds no households");
  const houseOf = new Map();   // handle -> slug | null (ambiguous)
  for (const [slug, rec] of Object.entries(houses)) {
    for (const h of Array.isArray(rec?.residents) ? rec.residents : []) {
      if (typeof h !== "string" || !h) continue;
      houseOf.set(h, houseOf.has(h) && houseOf.get(h) !== slug ? null : slug);
    }
  }
  const decide = (handle) => {
    if (!houseOf.has(handle)) return { decision: "unknown" };
    const slug = houseOf.get(handle);
    if (slug === null) return { decision: "unknown" };
    const l = houses[slug]?.likeness;
    if (l?.answer === "yes") return { decision: "yes", house: slug, answered_at: l.at ?? null, words_version: l.words ?? null };
    return { decision: l?.answer === "no" ? "no" : "unset" };
  };
  return {
    consent_source: { repo: "town", sha, file },
    decide,
    /** The only fields a projected resident record may carry. A not-yes has no record. */
    recordFor: (handle) => { const d = decide(handle); return d.decision === "yes" ? { handle, house: d.house, decision: "yes", answered_at: d.answered_at, words_version: d.words_version } : null; },
  };
}

// ── 3. raw eligibility, then roles ───────────────────────────────────────────

const payloadOf = (row) => {
  if (typeof row.payload === "string") { try { return JSON.parse(row.payload); } catch { return undefined; } }
  return row.payload ?? {};
};

const geoOk = (v) => v === null || typeof v === "number" || (Array.isArray(v) ? v.every(geoOk) : isObj(v) && Object.values(v).every(geoOk));
const typeOk = {
  str: (v) => v === null || typeof v === "string", num: (v) => v === null || typeof v === "number",
  bool: (v) => typeof v === "boolean", geo: geoOk, text: (v) => v === null || typeof v === "string",
  prov: (v) => v === null || typeof v === "string",
};

/**
 * Judge ONE raw archived row. Returns { outcome: "admit"|"untabled"|"ineligible"|"excluded",
 * act?, exclusions[], stored_name }. `exclusions` carry the act id, the field, the role, and what
 * happened to it, and never a handle. The row is not altered.
 */
export function judgeAct(row, consent) {
  const stored = String(row?.action);
  const alias = Object.hasOwn(ACTION_ALIASES, stored) ? ACTION_ALIASES[stored] : null;
  if (!alias) return { outcome: "untabled", stored_name: stored, exclusions: [] };
  const id = row.id;
  const payload = payloadOf(row);
  if (!isObj(payload)) return { outcome: "ineligible", reason: "payload_unreadable", stored_name: stored, exclusions: [] };

  // ── raw private eligibility: OUTER and INNER classifiers, before any projection ──
  if (alias.classes && !alias.classes.includes(String(row.class)))
    return { outcome: "ineligible", reason: "class_unqualified", stored_name: stored, class: String(row.class), exclusions: [] };
  let inner = null;
  if (alias.wrapper) {
    inner = payload.payload;
    if (payload.type !== alias.line_type || !isObj(inner) || inner.class !== EMISSION_SOUND_CLASS)
      return { outcome: "ineligible", reason: "not_a_say", stored_name: stored, exclusions: [] };
    if (payload.room != null || inner.room != null) return { outcome: "ineligible", reason: "room_private", stored_name: stored, exclusions: [] };
  } else {
    if (payload.room != null) return { outcome: "ineligible", reason: "room_private", stored_name: stored, exclusions: [] };
    // A leave-mark row in `acts` is a public deed by its producer (an unstaked draft never reaches acts while the
    // candle burns; a stake releases it into acts), so ABSENCE of put_forward proves nothing. A row that says
    // put_forward:false says it is not put forward, and no door writes that: it is not carried.
    if (payload.put_forward === false)
      return { outcome: "ineligible", reason: "put_forward_false", stored_name: stored, exclusions: [] };
  }

  // ── roles ──
  const exclusions = [];
  const out = {};
  const outAction = alias.canonical;
  let partyFail = false;
  const fail = (field, role, reason) => { partyFail = true; exclusions.push({ act_id: id, field, role, action: "act_excluded", reason }); };
  const partyOk = (v, field, role) => {
    if (v === null || v === undefined) return true;
    if (typeof v !== "string" || !v) { fail(field, role, REASONS.type); return false; }
    if (SYSTEM_ACTORS.includes(v)) return true;
    if (consent.decide(v).decision !== "yes") { fail(field, role, refusalOf(consent, v)); return false; }
    return true;
  };

  if (typeof row.actor !== "string" || !row.actor) fail("actor", "actor", REASONS.type);
  else partyOk(row.actor, "actor", "actor");

  const vocab = alias.wrapper ? EMISSION_INNER : alias.payload;
  const source = alias.wrapper ? inner : payload;
  const prefix = alias.wrapper ? "payload.payload." : "payload.";
  const kept = {};
  for (const [k, v] of Object.entries(source)) {
    const role = Object.hasOwn(vocab, k) ? vocab[k] : undefined;
    const field = prefix + k;
    if (role === undefined) { fail(field, "unclassified", REASONS.field); continue; }
    if (role === "drop" || role === "private") continue;
    if (role === "party" || role === "speaker") { if (partyOk(v, field, role)) kept[k] = v; continue; }
    if (role === "moves") {
      const moveVocab = alias.moves === "drop" ? UNITS_DROP_MOVE : UNITS_MOVE;
      if (!Array.isArray(v)) { fail(field, "moves", REASONS.type); continue; }
      const moves = [];
      for (const [i, m] of v.entries()) {
        if (!isObj(m)) { fail(`${field}[${i}]`, "moves", REASONS.type); continue; }
        const mv = {};
        for (const [mk, mval] of Object.entries(m)) {
          const mrole = Object.hasOwn(moveVocab, mk) ? moveVocab[mk] : undefined;
          const mf = `${field}[${i}].${mk}`;
          if (mrole === undefined) { fail(mf, "unclassified", REASONS.field); continue; }
          // the set-down's destination is the ground: null, and nothing else (a null anywhere else is a missing counterpart, not the ground)
          if (mrole === "ground") { if (mval === null) mv[mk] = null; else fail(mf, "ground", REASONS.type); continue; }
          // a holder is a resident exactly when it has no "/" (holderLawOf, a qualified caller); a "/" is a mark or chest
          if (mrole === "holder") {
            if (typeof mval !== "string" || !mval) { fail(mf, "holder", REASONS.type); continue; }
            if (!mval.includes("/") && !partyOk(mval, mf, "holder")) continue;
            mv[mk] = mval;
          } else if (typeOk[mrole](mval)) mv[mk] = mval;
          else fail(mf, "moves", REASONS.type);
        }
        moves.push(mv);
      }
      kept[k] = moves;
      continue;
    }
    if (!typeOk[role](v)) { fail(field, role, REASONS.type); continue; }
    kept[k] = v;
  }
  if (alias.wrapper) {
    // the speech source is spoken_by (else the row's actor): it was gated above if present; the outer `at` is the instant
    if (typeof payload.at === "string") out.emitted_at = payload.at;
    for (const [k, v] of Object.entries(payload)) {
      const orole = Object.hasOwn(alias.payload, k) ? alias.payload[k] : undefined;
      if (orole === undefined) fail(`payload.${k}`, "unclassified", REASONS.field);
      else if (orole === "party") partyOk(v, `payload.${k}`, "party");
      else if ((orole === "str" || orole === "prov") && !typeOk[orole](v)) fail(`payload.${k}`, orole, REASONS.type);
    }
  }

  // object / anchor columns are provenance and position, kept; witnesses are bystanders
  const objectOk = row.object === null || row.object === undefined || typeof row.object === "string";
  if (!objectOk) fail("object", "prov", REASONS.type);
  const w = row.witnesses;
  let witnesses = null;
  let refsDropped = 0;
  if (w !== null && w !== undefined) {
    if (!isObj(w) || !Array.isArray(w.list ?? []) ) fail("witnesses", "unclassified", REASONS.type);
    else {
      const list = [];
      for (const e of w.list ?? []) {
        if (!isObj(e) || typeof e.handle !== "string") { fail("witnesses.list[]", "bystander", REASONS.type); continue; }
        if (consent.decide(e.handle).decision === "yes") list.push({ handle: e.handle, anchor: e.anchor ?? null, dx: e.dx ?? null, dy: e.dy ?? null });
        else { refsDropped += 1; exclusions.push({ act_id: id, field: "witnesses.list[]", role: "bystander", action: "reference_dropped", reason: refusalOf(consent, e.handle) }); }
      }
      witnesses = { source: w.source ?? null, ...(w.reason !== undefined ? { reason: w.reason } : {}), list };
    }
  }

  // a party out takes the act out: a bystander reference dropped from a vanished act is not a record
  if (partyFail) return { outcome: "excluded", stored_name: stored, exclusions: exclusions.filter((e) => e.action === "act_excluded"), refs_dropped: 0 };
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  return {
    outcome: "admit", stored_name: stored, exclusions, refs_dropped: refsDropped,
    act: {
      id: Number(id), at: row.at, crossing: num(row.crossing), actor: row.actor,
      action: outAction, stored_action: stored, object: row.object ?? null,
      at_anchor: row.at_anchor ?? null, at_dx: num(row.at_dx), at_dy: num(row.at_dy),
      witnesses, payload: { ...kept, ...out },
    },
  };
}

/**
 * Judge every row of a window. Returns the admitted acts, the exclusions (act id + field + role + reason,
 * no handle) and the counts the manifest needs. Stored names are counted in a Map, so a name like
 * "__proto__" is a count and never a property write; every reported counter is a plain object with sorted keys.
 * `excluded_by_reason` counts each excluded act ONCE under its first reason in the order field, type,
 * identity, household, so "household_not_yes" is only ever a registry's own no or unset. Admitted acts keep archive order (at, id).
 */
export function filterActs(rows, consent) {
  const acts = [];
  const exclusions = [];
  const untabled = new Map(), ineligible = new Map(), byReason = new Map();
  const counts = { in_window: rows.length, admitted: 0, untabled_by_stored_name: {}, ineligible: {}, excluded_acts: 0, excluded_by_reason: {}, bystander_refs_dropped: 0 };
  for (const row of rows) {
    const j = judgeAct(row, consent);
    if (j.outcome === "untabled") { bump(untabled, j.stored_name); continue; }
    if (j.outcome === "ineligible") { bump(ineligible, `${j.reason}:${j.stored_name}${j.class !== undefined ? `[class ${j.class}]` : ""}`); continue; }
    exclusions.push(...j.exclusions);
    if (j.outcome === "excluded") {
      counts.excluded_acts += 1;
      const had = new Set(j.exclusions.map((e) => e.reason));
      bump(byReason, REASON_ORDER.find((r) => had.has(r)));
      continue;
    }
    counts.admitted += 1; counts.bystander_refs_dropped += j.refs_dropped;
    acts.push(j.act);
  }
  counts.untabled_by_stored_name = tally(untabled); counts.ineligible = tally(ineligible); counts.excluded_by_reason = tally(byReason);
  return { acts, exclusions, counts };
}

/** The residents an admitted set of acts shows or voices, with only the consent records the registry gives. */
export function residentsOf(acts, consent) {
  const handles = new Set();
  for (const a of acts) {
    if (!SYSTEM_ACTORS.includes(a.actor)) handles.add(a.actor);
    for (const w of a.witnesses?.list ?? []) handles.add(w.handle);
    const p = a.payload ?? {};
    for (const k of ["holder", "previous_holder", "stood_with", "spoken_by", "declared_by", "by", "handle"]) if (typeof p[k] === "string" && !SYSTEM_ACTORS.includes(p[k])) handles.add(p[k]);
    for (const m of p.moves ?? []) for (const k of ["from", "to"]) if (typeof m[k] === "string" && !m[k].includes("/") && !SYSTEM_ACTORS.includes(m[k])) handles.add(m[k]);
  }
  return [...handles].sort().map((h) => consent.recordFor(h)).filter(Boolean);
}
