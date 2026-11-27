// bind-household-account.mjs — one more GitHub account appended to an existing household, proof first (POS-1259).
//
// Why (town #4758): the Bug Catcher could not credit Tidemark's merged office #1244 and site #511, because their
// author, GitHub account harpytfc (id 215802487), is bound to no household, and The Workshop lists only harpylandfall
// (340503351). No door adds a second account to a house that already stands: the join appends one only for an
// account the house already vouches for, and the co-sign founds a house. Darko, POS-1259/a: "Yes, with proof first."
// The ruling: "harpytfc comments on town #4758 that it is the keeper's account, and harpylandfall authorizes adding it
// to The Workshop; then Rivet applies the operator-only additive bind." Wright: "apply the bind only once both
// confirmations are there, from the right GitHub authors." This is household authority, not a credit alias.
//
//   node tools/bind-household-account.mjs --household <slug> --account-id <id> --account-login <login>
//     --issue <owner>/<repo>#<n> --request <comment url> --account-proof <comment url> --keeper-proof <comment url>
//     (--dry-run | --apply --accept <digest>)
//
// Run it as move-resident runs (tools/move-resident.mjs): on the box under the town lock, with the office's env (the
// store as the office reads it, TOWN_CLONE, TOWN_PUSH, the box's read-only GitHub token). The store write is the
// office's own pen role, `office_api`, which holds UPDATE on `households` (019); no owner's connection is needed.
//
// THE PROOF, read from GitHub at every run, never taken from the operator's word:
//
//   · --request: the town's ask on --issue (Wright's, on town #4758), naming the account and the house, written by
//     neither answering account. It gives the answers their meaning; both must be posted after it.
//   · --account-proof: the answer whose author's numeric GitHub id IS --account-id (and whose login is
//     --account-login): the account is the keeper's;
//   · --keeper-proof: the answer whose author's numeric id is one of the accounts the household ALREADY lists (never
//     the account being bound): the house authorizes it.
//
// Each comment's issue is GitHub's own `issue_url`, not the link's spelling. A login can be renamed and an id cannot,
// so the id decides. The answers are read with every quoted line (`> …`) and code block taken out: one with no words
// of its own, or with a negation (not, never, don't, wait, revoke …), is not a proof. THE WORDS ARE THE OPERATOR'S
// TO JUDGE, against the request: the ruling's confirmations are ordinary replies in context ("this is my account as
// well as the harpy landfall one"; "confirming same account from Harpylandfall"), which no phrase list reads fairly.
// So the dry run prints the three bodies (to 1200 characters, a longer one marked cut) and a digest of exactly those
// comments, and --apply runs only with `--accept <digest>`: the words a person read and accepted are the words the
// write runs on, and an answer edited, swapped or added since changes the digest and refuses. A dry run reports each
// verdict and refuses nothing for it; an --apply without all three standing, or without the digest, writes nothing.
//
// WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT:
//
//   · THE STORE, in one statement (src/registry-store.mjs § appendHouseholdAccount): `{ login, id }` appended to the
//     END of the house's `accounts`, the login spelled as GitHub spells it. It is written only while the row still
//     holds the accounts the plan read, no house lists the id and no pin carries it, so a race writes nothing.
//   · THE TOWN FILES, in one pen commit: the registry drain prints tools/households.json from the store; the house's
//     entry gains the account and nothing else moves (COLLATERAL refuses otherwise, move-resident's rule).
//   · NOT CHANGED: the house's residents, name, human, since, membership, former keys, home pictures, likeness,
//     hearth and invitation; every pin (tools/github-ids.json); the stamp ledger (no key line: no resident's key
//     moves). Sign-in finds a handle by its PIN, so the new account signs in to no resident; what it gains is what
//     reads a house's accounts: the Bug Catcher's author check, and the house's own settings.
//   · THE KEYS (src/house-key.mjs's judgment, asked before any write): the house's residents must already stand on
//     `hh:<slug>` in the town's own fold, since this tool keys no one. The town reads every account of a house as
//     that house (stamp-mint.mjs § houseCanonOf: `gh:<id>` → `hh:<slug>`), so the ledger must carry no `gh:<id>`
//     key for the new id, or minted history would regroup.
//   · THE SPELLINGS (household-deriver.mjs § houseKeysOf, folded over the row as it will stand): the account adds
//     `gh:<id>` and `solo:<login>` to the set the house's sessions read rows by (024's draft policies). A spelling it
//     adds that another house's set already holds (a resident's handle, an old pinned login, under another id) would
//     open that house's old-spelled rows to this one, so it refuses; the plan prints what the set gains.
//
// RESUMABLE AND REPEATABLE. The store binds before the commit, so a push that cannot land leaves the store bound and
// the clone as it was; the same command then finds the account already in the house, writes nothing to the store,
// and prints and commits what the town's files still lack. Once the printout carries it, the same command does
// nothing at all. An account already in ANOTHER house, or carried by any pin, refuses before any write.

