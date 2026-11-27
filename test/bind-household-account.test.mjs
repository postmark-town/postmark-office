// bind-household-account.test.mjs — one more GitHub account appended to an existing household, proof first (POS-1259).
//
// Darko, POS-1259/a: "Yes, with proof first": the new account says on the issue it is the keeper's, and the house's
// own account authorizes adding it; then the operator applies an additive bind. Wright: "apply the bind only once both
// confirmations are there, from the right GitHub authors." The real confirmations were ordinary replies to Wright's
// request ("this is my account as well as the harpy landfall one"; "confirming same account from Harpylandfall"), which
// Wright accepted in context; so the tool checks the authors, the issue and the order mechanically, and pins the
// operator's reading of the words with a digest (--accept) rather than a phrase list.
//
// Every house, handle, login, id and comment here is INVENTED. The store is a real embedded Postgres with every
// migration applied, written as office_api; the clone holds the town's own engine and key fold, over a ledger signed
// with a key this test holds. GitHub is a stub that answers the comments below.
//
//   B1  the dry run names the row, the printout and both proofs' verdicts, and reaches no writer
//   B2  THE BIND: only the account is appended; every other column, every pin, the ledger and every other house kept;
//       the printout changes in the one house; the lookups (the Bug Catcher's, the identities view, the town's key
//       canon, the residents' keys) read the house coherently; one commit naming both proofs
//   B3  a repeat is a no-op: no store write, no drain, no commit
//   B4  RESUMABLE: a push that cannot land leaves the store bound; the same command publishes once; then nothing
//   B5  THE FALSIFIER: no request or proof, a wrong author, an answer before the request, a negation, a quote-only
//       reply, another issue, a bot, one comment twice, an unreadable or deleted comment, a request by an answering
//       account or about nothing; and chatter, an edited answer or a wrong digest without the operator's --accept of
//       exactly those words: --apply refuses and neither house changes
//   B5b the answers as the ruling's confirmations were actually written stand; negated, empty, early ones do not
//   B6  an account another house lists, or a pin carries, refuses before any write, proof or not
//   B7  the statement re-checks the plan's read: a house or account that changed since refuses, writing nothing
//   B8  the keys: a resident off the house's key, or a ledger that keys the id, refuses
//   B9  a town file behind the store elsewhere refuses (COLLATERAL)
//   B10 the command: exactly one of --dry-run or --apply, and an id that is a number
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/bind-household-account.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { pinTown, stageTownTools } from "./helpers/pinned-town.mjs";
import { generateKeyPairSync, createPrivateKey, sign as edSign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers/temp-dir.mjs";
import { execFileSync } from "node:child_process";

import { fixtureTown } from "./fixture.mjs";
import { indexStore, seedRegistry, recordInProcess } from "./helpers/office-under-test.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";
import { loadRegistryRows, appendHouseholdAccount } from "../src/registry-store.mjs";
import { registryFromRows, pinsFromRows, renderPublicRegistry } from "../src/registry-rows.mjs";
import { notLandedError, penTransaction } from "../src/write.mjs";
import { REGISTRY_PATH, PINS_PATH } from "../src/residency.mjs";
import { householdsOfAccount } from "../src/bug-credit.mjs";
import { resolveHouse, VIA } from "../src/household-deriver.mjs";
import { currentKeysOf } from "../src/house-key.mjs";
import { bindHouseholdAccount, describe, main, BIND_REFUSALS, judgeProof, parseCommentUrl, readProofs } from "../tools/bind-household-account.mjs";

const TOWN = townClone();
const HAS_ENGINE = Boolean(TOWN) && existsSync(join(TOWN, "tools", "household-keys.mjs"));
const SKIP = !TOWN ? NO_TOWN : (!HAS_ENGINE && "the town clone predates tools/household-keys.mjs (town d95e81c1c)");
const ENGINE = HAS_ENGINE ? await import(townModuleUrl("tools", "stamp-mint.mjs")) : null;
const VERIFY = HAS_ENGINE ? await import(townModuleUrl("tools", "stamp-verify.mjs")) : null;

delete process.env.TOWN_PUSH;
const D = "2026-11-27";

const IX = await indexStore(fixtureTown());
const RECORD_RESTORE = await recordInProcess(IX.store);
after(async () => { await RECORD_RESTORE(); await IX.stop(); });

const git = (dir, ...a) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" }).trim();
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });

