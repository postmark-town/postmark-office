// pos-1179-spire-forward-reconcile.test.mjs — POS-1179: the Spire's store row AND its WLD-253 re-kind door claim carry no `rooms`, by the
// clearing's own pen, with every later legitimate change kept and the file losing exactly one line.
//
// THE CASE (WLD-260): WLD-135 (5aacbe95) deleted the Spire's 22 `rooms` from its file; WLD-253's re-kind built the Spire's door claim from the
// store's older body, which still held them; the 18:00Z sweep of 2026-11-27 wrote them back. world2/tools/spire-forward-reconcile.mjs is the
// minimal correction (its header says why this and not an amend): `clearing_job`, the one pen `claims_update_guard` admits, removes `rooms`
// from the named claim's data and from the row's data in ONE transaction. Nothing else is written (not the row's `locked_window`): the
// settlement prints from the SEAL (settlement-printout.mjs), and the corrected row's sealed version differs, so the printout carries it.
//
//   THE PEN        a resident door / the owner role cannot edit that claim (the guard refuses them), and the tool refuses to run as them
//   THE DRY RUN    BEGIN READ ONLY: nothing is written, the digest is stable, the file diff is the one `rooms:` line
//   THE APPLY      both inputs clean; kind door, into, lands_at, image, date, tier, body, geometry (the 22 `points`), the claim's window and
//                  supersedes, the origin claim (history), the claim chain and every other row unchanged; the marker names what was removed
//   THE FILE       the write-down's renderer prints the row before and after: the ONLY difference is the `rooms:` line (no date restamp,
//                  no claimed_at, no footprints, the ring kept)
//   THE CROSSING   the settlement's own path: the next seal writes the corrected row as a NEW sealed version beside the old one (every earlier
//                  version, header and list exactly as they were); the printout's list delta (`deltaOf`) names the Spire as the one changed
//                  mark; its entry, rendered from the sealed version as `entriesOf` renders it and planned by `planStoreWriteDown`, differs
//                  from today's file by exactly the `rooms:` line
//   THE REFUSALS   drift (any other rooms, a later claim, an unstamped claim, row ≠ claim, another kind, no ring, a wrong digest, a moved
//                  store, no/clearing window) refuses and writes nothing; a failed second write rolls the first back
//   IDEMPOTENT     a second run writes nothing; a half-finished run finishes
//
// FLIPS (each run, then restored): drop the claims UPDATE → the planner's two-writes test, THE DRY RUN, THE APPLY, IDEMPOTENT and THE CROSSING go
// red; drop the marks UPDATE → the same six go red; skip the head-of-chain check → the planner's drift test goes red.
// (The file-diff guard is defensive: the renderer prints rooms as one line today, so it is asserted on the plan, and lineDiff has its own unit.)
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startStore } from "./helpers/embedded-store.mjs";
import { seedRegistry } from "./helpers/office-under-test.mjs";
import {
  SLUG, OLD_ROOMS, REKIND_WINDOW, REKIND_STAMP, MARKER, PEN, planReconcile, reconcileSpire, lineDiff, roomsDigest,
} from "../world2/tools/spire-forward-reconcile.mjs";
import { renderRecord, MARK_COLUMNS } from "../world2/tools/mark-render.mjs";