import { readFileSync, realpathSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { loadRegistryRows, appendHouseholdAccount } from "../src/registry-store.mjs";
import { registryFromRows, pinsFromRows, renderPublicRegistry } from "../src/registry-rows.mjs";
import { collectingDrain } from "../src/ceremony.mjs";
import { currentKeysOf, LEDGER_REL } from "../src/house-key.mjs";
import { penCommit, penTransaction, landOrRefuse } from "../src/write.mjs";
import { REGISTRY_PATH, PINS_PATH } from "../src/residency.mjs";
import { githubGet, householdsOfAccount } from "../src/bug-credit.mjs";
import { houseKeysOf } from "../src/household-deriver.mjs";
import { easternDate } from "./rekey-household.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export const BIND_REFUSALS = Object.freeze({
  NO_RECORD: { code: 503, defect: "the office cannot reach the town's record — nothing was written" },
  NO_HOUSE: { code: 404, defect: "no household stands at --household" },
  PINNED: { code: 409, defect: "a pin carries --account-id: binding it would rehouse that handle — a person reads it; nothing was written" },
  OTHER_HOUSE: { code: 409, defect: "--account-id is already bound to another household — nothing was written" },
  OFF_KEY: { code: 409, defect: "a resident of --household is not on the house's own key: this tool appends an account and keys no one — nothing was written" },
  KEY_ALIAS: { code: 409, defect: "the stamp ledger already carries a key for --account-id, which the house would take over — a person reads it; nothing was written" },
  SHARED_SPELLING: { code: 409, defect: "the account would give --household a spelling another household already holds, and with it that house's rows — a person reads it; nothing was written" },
  COLLATERAL: { code: 409, defect: "printing the registry would change more than --household — the town's files are behind the store elsewhere; run the registry drain first" },
  PROOF_MISSING: { code: 422, defect: "--apply needs the request and both public answers, --request, --account-proof and --keeper-proof — nothing was written" },
  PROOF_UNREAD: { code: 503, defect: "a proof could not be read from GitHub just now — nothing was written; try again" },
  PROOF_REFUSED: { code: 422, defect: "a proof does not stand — nothing was written" },
  PROOF_UNACCEPTED: { code: 409, defect: "--apply needs --accept <digest> from a dry run over these same comments: the operator's reading of exactly these words — nothing was written" },
  CHANGED: { code: 409, defect: "the house's accounts, another house or a pin changed between the plan and the write — nothing was written; run it again" },
  DRAIN_REFUSED: { code: 409, defect: "the registry drain refused to print" },
});

const refuse = (r, detail = null) => Object.assign(new Error(r.defect), { code: r.code, defect: r.defect, detail });

const read = (clone, rel) => { try { return readFileSync(join(clone, rel), "utf8"); } catch { return null; } };
const filesHouses = (clone) => JSON.parse(read(clone, REGISTRY_PATH) ?? "{}").households ?? {};
const cloneHead = (clone) => { try { return execFileSync("git", ["-C", clone, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return null; } };
const sameId = (a, id) => a?.id != null && String(a.id) === String(id);

// ── the proofs ──────────────────────────────────────────────────────────────

const ISSUE_RE = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)#(\d+)$/;
const COMMENT_RE = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/issues\/(\d+)#issuecomment-(\d+)$/;

/** `owner/repo#n` → `{ owner, repo, number }`, or null. */
export function parseIssue(s) {
  const m = ISSUE_RE.exec(String(s ?? "").trim());
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
}

/** A comment's link → `{ owner, repo, number, comment, url }`, or null. */
export function parseCommentUrl(s) {
  const url = String(s ?? "").trim();
  const m = COMMENT_RE.exec(url);
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]), comment: m[4], url } : null;
}

