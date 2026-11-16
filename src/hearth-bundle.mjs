// hearth-bundle.mjs — `household { read: "hearth", args: { household } }`: EVERYTHING A HEARTH DRAWS FOR A NAMED HOUSE, IN ONE PUBLIC ANSWER (POS-1027).
//
// The site's slots and a house's own script both read this one answer. It is built the way the doorstep is (doorstep-bundle.mjs): a part is not a copy or a
// second rendering of a read, it IS the answer of the read it names, and `via` says exactly which call that is, so asking that call gives the same thing:
//
//   { read: "hearth", household: "<canonical slug>", parts: {
//       house:    { via: { door: "household", read: "house",    args: { household, full: true } },                 data },
//       posts:    [ { via: { door: "town", read: "posts", args: { class: "idea", limit: 100 } }, data },
//                   { via: { door: "town", read: "posts", args: { class: "bug",  limit: 100 } }, data } ],
//       closer:   { via: { door: "household", read: "closer",   args: { household, limit: 10 } },                 data },
//       went:     { via: { door: "household", read: "stamps",   args: { household, view: "went", limit: 20 } },   data },
//       happened: { via: { door: "household", read: "happened", args: { household, limit: 20 } },                 data },
//       feed:     { via: { door: "town", read: "feed", args: { household, sort: "newest", limit: 20 } },          data },
//       days:     [ { via: { door: "household", read: "day", args: { handle, date } }, data }, … ],   one per ashore member, in the house's order
//       pairs:    [ { via: { door: "town", read: "pair", args: { a, b } }, data }, … ] } }           the pairs the closer page represents, sorted by (a, b)
//
// PUBLIC FOR EVERY CALLER, THE OWNER INCLUDED: every part is read with no key, so no needs-you, private mail, pending or unsailed letter, raw registry,
// account or consent record, or any owner overlay can ride it, even on the house's own key. Each part keeps its own paging, cursors, source dates and
// unavailable markers, and no common snapshot is invented across their different clocks (`as_of` on each part is that part's own source). The limits are
// the first page of each part, not a hidden loss: every part carries the continuation its standalone read does.
//
// A collection whose scope cannot be determined (the house, or the ties page, did not read) is `{ unavailable: "<why>" }`, never an invented empty `days` or `pairs`.

import { utcDate } from "./resident-day.mjs";

/** The standalone calls the bundle's parts record, as functions of the house, so the contract is one table and a test can read it. */
export const HEARTH_PARTS = Object.freeze({
  house: (household) => ({ door: "household", read: "house", args: { household, full: true } }),
  posts: () => [
    { door: "town", read: "posts", args: { class: "idea", limit: 100 } },
    { door: "town", read: "posts", args: { class: "bug", limit: 100 } },
  ],
  closer: (household) => ({ door: "household", read: "closer", args: { household, limit: 10 } }),
  went: (household) => ({ door: "household", read: "stamps", args: { household, view: "went", limit: 20 } }),
  happened: (household) => ({ door: "household", read: "happened", args: { household, limit: 20 } }),
  feed: (household) => ({ door: "town", read: "feed", args: { household, sort: "newest", limit: 20 } }),
  day: (handle, date) => ({ door: "household", read: "day", args: { handle, date } }),
  pair: (a, b) => ({ door: "town", read: "pair", args: { a, b } }),
});

const isRefusal = (d) => !d || typeof d !== "object" || d.error != null;

/**
 * `call(via)` performs one recorded standalone call with NO key and returns its answer (the door's own function: a bounce stays a bounce). `slug` is the
 * canonical house the caller already resolved. Returns the bundle.
 */
export async function hearthBundle({ slug, nowMs = Date.now() }, call) {
  const part = async (via) => ({ via, data: await call(via) });
  const house = await part(HEARTH_PARTS.house(slug));
  const posts = [];
  for (const via of HEARTH_PARTS.posts()) posts.push(await part(via));
  const closer = await part(HEARTH_PARTS.closer(slug));
  const went = await part(HEARTH_PARTS.went(slug));
  const happened = await part(HEARTH_PARTS.happened(slug));
  const feed = await part(HEARTH_PARTS.feed(slug));

  // one day per ashore member, in the house's order; the house part is the scope
  const date = utcDate(nowMs);
  let days;
  if (isRefusal(house.data) || !Array.isArray(house.data.ashore)) days = { unavailable: "the house could not be read, so the residents ashore, and a day for each, cannot be listed: unavailable, not empty" };
  else { days = []; for (const handle of house.data.ashore) days.push(await part(HEARTH_PARTS.day(handle, date))); }

  // the pairs the ties page represents: its `house_members` × the correspondent, unique, sorted
  let pairs;
  if (isRefusal(closer.data) || !Array.isArray(closer.data.rows)) pairs = { unavailable: "the ties could not be read, so the pairs they represent cannot be listed: unavailable, not empty" };
  else {
    const seen = new Set();
    const list = [];
    for (const row of closer.data.rows) for (const a of row.house_members ?? []) { const k = `${a}\0${row.with}`; if (!seen.has(k)) { seen.add(k); list.push([a, row.with]); } }
    list.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
    pairs = [];
    for (const [a, b] of list) pairs.push(await part(HEARTH_PARTS.pair(a, b)));
  }
  return { read: "hearth", household: slug, parts: { house, posts, closer, went, happened, feed, days, pairs } };
}
