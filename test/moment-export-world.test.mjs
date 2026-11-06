// moment-export-world.test.mjs — the founder moment export's blessed timeline and local World inputs (POS-780, increment 2 and its FIX 1 correction).
//
// EVERY repository, tag, time, World state, skeleton, registry, certificate, archive, origin URL, credential marker and listener below is invented. The World
// repositories are real git repositories built in a temp directory with `git` itself, so the reader is proved against what git
// stores (annotated tag objects, peeled commits, tagger and committer dates) and not against its own parser. Dates are given to
// git as "<unix seconds> <tz>" in the environment of each child process only; no git configuration is written anywhere but into the
// fixture repositories themselves. Expectations are fixed literals written before the run. The commit dates are deliberately NOT
// the tagger dates, and HEAD is deliberately NOT any tagged commit, so a reader that takes either one cannot pass.
//
// THE CORRECTION (POS-780, Wright 2026-11-05T15:22 "World refs TRUSTED precondition", and Root's W4/W2/W3 decisions): a tag of a tag
// peels to its commit (the clock stays the OUTER tag's); the child git is local, noninteractive and bounded; an unreadable tag is
// bounded out of a window only by a chronology that follows the numbers; the newest tag must be blessed at or after the window's end;
// and the plan carries the trusted repository's provenance. The one loopback listener below is OWNED by this file and only counts
// connections: no test contacts anything else.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { archiveLine, certification } from "../world2/tools/snapshot-export.mjs";
import { readCertifiedArchives, loadConsentRegistry, filterActs } from "../tools/moment-export-core.mjs";
// The module is imported as a namespace so that a run against an OLDER copy of it (the pre-correction baseline) loads and reds case by case, instead
// of every case failing at import for the one reason that two names are not exported yet.
import * as world from "../tools/moment-export-world.mjs";
const { readSettlementTags, resolveSegments, segmentAt, readSegmentInputs, planWorldInputs, ExportWorldError, SEGMENT_CLOCK } = world;
const sanitizeOrigin = (raw) => { assert.equal(typeof world.sanitizeOrigin, "function", "the module exports sanitizeOrigin"); return world.sanitizeOrigin(raw); };
const preconditionText = () => { assert.equal(typeof world.TRUSTED_WORLD_PRECONDITION, "string", "the module exports TRUSTED_WORLD_PRECONDITION"); return world.TRUSTED_WORLD_PRECONDITION; };

const root = mkdtempSync(join(tmpdir(), "moment-export-world-"));
after(() => rmSync(root, { recursive: true, force: true }));

const T = (iso) => Date.parse(iso);
const unix = (iso, tz = "+0000") => `${Math.floor(T(iso) / 1000)} ${tz}`;
const errOf = (fn) => { try { fn(); } catch (e) { return e; } return null; };
const codeOf = (fn) => { const e = errOf(fn); return e instanceof ExportWorldError ? e.code : (e ? `OTHER ${e.message}` : "NO ERROR"); };
const msgOf = (fn) => String(errOf(fn)?.message ?? "");

/**
 * A World repository from a list of commits: { state, skeleton (null: absent), commitAt, tag: { n, at, tz, kind } }.
 * kind "annotated" (default), "lightweight", "nested" (an outer tag whose target is an inner tag whose target is the commit: three
 * objects built with `git mktag` and `update-ref`, never a porcelain whose default target varies by version; the inner has its own
 * `innerAt`/`innerTz`) or "tag-of-tree" (an annotated tag whose target is the commit's TREE). `opts.origin` sets remote.origin.url in the
 * fixture repository only. Returns { dir, shas, nested, git }.
 */