/** A body's own words: quoted lines and code blocks taken out, curly apostrophes made straight, lower case. */
export function ownWords(body) {
  return String(body ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\r?\n/).filter((l) => !/^\s*>/.test(l)).join("\n")
    .replace(/[‘’]/g, "'")
    .toLowerCase();
}

const NEGATION_RE = /\b(not|no|never|nope|cannot|refuse[sd]?|deny|denie[sd]|decline[sd]?|revoke[sd]?|withdraw[sn]?|wait|stop|cancel(?:led|s)?|undo)\b|n't\b/;
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const names = (text, word) => new RegExp(`(^|[^a-z0-9-])${escapeRe(String(word).toLowerCase())}([^a-z0-9-]|$)`).test(text);
const FLAG = { request: "--request", account: "--account-proof", keeper: "--keeper-proof" };

/**
 * Judge one comment against what its role asks of it. PURE over GitHub's answer for the comment (`got`: githubGet's
 * `{ status, body }`, or null when it could not be read). `role` is "request" (the town's ask on the issue, which
 * gives the answers their meaning), "account" or "keeper"; `after` is the request's `created_at`, which both answers
 * must follow. Returns `{ ok, role, ref, url, why?, unread?, author?, created_at?, updated_at?, body? }`.
 */
export function judgeProof({ role, ref, got, issue, account, house, after = null }) {
  const out = { role, ref: ref ?? null, url: ref?.url ?? null, ok: false };
  if (!ref) return { ...out, why: `no ${FLAG[role]} was given` };
  const wanted = `${issue.owner}/${issue.repo}#${issue.number}`;
  if (`${ref.owner}/${ref.repo}#${ref.number}`.toLowerCase() !== wanted.toLowerCase())
    return { ...out, why: `${ref.url} is not a comment on ${wanted}` };
  if (got == null) return { ...out, unread: true, why: `${ref.url} could not be read from GitHub` };
  if (got.status === 404 || !got.body) return { ...out, why: `${ref.url} is not on GitHub (deleted, or never there)` };
  const c = got.body;
  const issueUrl = String(c.issue_url ?? "");
  if (!issueUrl.toLowerCase().endsWith(`/repos/${issue.owner}/${issue.repo}/issues/${issue.number}`.toLowerCase()))
    return { ...out, why: `GitHub says ${ref.url} belongs to ${issueUrl || "no issue"}, not ${wanted}` };
  const id = c.user?.id, login = String(c.user?.login ?? "");
  const seen = { ...out, author: { login, id: Number.isSafeInteger(id) ? id : null, type: c.user?.type ?? null },
    created_at: c.created_at ?? null, updated_at: c.updated_at ?? null, body: String(c.body ?? "") };
  if (!Number.isSafeInteger(id)) return { ...seen, why: `${ref.url} carries no numeric author id` };
  if (c.user?.type !== "User") return { ...seen, why: `${ref.url} was written by ${login} (${c.user?.type ?? "no type"}), not a person's account` };
  const words = ownWords(c.body);
  const houseAccount = (house.accounts ?? []).some((a) => sameId(a, id));
  if (role === "request") {
    // THE ASK: the town's, never the house's or the new account's own, and about this account and this house
    if (String(id) === String(account.id) || houseAccount)
      return { ...seen, why: `${ref.url} was written by ${login} (id ${id}), one of the two accounts answering; the request is the town's ask` };
    if (!(names(words, account.login) || names(words, String(account.id))) || ![house.slug, house.name].filter(Boolean).some((w) => names(words, w)))
      return { ...seen, why: `${ref.url} does not ask about ${account.login} (${account.id}) and ${house.name ?? house.slug} by name` };
    return { ...seen, ok: true };
  }
  if (!words.trim()) return { ...seen, why: `${ref.url} has no words of its own (only quoted lines or code), so it confirms nothing` };
  if (NEGATION_RE.test(words)) return { ...seen, why: `${ref.url}'s own words carry a negation (${NEGATION_RE.exec(words)[0]}), so they are read by a person, never as a yes` };
  if (after && !(Date.parse(c.created_at) > Date.parse(after)))
    return { ...seen, why: `${ref.url} was posted at ${c.created_at}, before the request it answers (${after})` };
  if (role === "account") {
    if (String(id) !== String(account.id))
      return { ...seen, why: `${ref.url} was written by ${login} (id ${id}), not the account being bound (id ${account.id})` };
    if (login.toLowerCase() !== String(account.login).toLowerCase())
      return { ...seen, why: `${ref.url}'s author is id ${id}, now spelled ${login}, not --account-login ${account.login}` };
    return { ...seen, ok: true };
  }
  if (String(id) === String(account.id))
    return { ...seen, why: `${ref.url} was written by the account being bound; the authorization is the house's own, from an account it already lists` };
  if (!houseAccount)
    return { ...seen, why: `${ref.url} was written by ${login} (id ${id}), which ${house.slug} does not list (it lists ${(house.accounts ?? []).map((a) => `${a.login} ${a.id}`).join(", ") || "none"})` };
  return { ...seen, ok: true };
}

