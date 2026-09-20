// settling-in-parcel.test.mjs — the doorstep's "not yet sited" line names the
// PARCEL, which is the thing its predicate reads (postmark#2817).
//
// ── THE SPECIMEN, REPRODUCED ────────────────────────────────────────────────
//
// mari's `marigold-house` (kind sited, 2 stamps) published at the 2026-09-14
// 17:45Z settlement; her doorstep still said "your home is not yet sited in the
// world — walk your ground and leave your home mark" at 2026-09-15 04:40Z, and
// for two days after. The predicate behind that line is `where-is.mjs § homeOf`
// in the world engine, and homeOf reads `world.parcels` — ruling 7, "the parcel
// IS the home". A sited house mark never satisfied it; mari's PARCEL claim
// (drafted 2026-09-14T03:56Z) locked at window 191 and reached world main only
// at 2026-09-17 05:46Z (`1984062f`), after two refused settlements.
//
// So the first test below builds exactly that household — a published sited
// house, no published parcel — and asks the ENGINE, not a stub, whether it is
// placed. It is not. The old sentence then told her to do the one act she had
// already done. The fix keeps the predicate and changes what the sentence says
// the predicate wants, and asks the docket store whether the parcel is already
// in transit so a resident who is waiting is told they are waiting.
//
// The engine is imported from the world clone the office reads (WORLD_CLONE),
// the same way src/world.mjs imports it — never vendored, so the reproduction
// is against the town's own derivation as it stands.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { paperGapRows, paperGaps, walkTheWorldText, parcelClaimForHandle } from "../src/household-apex.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const WORLD = process.env.WORLD_CLONE ?? resolve(ROOT, "world-clone");

// A db stub the gaps composer can walk: the home row is present (so the
// `tend-your-home` gap stays quiet and the world gap is the only voice), the
// letters count answers 0.
const db = { prepare: () => ({ get: () => ({ n: 0, json: JSON.stringify({ description: "a home" }), description: "a home" }), all: () => [] }) };
const unsited = async () => ({ mark_id: null, x: null, y: null, sited: false });
const ctx = (extra = {}) => ({ db, clone: null, worldBlock: unsited, parcelClaim: async () => null, ...extra });

const worldGap = (rows) => rows.find((r) => r.id === "walk-the-world");

test("THE SPECIMEN · a published SITED house mark with no parcel is NOT placed by the engine's own homeOf — the predicate reads parcels", async () => {
  const engine = join(WORLD, "tools", "where-is.mjs");
  assert.ok(existsSync(engine), `no world clone at ${WORLD} — set WORLD_CLONE; the reproduction is against the town's own derivation`);
  const where = await import(pathToFileURL(engine));
  const world = {
    marks: [{ id: "mari/marigold-house", kind: "sited", by: "mari", household: "mari", at: { x: 140, y: 60 }, extent: { w: 30, h: 24 }, stamps: 2 }],
    parcels: [],
    households: { mari: "gh:67605380" },
  };
  const home = where.homeOf("mari", world);
  assert.equal(home.placed, false, "a sited house mark alone must not place a resident — if it does, #2817 was never this bug");
  // and the same world with the parcel published places her — the parcel is the whole condition
  const withParcel = { ...world, parcels: [{ id: "mari/marigold-house-parcel", household: "mari", at: { x: 140, y: 60 }, extent: { w: 25, h: 25 } }] };
  assert.equal(where.homeOf("mari", withParcel).placed, true);
  assert.equal(where.homeOf("mari", withParcel).source, "parcel");
});

test("the line names the PARCEL as the condition and says a house mark alone does not site you — never 'leave your home mark'", async () => {
  const rows = await paperGapRows("mari", ctx());
  const gap = worldGap(rows);
  assert.ok(gap, "the gap still fires for an unsited home — the predicate is untouched");
  assert.match(gap.text, /not yet sited/i, "roll-union's own pin: the words 'not yet sited' stay (the predicate IS 'no ground')");
  assert.match(gap.text, /PARCEL/, "the sentence names what the predicate reads");
  assert.match(gap.text, /kind: "parcel"/, "and the act that satisfies it — a parcel claim at leave-mark");
  assert.match(gap.text, /house mark alone does not site you/i, "and says the act mari had done is not the one this line wants");
  assert.doesNotMatch(gap.text, /leave your home mark/i, "the old sentence — the one already-done act it pointed at");
});

test("a parcel claim ON THE DOCKET is reported as waiting, by slug and window — nothing more is owed", async () => {
  const rows = await paperGapRows("mari", ctx({ parcelClaim: async (h, { key } = {}) => {
    assert.equal(h, "mari", "the claim is asked for by the resident's own handle");
    return { slug: "mari/marigold-house-parcel", status: "pending", window_id: 190 };
  } }));
  const gap = worldGap(rows);
  assert.match(gap.text, /"mari\/marigold-house-parcel" is on the docket at window 190/);
  assert.match(gap.text, /Nothing more is owed by you/);
  assert.doesNotMatch(gap.text, /kind: "parcel"/, "a resident who has already claimed is not told to claim again");
});

