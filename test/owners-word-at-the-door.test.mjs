// owners-word-at-the-door.test.mjs — MAKER AND OWNER, AT THE DOORS (POS-688,
// Darko 2026-10-19 16:39–16:45; D-O1..D-O6 at 17:14).
//
// THE LAW: a thing's maker is fixed; its owner has the say. Borrowing is just
// taking. While someone outside the owner's house holds it or has set it down,
// the owner's word on it is a stance: silence or neutral lends it, welcomed gives
// it to keep (final), opposed brings it back at the next settlement. A set-down
// prints where it was made at the next settlement (D2), so the door files no
// amend: the POS-138 set-down arm and its amend are retired (POS-706 closed into
// this), and this suite replaces set-down-files-the-amend.test.mjs.
//
// WHAT THIS SUITE DRIVES: the real hold door (`callHoldTool`) on the hold lane as
// prod runs it, and the real stance door (`declareStanceViaOffice`), against an
// in-memory record (`acts-pen-stub.mjs`) that keeps every act it is handed. The
// owner is the one fold (src/ownership.mjs) over exactly those acts, handed to
// the stance door and the awaiting read in place of the kept hold record.
//
//   node --test test/owners-word-at-the-door.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };

const repo = mkdtempSync(join(tmpdir(), "owners-word-world-"));
const town = mkdtempSync(join(tmpdir(), "owners-word-town-"));
const scratch = mkdtempSync(join(tmpdir(), "owners-word-db-"));
after(() => { sweep(repo); sweep(town); sweep(scratch); });

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (root, path, text) => {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

// ── the world in a bottle ────────────────────────────────────────────────────
//
// Keith's house (`gh:1`: keith, and his housemate kin) holds the garage and a
// yard parcel. Ana is another household (`gh:2`). The Waiting Room is the
// postmaster's. The stool is Keith's thing, folded in the garage — the live
// record's own fields, copied from world main `5509c996`.
const STOOL = "keith/waiting-room-stool-2026-09-10";
const GARAGE_AT = { x: 3978, y: -398 };
const WAITING_ROOM_AT = { x: 176, y: 425.5 };
const YARD_AT = { x: 4100, y: -300 };
const ANA_AT = { x: 4105, y: -305 };

const stoolRecord = {
  id: STOOL, kind: "sited", by: "keith", tier: "home", household: "keith", declared_household: "gh:1",
  date: "2026-09-10T15:37:58.221Z", at: GARAGE_AT, extent: { w: 1, h: 1 }, sovereign: true, stamps: 2, weight: 2,
  weight_parts: { own_escrow: 2 }, body: "Three-legged stool in pale ash: splayed legs, brass levelers, a seat sanded kind. Two names and a date under the seat. Built for whoever waits.",
  class: "thing", placementParent: "keith/the-garage", ledger_weight: 2,
};

const PUBLISHED = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 20000, h: 20000 }, body: "the world frame" },
  { id: "keith/the-garage", by: "keith", kind: "sited", tier: "home", at: GARAGE_AT, extent: { w: 20, h: 20 }, body: "one bay door up" },
  { id: "keith/the-yard", by: "keith", kind: "parcel", tier: "home", at: YARD_AT, extent: { w: 25, h: 25 }, body: "the yard behind the garage" },
  { id: "kin/the-shed", by: "kin", kind: "parcel", tier: "home", at: { x: 4130, y: -300 }, extent: { w: 25, h: 25 }, body: "the shed beside the yard" },
  // Ana stands INSIDE Keith's yard (this bottle's where-is puts a resident at
  // their own parcel's centre), so a set-down she makes lands on Keith's own
  // ground: the minimum there is zero, and a welcome goes forward. It is also
  // the plainest version of the question — a stranger's thing left on YOUR land.
  { id: "ana/the-orchard", by: "ana", kind: "parcel", tier: "home", at: ANA_AT, extent: { w: 5, h: 5 }, body: "an orchard" },
  { id: "postmaster/the-waiting-room", by: "postmaster", kind: "sited", tier: "market", at: WAITING_ROOM_AT, extent: { w: 30, h: 30 }, body: "the waiting room" },
  stoolRecord,
  // Zed's cup (THE NOTE): a thing that stands, far from every parcel, so a
  // set-down of it can be answered and zed still holds no ground.
  { id: "zed/a-cup", by: "zed", kind: "sited", tier: "home", class: "thing", at: { x: -6000, y: 6000 }, extent: { w: 1, h: 1 }, body: "a cup" },
];

