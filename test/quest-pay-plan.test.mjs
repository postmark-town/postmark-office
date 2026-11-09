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
// The Hearth quest (POS-985) is held the same way: its evidence is the
// registered Hearth entries on the town's main, read through git from a
// throwaway repo, paid once per household by the roll in tools/households.json,
// closed until the town's QUEST_PAY names its opening day.
//
// Run: node --test test/quest-pay-plan.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { OFFICE_ROOT } from "./fixture-paths.mjs";

delete process.env.OFFICE_KEEP;
delete process.env.INVOCATION_ID;
const { planQuestPays, renderPlan, parseQuestPlan, planDiffers, planDigest, isMarkedLetter, commentItems, letterItems, recipientOf, housesFrom, deliveredLetters, fetchComments, townEngine, main, QUEST_SOURCES,
  hearthItems, housesFromRoll, hearthEntries, readHearthMeta, renderApplyHint, questOpen } =
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

// ── the Hearth quest (POS-985) ──────────────────────────────────────────────
// LAW (Darko 2026-11-01 16:51 EST, POS-845): "we should still reward stamps to
// anyone who tries their hand at their own household hearth"; 20:08: "let's say
// 10 stamps for entering and 100 to the winner". The 10 is this pass, once per
// household; the 100 is the founder gift and never this pass.

const HQ = "hearth-entry";
const HSOURCE = QUEST_SOURCES[HQ];
const HTERMS = { amount: 10, once_per: "household", from: "2026-11-10", until: null };
const ROLL = { "fox-hearth": { residents: ["fox-meep", "alden", "corwin"] }, "lone-wolf": { residents: ["wolf"] }, "ghost-house": { residents: ["nobody"] } };
const HKEYS = { "fox-meep": "gh:20", alden: "gh:20", corwin: "gh:20", wolf: "gh:30" };
const hHouseOf = housesFromRoll(ROLL, { keyOf: (h) => HKEYS[h], hasRoom: (h) => h in HKEYS, date: "2026-11-14" });
const hLineOf = ({ date, handle, quest, household }) => `- ${date} · MINT → ${handle} · 10 · for: quest:${quest}/${household} · by: the-town`;
const E = (id, author, date, extra = {}) => ({ id, author, line: `${id}'s design.`, date, commit: `${id.length}`.padStart(40, "a"), subject: `Merge pull request #1 from x/${id}`, ...extra });
const ENTRIES = [
  E("broken", null, null, { problem: "not an entry: no hearth.html (the site skips it too)" }),
  E("default", "postmark", "2026-11-08"),
  E("fox-hearth", "fox-hearth", "2026-11-09"),
  E("fox-hearth-2", "fox-hearth", "2026-11-12"),
  E("ghost", "ghost-house", "2026-11-12"),
  E("lone-wolf", "lone-wolf", "2026-11-13"),
  E("nameless", null, "2026-11-13"),
];
const hPlan = (over = {}) => planQuestPays({ items: hearthItems(ENTRIES, { source: HSOURCE }), quest: HQ, terms: HTERMS, houseOf: hHouseOf,
  isMeep: (h) => h === "fox-meep", paid: new Map(), lineOf: hLineOf, date: "2026-11-14", ...over });

test("hearth: the source is the town's PROJECTS/household-hearths, and a hearth ref is one --reject takes", () => {
  assert.deepEqual([HSOURCE.kind, HSOURCE.owner, HSOURCE.repo, HSOURCE.dir], ["hearth", "postmark-town", "postmark", "PROJECTS/household-hearths"]);
  assert.equal(QUEST_SOURCES[Q].kind, "feedback", "the v2 quest keeps its two feedback sources");
});

