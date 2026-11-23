// bug-credit.mjs — WHOSE WORK EARNED THE STAGE (POS-649, a hotfix).
//
// bugs.mjs § AN EARNED STAGE IS CHECKED AGAINST ITS WORK holds the law and the
// link's kind. This file reads who wrote the linked work and judges it against
// the credit, before the act is written:
//
//   a comment, issue or PR   its GitHub author's ACCOUNT ID must be bound to the
//                            credited resident's household: the house whose
//                            accounts[] hold the id (the sign-in road,
//                            residency.mjs § houseForAccount), or the house of a
//                            handle pinned to the id (the `identities` view's
//                            gh_id). Never the login: a login is a label, and
//                            GitHub hands abandoned ones out again.
//   a letter                 its `from` is the credited resident, or a resident
//                            of the same household.
//   the bug's own post       (POS-1105) its reporter is the credited resident,
//                            or a resident of the same household, the letter's
//                            rule, when the post's own acts show its body or
//                            steps stand in the reporter's own words, each dated
//                            by the act that wrote it (§ ownPostEvidenceOf).
//   the founders             wright-starforge and keeminlee may credit only wright
//                            or keemin, and only they may credit them.
//   Starforge's Apps         the four Apps (bugs.mjs § HOUSE_APPS), by id AND
//                            login, credit wright only: an App's pull request
//                            earns fixed, and its issue comment diagnosed or
//                            briefed; nothing else (POS-867, POS-892, POS-931).
//
// NEVER PASS ON DOUBT. GitHub unreachable, an author bound to no house, a
// letter the store does not hold: each refuses, naming what could not be
// proven, and nothing is written. An advance is rare; a wrong mint is forever.
//
// ── THE READS ───────────────────────────────────────────────────────────────
//
// GitHub: ONE GET per advance (the comment, the issue or the pull), made BEFORE
// the write's transaction opens, so no store connection is held across the
// network (POS-370's lesson). The token is the box's read-only one,
// /srv/postmark-office/git-metrics-token (GITHUB_READ_TOKEN_FILE overrides
// it), and only to api.github.com itself; without one the read is keyless.
// GITHUB_API_URL is the test override the oauth dance and the pen already use.
//
// The store: the registry and the letter are read through the write's own
// client (registry-store.mjs § registryRowsVia), fresh on every advance rather
// than from the deriver's per-client memo, so a binding is judged as it stands.
//
// ── A CARRIED FIX (POS-912 W2; Wright, settled 2026-11-05 17:51:47Z) ─────────
//
// A resident's fix PR that can't merge as it stands is carried onto another PR,
// which merges (a fix PR into main comes from train/* or hotfix/*). "Link the
// CARRIER, credit the carried PR's author": fixed links the merged carrier, so
// the stage guard's merge and shipped proofs read it as they read any fix, and
// the FIRST LINE of the carrier's BODY names the PR it carries:
//
//   carries: office#910
//
// Then fixed's credit is judged against the CARRIED PR's author, by the same
// judgeEarnedCredit. The line is data, never authority: it earns nothing unless
// both PRs' net diffs agree by `git patch-id --stable` AND byte for byte in what
// they change ("Patch-id is whitespace-blind … the carried diff must agree
// byte-for-byte in its changed content, with no whitespace normalization").
// A first line that isn't the form, whole, declares nothing. Once one declares,
// anything ambiguous or unsupported refuses, naming the mismatch, and a founder
// credits it by hand. Only fixed (and its recredit) reads a carry. A body can be
// edited after the merge, and the act keeps no copy of it: that is the ruled,
// stated limit, not a merge signature. The reads stay before the transaction:
// the carried PR, then each PR's net diff at the base and head commits its own
// JSON names (compare, as application/vnd.github.diff); git only hashes the
// diff's text on stdin, and nothing in either PR is applied or run.

import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { refuse, ACT_POST, ACT_AMEND_POST } from "./events.mjs";
import { registryRowsVia } from "./registry-store.mjs";
import { registryFromRows, pinsFromRows } from "./registry-rows.mjs";
import { resolveHouse, VIA } from "./household-deriver.mjs";
import { BUG_CLASS, EARNED_BY, FOUNDER_ACCOUNTS, FOUNDER_HANDLES, HOUSE_APPS, STATE_FIXED } from "./bugs.mjs";

