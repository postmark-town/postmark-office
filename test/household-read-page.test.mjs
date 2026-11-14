// household-read-page.test.mjs — CORE-88: pages of the household reads, by size.
//
// Wright, Settled 2026-11-14 07:23Z: "Give each read a stub that points to (stances, stakes' at-risk set, needs-you) a bounded
// page with a cursor … Every page stays under the 10,000-byte cap … Keep today's unpaged answers byte-for-byte for callers who
// don't pass a cursor, unless that alone breaks the cap."
//
//   P1  an answer that fits is returned as it was: the same object, and the same delivered bytes (stances and needs-you);
//   P2  an answer that does not fit comes in pages: each page's delivered text ≤ PAGE_BYTES < the cap, the cursors chain, every
//       row is on exactly one page, and the last page says complete;
//   P3  the context of a paged stances answer is counted and read by part, and each part pages the same way;
//   P4  a needs-you that does not fit is its parts counted, each with the call that pages it; each part pages;
//   P5  a row that cannot fit alone is folded and counted (never cut), a bad part is refused by name;
//   P6  every page of every part of an invented large house, followed by cursor, is measured and matched to the source.
//
//   node --test test/household-read-page.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { fitRows, pageStances, pageNeeds, textBytes, startOf, PAGE_BYTES, CAP_BYTES, STANCE_PARTS, NEEDS_PARTS } from "../src/household-read-page.mjs";

const body = (n, tag) => `${tag} ${"café 庭の柵を直してください 🌱 ".repeat(n)}`.trim();
const mark = (i, by = `by-${i % 7}`, n = 4) => ({ mark: `${by}/m-${i}`, by, on_your_ground: [`r000/ground-${i % 5}`], kind: "mark", date: "2026-11-01", body: body(n, `m${i}`) });

/** A stances answer as stanceShadow shapes it, over `n` candidates read from `start`, `limit` at a time. */
function stancesAnswer(all, { start = 0, limit = 100, setDowns = [], takes = [], standing = [], ground = [] } = {}) {
  const page = all.slice(start, start + limit);
  const next = start + limit < all.length ? String(start + limit) : null;
  return { stances_awaiting: all.length, stances_awaiting_ground: "household", awaiting: page, cursor: next, complete: next == null,
    set_downs_awaiting: setDowns, ...(takes.length ? { awaiting_your_word: [...setDowns.map((r) => ({ ...r, act: "set-down" })), ...takes] } : {}), standing, ground, law: "A stance is a revisable word on an edge.",
    teach: { law_mark: "the-town/the-law", after_it_is_published: { the_law_reaches: body(3, "law") } } };
}

test("P1 · an answer that fits is returned as it was: same object, same bytes", () => {
  const small = stancesAnswer(Array.from({ length: 3 }, (_, i) => mark(i)), { limit: 20 });
  assert.ok(textBytes(small) < PAGE_BYTES);
  assert.equal(pageStances(small, {}), small);
  assert.equal(pageStances(small, { cursor: "0", limit: 20 }), small, "a cursor that changes nothing changes nothing");
  const needs = { read: "needs-you", household: "h", count: 1, stances_awaiting: { total: 1, shown: 1, rows: [{ mark: "a/b" }] }, set_downs_awaiting: { rows: [] }, key_asks: { rows: [] }, alerts: [] };
  assert.equal(pageNeeds(needs, {}), needs);
  assert.equal(textBytes(pageNeeds(needs, {})), textBytes(needs));
});

