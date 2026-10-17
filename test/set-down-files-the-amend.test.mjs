// set-down-files-the-amend.test.mjs — POS-138, the office half.
//
// THE LAW: `LOGOS/classes.md` § The reach of a hold — a set-down's "position
// is written on the act and is canon at the next fold like any move". A move is
// an AMEND through the office's pen (`LOGOS/state-and-time.md`: "the settlement
// writes a mark once; nothing moves it after").
//
// THE INSTANCE: Keith set his own stool down in the Waiting Room (postmark#2693,
// act 1636, 2026-09-10). The hold door told him "the record re-sites the mark at
// the next fold" and filed nothing, so canon kept the stool in his garage
// through nine folds while the read said it stood in the Waiting Room.
//
// THE RULING (Keemin, 2026-09-24): the author's pen moves the author's own
// thing without ceremony; a set-down by ANOTHER household moves nothing in
// canon until the author's house accepts it, and the read says so.
//
// WHAT THIS SUITE DRIVES: the real hold door (`callHoldTool`) on the hold
// lane as prod runs it (flipped, guards on — POS-269 retired the dynamic store
// that held the edge anywhere else), whose drop reaches the real leave-mark door
// (`leaveMarkViaOffice` → `journalLeaveMark` → `appendActFlipped` →
// `claimTxFromJournal`), against an in-memory record (`acts-pen-stub.mjs`) that
// keeps every act and claim it is handed. Nothing here is a copy of the amend
// shape: the rows asserted are the rows the door wrote.
//
// THE SECOND HALF (Keemin, 2026-09-24 ~10:1x, "I agree with you here", on
// PR #180's proposal) is at the foot of this file: the author's house answers a
// stranger's set-down through the real stance door — accept, refuse, silence,
// and the author-only speaker refusal.
//
//   node --test test/set-down-files-the-amend.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };

const repo = mkdtempSync(join(tmpdir(), "pos138-world-"));
const town = mkdtempSync(join(tmpdir(), "pos138-town-"));
const scratch = mkdtempSync(join(tmpdir(), "pos138-db-"));
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

// ── FALSIFIER 1 · the author's own set-down files the amend ──────────────────
//
// THE FLIP: delete the `fileSetDownAmend` call in `callHoldTool`'s flipped
// branch and this goes red on "no amend act" — the drop alone is what the
// office wrote before POS-138.

test("KEITH DROPS KEITH'S STOOL: the drop files an amend in the store's own shape — at = the standpoint, attributed to the drop act", async () => {
  const p = await fresh();
  hand("keith");
  const r = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "keith" }, KEITH);
  assert.equal(r.did, "drop", `the door answered ${JSON.stringify(r)}`);

  const acts = p.rows();
  const drop = acts.find((a) => a.action === "drop");
  const amend = acts.find((a) => a.action === "amend");
  assert.ok(drop, "the drop act is on the record, as before");
  assert.ok(amend, `no amend act — the set-down filed nothing. Acts: ${acts.map((a) => a.action).join(", ")}`);
  assert.equal(amend.class, "mark", "the amend is a mark-class act, the lane every door-made amend rides");
  assert.equal(amend.actor, "keith", "the author's pen: the amend is Keith's own");
  assert.equal(amend.object, STOOL);

  const payload = parse(amend.payload);
  assert.deepEqual(payload.at, YARD_AT, "at = the standpoint Keith stood on when he set it down");
  assert.deepEqual(r.stands_at, YARD_AT, "…the same point the receipt says it stands at");
  assert.equal(payload._set_down.act_id, String(drop.id), "attributed to the drop act, by the act's own id");
  assert.equal(payload._set_down.by, "keith");
  assert.equal(payload.class, "thing", "every field Keith wrote is copied — the stool is still a thing");
  assert.equal(payload.body, stoolRecord.body);
  assert.deepEqual(payload.extent, stoolRecord.extent);

  // THE CANDLE HALF — the claim the crossing locks and the fold re-sites.
  const claims = p.claims();
  assert.equal(claims.length, 1, `one claim, got ${JSON.stringify(claims)}`);
  const c = claims[0];
  assert.equal(c.slug, STOOL);
  assert.equal(c.claimant, "keith", "claimant = owner, so materialize grains it to Keith's house");
  assert.equal(c.supersedes, STANDING_ID, "it supersedes the standing mark — the amend chain, not a fresh claim (#2806)");
  assert.deepEqual(c.geometry.at, YARD_AT, "the claim's own geometry carries the set-down point");
  assert.equal(c.status, "pending", "on Keith's own ground the minimum is zero, so it goes forward");
  assert.equal(parse(c.data)._set_down.act_id, String(drop.id), "the claim names the drop act too");
  assert.equal(parse(c.data)._act_id, String(amend.id), "and its own act, as every candle claim does");

  assert.equal(r.set_down.amend.filed, true);
  assert.equal(r.set_down.amend.put_forward, true);
  assert.match(r.stands_note, /the amend that re-sites the mark is filed \(act \d+\), and canon moves it here at the next crossing/);
  console.log(`    RECEIPT · ${r.stands_note}`);
});

// The unflipped hold pen used to file the same amend, attributed by the drop's
// stamp, over dynamic.db's edge. That edge is retired (POS-269): off the hold
// lane there is no record of who holds the stool, so the door refuses by name
// before it adjudicates, and nothing — no drop, no amend — reaches the record.
test("the unflipped hold pen refuses the set-down by name: no drop, no amend, nothing filed", async () => {
  const p = await fresh();
  process.env.W2_PEN = "mark";
  try {
    hand("keith");
    const before = p.rows().length;
    const e = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "keith" }, KEITH).then((r) => ({ answered: r }), (err) => err);
    assert.equal(e?.code, 503, `the door answered ${JSON.stringify(e?.answered ?? e?.defect)}`);
    assert.match(e.defect, /holding things needs the hold lane's record/);
    assert.equal(p.rows().length, before, "nothing was filed");
    assert.equal(p.claims().length, 0, "and nothing went on the docket");
  } finally { process.env.W2_PEN = "mark,hold"; }
});

test("a housemate's set-down is the author's household's: the door's own amend, in the author's name, filed through the housemate's key", async () => {
  const p = await fresh();
  hand("kin");
  const r = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "kin" }, KEITH);
  assert.equal(r.did, "drop");
  assert.equal(r.set_down.whose, "your household's");
  const amend = p.rows().find((a) => a.action === "amend");
  assert.ok(amend, "a housemate on the house's key moves the house's thing");
  assert.equal(amend.actor, "keith", "the amend stays in the author's name — the mark's `by` never moves");
  assert.equal(parse(amend.payload)._set_down.by, "kin", "and the set-down names who actually set it down");
});