const POINTS = [[3725, -5590.5], [3757.5, -5590.5], [3757.5, -5579.5], [3855, -5579.5], [3855, -5600], [3900.5, -5600], [3900.5, -5572], [3961, -5572], [3961, -5435], [3758.5, -5435], [3758.5, -5424], [3725, -5424], [3725, -5460], [3745.5, -5460], [3745.5, -5490.5], [3774, -5490.5], [3774, -5526.5], [3767, -5526.5], [3767, -5534], [3745.5, -5534], [3745.5, -5554.5], [3725, -5554.5]];
const IMAGE = "https://media.postmark.town/media/keeminlee/c5e77cc7c904aa88ea44bd7530463193f5940c0622e2af4fbe2a12d3b6c12889.jpg";
const BODY = "The keep itself: a black mass of towers and buttresses rising out of the mist, every window dark but one high star-shaped gap above its doors.";
const AT = { x: 3843, y: -5512 }, EXTENT = { w: 236, h: 176 };
const BBOX = "(3961,-5424),(3725,-5600)";
const ORIGIN = "00000000-0000-4000-8000-000000001179", REKIND = "00000000-0000-4000-8000-000000337253";
const LATER = "00000000-0000-4000-8000-0000000001a7";
const DATA = { date: "2026-10-18T12:00:00.000Z", image: IMAGE, into: "wright/spire-gilded-vestibule", lands_at: "wright/spire-gilded-doors-inside", rooms: [...OLD_ROOMS], tier: "market" };
const PLACE = { at: AT, extent: EXTENT, points: POINTS };

// ── the pure planner, on in-memory inputs shaped as the tool reads them ─────────────────────────────────────────────────────
const claimRow = (id, window, supersedes, geometry, data, decided = "2026-11-25T18:00:00.000Z") =>
  ({ id, slug: SLUG, status: "locked", window_id: window, supersedes, class: "door", claimant: "wright", data, geometry, decided_at: new Date(decided) });
function inputs(over = {}) {
  const origin = claimRow(ORIGIN, 100, null, PLACE, { ...DATA }, "2026-10-18T12:00:00.000Z");
  const rekind = claimRow(REKIND, REKIND_WINDOW, ORIGIN, { at: AT, extent: EXTENT }, { ...DATA, _ingested_from: `6f05ce68${"0".repeat(32)}` });
  const mark = {
    id: ORIGIN, slug: SLUG, kind: "door", owner: "wright", household: "hh:starforge", body: BODY, geometry: { ...PLACE }, status: "standing",
    locked_window: REKIND_WINDOW, retired_window: null, data: { ...DATA }, first_claimed: DATA.date, first_claim_submitted_at: null,
    claim_chain: [{ id: ORIGIN, geometry: PLACE, decided_at: origin.decided_at.toISOString() }, { id: REKIND, geometry: { at: AT, extent: EXTENT }, decided_at: rekind.decided_at.toISOString() }],
  };
  return { mark: { ...mark, ...(over.mark ?? {}) }, claims: over.claims ?? [origin, rekind], windows: over.windows ?? [{ id: 340, status: "open" }], claimId: REKIND };
}
const refused = (p, re) => assert.ok(p.refusals.some((r) => re.test(r)) && p.steps.length === 0, `${re}: ${JSON.stringify(p.refusals)}`);

test("the planner · the Spire as the re-kind left it plans exactly two writes and a one-line file diff", () => {
  const p = planReconcile(inputs());
  assert.deepEqual(p.refusals, []);
  assert.deepEqual(p.steps.map((s) => [s.table, s.remove]), [["claims", "rooms"], ["marks", "rooms"]], "two removals and no lock window");
  assert.equal(p.diff.gone.length, 1);
  assert.ok(p.diff.gone[0].startsWith("rooms: "));
  assert.deepEqual(p.diff.added, []);
  assert.match(p.digest, /^[0-9a-f]{64}$/);
  assert.equal(p.digest, planReconcile(inputs()).digest, "the digest is a function of the inputs alone");
});

