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
//     world_sha, which is the marks projection's input: world2/tools/world-snapshot-seal.mjs:125-145). The peel is
//     explicit and recursive (`<ref>^{commit}`), so a tag of a tag still reaches its commit, and the clock stays the
//     OUTER tag's own tagger time (never an inner tag's, never the commit's).
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
// THE TRUSTED PRECONDITION (Wright, 2026-11-05 15:22 "World refs TRUSTED precondition, not certified completeness"):
// the supplied World repository is trusted, not verified. TRUSTED_WORLD_PRECONDITION is its text, for the later help
// and README to carry; neither exists yet. The one check that IS possible is the tail (resolveSegments): the newest
// settlement tag in the supplied refs must have been blessed at or after the window's `to`. Interior numbering gaps
// are never refused or inferred (src/settlements.mjs:52-54: a gap "is a refusal that happened").
//
// THE CHILD GIT BOUNDARY (this file's, not the harness's): every git child gets a built-from-nothing environment, no
// prompt, no global or system config, the network protocols closed, a time bound and an output bound, and its raw
// output, command line and environment are never put in an error. A shallow or partial (promisor) repository is a named
// refusal: its missing objects could mean a hidden fetch. See `git` below.
//
// IMPORT CLOSURE: node:child_process and node:fs. Nothing else, and nothing at import time.

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

export const SEGMENT_CLOCK = "blessed_at";
export const TRUSTED_WORLD_PRECONDITION =
  "The World repository must be a fresh clone fetched from origin with its tags, fetched after the moment window's end (`to`). "
  + "The export trusts the founder-supplied repository and does not certify it: it fetches nothing itself and asks no service. "
  + "The one check it makes is that the newest settlement tag in the supplied refs was blessed at or after `to`.";
const WORLD_STATE_PATH = "WORLD/world-state.json";
const SKELETON_PATH = "WORLD/skeleton.json";
const TAG_REF = /^refs\/tags\/settlement\/S(\d+)$/;
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
// refname, object type, tagger date: a lightweight tag has an empty tagger field. The peeled commit is NOT asked of for-each-ref (its
// `*` atoms peel a version-dependent number of levels); it is resolved explicitly by `<ref>^{commit}` below.
const FORMAT = ["%(refname)", "%(objecttype)", "%(taggerdate:iso-strict)"].join("%09");
const GIT_TIMEOUT_MS = 15_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

export class ExportWorldError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = "ExportWorldError"; this.code = code; }
}

/** What went wrong with one child git, in fixed words only: never its output, its command line, its environment or a path. */
class GitFail extends Error {
  constructor(kind, status) { super("git did not complete"); this.name = "GitFail"; this.kind = kind; this.status = status; }
}

/** The environment of every child git: built from nothing. Only PATH is carried over; nothing of the caller's GIT_*, HOME or credentials reaches git. */
function childEnv() {
  return {
    PATH: process.env.PATH ?? "",
    LC_ALL: "C", LANG: "C",
    GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ALLOW_PROTOCOL: "none", GIT_NO_LAZY_FETCH: "1", GIT_OPTIONAL_LOCKS: "0",
  };
}

/**
 * One child git, local and bounded. `-c protocol.allow=never` and GIT_ALLOW_PROTOCOL=none close every transport, so even a git that ignores
 * GIT_NO_LAZY_FETCH cannot fetch a missing object; a time bound and an output bound end a stuck or runaway child. `input` feeds stdin.
 * Throws GitFail (never the raw exec error).
 */
function git(repo, args, { input } = {}) {
  try {
    return execFileSync("git", ["-c", "protocol.allow=never", "-C", repo, ...args], {
      encoding: "utf8", input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"], env: childEnv(),
      timeout: GIT_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: GIT_MAX_BUFFER, windowsHide: true,
    });
  } catch (e) {
    if (e?.code === "ETIMEDOUT") throw new GitFail("timeout", null);
    if (e?.code === "ENOBUFS") throw new GitFail("output", null);
    throw new GitFail("failed", typeof e?.status === "number" ? e.status : null);
  }
}

