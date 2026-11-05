// moment-export-world.test.mjs — the founder moment export's blessed timeline and local World inputs (POS-780, increment 2).
//
// EVERY repository, tag, time, World state, skeleton, registry, certificate, archive and marker below is invented. The World
// repositories are real git repositories built in a temp directory with `git` itself, so the reader is proved against what git
// stores (annotated tag objects, peeled commits, tagger and committer dates) and not against its own parser. Dates are given to
// git as "<unix seconds> <tz>" in the environment of each child process only; no git configuration is written anywhere.
// Expectations are fixed literals written before the run. The commit dates are deliberately NOT the tagger dates, and HEAD is
// deliberately NOT any tagged commit, so a reader that takes either one cannot pass.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { archiveLine, certification } from "../world2/tools/snapshot-export.mjs";
import { readCertifiedArchives, loadConsentRegistry, filterActs } from "../tools/moment-export-core.mjs";
import {
  readSettlementTags, resolveSegments, segmentAt, readSegmentInputs, planWorldInputs, ExportWorldError, SEGMENT_CLOCK,
} from "../tools/moment-export-world.mjs";

const root = mkdtempSync(join(tmpdir(), "moment-export-world-"));
after(() => rmSync(root, { recursive: true, force: true }));

const T = (iso) => Date.parse(iso);
const unix = (iso, tz = "+0000") => `${Math.floor(T(iso) / 1000)} ${tz}`;
const errOf = (fn) => { try { fn(); } catch (e) { return e; } return null; };
const codeOf = (fn) => { const e = errOf(fn); return e instanceof ExportWorldError ? e.code : (e ? `OTHER ${e.message}` : "NO ERROR"); };

/**
 * A World repository from a list of commits: { state, skeleton (null: absent), commitAt, tag: { n, at, kind } }.
 * kind "annotated" (default), "lightweight", or "tag-of-tag" (tags the previous tag's object). Returns { dir, shas, git }.
 */
