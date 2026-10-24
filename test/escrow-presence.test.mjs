// escrow-presence.test.mjs — the falsifiers for the candle's escrow PRESENCE
// gate (postmark#2594's second half, ruled a G1 blocker 2026-09-08).
//
// THE LAW EACH ONE QUOTES. The world's sweep, `tools/settlement-sweep.mjs`
// :1146-1152, verbatim:
//
//     const cls = classifyMark(view ?? record, folded);
//     const rowClass = cls === "market" ? "commons" : cls;
//     const n = escrow.get(record.id) ?? 0;
//     const eligible = rowClass !== "commons" || n > 0;
//     if (!eligible) {
//       leftDrafted.push({ …, reason: "commons needs escrow > 0" });
//
// and the ground verdict that makes own ground exempt, `tools/mark-standing.mjs`
// :130-134, verbatim:
//
//     const holder = standingHouseholdOf(ground);
//     if (holder == null || house == null) return "market";
//     if (holder === house) return "home";
//     return mark.id != null && consentMap(ground)?.[mark.id] === "welcomed" ? "home" : "market";
//
// G1 deletes the sketchbook path the sweep's gate lives on, so after the cutover
// the rule stops being enforced anywhere unless the candle carries it.
//
// ── THE CAN-FAIL FLIP ───────────────────────────────────────────────────────
//
// In `world2/tools/escrow-presence.mjs § escrowAbsentAmong`, delete the push:
//
//     -    refused.push({ id: c.id, slug: c.slug, check: escrowAbsentCheck(c.slug, townSha) });
//
// The drift-room test goes RED; the two LOCK controls (own ground, and a staked
// commons mark) stay GREEN, which is what makes them controls. The split is in
// `docs/2026-09-08/jetto-candle-refusal-report.md` beside the run.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escrowAbsentAmong, escrowPresenceAt, escrowAbsentCheck, rowClassOf, townsOwn, ESCROW_ABSENT_CHECK, escrowLines,
} from "../world2/tools/escrow-presence.mjs";

// Window 177's own pinned town sha, off the store. NOT 2a681e6c, which is the
// sha my scratch carried while replaying window 154 and the sha lane 2's fixture
// is named for — a falsifier written against the wrong one would still be green.
const TOWN_177 = "723005e502a761b11959b43f271c29c824063d8f";

const DRIFT_ROOM = { id: "32c20578", slug: "lupi/the-drift-room" };
const OWN_GROUND = { id: "aaaa1111", slug: "current-the-reader/the-mantel" };
const STAKED = { id: "bbbb2222", slug: "berthillon/cone-peche-blanche-2026-09-08" };

// ── 1 · the live instance ───────────────────────────────────────────────────
test("THE DRIFT ROOM: a commons mark with nothing staked on it is refused, named", () => {
  const r = escrowAbsentAmong([DRIFT_ROOM], {
    tiers: new Map([[DRIFT_ROOM.slug, "market"]]),
    escrowByMark: new Map(),                       // the town names it nowhere at 723005e5
    townSha: TOWN_177,
  });
  assert.deepEqual(r.refused.map((x) => x.slug), ["lupi/the-drift-room"]);
  assert.equal(r.refused[0].check, `escrow-absent: lupi/the-drift-room @ 723005e5`);
  assert.deepEqual(r.unchecked, []);
});

// ── 2 · the two controls, which must stay GREEN under the flip ─────────────
test("OWN GROUND locks at zero escrow — and it locks because of the CLASS, not a clause", () => {
  // The class rule answers `home` for a mark on its own household's ground, and
  // only `commons` needs escrow. Nothing in escrow-presence.mjs mentions own
  // ground; if this ever fails, the class rule moved, which is the thing worth
  // hearing about.
  const r = escrowAbsentAmong([OWN_GROUND], {
    tiers: new Map([[OWN_GROUND.slug, "home"]]),
    escrowByMark: new Map(),
    townSha: TOWN_177,
  });
  assert.deepEqual(r.refused, []);
  assert.deepEqual(r.commons, [], "a home mark is not a commons candidate at all");
});

