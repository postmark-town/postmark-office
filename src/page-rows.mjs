// page-rows.mjs — the one pager for a list read (POS-732, Darko 2026-11-16 22:58:
// "paging unification ... We need to do this").
//
// THE PATTERN, one on every door: `limit` (default 20) and `offset` in;
// `total`, `shown`, `limit`, `offset`, `complete` and, while there is more,
// `next_offset` with `more_note` out. "Load another 20" is `{ offset: <next_offset> }`
// everywhere. The spelling is held by test/paged-reads-one-grammar.test.mjs, and
// which reads page is held by test/every-list-read-pages.test.mjs.
//
// THE CEILING. A page is held under the connector's 10,000-byte text cap
// (household-read-page.mjs § PAGE_BYTES): a caller who asks for 20 rows of long
// ones gets the rows that fit, and `limit` says how many that was, so the
// answer never lies about its own page. A page always carries one row at least.

import { wholeNumber } from "./whole-number.mjs";
import { PAGE_BYTES, textBytes } from "./household-read-page.mjs";

/** The default page: a list read shows this many rows unless the caller asks for another number. */
export const PAGE_DEFAULT = 20;
/** The most rows one page may carry. */
export const PAGE_MAX = 200;

/**
 * One page of `all`, in the office's paged-read grammar, as `{ ...around, ...paging, [key]: page }`.
 * @param {any[]} all  every row, already in its order
 * @param {{ limit?: any, offset?: any }} asked  the caller's fields, as they arrived
 * @param {{ noun?: string, dflt?: number, max?: number, key?: string, around?: object, hold?: boolean }} [opt]
 *   `noun` words the more_note; `key` names the rows' field (default "rows"); `around` is the rest of the
 *   answer, which rides with the page and counts against the cap; `hold: false` skips the cap (a read whose
 *   rows are already small).
 */
export function pageRows(all, asked = {}, { noun = "row", dflt = PAGE_DEFAULT, max = PAGE_MAX, key = "rows", around = {}, hold = true } = {}) {
  const n = Math.min(Math.max(wholeNumber(asked.limit) || dflt, 1), max);
  const start = Math.max(wholeNumber(asked.offset) || 0, 0);
  let said = n; // the page size the answer names: the caller's, or what fit under the cap
  const answer = (page) => {
    const next = start + page.length;
    const complete = next >= all.length;
    const left = all.length - next;
    return {
      ...around, total: all.length, shown: page.length, limit: said, offset: start, complete,
      ...(complete ? {} : { next_offset: next, more_note: `${left} further ${noun}${left === 1 ? "" : "s"} — call again with offset: ${next}` }),
      [key]: page,
    };
  };
  let page = all.slice(start, start + n);
  if (hold) while (page.length > 1 && textBytes(answer(page)) > PAGE_BYTES) { page = page.slice(0, -1); said = page.length; }
  return answer(page);
}