let seq = 0;
function makeWorld(commits, opts = {}) {
  const dir = join(root, `world-${++seq}`);
  mkdirSync(dir, { recursive: true });
  const g = (args, at = null) => execFileSync("git", ["-C", dir, "-c", "user.name=syn-keeper", "-c", "user.email=syn@t.invalid", ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: at ? { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : process.env,
  });
  const mk = (text) => execFileSync("git", ["-C", dir, "mktag"], { input: text, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  g(["init", "-q", "-b", "main"]);
  if (opts.origin) g(["config", "remote.origin.url", opts.origin]);
  const shas = [], nested = {};
  for (const [i, c] of commits.entries()) {
    mkdirSync(join(dir, "WORLD"), { recursive: true });
    const put = (name, v) => { if (v === null) rmSync(join(dir, "WORLD", name), { force: true }); else writeFileSync(join(dir, "WORLD", name), typeof v === "string" ? v : JSON.stringify(v)); };
    put("world-state.json", c.state === undefined ? { marks: [{ id: `syn/mark-${i + 1}` }], note: `STATE-C${i + 1}` } : c.state);
    put("skeleton.json", c.skeleton === undefined ? { regions: [`syn-region-${i + 1}`] } : c.skeleton);
    g(["add", "-A"]);
    g(["commit", "-q", "-m", `syn commit ${i + 1}`, "--allow-empty"], unix(c.commitAt));
    shas.push(g(["rev-parse", "HEAD"]).trim());
    if (c.tag) {
      const t = c.tag, name = `settlement/S${t.n}`;
      const tagger = (at, tz) => `tagger syn-keeper <syn@t.invalid> ${unix(at, tz)}`;
      if (t.kind === "lightweight") g(["tag", name, shas[i]]);
      else if (t.kind === "nested") {
        const inner = mk(`object ${shas[i]}\ntype commit\ntag syn-inner\n${tagger(t.innerAt, t.innerTz)}\n\ninner\n`);
        const outer = mk(`object ${inner}\ntype tag\ntag syn-outer\n${tagger(t.at, t.tz)}\n\nouter\n`);
        g(["update-ref", `refs/tags/${name}`, outer]);
        nested[t.n] = { outer, inner, commit: shas[i] };
      } else if (t.kind === "tag-of-tree") {
        const tree = g(["rev-parse", `${shas[i]}^{tree}`]).trim();
        g(["update-ref", `refs/tags/${name}`, mk(`object ${tree}\ntype tree\ntag syn-tree\n${tagger(t.at, t.tz)}\n\ntree\n`)]);
      } else g(["tag", "-a", "-m", `S${t.n}`, name, shas[i]], unix(t.at, t.tz));
    }
  }
  return { dir, shas, nested, git: (...a) => g(a) };
}

// The standard repository. Tagger times are NOT the commit times (hours apart), the tags carry different zones, S4 is a trailing
// blessing after every success window below (the tail check needs the supplied refs to show something at or after a window's end),
// and C5 (HEAD) is untagged.
const S1 = "2026-10-01T06:00:00.000Z", S2 = "2026-10-02T06:00:00.000Z", S3 = "2026-10-02T18:00:00.000Z", S4 = "2026-10-03T06:00:00.000Z";
const ORIGIN_RAW = "git@example.invalid:syn-org/syn-world.git";
const standard = (opts = {}) => makeWorld([
  { commitAt: "2026-10-01T05:00:00Z", tag: { n: 1, at: S1, tz: "-0400" } },
  { commitAt: "2026-10-01T20:00:00Z", tag: { n: 2, at: S2, tz: "+0200" } },
  { commitAt: "2026-10-02T10:00:00Z", tag: { n: 3, at: S3, tz: "+0000" } },
  { commitAt: "2026-10-03T01:00:00Z", tag: { n: 4, at: S4, tz: "+0900" } },
  { commitAt: "2026-10-03T09:00:00Z" },
], opts);
const W = standard({ origin: ORIGIN_RAW });
const [C1, C2, C3, C4, C5] = W.shas;
const tagObject = (n) => W.git("rev-parse", `refs/tags/settlement/S${n}`).trim();

test("timeline: blessed_at is the TAGGER time and world_sha is the tag PEELED to its commit; the commit date, the tag object and HEAD are none of them", () => {
  const tl = readSettlementTags(W.dir);
  assert.deepEqual(tl.unqualified, []);
  assert.deepEqual(tl.tags.map((t) => [t.n, t.tag, t.blessed_at, t.world_sha]), [
    [1, "settlement/S1", S1, C1], [2, "settlement/S2", S2, C2], [3, "settlement/S3", S3, C3], [4, "settlement/S4", S4, C4],
  ]);
  assert.deepEqual(Object.keys(tl.tags[0]).sort(), ["blessed_at", "blessed_at_ms", "n", "tag", "world_sha"]);
  for (const n of [1, 2, 3, 4]) assert.notEqual(tl.tags[n - 1].world_sha, tagObject(n), `S${n}: the tag object's own sha is not the World sha`);
  assert.ok(![C1, C2, C3, C4].includes(C5), "HEAD is not any tagged commit");
  assert.equal(W.git("rev-parse", "HEAD").trim(), C5);
  // the fixture really separates the three clocks: committer date != tagger date for every tag
  for (const [i, tagAt] of [[1, S1], [2, S2], [3, S3], [4, S4]]) {
    const committed = W.git("log", "-1", "--format=%cI", [C1, C2, C3, C4][i - 1]).trim();
    assert.notEqual(new Date(committed).toISOString(), tagAt, `S${i}: the commit date differs from the tagger date`);
  }
});

test("a tag of a tag peels to its commit: the OUTER tagger time is the clock and the FINAL commit is the World sha, never the inner tag's time or object, the commit's date or the outer object", () => {
  const INNER = "2026-10-01T09:00:00.000Z", OUTER = "2026-10-02T18:00:00.000Z";
  const w = makeWorld([
    { commitAt: "2026-10-01T05:00:00Z", tag: { n: 1, at: S1 } },
    { commitAt: "2026-10-01T20:00:00Z", tag: { n: 9, kind: "nested", at: OUTER, tz: "+0900", innerAt: INNER, innerTz: "-0300" } },
    { commitAt: "2026-10-03T01:00:00Z", tag: { n: 10, at: S4 } },
  ]);
  const o = w.nested[9];
  // THE SHAPE FIRST, from what git stored, before the reader is judged: outer tag -> inner tag -> commit, three distinct objects with distinct times
  assert.equal(w.git("cat-file", "-t", o.outer).trim(), "tag", "the outer object is a tag");
  const outerBody = w.git("cat-file", "-p", o.outer), innerBody = w.git("cat-file", "-p", o.inner);
  assert.ok(outerBody.includes(`object ${o.inner}\ntype tag\n`), "the outer's direct target is the inner TAG");
  assert.equal(w.git("cat-file", "-t", o.inner).trim(), "tag", "the inner object is a tag");
  assert.ok(innerBody.includes(`object ${o.commit}\ntype commit\n`), "the inner's target is the commit");
  assert.equal(w.git("cat-file", "-t", o.commit).trim(), "commit");
  assert.equal(new Set([o.outer, o.inner, o.commit]).size, 3, "outer, inner and commit are three different identities");
  const taggerSecs = (body) => Number(/^tagger .* (\d+) [+-]\d{4}$/m.exec(body)[1]) * 1000;
  assert.deepEqual([taggerSecs(outerBody), taggerSecs(innerBody)], [T(OUTER), T(INNER)], "the outer and inner tagger times are the ones built");
  const commitAt = T(w.git("log", "-1", "--format=%cI", o.commit).trim());
  assert.ok(![T(OUTER), T(INNER)].includes(commitAt), "the commit's own date is neither tagger time");
  // the reader
  const tl = readSettlementTags(w.dir);
  assert.deepEqual(tl.unqualified, [], "a tag of a tag that reaches a commit is qualified");
  const s9 = tl.tags.find((t) => t.n === 9);
  assert.deepEqual([s9.blessed_at, s9.world_sha], [OUTER, o.commit], "the clock is the outer tag's tagger time and the sha the final commit");
  assert.notEqual(s9.world_sha, o.inner); assert.notEqual(s9.world_sha, o.outer);
  assert.notEqual(s9.blessed_at, INNER);
  // the world read at that sha is the commit's own
  assert.equal(readSegmentInputs(w.dir, s9.world_sha).worldState.note, "STATE-C2");
  // matched negatives: a chain that ends at a tree and a lightweight ref are still unqualified, each with its own reason
  const bad = makeWorld([
    { commitAt: "2026-10-01T05:00:00Z", tag: { n: 1, at: S1 } },
    { commitAt: "2026-10-01T20:00:00Z", tag: { n: 8, kind: "tag-of-tree", at: S2 } },
    { commitAt: "2026-10-02T10:00:00Z", tag: { n: 7, kind: "lightweight" } },
  ]);
  assert.deepEqual(readSettlementTags(bad.dir).unqualified.map((u) => [u.n, u.why]), [[7, "lightweight_tag"], [8, "tag_does_not_peel_to_a_commit"]]);
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

test("refusals: a window before the first blessing, no tags, a bad window, an unreadable or lightweight tag, a tie, a disorder and a bad repository each fail NAMED, for their own reason", () => {
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
    { commitAt: "2026-10-03T10:00:00Z", tag: { n: 4, at: S4 } },
  ]);
  const ltl = readSettlementTags(light.dir);
  assert.deepEqual(ltl.unqualified.map((u) => [u.n, u.why]), [[2, "lightweight_tag"]]);
  assert.deepEqual(ltl.tags.map((t) => t.n), [1, 3, 4]);
  assert.equal(codeOf(resolve(ltl, "2026-10-01T10:00:00.000Z", "2026-10-02T20:00:00.000Z")), "SETTLEMENT_UNQUALIFIED");
  assert.match(msgOf(resolve(ltl, "2026-10-01T10:00:00.000Z", "2026-10-02T20:00:00.000Z")), /settlement\/S2 cannot be read as a blessing \(lightweight_tag\)/, "for its own reason: the unreadable tag, not the tail");
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
  assert.match(msgOf(resolve(ttl, "2026-10-02T08:00:00.000Z", "2026-10-02T20:00:00.000Z")), /settlement\/S4 cannot be read as a blessing/, "for its own reason");

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

test("an unreadable tag is bounded out of a window only by a chronology that follows the numbers: S1, S10 (late), S12 (EARLIER than S10), unreadable S11 refuses; the monotone twin passes", () => {
  const build = (s12At) => makeWorld([
    { commitAt: "2026-09-30T05:00:00Z", tag: { n: 1, at: "2026-10-01T00:00:00.000Z" } },
    { commitAt: "2026-09-30T06:00:00Z", tag: { n: 10, at: "2026-10-04T00:00:00.000Z" } },
    { commitAt: "2026-09-30T07:00:00Z", tag: { n: 11, kind: "lightweight" } },
    { commitAt: "2026-09-30T08:00:00Z", tag: { n: 12, at: s12At } },
  ]);
  const win = { fromMs: T("2026-10-01T06:00:00.000Z"), toMs: T("2026-10-01T18:00:00.000Z") };
  // the contradiction lies OUTSIDE the window: S12 (10-02) was blessed before S10 (10-04), so S10's late time cannot show that S11 is out of it
  const bad = readSettlementTags(build("2026-10-02T00:00:00.000Z").dir);
  assert.deepEqual(bad.unqualified.map((u) => u.n), [11]);
  assert.equal(codeOf(() => resolveSegments(bad, win)), "SETTLEMENT_UNQUALIFIED");
  assert.match(msgOf(() => resolveSegments(bad, win)), /do not follow their numbers/, "refused for the chronology, not for the lack of a witness");
  // the matched twin: the same shape with S12 AFTER S10 is monotone, S10 bounds S11 out of the window, and the window stands on S1
  const good = readSettlementTags(build("2026-10-05T00:00:00.000Z").dir);
  assert.deepEqual(resolveSegments(good, win).segments.map((s) => s.settlement), [1], "monotone outside the window: bounded, passes");
  // interior numbering gaps are never refused or inferred (S1, S10, S12 with no S2..S9)
  assert.deepEqual(good.tags.map((t) => t.n), [1, 10, 12]);
});

test("THE TAIL: the newest settlement tag (highest NUMBER) in the supplied refs must be blessed at or after the window's end; equality passes, one millisecond later refuses and names the tag; gaps are not refused", () => {
  const tl = readSettlementTags(W.dir);
  const plan = (from, to) => () => resolveSegments(tl, { fromMs: T(from), toMs: T(to) });
  assert.doesNotThrow(plan("2026-10-03T00:00:00.000Z", S4), "control: ending exactly ON the newest blessing passes");
  assert.doesNotThrow(plan("2026-10-03T00:00:00.000Z", "2026-10-03T05:59:59.999Z"), "control: ending before it passes");
  assert.equal(codeOf(plan("2026-10-03T00:00:00.000Z", "2026-10-03T06:00:00.001Z")), "SETTLEMENT_UNQUALIFIED", "one millisecond after the newest blessing refuses");
  const m = msgOf(plan("2026-10-03T00:00:00.000Z", "2026-10-03T06:00:00.001Z"));
  assert.ok(m.includes("settlement/S4") && m.includes(S4) && m.includes("2026-10-03T06:00:00.001Z"), `it names the newest tag, its blessing and the window's end: ${m}`);
  // the stale clone: the same refs minus the trailing tag show nothing after S3, so a window ending after S3 refuses, and the full clone passes it
  const stale = makeWorld([
    { commitAt: "2026-10-01T05:00:00Z", tag: { n: 1, at: S1 } },
    { commitAt: "2026-10-01T20:00:00Z", tag: { n: 2, at: S2 } },
    { commitAt: "2026-10-02T10:00:00Z", tag: { n: 3, at: S3 } },
  ]);
  const stl = readSettlementTags(stale.dir);
  const win = { fromMs: T("2026-10-02T08:00:00.000Z"), toMs: T("2026-10-02T20:00:00.000Z") };
  assert.equal(codeOf(() => resolveSegments(stl, win)), "SETTLEMENT_UNQUALIFIED");
  assert.match(msgOf(() => resolveSegments(stl, win)), /settlement\/S3, was blessed .* before the window ends/);
  assert.deepEqual(resolveSegments(tl, win).segments.map((s) => s.settlement), [2, 3], "matched control: the refs that show S4 pass the same window");
  // a numbering gap (S1, S2, S4: no S3) is a possible legitimate refusal, never inferred or refused here
  const gap = makeWorld([
    { commitAt: "2026-10-01T05:00:00Z", tag: { n: 1, at: S1 } },
    { commitAt: "2026-10-01T20:00:00Z", tag: { n: 2, at: S2 } },
    { commitAt: "2026-10-02T10:00:00Z", tag: { n: 4, at: S4 } },
  ]);
  assert.deepEqual(resolveSegments(readSettlementTags(gap.dir), { fromMs: T("2026-10-02T08:00:00.000Z"), toMs: T("2026-10-02T20:00:00.000Z") }).segments.map((s) => s.settlement), [2], "a gap is left alone");
  // "newest" is the highest NUMBER, not the latest time: S2 (10-03) is the latest blessing, but S3 is the newest settlement and it was blessed
  // (10-01T12) before this window ends, so the window refuses even though a later-TIMED tag exists
  const numbered = makeWorld([
    { commitAt: "2026-10-01T05:00:00Z", tag: { n: 1, at: S1 } },
    { commitAt: "2026-10-01T06:00:00Z", tag: { n: 2, at: "2026-10-03T06:00:00.000Z" } },
    { commitAt: "2026-10-01T07:00:00Z", tag: { n: 3, at: "2026-10-01T12:00:00.000Z" } },
  ]);
  const ntl = readSettlementTags(numbered.dir);
  assert.equal(codeOf(() => resolveSegments(ntl, { fromMs: T("2026-10-01T20:00:00.000Z"), toMs: T("2026-10-01T22:00:00.000Z") })), "SETTLEMENT_UNQUALIFIED", "newest by number, blessed before the window ends");
  assert.match(msgOf(() => resolveSegments(ntl, { fromMs: T("2026-10-01T20:00:00.000Z"), toMs: T("2026-10-01T22:00:00.000Z") })), /settlement\/S3/);
});

test("inputs: each segment's WORLD/world-state.json and WORLD/skeleton.json come from ITS OWN sha; HEAD never leaks; the plan is not a manifest", () => {
  const plan = planWorldInputs(W.dir, { fromMs: T("2026-10-01T10:00:00.000Z"), toMs: T("2026-10-02T20:00:00.000Z") });
  assert.deepEqual(Object.keys(plan), ["segment_clock", "segments", "internal_inputs", "world_provenance"], "a feed for the manifest, not a manifest, bundle, completeness or success key");
  assert.equal(plan.segment_clock, "blessed_at");
  assert.deepEqual(plan.segments.map((s) => [s.settlement, s.world_sha]), [[1, C1], [2, C2], [3, C3]]);
  assert.deepEqual(plan.internal_inputs.map((i) => [i.settlement, i.world_sha, i.worldState.note, i.skeleton.regions[0]]), [
    [1, C1, "STATE-C1", "syn-region-1"], [2, C2, "STATE-C2", "syn-region-2"], [3, C3, "STATE-C3", "syn-region-3"],
  ]);
  assert.deepEqual(plan.internal_inputs.map((i) => i.worldState.marks[0].id), ["syn/mark-1", "syn/mark-2", "syn/mark-3"]);
  // HEAD's WORLD is in no segment and no input. (Until this correction the plan held no HEAD sha at all and this asserted that of the whole plan; the
  // provenance line now records HEAD's sha on purpose, so the claim is made of what it always guarded: the segments and the inputs.)
  const wire = JSON.stringify([plan.segments, plan.internal_inputs]);
  assert.ok(!wire.includes("STATE-C5") && !wire.includes("syn-region-5") && !wire.includes(C5), "HEAD's world is in no segment and no input");
  assert.equal(plan.world_provenance.head_sha, C5, "and the provenance line, on purpose, names HEAD");
  // the same read directly, at one sha
  assert.equal(readSegmentInputs(W.dir, C2).worldState.note, "STATE-C2");

  // the matched complete control above passes; now each required input, missing or corrupt, refuses (and the control windows beside it still pass)
  const MARK = "SYN-LEAK-MARKER";
  const bad = makeWorld([
    { commitAt: "2026-10-01T05:00:00Z", tag: { n: 1, at: S1 } },
    { commitAt: "2026-10-01T20:00:00Z", skeleton: null, tag: { n: 2, at: S2 } },
    { commitAt: "2026-10-02T10:00:00Z", state: `{ ${MARK}`, tag: { n: 3, at: S3 } },
    { commitAt: "2026-10-02T11:00:00Z", state: "[]", tag: { n: 4, at: "2026-10-02T19:00:00.000Z" } },
    { commitAt: "2026-10-02T12:00:00Z", tag: { n: 5, at: S4 } },
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

test("the reader changes nothing, imports only node builtins, runs only four local git verbs and reads exactly one environment variable", () => {
  const snap = () => [W.git("for-each-ref"), W.git("rev-parse", "HEAD"), W.git("status", "--porcelain")].join("|");
  const before = snap();
  planWorldInputs(W.dir, { fromMs: T(S1), toMs: T(S3) });
  readSettlementTags(W.dir);
  assert.equal(snap(), before, "refs, HEAD and the work tree are exactly as they were");
  const src = readFileSync(new URL("../tools/moment-export-world.mjs", import.meta.url), "utf8");
  const code = src.replace(/\/\/.*$/gm, "");
  const specs = [...src.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gm)].map((m) => m[1]).sort();
  assert.deepEqual(specs, ["node:child_process", "node:fs"]);
  const verbs = new Set([...code.matchAll(/\bgit\((?:repo|real),\s*\["([a-z-]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...verbs].sort(), ["cat-file", "config", "for-each-ref", "rev-parse"], "the only git verbs the reader runs: all local reads");
  assert.deepEqual([...code.matchAll(/process\.env[.\w]*/g)].map((m) => m[0]), ["process.env.PATH"], "the caller's environment is read for PATH and nothing else");
  assert.ok(!/\bfetch\s*\(|\bwriteFile|\bspawn\b/.test(code), "no network, repair or write verb in code");
});

// ── the child git boundary (W2) ──────────────────────────────────────────────

const withEnv = async (vars, fn) => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const WIN_ALL = { fromMs: T("2026-10-01T10:00:00.000Z"), toMs: T("2026-10-02T20:00:00.000Z") };

// A call into the module in a CHILD node process, killed from outside (its whole process group) after killMs. The reader's git calls are synchronous, so
// nothing in this process can stop or answer one: a barrier that is missing must be a red and not a hang, and a listener owned by this process can only
// answer a connection while the reader runs elsewhere.
const runnerFile = join(root, "child-runner.mjs");
writeFileSync(runnerFile, [
  `import { readSettlementTags, readSegmentInputs, planWorldInputs } from ${JSON.stringify(pathToFileURL(new URL("../tools/moment-export-world.mjs", import.meta.url).pathname).href)};`,
  `const [, , mode, repo, a, b] = process.argv;`,
  `try { if (mode === "blob") readSegmentInputs(repo, a); else if (mode === "plan") planWorldInputs(repo, { fromMs: Number(a), toMs: Number(b) }); else readSettlementTags(repo); console.log(JSON.stringify({ ok: true })); }`,
  `catch (e) { console.log(JSON.stringify({ code: e.code, message: String(e.message) })); }`,
].join("\n"));
const inChild = (env, args, killMs = 45_000) => new Promise((resolve) => {
  const child = spawn(process.execPath, [runnerFile, ...args.map(String)], { env, stdio: ["ignore", "pipe", "ignore"], detached: true });
  let out = "", hung = false;
  const timer = setTimeout(() => { hung = true; try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } }, killMs);
  child.stdout.on("data", (d) => { out += d; });
  child.on("close", () => { clearTimeout(timer); resolve(hung ? { hung: true } : JSON.parse(out || "{}")); });
});

test("a hostile caller environment cannot redirect the declared repository, inject configuration or reach an error: the answer equals the clean answer and names no decoy", async () => {
  const decoy = makeWorld([{ commitAt: "2026-10-01T05:00:00Z", tag: { n: 7, at: S1 } }]);
  const marker = join(root, "askpass-marker");
  const askpass = join(root, "askpass.sh");
  writeFileSync(askpass, `#!/bin/sh\necho ran > ${marker}\necho x\n`); chmodSync(askpass, 0o755);
  const clean = planWorldInputs(W.dir, WIN_ALL);
  const SECRET = "SYN-ENV-SECRET-4410";
  const hostile = {
    GIT_DIR: join(decoy.dir, ".git"), GIT_WORK_TREE: decoy.dir, GIT_INDEX_FILE: join(decoy.dir, ".git", "index"), GIT_OBJECT_DIRECTORY: join(decoy.dir, ".git", "objects"),
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "remote.origin.url", GIT_CONFIG_VALUE_0: "https://decoy.invalid/injected.git", GIT_ASKPASS: askpass, SYN_SECRET_ENV: SECRET,
  };
  let after = null, thrown = null, badPath = null;
  await withEnv(hostile, async () => {
    try { after = planWorldInputs(W.dir, WIN_ALL); } catch (e) { thrown = e; }
    badPath = errOf(() => readSettlementTags(join(root, "no-such-dir")));
  });
  assert.equal(thrown, null, `the hostile environment changed the outcome: ${thrown?.message}`);
  assert.deepEqual(after, clean, "the same plan, byte for byte, as with a clean environment");
  assert.ok(!JSON.stringify(after).includes("decoy.invalid") && !JSON.stringify(after).includes("settlement/S7"), "nothing of the decoy repository or the injected configuration");
  assert.equal(existsSync(marker), false, "no askpass program ran");
  assert.ok(badPath instanceof ExportWorldError && !badPath.message.includes(SECRET) && !badPath.message.includes(root), "an error carries neither the environment nor a path");
});

test("a bare repository and a normal work tree answer the same", () => {
  const bare = join(root, "bare.git");
  execFileSync("git", ["clone", "--bare", "-q", W.dir, bare], { stdio: ["ignore", "pipe", "pipe"] });
  assert.deepEqual(readSettlementTags(bare), readSettlementTags(W.dir));
  const a = planWorldInputs(bare, WIN_ALL), b = planWorldInputs(W.dir, WIN_ALL);
  assert.deepEqual([a.segments, a.internal_inputs], [b.segments, b.internal_inputs]);
});

test("a shallow or a partial (promisor) clone is a NAMED refusal and nothing is fetched or asked: no connection reaches the owned listener, no askpass runs", async () => {
  // matched controls first: the same shapes of repository, ordinary, pass
  const mk = () => makeWorld([
    { commitAt: "2026-10-01T05:00:00Z", tag: { n: 1, at: S1 } },
    { commitAt: "2026-10-01T20:00:00Z", tag: { n: 2, at: S2 } },
    { commitAt: "2026-10-03T10:00:00Z", tag: { n: 3, at: S4 } },
  ]);
  const win = { fromMs: T("2026-10-01T10:00:00.000Z"), toMs: T("2026-10-02T12:00:00.000Z") };
  const ok = mk();
  assert.doesNotThrow(() => planWorldInputs(ok.dir, win), "control: an ordinary full repository passes");

  const shallow = mk();
  writeFileSync(join(shallow.dir, ".git", "shallow"), `${shallow.shas[1]}\n`);
  const shallowCode = codeOf(() => planWorldInputs(shallow.dir, win));

  // The reader runs in a child (inChild), so this process's listener can answer: a connection attempt is closed at once and git fails fast.
  let connections = 0;
  const server = createServer((socket) => { connections++; socket.destroy(); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let partialOut = null, missingOut = null, connectionsDuringTheRefusal = null;
  const marker = join(root, "askpass-partial-marker");
  try {
    const port = server.address().port;
    const askpass = join(root, "askpass-partial.sh");
    writeFileSync(askpass, `#!/bin/sh\necho ran > ${marker}\necho x\n`); chmodSync(askpass, 0o755);
    const partial = mk();
    // a promisor repository whose segment blob is gone: reading it could make git fetch it from the promisor remote, here the owned listener
    partial.git("config", "core.repositoryformatversion", "1");
    partial.git("config", "extensions.partialclone", "origin");
    partial.git("config", "remote.origin.promisor", "true");
    partial.git("config", "remote.origin.url", `http://127.0.0.1:${port}/syn-world.git`);
    const blob = partial.git("rev-parse", `${partial.shas[1]}:WORLD/skeleton.json`).trim();
    rmSync(join(partial.dir, ".git", "objects", blob.slice(0, 2), blob.slice(2)));
    const childEnv = { PATH: process.env.PATH, GIT_ASKPASS: askpass };    // the caller's askpass: the reader must not let git use it
    partialOut = await inChild(childEnv, ["plan", partial.dir, win.fromMs, win.toMs]);
    connectionsDuringTheRefusal = connections;
    // the same repository without the promisor markers is an ordinary one with a missing object: a different named refusal, and still no contact
    for (const k of ["extensions.partialclone", "remote.origin.promisor"]) partial.git("config", "--unset", k);
    missingOut = await inChild(childEnv, ["plan", partial.dir, win.fromMs, win.toMs]);
  } finally { await new Promise((resolve) => server.close(resolve)); }
  // every fact in one comparison, so a red names each barrier that moved: the refusal by name, the second barrier (no connection, no askpass), and the controls
  const named = (r) => (r?.hung ? "HUNG" : r?.code ?? null);
  assert.deepEqual(
    { shallow: shallowCode, partial: named(partialOut), missingObjectControl: named(missingOut), connectionsDuringTheRefusal, connections, askpassRan: existsSync(marker) },
    { shallow: "REPO_SHALLOW", partial: "REPO_PARTIAL", missingObjectControl: "INPUT_MISSING", connectionsDuringTheRefusal: 0, connections: 0, askpassRan: false },
    "a shallow or partial clone is refused by name, nothing connected to the owned listener, and no askpass ran",
  );
});

test("every child git is bounded in time and in output, and the bound keeps its own name through every call site (a child node, killed from outside, so a missing bound is a red and not a hang)", async () => {
  const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const fake = (name, pattern, action) => {
    const dir = join(root, `fake-${name}`); mkdirSync(dir, { recursive: true });
    const f = join(dir, "git");
    writeFileSync(f, `#!/bin/sh\ncase "$*" in\n  ${pattern}) ${action} ;;\n  *) exec ${realGit} "$@" ;;\nesac\n`); chmodSync(f, 0o755);
    return dir;
  };
  const SLEEP = "exec sleep 60", FLOOD = "yes aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa | head -c 70000000";
  const runChild = (binDir, mode) => inChild({ PATH: `${binDir}:${process.env.PATH}` }, [mode, W.dir, C2]);
  const cases = [
    ["repo", fake("repo", "*rev-parse*", SLEEP), "tags", "GIT_TIMEOUT"],
    ["list", fake("list", "*for-each-ref*", SLEEP), "tags", "GIT_TIMEOUT"],
    ["peel", fake("peel", "*'cat-file --batch-check'*", SLEEP), "tags", "GIT_TIMEOUT"],
    ["blob", fake("blob", "*'cat-file blob'*", SLEEP), "blob", "GIT_TIMEOUT"],
    ["flood", fake("flood", "*for-each-ref*", FLOOD), "tags", "GIT_OUTPUT_TOO_LARGE"],
  ];
  const results = await Promise.all(cases.map(([, dir, mode]) => runChild(dir, mode)));
  assert.deepEqual(results.map((r) => r.hung ? "HUNG (no bound ended the child)" : r.code ?? JSON.stringify(r)), cases.map((c) => c[3]), "each site answers with its bound's own name");
  for (const r of results) assert.ok(!String(r.message).includes(root), "and the message carries no path");
});

// ── the trusted repository's provenance and its stated precondition (Wright 15:22, parts 1 and 3) ──────────

test("provenance: the plan records the trusted repository's origin (safe), HEAD, and the newest settlement tag with its blessed_at, and no credential reaches the plan or any error", () => {
  const SECRETS = ["syn-user", "SYN-SECRET-TOKEN-7731", "SYN-QUERY-TOKEN", "SYN-FRAGMENT"];
  const dirty = `https://syn-user:SYN-SECRET-TOKEN-7731@example.invalid/syn-org/syn-world.git?access_token=SYN-QUERY-TOKEN#SYN-FRAGMENT`;
  const p = standard({ origin: dirty });
  const plan = planWorldInputs(p.dir, WIN_ALL);
  assert.deepEqual(plan.world_provenance, { origin: "https://example.invalid/syn-org/syn-world.git", head_sha: p.shas[4], newest_settlement: { tag: "settlement/S4", blessed_at: S4 } });
  assert.notEqual(plan.world_provenance.head_sha, p.shas[3], "HEAD is not the newest tag's commit");
  const wire = JSON.stringify(plan);
  for (const s of SECRETS) assert.ok(!wire.includes(s), `the plan never carries ${s}`);
  // the refusal paths of the same repository carry none of it either (a tail refusal, a bad window)
  const tailMsg = msgOf(() => planWorldInputs(p.dir, { fromMs: T("2026-10-03T00:00:00.000Z"), toMs: T("2026-10-04T00:00:00.000Z") }));
  assert.match(tailMsg, /settlement\/S4/);
  for (const s of [...SECRETS, "example.invalid"]) assert.ok(!tailMsg.includes(s) && !msgOf(() => planWorldInputs(p.dir, { fromMs: 5, toMs: 1 })).includes(s), `no error carries ${s}`);
  // the standard repository's scp-like origin: the user is dropped; no origin at all is null, not a refusal
  assert.equal(planWorldInputs(W.dir, WIN_ALL).world_provenance.origin, "example.invalid:syn-org/syn-world.git");
  const bare = standard();
  assert.equal(planWorldInputs(bare.dir, WIN_ALL).world_provenance.origin, null);
});

test("sanitizeOrigin: a network URL or scp host:path keeps scheme, host, port and path and nothing else; a local path, file: URL, other scheme or unparseable value is null", () => {
  const table = [
    ["https://example.invalid/syn/w.git", "https://example.invalid/syn/w.git"],
    ["https://syn-token@example.invalid/syn/w.git", "https://example.invalid/syn/w.git"],
    ["ssh://git@example.invalid:2222/syn/w.git", "ssh://example.invalid:2222/syn/w.git"],
    ["git://example.invalid/syn/w.git", "git://example.invalid/syn/w.git"],
    ["https://example.invalid/syn/w.git?x=1#y", "https://example.invalid/syn/w.git"],
    ["git@example.invalid:syn/w.git", "example.invalid:syn/w.git"],
    ["example.invalid:syn/w.git?tok=1", "example.invalid:syn/w.git"],
    ["/home/syn-person/world", null], ["./world", null], ["../world", null], ["~/world", null], ["file:///tmp/world", null],
    ["ftp://example.invalid/w", null], ["ext::sh -c x", null], ["https://", null], ["a b", null], ["", null], ["   ", null], [undefined, null], [42, null],
  ];
  assert.deepEqual(table.map(([raw]) => sanitizeOrigin(raw)), table.map(([, want]) => want));
});

test("the precondition text states each of Wright's clauses: fetched from origin, with its tags, after the window's end, trusted not certified, no fetch of its own", () => {
  const t = preconditionText();
  const clauses = {
    "fetched from origin": /fetched from origin/i.test(t),
    "with its tags": /\btags\b/i.test(t),
    "after the window's end (to)": /after the .*window.*\(`to`\)|after.*`to`/is.test(t),
    "trusted, not certified": /\btrusts\b/i.test(t) && /not certify|does not certify/i.test(t),
    "fetches nothing itself": /fetches nothing/i.test(t),
    "the one tail check": /newest settlement tag/i.test(t),
  };
  assert.deepEqual(Object.fromEntries(Object.entries(clauses).filter(([, ok]) => !ok)), {}, "every clause is present (an empty object means none missing)");
  assert.equal(typeof t, "string");
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
  assert.deepEqual(Object.keys(plan), ["segment_clock", "segments", "internal_inputs", "world_provenance"]);
  assert.ok(!JSON.stringify([res, plan]).includes("STATE-C5"));
});
