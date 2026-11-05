// moment-export-core.test.mjs — the founder moment export's CORE, on invented records (POS-780).
//
// EVERY name, registry, certificate, archive and marker below is invented. No notary archive, Town
// file, resident, account or R2 object is read. The ARCHIVES are written by the notary's own
// producer functions (archiveLine, certification), so the reader is proved against what the real
// pen emits; the digests are ALSO recomputed here from the documented recipe with node:crypto, so
// the reader's verdict is not judged by its own parser. Expectations are fixed literals written
// before the run, not derived from the code under test.
//
// Row shapes are the persisted ones read at office 32ce1e05 (see tools/moment-export-table.mjs for
// the line of each writer). A fixture here proves a namespace only where the table cites its writer.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { archiveLine, certification } from "../world2/tools/snapshot-export.mjs";
import {
  readCertifiedArchives, loadConsentRegistry, filterActs, residentsOf, judgeAct, ExportCoreError,
  COVERAGE, HELD_BACK_LINE, OUTSIDE_CERTIFICATE_LINE,
} from "../tools/moment-export-core.mjs";
import { ACTION_ALIASES, CANONICAL_ACTS } from "../tools/moment-export-table.mjs";

const root = mkdtempSync(join(tmpdir(), "moment-export-core-"));
after(() => rmSync(root, { recursive: true, force: true }));

const sha = (s) => createHash("sha256").update(s).digest("hex");
const T = (iso) => Date.parse(iso);
const EXPORTED = "2026-10-03T00:00:00.000Z";

// ── fixtures: archives written by the notary's own producer ───────────────────

/** An `acts` row the way pg hands it over (bigint/numeric as text, timestamptz as Date). */
function pgRow(o) {
  return {
    id: String(o.id), at: new Date(o.at), crossing: String(o.crossing ?? 200), actor: o.actor ?? "syn-a",
    action: o.action ?? "walk", object: o.object ?? null, at_anchor: null, at_dx: null, at_dy: null,
    witnesses: o.witnesses ?? null, class: o.class ?? "move", payload: o.payload ?? {}, effect: null,
    household: o.household ?? null, journal_seq: null, inserted_at: new Date("2026-10-02T12:00:00.000Z"),
  };
}

let seq = 0;
function checkout(windows, { exportedAt = EXPORTED } = {}) {
  const dir = join(root, `co-${++seq}`);
  mkdirSync(join(dir, "archives", "acts"), { recursive: true });
  const archives = Object.entries(windows).map(([w, rows]) => {
    const bytes = rows.map((r) => archiveLine(pgRow(r))).join("\n") + (rows.length ? "\n" : "");
    writeFileSync(join(dir, "archives", "acts", `${w}.jsonl`), bytes);
    return { window: Number(w), lines: rows.length, bytes };
  });
  const cert = certification({
    cursors: { acts_cursor: 99, marks_count: 0 }, windowCursor: Math.max(...archives.map((a) => a.window)),
    pins: { law_sha: "syn-law", town_sha: "syn-town" }, marksDigest: "sha256:syn", archives, exportedAt,
  });
  writeFileSync(join(dir, "CERTIFICATION.json"), JSON.stringify(cert, null, 2) + "\n");
  return { dir, cert, archives };
}
const W = { fromMs: T("2026-10-01T08:00:00Z"), toMs: T("2026-10-01T11:00:00Z") };

