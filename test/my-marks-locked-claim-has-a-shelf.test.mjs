// my-marks-locked-claim-has-a-shelf.test.mjs — bug post #4014: the my-marks read
// had no shelf for a locked claim.
//
// THE REPORT, verbatim (kogane, 2026-10-19; the kept record on the bug post,
// postmark-town/postmark#4014):
//
//   "Expected: the bare read shows the bowl on some shelf while it is locked and
//    waiting for its settlement.
//    Actually happened: the bare read's counts were drafts 1 (a different mark),
//    docket 0, published 0, refused 0. The bowl was on no shelf. The focused read
//    said status locked, window 259, 'the candle ruled for it; it reaches the
//    world at the settlement that carries that candle'."
//
// ── THE MEASUREMENT THIS FILE WAS BORN FROM, AND WHAT RULED THE BUILD ───────
//
// The brief took the two filter lines in `world.mjs § worldMyMarks` for the cause.
// They were not. A locked claim never reaches the list those lines split: the
// overlay reads `claims` with `status = ANY(LIVE_STATUSES)`, `LIVE_STATUSES` is
// exactly `["draft","pending"]`, and the write-path guards read the same constant
// (`guard-reads.mjs`: "locked  gone — it is a row in `marks` now, which is canon";
// pinned by leave-mark-drafts-and-docket and world2-guard-reads). So the bowl was
// on no shelf because it was never read, and the negative `drafts` filter was a
// trap nobody had sprung. Against the unchanged base, the CONTROL below was green,
// KOGANE'S SHAPE was red ("is on NO shelf … counts all 0 … the overlay asked the
// store for statuses [draft, pending]"), and DRAFTS ARE DRAFTS was red.
//
// RULED (Wright, 2026-11-02 00:4x EST, on postmark-office#839, quoted):
//   1. "B: locked rows come from claim effects, the way `refused` does. Add
//       `lockedRowsFrom(events, canonIds)` beside `refusedRowsFrom`, derived from
//       `readClaimEffects` over the same two-crossing window, skipping slugless
//       rows, and shared by both doors. `LIVE_STATUSES` and the overlay reader
//       stay as they are, since the write-path guards read the same constant."
//   2. "'Not yet carried' is canon-absence, the 1.0 focused read's own rule, inside
//       that two-crossing bound."
//   3. "`held_review` waits for its own ruling. It isn't on this shelf."
//   4. "The shelf is keyed `locked` … `locked` joins `counts`, `shown`, `withheld`
//       and `labels`."
//
// ── WHAT IS HELD HERE, ARM BY ARM (each has a flip, run and logged in the PR) ──
//
//   CONTROL                 the harness is live; the overlay still asks for exactly
//                           draft and pending (the ruling's "stay as they are")
//   DRAFTS ARE DRAFTS       the positive `drafts` filter (RED on the old negative one)
//   SKETCHBOOK              a row with no claim status is still private
//   KOGANE'S SHAPE          the acceptance: locked, uncarried, on `locked`, counted
//   CARRIED IS NOT LOCKED   canon-absence is wired at the door, on real canon
//   THE BOUND               a lock older than two crossings is not on the shelf
//   ONLY YOURS              another household's locked claim is not on the shelf
//   NOTHING PUBLISHED       a household with no published mark still sees its first
//   SLUGLESS                a claim with no slug neither throws nor appears
//   HELD IS NOT HERE        a held_review claim is not on the shelf
//   REFUSED STAYS REFUSED   `refused` is untouched and its claims are not `locked`
//   THE PAGE                counts first, slice after; the overflow named; offset wired
//   UNAVAILABLE             an unread docket is said, never an empty shelf
//   lockedRowsFrom (pure)   kind, yours, canon, one row per mark, order, slugless
//   LABELS AND WORDS        the ruled label; the twin's equal to it; `says` is the
//                           focused read's own sentence
//
// Run: WORLD_CLONE=<tree>/world-clone node --import ./test/helpers/sparse-guard.mjs \
//        --test --test-concurrency=1 test/my-marks-locked-claim-has-a-shelf.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { useGuardReader } from "../src/world2-guards.mjs";
import { __setPoolForTest as __setClaimsPool } from "../src/world2-claims.mjs";
import { __setPoolForTest as __setActsPool } from "../src/world2-acts.mjs";
import { __clearHouseCache } from "../src/household-deriver.mjs";
import { claimEffectsFrom, lockedRowsFrom, myMarksLocked, RULINGS_SINCE_CROSSINGS } from "../src/claim-effects.mjs";
import { receiptFrom } from "../src/mark-receipt.mjs";
import { CROSSING_MS } from "../src/crossings.mjs";
import { publishedState } from "../src/world-branches.mjs";
import { LIVE_STATUSES } from "../world2/tools/guard-reads.mjs";
import { PORTFOLIO_LABELS } from "../world2/tools/portfolio-reads.mjs";
// Imported HERE, before any test registers (world.mjs awaits the world graph
// snapshot's load at import — see my-marks-refused.test.mjs).
import { WORLD_CLONE, worldMyMarks } from "../src/world.mjs";