// ── the private-draft outcome is the door's own verdict, said on the receipt ─

test("set down on ground that is not the author's, with no escrow readable: the amend is filed as a private draft, and the receipt says canon waits", async () => {
  const p = await fresh();
  const out = await hold.fileSetDownAmend({
    did: { thing: STOOL, declared_by: "keith", at: "2026-09-10T15:37:58.221Z", did: "drop" },
    stood: WAITING_ROOM_AT, key: KEITH, actId: 1636, deps: { householdOf: HOUSES, mark: stoolRecord },
  });
  assert.equal(out.amend.filed, true, JSON.stringify(out));
  assert.equal(out.amend.put_forward, false, "the Waiting Room is not Keith's ground and this bottle has no escrow to read");
  const c = p.claims()[0];
  assert.equal(c.status, "draft", "the claim's status is the verdict the receipt reports — one verdict");
  assert.deepEqual(c.geometry.at, WAITING_ROOM_AT);
  assert.equal(parse(c.data)._set_down.act_id, "1636", "the hand-run shape: act 1636 named on the claim");
  assert.match(hold.setDownNote(out), /filed as keith's private draft/);
  assert.doesNotMatch(hold.setDownNote(out), /canon moves it here/, "no promise of a move the verdict did not make");
});

// ── THE AUTHOR'S OWN DRAFT (postmark#3663, kogane) ──────────────────────────
//
// kogane folded draft things at the Well House, carried them to a shrine and
// set them down before the crossing; they published back at the Well House.
// The set-down read only canon, found nothing for an unpublished thing, and
// filed nothing. A PRIVATE DRAFT is now re-sited in place: the same claim row,
// at the place it was set down. A claim already PUT FORWARD waits on a ruling,
// and the receipt says that instead of promising an amend that never comes.
// THE FLIP: drop the live-claim read in `fileAuthorsAmend` and DRAFT reds on
// "the set-down filed nothing".

const CUP = "keith/a-tin-cup";
const FOLD_AT = { x: 176, y: 425.5 };   // the Waiting Room: not Keith's ground, so the cup stays a draft
const MOVED_AT = { x: 185, y: 430 };    // still the Waiting Room, a few steps over

async function cupDraft(p) {
  const world = await import("../src/world.mjs");
  await world.leaveMarkViaOffice(repo, { by: "keith", slug: "a-tin-cup", at: FOLD_AT, extent: { w: 1, h: 1 },
    kind: "sited", class: "thing", body: "A tin cup with a dent in the rim.", portable: true }, KEITH);
  const rows = p.claims().filter((c) => c.slug === CUP);
  assert.equal(rows.length, 1, `the cup is one claim: ${JSON.stringify(p.claims())}`);
  assert.equal(rows[0].status, "draft", "with no stake on ground that is not Keith's, the cup is a private draft");
  const { liveMarkOf } = await import("../world2/tools/guard-reads.mjs");
  return liveMarkOf(rows[0]).mark;
}

test("DRAFT: Keith sets down his own private draft elsewhere, and the same claim is re-sited where he stood", async () => {
  const p = await fresh();
  const live = await cupDraft(p);
  const out = await hold.fileSetDownAmend({
    did: { thing: CUP, declared_by: "keith", at: "2026-10-10T23:45:10.654Z", did: "drop" },
    stood: MOVED_AT, key: KEITH, actId: 16113, deps: { householdOf: HOUSES, mark: null, liveClaim: live },
  });
  assert.equal(out.amend.filed, true, `the set-down filed nothing: ${JSON.stringify(out)}`);
  assert.equal(out.amend.draft, true);
  assert.equal(p.rows().filter((a) => a.object === CUP).length, 0, "a private draft is no public deed: no act is mirrored until it is put forward");
  // The newest claim for the cup is a private draft at the set-down place. (This
  // in-memory pen answers every UPDATE with no rows, so it stands a second row
  // where the real pen rewrites the first; second-amend-replaces-the-first.test.mjs
  // proves the rewrite against the real store.)
  const latest = p.claims().filter((c) => c.slug === CUP).at(-1);
  assert.equal(latest.status, "draft");
  assert.deepEqual(latest.geometry.at, MOVED_AT, "the draft now carries the place it was set down");
  assert.equal(parse(latest.data)._set_down.act_id, "16113", "and names the drop that moved it");
  const deferred = parse(latest.data)._deferred_act;
  assert.equal(deferred.action, "amend", "the act it holds until it is put forward is Keith's amend");
  assert.equal(deferred.actor, "keith");
  assert.match(hold.setDownNote(out), /your private draft is re-sited here, and it publishes here when it is put forward/);
});

test("PUT FORWARD: a claim already on the docket is not re-sited here, and the receipt says so instead of promising an amend", async () => {
  const p = await fresh();
  const live = await cupDraft(p);
  const before = JSON.stringify(p.claims());
  const out = await hold.fileSetDownAmend({
    did: { thing: CUP, declared_by: "keith", at: "2026-10-10T23:45:10.654Z", did: "drop" },
    stood: MOVED_AT, key: KEITH, actId: 16113,
    deps: { householdOf: HOUSES, mark: null, liveClaim: { ...live, claim_status: "pending", put_forward: true } },
  });
  assert.equal(out.amend.filed, false);
  assert.equal(out.amend.put_forward_unpublished, true);
  assert.equal(JSON.stringify(p.claims()), before, "nothing was written");
  const note = hold.setDownNote(out);
  assert.match(note, /put forward and not yet published, so it publishes where it was folded/);
  assert.doesNotMatch(note, /until one is/, "no promise of an amend that will never be filed");
});

// ── FALSIFIER 2 · a stranger's set-down files nothing, and says so ──────────

test("ANA DROPS KEITH'S STOOL: no amend, no claim, canon unchanged — and the receipt says it is unaccepted", async () => {
  const p = await fresh();
  hand("ana");
  const r = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "ana" }, ANA);
  assert.equal(r.did, "drop", `the drop itself stands, as before: ${JSON.stringify(r)}`);
  assert.ok(p.rows().some((a) => a.action === "drop"), "the drop act is written");
  assert.equal(p.rows().filter((a) => a.action === "amend").length, 0, "no amend in Keith's name from Ana's hand");
  assert.equal(p.claims().length, 0, "no claim on the docket: canon keeps the stool where Keith put it");
  assert.equal(r.set_down.whose, "another household's");
  assert.equal(r.set_down.amend.filed, false);
  assert.match(r.stands_note, /keith made it, and a set-down by another household moves nothing in canon on its own: it reads as set down by you, unaccepted, and canon stays where keith put it/);
  assert.doesNotMatch(r.stands_note, /re-sites/, "the old promise is not made to a stranger");
  console.log(`    RECEIPT · ${r.stands_note}`);
});