test("reader: accepts what the real producer wrote, finds a late restamped row in a LATER archive, and says exactly what it covers", () => {
  const { dir, cert, archives } = checkout({
    150: [{ id: 1, at: "2026-10-01T10:00:00Z", crossing: 150, payload: { to: null } }],
    // a late arrival keeps its OLD `at` but is restamped to the open window's crossing (src/world2-pen.mjs:91-128)
    151: [{ id: 2, at: "2026-10-01T09:00:00Z", crossing: 151, payload: { late_arrival: true, late_from_crossing: 150 } },
          { id: 3, at: "2026-10-05T09:00:00Z", crossing: 151 }],
  });
  // independent recompute of the documented recipe (snapshot-export.mjs:148-157), not the reader's parser
  const lines = [...archives].sort((a, b) => String(a.window).localeCompare(String(b.window))).map((a) => `${sha(a.bytes)}  ${a.window}\n`).join("");
  assert.equal(cert.archives_sha, "sha256:" + sha(lines), "the imported producer matches the documented digest recipe");

  const got = readCertifiedArchives(dir, W);
  assert.deepEqual(got.rows.map((r) => r.id), [2, 1], "both in-window rows, in `at` order: the late one lives in window 151");
  assert.equal(got.coverage.coverage, "certified-snapshot");
  assert.equal(COVERAGE, "certified-snapshot");
  assert.deepEqual(Object.keys(got.coverage).sort(), ["acts_cursor", "archives", "archives_sha", "coverage", "exported_at", "held_back", "outside_certificate", "window_cursor"]);
  assert.equal(got.coverage.window_cursor, 151);
  assert.equal(got.coverage.exported_at, EXPORTED);
  assert.deepEqual(got.coverage.archives.map((a) => [a.window, a.lines, a.sha256]), archives.map((a) => [a.window, a.lines, sha(a.bytes)]));
  assert.equal(got.coverage.held_back, HELD_BACK_LINE);
  assert.equal(got.coverage.outside_certificate, OUTSIDE_CERTIFICATE_LINE);
  assert.match(got.coverage.held_back, /not reported/);
  for (const banned of ["heldBack", "held_back_count", "acts_total", "heartbeat", "gap_free"]) assert.ok(!(banned in got.coverage), banned);
});

test("reader: a flipped byte, a wrong line count, a wrong aggregate, a missing file, a missing or unreadable certificate each fail NAMED; restoring the bytes passes again", () => {
  const { dir, archives } = checkout({ 150: [{ id: 1, at: "2026-10-01T10:00:00Z" }, { id: 4, at: "2026-10-01T10:05:00Z" }] });
  const file = join(dir, "archives", "acts", "150.jsonl");
  const original = readFileSync(file, "utf8");
  assert.equal(sha(original), sha(archives[0].bytes));
  const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof ExportCoreError); return e.code; } return "NO ERROR"; };

  writeFileSync(file, original.replace("syn-a", "syn-z"));           // corrupt
  assert.equal(code(() => readCertifiedArchives(dir, W)), "ARCHIVE_DIGEST");
  writeFileSync(file, original);                                      // restore, then hash-check the restore
  assert.equal(sha(readFileSync(file, "utf8")), sha(archives[0].bytes), "the bytes are restored exactly");
  assert.equal(readCertifiedArchives(dir, W).rows.length, 2, "positive control: the restored checkout passes");

  const certFile = join(dir, "CERTIFICATION.json");
  const certText = readFileSync(certFile, "utf8");
  const edit = (fn) => { const c = JSON.parse(certText); fn(c); writeFileSync(certFile, JSON.stringify(c)); };
  edit((c) => { c.archives[0].lines = 3; });
  assert.equal(code(() => readCertifiedArchives(dir, W)), "ARCHIVE_LINES");
  edit((c) => { c.archives_sha = "sha256:" + "0".repeat(64); });
  assert.equal(code(() => readCertifiedArchives(dir, W)), "ARCHIVES_AGGREGATE");
  edit((c) => { c.archives.push({ window: 777, lines: 0, sha256: sha("") }); });
  assert.equal(code(() => readCertifiedArchives(dir, W)), "ARCHIVE_MISSING");
  edit((c) => { delete c.exported_at; });
  assert.equal(code(() => readCertifiedArchives(dir, W)), "CERT_SHAPE");
  writeFileSync(certFile, "{ not json");
  assert.equal(code(() => readCertifiedArchives(dir, W)), "CERT_UNREADABLE");
  rmSync(certFile);
  assert.equal(code(() => readCertifiedArchives(dir, W)), "CERT_MISSING");
  writeFileSync(certFile, certText);                                  // restore
  assert.equal(sha(readFileSync(certFile, "utf8")), sha(certText));
  assert.equal(readCertifiedArchives(dir, W).rows.length, 2);
});

