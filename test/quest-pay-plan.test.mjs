// quest-pay-plan.test.mjs — the reviewed quest pass (POS-632 PR-Q2).
//
// The plan is pure over its facts, so it is held on fixtures: the two sources
// (Darko 2026-10-15 Q3: comments on ONE designated discussion, and letters to
// the postmaster marked "v2 feedback"), whom each pays, once per household
// across both (Q1), the rows' reasons (owed, already paid, rejected by a hand,
// unbound, a household's second piece of feedback, a meep), the printed plan
// read back, and the digest moving with a rejection. The town's engine is read
// from a town checkout carrying the quest grammar (postmark#3819) when one is
// named by QUEST_MINT_TOWN; the pinned town-clone carries it once the pin moves.
//
// Run: node --test test/quest-pay-plan.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { OFFICE_ROOT } from "./fixture-paths.mjs";

delete process.env.OFFICE_KEEP;
delete process.env.INVOCATION_ID;
const { planQuestPays, renderPlan, parseQuestPlan, planDiffers, planDigest, isMarkedLetter, commentItems, letterItems, recipientOf, housesFrom, deliveredLetters, fetchComments, townEngine, main, QUEST_SOURCES } =
  await import("../tools/quest-pay-plan.mjs");

const Q = "read-v2-feedback";
const TERMS = { amount: 5, once_per: "household", from: "2026-10-15", until: null };
const SOURCE = QUEST_SOURCES[Q];
const DISC = 7;
const C = (id, login, gh, at = "2026-10-16T10:00:00Z", body = "I like the view.\nNot the who.", discussion = DISC) =>
  ({ databaseId: id, url: `https://github.com/postmark-town/postmark-blueprints/discussions/${DISC}#discussioncomment-${id}`, createdAt: at, body, discussion: { number: discussion }, author: { login, databaseId: gh } });
const L = (id, from, date = "2026-10-16", body = "The v2 read is quieter.\nI miss the crowd.", to = "postmaster") => ({ id, from, to, date, body });
const BINDINGS = [
  { handle: "alice", household: "keeminlee", gh_login: "keeminlee", gh_id: "1" },
  { handle: "bob", household: "keeminlee", gh_login: "keeminlee", gh_id: "1" },
  { handle: "carol", household: "carol", gh_login: "carolgh", gh_id: "2" },
  { handle: "ferry", household: "ferryhouse", gh_login: "ferrygh", gh_id: "3" },
];
const KEYS = { alice: "gh:1", bob: "gh:1", carol: "gh:2", ferry: "gh:3", dana: "gh:4" };
const houseOf = housesFrom(BINDINGS, { keyOf: (h) => KEYS[h], hasRoom: (h) => h in KEYS, date: "2026-10-17" });
const lineOf = ({ date, handle, quest, household }) => `- ${date} · MINT → ${handle} · 5 · for: quest:${quest}/${household} · by: the-town`;
const items = (comments, letters = []) => [...commentItems(comments, { discussion: DISC }), ...letterItems(letters, { source: SOURCE })];
const plan = (over = {}) => planQuestPays({
  items: items([C(40, "keeminlee", 1), C(41, "carolgh", 2), C(42, "keeminlee", 1, "2026-10-16T11:00:00Z", "more"), C(43, "stranger", 9),
    C(44, "ferrygh", 3), C(46, "carolgh", 2, "2026-10-14T10:00:00Z")]),
  quest: Q, terms: TERMS, houseOf, isMeep: (h) => h === "ferry", paid: new Map(), lineOf, date: "2026-10-17", ...over });

test("which letters are v2 feedback: the slug after the date starts v2-feedback, in the door's form or a git letter's", () => {
  assert.equal(isMarkedLetter("dana-2026-10-16-to-postmaster-v2-feedback", SOURCE), true, "the door, title \"v2 feedback\"");
  assert.equal(isMarkedLetter("dana-2026-10-16-to-postmaster-v2-feedback-the-quiet-read", SOURCE), true, "the door, a longer title");
  assert.equal(isMarkedLetter("dana-2026-10-16-v2-feedback", SOURCE), true, "a git letter, letter-<date>-v2-feedback.md");
  assert.equal(isMarkedLetter("dana-2026-10-16-to-postmaster-hello", SOURCE), false);
  assert.equal(isMarkedLetter("dana-2026-10-16-to-postmaster-my-v2-feedback", SOURCE), false, "the mark leads the slug");
  assert.equal(isMarkedLetter("dana-2026-10-16-to-postmaster-v2-feedbacks", SOURCE), false);
});