test("THE READ: a stranger's set-down reads 'set down by ana at <place> — unaccepted; canon stays at <keith's place>'", async () => {
  const attachments = [{ target: STOOL, entity: "ana", policy: "detach", born_at: "2026-09-24T01:00:00Z" }];
  const journal = [{ object: STOOL, action: "drop", actor: "ana", seq: 9001, at: { anchor: null, dx: WAITING_ROOM_AT.x, dy: WAITING_ROOM_AT.y } }];
  const s = await hold.whereThingStands(STOOL, { attachments, journal, fold: GARAGE_AT, householdOf: HOUSES });
  assert.equal(s.source, "set-down", "it stands where Ana set it down — the reach's interim read");
  assert.deepEqual(s.where, WAITING_ROOM_AT);
  assert.equal(s.accepted, false);
  assert.deepEqual(s.canon_at, GARAGE_AT, "canon has not moved");
  assert.equal(s.says, "set down by ana at (176, 425.5) — unaccepted; canon stays at (3978, -398), where keith put it");

  // The promise is made over the amend THIS drop filed, on the docket (POS-451;
  // set-down-moves-the-stool.test.mjs § E drives the read with the real port).
  const amends = [{ thing: STOOL, act_id: "9001", status: "pending" }];
  const own = await hold.whereThingStands(STOOL, { attachments, journal: [{ ...journal[0], actor: "keith" }], fold: GARAGE_AT, householdOf: HOUSES, amends });
  assert.equal(own.accepted, undefined, "the author's own set-down is not a stance question");
  assert.match(own.says, /the record re-sites the mark at the next fold/, "and its promise is kept over its filed amend, word for word");
});

test("a household record that cannot be read decides neither way: nothing filed, and the read promises nothing", async () => {
  const p = await fresh();
  const out = await hold.fileSetDownAmend({
    did: { thing: STOOL, declared_by: "kin", at: "2026-09-24T01:00:00Z", did: "drop" },
    stood: YARD_AT, key: KEITH, deps: { householdOf: null, mark: stoolRecord },
  });
  assert.equal(out.amend.filed, false);
  assert.equal(out.whose, "unread");
  assert.equal(p.rows().length + p.claims().length, 0, "the pen was never asked");
  const s = await hold.whereThingStands(STOOL, {
    attachments: [{ target: STOOL, entity: "kin", policy: "detach", born_at: "x" }],
    journal: [{ object: STOOL, action: "drop", actor: "kin", at: { anchor: null, dx: 1, dy: 2 } }],
    fold: GARAGE_AT,
  });
  assert.equal(s.accepted, null);
  assert.doesNotMatch(s.says, /re-sites/);
});

// ── an amend that would delete an authored line is not filed ─────────────────

test("a record carrying a line the door cannot re-declare (loot) is not amended — the receipt names the line", async () => {
  const built = hold.setDownAmend({ thing: "the-town/the-wick-end", mark: { ...stoolRecord, id: "the-town/the-wick-end", loot: true }, stood: YARD_AT, actor: "the-town" });
  assert.match(built.refused, /`loot`/);
  assert.equal(built.payload, undefined);
  const ok = hold.setDownAmend({ thing: STOOL, mark: { ...stoolRecord, signal: false }, stood: YARD_AT, actor: "keith" });
  assert.ok(ok.payload, "the assembly's derived `signal` is not an authored line");
});

// ── ACCEPTANCE (b) · the inventory agrees with the graph after the fold ──────
//
// THE INVENTORY'S READER is `groundWithinReach` (src/world-apex.mjs): what a
// resident standing somewhere is shown as standing there. It composes three
// pure parts — `whereThingStands` for the place, `standsWithin` for the reach,
// `groundRow` for the verdict — and this drives those three exactly as it does.
// The GRAPH's answer is the fold's `at` for the stool, which the published amend
// sets to the set-down point (the world lane measured `placementParent` →
// `postmaster/the-waiting-room` for that point, 2026-09-23).

test("AFTER THE FOLD: the Waiting Room inventory and the published graph give the same point for the stool", async () => {
  const { standsWithin } = await import("../src/reach.mjs");
  const attachments = [{ target: STOOL, entity: "keith", policy: "detach", born_at: "2026-09-10T15:37:58Z" }];
  const journal = [{ object: STOOL, action: "drop", actor: "keith", seq: 1636, at: { anchor: null, dx: WAITING_ROOM_AT.x, dy: WAITING_ROOM_AT.y } }];
  const foldedAt = { ...WAITING_ROOM_AT }; // the graph, after the amend publishes
  const s = await hold.whereThingStands(STOOL, { attachments, journal, fold: foldedAt, householdOf: HOUSES });
  assert.deepEqual(s.where, foldedAt, "the inventory's place and the graph's are one point");
  const inRoom = { x: WAITING_ROOM_AT.x + 3, y: WAITING_ROOM_AT.y - 2 };
  const room = PUBLISHED.find((m) => m.id === "postmaster/the-waiting-room");
  const rect = (m, p) => Math.abs(p.x - m.at.x) <= m.extent.w / 2 && Math.abs(p.y - m.at.y) <= m.extent.h / 2;
  assert.ok(rect(room, s.where), "and that point is inside the Waiting Room, as the graph's containment says");
  const reach = standsWithin(inRoom, { id: STOOL, at: s.where, extent: stoolRecord.extent }, { pointWithinMark: (p, m) => rect(m, p) });
  const row = hold.groundRow({ id: STOOL, made_by: "keith", body: stoolRecord.body, stands: s, reach });
  assert.deepEqual(row.stands_at, foldedAt, "the ground read lists it at the graph's point");
  assert.equal(row.holder, undefined, "nobody holds it");
});

// ── ACCEPTANCE (c) · nothing is inferred from a set-down edge alone ──────────

