// bulletin-newest-first.test.mjs — the bulletin's "newest first" is the date the
// author posted, on both twins, and the standing read says what it checks
// (POS-543).
//
//   EMBEDDED_PG_DIR=<dir with embedded-postgres> node --test test/bulletin-newest-first.test.mjs
//
// The defect: bulletinTeaserOf reversed the slug order, on the belief that the
// town's bulletin slugs are date-led. None of them is, so your-doorstep (posted
// 07-03) led every doorstep in town and the newest posting came 13th. The
// fixture here is the PINNED town's own TOWN_BULLETIN (test/clone-pins.json),
// read the way the index reads it (vendor/tools/lib/town.mjs § readTown), so
// the order is checked against real slugs and real dates. Without a Postgres
// the store twin's test SKIPS and says so; the rest run.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fixtureDb } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { copyIndexToStore } from "./helpers/index-to-store.mjs";
import { parseFrontmatter } from "../vendor/tools/lib/town.mjs";
import * as office from "../src/queries.mjs";
import * as store from "../src/town-index-store.mjs";
import { HOUSEHOLD_READS, HOUSEHOLD_DESCRIPTION, paperGapRows } from "../src/household-apex.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BULLETIN_DIR = join(ROOT, "town-clone", "TOWN_BULLETIN");

// The town's postings as readTown takes them: every .md but README.md.
const townPostings = () => readdirSync(BULLETIN_DIR)
  .filter((f) => f.endsWith(".md") && f !== "README.md")
  .map((f) => {
    const { data, body } = parseFrontmatter(readFileSync(join(BULLETIN_DIR, f), "utf8"));
    return { slug: f.replace(/\.md$/, ""), data, body, path: `TOWN_BULLETIN/${f}` };
  });

// The order, said independently of the code under test: dated postings by
// date, newest first; then the undated. Ties and the undated by reverse slug.
const expectedOrder = (postings) => {
  const dated = postings.filter((p) => p.data.posted).sort((a, b) => (a.data.posted < b.data.posted ? 1 : a.data.posted > b.data.posted ? -1 : a.slug < b.slug ? 1 : -1));
  const undated = postings.filter((p) => !p.data.posted).sort((a, b) => (a.slug < b.slug ? 1 : -1));
  return [...dated, ...undated].map((p) => p.slug);
};

test("bulletinTeaserOf: newest posted first, out of slug order; undated after; ties and the undated by reverse slug", () => {
  // A listing as both twins hand it over: ascending by slug, bytewise.
  const listing = [
    { slug: "a-old", posted: "2026-06-01" },
    { slug: "b-newest", posted: "2026-10-05" },
    { slug: "c-mid", posted: "2026-08-01" },
    { slug: "d-undated" },
    { slug: "e-not-a-date", posted: "soon" },
    { slug: "f-tie", posted: "2026-08-01" },
    { slug: "g-timestamp", posted: "2026-10-04T23:00:00.000Z" },
  ];
  const t = office.bulletinTeaserOf(listing, { limit: 200 });
  assert.deepEqual(t.entries.map((e) => e.slug), ["b-newest", "g-timestamp", "f-tie", "c-mid", "a-old", "e-not-a-date", "d-undated"]);
  assert.equal(t.total, 7);
  assert.equal(t.complete, true);
  // the walk the more_note names reaches the same order a page at a time
  const first = office.bulletinTeaserOf(listing, { limit: 3 });
  const second = office.bulletinTeaserOf(listing, { limit: 3, offset: first.next_offset });
  assert.deepEqual([...first.entries, ...second.entries].map((e) => e.slug), ["b-newest", "g-timestamp", "f-tie", "c-mid", "a-old", "e-not-a-date"]);
  // the listing it was handed is not reordered under the door that serves it whole
  assert.deepEqual(listing.map((e) => e.slug), ["a-old", "b-newest", "c-mid", "d-undated", "e-not-a-date", "f-tie", "g-timestamp"]);
});