test("the planner · every drift refuses by name and plans nothing", () => {
  const i = inputs();
  refused(planReconcile({ ...i, claimId: null }), /no --claim/);
  refused(planReconcile({ ...i, claimId: LATER }), /not a locked claim on/);
  refused(planReconcile(inputs({ mark: { kind: "sited" } })), /not the door class/);
  refused(planReconcile(inputs({ mark: { owner: "someone" } })), /owner/);
  refused(planReconcile(inputs({ mark: { status: "retired" } })), /not standing/);
  // a later legitimate change to the rooms is not the list this tool was reviewed against (row or claim)
  refused(planReconcile(inputs({ mark: { data: { ...DATA, rooms: OLD_ROOMS.slice(1) } } })), /row's rooms are not the 22/);
  const c = inputs();
  c.claims[1] = { ...c.claims[1], data: { ...c.claims[1].data, rooms: [...OLD_ROOMS, "wright/a-twenty-third"] } };
  refused(planReconcile(c), /claim's rooms are not the 22/);
  // the claim is not the re-kind's
  const u = inputs(); u.claims[1] = { ...u.claims[1], data: { ...DATA } };
  refused(planReconcile(u), /not stamped by WLD-253's re-kind/);
  const w = inputs(); w.claims[1] = { ...w.claims[1], window_id: 336 };
  refused(planReconcile(w), /re-kind window 337/);
  const s = inputs(); s.claims[1] = { ...s.claims[1], supersedes: LATER };
  refused(planReconcile(s), /does not supersede the standing row/);
  // a later locked claim: the named claim is not the head, so there are later legitimate changes
  const l = inputs(); l.claims.push(claimRow(LATER, 338, ORIGIN, PLACE, { ...DATA, rooms: undefined }, "2026-11-26T06:00:00.000Z"));
  refused(planReconcile(l), /not the head of its chain/);
  // the row is not the claim's materialization
  refused(planReconcile(inputs({ mark: { data: { ...DATA, into: "wright/elsewhere" } } })), /disagree beyond rooms and tier \(into\)/);
  // the ring must be on the row
  refused(planReconcile(inputs({ mark: { geometry: { at: AT, extent: EXTENT } } })), /no `points` ring/);
  // the windows
  refused(planReconcile(inputs({ windows: [] })), /0 windows are open/);
  refused(planReconcile(inputs({ windows: [{ id: 340, status: "open" }, { id: 341, status: "open" }] })), /2 windows are open/);
  refused(planReconcile(inputs({ windows: [{ id: 339, status: "clearing" }, { id: 340, status: "open" }] })), /is clearing/);
});

test("the planner · neither input carrying rooms is a no-op; one input clean plans only the other", () => {
  const { rooms: _r, ...clean } = DATA;
  const done = inputs({ mark: { data: { ...clean } } });
  done.claims[1] = { ...done.claims[1], data: { ...clean, _ingested_from: done.claims[1].data._ingested_from } };
  const p = planReconcile(done);
  assert.equal(p.noop, true);
  assert.deepEqual(p.steps, []);
  const half = inputs({ mark: { data: { ...clean } } });   // the row clean, the claim not
  const h = planReconcile(half);
  assert.deepEqual(h.refusals, []);
  assert.deepEqual(h.steps.map((s) => s.table), ["claims"]);
  const other = inputs(); other.claims[1] = { ...other.claims[1], data: { ...clean, _ingested_from: other.claims[1].data._ingested_from } };   // the claim clean, the row not
  const o = planReconcile(other);
  assert.deepEqual(o.refusals, []);
  assert.deepEqual(o.steps.map((s) => s.table), ["marks"]);
});

test("the file guard · lineDiff names what a render would change beyond the one line", () => {
  assert.deepEqual(lineDiff("a\nrooms: x\nb", "a\nb"), { gone: ["rooms: x"], added: [] });
  assert.deepEqual(lineDiff("a\nrooms: x\nb", "a\nb\nfootprints: y"), { gone: ["rooms: x"], added: ["footprints: y"] });
  assert.deepEqual(lineDiff("date: 1\nrooms: x", "date: 2"), { gone: ["date: 1", "rooms: x"], added: ["date: 2"] });
});

// ── the real store ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const store = await startStore({ db: "pos1179_spire" });
const skip = store.skip ?? false;
let owner, pen, office;
after(async () => { for (const c of [owner, pen, office]) await c?.end().catch(() => {}); await store.stop(); });

const REGISTRY = { schema_version: 1, households: { starforge: { name: "Starforge", human: "Wright", accounts: [{ login: "wrightlogin", id: 4242 }], residents: ["wright"], since: "2026-07-01", member_of: null, declared_by: "wright", formerly: [], provisional: false } } };
const PINS = { wright: { login: "wrightlogin", id: 4242, pinned: "2026-07-01" } };

async function seed() {
  owner = await store.connect("world2_owner");
  pen = await store.connect(PEN);
  office = await store.connect("office_api");
  await seedRegistry(store, REGISTRY, PINS);
  // the candle tiles time: each window opens where the one before it closed (335 … 340, twelve hours each)
  for (let id = 335; id <= 340; id++)
    await owner.query("INSERT INTO windows (id, opens_at, closes_at, status) VALUES ($1, '2026-11-20T06:00:00Z'::timestamptz + ($1 - 335) * interval '12 hours', '2026-11-20T06:00:00Z'::timestamptz + ($1 - 334) * interval '12 hours', $2)", [id, id === 340 ? "open" : "closed"]);
  const ins = (id, window, supersedes, geometry, data, decided) => owner.query(
    `INSERT INTO claims (id, window_id, slug, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, supersedes)
     VALUES ($1,$2,$3,'door','wright','hh:starforge','locked',$4,$5,$6,$7,0,$8,$9)`, [id, window, SLUG, decided, BODY, JSON.stringify(geometry), BBOX, JSON.stringify(data), supersedes]);
  await ins(ORIGIN, 335, null, PLACE, { ...DATA }, "2026-10-18T12:00:00Z");
  await owner.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
    VALUES ($1,$2,'door','wright','hh:starforge',$3,$4,$5,'standing',337,$6)`, [ORIGIN, SLUG, BODY, JSON.stringify(PLACE), BBOX, JSON.stringify(DATA)]);
  await ins(REKIND, 337, ORIGIN, { at: AT, extent: EXTENT }, { ...DATA, _ingested_from: `${REKIND_STAMP}${"0".repeat(32)}` }, "2026-11-25T18:00:00Z");
  // a neighbour that is not the Spire, locked at 337, to show the delta selects only what the docket locked
  await owner.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
    VALUES ('00000000-0000-4000-8000-0000000000aa','wright/spire-servants-door','door','wright','hh:starforge','a door','{"at":{"x":3800,"y":-5500},"extent":{"w":2,"h":2}}','(3801,-5499),(3799,-5501)','standing',337,'{"date":"2026-10-18T12:00:00.000Z","tier":"market"}')`);
}
const dump = async () => JSON.stringify({
  claims: (await owner.query("SELECT id, slug, status, window_id, supersedes, class, data, geometry FROM claims ORDER BY id")).rows,
  marks: (await owner.query("SELECT id, slug, kind, owner, body, geometry, data, locked_window, status FROM marks ORDER BY slug")).rows,
});
const rowOf = async () => (await owner.query(`SELECT ${MARK_COLUMNS} FROM marks WHERE slug = $1`, [SLUG])).rows[0];
// the clearing's own seal (world-snapshot-seal.mjs): in the caller's transaction, as it runs at a window's close
const seal = async (windowId) => {
  const { sealSnapshot } = await import("../world2/tools/world-snapshot-seal.mjs");
  await pen.query("BEGIN");
  try { const r = await sealSnapshot((t, a) => pen.query(t, a), { windowId }); await pen.query("COMMIT"); return r; }
  catch (e) { await pen.query("ROLLBACK").catch(() => {}); throw e; }
};
const sealedState = async () => JSON.stringify({
  versions: (await owner.query("SELECT digest, row FROM mark_versions ORDER BY digest")).rows,
  snapshots: (await owner.query("SELECT id, window_id, digest, marks_digest, marks FROM world_snapshots WHERE window_id <= 339 ORDER BY id")).rows,
  lists: (await owner.query("SELECT marks_digest, slug, digest FROM world_snapshot_marks ORDER BY marks_digest, slug")).rows,
});
let sealedBefore = null, oldSpireDigest = null;
const claimOf = async (id) => (await owner.query("SELECT * FROM claims WHERE id = $1", [id])).rows[0];

test("THE PEN · the guard refuses a resident door and the owner role, and the tool refuses to run as them", { skip }, async () => {
  await seed();
  for (const [who, client] of [["world2_owner", owner], ["office_api", office]]) {
    await assert.rejects(client.query("UPDATE claims SET data = data - 'rooms' WHERE id = $1", [REKIND]), /claims: .* may/, `${who}'s edit of a locked claim is refused by claims_update_guard`);
    const r = await reconcileSpire(client, { claimId: REKIND });
    assert.equal(r.status, "refused");
    assert.match(r.receipt, new RegExp(`not \`${PEN}\``), `the tool names the pen it needs (${who})`);
  }
  assert.ok((await claimOf(REKIND)).data.rooms, "the claim is as it was");
});

test("THE DRY RUN · reads inside BEGIN READ ONLY, writes nothing, and prints the one-line file diff and a stable digest", { skip }, async () => {
  const before = await dump();
  const a = await reconcileSpire(pen, { claimId: REKIND });
  const b = await reconcileSpire(pen, { claimId: REKIND });
  assert.equal(a.status, "dry-run", a.receipt);
  assert.deepEqual(a.plan.refusals, []);
  assert.equal(a.plan.digest, b.plan.digest);
  assert.equal(a.plan.window, 340);
  assert.equal(a.plan.diff.gone.length, 1);
  assert.deepEqual(a.plan.diff.added, []);
  assert.match(a.receipt, /will write: claims .* remove rooms/);
  assert.match(a.receipt, /will write: marks .* remove rooms/);
  assert.doesNotMatch(a.receipt, /locked_window \d/, "no lock window is written");
  assert.equal(await dump(), before, "a dry run wrote nothing");
});

test("THE REFUSALS · a wrong or missing digest, and a store that moved since the dry run, refuse and write nothing", { skip }, async () => {
  const before = await dump();
  const dry = await reconcileSpire(pen, { claimId: REKIND });
  const noDigest = await reconcileSpire(pen, { claimId: REKIND, apply: true });
  assert.equal(noDigest.status, "refused");
  assert.match(noDigest.receipt, /needs --expect/);
  const wrong = await reconcileSpire(pen, { claimId: REKIND, apply: true, expect: "0".repeat(64) });
  assert.equal(wrong.status, "refused");
  assert.match(wrong.receipt, /not what the dry run read/);
  // the row moves between the dry run and the apply (a legitimate later change to a kept field): the digest no longer matches
  await owner.query("UPDATE marks SET data = data || '{\"into\":\"wright/elsewhere\"}'::jsonb WHERE slug = $1", [SLUG]);
  try {
    const stale = await reconcileSpire(pen, { claimId: REKIND, apply: true, expect: dry.plan.digest });
    assert.equal(stale.status, "refused");
    assert.match(stale.receipt, /disagree beyond rooms and tier|not what the dry run read/);
  } finally {
    await owner.query("UPDATE marks SET data = data || $2::jsonb WHERE slug = $1", [SLUG, JSON.stringify({ into: "wright/spire-gilded-vestibule" })]);
  }
  assert.equal(await dump(), before, "every refusal wrote nothing (the fixture is as seeded)");
});

test("THE WINDOWS · no open window, and a clearing in flight, refuse", { skip }, async () => {
  const before = await dump();
  const dry = await reconcileSpire(pen, { claimId: REKIND });
  await owner.query("UPDATE windows SET status = 'clearing' WHERE id = 340");
  try {
    const r = await reconcileSpire(pen, { claimId: REKIND, apply: true, expect: dry.plan.digest });
    assert.equal(r.status, "refused");
    assert.match(r.receipt, /is clearing|0 windows are open/);
  } finally { await owner.query("UPDATE windows SET status = 'open' WHERE id = 340"); }
  assert.equal(await dump(), before);
});

test("ATOMIC · a failed second write rolls the first back whole", { skip }, async () => {
  const before = await dump();
  const dry = await reconcileSpire(pen, { claimId: REKIND });
  await owner.query(`CREATE FUNCTION pos1179_refuse_mark() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'pos1179 test: the marks write is refused'; END $$`);
  await owner.query("CREATE TRIGGER pos1179_refuse BEFORE UPDATE ON marks FOR EACH ROW WHEN (OLD.slug = 'wright/the-starforge-spire') EXECUTE FUNCTION pos1179_refuse_mark()");
  try {
    const r = await reconcileSpire(pen, { claimId: REKIND, apply: true, expect: dry.plan.digest });
    assert.equal(r.status, "refused");
    assert.match(r.receipt, /rolled back whole/);
  } finally {
    await owner.query("DROP TRIGGER pos1179_refuse ON marks");
    await owner.query("DROP FUNCTION pos1179_refuse_mark()");
  }
  assert.equal(await dump(), before, "the claim UPDATE that ran first was rolled back with the failed marks UPDATE");
});

test("THE APPLY · both inputs lose rooms, the marker says what was removed, and every later legitimate change is exactly as it was", { skip }, async () => {
  const beforeRow = await rowOf();
  const beforeClaim = await claimOf(REKIND);
  const beforeOrigin = await claimOf(ORIGIN);
  const beforeFile = renderRecord(beforeRow);
  const beforeOthers = JSON.stringify((await owner.query("SELECT * FROM marks WHERE slug <> $1 ORDER BY slug", [SLUG])).rows);
  const nClaims = (await owner.query("SELECT count(*)::int n FROM claims")).rows[0].n;
  // the window before the open one was sealed with the Spire as it stands today: that sealed version is history, and stays
  const s339 = await seal(339);
  sealedBefore = await sealedState();
  oldSpireDigest = (await owner.query("SELECT w.digest FROM world_snapshot_marks w JOIN world_snapshots s ON s.marks_digest = w.marks_digest WHERE s.window_id = 339 AND w.slug = $1", [SLUG])).rows[0].digest;
  assert.equal(JSON.parse((await owner.query("SELECT row FROM mark_versions WHERE digest = $1", [oldSpireDigest])).rows[0].row).data.rooms.length, 22, "the sealed version holds the 22 rooms");
  assert.ok(s339.marks >= 2);
  const dry = await reconcileSpire(pen, { claimId: REKIND });
  const r = await reconcileSpire(pen, { claimId: REKIND, apply: true, expect: dry.plan.digest, now: () => new Date("2026-11-27T22:00:00.000Z") });
  assert.equal(r.status, "applied", r.receipt);

  const row = await rowOf(), claim = await claimOf(REKIND);
  assert.equal(Object.hasOwn(row.data, "rooms"), false, "the store's row carries no rooms");
  assert.equal(Object.hasOwn(claim.data, "rooms"), false, "WLD-253's re-kind claim carries no rooms");
  const marker = { issue: "POS-1179", cause: "WLD-260", removed: ["rooms"], was: { entries: 22, sha256: roomsDigest(OLD_ROOMS) }, window: 340, at: "2026-11-27T22:00:00.000Z" };
  assert.deepEqual(row.data[MARKER], marker);
  assert.deepEqual(claim.data[MARKER], marker);
  // everything else: the data minus rooms and the marker, the geometry (the 22 points), kind, the claim's window/supersedes/status, all as before
  const rest = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== "rooms" && k !== MARKER));
  assert.deepEqual(rest(row.data), rest(beforeRow.data));
  assert.deepEqual(rest(claim.data), rest(beforeClaim.data));
  assert.deepEqual(row.geometry, beforeRow.geometry);
  assert.equal(row.geometry.points.length, 22, "the ring stays on the row");
  assert.equal(row.kind, "door", "the later door class is kept");
  assert.equal(row.data.into, "wright/spire-gilded-vestibule");
  assert.equal(row.data.lands_at, "wright/spire-gilded-doors-inside");
  assert.equal(row.locked_window, beforeRow.locked_window, "the row's recorded lock window is untouched");
  assert.equal(row.locked_window, 337);
  for (const k of ["window_id", "supersedes", "status", "class", "claimant", "geometry", "body", "decided_at"]) assert.deepEqual(claim[k], beforeClaim[k], `the claim's ${k} is untouched`);
  assert.deepEqual(await claimOf(ORIGIN), beforeOrigin, "the origin claim is a version that was true when it was made: untouched");
  assert.equal((await owner.query("SELECT count(*)::int n FROM claims")).rows[0].n, nClaims, "no claim was added or removed");
  assert.equal(JSON.stringify((await owner.query("SELECT * FROM marks WHERE slug <> $1 ORDER BY slug", [SLUG])).rows), beforeOthers, "no other mark moved");

  // THE FILE, by the write-down's own renderer: exactly the one line, nothing else
  const afterFile = renderRecord(row);
  const d = lineDiff(beforeFile, afterFile);
  assert.equal(d.gone.length, 1);
  assert.ok(d.gone[0].startsWith("rooms: "));
  assert.deepEqual(d.added, []);
  assert.ok(afterFile.includes("kind: door") && afterFile.includes(`date: ${DATA.date}`) && afterFile.includes("points: [[3725,-5590.5]") && afterFile.includes("into: wright/spire-gilded-vestibule"));
  assert.doesNotMatch(afterFile, /claimed_at|footprints|rooms|_forward_reconciled/);
});