test("reader: a window ending AFTER the certificate's exported_at is refused; ending exactly at it is not; an undeclared archive on disk is not read", () => {
  const { dir } = checkout({ 150: [{ id: 1, at: "2026-10-01T10:00:00Z" }] }, { exportedAt: "2026-10-01T12:00:00.000Z" });
  const poison = pgRow({ id: 90, at: "2026-10-01T09:30:00Z", actor: "syn-poison" });
  writeFileSync(join(dir, "archives", "acts", "999.jsonl"), archiveLine(poison) + "\n");
  let err;
  try { readCertifiedArchives(dir, { fromMs: T("2026-10-01T08:00:00Z"), toMs: T("2026-10-01T12:00:00.001Z") }); } catch (e) { err = e; }
  assert.equal(err?.code, "WINDOW_AFTER_CERTIFICATE");
  const ok = readCertifiedArchives(dir, { fromMs: T("2026-10-01T08:00:00Z"), toMs: T("2026-10-01T12:00:00.000Z") });
  assert.deepEqual(ok.rows.map((r) => r.id), [1], "the undeclared 999.jsonl row is not in the result");
  assert.throws(() => readCertifiedArchives(dir, { fromMs: 5, toMs: 1 }), (e) => e.code === "WINDOW_INVALID");
});

// ── the consent registry: invented, with fake human fields that must not travel ─

const REGISTRY = JSON.stringify({ households: {
  "syn-house-a": { residents: ["syn-a", "syn-b"], likeness: { answer: "yes", at: "2026-10-20T00:00:00.000Z", by: "SYN-HUMAN-NAME", gh_id: 999001, words: "2026-10-21" }, accounts: [{ id: 999001, login: "syn-login-a" }] },
  "syn-house-c": { residents: ["syn-c"], likeness: { answer: "yes", at: "2026-10-22T00:00:00.000Z", by: "SYN-HUMAN-C", gh_id: 999002, words: "2026-10-21" } },
  "syn-house-n": { residents: ["syn-n"], likeness: { answer: "no", at: "2026-10-23T00:00:00.000Z", by: "SYN-HUMAN-N", gh_id: 999003, words: "2026-10-21" } },
  "syn-house-u": { residents: ["syn-u"] },
  "syn-house-x": { residents: ["syn-dup"], likeness: { answer: "yes" } },
  "syn-house-y": { residents: ["syn-dup"], likeness: { answer: "no" } },
} });
const consent = loadConsentRegistry({ text: REGISTRY, sha: "a".repeat(40), file: "tools/households.json" });

test("registry: only a household's yes is yes; no, unset, unmapped and ambiguous are not; the record carries refs and no human or account field", () => {
  const d = (h) => consent.decide(h).decision;
  assert.deepEqual(["syn-a", "syn-b", "syn-c", "syn-n", "syn-u", "syn-ghost", "syn-dup"].map(d), ["yes", "yes", "yes", "no", "unset", "unknown", "unknown"]);
  assert.deepEqual(consent.consent_source, { repo: "town", sha: "a".repeat(40), file: "tools/households.json" });
  assert.deepEqual(consent.recordFor("syn-a"), { handle: "syn-a", house: "syn-house-a", decision: "yes", answered_at: "2026-10-20T00:00:00.000Z", words_version: "2026-10-21" });
  for (const h of ["syn-n", "syn-u", "syn-ghost", "syn-dup"]) assert.equal(consent.recordFor(h), null);
  const all = JSON.stringify(["syn-a", "syn-b", "syn-c"].map((h) => consent.recordFor(h)));
  for (const leak of ["SYN-HUMAN", "999001", "syn-login-a", "gh_id", "accounts"]) assert.ok(!all.includes(leak), leak);
  for (const bad of ["{ nope", "{}", JSON.stringify({ households: {} })]) assert.throws(() => loadConsentRegistry({ text: bad, sha: "b", file: "f" }), (e) => e.code === "REGISTRY_UNREADABLE");
  assert.throws(() => loadConsentRegistry({ text: REGISTRY, sha: "", file: "f" }), (e) => e.code === "REGISTRY_SOURCE");
});

