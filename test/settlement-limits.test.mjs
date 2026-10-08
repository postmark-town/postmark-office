// settlement-limits.test.mjs — THE SETTLEMENT APPLIES THE PARCEL LIMITS, ON THE
// PRODUCTION PATHS, WITH THE WORLD'S OWN ENGINE (POS-364; Wright's review of #441).
//
//   node --test test/settlement-limits.test.mjs
//
// THE RIG. A real Postgres (embedded-store.mjs) holding one settlement whose
// snapshot carries one household's parcels, and the marks and claims rows a
// parcel's FIRST claim is read from (world-snapshot.mjs § withClaimedAt). The
// engine is the world's own, materialised from the office's world clone at
// ENGINE: world#166, the first engine that orders parcels by their first claim
// (and carries world#146's town word, which is how a limit is carried). The
// pinned clone's own HEAD predates both, and serves as the old-engine control.
//
// ⚑ MERGE ORDER: world#166 before this file can pass on CI. The suite fetches
// world main's objects, so ENGINE is in the clone once #166 is on main; before
// that the engine check below fails by name, never skips.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";
import { settlementRig, WORLD, LAW_SHA, TOWN_SHA } from "./helpers/settlement-seed.mjs";
import { servedSettlement, settlementTakesAway, resetSettlementCaches, foldText } from "../src/world-settlement.mjs";
import { settlementWithhold } from "../world2/tools/fold-input-cli.mjs";

