// pending-claim-moves-with-it.test.mjs — A CLAIM PUT FORWARD MOVES WITH ITS THING (POS-990/a; the
// rest of postmark#3663, kogane's staked case).
//
//   node --test test/pending-claim-moves-with-it.test.mjs
//
// THE RULING (Darko, 2026-11-13 09:11 EST, in the picker): "Moves with it". A
// claim set down somewhere else before its settlement is re-filed at the new
// spot with its stamps, and judged there. The receipt says so, including that
// the new spot can refuse it.
//
// THE CHAIN, as the code runs it (no second policy, no new store):
//   the drop (world-hold.mjs § holdAct) writes the holding act, then, for a
//   thing its own household put forward and canon does not yet hold,
//   `refileSetDownClaim` → `fileAuthorsAmend` files the claim's own record as a
//   put-forward amend at the set-down place (world.mjs § journalLeaveMark,
//   `refiling`); the claims pen retracts the claim at the old place as
//   `replaced` (POS-241 ruling 1); the escrow stays behind the mark; and the
//   clearing judges the new claim on the new ground (step 5.5), where it locks
//   or is refused. The printout (hold-through.mjs) never had a standing row to
//   move, and still prints nothing.
//
// THE RIG for the end-to-end half is kind-door-carried-holder's: a throwaway
// world (positions from its own where-is seam), a real Postgres with the whole
// schema, the real hold door and leave door with prod's pen flags, and the real
// `clearing-job.mjs` run as `clearing_job`. Two invented grounds with OPPOSITE
// verdicts: a parcel (home: a ✦0 claim locks) and the commons (a claim locks
// only with escrow behind it).
//
// THE FLIPS (each run, then restored):
//   the drop's `refileSetDownClaim` call taken out → E1 and E2 red: the claim
//     locks where it was put forward (a moved picture, the old ground judged)
//   `refiling` dropped from journalLeaveMark's verdict → E2 red: the re-file is
//     the author's draft and the claim at the old place locks there

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { markRecord } from "../src/mark-record.mjs";

// The office's modules are imported AFTER the rig below names its world (WORLD_CLONE is read at import),
// and no test runs before they are
let refileSetDownClaim, setDownNote, putForwardVerdict, amendmentPublishNote;
let imported;
const ready = new Promise((resolve) => { imported = resolve; });
before(() => ready);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JOB = join(ROOT, "world2", "tools", "clearing-job.mjs");

// ── THE PURE HALF: what the drop files, and what its receipt says ───────────

const LANTERN = "sbx-cy/a-lantern";
const STOOD = { x: 1010, y: 10 };
const PENDING = { id: LANTERN, by: "sbx-cy", slug: "a-lantern", kind: "sited", at: { x: 500, y: 10 }, extent: { w: 1, h: 1 },
  body: "A lantern for the path.", household: "hh:sbx-cy", stamps: 1, put_forward: true, claim_id: "c-1", claim_status: "pending", seq: 7 };
const KEY = { household: "sbx-cy", handles: new Set(["sbx-cy"]) };

function leaveSpy(answer = { id: LANTERN, seq: 42, put_forward: true, publishing: { note: "it is re-filed here, …" } }) {
  const calls = [];
  return { calls, leave: async (payload, key, opts) => { calls.push({ payload, key, opts }); return answer; } };
}