test("IDEMPOTENT · a second run writes nothing; a half-finished run finishes", { skip }, async () => {
  const before = await dump();
  const again = await reconcileSpire(pen, { claimId: REKIND, apply: true, expect: "ignored-by-a-noop" });
  assert.equal(again.status, "noop", again.receipt);
  assert.equal(await dump(), before);
  // half-finished: put rooms back on the ROW only (the claim stays clean), as an interrupted earlier run would leave the other half
  await owner.query("UPDATE marks SET data = data || $2::jsonb WHERE slug = $1", [SLUG, JSON.stringify({ rooms: OLD_ROOMS })]);
  const dry = await reconcileSpire(pen, { claimId: REKIND });
  assert.equal(dry.status, "dry-run", dry.receipt);
  assert.deepEqual(dry.plan.steps.map((s) => s.table), ["marks"]);
  const done = await reconcileSpire(pen, { claimId: REKIND, apply: true, expect: dry.plan.digest });
  assert.equal(done.status, "applied", done.receipt);
  assert.equal(Object.hasOwn((await rowOf()).data, "rooms"), false);
});

test("THE CROSSING · the settlement prints from the seal: the Spire is the lists' one changed mark and its printed file differs from today's by exactly the rooms line; every earlier sealed version stays", { skip }, async () => {
  const { deltaOf } = await import("../world2/tools/settlement-printout.mjs");
  const { snapshotHeader, snapshotRows } = await import("../src/world-snapshot.mjs");
  const { renderedMark } = await import("../world2/tools/mark-render.mjs");
  const { planStoreWriteDown, normalizeMark } = await import("../src/store-writedown.mjs");
  const q = (t, a) => pen.query(t, a);
  // the open window closes and the clearing seals it (the real sealSnapshot, in its own transaction)
  await owner.query("UPDATE windows SET status = 'closed', cleared_at = now() WHERE id = 340");
  const s340 = await seal(340);
  assert.ok(s340.new_versions >= 1, "the corrected row is a new sealed version");

  // THE PRINTOUT'S OWN MEASURE (settlement-printout.mjs § printSettlement): P is the last sealed list, S this window's; the delta is by sealed version
  const P = await snapshotHeader({ query: q }, { window: 339 });
  const S = await snapshotHeader({ query: q }, { window: 340 });
  const [pRows, sRows] = await Promise.all([snapshotRows({ query: q }, P.marks_digest), snapshotRows({ query: q }, S.marks_digest)]);
  assert.deepEqual(deltaOf(pRows, sRows), { changed: [SLUG], removed: [] }, "the Spire is the one mark whose sealed version differs; the neighbour is not");
  // … and what is printed: each changed version rendered from the SEAL as entriesOf renders it (no live table, no claim chain), then planned by the write-down's planner
  const entryOf = (rows) => {
    const r = JSON.parse(rows.find((x) => x.slug === SLUG).row);
    return { slug: SLUG, kind: r.kind, by: r.owner, household: "hh:starforge", locked_window: null, founder_commit: r.data?.founder_commit ?? null,
      ...renderedMark({ ...r, first_claimed: null, first_claim_submitted_at: null }) };
  };
  const today = entryOf(pRows), next = entryOf(sRows);
  assert.match(today.bytes, /\nrooms: \[/, "the sealed version main holds today carries the rooms");
  const PATH = "WORLD/marks/wright/the-starforge-spire/mark.md";
  const plan = planStoreWriteDown([normalizeMark(next)], { publishedPathOf: () => PATH, canonBytesAt: (p) => (p === PATH ? today.bytes : null) });
  const upserts = plan.households.flatMap((h) => h.upserts);
  assert.equal(upserts.length, 1, "the planner prints the Spire");
  assert.equal(upserts[0].path, PATH, "at its filed path");
  const d = lineDiff(today.bytes, upserts[0].bytes);
  assert.equal(d.gone.length, 1, JSON.stringify(d));
  assert.ok(d.gone[0].startsWith("rooms: "));
  assert.deepEqual(d.added, [], "nothing else changes: no date restamp, claimed_at, footprints; the ring and every field stay");
  assert.ok(upserts[0].bytes.includes("kind: door") && upserts[0].bytes.includes("points: [[3725,-5590.5]") && upserts[0].bytes.includes("lands_at: wright/spire-gilded-doors-inside"));

  // SEALED HISTORY: every earlier seal is exactly as it was, and the old version is still there beside the new one
  const state = JSON.parse(await sealedState());
  const before = JSON.parse(sealedBefore);
  assert.deepEqual(state.snapshots, before.snapshots, "the earlier snapshot header is exactly as it was");
  const sealedLists = new Set(before.lists.map((l) => l.marks_digest));
  assert.deepEqual(state.lists.filter((l) => sealedLists.has(l.marks_digest)), before.lists, "every earlier list is exactly as it was");
  for (const v of before.versions) assert.deepEqual(state.versions.find((x) => x.digest === v.digest), v, "an older sealed version is untouched");
  const newSpire = (await owner.query("SELECT w.digest FROM world_snapshot_marks w JOIN world_snapshots s ON s.marks_digest = w.marks_digest WHERE s.window_id = 340 AND w.slug = $1", [SLUG])).rows[0].digest;
  assert.notEqual(newSpire, oldSpireDigest, "the corrected row is a new version");
  const newRow = (await owner.query("SELECT row FROM mark_versions WHERE digest = $1", [newSpire])).rows[0].row;
  assert.equal(Object.hasOwn(JSON.parse(newRow).data, "rooms"), false, "the new sealed version carries no rooms (its marker names the removal, in `_forward_reconciled`)");
  assert.equal(JSON.parse((await owner.query("SELECT row FROM mark_versions WHERE digest = $1", [oldSpireDigest])).rows[0].row).data.rooms.length, 22, "the old sealed version still holds them");
});
