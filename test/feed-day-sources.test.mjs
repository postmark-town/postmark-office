// feed-day-sources.test.mjs — the REAL queries behind the feed's continuation and the day's received letters (POS-1027 fix round).
//
//   node --test test/feed-day-sources.test.mjs
//
//   1. lettersDeliveredFeed reads from a POSITION: a run of letters delivered at one instant is paged on from the exact id, an instant wholly served is skipped, and
//      a later kind's rows at that instant are all still to come;
//   2. claimRowsDecidedSince (the feed's mark source) does the same from `until`, newest first then slug ascending, so its newest-500 window moves with the cursor;
//   3. lettersOfDay counts a delivered letter for EVERY recipient: the column holds the first one (town-index.mjs § letterRows), the rest ride only in the json
//      toList, and the day of a secondary recipient must not lose it.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { storeIndexPooled } from "../src/town-index-store.mjs";
import { claimRowsDecidedSince } from "../src/world2-claims.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { fixtureTown, put } from "./fixture.mjs";
import { realSources } from "../src/town-feed-sources.mjs";

const DAY = "2026-09-27";
const AT = `${DAY}T12:00:00.000Z`;
const town = fixtureTown();
const letter = (id, from, to, json = {}, at = AT) => put(town, "letters", { id, from_h: from, to_h: to, date: at.slice(0, 10), thread: "new", box: "inbox", owner: to,
  path: `WHITE_PAGES/${to}/inbox/${id}.md`, json: JSON.stringify({ id, from, to, date: at.slice(0, 10), ...json }), delivered_at: at });
for (const id of ["t-a", "t-b", "t-c", "t-d", "t-e"]) letter(id, "wright", "limen");
letter("t-old", "wright", "limen", {}, "2026-09-26T12:00:00.000Z");
// one letter, three recipients: the column says limen, the toList says the rest
letter("multi-1", "wright", "limen", { toList: ["limen", "postmaster", "lupi"] });
letter("single-1", "wright", "limen");

const IX = await indexStore(town, { db: "feed_day_sources" });
const RESTORE = await IX.useInProcess();
after(async () => { await RESTORE(); await IX.stop(); });
const ix = () => storeIndexPooled(null);
const ids = (r) => r.rows.map((x) => x.id);

test("1 · lettersDeliveredFeed reads from a position: on from the exact id, an instant wholly served skipped, a later kind\x27s rows at it all to come", async () => {
  const tied = ["multi-1", "single-1", "t-a", "t-b", "t-c", "t-d", "t-e"];   // the id order at one instant
  const whole = await ix().lettersDeliveredFeed({ sinceIso: "2026-09-01", limit: 100 });
  assert.deepEqual(ids(whole), [...tied, "t-old"]);
  // paged two at a time with the position the feed gives back
  const seen = [];
  let resume = null;
  for (let guard = 0; guard < 10; guard++) {
    const page = await ix().lettersDeliveredFeed({ sinceIso: "2026-09-01", limit: 2, ...(resume ? { resume } : {}) });
    if (!page.rows.length) break;
    seen.push(...ids(page));
    const lastRow = page.rows.at(-1);
    resume = { at: String(lastRow.delivered_at), afterId: lastRow.id, exclusive: false };
    if (!page.cut) break;
  }
  assert.deepEqual(seen, [...tied, "t-old"], "every letter once, in the feed\x27s order, across a run of equal instants longer than the page");
  assert.deepEqual(ids(await ix().lettersDeliveredFeed({ sinceIso: "2026-09-01", limit: 100, resume: { at: AT, afterId: "t-c", exclusive: false } })), ["t-d", "t-e", "t-old"]);
  assert.deepEqual(ids(await ix().lettersDeliveredFeed({ sinceIso: "2026-09-01", limit: 100, resume: { at: AT, afterId: null, exclusive: true } })), ["t-old"], "the instant is wholly served");
  assert.equal((await ix().lettersDeliveredFeed({ sinceIso: "2026-09-01", limit: 100, resume: { at: AT, afterId: null, exclusive: false } })).rows.length, 8, "all of it still to come");
});

test("2 · claimRowsDecidedSince reads the newest 500 from the cursor\x27s position, not the same newest 500 again", async () => {
  const owner = await IX.store.connect("world2_owner");
  const slugs = ["m-a", "m-b", "m-c", "m-d"];
  try {
    await owner.query("INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES (1, '2026-09-01T00:00:00Z', '2026-09-01T12:00:00Z', 'closed', '2026-09-01T12:00:00Z') ON CONFLICT DO NOTHING");
    const add = (slug, decidedAt) => owner.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, slug)
       VALUES (1, 'sited', 'wright', 'hh:fixture', 'locked', $1::timestamptz, $2, '{"at":{"x":1,"y":1}}', '(1,1),(0,0)'::box, 0, '{}', $3)`, [decidedAt, `${slug}.`, slug]);
    for (const sl of slugs) await add(sl, AT);
    await add("m-old", "2026-09-26T12:00:00.000Z");
  } finally { await owner.end(); }
  const env = IX.env;
  const slugsOf = async (opts) => (await claimRowsDecidedSince("1970-01-01T00:00:00.000Z", { env, ...opts })).map((r) => r.slug);
  assert.deepEqual(await slugsOf({}), ["m-a", "m-b", "m-c", "m-d", "m-old"], "newest first, then slug ascending");
  assert.deepEqual(await slugsOf({ until: AT, afterSlug: "m-b" }), ["m-c", "m-d", "m-old"]);
  assert.deepEqual(await slugsOf({ until: AT, exclusive: true }), ["m-old"]);
  assert.deepEqual(await slugsOf({ until: AT, afterSlug: null }), ["m-a", "m-b", "m-c", "m-d", "m-old"]);
  // through the feed\x27s own mark source: the cursor\x27s position reaches the store\x27s read
  const asked = [];
  const src = realSources({ ix: ix(), clone: null, readers: { claimRowsDecidedSince: async (since, opts) => { asked.push(opts); return claimRowsDecidedSince(since, { env, ...opts }); }, publishedMarksTownwide: () => [] } });
  const first = await src.mark({ since: null, before: null, resume: null, cap: 500 });
  assert.deepEqual(first.rows.map((r) => r.id), ["m-a", "m-b", "m-c", "m-d", "m-old"]);
  const next = await src.mark({ since: null, before: AT, resume: { at: AT, afterId: "m-b", exclusive: false }, cap: 500 });
  assert.deepEqual(next.rows.map((r) => r.id), ["m-c", "m-d", "m-old"]);
  assert.deepEqual(asked.at(-1), { until: AT, afterSlug: "m-b", exclusive: false });
});

test("3 · a day counts a delivered letter for every recipient: the first (the column) and the rest (the json toList), and not for a bystander", async () => {
  for (const [who, expected] of [["limen", ["multi-1", "single-1", "t-a", "t-b", "t-c", "t-d", "t-e"]], ["postmaster", ["multi-1"]], ["lupi", ["multi-1"]], ["wright", []]]) {
    const d = await ix().lettersOfDay(who, DAY);
    assert.deepEqual(d.received.map((r) => r.id).sort(), expected, `${who}\x27s received on ${DAY}`);
  }
});