put(repo, "tools/world-build.mjs", `export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }\n`);
put(repo, "tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function homeOf(handle, world) {
  const parcel = (world?.parcels ?? []).find((p) => p.household === handle);
  if (!parcel) return { ...NOWHERE };
  return { x: parcel.at.x, y: parcel.at.y, placed: true, source: "parcel", mark_id: parcel.id, parcel };
}
export function whereIs(handle, { world = null } = {}) { return homeOf(handle, world); }
export function publicResidents() { return []; }
`);
put(repo, "tools/world-verbs.mjs", `
export function containmentChain(pos, marks) {
  return (marks ?? [])
    .filter((m) => m.at && m.extent && Math.abs(pos.x - m.at.x) <= m.extent.w / 2 && Math.abs(pos.y - m.at.y) <= m.extent.h / 2)
    .sort((a, b) => (b.extent.w * b.extent.h) - (a.extent.w * a.extent.h))
    .map((m) => ({ id: m.id, by: m.by, tier: m.tier, body: m.body }));
}
export function orient() { return { seen: [] }; }
export function investigate() { return null; }
export function pointWithinMark(p, m) {
  return Boolean(m?.at && m?.extent) && Math.abs(p.x - m.at.x) <= m.extent.w / 2 && Math.abs(p.y - m.at.y) <= m.extent.h / 2;
}
`);
put(repo, "tools/marks-fold.mjs", `
export function loadMarks() { return []; }
export const PARCEL_EXTENT_M = 25;
export const PARCEL_CLAIM_CAP = 3;
export const PARCEL_CAP_LAW_DATE = "2026-07-30";
export function marksContain(outer, inner) {
  if (!outer?.at || !outer?.extent || !inner?.at) return false;
  return Math.abs(inner.at.x - outer.at.x) <= outer.extent.w / 2
      && Math.abs(inner.at.y - outer.at.y) <= outer.extent.h / 2;
}
`);
// The engine's geometry, which the stance door asks for overlap and will not
// substitute its own (`world-stance.mjs § stanceGeometry`).
put(repo, "tools/geometry.mjs", `
export const rect = (m) => ({ x0: m.at.x - m.extent.w / 2, x1: m.at.x + m.extent.w / 2, y0: m.at.y - m.extent.h / 2, y1: m.at.y + m.extent.h / 2 });
export function overlapArea(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}
`);
put(repo, "seeding/manifest.json", JSON.stringify({ homes: [] }));
put(repo, "WORLD/households.json", JSON.stringify({ households: { keith: "gh:1", kin: "gh:1", ana: "gh:2" } }));
put(repo, "WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put(repo, "WORLD/world-state.json", JSON.stringify({
  tick: 0, dials: {}, marks: PUBLISHED,
  parcels: PUBLISHED.filter((m) => m.kind === "parcel").map((m) => ({ id: m.id, household: m.by, at: m.at, extent: m.extent })),
  determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [],
}));
put(repo, "WORLD/filing-freeze.json", JSON.stringify({ frozen_at: "2026-08-25", marks: {} }));
git("init", "-q", "-b", "main");
git("config", "user.email", "test@postmark.town");
git("config", "user.name", "pos138 falsifier");
git("add", "-A");
git("commit", "-qm", "canon: keith's stool, folded in his garage");
git("branch", "-q", "draft/keithhouse");

// THE TOWN'S HOUSEHOLD MAP, the one `households.mjs § householdOf` reads —
// the same reader the door's reach clause asks. Two houses, in the STORE's
// registry (POS-342), seeded into each fresh pen below.
const { rowsFromRegistry } = await import("../src/registry-rows.mjs");
const REGISTRY_ROWS = rowsFromRegistry({ households: {
  "keith-house": { residents: ["keith", "kin"], accounts: [{ login: "keith-gh", id: 1 }] },
  "ana-house": { residents: ["ana"], accounts: [{ login: "ana-gh", id: 2 }] },
} }, {});

process.env.WORLD_CLONE = repo;
process.env.TOWN_CLONE = town;
process.env.WORLD_SINGLE_LOG = "1";
process.env.W2_GUARDS = "1";
process.env.W2_PEN = "mark,hold";
process.env.WORLD2_CANDLE = "1";
process.env.TOWN_PUSH = "";

const { installActsPen, uninstallActsPen, readHoldsFrom, RECORD_ON } = await import("./acts-pen-stub.mjs");
process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
const STANDING_ID = "7f3a0c1e-0000-4000-8000-000000000636";
// THE DOCKET PEN HOLDS ITS OWN POOL (`world2-claims.mjs § __setPoolForTest`):
// the claim half resolves its household there before the transaction opens.
// `installActsPen` sets the acts and pen pools only, so without this the
// amend reaches a real socket and refuses as an unreachable record.
const claimsPen = await import("../src/world2-claims.mjs");
// The holder check reads the holding acts back off the same pen (the guards
// are on, as in prod), so each fresh pen gets the guard reader with it.
let unread = () => {};
const install = async () => {
  const p = installActsPen({ marks: [{ id: STANDING_ID, slug: STOOL }], households: REGISTRY_ROWS.households });
  claimsPen.__setPoolForTest(p);
  unread(); unread = await readHoldsFrom(p);
  return p;
};
let pen = await install();
after(() => { unread(); uninstallActsPen(); claimsPen.__setPoolForTest(null); delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; });

const hold = await import("../src/world-hold.mjs");
// The leave door asks the class's own makers (LOGOS v2, O1): the amend this drop files cites class: thing, so the law it reads states makers.
const { seedMakersLaw } = await import("./helpers/makers-law.mjs");
await seedMakersLaw();
after(async () => (await import("../src/law-snapshot.mjs")).resetLawSnapshot());
const { resetPathIndex } = await import("../src/world-journal.mjs");

const KEITH = { household: "keithhouse", handles: new Set(["keith", "kin"]) };
const ANA = { household: "anahouse", handles: new Set(["ana"]) };
const HOUSES = (h) => ({ keith: { key: "gh:1", slug: "keith-house" }, kin: { key: "gh:1", slug: "keith-house" }, ana: { key: "gh:2", slug: "ana-house" } })[h] ?? null;

/** Put the stool in `who`'s hands on the record, as a take would have: the take act. */
// Stamped NOW, not on the instance's date: the drop the door makes next is
// stamped now too, and latest-wins must see this hand-off after every earlier
// test's drop or the door reads the stool as standing on the ground.
function hand(who) {
  pen.seedAct({ class: "holding", actor: who, action: "take", object: STOOL, at: new Date(),
    payload: { thing: STOOL, holder: who, previous_holder: null, made_by: "keith", policy: "cascade" } });
}
const fresh = async () => { uninstallActsPen(); pen = await install(); return pen; };
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

const stance = await import("../src/world-stance.mjs");
// The stance door's candidate read rides its own credential (`stance_reader`,
// 023). Pointed at the same in-memory record: it asks `claims`, which the pen
// answers from the docket it keeps.
process.env.WORLD2_STANCE_URL = "postgres://acts-pen-stub/stance";
const acts2 = await import("../src/world2-acts.mjs");
const speakPool = { query: (t, p) => pen.query(t, p) };
acts2.__setStancePoolForTest(speakPool);
after(() => acts2.__setStancePoolForTest(null));

/** Ana sets Keith's stool down, through the real door. Returns her drop act. */
async function anaDrops(p) {
  hand("ana");
  const r = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "ana" }, ANA);
  assert.equal(r.did, "drop", `Ana's drop did not land: ${JSON.stringify(r)}`);
  const drops = p.rows().filter((a) => a.action === "drop" && a.actor === "ana");
  return drops[drops.length - 1];
}

