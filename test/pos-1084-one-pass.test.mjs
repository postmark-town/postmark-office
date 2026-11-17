// pos-1084-one-pass.test.mjs — POS-1084: the full house read's per-resident waiting counts come from ONE stance pass per world-household, not one per resident.
//
//   node --test test/pos-1084-one-pass.test.mjs
//
// WHY (Jetto, POS-1084, dev, 2026-11-17: starforge's full house read 5.0 s -> 56.6 s): #1067 asked `stancesForHandles([handle])` once per resident, and each call is a whole `stanceInbox`
// pass (the world, the geometry overlaps, the stance record, the versions). But `stanceInbox` weighs the ground of the caller's whole WORLD-household (`myHouses`), so every resident of
// one world-household gets the same candidate list; only the ground LABEL (`stances_awaiting_ground`) differs. `stanceCountsForHandles` asks the house once and takes each resident's count
// and label from that pass.
//
// This file runs the REAL derivation on a world in a bottle (canon marks, a households map in world-state.json, outsiders' live sketches laid over the houses' ground), and holds:
//   1. OLD-AGAINST-NEW EQUIVALENCE: for every resident, the old per-resident block (the doorstep's own call, `stancesForHandles([h])`, as #1067's `stanceCountOf` built it) deep-equals the new
//      batch block, on a house of three where the label is "household" for all, a house of two where the label is "resident:<h>" for ONE (the author of all the ground) and "household" for the
//      other, a lone author, a true zero, and a resident in no house. The expected table is written out, so the equivalence cannot hold by both sides being empty.
//   2. THE PASS COUNT: the store's claims read (one per pass) is counted. A house of ten residents is 1 pass; the whole fixture is one per house; the old per-resident way is one per resident.
//   3. UNAVAILABLE: with the stance store unreachable, every resident says `unavailable` with NO count (never 0), the same words the old way said.

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const scratch = mkdtempSync(join(tmpdir(), "pos1084-one-pass-"));
after(() => sweep(scratch));

// ── canon, in a bottle ───────────────────────────────────────────────────────
const repo = join(scratch, "world");
mkdirSync(repo, { recursive: true });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const parcel = (id, x, y) => ({ id, by: id.split("/")[0], kind: "parcel", at: { x, y }, extent: { w: 25, h: 25 }, date: "2026-08-01", body: `${id}'s ground` });
const CANON = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 20000, h: 20000 }, date: "2026-07-01", body: "the world frame" },
  parcel("alpha/alphas-parcel", 100, 100), parcel("bravo/bravos-patch", 500, 500),     // house H1: alpha, bravo, charlie (two authors of the ground)
  parcel("delta/deltas-parcel", 3000, 3000),                                           // house H2: delta (a lone author)
  parcel("echo/echos-plot", 6000, 6000),                                               // house H3: echo (nobody lays anything over it: a true zero)
  parcel("golf/golfs-parcel", 8000, 8000),                                             // house H4: hotel, golf (golf authors ALL the ground; hotel authors none)
  ...Array.from({ length: 10 }, (_, i) => parcel(`t${i}/t${i}-plot`, 12000 + i * 100, 12000)),   // house H5: ten residents, each holds a plot
];
const TEN = Array.from({ length: 10 }, (_, i) => `t${i}`);
const HOUSES = { alpha: "H1", bravo: "H1", charlie: "H1", delta: "H2", echo: "H3", golf: "H4", hotel: "H4", ...Object.fromEntries(TEN.map((h) => [h, "H5"])) };

put("tools/geometry.mjs", `
export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function overlapArea(a, b) {
  const dx = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const dy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}
`);
put("WORLD/world-state.json", JSON.stringify({ tick: 0, marks: CANON, parcels: [], households: HOUSES }));
put("WORLD/skeleton.json", JSON.stringify({ features: [] }));
git("init", "-q", "-b", "main");
git("config", "user.email", "t@postmark.invalid");
git("config", "user.name", "pos1084 one-pass falsifier");
git("add", "-A");
git("commit", "-qm", "canon");