// THE TOWN: ana and bo keep The Workroom from keeper-gh (601); cy keeps Next Door from neighbour-gh (701). The keeper
// opened work from a second account, keeper-second (602), which no house lists.
const HOUSES = () => ({
  "the-workroom": { name: "The Workroom", human: "A Keeper (private)", accounts: [{ login: "keeper-gh", id: 601 }], residents: ["ana", "bo"],
    since: "2026-10-10", member_of: "the-harbor", declared_by: "fixture", home_images: { ana: "https://media.postmark.town/the-workroom/aa.png" },
    likeness: { answer: "yes", at: "2026-10-25T23:06:47.428Z", by: "keeper-gh", gh_id: 601, words: "2026-10-21" } },
  "next-door": { name: "Next Door", accounts: [{ login: "neighbour-gh", id: 701 }], residents: ["cy"], since: "2026-09-01", declared_by: "fixture" },
});
const PINS = () => ({
  ana: { login: "keeper-gh", id: 601, pinned: "2026-10-10" },
  bo: { login: "keeper-gh", id: 601, pinned: "2026-10-10" },
  cy: { login: "neighbour-gh", id: 701, pinned: "2026-09-01" },
});
const KEYED = ["- 2026-10-10 · registry: ana = hh:the-workroom", "- 2026-10-10 · registry: bo = hh:the-workroom", "- 2026-10-11 · registry: cy = hh:next-door"];
const NEW = { id: 602, login: "keeper-second" };
const SLUG = "the-workroom";

/** The store seeded, and a sealed clone whose printouts are the store's own print. */
async function town({ houses = HOUSES(), pins = PINS(), ledger = KEYED } = {}) {
  await seedRegistry(IX.store, { schema_version: 1, note: "invented for POS-1259", households: houses }, pins);
  const printed = renderPublicRegistry(await loadRegistryRows());
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const dir = tempDir("pm-bind-account-");
  dirs.push(dir);
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), printed.households);
  writeFileSync(join(dir, PINS_PATH), printed.pins);
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), "# mail\n");
  const lines = ["- 2026-06-12 · rules: stamps-v1", ...ledger];
  const seals = ENGINE.sealChain(lines);
  const key = createPrivateKey(pem);
  const signed = lines.map((l, i) => `${l} · sig: ${edSign(null, Buffer.from(seals[i], "utf8"), key).toString("base64url")}`);
  writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), `# the ledger\n\n${signed.join("\n")}\n`);
  writeFileSync(join(dir, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "seed");
  return { dir };
}

const withPins = async (t, fn) => {
  const prev = process.env.TOWN_PINS_DIR;
  process.env.TOWN_PINS_DIR = pinTown(stageTownTools(t.dir, TOWN));
  try { return await fn(); }
  finally { if (prev == null) delete process.env.TOWN_PINS_DIR; else process.env.TOWN_PINS_DIR = prev; }
};

// ── GitHub, stubbed: comments on the invented issue, by id ─────────────────
const ISSUE = { owner: "postmark-town", repo: "postmark", number: 4758 };
const ISSUE_API = "https://api.github.com/repos/postmark-town/postmark/issues/4758";
const url = (id, n = 4758) => `https://github.com/postmark-town/postmark/issues/${n}#issuecomment-${id}`;
const comment = (id, user, body, extra = {}) => ({ id, issue_url: ISSUE_API, user: { type: "User", ...user }, body,
  created_at: "2026-11-27T05:00:00Z", updated_at: "2026-11-27T05:00:00Z", ...extra });
