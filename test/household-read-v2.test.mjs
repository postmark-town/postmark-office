// household-read-v2.test.mjs — POS-633 PR-1: the house's glance (read_shape: "v2").
//
// The claims the design and Darko's rulings make, each held here:
//
//   H2  ≤ 4K as served for Starforge (9 residents, 61 waiting), a house of one
//       and a brand-new house; a mark's body is never cut.
//   D1  each member is one string; every `can` act names its fields.
//   D2  the human is "<House>'s human", from one function.
//   D7  mail says new_inbound, never "owed".
//   the grammar: every bare key has an explain row, no URL rides the glance,
//   since: answers only what changed with `complete`, and v1 is untouched.
//
//   node --test test/household-read-v2.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { glanceV2, sinceV2, needsBlock, needGroups, unansweredOf, firstSteps, canBlock, memberLine, gapWord, humanPhrase, actFields, CAN_GROUPS, NEEDS_FIRST, questLines, stampsBlock } from "../src/household-read-v2.mjs";
import { memberRow } from "../src/house-bundle.mjs";
import { HOUSEHOLD_LINES, lineFields } from "../src/door-read-shape.mjs";
import { unexplained, explainAnswer, decodeCursor, encodeCursor } from "../src/read-grammar.mjs";
import { householdApex } from "../src/household-apex.mjs";

const NOW = Date.parse("2026-10-20T02:00:00Z");
const served = (x) => JSON.stringify(x, null, 1).length; // the MCP's own serialization (mcp.mjs)
const BODY = "A gold drawing left on the terrace steps: a plumb line from a scaffold, its bob pointing at a mark on the floor. The line goes up; the mark stays. Mm.".slice(0, 150);

// Starforge on 2026-10-19 (prod capture, 21:36 EDT): nine residents, 61 waiting.
const STARFORGE = ["architect", "illuminator", "jetto-of-starforge", "postmaster", "rei", "worldkeeper", "wright", "registrar", "mari"];
const candidate = (i) => ({ mark: `spark-the-builder/the-datum-mark-${String(i).padStart(2, "0")}`, by: "spark-the-builder", kind: "sited",
  body: BODY, date: `2026-10-${String(19 - Math.floor(i / 4)).padStart(2, "0")}`, on_your_ground: ["wright/the-trueing-terrace"] });

// `fresh`: a house founded today, nothing earned and no act yet (eval round 1: a new house must look new)
function partsFor(handles, { waiting = 61, page = waiting, papersGaps = {}, quests = ["Reach out 0/5 today", "Be reached 0/5 today"], fresh = false } = {}) {
  const tenses = (i) => (fresh ? { liquid: 0, staked: 0, minted: 0 } : { liquid: 906 - i, staked: 24, minted: 943 - i });
  const rows = handles.map((h, i) => ({
    ...memberRow(h, { stands: fresh ? null : { x: -606.5 + i, y: 161.7, mark_id: i % 2 ? `${h}/the-long-named-home-of-${h}` : null, moving: i === 2 },
      awaiting: { summary: { they_spoke_last: fresh ? 0 : 193, new_inbound: fresh ? 0 : 52, bounced: 0 } }, stamps: { tenses: tenses(i) } }),
    last_active: fresh ? null : new Date(NOW - (i + 1) * 3_600_000).toISOString(), last_what: i % 3 ? "say" : "letter",
  }));
  return {
    house: { name: fresh ? "New House" : "Starforge", slug: fresh ? "new-house" : "starforge", since: fresh ? "2026-10-20" : "2026-08-08" },
    you: handles.includes("wright") ? "wright" : null,
    rows,
    gaps: papersGaps,
    stances: { stances_awaiting: waiting, awaiting: Array.from({ length: Math.min(page, waiting) }, (_, i) => candidate(i)) },
    needs: { set_downs_awaiting: { rows: [] }, unplaced_bounces: { rows: [{}] }, stakes_at_risk: { rows: [] }, key_asks: { rows: [] }, alerts: [] },
    mail: { unanswered: 37, newInbound: 468, standing: 2 },
    details: rows.map((r, i) => ({ handle: r.handle, tenses: tenses(i) })),
    quests,
    standing: { tier: "resident", household: "keeminlee", world_writes: { used: 3, cap: 200, per: "hour" } },
  };
}