test("a LOCKED parcel claim — ruled, waiting for a settlement to write it — is reported as exactly that", async () => {
  const rows = await paperGapRows("mari", ctx({ parcelClaim: async () => ({ slug: "mari/marigold-house-parcel", status: "locked", window_id: 191 }) }));
  assert.match(worldGap(rows).text, /locked at window 191 — ruled and waiting for the settlement/);
});

test("a private DRAFT parcel is told the stake act that puts it forward, by its own slug", async () => {
  const rows = await paperGapRows("mari", ctx({ parcelClaim: async () => ({ slug: "mari/marigold-house-parcel", status: "draft", window_id: null }) }));
  const t = worldGap(rows).text;
  assert.match(t, /still a private draft/);
  assert.match(t, /world \{ do: "stake", args: \{ mark: "mari\/marigold-house-parcel"/);
});

test("the store read is a garnish: a reader that throws leaves the plain parcel sentence, never a 500 and never 'nothing owed'", async () => {
  const rows = await paperGapRows("mari", ctx({ parcelClaim: async () => { throw new Error("store down"); } }));
  const t = worldGap(rows).text;
  assert.match(t, /no published parcel stands in your household's name/);
  assert.doesNotMatch(t, /Nothing more is owed/);
  // and paperGaps — the flat shape every caller reads — carries the same sentence
  const flat = await paperGaps("mari", ctx({ parcelClaim: async () => { throw new Error("store down"); } }));
  assert.ok(flat.includes(t));
});

test("an office with no docket store configured answers null for the claim and keeps the plain sentence", async () => {
  const saved = { PG: process.env.WORLD2_PG, URL: process.env.WORLD2_PG_URL };
  delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL;
  try {
    assert.equal(await parcelClaimForHandle("mari"), null);
    const rows = await paperGapRows("mari", { db, clone: null, worldBlock: unsited });
    assert.match(worldGap(rows).text, /no published parcel stands/);
  } finally {
    if (saved.PG !== undefined) process.env.WORLD2_PG = saved.PG;
    if (saved.URL !== undefined) process.env.WORLD2_PG_URL = saved.URL;
  }
});

test("the sentence is pure over (handle, claim): the four shapes, pinned", () => {
  assert.match(walkTheWorldText("x", null), /Claim your ground/);
  assert.match(walkTheWorldText("x", { slug: "x/p", status: "pending", window_id: 7 }), /on the docket at window 7/);
  assert.match(walkTheWorldText("x", { slug: "x/p", status: "locked", window_id: 8 }), /locked at window 8/);
  assert.match(walkTheWorldText("x", { slug: "x/p", status: "draft" }), /private draft/);
  // a claim in a state this line does not speak for (refused, retired) reads as no claim
  assert.match(walkTheWorldText("x", { slug: "x/p", status: "refused" }), /Claim your ground/);
});

// ── the store reader's wiring, against a recording stub ─────────────────────
//
// There is no lab store (the box's world2_dev IS prod), so the reader is proven
// the way `claimRowsSince` is: the SQL and the parameters that reach the pool.
// The stub throws on any statement it does not recognise.
test("parcelClaimFor asks the claims table for THIS claimant's parcel rows in transit, newest first, inside the household's row policy", async () => {
  const { parcelClaimFor, __setPoolForTest } = await import("../src/world2-claims.mjs");
  const seen = [];
  const client = {
    async query(text, params) {
      const t = String(text).replace(/\s+/g, " ").trim();
      seen.push({ t, params });
      if (/^BEGIN$|^COMMIT$|^ROLLBACK$/.test(t)) return { rows: [] };
      if (/set_config\('app\.household'/.test(t)) return { rows: [] };
      if (/FROM households/.test(t) || /household_key/.test(t)) return { rows: [{ household: "gh:67605380" }] };
      if (/FROM claims WHERE claimant = \$1 AND class = 'parcel'/.test(t)) {
        assert.deepEqual(params, ["mari"]);
        assert.match(t, /status IN \('draft','pending','locked'\)/);
        assert.match(t, /ORDER BY submitted_at DESC/);
        return { rows: [{ slug: "mari/marigold-house-parcel", status: "pending", window_id: 190, submitted_at: "2026-09-14T03:56:50.560Z" }] };
      }
      throw new Error(`unmodelled statement — "${t.slice(0, 90)}"`);
    },
    release() {},
  };
  const pool = { query: client.query, async connect() { return client; } };
  __setPoolForTest(pool);
  try {
    const row = await parcelClaimFor("mari");
    assert.equal(row.slug, "mari/marigold-house-parcel");
    assert.equal(row.status, "pending");
    assert.ok(seen.some((s) => /class = 'parcel'/.test(s.t)), "the predicate is the class column");
  } finally { __setPoolForTest(null); }
});