/** Speak on the stool, through the real stance door; a bounce comes back as `{ refused }`. */
//
// THE HOLDING READ IS THE PORT'S OWN (`standsRowsFromStore`), answered by
// `stands-store-fixture.mjs § actsClient` — the investigate suite's client,
// which filters and orders the way the real SQL does — over the acts the real
// doors wrote into this suite's pen a moment earlier. Nothing is hand-seeded:
// the drop the stance answers is the one Ana's call to the hold door made.
const guards = await import("../src/world2-guards.mjs");
const { actsClient } = await import("./stands-store-fixture.mjs");
const written = (p) => p.rows().map((r) => ({ ...r, at: new Date(r.at), payload: parse(r.payload) }));
// The fixture reader is installed for the HOLDING READ ALONE — the real
// `standsRowsFromStore`, called through the arm's `readRows` seam — and taken
// down before the stance and the amend write, so the pen's own reads on the
// write path reach the pen and not the fixture.
const readRows = async (thing) => {
  const restore = guards.useGuardReader((run) => run(actsClient(written(pen))));
  try { return await guards.standsRowsFromStore(thing); } finally { restore(); }
};
const { foldOwners, ownershipEvents, ownershipOf } = await import("../src/ownership.mjs");
const HOUSEKEY = (h) => HOUSES(h)?.key ?? `solo:${h}`;
/** The one fold, over the acts the doors in this suite wrote. */
function ownersNow(p) {
  const rows = written(p);
  const holding = rows.filter((r) => r.class === "holding").map((r) => ({ seq: Number(r.id), actor: r.actor, action: r.action, object: r.object, payload: r.payload }));
  const stances = rows.filter((r) => r.class === "stance").map((r) => ({ id: Number(r.id), actor: r.actor, object: r.object, payload: r.payload }));
  return foldOwners(ownershipEvents(holding, stances), { houseOf: HOUSEKEY });
}
const depsFor = (p) => ({ householdOf: HOUSES, ownership: async (t) => ownershipOf(ownersNow(p), t), record: async () => ({ owners: ownersNow(p), places: new Map() }) });
async function speak(word, handle, key, extraDeps = {}) {
  try {
    return await stance.declareStanceViaOffice(repo, { on: STOOL, stance: word, handle }, key, { setDownDeps: { ...depsFor(pen), readRows, ...extraDeps } });
  } catch (e) {
    return { refused: true, code: e?.code, defect: e?.defect ?? e?.message, hint: e?.hint };
  }
}