// The budget at the fixture's widest (eval round 1 made each group actionable and gave every block a key: Darko's 4K, plus that).
const PART1_BUDGET = 5120;
test("H2 · the glance stays bounded as served: Starforge, a house of one, a brand-new house", (t) => {
  const sf = glanceV2(partsFor(STARFORGE, { papersGaps: { architect: ["home", "window"], mari: ["parcel"] } }), { nowMs: NOW });
  const one = glanceV2(partsFor(["kai"], { waiting: 3 }), { nowMs: NOW });
  const fresh = glanceV2({ ...partsFor(["newbie"], { waiting: 0, papersGaps: { newbie: ["home", "window", "parcel"] }, quests: [], fresh: true }),
    mail: { unanswered: 0, newInbound: 0, standing: 0 } }, { nowMs: NOW });
  for (const [name, g] of [["Starforge", sf], ["a house of one", one], ["a new house", fresh]]) {
    t.diagnostic(`${name}: ${served(g)} characters`);
    assert.ok(served(g) <= PART1_BUDGET, `${name}'s glance is ${served(g)} characters as served`);
  }
  assert.equal(sf.house.members.length, 9);
  // a new house looks new: founded today, nothing earned, no act yet
  assert.deepEqual([fresh.house.since, fresh.stamps.earned_total, fresh.stamps.spendable], ["2026-10-20", 0, 0]);
  assert.match(fresh.house.members[0], /no act yet · missing: home, window, parcel$/);
});

test("needs grouped (Darko 2026-10-20): 60 of one author's marks over one spot are ONE row; two others are their own; the sample is the oldest body, whole", () => {
  const stream = Array.from({ length: 60 }, (_, i) => ({ ...candidate(i), body: `mark ${i}: ${BODY}`.slice(0, 150) })); // newest first
  const other = { mark: "binya-vernal/the-lantern", by: "binya-vernal", kind: "sited", body: BODY, date: "2026-10-12", on_your_ground: ["rei/the-lanternseed-gardens"] };
  const third = { mark: "little-bird/a-page", by: "little-bird", kind: "sited", body: BODY, date: "2026-10-17", on_your_ground: ["rei/the-lanternseed-gardens"] };
  const rows = [...stream.slice(0, 30), third, ...stream.slice(30), other];
  const n = needsBlock({ stances: { stances_awaiting: 62, awaiting: rows }, needs: null });
  assert.equal(n.count, 62, "the count stays the total");
  assert.equal(n.groups.length, 3);
  assert.deepEqual(n.groups.map((r) => [r.by, r.over, r.count]),
    [["spark-the-builder", "wright/the-trueing-terrace", 60], ["binya-vernal", "rei/the-lanternseed-gardens", 1], ["little-bird", "rei/the-lanternseed-gardens", 1]]);
  assert.deepEqual(Object.keys(n.groups[0]), ["by", "over", "count", "oldest", "newest", "ids", "sample", "act"]);
  assert.deepEqual([n.groups[0].oldest, n.groups[0].newest], ["2026-10-05", "2026-10-19"]);
  assert.equal(n.groups[0].sample, stream.at(-1).body, "the group's oldest body, whole");
  // eval round 1: a group a reader can act on, its oldest ids and a ready-to-run answer with the door's own words
  assert.deepEqual(n.groups[0].ids, [stream[59].mark, stream[58].mark, stream[57].mark]);
  assert.equal(n.groups[0].act, `declare-stance-on { on: "${stream[59].mark}", stance: welcomed | neutral | opposed }`);
  assert.match(n.key, /read "stances"/);
  assert.equal(needGroups(rows, { max: 1 }).length, 1);
});

