// page-rows.test.mjs — the one pager (POS-732).
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/page-rows.test.mjs
//
// LAW (Darko, 2026-11-16 22:58 EST): "paging unification ... We need to do this." `limit` (default 20, held under the
// ~10K ceiling) and `offset` in; `next_offset` and `more_note` out when there is more.

import test from "node:test";
import assert from "node:assert/strict";
import { PAGE_DEFAULT, pageRows } from "../src/page-rows.mjs";
import { CAP_BYTES, textBytes } from "../src/household-read-page.mjs";

const rows = (n, make = (i) => ({ id: `r${i}` })) => Array.from({ length: n }, (_, i) => make(i));

test("a page is 20 by default, and `next_offset` walks the rest until `complete`", () => {
  const all = rows(45);
  const p1 = pageRows(all, {}, { noun: "thing" });
  assert.deepEqual([p1.total, p1.shown, p1.limit, p1.offset, p1.complete, p1.next_offset], [45, 20, 20, 0, false, 20]);
  assert.equal(p1.more_note, "25 further things — call again with offset: 20");
  const p2 = pageRows(all, { offset: p1.next_offset });
  assert.deepEqual([p2.shown, p2.offset, p2.complete, p2.next_offset], [20, 20, false, 40]);
  const p3 = pageRows(all, { offset: p2.next_offset });
  assert.deepEqual([p3.shown, p3.complete, p3.next_offset, p3.more_note], [5, true, undefined, undefined]);
  assert.deepEqual([...p1.rows, ...p2.rows, ...p3.rows], all, "the pages tile the list: none twice, none missed");
  assert.equal(PAGE_DEFAULT, 20);
});

test("a caller's limit is honoured, floored at 1 and capped at 200; a bad number is the default, never a crash", () => {
  const all = rows(300);
  assert.equal(pageRows(all, { limit: 5 }).shown, 5);
  assert.equal(pageRows(all, { limit: 0 }).limit, 20, "0 is not a page size: the default answers");
  assert.equal(pageRows(all, { limit: "7" }).shown, 7);
  assert.equal(pageRows(all, { limit: 9999 }).limit, 200);
  assert.equal(pageRows(all, { limit: "nonesuch", offset: "-3" }).offset, 0);
  assert.equal(pageRows(all, { offset: 1e30 }).shown, 0, "past the end is an empty, complete page");
  assert.equal(pageRows(all, { offset: 1e30 }).complete, true);
  assert.equal(pageRows([], {}).complete, true);
});

test("a page is held under the connector's cap, `limit` says how many it carried, and no row is lost to the walk", () => {
  const fat = rows(30, (i) => ({ id: `fat${i}`, body: "x".repeat(900) }));
  const p1 = pageRows(fat, { limit: 30 }, { around: { class: "idea" } });
  assert.ok(textBytes(p1) <= CAP_BYTES, `the page is ${textBytes(p1)} bytes`);
  assert.ok(p1.shown < 30 && p1.shown >= 1, "it carried the rows that fit");
  assert.equal(p1.limit, p1.shown, "and says so, never the number it was asked for");
  assert.equal(p1.next_offset, p1.shown);
  assert.equal(p1.class, "idea", "the rest of the answer rides with the page");
  const walked = [];
  for (let off = 0, guard = 0; off != null && guard < 100; guard++) { const p = pageRows(fat, { limit: 30, offset: off }); walked.push(...p.rows); off = p.next_offset; }
  assert.deepEqual(walked, fat, "walking by next_offset reaches every row");
  // CONTROL: with the hold off the same ask is the whole 30 and over the cap, so the cap above is the hold's doing
  const loose = pageRows(fat, { limit: 30 }, { hold: false });
  assert.equal(loose.shown, 30);
  assert.ok(textBytes(loose) > CAP_BYTES);
  // a single row bigger than the cap still goes out, alone: a page carries one row at least
  const huge = pageRows([{ body: "y".repeat(20000) }, { body: "z" }], {});
  assert.equal(huge.shown, 1);
  assert.equal(huge.next_offset, 1);
});