test("P2 · stances that do not fit come in pages: each ≤ the page budget, the cursors chain, every mark once", () => {
  const all = Array.from({ length: 100 }, (_, i) => mark(i));
  const first = stancesAnswer(all, { limit: 100, setDowns: Array.from({ length: 30 }, (_, i) => ({ thing: `t-${i}`, made_by: "r000", set_down_by: "o", at: null, act_id: String(i), answer: "x" })), standing: Array.from({ length: 200 }, (_, i) => ({ on: `m-${i}`, stance: "welcomed", by: "r000" })), ground: Array.from({ length: 300 }, (_, i) => `r000/g-${i}`) });
  assert.ok(textBytes(first) > CAP_BYTES, `the invented answer is over the cap: ${textBytes(first)}`);
  const seen = [];
  let cursor = null, pages = 0, a = pageStances(first, {});
  for (;;) {
    pages += 1;
    assert.ok(textBytes(a) <= PAGE_BYTES, `page ${pages}: ${textBytes(a)} bytes`);
    seen.push(...a.awaiting.map((r) => r.mark));
    cursor = a.cursor;
    if (a.complete) break;
    assert.ok(cursor != null && Number(cursor) === seen.length, "the cursor is the index of the first mark not on the page");
    a = pageStances(stancesAnswer(all, { start: Number(cursor), limit: 100, setDowns: first.set_downs_awaiting, standing: first.standing, ground: first.ground }), { cursor });
    assert.ok(pages < 100);
  }
  assert.ok(pages > 1);
  assert.deepEqual(seen, all.map((m) => m.mark), "every mark once, in the inbox's order");
  assert.equal(a.cursor, null);
});

test("P3 · a paged stances answer counts its context and each context part pages by size", () => {
  const setDowns = Array.from({ length: 80 }, (_, i) => ({ thing: `thing-${i}`, made_by: "r000", owner: "r001", set_down_by: `o${i}`, at: "2026-11-12T00:00:00Z", act_id: String(i), answer: body(2, "answer") }));
  const takes = Array.from({ length: 40 }, (_, i) => ({ thing: `take-${i}`, owner: "r001", act: "take", by: `t${i}`, act_id: String(i), answer: body(2, "answer") }));
  const standing = Array.from({ length: 150 }, (_, i) => ({ on: `m-${i}`, stance: "welcomed", by: "r000", note: body(1, "n") }));
  const ground = Array.from({ length: 500 }, (_, i) => `r000/ground-${i}`);
  const answer = stancesAnswer(Array.from({ length: 5 }, (_, i) => mark(i)), { limit: 20, setDowns, takes, standing, ground });
  assert.ok(textBytes(answer) > CAP_BYTES);
  const page = pageStances(answer, {});
  assert.ok(textBytes(page) <= PAGE_BYTES);
  assert.equal(page.awaiting.length, 5, "the marks ride: the context is what folded");
  for (const k of ["standing", "ground", "set_downs_awaiting", "awaiting_your_word", "teach", "law"]) assert.ok(!(k in page), `${k} is not carried on a paged page`);
  assert.deepEqual(Object.keys(page.context).sort(), ["ground", "note", "set_downs", "standing", "takes", "teach"]);
  assert.equal(page.context.set_downs.total, 80);
  assert.equal(page.context.set_downs.read, 'household { read: "stances", args: { part: "set_downs" } }');
  assert.equal(page.context.takes.total, 40);
  assert.equal(page.context.standing.total, 150);
  // each part, walked by cursor: every row once, every page fits
  for (const [part, rows] of [["set_downs", setDowns], ["takes", takes], ["standing", standing], ["ground", ground]]) {
    const got = [];
    let cursor = null;
    for (let i = 0; i < 100; i++) {
      const p = pageStances(answer, { part, ...(cursor ? { cursor } : {}) });
      assert.ok(textBytes(p) <= PAGE_BYTES, `${part} page ${i}: ${textBytes(p)}`);
      assert.equal(p.total, rows.length);
      got.push(...p.rows);
      if (p.complete) break;
      cursor = p.cursor;
      assert.equal(Number(cursor), got.length);
    }
    assert.deepEqual(got, rows, `${part}: every row, once, in order`);
  }
  const t = pageStances(answer, { part: "teach" });
  assert.deepEqual([t.law, t.teach], [answer.law, answer.teach]);
  assert.deepEqual(Object.keys(STANCE_PARTS), ["set_downs", "takes", "standing", "ground"]);
});