/**
 * THE OPERATOR'S READING, PINNED: a digest of exactly the three comments judged (each one's id, author id and words).
 * The dry run prints it and --apply must be handed it back, so the words a person read and accepted are the words the
 * write runs on: an answer edited, swapped or added after the reading changes the digest and refuses.
 */
export function proofDigest(proofs) {
  const pin = ["request", "account", "keeper"].map((r) => [proofs[r].ref?.comment ?? null, proofs[r].author?.id ?? null, proofs[r].body ?? null]);
  return createHash("sha256").update(JSON.stringify(pin)).digest("hex").slice(0, 16);
}

/** The request and both answers, read from GitHub (`gh`: githubGet's shape), judged. Reads only. */
export async function readProofs({ issue, request, accountProof, keeperProof, account, house, env, gh = githubGet }) {
  const one = async (role, raw, after = null) => {
    const ref = raw == null ? null : parseCommentUrl(raw);
    if (raw != null && !ref) return { role, ref: null, url: String(raw), ok: false, why: `${raw} is not a GitHub issue comment's link (https://github.com/<owner>/<repo>/issues/<n>#issuecomment-<id>)` };
    const got = ref && `${ref.owner}/${ref.repo}#${ref.number}`.toLowerCase() === `${issue.owner}/${issue.repo}#${issue.number}`.toLowerCase()
      ? await gh(`/repos/${ref.owner}/${ref.repo}/issues/comments/${ref.comment}`, { env }) : undefined;
    return judgeProof({ role, ref, got, issue, account, house, after });
  };
  const asked = await one("request", request);
  const proofs = { request: asked, account: await one("account", accountProof, asked.created_at ?? null), keeper: await one("keeper", keeperProof, asked.created_at ?? null) };
  // three comments, three authors' own: none of them may stand in for another
  const ids = ["request", "account", "keeper"].map((r) => proofs[r].ref?.comment).filter(Boolean);
  if (new Set(ids).size !== ids.length)
    for (const r of ["account", "keeper"]) if (ids.filter((x) => x === proofs[r].ref?.comment).length > 1) proofs[r] = { ...proofs[r], ok: false, why: "the same comment is given twice; the request and each answer are their own comments" };
  const ok = proofs.request.ok && proofs.account.ok && proofs.keeper.ok;
  return { ...proofs, ok, digest: ok ? proofDigest(proofs) : null };
}

// ── the plan ────────────────────────────────────────────────────────────────

/**
 * Everything the bind would change, decided from the store's rows, the clone and the two proofs as they stand.
 * Reads only; throws a named refusal for what no proof can cure. `keysOf` is house-key.mjs § currentKeysOf (the
 * town's own fold over the clone), injected in test.
 */