test("hearth: hearth.md's author and first line, as the site reads them", () => {
  assert.deepEqual(readHearthMeta("---\ntitle: The den\nauthor: fox-hearth\n---\n\nA den in the snow,\nwarm.\n\nMore.\n"), { author: "fox-hearth", line: "A den in the snow, warm." });
  assert.deepEqual(readHearthMeta("---\r\ntitle: x\r\nauthor:  lone-wolf \r\n---\r\nOne line.\r\n"), { author: "lone-wolf", line: "One line." }, "CRLF and padding");
  assert.equal(readHearthMeta("no front matter\nauthor: fox-hearth\n").author, null, "an author outside the front matter names no one");
  assert.equal(readHearthMeta("---\ntitle: x\nauthor:\n---\n").author, null, "an empty author names no one");
});

test("hearth: the rows: once per household, the house's first resident who is not a meep, an entry from before the quest opened still pays", () => {
  const rows = hPlan();
  const by = Object.fromEntries(rows.map((r) => [r.ref, r]));
  assert.deepEqual(rows.map((r) => r.ref), ["hearth:broken", "hearth:default", "hearth:fox-hearth", "hearth:fox-hearth-2", "hearth:ghost", "hearth:lone-wolf", "hearth:nameless"]);
  assert.deepEqual([by["hearth:fox-hearth"].why, by["hearth:fox-hearth"].handle, by["hearth:fox-hearth"].household, by["hearth:fox-hearth"].n], ["owed", "alden", "gh:20", 10],
    "merged 11-09, before the quest opened on 11-10, and still owed; paid to alden, not the meep listed first");
  assert.match(by["hearth:fox-hearth-2"].why, /^duplicate: the household's hearth:fox-hearth is the one paid/);
  assert.deepEqual([by["hearth:lone-wolf"].why, by["hearth:lone-wolf"].handle, by["hearth:lone-wolf"].household], ["owed", "wolf", "gh:30"]);
  assert.match(by["hearth:broken"].why, /^not an entry: no hearth\.html/);
  assert.match(by["hearth:default"].why, /^unbound: the author "postmark" is no resident on the roll and no household with a resident here$/, "the town's own designs pay no one");
  assert.match(by["hearth:ghost"].why, /^unbound: the author "ghost-house" is no resident on the roll and no household with a resident here$/, "a household with no resident who has a room");
  assert.match(by["hearth:nameless"].why, /^unbound: its hearth\.md names no author/);
  assert.equal(rows.filter((r) => r.owed).reduce((s, r) => s + r.n, 0), 20, "LAW: 10 a household, two households");
  assert.equal(by["hearth:fox-hearth"].line, hLineOf({ date: "2026-11-14", handle: "alden", quest: HQ, household: "gh:20" }));
});

test("hearth: an entry merged after `until` is not listed; already paid, a hand's rejection and an all-meep house pay nothing", () => {
  const late = planQuestPays({ items: hearthItems([E("fox-hearth", "fox-hearth", "2026-12-09"), E("lone-wolf", "lone-wolf", "2026-12-08")], { source: HSOURCE }), quest: HQ,
    terms: { ...HTERMS, until: "2026-12-08" }, houseOf: hHouseOf, isMeep: () => false, lineOf: hLineOf, date: "2026-12-08" });
  assert.deepEqual(late.map((r) => [r.ref, r.owed]), [["hearth:lone-wolf", true]], "merged on until is in; the day after is not");
  const rows = hPlan({ paid: new Map([["gh:30", { handle: "wolf", date: "2026-11-13" }]]), rejected: new Set(["hearth:fox-hearth"]) });
  const by = Object.fromEntries(rows.map((r) => [r.ref, r]));
  assert.match(by["hearth:fox-hearth"].why, /^rejected: a hand read it — not this household's own Hearth/);
  assert.equal(by["hearth:fox-hearth-2"].why, "owed", "with the first rejected, the household's next entry is the one paid");
  assert.match(by["hearth:lone-wolf"].why, /^already paid: wolf on 2026-11-13/);
  const meeps = planQuestPays({ items: hearthItems([E("fox-hearth", "fox-hearth", "2026-11-12")], { source: HSOURCE }), quest: HQ, terms: HTERMS, houseOf: hHouseOf,
    isMeep: () => true, lineOf: hLineOf, date: "2026-11-14" });
  assert.deepEqual([meeps[0].owed, meeps[0].why.split(":")[0]], [false, "meep"]);
});

test("hearth: the printed plan names each entry's folder and merging commit, reads back, and its hint carries no --discussion", () => {
  const rows = hPlan();
  const text = renderPlan(rows, { date: "2026-11-14", quest: HQ });
  assert.match(text, /^quest pay plan for hearth-entry — 7 Hearth entr\(ies\) qualify, 0 already paid, 5 pay nothing, 2 owed \(20 stamps\), dated 2026-11-14$/m);
  assert.match(text, /needs-review: open every OWED entry/);
  assert.match(text, / {2}hearth:fox-hearth · alden · gh:20 · 10 · owed · by fox-hearth on 2026-11-09\n {6}a Hearth entry: https:\/\/github\.com\/postmark-town\/postmark\/tree\/main\/PROJECTS\/household-hearths\/fox-hearth, merged in a{9} "Merge pull request #1 from x\/fox-hearth"\n {6}"fox-hearth's design\."/);
  const parsed = parseQuestPlan(text);
  assert.deepEqual(parsed.owed.map((r) => [r.ref, r.handle, r.n]), [["hearth:fox-hearth", "alden", 10], ["hearth:lone-wolf", "wolf", 10]]);
  assert.equal(planDiffers(parsed, rows, "2026-11-14"), null);
  assert.throws(() => parseQuestPlan(text.replace("hearth:lone-wolf · wolf · gh:30 · 10 · owed", "hearth:lone-wolf · wolf · gh:30 · 100 · owed")), /stamps owed and its rows add to/);
  const hint = renderApplyHint(planDigest(rows), { town: "/t", quest: HQ, discussion: null, date: "2026-11-14", keyPath: "/k", rejected: new Set(["hearth:default"]) });
  assert.match(hint, /--town \/t --quest hearth-entry --date 2026-11-14 --reject hearth:default --apply --key \/k --expect sha256:/);
  assert.doesNotMatch(hint, /--discussion/);
});

test("hearth: questOpen: closed while the town names no opening day, open from it, closed after until", () => {
  assert.equal(questOpen({ from: null, until: null }, "2026-11-14"), false);
  assert.equal(questOpen(HTERMS, "2026-11-09"), false);
  assert.equal(questOpen(HTERMS, "2026-11-10"), true);
  assert.equal(questOpen({ ...HTERMS, until: "2026-12-08" }, "2026-12-09"), false);
});

test("hearth: the pass refuses a --discussion, and takes a hearth ref in --reject", async () => {
  const out = [];
  const opts = { log: (s) => out.push(s), err: (s) => out.push(`ERR ${s}`), env: {} };
  assert.equal(await main(["--town", OFFICE_ROOT, "--quest", HQ, "--discussion", "7"], opts), 1);
  assert.match(out.join("\n"), /hearth-entry reads no discussion/);
  out.length = 0;
  assert.equal(await main(["--town", OFFICE_ROOT, "--quest", HQ, "--reject", "hearth:fox-hearth"], opts), 1, "no town engine in the office root, so it stops there");
  assert.doesNotMatch(out.join("\n"), /--reject takes/);
  assert.match(out.join("\n"), /no tools\/stamp-mint\.mjs/);
});

// The author line (Truey's FIX on #995 at ebe968a). The README said "author
// (you)", and on the real roll most residents' handles are not their
// household's slug; three handles (moth, mari, ember) are another household's
// slug. Synthetic names, the same shapes:
//   corwin — a housemate's handle, not a slug (alden's case on the real roll)
//   wisp   — a resident of the-burrow AND the slug of another household (moth's)
//   lone-wolf — a house of one named after its only resident: both readings, one house
//   drifter — a name with a room-shaped key and no line in the roll
//   old-name — a retired pin: in the key base (github-ids.json keeps it), on no
//              roll line, no resident (dylan-android-husband's and
//              wesley-seeker's shape on the real roll; Truey's FIX at f7e8a9b)
const AROLL = {
  "fox-hearth": { residents: ["fox-meep", "alden", "corwin"] },
  "the-burrow": { residents: ["wisp", "bramble"] },
  wisp: { residents: ["glow"] },
  "lone-wolf": { residents: ["lone-wolf"] },
};
const AKEYS = { "fox-meep": "gh:20", alden: "gh:20", corwin: "gh:20", wisp: "gh:40", bramble: "gh:40", glow: "gh:41", "lone-wolf": "gh:30", drifter: "solo:drifter", "old-name": "gh:50" };
const aHouseOf = housesFromRoll(AROLL, { keyOf: (h) => AKEYS[h], hasRoom: (h) => h in AKEYS, date: "2026-11-14" });
const aRows = (authors) => planQuestPays({ items: hearthItems(authors.map((a, i) => E(`e${i}-${a}`, a, "2026-11-12")), { source: HSOURCE }), quest: HQ, terms: HTERMS,
  houseOf: aHouseOf, isMeep: (h) => h === "fox-meep", lineOf: hLineOf, date: "2026-11-14" });

test("hearth: the author line takes a resident's handle (that household, the author paid) or a household's slug", () => {
  const [byHandle, bySlug] = aRows(["corwin", "the-burrow"]);
  assert.deepEqual([byHandle.why, byHandle.handle, byHandle.household], ["owed", "corwin", "gh:20"], "a housemate's handle pays its own household, to the author (alden's case)");
  assert.deepEqual([bySlug.why, bySlug.handle, bySlug.household], ["owed", "wisp", "gh:40"], "a slug pays the household's first resident who is not a meep");
  // until f7e8a9b this asserted drifter paid as its own house; a name off the roll is paid nothing (Truey's FIX)
  for (const [name, row] of [["drifter", aRows(["drifter"])[0]], ["old-name", aRows(["old-name"])[0]]]) {
    assert.deepEqual([row.owed, row.n, row.handle ?? null, row.household ?? null], [false, 0, null, null], `${name}: a name off the roll pays no one`);
    assert.equal(row.why, `unbound: the author "${name}" is no resident on the roll and no household with a resident here`);
  }
  assert.match(aRows(["fox-hearth"])[0].why, /^owed$/);
  assert.equal(aRows(["fox-hearth"])[0].handle, "alden", "the slug still skips the meep listed first");
});

test("hearth: a handle that is also another household's slug is ambiguous and pays nothing; a house of one named after its resident pays", () => {
  const [wisp, glow, wolf] = aRows(["wisp", "glow", "lone-wolf"]);
  assert.deepEqual([wisp.owed, wisp.n, wisp.why], [false, 0, 'ambiguous: "wisp" is a household\'s slug and the handle of a resident of another household; a hand decides'],
    "moth's case: never paid to either house without a hand");
  assert.deepEqual([glow.why, glow.handle, glow.household], ["owed", "glow", "gh:41"], "the slug wisp's own resident, by handle, is paid");
  assert.deepEqual([wolf.why, wolf.handle, wolf.household], ["owed", "lone-wolf", "gh:30"], "both readings name one household: no ambiguity (Wright, 2026-11-09)");
  // an ambiguous row never holds the house: the-burrow's next entry, by a plain handle, is the one paid
  const held = aRows(["wisp", "bramble"]);
  assert.deepEqual(held.map((r) => [r.owed, r.handle ?? null]), [[false, null], [true, "bramble"]]);
});

test("hearth: an unbound or ambiguous row names the later commit that changed the author line, and still pays nothing", () => {
  const later = (author) => ({ commit: "b".repeat(40), subject: "fix our author line (#9)", author });
  const note = (to) => ` · a later commit, bbbbbbbbb "fix our author line (#9)", changed the author line to ${to}; a hand decides`;
  const rows = planQuestPays({ items: hearthItems([
    E("typo", "the-burow", "2026-11-12", { later: later("the-burrow") }),
    E("both", "wisp", "2026-11-12", { later: later("bramble") }),
    E("blank", null, "2026-11-12", { later: later("glow") }),
    E("fixed", "corwin", "2026-11-12", { later: later("thief-house") }),
  ], { source: HSOURCE }), quest: HQ, terms: HTERMS, houseOf: aHouseOf, isMeep: () => false, lineOf: hLineOf, date: "2026-11-14" });
  const by = Object.fromEntries(rows.map((r) => [r.ref, r]));
  assert.equal(by["hearth:typo"].why, `unbound: the author "the-burow" is no resident on the roll and no household with a resident here${note('"the-burrow"')}`);
  assert.equal(by["hearth:both"].why, `ambiguous: "wisp" is a household's slug and the handle of a resident of another household; a hand decides${note('"bramble"')}`);
  assert.equal(by["hearth:blank"].why, `unbound: its hearth.md names no author${note('"glow"')}`);
  assert.deepEqual(rows.filter((r) => r.owed).map((r) => [r.ref, r.handle, r.why]), [["hearth:fixed", "corwin", "owed"]],
    "nothing pays from the later line: only the entry whose author resolved at the merge is owed, and an owed row carries no note");
});

// The entries, read from a real git history: a throwaway town repo whose main
// takes one entry by a merge commit and one by a direct commit, plus the
// infrastructure folder, a folder with no hearth.html and an uncommitted one.
function hearthTown() {
  const dir = mkdtempSync(join(tmpdir(), "quest-hearth-"));
  const g = (args, at) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", "-C", dir, ...args],
    { encoding: "utf8", env: { ...process.env, ...(at ? { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : {}) } });
  const put = (path, text) => { mkdirSync(join(dir, path, ".."), { recursive: true }); writeFileSync(join(dir, path), text); };
  const H = "PROJECTS/household-hearths";
  g(["init", "-q", "-b", "main"]);
  put(`${H}/README.md`, "# Hearths\n");
  put(`${H}/STARTER/hearth.html`, "<hearth-house></hearth-house>\n");
  put(`${H}/STARTER/hearth.md`, "---\nauthor: your-household-slug\n---\n");
  put(`${H}/default/hearth.html`, "<hearth-house></hearth-house>\n");
  put(`${H}/default/hearth.md`, "---\ntitle: Postmark's default\nauthor: postmark\n---\nThe default.\n");
  put(`${H}/broken/hearth.md`, "---\nauthor: lone-wolf\n---\nNo template.\n");
  g(["add", "."]); g(["commit", "-q", "-m", "intake"], "2026-11-08T21:00:00Z");
  g(["checkout", "-q", "-b", "fox"]);
  put(`${H}/fox-hearth/hearth.html`, "<div><hearth-residents></hearth-residents></div>\n");
  put(`${H}/fox-hearth/hearth.md`, "---\ntitle: The den\nauthor: fox-hearth\n---\nA den in the snow.\n");
  g(["add", "."]); g(["commit", "-q", "-m", "fox-hearth: our Hearth"], "2026-11-07T15:00:00Z");
  g(["checkout", "-q", "main"]);
  put("WHITE_PAGES/note.md", "a resident's commit\n");
  g(["add", "."]); g(["commit", "-q", "-m", "a resident's commit"], "2026-11-09T11:00:00Z");
  // merged at 03:30Z on 11-10, which is 22:30 on 11-09 in the town's time
  g(["merge", "-q", "--no-ff", "-m", "Merge pull request #7 from fox-hearth/hearth", "fox"], "2026-11-10T03:30:00Z");
  put(`${H}/lone-wolf/hearth.html`, "<hearth-house></hearth-house>\n");
  put(`${H}/lone-wolf/hearth.md`, "---\nauthor: lone-wolf\n---\nOne wolf.\n");
  g(["add", "."]); g(["commit", "-q", "-m", "lone-wolf: a Hearth (#8)"], "2026-11-12T15:00:00Z");
  const merge = g(["rev-parse", "HEAD~1"]).trim();
  const direct = g(["rev-parse", "HEAD"]).trim();
  // a later PR rewrites fox-hearth's author line: the row shows the merge, so the author is read there
  put(`${H}/fox-hearth/hearth.md`, "---\ntitle: The den\nauthor: thief-house\n---\nA den in the snow.\n");
  g(["add", "."]); g(["commit", "-q", "-m", "a later PR: fox-hearth's author line"], "2026-11-13T12:00:00Z");
  const thief = g(["rev-parse", "HEAD"]).trim();
  // an entry whose hearth.css is a link (mode 120000), staged by index so no filesystem link is needed
  put(`${H}/linked/hearth.html`, "<hearth-house></hearth-house>\n");
  put(`${H}/linked/hearth.md`, "---\nauthor: lone-wolf\n---\nA linked style.\n");
  g(["add", `${H}/linked/hearth.html`, `${H}/linked/hearth.md`]);
  const target = execFileSync("git", ["-C", dir, "hash-object", "-w", "--stdin"], { encoding: "utf8", input: "../lone-wolf/hearth.css" }).trim();
  g(["update-index", "--add", "--cacheinfo", `120000,${target},${H}/linked/hearth.css`]);
  g(["commit", "-q", "-m", "linked: a Hearth with a linked style"], "2026-11-13T16:00:00Z");
  // an entry merged with a misspelt author line, fixed by a later PR
  put(`${H}/typo/hearth.html`, "<hearth-house></hearth-house>\n");
  put(`${H}/typo/hearth.md`, "---\nauthor: lone-wolff\n---\nA typo.\n");
  g(["add", `${H}/typo`]); g(["commit", "-q", "-m", "typo: a Hearth (#10)"], "2026-11-13T17:00:00Z");
  put(`${H}/typo/hearth.md`, "---\nauthor: lone-wolf\n---\nA typo.\n");
  g(["add", `${H}/typo`]); g(["commit", "-q", "-m", "typo: fix the author line (#11)"], "2026-11-13T18:00:00Z");
  const fix = g(["rev-parse", "HEAD"]).trim();
  put(`${H}/drafty/hearth.html`, "<hearth-house></hearth-house>\n"); // never committed: not on main
  return { dir, merge, direct, fix, thief };
}

test("hearth: the entries come from the town's main: a folder with hearth.html, not in capitals, dated by the commit that merged it, in the town's time", () => {
  const { dir, merge, direct, fix, thief } = hearthTown();
  try {
    const got = hearthEntries(dir, HSOURCE);
    assert.deepEqual(got.map((e) => e.id), ["broken", "default", "fox-hearth", "linked", "lone-wolf", "typo"], "STARTER is infrastructure; drafty was never committed");
    const by = Object.fromEntries(got.map((e) => [e.id, e]));
    assert.match(by.broken.problem, /^not an entry: no hearth\.html/);
    assert.deepEqual([by["fox-hearth"].date, by["fox-hearth"].commit, by["fox-hearth"].subject],
      ["2026-11-09", merge, "Merge pull request #7 from fox-hearth/hearth"],
      "the merge onto main, on its town day: not the branch commit's 11-07, and not 11-10 in UTC");
    assert.deepEqual([by["fox-hearth"].author, by["fox-hearth"].line], ["fox-hearth", "A den in the snow."],
      "the author at the merge the row shows, not thief-house from the later PR at HEAD");
    assert.deepEqual([by.linked.problem, by.linked.author], ["not an entry: its hearth.css is not a plain file (the site refuses it and skips the whole entry)", undefined],
      "a linked hearth.css: the site skips the entry, so the plan pays nothing");
    assert.deepEqual([by["lone-wolf"].date, by["lone-wolf"].commit], ["2026-11-12", direct]);
    assert.equal(by.default.author, "postmark");
    // the later commits: typo's fix and fox-hearth's rewrite are named; lone-wolf, never changed, has none
    assert.deepEqual([by.typo.author, by.typo.later], ["lone-wolff", { commit: fix, subject: "typo: fix the author line (#11)", author: "lone-wolf" }]);
    assert.deepEqual(by["fox-hearth"].later, { commit: thief, subject: "a later PR: fox-hearth's author line", author: "thief-house" });
    assert.equal(by["lone-wolf"].later, undefined);
    const rows = planQuestPays({ items: hearthItems(got, { source: HSOURCE }), quest: HQ, terms: HTERMS, houseOf: hHouseOf, isMeep: (h) => h === "fox-meep", lineOf: hLineOf, date: "2026-11-14" });
    assert.deepEqual(rows.filter((r) => r.owed).map((r) => [r.ref, r.handle]), [["hearth:fox-hearth", "alden"], ["hearth:lone-wolf", "wolf"]], "the read feeds the plan");
    const typo = rows.find((r) => r.ref === "hearth:typo");
    assert.deepEqual([typo.owed, typo.why], [false, `unbound: the author "lone-wolff" is no resident on the roll and no household with a resident here · a later commit, ${fix.slice(0, 9)} "typo: fix the author line (#11)", changed the author line to "lone-wolf"; a hand decides`],
      "a misspelt line at the merge stays unpaid, and the row names the PR that fixed it");
    assert.equal(rows.find((r) => r.ref === "hearth:fox-hearth").why, "owed", "a resolved row carries no note, though its line changed later");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const HEARTH_TOWN = (() => {
  const t = process.env.QUEST_MINT_TOWN ?? join(OFFICE_ROOT, "town-clone");
  return existsSync(join(t, "tools", "stamp-mint.mjs")) ? t : null;
})();
const HEARTH_TERMS = HEARTH_TOWN ? (await import(pathToFileURL(join(HEARTH_TOWN, "tools", "stamp-mint.mjs")).href)).QUEST_PAY?.[HQ] ?? null : null;

test("hearth: over the town's own engine, the quest is refused while the town names no opening day",
  { skip: (!HEARTH_TERMS && "the town checkout carries no hearth-entry in QUEST_PAY yet (postmark#4586); set QUEST_MINT_TOWN") || (HEARTH_TERMS.from != null && `the town opened it (from ${HEARTH_TERMS.from}); the open-path test runs instead`) }, async () => {
    const out = [];
    const code = await main(["--town", HEARTH_TOWN, "--quest", HQ, "--date", "2026-11-14"], { facts: { entries: [], households: {} }, log: (s) => out.push(s), err: (s) => out.push(`ERR ${s}`), env: {} });
    assert.equal(code, 1);
    assert.match(out.join("\n"), /ERR quest-pay-plan: hearth-entry is not open on 2026-11-14: the town's QUEST_PAY \(tools\/stamp-mint\.mjs\) names no opening day for it yet\. Nothing written\./);
    assert.doesNotMatch(out.join("\n"), /quest pay plan for/, "no plan printed");
  });

test("hearth: over the town's own engine, once open, the plan prints and its hint carries no --discussion",
  { skip: (!HEARTH_TERMS && "the town checkout carries no hearth-entry in QUEST_PAY yet (postmark#4586); set QUEST_MINT_TOWN") || (HEARTH_TERMS.from == null && "closed until the town names its opening day at ship; the closed-path test runs instead") }, async () => {
    const out = [];
    const code = await main(["--town", HEARTH_TOWN, "--quest", HQ, "--date", HEARTH_TERMS.from], { facts: { entries: [], households: {} }, log: (s) => out.push(s), err: (s) => out.push(`ERR ${s}`), env: {} });
    assert.equal(code, 0, out.join("\n"));
    assert.deepEqual(HEARTH_TERMS.amount, 10);
    assert.match(out.join("\n"), /quest pay plan for hearth-entry — 0 Hearth entr\(ies\) qualify/);
    assert.match(out.join("\n"), /apply exactly this plan with:\n.*--quest hearth-entry --date/);
    assert.match(out.join("\n"), /Read every owed entry, then --apply/);
    assert.doesNotMatch(out.join("\n"), /--discussion/);
  });