test("PINNED: a set-down never reads as accepted, and an amend copies a notice's status verbatim — no completion is inferred", async () => {
  for (const actor of ["keith", "kin", "ana", "someone"]) {
    const s = await hold.whereThingStands(STOOL, {
      attachments: [{ target: STOOL, entity: actor, policy: "detach", born_at: "x" }],
      journal: [{ object: STOOL, action: "drop", actor, at: { anchor: null, dx: 1, dy: 1 } }],
      fold: GARAGE_AT, householdOf: HOUSES,
    });
    assert.notEqual(s.accepted, true, `a set-down by ${actor} read as accepted — acceptance is the author's word, never the edge's`);
  }
  const notice = { ...stoolRecord, id: "keith/a-notice", class: "bounty", ask: "fix the latch", reward: 2, status: "open" };
  const built = hold.setDownAmend({ thing: "keith/a-notice", mark: notice, stood: YARD_AT, actor: "ana" });
  assert.equal(built.payload.status, "open", "a notice set down anywhere is still open — the amend carries the poster's word, not a verdict");
  assert.equal(built.payload.class, "bounty");
});

// ── the receipt's act id (found on the way) ──────────────────────────────────

test("the flipped hold receipt's `seq` is the act's id — it answered null on every act since G1", async () => {
  const p = await fresh();
  hand("keith");
  const r = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "keith" }, KEITH);
  const drop = p.rows().find((a) => a.action === "drop");
  assert.equal(r.seq, drop.id);
});

// ═════════════════════════════════════════════════════════════════════════════
// THE SECOND HALF · the author's house answers a stranger's set-down
// ═════════════════════════════════════════════════════════════════════════════
//
// Keemin, 2026-09-24 ~10:1x EDT, on PR #180's proposal: "I agree with you here."
// The drop act IS the drafted amend. `declare-stance-on` gains the author's-
// house arm: welcomed files the author's amend through the same
// `leaveMarkViaOffice` call, in the author's name, with `_set_down` plus the
// stance act's id; opposed makes the read answer canon, with no store write;
// silence stays unaccepted.
//
// Driven end to end: Ana's drop through the real hold door, Keith's word
// through the real stance door (`declareStanceViaOffice`), the amend through the
// real leave-mark door, the read over the real stance rows (`stanceRows`).

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
async function speak(word, handle, key, extraDeps = {}) {
  try {
    return await stance.declareStanceViaOffice(repo, { on: STOOL, stance: word, handle }, key, { setDownDeps: { householdOf: HOUSES, readRows, ...extraDeps } });
  } catch (e) {
    return { refused: true, code: e?.code, defect: e?.defect ?? e?.message, hint: e?.hint };
  }
}

/** The read, over the record's own stance rows. */
// THE DOCKET the read judges "canon follows" against (POS-451): the pen's
// claims as `guard-reads.mjs § pgSetDownAmends` answers them (pending or
// locked, carrying `_set_down`); the real query runs on a real store in
// set-down-moves-the-stool.test.mjs § E and § F.
const docketOf = (p) => p.claims()
  .filter((c) => (c.status === "pending" || c.status === "locked") && parse(c.data)?._set_down)
  .map((c) => ({ thing: c.slug, act_id: String(parse(c.data)._set_down.act_id), status: c.status }));

async function readStool(drop, fold = GARAGE_AT, { escrow = stoolRecord.stamps } = {}) {
  const stances = await stance.stanceRows({ worldClone: repo });
  return hold.whereThingStands(STOOL, {
    attachments: [{ target: STOOL, entity: "ana", policy: "detach", born_at: "2026-09-24T01:00:00Z" }],
    journal: [{ object: STOOL, action: "drop", actor: "ana", seq: drop.id, at: { anchor: null, dx: ANA_AT.x, dy: ANA_AT.y } }],
    fold, householdOf: HOUSES, stances, amends: docketOf(pen), escrowOf: () => escrow,
  });
}

// ── ACCEPT ───────────────────────────────────────────────────────────────────
//
// THE FLIP: make `answerSetDown` skip `fileAuthorsAmend` and this reds on "no
// amend act" — a welcome that is only a word moves nothing.

test("ACCEPT: Keith's house welcomes Ana's set-down — the author's amend is filed in Keith's name, attributed to the drop act AND the stance act", async () => {
  const p = await fresh();
  const drop = await anaDrops(p);
  assert.equal(p.claims().length, 0, "before the answer, canon has not moved");

  const r = await speak("welcomed", "keith", KEITH);
  assert.ok(!r.refused, `the welcome was refused: ${JSON.stringify(r)}`);

  const said = p.rows().find((a) => a.class === "stance");
  assert.ok(said, "the stance act is on the record");
  const sp = parse(said.payload);
  assert.equal(sp.answers, "set-down", "the stance says which question it answers");
  assert.equal(sp.set_down.act_id, String(drop.id), "and names the ONE drop it answers");
  assert.equal(sp.set_down.by, "ana");

  const amend = p.rows().find((a) => a.action === "amend");
  assert.ok(amend, `no amend act — the welcome moved nothing: ${JSON.stringify(r.amend)}`);
  assert.equal(amend.actor, "keith", "filed in the author's name, never the dropper's");
  const ap = parse(amend.payload);
  assert.deepEqual(ap.at, ANA_AT, "at = where Ana set it down");
  assert.equal(ap._set_down.act_id, String(drop.id), "attributed to the drop act");
  assert.equal(ap._set_down.by, "ana", "…and to who set it down");
  assert.equal(ap._set_down.stance_act_id, String(said.id), "…and to the stance act that accepted it");
  assert.equal(ap.class, "thing", "every field Keith wrote is copied");

  const c = p.claims()[0];
  assert.equal(c.claimant, "keith");
  assert.equal(c.supersedes, STANDING_ID, "the amend chain, superseding the standing mark");
  assert.equal(c.status, "pending", "set down on Keith's own ground, so it goes forward");

  assert.equal(r.effect, `your house accepts ana's set-down: the amend that re-sites ${STOOL} at (4105, -305) is filed in keith's name, and canon moves it at the next crossing.`);
  console.log(`    RECEIPT · ${r.effect}`);

  const s = await readStool(drop);
  assert.equal(s.accepted, true, "the read says accepted once the author's house has welcomed it");
  assert.deepEqual(s.where, ANA_AT, "and it stands where Ana set it down");
});

// ── REFUSE ───────────────────────────────────────────────────────────────────