// outsiders' live sketches (draft claims) laid over the houses' ground LATER: those are the candidates awaiting each house's word
const sketch = (slug, x, y) => ({ slug, claimant: "zed", declared_by: "zed", status: "draft", kind: "sited", date: "2026-08-20", at: { x, y }, extent: { w: 2, h: 2 }, body: "" });
const SKETCHES = [
  sketch("zed/near-alpha", 100, 100), sketch("zed/near-bravo", 500, 500),             // H1: 2 waiting, for every member
  sketch("zed/near-delta", 3000, 3000),                                               // H2: 1
  sketch("zed/near-golf-a", 8000, 8000), sketch("zed/near-golf-b", 8001, 8001),       // H4: 2, for both members
  ...TEN.flatMap((h, i) => [sketch(`zed/near-${h}-a`, 12000 + i * 100, 12000), sketch(`zed/near-${h}-b`, 12001 + i * 100, 12001), sketch(`zed/near-${h}-c`, 12002 + i * 100, 12002)]),   // H5: 30 for each of ten
];

const COLUMNS = ["slug", "claimant", "status", "at", "extent", "kind", "date", "declared_by", "body"];
const selects = (text, column) => {
  const list = String(text).slice(0, String(text).search(/\bFROM\b/i));
  return new RegExp(`(\\bAS\\s+${column}\\b)|(^|[\\s,])${column}\\s*(,|$)`, "im").test(list);
};
// the office reads WORLD_CLONE once, as a module constant: set before any office module that reads it is imported (every office import below is dynamic for that reason)
process.env.WORLD_CLONE = repo;
process.env.WORLD_SINGLE_LOG = "1";
const keepStance = process.env.WORLD2_STANCE_URL;
let passes = 0;   // one per `stanceInbox` pass: only the world read selects `claimant`
const { __setStancePoolForTest } = await import("../src/world2-acts.mjs");
function storeHolding(rows) {
  __setStancePoolForTest({
    async query(text, params = []) {
      if (/\bclaimant\b/.test(text)) passes++;
      const wanted = new Set(params[0] ?? ["draft", "pending"]);
      return { rows: rows.filter((r) => wanted.has(r.status)).sort((a, b) => String(a.slug).localeCompare(String(b.slug)))
        .map((r) => { const out = {}; for (const c of COLUMNS) if (selects(text, c)) out[c] = r[c]; return out; }) };
    },
    async end() { /* nothing to close */ },
  });
}

const { stancesForHandles, stanceCountsForHandles, resetStanceGeometry } = await import("../src/world-stance.mjs");
const { stanceCountsOf } = await import("../src/house-bundle.mjs");
const { DOORSTEP_STANCES } = await import("../src/queries.mjs");
const { STANCE_ON } = await import("./stance-pool-stub.mjs");

beforeEach(() => { Object.assign(process.env, STANCE_ON); storeHolding(SKETCHES); resetStanceGeometry(); passes = 0; });
after(() => {
  __setStancePoolForTest(null); delete process.env.WORLD_SINGLE_LOG;
  if (keepStance === undefined) delete process.env.WORLD2_STANCE_URL; else process.env.WORLD2_STANCE_URL = keepStance;
});

/** THE OLD WAY, as #1067's `stanceCountOf` built it: the doorstep's own reader, asked for ONE resident, once per resident. */
async function oldBlock(handle) {
  const base = { serves: "household.stances", args: { handle } };
  const whole = await stancesForHandles([handle], { limit: DOORSTEP_STANCES });
  if (whole?.unavailable || !Number.isFinite(whole?.stances_awaiting))
    return { ...base, unavailable: whole?.unavailable ?? "the consent inbox answered no count for this resident — unknown, not zero" };
  return { ...base, stances_awaiting: whole.stances_awaiting, ...(whole.stances_awaiting_ground !== undefined ? { stances_awaiting_ground: whole.stances_awaiting_ground } : {}) };
}
const oldBlocks = async (handles) => { const out = {}; for (const h of handles) out[h] = await oldBlock(h); return out; };

// hotel before golf, so the house's first resident (the one the pass is asked for) is the one who authors NONE of the ground: golf's label is taken from hotel's pass
const MIXED = ["hotel", "golf", "alpha", "charlie", "bravo", "delta", "echo", "fox"];
const blk = (handle, stances_awaiting, stances_awaiting_ground) => ({ serves: "household.stances", args: { handle }, stances_awaiting, stances_awaiting_ground });