let seq = 0;
function makeWorld(commits) {
  const dir = join(root, `world-${++seq}`);
  mkdirSync(dir, { recursive: true });
  const g = (args, at = null) => execFileSync("git", ["-C", dir, "-c", "user.name=syn-keeper", "-c", "user.email=syn@t.invalid", ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: at ? { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : process.env,
  });
  g(["init", "-q", "-b", "main"]);
  const shas = [];
  for (const [i, c] of commits.entries()) {
    mkdirSync(join(dir, "WORLD"), { recursive: true });
    const put = (name, v) => { if (v === null) rmSync(join(dir, "WORLD", name), { force: true }); else writeFileSync(join(dir, "WORLD", name), typeof v === "string" ? v : JSON.stringify(v)); };
    put("world-state.json", c.state === undefined ? { marks: [{ id: `syn/mark-${i + 1}` }], note: `STATE-C${i + 1}` } : c.state);
    put("skeleton.json", c.skeleton === undefined ? { regions: [`syn-region-${i + 1}`] } : c.skeleton);
    g(["add", "-A"]);
    g(["commit", "-q", "-m", `syn commit ${i + 1}`, "--allow-empty"], unix(c.commitAt));
    shas.push(g(["rev-parse", "HEAD"]).trim());
    if (c.tag) {
      const name = `settlement/S${c.tag.n}`;
      if (c.tag.kind === "lightweight") g(["tag", name, shas[i]]);
      else if (c.tag.kind === "tag-of-tag") g(["tag", "-a", "-m", `S${c.tag.n}`, name, `refs/tags/settlement/S${c.tag.of}`], unix(c.tag.at, c.tag.tz));
      else g(["tag", "-a", "-m", `S${c.tag.n}`, name, shas[i]], unix(c.tag.at, c.tag.tz));
    }
  }
  return { dir, shas, git: (...a) => g(a) };
}

// The standard repository. Tagger times are NOT the commit times (hours apart), the tags carry different zones, and C4 (HEAD) is untagged.
const S1 = "2026-10-01T06:00:00.000Z", S2 = "2026-10-02T06:00:00.000Z", S3 = "2026-10-02T18:00:00.000Z";
const standard = () => makeWorld([
  { commitAt: "2026-10-01T05:00:00Z", tag: { n: 1, at: S1, tz: "-0400" } },
  { commitAt: "2026-10-01T20:00:00Z", tag: { n: 2, at: S2, tz: "+0200" } },
  { commitAt: "2026-10-02T10:00:00Z", tag: { n: 3, at: S3, tz: "+0000" } },
  { commitAt: "2026-10-03T01:00:00Z" },
]);
const W = standard();
const [C1, C2, C3, C4] = W.shas;
const tagObject = (n) => W.git("rev-parse", `refs/tags/settlement/S${n}`).trim();

test("timeline: blessed_at is the TAGGER time and world_sha is the tag PEELED to its commit; the commit date, the tag object and HEAD are none of them", () => {
  const tl = readSettlementTags(W.dir);
  assert.deepEqual(tl.unqualified, []);
  assert.deepEqual(tl.tags.map((t) => [t.n, t.tag, t.blessed_at, t.world_sha]), [
    [1, "settlement/S1", S1, C1], [2, "settlement/S2", S2, C2], [3, "settlement/S3", S3, C3],
  ]);
  assert.deepEqual(Object.keys(tl.tags[0]).sort(), ["blessed_at", "blessed_at_ms", "n", "tag", "world_sha"]);
  for (const n of [1, 2, 3]) assert.notEqual(tl.tags[n - 1].world_sha, tagObject(n), `S${n}: the tag object's own sha is not the World sha`);
  assert.notEqual(C4, C3, "HEAD is not any tagged commit");
  assert.equal(W.git("rev-parse", "HEAD").trim(), C4);
  // the fixture really separates the three clocks: committer date != tagger date for every tag
  for (const [i, tagAt] of [[1, S1], [2, S2], [3, S3]]) {
    const committed = W.git("log", "-1", "--format=%cI", [C1, C2, C3][i - 1]).trim();
    assert.notEqual(new Date(committed).toISOString(), tagAt, `S${i}: the commit date differs from the tagger date`);
  }
});

test("segments: within one settlement, across several blessings, and at the exact instants; every segment record is exactly {from,to,settlement,world_sha}", () => {
  const tl = readSettlementTags(W.dir);
  const plan = (from, to) => resolveSegments(tl, { fromMs: T(from), toMs: T(to) });
  const one = plan("2026-10-02T08:00:00.000Z", "2026-10-02T12:00:00.000Z");
  assert.equal(one.segment_clock, "blessed_at");
  assert.equal(SEGMENT_CLOCK, "blessed_at");
  assert.deepEqual(one.segments, [{ from: "2026-10-02T08:00:00.000Z", to: "2026-10-02T12:00:00.000Z", settlement: 2, world_sha: C2 }]);

  const across = plan("2026-10-01T10:00:00.000Z", "2026-10-02T20:00:00.000Z");
  assert.deepEqual(across.segments, [
    { from: "2026-10-01T10:00:00.000Z", to: S2, settlement: 1, world_sha: C1 },
    { from: S2, to: S3, settlement: 2, world_sha: C2 },
    { from: S3, to: "2026-10-02T20:00:00.000Z", settlement: 3, world_sha: C3 },
  ]);
  for (const s of across.segments) assert.deepEqual(Object.keys(s).sort(), ["from", "settlement", "to", "world_sha"]);

  // a window starting AT a blessing is in that settlement, not the one before
  assert.deepEqual(plan(S2, "2026-10-02T07:00:00.000Z").segments, [{ from: S2, to: "2026-10-02T07:00:00.000Z", settlement: 2, world_sha: C2 }]);
  // a window ending one millisecond before a blessing does not include it; ending ON it includes it, for that final instant
  assert.deepEqual(plan(S2, "2026-10-02T17:59:59.999Z").segments.map((s) => s.settlement), [2]);
  const endsOn = plan(S2, S3);
  assert.deepEqual(endsOn.segments, [{ from: S2, to: S3, settlement: 2, world_sha: C2 }, { from: S3, to: S3, settlement: 3, world_sha: C3 }]);
  // the same rule as a function: the boundary instant is the NEW settlement's, once; the final instant is inside the last segment
  const at = (iso) => segmentAt(endsOn.segments, T(iso))?.settlement ?? null;
  assert.deepEqual([at(S2), at("2026-10-02T17:59:59.999Z"), at(S3), at("2026-10-02T18:00:00.001Z"), at("2026-10-02T05:59:59.999Z")], [2, 2, 3, null, null]);
  assert.deepEqual(plan(S1, S1).segments, [{ from: S1, to: S1, settlement: 1, world_sha: C1 }], "a one-instant window at S1's blessing is S1's");
});

test("refusals: a window before the first blessing, no tags, a bad window, an unreadable or lightweight tag, a tie, a disorder and a bad repository each fail NAMED", () => {
  const tl = readSettlementTags(W.dir);
  const resolve = (t, from, to) => () => resolveSegments(t, { fromMs: T(from), toMs: T(to) });
  assert.equal(codeOf(resolve(tl, "2026-10-01T05:59:59.999Z", "2026-10-01T08:00:00.000Z")), "WINDOW_BEFORE_FIRST_BLESSING");
  assert.doesNotThrow(resolve(tl, S1, "2026-10-01T08:00:00.000Z"), "control: starting at the first blessing is fine");
  assert.equal(codeOf(() => resolveSegments(tl, { fromMs: 5, toMs: 1 })), "WINDOW_INVALID");
  assert.equal(codeOf(() => resolveSegments(tl, { fromMs: NaN, toMs: 1 })), "WINDOW_INVALID");

  const none = makeWorld([{ commitAt: "2026-10-01T05:00:00Z" }]);
  assert.equal(codeOf(() => planWorldInputs(none.dir, { fromMs: T(S1), toMs: T(S2) })), "SETTLEMENTS_NONE");

  // S2 is lightweight (no tagger time): it may be the one in force inside the window, so the window refuses; the reader lists it, unrepaired
  const light = makeWorld([
    { commitAt: "2026-10-01T05:00:00Z", tag: { n: 1, at: S1 } },
    { commitAt: "2026-10-01T20:00:00Z", tag: { n: 2, kind: "lightweight" } },
    { commitAt: "2026-10-02T10:00:00Z", tag: { n: 3, at: S3 } },
  ]);
  const ltl = readSettlementTags(light.dir);
  assert.deepEqual(ltl.unqualified.map((u) => [u.n, u.why]), [[2, "lightweight_tag"]]);
  assert.deepEqual(ltl.tags.map((t) => t.n), [1, 3]);
  assert.equal(codeOf(resolve(ltl, "2026-10-01T10:00:00.000Z", "2026-10-02T20:00:00.000Z")), "SETTLEMENT_UNQUALIFIED");
  // a tag of a tag does not peel to a commit; it is listed as such
  const nested = makeWorld([
    { commitAt: "2026-10-01T05:00:00Z", tag: { n: 1, at: S1 } },
    { commitAt: "2026-10-01T20:00:00Z", tag: { n: 9, kind: "tag-of-tag", of: 1, at: S3 } },
  ]);
  assert.deepEqual(readSettlementTags(nested.dir).unqualified.map((u) => [u.n, u.why]), [[9, "tag_does_not_peel_to_a_commit"]]);
  // bounded: an unreadable NEWER tag cannot be in a window that ended before a lower-numbered blessing; unbounded, it refuses
  const tail = makeWorld([
    { commitAt: "2026-10-01T05:00:00Z", tag: { n: 1, at: S1 } },
    { commitAt: "2026-10-01T20:00:00Z", tag: { n: 2, at: S2 } },
    { commitAt: "2026-10-02T10:00:00Z", tag: { n: 3, at: S3 } },
    { commitAt: "2026-10-02T11:00:00Z", tag: { n: 4, kind: "lightweight" } },
  ]);
  const ttl = readSettlementTags(tail.dir);
  assert.deepEqual(resolveSegments(ttl, { fromMs: T("2026-10-02T08:00:00.000Z"), toMs: T("2026-10-02T12:00:00.000Z") }).segments.map((s) => s.settlement), [2], "bounded by S3: control passes");
  assert.equal(codeOf(resolve(ttl, "2026-10-02T08:00:00.000Z", "2026-10-02T20:00:00.000Z")), "SETTLEMENT_UNQUALIFIED", "unbounded: S4 may be inside");

  // two blessings at one instant: which is in force is not decided
  const tie = makeWorld([
    { commitAt: "2026-10-01T05:00:00Z", tag: { n: 1, at: S1 } },
    { commitAt: "2026-10-01T20:00:00Z", tag: { n: 2, at: S2 } },
    { commitAt: "2026-10-02T10:00:00Z", tag: { n: 3, at: S2, tz: "-0700" } },
  ]);
  const tietl = readSettlementTags(tie.dir);
  assert.equal(codeOf(resolve(tietl, "2026-10-01T10:00:00.000Z", "2026-10-02T20:00:00.000Z")), "TIMELINE_AMBIGUOUS", "inside the window");
  assert.equal(codeOf(resolve(tietl, S2, "2026-10-02T20:00:00.000Z")), "TIMELINE_AMBIGUOUS", "at the window's start");
  assert.doesNotThrow(resolve(tietl, S1, "2026-10-02T05:00:00.000Z"), "control: a window that ends before the tie is fine");
  // a higher number blessed EARLIER than a lower one: the clock disagrees with the count
  const disorder = makeWorld([
    { commitAt: "2026-10-01T05:00:00Z", tag: { n: 2, at: S3 } },
    { commitAt: "2026-10-01T20:00:00Z", tag: { n: 3, at: S2 } },
  ]);
  assert.equal(codeOf(resolve(readSettlementTags(disorder.dir), "2026-10-02T20:00:00.000Z", "2026-10-02T21:00:00.000Z")), "TIMELINE_ORDER");

  // a bad repository: missing path, a plain directory, a subdirectory of another repository
  assert.equal(codeOf(() => readSettlementTags(join(root, "no-such-dir"))), "WORLD_REPO");
  const plain = join(root, "plain"); mkdirSync(plain);
  assert.equal(codeOf(() => readSettlementTags(plain)), "WORLD_REPO");
  assert.equal(codeOf(() => readSettlementTags(join(W.dir, "WORLD"))), "WORLD_REPO", "another repository's tags are not read through a subdirectory");
  assert.equal(codeOf(() => readSettlementTags("")), "WORLD_REPO");
});

test("inputs: each segment's WORLD/world-state.json and WORLD/skeleton.json come from ITS OWN sha; HEAD never leaks; the plan is not a manifest", () => {
  const plan = planWorldInputs(W.dir, { fromMs: T("2026-10-01T10:00:00.000Z"), toMs: T("2026-10-02T20:00:00.000Z") });
  assert.deepEqual(Object.keys(plan), ["segment_clock", "segments", "internal_inputs"], "no manifest, bundle, completeness or success key");
  assert.equal(plan.segment_clock, "blessed_at");
  assert.deepEqual(plan.segments.map((s) => [s.settlement, s.world_sha]), [[1, C1], [2, C2], [3, C3]]);
  assert.deepEqual(plan.internal_inputs.map((i) => [i.settlement, i.world_sha, i.worldState.note, i.skeleton.regions[0]]), [
    [1, C1, "STATE-C1", "syn-region-1"], [2, C2, "STATE-C2", "syn-region-2"], [3, C3, "STATE-C3", "syn-region-3"],
  ]);
  assert.deepEqual(plan.internal_inputs.map((i) => i.worldState.marks[0].id), ["syn/mark-1", "syn/mark-2", "syn/mark-3"]);
  const wire = JSON.stringify(plan);
  assert.ok(!wire.includes("STATE-C4") && !wire.includes("syn-region-4") && !wire.includes(C4), "HEAD's world is nowhere in the plan");
  // the same read directly, at one sha
  assert.equal(readSegmentInputs(W.dir, C2).worldState.note, "STATE-C2");

  // the matched complete control above passes; now each required input, missing or corrupt, refuses (and the control windows beside it still pass)
  const MARK = "SYN-LEAK-MARKER";
  const bad = makeWorld([
    { commitAt: "2026-10-01T05:00:00Z", tag: { n: 1, at: S1 } },
    { commitAt: "2026-10-01T20:00:00Z", skeleton: null, tag: { n: 2, at: S2 } },
    { commitAt: "2026-10-02T10:00:00Z", state: `{ ${MARK}`, tag: { n: 3, at: S3 } },
    { commitAt: "2026-10-02T11:00:00Z", state: "[]", tag: { n: 4, at: "2026-10-02T19:00:00.000Z" } },
  ]);
  const win = (from, to) => () => planWorldInputs(bad.dir, { fromMs: T(from), toMs: T(to) });
  assert.doesNotThrow(win("2026-10-01T10:00:00.000Z", "2026-10-01T12:00:00.000Z"), "control: a window inside S1 reads S1's good inputs");
  assert.equal(codeOf(win("2026-10-01T10:00:00.000Z", "2026-10-02T08:00:00.000Z")), "INPUT_MISSING", "S2 has no skeleton");
  const corrupt = errOf(win("2026-10-02T18:10:00.000Z", "2026-10-02T18:30:00.000Z"));
  assert.equal(corrupt?.code, "INPUT_CORRUPT", "S3's world state is not JSON");
  assert.ok(!corrupt.message.includes(MARK), "the refusal never carries the file's text");
  assert.equal(codeOf(win("2026-10-02T19:30:00.000Z", "2026-10-02T20:00:00.000Z")), "INPUT_CORRUPT", "S4's world state is JSON but not an object");
  assert.equal(codeOf(() => readSegmentInputs(W.dir, "HEAD")), "INPUT_MISSING", "a ref name is not a sha");
  assert.equal(codeOf(() => readSegmentInputs(W.dir, "0".repeat(40))), "INPUT_MISSING", "an unknown sha refuses");
});

test("the reader changes nothing and imports only node builtins", () => {
  const snap = () => [W.git("for-each-ref"), W.git("rev-parse", "HEAD"), W.git("status", "--porcelain")].join("|");
  const before = snap();
  planWorldInputs(W.dir, { fromMs: T(S1), toMs: T(S3) });
  readSettlementTags(W.dir);
  assert.equal(snap(), before, "refs, HEAD and the work tree are exactly as they were");
  const src = readFileSync(new URL("../tools/moment-export-world.mjs", import.meta.url), "utf8");
  const specs = [...src.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gm)].map((m) => m[1]).sort();
  assert.deepEqual(specs, ["node:child_process", "node:fs"]);
  assert.ok(!/\bfetch\b|\bpull\b|\bclone\b|process\.env|\bwriteFile/.test(src.replace(/\/\/.*$/gm, "")), "no network, repair or write verb in code");
});