test("REFUSE: Keith's house opposes Ana's set-down — nothing is filed, and the read answers canon from now on", async () => {
  const p = await fresh();
  const drop = await anaDrops(p);
  const before = p.rows().length;
  const r = await speak("opposed", "keith", KEITH);
  assert.ok(!r.refused, `the refusal was refused: ${JSON.stringify(r)}`);
  assert.equal(p.rows().length, before + 1, "one row: the stance itself");
  assert.equal(p.rows().filter((a) => a.action === "amend").length, 0, "no amend");
  assert.equal(p.claims().length, 0, "no claim — no store write moves canon");
  assert.equal(r.effect, `your house refuses ana's set-down: canon keeps ${STOOL} at (3978, -398), and the read answers canon from now on.`);
  console.log(`    RECEIPT · ${r.effect}`);

  const s = await readStool(drop);
  assert.equal(s.source, "fold", "the read answers canon");
  assert.deepEqual(s.where, GARAGE_AT, "at the garage, where Keith put it");
  assert.equal(s.refused_by, "keith");
  assert.equal(s.says, "set down by ana at (4105, -305) — refused by keith's house; canon stands at (3978, -398), where keith put it");
});

// ── SILENCE ──────────────────────────────────────────────────────────────────

test("SILENCE: with no answer, nothing is filed and the read stays unaccepted, canon where Keith put it", async () => {
  const p = await fresh();
  const drop = await anaDrops(p);
  assert.equal(p.rows().filter((a) => a.class === "stance" || a.action === "amend").length, 0);
  const s = await readStool(drop);
  assert.equal(s.accepted, false);
  assert.equal(s.source, "set-down");
  assert.match(s.says, /— unaccepted; canon stays at \(3978, -398\), where keith put it$/);
});

// ── THE AUTHOR'S HOUSE ALONE ─────────────────────────────────────────────────

test("AUTHOR-ONLY: Ana cannot welcome her own set-down of Keith's thing — refused by name, nothing written", async () => {
  const p = await fresh();
  await anaDrops(p);
  const before = p.rows().length;
  const r = await speak("welcomed", "ana", ANA);
  assert.equal(r.refused, true, `Ana accepted her own move of Keith's stool: ${JSON.stringify(r)}`);
  assert.equal(r.code, 403);
  assert.match(r.hint, /a set-down of keith's thing is accepted or refused by keith's house alone/);
  assert.equal(p.rows().length, before, "no stance row, no amend");
  assert.equal(p.claims().length, 0);
});

test("a welcome needs a key that acts for the author — the amend is filed in their name; a housemate's key without them is refused before anything is written", async () => {
  const p = await fresh();
  await anaDrops(p);
  const before = p.rows().length;
  const r = await speak("welcomed", "kin", { household: "keithhouse", handles: new Set(["kin"]) });
  assert.equal(r.refused, true, JSON.stringify(r));
  assert.equal(r.code, 403);
  assert.match(r.defect, /this key does not act for keith/);
  assert.equal(p.rows().length, before, "refused before the stance row, not after it");
});

test("a housemate on a key without the author may still REFUSE — opposed writes nothing but the word", async () => {
  const p = await fresh();
  await anaDrops(p);
  const r = await speak("opposed", "kin", { household: "keithhouse", handles: new Set(["kin"]) });
  assert.ok(!r.refused, JSON.stringify(r));
  assert.equal(p.claims().length, 0);
});

test("once accepted, a later 'opposed' is refused — the amend is filed in the author's name, and moving it back is an amend", async () => {
  const p = await fresh();
  await anaDrops(p);
  const ok = await speak("welcomed", "keith", KEITH);
  assert.ok(!ok.refused, JSON.stringify(ok));
  const before = p.rows().length;
  const r = await speak("opposed", "keith", KEITH);
  assert.equal(r.refused, true, JSON.stringify(r));
  assert.equal(r.code, 409);
  assert.match(r.hint, /accepting filed the amend/, "the record found the amend, so the refusal may say it was filed");
  assert.equal(p.rows().length, before, "nothing written");
});

// ── AN UNFILED WELCOME CAN STILL BE OPPOSED (postmark#3549, the second effect) ─
//
// A welcome whose amend the door refused moved nothing. The opposed arm used to
// refuse every later word after a welcome, saying "accepting filed the amend",
// which is false here: the author's house could neither move the thing nor take
// the welcome back. It now asks the record whether an amend answering THIS drop
// was filed, and refuses only when one was.
//
// THE FLIP: drop the record check in `answerSetDown` and this reds on "the
// refusal was refused".

test("AN UNFILED WELCOME CAN STILL BE OPPOSED: no amend answers the drop, so opposed is recorded and the read answers canon", async () => {
  const p = await fresh();
  const drop = await anaDrops(p);
  const refusingDoor = async () => { const e = new Error("3 marks stand on it"); Object.assign(e, { code: 409, defect: "3 marks stand on it" }); throw e; };
  const ok = await speak("welcomed", "keith", KEITH, { leave: refusingDoor });
  assert.equal(ok.amend?.filed, false, `the control: the welcome's amend was refused: ${JSON.stringify(ok)}`);
  const before = p.rows().length;

  const r = await speak("opposed", "keith", KEITH);
  assert.ok(!r.refused, `the refusal was refused: ${JSON.stringify(r)}`);
  assert.equal(r.superseded?.stance, "welcomed", "it supersedes the welcome");
  assert.equal(p.rows().length, before + 1, "one row: the stance itself");
  assert.equal(p.rows().filter((a) => a.action === "amend").length, 0, "no amend");
  assert.equal(p.claims().length, 0, "no claim");

  const s = await readStool(drop);
  assert.equal(s.source, "fold", "the read answers canon");
  assert.deepEqual(s.where, GARAGE_AT);
  assert.equal(s.refused_by, "keith");
});

test("A WELCOME THE DOOR CANNOT CHECK: opposed is still refused, and the refusal does not claim the amend was filed", async () => {
  const p = await fresh();
  await anaDrops(p);
  const refusingDoor = async () => { const e = new Error("3 marks stand on it"); Object.assign(e, { code: 409, defect: "3 marks stand on it" }); throw e; };
  const ok = await speak("welcomed", "keith", KEITH, { leave: refusingDoor });
  assert.equal(ok.amend?.filed, false, JSON.stringify(ok));
  const before = p.rows().length;
  // The mark lane off the register: an amend would not be in `acts`, so "none
  // found" there is "could not tell", never "none was filed".
  process.env.W2_PEN = "hold";
  try {
    const r = await speak("opposed", "keith", KEITH);
    assert.equal(r.refused, true, JSON.stringify(r));
    assert.equal(r.code, 409);
    assert.doesNotMatch(r.hint, /accepting filed the amend/, `the refusal claims a filing it did not see: ${r.hint}`);
    assert.match(r.hint, /could not tell whether/);
    assert.equal(p.rows().length, before, "nothing written");
  } finally { process.env.W2_PEN = "mark,hold"; }
});

