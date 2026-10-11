// set-down-moves-the-stool.test.mjs — ONE SET-DOWN, CARRIED THE WHOLE WAY (POS-451).
//
//   node --test test/set-down-moves-the-stool.test.mjs
//
// THE QUESTION (POS-451 part 1, Darko 2026-10-07: high priority): on today's
// code, does an author's take → walk → drop re-site the mark at the next
// crossing, so that the World read and the inventory agree?
//
// THE INSTANCE is Keith's stool (postmark#2693): `keith/waiting-room-stool-
// 2026-09-10`, a 1×1 thing filed at the root of keith/, standing in his garage
// at (3978, −398) with ✦2 of his own escrow behind it. Keith carried it to the
// Waiting Room (postmaster's ground, centre (176, 425.5)) on 09-10 and 09-11,
// before POS-138 (09-24) taught the drop to file the amend, so his set-downs
// filed nothing and canon kept it in the garage.
//
// WHAT WAS ALREADY PROVED, IN PIECES, by other files:
//   · the door files the amend as a pending claim superseding the standing
//     mark (set-down-files-the-amend.test.mjs, "KEITH DROPS KEITH'S STOOL") —
//     but onto his own yard, and with no escrow, so never onto another's ground;
//   · the clearing locks a superseding claim and moves the mark's geometry
//     (carry-at-the-clearing.test.mjs, "THE CARRY") — for a parcel;
//   · the write-down prints the store's place and the world's fold agrees
//     (store-writedown-carry.test.mjs, "THE INVARIANT") — for Rei's fixture.
//
// No one file followed ONE set-down from the door to the fold. This one does,
// on the stool's own layout and numbers, through the real code at every hop:
//
//   A · THE DOOR: the real hold door (`callHoldTool`) — Keith takes the stool in
//       his garage, walks to the Waiting Room, sets it down. The amend goes
//       forward on postmaster's ground on the ✦2 standing escrow, and the
//       receipt promises exactly that.
//   B · THE CLEARING: that claim, as the door wrote it, in a real Postgres with
//       the stool standing in the garage; the real `clearing-job.mjs` locks it.
//   C · THE PRINTOUT: the store's row through the real write-down onto a world
//       carrying the stool's own file, and the world's own fold (`tools/marks-
//       fold.mjs` from the pinned world clone) places it.
//   D · THE INVENTORY: `whereThingStands` over the drop and that fold — the
//       reader behind the Waiting Room's ground list.
//
// THE FLIP: delete the `fileSetDownAmend` call in `callHoldTool` (world-hold.mjs)
// and A goes red on "no amend act", and every later stage has nothing to carry.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { startStore } from "./helpers/embedded-store.mjs";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
// THE REAL WORLD CHECKOUT, found before A points WORLD_CLONE at its bottle: C
// runs the world's own fold (tools/marks-fold.mjs) from it, as
// store-writedown-carry.test.mjs does.
const WORLD = [process.env.POSTMARK_WORLD_CLONE, process.env.WORLD_CLONE, join(OFFICE, "world-clone"), join(OFFICE, "..", "postmark-world")]
  .filter(Boolean).find((c) => existsSync(join(c, "tools", "marks-fold.mjs"))) ?? null;
const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };

// ── the stool, as the live record has it ─────────────────────────────────────
//
// The mark file at world main (WORLD/marks/keith/waiting-room-stool-2026-09-10/
// mark.md, unchanged since S65) and the live stake read (escrow 2, holder keith),
// both read 2026-10-10.
const STOOL = "keith/waiting-room-stool-2026-09-10";
const STOOL_FILE = `WORLD/marks/${STOOL}/mark.md`;
const GARAGE_AT = { x: 3978, y: -398 };
const WAITING_ROOM_AT = { x: 176, y: 425.5 };
const STOOL_BODY = "Three-legged stool in pale ash: splayed legs, brass levelers, a seat sanded kind. Two names and a date under the seat. Built for whoever waits.";
const STOOL_DATE = "2026-09-10T15:37:58.221Z";
const ESCROW = 2;
const stoolRecord = {
  id: STOOL, kind: "sited", by: "keith", tier: "home", household: "keith", declared_household: "gh:1",
  date: STOOL_DATE, at: GARAGE_AT, extent: { w: 1, h: 1 }, sovereign: true, stamps: ESCROW, weight: ESCROW,
  weight_parts: { own_escrow: ESCROW }, body: STOOL_BODY, class: "thing", placementParent: "keith/the-garage", ledger_weight: ESCROW,
};