// ── the act table and the role filter, row by row, against fixed expectations ──

const AT = "2026-10-01T10:00:00.000Z";
const geo = { x: 1, y: 2 };
const holdP = (o) => ({ thing: "syn-a/ball", holder: "syn-a", previous_holder: null, made_by: "syn-a", policy: "hold", ...o });
const emit = (inner, outer = {}) => ({ at: AT, payload: { class: "sound", x: 1, y: 2, text: "t", spoken_by: "syn-a", aboard: false, place: null, ...inner }, ...outer });
const markP = (o) => ({ slug: "syn-a/sign", kind: "sited", at: geo, body: "a sign", by: "syn-a", date: AT, put_forward: true, ...o });

/** [id, action, class, actor, payload, extras, expected] — expected: admit | consent | untabled | ineligible:<key> */
const CASES = [
  [1, "walk", "move", "syn-a", { from: geo, toward: geo, pace: 1.5, within: null, to: "syn-n/shed", declared_by: "syn-a" }, { object: "syn-n/shed", witnesses: { source: "presence", list: [{ handle: "syn-b", anchor: "world", dx: 1, dy: 2 }, { handle: "syn-n", anchor: "world", dx: 3, dy: 4 }] } }, "admit"],
  [2, "give", "holding", "syn-a", holdP({ holder: "syn-n", previous_holder: "syn-a" }), { object: "syn-a/ball" }, "consent"],
  [3, "take", "holding", "syn-a", holdP({ thing: "syn-n/lamp", made_by: "syn-n", owns: true }), { object: "syn-n/lamp" }, "admit"],
  [4, "take", "holding", "syn-n", holdP({ thing: "syn-n/lamp", holder: "syn-n", made_by: "syn-n" }), { object: "syn-n/lamp" }, "consent"],
  [5, "say", "voice", "syn-a", { text: "MARK-FIVE-WORDS", place: null, stood_with: "syn-n" }, {}, "consent"],
  [6, "say", "voice", "syn-a", { text: "MARK-SIX-WORDS", place: null, aboard: true }, {}, "admit"],
  [7, "say", "voice", "syn-a", { text: "MARK-SEVEN-WORDS", place: null, aboard: "syn-c" }, {}, "consent"],
  [8, "say", "voice", "syn-a", { text: "MARK-EIGHT-ROOM", place: null, room: "cellar" }, {}, "ineligible:room_private:say"],
  [9, "legacy:emission", "legacy", "syn-a", emit({ text: "MARK-NINE-WORDS" }), {}, "admit"],
  [10, "legacy:emission", "legacy", "syn-a", emit({ text: "MARK-TEN-WORDS", spoken_by: "syn-n" }), {}, "consent"],
  [11, "legacy:emission", "legacy", "syn-a", emit({ class: "smell" }), {}, "ineligible:not_a_say:legacy:emission"],
  [12, "legacy:emission", "legacy", "syn-a", emit({ text: "MARK-TWELVE-ROOM" }, { room: "cellar" }), {}, "ineligible:room_private:legacy:emission"],
  [13, "leave-mark", "mark", "syn-a", markP({ holder: true, open: false, capacity: 24, stamps: 3, _placed_by: "wright", _set_down: { by: "syn-n" }, image: "syn-n.png" }), { object: "syn-a/sign" }, "admit"],
  [14, "leave-mark", "mark", "syn-a", markP({ put_forward: false, body: "MARK-FOURTEEN-DRAFT" }), { object: "syn-a/sign" }, "ineligible:private_draft:leave-mark"],
  [15, "leave-mark", "mark", "syn-a", markP({ holder: "syn-c" }), { object: "syn-a/sign" }, "consent"],
  [16, "give", "holding", "the-town", holdP({ previous_holder: "the-town" }), { object: "syn-a/ball" }, "admit"],
  [17, "give", "holding", "the-town", holdP({ holder: "syn-n", previous_holder: "the-town" }), { object: "syn-a/ball" }, "consent"],
  [18, "give", "holding", "syn-a", holdP({ holder: "syn-ghost", previous_holder: "syn-a" }), { object: "syn-a/ball" }, "consent"],
  [19, "give", "holding", "syn-a", holdP({ holder: "syn-a/chest", previous_holder: "syn-a" }), { object: "syn-a/ball" }, "consent"],
  [20, "units:give", "holding", "syn-a", { units: true, moves: [{ from: "syn-a", to: "syn-a/chest", kind: "candy", label: "mint", n: 2 }] }, { object: "mint" }, "admit"],
  [21, "units:give", "holding", "syn-a", { units: true, moves: [{ from: "syn-a", to: "syn-n", kind: "candy", label: "mint", n: 2 }] }, { object: "mint" }, "consent"],
  [22, "units:take", "holding", "syn-a", { units: true, moves: [{ from: "syn-a/chest", to: "syn-a", kind: "candy", label: "mint", n: 1 }] }, { object: "mint" }, "admit"],
  [23, "legacy:departure", "legacy", "syn-a", { iso: AT, handle: "syn-a", from: geo, toward: geo, at: 150.5, targetExtent: null, targetMarkId: null, pace: null, line: "RAW-LEDGER-LINE-23 syn-n", _ledger: "WORLD/walk-ledger.md" }, {}, "admit"],
  [24, "legacy:enter", "legacy", "syn-a", { iso: AT, handle: "syn-a", act: "enters", mark: "syn-a/hall", at: 150.1, word: "neutral", line: "RAW-LEDGER-LINE-24 syn-n", _ledger: "WORLD/enter-exit-ledger.md" }, { object: "syn-a/hall" }, "admit"],
  [25, "enter", "frame", "syn-a", { ledger: "L", lines: ["RAW-LINES-25 syn-n"], summary: "S", arrived: true }, { object: "syn-a/hall" }, "admit"],
  [26, "ride", "ride", "syn-a", { origin: "syn-stop-1", to: "syn-n", distance_m: 100, pace_km_per_crossing: 5, declared_at: AT, arrives_at: AT }, { object: "syn-a/boat" }, "admit"],
  [27, "walk", "move", "syn-a", { from: geo, toward: geo, pace: 1, within: null, to: null, declared_by: "syn-a", zzz_unlisted: "x" }, {}, "consent"],
  [28, "walk", "move", "syn-a", { from: geo, toward: geo, pace: 1, within: null, to: null, declared_by: "syn-a" }, { household: "syn-n" }, "admit"],
  [29, "land", "move", "syn-a", {}, {}, "untabled"],
  [30, "legacy:leave-mark", "legacy", "syn-a", { object: "syn-a/x" }, {}, "untabled"],
  [31, "walks", "move", "syn-a", {}, {}, "untabled"],
  [32, "amend", "mark", "syn-a", {}, {}, "untabled"],
  [33, "give", "creature", "syn-a", holdP({ holder: "syn-a" }), {}, "ineligible:class_unqualified:give[class creature]"],
  [34, "walk", "move", "syn-u", { from: geo, toward: geo, pace: 1, within: null, to: null, declared_by: "syn-u" }, {}, "consent"],
  [35, "walk", "move", "syn-dup", { from: geo, toward: geo, pace: 1, within: null, to: null, declared_by: "syn-dup" }, {}, "consent"],
  [36, "say", "voice", "syn-a", { text: "MARK-THIRTYSIX-WORDS", place: null }, { witnesses: { source: "unread", reason: "no presence record", list: [] } }, "admit"],
  [37, "give", "holding", "syn-a", holdP({ holder: "syn-b", previous_holder: "syn-a" }), { object: "syn-a/ball", witnesses: { source: "presence", list: [{ handle: "syn-c", anchor: "world", dx: 0, dy: 0 }] } }, "admit"],
  [38, "walk", "move", "syn-a", { from: geo, toward: geo, pace: 1, within: null, to: null, declared_by: "syn-n" }, {}, "consent"],
  [39, "units:give", "holding", "syn-a", { units: true, moves: [{ from: "syn-a", to: "syn-b", kind: "candy", label: "mint", n: 1, extra: 1 }] }, { object: "mint" }, "consent"],
  [40, "walk", "move", "syn-a", { from: geo, toward: geo, pace: 1, within: null, to: null, declared_by: "syn-a" }, { witnesses: { source: "presence", list: [{ handle: "syn-n" }, { handle: "syn-u" }, { handle: "syn-ghost" }] } }, "admit"],
];
const rowsOf = (cases) => cases.map(([id, action, cls, actor, payload, extra]) => ({ id, at: AT, crossing: 200, action, class: cls, actor, payload, ...extra }))
  // as archived: round-trip through the notary's line writer, so the shapes are the persisted ones
  .map((r) => JSON.parse(archiveLine(pgRow(r))));