test("an answer belongs to ONE drop: a welcome of Ana's first set-down does not accept a later one", () => {
  const stances = [{ class: "stance", actor: "keith", object: STOOL, written_at: "2026-09-24T10:00:00Z", seq: 5,
    payload: { stance: "welcomed", answers: "set-down", set_down: { act_id: "3" } } }];
  assert.equal(hold.setDownAnswer({ stances, thing: STOOL, dropSeq: 3, madeBy: "keith", householdOf: HOUSES })?.stance, "welcomed");
  assert.equal(hold.setDownAnswer({ stances, thing: STOOL, dropSeq: 9, madeBy: "keith", householdOf: HOUSES }), null, "drop 9 is unanswered");
  const byAna = [{ ...stances[0], actor: "ana" }];
  assert.equal(hold.setDownAnswer({ stances: byAna, thing: STOOL, dropSeq: 3, madeBy: "keith", householdOf: HOUSES }), null,
    "a stance by anyone outside the author's house answers nothing, even if a writer other than the door put it there");
  const groundWord = [{ ...stances[0], payload: { stance: "opposed" } }];
  assert.equal(hold.setDownAnswer({ stances: groundWord, thing: STOOL, dropSeq: 3, madeBy: "keith", householdOf: HOUSES }), null,
    "a ground-holder's ordinary stance on the thing is not an answer to a set-down");
});

// ── THE READ CLAIMS ONLY WHAT THE STANCE PROVES (Wright's review, #184) ──────
//
// The stance row is written before the amend is filed, and the amend door can
// still refuse (the move guard, an error). The read sees the word and never
// the filing, so it must not say the amend "is filed".
//
// THE FLIP: restore the old sentence ("…; the amend that re-sites it is filed
// in keith's name") and this reds.

test("A WELCOME WHOSE AMEND THE DOOR REFUSES: the receipt says it was not filed, and the read does not claim a filing", async () => {
  const p = await fresh();
  const drop = await anaDrops(p);
  const refusingDoor = async () => { const e = new Error("3 marks stand on it"); Object.assign(e, { code: 409, defect: "3 marks stand on it" }); throw e; };
  const r = await speak("welcomed", "keith", KEITH, { leave: refusingDoor });
  assert.ok(!r.refused, `the welcome itself stands: ${JSON.stringify(r)}`);
  assert.equal(r.amend.filed, false, "the amend door refused");
  assert.match(r.effect, /was not filed \(the amend door refused: 3 marks stand on it\)/, "the receipt tells the truth");
  assert.equal(p.rows().filter((a) => a.action === "amend").length, 0, "no amend act");
  assert.equal(p.claims().length, 0, "no claim");

  const s = await readStool(drop);
  assert.equal(s.accepted, true, "the word was spoken, and the read says so");
  assert.doesNotMatch(s.says, /is filed/, `the read claims a filing that did not happen: ${s.says}`);
  // …nor a move nothing filed can make (POS-451): no amend on the docket.
  assert.doesNotMatch(s.says, /canon follows/, `the read promised a move no amend can make: ${s.says}`);
  assert.equal(s.says, `set down by ana at (4105, -305) — accepted by keith's house, but no amend from this set-down is on the docket, so canon stays at (3978, -398): keith's amend is a private draft or was refused, and a stake on ${STOOL} by keith's house puts a draft forward`);
});