const ENGINE = "a01213a822fbddeec31dfdd0dfb72afb9b6b9367";   // postmark-world#166 (first-claim order), on #146 and #165
const git = (...a) => execFileSync("git", ["-C", WORLD, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const hasEngine = (() => { try { git("cat-file", "-e", `${ENGINE}^{commit}`); return true; } catch { return false; } })();

const store = await startStore({ db: "settlement_limits_test" });
const { owner, asOffice, seal } = settlementRig(store);

const ONE = "hh:one-house";
const box = (x) => ({ at: { x, y: 0 }, extent: { w: 25, h: 25 } });
const parcel = (by, x, date) => ({ slug: `${by}/plot`, kind: "parcel", owner: by, body: `${by}'s plot`, geometry: box(x), parent: null, data: { date, tier: "market" } });
const shed = (by, x) => ({ slug: `${by}/shed`, kind: "sited", owner: by, body: `${by}'s shed`, geometry: { at: { x, y: 0 }, extent: { w: 4, h: 4 } }, parent: null, data: { date: "2026-10-05T00:00:00Z", tier: "market" } });
const uuid = (n) => `7${String(n).padStart(7, "0")}-0000-4000-8000-000000000000`;

/**
 * One settlement, S11 at window 501, sealed over `parcels` with `lawSha`. Each
 * parcel gets a marks row and its ORIGIN claim (the id the mark keeps for life)
 * dated `firstClaimed[slug]` (or its own date), so its first claim is a source.
 */
async function settle({ parcels, firstClaimed = {}, lawSha = ENGINE, stakes = [] }) {
  resetSettlementCaches();
  return owner(async (c) => {
    await c.query("TRUNCATE world_snapshot_folds, settlements, world_snapshots, world_snapshot_marks, mark_versions, law_projection, escrow_projection, acts, claims, marks, windows CASCADE");
    await c.query("INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES (500, '2026-10-01T06:00Z', '2026-10-01T18:00Z', 'closed', '2026-10-01T18:00Z'), (501, '2026-10-01T18:00Z', '2026-10-02T06:00Z', 'closed', '2026-10-02T06:00Z')");
    const skeleton = JSON.parse(git("show", `${lawSha}:WORLD/skeleton.json`));
    for (const [key, data] of Object.entries(skeleton))
      await c.query("INSERT INTO law_projection (law_sha, kind, path, key, data) VALUES ($1, 'skeleton', 'WORLD/skeleton.json', $2, $3)", [lawSha, key, JSON.stringify(data)]);
    await c.query(`INSERT INTO law_projection (law_sha, kind, path, key, data) VALUES ($1, 'class', 'LOGOS/classes/hall/mark.md', 'hall', '{"id":"the-town/hall","kind":"class","class":"hall"}')`, [lawSha]);
    for (const p of [...new Map(parcels.map((x) => [x.owner, x])).values()])   // the printed roster: every resident here is one household
      await c.query("INSERT INTO law_projection (law_sha, kind, path, key, data) VALUES ($1, 'roster', 'WORLD/households.json', $2, $3)", [lawSha, p.owner, JSON.stringify({ household: ONE })]);
    // The ledger at TOWN_SHA has been ingested (an empty stake set would refuse, by design): ✦1 behind the first plot.
    for (const s of stakes.length ? stakes : [{ mark: parcels[0].slug, holder: parcels[0].owner, n: 1 }])
      await c.query("INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k) VALUES ($1, $2, $3, $3, $3, $4, 1)", [TOWN_SHA, s.mark, s.holder, s.n]);
    let n = 0;
    for (const p of parcels) {
      const id = uuid(++n);
      await c.query(
        `INSERT INTO claims (id, window_id, class, claimant, household, status, body, geometry, stake, data, slug, submitted_at, decided_at)
         VALUES ($1, 500, $8, $2, $2, 'locked', $3, $4, 0, $5, $6, $7, $7)`,
        [id, p.owner, p.body, JSON.stringify(p.geometry), JSON.stringify({ ...p.data, date: firstClaimed[p.slug] ?? p.data.date }), p.slug, firstClaimed[p.slug] ?? p.data.date, p.kind]);
      await c.query(
        `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data, parent)
         VALUES ($1, $2, $9, $3, $3, $4, $5, box(point($7::float8 - $8::float8, -$8::float8), point($7::float8 + $8::float8, $8::float8)), 'standing', 501, $6, NULL)`,
        [id, p.slug, p.owner, p.body, JSON.stringify(p.geometry), JSON.stringify(p.data), p.geometry.at.x, p.geometry.extent.w / 2, p.kind]);
    }
    return seal(c, { id: 2, window: 501, number: 11, marks: parcels, lawSha });
  });
}
const ids = (s) => s.marks.filter((m) => m.kind === "parcel").map((m) => m.id).sort();
const serve = (opts = {}) => asOffice((p) => servedSettlement(p, { worldRepo: WORLD, ...opts }));

test("the engine with the first-claim order is in the world clone (world#166 merged to world main)", () => {
  assert.ok(hasEngine, `world clone ${WORLD} holds no ${ENGINE.slice(0, 12)} — merge postmark-world#166 first; nothing in this file can test the limits on the world's own engine without it`);
});

const skip = !hasEngine;

test("AN AMENDED PARCEL KEEPS ITS PLACE: four parcels, one household, a limit of three; the one moved today is the first claim, so the fourth is opposed (R11)", { skip }, async () => {
  const parcels = [parcel("ra", 0, "2026-10-09T00:00:00Z"), parcel("rb", 100, "2026-10-02T00:00:00Z"), parcel("rc", 200, "2026-10-03T00:00:00Z"), parcel("rd", 300, "2026-10-04T00:00:00Z")];
  await settle({ parcels, firstClaimed: { "ra/plot": "2026-10-01T00:00:00Z" } });
  const s = await serve({ settlement: "S11" });
  assert.deepEqual(ids(s), ["ra/plot", "rb/plot", "rc/plot"], "ra's plot, moved today, was claimed first");
  const ret = s.returned.find((r) => r.mark === "rd/plot");
  assert.equal(ret?.law, "the-town/claim-cap", JSON.stringify(s.returned));
  assert.equal(ret.authority, "the town (absolute)");
  assert.deepEqual(s.meta.opposed.limits, [{ mark: "rd/plot", law: "the-town/claim-cap" }]);
  assert.equal(s.meta.limits_unread, undefined);
  assert.deepEqual((s.errors ?? []).filter((e) => /capped/.test(e.error)), [], "the limit's error is answered by its return");
});

test("PRIOR ESTATE STANDS: four pre-law parcels, each amended after the law, are all standing; nothing is opposed", { skip }, async () => {
  const parcels = ["pa", "pb", "pc", "pd"].map((h, i) => parcel(h, i * 100, "2026-10-08T00:00:00Z"));
  const firstClaimed = Object.fromEntries(parcels.map((p, i) => [p.slug, `2026-07-0${i + 1}T00:00:00Z`]));
  await settle({ parcels, firstClaimed });
  const s = await serve({ settlement: "S11" });
  assert.deepEqual(ids(s), ["pa/plot", "pb/plot", "pc/plot", "pd/plot"]);
  assert.deepEqual(s.meta.opposed.limits, []);
});

test("GIT IS WRITTEN FROM THE SETTLEMENT: a STAKED parcel over the cap still leaves the write-down (it stands in the World until its stakes unwind)", { skip }, async () => {
  const parcels = [parcel("ra", 0, "2026-10-01T00:00:00Z"), parcel("rb", 100, "2026-10-02T00:00:00Z"), parcel("rc", 200, "2026-10-03T00:00:00Z"), parcel("rd", 300, "2026-10-04T00:00:00Z")];
  await settle({ parcels, stakes: [{ mark: "rd/plot", holder: "rd", n: 2 }] });
  const served = await serve({ settlement: "S11" });
  assert.equal(served.returned.find((r) => r.mark === "rd/plot")?.state, "pending-escrow", "R10: it stands until its stakes unwind");
  const header = await asOffice(async (p) => (await p.query("SELECT * FROM world_snapshots WHERE id = 2")).rows[0]);
  const { slugs } = await asOffice((p) => settlementTakesAway(p, header, { worldRepo: WORLD }));
  assert.deepEqual([...slugs], ["rd/plot"], "and git never sees it: the sweep's own fold would quarantine the household");
});

test("AN ENGINE OLDER THAN THE FIRST-CLAIM ORDER applies no limit, says so, and git still withholds what it found", async () => {
  const parcels = [parcel("ra", 0, "2026-10-01T00:00:00Z"), parcel("rb", 100, "2026-10-02T00:00:00Z"), parcel("rc", 200, "2026-10-03T00:00:00Z"), parcel("rd", 300, "2026-10-04T00:00:00Z")];
  await settle({ parcels, lawSha: LAW_SHA });                      // the pinned clone's HEAD: no #146, no #166
  const s = await serve({ settlement: "S11" });
  assert.deepEqual(ids(s), ["ra/plot", "rb/plot", "rc/plot", "rd/plot"], "nothing is subtracted by hand");
  assert.match(s.meta.limits_unread ?? "", /1 parcel\(s\) over a limit \(the-town\/claim-cap\) are not opposed here/);
  const header = await asOffice(async (p) => (await p.query("SELECT * FROM world_snapshots WHERE id = 2")).rows[0]);
  const { slugs } = await asOffice((p) => settlementTakesAway(p, header, { worldRepo: WORLD }));
  assert.deepEqual([...slugs], ["rd/plot"]);
});

test("THE CROSSING'S SETTLEMENT BLOCK: the docket loses what the settlement takes away; unreadable, it loses the clearing's forecast", { skip }, async () => {
  const parcels = [parcel("ra", 0, "2026-10-01T00:00:00Z"), parcel("rb", 100, "2026-10-02T00:00:00Z"), parcel("rc", 200, "2026-10-03T00:00:00Z"), parcel("rd", 300, "2026-10-04T00:00:00Z")];
  await settle({ parcels });
  const out = { marks: parcels.map((p) => ({ slug: p.slug })), as_of: { window: 501 } };
  const selection = { entry: "fold-delta.mjs § foldDelta", docket_claims: 4, carried_absent: { checked: true, count: 0, slugs: [] } };
  const read = await asOffice((p) => settlementWithhold(p, { window: 501, worldRepo: WORLD, out, selection }));
  assert.deepEqual(read.out.marks.map((m) => m.slug), ["ra/plot", "rb/plot", "rc/plot"]);
  assert.equal(read.selection.settlement.withheld_from_docket, 1);
  assert.deepEqual(read.selection.settlement.limits, [{ mark: "rd/plot", law: "the-town/claim-cap" }]);
  // Unreadable (no world checkout): the window's own forecast is withheld instead.
  await owner((c) => c.query(`UPDATE windows SET receipts = '{"parcel_cap":{"checked":true,"over_limit":[{"slug":"rd/plot","held":3,"law":"the-town/claim-cap"}]}}' WHERE id = 501`));
  const blind = await asOffice((p) => settlementWithhold(p, { window: 501, worldRepo: null, out, selection }));
  assert.deepEqual(blind.out.marks.map((m) => m.slug), ["ra/plot", "rb/plot", "rc/plot"], "the forecast is withheld");
  assert.match(blind.selection.settlement.unread, /no --world-repo/);
  assert.deepEqual(blind.selection.settlement.withheld_by_forecast, ["rd/plot"]);
});

test("--verify over a settlement with a limit: the derivation applies the limit, and a fold kept BEFORE the deploy (no limits) is named as a difference", { skip }, async () => {
  const parcels = [parcel("ra", 0, "2026-10-01T00:00:00Z"), parcel("rb", 100, "2026-10-02T00:00:00Z"), parcel("rc", 200, "2026-10-03T00:00:00Z"), parcel("rd", 300, "2026-10-04T00:00:00Z")];
  const digest = await settle({ parcels });
  const verify = () => {
    const r = spawnSync(process.execPath, [join(WORLD, "..", "world2", "tools", "world-snapshot.mjs"), "--verify", "--window", "501", "--world-repo", WORLD],
      { encoding: "utf8", env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_PG_URL: store.url("office_api") } });
    return `${r.stdout}\n${r.stderr}`;
  };
  // A fold an office kept before this code: the cleared World, no limit applied.
  const { settlementFoldInputs, foldOver } = await import("../src/world-settlement.mjs");
  const header = await asOffice(async (p) => (await p.query("SELECT * FROM world_snapshots WHERE id = 2")).rows[0]);
  const stale = await asOffice(async (p) => foldText(foldOver(await settlementFoldInputs(p, header, { worldRepo: WORLD, townRepo: null }))));
  await owner((c) => c.query("INSERT INTO world_snapshot_folds (digest, state) VALUES ($1, $2)", [digest, stale]));
  assert.match(verify(), /the settlement \(with its seal's words\) vs the cached fold of [0-9a-f]{12}: VALUES differ/, "the pre-deploy fold is named, never passed (DEPLOY: 069, then the office restarts)");
  // The office's own read keeps the settlement once that row is gone: VALUE-EQUAL.
  await owner((c) => c.query("DELETE FROM world_snapshot_folds WHERE digest = $1", [digest]));
  resetSettlementCaches();
  await serve({ settlement: "S11" });
  assert.match(verify(), /the settlement \(with its seal's words\) vs the cached fold of [0-9a-f]{12}: VALUE-EQUAL/);
});

test.after(async () => { await store.stop(); });

test("A LIMIT PARCEL'S OWN GROUND GOES WITH IT: rd's shed on its over-cap plot never reaches git without it (applied, or found and not applied)", { skip }, async () => {
  const marks = [parcel("ra", 0, "2026-10-01T00:00:00Z"), parcel("rb", 100, "2026-10-02T00:00:00Z"), parcel("rc", 200, "2026-10-03T00:00:00Z"), parcel("rd", 300, "2026-10-04T00:00:00Z"), shed("rd", 302), shed("ra", 2)];
  for (const lawSha of [ENGINE, LAW_SHA]) {
    await settle({ parcels: marks, lawSha });
    const header = await asOffice(async (p) => (await p.query("SELECT * FROM world_snapshots WHERE id = 2")).rows[0]);
    const { slugs } = await asOffice((p) => settlementTakesAway(p, header, { worldRepo: WORLD }));
    assert.deepEqual([...slugs].sort(), ["rd/plot", "rd/shed"], `at law ${lawSha.slice(0, 8)}: the plot over the cap and its own household's shed, and ra's shed stays`);
  }
});

test("THE FALLBACK WITHHOLDS EVERY STANDING FORECAST PARCEL, not only this window's, with its own ground", { skip }, async () => {
  const marks = [parcel("ra", 0, "2026-10-01T00:00:00Z"), parcel("rb", 100, "2026-10-02T00:00:00Z"), parcel("rc", 200, "2026-10-03T00:00:00Z"), parcel("rd", 300, "2026-10-04T00:00:00Z"), shed("rd", 302)];
  await settle({ parcels: marks });
  // rd/plot was forecast over the cap at an EARLIER window (500); this crossing folds 501 and carries it.
  await owner((c) => c.query(`UPDATE windows SET receipts = '{"parcel_cap":{"checked":true,"over_limit":[{"slug":"rd/plot","held":3,"law":"the-town/claim-cap"}]}}' WHERE id = 500`));
  const out = { marks: marks.map((m) => ({ slug: m.slug })), as_of: { window: 501 } };
  const selection = { entry: "fold-delta.mjs § foldDelta", docket_claims: 1, carried_absent: { checked: true, count: 4, slugs: marks.slice(0, 4).map((m) => m.slug) } };
  const blind = await asOffice((p) => settlementWithhold(p, { window: 501, worldRepo: null, out, selection }));
  assert.deepEqual(blind.out.marks.map((m) => m.slug), ["ra/plot", "rb/plot", "rc/plot"]);
  assert.deepEqual(blind.selection.settlement.withheld_by_forecast, ["rd/plot"]);
  assert.deepEqual(blind.selection.settlement.withheld_with_them, ["rd/shed"]);
  assert.equal(blind.selection.carried_absent.count, 3, "the carry stays a subset of what is offered");
});