const KEEPER = { login: "keeper-gh", id: 601 }, SECOND = { login: "keeper-second", id: 602 }, NEIGHBOUR = { login: "neighbour-gh", id: 701 };
const STEWARD = { login: "town-steward", id: 800 };
const ASKED_AT = "2026-11-27T04:25:51Z";
const COMMENTS = {
  // the town's request, and the two answers in the shape the real ones took (replies in context, not a set phrase)
  9000: comment(9000, STEWARD, "For the keeper of The Workroom: two short confirmations here first, each from its own account:\n\n"
    + "1. From @keeper-second: that this account is yours, the keeper of The Workroom.\n2. From @keeper-gh: that you authorize adding keeper-second to The Workroom.",
  { created_at: ASKED_AT, updated_at: ASKED_AT }),
  9001: comment(9001, SECOND, "hi from Keeper-second, this is my account as well as the keeper-gh one, I'll do the keeper-gh next"),
  9002: comment(9002, KEEPER, "and confirming same account from keeper-gh, sorry about the confusion"),
  9113: comment(9113, KEEPER, "I authorize adding keeper-second to The Workroom.", { created_at: "2026-11-27T04:00:00Z" }), // before the request
  9114: comment(9114, STEWARD, "Thanks, everyone."),                                                     // a "request" that asks nothing
  9108: comment(9108, KEEPER, "> 2. From @keeper-gh: that you authorize adding keeper-second to The Workroom."), // the request, quoted, nothing else
  9101: comment(9101, KEEPER, "Yes, this account is mine: I'm the keeper of The Workroom."),             // the right words, the wrong author
  9102: comment(9102, { login: "someone-else", id: 602 }, "Yes, this account is mine: I'm the keeper of The Workroom."), // id 602, renamed
  9103: comment(9103, SECOND, "I authorize adding keeper-second to The Workroom."),                     // the bound account authorizing itself
  9104: comment(9104, NEIGHBOUR, "I authorize adding keeper-second to The Workroom."),                  // another house's account
  9105: comment(9105, { login: "stranger", id: 999 }, "I authorize adding keeper-second to The Workroom."),
  9106: comment(9106, KEEPER, "What is this about? Who is keeper-second?"),                            // chatter
  9107: comment(9107, KEEPER, "I do not authorize adding keeper-second to The Workroom."),             // a negation
  9109: comment(9109, KEEPER, "I authorize adding keeper-second to The Workroom.", { issue_url: "https://api.github.com/repos/postmark-town/postmark/issues/1" }),
  9110: comment(9110, { ...KEEPER, type: "Bot" }, "I authorize adding keeper-second to The Workroom."),
  9111: comment(9111, SECOND, "Hello! Thanks for the fixes."),                                         // chatter from the right account
  9112: null,                                                                                           // GitHub could not be read
};
const gh = async (path) => {
  const id = path.split("/").pop();
  if (!(id in COMMENTS)) return { status: 404, body: null };
  return COMMENTS[id] === null ? null : { status: 200, body: COMMENTS[id] };
};
const GOOD = { request: url(9000), accountProof: url(9001), keeperProof: url(9002) };
const args = (t, extra = {}) => ({ slug: SLUG, account: NEW, issue: ISSUE, clone: t.dir, date: D, gh, ...GOOD, ...extra });
/** The digest a dry run prints for these comments as they stand: the operator's --accept. */
const digestOf = async (extra = {}) => (await readProofs({ issue: ISSUE, ...GOOD, ...extra, account: NEW, house: { slug: SLUG, ...HOUSES()[SLUG] }, gh })).digest;
/** --apply as the operator runs it: after a dry run over the same comments, with its digest. */
const go = async (t, extra = {}) => ({ ...args(t, extra), apply: true, accept: await digestOf(extra) });

async function storeRows() {
  const c = await IX.store.connect("world2_owner");
  try {
    const h = (await c.query("SELECT to_jsonb(households) AS row FROM households ORDER BY slug")).rows.map((r) => r.row);
    const p = (await c.query("SELECT handle, login, gh_id::text AS gh_id, pinned FROM household_pins ORDER BY handle")).rows;
    const ids = (await c.query("SELECT handle, household, gh_id::text AS gh_id FROM identities ORDER BY handle")).rows;
    return { households: h, pins: p, identities: ids };
  } finally { await c.end(); }
}
const asOwner = async (sql, params = []) => { const c = await IX.store.connect("world2_owner"); try { await c.query(sql, params); } finally { await c.end(); } };
const head = (dir) => git(dir, "rev-parse", "HEAD");
const clean = (dir) => git(dir, "status", "--porcelain") === "";
const fileAt = (dir, rel) => readFileSync(join(dir, rel), "utf8");
const housesIn = (dir) => JSON.parse(fileAt(dir, REGISTRY_PATH)).households;

const NEVER = (what) => async () => { throw new Error(`reached ${what}`); };
const NO_WRITERS = { bind: NEVER("the store write"), drainWith: () => { throw new Error("reached the drain"); }, commit: () => { throw new Error("reached the pen"); } };

// ── B1 the dry run ──────────────────────────────────────────────────────────

