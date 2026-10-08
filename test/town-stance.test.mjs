// town-stance.test.mjs — POS-361, the office half: the town's stance as law.
//
// The rulings each test holds, verbatim (Darko, 2026-10-06, deep slot 1, on
// POS-361):
//
//   "Words: the town reuses the resident tri-state. A declared neutral replaces
//    'ratified': it clears 'awaiting the town' and confers nothing. opposed is
//    unchanged. A town welcomed is adoption, reserved, and refused for now.
//    Silence leaves the mark awaiting."
//   "Verb: no new verb. The town speaks with declare-stance-on."
//   "Speaker: postmark-pen, household the-town, as town quest posts already
//    are. The act names the hand that held the pen. Hands: darko, wright,
//    worldkeeper."
//   "Citations: law marks only, in the shape the world lints already use (law =
//    the mark id, plus its text verbatim)."
//   "Cutover (Q4): the first settlement after Sunday's ship, set by Wright at
//    the deploy."
//   "Version (Q5): every stance records the mark version it was spoken on; a
//    stale version is absent, so an amendment reopens every word."
//   "Awaiting (Q6): the stance door's overlap rule, grouped by HOUSEHOLD, with
//    seniority (a parcel holder speaks only on marks younger than the parcel)."
//
// Each numbered test is the falsifier for the brief's item of the same number;
// its flip is named in its header and in the PR body.
//
//   node --test test/town-stance.test.mjs

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { installActsPen, uninstallActsPen, RECORD_ON } from "./acts-pen-stub.mjs";
import { __setStancePoolForTest } from "../src/world2-acts.mjs";
import { CLASS_STANCE, ACTION_STANCE, candidatesFrom, declareStanceViaOffice, resetStanceGeometry, stanceInbox, stanceRows, standingStances } from "../src/world-stance.mjs";
import {
  TOWN, TOWN_HANDS, TOWN_SPEAKER, awaitingLabels, awaitingOf, citeLaw, clearedAtCutover, cutoverNumber,
  readCutover, townSeatOf, townWordsOf, versionAt, versionsFromRows,
} from "../src/town-stance.mjs";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const scratch = mkdtempSync(join(tmpdir(), "postmark-town-stance-"));
after(() => sweep(scratch));

// ── the world in a bottle ────────────────────────────────────────────────────
//
// alpha and alpha2 are ONE household (hh:alpha). alpha's parcel stood on 08-01;
// alpha2's cairn sits inside it, later. beta's cairn (08-10) overlaps both.
// epsilon's mark stood before alpha's parcel and overlaps it. Two town marks:
// one law (tier constitution), one market stall (not law).

const repo = join(scratch, "world");
mkdirSync(repo, { recursive: true });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const UNMOVED = "A departure is judged against the stop geometry of its own instant — rearranging the world never makes the past late.";
const MARKS = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 1, h: 1 }, date: "2026-07-01", body: "the world frame" },
  { id: "the-town/the-unmoved-past", by: "the-town", kind: "class", tier: "constitution", date: "2026-08-19", body: UNMOVED },
  { id: "the-town/a-market-stall", by: "the-town", kind: "sited", tier: "market", at: { x: 9000, y: -9000 }, extent: { w: 2, h: 2 }, date: "2026-07-02", body: "a stall, not a law" },
  { id: "alpha/alphas-parcel", by: "alpha", kind: "parcel", tier: "home", at: { x: 100, y: 100 }, extent: { w: 25, h: 25 }, date: "2026-08-01", body: "alpha's ground" },
  { id: "alpha2/the-cairn", by: "alpha2", kind: "sited", tier: "home", at: { x: 110, y: 100 }, extent: { w: 4, h: 4 }, date: "2026-08-05", body: "alpha2's cairn, inside the house's parcel" },
  { id: "beta/on-alphas-edge", by: "beta", kind: "sited", tier: "market", at: { x: 112, y: 100 }, extent: { w: 4, h: 4 }, date: "2026-08-10", body: "beta's cairn, half over the line" },
  { id: "epsilon/was-here-first", by: "epsilon", kind: "sited", tier: "market", at: { x: 90, y: 100 }, extent: { w: 6, h: 6 }, date: "2026-07-15", body: "standing here since before alpha arrived" },
];
const HOUSEHOLDS = { alpha: "hh:alpha", alpha2: "hh:alpha", beta: "hh:beta", epsilon: "hh:epsilon" };

