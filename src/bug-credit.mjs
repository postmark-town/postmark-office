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
//   the founders             wright-starforge and keeminlee may credit only wright
//                            or keemin, and only they may credit them.
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
// the carrier's BODY names the PR it carries, on one line of its own:
//
//   carries: office#910
//
// Then fixed's credit is judged against the CARRIED PR's author, by the same
// judgeEarnedCredit. The line is data, never authority: it earns nothing unless
// both PRs' net diffs agree by `git patch-id --stable` AND byte for byte in what
// they change ("Patch-id is whitespace-blind … the carried diff must agree
// byte-for-byte in its changed content, with no whitespace normalization").
// Anything ambiguous or unsupported refuses, naming the mismatch, and a founder
// credits it by hand. Only fixed (and its recredit) reads a carry. A body can be
// edited after the merge, and the act keeps no copy of it: that is the ruled,
// stated limit, not a merge signature. The reads stay before the transaction:
// the carried PR, then each PR's net diff at the base and head commits its own
// JSON names (compare, as application/vnd.github.diff); git only hashes the
// diff's text on stdin, and nothing in either PR is applied or run.

import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { refuse } from "./events.mjs";
import { registryRowsVia } from "./registry-store.mjs";
import { registryFromRows, pinsFromRows } from "./registry-rows.mjs";
import { resolveHouse, VIA } from "./household-deriver.mjs";
import { EARNED_BY, FOUNDER_ACCOUNTS, FOUNDER_HANDLES, STATE_FIXED } from "./bugs.mjs";

export const GITHUB_READ_TOKEN_FILE = "/srv/postmark-office/git-metrics-token";
const GITHUB_API = "https://api.github.com";
const READ_TIMEOUT_MS = 8000;

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
  if (!ref || ref.kind === "letter") return null;
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

const CARRY_HOW = 'fixed credits a carried pull request\'s author only when the merged carrier\'s body declares it on one line of its own, "carries: <repo>#<n>" (its own repo: carries: office#910), and both make the same change, by patch-id and byte for byte; anything else a founder credits by hand';
const NO_DOUBT = "nothing was written: the office never pays a stage on doubt — ask again shortly, or a founder credits it by hand";
/** Any line that tries to declare a carry, wherever it stands (quoted, indented, any case). */
const DECLARES = /^[ \t]*(?:>[ \t]*)*carries[ \t]*:/i;
/** The one form that does: the whole line, a repo, and a number with no leading zero. */
const DECLARATION = /^carries: ([A-Za-z0-9_-][A-Za-z0-9._-]*)#([1-9][0-9]{0,8})$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const SHA_RE = /^[0-9a-f]{40}$/;
const PATCH_ID_TIMEOUT_MS = 10_000;

/**
 * The PR a carrier's body declares it carries, `{ repo, number }`; null when no
 * line tries to; else the refusal. Exactly one line, outside quotes and code
 * blocks, on the carrier's own repo (`office` names postmark-office), never itself.
 */
function carriedDeclarationOf(text, ref) {
  const name = `${ref.repo}#${ref.number}`;
  const tried = [];
  let fence = null;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const f = FENCE.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (DECLARES.test(line)) tried.push({ line, fenced: fence !== null });
  }
  if (!tried.length) return null;
  const bad = (defect) => refuse(422, defect, CARRY_HOW, { field: "link" });
  if (tried.length > 1) throw bad(`${name}'s body declares carries: more than once, and a carrier carries one pull request`);
  const [{ line, fenced }] = tried;
  if (fenced) throw bad(`${name}'s carries: line is inside a code block`);
  if (/^[ \t]*>/.test(line)) throw bad(`${name}'s carries: line is quoted`);
  const m = DECLARATION.exec(line);
  if (!m) throw bad(`${name}'s carries: line is not "carries: <repo>#<n>" on a line of its own`);
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
  if (String(pr?.body ?? "").split(/\r?\n/).some((l) => DECLARES.test(l)))
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
 * one char a byte). The index line and the hunks' line numbers are left out, as
 * patch-id leaves them. A binary, rename, copy or mode change, a path git would
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
export function judgeEarnedCredit({ to, credit, link }, author, { registry, pins }) {
  const teach = EARNED_BY[to];
  const creditFounder = FOUNDER_HANDLES.includes(credit);
  if (author?.gh) {
    const { id, login } = author.gh;
    const who = `GitHub account ${login || "?"} (id ${id})`;
    const authorFounder = Object.hasOwn(FOUNDER_ACCOUNTS, String(id));
    // A founder's PR never earns diagnosed or briefed, for anyone (#3757's link).
    if (authorFounder && author.gh.pull && (to === "diagnosed" || to === "briefed"))
      throw refuse(422, `${link} is a founder's pull request (${who}), and a founder's pull request never earns ${to}`,
        `${teach} — the founders' own builds are paid at fixed`, { field: "link" });
    if (authorFounder && !creditFounder)
      throw refuse(422, `${link} was written by a founder's account, ${who}, and a founder's work credits only ${FOUNDER_HANDLES.join(" or ")}`, teach, { field: "credit" });
    if (!authorFounder && creditFounder)
      throw refuse(422, `only a founder's account earns ${credit} a stage, and ${link} was written by ${who}`, teach, { field: "credit" });
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
  if (author?.letter) {
    const { id, from } = author.letter;
    const fromFounder = FOUNDER_HANDLES.includes(from);
    if (fromFounder !== creditFounder)
      throw refuse(422, fromFounder
        ? `letter "${id}" is from ${from}, a founder, and a founder's work credits only ${FOUNDER_HANDLES.join(" or ")}`
        : `only a founder's own letter earns ${credit} a stage, and letter "${id}" is from ${from}`, teach, { field: "credit" });
    if (from === credit || fromFounder) return;
    const want = keyOfHandle(credit, registry, pins);
    const have = keyOfHandle(from, registry, pins);
    if (have !== want)
      throw refuse(422, `letter "${id}" is from ${from}, of ${have}, and ${credit} stands in ${want}`,
        `${teach}: credit the letter's sender or a resident of their household`, { field: "credit" });
    return;
  }
  throw refuse(503, `the office could not prove who wrote ${link}`, "nothing was written: the office never pays a stage on doubt — ask again shortly", { field: "link" });
}

/**
 * The write's half: the registry, and a letter when the link is one, read
 * through the write's own client, then judged. `gh` is githubAuthorOf's answer,
 * read before the transaction opened.
 */
export async function judgeEarnedCreditVia(client, j, gh) {
  const rows = await registryRowsVia(client);
  const folded = { registry: registryFromRows(rows), pins: pinsFromRows(rows) };
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