test("U1 · A PENDING CLAIM SET DOWN ELSEWHERE is re-filed there: its own record, at the set-down place, amend: true, and NO stamps asked again", async () => {
  const spy = leaveSpy();
  const out = await refileSetDownClaim({ thing: LANTERN, stood: STOOD, key: KEY, actor: "sbx-cy", actId: 901, writtenAt: "2026-11-21T20:00:00Z" },
    { mark: null, canonMarks: 12, liveClaim: PENDING, leave: spy.leave });
  assert.equal(spy.calls.length, 1, "one amend");
  const { payload, opts } = spy.calls[0];
  assert.deepEqual(payload, { by: "sbx-cy", slug: "a-lantern", amend: true, at: STOOD, kind: "sited", extent: { w: 1, h: 1 }, body: "A lantern for the path." },
    "the claim's own lines, the set-down place, and nothing that stakes: no stamps, no put_forward word from the caller");
  assert.deepEqual(opts.setDown, { act_id: "901", by: "sbx-cy", at: STOOD, written_at: "2026-11-21T20:00:00Z", moves_claim: "c-1" },
    "the drop act and the claim it moves ride the declaration (only the hold door passes setDown)");
  assert.deepEqual([out.filed, out.put_forward, out.moved_claim, out.stake], [true, true, "c-1", 1]);
  assert.match(out.note, /^it is re-filed here/);
});

test("U2 · CONTROLS: a private draft, no claim, a published mark and an unread canon file nothing through this path, and say so", async () => {
  const spy = leaveSpy();
  const base = { thing: LANTERN, stood: STOOD, key: KEY, actor: "sbx-cy", actId: 901 };
  // a private draft is not the docket's: the drop is as before (office#540's half, not this one)
  assert.equal(await refileSetDownClaim(base, { mark: null, canonMarks: 12, liveClaim: { ...PENDING, claim_status: "draft", put_forward: undefined }, leave: spy.leave }), null);
  // no live claim of the dropper's house
  assert.equal(await refileSetDownClaim(base, { mark: null, canonMarks: 12, liveClaim: null, leave: spy.leave }), null);
  // canon could not be read: a published mark's pending amend would look the same, so nothing is re-filed
  const unread = await refileSetDownClaim(base, { mark: null, canonMarks: 0, liveClaim: PENDING, leave: spy.leave });
  assert.deepEqual([unread.filed, unread.put_forward_unpublished], [false, true]);
  assert.match(unread.why, /canon could not be read here.*nothing was re-filed, and the settlement judges it where it was put forward/);
  assert.equal(spy.calls.length, 0, "the leave door was never called");
  // the leave door refuses: the receipt says the claim is judged where it was
  const refused = await refileSetDownClaim(base, { mark: null, canonMarks: 12, liveClaim: PENDING, leave: async () => ({ error: true, defect: "the walk ledger is unreadable" }) });
  assert.deepEqual([refused.filed, refused.why], [false, "the amend door answered: the walk ledger is unreadable"]);
});

test("U3 · THE VERDICT: a re-filed claim stays put forward whatever the escrow behind it, and the sentence says where it is judged", () => {
  // the old rule, still the rule for every other amend: ✦0 behind a mark on the commons is the author's draft
  assert.equal(putForwardVerdict({ amending: true, escrowBehind: 0, groundMin: 1 }).put_forward, false);
  const moved = putForwardVerdict({ amending: true, escrowBehind: 0, groundMin: 1, refiling: true });
  assert.deepEqual([moved.put_forward, moved.carried_by, moved.staked, moved.escrow_after], [true, "set-down", 0, 0], "nothing staked, nothing added");
  assert.equal(amendmentPublishNote(moved),
    "it is re-filed here, in place of the claim put forward where it stood, with no stamps in escrow behind it, and the next settlement judges it on this ground, which can refuse it: off your household's own ground, a mark stands only with a stamp behind it.");
  const backed = putForwardVerdict({ amending: true, escrowBehind: 1, groundMin: 1, refiling: true });
  assert.deepEqual([backed.put_forward, backed.carried_by], [true, "standing-escrow"]);
  assert.equal(amendmentPublishNote(backed),
    "it is re-filed here, in place of the claim put forward where it stood, with the ✦1 in escrow behind it, and the next settlement judges it on this ground, which can refuse it.");
  // refiling means nothing outside an amend
  assert.equal(putForwardVerdict({ amending: false, refiling: true, groundMin: 1 }).put_forward, false);
});