/** admit | consent | other (untabled or ineligible, which the exact counts below tell apart) */
const outcomeOf = (res, cases) => {
  const admitted = new Set(res.acts.map((a) => a.id));
  const consentOut = new Set(res.consent_exclusions.filter((e) => e.action === "act_excluded").map((e) => e.act_id));
  return Object.fromEntries(cases.map(([id]) => [id, admitted.has(id) ? "admit" : consentOut.has(id) ? "consent" : "other"]));
};
const expectedOf = (c) => (c[6] === "admit" || c[6] === "consent" ? c[6] : "other");

test("filter: every row lands where the fixed expectation says, and the counts are exact", () => {
  const res = filterActs(rowsOf(CASES), consent);
  const expectedOutcome = Object.fromEntries(CASES.map((c) => [c[0], expectedOf(c)]));
  assert.deepEqual(outcomeOf(res, CASES), expectedOutcome);
  assert.deepEqual(res.counts.untabled_by_stored_name, { land: 1, "legacy:leave-mark": 1, walks: 1, amend: 1 });
  assert.deepEqual(res.counts.ineligible, {
    "room_private:say": 1, "not_a_say:legacy:emission": 1, "room_private:legacy:emission": 1,
    "private_draft:leave-mark": 1, "class_unqualified:give[class creature]": 1,
  });
  assert.equal(res.counts.in_window, 40);
  assert.equal(res.counts.admitted, 16);          // by hand from CASES: 1 3 6 9 13 16 20 22 23 24 25 26 28 36 37 40
  assert.equal(res.counts.consent_excluded_acts, 15);   // 2 4 5 7 10 15 17 18 19 21 27 34 35 38 39
  assert.equal(res.counts.bystander_refs_dropped, 4, "row 1: one (the denied syn-n); row 40: three (no, unset, unmapped)");
});