// ═════════════════════════════════════════════════════════════════════════════
// A · THE DOOR
// ═════════════════════════════════════════════════════════════════════════════

const repo = mkdtempSync(join(tmpdir(), "pos451-world-"));
const town = mkdtempSync(join(tmpdir(), "pos451-town-"));
after(() => { sweep(repo); sweep(town); });

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (root, path, text) => {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

const PUBLISHED = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 20000, h: 20000 }, body: "the world frame" },
  { id: "keith/the-garage", by: "keith", kind: "sited", tier: "home", at: GARAGE_AT, extent: { w: 20, h: 20 }, body: "one bay door up" },
  { id: "postmaster/the-waiting-room-parcel", by: "postmaster", kind: "parcel", tier: "home", at: WAITING_ROOM_AT, extent: { w: 25, h: 25 }, body: "the ground the Waiting Room stands on" },
  { id: "postmaster/the-waiting-room", by: "postmaster", kind: "sited", tier: "home", at: WAITING_ROOM_AT, extent: { w: 12, h: 12 }, body: "the waiting room" },
  stoolRecord,
];

// WHERE A RESIDENT STANDS is the world's `where-is`; this bottle's answers from
// a table the test moves, which is what a walk does to the walk ledger. Nobody
// placed stands nowhere (the door then has no standpoint to re-site to).
const STANDPOINTS = (globalThis.__POS451_STANDPOINTS = {});
put(repo, "tools/world-build.mjs", `export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }\n`);
put(repo, "tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function homeOf() { return { ...NOWHERE }; }
export function whereIs(handle) {
  const s = globalThis.__POS451_STANDPOINTS?.[handle];
  return s ? { x: s.x, y: s.y, placed: true, source: "walk", mark_id: null } : { ...NOWHERE };
}
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
put(repo, "tools/geometry.mjs", `
export const rect = (m) => ({ x0: m.at.x - m.extent.w / 2, x1: m.at.x + m.extent.w / 2, y0: m.at.y - m.extent.h / 2, y1: m.at.y + m.extent.h / 2 });
export function overlapArea(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}
`);
put(repo, "seeding/manifest.json", JSON.stringify({ homes: [] }));
put(repo, "WORLD/households.json", JSON.stringify({ households: { keith: "gh:1", postmaster: "gh:9" } }));
put(repo, "WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put(repo, "WORLD/world-state.json", JSON.stringify({
  tick: 0, dials: {}, marks: PUBLISHED,
  parcels: PUBLISHED.filter((m) => m.kind === "parcel").map((m) => ({ id: m.id, household: m.by, at: m.at, extent: m.extent })),
  determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [],
}));
put(repo, "WORLD/filing-freeze.json", JSON.stringify({ frozen_at: "2026-08-25", marks: {} }));
git("init", "-q", "-b", "main");
git("config", "user.email", "test@postmark.town");
git("config", "user.name", "pos451 fixture");
git("add", "-A");
git("commit", "-qm", "canon: keith's stool, folded in his garage");

// THE ESCROW BEHIND THE STOOL is the town ledger's (`world-stake.mjs §
// worldStakeRead` asks the town clone's engine). This town's engine answers the
// live read: ✦2, all Keith's.
put(town, "tools/world-stake.mjs", `
const POS = new Map([["${STOOL}|keith", ${ESCROW}]]);
export function worldStakeState() { return { positions: POS }; }
export function deriveWorldMarkWeights() { return { k: 5, marks: [] }; }
export function markEscrow(_town, mark) { return mark === "${STOOL}" ? ${ESCROW} : 0; }
export function retirementBlocked() { return { blocked: true }; }
`);

