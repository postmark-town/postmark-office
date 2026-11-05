// moment-export-world.mjs — the founder moment export's BLESSED TIMELINE and local World inputs (POS-780, increment 2).
//
// INTERNAL and PARTIAL. It reads one explicitly supplied LOCAL World repository with argument-array `git` calls and
// returns data or throws a NAMED error (ExportWorldError.code). It fetches nothing, opens no store and no socket,
// writes nothing, executes no World engine, and builds no manifest, folder, ZIP, CLI or bundle. Its result is for a
// library caller (the later assembly step) and says so: the inputs it returns are INTERNAL and unprojected.
//
// WHAT IT ANSWERS TO (POS-780, Wright 2026-11-05 08:20, "the blessed-settlement timeline"):
//   · A segment starts at a settlement's `blessed_at`: the TAGGER time of its annotated `settlement/S<n>` tag
//     (world2/tools/settlements-backfill.mjs:113-143 readTagLines + settlementRowsFrom: `blessed_at` is the tag
//     object's `taggerdate`, `tag_sha` is the tag PEELED to its commit, and `published_at` is the COMMITTER date,
//     which is never a clock here).
//   · Its `world_sha` is the tag peeled to its COMMIT (never the tag object's own sha, never the snapshot header's
//     world_sha, which is the marks projection's input: world2/tools/world-snapshot-seal.mjs:125-145).
//   · Its inputs are `WORLD/world-state.json` and `WORLD/skeleton.json` AT THAT SHA (tools/world-build.mjs:123
//     assembleWorld({worldState, skeleton}), read here, not run). Not HEAD, not a cached or newest World.
//   · A required settlement with no tag, tagger time or peeled commit REFUSES. It is never filled from HEAD, a
//     cadence, the first or last act, or a commit date.
//
// THE WINDOW: [fromMs, toMs], inclusive at both ends, as the archive reader's window. The settlement in force at a
// time t is the one with the greatest `blessed_at` <= t, so an exact blessing instant belongs to the NEW
// settlement (it is assigned once). The segments partition the window: every segment but the last ends where the
// next begins (that instant is the next segment's); the last segment's `to` is the window's own final instant,
// which is inside it. `segmentAt` is that rule as a function.
//
// IMPORT CLOSURE: node:child_process and node:fs. Nothing else, and nothing at import time.

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

export const SEGMENT_CLOCK = "blessed_at";
const WORLD_STATE_PATH = "WORLD/world-state.json";
const SKELETON_PATH = "WORLD/skeleton.json";
const TAG_REF = /^refs\/tags\/settlement\/S(\d+)$/;
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
// refname, object type, object name, peeled type, peeled name, tagger date: a lightweight tag has empty peeled and tagger fields
const FORMAT = ["%(refname)", "%(objecttype)", "%(objectname)", "%(*objecttype)", "%(*objectname)", "%(taggerdate:iso-strict)"].join("%09");

export class ExportWorldError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = "ExportWorldError"; this.code = code; }
}

const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
const isoOf = (ms) => new Date(ms).toISOString();
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** The repository, or a named refusal: a real path that is the top of a work tree (or a bare repository), not a subdirectory of some other repo. */
function openRepo(worldRepo) {
  if (typeof worldRepo !== "string" || !worldRepo) throw new ExportWorldError("WORLD_REPO", "a local World repository path is required");
  let real;
  try { real = realpathSync(worldRepo); } catch { throw new ExportWorldError("WORLD_REPO", "the World repository path does not exist"); }
  let bare;
  try { bare = git(real, ["rev-parse", "--is-bare-repository"]).trim(); } catch { throw new ExportWorldError("WORLD_REPO", "the path is not a git repository"); }
  if (bare === "false") {
    let top;
    try { top = realpathSync(git(real, ["rev-parse", "--show-toplevel"]).trim()); } catch { throw new ExportWorldError("WORLD_REPO", "the repository's top could not be read"); }
    if (top !== real) throw new ExportWorldError("WORLD_REPO", "the path is not the top of a git work tree; another repository's tags are not read");
  }
  return real;
}