test("only the designated discussion's comments, and only marked letters to the postmaster, are feedback", () => {
  const got = items([C(40, "keeminlee", 1), C(50, "carolgh", 2, undefined, undefined, 99)],
    [L("dana-2026-10-16-to-postmaster-v2-feedback", "dana"), L("dana-2026-10-16-to-postmaster-hello", "dana"), L("dana-2026-10-16-to-carol-v2-feedback", "dana", undefined, undefined, "carol")]);
  assert.deepEqual(got.map((i) => i.ref), ["comment:40", "letter:dana-2026-10-16-to-postmaster-v2-feedback"], "a comment on discussion #99 is ignored; so are an unmarked letter and one to someone else");
});

test("whom a comment pays: a resident of the author's house it names, else the house's first", () => {
  const house = { household: "gh:1", handles: ["alice", "bob"] };
  assert.equal(recipientOf({ body: "thanks — @bob" }, house), "bob");
  assert.equal(recipientOf({ body: "from @carol" }, house), "alice", "a name outside the house is not the house's resident");
  assert.equal(recipientOf({ body: "" }, house), "alice");
});

test("the rows: owed once per household, a housemate's second comment, an unbound author, a meep, out-of-window comments not listed", () => {
  const rows = plan();
  const by = Object.fromEntries(rows.map((r) => [r.ref, r]));
  assert.deepEqual(rows.map((r) => r.ref), ["comment:40", "comment:41", "comment:42", "comment:43", "comment:44"], "only comments inside the window are rows");
  assert.equal(by["comment:40"].why, "owed"); assert.equal(by["comment:40"].handle, "alice"); assert.equal(by["comment:40"].household, "gh:1");
  assert.equal(by["comment:41"].why, "owed"); assert.equal(by["comment:41"].household, "gh:2");
  assert.match(by["comment:42"].why, /duplicate: the household's comment:40 is the one paid/);
  assert.match(by["comment:43"].why, /unbound: stranger binds no resident here/);
  assert.match(by["comment:44"].why, /meep/);
  assert.equal(rows.filter((r) => r.owed).reduce((s, r) => s + r.n, 0), 10);
});

test("a letter-sourced row: the sender's household from the town's record, paid to the sender, no GitHub binding", () => {
  const rows = planQuestPays({ items: items([], [L("dana-2026-10-16-to-postmaster-v2-feedback", "dana"), L("zed-2026-10-16-to-postmaster-v2-feedback", "zed")]),
    quest: Q, terms: TERMS, houseOf, isMeep: () => false, lineOf, date: "2026-10-17" });
  const [dana, zed] = rows;
  assert.equal(dana.why, "owed"); assert.equal(dana.handle, "dana"); assert.equal(dana.household, "gh:4"); assert.equal(dana.source, "letter");
  assert.equal(dana.line, lineOf({ date: "2026-10-17", handle: "dana", quest: Q, household: "gh:4" }));
  assert.match(zed.why, /unbound: zed has no room here/);
  const text = renderPlan(rows, { date: "2026-10-17", quest: Q });
  assert.match(text, /letter:dana-2026-10-16-to-postmaster-v2-feedback · dana · gh:4 · 5 · owed · by dana on 2026-10-16/);
  assert.match(text, /a letter to the postmaster: dana-2026-10-16-to-postmaster-v2-feedback\n {6}"The v2 read is quieter\."/, "the row prints the letter's id and first line");
});

test("once per household across both sources: a letter and a comment from one house pay once, whichever source", () => {
  // bob writes to the postmaster; keeminlee (alice + bob's GitHub) comments the same day.
  const rows = planQuestPays({ items: items([C(40, "keeminlee", 1)], [L("bob-2026-10-16-to-postmaster-v2-feedback", "bob")]),
    quest: Q, terms: TERMS, houseOf, isMeep: () => false, lineOf, date: "2026-10-17" });
  assert.deepEqual(rows.map((r) => [r.ref, r.owed]), [["comment:40", true], ["letter:bob-2026-10-16-to-postmaster-v2-feedback", false]]);
  assert.match(rows[1].why, /duplicate: the household's comment:40 is the one paid/);
  // the letter came first (a day earlier): it is the one paid, and the comment is the duplicate.
  const earlier = planQuestPays({ items: items([C(40, "keeminlee", 1)], [L("bob-2026-10-15-to-postmaster-v2-feedback", "bob", "2026-10-15")]),
    quest: Q, terms: TERMS, houseOf, isMeep: () => false, lineOf, date: "2026-10-17" });
  assert.deepEqual(earlier.map((r) => [r.ref, r.owed, r.handle]), [["letter:bob-2026-10-15-to-postmaster-v2-feedback", true, "bob"], ["comment:40", false, "alice"]]);
  assert.equal(earlier.filter((r) => r.owed).length, 1);
  // a house already paid by a comment's line is not paid again by its letter.
  const paid = planQuestPays({ items: items([], [L("bob-2026-10-16-to-postmaster-v2-feedback", "bob")]),
    quest: Q, terms: TERMS, houseOf, isMeep: () => false, paid: new Map([["gh:1", { handle: "alice", date: "2026-10-16" }]]), lineOf, date: "2026-10-17" });
  assert.match(paid[0].why, /already paid: alice on 2026-10-16/);
  assert.equal(paid[0].owed, false);
});

test("already paid and a hand's rejection pay nothing, for both sources, and a rejection moves the digest", () => {
  const before = plan();
  const rows = plan({ paid: new Map([["gh:2", { handle: "carol", date: "2026-10-16" }]]), rejected: new Set(["comment:40"]) });
  const by = Object.fromEntries(rows.map((r) => [r.ref, r]));
  assert.match(by["comment:40"].why, /rejected: a hand read it/);
  assert.match(by["comment:41"].why, /already paid: carol on 2026-10-16/);
  assert.match(by["comment:42"].why, /^owed$/, "with comment:40 rejected, the household's next comment is the one that pays");
  assert.notEqual(planDigest(rows), planDigest(before));
  const letter = "letter:dana-2026-10-16-to-postmaster-v2-feedback";
  const withLetter = planQuestPays({ items: items([], [L("dana-2026-10-16-to-postmaster-v2-feedback", "dana")]), quest: Q, terms: TERMS, houseOf, isMeep: () => false, lineOf, date: "2026-10-17", rejected: new Set([letter]) });
  assert.match(withLetter[0].why, /rejected: a hand read it/);
  assert.equal(withLetter[0].owed, false);
});

test("the printed plan reads back to the plan, and a changed row is caught", () => {
  const rows = plan();
  const text = renderPlan(rows, { date: "2026-10-17", quest: Q });
  assert.match(text, /needs-review \(Q4\)/);
  assert.match(text, /discussioncomment-40/, "each owed row carries its link, to read before the apply");
  const parsed = parseQuestPlan(text);
  assert.equal(parsed.owed.length, 2);
  assert.equal(planDiffers(parsed, rows, "2026-10-17"), null);
  assert.match(planDiffers(parsed, rows, "2026-10-18"), /the lines' date/);
  const forged = text.replace("comment:41 · carol · gh:2 · 5 · owed", "comment:41 · carol · gh:2 · 50 · owed");
  assert.throws(() => parseQuestPlan(forged), /stamps owed and its rows add to/);
});

test("the letters come from the mail ledger's deliveries to the postmaster, with their bodies from the inbox", () => {
  const town = mkdtempSync(join(tmpdir(), "quest-letters-"));
  mkdirSync(join(town, "WHITE_PAGES", "postmaster", "inbox", "bob-2026-10-16-v2-feedback"), { recursive: true });
  writeFileSync(join(town, "WHITE_PAGES", "mail-ledger.md"), [
    "# Mail ledger", "",
    "- 2026-10-16 · dana-2026-10-16-to-postmaster-v2-feedback · dana → postmaster · thread: new",
    "- 2026-10-16 · bob-2026-10-16-v2-feedback · bob → postmaster · thread: new",
    "- 2026-10-16 · dana-2026-10-16-to-carol-v2-feedback · dana → carol · thread: new",
    "- 2026-10-16 · BOUNCE · WHITE_PAGES/zed/outbox/letter-2026-10-16-v2-feedback.md (from zed): missing required field: id", ""].join("\n"));
  writeFileSync(join(town, "WHITE_PAGES", "postmaster", "inbox", "dana-2026-10-16-to-postmaster-v2-feedback.md"), "---\nid: x\nfrom: dana\n---\n\nQuieter, and I like it.\n");
  writeFileSync(join(town, "WHITE_PAGES", "postmaster", "inbox", "bob-2026-10-16-v2-feedback", "letter.md"), "---\nid: y\n---\nA folder letter.\n");
  const parse = (text) => text.split("\n").map((l) => /^- (\S+) · (\S+) · (\S+) → (\S+)/.exec(l)).filter((m) => m && m[2] !== "BOUNCE").map((m) => ({ kind: "delivery", date: m[1], id: m[2], from: m[3], to: m[4] }));
  const got = deliveredLetters(town, "postmaster", parse);
  assert.deepEqual(got.map((l) => [l.id, l.from, l.date]), [["dana-2026-10-16-to-postmaster-v2-feedback", "dana", "2026-10-16"], ["bob-2026-10-16-v2-feedback", "bob", "2026-10-16"]]);
  assert.equal(got[0].body.trim(), "Quieter, and I like it.");
  assert.equal(got[1].body.trim(), "A folder letter.");
  rmSync(town, { recursive: true });
});

// ── review-quest F1–F4 (2026-10-15) ─────────────────────────────────────────

test("F3: a marked letter the ledger delivered but the inbox does not hold pays nothing, and says why", () => {
  const town = mkdtempSync(join(tmpdir(), "quest-letters-"));
  mkdirSync(join(town, "WHITE_PAGES", "postmaster", "inbox"), { recursive: true });
  writeFileSync(join(town, "WHITE_PAGES", "mail-ledger.md"), "- 2026-10-16 · dana-2026-10-16-to-postmaster-v2-feedback · dana → postmaster · thread: new\n");
  const parse = (text) => text.split("\n").map((l) => /^- (\S+) · (\S+) · (\S+) → (\S+)/.exec(l)).filter(Boolean).map((m) => ({ kind: "delivery", date: m[1], id: m[2], from: m[3], to: m[4] }));
  const letters = deliveredLetters(town, "postmaster", parse);
  rmSync(town, { recursive: true });
  assert.equal(letters[0].body, null, "no file: no body, never an empty one");
  const rows = planQuestPays({ items: items([], letters), quest: Q, terms: TERMS, houseOf, isMeep: () => false, lineOf, date: "2026-10-17" });
  assert.equal(rows[0].owed, false);
  assert.match(rows[0].why, /^no letter on file: .*WHITE_PAGES\/postmaster\/inbox holds no dana-2026-10-16-to-postmaster-v2-feedback/);
  assert.match(renderPlan(rows, { date: "2026-10-17", quest: Q }), /0 owed \(0 stamps\)/);
});

test("F1: a comment's named recipient is chosen only among the handles holding the house's key", () => {
  // one GitHub account pins ann (gh:1) and zed-bot (its own solo key): the line names gh:1, so it can only pay ann.
  const bindings = [{ handle: "ann", gh_login: "annie", gh_id: "1" }, { handle: "zed-bot", gh_login: "annie", gh_id: "1" }];
  const keys = { ann: "gh:1", "zed-bot": "solo:zed-bot" };
  const houses = housesFrom(bindings, { keyOf: (h) => keys[h], hasRoom: () => true, date: "2026-10-17" });
  const rows = planQuestPays({ items: items([C(1, "annie", 1, undefined, "from @zed-bot: the view is lovely")]), quest: Q, terms: TERMS, houseOf: houses, isMeep: () => false, lineOf, date: "2026-10-17" });
  assert.deepEqual([rows[0].handle, rows[0].household, rows[0].owed], ["ann", "gh:1", true], "never zed-bot on gh:1's line, which the minter refuses");
});

test("F2: a meep's or a refused row never holds the house, so the household's next feedback is still paid", () => {
  // one account pins aa-meep and bob under one key: the unnamed comment goes to aa-meep (the first) and pays nothing.
  const bindings = [{ handle: "aa-meep", gh_login: "acct", gh_id: "1" }, { handle: "bob", gh_login: "acct", gh_id: "1" }];
  const houses = housesFrom(bindings, { keyOf: () => "gh:1", hasRoom: () => true, date: "2026-10-17" });
  const rows = planQuestPays({ items: items([C(1, "acct", 1)], [L("bob-2026-10-16-to-postmaster-v2-feedback", "bob")]),
    quest: Q, terms: TERMS, houseOf: houses, isMeep: (h) => h === "aa-meep", lineOf, date: "2026-10-17" });
  assert.deepEqual(rows.map((r) => [r.ref, r.owed]), [["comment:1", false], ["letter:bob-2026-10-16-to-postmaster-v2-feedback", true]]);
  assert.match(rows[0].why, /^meep/);
  // a line the town refuses holds nothing either.
  const refusing = (row) => { if (row.handle === "aa-meep") throw new Error("no room"); return lineOf(row); };
  const refused = planQuestPays({ items: items([C(1, "acct", 1)], [L("bob-2026-10-16-to-postmaster-v2-feedback", "bob")]),
    quest: Q, terms: TERMS, houseOf: houses, isMeep: () => false, lineOf: refusing, date: "2026-10-17" });
  assert.deepEqual(refused.map((r) => [r.why.split(":")[0], r.owed]), [["refused", false], ["owed", true]]);
});

test("F4: a comment binds by its author's GitHub id; a login alone binds only a binding with no id", () => {
  const bindings = [{ handle: "dee", gh_login: "old", gh_id: "5" }, { handle: "eve", gh_login: "eve-gh", gh_id: null }];
  const houses = housesFrom(bindings, { keyOf: (h) => `gh:${h}`, hasRoom: () => true, date: "2026-10-17" });
  const rows = planQuestPays({ items: items([C(1, "old", 99), C(2, "old", 5), C(3, "eve-gh", 7)]), quest: Q, terms: TERMS, houseOf: houses, isMeep: () => false, lineOf, date: "2026-10-17" });
  const by = Object.fromEntries(rows.map((r) => [r.ref, r]));
  assert.match(by["comment:1"].why, /^unbound: old binds no resident here/, "the login matches but the id is another account's");
  assert.deepEqual([by["comment:2"].handle, by["comment:2"].owed], ["dee", true]);
  assert.deepEqual([by["comment:3"].handle, by["comment:3"].owed], ["eve", true], "a binding with no id still matches by login");
});

test("the comments are read from the one designated discussion, by number, every page", async () => {
  const asked = [];
  const pages = [
    { nodes: [C(1, "a", 1)], pageInfo: { hasNextPage: true, endCursor: "x" } },
    { nodes: [C(2, "b", 2)], pageInfo: { hasNextPage: false, endCursor: null } },
  ];
  const fetchImpl = async (_url, init) => {
    const { variables } = JSON.parse(init.body);
    asked.push(variables);
    return { json: async () => ({ data: { repository: { discussion: { number: variables.n, comments: pages[asked.length - 1] } } } }) };
  };
  const got = await fetchComments(SOURCE, DISC, { env: { GH_TOKEN: "t" }, fetchImpl });
  assert.deepEqual(got.map((c) => c.databaseId), [1, 2]);
  assert.deepEqual(asked.map((v) => [v.o, v.r, v.n, v.a]), [["postmark-town", "postmark-blueprints", DISC, null], ["postmark-town", "postmark-blueprints", DISC, "x"]]);
});

test("the pass refuses without its designated discussion, and a --reject that is not a ref", async () => {
  const out = [];
  const opts = { log: (s) => out.push(s), err: (s) => out.push(`ERR ${s}`), env: {} };
  assert.equal(await main(["--town", OFFICE_ROOT, "--quest", Q], opts), 1);
  assert.match(out.join("\n"), /--discussion <n> is required/);
  assert.equal(await main(["--town", OFFICE_ROOT, "--quest", Q, "--discussion", "7", "--reject", "40"], opts), 1);
  assert.match(out.join("\n"), /--reject takes the plan's refs/);
});

const TOWN = process.env.QUEST_MINT_TOWN ?? join(OFFICE_ROOT, "town-clone");
const HAS_GRAMMAR = existsSync(join(TOWN, "tools", "stamp-mint.mjs"))
  && (await import(pathToFileURL(join(TOWN, "tools", "stamp-mint.mjs")).href)).QUEST_PAY;

test("the plan over the town's own engine: its QUEST_PAY terms, line builder and mail ledger", { skip: !HAS_GRAMMAR && "the town checkout carries no quest grammar yet (postmark#3819); set QUEST_MINT_TOWN" }, async () => {
  const engine = await townEngine(TOWN, Q);
  assert.deepEqual(engine.terms, TERMS);
  assert.equal(typeof engine.parseMailLedger, "function");
  const out = [];
  const code = await main(["--town", TOWN, "--quest", Q, "--discussion", String(DISC), "--date", "2026-10-17"], {
    facts: { comments: [C(40, "keeminlee", 1)], bindings: [{ handle: "wright", household: "keeminlee", gh_login: "keeminlee", gh_id: "1" }], letters: [] },
    log: (s) => out.push(s), err: (s) => out.push(`ERR ${s}`), env: {},
  });
  assert.equal(code, 0, out.join("\n"));
  assert.match(out.join("\n"), /quest pay plan for read-v2-feedback/);
  assert.match(out.join("\n"), /apply exactly this plan with:\n.*--discussion 7/);
});