const { rowsFromRegistry } = await import("../src/registry-rows.mjs");
const REGISTRY_ROWS = rowsFromRegistry({ households: {
  "shard-house": { residents: ["keith"], accounts: [{ login: "keith-gh", id: 1 }] },
  "starforge": { residents: ["postmaster"], accounts: [{ login: "starforge-gh", id: 9 }] },
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
// The stool's standing mark id in the store — a mark's id is the claim that
// locked it. The same id is seeded in B, so the door's `supersedes` is a real
// foreign key there.
const STANDING_ID = "7f3a0c1e-0000-4000-8000-000000000451";
const claimsPen = await import("../src/world2-claims.mjs");
let unread = () => {};
const pen = installActsPen({ marks: [{ id: STANDING_ID, slug: STOOL }], households: REGISTRY_ROWS.households });
claimsPen.__setPoolForTest(pen);
unread = await readHoldsFrom(pen);
after(() => { unread(); uninstallActsPen(); claimsPen.__setPoolForTest(null); delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; });

const hold = await import("../src/world-hold.mjs");
const KEITH = { household: "keithhouse", handles: new Set(["keith"]) };
const HOUSES = (h) => ({ keith: { key: "gh:1", slug: "shard-house" }, postmaster: { key: "gh:9", slug: "starforge" } })[h] ?? null;
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

/** What the door did, kept for the stages after it. */
const carried = {};

test("A · THE DOOR: Keith takes the stool in his garage, walks to the Waiting Room, sets it down — the amend goes forward on ✦2, superseding the standing mark, and the receipt promises the move", async () => {
  // THE TAKE, in the garage, through the door.
  STANDPOINTS.keith = { ...GARAGE_AT };
  const took = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "keith" }, KEITH);
  assert.equal(took.did, "take", `the take did not land: ${JSON.stringify(took)}`);

  // THE WALK: 4.1 km to the Waiting Room.
  STANDPOINTS.keith = { ...WAITING_ROOM_AT };

  // THE DROP.
  const r = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "keith" }, KEITH);
  assert.equal(r.did, "drop", `the door answered ${JSON.stringify(r)}`);
  assert.deepEqual(r.stands_at, WAITING_ROOM_AT, "it stands where Keith stood");

  const acts = pen.rows();
  const drop = acts.find((a) => a.action === "drop");
  const amend = acts.find((a) => a.action === "amend");
  assert.ok(amend, `no amend act — the set-down filed nothing. Acts: ${acts.map((a) => a.action).join(", ")}`);
  assert.equal(amend.actor, "keith", "the author's own pen");
  assert.deepEqual(parse(amend.payload).at, WAITING_ROOM_AT);
  assert.equal(parse(amend.payload)._set_down.act_id, String(drop.id), "attributed to the drop act");

  const claims = pen.claims();
  assert.equal(claims.length, 1, JSON.stringify(claims));
  const c = claims[0];
  assert.equal(c.supersedes, STANDING_ID, "it supersedes the standing mark (the amend chain, #2806)");
  assert.deepEqual(c.geometry.at, WAITING_ROOM_AT);
  assert.equal(c.status, "pending",
    "FORWARD, not a draft: the Waiting Room is not Keith's ground (minimum ✦1), and the ✦2 already behind the stool clears it (putForwardVerdict's standing-escrow arm, #2614)");
  assert.equal(r.set_down.whose, "your household's");
  assert.equal(r.set_down.amend.filed, true);
  assert.equal(r.set_down.amend.put_forward, true);
  assert.match(r.stands_note, /^it stands where you stood when you set it down, and the act carries that place; the amend that re-sites the mark is filed \(act \d+\), and canon moves it here at the next crossing\.$/);
  console.log(`    RECEIPT · ${r.stands_note}`);
  Object.assign(carried, { claim: c, drop });
});

// ═════════════════════════════════════════════════════════════════════════════
// B · THE CLEARING
// ═════════════════════════════════════════════════════════════════════════════
//
// The rig is carry-at-the-clearing.test.mjs's: a real Postgres with the whole
// schema and the real `clearing-job.mjs` as a child under the `clearing_job`
// pen. The stool stands in the garage as its locking claim and mark; the
// Waiting Room is postmaster's (the founders' house); ✦2 of Keith's escrow is
// on the stool at the window's town sha, so step 5.5 (a commons mark needs
// stamps behind it) asks and is answered, not skipped as unchecked.

const JOB = join(OFFICE, "world2", "tools", "clearing-job.mjs");
const TOWN_SHA = "t".repeat(40);
const LAW_SHA = "l".repeat(40);
const WIN = 260;
const store = await startStore({ db: "set_down_stool_test" });
after(() => store.stop());
const noStore = store.skip ?? false;

