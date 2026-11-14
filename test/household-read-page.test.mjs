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
import { fitRows, cutToCap, pageStances, pageNeeds, textBytes, startOf, PAGE_BYTES, CAP_BYTES, STANCE_PARTS, NEEDS_PARTS } from "../src/household-read-page.mjs";

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

test("P5 · a part that does not exist is refused by name", () => {
  const answer = stancesAnswer([mark(1)], { limit: 20 });
  assert.equal(pageStances(answer, { part: "nope" }).defect, 'part: "nope" is not a part of the stances read');
  assert.equal(pageNeeds({ read: "needs-you" }, { part: "nope" }).defect, 'part: "nope" is not a part of the needs-you read');
});

// ── a single field over the cap: cut with a plain marker (Wright, verified 08:37Z), never paged ──────────────
const bytes = (s) => Buffer.byteLength(s, "utf8");
/** The cut field's kept text and its marker, split; the marker says exactly how many bytes were cut and where the whole text is. */
const split = (cut) => {
  const m = / \[…cut (\d+) bytes; (the whole text: (.*)|no existing read holds this field whole)\]$/s.exec(cut);
  assert.ok(m, `a marker at the end of: ${cut.slice(-160)}`);
  return { kept: cut.slice(0, m.index), cutBytes: Number(m[1]), source: m[3] ?? null };
};

test("P9 · a stance row whose body alone is over the cap: the body is cut with its exact byte count and the mark's read, the row's identity stands, the walk goes on", () => {
  const original = "庭の柵 café 🌱 ".repeat(1500); // 3-, 1- and 4-byte characters
  const huge = { mark: "x/y", by: "x", on_your_ground: ["r000/g"], kind: "mark", date: "2026-11-01", body: original };
  assert.ok(bytes(original) > CAP_BYTES);
  const answer = stancesAnswer([huge, mark(1)], { limit: 20, ground: Array.from({ length: 1000 }, (_, i) => `r000/g-${i}`) });
  const p = pageStances(answer, {});
  assert.ok(textBytes(p) <= CAP_BYTES, `${textBytes(p)} bytes`);
  assert.equal(p.awaiting.length, 1, "the page is that one row");
  assert.deepEqual([p.awaiting[0].mark, p.awaiting[0].by, p.awaiting[0].on_your_ground], ["x/y", "x", ["r000/g"]], "identity stands");
  const { kept, cutBytes, source } = split(p.awaiting[0].body);
  assert.equal(source, 'world { mark: "x/y" }', "the world's bare mark focus, by the row's own mark id");
  assert.ok(original.startsWith(kept), "what is kept is the text's own beginning");
  assert.ok(!kept.includes("�"), "cut on a whole character");
  assert.equal(bytes(kept) + cutBytes, bytes(original), "kept bytes + cut bytes = the field's bytes, exactly");
  assert.equal(p.cursor, "1", "and the next row is where the walk goes on");
  assert.ok(!("body_folded" in p.awaiting[0]));
});

test("P10 · a lone row that fits the cap goes out whole, even past the 9,000 page target; never cut merely to reach it", () => {
  const original = "x".repeat(8300); // with the page's own context, the lone row is between the 9,000 target and the 10,000 cap
  const answer = stancesAnswer([{ mark: "x/y", by: "x", on_your_ground: ["r000/g"], kind: "mark", date: "d", body: original }, mark(1)], { limit: 20, ground: Array.from({ length: 800 }, (_, i) => `r000/g-${i}`) });
  const p = pageStances(answer, {});
  assert.ok(textBytes(p) > PAGE_BYTES && textBytes(p) <= CAP_BYTES, `${textBytes(p)} bytes`);
  assert.equal(p.awaiting[0].body, original, "the body is whole");
});

test("P11 · an alert's nested about.body over the cap is cut, and plainly says no existing read holds it (neither kind has a verified opening)", () => {
  const big = "庭".repeat(4000);
  const alert = (kind, mark) => ({ kind, severity: "act", about: { mark, body: big }, message: "m", act: { verb: "world.stake", args: { mark } }, since: "d", until: null });
  const needs = (rows) => ({ read: "needs-you", household: "h", residents: ["r000"], as_of: "x", count: rows.length, alerts: rows, alerts_unread: [] });
  const taken = pageNeeds(needs([alert("mark-taken", "r000/old")]), { part: "alerts" });
  assert.ok(textBytes(taken) <= CAP_BYTES, `${textBytes(taken)}`);
  const t = split(taken.rows[0].about.body);
  assert.equal(t.source, null, "no verified opening for a retired mark's body: none is promised (the world's focus answers a receipt for a missing mark)");
  assert.equal(bytes(t.kept) + t.cutBytes, bytes(big), "exact");
  assert.deepEqual([taken.rows[0].kind, taken.rows[0].about.mark, taken.rows[0].act.verb], ["mark-taken", "r000/old", "world.stake"], "the alert is still identified and actionable");
  const escrow = pageNeeds(needs([alert("escrow-on-missing-mark", "r001/ghost")]), { part: "alerts" });
  assert.ok(textBytes(escrow) <= CAP_BYTES);
  const e = split(escrow.rows[0].about.body);
  assert.equal(e.source, null, "the mark is not in the world or the store: no existing read holds this body");
  assert.equal(bytes(e.kept) + e.cutBytes, bytes(big));
});