/**
 * Every `settlement/S<n>` tag of the repository, classified. A tag is QUALIFIED when it is an annotated tag object whose
 * peeled object is a commit and which carries a tagger time. Anything else (lightweight, no tagger time, a tag of a tag
 * or of a non-commit, a duplicate number) is listed as unqualified with its reason and never repaired here.
 * `tags` are sorted by number; `blessed_at_ms` is the tagger time, `world_sha` the peeled commit.
 */
export function readSettlementTags(worldRepo) {
  const repo = openRepo(worldRepo);
  let out;
  try { out = git(repo, ["for-each-ref", `--format=${FORMAT}`, "refs/tags/settlement/"]); } catch { throw new ExportWorldError("TAGS_UNREADABLE", "the settlement tags could not be listed"); }
  const byNumber = new Map();
  for (const line of out.split(/\r?\n/).filter(Boolean)) {
    const [ref, type, , peeledType, peeledName, tagger] = line.split("\t");
    const m = TAG_REF.exec(ref ?? "");
    if (!m) continue;                                   // not a settlement tag: it contributes nothing
    const n = Number(m[1]);
    if (!Number.isSafeInteger(n)) continue;
    const entry = { n, tag: `settlement/S${n}`, ref };
    let why = null;
    if (type !== "tag") why = "lightweight_tag";
    else if (peeledType !== "commit" || !SHA.test(peeledName ?? "")) why = "tag_does_not_peel_to_a_commit";
    else if (!tagger) why = "no_tagger_time";
    else if (!Number.isFinite(Date.parse(tagger))) why = "tagger_time_unreadable";
    if (why) entry.why = why; else Object.assign(entry, { blessed_at_ms: Date.parse(tagger), blessed_at: isoOf(Date.parse(tagger)), world_sha: peeledName });
    if (!byNumber.has(n)) byNumber.set(n, []);
    byNumber.get(n).push(entry);
  }
  const tags = [], unqualified = [];
  for (const [n, list] of [...byNumber.entries()].sort((a, b) => a[0] - b[0])) {
    if (list.length > 1) { for (const e of list) unqualified.push({ n, tag: e.tag, ref: e.ref, why: "duplicate_number" }); continue; }
    const e = list[0];
    if (e.why) unqualified.push({ n, tag: e.tag, ref: e.ref, why: e.why });
    else tags.push({ n, tag: e.tag, blessed_at_ms: e.blessed_at_ms, blessed_at: e.blessed_at, world_sha: e.world_sha });
  }
  return { tags, unqualified };
}

/**
 * The settlement in force at `tMs` (the greatest blessed_at <= tMs), or null before the first blessing. A tie on that
 * instant is ambiguous, and a higher-numbered blessing that is EARLIER in time than the one in force is disorder; both
 * refuse, because the order is a number law (the count of blessings) and the clock must agree with it to be used.
 */
function inForce(tags, tMs) {
  const before = tags.filter((t) => t.blessed_at_ms <= tMs);
  if (!before.length) return null;
  const latest = Math.max(...before.map((t) => t.blessed_at_ms));
  const atLatest = before.filter((t) => t.blessed_at_ms === latest);
  if (atLatest.length > 1) throw new ExportWorldError("TIMELINE_AMBIGUOUS", `settlements ${atLatest.map((t) => t.n).join(" and ")} share one blessing instant, so the one in force is not decided`);
  const cur = atLatest[0];
  if (before.some((t) => t.n > cur.n)) throw new ExportWorldError("TIMELINE_ORDER", `a higher-numbered settlement was blessed before settlement ${cur.n}; the clock disagrees with the count`);
  return cur;
}

/**
 * The window as the ruled segment records `{from, to, settlement, world_sha}`, plus the clock identity.
 * `timeline` is `readSettlementTags`' answer. See the header for the boundary rule.
 */