const box = (at, ext) => `((${at.x - ext.w / 2},${at.y - ext.h / 2}),(${at.x + ext.w / 2},${at.y + ext.h / 2}))`;
const IDS = {
  garage: "b0000000-0000-4000-8000-000000000001",
  parcel: "b0000000-0000-4000-8000-000000000002",
  room: "b0000000-0000-4000-8000-000000000003",
};

async function readStore(sql, args = []) {
  const c = await store.connect("world2_owner");
  try { return (await c.query(sql, args)).rows; } finally { await c.end(); }
}

async function seedStore(doorClaim, { escrow = true } = {}) {
  const c = await store.connect("world2_owner");
  try {
    await c.query("TRUNCATE escrow_projection, claims, marks, windows, projection_heads, households, household_pins CASCADE");
    for (const id of [WIN - 1, WIN]) {
      const opens = new Date(Date.UTC(2026, 9, 10, 18) + (id - WIN + 1) * 12 * 3600e3).toISOString();
      await c.query(
        `INSERT INTO windows (id, opens_at, closes_at, status, cleared_at)
         VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4)`,
        [id, opens, id === WIN ? "open" : "closed", id === WIN ? null : opens]);
    }
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now())", [LAW_SHA, TOWN_SHA]);
    await c.query(
      `INSERT INTO households (slug, ord, name, residents, since, declared_by)
       VALUES ('shard-house', 0, 'The Shard House', ARRAY['keith'], '2026-08-01', 'keith'),
              ('starforge', 1, 'Starforge', ARRAY['postmaster'], '2026-07-22', 'postmaster')`);
    await c.query(
      `INSERT INTO household_pins (handle, login, gh_id, pinned)
       VALUES ('keith', 'keith-gh', 1, '2026-08-01'), ('postmaster', 'starforge-gh', 9, '2026-07-22')`);
    const mark = async (id, slug, kind, owner, household, at, ext, data = {}) => {
      const geometry = JSON.stringify({ at, extent: ext }), d = JSON.stringify({ tier: "home", ...data });
      await c.query(
        `INSERT INTO claims (id, window_id, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, slug)
         VALUES ($1, $2, $3, $4, $5, 'locked', now(), $6, $7, $8::box, 0, $9, $10)`,
        [id, WIN - 1, kind, owner, household, `${slug}.`, geometry, box(at, ext), d, slug]);
      await c.query(
        `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::box, 'standing', $9, $10)`,
        [id, slug, kind, owner, household, `${slug}.`, geometry, box(at, ext), WIN - 1, d]);
    };
    await mark(IDS.garage, "keith/the-garage", "sited", "keith", "hh:shard-house", GARAGE_AT, { w: 20, h: 20 });
    await mark(STANDING_ID, STOOL, "sited", "keith", "hh:shard-house", GARAGE_AT, { w: 1, h: 1 }, { class: "thing" });
    await mark(IDS.parcel, "postmaster/the-waiting-room-parcel", "parcel", "postmaster", "hh:starforge", WAITING_ROOM_AT, { w: 25, h: 25 });
    await mark(IDS.room, "postmaster/the-waiting-room", "sited", "postmaster", "hh:starforge", WAITING_ROOM_AT, { w: 12, h: 12 });
    if (escrow) await c.query(
      `INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k)
       VALUES ($1, $2, 'keith', 'hh:shard-house', 'hh:shard-house', $3, 5)`, [TOWN_SHA, STOOL, ESCROW]);

    // THE DOOR'S CLAIM, as the door wrote it: every column the door's INSERT
    // names (`world2-claims.mjs § claimTxFromJournal`), copied off the pen.
    const g = doorClaim.geometry;
    const { rows: [row] } = await c.query(
      `INSERT INTO claims (window_id, class, claimant, household, body, geometry, bbox, stake, supersedes, data, slug, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7::box, $8, $9, $10, $11, $12) RETURNING id::text`,
      [WIN, doorClaim.class, doorClaim.claimant, doorClaim.household, doorClaim.body,
       JSON.stringify(g), doorClaim.bbox ?? box(g.at, g.extent), doorClaim.stake ?? 0, doorClaim.supersedes,
       typeof doorClaim.data === "string" ? doorClaim.data : JSON.stringify(doorClaim.data), doorClaim.slug, doorClaim.status]);
    return row.id;
  } finally { await c.end(); }
}