// ── the drop's receipt: no amend, the settlement prints it, and whose it is ──

test("KEITH SETS DOWN HIS OWN STOOL: no amend is filed (the settlement prints it), and the receipt says so", async () => {
  const p = await fresh();
  hand("keith");
  const r = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "keith" }, KEITH);
  assert.equal(r.did, "drop", JSON.stringify(r).slice(0, 400));
  assert.equal(p.rows().some((a) => a.action === "amend"), false, "no amend act: the printout is the one writer of its place");
  assert.equal(p.claims().length, 0, "nothing on the docket");
  assert.deepEqual([r.set_down.by, r.set_down.owner, r.set_down.whose], ["keith", "keith", "your house's"]);
  assert.equal(r.stands_note, "it stands where you stood when you set it down, and the act carries that place; the settlement prints it here at the next crossing.");
});

test("ANA SETS DOWN KEITH'S STOOL: it is keith's, lent to her; the receipt says the settlement prints it there and keith's house may still ask for it back", async () => {
  const p = await fresh();
  hand("ana");
  const r = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "ana" }, ANA);
  assert.equal(r.did, "drop", JSON.stringify(r).slice(0, 400));
  assert.equal(p.rows().some((a) => a.action === "amend"), false);
  assert.equal(r.set_down.whose, "another household's");
  assert.equal(r.stands_note, "it stands where you stood when you set it down, and the act carries that place. It is keith's, lent to you: the settlement prints it here at the next crossing, and keith's house may still ask for it back.");
});

