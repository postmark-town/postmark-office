// quest-pay-plan.test.mjs — the reviewed quest pass (POS-632 PR-Q2).
//
// The plan is pure over its facts, so it is held on fixtures: which discussions
// qualify, whom each pays, the rows' reasons (owed, already paid, rejected by a
// hand, unbound, a household's second discussion, a meep), the printed plan
// read back, and the digest moving with a rejection. The town's engine is read
// from a town checkout carrying the quest grammar (postmark#3819) when one is
// named by QUEST_MINT_TOWN; the pinned town-clone carries it once the pin moves.
//
// Run: node --test test/quest-pay-plan.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { OFFICE_ROOT } from "./fixture-paths.mjs";

delete process.env.OFFICE_KEEP;
delete process.env.INVOCATION_ID;
const { planQuestPays, renderPlan, parseQuestPlan, planDiffers, planDigest, qualifies, recipientOf, housesFrom, townEngine, main, QUEST_SOURCES } =
  await import("../tools/quest-pay-plan.mjs");

const Q = "read-v2-feedback";
const TERMS = { amount: 5, once_per: "household", from: "2026-10-15", until: null };
const SOURCE = QUEST_SOURCES[Q];
const D = (number, login, id, title = "Read v2 feedback: the view is lovely", at = "2026-10-16T10:00:00Z", body = "I like the view.\nNot the who.") =>
  ({ number, title, url: `https://github.com/postmark-town/postmark-blueprints/discussions/${number}`, createdAt: at, body, author: { login, databaseId: id } });
const BINDINGS = [
  { handle: "alice", household: "keeminlee", gh_login: "keeminlee", gh_id: "1" },
  { handle: "bob", household: "keeminlee", gh_login: "keeminlee", gh_id: "1" },
  { handle: "carol", household: "carol", gh_login: "carolgh", gh_id: "2" },
  { handle: "ferry", household: "ferryhouse", gh_login: "ferrygh", gh_id: "3" },
];
const houseOf = housesFrom(BINDINGS, { keyOf: (h) => ({ alice: "gh:1", bob: "gh:1", carol: "gh:2", ferry: "gh:3" })[h], hasRoom: () => true, date: "2026-10-17" });
const lineOf = ({ date, handle, quest, household }) => `- ${date} · MINT → ${handle} · 5 · for: quest:${quest}/${household} · by: the-town`;
const plan = (over = {}) => planQuestPays({ discussions: [D(40, "keeminlee", 1), D(41, "carolgh", 2), D(42, "keeminlee", 1, "Read v2 feedback: more"), D(43, "stranger", 9),
  D(44, "ferrygh", 3), D(45, "carolgh", 2, "Something else"), D(46, "carolgh", 2, "Read v2 feedback: early", "2026-10-14T10:00:00Z")],
  quest: Q, terms: TERMS, source: SOURCE, houseOf, isMeep: (h) => h === "ferry", paid: new Map(), lineOf, date: "2026-10-17", ...over });

test("which discussions qualify: the title's prefix, inside the quest's window", () => {
  assert.equal(qualifies(D(1, "a", 1), { source: SOURCE, terms: TERMS }), true);
  assert.equal(qualifies(D(1, "a", 1, "Something else"), { source: SOURCE, terms: TERMS }), false);
  assert.equal(qualifies(D(1, "a", 1, undefined, "2026-10-14T23:00:00Z"), { source: SOURCE, terms: TERMS }), false, "before the quest opens");
});

test("whom a discussion pays: a resident of the author's house it names, else the house's first", () => {
  const house = { household: "gh:1", handles: ["alice", "bob"] };
  assert.equal(recipientOf({ body: "thanks — @bob" }, house), "bob");
  assert.equal(recipientOf({ body: "from @carol" }, house), "alice", "a name outside the house is not the house's resident");
  assert.equal(recipientOf({ body: "" }, house), "alice");
});

test("the rows: owed once per household, a housemate's second discussion, an unbound author, a meep, out-of-scope discussions not listed", () => {
  const rows = plan();
  const by = Object.fromEntries(rows.map((r) => [r.number, r]));
  assert.deepEqual(rows.map((r) => r.number), [40, 41, 42, 43, 44], "only qualifying discussions are rows");
  assert.equal(by[40].why, "owed"); assert.equal(by[40].handle, "alice"); assert.equal(by[40].household, "gh:1");
  assert.equal(by[41].why, "owed"); assert.equal(by[41].household, "gh:2");
  assert.match(by[42].why, /duplicate: the household's discussion #40 is the one paid/);
  assert.match(by[43].why, /unbound: stranger binds no resident here/);
  assert.match(by[44].why, /meep/);
  assert.equal(rows.filter((r) => r.owed).reduce((s, r) => s + r.n, 0), 10);
});

test("already paid and a hand's rejection pay nothing, and a rejection moves the digest", () => {
  const before = plan();
  const rows = plan({ paid: new Map([["gh:2", { handle: "carol", date: "2026-10-16" }]]), rejected: new Set([40]) });
  const by = Object.fromEntries(rows.map((r) => [r.number, r]));
  assert.match(by[40].why, /rejected: a hand read it/);
  assert.match(by[41].why, /already paid: carol on 2026-10-16/);
  assert.match(by[42].why, /^owed$/, "with #40 rejected, the household's next discussion is the one that pays");
  assert.notEqual(planDigest(rows), planDigest(before));
});

test("the printed plan reads back to the plan, and a changed row is caught", () => {
  const rows = plan();
  const text = renderPlan(rows, { date: "2026-10-17", quest: Q });
  assert.match(text, /needs-review \(Q4\)/);
  assert.match(text, /discussions\/40/, "each owed row carries its link, to read before the apply");
  const parsed = parseQuestPlan(text);
  assert.equal(parsed.owed.length, 2);
  assert.equal(planDiffers(parsed, rows, "2026-10-17"), null);
  assert.match(planDiffers(parsed, rows, "2026-10-18"), /the lines' date/);
  const forged = text.replace("#41 · carol · gh:2 · 5 · owed", "#41 · carol · gh:2 · 50 · owed");
  assert.throws(() => parseQuestPlan(forged), /stamps owed and its rows add to/);
});

const TOWN = process.env.QUEST_MINT_TOWN ?? join(OFFICE_ROOT, "town-clone");
const HAS_GRAMMAR = existsSync(join(TOWN, "tools", "stamp-mint.mjs"))
  && (await import(pathToFileURL(join(TOWN, "tools", "stamp-mint.mjs")).href)).QUEST_PAY;

test("the plan over the town's own engine: its QUEST_PAY terms and line builder", { skip: !HAS_GRAMMAR && "the town checkout carries no quest grammar yet (postmark#3819); set QUEST_MINT_TOWN" }, async () => {
  const engine = await townEngine(TOWN, Q);
  assert.deepEqual(engine.terms, TERMS);
  const out = [];
  const code = await main(["--town", TOWN, "--quest", Q, "--date", "2026-10-17"], {
    facts: { discussions: [D(40, "keeminlee", 1)], bindings: [{ handle: "wright", household: "keeminlee", gh_login: "keeminlee", gh_id: "1" }] },
    log: (s) => out.push(s), err: (s) => out.push(`ERR ${s}`), env: {},
  });
  assert.equal(code, 0, out.join("\n"));
  assert.match(out.join("\n"), /quest pay plan for read-v2-feedback/);
  assert.match(out.join("\n"), /apply exactly this plan with:/);
});