// At ✦0 the refused welcome left NO draft, and the read cannot see that: it
// must hedge exactly as it does at ✦2, never promise "keith's private draft",
// and never say whose ground it is (it does not look).
//
// THE FLIP: restore "keith's amend is keith's private draft at escrow ✦0: on
// ground that is not keith's household's …" and this reds.
test("A WELCOME WHOSE AMEND THE DOOR REFUSES, AT ✦0: the read names no draft that does not exist, and asserts no ground it did not read", async () => {
  const p = await fresh();
  const drop = await anaDrops(p);
  const refusingDoor = async () => { const e = new Error("the record carries `loot`"); Object.assign(e, { code: 409, defect: "the record carries `loot`" }); throw e; };
  const r = await speak("welcomed", "keith", KEITH, { leave: refusingDoor });
  assert.equal(r.amend.filed, false, "the amend door refused");
  assert.equal(p.claims().length, 0, "no claim, so no draft either");

  const s = await readStool(drop, GARAGE_AT, { escrow: 0 });
  assert.equal(s.accepted, true);
  assert.doesNotMatch(s.says, /canon follows/);
  assert.doesNotMatch(s.says, /is keith's private draft/, `the read named a draft the door never filed: ${s.says}`);
  assert.doesNotMatch(s.says, /ground that is not/, `the read asserted a ground it never read: ${s.says}`);
  assert.equal(s.says, `set down by ana at (4105, -305) — accepted by keith's house, but no amend from this set-down is on the docket, so canon stays at (3978, -398): keith's amend is a private draft or was refused, and ${STOOL} has ✦0 behind it: a draft goes forward with ✦1 behind it, so a stake of ✦1 on ${STOOL} by keith's house puts a draft forward`);
  assert.equal(s.escrow, 0);
  assert.equal(s.stake_needed, 1);
});

// ── A WELCOME OUTSIDE THE DECLARED PARENT (postmark#3549) ────────────────────
//
// The amend door refuses an amend that moves a mark outside the parent its
// FILING declares (`world.mjs § declaredParentGuard`, postmark#3020). A welcome
// asks that guard before the stance row, so the refusal leaves nothing behind.
// Before, the row was written, the amend was refused after it, and the receipt
// said "speak welcomed again to file it", which meets the same refusal.
//
// Here the freeze files the stool inside Keith's garage, and Ana sets it down
// in Keith's yard, outside the garage. The freeze is put back afterwards.
//
// THE FLIP: drop the guard call in `answerSetDown` and this reds on "the
// welcome was recorded".

test("A WELCOME OUTSIDE THE DECLARED PARENT: refused before the stance row, with nothing written", async () => {
  const freeze = (marks) => {
    put(repo, "WORLD/filing-freeze.json", JSON.stringify({ frozen_at: "2026-08-25", marks }));
    git("commit", "-qam", "freeze");
    resetPathIndex();
  };
  freeze({ "keith/the-garage": "WORLD/marks/let-there-be-light/the-garage",
    [STOOL]: "WORLD/marks/let-there-be-light/the-garage/waiting-room-stool-2026-09-10" });
  try {
    const p = await fresh();
    await anaDrops(p);
    const before = p.rows().length;
    const r = await speak("welcomed", "keith", KEITH);
    assert.equal(r.refused, true, `the welcome was recorded: ${JSON.stringify(r)}`);
    assert.equal(r.code, 409);
    assert.equal(r.defect, `(4105, -305) is outside "keith/the-garage", and "${STOOL}" is filed inside it`);
    assert.match(r.hint, /nothing was written$/);
    assert.equal(p.rows().length, before, "no stance row, no amend");
    assert.equal(p.claims().length, 0, "no claim");
  } finally { freeze({}); }
});

// ═════════════════════════════════════════════════════════════════════════════
// THE THIRD HALF · the set-down waits in the author's stances read
// ═════════════════════════════════════════════════════════════════════════════
//
// Keemin, 2026-09-24 17:2x: an author's house must be told when another
// household has set down a thing it made, "in the same stances read". The
// group is `set_downs_awaiting`, beside the ground group, built from
// `setDownFor` + `setDownAnswer` over the holding record's drops of things the
// house made (`world2-guards.mjs § setDownRowsForMakers`).
//
// Driven over the acts the real doors wrote into this suite's pen: Ana's drop
// through the hold door, Keith's word through the stance door. The holding read
// is the real `setDownRowsForMakers`, answered by `actsClient` through the
// guards' own reader seam; the household map is the town's own reader
// (`households.mjs`, off this suite's town clone), never HOUSES, so the doorstep
// leg and the read legs ask the same question the same way.
//
// THE FLIPS (each reds its own leg):
//   · drop `setDowns: true` from the household door → KEITH SEES IT reds;
//   · make `setDownsAwaiting` skip the `setDownAnswer` check → ANSWERED reds;
//   · make it keep a set-down whose `setDownFor` found no stranger → OWN DROP reds;
//   · drop `setDowns: true` from the doorstep → THE DOORSTEP reds.

const underRecord = async (fn) => {
  const restore = guards.useGuardReader((run) => run(actsClient(written(pen))));
  try { return await fn(); } finally { restore(); }
};
const apex = await import("../src/household-apex.mjs");
/** The household door's own stances read, as `key` asks it. */
const stancesRead = (key, extra = {}) => underRecord(() => apex.householdApex({ read: "stances", ...extra }, key));

test("KEITH SEES IT: Ana sets down Keith's stool, and Keith's stances read lists it with the call that answers it", async () => {
  const p = await fresh();
  const drop = await anaDrops(p);
  const r = await stancesRead(KEITH);
  assert.equal(r.unavailable, undefined, `the read could not see the world: ${r.unavailable}`);
  assert.equal(r.set_downs_unavailable, undefined, `the holding record could not be read: ${r.set_downs_unavailable}`);
  assert.equal(r.set_downs_awaiting?.length, 1, `one set-down waits: ${JSON.stringify(r.set_downs_awaiting)}`);
  const w = r.set_downs_awaiting[0];
  assert.equal(w.thing, STOOL);
  assert.equal(w.made_by, "keith");
  assert.equal(w.set_down_by, "ana", "who set it down");
  assert.deepEqual(w.at, ANA_AT, "where");
  assert.ok(w.when && !Number.isNaN(Date.parse(w.when)), `when: ${w.when}`);
  assert.equal(w.act_id, String(drop.id), "the drop's act id — the one the answer binds to");
  assert.deepEqual(w.canon_at, GARAGE_AT, "where canon keeps it");
  assert.match(w.answer, /^household \{ do: "declare-stance-on", args: \{ on: "keith\/waiting-room-stool-2026-09-10", stance: "welcomed" \| "opposed" \} \}/);
  assert.equal(r.note, undefined, "the read does not say nothing awaits while a set-down does");
  console.log(`    WAITING · ${JSON.stringify(w)}`);

  const kin = await stancesRead({ household: "keithhouse", handles: new Set(["kin"]) });
  assert.deepEqual(kin.set_downs_awaiting, [], "narrowed to kin, who did not make the stool, the group is empty");
});

test("PRIVACY: Ana's own stances read does not list her set-down of Keith's thing", async () => {
  const p = await fresh();
  await anaDrops(p);
  const r = await stancesRead(ANA);
  assert.deepEqual(r.set_downs_awaiting, [], "a house sees set-downs of its own residents' things and nobody else's");
});

test("ANSWERED: once Keith's house welcomes or opposes it, the set-down leaves the waiting group and reads with the stances spoken", async () => {
  for (const word of ["welcomed", "opposed"]) {
    const p = await fresh();
    await anaDrops(p);
    assert.equal((await stancesRead(KEITH)).set_downs_awaiting.length, 1, `${word}: it waits first`);
    const said = await speak(word, "keith", KEITH);
    assert.ok(!said.refused, `${word}: the answer was refused: ${JSON.stringify(said)}`);
    const r = await stancesRead(KEITH);
    assert.deepEqual(r.set_downs_awaiting, [], `${word}: an answered set-down no longer waits`);
    assert.ok(r.standing.some((s) => s.on === STOOL && s.stance === word && s.by === "keith"),
      `${word}: and the word reads in standing: ${JSON.stringify(r.standing)}`);
  }
});

test("PICKED UP: once the stool is in somebody's hands again, nothing waits", async () => {
  const p = await fresh();
  await anaDrops(p);
  // The record's own rows for Ana's drop, then the same rows with a live holder
  // in the attachment half (`pgAttachmentsFor`'s answer once somebody takes it
  // up). `hand()` writes the dynamic store, which the holding record does not
  // read, so the holder is put where the record would carry it.
  const rows = await underRecord(() => guards.setDownRowsForMakers(["keith"]));
  const rec = rows.get(STOOL);
  const heldRec = { ...rec, attachments: [{ target: STOOL, entity: "keith", policy: "cascade", born_at: new Date(Date.now() + 1000).toISOString() }] };
  const got = await stance.setDownsAwaiting(["keith"], {
    marks: PUBLISHED, stances: [], deps: { rowsForMakers: async () => new Map([[STOOL, heldRec]]) } });
  assert.deepEqual(got.rows, [], "a held thing is not set down");
  const free = await stance.setDownsAwaiting(["keith"], {
    marks: PUBLISHED, stances: [], deps: { rowsForMakers: async () => new Map([[STOOL, rec]]) } });
  assert.equal(free.rows.length, 1, "the same record with no live holder still waits — the control");
});

// ── SWEPT (little-bird's box of nine) ────────────────────────────────────────
//
// neth set down little-bird/a-box-of-nine-at-grove-wharf on 2026-09-26; the box
// was swept at S86 (a commons mark at ✦0), and the stances read went on listing
// the set-down with an answer the stance door refused 404, "no mark". The read
// lists a set-down only when the thing is among the marks the answer door looks
// in. THE FLIP: drop the `if (!mark) continue` and SWEPT reds.
test("SWEPT: a set-down of a thing that no longer stands does not wait on a word the door would refuse", async () => {
  const p = await fresh();
  await anaDrops(p);
  const rows = await underRecord(() => guards.setDownRowsForMakers(["keith"]));
  const rec = rows.get(STOOL);
  const ask = (marks) => stance.setDownsAwaiting(["keith"], { marks, stances: [], deps: { rowsForMakers: async () => new Map([[STOOL, rec]]) } });
  assert.equal((await ask(PUBLISHED)).rows.length, 1, "the control: while the stool stands, its set-down waits");
  const swept = await ask(PUBLISHED.filter((m) => m.id !== STOOL));
  assert.deepEqual(swept.rows, [], "the stool left canon, so there is nothing to welcome or oppose");
  assert.equal(swept.unavailable, undefined, "an empty group here is an answer, not a failure to read");
});

test("OWN DROP: Keith setting down his own stool never waits on his house's word", async () => {
  const p = await fresh();
  hand("keith");
  const r0 = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "keith" }, KEITH);
  assert.equal(r0.did, "drop", `Keith's drop did not land: ${JSON.stringify(r0)}`);
  assert.ok(p.rows().some((a) => a.action === "drop" && a.actor === "keith"));
  const r = await stancesRead(KEITH);
  assert.deepEqual(r.set_downs_awaiting, [], "the author's own set-down files its amend; nothing waits");
});