test("A STAKED COMMONS MARK LOCKS — the gate is presence, not sufficiency", () => {
  const r = escrowAbsentAmong([STAKED], {
    tiers: new Map([[STAKED.slug, "market"]]),
    escrowByMark: new Map([[STAKED.slug, 1]]),     // one stamp is enough; `n > 0`
    townSha: TOWN_177,
  });
  assert.deepEqual(r.refused, []);
  assert.deepEqual(r.commons.map((c) => c.slug), [STAKED.slug], "it WAS judged, and it passed");
});

test("constitution marks are never commons — the town's own law does not stake itself", () => {
  const r = escrowAbsentAmong([{ id: "c", slug: "the-town/pledges" }], {
    tiers: new Map([["the-town/pledges", "constitution"]]),
    escrowByMark: new Map(),
    townSha: TOWN_177,
  });
  assert.deepEqual(r.refused, []);
  assert.deepEqual(r.commons, []);
});

// ── 3 · the two zeroes, which must not be spelled the same way ─────────────
test("A STORE THAT CANNOT ANSWER IS NOT A TOWN WHERE NOBODY STAKED", () => {
  // `escrow_projection` is not on prod today — migration 014 lives on lane 2's
  // branch. If null read as zero, the first crossing after merge would refuse
  // every commons claim in the town. It returns `unchecked` instead, and the
  // crossing says so out loud.
  const r = escrowAbsentAmong([DRIFT_ROOM, STAKED], {
    tiers: new Map([[DRIFT_ROOM.slug, "market"], [STAKED.slug, "market"]]),
    escrowByMark: null,
    townSha: TOWN_177,
  });
  assert.deepEqual(r.refused, [], "an unreadable projection must refuse NOBODY");
  assert.deepEqual(r.unchecked.map((c) => c.slug).sort(), [STAKED.slug, DRIFT_ROOM.slug].sort());
});

test("an EMPTY escrow map is a real answer and does refuse — that is the town where nobody staked", () => {
  // The other half of the same distinction: `new Map()` means the projection
  // answered and holds no stake for this mark. Only `null` means it could not.
  const r = escrowAbsentAmong([DRIFT_ROOM], {
    tiers: new Map([[DRIFT_ROOM.slug, "market"]]),
    escrowByMark: new Map([["somebody-else/a-mark", 3]]),
    townSha: TOWN_177,
  });
  assert.deepEqual(r.refused.map((x) => x.slug), [DRIFT_ROOM.slug]);
});

// ── 4 · the shape errors ───────────────────────────────────────────────────
test("a claim naming no mark, and a class the walk did not answer, are both skipped", () => {
  const r = escrowAbsentAmong([{ id: "x", slug: null }, { id: "y", slug: "nobody/unwalked" }], {
    tiers: new Map(),
    escrowByMark: new Map(),
    townSha: TOWN_177,
  });
  assert.deepEqual(r.refused, [], "a class the walk did not answer must not be guessed as commons");
  assert.deepEqual(r.commons, []);
});

test("the sweep's mapping is one line, and it is the sweep's", () => {
  assert.equal(rowClassOf("market"), "commons");
  assert.equal(rowClassOf("home"), "home");
  assert.equal(rowClassOf("constitution"), "constitution");
});

test("the check names the TOWN sha, short, and splits on the first colon", () => {
  assert.equal(escrowAbsentCheck("a/b", TOWN_177), "escrow-absent: a/b @ 723005e5");
  assert.equal(escrowAbsentCheck("a/b", null), "escrow-absent: a/b @ ?");
  const raw = escrowAbsentCheck("a/b", TOWN_177);
  assert.equal(raw.slice(0, raw.indexOf(":")), ESCROW_ABSENT_CHECK);
});

// ── 5 · the reader, over a fake `q` ────────────────────────────────────────
test("escrowPresenceAt answers null where the projection cannot, and a Map where it can", async () => {
  const q = (text, args) =>
    /to_regclass/.test(text) ? { rows: [{ ok: false }] } : { rows: [] };
  assert.equal(await escrowPresenceAt(q, { townSha: TOWN_177 }), null,
    "migration 014 absent — the table is not there and the gate must not read that as an unstaked town");

  const qEmpty = (text) => (/to_regclass/.test(text) ? { rows: [{ ok: true }] } : { rows: [] });
  assert.equal(await escrowPresenceAt(qEmpty, { townSha: TOWN_177 }), null,
    "the table exists and holds no row for this sha — not ingested, which is also not an unstaked town");

  const qRows = (text) => (/to_regclass/.test(text)
    ? { rows: [{ ok: true }] }
    : { rows: [{ mark: "berthillon/a-cone", n: 2 }, { mark: "wright/a-thing", n: 1 }] });
  const m = await escrowPresenceAt(qRows, { townSha: TOWN_177 });
  assert.equal(m.get("berthillon/a-cone"), 2);
  assert.equal(m.get("nobody/never"), undefined, "absent from the map is zero staked, which the judgement reads as zero");
});