function clearWindow() {
  const r = spawnSync(process.execPath, [JOB, "--window", String(WIN)], {
    cwd: OFFICE, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
  });
  return { code: r.status, out: `${r.stdout}
${r.stderr}` };
}

test("B · THE CLEARING: the door's claim locks, and the stool's mark stands in the Waiting Room — market on postmaster's ground, uncoupled, with no word from the room's holder", { skip: noStore }, async () => {
  assert.ok(carried.claim, "A ran first and left its claim");
  const claimId = await seedStore(carried.claim);
  const { code, out } = clearWindow();
  assert.equal(code, 0, out);

  const [claim] = await readStore("SELECT status, refusal_check FROM claims WHERE id = $1", [claimId]);
  assert.equal(claim.status, "locked", `the clearing did not lock the set-down's amend: ${JSON.stringify(claim)}
${out}`);

  const marks = await readStore("SELECT id::text, slug, kind, owner, household, body, status, geometry, locked_window, data FROM marks WHERE slug = $1", [STOOL]);
  const standing = marks.filter((m) => m.status === "standing");
  assert.equal(standing.length, 1, `one standing stool: ${JSON.stringify(marks)}`);
  const [stool] = standing;
  assert.deepEqual(stool.geometry.at, WAITING_ROOM_AT, "the store's mark stands where Keith set it down");
  assert.equal(stool.id, STANDING_ID, "the amend moves the standing mark in place: the same mark, never a second stool");
  assert.equal(stool.owner, "keith", "a move never changes whose it is");
  assert.equal(stool.locked_window, WIN);
  assert.equal(stool.data?.tier, "market",
    "standing is recomputed at step 7: on the founders' ground with no word from them, the stool stands at its own weight — market, as kogane's washstand does in the same room");
  assert.match(out, /⚑ carry: moved keith\/waiting-room-stool-2026-09-10/);
  assert.doesNotMatch(out, /escrow: refused|LOCKED UNCHECKED/, "step 5.5 read the stamps behind it and found them (the control below is the same claim with none)");
  console.log(`    STORE · ${STOOL} at ${JSON.stringify(stool.geometry.at)}, ${stool.data?.tier}, window ${stool.locked_window}`);
  carried.storeRow = stool;
});

// THE CONTROL for step 5.5: the same claim with no stamps on the stool at the
// window's town sha is refused, and the stool stays in the garage. The move
// onto another household's ground rides Keith's ✦2; unstaking it first would
// leave the amend refused at the clearing.
test("B · THE CONTROL: with no stamps behind it, the clearing refuses the same move (a commons mark needs escrow, step 5.5) and the stool stays in the garage", { skip: noStore }, async () => {
  assert.ok(carried.claim, "A ran first and left its claim");
  const claimId = await seedStore(carried.claim, { escrow: false });
  // A town sha with rows, so the gate can answer: someone else's stake elsewhere.
  const c = await store.connect("world2_owner");
  try {
    await c.query(
      `INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k)
       VALUES ($1, 'postmaster/the-waiting-room', 'postmaster', 'hh:starforge', 'hh:starforge', 1, 5)`, [TOWN_SHA]);
  } finally { await c.end(); }
  const { code, out } = clearWindow();
  assert.equal(code, 0, out);
  const [claim] = await readStore("SELECT status, refusal_check FROM claims WHERE id = $1", [claimId]);
  assert.equal(claim.status, "refused", `${JSON.stringify(claim)}
${out}`);
  assert.match(out, /escrow: refused 1 commons claim\(s\) with nothing staked/);
  const [stool] = await readStore("SELECT geometry FROM marks WHERE slug = $1 AND status = 'standing'", [STOOL]);
  assert.deepEqual(stool.geometry.at, GARAGE_AT);
});

// ═════════════════════════════════════════════════════════════════════════════
// C · THE PRINTOUT, AND THE WORLD'S OWN FOLD
// ═════════════════════════════════════════════════════════════════════════════
//
// The world the write-down prints onto carries the real bytes of every file in
// the question, copied from the pinned world clone: the light, Keith's parcel
// and garage (frozen filings), postmaster's parcel and the Waiting Room nested
// in it, and the stool, filed by identity at keith/ since 09-10. The fold is
// the world's own `tools/marks-fold.mjs`, run on canon and on the sketchbook
// the write-down made.