test("B1 · the dry run names the row, the printout and both proofs' verdicts, and reaches no store, file or Git writer", { skip: SKIP }, async (tc) => {
  const t = await town();
  const before = await storeRows();
  const h0 = head(t.dir);
  // before any confirmation exists: the plan still shows what would change, and that --apply would refuse
  const bare = await withPins(t, () => bindHouseholdAccount({ ...args(t), request: null, accountProof: null, keeperProof: null, ...NO_WRITERS }));
  assert.equal(bare.applied, false);
  assert.equal(bare.plan.proofs.ok, false);
  assert.equal(bare.plan.proofs.digest, null, "no digest to accept while anything is missing");
  assert.match(bare.plan.proofs.account.why, /no --account-proof was given/);
  assert.deepEqual(bare.plan.store.after.map((a) => [a.login, Number(a.id)]), [["keeper-gh", 601], ["keeper-second", 602]], "appended at the end, the first account first");
  const { plan } = await withPins(t, () => bindHouseholdAccount({ ...args(t), ...NO_WRITERS }));
  assert.equal(plan.proofs.ok, true);
  assert.deepEqual([plan.proofs.request.author, plan.proofs.account.author, plan.proofs.keeper.author].map((a) => a.id), [800, 602, 601]);
  assert.match(plan.proofs.digest, /^[0-9a-f]{16}$/);
  assert.deepEqual(plan.registry.after.accounts, [{ login: "keeper-gh", id: 601 }, { login: "keeper-second", id: 602 }]);
  assert.equal(plan.registry.published, false);
  assert.deepEqual(plan.keys.residents, [["ana", "hh:the-workroom"], ["bo", "hh:the-workroom"]]);

  assert.deepEqual(await storeRows(), before, "the store is as it was");
  assert.equal(head(t.dir), h0);
  assert.ok(clean(t.dir), "no file in the clone changed");

  const text = describe(plan, { applied: false });
  for (const line of text.split("\n")) tc.diagnostic(`dry-run | ${line}`);
  for (const s of ["DRY RUN — nothing written.", `proofs (read from GitHub at this run; the request and both answers stand):`,
    `request (the town's ask, which both answers follow): ${url(9000)} — STANDS`, "by town-steward (id 800)",
    `account (the account is the keeper's): ${url(9001)} — STANDS`, `keeper (the-workroom authorizes it): ${url(9002)} — STANDS`,
    "by keeper-second (id 602)", "| and confirming same account from keeper-gh, sorry about the confusion",
    `accept: ${plan.proofs.digest} — if these answers, read against the request, are the confirmations the ruling asks for`, `--accept ${plan.proofs.digest}`,
    "UPDATE households the-workroom:", 'accounts    [{"login":"keeper-gh","id":601}] -> [{"login":"keeper-gh","id":601},{"login":"keeper-second","id":602}]',
    "tools/github-ids.json: unchanged", "WHITE_PAGES/stamp-ledger.md: unchanged",
    `commit: registry: keeper-second (602) added to the-workroom's accounts — proofs ${url(9001)} and ${url(9002)}, answering ${url(9000)}`])
    assert.ok(text.includes(s), `the dry run says: ${s}`);
  assert.ok(!text.includes("A Keeper (private)"), "the human's own name is never printed");
  const bareText = describe(bare.plan, { applied: false });
  assert.match(bareText, /--apply refuses until the request and both answers stand/);
  assert.ok(!bareText.includes("accept:"), "no digest is offered while anything is missing");
});

// ── B2 the bind ─────────────────────────────────────────────────────────────

test("B2 · THE BIND: only the account is appended; pins, ledger and other houses kept; one printout house changes; the lookups read the house", { skip: SKIP }, async () => {
  const t = await town();
  const before = await storeRows();
  const h0 = head(t.dir);
  const pins0 = fileAt(t.dir, PINS_PATH), ledger0 = fileAt(t.dir, "WHITE_PAGES/stamp-ledger.md"), houses0 = housesIn(t.dir);
  const keys0 = await withPins(t, () => currentKeysOf(t.dir));
  const rows0 = await loadRegistryRows();
  assert.deepEqual([...householdsOfAccount(602, registryFromRows(rows0), pinsFromRows(rows0))], [], "control: bound to no household (the Bug Catcher's refusal)");

  const A = await go(t);
  const out = await withPins(t, () => bindHouseholdAccount(A));
  assert.equal(out.applied, true);
  assert.match(out.commit, /^[0-9a-f]{40}$/);

  // THE STORE: the account appended, and every other column of every row, every pin and the identities view as they were
  const now = await storeRows();
  const [wb, wa] = [before, now].map((s) => s.households.find((r) => r.slug === SLUG));
  assert.deepEqual(wa.accounts.map((a) => [a.login, Number(a.id)]), [["keeper-gh", 601], ["keeper-second", 602]]);
  assert.deepEqual({ ...wa, accounts: null }, { ...wb, accounts: null }, "no other column of the house moved");
  assert.deepEqual(now.households.filter((r) => r.slug !== SLUG), before.households.filter((r) => r.slug !== SLUG), "no other house moved");
  assert.deepEqual(now.pins, before.pins, "no pin moved");
  assert.deepEqual(now.identities, before.identities, "every handle is housed as before (055's view)");

  // THE TOWN FILES: one commit, the one house's accounts, nothing else
  assert.equal(git(t.dir, "rev-list", "--count", `${h0}..HEAD`), "1");
  assert.deepEqual(git(t.dir, "diff", "--name-only", h0, "HEAD").split("\n"), [REGISTRY_PATH]);
  const houses1 = housesIn(t.dir);
  assert.deepEqual(houses1[SLUG].accounts, [{ login: "keeper-gh", id: 601 }, { login: "keeper-second", id: 602 }]);
  assert.deepEqual({ ...houses1[SLUG], accounts: null }, { ...houses0[SLUG], accounts: null });
  assert.deepEqual({ ...houses1, [SLUG]: null }, { ...houses0, [SLUG]: null });
  assert.equal(fileAt(t.dir, PINS_PATH), pins0);
  assert.equal(fileAt(t.dir, "WHITE_PAGES/stamp-ledger.md"), ledger0);
  const msg = git(t.dir, "log", "-1", "--format=%B");
  assert.ok(msg.includes(url(9001)) && msg.includes(url(9002)) && msg.includes(url(9000)), `the commit names both answers and the request: ${msg}`);

  // THE LOOKUPS: the Bug Catcher's author check finds the house; the old account still does; the residents stand where they stood
  const rows1 = await loadRegistryRows();
  const [reg1, pins1] = [registryFromRows(rows1), pinsFromRows(rows1)];
  assert.deepEqual([...householdsOfAccount(602, reg1, pins1)], ["hh:the-workroom"]);
  assert.deepEqual([...householdsOfAccount(601, reg1, pins1)], ["hh:the-workroom"]);
  assert.deepEqual([...householdsOfAccount(701, reg1, pins1)], ["hh:next-door"]);
  for (const h of ["ana", "bo"]) assert.equal(resolveHouse(h, reg1, pins1, { via: [VIA.RESIDENT, VIA.PIN] }).slug, SLUG);
  assert.equal(resolveHouse({ ghId: 602 }, reg1, {}, { via: VIA.ACCOUNT }).slug, SLUG);
  // the town: every resident keeps their key, the town's canon reads the new id as the house, and the ledger verifies as before
  assert.deepEqual([...(await withPins(t, () => currentKeysOf(t.dir)))], [...keys0]);
  const canon = ENGINE.houseCanonOf(houses1);
  assert.equal(canon("gh:602"), "hh:the-workroom");
  assert.equal(canon("gh:601"), "hh:the-workroom");
  assert.deepEqual(VERIFY.verifyStampLedger(t.dir).problems ?? [], []);

  assert.match(describe(out.plan, out), /^BOUND\./);
});