test("filter: a party takes the whole act and its words out; a bystander loses only the reference; the exclusions name act and field, never a handle", () => {
  const res = filterActs(rowsOf(CASES), consent);
  const acts = new Map(res.acts.map((a) => [a.id, a]));
  assert.deepEqual(acts.get(1).witnesses.list.map((w) => w.handle), ["syn-b"], "S3: the denied witness's entry goes, the consenting one stays");
  assert.equal(acts.get(1).witnesses.source, "presence");
  assert.deepEqual(acts.get(40).witnesses.list, [], "no, unset and unmapped bystanders all drop; the act stays");
  assert.deepEqual(acts.get(36).witnesses, { source: "unread", reason: "no presence record", list: [] }, "unread is kept as unread, not read as an empty world");
  assert.deepEqual(acts.get(37).witnesses.list.map((w) => w.handle), ["syn-c"]);
  const dump = JSON.stringify(res.acts);
  for (const words of ["MARK-FIVE-WORDS", "MARK-SEVEN-WORDS", "MARK-EIGHT-ROOM", "MARK-TEN-WORDS", "MARK-TWELVE-ROOM", "MARK-FOURTEEN-DRAFT"]) assert.ok(!dump.includes(words), `${words} is gone`);
  for (const words of ["MARK-SIX-WORDS", "MARK-NINE-WORDS", "MARK-THIRTYSIX-WORDS"]) assert.ok(dump.includes(words), `${words} stays`);
  const ex = res.consent_exclusions;
  for (const e of ex) assert.deepEqual(Object.keys(e).sort(), ["act_id", "action", "field", "reason", "role"]);
  assert.ok(!JSON.stringify(ex).includes("syn-"), "no handle in the manifest's consent exclusions");
  const of = (id) => ex.filter((e) => e.act_id === id).map((e) => `${e.field}|${e.role}|${e.action}|${e.reason}`);
  assert.deepEqual(of(2), ["payload.holder|party|act_excluded|consent_not_yes"]);
  assert.deepEqual(of(4), ["actor|actor|act_excluded|consent_not_yes", "payload.holder|party|act_excluded|consent_not_yes"]);
  assert.deepEqual(of(5), ["payload.stood_with|speaker|act_excluded|consent_not_yes"]);
  assert.deepEqual(of(7), ["payload.aboard|bool|act_excluded|type_mismatch"]);
  assert.deepEqual(of(10), ["payload.payload.spoken_by|speaker|act_excluded|consent_not_yes"]);
  assert.deepEqual(of(15), ["payload.holder|bool|act_excluded|type_mismatch"]);
  assert.deepEqual(of(27), ["payload.zzz_unlisted|unclassified|act_excluded|unclassified_field"]);
  assert.deepEqual(of(38), ["payload.declared_by|party|act_excluded|consent_not_yes"]);
  assert.deepEqual(of(21), ["payload.moves[0].to|holder|act_excluded|consent_not_yes"]);
  assert.deepEqual(of(39), ["payload.moves[0].extra|unclassified|act_excluded|unclassified_field"]);
  assert.deepEqual(of(1), ["witnesses.list[]|bystander|reference_dropped|consent_not_yes"]);
  assert.equal(of(40).length, 3);
});