test("U4 · THE DROP RECEIPT names the claim's fate: moved and judged here, or left where it was put forward and why", () => {
  const lead = "it stands where you stood when you set it down, and the act carries that place";
  assert.equal(setDownNote({ whose: "your house's", claim: { filed: true, moved_claim: "c-1", note: "it is re-filed here, X." } }),
    `${lead}. Your claim on it moves with it: it is re-filed here, X.`);
  assert.equal(setDownNote({ whose: "your house's", claim: { filed: false, why: "the amend door answered: no" } }),
    `${lead}. Your claim on it was put forward where it stood before and could not be re-filed here (the amend door answered: no), so the next settlement judges it there.`);
  // a published thing's drop is unchanged
  assert.equal(setDownNote({ whose: "your house's" }), `${lead}; the settlement prints it here at the next crossing.`);
});

// ── THE END-TO-END HALF: the real doors, the real store, the real clearing ──

const WORLD = worldClone();
const store = await startStore({ db: "pending_claim_moves" });
const skip = store.skip ?? ((!WORLD && NO_WORLD) || false);
const WIN = 300;
const TOWN_SHA = "t".repeat(40), LAW_SHA = "l".repeat(40);
const repo = mkdtempSync(join(tmpdir(), "pos990-world-"));
const NO_TOWN = mkdtempSync(join(tmpdir(), "pos990-no-town-"));
const put = (p, content) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); };
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "WORLD2_CANDLE", "W2_PEN", "W2_GUARDS", "WORLD_CLONE", "WORLD_SINGLE_LOG", "WORLD_POOL", "TOWN_CLONE"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
// THE TWO GROUNDS, each resident's own parcel 25×25 at their HOME, and where each stands now:
//   cy stands on her own parcel (home ground: free, and a ✦0 claim locks there)
//   dee stands on the commons, 1 km from her parcel (a claim locks there only with escrow behind it)
const CY_PARCEL = { x: 1010, y: 10 }, DEE_PARCEL = { x: 2000, y: 10 };
const STANDS = { "sbx-cy": { x: 1010, y: 10 }, "sbx-dee": { x: 3000, y: 10 } };
const CY_THING = "sbx-cy/a-lantern", DEE_THING = "sbx-dee/a-bell";
// A SETTLED THING, the control: published in canon and standing in the store, beside cy's parcel on the commons
const STOOL = "sbx-cy/a-stool", STOOL_AT = { x: 1040, y: 10 };
const CY_FROM = { x: 500, y: 10 };      // the commons: cy's claim was put forward with ✦1 behind it
const DEE_FROM = { x: 2001, y: 11 };    // dee's own parcel: her claim was put forward at ✦0, home ground
const parcelId = (h) => `${h}/home`;
const ids = { cyParcel: "c0000000-0000-4000-8000-000000000001", deeParcel: "c0000000-0000-4000-8000-000000000002",
  cyClaim: "c0000000-0000-4000-8000-000000000011", deeClaim: "c0000000-0000-4000-8000-000000000012", stool: "c0000000-0000-4000-8000-000000000021" };
const box = (at, ext) => `((${at.x - ext.w / 2},${at.y - ext.h / 2}),(${at.x + ext.w / 2},${at.y + ext.h / 2}))`;
const P = { w: 25, h: 25 }, T = { w: 1, h: 1 };