export function planBind({ slug, account, rows, clone, proofs, date, keysOf = currentKeysOf }) {
  const target = rows.households.find((r) => r.slug === slug);
  if (!target) {
    const wore = rows.households.find((r) => (r.formerly ?? []).includes(slug));
    throw refuse(BIND_REFUSALS.NO_HOUSE, wore ? `${slug} is a former key of ${wore.slug}` : slug);
  }
  // THE ID IS NOBODY ELSE'S: no other house lists it, no pin carries it, and the lookup the Bug Catcher refused by
  // (bug-credit.mjs § householdsOfAccount: a house by its accounts, and the house of each handle pinned to the id)
  // finds no house but this one
  const listed = rows.households.filter((r) => r.slug !== slug && (r.accounts ?? []).some((a) => sameId(a, account.id))).map((r) => `hh:${r.slug}`);
  if (listed.length) throw refuse(BIND_REFUSALS.OTHER_HOUSE, `${account.id} is bound to ${listed.join(", ")}`);
  const pinned = (rows.pins ?? []).filter((p) => String(p.gh_id) === String(account.id)).map((p) => p.handle);
  if (pinned.length) throw refuse(BIND_REFUSALS.PINNED, `${account.id} is the pin of ${pinned.join(", ")}`);
  const registry = registryFromRows(rows), pins = pinsFromRows(rows);
  const elsewhere = [...householdsOfAccount(account.id, registry, pins)].filter((k) => k !== `hh:${slug}`);
  if (elsewhere.length) throw refuse(BIND_REFUSALS.OTHER_HOUSE, `${account.id} is bound to ${elsewhere.join(", ")}`);
  const already = (target.accounts ?? []).some((a) => sameId(a, account.id));

  // THE KEYS (house-key.mjs, the town's fold): every resident the fold knows stands on hh:<slug> (houseKeyLines'
  // housemate rule, which writes a line for any that does not; this tool writes none), and no ledger line keys the id
  const keys = keysOf(clone);
  const off = (target.residents ?? []).filter((h) => keys.has(h) && keys.get(h) !== `hh:${slug}`);
  if (off.length) throw refuse(BIND_REFUSALS.OFF_KEY, off.map((h) => `${h} mints under ${keys.get(h)}`).join(", "));
  if (new RegExp(`(^|[^0-9A-Za-z:])gh:${account.id}([^0-9]|$)`, "m").test(read(clone, LEDGER_REL) ?? ""))
    throw refuse(BIND_REFUSALS.KEY_ALIAS, `the ledger names gh:${account.id}`);

  // the row as it will stand, the login as GitHub spells it on the account's own proof (else as given)
  const login = proofs?.account?.ok ? proofs.account.author.login : account.login;
  const accountsAfter = already ? target.accounts : [...(target.accounts ?? []), { login, id: Number(account.id) }];
  const after = already ? rows : { ...rows, households: rows.households.map((r) => (r.slug === slug ? { ...r, accounts: accountsAfter } : r)) };

  // THE SPELLINGS (the lead's FIX on #1252): the house's effective spelling set is what a resident's session reads its
  // rows by (household-deriver.mjs § houseKeysOf → sessionKeysVia → 024's draft policies), and an account brings
  // `gh:<id>` and `solo:<login>` with it. A `solo:` spelling another house already holds (its resident's handle, an
  // old pinned login) under a different id would let this house read that house's old-spelled drafts. So the set is
  // folded over the row as it will stand, by the real deriver, and a spelling it ADDS that another house's set already
  // holds refuses. Overlaps the town already carries are not this tool's to judge or repair: only the delta is.
  const pinsNow = pinsFromRows(rows);
  const spellBefore = houseKeysOf(`hh:${slug}`, registryFromRows(rows), pinsNow);
  const registryAfter = registryFromRows(after);
  const spellAfter = houseKeysOf(`hh:${slug}`, registryAfter, pinsNow);
  const added = spellAfter.filter((k) => !spellBefore.includes(k));
  const shared = [];
  for (const other of Object.keys(registryAfter.households ?? {})) {
    if (other === slug) continue;
    const theirs = new Set(houseKeysOf(`hh:${other}`, registryAfter, pinsNow));
    for (const k of added) if (theirs.has(k)) shared.push(`${k} is already hh:${other}'s`);
  }
  if (shared.length) throw refuse(BIND_REFUSALS.SHARED_SPELLING, shared.join(", "));

  // COLLATERAL (move-resident's rule): what the drain would print may differ from the town's files only in this house
  const files = filesHouses(clone);
  const printed = renderPublicRegistry(after);
  const printedHouses = JSON.parse(printed.households).households ?? {};
  const moved = [];
  for (const k of new Set([...Object.keys(files), ...Object.keys(printedHouses)])) {
    if (k === slug) continue;
    if (JSON.stringify(files[k]) !== JSON.stringify(printedHouses[k])) moved.push(k);
  }
  // (read here, never written: the drain is the registers' one writer, test/registry-no-file-writer.test.mjs)
  const pinsBehind = (read(clone, PINS_PATH) ?? "") !== printed.pins;
  if (pinsBehind) moved.push("tools/github-ids.json");
  if (moved.length) throw refuse(BIND_REFUSALS.COLLATERAL, moved.slice(0, 8).join(", ") + (moved.length > 8 ? `, +${moved.length - 8} more` : ""));

  const publishedNow = JSON.stringify(files[slug] ?? null) === JSON.stringify(printedHouses[slug] ?? null);
  return {
    slug, name: target.name ?? null, account: { login, id: Number(account.id) }, date, clone_head: cloneHead(clone),
    proofs,
    store: already ? null : { table: "households", slug, before: target.accounts ?? [], after: accountsAfter },
    registry: { before: files[slug] ?? null, after: printedHouses[slug] ?? null, published: publishedNow },
    residents: target.residents ?? [],
    keys: { residents: (target.residents ?? []).map((h) => [h, keys.get(h) ?? null]) },
    spellings: { before: spellBefore, after: spellAfter, added },
  };
}