test("provenance, namespaces and the alias table: a maker is not a party; booleans, coordinates, stop ids and the household slug are not residents; no wildcard admits an extra name", () => {
  const res = filterActs(rowsOf(CASES), consent);
  const acts = new Map(res.acts.map((a) => [a.id, a]));
  assert.equal(acts.get(3).object, "syn-n/lamp", "an absent maker's id stays on the object it made");
  assert.equal(acts.get(3).payload.made_by, "syn-n");
  assert.equal(acts.get(1).object, "syn-n/shed", "a walk toward an absent maker's shed stays");
  assert.ok(!consent.recordFor("syn-n"), "and that maker is still no one's drawn resident");
  assert.equal(consent.decide("syn-n").decision, "no");
  // a maker who is actually present IS gated: row 4 (actor) is out; as a witness (row 1) only the reference goes
  assert.equal(acts.has(4), false);
  assert.equal(acts.get(6).payload.aboard, true);
  assert.deepEqual(acts.get(26).payload.to, "syn-n", "a ride's `to` is a stop id");
  assert.equal("household" in acts.get(28), false, "the household column is dropped, not read as a handle");
  assert.equal(acts.get(13).payload.holder, true);
  assert.equal(acts.get(13).payload.capacity, 24);
  for (const dropped of ["_set_down", "_placed_by", "image"]) assert.ok(!(dropped in acts.get(13).payload), dropped);
  assert.ok(!("line" in acts.get(23).payload) && !JSON.stringify(acts.get(23)).includes("RAW-LEDGER-LINE-23"));
  assert.ok(!JSON.stringify(acts.get(24)).includes("RAW-LEDGER-LINE-24"));
  assert.ok(!JSON.stringify(acts.get(25)).includes("RAW-LINES-25"));
  // the alias table: canonical names, stored names kept, units/legacy/emission mapped, units "/" law only inside moves
  assert.deepEqual([9, 20, 22, 23, 24].map((i) => [acts.get(i).action, acts.get(i).stored_action]),
    [["say", "legacy:emission"], ["give", "units:give"], ["take", "units:take"], ["walk", "legacy:departure"], ["enter", "legacy:enter"]]);
  assert.ok(acts.has(20) && !acts.has(19), "a chest in a units move is a mark (the qualified law); the same string in a plain hold is unchecked, so unknown");
  for (const a of Object.values(ACTION_ALIASES)) assert.ok(CANONICAL_ACTS.includes(a.canonical), a.canonical);
  assert.equal(Object.keys(ACTION_ALIASES).length, 17);
  for (const n of ["land", "walks", "legacy:departure2", "units:make", "legacy:leave-mark", "amend"]) assert.ok(!(n in ACTION_ALIASES), n);
  const wild = filterActs(rowsOf([[50, "legacy:departure2", "legacy", "syn-a", {}, {}], [51, "units:make", "holding", "syn-a", { units: true }, {}]]), consent);
  assert.deepEqual(wild.counts.untabled_by_stored_name, { "legacy:departure2": 1, "units:make": 1 });
  assert.equal(wild.acts.length, 0);
});