/** Turn a caught error into a named one: a bound that ended the child keeps its own name, an ExportWorldError passes, anything else becomes `code`. */
function fail(e, code, message) {
  if (e instanceof ExportWorldError) throw e;
  if (e instanceof GitFail && e.kind === "timeout") throw new ExportWorldError("GIT_TIMEOUT", "a git read took too long and was stopped");
  if (e instanceof GitFail && e.kind === "output") throw new ExportWorldError("GIT_OUTPUT_TOO_LARGE", "a git read returned more than the bound allows");
  throw new ExportWorldError(code, message);
}

const isoOf = (ms) => new Date(ms).toISOString();
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * The repository, or a named refusal: a real path that is the top of a work tree (or a bare repository), not a subdirectory of some other
 * repo, and neither shallow nor partial (a promisor clone could answer a missing object by fetching it).
 */
function openRepo(worldRepo) {
  if (typeof worldRepo !== "string" || !worldRepo) throw new ExportWorldError("WORLD_REPO", "a local World repository path is required");
  let real;
  try { real = realpathSync(worldRepo); } catch { throw new ExportWorldError("WORLD_REPO", "the World repository path does not exist"); }
  let bare;
  try { bare = git(real, ["rev-parse", "--is-bare-repository"]).trim(); } catch (e) { fail(e, "WORLD_REPO", "the path is not a git repository"); }
  if (bare === "false") {
    let top;
    try { top = realpathSync(git(real, ["rev-parse", "--show-toplevel"]).trim()); } catch (e) { fail(e, "WORLD_REPO", "the repository's top could not be read"); }
    if (top !== real) throw new ExportWorldError("WORLD_REPO", "the path is not the top of a git work tree; another repository's tags are not read");
  }
  let shallow;
  try { shallow = git(real, ["rev-parse", "--is-shallow-repository"]).trim(); } catch (e) { fail(e, "WORLD_REPO", "the repository's depth could not be read"); }
  if (shallow === "true") throw new ExportWorldError("REPO_SHALLOW", "a shallow repository may lack the objects a settlement needs; supply a full clone");
  let partial = "";
  try { partial = git(real, ["config", "--local", "--get-regexp", "^(extensions[.]partialclone|remote[.].*[.](promisor|partialclonefilter))$"]); }
  catch (e) { if (!(e instanceof GitFail && e.kind === "failed" && e.status === 1)) fail(e, "WORLD_REPO", "the repository's configuration could not be read"); }
  for (const line of partial.split(/\r?\n/).filter(Boolean)) {
    const [key, value = ""] = line.split(" ");
    if (/[.]promisor$/.test(key) && /^(false|no|off|0)$/i.test(value)) continue;
    throw new ExportWorldError("REPO_PARTIAL", "a partial (promisor) clone could fetch a missing object; supply a full clone");
  }
  return real;
}

/**
 * Every `settlement/S<n>` tag of the repository, classified. A tag is QUALIFIED when it is an annotated tag object that peels, by an
 * explicit recursive `^{commit}`, to a commit and which carries its own tagger time. Anything else (lightweight, no tagger time, a tag
 * that does not reach a commit, a duplicate number) is listed as unqualified with its reason and never repaired here.
 * `tags` are sorted by number; `blessed_at_ms` is the OUTER tag's tagger time, `world_sha` the final commit.
 */