// ── the act ─────────────────────────────────────────────────────────────────

/** The commit's words: the receipt a person finds in the town's history, naming the request and both answers. */
export const commitMessage = (plan) =>
  `registry: ${plan.account.login} (${plan.account.id}) added to ${plan.slug}'s accounts — proofs ${plan.proofs.account.url} and ${plan.proofs.keeper.url}, answering ${plan.proofs.request.url} (via postmark-office, bind-household-account, POS-1259)`;

/**
 * Plan, and with `apply`, do it: the store's one statement, then the printed registry in one pen commit. Without
 * `apply` it returns the plan and calls no writer. `gh`, `keysOf`, `bind`, `drainWith` and `commit` are injected in
 * test. Answers `{ applied, plan, done?, commit? }`.
 */
export async function bindHouseholdAccount({ slug, account, issue, request = null, accountProof = null, keeperProof = null, accept = null, clone,
  env = process.env, date = easternDate(), apply = false, gh = githubGet, keysOf = currentKeysOf,
  bind = appendHouseholdAccount, drainWith = collectingDrain, commit = penCommit } = {}) {
  const rows = await loadRegistryRows(env);
  if (rows === null) throw refuse(BIND_REFUSALS.NO_RECORD);
  const house = rows.households.find((r) => r.slug === slug);
  if (!house) return planBind({ slug, account, rows, clone, proofs: null, date, keysOf }); // throws NO_HOUSE
  const proofs = await readProofs({ issue, request, accountProof, keeperProof, account, house, env, gh });
  const plan = planBind({ slug, account, rows, clone, proofs, date, keysOf });
  if (!apply) return { applied: false, plan };

  // NO PROOF, NO WRITE: both must stand at this run, the resumed and the repeated run included
  const three = [proofs.request, proofs.account, proofs.keeper];
  if (three.some((p) => !p.url)) throw refuse(BIND_REFUSALS.PROOF_MISSING, three.filter((p) => !p.url).map((p) => p.why).join("; "));
  const bad = three.filter((p) => !p.ok);
  if (bad.some((p) => p.unread)) throw refuse(BIND_REFUSALS.PROOF_UNREAD, bad.filter((p) => p.unread).map((p) => p.why).join("; "));
  if (bad.length) throw refuse(BIND_REFUSALS.PROOF_REFUSED, bad.map((p) => `${p.role}: ${p.why}`).join("; "));
  if (String(accept ?? "") !== proofs.digest)
    throw refuse(BIND_REFUSALS.PROOF_UNACCEPTED, accept ? `--accept ${accept} is not the digest of the comments as they stand: mistyped, or changed since they were read; run the dry run and read them again` : "no --accept was given");

  if (!plan.store && plan.registry.published) return { applied: true, plan, done: true, commit: null };

  if (plan.store) {
    const wrote = await bind({ slug, before: plan.store.before, account: plan.account }, env);
    if (wrote === null) throw refuse(BIND_REFUSALS.NO_RECORD, "the store went away before the write");
    if (!wrote.slug) throw refuse(BIND_REFUSALS.CHANGED);
  }

  const { drain, paths } = drainWith({ clone, env });
  const drained = await drain({ note: `POS-1259: ${plan.account.login} (${plan.account.id}) bound to ${slug}` });
  if (drained?.refused) throw refuse(BIND_REFUSALS.DRAIN_REFUSED, `${drained.refused} (the store holds the account; run the same command again once the drain prints)`);
  if (!paths.length) return { applied: true, plan, done: true, commit: null };
  const sha = landOrRefuse(() => commit(clone, paths, commitMessage(plan)));
  if (sha?.error) throw Object.assign(new Error(sha.error.defect), sha.error, { detail: "the store holds the account; run the same command again to publish" });
  return { applied: true, plan, commit: sha };
}