test("P4 · needs-you that does not fit is its parts counted, each paged by its call", () => {
  const big = (n, make) => Array.from({ length: n }, (_, i) => make(i));
  const answer = {
    read: "needs-you", household: "big-house", residents: ["r000"], as_of: "x", count: 999, shown: 20,
    stances_awaiting: { total: 700, shown: 20, rows: big(20, (i) => ({ mark: `a/b-${i}`, cause: body(3, "cause"), act: body(2, "act") })) },
    set_downs_awaiting: { rows: big(40, (i) => ({ thing: `t-${i}`, cause: body(3, "cause") })) },
    takes_awaiting: { rows: big(10, (i) => ({ thing: `k-${i}`, cause: body(3, "cause") })) },
    unplaced_bounces: { rows: big(50, (i) => ({ handle: "r000", path: `p-${i}`, reason: body(2, "r"), cause: body(2, "c") })) },
    key_asks: { rows: big(6, (i) => ({ handle: `r${i}`, asks_standing: "d", cause: body(2, "c"), cosign_link: null, why_no_link: body(5, "why") })), unavailable: "the key store could not be read for every resident — the list below may be short" },
    likeness_question: { rows: [{ household: "h", residents: ["r000"], cause: body(3, "c"), link: "l" }] },
    stakes_at_risk: { next_settlement: { at: "2026-11-15T00:00:00.000Z" }, rows: big(60, (i) => ({ mark: `r000/shed-${i}`, cause: body(3, "cause"), act: "world { do: stake }" })) },
    alerts: big(30, (i) => ({ kind: "mark-taken", severity: "act", about: { mark: `r000/a-${i}`, body: body(4, "body") }, message: body(3, "m"), act: { verb: "world.stake", args: { mark: `r000/a-${i}` } }, since: "d", until: null })),
    alerts_unread: [{ kind: "x", reason: "the store could not be reached" }],
  };
  assert.ok(textBytes(answer) > CAP_BYTES * 5);
  const sk = pageNeeds(answer, {});
  assert.ok(textBytes(sk) <= PAGE_BYTES, `${textBytes(sk)}`);
  assert.equal(sk.count, 999);
  assert.equal(sk.key_asks.unavailable, answer.key_asks.unavailable, "an unavailable word survives");
  assert.deepEqual(sk.alerts_unread, answer.alerts_unread);
  for (const k of Object.keys(NEEDS_PARTS)) {
    const rows = NEEDS_PARTS[k](answer);
    assert.equal(sk[k].total, rows.length, `${k}: counted`);
    assert.equal(sk[k].read, `household { read: "needs-you", args: { part: "${k}" } }`);
    const got = [];
    let cursor = null;
    for (let i = 0; i < 200; i++) {
      const p = pageNeeds(answer, { part: k, ...(cursor ? { cursor } : {}) });
      assert.ok(textBytes(p) <= PAGE_BYTES, `${k} page ${i}: ${textBytes(p)}`);
      got.push(...p.rows);
      if (k === "stakes_at_risk") assert.deepEqual(p.next_settlement, answer.stakes_at_risk.next_settlement);
      if (k === "key_asks") assert.equal(p.unavailable, answer.key_asks.unavailable, "and on its pages");
      if (p.complete) break;
      cursor = p.cursor;
    }
    assert.deepEqual(got, rows, `${k}: every row once, whole (as needs-you gives them), in order`);
  }
  assert.match(sk.stances_awaiting.read, /read: "stances", args: \{ limit: 100 \}/, "the marks are read at stances");
});

test("P5 · a row that cannot fit alone is folded and counted, never cut; a part that does not exist is refused by name", () => {
  const huge = { mark: "x/y", by: "x", on_your_ground: ["r000/g"], body: "庭".repeat(6000) };
  const answer = stancesAnswer([huge, mark(1)], { limit: 20, ground: Array.from({ length: 1000 }, (_, i) => `r000/g-${i}`) });
  assert.ok(textBytes(answer) > PAGE_BYTES);
  const p = pageStances(answer, {});
  assert.ok(textBytes(p) <= PAGE_BYTES);
  assert.equal(p.awaiting.length, 1, "the page is that one row");
  assert.ok(!("body" in p.awaiting[0]));
  assert.equal(p.awaiting[0].body_folded, `${Buffer.byteLength(huge.body, "utf8")} bytes not shown`);
  assert.equal(p.cursor, "1", "and the next row is where the walk goes on");
  assert.equal(pageStances(answer, { part: "nope" }).defect, 'part: "nope" is not a part of the stances read');
  assert.equal(pageNeeds({ read: "needs-you" }, { part: "nope" }).defect, 'part: "nope" is not a part of the needs-you read');
});