let pool, callHoldTool, writeThingHolding, appendActFlipped, currentCrossing;
if (!skip) {
  mkdirSync(join(repo, "tools"), { recursive: true });
  for (const f of readdirSync(join(WORLD, "tools")).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")))
    copyFileSync(join(WORLD, "tools", f), join(repo, "tools", f));
  put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export const QUAY_MARK_ID = "the-town/the-quay";
const STANDS = ${JSON.stringify(STANDS)};
export function homeOf(handle) { const h = STANDS[handle]; return h ? { ...h, mark_id: handle + "/home", placed: true, source: "home", parcel: null } : NOWHERE; }
export function whereIs(handle) { const h = homeOf(handle); return h.placed ? { ...h, position: null } : NOWHERE; }
export function publicResidents() { return []; }
export function porchOf() { return null; }
export function householdOf() { return null; }
export function parcelsFor() { return []; }
export function parcelFor() { return null; }
export function sourceLabel() { return "home"; }
`);
  const root = { id: "the-town/let-there-be-light", by: "the-town", slug: "let-there-be-light", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10000, h: 10000 } };
  const parcels = [["sbx-cy", CY_PARCEL], ["sbx-dee", DEE_PARCEL]].map(([h, at]) => ({ id: parcelId(h), by: h, slug: "home", kind: "parcel", at, extent: P }));
  put("WORLD/marks/let-there-be-light/mark.md", markRecord(root, "Synthetic world frame."));
  for (const p of parcels) put(`WORLD/marks/${p.id}/mark.md`, markRecord(p, `${p.by}'s home ground.`));
  const stool = { id: STOOL, by: "sbx-cy", slug: "a-stool", kind: "sited", at: STOOL_AT, extent: T };
  put(`WORLD/marks/${STOOL}/mark.md`, markRecord(stool, "A stool."));
  // canon holds the frame, the two parcels and the stool, and NEITHER claimed thing: both are put forward, not yet published
  put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: [root, ...parcels, stool] }));
  copyFileSync(join(WORLD, "WORLD", "skeleton.json"), join(repo, "WORLD", "skeleton.json"));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "add", "-A", "WORLD", "tools"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qm", "synthetic canon"]);
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: store.url("office_api") });
  // prod's flags: the single log (the mark lane's journal pass, the one that rules put_forward) and both pens on Postgres
  Object.assign(process.env, { WORLD_CLONE: repo, WORLD_SINGLE_LOG: "1", WORLD_POOL: "0", WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"),
    WORLD2_CANDLE: "1", W2_PEN: "hold,mark", W2_GUARDS: "1", TOWN_CLONE: NO_TOWN });
  (await import("../src/world2-pen.mjs")).__setPoolForTest(pool);
  (await import("../src/world2-claims.mjs")).__setPoolForTest(pool);
  ({ callHoldTool } = await import("../src/world-hold.mjs"));
  ({ writeThingHolding } = await import("../src/world-units.mjs"));
  ({ appendActFlipped } = await import("../src/world-journal.mjs"));
  ({ currentCrossing } = await import("../src/crossings.mjs"));
}
({ refileSetDownClaim, setDownNote } = await import("../src/world-hold.mjs"));
({ putForwardVerdict, amendmentPublishNote } = await import("../src/world.mjs"));
imported();
after(async () => {
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  if (!skip) {
    (await import("../src/world2-pen.mjs")).__setPoolForTest(null);
    (await import("../src/world2-claims.mjs")).__setPoolForTest(null);
  }
  if (pool) await pool.end();
  await store.stop();
  rmSync(repo, { recursive: true, force: true });
  rmSync(NO_TOWN, { recursive: true, force: true });
});

const owner = async (fn) => { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } };
const read = (sql, args = []) => owner(async (c) => (await c.query(sql, args)).rows);

