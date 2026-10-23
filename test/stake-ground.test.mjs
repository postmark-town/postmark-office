// stake-ground.test.mjs — THE ✦0 STAKE DOOR SAYS WHAT THE CANDLE'S WALK SAYS
// (POS-674).
//
//   node --test test/stake-ground.test.mjs
//
// A resident staked ✦0 on a plain sited mark on open ground, with no
// parcel above it, and the door answered "it stands on your own household's
// ground". It printed that whenever the promotion went through; the crossing
// refused it `escrow-absent` (claim 56688387, window 260). Now the door asks the
// walk the candle asks (world2-claims.mjs § claimGroundClass, its sixth `deps`
// collaborator, injected here) and its words follow the answer. It never
// refuses on it (R11, Darko 2026-10-04: "The office accepts every physically
// legal act… The settlement applies limits."): a ✦0 commons mark is put forward
// as before, and told up front what the crossing will do.
//
// The walk itself is proven against a real Postgres, and held equal to the
// clearing's 5.5, in test/prospective-standing.test.mjs. These cases drive the
// door with the judge's three answers; the promotion is a spy, and the one
// retraction runs through the fake pen.

import { registerHooks } from "node:module";

const FAKE_PEN = new URL("./helpers/fake-pen.mjs", import.meta.url).href;

// Registered BEFORE any src/ module is imported — `pool()` caches the module
// namespace on first use and a hook that arrives second never runs.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "pg") return { url: FAKE_PEN, shortCircuit: true };
    return next(spec, ctx);
  },
});

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const unflip = () => {
  delete process.env.W2_PEN; delete process.env.WORLD2_PG;
  delete process.env.WORLD2_PG_URL; delete process.env.WORLD2_CANDLE;
};
const candleOn = () => {
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://fake/pen";
  process.env.WORLD2_CANDLE = "1";
};
unflip();
after(unflip);

const { resetStore } = await import("./helpers/fake-pen.mjs");
const { worldStakeViaOffice, zeroStakeAnswer, zeroStakeReason, commonsAtZero, zeroStakeUnfiled } = await import("../src/world-stake.mjs");
const { LateCrossingError } = await import("../src/world2-pen.mjs");

const W = 260;
const MARK = "neth/a-bench-on-open-ground";
const KEY = { handles: new Set(["neth"]), household: "neth" };
const HOME = { known: true, tier: "home", ground: "home" };
const COMMONS = { known: true, tier: "market", ground: "commons" };
const OWN_GROUND = /your own household's ground/;

function door({ ground, applied = null } = {}) {
  const promoted = [], asked = [], charges = [];
  const deps = {
    exists: async () => ({ known: true, exists: true, record: null }),
    left: async () => null,
    standing: async () => ({ known: false }),
    held: async () => ({ liquid: applied ?? 5, staked: 0 }),
    ledger: async (p) => { charges.push(p); const a = applied ?? p.n; return { applied: a, requested: p.n, clipped: a < p.n, balance_before: a }; },
    promote: async (p) => { promoted.push(p); return { promoted: true, claim: "c-1", window: W }; },
    ground: async (p) => { asked.push(p); if (ground instanceof Error) throw ground; return ground; },
  };
  return { deps, promoted, asked, charges };
}

beforeEach(() => { candleOn(); resetStore(); });

// ── 1 · THE WORDS, PURE ────────────────────────────────────────────────────

test("COMMONS AT ✦0 · the answer warns that the crossing will refuse it, and never says 'your own household's ground'", () => {
  const a = zeroStakeAnswer({ mark: MARK, ground: COMMONS });
  assert.equal(a.ground, "commons");
  assert.equal(a.warning, commonsAtZero(MARK));
  assert.match(a.warning, /stands on the commons/);
  assert.match(a.warning, /At ✦0 the crossing will refuse it by name; stake at least ✦1 now and it can stand\./);
  assert.doesNotMatch(`${a.effect} ${a.warning}`, OWN_GROUND, "POS-674: the sentence that mark was told");
});