// ── composed: certified archive -> reader -> filter -> timeline and inputs ────

const REGISTRY = JSON.stringify({ households: {
  "syn-house-a": { residents: ["syn-a"], likeness: { answer: "yes", at: "2026-10-20T00:00:00.000Z", words: "2026-10-21" } },
  "syn-house-n": { residents: ["syn-n"], likeness: { answer: "no", at: "2026-10-23T00:00:00.000Z", words: "2026-10-21" } },
} });
const consent = loadConsentRegistry({ text: REGISTRY, sha: "a".repeat(40), file: "tools/households.json" });

test("composed: the archive reader and consent filter keep their gates, and each admitted act falls in a segment whose inputs are its own", () => {
  const dir = join(root, "co-archive");
  mkdirSync(join(dir, "archives", "acts"), { recursive: true });
  const geo = { x: 1, y: 2 };
  const row = (id, at, actor, action, cls, payload) => ({
    id: String(id), at: new Date(at), crossing: "200", actor, action, object: null, at_anchor: null, at_dx: null, at_dy: null,
    witnesses: null, class: cls, payload, effect: null, household: null, journal_seq: null, inserted_at: new Date("2026-10-02T12:00:00.000Z"),
  });
  const rows = [
    row(1, "2026-10-02T05:00:00.000Z", "syn-a", "say", "voice", { text: "MARK-SEG-ONE", place: null }),
    row(2, "2026-10-02T07:00:00.000Z", "syn-a", "walk", "move", { from: geo, toward: geo, pace: 1, within: null, to: null, declared_by: "syn-a" }),
    row(3, "2026-10-02T07:30:00.000Z", "syn-a", "walk", "move", { from: geo, toward: geo, pace: 1, within: null, to: null, declared_by: "syn-n" }),
    row(4, "2026-10-02T19:00:00.000Z", "syn-a", "say", "voice", { text: "MARK-SEG-THREE", place: null }),
  ];
  const bytes = rows.map((r) => archiveLine(r)).join("\n") + "\n";
  writeFileSync(join(dir, "archives", "acts", "150.jsonl"), bytes);
  const cert = certification({ cursors: { acts_cursor: 9, marks_count: 0 }, windowCursor: 150, pins: { law_sha: "syn-law", town_sha: "syn-town" }, marksDigest: "sha256:syn", archives: [{ window: 150, lines: rows.length, bytes }], exportedAt: "2026-10-03T00:00:00.000Z" });
  writeFileSync(join(dir, "CERTIFICATION.json"), JSON.stringify(cert, null, 2) + "\n");

  const win = { fromMs: T("2026-10-02T04:00:00.000Z"), toMs: T("2026-10-02T19:30:00.000Z") };
  const read = readCertifiedArchives(dir, win);
  const res = filterActs(read.rows, consent);
  const plan = planWorldInputs(W.dir, win);

  assert.equal(read.coverage.coverage, "certified-snapshot");
  assert.deepEqual(read.rows.map((r) => r.id), [1, 2, 3, 4]);
  assert.deepEqual(res.acts.map((a) => a.id), [1, 2, 4], "the denied party's act is out; the qualified gates still decide");
  assert.deepEqual(res.counts.excluded_by_reason, { household_not_yes: 1 });
  assert.deepEqual(plan.segments.map((s) => [s.settlement, s.from, s.to]), [
    [1, "2026-10-02T04:00:00.000Z", S2], [2, S2, S3], [3, S3, "2026-10-02T19:30:00.000Z"],
  ]);
  const inSegment = (a) => segmentAt(plan.segments, Date.parse(a.at))?.settlement;
  assert.deepEqual(res.acts.map(inSegment), [1, 2, 3], "each admitted act lies in the segment whose world was in force when it happened");
  const stateNote = (n) => plan.internal_inputs.find((i) => i.settlement === n).worldState.note;
  assert.deepEqual(res.acts.map((a) => stateNote(inSegment(a))), ["STATE-C1", "STATE-C2", "STATE-C3"]);
  // no completeness is claimed anywhere: this is a plan for a later step, and the words of the refused act are nowhere
  assert.deepEqual(Object.keys(plan), ["segment_clock", "segments", "internal_inputs"]);
  assert.ok(!JSON.stringify([res, plan]).includes("STATE-C4"));
});