test("a housemate's set-down is the owner's house's own: no word is awaited", async () => {
  const p = await fresh();
  hand("kin");
  const r = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "kin" }, KEITH);
  assert.equal(r.did, "drop", JSON.stringify(r).slice(0, 400));
  assert.equal(r.set_down.whose, "your house's");
  assert.equal(ownershipOf(ownersNow(p), STOOL).outing, null);
});

// ═════════════════════════════════════════════════════════════════════════════
// THE OWNER'S WORD, through the real stance door (POS-688, Darko 2026-10-19 16:39–16:45)
// ═════════════════════════════════════════════════════════════════════════════

const words = (p) => written(p).filter((r) => r.class === "stance" && r.object === STOOL);

test("NEUTRAL LENDS IT: Keith's house answers Ana's set-down with neutral — one stance row naming the act, and nothing else written", async () => {
  const p = await fresh();
  const drop = await anaDrops(p);
  const before = p.rows().length;
  const r = await speak("neutral", "keith", KEITH);
  assert.ok(!r.refused, JSON.stringify(r));
  assert.deepEqual(r.act, { act_id: String(drop.id), by: "ana" });
  assert.equal(r.answers, "set-down");
  assert.match(r.effect, /is lent to ana\. It stays yours/);
  assert.equal(p.rows().length, before + 1, "one row: the word");
  const [w] = words(p);
  assert.deepEqual([w.payload.stance, w.payload.answers, w.payload.act.act_id], ["neutral", "set-down", String(drop.id)]);
  assert.equal(p.claims().length, 0, "no amend, no claim");
});

test("OPPOSED, THEN REVISED: the latest word wins, and the receipt names the word it superseded", async () => {
  const p = await fresh();
  await anaDrops(p);
  const a = await speak("opposed", "keith", KEITH);
  assert.match(a.effect, /comes back to your hands, or onto your parcel if your hands are full/);
  const b = await speak("neutral", "kin", KEITH);
  assert.ok(!b.refused, JSON.stringify(b));
  assert.equal(b.superseded.stance, "opposed", "a housemate speaks for the house, and revises it");
  assert.equal(ownershipOf(ownersNow(p), STOOL).outing.word.stance, "neutral");
});