export function readSettlementTags(worldRepo) {
  const repo = openRepo(worldRepo);
  let out;
  try { out = git(repo, ["for-each-ref", `--format=${FORMAT}`, "refs/tags/settlement/"]); } catch (e) { fail(e, "TAGS_UNREADABLE", "the settlement tags could not be listed"); }
  const rows = [];
  for (const line of out.split(/\r?\n/).filter(Boolean)) {
    const [ref, type, tagger] = line.split("\t");
    const m = TAG_REF.exec(ref ?? "");
    if (!m) continue;                                   // not a settlement tag: it contributes nothing
    const n = Number(m[1]);
    if (!Number.isSafeInteger(n)) continue;
    rows.push({ n, tag: `settlement/S${n}`, ref, type, tagger });
  }
  // the commit each annotated tag reaches, by one bounded child: `<ref>^{commit}` peels as many tag layers as there are
  const annotated = rows.filter((r) => r.type === "tag");
  const commitOf = new Map();
  if (annotated.length) {
    let answer;
    try { answer = git(repo, ["cat-file", "--batch-check=%(objectname) %(objecttype)"], { input: `${annotated.map((r) => `${r.ref}^{commit}`).join("\n")}\n` }); }
    catch (e) { fail(e, "TAGS_UNREADABLE", "the settlement tags could not be peeled"); }
    const lines = answer.split(/\r?\n/).filter(Boolean);
    if (lines.length !== annotated.length) throw new ExportWorldError("TAGS_UNREADABLE", "the settlement tags could not be peeled");
    for (const [i, line] of lines.entries()) {
      const [sha, kind] = line.split(" ");
      if (kind === "commit" && SHA.test(sha ?? "")) commitOf.set(annotated[i].ref, sha);
    }
  }
  const byNumber = new Map();
  for (const r of rows) {
    const entry = { n: r.n, tag: r.tag, ref: r.ref };
    let why = null;
    if (r.type !== "tag") why = "lightweight_tag";
    else if (!commitOf.has(r.ref)) why = "tag_does_not_peel_to_a_commit";
    else if (!r.tagger) why = "no_tagger_time";
    else if (!Number.isFinite(Date.parse(r.tagger))) why = "tagger_time_unreadable";
    if (why) entry.why = why; else Object.assign(entry, { blessed_at_ms: Date.parse(r.tagger), blessed_at: isoOf(Date.parse(r.tagger)), world_sha: commitOf.get(r.ref) });
    if (!byNumber.has(r.n)) byNumber.set(r.n, []);
    byNumber.get(r.n).push(entry);
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

/** The first pair of readable settlements, in number order, whose blessing times disagree with their numbers, or null. */
function chronologyBreak(tags) {
  const byNumber = [...tags].sort((a, b) => a.n - b.n);
  for (let i = 1; i < byNumber.length; i++) if (byNumber[i].blessed_at_ms < byNumber[i - 1].blessed_at_ms) return [byNumber[i - 1], byNumber[i]];
  return null;
}

/** The highest-NUMBERED qualified tag (the ruling's "newest settlement tag"; settlements are ordered by number, not by time), or null. */
function newestByNumber(tags) {
  return tags.reduce((a, b) => (!a || b.n > a.n ? b : a), null);
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
  // the readable tags below it; it is out of the window only when a readable LOWER-numbered tag was already blessed after the window. That
  // witness is trusted only while the readable blessing times follow their numbers: if they do not, no readable time can show where the
  // unreadable one lies, and its own time is never invented.
  const broken = chronologyBreak(tags);
  for (const u of unqualified) {
    if (u.n <= start.n) continue;
    if (!tags.some((t) => t.n < u.n && t.blessed_at_ms > toMs)) throw new ExportWorldError("SETTLEMENT_UNQUALIFIED", `${u.tag} cannot be read as a blessing (${u.why}) and may lie inside the window`);
    if (broken) throw new ExportWorldError("SETTLEMENT_UNQUALIFIED", `${u.tag} cannot be read as a blessing (${u.why}), and the readable blessing times do not follow their numbers (${broken[1].tag} was blessed before ${broken[0].tag}), so no readable time can show it lies outside the window`);
  }
  // THE TAIL (Wright 15:22, part 2), last so every older refusal keeps its own reason: the newest settlement tag in the supplied refs must
  // have been blessed at or after the window's end. A tag blessed exactly at `to` passes. Numbering gaps are not read as missing tags.
  const newest = newestByNumber(tags);
  if (newest.blessed_at_ms < toMs) throw new ExportWorldError("SETTLEMENT_UNQUALIFIED", `the newest settlement tag in the supplied repository, ${newest.tag}, was blessed ${newest.blessed_at}, before the window ends ${isoOf(toMs)}: the repository is trusted to be fetched from origin with its tags after the window's end, and this one shows nothing after it`);
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
  try { text = git(repo, ["cat-file", "blob", `${sha}:${file}`]); } catch (e) { fail(e, "INPUT_MISSING", `${file} is not in the tree of ${sha}`); }
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
 * A recorded origin URL made safe to return or print: scheme, host, port and path of a network URL (http, https, ssh, git) or of an
 * scp-like `host:path`, and nothing else. User names, passwords, tokens in a query, fragments and the scp user are dropped; a local
 * path, a `file:` URL, any other scheme, control characters or anything unparseable is null (a local path would export a home directory).
 */
export function sanitizeOrigin(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || /[\u0000- \u007f]/.test(s)) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s);
  if (scheme) {
    const proto = scheme[1].toLowerCase();
    if (!["http", "https", "ssh", "git"].includes(proto)) return null;
    let u;
    try { u = new URL(s); } catch { return null; }
    if (!u.hostname) return null;
    return `${proto}://${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  }
  if (/^[/.~]/.test(s)) return null;                    // a local path
  const scp = /^(?:[^@/:]+@)?([^@/:]{2,}):(?!\/\/)(.+)$/.exec(s);
  if (!scp) return null;
  const path = scp[2].split(/[?#]/)[0];
  return path ? `${scp[1]}:${path}` : null;
}

/**
 * The line of provenance a later manifest records for the trusted repository (Wright 15:22, part 3): its origin as a safe URL or null, HEAD's commit
 * sha or null, and the newest settlement tag (the one the tail check uses) with its blessed_at. Read through the same bounded child; the raw origin
 * is sanitized before it leaves this function and is never put in an error. It records what was TRUSTED; it proves nothing about freshness.
 */
function worldProvenance(repo, tags) {
  let origin = null;
  try { origin = sanitizeOrigin(git(repo, ["config", "--local", "--get", "remote.origin.url"]).trim()); }
  catch (e) { if (!(e instanceof GitFail && e.kind === "failed")) fail(e, "TAGS_UNREADABLE", "the repository's origin could not be read"); }
  let head = null;
  try { const sha = git(repo, ["rev-parse", "--verify", "HEAD^{commit}"]).trim(); head = SHA.test(sha) ? sha : null; }
  catch (e) { if (!(e instanceof GitFail && e.kind === "failed")) fail(e, "TAGS_UNREADABLE", "the repository's HEAD could not be read"); }
  const newest = newestByNumber(tags);
  return { origin, head_sha: head, newest_settlement: newest ? { tag: newest.tag, blessed_at: newest.blessed_at } : null };
}

/**
 * The whole internal plan for a window: the ruled segments and, for each, its inputs at its own sha, and the provenance of the trusted repository.
 * Nothing here is a manifest, a bundle or a success claim; positions, air, telling, marks and assets are later steps. `internal_inputs` is not for
 * projection, and `world_provenance` is a feed for the later manifest writer, not that manifest.
 */
export function planWorldInputs(worldRepo, { fromMs, toMs }) {
  const timeline = readSettlementTags(worldRepo);
  const { segment_clock, segments } = resolveSegments(timeline, { fromMs, toMs });
  const internal_inputs = segments.map((s) => ({ settlement: s.settlement, world_sha: s.world_sha, ...readSegmentInputs(worldRepo, s.world_sha) }));
  const world_provenance = worldProvenance(openRepo(worldRepo), timeline.tags);
  return { segment_clock, segments, internal_inputs, world_provenance };
}