export const GITHUB_READ_TOKEN_FILE = "/srv/postmark-office/git-metrics-token";
const GITHUB_API = "https://api.github.com";
const READ_TIMEOUT_MS = 8000;
/** The one handle Starforge's own Apps earn a stage for (bugs.mjs § HOUSE_APPS). */
const HOUSE_APP_CREDIT = "wright";

const githubPath = (ref) =>
  ref.kind === "comment" ? `/repos/postmark-town/${ref.repo}/issues/comments/${ref.comment}`
    : ref.kind === "issue" ? `/repos/postmark-town/${ref.repo}/issues/${ref.number}`
      : `/repos/postmark-town/${ref.repo}/pulls/${ref.number}`;

function readToken(env) {
  try { return readFileSync(env.GITHUB_READ_TOKEN_FILE ?? GITHUB_READ_TOKEN_FILE, "utf8").trim() || null; }
  catch { return null; }
}

/**
 * Who wrote the linked work on GitHub: `{ id, login }`, or a refusal. `j` is
 * judgeAdvance's answer; a stage that links no GitHub work answers null.
 */
export async function githubAuthorOf(j, { env = process.env, fetchImpl = fetch } = {}) {
  const ref = j?.earned;
  if (!ref || ref.kind === "letter" || ref.kind === "post") return null;
  const api = String(env.GITHUB_API_URL ?? GITHUB_API).replace(/\/+$/, "");
  const token = api === GITHUB_API ? readToken(env) : null;
  const plain = { accept: "application/vnd.github+json", "user-agent": "postmark-office", "x-github-api-version": "2022-11-28" };
  const headers = { ...plain, ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const cannot = refuse(503, `GitHub could not be read, so the office cannot prove who wrote ${j.link}`,
    `nothing was written: the office never pays a stage on doubt — ask again shortly`, { field: "link" });
  let res, body;
  let tokenRefused = false;
  // A refused token is named, so an expired one is found at its first refusal (review-649 § 4).
  const tokenWas = () => refuse(503, `the office's GitHub read token was refused, and the keyless retry could not read ${j.link} either, so the office cannot prove who wrote it`,
    "nothing was written: renew the token (/srv/postmark-office/git-metrics-token), or ask again shortly", { field: "link" });
  try {
    const url = `${api}${githubPath(ref)}`;
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
    // A refused token (expired or revoked: review-649 § 4) would refuse every
    // linked advance. The repos are public, so the one retry is keyless.
    if (token && res.status === 401) {
      tokenRefused = true;
      res = await fetchImpl(url, { headers: plain, signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
    }
    if (res.status === 404 || res.status === 410)
      throw refuse(422, `${j.link} is not on GitHub`, `${EARNED_BY[j.to]} — link the work as GitHub shows it`, { field: "link" });
    if (!res.ok) throw cannot;
    body = await res.json();
  } catch (e) {
    if (e?.code === 422) throw e;
    throw tokenRefused ? tokenWas() : cannot;
  }
  if (ref.kind === "comment") {
    const want = `/repos/postmark-town/${ref.repo}/issues/${ref.number}`.toLowerCase();
    if (!String(body?.issue_url ?? "").toLowerCase().endsWith(want))
      throw refuse(422, `comment ${ref.comment} is not on ${ref.repo}#${ref.number}`, `${EARNED_BY[j.to]} — link the comment from the issue it sits on`, { field: "link" });
  }
  const id = body?.user?.id;
  if (!Number.isSafeInteger(id)) throw cannot;
  // An issue link GitHub answers as a PR is a PR (its issues API serves both).
  const author = { id, login: String(body.user.login ?? ""), pull: ref.kind === "pull" || Boolean(body?.pull_request) };
  // A CARRIED FIX (above): only fixed reads a carrier's declaration; none, and the PR's own author stands.
  if (j.to !== STATE_FIXED || ref.kind !== "pull") return author;
  const of = carriedDeclarationOf(body?.body, ref);
  return of ? carriedAuthorOf(ref, body, of, { env, fetchImpl }) : author;
}

// ── the carry: its declaration, the carried PR, and the two net diffs ────────

const CARRY_HOW = 'fixed credits a carried pull request\'s author only when the first line of the merged carrier\'s body declares it, "carries: <repo>#<n>" (its own repo: carries: office#910), and both make the same change, by patch-id and byte for byte; anything else a founder credits by hand';
const NO_DOUBT = "nothing was written: the office never pays a stage on doubt — ask again shortly, or a founder credits it by hand";
/** The one form that declares: the whole line, a repo, and a number with no leading zero. */
const DECLARATION = /^carries: ([A-Za-z0-9_-][A-Za-z0-9._-]*)#([1-9][0-9]{0,8})$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const PATCH_ID_TIMEOUT_MS = 10_000;

// A HIDDEN DECLARATION DOESN'T COUNT (Wright, settled 2026-11-05 19:57:03Z, answer 2): "the `carries:`
// declaration has to be visible to anyone reading the PR. A declaration inside an HTML comment (`<!-- … -->`),
// or anywhere else the rendered body hides, refuses with a reason naming it". So A DECLARATION COUNTS ONLY AS THE
// BODY'S FIRST LINE (Wright, 2026-11-06 22:01Z, POS-867). Nothing stands above a first line, so nothing can hide
// it, and the office judges no markup at all. A carries: line anywhere below is plain text: hidden or not, it
// earns nothing and refuses nobody. The old rule then stands, and the carrier's own author is judged.
/** The body's first line. Empty when the body opens with a line ending, so a leading blank line isn't skipped. */
const firstLineOf = (text) => String(text ?? "").split(/\r\n|\r|\n/, 1)[0];

/**
 * The PR a carrier's body declares it carries, `{ repo, number }`; null when its first line isn't the declaration,
 * whole; else the refusal. It names the carrier's own repo (`office` names postmark-office), and never itself.
 */
function carriedDeclarationOf(text, ref) {
  const m = DECLARATION.exec(firstLineOf(text));
  if (!m) return null;
  const name = `${ref.repo}#${ref.number}`;
  const bad = (defect) => refuse(422, defect, CARRY_HOW, { field: "link" });
  const own = ref.repo.toLowerCase();
  if (m[1].toLowerCase() !== own && `postmark-${m[1].toLowerCase()}` !== own)
    throw bad(`${name} declares it carries ${m[1]}#${m[2]}, and a carrier carries a pull request on its own repo, ${ref.repo}`);
  const number = Number(m[2]);
  if (number === ref.number) throw bad(`${name} declares it carries itself`);
  return { repo: ref.repo, number };
}

/**
 * The carried PR's author, once the carry is proven: `{ id, login, pull, carried }`
 * for judgeEarnedCredit, or the refusal. `carrierPr` is the carrier's JSON, read.
 */
async function carriedAuthorOf(ref, carrierPr, of, ctx) {
  const carrier = `${ref.repo}#${ref.number}`;
  const carried = `${of.repo}#${of.number}`;
  const why = (defect) => refuse(422, defect, CARRY_HOW, { field: "link" });
  const doubt = (defect) => refuse(503, defect, NO_DOUBT, { field: "link" });
  // the carrier must be MERGED: a founder's force goes past the stage guard, never past a carry's proof
  if (carrierPr?.merged !== true)
    throw refuse(409, `a carried credit waits for its carrier to merge: ${carrier} is not merged`, CARRY_HOW, { field: "link" });
  const got = await githubGet(`/repos/postmark-town/${of.repo}/pulls/${of.number}`, ctx);
  if (!got) throw doubt(`GitHub could not be read, so the office cannot prove who wrote ${carried}, which ${carrier} carries`);
  if (got.status === 404) throw why(`${carried}, which ${carrier} declares it carries, is not on GitHub`);
  const pr = got.body;
  if (!Number.isSafeInteger(pr?.user?.id)) throw doubt(`GitHub could not be read, so the office cannot prove who wrote ${carried}, which ${carrier} carries`);
  if (DECLARATION.test(firstLineOf(pr?.body)))
    throw why(`${carried}, which ${carrier} carries, declares a carry of its own, and a carried pull request is never carried again`);
  const said = { carrier, carried };
  const mine = await netDiffOf(carrier, of.repo, carrierPr, said, ctx);
  const theirs = await netDiffOf(carried, of.repo, pr, said, ctx);
  for (const [name, d] of [[carrier, mine], [carried, theirs]])
    if (!d.files.length) throw why(`${name}'s diff changes nothing, so there is no patch to carry`);
  // PATCH-ID: the same change against the same surrounding code, whitespace aside
  const ids = [];
  for (const [name, d] of [[carrier, mine], [carried, theirs]]) {
    try { ids.push(await patchIdOf(d.bytes)); }
    catch { throw doubt(`the office could not compute the patch-id of ${name}'s diff, so it cannot prove ${carrier} carries ${carried}`); }
  }
  if (ids[0] !== ids[1])
    throw why(`${carrier} and ${carried} are not the same patch (their patch-ids differ): a rebase that touched the hunks, a partial carry, or another change`);
  // AND THE BYTES: every file's added and removed lines, exactly, whitespace counted
  if (mine.files.length !== theirs.files.length || mine.files.some((f, i) => f.id !== theirs.files[i].id))
    throw why(`${carrier} and ${carried} change different files, though their patch-ids agree`);
  const differs = mine.files.find((f, i) => f.changed !== theirs.files[i].changed);
  if (differs)
    throw why(`${carrier} and ${carried} change different bytes in ${differs.path} (compared byte for byte, whitespace counted), though their patch-ids agree`);
  return { id: pr.user.id, login: String(pr.user.login ?? ""), pull: true,
    carried: { ref: carried, by: carrier, link: `https://github.com/postmark-town/${of.repo}/pull/${of.number}` } };
}

const files = (n) => `${Number.isSafeInteger(n) ? n : "?"} ${n === 1 ? "file" : "files"}`;
const num = (n) => (Number.isSafeInteger(n) ? n : "?");

/**
 * One PR's net diff at the base and head commits its own JSON names, read as
 * bytes and parsed (changesOf), and held to the counts GitHub states for the
 * PR: `{ bytes, files }`, or the refusal.
 */
async function netDiffOf(name, repo, pr, { carrier, carried }, ctx) {
  const base = String(pr?.base?.sha ?? ""), head = String(pr?.head?.sha ?? "");
  if (!SHA_RE.test(base) || !SHA_RE.test(head))
    throw refuse(503, `GitHub could not show ${name}'s commits, so the office cannot prove ${carrier} carries ${carried}`, NO_DOUBT, { field: "link" });
  const got = await githubGet(`/repos/postmark-town/${repo}/compare/${base}...${head}`, { ...ctx, diff: true });
  if (got?.status !== 200 || !Buffer.isBuffer(got.body))
    throw refuse(503, `GitHub could not serve ${name}'s diff (too large, unreadable or GitHub down), so the office cannot prove ${carrier} carries ${carried}`, NO_DOUBT, { field: "link" });
  const parsed = changesOf(got.body.toString("latin1"), name);
  const have = { files: parsed.length, add: 0, del: 0 };
  for (const f of parsed) { have.add += f.add; have.del += f.del; }
  const want = { files: pr.changed_files, add: pr.additions, del: pr.deletions };
  if (have.files !== want.files || have.add !== want.add || have.del !== want.del)
    throw refuse(422, `${name}'s diff (${files(have.files)}, +${have.add} −${have.del}) is not the pull request's own (${files(want.files)}, +${num(want.add)} −${num(want.del)}): cut short, or against another base, so the carry can't be checked`,
      CARRY_HOW, { field: "link" });
  return { bytes: got.body, files: parsed };
}

/**
 * A net diff as git writes it, per file: `{ path, id, changed, add, del }`, where
 * `id` is its ---/+++ and new/deleted-file lines and `changed` its added, removed
 * and no-newline lines, hunk by hunk, byte for byte (the text is read as latin1,
 * one char a byte). The index line and each hunk's @@ line (its line numbers and
 * section heading) are left out, as patch-id leaves them. A binary, rename, copy or mode change, a path git would
 * quote, a hunk that is not its header's length, or any line it does not read
 * refuses.
 */
function changesOf(text, name) {
  const out = [];
  const holds = (what, path) => refuse(422, `${name}'s diff holds ${what} (${path}), which the office does not compare, so the carry can't be checked`, CARRY_HOW, { field: "link" });
  let file = null, left = null;   // left: the hunk's lines still owed, { old, new }
  const close = () => {
    if (left && (left.old > 0 || left.new > 0))
      throw refuse(422, `${name}'s diff has a hunk shorter than its header in ${file.path}: cut short, so the carry can't be checked`, CARRY_HOW, { field: "link" });
    left = null;
  };
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (file) close();
      const m = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
      if (!m) throw holds("a path the office does not read", line.slice("diff --git ".length, 100));
      file = { path: m[1], head: [], changed: [], add: 0, del: 0 };
      out.push(file);
      continue;
    }
    if (!file) throw holds("a line before its first file", "its start");
    let h;
    if ((h = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line))) {
      close();
      left = { old: h[1] === undefined ? 1 : Number(h[1]), new: h[2] === undefined ? 1 : Number(h[2]) };
      file.changed.push("@@");
      continue;
    }
    if (left) {
      const c = line[0];
      if (c === "\\") { file.changed.push(line); continue; }
      if (c === " " && left.old > 0 && left.new > 0) { left.old--; left.new--; continue; }
      if (c === "-" && left.old > 0) { left.old--; file.del++; file.changed.push(line); continue; }
      if (c === "+" && left.new > 0) { left.new--; file.add++; file.changed.push(line); continue; }
      throw holds("a line the office does not read", file.path);
    }
    if (/^index [0-9a-f]{7,64}\.\.[0-9a-f]{7,64}(?: 100644| 100755)?$/.test(line)) continue;
    if (/^(?:new|deleted) file mode 100(?:644|755)$/.test(line) || /^--- (?:a\/\S+|\/dev\/null)$/.test(line) || /^\+\+\+ (?:b\/\S+|\/dev\/null)$/.test(line)) {
      file.head.push(line);
      continue;
    }
    if (/^(?:Binary files |GIT binary patch)/.test(line)) throw holds("a binary change", file.path);
    if (/^(?:rename|copy) (?:from|to) |^(?:dis)?similarity index /.test(line)) throw holds("a rename or copy", file.path);
    if (/^(?:old|new) mode /.test(line)) throw holds("a mode change", file.path);
    throw holds("a line the office does not read", file.path);
  }
  if (file) close();
  return out.map((f) => ({ path: f.path, id: f.head.join("\n"), changed: f.changed.join("\n"), add: f.add, del: f.del }));
}