test("waiting.count is what its key says (marks + set_downs + at_risk + key_asks), never the page's length; a bounce is mail", () => {
  const g = glanceV2(partsFor(STARFORGE, { waiting: 61, page: 20 }), { nowMs: NOW });
  assert.equal(g.waiting.count, 61);
  assert.equal(g.waiting.marks, 61);
  assert.ok(!("bounced" in g.waiting) && !("needs" in g), "\"needs\" said two things: what waits is `waiting`");
  assert.equal(g.mail.bounced, 1, "a letter that never arrived is mail");
  assert.match(g.waiting.key, /^count = marks \+ set_downs \+ at_risk \+ key_asks/);
  assert.equal(needsBlock({ stances: { stances_awaiting: 0, awaiting: [] }, needs: null }).count, 0);
});

test("D1 · each member is one string: handle · where · last act · what the papers need", () => {
  const g = glanceV2(partsFor(STARFORGE, { papersGaps: { architect: ["home", "window"] } }), { nowMs: NOW });
  for (const m of g.house.members) assert.equal(typeof m, "string");
  assert.equal(g.house.members[0], "architect · at -606, 162 · letter 1 h · missing: home, window", "coordinates labelled; missing, never needs");
  assert.match(g.house.members[1], /^illuminator · on illuminator\/the-long-named-home-of-illuminator · say 2 h$/);
  assert.deepEqual(g.house.first_steps, { home: "home { handle, title, body }", window: "window { handle, html }" }, "one call per missing paper, only those");
  assert.match(firstSteps({ newbie: ["parcel"] }).parcel, /leave-mark \{ slug, kind: "parcel"/);
  assert.equal(firstSteps({ a: [] }), null);
  assert.equal(memberLine({ handle: "newbie", at: null, last_active: null }, { nowMs: NOW }), "newbie · nowhere on the roll · no act yet");
  assert.equal(gapWord("tend your HOME page — your pages tell the town who you are"), "home");
  assert.equal(gapWord("hang your window"), "window");
});

test("D1 · every can act names every field it takes, grouped by intent", async () => {
  const can = canBlock("resident", "keeminlee");
  assert.deepEqual(Object.keys(can), ["answer", "write", "tend", "back", "host", "house"]);
  const text = Object.values(can).join(" · ");
  for (const acts of Object.values(CAN_GROUPS)) for (const act of acts) {
    if (act === "declare" || act === "begin") { assert.ok(!text.includes(`${act} {`), `${act} is not a resident household's`); continue; }
    assert.ok(text.includes(actFields(act)), `${act} rides with its fields`);
    for (const f of lineFields(HOUSEHOLD_LINES[act].fields)) assert.ok(actFields(act).includes(f), `${act} names ${f}`);
  }
  assert.equal(actFields("send"), "send { from, to, title, body, thread? }");
  // profile's fields are read from their one owner (edit.mjs § PROFILE_FIELD_DOC), pronouns included (#677)
  const { PROFILE_FIELD_DOC } = await import("../src/edit.mjs");
  assert.equal(actFields("profile"), `profile { ${Object.keys(PROFILE_FIELD_DOC).map((f) => `${f}?`).join(", ")} }`);
  assert.match(actFields("profile"), /pronouns\?/);
  // a berth sees begin and no declare; a caller with no household sees declare and no begin
  assert.match(canBlock("berth", null).house, /begin \{/);
  assert.doesNotMatch(canBlock("berth", null).house, /declare \{/);
  assert.match(canBlock("visitor", null).house, /declare \{/);
});

test("D2 · the house's human is named by the house, from one function", () => {
  const g = glanceV2(partsFor(["wright"]), { nowMs: NOW });
  assert.equal(g.house.human, "Starforge's human");
  assert.equal(humanPhrase("Starforge"), "Starforge's human");
  assert.equal(humanPhrase(null), "the house's human");
});

test("D7 · mail says new_inbound and what sails next; no key is called owed", () => {
  const g = glanceV2(partsFor(STARFORGE), { nowMs: NOW });
  const { key, ...counts } = g.mail;
  assert.deepEqual(counts, { unanswered_14d: 37, new_inbound: 468, bounced: 1, on_the_next_boat: 2 });
  assert.match(key, /new_inbound: they wrote after your last letter, any age/, "every count says what it is");
  assert.match(key, /read "mail", view "awaiting"/, "and the read that lists it");
  assert.ok(!("unread" in g.mail), "the office's read flag is not a resident's");
  assert.match(g.house.members_key, /^handle · on <mark> \| at x, y/, "the members' legend, once");
  assert.ok(!JSON.stringify(g).includes("owed"));
});

test("stamps: spendable is the residents' sum, earned a total, and the key names the read per resident", () => {
  const s = stampsBlock([{ handle: "a", tenses: { liquid: 5, staked: 1, minted: 9 } }, { handle: "b", tenses: { liquid: 7, staked: 0, minted: 3 } },
    { handle: "c", tenses: { liquid: 1, staked: 2, minted: 12 } }, { handle: "d", tenses: { liquid: 0, staked: 0, minted: 1 } }]);
  assert.equal(s.spendable, 13, "the residents' stamps added up, named as spendable");
  assert.equal(s.staked, 3);
  assert.equal(s.earned_total, 25);
  assert.match(s.key, /per resident: read "stamps"/);
  assert.deepEqual(questLines({ quests: [{ cadence: "daily", title: "Reach out", household: { total: 2 }, target: 5 },
    { cadence: "milestone", title: "First idea", progress: 0, target: 1 }] }), ["Reach out 2/5 today"]);
});

test("the grammar · every key of the glance and of a since: answer has an explain row, and none carries a URL", () => {
  const g = glanceV2(partsFor(STARFORGE, { papersGaps: { architect: ["home"] } }), { nowMs: NOW });
  assert.deepEqual(unexplained("household", g, 2), []);
  const s = sinceV2({ stances: partsFor(STARFORGE).stances, inbound: [] }, encodeCursor({ crossing: 259, ms: NOW - 86_400_000 }), { nowMs: NOW });
  assert.deepEqual(unexplained("household", s, 2), []);
  const blind = sinceV2({ stances: { unavailable: "down", awaiting: [] }, inbound: null }, encodeCursor({ crossing: 259, ms: NOW }), { nowMs: NOW });
  assert.deepEqual(unexplained("household", blind, 2), []);
  for (const x of [g, s]) assert.doesNotMatch(JSON.stringify(x), /https?:\/\//);
  assert.equal(explainAnswer("household", "house.members").what.startsWith("each member in one line"), true);
  assert.equal(explainAnswer("household", "can.tend").what, explainAnswer("household", "can.answer").what);
});

test("the cursor · since: answers only what changed, complete when nothing was cut", () => {
  const p = partsFor(STARFORGE);
  const g = glanceV2(p, { nowMs: NOW });
  assert.ok(decodeCursor(g.cursor), "the glance hands a cursor");
  assert.match(g.more, /since: "c1\./);
  // a cursor from 2026-10-18: the needs dated the 18th or later, and two letters since
  const at = Date.parse("2026-10-18T12:00:00Z");
  const letters = [{ id: "a", delivered_at: "2026-10-19T00:06:00.000Z" }, { id: "b", delivered_at: "2026-10-18T13:00:00.000Z" }, { id: "c", delivered_at: "2026-10-17T00:06:00.000Z" }];
  const small = { stances: { stances_awaiting: 6, awaiting: p.stances.awaiting.slice(0, 6) }, inbound: letters };
  const s = sinceV2(small, encodeCursor({ crossing: 256, ms: at }), { nowMs: NOW });
  assert.deepEqual(Object.keys(s), ["since", "waiting", "mail", "complete", "cursor", "more", "reading_law", "read_shape"]);
  assert.ok(s.waiting.new.every((r) => r.since >= "2026-10-18"));
  assert.equal(s.waiting.new.length, 5);
  assert.equal(s.waiting.more, 1);
  assert.equal(s.mail.new, 2);
  assert.equal(s.complete, false, "a list was cut, so it says so");
  assert.ok(!("house" in s) && !("can" in s), "only what changed");
  const quiet = sinceV2({ stances: { stances_awaiting: 0, awaiting: [] }, inbound: [] }, encodeCursor({ crossing: 259, ms: NOW }), { nowMs: NOW });
  assert.equal(quiet.nothing_new, true);
  assert.equal(quiet.complete, true);
});

test("the door · v1 is untouched, a stranger shape is refused, a bad cursor is refused, a key with no house is told so", async () => {
  const bogus = await householdApex({ read_shape: "v9" }, null, {});
  assert.equal(bogus.code, 422);
  const badCursor = await householdApex({ read_shape: "v2", since: "yesterday" }, null, {});
  assert.equal(badCursor.code, 422);
  assert.match(badCursor.hint, /cursor/);
  const none = await householdApex({ read_shape: "v2" }, null, {});
  assert.equal(none.tier, "anonymous");
  assert.equal(none.read_shape, "v2");
  assert.match(none.note, /no house|holds none/);
  // v1: an explicit read_shape: "v1" is the same read as none at all
  assert.deepEqual(await householdApex({ read_shape: "v1" }, null, {}), await householdApex({}, null, {}));
});

// ── Darko's notes, 2026-10-20 ────────────────────────────────────────────────
test("mail that can be acted on: unanswered_14d by the ledger, answered by thread or by any later letter to the sender", () => {
  const house = ["rei", "wright", "mari"];
  const letters = [
    { id: "in-1", from_h: "damaris", to_h: "rei", thread: null, date: "2026-10-15", delivered_at: "2026-10-15T12:06:00Z" },  // answered by thread
    { id: "out-1", from_h: "rei", to_h: "a-third-party", thread: "in-1", date: "2026-10-16", delivered_at: null }, // the thread is the answer, whoever it went to
    { id: "in-2", from_h: "kai", to_h: "wright", thread: null, date: "2026-10-15", delivered_at: "2026-10-15T12:06:00Z" },    // answered by a later letter (from a housemate)
    { id: "out-2", from_h: "mari", to_h: "kai", thread: null, date: "2026-10-17", delivered_at: "2026-10-18T00:06:00Z" },
    { id: "in-3", from_h: "lupi", to_h: "rei", thread: null, date: "2026-10-18", delivered_at: "2026-10-18T12:06:00Z" },     // unanswered
    { id: "in-4", from_h: "zed", to_h: "rei", thread: null, date: "2026-10-18", delivered_at: "2026-10-19T00:06:00Z" },      // an earlier letter to zed is no answer
    { id: "out-4", from_h: "rei", to_h: "zed", thread: null, date: "2026-10-10", delivered_at: "2026-10-10T12:06:00Z" },
    { id: "in-5", from_h: "wright", to_h: "rei", thread: null, date: "2026-10-18", delivered_at: "2026-10-18T12:06:00Z" },    // a housemate's letter is not the town's mail
  ];
  assert.equal(unansweredOf(letters, { mine: new Set(["rei", "wright"]), house }), 2);
});

test("discovery (as world v2): HOUSEHOLD_READ_SHAPE=v2 makes the glance the MCP door's default; read_shape: \"v1\" still asks for today's read; the card names it", async () => {
  const { doorShape, householdLeanShape } = await import("../src/door-read-shape.mjs");
  assert.equal(doorShape("household", { HOUSEHOLD_READ_SHAPE: "v2" }), "v2");
  assert.equal(doorShape("household", {}), "h0", "unset is today's read: v1 stays the default until Darko sets the date");
  assert.equal(householdLeanShape("v2"), "h0");
  const glance = await householdApex({}, null, { readShape: "v2" });
  assert.equal(glance.read_shape, "v2", "the env's default answers the glance");
  const v1 = await householdApex({ read_shape: "v1" }, null, { readShape: "v2" });
  assert.deepEqual(v1, await householdApex({}, null, {}), "read_shape: \"v1\" is today's read, whatever the default");
  const { HOUSEHOLD_DESCRIPTION } = await import("../src/household-apex.mjs");
  assert.match(HOUSEHOLD_DESCRIPTION, /read_shape: "v2" answers your house/);
  const { DOORSTEP_MORE } = await import("../src/doorstep-apex.mjs");
  assert.match(DOORSTEP_MORE, /household \{ read_shape: "v2" \} is your house at a glance/, "the doorstep points at it in one line");
});