test("matched all-consenting control: swapping the denied resident for a consenting one admits every row the rules allow, consented says remain, and nothing changes shape", () => {
  const swapped = CASES.map((c) => JSON.parse(JSON.stringify(c).replaceAll("syn-n", "syn-c")));
  const res = filterActs(rowsOf(swapped), consent);
  const out = outcomeOf(res, swapped);
  // still out for reasons that are NOT consent: type mismatches (7, 15), an unlisted key (27, 39), an unmapped or unchecked holder (18, 19), unset and ambiguous actors (34, 35)
  const stillOut = [7, 15, 18, 19, 27, 34, 35, 39];
  for (const [id] of CASES) {
    const want = stillOut.includes(id) ? "consent" : CASES[id - 1][6] === "consent" ? "admit" : expectedOf(CASES[id - 1]);
    assert.equal(out[id], want, `row ${id}`);
  }
  const dump = JSON.stringify(res.acts);
  for (const words of ["MARK-FIVE-WORDS", "MARK-TEN-WORDS"]) assert.ok(dump.includes(words), `${words} remains for a consenting speaker`);
  assert.equal(res.consent_exclusions.filter((e) => e.action === "act_excluded" && e.reason === "consent_not_yes").filter((e) => ![18, 19, 34, 35].includes(e.act_id)).length, 0,
    "no party exclusion remains except the unmapped, unchecked, unset and ambiguous controls");
  assert.deepEqual(res.acts.find((a) => a.id === 1).witnesses.list.map((w) => w.handle), ["syn-b", "syn-c"], "the consenting bystander's reference stays");
});

test("residents: only consent records for who an admitted set shows or voices; no human, account or maker-only name", () => {
  const res = filterActs(rowsOf(CASES), consent);
  const recs = residentsOf(res.acts, consent);
  assert.deepEqual(recs.map((r) => r.handle), ["syn-a", "syn-b", "syn-c"]);
  for (const r of recs) assert.deepEqual(Object.keys(r).sort(), ["answered_at", "decision", "handle", "house", "words_version"]);
  assert.ok(!JSON.stringify(recs).match(/SYN-HUMAN|999001|syn-login/));
  assert.ok(!recs.some((r) => r.handle === "syn-n"), "the absent maker is not a resident of the scene");
});

test("a row judged alone is not altered and a payload that is not an object is ineligible, not a crash", () => {
  const raw = rowsOf(CASES.slice(0, 1))[0];
  const before = JSON.stringify(raw);
  judgeAct(raw, consent);
  assert.equal(JSON.stringify(raw), before);
  const bad = { ...raw, payload: "{ not json" };
  assert.equal(judgeAct(bad, consent).outcome, "ineligible");
  assert.equal(judgeAct({ ...raw, action: "toString" }, consent).outcome, "untabled");
});
