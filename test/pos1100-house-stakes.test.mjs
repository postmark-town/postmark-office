// pos1100-house-stakes.test.mjs — everything the house has stamps behind, from the ledger (POS-1100).
//
//   node --import ./test/helpers/sparse-guard.mjs --import ./test/helpers/town-pins-env.mjs --test test/pos1100-house-stakes.test.mjs
//
// THE RULING (Darko, 2026-11-16 22:30 EST, POS-844 call 7): "I think the idea is right that we should have a household
// list of everything the house has stamps behind, but we do need to keep in mind that aggregates will likely be
// necessary … we shouldn't allow households to bloat their own household apex read beyond readability just by staking
// on lots of different things, keeping in mind that some households have like 2K plus stamps at this point."
//
// WHAT THESE PIN, over a scratch town (a real signed ledger the town's own tools wrote, read by the town's own
// folds): the list's rows add up to the house's escrow in the ledger (marks, posts, pots and ballots together, and
// equal to the town's `foldStaked`); each place a house sees its stakes counts a post stake (the list, the glance's
// aggregate, the doorstep segment, the Hearth's `went` kind); the glance carries the aggregate and never the list,
// flat in size; the list pages as every list read pages.
//
// Synthetic handles, marks and posts throughout.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { townClone, NO_TOWN } from "./fixture-paths.mjs";
import { copyTownTools } from "./helpers/town-tools.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";
import { pinTown } from "./helpers/pinned-town.mjs";
import { importTownTool } from "../src/town-tool.mjs";
import { houseStakes, aggregateOf, pageStakes, openPositions, ledgerPositions, STAKE_KINDS } from "../src/household-stakes.mjs";
import { wentRows, wentKind, stampsBlock, stakesAggregate } from "../src/household-read-v2.mjs";
import { stakesFor } from "../src/doorstep-stakes.mjs";
import { PAGE_BYTES, textBytes } from "../src/household-read-page.mjs";

const TOWN = townClone();
const skip = NO_TOWN && !TOWN ? "no town clone here" : false;
const ident = ["-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid"];
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// ── the scratch town ─────────────────────────────────────────────────────────
const ANA = "sbx-ana", BO = "sbx-bo", CY = "sbx-cy";
const HOUSE = [ANA, BO];                 // the house under test; CY is another house
const DAY = "2026-11-10";
let town, pem, M;
const ledgerPath = () => join(town, "WHITE_PAGES", "stamp-ledger.md");
const entries = () => M.parseStampLedger(readFileSync(ledgerPath(), "utf8"));