// ── the command ─────────────────────────────────────────────────────────────

const arg = (name, argv) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] ?? null; };
const QUOTE_MAX = 1200;
const quote = (body) => {
  const s = String(body ?? "");
  const shown = s.slice(0, QUOTE_MAX).split(/\r?\n/).map((l) => `      | ${l}`).join("\n");
  return s.length > QUOTE_MAX ? `${shown}\n      … (cut at ${QUOTE_MAX} characters; the rest is at the link)` : shown;
};

/** What the plan touches and what it read, in plain lines. */
export function describe(plan, { applied = false, done = false, commit = null } = {}) {
  const out = [];
  out.push(!applied ? "DRY RUN — nothing written." : done && !commit ? "ALREADY BOUND AND PUBLISHED — nothing to do." : "BOUND.");
  out.push(`household: ${plan.slug}${plan.name ? ` (${plan.name})` : ""}  ·  account: ${plan.account.login} (id ${plan.account.id})  ·  date: ${plan.date}`);
  if (!applied) out.push(`town clone: ${plan.clone_head ?? "(no HEAD)"} — read as it stands, not pulled; --apply pulls first when TOWN_PUSH=1`);
  out.push(`proofs (read from GitHub at this run; ${plan.proofs.ok ? "the request and both answers stand" : "--apply refuses until the request and both answers stand"}):`);
  for (const p of [plan.proofs.request, plan.proofs.account, plan.proofs.keeper]) {
    const head = p.role === "request" ? "the town's ask, which both answers follow" : p.role === "account" ? "the account is the keeper's" : `${plan.slug} authorizes it`;
    out.push(`  ${p.role} (${head}): ${p.url ?? "(none given)"} — ${p.ok ? "STANDS" : `DOES NOT STAND: ${p.why}`}`);
    if (p.author) out.push(`    by ${p.author.login} (id ${p.author.id}), ${p.created_at}${p.updated_at && p.updated_at !== p.created_at ? `, edited ${p.updated_at}` : ""}; its words, for the operator to read:\n${quote(p.body)}`);
  }
  // the words are the operator's to judge against the request; the digest pins the judgment to exactly these bytes
  if (plan.proofs.ok && !applied) out.push(`accept: ${plan.proofs.digest} — if these answers, read against the request, are the confirmations the ruling asks for, apply with the same line, --apply in place of --dry-run, and --accept ${plan.proofs.digest}`);
  if (plan.store) {
    out.push("store (one statement, as office_api; written only while the row holds the accounts read here, no house lists the id and no pin carries it):");
    out.push(`  UPDATE households ${plan.slug}:`);
    const shown = (as) => JSON.stringify(as.map((a) => ({ login: a.login, id: a.id })));
    out.push(`    accounts    ${shown(plan.store.before)} -> ${shown(plan.store.after)}`);
    out.push("  every other column of the row unchanged; household_pins unchanged (no pin carries the id)");
  } else out.push(`store: no change (${plan.slug} already lists ${plan.account.id})`);
  out.push(`keys: ${plan.keys.residents.map(([h, k]) => `${h} ${k ?? "(not in the fold)"}`).join(", ")} — unchanged, no ledger line; the town reads gh:${plan.account.id} as hh:${plan.slug} from now, and the ledger holds no gh:${plan.account.id} key to regroup`);
  const sp = plan.spellings;
  out.push(sp.added.length
    ? `spellings (what the house's sessions read rows by): ${JSON.stringify(sp.before)} + ${JSON.stringify(sp.added)} — no other household holds ${sp.added.length === 1 ? "it" : "any of them"}`
    : `spellings (what the house's sessions read rows by): unchanged, ${JSON.stringify(sp.after)}`);
  out.push("town files (one pen commit):");
  // the drain writes the registers; these lines only say what it will print
  const registryText = plan.registry.published ? `  ${REGISTRY_PATH}: ${plan.slug} already printed with the account`
    : `  ${REGISTRY_PATH}: ${plan.slug} printed as ${JSON.stringify(plan.registry.after)}`;
  const pinsText = `  ${PINS_PATH}: unchanged`;
  out.push(registryText, pinsText, `  ${LEDGER_REL}: unchanged`);
  if (!plan.registry.published && plan.proofs.ok) out.push(`  commit: ${commitMessage(plan)}`);
  out.push("not changed: residents, pins, name, human, membership, former keys, home pictures, likeness, hearth, invitation, any history row. Sign-in still finds a resident by pin, so the account signs in to no handle; the office's house caches renew within a minute.");
  if (commit) out.push(`commit: ${commit}`);
  return out.join("\n");
}