test("THE DOORSTEP CARRIES IT: Keith's morning page lists the waiting set-down, and the segment IS the read", async () => {
  const p = await fresh();
  const drop = await anaDrops(p);
  const { emptyTown, setMeta, put } = await import("./fixture.mjs");
  const { indexStore } = await import("./helpers/office-under-test.mjs");
  const { SEGMENT_META } = await import("../src/queries.mjs");
  const { doorstepBundle } = await import("../src/doorstep-bundle.mjs");
  const { callTool } = await import("../src/mcp.mjs");
  // The town index is a real store (the suite's embedded one), read through the
  // index's own pool seam: the record stays this file's in-memory pen.
  const town = emptyTown();
  setMeta(town, "as_of", "pos138fixture00000000000000000000000000"); setMeta(town, "town_path", "fixture"); setMeta(town, "hydrated_counts", "{}");
  setMeta(town, "quest_registry", '{"quests":[]}');
  put(town, "residents", { handle: "keith", json: JSON.stringify({
    handle: "keith", is_office: false, last_active: null, address: { data: { since: "2026-01-01", joined: "2026-06-10" } } }) });
  const IX = await indexStore(town);
  const restore = await IX.useInProcess();
  try {
    const ctx = { key: KEITH, asOf: "pos138fixture00000000000000000000000000", canWrite: false, clone: null, pen: null, odb: null };
    const seg = await underRecord(async () => (await doorstepBundle("keith", ctx)).stances);
    assert.equal(seg.serves, "household.stances", "no new segment name");
    assert.equal(seg.set_downs_awaiting?.length, 1, `the doorstep carries it: ${JSON.stringify(seg).slice(0, 400)}`);
    assert.equal(seg.set_downs_awaiting[0].act_id, String(drop.id));
    const asked = await underRecord(() => callTool("household", { read: "stances", ...seg.args }, ctx));
    const answerOf = (s) => Object.fromEntries(Object.entries(s).filter(([k]) => !SEGMENT_META.includes(k)));
    assert.deepEqual(answerOf(seg), asked, "ask the named read yourself and you get the same object back");
  } finally { await restore(); await IX.stop(); }
});

// ── THE PLACEHOLDER (1626f2f4) ───────────────────────────────────────────────
//
// `pgHoldingRows` wrote its thing clause as `= ${n}` — one dollar, eaten by a
// shell — so Postgres was sent `= 2`. This reads the text the port hands the
// client. THE FLIP: put the one dollar back and this reds.
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

// ── THE NOTE (the read's "nothing awaits" line) ──────────────────────────────
//
// Zed holds no ground in this bottle (the world frame overlaps every parcel, so
// no parcel-holder has an empty ground group), so only a set-down can make the
// note false. THE FLIP: let the note
// ignore `set_downs_awaiting` and this reds.
test("THE NOTE: with the ground group empty and a set-down waiting, the read never says nothing awaits", async () => {
  const cup = "zed/a-cup";
  const houses = (h) => (h === "zed" ? { key: "gh:9", slug: "zed-house" } : HOUSES(h));
  const rec = { attachments: [], journal: [{ seq: 77, crossing: 1, actor: "ana", action: "drop", object: cup,
    at: { anchor: null, dx: ANA_AT.x, dy: ANA_AT.y }, class: "holding", payload: { thing: cup }, written_at: "2026-09-24T12:00:00.000Z" }] };
  const r = await stance.stancesForHandles(["zed"], { repo, setDowns: true,
    setDownDeps: { householdOf: houses, rowsForMakers: async () => new Map([[cup, rec]]) } });
  assert.equal(r.stances_awaiting, 0, `the control: zed holds no ground: ${JSON.stringify(r).slice(0, 300)}`);
  assert.deepEqual(r.set_downs_awaiting.map((w) => [w.thing, w.set_down_by, w.act_id]), [[cup, "ana", "77"]]);
  assert.equal(r.note, undefined, `the read said nothing awaits while a set-down did: ${r.note}`);
  const none = await stance.stancesForHandles(["zed"], { repo, setDowns: true, setDownDeps: { householdOf: houses, rowsForMakers: async () => new Map() } });
  assert.match(none.note ?? "", /nothing awaits your word/, "with both groups empty the note is said");
  assert.equal(none.stances_awaiting, 0);
});