put("tools/geometry.mjs", `
export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function overlapArea(a, b) {
  const dx = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const dy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}
`);
put("WORLD/world-state.json", JSON.stringify({ tick: 0, marks: MARKS, parcels: [], households: HOUSEHOLDS }));
put("WORLD/skeleton.json", JSON.stringify({ features: [] }));
git("init", "-q", "-b", "main");
git("config", "user.email", "t@postmark.invalid");
git("config", "user.name", "town stance falsifier");
git("add", "-A");
git("commit", "-qm", "canon");
const MAIN_SHA = git("rev-parse", "HEAD").trim();

// ── the store's claims, as the stance credential reads them ─────────────────
//
// A pool that answers the two questions the stance credential asks: the live
// sketches (none here; every mark above is canon) and the versions. The version
// answer is computed from CLAIMS by the real SQL's own predicate, so a test
// that amends a mark does it by adding a claim, the way the store does.
let CLAIMS = [];
// The live layer: drafts the stance credential sees (023's carve). Empty unless a test plants one.
let LIVE = [];
const claim = (slug, id, { status = "locked", window_id = 10, at = "2026-08-20T00:00:00Z" } = {}) =>
  ({ slug, id, status, window_id, submitted_at: at, decided_at: status === "locked" ? at : null });
const stancePool = {
  async query(text, params = []) {
    if (/FROM claims\s+WHERE slug = ANY\(\$1\) AND status = ANY\(\$2\)/.test(text)) {
      const slugs = new Set(params[0]), statuses = new Set(params[1]);
      return { rows: CLAIMS.filter((c) => slugs.has(c.slug) && statuses.has(c.status)) };
    }
    if (/FROM claims\s+WHERE status = ANY\(\$1\)/.test(text)) return { rows: LIVE.filter((r) => params[0].includes(r.status)) };
    throw new Error(`the stance pool stub does not answer: ${text.slice(0, 80)}`);
  },
  async end() {},
};

const wright = { household: "wright", handles: new Set(["wright"]) };
const alpha = { household: "alpha", handles: new Set(["alpha"]) };
const alpha2 = { household: "alpha2", handles: new Set(["alpha2"]) };
const beta = { household: "beta", handles: new Set(["beta"]) };

let pen;
beforeEach(() => {
  process.env.WORLD_SINGLE_LOG = "1";
  process.env.WORLD2_STANCE_URL = "postgres://stub/none";
  process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
  process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
  process.env.W2_LATE_ARRIVAL = "town-stance.test.mjs fixtures declare at crossing 145 on purpose";
  __setStancePoolForTest(stancePool);
  pen = installActsPen();
  resetStanceGeometry();
  CLAIMS = [claim("beta/on-alphas-edge", "c-beta-1"), claim("alpha/alphas-parcel", "c-alpha-1")];
  LIVE = [];
});
after(() => {
  for (const k of ["WORLD_SINGLE_LOG", "WORLD2_STANCE_URL", "WORLD2_PG", "WORLD2_PG_URL", "W2_LATE_ARRIVAL"]) delete process.env[k];
  __setStancePoolForTest(null);
  uninstallActsPen();
});

const speak = (args, key) => declareStanceViaOffice(repo, args, key, { crossing: 145 });
const written = () => pen.rows().filter((r) => r.class === CLASS_STANCE)
  .map((r) => ({ ...r, seq: r.id, payload: JSON.parse(r.payload), written_at: r.at }));