const { fileFramer } = await import("../src/world-drain.mjs");
const { storeWriteDown } = await import("../src/store-writedown.mjs");
const { renderedMark } = await import("../world2/tools/mark-render.mjs");

const FILES = [
  "WORLD/marks/let-there-be-light/mark.md",
  "WORLD/marks/let-there-be-light/the-shard-house-by-the-basement-door-parcel/mark.md",
  "WORLD/marks/let-there-be-light/the-shard-house-by-the-basement-door-parcel/the-garage/mark.md",
  "WORLD/marks/postmaster/the-waiting-room-parcel/mark.md",
  "WORLD/marks/postmaster/the-waiting-room-parcel/the-waiting-room/mark.md",
  STOOL_FILE,
];
const FROZEN = {
  "the-town/let-there-be-light": "WORLD/marks/let-there-be-light",
  "keith/the-shard-house-by-the-basement-door-parcel": "WORLD/marks/let-there-be-light/the-shard-house-by-the-basement-door-parcel",
  "keith/the-garage": "WORLD/marks/let-there-be-light/the-shard-house-by-the-basement-door-parcel/the-garage",
  "postmaster/the-waiting-room-parcel": "WORLD/marks/postmaster/the-waiting-room-parcel",
  "postmaster/the-waiting-room": "WORLD/marks/postmaster/the-waiting-room-parcel/the-waiting-room",
};
const WHY_NO_WORLD = WORLD ? false : "no world checkout found (set POSTMARK_WORLD_CLONE) — C needs the real fold";
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