/**
 * git's stable patch-id of a diff's bytes, handed on stdin to a fixed command.
 * Anything but one 40-hex id rejects, so two diffs git can't identify never
 * agree by both answering nothing (measured, git 2.43.0: every parsed diff,
 * down to a bare `diff --git` line, gets an id).
 */
const patchIdOf = (bytes) => new Promise((resolve, reject) => {
  const git = execFile("git", ["patch-id", "--stable"], { encoding: "utf8", timeout: PATCH_ID_TIMEOUT_MS, windowsHide: true }, (err, out) => {
    const id = String(out ?? "").split(" ")[0];
    return err || !SHA_RE.test(id) ? reject(err ?? new Error("git patch-id gave no id")) : resolve(id);
  });
  git.stdin.on("error", () => {});
  git.stdin.end(bytes);
});

/**
 * One GET against the town's GitHub, for the stage guard (bug-stage-guard.mjs):
 * `{ status, body }` for any answer GitHub gives (404 included), or null when
 * it could not be read at all (no answer, a timeout, a rate limit, a 5xx, a
 * refused token with the keyless retry refused too). The same token, the same
 * keyless retry on a 401 and the same test override as githubAuthorOf.
 * `diff: true` asks for the text of a diff instead (application/vnd.github.diff),
 * and `body` is its bytes as GitHub sent them (a carried fix, POS-912).
 */