let s = null, skip = false, api, db, postings;

before(async () => {
  assert.ok(existsSync(BULLETIN_DIR), `the pinned town clone has no TOWN_BULLETIN at ${BULLETIN_DIR}`);
  postings = townPostings();
  db = fixtureDb();
  db.exec("DELETE FROM bulletin");
  const b = db.prepare("INSERT INTO bulletin VALUES (?, ?)");
  for (const p of postings) b.run(p.slug, JSON.stringify(p));
  s = await startStore();
  if (s.skip) { skip = s.skip; return; }
  const w = await s.connect("law_ingester");
  await copyIndexToStore(w, db);
  await w.end();
  api = await s.connect("office_api");
});

after(async () => {
  if (api) await api.end().catch(() => {});
  if (s?.stop) await s.stop();
});

test("the pinned town: the slugs are out of date order, and the office.db twin lists the newest posting first", () => {
  const want = expectedOrder(postings);
  const bySlugReversed = postings.map((p) => p.slug).sort().reverse();
  assert.notDeepEqual(bySlugReversed, want, "the pinned town's slug order must differ from its date order, or this proves nothing");
  const all = office.bulletinTeaser(db, { limit: 200 });
  assert.deepEqual(all.entries.map((e) => e.slug), want);
  // the doorstep's segment is the same read at its own bound
  const page = office.bulletinTeaser(db, { limit: 3 });
  assert.deepEqual(page.entries.map((e) => e.slug), want.slice(0, 3));
  const newest = postings.reduce((m, p) => (p.data.posted && (!m || p.data.posted > m.data.posted) ? p : m), null);
  assert.equal(page.entries[0].slug, newest.slug, `the newest posting (${newest.slug}, ${newest.data.posted}) leads`);
});

test("the pinned town: the store twin lists the same order as the office.db twin", async (t) => {
  if (skip) return t.skip(skip);
  const want = expectedOrder(postings);
  for (const a of [{ limit: 200 }, { limit: 3 }, { limit: 3, offset: 3 }, {}]) {
    const fromStore = await store.bulletinTeaser(api, a);
    assert.equal(JSON.stringify(fromStore), JSON.stringify(office.bulletinTeaser(db, a)), `bulletinTeaser ${JSON.stringify(a)}`);
  }
  assert.deepEqual((await store.bulletinTeaser(api, { limit: 200 })).entries.map((e) => e.slug), want);
});

// ── standing: "papers" names what paperGapRows checks ─────────────────────────

// Each gap paperGapRows can raise, and the word the descriptions use for it.
const PAPER_WORDS = { "tend-your-home": "HOME page", "hang-your-window": "window", "walk-the-world": "parcel" };

test("paperGapRows checks exactly three papers, and both descriptions name those three", async () => {
  // a settled resident with nothing done: no home, no window, no parcel
  const gaps = await paperGapRows("nobody-yet", {
    db: fixtureDb(), clone: null,
    worldBlock: async () => ({ sited: false }),
    parcelClaim: async () => null,
  });
  assert.deepEqual(gaps.map((g) => g.id).sort(), Object.keys(PAPER_WORDS).sort(), "a new paper check needs its word in the descriptions below");
  for (const [label, text] of [["read: standing", HOUSEHOLD_READS.standing], ["the household tool", HOUSEHOLD_DESCRIPTION]]) {
    for (const word of Object.values(PAPER_WORDS)) assert.ok(text.includes(word), `${label} names the ${word}`);
  }
  assert.equal(HOUSEHOLD_READS.standing,
    "your tier, residents, papers (checks your HOME page, window and parcel, nothing else), what moves you forward, and world_writes: the world-write budget (used of cap, reset, verbs counted)");
  assert.ok(HOUSEHOLD_DESCRIPTION.includes("your residents and papers (each settled resident's HOME page, window and parcel; nothing else is checked)"));
});