const TOWN_CLONE = process.env.TOWN_CLONE ?? join(WORLD_CLONE, "..", "town-clone");
const HAVE = existsSync(join(WORLD_CLONE, "WORLD", "world-state.json"))
  && existsSync(join(TOWN_CLONE, "tools", "world-stake.mjs"));
const WHY_NOT = `needs a world clone at ${WORLD_CLONE} and a town clone at ${TOWN_CLONE}`;
const skipIfNoClone = { skip: HAVE ? false : WHY_NOT };

// `readClaimEffects` asks the docket only when an office is pointed at a store; the
// stores here are hand-built and installed below, and the URL is never dialled.
const was = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
before(() => { process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL = "postgres://my-marks-locked-test@localhost/none"; });
after(() => {
  if (was.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = was.pg;
  if (was.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = was.url;
});

// ── the fixture: one household of one resident, no registry, a hand-built store ──
//
// A handle nothing else in the suite uses (`world2-claims.mjs` keeps a
// process-wide house cache). With no registry rows the handle is its own house,
// `solo:<handle>`, which is also the key every claim below is filed under.
const HANDLE = "pos4014-kogane";
const HOUSE = `solo:${HANDLE}`;
const KEY = { household: "pos4014", handles: new Set([HANDLE]) };

const BOWL = `${HANDLE}/the-bowl-on-the-step`;      // Kogane's shape: locked, stamps 0, our own parcel, not in canon
const SHED = `${HANDLE}/the-private-shed`;
const STAKED = `${HANDLE}/the-staked-shed`;
const NOTHING = `${HANDLE}/a-row-with-no-claim-status`;

/**
 * A `claims` row as both readers return it: `LIVE_CLAIM_SELECT`'s columns (the
 * overlay) and `claimRowsSince`'s (the effects), one object for both. The ruling
 * is dated against the REAL clock (`ago` ms before now), never a fixed instant:
 * the effects window is the last two crossings of whatever "now" is.
 */
let serial = 0;
const claim = ({ id, status, stake = 0, window_id = 259, claimant = HANDLE, household = HOUSE, ago = 60e3, slug = id }) => ({
  id: `00000000-0000-0000-0000-${String(++serial).padStart(12, "0")}`,
  slug, class: "sited", claimant, household, status, body: `the body of ${id}`,
  geometry: { slug: id, at: { x: 12, y: 34 }, extent: { w: 2, h: 2 } },
  stake, data: { by: claimant, kind: "sited", date: "2026-10-19" },
  window_id, submitted_at: new Date(Date.now() - ago - 3600e3),
  decided_at: ["locked", "refused", "held_review"].includes(status) ? new Date(Date.now() - ago) : null,
  refusal_check: status === "refused" ? "harm: a fixture refusal" : null, supersedes: null,
});

const ms = (t) => (t == null ? NaN : t instanceof Date ? t.getTime() : Date.parse(String(t)));

/**
 * The store. It honours what both readers depend on — and that is the whole of
 * its value: a fake that ignored `status = ANY($1)` could not tell a reader that
 * never asks for a locked claim from one that asks and drops it, and one that
 * ignored the window could not tell a bound from none (TEST-DESIGN § A fake must
 * honour what the code depends on). Both claims readers are answered:
 *
 *   the OVERLAY  `LIVE_CLAIM_SELECT … WHERE status = ANY($1) AND household = ANY($2)`
 *   the EFFECTS  `claimRowsSince`: `claimant = ANY($1) OR slug = ANY($2)` since $3,
 *                under 007's row policy (a draft is its own household's only)
 *
 * `honourStatuses: false` is the ONE deliberate lie, for the tests that stand for
 * "LIVE_STATUSES widened": the overlay hands back every row of the house whatever
 * statuses were asked for. It is named at its call site, never the default.
 * `down: true` breaks the effects reader only (the docket cannot be read).
 *
 * A query it does not know THROWS: an empty answer to a question it does not
 * understand reads as "the record holds none".
 */
function store(rows, { honourStatuses = true, down = false } = {}) {
  let declared = null, declaredKeys = null;
  const claimsAsked = [];      // the overlay's asks
  const effectsAsked = [];     // the effects reader's asks
  const self = {
    claimsAsked, effectsAsked,
    async query(sql, args = []) {
      const q = String(sql).replace(/\s+/g, " ").trim();
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(q)) return { rows: [] };
      if (/set_config\(.app\.household_keys./.test(q)) { declaredKeys = args[0] ? String(args[0]).split(",") : null; return { rows: [{}] }; }
      if (/set_config\(.app\.household./.test(q)) { declared = args[0]; return { rows: [{}] }; }
      if (/current_setting\(.app\.household./.test(q)) return { rows: [{ declared, keys: declaredKeys }] };
      // The overlay's DELETED arm (guard-reads.mjs § WITHDRAW_ACT_SELECT): nothing withdrawn here.
      if (/^SELECT/i.test(q) && /FROM acts a/.test(q) && /'withdraw'/.test(q)) return { rows: [] };
      // The registry, three fixed SELECTs: empty, so every handle is its own `solo:` house.
      if (/FROM households/.test(q) || /FROM household_pins/.test(q) || /FROM identities/.test(q)) return { rows: [] };
      if (/FROM registry_meta/.test(q)) return { rows: [{ key: "schema_version", value: 1 }] };
      if (/^SELECT/i.test(q) && /FROM claims/.test(q)) {
        if (/claimant = ANY\(\$1::text\[\]\)/.test(q)) {          // claim-effects.mjs → world2-claims.mjs § claimRowsSince
          const [claimants = [], slugs = [], since] = args;
          effectsAsked.push({ claimants: [...claimants], slugs: [...slugs], since });
          if (down) throw new Error("the docket is down");
          const sinceMs = Date.parse(since);
          const visible = (c) => c.status !== "draft" || (declaredKeys ?? []).includes(c.household);
          return { rows: rows.filter((c) => (claimants.includes(c.claimant) || slugs.includes(c.slug)) && visible(c)
            && (ms(c.submitted_at) >= sinceMs || ms(c.decided_at) >= sinceMs)) };
        }
        const [statuses, asked] = args;                           // the overlay → guard-reads.mjs § pgLiveMarks
        claimsAsked.push({ statuses: [...statuses], households: [].concat(asked ?? []) });
        const keys = asked == null ? null : [].concat(asked);
        return { rows: rows.filter((c) => (honourStatuses ? statuses.includes(c.status) : true)
          && (keys == null || keys.includes(c.household))) };
      }
      throw new Error(`the hand-built store was asked something it does not know: ${q.slice(0, 120)}`);
    },
    async connect() { return { query: (s, a) => self.query(s, a), release() { /* pooled in name only */ } }; },
    release() { /* pooled in name only */ },
    async end() { /* nothing to end */ },
  };
  return self;
}

/** Read the door as `key`, through a store holding `rows`, with every seam installed and put back. */
async function door(rows, { key = KEY, offset = 0, ...opts } = {}) {
  const fake = store(rows, opts);
  __clearHouseCache();
  const restore = useGuardReader(async (run) => run(fake));
  __setClaimsPool(fake);
  __setActsPool(fake);
  try {
    const answer = await worldMyMarks(key, { offset });
    assert.ok(!answer?.error, `the door bounced: ${JSON.stringify(answer?.defect ?? answer).slice(0, 300)}`);
    return { answer, fake };
  } finally { restore(); __setClaimsPool(null); __setActsPool(null); __clearHouseCache(); }
}

/** Every list the answer carries, by name, as the ids on it. (Shape-agnostic about which lists exist.) */
const shelvesOf = (answer) => Object.fromEntries(Object.entries(answer)
  .filter(([, value]) => Array.isArray(value))
  .map(([name, rows]) => [name, rows.map((row) => (typeof row === "string" ? row : row?.id))]));
const shelvesHolding = (answer, id) => Object.entries(shelvesOf(answer)).filter(([, ids]) => ids.includes(id)).map(([name]) => name);

// RULED (Wright, 2026-11-02, on postmark-office#839): "PUBLIC — the candle ruled for these and no
// settlement has carried them to the world yet; they reach it at the settlement that carries their
// candle." plus the receipt pointer the docket label carries.
const RULED_LOCKED_LABEL = "PUBLIC — the candle ruled for these and no settlement has carried them to the world yet; they reach it at the settlement that carries their candle. `world { read: \"leave-mark\", args: { mark: \"<by>/<slug>\" } }` carries its receipt.";

// ═════════════════════════════════════════════════════════════════════════════
// THE HARNESS IS LIVE, AND THE READER IS UNCHANGED
// ═════════════════════════════════════════════════════════════════════════════

test("CONTROL: a draft files under drafts and a pending claim under docket, the overlay still asks for draft and pending only, and `counts` names five lists", skipIfNoClone, async () => {
  const { answer, fake } = await door([
    claim({ id: SHED, status: "draft" }),
    claim({ id: STAKED, status: "pending", stake: 2 }),
  ]);
  assert.deepEqual(shelvesHolding(answer, SHED), ["drafts"], "a private draft files under drafts");
  assert.deepEqual(shelvesHolding(answer, STAKED), ["docket"], "a pending claim files under docket");
  assert.equal(answer.counts.drafts, 1);
  assert.equal(answer.counts.docket, 1);
  assert.deepEqual(Object.keys(answer.counts).sort(), ["backed", "docket", "drafts", "locked", "published"], "`locked` joined counts (RULED)");
  assert.ok(!("locked_unavailable" in answer), "and a docket that was read says nothing of being unread");
  // RULED: "LIVE_STATUSES and the overlay reader stay as they are" — the write-path guards read the same constant.
  assert.ok(fake.claimsAsked.length > 0, "the overlay never asked the store for claims — the harness read nothing, and every absence below would mean nothing");
  for (const ask of fake.claimsAsked) assert.deepEqual(ask.statuses, [...LIVE_STATUSES], "the overlay asks for exactly the live statuses");
  assert.deepEqual([...LIVE_STATUSES], ["draft", "pending"], "and those are draft and pending, the two sides of 007's line");
});

// ═════════════════════════════════════════════════════════════════════════════
// DRAFTS ARE DRAFTS — the positive filter
// ═════════════════════════════════════════════════════════════════════════════

test("DRAFTS ARE DRAFTS: a live row with a claim status the shelves do not know is never filed under the private word", skipIfNoClone, async () => {
  // LAW (world2/schema/007_private_drafts.sql, as leave-mark-drafts-and-docket
  // quotes it): "USING (status <> 'draft' OR household = current_setting('app.household', true))"
  // — a draft is private to its household; EVERY OTHER STATUS IS PUBLIC. So the
  // word the read puts on a locked row must never be the private one.
  //
  // `honourStatuses: false` — the one lie, on purpose: the overlay hands the locked
  // row back whatever was asked for, which is what the read would see the day
  // LIVE_STATUSES were widened (the event the code's own comment warns about).
  const { answer } = await door([claim({ id: SHED, status: "draft" }), claim({ id: BOWL, status: "locked" })], { honourStatuses: false });
  // The control that the row reached the splitter at all: the draft arrived beside it.
  assert.deepEqual(shelvesHolding(answer, SHED), ["drafts"], "the control: the draft that arrived with it is on drafts, so the overlay ran");
  assert.ok(!shelvesHolding(answer, BOWL).includes("drafts"),
    `a LOCKED claim, public by 007, was filed under "drafts" — the word the labels call "your drafts, not the town's canon, on no docket"; it is on: ${JSON.stringify(shelvesHolding(answer, BOWL))}, drafts: ${JSON.stringify(shelvesOf(answer).drafts)}`);
  assert.equal(answer.counts.drafts, 1, "and counts.drafts counts the one draft, not the locked row");
});

test("a live row with NO claim status (a sketchbook row) is private, so it still files under drafts", skipIfNoClone, async () => {
  // GUARD 2's own header: dropping the sketchbook half "would make a resident's
  // existing work vanish from their own overlay on the day the guard flipped".
  // A row with no `status` column comes through the overlay with no
  // `claim_status`, exactly as a sketchbook row does. (`honourStatuses: false`
  // is how it gets past the status filter here: a real `claims` row always has a
  // status; the sketchbook half has none, and rides the git delta, not the SQL.)
  const bare = { ...claim({ id: NOTHING, status: "draft" }), status: undefined };
  const { answer } = await door([bare], { honourStatuses: false });
  assert.deepEqual(shelvesHolding(answer, NOTHING), ["drafts"], "a row the docket never held cannot be on the docket, and is private");
  assert.equal(answer.counts.drafts, 1);
  assert.equal(answer.counts.docket, 0);
});

// ═════════════════════════════════════════════════════════════════════════════
// KOGANE'S SHAPE — the acceptance
// ═════════════════════════════════════════════════════════════════════════════

test("KOGANE'S SHAPE (acceptance): a claim the candle locked, not yet carried, is on a shelf of its own, with its label, and in counts", skipIfNoClone, async () => {
  // LAW (mark-receipt.mjs § receiptFrom, the focused read's own sentence for this
  // state): "locked at candle N — the candle ruled for it; it reaches the world
  // at the settlement that carries that candle". The bare read owes the resident
  // the same fact about the same mark. The report's own bare read had drafts 1
  // (a different mark), docket 0, published 0, refused 0 — rebuilt here.
  const { answer, fake } = await door([claim({ id: SHED, status: "draft" }), claim({ id: BOWL, status: "locked", stake: 0 })]);
  assert.ok(fake.effectsAsked.length > 0, "the claim effects were never read — the harness proved nothing about the shelf");
  assert.deepEqual(shelvesHolding(answer, BOWL), ["locked"],
    `${BOWL} must stand on the \`locked\` shelf and on no other; shelves: ${JSON.stringify(shelvesOf(answer))}; counts: ${JSON.stringify(answer.counts)}`);
  assert.deepEqual(answer.counts, { drafts: 1, docket: 0, locked: 1, published: 0, backed: 0 }, "the report's counts, and the bowl in them");
  assert.equal(answer.refused.count, 0, "and `refused` is as the report had it");
  assert.equal(answer.shown.locked, 1);
  assert.equal(answer.complete, true);
  assert.ok(!("withheld" in answer), "nothing was withheld");
  const row = answer.locked[0];
  assert.deepEqual({ id: row.id, by: row.by, window: row.window }, { id: BOWL, by: HANDLE, window: 259 });
  assert.match(row.locked_at, /^\d{4}-\d\d-\d\dT/, "when the candle ruled, as an ISO instant");
  assert.equal(row.says, receiptFrom({ id: BOWL, claims: [{ slug: BOWL, status: "locked", window_id: 259 }] }).says,
    "the row says what the focused read says about the same mark, derived from it and not copied");
  assert.equal(answer.labels.locked, RULED_LOCKED_LABEL, "the shelf's label is the ruled one");
  assert.equal(answer.labels.locked, PORTFOLIO_LABELS.locked, "and the twin's is the same word for word");
  assert.ok(!("locked_unavailable" in answer));
});

// ═════════════════════════════════════════════════════════════════════════════
// THE RULES THE SHELF IS DERIVED BY
// ═════════════════════════════════════════════════════════════════════════════

test("CARRIED IS NOT LOCKED: a locked claim whose mark canon holds is `published`'s, and the shelf does not list it", skipIfNoClone, async () => {
  // RULED: "'Not yet carried' is canon-absence, the 1.0 focused read's own rule."
  // LAW (mark-receipt.mjs § receiptFrom § 1): "PUBLISHED. Canon holds it, so the
  // settlement ruled and the answer is a fact about the world, whatever the docket
  // says about the claim behind it." A locked claim stays `locked` for good (the
  // status set has no `carried`), so a carried mark's claim is locked forever.
  //
  // The mark is read off the real canon the door reads (derived, never typed), and
  // its author is the key's one handle. The fresh bowl beside it is the control:
  // the same author, the same minute, locked and in no canon.
  const canon = new Set((publishedState(WORLD_CLONE).state?.marks ?? []).map((m) => m.id));
  const carried = (publishedState(WORLD_CLONE).state?.marks ?? []).find((m) => m?.id && m?.by && m.by !== "the-town");
  assert.ok(carried, "the pinned world holds no mark to stand for a carried one — this test would be vacuous");
  const key = { household: "pos4014-carried", handles: new Set([carried.by]) };
  const house = `solo:${carried.by}`;
  const FRESH = `${carried.by}/a-fresh-locked-bowl`;
  assert.ok(canon.has(carried.id) && !canon.has(FRESH), "the premise, read from canon: the first is carried and the second is not");
  const { answer } = await door([
    claim({ id: carried.id, status: "locked", claimant: carried.by, household: house }),
    claim({ id: FRESH, status: "locked", claimant: carried.by, household: house }),
  ], { key });
  assert.deepEqual(shelvesHolding(answer, FRESH), ["locked"], "the control: the uncarried one is on the shelf");
  assert.ok(!shelvesHolding(answer, carried.id).includes("locked"),
    `${carried.id} is held by canon and was listed as locked, "waiting for a settlement" it has already had; it is on ${JSON.stringify(shelvesHolding(answer, carried.id))}`);
  assert.equal(answer.counts.locked, 1);
});

test("THE BOUND: a lock older than the two crossings the doorstep and `refused` look back over is not on the shelf", skipIfNoClone, async () => {
  assert.equal(RULINGS_SINCE_CROSSINGS, 2, "the window is `refused`'s, and the ruling says the same two crossings");
  const OLD = `${HANDLE}/locked-a-long-time-ago`;
  // Three crossings and an hour back: before the window opens, whatever instant "now" is.
  const { answer } = await door([
    claim({ id: BOWL, status: "locked" }),
    claim({ id: OLD, status: "locked", ago: (RULINGS_SINCE_CROSSINGS + 1) * CROSSING_MS + 3600e3 }),
  ]);
  assert.deepEqual(shelvesHolding(answer, BOWL), ["locked"], "the control: the fresh lock is on the shelf, so the effects were read");
  assert.deepEqual(shelvesHolding(answer, OLD), [], "and the old one, past the bound, is on no shelf");
  assert.equal(answer.counts.locked, 1);
});

test("ONLY YOURS: another household's locked claim is not on the shelf", skipIfNoClone, async () => {
  const THEIRS = "pos4014-stranger/their-bowl";
  const { answer } = await door([
    claim({ id: BOWL, status: "locked" }),
    claim({ id: THEIRS, status: "locked", claimant: "pos4014-stranger", household: "solo:pos4014-stranger" }),
  ]);
  assert.deepEqual(shelvesHolding(answer, BOWL), ["locked"], "the control: ours is on the shelf");
  assert.deepEqual(shelvesHolding(answer, THEIRS), [], "theirs is a public fact, and it is not this household's portfolio");
});

test("NOTHING PUBLISHED: a household with no mark on the world still sees its first locked claim", skipIfNoClone, async () => {
  // `residents` is read off canon, so a household with nothing published has none,
  // and the first claim is the one most worth seeing. The shelf is asked for the
  // residents AND the key's own handles.
  const { answer } = await door([claim({ id: BOWL, status: "locked" })]);
  assert.deepEqual(answer.residents, [], "the premise: canon names no resident of this household");
  assert.deepEqual(shelvesHolding(answer, BOWL), ["locked"], "and the bowl is on the shelf all the same");
});

test("SLUGLESS: a locked claim with no slug neither throws nor appears, and the rest of the read stands", skipIfNoClone, async () => {
  // A slugless claim names no mark; there are real ones on prod (claim-effects.mjs,
  // 2026-09-07). RULED: "skipping slugless rows".
  const { answer } = await door([
    claim({ id: SHED, status: "draft" }),
    claim({ id: BOWL, status: "locked" }),
    claim({ id: "unnamed", status: "locked", slug: null }),
  ]);
  assert.deepEqual(shelvesHolding(answer, BOWL), ["locked"], "the control: the named claim is on the shelf");
  assert.equal(answer.counts.locked, 1, "and the slugless one is not counted");
  assert.deepEqual(shelvesHolding(answer, SHED), ["drafts"], "and the overlay half of the read is unharmed");
  assert.ok(!("locked_unavailable" in answer), "nor did it read as an unreadable docket");
});

test("HELD IS NOT HERE: a held_review claim is not on the shelf", skipIfNoClone, async () => {
  // RULED: "`held_review` waits for its own ruling. It isn't on this shelf."
  const HELD = `${HANDLE}/the-held-one`;
  const { answer } = await door([claim({ id: BOWL, status: "locked" }), claim({ id: HELD, status: "held_review" })]);
  assert.deepEqual(shelvesHolding(answer, BOWL), ["locked"], "the control: the locked one is on the shelf");
  assert.deepEqual(shelvesHolding(answer, HELD), [], "a held claim is on no shelf of this read yet, and is not filed under the private word either");
  assert.equal(answer.counts.locked, 1);
});

test("REFUSED STAYS REFUSED: the `refused` block is as it was, and a refused claim is not `locked`", skipIfNoClone, async () => {
  // `refused` is asked for the residents canon names; this key's household has no
  // published mark, so it is asked of the real canon's author instead (the first
  // test's trick), whose handle the fixture's refusal is filed under.
  const canonMark = (publishedState(WORLD_CLONE).state?.marks ?? []).find((m) => m?.id && m?.by && m.by !== "the-town");
  const key = { household: "pos4014-refused", handles: new Set([canonMark.by]) };
  const house = `solo:${canonMark.by}`;
  const REFUSED = `${canonMark.by}/a-refused-bowl`;
  const LOCKED = `${canonMark.by}/a-locked-bowl`;
  const { answer } = await door([
    claim({ id: LOCKED, status: "locked", claimant: canonMark.by, household: house }),
    claim({ id: REFUSED, status: "refused", claimant: canonMark.by, household: house }),
  ], { key });
  assert.deepEqual(shelvesHolding(answer, LOCKED), ["locked"], "the control: the locked claim is on the shelf");
  assert.deepEqual(shelvesHolding(answer, REFUSED), [], "a refused claim is not on it");
  assert.deepEqual(answer.refused.rows.map((r) => r.mark), [REFUSED], "and `refused` still lists exactly the refusal");
});

// ═════════════════════════════════════════════════════════════════════════════
// THE PAGE — counts first, slice after
// ═════════════════════════════════════════════════════════════════════════════

test("THE PAGE: counts.locked is the whole, the page is cut like the other lists', the overflow is named, and offset reaches the shelf", skipIfNoClone, async () => {
  const rows = Array.from({ length: 25 }, (_, i) => claim({ id: `${HANDLE}/locked-${String(i).padStart(2, "0")}`, status: "locked" }));
  const first = await door(rows);
  const a = first.answer;
  assert.equal(a.counts.locked, 25, "the count is the whole of what is waiting, taken before the page cuts it");
  assert.equal(a.locked.length, 20, "the page is the other lists' page (20)");
  assert.equal(a.shown.locked, 20);
  assert.equal(a.complete, false);
  assert.equal(a.withheld.locked.length, 5, "the five it did not show are named, by id");
  assert.deepEqual([...a.locked.map((r) => r.id), ...a.withheld.locked].sort(), rows.map((r) => r.slug).sort(), "shown and named are exactly the 25");
  assert.match(a.withheld_note, /5 of your marks/, "and the total in the note counts the locked shelf");
  // The offset is wired to this shelf as to the rest: the second page is the tail.
  const second = (await door(rows, { offset: 20 })).answer;
  assert.equal(second.locked.length, 5, "offset 20 shows the last five");
  assert.equal(second.withheld.locked.length, 20, "and names the twenty before them");
  assert.equal(second.counts.locked, 25);
});

test("UNAVAILABLE: an unread docket is said, never an empty shelf that reads as nothing waiting", skipIfNoClone, async () => {
  const { answer } = await door([claim({ id: BOWL, status: "locked" })], { down: true });
  assert.deepEqual(answer.locked, [], "nothing could be listed");
  assert.equal(answer.counts.locked, 0);
  assert.match(answer.locked_unavailable, /could not be read/, "and the answer says why the shelf is empty");
  // (`refused` is not asked at all for this household: it reads the residents canon names, and canon
  // names none here. That blind spot is `refused`'s own and is not touched; the shelf asks the key's
  // handles too, which is why it can say it could not read.)
  // the reader itself, apart from the door
  const fake = store([], { down: true });
  __setClaimsPool(fake);
  try {
    const r = await myMarksLocked([HANDLE], { key: null });
    assert.deepEqual(r.rows, []);
    assert.match(r.unavailable, /could not be read/);
  } finally { __setClaimsPool(null); }
});

// ═════════════════════════════════════════════════════════════════════════════
// lockedRowsFrom — the pure rules, with no store, clone or clock
// ═════════════════════════════════════════════════════════════════════════════

const ev = (mark, over = {}) => ({
  kind: "claim-locked", mark, at: "2026-11-02T05:00:00.000Z", crossing: 400, window: 259,
  yours: true, on_your_ground: false, summary: `${mark} was locked`, ...over,
});

test("lockedRowsFrom: only `claim-locked` events, only yours, only what canon does not hold", () => {
  const events = [
    ev("a/kept"),
    ev("a/refused", { kind: "claim-refused" }),
    ev("a/pending", { kind: "claim-pending" }),
    ev("b/laid-on-my-ground", { yours: false, on_your_ground: true }),
    ev("a/carried"),
  ];
  const rows = lockedRowsFrom(events, new Set(["a/carried"]));
  assert.deepEqual(rows.map((r) => r.id), ["a/kept"],
    "the kept one is the control; a refusal, a pending claim, another's mark on my ground and a carried mark are each out");
  assert.deepEqual(lockedRowsFrom(events, ["a/carried"]).map((r) => r.id), ["a/kept"], "canon may be handed as any iterable of ids");
  assert.deepEqual(lockedRowsFrom(events).map((r) => r.id).sort(), ["a/carried", "a/kept"], "with no canon handed, nothing is carried");
});

test("lockedRowsFrom: one row per mark, the newest ruling deciding, in id order", () => {
  const rows = lockedRowsFrom([
    ev("a/zebra", { window: 258, at: "2026-11-01T17:00:00.000Z" }),
    ev("a/apple", { window: 259 }),
    ev("a/zebra", { window: 259, at: "2026-11-02T05:00:00.000Z" }),       // amended and locked again, neither carried
    ev("a/zebra", { window: 257, at: "2026-11-01T05:00:00.000Z" }),       // and the oldest, listed last
  ], new Set());
  assert.deepEqual(rows.map((r) => [r.id, r.window]), [["a/apple", 259], ["a/zebra", 259]],
    "`receiptFrom`'s rule: the newest row decides the tense, older rows are history; and ids sort as `published` sorts");
});

test("lockedRowsFrom: a row is `id`-keyed like every shelf's, says the focused read's sentence, and carries no mark position", () => {
  const [row] = lockedRowsFrom([ev("kogane/the-bowl-on-the-step", { window: 259 })], new Set());
  assert.deepEqual(Object.keys(row).sort(), ["by", "id", "locked_at", "says", "window"]);
  assert.equal(row.by, "kogane");
  assert.equal(row.says, receiptFrom({ id: row.id, claims: [{ slug: row.id, status: "locked", window_id: 259 }] }).says,
    "derived from `receiptFrom`, never copied: the bare read and the focused read cannot tell it two ways");
});

test("lockedRowsFrom: a slugless claim names no mark, so the effects skip it and no row is made", () => {
  // RULED: "skipping slugless rows". The skip is `claimEffectsFrom`'s (test/slugless-claims.test.mjs binds
  // it); this holds that the two compose: a slugless locked claim, run through the real events, yields none.
  const now = Date.now();
  const events = claimEffectsFrom({
    rows: [
      { id: 1, slug: null, claimant: "a", status: "locked", window_id: 259, submitted_at: new Date(now - 7200e3), decided_at: new Date(now - 60e3) },
      { id: 2, slug: "a/named", claimant: "a", status: "locked", window_id: 259, submitted_at: new Date(now - 7200e3), decided_at: new Date(now - 60e3) },
    ],
    sinceCrossing: 0, nowCrossing: 1e9, mine: (id, row) => row.claimant === "a",
  });
  assert.deepEqual(lockedRowsFrom(events, new Set()).map((r) => r.id), ["a/named"], "the named one is the control");
  assert.deepEqual(lockedRowsFrom([ev(null)], new Set()), [], "and an event that somehow names no mark makes no row either");
});

test("LABELS AND WORDS: the ruled label, on both doors", () => {
  assert.equal(PORTFOLIO_LABELS.locked, RULED_LOCKED_LABEL, "the twin's constant is the ruled label");
});