const overlaps = (a, b) => {
  const r = (m) => ({ x: m.at.x, y: m.at.y, w: m.extent.w, h: m.extent.h });
  const A = r(a), B = r(b);
  return Math.min(A.x + A.w / 2, B.x + B.w / 2) - Math.max(A.x - A.w / 2, B.x - B.w / 2) > 0
      && Math.min(A.y + A.h / 2, B.y + B.h / 2) - Math.max(A.y - A.h / 2, B.y - B.h / 2) > 0;
};
const mark = (id) => ({ ...MARKS.find((m) => m.id === id), published: true });
const householdOf = (h) => HOUSEHOLDS[h] ?? h;

// ── 1 · the town speaks through declare-stance-on ───────────────────────────
// FLIP: in declareStanceViaOffice, skip the `as: "town"` arm → the hand is read
// as a resident with no ground there and refused 403, and no pen row exists.

test("1 · the town speaks through declare-stance-on, written by its own pen, naming the hand", async () => {
  assert.deepEqual(TOWN_HANDS, ["darko", "wright", "worldkeeper"], "the ruled hands, darko included (inert until a key holds it)");

  const r = await speak({ as: "town", on: "beta/on-alphas-edge", stance: "neutral" }, wright);
  assert.equal(r.by, TOWN_SPEAKER, "the speaker is the town's pen");
  assert.equal(r.household, TOWN);
  assert.equal(r.hand, "wright", "and the act names the hand that held it");

  const [row] = written();
  assert.equal(row.action, ACTION_STANCE, "no new verb");
  assert.equal(row.actor, "postmark-pen");
  assert.equal(row.payload.as, "town");
  assert.equal(row.payload.hand, "wright");

  await assert.rejects(() => speak({ on: "beta/on-alphas-edge", stance: "neutral" }, wright), (e) => {
    assert.equal(e.code, 403, "without as: \"town\" the same hand is a resident, with no ground there");
    return true;
  }, "the town's word is one explicit field, never inferred from the key");
  await assert.rejects(() => speak({ as: "town", on: "beta/on-alphas-edge", stance: "neutral" }, beta), (e) => {
    assert.equal(e.code, 403);
    assert.match(e.defect, /only the town's hands/);
    return true;
  });
  await assert.rejects(() => speak({ as: "mayor", on: "beta/on-alphas-edge", stance: "neutral" }, wright), (e) => e.code === 422);
  assert.equal(written().length, 1, "every refusal left nothing behind");
});

// ── 2 · the words ───────────────────────────────────────────────────────────
// FLIP: let judgeTownWord pass "welcomed" → the town's welcomed is written.

test("2 · the town says neutral or opposed; its welcomed is adoption, reserved; a resident may say neutral", async () => {
  await assert.rejects(() => speak({ as: "town", on: "beta/on-alphas-edge", stance: "welcomed", law: ["the-town/the-unmoved-past"] }, wright), (e) => {
    assert.equal(e.code, 422);
    assert.match(e.defect, /adoption, and it is reserved/);
    return true;
  });
  assert.equal(written().length, 0, "nothing was written");

  const n = await speak({ as: "town", on: "beta/on-alphas-edge", stance: "neutral" }, wright);
  assert.match(n.effect, /clears "awaiting the town" and confers nothing/);

  const res = await speak({ on: "beta/on-alphas-edge", stance: "neutral" }, alpha);
  assert.equal(res.stance, "neutral", "and the resident's neutral is a word too: one taxonomy");
});

// ── 3 · citations: law marks only ───────────────────────────────────────────
// FLIP: drop citeLaw's "opposition cites the law" refusal → an uncited
// opposition is written.

test("3 · an opposition cites law marks at the law sha, recorded with their words verbatim", async () => {
  await assert.rejects(() => speak({ as: "town", on: "beta/on-alphas-edge", stance: "opposed" }, wright), (e) => {
    assert.equal(e.code, 422);
    assert.match(e.defect, /cites the law it applies/);
    return true;
  }, "an uncited opposition is opinion, and the town's word is law");
  await assert.rejects(() => speak({ as: "town", on: "beta/on-alphas-edge", stance: "opposed", law: ["the-town/no-such-law"] }, wright),
    (e) => e.code === 422 && /not a mark at the law sha/.test(e.defect));
  await assert.rejects(() => speak({ as: "town", on: "beta/on-alphas-edge", stance: "opposed", law: ["the-town/a-market-stall"] }, wright),
    (e) => e.code === 422 && /is not law/.test(e.defect), "a mark that is not of the constitution tier is not law");
  assert.equal(written().length, 0, "nothing was written by any of the three");

  const r = await speak({ as: "town", on: "beta/on-alphas-edge", stance: "opposed", law: ["the-town/the-unmoved-past"] }, wright);
  assert.deepEqual(r.law, [{ law: "the-town/the-unmoved-past", law_text: UNMOVED }], "the lints' shape: the id, and its words verbatim");
  assert.equal(r.law_sha, MAIN_SHA, "read at the law sha (no snapshot, no tag in this bottle: main, and it says so)");
  assert.deepEqual(written()[0].payload.law, r.law, "and the record holds what the answer says");

  // Neutral may carry a citation and does not need one.
  assert.deepEqual(citeLaw(undefined, { word: "neutral", lawMarks: [mark("the-town/the-unmoved-past")], sha: MAIN_SHA }), []);
});

// ── 4 · the version a word is spoken on ─────────────────────────────────────
// FLIP: make onCurrentVersion answer true → the amended mark keeps the town's
// opposition and stays out of alpha's inbox.

test("4 · every stance records the version it was spoken on, and an amendment reopens every word", async () => {
  await speak({ as: "town", on: "beta/on-alphas-edge", stance: "opposed", law: "the-town/the-unmoved-past" }, wright);
  const said = await speak({ on: "beta/on-alphas-edge", stance: "opposed" }, alpha);
  assert.equal(said.version, "c-beta-1", "the resident's word names the version");
  assert.deepEqual(written().map((r) => r.payload.version), ["c-beta-1", "c-beta-1"], "and so does the town's");

  let read = versionsFromRows(CLAIMS);
  assert.deepEqual([...townWordsOf(written(), { versions: read })], [["beta/on-alphas-edge", "opposed"]]);
  let inbox = await stanceInbox(repo, alpha);
  assert.equal(inbox.candidates.some((c) => c.mark === "beta/on-alphas-edge"), false, "alpha has spoken");

  // beta amends: the store locks a new claim that supersedes the first.
  CLAIMS.push(claim("beta/on-alphas-edge", "c-beta-2", { window_id: 12, at: "2026-09-01T00:00:00Z" }));
  read = versionsFromRows(CLAIMS);
  assert.equal(townWordsOf(written(), { versions: read }).size, 0, "the town's word was on the old version: absent");
  inbox = await stanceInbox(repo, alpha);
  assert.ok(inbox.candidates.some((c) => c.mark === "beta/on-alphas-edge"), "and the amendment reopens the resident's word");
  assert.equal(inbox.standing.some((s) => s.on === "beta/on-alphas-edge"), false, "a stale word does not stand");

  // A pending amendment has not published, so it reopens nothing yet.
  CLAIMS.push(claim("beta/on-alphas-edge", "c-beta-3", { status: "pending", window_id: 13, at: "2026-09-05T00:00:00Z" }));
  assert.equal(versionsFromRows(CLAIMS).get("beta/on-alphas-edge").current.id, "c-beta-2");

  // A word written before versions were recorded is read on the claim that
  // carried the mark at its instant.
  const legacy = { class: CLASS_STANCE, object: "beta/on-alphas-edge", actor: "alpha", payload: { stance: "opposed" }, written_at: "2026-08-25T00:00:00Z", seq: 9 };
  assert.equal(versionAt(versionsFromRows(CLAIMS).get("beta/on-alphas-edge"), legacy.written_at), "c-beta-1");
  assert.deepEqual(standingStances([legacy], { versions: versionsFromRows(CLAIMS) }), [], "so the amendment reopens it too");
});

// ── 4b · a word written before versions were recorded ───────────────────────
// FLIP: read a row with no recorded version as unknown (rowVersion → null) →
// the pre-change word survives the amendment.

test("4b · a pre-change word reads as spoken on the claim current at its instant: it stands until an amendment, then it is absent", () => {
  // Wright, 2026-10-06 (b): "A legacy row with no version reads as spoken on
  // the claim current at its instant, derived from claims."
  const legacy = [
    { class: CLASS_STANCE, object: "beta/on-alphas-edge", actor: "alpha", payload: { stance: "opposed" }, written_at: "2026-08-25T00:00:00Z", seq: 9 },
    { class: CLASS_STANCE, object: "beta/on-alphas-edge", actor: TOWN_SPEAKER, payload: { stance: "opposed", as: "town" }, written_at: "2026-08-26T00:00:00Z", seq: 10 },
  ];
  const before = versionsFromRows(CLAIMS);
  assert.deepEqual(standingStances(legacy, { versions: before }).map((s) => s.by).sort(), ["alpha", TOWN_SPEAKER],
    "with no amendment since, both pre-change words stand");
  assert.deepEqual([...townWordsOf(legacy, { versions: before })], [["beta/on-alphas-edge", "opposed"]]);

  const after = versionsFromRows([...CLAIMS, claim("beta/on-alphas-edge", "c-beta-2", { window_id: 12, at: "2026-09-01T00:00:00Z" })]);
  assert.deepEqual(standingStances(legacy, { versions: after }), [], "after an amendment, the pre-change words are absent");
  assert.equal(townWordsOf(legacy, { versions: after }).size, 0, "the town's too");

  // POS-362: AS OF A SEAL. A seal taken before the amendment was decided saw the
  // old version as current, so the words stand in that settlement however the
  // store has moved since. Judged by the decision's instant (Wright's review).
  const atSeal = versionsFromRows([...CLAIMS, claim("beta/on-alphas-edge", "c-beta-2", { window_id: 12, at: "2026-09-01T00:00:00Z" })], { at: "2026-08-31T00:00:00Z" });
  assert.notEqual(atSeal.get("beta/on-alphas-edge").current.id, "c-beta-2", "an amendment decided after the seal is not its current version");
  assert.deepEqual([...townWordsOf(legacy, { versions: atSeal })], [["beta/on-alphas-edge", "opposed"]], "so the word spoken on the older version stands at that seal");
});

// ── 4c · the town speaks only on published marks ────────────────────────────
// FLIP: let the town's arm find unpublished marks → the town's word on a
// household's draft is written.

test("4c · the town speaks only on PUBLISHED marks: a draft is its household's own, and the refusal says so", async () => {
  // Wright, 2026-10-06 (c): "A draft is its household's own (private drafts
  // live at the world door), and a town that read drafts through the stance
  // carve would breach that. Refuse with a sentence that says so."
  LIVE = [{ slug: "beta/a-private-sketch", claimant: "beta", status: "draft", at: { x: 104, y: 100 }, extent: { w: 2, h: 2 }, kind: "sited", date: "2026-09-02", declared_by: "beta" }];
  for (const on of ["beta/a-private-sketch", "beta/no-such-mark"]) {
    await assert.rejects(() => speak({ as: "town", on, stance: "opposed", law: ["the-town/the-unmoved-past"] }, wright), (e) => {
      assert.equal(e.code, 404);
      assert.equal(e.defect, `no published mark "${on}"`, "one answer for a draft and for nothing: the refusal never says which");
      assert.match(e.hint, /a draft is its household's own until it publishes/);
      assert.match(e.hint, /waits for the publish/);
      return true;
    });
  }
  assert.equal(written().length, 0, "nothing was written");
  // The same draft is still a resident's candidate (the-late-welcome), so the
  // stub really does hold it.
  assert.ok((await stanceInbox(repo, alpha)).candidates.some((c) => c.mark === "beta/a-private-sketch"));
});

// ── 5 · who a mark awaits: households, seniority, one function ──────────────
// FLIPS: (a) drop the seniority test in awaitingOf → epsilon's older mark
// awaits alpha's house; (b) group by handle instead of household → the house
// is listed twice and alpha2's word does not clear it.

test("5 · awaiting is grouped by household, with seniority, and the inbox reads the label's function", async () => {
  const marks = MARKS.map((m) => ({ ...m, published: true }));
  const a = awaitingOf(mark("beta/on-alphas-edge"), { marks, overlaps, householdOf });
  assert.deepEqual(a, [{ who: "hh:alpha", ground: ["alpha/alphas-parcel", "alpha2/the-cairn"] }],
    "one entry for the house, carrying both residents' ground");

  assert.deepEqual(awaitingOf(mark("epsilon/was-here-first"), { marks, overlaps, householdOf }), [],
    "seniority: alpha's house holds nothing older than epsilon's mark, so it has no word on it");
  assert.deepEqual(awaitingOf(mark("alpha/alphas-parcel"), { marks, overlaps, householdOf }).map((x) => x.who), ["hh:epsilon"],
    "and the same edge read from the side that was there first");

  const words = [{ on: "beta/on-alphas-edge", stance: "neutral", by: "alpha2" }];
  assert.deepEqual(awaitingOf(mark("beta/on-alphas-edge"), { marks, overlaps, householdOf, words }), [],
    "one word per household: alpha2's word answers for alpha");

  // THE INBOX AND THE LABEL READ ONE FUNCTION. alpha's inbox is exactly the
  // marks whose label names alpha's house.
  const labels = awaitingLabels(marks, { overlaps, householdOf });
  const labelled = [...labels].filter(([, who]) => who.includes("hh:alpha")).map(([id]) => id).sort();
  const inbox = await stanceInbox(repo, alpha);
  assert.deepEqual(inbox.candidates.map((c) => c.mark).sort(), labelled);
  assert.equal(inbox.scope, "household", "and the number says whose ground it counted: the house's, alpha2's cairn included");
  const pure = candidatesFrom({ mine: marks.filter((m) => householdOf(m.by) === "hh:alpha"), all: marks, overlaps, householdOf });
  assert.deepEqual(pure.map((c) => c.mark).sort(), labelled);

  // At the door: alpha2's word is the house's, and a housemate's mark is never
  // the house's ground.
  await speak({ on: "beta/on-alphas-edge", stance: "opposed" }, alpha2);
  assert.equal((await stanceInbox(repo, alpha)).candidates.some((c) => c.mark === "beta/on-alphas-edge"), false,
    "alpha's inbox is cleared by a housemate's word");
  await assert.rejects(() => speak({ on: "alpha2/the-cairn", stance: "opposed" }, alpha),
    (e) => e.code === 422 && /own household's ground/.test(e.defect));
});

// ── 6 · the cutover ─────────────────────────────────────────────────────────
// FLIP: make clearedAtCutover answer false → a mark that stood at the cutover
// awaits the town.

test("6 · a mark whose current version stood at or before the cutover never awaits the town", async () => {
  const versions = versionsFromRows(CLAIMS);
  const cutover = { number: 94, window_id: 11, published_at: null };
  const beta = mark("beta/on-alphas-edge");
  assert.equal(clearedAtCutover(beta, { cutover, versions }), true, "locked in window 10, before S94's window 11");
  assert.deepEqual(awaitingOf(beta, { marks: [], overlaps, townSeat: townSeatOf({ cutover, versions }) }), []);

  const amended = versionsFromRows([...CLAIMS, claim("beta/on-alphas-edge", "c-beta-2", { window_id: 12, at: "2026-09-01T00:00:00Z" })]);
  assert.deepEqual(awaitingOf(beta, { marks: [], overlaps, townSeat: townSeatOf({ cutover, versions: amended }) }),
    [{ who: TOWN, ground: [] }], "an amendment after the cutover starts awaiting the town");
  assert.deepEqual(awaitingOf(beta, { marks: [], overlaps, townSeat: townSeatOf({ cutover: null, versions }) }),
    [{ who: TOWN, ground: [] }], "unset means no cutover: every published mark awaits the town");
  assert.deepEqual(awaitingOf({ ...beta, published: false }, { marks: [], overlaps, townSeat: townSeatOf({ cutover: null, versions }) }), [],
    "a sketch is not the town's yet");
  assert.deepEqual(awaitingOf(beta, { marks: [], overlaps, townSeat: townSeatOf({ cutover: null, versions }),
    words: [{ on: beta.id, by: TOWN_SPEAKER, as: "town", stance: "neutral" }] }), [], "the town's word clears it");

  assert.equal(cutoverNumber({}), null);
  assert.equal(cutoverNumber({ TOWN_STANCE_CUTOVER: "S94" }), 94);
  assert.throws(() => cutoverNumber({ TOWN_STANCE_CUTOVER: "next sunday" }), /names no settlement/);
  const read = await readCutover({ env: { TOWN_STANCE_CUTOVER: "S94" }, query: async (_t, p) => (p[0] === 94 ? [{ number: 94, window_id: 11, published_at: null }] : []) });
  assert.deepEqual(read, { number: 94, window_id: 11, published_at: null });
  await assert.rejects(() => readCutover({ env: { TOWN_STANCE_CUTOVER: "S95" }, query: async () => [] }), (e) => e.code === 503);
});

// ── 7 · the fold's input ────────────────────────────────────────────────────

test("7 · townWordsOf is the map world#146's resolveConsent takes: the town's newest word per mark", async () => {
  await speak({ as: "town", on: "beta/on-alphas-edge", stance: "opposed", law: ["the-town/the-unmoved-past"] }, wright);
  // A resident's later word on the same mark, in a word the town also speaks:
  // it must not move the town's.
  await speak({ on: "beta/on-alphas-edge", stance: "neutral" }, alpha);
  await speak({ as: "town", on: "alpha/alphas-parcel", stance: "neutral" }, wright);
  await speak({ as: "town", on: "alpha/alphas-parcel", stance: "opposed", law: ["the-town/the-unmoved-past"] }, wright);
  // The record as the register reads it back (jsonb payloads are objects there).
  const rows = await stanceRows({ acts: pen.rows().map((r) => ({ ...r, payload: JSON.parse(r.payload) })) });
  const words = townWordsOf(rows, { versions: versionsFromRows(CLAIMS) });
  assert.ok(words instanceof Map);
  assert.deepEqual([...words].sort(), [["alpha/alphas-parcel", "opposed"], ["beta/on-alphas-edge", "opposed"]],
    "latest wins per mark; a resident's word is not the town's");
});

// ── a review granted after the seal never reaches back into it (#432 review) ─
// review-rule.mjs locks a held_review claim LATER and keeps its submit window,
// so the window alone would let a grant in W+1 rewrite the asked S(W). The
// seal's own instant decides: a claim counts as locked at the seal only if it
// was decided by then.
test("4c · a review granted after the seal never changes the version the seal saw", () => {
  const rows = [
    { slug: "bo/shed", id: "v1", status: "locked", window_id: 20, submitted_at: "2026-10-01T01:00:00Z", decided_at: "2026-10-01T06:00:00Z" },
    // V2 was submitted in window 21 and held for review at 21's seal (18:00Z);
    // a mind granted it the next morning, and it keeps window 21.
    { slug: "bo/shed", id: "v2", status: "locked", window_id: 21, submitted_at: "2026-10-01T09:00:00Z", decided_at: "2026-10-02T07:00:00Z" },
  ];
  const sealOf21 = "2026-10-01T18:00:00Z";
  assert.equal(versionsFromRows(rows, { window: 21, at: sealOf21 }).get("bo/shed").current.id, "v1",
    "at window 21's seal V2 was still held, so V1 is the version that stood");
  assert.equal(versionsFromRows(rows, { window: 21 }).get("bo/shed").current.id, "v2",
    "(the window alone would have answered V2: the defect this guards)");
  assert.equal(versionsFromRows(rows, { window: 22, at: "2026-10-02T18:00:00Z" }).get("bo/shed").current.id, "v2",
    "and the next seal after the grant sees V2");
  // A seed claim with no decision time falls back to the window rule.
  const seed = [{ slug: "bo/old", id: "s1", status: "locked", window_id: null, submitted_at: null, decided_at: null }];
  assert.equal(versionsFromRows(seed, { window: 21, at: sealOf21 }).get("bo/old").current.id, "s1");
});