export async function main(argv = process.argv.slice(2), { env = process.env, log = console.log, err = console.error, act = bindHouseholdAccount } = {}) {
  const usage = "bind-household-account: --household <slug> --account-id <id> --account-login <login> --issue <owner>/<repo>#<n> [--request <comment url>] [--account-proof <comment url>] [--keeper-proof <comment url>] (--dry-run | --apply --accept <digest>)";
  const dry = argv.includes("--dry-run"), apply = argv.includes("--apply");
  if (dry === apply) { err(`bind-household-account: pass exactly one of --dry-run or --apply\n${usage}`); return 2; }
  const slug = arg("--household", argv), id = arg("--account-id", argv), login = arg("--account-login", argv), issue = parseIssue(arg("--issue", argv));
  if (!slug || !id || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || !login || !issue) { err(usage); return 2; }
  const clone = env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");
  try {
    const out = await penTransaction(clone, async () => {
      if (apply && env.TOWN_PUSH === "1") execFileSync("git", ["-C", clone, "pull", "--rebase", "-q"], { encoding: "utf8" });
      try {
        return await act({ slug, account: { id: Number(id), login }, issue, request: arg("--request", argv), accountProof: arg("--account-proof", argv),
          keeperProof: arg("--keeper-proof", argv), accept: arg("--accept", argv), clone, env, apply });
      } catch (e) {
        if (typeof e?.code !== "number") throw e;
        return { error: { code: e.code, defect: e.defect ?? String(e.message), detail: e.detail ?? null } };
      }
    });
    if (out?.error) { err(`bind-household-account: REFUSED — ${out.error.defect}${out.error.detail ? ` (${out.error.detail})` : ""}`); return 1; }
    log(describe(out.plan, out));
    return 0;
  } catch (e) {
    err(`bind-household-account: tripped — ${String(e?.stack ?? e).slice(0, 600)}`);
    return 1;
  }
}

// ── entry guard ── the realpath compare (test/cli-guard.test.mjs spawns it both ways)
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exit(await main());