test("P6 · fitRows: the largest prefix that fits, deterministic, with the cursor of the first row off the page", () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ i, s: "x".repeat(300) }));
  const build = (page, next) => ({ rows: page, cursor: next });
  const { answer, taken, next } = fitRows(rows, 0, build, { budget: 2000 });
  assert.ok(textBytes(answer) <= 2000);
  assert.ok(textBytes(build(rows.slice(0, taken + 1), String(taken + 1))) > 2000, "one more row would not fit");
  assert.equal(next, String(taken));
  assert.deepEqual(fitRows(rows, 49, build, { budget: 2000 }).answer, { rows: [rows[49]], cursor: null });
  assert.equal(fitRows([], 0, build).next, null);
  assert.equal(startOf("7"), 7);
  assert.equal(startOf("junk"), 0);
  assert.equal(startOf(undefined), 0);
});

test("P7 · stances of 9,001 to 10,000 bytes fit the connector and come back untouched; one over the cap is paged", () => {
  const ground = (n) => Array.from({ length: n }, (_, i) => `r000/ground-${i}`);
  const at = (n) => stancesAnswer(Array.from({ length: 3 }, (_, i) => mark(i)), { limit: 20, ground: ground(n) });
  let n = 1;
  while (textBytes(at(n)) <= PAGE_BYTES) n++;
  let seen = 0;
  for (; textBytes(at(n)) <= CAP_BYTES; n++) {
    const a = at(n);
    assert.ok(textBytes(a) > PAGE_BYTES);
    assert.equal(pageStances(a, {}), a, `${textBytes(a)} bytes: the same object, not paged`);
    assert.equal(pageStances(a, { cursor: "0" }), a);
    seen += 1;
  }
  assert.ok(seen > 5, `${seen} sizes tried in the window`);
  const over = at(n);
  assert.ok(textBytes(over) > CAP_BYTES);
  const page = pageStances(over, {});
  assert.ok(page.context && textBytes(page) <= PAGE_BYTES, "one answer over the cap is paged, to the page budget");
});

test("P8 · needs-you of 9,001 to 10,000 bytes fits the connector and comes back untouched; one over the cap is its parts counted", () => {
  const make = (n) => ({ read: "needs-you", household: "h", residents: ["r000"], as_of: "x", count: n, shown: n,
    stances_awaiting: { total: 0, shown: 0, rows: [] }, set_downs_awaiting: { rows: [] }, unplaced_bounces: { rows: [] }, key_asks: { rows: [] },
    likeness_question: { rows: [{ household: "h", residents: ["r000"], cause: "c", link: "https://postmark.town/likeness?household=h", hand_it_over: "give it to your human" }] },
    stakes_at_risk: { next_settlement: null, rows: Array.from({ length: n }, (_, i) => ({ mark: `r000/shed-${i}`, class: "commons", escrow: 0, at_risk: true, cause: "c".repeat(40) })) }, alerts: [] });
  let n = 1;
  while (textBytes(make(n)) <= PAGE_BYTES) n++;
  let seen = 0;
  for (; textBytes(make(n)) <= CAP_BYTES; n++) {
    const a = make(n);
    assert.equal(pageNeeds(a, {}), a, `${textBytes(a)} bytes: the same object, rows and the likeness link intact`);
    seen += 1;
  }
  assert.ok(seen >= 1);
  const over = pageNeeds(make(n), {});
  assert.ok(over.paged && textBytes(over) <= PAGE_BYTES);
});
