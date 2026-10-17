// town-index-reads.test.mjs — each reader moved to the store answers exactly
// what its office.db twin answered (POS-268's gate for a moved reader).
//
//   EMBEDDED_PG_DIR=<dir with embedded-postgres> node --test test/town-index-reads.test.mjs
//
// The store is seeded from the fixture town's rows (helpers/index-to-store.mjs).
// Each reader is asked a spread of questions, and each answer is compared whole,
// as bytes, to the twin's answer over the same rows, recorded in the last tree
// that had office.db (helpers/twin-golden.mjs, POS-656).
//
// The fixture is test/fixture.mjs's town plus the history rows the ports had to
// get right: tied commit times (sqlite breaks the tie by sha), mixed-case paths
// and authors (sqlite's LIKE folds ASCII case), a `%` and a `_` in a path (the
// escape), a backslash in an author (that LIKE has no escape), and a commit with
// more than 100 files (the cap and files_total). Without a Postgres the file
// SKIPS and says so.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { fixtureTown, putValues } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { seedTownIndex } from "./helpers/index-to-store.mjs";
import { twinGolden } from "./helpers/twin-golden.mjs";
import * as store from "../src/town-index-store.mjs";

const TWINS = twinGolden("town-index-reads");
let s = null, skip = false, api, db;

before(async () => {
  s = await startStore();
  if (s.skip) { skip = s.skip; return; }
  db = fixtureTown();
  const log = (...v) => putValues(db, "repo_log", v);
  // two commits at the same second: sqlite orders the tie by sha
  log("b2sha", "2026-07-20T10:00:00.000Z", "Postmark Pen", "ferry: 2 delivered", "A", "WHITE_PAGES/limen/inbox/a.md");
  log("a1sha", "2026-07-20T10:00:00.000Z", "Postmark Pen", "mint: crossing pass", "M", "WHITE_PAGES/stamp-ledger.md");
  // case, and the characters LIKE treats specially
  log("d4sha", "2026-07-21T09:00:00.000Z", "Keemin\\Lee", "odd path", "A", "PROJECTS/Build_The-Town/100%.md");
  log("d4sha", "2026-07-21T09:00:00.000Z", "Keemin\\Lee", "odd path", "A", "PROJECTS/BuildXThe-Town/other.md");
  // a commit over the 100-file cap, files inserted out of name order
  for (let i = 0; i < 103; i++)
    log("e5sha", "2026-07-22T12:00:00.000Z", "Postmark Pen", "seal: re-seal at the crossing", "M", `WHITE_PAGES/w${String((i * 37) % 103).padStart(3, "0")}/window.html`);
  // an id that sorts differently bytewise ("B" < "a") than in an English
  // collation ("a" < "B"): without COLLATE "C" the store's page order moves
  putValues(db, "regions", ["B-side", "the B Side", JSON.stringify({
    id: "B-side", name: "the B Side", holder: "wright", body: "# B\n\nThe far bank.", images: [], residents: ["wright"] })]);
  putValues(db, "regions", ["a-quay", "the Low Quay", JSON.stringify({
    id: "a-quay", name: "the Low Quay", holder: "limen", body: "", images: [],
    residents: Array.from({ length: 30 }, (_, i) => `r${i}`) })]);
  // the bulletin: date-led slugs, a human-gated notice, an upper-case slug that
  // sorts first bytewise and not in an English collation, and a posting with no
  // frontmatter at all (README's shape)
  const b = (...v) => putValues(db, "bulletin", v);
  b("2026-07-20-the-quay-floods", JSON.stringify({ slug: "2026-07-20-the-quay-floods", data: { title: "The quay floods", posted: "2026-07-20", kind: "announcement", teaser: "Spring tide." }, body: "# The quay floods\n\nMind the steps." }));
  b("2026-07-21-a-human-please", JSON.stringify({ slug: "2026-07-21-a-human-please", data: { title: "A human, please", human_gated: "true" }, body: "Ask your human to look." }));
  b("README", JSON.stringify({ slug: "README", data: {}, body: "# The board\n\nWhat goes here." }));
  b("a-note", JSON.stringify({ slug: "a-note", data: { title: "A note" }, body: "Before README in English, after it bytewise." }));
  // stamps: a tie in balance (the handle breaks it, bytewise), a patron's holo
  // with its receipt, a receipt ref two receipts share, and a keeping-mint row
  const st = (...v) => putValues(db, "stamps", v, ["handle", "balance", "mint_count", "staked"]);
  st("Zed", 4, 4, 0);
  st("stake:the-quay/wright", 2, 0, 0);
  putValues(db, "pot_receipts", ["the-quay-fund", "stripe", 25, "2026-07-10", "rc-1", "wright"], ["pot", "rail", "usd", "date", "receipt", "payer"]);
  putValues(db, "pot_receipts", ["the-quay-fund", "stripe", 5, "2026-07-10", "rc-1", "wright"], ["pot", "rail", "usd", "date", "receipt", "payer"]);
  putValues(db, "funding_holo", ["wright", "the-quay-fund", 3, "2026-07", "2026-07-10", "rc-1"], ["party", "pot", "holo", "epoch", "date", "receipt"]);
  putValues(db, "funding_holo", ["wright", "the-quay-fund", 1, "2026-07", "2026-07-09", "rc-none"], ["party", "pot", "holo", "epoch", "date", "receipt"]);
  putValues(db, "funding_keeping_mint", ["wright", "keeping", 2, "2026-07", "2026-07-11"], ["party", "pot", "n", "epoch", "date"]);
  const w = await s.connect("law_ingester");
  await seedTownIndex(w, db);
  await w.end();
  api = await s.connect("office_api");   // the doors' own role
});