async function seed() {
  await owner(async (c) => {
    await c.query("TRUNCATE acts, stamp_projection, escrow_projection, claims, marks, windows, settlements, projection_heads, households, household_pins CASCADE");
    // the candle tiles time: the open window opened where the one before it closed, and now is inside it
    const opened = Date.now() - 6 * 3600e3;
    for (const id of [WIN - 1, WIN]) {
      const open = id === WIN;
      const opens = new Date(opened - (open ? 0 : 12 * 3600e3)).toISOString();
      await c.query(
        `INSERT INTO windows (id, opens_at, closes_at, status, cleared_at, receipts)
         VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4, $5)`,
        // the window before has printed (POS-688's cutoff), so the printout is live for every drop here
        [id, opens, open ? "open" : "closed", open ? null : new Date(opened).toISOString(), open ? null : JSON.stringify({ hold_through: 0 })]);
    }
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now())", [LAW_SHA, TOWN_SHA]);
    await c.query(`INSERT INTO households (slug, ord, name, residents, since, declared_by)
                   VALUES ('sbx-cy', 0, 'Cy', ARRAY['sbx-cy'], '2026-08-01', 'sbx-cy'), ('sbx-dee', 1, 'Dee', ARRAY['sbx-dee'], '2026-08-01', 'sbx-dee')`);
    await c.query(`INSERT INTO household_pins (handle, login, gh_id, pinned)
                   VALUES ('sbx-cy', 'sbx-cy', 401, '2026-08-01'), ('sbx-dee', 'sbx-dee', 402, '2026-08-01')`);
    // the two parcels stand in the store as they do in canon (a mark's id is the claim that locked it)
    for (const [h, slug, kind, at, ext, id, body] of [["sbx-cy", parcelId("sbx-cy"), "parcel", CY_PARCEL, P, ids.cyParcel, "sbx-cy's home ground."],
      ["sbx-dee", parcelId("sbx-dee"), "parcel", DEE_PARCEL, P, ids.deeParcel, "sbx-dee's home ground."], ["sbx-cy", STOOL, "sited", STOOL_AT, T, ids.stool, "A stool."]]) {
      const geometry = JSON.stringify({ slug, at, extent: ext });
      await c.query(
        `INSERT INTO claims (id, window_id, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, slug)
         VALUES ($1, $2, $3, $4, $5, 'locked', now(), $6, $7, $8::box, 0, '{}', $9)`,
        [id, WIN - 1, kind, h, `hh:${h}`, body, geometry, box(at, ext), slug]);
      await c.query(
        `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::box, 'standing', $9, '{"tier":"home"}')`,
        [id, slug, kind, h, `hh:${h}`, body, geometry, box(at, ext), WIN - 1]);
    }
    // THE TWO CLAIMS PUT FORWARD in this window, each with its leave act: cy's at ✦1 on the commons (and ✦1 in
    // escrow behind it at the town's sha), dee's at ✦0 on her own parcel
    for (const [h, thing, at, stake, id] of [["sbx-cy", CY_THING, CY_FROM, 1, ids.cyClaim], ["sbx-dee", DEE_THING, DEE_FROM, 0, ids.deeClaim]]) {
      const slug = thing.split("/")[1];
      const { rows: [act] } = await c.query(
        `INSERT INTO acts (at, crossing, actor, action, object, class, payload) VALUES (now(), $1, $2, 'leave', $3, 'mark', $4) RETURNING id`,
        [WIN, h, thing, JSON.stringify({ slug, by: h, kind: "sited", at, extent: T, body: `${h}'s thing.`, stamps: stake, put_forward: true })]);
      await c.query(
        `INSERT INTO claims (id, window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
         VALUES ($1, $2, 'sited', $3, $4, 'pending', $5, $6, $7::box, $8, $9, $10)`,
        [id, WIN, h, `hh:${h}`, `${h}'s thing.`, JSON.stringify({ slug: thing, at, extent: T }), box(at, T), stake,
          JSON.stringify({ by: h, kind: "sited", _act_id: String(act.id) }), thing]);
    }
    await c.query("INSERT INTO stamp_projection (town_sha, handle, household, balance) VALUES ($1, 'sbx-cy', 'hh:sbx-cy', 4), ($1, 'sbx-dee', 'hh:sbx-dee', 4)", [TOWN_SHA]);
    await c.query(`INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k)
                   VALUES ($1, $2, 'sbx-cy', 'hh:sbx-cy', 'hh:sbx-cy', 1, 1)`, [TOWN_SHA, CY_THING]);
  });
}

