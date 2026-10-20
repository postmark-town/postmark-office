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
import { glanceV2, sinceV2, needsBlock, canBlock, memberLine, gapWord, humanPhrase, actFields, CAN_GROUPS, NEEDS_FIRST, questLines, stampsBlock,
  closerRows, mintsByLetter, wentRows, happenedRow, happenedLine, closerGlance, dayBefore, CLOSER_SHOWN } from "../src/household-read-v2.mjs";
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

test("D1 · every can act names every field it takes, grouped by intent", () => {
  const can = canBlock("resident", "keeminlee");
  assert.deepEqual(Object.keys(can), ["answer", "write", "tend", "back", "host", "house"]);
  const text = Object.values(can).join(" · ");
  for (const acts of Object.values(CAN_GROUPS)) for (const act of acts) {
    if (act === "declare" || act === "begin") { assert.ok(!text.includes(`${act} {`), `${act} is not a resident household's`); continue; }
    assert.ok(text.includes(actFields(act)), `${act} rides with its fields`);
    for (const f of lineFields(HOUSEHOLD_LINES[act].fields)) assert.ok(actFields(act).includes(f), `${act} names ${f}`);
  }
  assert.equal(actFields("send"), "send { from, to, title, body, thread? }");
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
  assert.deepEqual(s.pool, { sum: 13, pending: "POS-326" });
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

// ── part 2: closer, went, happened ───────────────────────────────────────────

const HOUSE9 = new Set(STARFORGE);

test("closer · pairs with everyone outside the house, a multi-recipient letter counting for each party, never a housemate", () => {
  const letters = [
    { id: "l1", from_h: "wright", to_h: "damaris", date: "2026-10-18", delivered_at: "2026-10-19T00:06:00.000Z" },
    { id: "l2", from_h: "damaris", to_h: "rei", date: "2026-10-19", delivered_at: "2026-10-19T12:06:00.000Z" },
    { id: "l3", from_h: "wright", to_h: "rei", date: "2026-10-19", delivered_at: null }, // housemates: not closer
    { id: "l4", from_h: "isabella-cognita", to_h: "kai", date: "2026-10-19", multi: JSON.stringify({ toList: ["kai", "mari"] }) },
    { id: "l5", from_h: "zed", to_h: "kai", date: "2026-10-19" }, // nobody of ours
  ];
  const houseOf = (h) => ({ damaris: "Mayflower", "isabella-cognita": "Casa Cognita", kai: "Kai's House" })[h] ?? null;
  const rows = closerRows(letters, { mine: HOUSE9, houseOf, mints: new Map([["l1", 1], ["l2", 1], ["l4", 1]]), milestones: new Map([["damaris", [{ by: "wright", rung: 1 }]]]) });
  assert.deepEqual(rows.map((r) => [r.with, r.of, r.letters]), [["damaris", "Mayflower", 2], ["isabella-cognita", "Casa Cognita", 1], ["kai", "Kai's House", 1]]);
  assert.deepEqual(Object.keys(rows[0]), ["with", "of", "letters", "milestones", "stamps_between", "last_at"]);
  assert.equal(rows[0].stamps_between, 2);
  assert.equal(rows[0].last_at, "2026-10-19T12:06:00.000Z");
  assert.ok(!rows.some((r) => "says" in r), "D6: no says");
  assert.deepEqual(closerGlance(rows)[0], { with: "damaris", of: "Mayflower", letters: 2 });
  assert.equal(closerGlance([...rows, ...rows]).length, CLOSER_SHOWN);
  assert.equal(dayBefore(Date.parse("2026-10-20T02:00:00Z"), 14), "2026-10-06");
});

test("went and mints · read by the ledger's own grammar: a giver of ours is went, a MINT to ours is a mint", () => {
  const lines = [
    { canonical: "- 2026-10-19 · rei → stake:world-mark/damaris/the-spring · 1 · via: api", written_at: "2026-10-19T20:00:00Z" },
    { canonical: "- 2026-10-15 · wright → BURN · 10 · for: correction:abc · by: wright", written_at: "2026-10-15T09:00:00Z" },
    { canonical: "- 2026-10-19 · MINT → mari · 1 · for: augie-2026-10-19-to-mari-the-view (received)", written_at: "2026-10-19T20:00:00Z" },
    { canonical: "- 2026-10-19 · stake:pot/the-lamp → rei · 3 · for: unstake · via: web", written_at: "2026-10-19T20:00:00Z" },
    { canonical: "- 2026-10-19 · damaris → stake:world-mark/x/y · 1 · via: api", written_at: "2026-10-19T20:00:00Z" },
  ];
  assert.deepEqual(wentRows(lines, HOUSE9), [
    { at: "2026-10-19T20:00:00.000Z", date: "2026-10-19", from: "rei", to: "stake:world-mark/damaris/the-spring", stamps: 1, via: "api" },
    { at: "2026-10-15T09:00:00.000Z", date: "2026-10-15", from: "wright", to: "BURN", stamps: 10, for: "correction:abc" },
  ]);
  assert.deepEqual([...mintsByLetter(lines, HOUSE9)], [["augie-2026-10-19-to-mari-the-view", 1]]);
});

test("happened · D4: hand and for from what the record knows; a route never recorded is absent, never the word unknown", () => {
  const own = happenedRow({ at: "2026-10-19T20:00:00Z", actor: "rei", action: "say", object: null, at_anchor: "the-town/quay" }, { houseName: "Starforge" });
  assert.deepEqual(own, { at: "2026-10-19T20:00:00.000Z", hand: "rei", for: "rei", verb: "say", object: null, place: "the-town/quay", by: "rei" });
  const human = happenedRow({ at: "2026-10-19T20:00:00Z", actor: "human-of-starforge", action: "say" }, { houseName: "Starforge" });
  assert.deepEqual([human.hand, human.for, human.by], ["human", null, "Starforge's human"]);
  const seated = happenedRow({ at: "2026-10-19T20:00:00Z", actor: "rei", action: "walk", object: "the-town/quay", as_human: "human-of-starforge" }, { houseName: "Starforge" });
  assert.deepEqual([seated.hand, seated.for, seated.by], ["human", "rei", "Starforge's human for rei"]);
  for (const r of [own, human, seated]) {
    assert.ok(!("route" in r), "no route was recorded");
    assert.ok(!JSON.stringify(r).includes("unknown"));
  }
  assert.equal(happenedRow({ actor: "rei", action: "say", route: "mcp" }).route, "mcp", "a recorded route rides");
  assert.equal(happenedLine(seated, { nowMs: Date.parse("2026-10-19T22:00:00Z") }), "walk the-town/quay · by Starforge's human for rei · 2 h");
});

test("H2 with every block · Starforge's glance with closer and happened stays ≤ 4K, every key explained", () => {
  const p = partsFor(STARFORGE, { papersGaps: { architect: ["home", "window"], mari: ["parcel"] } });
  const closer = Array.from({ length: 12 }, (_, i) => ({ with: `isabella-cognita-${i}`, of: "Casa Cognita", letters: 30 - i, last_at: "2026-10-19" }));
  const happened = Array.from({ length: 9 }, (_, i) => happenedRow({ at: new Date(NOW - i * 3_600_000).toISOString(), actor: i % 3 ? "jetto-of-starforge" : "human-of-starforge",
    action: "leave-mark", object: `jetto-of-starforge/a-mark-with-a-long-slug-${i}` }, { houseName: "Starforge" }));
  const went = [{ at: new Date(NOW - 3_600_000).toISOString() }, { at: new Date(NOW - 7_200_000).toISOString() }];
  const g = glanceV2({ ...p, closer, happened, went }, { nowMs: NOW });
  assert.ok(served(g) <= 4096, `Starforge's whole glance is ${served(g)} characters as served`);
  assert.equal(g.closer.length, 3);
  assert.equal(g.happened.length, 5);
  assert.equal(g.stamps.went, 2);
  assert.deepEqual(unexplained("household", g, 2), []);
  const s = sinceV2({ stances: { stances_awaiting: 0, awaiting: [] }, unreadRows: [], happened, went }, encodeCursor({ crossing: 259, ms: NOW - 5_400_000, hw: "100" }), { nowMs: NOW });
  assert.equal(s.happened.length, 5);
  assert.equal(s.happened_more, 4);
  assert.equal(s.stamps.went, 1, "only what went after the cursor");
  assert.deepEqual(unexplained("household", s, 2), []);
});

// ── part 4: the recorded triple, said as the reads say it ────────────────────
test("H4 phrases · a recorded hand and for win over the actor; a recorded route rides; one phrase function says them", async () => {
  const { byPhrase } = await import("../src/household-read-v2.mjs");
  const site = happenedRow({ at: "2026-10-20T08:00:00Z", actor: "rei", action: "home", hand: "human", for_handle: "rei", route: "site" }, { houseName: "Starforge" });
  assert.deepEqual([site.hand, site.for, site.route, site.by], ["human", "rei", "site", "Starforge's human for rei"]);
  const own = happenedRow({ at: "2026-10-20T08:00:00Z", actor: "rei", action: "say", hand: "rei", for_handle: "rei", route: "mcp" }, { houseName: "Starforge" });
  assert.deepEqual([own.hand, own.for, own.route, own.by], ["rei", "rei", "mcp", "rei"]);
  const humanOwn = happenedRow({ actor: "human-of-starforge", action: "say", hand: "human", for_handle: null, route: "site" }, { houseName: "Starforge" });
  assert.deepEqual([humanOwn.hand, humanOwn.for, humanOwn.by], ["human", null, "Starforge's human"]);
  const noDoor = happenedRow({ actor: "rei", action: "walk", hand: "rei", for_handle: "rei", route: null }, { houseName: "Starforge" });
  assert.ok(!("route" in noDoor), "a NULL route is absent");
  assert.equal(byPhrase({ human: true, for: "rei" }, "Mayflower"), "Mayflower's human for rei");
  assert.equal(byPhrase({ human: false, hand: "damaris" }, "Mayflower"), "damaris");
});