test("1 · EQUIVALENCE: every resident's block from one pass per house deep-equals the old per-resident block, count AND ground, true zero included", async () => {
  const old = await oldBlocks(MIXED);
  const oldPasses = passes;
  passes = 0;
  const now = await stanceCountsOf(MIXED);
  const newPasses = passes;
  // the expected table, written out (a resident's label is "resident:<h>" only while every mark the pass counted is theirs)
  const expected = {
    hotel: blk("hotel", 2, "household"),          // golf authors the ground, not hotel
    golf: blk("golf", 2, "resident:golf"),        // ... and golf's label is taken from HOTEL's pass
    alpha: blk("alpha", 2, "household"), charlie: blk("charlie", 2, "household"), bravo: blk("bravo", 2, "household"),   // two authors' ground
    delta: blk("delta", 1, "resident:delta"),
    echo: blk("echo", 0, "resident:echo"),        // a TRUE zero, with its ground
    fox: blk("fox", 0, "resident:fox"),           // in no house and holding nothing
  };
  assert.deepEqual(old, expected, "the old per-resident way answers the table (the fixture separates the cases)");
  assert.deepEqual(now, old, "the one-pass-per-house way answers exactly what the old way did, for every resident");
  assert.equal(now.echo.stances_awaiting, 0);
  assert.ok(now.echo.stances_awaiting === 0 && "stances_awaiting_ground" in now.echo, "a true zero is 0, with its ground");
  assert.equal(oldPasses, MIXED.length, "the old way is one pass per resident");
  assert.equal(newPasses, 5, "the new way is one pass per world-household: H4, H1, H2, H3 and fox's own");
});

test("2 · A HOUSE OF TEN RESIDENTS IS ONE STANCE PASS, not ten; each resident carries their own label and the same whole count", async () => {
  const now = await stanceCountsOf(TEN);
  assert.equal(passes, 1, "one pass for the ten");
  for (const h of TEN) assert.deepEqual(now[h], blk(h, 30, "household"), `${h}: 30 waiting (past one page), and ten authors' ground is the household's`);
  passes = 0;
  const old = await oldBlocks(TEN);
  assert.equal(passes, 10, "the old way: ten passes");
  assert.deepEqual(now, old);
});

test("3 · THE BATCH'S OWN ANSWER, asked through the exported function: a Map by handle, one pass for a house (the seam counts passes too)", async () => {
  let seen = 0;
  const { stanceInbox } = await import("../src/world-stance.mjs");
  const counted = async (...a) => { seen++; return stanceInbox(...a); };
  const m = await stanceCountsForHandles(["alpha", "bravo", "charlie"], { inbox: counted });
  assert.equal(seen, 1, "three residents of one house, one pass");
  assert.deepEqual([...m.keys()].sort(), ["alpha", "bravo", "charlie"]);
  assert.equal(passes, 1);
});

test("4 · UNAVAILABLE: with the stance store unreachable every resident says so with NO count (never 0), in the old way's own words", async () => {
  delete process.env.WORLD2_STANCE_URL;
  const old = await oldBlocks(["alpha", "bravo", "echo"]);
  const now = await stanceCountsOf(["alpha", "bravo", "echo"]);
  assert.deepEqual(now, old, "the same unavailable block, resident for resident");
  for (const h of ["alpha", "bravo", "echo"]) {
    assert.ok(!("stances_awaiting" in now[h]) && !("stances_awaiting_ground" in now[h]), `${h}: no count at all`);
    assert.match(now[h].unavailable, /stance read has no credential/);
  }
});

test("5 · A PASS THAT THROWS is that resident's unavailable, never a zero, and never takes the rest of the batch down", async () => {
  let n = 0;
  const { stanceInbox } = await import("../src/world-stance.mjs");
  const flaky = async (...a) => { if (n++ === 0) throw new Error("the record did not answer"); return stanceInbox(...a); };
  const m = await stanceCountsForHandles(["delta", "echo"], { inbox: flaky });
  assert.ok(!("stances_awaiting" in m.get("delta")) && /consent inbox could not be read/.test(m.get("delta").unavailable));
  assert.deepEqual(m.get("echo"), { stances_awaiting: 0, stances_awaiting_ground: "resident:echo" });
});