test("P12 · a top-level message over the cap is cut too (the office composes it: no other copy), and two long fields are both counted", () => {
  const msg = "y".repeat(12000);
  const row = { kind: "info", severity: "info", about: { mark: "r000/a", body: "z".repeat(12000) }, message: msg, act: { verb: "x", args: {} }, since: "d", until: null };
  const p = pageNeeds({ read: "needs-you", household: "h", count: 1, alerts: [row] }, { part: "alerts" });
  assert.ok(textBytes(p) <= CAP_BYTES, `${textBytes(p)}`);
  const m = split(p.rows[0].message);
  assert.equal(m.source, null);
  assert.equal(bytes(m.kept) + m.cutBytes, bytes(msg));
  const b = split(p.rows[0].about.body);
  assert.equal(bytes(b.kept) + b.cutBytes, 12000, "the second long field is counted by its own bytes");
  assert.equal(b.source, null, "an alert's body has no verified opening");
});

test("P13 · the teaching block bypassed no fit: over the cap its longest strings are cut with where each lives; within the cap it is whole", () => {
  const long = "the response function says that ".repeat(400);
  const teach = { what_opposed_does: "short", any_latency: long, from: "LOGOS/the-response-function.md",
    after_it_is_published: { the_law_reaches: "law ".repeat(2000), law_mark: "the-town/the-late-welcome", unruled: ["a", long].join(" ") }, law_mark: "the-town/the-law" };
  const answer = { ...stancesAnswer([mark(1)], { limit: 20 }), teach, law: "A stance is a revisable word on an edge." };
  assert.ok(bytes(JSON.stringify(teach)) > CAP_BYTES);
  const t = pageStances(answer, { part: "teach" });
  assert.ok(textBytes(t) <= CAP_BYTES, `${textBytes(t)}`);
  assert.equal(t.law, answer.law);
  assert.equal(t.teach.what_opposed_does, "short", "a short string is not touched");
  const cuts = [["any_latency", t.teach.any_latency, long], ["the_law_reaches", t.teach.after_it_is_published.the_law_reaches, teach.after_it_is_published.the_law_reaches], ["unruled", t.teach.after_it_is_published.unruled, teach.after_it_is_published.unruled]];
  let cutOnes = 0;
  for (const [name, field, original] of cuts) {
    if (!/\[…cut \d+ bytes;/.test(field)) continue;
    cutOnes += 1;
    const { kept, cutBytes, source } = split(field);
    assert.equal(bytes(kept) + cutBytes, bytes(original), `${name}: exact`);
    if (name === "any_latency") assert.equal(source, "LOGOS/the-response-function.md in the world checkout");
    if (name === "the_law_reaches") assert.equal(source, 'world { mark: "the-town/the-late-welcome" }');
    if (name === "unruled") assert.equal(source, 'LOGOS/the-response-function.md in the world checkout and world { mark: "the-town/the-late-welcome" }');
  }
  assert.ok(cutOnes >= 1);
  // within the cap: whole, the same strings
  const small = { ...answer, teach: { ...teach, any_latency: "short", after_it_is_published: { ...teach.after_it_is_published, the_law_reaches: "short", unruled: "short" } } };
  assert.deepEqual(pageStances(small, { part: "teach" }).teach, small.teach);
});

test("P14 · a field with no string long enough to cut is delivered as it is, never looped on; cutToCap says what it cut", () => {
  const row = { a: Array.from({ length: 400 }, (_, i) => `field ${i} `.repeat(5)) }; // many strings, none over the cut floor
  const { answer, cuts } = cutToCap(row, (r) => ({ rows: [r] }), { cap: 1000 });
  assert.equal(cuts.length, 0);
  assert.ok(textBytes(answer) > 1000, "nothing was long enough to cut, so it is what it is: the Build names this limit");
  const { cuts: two } = cutToCap({ x: "a".repeat(3000), y: "b".repeat(2900) }, (r) => ({ rows: [r] }), { cap: 2500, sourceOf: (p) => (p[0] === "x" ? "src-x" : null) });
  assert.deepEqual(two.map((c) => [c.path, c.source]).sort(), [["x", "src-x"], ["y", null]]);
  assert.equal(two.reduce((n, c) => n + bytes(c.kept) + c.cut_bytes, 0), two.reduce((n, c) => n + bytes(c.original), 0));
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
