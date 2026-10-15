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

import { readFileSync } from "node:fs";
import { refuse } from "./events.mjs";
import { registryRowsVia } from "./registry-store.mjs";
import { registryFromRows, pinsFromRows } from "./registry-rows.mjs";
import { resolveHouse, VIA } from "./household-deriver.mjs";
import { EARNED_BY, FOUNDER_ACCOUNTS, FOUNDER_HANDLES } from "./bugs.mjs";

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
  return { id, login: String(body.user.login ?? ""), pull: ref.kind === "pull" || Boolean(body?.pull_request) };
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
  if (j.earned.kind !== "letter") return judgeEarnedCredit(j, gh ? { gh } : null, folded);
  const row = (await client.query("SELECT json FROM town_letters WHERE id = $1", [j.earned.id])).rows[0];
  const from = row ? JSON.parse(row.json)?.from : null;
  if (!from)
    throw refuse(422, `no letter "${j.earned.id}" in the town's mail`,
      `${EARNED_BY[j.to]} — a letter link is the letter's id, as town { read: "letter" } reads it`, { field: "link" });
  return judgeEarnedCredit(j, { letter: { id: j.earned.id, from: String(from) } }, folded);
}