test("escrowPresenceAt refuses to answer without a sha — there is no 'latest' escrow", async () => {
  await assert.rejects(() => escrowPresenceAt(() => ({ rows: [] }), {}), /no townSha/);
});

// ── THE OPERATOR LINES, READ AS STRINGS (the reviewer's repair 1) ───────────
//
// The first cut composed these at the call site in `clearing-job.mjs`, which is
// a script, so nothing watched them — and the UNCHECKED line joined an array of
// `{ id, slug }` OBJECTS and printed `[object Object]`. Its sibling one line
// above mapped to `.slug` correctly, the receipt mapped correctly, and the tests
// above map `unchecked` to slugs in their own assertions — so the suite
// performed the exact mapping the production line forgot, and stayed green.
//
// It was the worst of the two to get wrong: until migration 014 lands with lane
// 2, `escrow_projection` does not exist on prod, so the UNCHECKED branch is the
// ONLY one that can run, and every crossing between merge and that migration
// would have printed a line naming nothing.
//
// THESE TESTS READ THE STRING. Asserting on the verdict object again would
// reproduce the blind spot exactly.
//
// THE CAN-FAIL FLIP: in `escrow-presence.mjs § escrowLines`, change
// `unchecked.map((c) => c.slug).join(", ")` back to `unchecked.join(", ")`.
// The first test below goes RED with `[object Object]` in the message; the
// refused-line test stays GREEN, which is what makes it the control.

test("the UNCHECKED line names the slugs, and never prints [object Object]", () => {
  const [line] = escrowLines({ unchecked: [DRIFT_ROOM, STAKED] }, TOWN_177);
  assert.doesNotMatch(line, /\[object Object\]/, "the line an operator reads on every crossing until 014 lands");
  assert.match(line, /lupi\/the-drift-room/);
  assert.match(line, /berthillon\/cone-peche-blanche-2026-09-08/);
  assert.match(line, /LOCKED UNCHECKED/);
  assert.match(line, /migration 014/, "and it names the pending migration, so the operator knows what clears it");
  assert.match(line, /town 723005e5/, "at the window's own pinned town sha, short");
});

test("the REFUSED line names its slugs too — the control that must stay green under the flip", () => {
  const [line] = escrowLines({ refused: [{ ...DRIFT_ROOM, check: "x" }] }, TOWN_177);
  assert.doesNotMatch(line, /\[object Object\]/);
  assert.match(line, /refused 1 commons claim/);
  assert.match(line, /lupi\/the-drift-room/);
});

test("both lines at once, and neither when there is nothing to say", () => {
  assert.equal(escrowLines({ refused: [], unchecked: [] }, TOWN_177).length, 0,
    "a quiet crossing prints nothing — an operator line for every crossing is a line nobody reads");
  assert.equal(escrowLines({ refused: [DRIFT_ROOM], unchecked: [STAKED] }, TOWN_177).length, 2);
  assert.equal(escrowLines(undefined, TOWN_177).length, 0, "and a caller with no verdict does not throw");
});

test("a missing town sha is spelled, not silently blank", () => {
  const [line] = escrowLines({ unchecked: [DRIFT_ROOM] }, null);
  assert.match(line, /town \?/, "the operator must be able to tell 'no sha' from a sha they misread");
});

test("townsOwn (POS-696): the town's own hand needs no stake, whatever the walk said; a resident's never qualifies", () => {
  assert.equal(townsOwn({ owner: "the-town", tier: "market" }), true);
  assert.equal(townsOwn({ owner: "lupi", tier: "market" }), false);
  assert.equal(townsOwn({ owner: "the-town-crier", tier: "market" }), false, "a handle that starts like the town is not the town");
  assert.equal(townsOwn({ slug: "the-town/orient" }), false, "the slug is not the owner: the answer is the column, never a prefix");
  assert.equal(townsOwn(null), false);
});
