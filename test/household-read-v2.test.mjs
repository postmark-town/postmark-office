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
import { glanceV2, sinceV2, needsBlock, canBlock, memberLine, gapWord, humanPhrase, actFields, CAN_GROUPS, NEEDS_FIRST, questLines, stampsBlock } from "../src/household-read-v2.mjs";
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

function partsFor(handles, { waiting = 61, page = waiting, papersGaps = {}, quests = ["Reach out 0/5 today", "Be reached 0/5 today"] } = {}) {
  const rows = handles.map((h, i) => ({
    ...memberRow(h, { stands: { x: -606.5 + i, y: 161.7, mark_id: i % 2 ? `${h}/the-long-named-home-of-${h}` : null, moving: i === 2 },
      awaiting: { summary: { they_spoke_last: 193, new_inbound: 52, bounced: 0 } }, stamps: { tenses: { liquid: 906 - i, staked: 24, minted: 943 - i } } }),
    last_active: new Date(NOW - (i + 1) * 3_600_000).toISOString(), last_what: i % 3 ? "say" : "letter",
  }));
  return {
    house: { name: "Starforge", slug: "starforge", since: "2026-08-08" },
    you: handles.includes("wright") ? "wright" : null,
    rows,
    gaps: papersGaps,
    stances: { stances_awaiting: waiting, awaiting: Array.from({ length: Math.min(page, waiting) }, (_, i) => candidate(i)) },
    needs: { set_downs_awaiting: { rows: [] }, unplaced_bounces: { rows: [{}] }, stakes_at_risk: { rows: [] }, key_asks: { rows: [] }, alerts: [] },
    mail: { unread: 4013, newInbound: 468, standing: 2 },
    details: rows.map((r, i) => ({ handle: r.handle, tenses: { liquid: 906 - i, staked: 24, minted: 943 - i } })),
    quests,
    standing: { tier: "resident", household: "keeminlee", world_writes: { used: 3, cap: 200, per: "hour" } },
  };
}

test("H2 · ≤ 4K as served: Starforge, a house of one, a brand-new house", () => {
  const sf = glanceV2(partsFor(STARFORGE, { papersGaps: { architect: ["home", "window"], mari: ["parcel"] } }), { nowMs: NOW });
  const one = glanceV2(partsFor(["kai"], { waiting: 3 }), { nowMs: NOW });
  const fresh = glanceV2({ ...partsFor(["newbie"], { waiting: 0, papersGaps: { newbie: ["home", "window", "parcel"] }, quests: [] }),
    mail: { unread: 0, newInbound: 0, standing: 0 } }, { nowMs: NOW });
  for (const [name, g] of [["Starforge", sf], ["a house of one", one], ["a new house", fresh]])
    assert.ok(served(g) <= 4096, `${name}'s glance is ${served(g)} characters as served`);
  assert.equal(sf.house.members.length, 9);
});

test("H2 · a mark's body is never cut, and needs.first is the oldest three, oldest first", () => {
  const p = partsFor(STARFORGE);
  const g = glanceV2(p, { nowMs: NOW });
  assert.equal(g.needs.first.length, NEEDS_FIRST);
  const oldest = p.stances.awaiting.slice(-NEEDS_FIRST).reverse();
  assert.deepEqual(g.needs.first.map((r) => r.mark), oldest.map((c) => c.mark));
  for (const r of g.needs.first) assert.equal(r.body, BODY, "whole");
  assert.deepEqual(Object.keys(g.needs.first[0]), ["mark", "by", "kind", "body", "over", "since"]);
});

test("needs.count is everything waiting (61 stances and a bounce), never the page's length", () => {
  const g = glanceV2(partsFor(STARFORGE, { waiting: 61, page: 20 }), { nowMs: NOW });
  assert.equal(g.needs.count, 62);
  assert.equal(g.needs.bounced, 1);
  assert.equal(needsBlock({ stances: { stances_awaiting: 0, awaiting: [] }, needs: null }).count, 0);
});

test("D1 · each member is one string: handle · where · last act · what the papers need", () => {
  const g = glanceV2(partsFor(STARFORGE, { papersGaps: { architect: ["home", "window"] } }), { nowMs: NOW });
  for (const m of g.house.members) assert.equal(typeof m, "string");
  assert.equal(g.house.members[0], "architect · -606, 162 · letter 1 h · needs home, window");
  assert.match(g.house.members[1], /^illuminator · illuminator\/the-long-named-home-of-illuminator · say 2 h$/);
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
  assert.deepEqual(g.mail, { unread: 4013, new_inbound: 468, on_the_next_boat: 2 });
  assert.ok(!JSON.stringify(g).includes("owed"));
});

test("stamps: the pool is the residents' sum, labelled pending POS-326; earned names three and counts the rest", () => {
  const s = stampsBlock([{ handle: "a", tenses: { liquid: 5, staked: 1, minted: 9 } }, { handle: "b", tenses: { liquid: 7, staked: 0, minted: 3 } },
    { handle: "c", tenses: { liquid: 1, staked: 2, minted: 12 } }, { handle: "d", tenses: { liquid: 0, staked: 0, minted: 1 } }]);
  assert.equal(s.pool, 13, "the residents' stamps added up; no tracker id reaches a resident");
  assert.equal(s.staked, 3);
  assert.equal(s.earned, "c 12 · a 9 · b 3 · 1 more");
  assert.deepEqual(questLines({ quests: [{ cadence: "daily", title: "Reach out", household: { total: 2 }, target: 5 },
    { cadence: "milestone", title: "First idea", progress: 0, target: 1 }] }), ["Reach out 2/5 today"]);
});

test("the grammar · every key of the glance and of a since: answer has an explain row, and none carries a URL", () => {
  const g = glanceV2(partsFor(STARFORGE, { papersGaps: { architect: ["home"] } }), { nowMs: NOW });
  assert.deepEqual(unexplained("household", g, 2), []);
  const s = sinceV2({ stances: partsFor(STARFORGE).stances, unreadRows: [] }, encodeCursor({ crossing: 259, ms: NOW - 86_400_000 }), { nowMs: NOW });
  assert.deepEqual(unexplained("household", s, 2), []);
  const blind = sinceV2({ stances: { unavailable: "down", awaiting: [] }, unreadRows: null }, encodeCursor({ crossing: 259, ms: NOW }), { nowMs: NOW });
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
  const small = { stances: { stances_awaiting: 6, awaiting: p.stances.awaiting.slice(0, 6) }, unreadRows: letters };
  const s = sinceV2(small, encodeCursor({ crossing: 256, ms: at }), { nowMs: NOW });
  assert.deepEqual(Object.keys(s), ["since", "needs", "mail", "complete", "cursor", "more", "reading_law", "read_shape"]);
  assert.ok(s.needs.new.every((r) => r.since >= "2026-10-18"));
  assert.equal(s.needs.new.length, 5);
  assert.equal(s.needs.more, 1);
  assert.equal(s.mail.new, 2);
  assert.equal(s.complete, false, "a list was cut, so it says so");
  assert.ok(!("house" in s) && !("can" in s), "only what changed");
  const quiet = sinceV2({ stances: { stances_awaiting: 0, awaiting: [] }, unreadRows: [] }, encodeCursor({ crossing: 259, ms: NOW }), { nowMs: NOW });
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