export function resolveSegments(timeline, { fromMs, toMs }) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) throw new ExportWorldError("WINDOW_INVALID", "the moment window needs finite from <= to");
  const { tags, unqualified } = timeline;
  if (!tags.length) {
    if (unqualified.length) throw new ExportWorldError("SETTLEMENT_UNQUALIFIED", `no settlement tag is usable (${unqualified[0].tag}: ${unqualified[0].why})`);
    throw new ExportWorldError("SETTLEMENTS_NONE", "the World repository has no settlement tag");
  }
  const start = inForce(tags, fromMs);
  if (!start) throw new ExportWorldError("WINDOW_BEFORE_FIRST_BLESSING", "no settlement was blessed at or before the window's start");
  const inside = tags.filter((t) => t.blessed_at_ms > fromMs && t.blessed_at_ms <= toMs).sort((a, b) => a.blessed_at_ms - b.blessed_at_ms || a.n - b.n);
  for (const [i, t] of inside.entries()) {
    const prev = i === 0 ? start : inside[i - 1];
    if (t.blessed_at_ms === prev.blessed_at_ms) throw new ExportWorldError("TIMELINE_AMBIGUOUS", `settlements ${prev.n} and ${t.n} share one blessing instant, so the one in force is not decided`);
    if (t.n <= prev.n) throw new ExportWorldError("TIMELINE_ORDER", `settlement ${t.n} was blessed after settlement ${prev.n}, which is numbered higher`);
  }
  // A tag that cannot be read could be the one in force. By the count law an unreadable tag numbered above the start is no earlier than
  // the readable tags below it; it is out of the window only when a readable LOWER-numbered tag was already blessed after the window.
  for (const u of unqualified) {
    if (u.n <= start.n) continue;
    const bounded = tags.some((t) => t.n < u.n && t.blessed_at_ms > toMs);
    if (!bounded) throw new ExportWorldError("SETTLEMENT_UNQUALIFIED", `${u.tag} cannot be read as a blessing (${u.why}) and may lie inside the window`);
  }
  const chain = [start, ...inside];
  const segments = chain.map((t, i) => ({
    from: isoOf(i === 0 ? fromMs : t.blessed_at_ms),
    to: isoOf(i < chain.length - 1 ? chain[i + 1].blessed_at_ms : toMs),
    settlement: t.n,
    world_sha: t.world_sha,
  }));
  return { segment_clock: SEGMENT_CLOCK, segments };
}

/** The segment holding instant `tMs`: every segment is [from, next.from) except the last, which is [from, to]. Null outside the window. */
export function segmentAt(segments, tMs) {
  for (const [i, s] of segments.entries()) {
    const from = Date.parse(s.from), to = Date.parse(s.to);
    if (tMs >= from && (i < segments.length - 1 ? tMs < to : tMs <= to)) return s;
  }
  return null;
}

/** One required local input, read at exactly `sha`: a JSON object, or a named refusal that never carries the file's text. */
function readJsonAt(repo, sha, file) {
  let text;
  try { text = git(repo, ["cat-file", "blob", `${sha}:${file}`]); } catch { throw new ExportWorldError("INPUT_MISSING", `${file} is not in the tree of ${sha}`); }
  let value;
  try { value = JSON.parse(text); } catch { throw new ExportWorldError("INPUT_CORRUPT", `${file} at ${sha} is not JSON`); }
  if (!isObj(value)) throw new ExportWorldError("INPUT_CORRUPT", `${file} at ${sha} is not a JSON object`);
  return value;
}

/** INTERNAL: the segment's two required inputs, at its own World sha. */
export function readSegmentInputs(worldRepo, worldSha) {
  const repo = openRepo(worldRepo);
  if (typeof worldSha !== "string" || !SHA.test(worldSha)) throw new ExportWorldError("INPUT_MISSING", "a segment needs a full commit sha");
  return { worldState: readJsonAt(repo, worldSha, WORLD_STATE_PATH), skeleton: readJsonAt(repo, worldSha, SKELETON_PATH) };
}

/**
 * The whole internal plan for a window: the ruled segments and, for each, its inputs at its own sha. Nothing here is a manifest,
 * a bundle or a success claim; positions, air, telling, marks and assets are later steps. `internal_inputs` is not for projection.
 */
export function planWorldInputs(worldRepo, { fromMs, toMs }) {
  const timeline = readSettlementTags(worldRepo);
  const { segment_clock, segments } = resolveSegments(timeline, { fromMs, toMs });
  const internal_inputs = segments.map((s) => ({ settlement: s.settlement, world_sha: s.world_sha, ...readSegmentInputs(worldRepo, s.world_sha) }));
  return { segment_clock, segments, internal_inputs };
}