// THE REAL HOLD ACT for picking a thing up, by the hold lane's own writer (world-units § writeThingHolding)
const carry = (thing, who) => writeThingHolding({
  stamp: async () => ({ at: { anchor: null, dx: null, dy: null, unplaced: true }, witnesses: { source: "presence", list: [] } }),
  crossing: () => currentCrossing(), household: () => who,
  append: (e, opts = {}) => appendActFlipped(null, { ...e, writtenAt: new Date().toISOString() }, opts),
}, { household: who, handles: new Set([who]) }, who, [], { did: "take", thing, holder: who, previous: null, madeBy: thing.split("/")[0] });

function clear() {
  const r = spawnSync(process.execPath, [JOB, "--window", String(WIN)], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}
const claimsOf = (slug) => read("SELECT id::text, status, refusal_check, geometry, stake, data FROM claims WHERE slug = $1 ORDER BY submitted_at, id", [slug]);
const standing = (slug) => read("SELECT geometry FROM marks WHERE slug = $1 AND status = 'standing'", [slug]);
const escrow = () => read("SELECT mark, holder, n FROM escrow_projection ORDER BY mark");

test("E0 · THE OLD GROUND'S OWN VERDICTS, with nothing moved: each claim is judged where it was put forward, and both lock there", { skip }, async () => {
  await seed();
  const r = clear();
  assert.equal(r.code, 0, r.out);
  assert.deepEqual((await claimsOf(CY_THING)).map((c) => c.status), ["locked"], "cy's ✦1 on the commons, backed by its escrow");
  assert.deepEqual((await claimsOf(DEE_THING)).map((c) => c.status), ["locked"], "dee's ✦0 on her own parcel: home ground");
  assert.deepEqual((await standing(CY_THING)).map((m) => m.geometry.at), [CY_FROM]);
  assert.deepEqual((await standing(DEE_THING)).map((m) => m.geometry.at), [DEE_FROM]);
});

test("E1 · MOVES WITH IT: cy's claim, put forward with ✦1 on the commons, set down on her own parcel, is re-filed there with its stamps and locks there, once", { skip }, async () => {
  await seed();
  await carry(CY_THING, "sbx-cy");
  const out = await callHoldTool("world_hold", { thing: CY_THING }, { household: "sbx-cy", handles: new Set(["sbx-cy"]) }, { verb: "drop" });
  assert.equal(out.did, "drop", JSON.stringify(out));
  assert.equal(out.set_down.claim?.filed, true, JSON.stringify(out.set_down));
  assert.equal(out.set_down.claim.moved_claim, ids.cyClaim);
  assert.match(out.stands_note, /Your claim on it moves with it: it is re-filed here, in place of the claim put forward where it stood, .*and the next settlement judges it on this ground, which can refuse it/);
  // ON THE DOCKET: the claim at the old place replaced, one pending claim at the set-down place, nothing staked again
  const filed = await claimsOf(CY_THING);
  assert.deepEqual(filed.map((c) => [c.status, c.geometry.at]), [["retracted", CY_FROM], ["pending", STANDS["sbx-cy"]]]);
  assert.match(filed[0].refusal_check, /^replaced:/);
  assert.equal(filed[1].data._set_down.moves_claim, ids.cyClaim, "the re-file names the claim it moves");
  assert.equal(filed[1].data._set_down.act_id, String(out.seq), "and the drop that moved it");
  assert.deepEqual(await escrow(), [{ mark: CY_THING, holder: "sbx-cy", n: 1 }], "the stamps stay where they were: behind the mark, once");
  // THE SETTLEMENT judges it at the set-down place, and it stands there
  const r = clear();
  assert.equal(r.code, 0, r.out);
  const decided = await claimsOf(CY_THING);
  assert.deepEqual(decided.map((c) => c.status), ["retracted", "locked"], "one claim judged, the re-filed one");
  assert.deepEqual((await standing(CY_THING)).map((m) => m.geometry.at), [STANDS["sbx-cy"]], "it stands where it was set down, and only there");
  const [win] = await read("SELECT receipts FROM windows WHERE id = $1", [WIN]);
  assert.ok(!(win.receipts.hold_printed ?? []).some((p) => p.slug === CY_THING), "no printout moves it a second time");
  assert.deepEqual(await escrow(), [{ mark: CY_THING, holder: "sbx-cy", n: 1 }], "no stamp moved, returned or minted");
});

test("E2 · THE NEW SPOT CAN REFUSE IT: dee's claim, put forward at ✦0 on her own parcel, set down on the commons, is judged there and refused there, not locked at home", { skip }, async () => {
  await seed();
  await carry(DEE_THING, "sbx-dee");
  // the commons asks the drop's own ✦1 (POS-688 D4 step 3), a separate term: accepted, and with no ledger in this rig it bounces
  const out = await callHoldTool("world_hold", { thing: DEE_THING, accept: true }, { household: "sbx-dee", handles: new Set(["sbx-dee"]) }, { verb: "drop" });
  assert.equal(out.did, "drop", JSON.stringify(out));
  assert.ok(out.stake_bounce, "the drop's ✦1 did not land here");
  assert.equal(out.set_down.claim?.filed, true, JSON.stringify(out.set_down));
  assert.match(out.stands_note, /with no stamps in escrow behind it, and the next settlement judges it on this ground, which can refuse it: off your household's own ground, a mark stands only with a stamp behind it\.$/);
  const filed = await claimsOf(DEE_THING);
  assert.deepEqual(filed.map((c) => [c.status, c.geometry.at]), [["retracted", DEE_FROM], ["pending", STANDS["sbx-dee"]]],
    "put forward at the set-down place, not left as a private draft beside the claim at home");
  const r = clear();
  assert.equal(r.code, 0, r.out);
  const decided = await claimsOf(DEE_THING);
  assert.deepEqual(decided.map((c) => c.status), ["retracted", "refused"], "judged once, at the set-down place");
  assert.match(decided[1].refusal_check, /escrow/, "refused by the commons' own rule, on the new ground");
  assert.deepEqual(await standing(DEE_THING), [], "and it does not lock at home, where it was put forward");
});

test("E3 · CONTROLS: a published thing's drop files no claim (the printout's), and another household's pending claim is never re-filed by a stranger", { skip }, async () => {
  await seed();
  // dee holds cy's pending claim's thing and sets it down: not her house's claim, so nothing is re-filed
  await carry(CY_THING, "sbx-dee");
  const out = await callHoldTool("world_hold", { thing: CY_THING, accept: true }, { household: "sbx-dee", handles: new Set(["sbx-dee"]) }, { verb: "drop" });
  assert.equal(out.did, "drop", JSON.stringify(out));
  assert.equal(out.set_down.claim, undefined, "a stranger's set-down moves no claim");
  assert.deepEqual((await claimsOf(CY_THING)).map((c) => [c.status, c.geometry.at]), [["pending", CY_FROM]], "cy's claim is untouched");
  // cy sets down her PUBLISHED stool: no claim is filed at the door, and the settlement's printout places it (POS-688), as before
  await carry(STOOL, "sbx-cy");
  const settled = await callHoldTool("world_hold", { thing: STOOL }, { household: "sbx-cy", handles: new Set(["sbx-cy"]) }, { verb: "drop" });
  assert.equal(settled.did, "drop", JSON.stringify(settled));
  assert.equal(settled.set_down.claim, undefined, "a published thing has no claim to move");
  assert.equal(settled.stands_note, "it stands where you stood when you set it down, and the act carries that place; the settlement prints it here at the next crossing.");
  assert.deepEqual((await claimsOf(STOOL)).map((c) => c.status), ["locked"], "nothing filed at the door");
  const r = clear();
  assert.equal(r.code, 0, r.out);
  const [win] = await read("SELECT receipts FROM windows WHERE id = $1", [WIN]);
  assert.ok((win.receipts.hold_printed ?? []).some((p) => p.slug === STOOL), `the printout places it: ${JSON.stringify(win.receipts)}`);
  assert.deepEqual((await standing(STOOL)).map((m) => m.geometry.at), [STANDS["sbx-cy"]]);
});