export async function githubGet(apiPath, { env = process.env, fetchImpl = fetch, diff = false } = {}) {
  const api = String(env.GITHUB_API_URL ?? GITHUB_API).replace(/\/+$/, "");
  const token = api === GITHUB_API ? readToken(env) : null;
  const plain = { accept: diff ? "application/vnd.github.diff" : "application/vnd.github+json", "user-agent": "postmark-office", "x-github-api-version": "2022-11-28" };
  const headers = { ...plain, ...(token ? { authorization: `Bearer ${token}` } : {}) };
  try {
    const url = `${api}${apiPath}`;
    let res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
    if (token && res.status === 401) res = await fetchImpl(url, { headers: plain, signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
    if (res.status === 404 || res.status === 410) return { status: 404, body: null };
    if (!res.ok) return null;
    return { status: res.status, body: diff ? Buffer.from(await res.arrayBuffer()) : await res.json() };
  } catch { return null; }
}

/** The household a handle stands in, as the act would be filed: `hh:<slug>`, else `solo:<handle>`. */
function keyOfHandle(handle, registry, pins) {
  const { slug } = resolveHouse(handle, registry, pins, { via: [VIA.RESIDENT, VIA.PIN] });
  return slug ? `hh:${slug}` : `solo:${handle}`;
}

/** Every household an account id is bound to: its house by accounts[], and the house of each handle pinned to it. */
export function householdsOfAccount(id, registry, pins) {
  const out = new Set();
  const { slug } = resolveHouse({ ghId: id }, registry, {}, { via: VIA.ACCOUNT });
  if (slug) out.add(`hh:${slug}`);
  for (const [handle, pin] of Object.entries(pins ?? {})) {
    if (pin?.id != null && Number(pin.id) === Number(id)) out.add(keyOfHandle(handle, registry, pins));
  }
  return out;
}

/**
 * Judge the credit against the work's author. Pure. `author` is
 * `{ gh: { id, login } }` or `{ letter: { id, from } }`; `registry` and `pins`
 * are the store's, folded. Throws the refusal, or returns nothing.
 */
export function judgeEarnedCredit({ to, credit, link, earned }, author, { registry, pins }) {
  const teach = EARNED_BY[to];
  const creditFounder = FOUNDER_HANDLES.includes(credit);
  if (author?.gh) {
    const { id, login } = author.gh;
    const who = `GitHub account ${login || "?"} (id ${id})`;
    // Starforge's own Apps (bugs.mjs § HOUSE_APPS): an App's PR earns wright fixed, its issue comment wright
    // diagnosed or briefed, and nothing else for anyone (POS-867; Wright, 2026-11-07 17:16:15Z).
    if (HOUSE_APPS.some((a) => a.bot_id === id && `${a.slug}[bot]` === login)) {
      const comment = earned?.kind === "comment" && !author.gh.pull;
      if (to === STATE_FIXED ? !author.gh.pull : !comment)
        throw refuse(422, `${link} was written by one of Starforge's own Apps, ${who}, and an App's pull request earns only fixed, and its issue comment only diagnosed or briefed`, teach, { field: "link" });
      if (credit !== HOUSE_APP_CREDIT)
        throw refuse(422, `${link} was written by one of Starforge's own Apps, ${who}, and an App's work credits only ${HOUSE_APP_CREDIT}`, teach, { field: "credit" });
      return;
    }
    const authorFounder = Object.hasOwn(FOUNDER_ACCOUNTS, String(id));
    // A founder's PR never earns diagnosed or briefed, for anyone (#3757's link).
    if (authorFounder && author.gh.pull && (to === "diagnosed" || to === "briefed"))
      throw refuse(422, `${link} is a founder's pull request (${who}), and a founder's pull request never earns ${to}`,
        `${teach} — the founders' own builds are paid at fixed`, { field: "link" });
    if (authorFounder && !creditFounder)
      throw refuse(422, `${link} was written by a founder's account, ${who}, and a founder's work credits only ${FOUNDER_HANDLES.join(" or ")}`, teach, { field: "credit" });
    if (!authorFounder && creditFounder)
      throw refuse(422, credit === HOUSE_APP_CREDIT
        ? `only a founder's account or one of Starforge's own Apps earns ${credit} ${to}, and ${link} was written by ${who}`
        : `only a founder's account earns ${credit} a stage, and ${link} was written by ${who}`, teach, { field: "credit" });
    if (authorFounder) return;
    const bound = householdsOfAccount(id, registry, pins);
    if (!bound.size)
      throw refuse(422, `${link} was written by ${who}, which is bound to no household here`,
        `${teach}, and the author's account must be bound by id to the credited resident's household, as at sign-in`, { field: "credit" });
    const want = keyOfHandle(credit, registry, pins);
    if (!bound.has(want))
      throw refuse(422, `${link} was written by ${who}, of ${[...bound].join(", ")}, and ${credit} stands in ${want}`,
        `${teach}: credit a resident of the author's household, or link ${credit}'s own work`, { field: "credit" });
    return;
  }
  // A letter, and the bug's own post (POS-1105): one rule, its writer or their household; a founder's credits only a founder.
  const sent = author?.letter ? { ...author.letter, noun: "letter", is: "is from", whose: "the letter's sender" }
    : author?.post ? { ...author.post, noun: "post", is: "was written by", whose: "its reporter" } : null;
  if (sent) {
    const { id, from, noun, is, whose } = sent;
    const fromFounder = FOUNDER_HANDLES.includes(from);
    if (fromFounder !== creditFounder)
      throw refuse(422, fromFounder
        ? `${noun} "${id}" ${is} ${from}, a founder, and a founder's work credits only ${FOUNDER_HANDLES.join(" or ")}`
        : `only a founder's own ${noun} earns ${credit} a stage, and ${noun} "${id}" ${is} ${from}`, teach, { field: "credit" });
    if (from === credit || fromFounder) return;
    const want = keyOfHandle(credit, registry, pins);
    const have = keyOfHandle(from, registry, pins);
    if (have !== want)
      throw refuse(422, `${noun} "${id}" ${is} ${from}, of ${have}, and ${credit} stands in ${want}`,
        `${teach}: credit ${whose} or a resident of their household`, { field: "credit" });
    return;
  }
  throw refuse(503, `the office could not prove who wrote ${link}`, "nothing was written: the office never pays a stage on doubt — ask again shortly", { field: "link" });
}

// ── THE BUG'S OWN POST (POS-1105) ───────────────────────────────────────────
//
// Wright's § 3b (CORE-105): "The cause has to be in the text the reporter
// wrote, dated by the act that wrote it." A report carries its words in two
// fields, the body and the steps, and the post's own acts say who last wrote
// EACH, and when (the review of #1167 at d1f298c2: one date for both named a
// cause by an act that wrote only the other field):
//   · the `post` act writes the body, and the steps when it sends them. Its
//     actor is the reporter; when a hand put it up on their behalf (`for`), it
//     names that `hand`, and the words are the hand's transcription.
//   · an `amend` writes only the fields its `changed` names. It is the
//     reporter's own when its actor is the reporter and it names no hand.
// So each field stands as written by the last act that wrote it: the reporter's
// own words, dated by that act, or a hand's, which are never counted as the
// reporter's. A hand's edit is not permanent: a field the reporter writes again
// is theirs from that act, and a hand's edit to one field leaves the other as
// it was. Title, issue and record are not the report's words, and an amend of
// them dates nothing. The receipt names each field's writer, act and date, and
// the checker judges which field, if either, names the cause. The office
// refuses only when neither field stands in the reporter's own words, or the
// acts are missing or cannot be read; nothing is written.
const OWN_TEXT = Object.freeze(["body", "steps"]);
const OWN_POST_HOW = (to) => `${EARNED_BY[to]} — the post's own link is earned by the words its reporter wrote: a body or steps a hand put up or last rewrote is not theirs, so link the letter or comment the reporter wrote`;
const NO_DOUBT_ACTS = "nothing was written: the office never pays a stage on doubt — ask again shortly";
const actPayload = (a) => (typeof a.payload === "string" ? JSON.parse(a.payload) : (a.payload ?? {}));
const was = (field) => (field === "steps" ? "were" : "was");

/**
 * Who last wrote each of the bug's own post's words, and when: `{ from, fields:
 * { body, steps? } }`, each `{ act, at, by, own }` (`own`: the reporter's own
 * words; `by`: the reporter, or the hand that wrote them), from the post's
 * `post` and `amend` acts, oldest first. Refuses when no field is the
 * reporter's own, or the acts are missing or unreadable. Pure. `to` is the stage
 * the link earns, for the refusals' teaching.
 */
export function ownPostEvidenceOf(id, acts, to = "diagnosed") {
  const how = OWN_POST_HOW(to);
  const mine = (acts ?? []).filter((a) => a.object === id);
  const posted = mine.find((a) => a.action === ACT_POST);
  if (!posted || !posted.actor)
    throw refuse(422, `the office holds no post act for "${id}", so it cannot show who wrote its words`, how, { field: "link" });
  const reporter = String(posted.actor);
  const fields = {};
  const wrote = (field, a, hand) => {
    const at = new Date(a.at);
    if (Number.isNaN(at.getTime()))
      throw refuse(503, `the office could not read when "${id}"'s ${field} was written (act ${a.id})`, NO_DOUBT_ACTS, { field: "link" });
    const own = !hand && String(a.actor) === reporter;
    fields[field] = { act: a.id, at: at.toISOString(), by: own ? reporter : String(hand ?? a.actor), own };
  };
  try {
    const p = actPayload(posted);
    wrote("body", posted, p.hand);
    if (p.fields?.steps !== undefined) wrote("steps", posted, p.hand);
    for (const a of mine.filter((x) => x.action === ACT_AMEND_POST)) {
      const q = actPayload(a);
      for (const field of (Array.isArray(q.changed) ? q.changed : []).filter((k) => OWN_TEXT.includes(k))) wrote(field, a, q.hand);
    }
  } catch (e) {
    if (e?.code === 422 || e?.code === 503) throw e;
    throw refuse(503, `the office could not read the acts of "${id}", so it cannot show who wrote its words`, NO_DOUBT_ACTS, { field: "link" });
  }
  if (!Object.values(fields).some((f) => f.own))
    throw refuse(422, `no word of "${id}"'s report stands as ${reporter}'s own: ${Object.entries(fields).map(([k, f]) => `its ${k} ${was(k)} last written by ${f.by}'s hand (act ${f.act})`).join(", and ")}`, how, { field: "link" });
  return { from: reporter, fields };
}

/** The receipt's words for the own post's evidence: each field's writer, act and date, and which are not the reporter's. */
export function ownWordsReceipt({ from, fields }) {
  const own = Object.entries(fields).filter(([, f]) => f.own).map(([k, f]) => `its ${k} written by act ${f.act} (${f.at})`);
  const not = Object.entries(fields).filter(([, f]) => !f.own).map(([k, f]) => `its ${k} ${was(k)} last written by ${f.by}'s hand (act ${f.act}, ${f.at}), so ${k === "steps" ? "they are" : "it is"} not ${from}'s and earn${k === "steps" ? "" : "s"} nothing`);
  return `, the report's own words by ${from}: ${own.join(", and ")}${not.length ? `; ${not.join("; ")}` : ""}`;
}

/**
 * The write's half: the registry, and a letter or the bug's own post's acts
 * when the link is one, read through the write's own client, then judged. `gh`
 * is githubAuthorOf's answer, read before the transaction opened. Answers the
 * own post's evidence, `{ from, fields }`, for the receipt; otherwise nothing.
 */
export async function judgeEarnedCreditVia(client, j, gh) {
  const rows = await registryRowsVia(client);
  const folded = { registry: registryFromRows(rows), pins: pinsFromRows(rows) };
  if (j.earned.kind === "post") {
    let acts;
    try {
      ({ rows: acts } = await client.query(
        "SELECT id, object, action, actor, at, payload FROM acts WHERE class = $1 AND object = ANY($2) AND action = ANY($3) ORDER BY id",
        [BUG_CLASS, [j.earned.id], [ACT_POST, ACT_AMEND_POST]]));
    } catch {
      throw refuse(503, `the office could not read the acts of "${j.earned.id}", so it cannot show who wrote its words`, "nothing was written: the office never pays a stage on doubt — ask again shortly", { field: "link" });
    }
    const ev = ownPostEvidenceOf(j.earned.id, acts, j.to);
    judgeEarnedCredit(j, { post: { id: j.earned.id, from: ev.from } }, folded);
    return ev;
  }
  // a carried fix is judged as its carried PR's work, and its refusals name both PRs
  if (j.earned.kind !== "letter")
    return judgeEarnedCredit(gh?.carried ? { ...j, link: `${gh.carried.link} (carried by ${j.link})` } : j, gh ? { gh } : null, folded);
  const row = (await client.query("SELECT json FROM town_letters WHERE id = $1", [j.earned.id])).rows[0];
  const from = row ? JSON.parse(row.json)?.from : null;
  if (!from)
    throw refuse(422, `no letter "${j.earned.id}" in the town's mail`,
      `${EARNED_BY[j.to]} — a letter link is the letter's id, as town { read: "letter" } reads it`, { field: "link" });
  return judgeEarnedCredit(j, { letter: { id: j.earned.id, from: String(from) } }, folded);
}