test("WELCOMED IS FINAL: Keith's house gives the stool to Ana to keep; then it is Ana's, and Keith's house has nothing left to answer", async () => {
  const p = await fresh();
  await anaDrops(p);
  const r = await speak("welcomed", "keith", KEITH);
  assert.match(r.effect, /is ana's now, to keep\. That is final/);
  assert.equal(ownershipOf(ownersNow(p), STOOL).owner, "ana");
  const again = await speak("opposed", "keith", KEITH);
  assert.equal(again.refused, true, "the owner is ana now: keith's word is no owner's word");
});

test("A TAKE IS ANSWERED THE SAME WAY: Ana holds Keith's stool, and Keith's house's opposed names the take", async () => {
  const p = await fresh();
  hand("ana");
  const take = p.rows().filter((a) => a.action === "take").pop();
  const r = await speak("opposed", "keith", KEITH);
  assert.ok(!r.refused, JSON.stringify(r));
  assert.deepEqual([r.answers, r.act.act_id, r.act.by], ["take", String(take.id), "ana"]);
});

test("ONLY THE OWNER'S HOUSE SPEAKS: Ana cannot answer her own set-down of Keith's thing, and nothing is written", async () => {
  const p = await fresh();
  await anaDrops(p);
  const before = p.rows().length;
  const r = await speak("welcomed", "ana", ANA);
  assert.equal(r.refused, true, JSON.stringify(r));
  assert.equal(p.rows().length, before);
});

test("NOTHING OUT, NOTHING TO ANSWER: Keith's own set-down opens no word, and the door answers what it always has", async () => {
  const p = await fresh();
  hand("keith");
  await hold.callHoldTool("world_hold", { thing: STOOL, handle: "keith" }, KEITH);
  const r = await speak("opposed", "keith", KEITH);
  assert.equal(r.refused, true);
  assert.match(r.defect, /a mark is never its own ground/);
});

// ── WHAT WAITS ON YOUR HOUSE'S WORD ──────────────────────────────────────────

const inboxOf = (handles, p) => stance.stancesForHandles(handles, { repo, setDowns: true, setDownDeps: depsFor(p) });

test("KEITH SEES IT: Ana's set-down of Keith's stool waits on his house's word, with the call that answers it; a take too", async () => {
  const p = await fresh();
  const drop = await anaDrops(p);
  const inbox = await inboxOf(["keith"], p);
  const row = inbox.awaiting_your_word.find((x) => x.thing === STOOL);
  assert.ok(row, JSON.stringify(inbox.awaiting_your_word));
  assert.deepEqual([row.act, row.by, row.act_id, row.owner], ["set-down", "ana", String(drop.id), "keith"]);
  assert.match(row.answer, /stance: "neutral" \| "welcomed" \| "opposed"/);
  assert.equal(inbox.set_downs_awaiting[0].set_down_by, "ana", "the POS-138 name keeps working, as the set-down rows");
  hand("ana");
  const taken = (await inboxOf(["keith"], p)).awaiting_your_word.find((x) => x.thing === STOOL);
  assert.equal(taken.act, "take", "the latest of the outing: Ana picked it up again");
});

test("PRIVACY: Ana's own read does not list her set-down of Keith's thing", async () => {
  const p = await fresh();
  await anaDrops(p);
  const inbox = await inboxOf(["ana"], p);
  assert.equal((inbox.awaiting_your_word ?? []).some((x) => x.thing === STOOL), false);
});

test("ANSWERED: once Keith's house says neutral (or opposed), nothing waits; and the note says nothing awaits only when nothing does", async () => {
  const p = await fresh();
  await anaDrops(p);
  const waiting = await inboxOf(["keith"], p);
  assert.notEqual(waiting.note?.startsWith("nothing awaits your word"), true, "a waiting set-down is a word awaited");
  await speak("neutral", "keith", KEITH);
  const after = await inboxOf(["keith"], p);
  assert.equal(after.awaiting_your_word.some((x) => x.thing === STOOL), false);
});

// ── found on the way, kept from the POS-138 suite ───────────────────────────

test("the unflipped hold pen refuses the set-down by name: no drop, nothing filed", async () => {
  const p = await fresh();
  process.env.W2_PEN = "mark";
  try {
    hand("keith");
    const before = p.rows().length;
    const e = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "keith" }, KEITH).then((r) => ({ answered: r }), (err) => err);
    assert.equal(e?.code, 503, `the door answered ${JSON.stringify(e?.answered ?? e?.defect)}`);
    assert.match(e.defect, /holding things needs the hold lane's record/);
    assert.equal(p.rows().length, before, "nothing was filed");
  } finally { process.env.W2_PEN = "mark,hold"; }
});

test("the flipped hold receipt's `seq` is the act's id", async () => {
  const p = await fresh();
  hand("keith");
  const r = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "keith" }, KEITH);
  const drop = p.rows().find((a) => a.action === "drop");
  assert.equal(r.seq, drop.id);
});

test("THE PLACEHOLDER: a per-thing holding read names its parameter, and the maker narrowing names its own", async () => {
  const { pgHoldingRows } = await import("../world2/tools/guard-reads.mjs");
  const asked = [];
  const client = { query: async (sql, params) => { asked.push({ sql: String(sql).replace(/\s+/g, " "), params }); return { rows: [] }; } };
  await pgHoldingRows(client, { thing: STOOL });
  assert.match(asked[0].sql, /COALESCE\(object, payload->>'thing'\) = \$2(\s|$)/, asked[0].sql);
  assert.deepEqual(asked[0].params, ["holding", STOOL]);
  await pgHoldingRows(client, { thing: STOOL, madeBy: ["keith", "kin"] });
  assert.match(asked[1].sql, /= \$2 AND split_part\(COALESCE\(object, payload->>'thing'\), '\/', 1\) = ANY\(\$3\)/, asked[1].sql);
  assert.deepEqual(asked[1].params, ["holding", STOOL, ["keith", "kin"]]);
});