test("HOME · a forecast, said as one: by the crossing's walk its ground reads as home as things stand now, a welcome included", () => {
  const a = zeroStakeAnswer({ mark: MARK, ground: HOME });
  assert.equal(a.ground, "home");
  assert.equal(a.warning, undefined);
  assert.match(a.effect, /by the crossing's own walk, its ground reads as home to it \(your household's ground, or ground that has welcomed it\) as things stand now/);
  assert.match(a.effect, /locks, or is refused by name, at the next crossing/, "the door cannot see steps 1–5.4, the carry, or later claims");
  assert.doesNotMatch(a.effect, /the crossing's own walk reads its ground/, "#756 review: the old sentence asserted the crossing's verdict");
});

test("COULD NOT TELL · the answer says the office could not read the ground and the crossing judges it", () => {
  const a = zeroStakeAnswer({ mark: MARK, ground: { known: false, why: "the store is down" } });
  assert.equal(a.ground, null);
  assert.match(a.effect, /could not read its ground just now, so the crossing judges it/);
  assert.doesNotMatch(a.effect, OWN_GROUND);
});

test("THE PREVIEW'S REASON · names the ground the walk found; the two-case sentence only when it could not tell", () => {
  assert.match(zeroStakeReason({ mark: MARK, ground: COMMONS }), /stands on the commons/);
  assert.match(zeroStakeReason({ mark: MARK, ground: HOME }), /home to it/);
  assert.match(zeroStakeReason({ mark: MARK, ground: { known: false } }), /on the commons the crossing refuses it by name/);
});

// ── 2 · THE DOOR ───────────────────────────────────────────────────────────

test("OPEN GROUND · ✦0 on the commons is PUT FORWARD (R11) and told the crossing will refuse it", async () => {
  const d = door({ ground: COMMONS });
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 0 }, KEY, d.deps);
  assert.equal(out.error, undefined, "the office does not refuse on governance grounds");
  assert.equal(out.put_forward, true);
  assert.equal(d.promoted.length, 1, "the promotion still runs");
  assert.equal(out.ground, "commons");
  assert.equal(out.warning, commonsAtZero(MARK));
  assert.doesNotMatch(JSON.stringify(out), OWN_GROUND);
  assert.deepEqual(d.asked, [{ actor: "neth", householdName: "neth", key: KEY, slug: MARK }],
    "the judge is asked about the author's own claim, by the key the promotion uses");
  assert.equal(d.charges.length, 0, "✦0 moves no stamps");
});

test("OWN GROUND · ✦0 at home is put forward with the home sentence", async () => {
  const d = door({ ground: HOME });
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 0 }, KEY, d.deps);
  assert.equal(out.put_forward, true);
  assert.equal(out.ground, "home");
  assert.equal(out.warning, undefined);
});

test("A JUDGE THAT THROWS · the stake still goes forward, and says the crossing judges its ground", async () => {
  const d = door({ ground: new Error("connection refused") });
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 0 }, KEY, d.deps);
  assert.equal(out.put_forward, true);
  assert.equal(out.ground, null);
  assert.match(out.effect, /could not read its ground/);
});

test("NOTHING TO PUT FORWARD · ✦0 on a mark that is no draft of yours asserts nothing about its ground", async () => {
  const d = door({ ground: HOME });
  d.deps.promote = async () => ({ promoted: false, claim: null, window: W });
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 0 }, KEY, d.deps);
  assert.equal(out.error, "bounce");
  assert.match(out.hint, /is not a draft of yours to put forward/);
  assert.doesNotMatch(`${out.defect} ${out.hint}`, OWN_GROUND);
});

// ── 2b · ✦0 THAT PUT NOTHING FORWARD: FOUR FACTS, FOUR SENTENCES (#756 review) ──

const NOT_A_DRAFT = /is not a draft of yours to put forward/;
const unfiled = async (promote) => {
  const d = door({ ground: HOME });
  d.deps.promote = promote;
  return worldStakeViaOffice({ mark: MARK, stamps: 0 }, KEY, d.deps);
};