// ── B3 a repeat ─────────────────────────────────────────────────────────────

test("B3 · a repeat is a no-op: the store is not written, the drain not run, nothing committed", { skip: SKIP }, async () => {
  const t = await town();
  const A = await go(t);
  await withPins(t, () => bindHouseholdAccount(A));
  const bound = await storeRows();
  const h1 = head(t.dir);
  const again = await withPins(t, () => bindHouseholdAccount({ ...A, ...NO_WRITERS }));
  assert.equal(again.done, true);
  assert.equal(again.commit, null);
  assert.equal(again.plan.store, null);
  assert.equal(again.plan.registry.published, true);
  assert.deepEqual(await storeRows(), bound);
  assert.equal(head(t.dir), h1);
  assert.match(describe(again.plan, again), /^ALREADY BOUND AND PUBLISHED — nothing to do\./);
});

// ── B4 resumable ────────────────────────────────────────────────────────────

test("B4 · RESUMABLE: a push that cannot land leaves the store bound; the same command publishes once; then nothing is left", { skip: SKIP }, async () => {
  const t = await town();
  const h0 = head(t.dir);
  const A = await go(t);
  await assert.rejects(withPins(t, () => penTransaction(t.dir, () => bindHouseholdAccount({ ...A,
    commit: () => { throw notLandedError("a fixture race"); } }))), (e) => e.code === 503 && /run the same command again/.test(e.detail));
  const bound = await storeRows();
  assert.ok(bound.households.find((r) => r.slug === SLUG).accounts.some((a) => Number(a.id) === 602), "the store bound");
  assert.equal(head(t.dir), h0, "the clone did not move");
  assert.ok(clean(t.dir), "and holds nothing half-written");

  const again = await withPins(t, () => bindHouseholdAccount({ ...A, bind: NEVER("the store write") }));
  assert.equal(again.plan.store, null, "the store is not written twice");
  assert.match(again.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(await storeRows(), bound);
  assert.deepEqual(housesIn(t.dir)[SLUG].accounts, [{ login: "keeper-gh", id: 601 }, { login: "keeper-second", id: 602 }]);

  const third = await withPins(t, () => bindHouseholdAccount({ ...A, ...NO_WRITERS }));
  assert.equal(third.done, true, "published whole: nothing left to do");
  assert.equal(git(t.dir, "rev-list", "--count", `${h0}..HEAD`), "1");
});

// ── B5 the falsifier ────────────────────────────────────────────────────────

test("B5 · FALSIFIER: missing, wrong or unaccepted proof never mutates either house", { skip: SKIP }, async () => {
  const t = await town();
  const before = await storeRows();
  const h0 = head(t.dir);
  const P = BIND_REFUSALS;
  const good = await digestOf();
  // refused by the machine, whatever digest is handed in
  const cases = [
    ["no request and no answer", { request: null, accountProof: null, keeperProof: null }, P.PROOF_MISSING, /no --request was given; no --account-proof was given; no --keeper-proof was given/],
    ["no request", { request: null }, P.PROOF_MISSING, /no --request was given/],
    ["the account's answer alone", { keeperProof: null }, P.PROOF_MISSING, /no --keeper-proof/],
    ["an answer from the wrong author", { accountProof: url(9101) }, P.PROOF_REFUSED, /written by keeper-gh \(id 601\), not the account being bound \(id 602\)/],
    ["the right id under another login", { accountProof: url(9102) }, P.PROOF_REFUSED, /now spelled someone-else, not --account-login keeper-second/],
    ["the bound account authorizing itself", { keeperProof: url(9103) }, P.PROOF_REFUSED, /written by the account being bound/],
    ["another house's account authorizing", { keeperProof: url(9104) }, P.PROOF_REFUSED, /neighbour-gh \(id 701\), which the-workroom does not list/],
    ["a stranger authorizing", { keeperProof: url(9105) }, P.PROOF_REFUSED, /stranger \(id 999\), which the-workroom does not list/],
    ["an answer posted before the request", { keeperProof: url(9113) }, P.PROOF_REFUSED, /posted at 2026-11-27T04:00:00Z, before the request it answers/],
    ["a negation from the keeper", { keeperProof: url(9107) }, P.PROOF_REFUSED, /carry a negation \(not\)/],
    ["the request quoted back, nothing else", { keeperProof: url(9108) }, P.PROOF_REFUSED, /has no words of its own/],
    ["a request by an answering account", { request: url(9103) }, P.PROOF_REFUSED, /request: .*one of the two accounts answering/],
    ["a request that asks nothing", { request: url(9114) }, P.PROOF_REFUSED, /does not ask about keeper-second \(602\) and The Workroom by name/],
    ["a comment GitHub files under another issue", { keeperProof: url(9109) }, P.PROOF_REFUSED, /belongs to .*issues\/1, not postmark-town\/postmark#4758/],
    ["a link to another issue", { keeperProof: url(9002, 1) }, P.PROOF_REFUSED, /is not a comment on postmark-town\/postmark#4758/],
    ["a bot's comment", { keeperProof: url(9110) }, P.PROOF_REFUSED, /\(Bot\), not a person's account/],
    ["one comment for both answers", { keeperProof: url(9001) }, P.PROOF_REFUSED, /the same comment is given twice/],
    ["a deleted comment", { keeperProof: url(9999) }, P.PROOF_REFUSED, /is not on GitHub/],
    ["not a comment link", { keeperProof: "https://github.com/postmark-town/postmark/issues/4758" }, P.PROOF_REFUSED, /is not a GitHub issue comment's link/],
    ["GitHub unreadable", { keeperProof: url(9112) }, P.PROOF_UNREAD, /could not be read from GitHub/],
    // the words are the operator's: chatter from the right accounts stands mechanically, and still writes nothing
    // without the digest of exactly those words, which is no reading of the confirmations
    ["chatter from the keeper, under the confirmations' digest", { keeperProof: url(9106), accept: good }, P.PROOF_UNACCEPTED, /is not the digest of the comments as they stand/],
    ["chatter from the new account, under the confirmations' digest", { accountProof: url(9111), accept: good }, P.PROOF_UNACCEPTED, /is not the digest/],
    ["the confirmations with no --accept", { accept: null }, P.PROOF_UNACCEPTED, /no --accept was given/],
    ["the confirmations with a wrong digest", { accept: "0123456789abcdef" }, P.PROOF_UNACCEPTED, /is not the digest/],
  ];
  for (const [what, extra, want, detail] of cases) {
    await assert.rejects(withPins(t, () => bindHouseholdAccount({ ...args(t, extra), apply: true, accept: good, ...extra, ...NO_WRITERS })),
      (e) => { assert.equal(e.defect, want.defect, `${what}: ${e.defect} (${e.detail})`); assert.match(e.detail, detail, what); return true; }, what);
  }
  // AN ANSWER EDITED AFTER THE OPERATOR READ IT: the digest they accepted no longer matches, and nothing is written
  const was = COMMENTS[9002];
  COMMENTS[9002] = { ...was, body: `${was.body} (edited: actually, add my cousin's account instead)`, updated_at: "2026-11-27T06:00:00Z" };
  try {
    await assert.rejects(withPins(t, () => bindHouseholdAccount({ ...args(t), apply: true, accept: good, ...NO_WRITERS })),
      (e) => e.defect === P.PROOF_UNACCEPTED.defect, "an edited answer");
  } finally { COMMENTS[9002] = was; }
  assert.deepEqual(await storeRows(), before, "neither house, nor any pin, changed");
  assert.equal(head(t.dir), h0);
  assert.ok(clean(t.dir));
  // the same comments, judged as a dry run, are reported and refuse nothing
  const dry = await withPins(t, () => bindHouseholdAccount({ ...args(t, { keeperProof: url(9107) }), ...NO_WRITERS }));
  assert.equal(dry.plan.proofs.ok, false);
  assert.match(describe(dry.plan, dry), /keeper \(the-workroom authorizes it\): .* — DOES NOT STAND: .*negation/);
});

test("B5b · the answers as the ruling's confirmations were written stand; negated, empty, early or misplaced ones do not (judgeProof, pure)", () => {
  const house = { slug: SLUG, name: "The Workroom", accounts: [{ login: "keeper-gh", id: 601 }] };
  const judge = (role, user, body, at = "2026-11-27T05:00:00Z") => judgeProof({ role, ref: parseCommentUrl(url(1)),
    got: { status: 200, body: comment(1, user, body, { created_at: at }) }, issue: ISSUE, account: NEW, house, after: ASKED_AT });
  // the real answers' shapes (town #4758, 2026-11-27), names swapped for the fixture's: replies in context, no set phrase
  assert.equal(judge("account", SECOND, "hi from Keeper-second, this is my account as well as the keeper-gh one, I'll do the keeper-gh next").ok, true);
  assert.equal(judge("keeper", KEEPER, "and confirming same account from keeper-gh, sorry about the confusion").ok, true);
  for (const body of ["Yes, this account is mine: I'm the keeper of The Workroom.", "I authorize adding keeper-second to The Workroom."])
    assert.equal(judge("keeper", KEEPER, body).ok, true, body);
  for (const body of ["This isn’t my account.", "> that this account is yours, the keeper of The Workroom", "", "  \n", "```\nyes\n```", "Don't add keeper-second yet", "wait"])
    assert.equal(judge("account", SECOND, body).ok, false, JSON.stringify(body));
  assert.match(judge("keeper", KEEPER, "I authorize it.", ASKED_AT).why, /before the request it answers/, "posted at the request's own instant is not after it");
  // the request: the town's, about this account and this house
  const ask = "1. From @keeper-second: that this account is yours, the keeper of The Workroom.";
  assert.equal(judge("request", STEWARD, ask).ok, true);
  assert.equal(judge("request", KEEPER, ask).ok, false, "the house's own account cannot ask");
  assert.equal(judge("request", STEWARD, "Could the keeper confirm?").ok, false, "a request naming neither the account nor the house");
});

// ── B6 collisions ───────────────────────────────────────────────────────────

test("B6 · an account another house lists, or a pin carries, refuses before any write, whatever the proofs say", { skip: SKIP }, async () => {
  const t = await town();
  const before = await storeRows();
  await assert.rejects(withPins(t, () => bindHouseholdAccount({ ...args(t), account: { id: 701, login: "neighbour-gh" }, apply: true, ...NO_WRITERS })),
    (e) => e.defect === BIND_REFUSALS.OTHER_HOUSE.defect && /701 is bound to hh:next-door/.test(e.detail));
  // and as a dry run too: no proof cures it
  await assert.rejects(withPins(t, () => bindHouseholdAccount({ ...args(t), account: { id: 701, login: "neighbour-gh" }, ...NO_WRITERS })),
    (e) => e.defect === BIND_REFUSALS.OTHER_HOUSE.defect);
  assert.deepEqual(await storeRows(), before);

  const t2 = await town({ pins: { ...PINS(), dee: { login: "keeper-second", id: 602, pinned: "2026-11-01" } },
    houses: { ...HOUSES(), "next-door": { ...HOUSES()["next-door"], residents: ["cy", "dee"] } } });
  const before2 = await storeRows();
  await assert.rejects(withPins(t2, () => bindHouseholdAccount({ ...args(t2), apply: true, ...NO_WRITERS })),
    (e) => e.defect === BIND_REFUSALS.PINNED.defect && /602 is the pin of dee/.test(e.detail));
  assert.deepEqual(await storeRows(), before2);
});

// ── B7 the statement re-checks the plan ─────────────────────────────────────

test("B7 · the store statement re-checks what the plan read: a changed house, or the id appearing elsewhere, writes nothing", { skip: SKIP }, async () => {
  const t = await town();
  const h0 = head(t.dir);
  // the house gains another account between the plan and the write
  await assert.rejects(withPins(t, async () => bindHouseholdAccount({ ...(await go(t)), bind: async (a, env) => {
    await asOwner(`UPDATE households SET accounts = accounts || '[{"login":"late-gh","id":650}]'::jsonb WHERE slug = $1`, [SLUG]);
    return appendHouseholdAccount(a, env);
  } })), (e) => e.defect === BIND_REFUSALS.CHANGED.defect);
  let rows = await storeRows();
  assert.deepEqual(rows.households.find((r) => r.slug === SLUG).accounts.map((a) => Number(a.id)), [601, 650], "602 was not written");

  // another house lists the id between the plan and the write
  const t2 = await town();
  await assert.rejects(withPins(t2, async () => bindHouseholdAccount({ ...(await go(t2)), bind: async (a, env) => {
    await asOwner(`UPDATE households SET accounts = accounts || '[{"login":"keeper-second","id":602}]'::jsonb WHERE slug = 'next-door'`);
    return appendHouseholdAccount(a, env);
  } })), (e) => e.defect === BIND_REFUSALS.CHANGED.defect);
  rows = await storeRows();
  assert.deepEqual(rows.households.find((r) => r.slug === SLUG).accounts.map((a) => Number(a.id)), [601]);

  // a pin takes the id between the plan and the write
  const t3 = await town();
  await assert.rejects(withPins(t3, async () => bindHouseholdAccount({ ...(await go(t3)), bind: async (a, env) => {
    await asOwner(`INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ('dee', 'keeper-second', 602, '2026-11-27')`);
    return appendHouseholdAccount(a, env);
  } })), (e) => e.defect === BIND_REFUSALS.CHANGED.defect);
  rows = await storeRows();
  assert.deepEqual(rows.households.find((r) => r.slug === SLUG).accounts.map((a) => Number(a.id)), [601]);
  assert.equal(head(t3.dir), git(t3.dir, "rev-list", "--max-parents=0", "HEAD"), "nothing committed");
  assert.equal(head(t.dir), h0);
});

// ── B8 the keys ─────────────────────────────────────────────────────────────

test("B8 · the keys: a resident off the house's key, or a ledger that already keys the id, refuses before any write", { skip: SKIP }, async () => {
  // bo has no registry line, so the town's fold keys bo under their pin's gh:601, not hh:the-workroom
  const t = await town({ ledger: KEYED.filter((l) => !/ bo = /.test(l)) });
  const before = await storeRows();
  await assert.rejects(withPins(t, () => bindHouseholdAccount({ ...args(t), apply: true, ...NO_WRITERS })),
    (e) => e.defect === BIND_REFUSALS.OFF_KEY.defect && /bo mints under gh:601/.test(e.detail));
  // a ledger line that already keys gh:602 (a handle once minted under it) would be taken over by the house
  const t2 = await town({ ledger: [...KEYED, "- 2026-11-01 · registry: dee = gh:602"] });
  await assert.rejects(withPins(t2, () => bindHouseholdAccount({ ...args(t2), apply: true, ...NO_WRITERS })),
    (e) => e.defect === BIND_REFUSALS.KEY_ALIAS.defect);
  assert.deepEqual((await storeRows()).households.find((r) => r.slug === SLUG).accounts, before.households.find((r) => r.slug === SLUG).accounts);
});

// ── B9 collateral ───────────────────────────────────────────────────────────

test("B9 · a town file behind the store in another house refuses (COLLATERAL), writing nothing", { skip: SKIP }, async () => {
  const t = await town();
  await asOwner(`UPDATE households SET name = 'Next Door, Renamed' WHERE slug = 'next-door'`);
  const before = await storeRows();
  await assert.rejects(withPins(t, () => bindHouseholdAccount({ ...args(t), apply: true, ...NO_WRITERS })),
    (e) => e.defect === BIND_REFUSALS.COLLATERAL.defect && /next-door/.test(e.detail));
  assert.deepEqual(await storeRows(), before);
});

// ── B10 the command ─────────────────────────────────────────────────────────

test("B10 · the command takes exactly one of --dry-run or --apply, and a numeric id, before it reads anything", async () => {
  const errs = [];
  const act = NEVER("the act");
  const base = ["--household", SLUG, "--account-id", "602", "--account-login", "keeper-second", "--issue", "postmark-town/postmark#4758"];
  assert.equal(await main(base, { err: (s) => errs.push(s), log: () => {}, act }), 2);
  assert.equal(await main([...base, "--dry-run", "--apply"], { err: (s) => errs.push(s), log: () => {}, act }), 2);
  assert.ok(errs.every((e) => e.includes("pass exactly one of --dry-run or --apply")));
  for (const bad of [["--account-id", "harpytfc"], ["--issue", "postmark#4758"], ["--household", null]]) {
    const argv = [...base]; const i = argv.indexOf(bad[0]);
    if (bad[1] == null) argv.splice(i, 2); else argv[i + 1] = bad[1];
    assert.equal(await main([...argv, "--dry-run"], { err: () => {}, log: () => {}, act }), 2, `refused: ${bad.join(" ")}`);
  }
});