after(async () => {
  if (api) await api.end().catch(() => {});
  if (s?.stop) await s.stop();
});

// Compared as the bytes a door sends (JSON.stringify), which also holds the key
// ORDER equal, against the twin's recorded answer under the same label.
const same = async (label, newAnswer) => TWINS.equal(label, JSON.stringify(await newAnswer));

test("repoLog: every filter, page and cap answers as its office.db twin did", async (t) => {
  if (skip) return t.skip(skip);
  const asks = [
    {}, { limit: 1 }, { limit: 2, offset: 1 }, { limit: 200 }, { offset: 3 }, { offset: 99 },
    { path: "WHITE_PAGES/" }, { path: "white_pages/wright" }, { path: "PROJECTS/Build_The" }, { path: "projects/build_the-town/100%" },
    { path: "WHITE_PAGES/w0" }, { author: "postmark" }, { author: "KEEMIN" }, { author: "keemin\\lee" }, { author: "%" },
    { since: "2026-07-12" }, { until: "2026-07-05" }, { since: "2026-07-05T08:30:00.000Z", until: "2026-07-20" },
    { since: "2026-07-20", limit: 1, offset: 1 }, { limit: "x" }, { limit: -4, offset: -1 },
  ];
  for (const a of asks) await same(`repoLog ${JSON.stringify(a)}`, store.repoLog(api, a));
});

test("regionList and regionOne answer as their office.db twins did", async (t) => {
  if (skip) return t.skip(skip);
  for (const a of [{}, { limit: 1 }, { limit: 1, offset: 1 }, { offset: 5 }, { limit: 500 }])
    await same(`regionList ${JSON.stringify(a)}`, store.regionList(api, a));
  for (const slug of ["the-terrace", "the Trueing Terrace", "a-quay", "the Low Quay", "nowhere", ""])
    await same(`regionOne ${slug}`, store.regionOne(api, slug));
});

test("bulletinList, bulletinTeaser and bulletinEntry answer as their office.db twins did", async (t) => {
  if (skip) return t.skip(skip);
  await same("bulletinList", store.bulletinList(api));
  for (const a of [{}, { limit: 1 }, { limit: 2, offset: 1 }, { offset: 3 }, { limit: 0 }, { limit: "x", offset: -2 }])
    await same(`bulletinTeaser ${JSON.stringify(a)}`, store.bulletinTeaser(api, a));
  for (const slug of ["settling-in", "2026-07-21-a-human-please", "README", "nope"])
    await same(`bulletinEntry ${slug}`, store.bulletinEntry(api, slug));
});

test("home answers as its office.db twin did, its freshness dated by the store's own as-of", async (t) => {
  if (skip) return t.skip(skip);
  for (const h of ["wright", "limen", "postmaster", "nobody"])
    await same(`home ${h}`, store.home(api, h));
  // A caller's asOf is the OTHER index's clock: the store's reader dates its row
  // by its own head, so a stray asOf changes nothing it answers.
  await same("home wright, a caller's asOf ignored", store.home(api, "wright", { asOf: "someothersha" }));
});

test("stampsRoster and stampsDetail answer as their office.db twins did", async (t) => {
  if (skip) return t.skip(skip);
  for (const a of [{}, { limit: 1 }, { limit: 2, offset: 1 }, { offset: 9 }, { limit: "x" }])
    await same(`stampsRoster ${JSON.stringify(a)}`, store.stampsRoster(api, a));
  for (const h of ["wright", "limen", "Zed", "nobody"])
    await same(`stampsDetail ${h}`, store.stampsDetail(api, h));
});

test("the store's as-of is the index's own", async (t) => {
  if (skip) return t.skip(skip);
  TWINS.equal("indexAsOf", await store.townIndexAsOf(api));
});