function worldOfTheQuestion() {
  const dir = mkdtempSync(join(tmpdir(), "pos451-print-"));
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const show = (p) => execFileSync("git", ["-C", WORLD, "show", `HEAD:${p}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  cpSync(join(WORLD, "tools"), join(dir, "tools"), { recursive: true });
  put(dir, "package.json", JSON.stringify({ name: "world-fixture", type: "module" }));
  put(dir, "WORLD/skeleton.json", json({ features: [], physics_registry: {} }));
  put(dir, "WORLD/households.json", json({ households: { keith: "hh:shard-house", postmaster: "hh:starforge" } }));
  put(dir, "WORLD/filing-freeze.json", json({ frozen_at: "2026-08-25", marks: FROZEN }));
  for (const p of FILES) put(dir, p, show(p));
  g("init", "-q", "-b", "main");
  execFileSync(process.execPath, [join(dir, "tools", "marks-fold.mjs")], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  g("add", "-A");
  g("-c", "user.name=fixture", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "canon: the stool in the garage");
  return { dir, g };
}

/** The world's own fold at a ref: id → { at, placementParent, tier }. */
function foldAt({ g }, ref) {
  const tmp = mkdtempSync(join(tmpdir(), "pos451-fold-"));
  try {
    cpSync(join(WORLD, "tools"), join(tmp, "tools"), { recursive: true });
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "world-fixture", type: "module" }));
    for (const p of g("ls-tree", "-r", "--name-only", ref, "--", "WORLD").trim().split("\n").filter(Boolean))
      put(tmp, p, g("show", `${ref}:${p}`));
    execFileSync(process.execPath, [join(tmp, "tools", "marks-fold.mjs")], { cwd: tmp, stdio: ["ignore", "pipe", "pipe"] });
    const state = JSON.parse(readFileSync(join(tmp, "WORLD", "world-state.json"), "utf8"));
    return new Map(state.marks.map((m) => [m.id, { at: m.at, placementParent: m.placementParent ?? null, tier: m.tier ?? null }]));
  } finally { sweep(tmp); }
}

test("C · THE PRINTOUT: the write-down prints the store's row, and the world's own fold places the stool in the Waiting Room — the file keeps its path, only the place changes", { skip: noStore || WHY_NO_WORLD }, async (t) => {
  assert.ok(carried.storeRow, "B ran first and left the store's row");
  const w = worldOfTheQuestion();
  t.after(() => sweep(w.dir));

  const before = foldAt(w, "main");
  assert.deepEqual(before.get(STOOL)?.at, GARAGE_AT, "the control: canon before the crossing has the stool in the garage");
  assert.equal(before.get(STOOL)?.placementParent, "keith/the-garage");

  const row = carried.storeRow;
  const entry = { slug: row.slug, kind: row.kind, by: row.owner, household: row.household, locked_window: row.locked_window,
    status: row.status, founder_commit: null, ...renderedMark(row) };
  const report = storeWriteDown({
    repo: w.dir, at: Date.parse("2026-10-11T18:00:00.000Z"), toFileFrame: await fileFramer(w.dir),
    input: { marks: [entry], stakes: [],
      as_of: { window: WIN, world_sha: "0".repeat(40), town_sha: TOWN_SHA },
      selection: { by: "docket", window: WIN, docket_claims: 1, carried_absent: { checked: true, count: 0 } } },
  });
  assert.equal(report.households.length, 1, JSON.stringify(report));
  const branch = report.households[0].branch;
  const files = w.g("diff", "--name-only", "main", branch).trim().split("\n").filter(Boolean);
  assert.deepEqual(files, [STOOL_FILE], "one file changes, at the stool's own path (a directory is its historical filing)");
  const printed = w.g("show", `${branch}:${STOOL_FILE}`);
  assert.match(printed, /^at: \{ x: 176, y: 425\.5 \}$/m, printed);
  assert.match(printed, /^class: thing$/m, "every line Keith wrote rides the amend");
  assert.ok(printed.includes(STOOL_BODY), "and the body is his, unchanged");

  const after = foldAt(w, branch);
  assert.deepEqual(after.get(STOOL)?.at, WAITING_ROOM_AT, "the world's fold places the stool where the store does");
  assert.equal(after.get(STOOL)?.placementParent, "postmaster/the-waiting-room", "inside the Waiting Room, by the fold's own containment");
  console.log(`    FOLD · ${STOOL} at ${JSON.stringify(after.get(STOOL).at)}, parent ${after.get(STOOL).placementParent}`);
  carried.folded = after.get(STOOL);
});

// ═════════════════════════════════════════════════════════════════════════════
// D · THE INVENTORY
// ═════════════════════════════════════════════════════════════════════════════
//
// The Waiting Room's ground list is `groundWithinReach` (world-apex.mjs), which
// composes `whereThingStands` for the place, `standsWithin` for the reach and
// `groundRow` for the row. Driven over the drop A wrote and the fold C made.

test("D · THE INVENTORY: over the drop and the fold, the stool's place is one point — the fold's — and a resident standing in the Waiting Room is shown it", { skip: noStore || WHY_NO_WORLD }, async () => {
  assert.ok(carried.folded, "C ran first and left the fold");
  const { standsWithin } = await import("../src/reach.mjs");
  const attachments = [{ target: STOOL, entity: "keith", policy: "detach", born_at: String(carried.drop.at) }];
  const journal = [{ object: STOOL, action: "drop", actor: "keith", seq: carried.drop.id,
    at: { anchor: null, dx: WAITING_ROOM_AT.x, dy: WAITING_ROOM_AT.y } }];
  const s = await hold.whereThingStands(STOOL, { attachments, journal, fold: carried.folded.at, householdOf: HOUSES });
  assert.deepEqual(s.where, carried.folded.at, "the inventory's place is the World's place");

  const room = { at: WAITING_ROOM_AT, extent: { w: 12, h: 12 } };
  const within = (p, m) => Math.abs(p.x - m.at.x) <= m.extent.w / 2 && Math.abs(p.y - m.at.y) <= m.extent.h / 2;
  const visitor = { x: WAITING_ROOM_AT.x + 3, y: WAITING_ROOM_AT.y - 2 };
  const reach = standsWithin(visitor, { id: STOOL, at: s.where, extent: { w: 1, h: 1 } }, { pointWithinMark: within });
  const row = hold.groundRow({ id: STOOL, made_by: "keith", body: STOOL_BODY, stands: s, reach });
  assert.deepEqual(row.stands_at, carried.folded.at, "the ground row lists it at the fold's point");
  assert.ok(within(row.stands_at, room), "inside the Waiting Room");
  assert.equal(row.holder, undefined, "nobody holds it");
});
