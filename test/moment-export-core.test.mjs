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
// The pen's own late-arrival stamp: late_from_crossing is a finite NUMBER, late_arrival a reason STRING (src/world2-pen.mjs:119-128;
// the standing reason of a stake that puts a draft forward, world2-pen.mjs:101, filed at src/world2-claims.mjs:927-929).
const LATE_REASON = "a stake put a draft forward after the window it was composed in had closed (postmark#2722)";
const LATE_META = { late_from_crossing: 150, late_arrival: LATE_REASON };
// an operator can type free text as the reason of a backfill (W2_LATE_ARRIVAL): an invented note that must be validated and never projected
const OPERATOR_NOTE = "backfill by syn-operator OPERATOR-NOTE-CANARY-4417";

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
    151: [{ id: 2, at: "2026-10-01T09:00:00Z", crossing: 151, payload: { ...LATE_META } },
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
const emit = (inner, outer = {}) => ({ at: AT, type: "emission", actor: "syn-a", id: "syn-e-1", payload: { class: "sound", x: 1, y: 2, text: "t", spoken_by: "syn-a", aboard: false, place: null, ...inner }, ...outer });
const markP = (o) => ({ slug: "syn-a/sign", kind: "sited", at: geo, body: "a sign", by: "syn-a", date: AT, put_forward: true, ...o });

/** [id, action, class, actor, payload, extras, expected] — expected: admit | excluded | untabled | ineligible:<key> */
const CASES = [
  [1, "walk", "move", "syn-a", { from: geo, toward: geo, pace: 1.5, within: null, to: "syn-n/shed", declared_by: "syn-a" }, { object: "syn-n/shed", witnesses: { source: "presence", list: [{ handle: "syn-b", anchor: "world", dx: 1, dy: 2 }, { handle: "syn-n", anchor: "world", dx: 3, dy: 4 }] } }, "admit"],
  [2, "give", "holding", "syn-a", holdP({ holder: "syn-n", previous_holder: "syn-a" }), { object: "syn-a/ball" }, "excluded"],
  [3, "take", "holding", "syn-a", holdP({ thing: "syn-n/lamp", made_by: "syn-n", owns: true }), { object: "syn-n/lamp" }, "admit"],
  [4, "take", "holding", "syn-n", holdP({ thing: "syn-n/lamp", holder: "syn-n", made_by: "syn-n" }), { object: "syn-n/lamp" }, "excluded"],
  [5, "say", "voice", "syn-a", { text: "MARK-FIVE-WORDS", place: null, stood_with: "syn-n" }, {}, "excluded"],
  [6, "say", "voice", "syn-a", { text: "MARK-SIX-WORDS", place: null, aboard: true }, {}, "admit"],
  [7, "say", "voice", "syn-a", { text: "MARK-SEVEN-WORDS", place: null, aboard: "syn-c" }, {}, "excluded"],
  [8, "say", "voice", "syn-a", { text: "MARK-EIGHT-ROOM", place: null, room: "cellar" }, {}, "ineligible:room_private:say"],
  [9, "legacy:emission", "legacy", "syn-a", emit({ text: "MARK-NINE-WORDS" }), {}, "admit"],
  [10, "legacy:emission", "legacy", "syn-a", emit({ text: "MARK-TEN-WORDS", spoken_by: "syn-n" }), {}, "excluded"],
  [11, "legacy:emission", "legacy", "syn-a", emit({ class: "smell" }), {}, "ineligible:not_a_say:legacy:emission"],
  [12, "legacy:emission", "legacy", "syn-a", emit({ text: "MARK-TWELVE-ROOM" }, { room: "cellar" }), {}, "ineligible:room_private:legacy:emission"],
  [13, "leave-mark", "mark", "syn-a", markP({ holder: true, open: false, capacity: 24, stamps: 3, _placed_by: "wright", _set_down: { by: "syn-n" }, image: "syn-n.png" }), { object: "syn-a/sign" }, "admit"],
  [14, "leave-mark", "mark", "syn-a", markP({ put_forward: false, body: "MARK-FOURTEEN-DRAFT" }), { object: "syn-a/sign" }, "ineligible:put_forward_false:leave-mark"],
  [15, "leave-mark", "mark", "syn-a", markP({ holder: "syn-c" }), { object: "syn-a/sign" }, "excluded"],
  [16, "give", "holding", "the-town", holdP({ previous_holder: "the-town" }), { object: "syn-a/ball" }, "admit"],
  [17, "give", "holding", "the-town", holdP({ holder: "syn-n", previous_holder: "the-town" }), { object: "syn-a/ball" }, "excluded"],
  [18, "give", "holding", "syn-a", holdP({ holder: "syn-ghost", previous_holder: "syn-a" }), { object: "syn-a/ball" }, "excluded"],
  [19, "give", "holding", "syn-a", holdP({ holder: "syn-a/chest", previous_holder: "syn-a" }), { object: "syn-a/ball" }, "excluded"],
  [20, "units:give", "holding", "syn-a", { units: true, moves: [{ from: "syn-a", to: "syn-a/chest", label: "mint", n: 2 }] }, { object: "mint" }, "admit"],
  [21, "units:give", "holding", "syn-a", { units: true, moves: [{ from: "syn-a", to: "syn-n", label: "mint", n: 2 }] }, { object: "mint" }, "excluded"],
  [22, "units:take", "holding", "syn-a", { units: true, moves: [{ from: "syn-a/chest", to: "syn-a", label: "mint", n: 1 }] }, { object: "mint" }, "admit"],
  [23, "legacy:departure", "legacy", "syn-a", { iso: AT, handle: "syn-a", from: geo, toward: geo, at: 150.5, targetExtent: null, targetMarkId: null, pace: null, line: "RAW-LEDGER-LINE-23 syn-n", _ledger: "WORLD/walk-ledger.md" }, {}, "admit"],
  [24, "legacy:enter", "legacy", "syn-a", { iso: AT, handle: "syn-a", act: "enters", mark: "syn-a/hall", at: 150.1, word: "neutral", line: "RAW-LEDGER-LINE-24 syn-n", _ledger: "WORLD/enter-exit-ledger.md" }, { object: "syn-a/hall" }, "admit"],
  [25, "enter", "frame", "syn-a", { ledger: "L", lines: ["RAW-LINES-25 syn-n"], summary: "S", arrived: true }, { object: "syn-a/hall" }, "admit"],
  [26, "ride", "ride", "syn-a", { origin: "syn-stop-1", to: "syn-n", distance_m: 100, pace_km_per_crossing: 5, declared_at: AT, arrives_at: AT }, { object: "syn-a/boat" }, "admit"],
  [27, "walk", "move", "syn-a", { from: geo, toward: geo, pace: 1, within: null, to: null, declared_by: "syn-a", zzz_unlisted: "x" }, {}, "excluded"],
  [28, "walk", "move", "syn-a", { from: geo, toward: geo, pace: 1, within: null, to: null, declared_by: "syn-a" }, { household: "syn-n" }, "admit"],
  [29, "land", "move", "syn-a", {}, {}, "untabled"],
  [30, "legacy:leave-mark", "legacy", "syn-a", { object: "syn-a/x" }, {}, "untabled"],
  [31, "walks", "move", "syn-a", {}, {}, "untabled"],
  [32, "amend", "mark", "syn-a", {}, {}, "untabled"],
  [33, "give", "creature", "syn-a", holdP({ holder: "syn-a" }), {}, "ineligible:class_unqualified:give[class creature]"],
  [34, "walk", "move", "syn-u", { from: geo, toward: geo, pace: 1, within: null, to: null, declared_by: "syn-u" }, {}, "excluded"],
  [35, "walk", "move", "syn-dup", { from: geo, toward: geo, pace: 1, within: null, to: null, declared_by: "syn-dup" }, {}, "excluded"],
  [36, "say", "voice", "syn-a", { text: "MARK-THIRTYSIX-WORDS", place: null }, { witnesses: { source: "unread", reason: "no presence record", list: [] } }, "admit"],
  [37, "give", "holding", "syn-a", holdP({ holder: "syn-b", previous_holder: "syn-a" }), { object: "syn-a/ball", witnesses: { source: "presence", list: [{ handle: "syn-c", anchor: "world", dx: 0, dy: 0 }] } }, "admit"],
  [38, "walk", "move", "syn-a", { from: geo, toward: geo, pace: 1, within: null, to: null, declared_by: "syn-n" }, {}, "excluded"],
  [39, "units:give", "holding", "syn-a", { units: true, moves: [{ from: "syn-a", to: "syn-b", label: "mint", n: 1, extra: 1 }] }, { object: "mint" }, "excluded"],
  [40, "walk", "move", "syn-a", { from: geo, toward: geo, pace: 1, within: null, to: null, declared_by: "syn-a" }, { witnesses: { source: "presence", list: [{ handle: "syn-n" }, { handle: "syn-u" }, { handle: "syn-ghost" }] } }, "admit"],
  // F1/F7: a persisted emission is qualified by its OUTER class, its line type and its inner sound; an inner room is the only difference of 41 from 42
  [41, "legacy:emission", "legacy", "syn-a", emit({ text: "MARK-41-INNERROOM", room: "cellar" }), {}, "ineligible:room_private:legacy:emission"],
  [42, "legacy:emission", "legacy", "syn-a", emit({ text: "MARK-42-PUBLIC" }), {}, "admit"],
  [43, "legacy:emission", "letter", "syn-a", emit({ text: "MARK-43-LETTER" }), {}, "ineligible:class_unqualified:legacy:emission[class letter]"],
  [44, "legacy:emission", "legacy", "syn-a", emit({ text: "MARK-44-TYPE" }, { type: "letter" }), {}, "ineligible:not_a_say:legacy:emission"],
  [45, "emission", "legacy", "syn-a", emit({ text: "MARK-45-BARE" }), {}, "untabled"],
  // F3: the real set-down (world-units.mjs:495-497) and its controls
  [46, "units:drop", "holding", "syn-a", { units: true, moves: [{ from: "syn-a", to: null, label: "mint", n: 1 }], label: "mint", at: geo }, { object: "syn-a" }, "admit"],
  [47, "units:drop", "holding", "syn-n", { units: true, moves: [{ from: "syn-n", to: null, label: "mint", n: 1 }], label: "mint", at: geo }, { object: "syn-n" }, "excluded"],
  [48, "units:drop", "holding", "syn-a", { units: true, moves: [{ from: "syn-a", to: "syn-a", label: "mint", n: 1 }], label: "mint", at: geo }, { object: "syn-a" }, "excluded"],
  [49, "units:give", "holding", "syn-a", { units: true, moves: [{ from: "syn-a", to: null, label: "mint", n: 1 }] }, { object: "mint" }, "excluded"],
  [50, "units:give", "holding", "syn-a", { units: true, moves: [{ from: "syn-a", to: "syn-b", kind: "candy", label: "mint", n: 1 }] }, { object: "mint" }, "excluded"],
  // F5: a leave-mark in acts is a public deed; absence of put_forward is not a draft
  [51, "leave-mark", "mark", "syn-a", { slug: "syn-a/idea", kind: "predicated", body: "MARK-51-BODY", slot: "idea", value: "v", parent_id: "syn-a/sign", by: "syn-a", date: AT }, { object: "syn-a/idea" }, "admit"],
  [52, "leave-mark", "mark", "syn-a", markP({ _deferred_act: { body: "MARK-52-DEFERRED" } }), { object: "syn-a/sign" }, "excluded"],
  [53, "leave-mark", "draft", "syn-a", markP({ body: "MARK-53-CLASS" }), { object: "syn-a/sign" }, "ineligible:class_unqualified:leave-mark[class draft]"],
  [54, "leave-mark", "mark", "syn-a", markP({ amend: true, body: "MARK-54-AMEND" }), { object: "syn-a/sign" }, "excluded"],
  // F7: malformed witnesses and a non-string actor
  [55, "say", "voice", "syn-a", { text: "MARK-55-WORDS", place: null }, { witnesses: "oops" }, "excluded"],
  [56, "say", "voice", "syn-a", { text: "MARK-56-WORDS", place: null }, { witnesses: { source: "presence", list: "x" } }, "excluded"],
  [57, "say", "voice", "syn-a", { text: "MARK-57-WORDS", place: null }, { witnesses: { source: "presence", list: [{ anchor: "world" }] } }, "excluded"],
  [58, "walk", "move", 7, { from: geo, toward: geo, pace: 1, within: null, to: null, declared_by: null }, {}, "excluded"],
];
const rowsOf = (cases) => cases.map(([id, action, cls, actor, payload, extra]) => ({ id, at: AT, crossing: 200, action, class: cls, actor, payload, ...extra }))
  // as archived: round-trip through the notary's line writer, so the shapes are the persisted ones
  .map((r) => JSON.parse(archiveLine(pgRow(r))));
/** admit | excluded | other (untabled or ineligible, which the exact counts below tell apart) */
const outcomeOf = (res, cases) => {
  const admitted = new Set(res.acts.map((a) => a.id));
  const excludedOut = new Set(res.exclusions.filter((e) => e.action === "act_excluded").map((e) => e.act_id));
  return Object.fromEntries(cases.map(([id]) => [id, admitted.has(id) ? "admit" : excludedOut.has(id) ? "excluded" : "other"]));
};
const expectedOf = (c) => (c[6] === "admit" || c[6] === "excluded" ? c[6] : "other");
const sumOf = (o) => Object.values(o).reduce((a, b) => a + b, 0);

test("filter: every row lands where the fixed expectation says, and the counts are exact and partition the window", () => {
  const res = filterActs(rowsOf(CASES), consent);
  const expectedOutcome = Object.fromEntries(CASES.map((c) => [c[0], expectedOf(c)]));
  assert.deepEqual(outcomeOf(res, CASES), expectedOutcome);
  assert.deepEqual(res.counts.untabled_by_stored_name, { amend: 1, emission: 1, land: 1, "legacy:leave-mark": 1, walks: 1 });
  assert.deepEqual(res.counts.ineligible, {
    "class_unqualified:give[class creature]": 1, "class_unqualified:legacy:emission[class letter]": 1, "class_unqualified:leave-mark[class draft]": 1,
    "not_a_say:legacy:emission": 2, "put_forward_false:leave-mark": 1, "room_private:legacy:emission": 2, "room_private:say": 1,
  });
  assert.equal(res.counts.in_window, 58);
  assert.equal(res.counts.admitted, 19);          // by hand from CASES: 1 3 6 9 13 16 20 22 23 24 25 26 28 36 37 40 42 46 51
  assert.equal(res.counts.excluded_acts, 25);     // 2 4 5 7 10 15 17 18 19 21 27 34 35 38 39 47 48 49 50 52 54 55 56 57 58
  assert.equal(res.counts.bystander_refs_dropped, 4, "row 1: one (the denied syn-n); row 40: three (no, unset, unmapped)");
  // the reasons, by hand, one reason per act (field > type > identity > household): household 2 4 5 10 17 21 34 38 47; type 7 15 48 49 55 56 57 58; identity 18 19 35; field 27 39 50 52 54
  assert.deepEqual(res.counts.excluded_by_reason, { household_not_yes: 9, identity_unresolved: 3, type_mismatch: 8, unclassified_field: 5 });
  // disjoint, and the window is fully explained: admitted + excluded + ineligible + untabled
  assert.equal(sumOf(res.counts.excluded_by_reason), res.counts.excluded_acts);
  assert.equal(res.counts.admitted + res.counts.excluded_acts + sumOf(res.counts.ineligible) + sumOf(res.counts.untabled_by_stored_name), 58);
  assert.equal(sumOf(res.counts.ineligible), 9);
  assert.equal(sumOf(res.counts.untabled_by_stored_name), 5);
});

test("filter: a party takes the whole act and its words out; a bystander loses only the reference; the exclusions name act, field and an honest reason, never a handle", () => {
  const res = filterActs(rowsOf(CASES), consent);
  const acts = new Map(res.acts.map((a) => [a.id, a]));
  assert.deepEqual(acts.get(1).witnesses.list.map((w) => w.handle), ["syn-b"], "S3: the denied witness's entry goes, the consenting one stays");
  assert.equal(acts.get(1).witnesses.source, "presence");
  assert.deepEqual(acts.get(40).witnesses.list, [], "no, unset and unmapped bystanders all drop; the act stays");
  assert.deepEqual(acts.get(36).witnesses, { source: "unread", reason: "no presence record", list: [] }, "unread is kept as unread, not read as an empty world");
  assert.deepEqual(acts.get(37).witnesses.list.map((w) => w.handle), ["syn-c"]);
  const dump = JSON.stringify(res.acts);
  for (const words of ["MARK-FIVE-WORDS", "MARK-SEVEN-WORDS", "MARK-EIGHT-ROOM", "MARK-TEN-WORDS", "MARK-TWELVE-ROOM", "MARK-FOURTEEN-DRAFT",
    "MARK-41-INNERROOM", "MARK-43-LETTER", "MARK-44-TYPE", "MARK-45-BARE", "MARK-52-DEFERRED", "MARK-53-CLASS", "MARK-54-AMEND", "MARK-55-WORDS", "MARK-56-WORDS", "MARK-57-WORDS"])
    assert.ok(!dump.includes(words), `${words} is gone`);
  for (const words of ["MARK-SIX-WORDS", "MARK-NINE-WORDS", "MARK-THIRTYSIX-WORDS", "MARK-42-PUBLIC", "MARK-51-BODY"]) assert.ok(dump.includes(words), `${words} stays`);
  const ex = res.exclusions;
  for (const e of ex) assert.deepEqual(Object.keys(e).sort(), ["act_id", "action", "field", "reason", "role"]);
  assert.ok(!JSON.stringify(ex).includes("syn-"), "no handle in the manifest's exclusions");
  const of = (id) => ex.filter((e) => e.act_id === id).map((e) => `${e.field}|${e.role}|${e.action}|${e.reason}`);
  assert.deepEqual(of(2), ["payload.holder|party|act_excluded|household_not_yes"]);
  assert.deepEqual(of(4), ["actor|actor|act_excluded|household_not_yes", "payload.holder|party|act_excluded|household_not_yes"]);
  assert.deepEqual(of(5), ["payload.stood_with|speaker|act_excluded|household_not_yes"]);
  assert.deepEqual(of(7), ["payload.aboard|bool|act_excluded|type_mismatch"]);
  assert.deepEqual(of(10), ["payload.payload.spoken_by|speaker|act_excluded|household_not_yes"]);
  assert.deepEqual(of(15), ["payload.holder|bool|act_excluded|type_mismatch"]);
  assert.deepEqual(of(27), ["payload.zzz_unlisted|unclassified|act_excluded|unclassified_field"]);
  assert.deepEqual(of(38), ["payload.declared_by|party|act_excluded|household_not_yes"]);
  assert.deepEqual(of(21), ["payload.moves[0].to|holder|act_excluded|household_not_yes"]);
  assert.deepEqual(of(39), ["payload.moves[0].extra|unclassified|act_excluded|unclassified_field"]);
  assert.deepEqual(of(1), ["witnesses.list[]|bystander|reference_dropped|household_not_yes"]);
  assert.deepEqual(of(40), ["witnesses.list[]|bystander|reference_dropped|household_not_yes", "witnesses.list[]|bystander|reference_dropped|household_not_yes", "witnesses.list[]|bystander|reference_dropped|identity_unresolved"],
    "a household's no, a household's unset and an unmapped name are three different facts");
  // F4: an unmapped holder, a chest in a plain hold and an ambiguous name are identity, not a household's refusal; a set household answer of no or unset is
  assert.deepEqual(of(18), ["payload.holder|party|act_excluded|identity_unresolved"]);
  assert.deepEqual(of(19), ["payload.holder|party|act_excluded|identity_unresolved"]);
  assert.deepEqual(of(34), ["actor|actor|act_excluded|household_not_yes", "payload.declared_by|party|act_excluded|household_not_yes"], "syn-u's household has no answer: unset");
  assert.deepEqual(of(35), ["actor|actor|act_excluded|identity_unresolved", "payload.declared_by|party|act_excluded|identity_unresolved"], "a handle in two households is unresolved");
  // F3: the real set-down, and its controls
  assert.deepEqual(of(47), ["actor|actor|act_excluded|household_not_yes", "payload.moves[0].from|holder|act_excluded|household_not_yes"], "a denied resident's own set-down");
  assert.deepEqual(of(48), ["payload.moves[0].to|ground|act_excluded|type_mismatch"], "a set-down's destination is the ground: null or nothing");
  assert.deepEqual(of(49), ["payload.moves[0].to|holder|act_excluded|type_mismatch"], "a null destination is NOT the ground in a give");
  assert.deepEqual(of(50), ["payload.moves[0].kind|unclassified|act_excluded|unclassified_field"]);
  assert.deepEqual(of(52), ["payload._deferred_act|unclassified|act_excluded|unclassified_field"]);
  assert.deepEqual(of(54), ["payload.amend|unclassified|act_excluded|unclassified_field"]);
  // F7: malformed witnesses and a non-string actor stay at the named type boundary
  assert.deepEqual(of(55), ["witnesses|unclassified|act_excluded|type_mismatch"]);
  assert.deepEqual(of(56), ["witnesses|unclassified|act_excluded|type_mismatch"]);
  assert.deepEqual(of(57), ["witnesses.list[]|bystander|act_excluded|type_mismatch"]);
  assert.deepEqual(of(58), ["actor|actor|act_excluded|type_mismatch"]);
});

test("persisted emission, inner room: an otherwise matched public wrapper admits its words; the same wrapper with ONLY an inner room does not", () => {
  const [pub, priv] = rowsOf([CASES[41], CASES[40]]);
  assert.equal(pub.id, 42);
  assert.equal(priv.id, 41);
  assert.equal(priv.payload.room, undefined, "the OUTER payload carries no room: only payload.payload.room refuses it");
  assert.equal(priv.payload.payload.room, "cellar");
  const strip = (o) => { const { room, text, ...rest } = o.payload; return { ...o, payload: rest }; };
  assert.deepEqual(strip(priv.payload), strip(pub.payload), "the pair differs in the inner room (and its words) alone");
  const jp = judgeAct(pub, consent);
  assert.equal(jp.outcome, "admit");
  assert.equal(jp.act.payload.text, "MARK-42-PUBLIC");
  const jr = judgeAct(priv, consent);
  assert.equal(jr.outcome, "ineligible", "an inner room refuses the whole persisted wrapper");
  assert.equal(jr.reason, "room_private");
  assert.ok(!JSON.stringify(jr).includes("MARK-41-INNERROOM"));
  const both = filterActs([pub, priv], consent);
  assert.deepEqual(both.acts.map((a) => a.id), [42]);
  assert.deepEqual(both.counts.ineligible, { "room_private:legacy:emission": 1 });
});

test("persisted emission wrapper: only a legacy-class line of type emission with a sound inner is a say; a bare `emission` is not carried", () => {
  const rs = rowsOf([CASES[42], CASES[43], CASES[44]]);   // 43 outer class letter, 44 line type letter, 45 bare `emission`
  const [letter, typed, bare] = rs.map((r) => judgeAct(r, consent));
  assert.deepEqual([letter.outcome, letter.reason, letter.class], ["ineligible", "class_unqualified", "letter"]);
  assert.deepEqual([typed.outcome, typed.reason], ["ineligible", "not_a_say"]);
  assert.equal(bare.outcome, "untabled");
  assert.equal(bare.stored_name, "emission");
  assert.ok(!("emission" in ACTION_ALIASES));
  const noInner = JSON.parse(archiveLine(pgRow({ id: 70, at: AT, action: "legacy:emission", class: "legacy", payload: { at: AT, type: "emission", actor: "syn-a", id: "e" } })));
  assert.equal(judgeAct(noInner, consent).reason, "not_a_say", "a wrapper without an inner payload is not a say");
  // an outer key the line never carries is unclassified, and the outer actor is a party
  const extra = JSON.parse(archiveLine(pgRow({ id: 71, at: AT, action: "legacy:emission", class: "legacy", payload: { ...emit({ text: "MARK-71-EXTRA" }), seq: 3 } })));
  assert.deepEqual(filterActs([extra], consent).exclusions.map((e) => `${e.field}|${e.reason}`), ["payload.seq|unclassified_field"]);
  const outerParty = JSON.parse(archiveLine(pgRow({ id: 72, at: AT, action: "legacy:emission", class: "legacy", payload: emit({ text: "MARK-72-OUTER" }, { actor: "syn-n" }) })));
  assert.deepEqual(filterActs([outerParty], consent).exclusions.map((e) => `${e.field}|${e.reason}`), ["payload.actor|household_not_yes"]);
});

test("stored names are counted without becoming object keys: __proto__, constructor and toString count as exactly their integer, in the counters the manifest serializes", () => {
  const names = ["toString", "__proto__", "constructor", "normal", "__proto__", "toString", "toString"];
  const rows = names.map((action, i) => JSON.parse(archiveLine(pgRow({ id: 80 + i, at: AT, action, class: "move", payload: {} }))));
  const res = filterActs(rows, consent);
  const want = { ["__proto__"]: 2, constructor: 1, normal: 1, toString: 3 };
  assert.deepEqual(res.counts.untabled_by_stored_name, want);
  assert.equal(Object.getPrototypeOf(res.counts.untabled_by_stored_name), Object.prototype, "an ordinary object, with `__proto__` an own key");
  assert.equal(JSON.stringify(res.counts.untabled_by_stored_name), '{"__proto__":2,"constructor":1,"normal":1,"toString":3}');
  assert.equal(JSON.parse(JSON.stringify(res.counts)).untabled_by_stored_name.constructor, 1);
  assert.equal(JSON.stringify(filterActs([...rows].reverse(), consent).counts), JSON.stringify(res.counts), "the same window in another order serializes identically");
  assert.equal(res.counts.in_window, 7);
  assert.equal(sumOf(res.counts.untabled_by_stored_name), 7);
  assert.equal(res.acts.length, 0);
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
  assert.deepEqual([9, 20, 22, 23, 24, 46].map((i) => [acts.get(i).action, acts.get(i).stored_action]),
    [["say", "legacy:emission"], ["give", "units:give"], ["take", "units:take"], ["walk", "legacy:departure"], ["enter", "legacy:enter"], ["drop", "units:drop"]]);
  assert.deepEqual(acts.get(46).payload.moves, [{ from: "syn-a", to: null, label: "mint", n: 1 }], "the real set-down keeps its ground destination");
  assert.deepEqual(acts.get(46).payload.at, geo);
  assert.deepEqual([acts.get(51).payload.slot, acts.get(51).payload.value, acts.get(51).payload.parent_id], ["idea", "v", "syn-a/sign"], "a published predicated mark keeps slot and value");
  assert.ok(acts.has(20) && !acts.has(19), "a chest in a units move is a mark (the qualified law); the same string in a plain hold is unchecked, so unknown");
  for (const a of Object.values(ACTION_ALIASES)) { assert.ok(CANONICAL_ACTS.includes(a.canonical), a.canonical); assert.ok(Array.isArray(a.classes) && a.classes.length > 0, `${a.canonical}: every alias names its outer class`); }
  assert.equal(Object.keys(ACTION_ALIASES).length, 16);
  for (const n of ["land", "walks", "legacy:departure2", "units:make", "legacy:leave-mark", "amend", "emission"]) assert.ok(!(n in ACTION_ALIASES), n);
  const wild = filterActs(rowsOf([[50, "legacy:departure2", "legacy", "syn-a", {}, {}], [51, "units:make", "holding", "syn-a", { units: true }, {}]]), consent);
  assert.deepEqual(wild.counts.untabled_by_stored_name, { "legacy:departure2": 1, "units:make": 1 });
  assert.equal(wild.acts.length, 0);
});

test("matched all-consenting control: swapping the denied resident for a consenting one admits every row the rules allow, consented says remain, and nothing changes shape", () => {
  const swapped = CASES.map((c) => JSON.parse(JSON.stringify(c).replaceAll("syn-n", "syn-c")));
  const res = filterActs(rowsOf(swapped), consent);
  const out = outcomeOf(res, swapped);
  // still out for reasons that are NOT a household's no: type mismatches (7 15 48 49 55-58), an unlisted key (27 39 50 52 54), an unmapped or unchecked holder (18 19), unset and ambiguous actors (34 35)
  const stillOut = [7, 15, 18, 19, 27, 34, 35, 39, 48, 49, 50, 52, 54, 55, 56, 57, 58];
  for (const [id] of CASES) {
    const want = stillOut.includes(id) ? "excluded" : CASES[id - 1][6] === "excluded" ? "admit" : expectedOf(CASES[id - 1]);
    assert.equal(out[id], want, `row ${id}`);
  }
  const dump = JSON.stringify(res.acts);
  for (const words of ["MARK-FIVE-WORDS", "MARK-TEN-WORDS"]) assert.ok(dump.includes(words), `${words} remains for a consenting speaker`);
  assert.equal(res.exclusions.filter((e) => e.action === "act_excluded" && (e.reason === "household_not_yes" || e.reason === "identity_unresolved")).filter((e) => ![18, 19, 34, 35].includes(e.act_id)).length, 0,
    "no party exclusion remains except the unmapped, unchecked, unset and ambiguous controls");
  assert.deepEqual(res.acts.find((a) => a.id === 1).witnesses.list.map((w) => w.handle), ["syn-b", "syn-c"], "the consenting bystander's reference stays");
  assert.equal(res.acts.some((a) => a.id === 47), true, "the set-down by a now-consenting resident is carried");
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

// ── reader: the endpoints, the declared set, the line boundary and the diagnostics ──

/** A checkout whose one archive is the given raw text (digest and count honest), so the reader reaches its own line check. */
function rawCheckout(window, text, lines) {
  const dir = join(root, `co-${++seq}`);
  mkdirSync(join(dir, "archives", "acts"), { recursive: true });
  writeFileSync(join(dir, "archives", "acts", `${window}.jsonl`), text);
  const cert = certification({ cursors: { acts_cursor: 9, marks_count: 0 }, windowCursor: window, pins: { law_sha: "syn-law", town_sha: "syn-town" }, marksDigest: "sha256:syn", archives: [{ window, lines, bytes: text }], exportedAt: EXPORTED });
  writeFileSync(join(dir, "CERTIFICATION.json"), JSON.stringify(cert, null, 2) + "\n");
  return dir;
}
const MARKER = "SYN-LEAK-MARKER";
const errOf = (fn) => { try { fn(); } catch (e) { return e; } return null; };

test("reader: the window is inclusive at BOTH ends, and one millisecond outside either end is not in it", () => {
  const { dir } = checkout({ 150: [
    { id: 1, at: "2026-10-01T07:59:59.999Z" }, { id: 2, at: "2026-10-01T08:00:00.000Z" },
    { id: 3, at: "2026-10-01T09:30:00.000Z" },
    { id: 4, at: "2026-10-01T11:00:00.000Z" }, { id: 5, at: "2026-10-01T11:00:00.001Z" },
  ] });
  assert.deepEqual(readCertifiedArchives(dir, W).rows.map((r) => r.id), [2, 3, 4]);
  assert.deepEqual(readCertifiedArchives(dir, { fromMs: W.fromMs, toMs: W.fromMs }).rows.map((r) => r.id), [2], "from == to is a one-instant window, and the instant is in");
});

test("reader: a window declared twice and a line that is not an act each fail NAMED, and no diagnostic carries the bytes it refused", () => {
  const { dir } = checkout({ 150: [{ id: 1, at: "2026-10-01T10:00:00Z" }] });
  const certFile = join(dir, "CERTIFICATION.json");
  const c = JSON.parse(readFileSync(certFile, "utf8"));
  c.archives.push({ ...c.archives[0] });
  writeFileSync(certFile, JSON.stringify(c));
  assert.equal(errOf(() => readCertifiedArchives(dir, W))?.code, "CERT_SHAPE", "a duplicate window is refused, not summed");
  assert.match(errOf(() => readCertifiedArchives(dir, W)).message, /declared twice/);

  const good = archiveLine(pgRow({ id: 1, at: "2026-10-01T10:00:00Z" }));
  const notJson = errOf(() => readCertifiedArchives(rawCheckout(150, `${good}\n{ ${MARKER}\n`, 2), W));
  assert.equal(notJson?.code, "ARCHIVE_LINE");
  assert.match(notJson.message, /line 2 is not JSON/);
  assert.ok(!notJson.message.includes(MARKER));
  const noAt = errOf(() => readCertifiedArchives(rawCheckout(150, `{"id":5,"note":"${MARKER}"}\n`, 1), W));
  assert.equal(noAt?.code, "ARCHIVE_LINE");
  assert.match(noAt.message, /no readable at/);
  assert.ok(!noAt.message.includes(MARKER));
  assert.equal(readCertifiedArchives(rawCheckout(150, `${good}\n`, 1), W).rows.length, 1, "positive control: the same helper with an honest line reads");
});

test("diagnostics: a malformed certificate or registry names its class and never embeds the parser's excerpt of the input", () => {
  // positive control: the platform's own parser message DOES carry the marker, so the assertions below can fail
  assert.ok(errOf(() => JSON.parse(`${MARKER} {`)).message.includes(MARKER), "the parser excerpts its input");

  const { dir } = checkout({ 150: [{ id: 1, at: "2026-10-01T10:00:00Z" }] });
  const certFile = join(dir, "CERTIFICATION.json");
  const good = readFileSync(certFile, "utf8");
  writeFileSync(certFile, `${MARKER} {`);
  const e1 = errOf(() => readCertifiedArchives(dir, W));
  assert.equal(e1?.code, "CERT_UNREADABLE");
  assert.ok(!e1.message.includes(MARKER), e1.message);
  const c = JSON.parse(good);
  c.exported_at = MARKER;
  writeFileSync(certFile, JSON.stringify(c));
  const e2 = errOf(() => readCertifiedArchives(dir, W));
  assert.equal(e2?.code, "CERT_SHAPE");
  assert.ok(!e2.message.includes(MARKER), e2.message);
  writeFileSync(certFile, good);
  assert.equal(readCertifiedArchives(dir, W).rows.length, 1, "restored: the checkout passes again");

  const reg = errOf(() => loadConsentRegistry({ text: `${MARKER} {`, sha: "b", file: "f" }));
  assert.equal(reg?.code, "REGISTRY_UNREADABLE");
  assert.ok(!reg.message.includes(MARKER), reg.message);
  const late = errOf(() => readCertifiedArchives(checkout({ 150: [{ id: 1, at: "2026-10-01T10:00:00Z" }] }, { exportedAt: "2026-10-01T12:00:00.000Z" }).dir, { fromMs: W.fromMs, toMs: T("2026-10-02T00:00:00Z") }));
  assert.equal(late?.code, "WINDOW_AFTER_CERTIFICATE");
  assert.match(late.message, /2026-10-01T12:00:00\.000Z/, "the instants are the parsed ones");
});

// ── composed: certified archives -> reader -> filter ──────────────────────────

/** Archives written by the notary's producer, read by the reader, judged by the filter: the whole road, not two isolated successes. */
const composed = (windows, win = W) => {
  const { dir } = checkout(windows);
  const read = readCertifiedArchives(dir, win);
  return { read, res: filterActs(read.rows, consent) };
};
const GEO = { x: 1, y: 2 };
const walkP = (o = {}) => ({ from: GEO, toward: GEO, pace: 1, within: null, to: null, declared_by: "syn-a", ...o });

test("composed N1: a late arrival keeps its old at in a LATER archive and reaches the filter with the pen's two metadata fields; a denied party and a private room still fail; a matched non-late row is the control", () => {
  const D = (hhmm) => `2026-10-01T${hhmm}:00.000Z`;
  const { read, res } = composed({
    150: [{ id: 1, at: D("10:00"), crossing: 150, action: "walk", class: "move", payload: walkP() }],
    151: [
      // 2: a stake released a late PUBLIC mark: no put_forward in the payload (the held row is the compose-time row), the stamp added by the pen
      { id: 2, at: D("09:00"), crossing: 151, action: "leave-mark", class: "mark", object: "syn-a/late", payload: { slug: "syn-a/late", kind: "sited", at: GEO, body: "MARK-LATE-MARK", by: "syn-a", date: D("09:00"), ...LATE_META } },
      { id: 3, at: D("09:05"), crossing: 151, action: "walk", class: "move", payload: walkP({ declared_by: "syn-n", ...LATE_META }) },
      { id: 4, at: D("09:10"), crossing: 151, action: "say", class: "voice", payload: { text: "MARK-LATE-ROOM", place: null, room: "cellar", ...LATE_META } },
      { id: 5, at: D("09:15"), crossing: 151, action: "say", class: "voice", payload: { text: "MARK-LATE-PUBLIC", place: null, late_from_crossing: 150, late_arrival: OPERATOR_NOTE } },
      // 6: the matched control of 5 — identical but for the stamp
      { id: 6, at: D("09:30"), crossing: 151, action: "say", class: "voice", payload: { text: "MARK-NONLATE-PUBLIC", place: null } },
      { id: 7, at: D("09:40"), crossing: 151, action: "say", class: "voice", payload: { text: "MARK-LATE-STRING", place: null, late_from_crossing: "150", late_arrival: LATE_REASON } },
      { id: 8, at: D("09:45"), crossing: 151, action: "say", class: "voice", payload: { text: "MARK-LATE-HALF", place: null, late_arrival: LATE_REASON } },
      { id: 9, at: "2026-10-05T09:00:00.000Z", crossing: 151, action: "say", class: "voice", payload: { text: "MARK-LATE-OUTSIDE", place: null, ...LATE_META } },
    ],
  });
  assert.deepEqual(read.rows.map((r) => r.id), [2, 3, 4, 5, 6, 7, 8, 1], "the reader finds every in-window row, late ones from the later archive, in at order; id 9 is outside");
  assert.deepEqual(res.acts.map((a) => a.id), [2, 5, 6, 1], "the late public mark and the late public say are carried beside their non-late control");
  assert.deepEqual(res.acts.map((a) => a.at), [D("09:00"), D("09:15"), D("09:30"), D("10:00")], "act.at is the old instant, untouched");
  const byId = new Map(res.acts.map((a) => [a.id, a]));
  assert.equal(byId.get(2).crossing, 151, "the crossing is the window it arrived in");
  assert.equal(byId.get(2).payload.late_from_crossing, 150, "the stamp's number travels as it was stored");
  for (const id of [2, 5]) assert.ok(!("late_arrival" in byId.get(id).payload), `act ${id}: the operator's reason text is validated and not projected`);
  const wire = JSON.stringify(res);
  for (const note of ["OPERATOR-NOTE-CANARY-4417", "syn-operator", LATE_REASON, "postmark#2722"]) assert.ok(!wire.includes(note), `the reason text "${note.slice(0, 24)}" is nowhere in the serialized result`);
  assert.ok(!("put_forward" in byId.get(2).payload), "a released public mark has no put_forward and is still a deed");
  assert.ok(!("late_from_crossing" in byId.get(6).payload) && !("late_arrival" in byId.get(6).payload), "the non-late control carries no stamp");
  assert.equal(res.counts.in_window, 8);
  assert.equal(res.counts.admitted, 4);
  assert.equal(res.counts.excluded_acts, 3);
  assert.deepEqual(res.counts.excluded_by_reason, { household_not_yes: 1, type_mismatch: 2 });
  assert.deepEqual(res.counts.ineligible, { "room_private:say": 1 });
  assert.deepEqual(res.counts.untabled_by_stored_name, {});
  const of = (id) => res.exclusions.filter((e) => e.act_id === id).map((e) => `${e.field}|${e.role}|${e.action}|${e.reason}`);
  assert.deepEqual(of(3), ["payload.declared_by|party|act_excluded|household_not_yes"], "the stamp does not make a denied party consent");
  assert.deepEqual(of(7), ["payload.late_from_crossing|crossnum|act_excluded|type_mismatch"], "a stringly crossing is not the pen's number");
  assert.deepEqual(of(8), ["payload.late_arrival|late|act_excluded|type_mismatch"], "the stamp is a pair");
  const dump = JSON.stringify(res.acts);
  for (const w of ["MARK-LATE-MARK", "MARK-LATE-PUBLIC", "MARK-NONLATE-PUBLIC"]) assert.ok(dump.includes(w), w);
  for (const w of ["MARK-LATE-ROOM", "MARK-LATE-STRING", "MARK-LATE-HALF", "MARK-LATE-OUTSIDE"]) assert.ok(!dump.includes(w), `${w} is not carried`);
});

test("composed N2: BOTH stored profiles of legacy:departure reach the filter through their own discriminator; a denied actor, an unknown field and a wrong or missing discriminator are controls", () => {
  const T2 = (n) => `2026-10-01T09:${String(n).padStart(2, "0")}:00.000Z`;
  const ledger = (o = {}) => ({ iso: T2(11), handle: "syn-a", from: GEO, toward: GEO, at: 150.5, targetExtent: null, targetMarkId: null, pace: null, line: "RAW-LEDGER-LINE-11 syn-n", _ledger: "WORLD/walk-ledger.md", ...o });
  const line = (inner = {}, outer = {}) => ({ at: T2(12), type: "departure", actor: "syn-a", seq: 42, payload: { from: GEO, toward: GEO, crossing: 150.5, within: null, to: null, pace: 1.5, declared_by: "syn-a", source: "acts", ...inner }, ...outer });
  const rows = [
    [11, ledger()], [12, line()], [13, line({ declared_by: "syn-n" })], [14, line({}, { actor: "syn-n" })], [15, line({ zzz: 1 })],
    [16, line({}, { type: "landing" })], [17, { at: T2(12), type: "departure", actor: "syn-a", seq: 42 }],
    [18, { ...ledger(), type: "departure" }], [19, { foo: 1 }], [20, ledger({ handle: "syn-n" })], [21, line({}, { room: "cellar" })],
  ].map(([id, payload]) => ({ id, at: T2(id), crossing: 150, action: "legacy:departure", class: "legacy", payload }));
  const { read, res } = composed({ 150: rows });
  assert.deepEqual(read.rows.map((r) => r.id), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  assert.deepEqual(res.acts.map((a) => a.id), [11, 12], "one act from each profile");
  assert.deepEqual(res.acts.map((a) => [a.action, a.stored_action]), [["walk", "legacy:departure"], ["walk", "legacy:departure"]]);
  assert.deepEqual(res.acts[0].payload, { iso: T2(11), handle: "syn-a", from: GEO, toward: GEO, at: 150.5, targetExtent: null, targetMarkId: null, pace: null }, "the flat ledger row keeps its parsed fields and drops its raw line");
  assert.deepEqual(res.acts[1].payload, { from: GEO, toward: GEO, crossing: 150.5, within: null, to: null, pace: 1.5, declared_by: "syn-a", source: "acts", line_at: T2(12) }, "the stored line's payload, with its own instant");
  assert.equal(res.counts.in_window, 11);
  assert.equal(res.counts.admitted, 2);
  assert.equal(res.counts.excluded_acts, 4);
  assert.deepEqual(res.counts.excluded_by_reason, { household_not_yes: 3, unclassified_field: 1 });
  assert.deepEqual(res.counts.ineligible, { "not_a_departure:legacy:departure": 4, "room_private:legacy:departure": 1 });
  const of = (id) => res.exclusions.filter((e) => e.act_id === id).map((e) => `${e.field}|${e.role}|${e.action}|${e.reason}`);
  assert.deepEqual(of(13), ["payload.payload.declared_by|party|act_excluded|household_not_yes"]);
  assert.deepEqual(of(14), ["payload.actor|party|act_excluded|household_not_yes"], "the line's own actor is a party");
  assert.deepEqual(of(15), ["payload.payload.zzz|unclassified|act_excluded|unclassified_field"]);
  assert.deepEqual(of(20), ["payload.handle|party|act_excluded|household_not_yes"]);
  assert.ok(!JSON.stringify(res.acts).includes("RAW-LEDGER-LINE-11"));
  // rows 16-19: a wrong discriminator, a wrapper without its inner payload, a flat row that also claims to be a line, and neither shape — none is unwrapped or guessed
  for (const id of [16, 17, 18, 19]) assert.deepEqual(of(id), [], `row ${id} is ineligible before roles`);
});