test("✦0 · THE STORE COULD NOT BE READ · says so and asks for another try, never 'not a draft of yours'", async () => {
  const out = await unfiled(async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:5432"); });
  assert.equal(out.error, "bounce");
  assert.match(out.defect, /the store could not be read/);
  assert.match(out.hint, /Try the stake again/);
  assert.doesNotMatch(`${out.defect} ${out.hint}`, NOT_A_DRAFT);
});

test("✦0 · THE CANDLE IS DARK (no open window) · nothing is put forward until it is lit", async () => {
  const out = await unfiled(async () => { throw new Error("no open candle — the candle is dark; the stake cannot put this mark forward"); });
  assert.match(out.defect, /the candle is dark/);
  assert.match(out.hint, /nothing is put forward until the next one is lit/);
  assert.doesNotMatch(`${out.defect} ${out.hint}`, NOT_A_DRAFT);
});

test("✦0 · THE CANDLE IS DARK (the docket is off: window null) · the same sentence", async () => {
  const out = await unfiled(async () => ({ promoted: false, claim: null, window: null }));
  assert.match(out.defect, /the candle is dark/);
  assert.doesNotMatch(`${out.defect} ${out.hint}`, NOT_A_DRAFT);
});

test("✦0 · TOO LATE FOR THIS CROSSING · nothing filed; staked again it goes to the next crossing's docket", async () => {
  const out = await unfiled(async () => { throw new LateCrossingError(300, 262); });
  assert.equal(out.code, 409);
  assert.match(out.defect, /too late for this crossing's docket/);
  assert.match(out.hint, /Stake it again at ✦0 and it goes to the next crossing's docket/);
  assert.doesNotMatch(`${out.defect} ${out.hint}`, NOT_A_DRAFT);
});

test("✦0 · NO DRAFT (the store answered, window open) · the one case 'not a draft of yours' is true of", async () => {
  const out = await unfiled(async () => ({ promoted: false, claim: null, window: W }));
  assert.equal(out.code, 422);
  assert.match(out.hint, NOT_A_DRAFT);
  assert.equal(zeroStakeUnfiled({ mark: MARK, putForward: { promoted: false, window: W } }).code, 422);
});

test("THE PREVIEW · ✦0 on the commons says so before anything is written", async () => {
  const d = door({ ground: COMMONS });
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 0, preview: true }, KEY, d.deps);
  assert.equal(out.preview, true);
  assert.equal(d.promoted.length, 0, "a preview promotes nothing");
  assert.match(out.stamps.this_act.reason, /stands on the commons/);
});

// ── 3 · ONE GROUND RULE ON THIS DOOR: the empty-purse retraction asks the walk too ──

const pendingRow = () => ({ id: 1, window_id: W, class: "sited", claimant: "neth", household: "gh:1",
  slug: MARK, geometry: JSON.stringify({ slug: MARK }), status: "pending", stake: 1, data: {}, submitted_at: "now" });

test("EMPTY PURSE ON THE COMMONS (the walk says commons) · the promotion this act made comes back off the docket", async () => {
  const s = resetStore();
  s.windows = [{ id: W, status: "open" }];
  s.claims.push(pendingRow());
  const d = door({ ground: COMMONS, applied: 0 });
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, d.deps);
  assert.equal(out.error, "bounce");
  assert.match(out.defect, /was not filed/);
  assert.equal(s.claims[0].status, "retracted");
});

test("EMPTY PURSE AT HOME (the walk says home, e.g. welcomed ground) · nothing is taken back", async () => {
  const s = resetStore();
  s.windows = [{ id: W, status: "open" }];
  s.claims.push(pendingRow());
  const d = door({ ground: HOME, applied: 0 });
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, d.deps);
  assert.notEqual(out.error, "bounce");
  assert.equal(s.claims[0].status, "pending", "the leave-mark door's flat scan would have read welcomed ground as commons");
});

test("THE DOOR NO LONGER ASKS THE LEAVE-MARK DOOR'S FLAT SCAN", () => {
  const src = readFileSync(new URL("../src/world-stake.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /await markStandsOnOwnGround\(/, "one ground rule on this door, and it is the candle's");
});