if (!skip) {
  town = tempDir("pos1100-town-");
  mkdirSync(join(town, "WHITE_PAGES"), { recursive: true });
  copyTownTools(TOWN, town);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(join(town, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  pem = privateKey.export({ type: "pkcs8", format: "pem" });
  execFileSync("git", ["init", "-q", "-b", "main", town]);
  process.env.TOWN_PINS_DIR = pinTown(town);
  M = await importTownTool(town, "stamp-mint.mjs");
  const gift = (handle, n) => M.giftLine({ date: "2026-09-01", handle, n, slug: `seed-${handle}`, by: "the-town" });
  M.appendSigned(town, [
    M.rulesLine("2026-06-12"), gift(ANA, 1000), gift(BO, 1000), gift(CY, 1000),
    // marks: ana on her own idea mark and on cy's plain mark (one stamp taken back), bo on cy's bounty mark, cy on ana's idea mark (not the house's)
    M.worldStakeLine({ date: DAY, handle: ANA, mark: "sbx-ana/idea-mark", n: 4, via: "api" }),
    M.worldStakeLine({ date: DAY, handle: ANA, mark: "sbx-cy/plain-mark", n: 3, via: "api" }),
    M.worldUnstakeLine({ date: DAY, mark: "sbx-cy/plain-mark", handle: ANA, n: 2 }),
    M.worldStakeLine({ date: DAY, handle: BO, mark: "sbx-cy/bounty-mark", n: 3, via: "api" }),
    M.worldStakeLine({ date: DAY, handle: CY, mark: "sbx-ana/idea-mark", n: 9, via: "api" }),
    // posts: ana on her own idea post, bo on cy's; cy on ana's (not the house's); bo against a third (one stamp)
    M.postStakeLine({ date: DAY, handle: ANA, post: "sbx-ana/idea-post", n: 5, side: "for", via: "api" }),
    M.postStakeLine({ date: DAY, handle: BO, post: "sbx-cy/idea-post", n: 6, side: "for", via: "api" }),
    M.postStakeLine({ date: DAY, handle: CY, post: "sbx-ana/idea-post", n: 1, side: "for", via: "api" }),
    M.postStakeLine({ date: DAY, handle: BO, post: "sbx-cy/other-post", n: 1, side: "against", via: "api" }),
    // a pot: ana stakes seven and takes two back
    M.potStakeLine({ date: DAY, handle: ANA, pot: "sbx-pot", n: 7, via: "api" }),
    M.potUnstakeLine({ date: DAY, pot: "sbx-pot", handle: ANA, n: 2, via: "api" }),
    // a ballot: bo's eight stand; ana's two came home at the close
    M.stakeLine({ date: DAY, handle: BO, topic: "sbx-topic", candidate: "sbx-c1", n: 8, via: "api" }),
    M.stakeLine({ date: DAY, handle: ANA, topic: "sbx-topic", candidate: "sbx-c1", n: 2, via: "api" }),
    M.returnLine({ date: DAY, topic: "sbx-topic", candidate: "sbx-c1", handle: ANA, n: 2 }),
  ], pem);
  git(town, "add", "-A"); git(town, ...ident, "commit", "-q", "--allow-empty", "-m", "fixture ledger");
}

const CLASS_OF_MARK = { "sbx-ana/idea-mark": "idea", "sbx-cy/bounty-mark": "bounty", "sbx-cy/plain-mark": null };
const markClass = async (id) => (id in CLASS_OF_MARK ? CLASS_OF_MARK[id] : undefined);
const postClasses = async (ids) => new Map(ids.map((id) => [id, "idea"]));
const readers = (over = {}) => ({ townClone: town, markClass, postClasses, ...over });

// THE INDEPENDENT TOTAL, from the town's own per-family folds and never from this lane's fold: the marks, the posts and the
// pots by the folds the stake doors already trust, the ballot's open stake read off the lines it was written from.
function independentEscrow(handles) {
  const mine = new Set(handles);
  const sumBy = (map) => [...map].filter(([k]) => mine.has(k.slice(k.lastIndexOf("|") + 1))).reduce((n, [, v]) => n + (typeof v === "number" ? v : v.n), 0);
  const marks = sumBy(M.foldWorldMarkPositions(entries()));
  const pots = sumBy(M.foldPotPositions(entries()));
  const posts = sumBy(ENG_state().positions);
  return { marks, posts, pots, ballots: 8 };   // bo's ballot stake of 8 (ana's was returned)
}
let ENG;
if (!skip) ENG = await import("../src/post-stake-engine.mjs");
const ENG_state = () => ENG.postStakeState(M, entries());

// ── the list is the ledger's ─────────────────────────────────────────────────

test("THE LIST ADDS UP TO THE LEDGER: marks, posts, pots and ballots together equal the house's escrow, and the town's own foldStaked", { skip }, async () => {
  const s = await houseStakes(HOUSE, readers());
  assert.equal(s.unavailable, undefined, s.unavailable);
  const want = independentEscrow(HOUSE);
  assert.deepEqual(want, { marks: 8, posts: 12, pots: 5, ballots: 8 }, "the independent folds, per family (marks 4 + 1 + 3, posts 5 + 6 + 1, the pot's 5, the ballot's 8)");
  const total = want.marks + want.posts + want.pots + want.ballots;
  assert.equal(s.total, total, `LAW (Wright on Darko 22:30, POS-1100): "the totals your read reports must equal the house's escrow in the stamp ledger, mark stakes and post stakes together": ${JSON.stringify(want)}`);
  assert.equal(s.total, HOUSE.reduce((n, h) => n + (M.foldStaked(entries()).get(h) ?? 0), 0), "and it is the town's own staked tense for those residents");
  assert.equal(s.total, 4 + 1 + 3 + 5 + 6 + 1 + 5 + 8, "by hand from the ledger lines above: 4 + 1 + 3 on marks, 5 + 6 + 1 on posts, 5 on the pot, 8 on the ballot");
  // a house nobody staked for reads zero, never unavailable
  const none = await houseStakes(["sbx-nobody"], readers());
  assert.deepEqual([none.total, none.count, none.rows], [0, 0, []]);
});

test("each row says what it is, how much is the HOUSE'S, and whether it is at risk; the other house's stamps on the same thing are not counted", { skip }, async () => {
  const s = await houseStakes(HOUSE, readers({ atRisk: new Set(["sbx-cy/plain-mark"]) }));
  const by = Object.fromEntries(s.rows.map((r) => [`${r.kind}:${r.id}`, r]));
  assert.deepEqual(Object.keys(by).sort(), [
    "ballot:sbx-topic/sbx-c1", "bounty:sbx-cy/bounty-mark", "idea:sbx-ana/idea-mark", "idea:sbx-ana/idea-post", "idea:sbx-cy/idea-post",
    "idea:sbx-cy/other-post", "mark:sbx-cy/plain-mark", "pot:sbx-pot"]);
  assert.equal(by["idea:sbx-ana/idea-mark"].stamps, 4, "cy's 9 on the same mark are not the house's");
  assert.equal(by["idea:sbx-ana/idea-post"].stamps, 5, "cy's 1 on the same post is not the house's");
  assert.equal(by["mark:sbx-cy/plain-mark"].stamps, 1, "three staked, two taken back: the open position");
  assert.equal(by["ballot:sbx-topic/sbx-c1"].stamps, 8, "ana's ballot stake came home at the close and is not a row");
  assert.equal(by["pot:sbx-pot"].stamps, 5);
  assert.equal(by["idea:sbx-cy/other-post"].side, "against", "the side is said when it is not for");
  assert.equal(by["idea:sbx-ana/idea-post"].own, true, "your own idea, backed by your own house");
  assert.equal(by["idea:sbx-cy/idea-post"].own, undefined);
  assert.equal(s.rows[0].id, "sbx-cy/plain-mark", "the at-risk row is first, though it is the smallest");
  assert.equal(s.rows[0].at_risk, true);
  assert.equal(by["pot:sbx-pot"].at_risk, false, "a pot, a post and a ballot are never swept");
  assert.deepEqual(by["idea:sbx-ana/idea-post"].by, [{ handle: ANA, stamps: 5 }]);
  const unmeasured = await houseStakes(HOUSE, readers({ atRisk: null }));
  assert.equal(unmeasured.rows.find((r) => r.id === "sbx-cy/plain-mark").at_risk, null, "a verdict nobody measured is null, never safe");
});

test("a kind nobody could read is said, never guessed: a mark with no readable class is a mark, a post with none is a post", { skip }, async () => {
  const s = await houseStakes(HOUSE, readers({ markClass: async () => { throw new Error("no world"); }, postClasses: async () => { throw new Error("no store"); } }));
  assert.equal(s.total, 33, "the money does not depend on the kinds");
  assert.deepEqual([...new Set(s.rows.map((r) => r.kind))].sort(), ["ballot", "mark", "post", "pot"]);
  assert.match(s.kind_note, /could not be read/);
});

test("THE GUARD: a fold that cannot agree with the ledger shows no number, and names both", { skip }, async () => {
  const real = await ledgerPositions(town);
  const short = new Map(real.positions);
  short.delete(`post|sbx-ana/idea-post|${ANA}`);   // one position lost: the total is then short by five
  const s = await houseStakes(HOUSE, { ...readers(), fold: async () => ({ positions: short, staked: real.staked }) });
  assert.equal(s.total, undefined);
  assert.match(s.unavailable, /the stakes read 28 stamps behind this house and the ledger's own fold says 33/);
  assert.equal(aggregateOf(s).total, undefined, "and the aggregate says unavailable, not a smaller number");
});

test("openPositions walks foldStaked's own lines: a stake and its way out net to nothing, whatever the family", { skip }, () => {
  const pos = openPositions(M, entries());
  const open = [...pos.values()].map((p) => `${p.family}|${p.target}|${p.handle}|${p.n}`).sort();
  assert.ok(open.includes(`mark|sbx-cy/plain-mark|${ANA}|1`));
  assert.ok(!open.some((k) => k.startsWith(`ballot|sbx-topic/sbx-c1|${ANA}`)), "a returned ballot stake is no position");
  const all = [...pos.values()].reduce((n, p) => n + p.n, 0);
  assert.equal(all, [...M.foldStaked(entries()).values()].reduce((a, b) => a + b, 0), "every handle's positions together are every handle's staked tense together");
});

// ── the aggregate, flat ──────────────────────────────────────────────────────

const manyRows = (n) => Array.from({ length: n }, (_, i) => ({ kind: STAKE_KINDS[i % 5], id: `sbx-${i % 7}/thing-${i}`, stamps: 1 + (i % 9), at_risk: false, by: [{ handle: ANA, stamps: 1 + (i % 9) }] }));
const fixtureOf = (rows) => ({ total: rows.reduce((n, r) => n + r.stamps, 0), count: rows.length, rows, ledger_staked: rows.reduce((n, r) => n + r.stamps, 0) });

test("THE AGGREGATE: the total, the count, a count per kind and what is at risk first; never the list", { skip }, async () => {
  const s = await houseStakes(HOUSE, readers({ atRisk: new Set(["sbx-cy/plain-mark"]) }));
  const a = aggregateOf(s);
  assert.deepEqual(Object.keys(a)[0], "at_risk", "at risk leads");
  assert.deepEqual(a, { at_risk: 1, total: 33, count: 8, by_kind: { idea: 4, bounty: 1, mark: 1, pot: 1, ballot: 1 } });
  assert.equal("rows" in a, false);
});

test("the glance's stamps block carries the aggregate and its size is flat however many things a house stakes on", () => {
  const details = [{ handle: ANA, tenses: { liquid: 10, staked: 33, minted: 40 } }];
  const small = stampsBlock(details, { stakes: aggregateOf(fixtureOf(manyRows(8))) });
  const huge = stampsBlock(details, { stakes: aggregateOf(fixtureOf(manyRows(2000))) });
  assert.equal("rows" in huge.stakes, false, "the glance never carries the list");
  assert.deepEqual(Object.keys(huge.stakes), ["at_risk", "total", "count", "by_kind", "list"]);
  assert.equal(huge.stakes.count, 2000);
  assert.equal(huge.stakes.list, 'household { read: "stakes" }', "and says where the list is");
  const grown = JSON.stringify(huge).length - JSON.stringify(small).length;
  assert.ok(grown <= 32, `2000 stakes cost ${grown} more characters than 8 (digits only), not a row each`);
  assert.ok(JSON.stringify(huge.stakes).length < 220, `the aggregate stays small: ${JSON.stringify(huge.stakes).length}`);
  assert.deepEqual(stampsBlock(details, {}).stakes, undefined, "a house read with no stakes aggregate says nothing new");
  assert.deepEqual(stakesAggregate({ unavailable: "no ledger" }), { unavailable: "the ledger could not be read, so this is unknown, not zero", list: 'household { read: "stakes" }' }, "an unread ledger is said short, never zero");
  assert.equal("stakes" in stampsBlock(details, { stakes: aggregateOf(fixtureOf([])) }), false, "a house with nothing staked leaves the block out: staked: 0 is the whole answer");
});

// ── the list pages as every list read pages ──────────────────────────────────

test("THE LIST PAGES: limit (default 20), offset, next_offset and more_note, the aggregate beside it, held under the 10K ceiling", () => {
  const stakes = fixtureOf(manyRows(45));
  const p1 = pageStakes(stakes, {});
  assert.deepEqual([p1.shown, p1.limit, p1.offset, p1.complete, p1.next_offset], [20, 20, 0, false, 20]);
  assert.equal(p1.count, 45, "the aggregate's own count is the whole house's, not the page's");
  assert.match(p1.more_note, /^25 further stakes — call again with offset: 20$/);
  const p3 = pageStakes(stakes, { offset: p1.next_offset + 20 });
  assert.deepEqual([p3.shown, p3.complete, p3.next_offset, p3.more_note], [5, true, undefined, undefined], "the last page says it is the last");
  assert.deepEqual(pageStakes(stakes, { limit: 5, offset: 40 }).rows.map((r) => r.id), stakes.rows.slice(40, 45).map((r) => r.id));
  assert.equal(pageStakes(stakes, { limit: 100000 }).limit <= 200, true, "a huge limit is clamped");
  const seen = [];
  for (let off = 0; off != null;) { const p = pageStakes(stakes, { offset: off }); seen.push(...p.rows.map((r) => r.id)); off = p.next_offset; }
  assert.deepEqual(seen, stakes.rows.map((r) => r.id), "walking next_offset reads every row exactly once");
  const long = fixtureOf(manyRows(150).map((r) => ({ ...r, id: `sbx-0/${"a-very-long-slug-".repeat(18)}${r.id}`, by: Array.from({ length: 6 }, (_, i) => ({ handle: `sbx-handle-${i}`, stamps: 1 })) })));
  const wide = pageStakes(long, { limit: 200 });
  assert.ok(textBytes(wide) <= PAGE_BYTES, `a page of long rows is held under the ceiling: ${textBytes(wide)}`);
  assert.ok(wide.shown < 200 && wide.limit === wide.shown, "and says how many fit");
  assert.equal(pageStakes({ unavailable: "no ledger" }, {}).unavailable, "no ledger");
});

// ── each place a house sees its stakes counts a post stake ───────────────────

test("THE DOORSTEP SEGMENT and THE STAKES READ carry what the house has stamps behind, posts included; the segment the aggregate, the read the page", { skip }, async () => {
  const world = async () => ({ state: { marks: [{ id: "sbx-ana/idea-mark", kind: "sited", by: ANA, household: "sbx-house" }] }, ref: "origin/main" });
  const allocation = (handles, o) => houseStakes(handles, { ...o, ...readers() });
  const base = { world, registry: async () => ({}), escrow: async () => ({ townSha: "abc", byMark: new Map(), reason: null }), rule: async () => null, pathAt: async () => () => null, allocation };
  const seg = await stakesFor(HOUSE, base);
  assert.deepEqual(seg.allocation, { at_risk: 0, total: 33, count: 8, by_kind: { idea: 4, bounty: 1, mark: 1, pot: 1, ballot: 1 } },
    "the segment's own marks list stays as it was, and the allocation beside it counts the post stakes (idea: two marks' worth, two posts)");
  assert.equal(seg.allocation.by_kind.idea, 4, "ideas: the idea mark, two idea posts, and the against-side post");
  const paged = await stakesFor(HOUSE, { ...base, allocationPage: { limit: 3, offset: 0 } });
  assert.deepEqual([paged.allocation.shown, paged.allocation.total, paged.allocation.count, paged.allocation.next_offset], [3, 33, 8, 3]);
  assert.match(paged.allocation.more_note, /5 further stakes/);
  assert.match(paged.allocation.key, /everything your house has stamps behind/);
  const empty = await stakesFor(["sbx-nobody"], base);
  assert.equal("allocation" in empty, false, "the morning page does not fatten: nothing staked, nothing said on the doorstep item");
  const unread = await stakesFor(HOUSE, { ...base, allocation: async () => ({ unavailable: "no ledger" }) });
  assert.equal("allocation" in unread, false, "and an unread ledger is said by the stakes read, not the doorstep item");
  assert.equal((await stakesFor(HOUSE, { ...base, allocation: async () => ({ unavailable: "no ledger" }), allocationPage: {} })).allocation.unavailable, "no ledger", "which says it in words");
  const dead = await stakesFor(HOUSE, { ...base, allocation: async () => { throw new Error("ledger down"); } });
  assert.match(dead.allocation.unavailable, /could not be read/, "a ledger that fails is said, never a zero");
});

test("THE HEARTH'S WENT KIND: a stake behind an idea post is an idea, as a stake behind a mark is not", () => {
  const lines = [
    { canonical: `- ${DAY} · ${ANA} → stake:post/sbx-cy/idea-post · 6 · side: for · via: api`, written_at: `${DAY}T10:00:00Z` },
    { canonical: `- ${DAY} · ${ANA} → stake:world-mark/sbx-cy/plain-mark · 3 · via: api`, written_at: `${DAY}T10:01:00Z` },
    { canonical: `- ${DAY} · ${ANA} → stake:pot/sbx-pot · 7 · via: api`, written_at: `${DAY}T10:02:00Z` },
    { canonical: `- ${DAY} · stake:post/sbx-cy/idea-post → ${ANA} · 6 · for: unstake · via: api`, written_at: `${DAY}T10:03:00Z` },
  ];
  const rows = wentRows(lines, new Set([ANA]), { house: [ANA, BO] });
  assert.deepEqual(rows.map((r) => [r.to, r.kind, r.stamps]), [
    ["stake:post/sbx-cy/idea-post", "idea", 6], ["stake:world-mark/sbx-cy/plain-mark", "mark", 3], ["stake:pot/sbx-pot", "pot", 7]],
    "the post stake was `other` until POS-1100; the way back out is not a stamp that went");
  assert.equal(wentKind("stake:post/sbx-a/b", null), "idea");
  assert.equal(wentKind("stake:world-mark/sbx-a/b", null, new Set(["sbx-a/b"])), "idea", "an idea mark still standing keeps its kind");
});
