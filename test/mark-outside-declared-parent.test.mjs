// mark-outside-declared-parent.test.mjs — THE MOORING THAT PUT TO SEA.
//
// ── THE LIVE CASE (postmark#3020, Linear POS-147) ────────────────────────────
//
// `current-the-reader/the-snug-mooring` is filed, by the 2026-08-25 freeze, at
//
//   WORLD/marks/let-there-be-light/the-doubled-coast/the-snug-harbour/the-snug-mooring/mark.md
//
// — inside the harbour. Its owner's 2026-09-14T17:02Z amend carried the WORLD
// point (-358, 4972), which is exactly where the mooring stood: the harbour's
// composed centre is (-350, 4978), so the file's own number was (-8, -6).
//
// The 2026-09-15T17:46Z crossing (world `3a3a645c`, the store path, BEFORE the
// 2026-09-18 framer landed) wrote those world numbers RAW into the
// parent-relative file. The fold then composed them against the harbour and the
// mooring resolved to (-708, 9950) — five kilometres out to sea — and stayed
// there through settlements S71, S72 and S73. Three placements lost it as their
// parent on the way out. World main `a7c866f1` restores `at: { x: -8, y: -6 }`
// by hand; this file is about the door and the write-down, not the repair.
//
// ── THE RULING (Keemin, 2026-09-20) ──────────────────────────────────────────
//
//   "1) absolute coords are what it takes (the written schema is correct, the
//    current behavior is wrong)
//    2) if marks DECLARE their parent, refuse at that lands outside the parent.
//    If they DON'T, dont, and parent just gets computed by geometry (which is
//    the way it should be)"
//
// A mark declares its parent BY ITS FROZEN FILING PATH (`WORLD/filing-freeze.json`;
// `leave-exec.mjs` ~313: "a sited/parcel mark never authors a parent (geometry
// decides)"). An existing mark has a path, so an amend is a declared-parent
// case. A new mark has none, so Gate B files it root-framed and geometry places
// it — which is the ruling's second sentence, already true.
//
// ── WHAT THIS FILE PROVES ────────────────────────────────────────────────────
//
// Over a Snug-shaped world (the root declaring `coords: relative`, the coast at
// its real (-400, 4923), the harbour filed under it at (50, 55) with its real
// 30×22 extent, the mooring filed under the harbour at (-8, -6), the freeze
// manifest naming all three) and the store's row for the amend:
//
//   Q1 — the framer already does (1): an amend carrying the mark's own WORLD
//        centre writes the file's numbers UNCHANGED. Absolute coords at the
//        door, frame-relative in the file, converted once.
//   Q2 — and NOTHING refused a world `at` that lands outside the declared
//        parent: the framer converted it faithfully and the file said "in the
//        harbour" while the geometry said "at sea".
//
// Both are measurements first: Q1 is expected green on main (it is the 2026-09-18
// Berthillon carriage, postmark#2865, holding), Q2 red — and Q2's red IS the
// build.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

import { fileFramer } from "../src/world-drain.mjs";
import { FoldInputRefusal, planStoreWriteDown, normalizeMark, storeWriteDown } from "../src/store-writedown.mjs";
import { frameOfRow, renderedMark } from "../world2/tools/mark-render.mjs";
import { declaredParentGuard } from "../src/world.mjs";
import { declaredParentIdOf, idOfMarkFileFrom, outsideDeclaredParent, outsideParentBounce } from "../src/mark-declared-parent.mjs";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");

function findWorldCheckout() {
  const candidates = [
    process.env.POSTMARK_WORLD_CLONE,
    process.env.WORLD_CLONE,
    join(OFFICE, "world-clone"),
    join(OFFICE, "..", "postmark-world"),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(join(c, "tools", "marks-fold.mjs"))) return c;
  return null;
}
const WORLD = findWorldCheckout();
const WHY_SKIP = WORLD ? false : "no world checkout found (set POSTMARK_WORLD_CLONE) — the fold assertions need the real fold";

const ROOT = "WORLD/marks/let-there-be-light";
const COAST_DIR = `${ROOT}/the-doubled-coast`;
const HARBOUR_DIR = `${COAST_DIR}/the-snug-harbour`;
const MOORING_DIR = `${HARBOUR_DIR}/the-snug-mooring`;
const MOORING_FILE = `${MOORING_DIR}/mark.md`;

const COAST_WORLD = { x: -400, y: 4923 };          // filed under the root, which is (0,0) — file number IS world
const HARBOUR_FILE_AT = { x: 50, y: 55 };          // what the harbour's file says
const HARBOUR_WORLD = { x: -350, y: 4978 };        // coast + file — the frame the mooring is written in
const HARBOUR_EXTENT = { w: 30, h: 22 };           // x ∈ [-365, -335], y ∈ [4967, 4989]
const MOORING_FILE_AT = { x: -8, y: -6 };          // what the file must say
const MOORING_WORLD = { x: -358, y: 4972 };        // harbour + file — where the mooring stands, and what the owner spoke
const AT_SEA = { x: -708, y: 9950 };               // where the raw carriage put it: harbour + the world number, read as an offset
const MOORING_EXTENT = { w: 8, h: 10 };
const IMAGE = "https://media.postmark.town/media/devadavisson/dd7afc6ea3c40e2f14308317c947e89cac00b27b661cc330ae9d6f68a450d0ff.jpg";
const BODY = "The Snug's dock at the pub door — deep water for a visiting hull, a cleat for the coracle, and the tide-to-threshold step a pint from the taps.";

const rec = (fields, body) => `---\n${fields.join("\n")}\n---\n\n${body}\n`;

/**
 * THE STORE'S ROW for the mooring's amend. `geometry.at` is the WORLD position
 * (the schema's word, and the owner's); `data` is the claim's, rewritten whole
 * by `materialize.mjs § materializeClaims` on an amend — so no `_fileAt`, and
 * that absence is what makes this a world-framed row.
 */
const storeRow = (at) => ({
  slug: "current-the-reader/the-snug-mooring", kind: "sited", owner: "current-the-reader",
  household: "gh:222333444", locked_window: 193, status: "standing",
  geometry: { at: { ...at }, slug: "current-the-reader/the-snug-mooring", extent: { ...MOORING_EXTENT } },
  data: {
    by: "current-the-reader", date: "2026-09-14T17:02:24.215Z", kind: "sited", image: IMAGE,
    _act_id: "6471", _journal_seq: null,
  },
  body: BODY,
});

/**
 * The Snug, shaped the way the freeze left it: the root declares
 * `coords: relative`; the coast is a pre-existing region at its real world
 * position; the harbour is filed under the coast at (50, 55) with its real
 * 30×22 extent; the mooring is filed under the harbour at (-8, -6). The coast's
 * real `points` ring is deliberately left off — the containment question this
 * file asks is about the HARBOUR, whose shape is a plain rect on the live
 * record too, and a ring on the coast would only make the fixture harder to read
 * without changing a single answer.
 */
function snugShapedWorld(t, { mooringFileAt = MOORING_FILE_AT } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "postmark-snug-parent-"));
  t.after(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* litter */ } });
  const put = (p, text) => { mkdirSync(join(repo, dirname(p)), { recursive: true }); writeFileSync(join(repo, p), text); };
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  cpSync(join(WORLD, "tools"), join(repo, "tools"), { recursive: true });
  put("package.json", JSON.stringify({ name: "world-fixture", type: "module" }));
  put("WORLD/skeleton.json", `${JSON.stringify({ features: [], physics_registry: {} }, null, 2)}\n`);
  put("WORLD/households.json", `${JSON.stringify({
    households: { devadavisson: "gh:222333444", spar: "gh:111222333" },
    logins: { devadavisson: "gh:222333444", spar: "gh:111222333" },
  }, null, 2)}\n`);

  put(`${ROOT}/mark.md`, rec(["kind: sited", "by: the-town", "tier: constitution", "date: 2026-07-22",
    "at: { x: 0, y: 0 }", "extent: { w: 320000, h: 320000 }", "coords: relative"], "Let there be light."));
  put(`${COAST_DIR}/mark.md`, rec(["by: spar", "kind: sited", "date: 2026-07-23", "tier: constitution",
    `at: { x: ${COAST_WORLD.x}, y: ${COAST_WORLD.y} }`, "extent: { w: 1790, h: 1688 }", "pre: true"],
    "An open twilight shore beyond the river's mouth."));
  put(`${HARBOUR_DIR}/mark.md`, rec(["kind: sited", "by: current-the-reader", "date: 2026-09-18T21:27:07.265Z",
    `at: { x: ${HARBOUR_FILE_AT.x}, y: ${HARBOUR_FILE_AT.y} }`,
    `extent: { w: ${HARBOUR_EXTENT.w}, h: ${HARBOUR_EXTENT.h} }`],
    "A harbour-stone pub at the tide's edge — the sign over the door reads EVERY NIGHT THE TIDE IS IN."));
  put(MOORING_FILE, rec(["kind: sited", "by: current-the-reader", "date: 2026-09-14T17:02:24.215Z",
    `at: { x: ${mooringFileAt.x}, y: ${mooringFileAt.y} }`,
    `extent: { w: ${MOORING_EXTENT.w}, h: ${MOORING_EXTENT.h} }`, `image: ${IMAGE}`], BODY));

  // THE FOSSIL MANIFEST — id → directory, minted once, never regenerated. It is
  // where a mark's DECLARED parent is read from: the path owns containment.
  put("WORLD/filing-freeze.json", `${JSON.stringify({
    frozen_at: "2026-08-25",
    marks: {
      "spar/the-doubled-coast": COAST_DIR,
      "current-the-reader/the-snug-harbour": HARBOUR_DIR,
      "current-the-reader/the-snug-mooring": MOORING_DIR,
    },
  }, null, 2)}\n`);

  git("init", "-q", "-b", "main");
  execFileSync(process.execPath, [join(repo, "tools", "marks-fold.mjs")], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "canon");
  return { repo, git };
}

/** The real fold over a ref of the fixture — where it actually placed things. */
function foldAt({ repo, git }, ref) {
  const dir = mkdtempSync(join(tmpdir(), "postmark-snug-fold-"));
  try {
    cpSync(join(WORLD, "tools"), join(dir, "tools"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "world-fixture", type: "module" }));
    for (const p of git("ls-tree", "-r", "--name-only", ref, "--", "WORLD").trim().split("\n").filter(Boolean)) {
      mkdirSync(join(dir, dirname(p)), { recursive: true });
      writeFileSync(join(dir, p), git("show", `${ref}:${p}`));
    }
    execFileSync(process.execPath, [join(dir, "tools", "marks-fold.mjs")], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    const state = JSON.parse(readFileSync(join(dir, "WORLD", "world-state.json"), "utf8"));
    const of = (id) => { const m = state.marks.find((x) => x.id === id); return m ? { at: m.at, parent: m.placementParent ?? null } : null; };
    return { mooring: of("current-the-reader/the-snug-mooring"), harbour: of("current-the-reader/the-snug-harbour") };
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* litter */ } }
}

/**
 * The fixture's canon, in the shape the door's guards hold it: exactly what
 * `world.mjs § canonForGuards` builds out of the published fold, so the guard
 * under test is reading the structure it reads in production.
 */
function canonOf(repo) {
  const state = JSON.parse(readFileSync(join(repo, "WORLD", "world-state.json"), "utf8"));
  const marks = state.marks ?? [];
  return { marks, byId: new Map(marks.map((m) => [m.id, m])), ids: new Set(marks.map((m) => m.id)) };
}

const foldInput = (marks) => ({
  marks, stakes: [],
  as_of: { window: 193, world_sha: "3a3a645c0000000000000000000000000000000a", town_sha: "422dbe6f2b5b4fc0eaae69c5f2c8058d259d8d98" },
  selection: { by: "docket", window: 193, docket_claims: 1, carried_absent: { checked: true, count: 0 } },
});

const entryFor = (row) => ({
  slug: row.slug, kind: row.kind, by: row.owner, household: row.household, locked_window: row.locked_window,
  status: row.status, founder_commit: null, ...renderedMark(row),
});

// ── THE CONTROL: the fixture is the live shape ───────────────────────────────

test("THE FIXTURE IS THE CASE: the harbour composes to (-350, 4978) and the mooring, filed at (-8, -6), stands at (-358, 4972)", { skip: WHY_SKIP }, (t) => {
  const w = snugShapedWorld(t);
  const before = foldAt(w, "main");
  assert.deepEqual(before.harbour.at, HARBOUR_WORLD, "the frame the mooring's file is written in");
  assert.deepEqual(before.mooring.at, MOORING_WORLD, "where the mooring stands — and what its owner spoke on 09-14");
  assert.equal(before.mooring.parent, "current-the-reader/the-snug-harbour", "the harbour is its parent, by geometry and by path");
});

test("THE RAW CARRIAGE, kept as an executable memory: the world number written into the relative file puts the mooring at (-708, 9950)", { skip: WHY_SKIP }, (t) => {
  // Exactly what the 09-15T17:46Z crossing did — the file's own frame added the
  // harbour's origin to a number that already carried it.
  const w = snugShapedWorld(t, { mooringFileAt: MOORING_WORLD });
  const after = foldAt(w, "main");
  assert.deepEqual(after.mooring.at, AT_SEA, "five kilometres out to sea — the number S71 through S73 answered with");
  assert.notEqual(after.mooring.parent, "current-the-reader/the-snug-harbour", "and the harbour is no longer its parent");
});

// ── Q1: IS (1) ALREADY TRUE? ─────────────────────────────────────────────────

test("Q1 — the row is WORLD-framed and the entry says so: an amend carries no `_fileAt`", () => {
  assert.equal(frameOfRow(storeRow(MOORING_WORLD)), "world",
    "an amended row's `data` is rewritten from the claim — no `_fileAt`, so its numbers are the owner's world position");
  const e = entryFor(storeRow(MOORING_WORLD));
  assert.equal(e.at_frame, "world");
  assert.match(e.bytes, /^at: \{ x: -358, y: 4972 \}$/m, "the bytes carry the world number — what the 09-15 crossing wrote raw");
  assert.deepEqual(e.fileRec.at, MOORING_WORLD);
});

test("Q1 — THE FALSIFIER: an amend carrying the mark's OWN world centre writes the file's numbers unchanged", async (t) => {
  const { repo } = snugShapedWorld(t);
  const toFileFrame = await fileFramer(repo);
  assert.equal(typeof toFileFrame, "function", "the tree declares coords: relative, so there is a converter to reach");

  const plan = planStoreWriteDown([normalizeMark(entryFor(storeRow(MOORING_WORLD)))], {
    publishedPathOf: (id) => (id === "current-the-reader/the-snug-mooring" ? MOORING_FILE : null),  // GATE A: the frozen filing
    canonBytesAt: () => null,
    toFileFrame,
  });
  const u = plan.households[0].upserts[0];
  assert.equal(u.path, MOORING_FILE, "Gate A: the frozen filing, nothing moves");
  assert.deepEqual(u.fileRec.at, MOORING_FILE_AT, "world − the harbour's origin: (-8, -6), what the file said before the amend");
  assert.match(u.bytes, /^at: \{ x: -8, y: -6 \}$/m);
  assert.equal(plan.counts.framed, 1);

  // THE PROPERTY, as the round trip: the file's number composed against the
  // frame it is written in is the position the owner spoke.
  assert.deepEqual({ x: u.fileRec.at.x + HARBOUR_WORLD.x, y: u.fileRec.at.y + HARBOUR_WORLD.y }, MOORING_WORLD);
});

// ── Q2: DOES ANYTHING REFUSE AN `at` OUTSIDE THE DECLARED PARENT? ────────────

test("Q2 — THE FALSIFIER: a world `at` five kilometres outside the declared parent is REFUSED, not converted", async (t) => {
  const { repo } = snugShapedWorld(t);
  const toFileFrame = await fileFramer(repo);

  const e = (() => {
    try {
      planStoreWriteDown([normalizeMark(entryFor(storeRow(AT_SEA)))], {
        publishedPathOf: () => MOORING_FILE, canonBytesAt: () => null, toFileFrame,
      });
      return null;
    } catch (x) { return x; }
  })();

  assert.ok(e instanceof FoldInputRefusal,
    "the path says `in the harbour` and the point says `at sea` — one of the two is wrong and the write-down may not pick");
  assert.equal(e.reason, "mark-outside-declared-parent");
  assert.match(e.detail, /the-snug-mooring/);
  assert.match(e.detail, /current-the-reader\/the-snug-harbour/, "the refusal names the parent the path declares");
});

// ── THE DOOR, SO THE OWNER HEARS IT AT ONCE AND NOT AT THE CROSSING ─────────
//
// The write-down's refusal sets the row aside at the settlement, hours later, in
// a receipt the owner does not read. `journalLeaveMark` is where they are
// standing. Same parent, same predicate, same word — and the test below asserts
// that agreement on these numbers rather than trusting it.

test("THE DOOR: an amend to a point outside the declared parent bounces 409 under the same word", async (t) => {
  const { repo } = snugShapedWorld(t);
  const canon = canonOf(repo);

  const out = await declaredParentGuard("current-the-reader/the-snug-mooring",
    { at: { ...AT_SEA }, extent: { ...MOORING_EXTENT } }, canon, repo);

  assert.ok(out, "the mooring is filed IN the harbour and this point is five kilometres out to sea");
  assert.equal(out.code, 409);
  assert.equal(out.reason, "mark-outside-declared-parent");
  // The sentence a resident actually reads — half the point of the guard.
  assert.match(out.defect, /\(-708, 9950\) is outside "current-the-reader\/the-snug-harbour"/);
  assert.match(out.defect, /"current-the-reader\/the-snug-mooring" is filed inside it/);
  assert.match(out.hint, /x -365…-335, y 4967…4989/, "the ground, in numbers they can check their own against");
  assert.match(out.hint, /amend to a point inside current-the-reader\/the-snug-harbour/);
  assert.match(out.hint, /withdraw .* and leave a new mark/, "and the other way on: a create is placed by geometry");
});

test("THE DOOR ADMITS what the ruling leaves alone: inside the parent, filed at the root, and a parent canon cannot see", async (t) => {
  const { repo } = snugShapedWorld(t);
  const canon = canonOf(repo);
  const guard = (id, at) => declaredParentGuard(id, { at }, canon, repo);

  assert.equal(await guard("current-the-reader/the-snug-mooring", { ...MOORING_WORLD }), null,
    "the owner's own 09-14 amend: inside the harbour, admitted");
  assert.equal(await guard("current-the-reader/the-snug-harbour", { ...HARBOUR_WORLD }), null,
    "the harbour is filed under the coast and stands in it");
  assert.equal(await guard("spar/the-doubled-coast", { x: -9000, y: -9000 }), null,
    "filed directly under the world root — the root is the FRAME, not a parent: geometry decides, per the ruling's second sentence");
  assert.equal(await guard("current-the-reader/a-cone-left-this-morning", { ...AT_SEA }), null,
    "no frozen filing — a create, filed at its own id and placed by geometry");
  assert.equal(await declaredParentGuard("current-the-reader/the-snug-mooring", { at: { ...AT_SEA } },
    { byId: new Map(), marks: [], ids: new Set() }, repo), null,
    "a parent canon does not carry cannot be asked about, and an unanswerable question is never a refusal");
});

test("THE AGREEMENT: the door and the write-down refuse the SAME numbers under the SAME word", async (t) => {
  const { repo } = snugShapedWorld(t);
  const canon = canonOf(repo);
  const toFileFrame = await fileFramer(repo);

  for (const [label, at, expectRefusal] of [
    ["at sea", AT_SEA, true],
    ["the owner's own point", MOORING_WORLD, false],
  ]) {
    const door = await declaredParentGuard("current-the-reader/the-snug-mooring", { at: { ...at } }, canon, repo);
    const crossing = (() => {
      try {
        planStoreWriteDown([normalizeMark(entryFor(storeRow(at)))], {
          publishedPathOf: () => MOORING_FILE, canonBytesAt: () => null, toFileFrame,
        });
        return null;
      } catch (x) { return x; }
    })();

    assert.equal(Boolean(door), expectRefusal, `${label}: the door`);
    assert.equal(Boolean(crossing), expectRefusal, `${label}: the write-down`);
    if (!expectRefusal) continue;
    assert.equal(door.reason, crossing.reason, `${label}: ONE word`);
    assert.equal(door.reason, "mark-outside-declared-parent");
    assert.equal(door.finding.parentId, "current-the-reader/the-snug-harbour", `${label}: ONE parent`);
    assert.match(crossing.detail, /current-the-reader\/the-snug-harbour/);
    assert.deepEqual(door.finding.point, { x: at.x, y: at.y }, `${label}: ONE point`);
  }
});

// ── THE NEGATIVES ───────────────────────────────────────────────────────────

test("THE NEGATIVE: a root-filed mark carrying a world `at` is written unshifted, wherever that point is", async (t) => {
  const { repo } = snugShapedWorld(t);
  const toFileFrame = await fileFramer(repo);
  const cone = {
    ...storeRow(MOORING_WORLD), slug: "current-the-reader/cone-left-at-the-mooring",
    geometry: { at: { ...MOORING_WORLD }, extent: { w: 1, h: 1 } },
    data: { by: "current-the-reader", date: "2026-09-20T12:00:00.000Z", kind: "sited", _act_id: "6472" },
    body: "A cone, left at the mooring.",
  };
  // GATE B: no frozen filing, so it is filed at its own id — root-framed, and
  // the world number IS the file number. The guard never sees it.
  const plan = planStoreWriteDown([normalizeMark(entryFor(cone))], { publishedPathOf: () => null, canonBytesAt: () => null, toFileFrame });
  const u = plan.households[0].upserts[0];
  assert.equal(u.path, "WORLD/marks/current-the-reader/cone-left-at-the-mooring/mark.md");
  assert.deepEqual(u.fileRec.at, MOORING_WORLD, "nothing shifts at the root");
  assert.equal(plan.counts.framed, 0);

  // And the same at a point far outside anything: a create is placed by geometry
  // wherever that point really is, which is the ruling's second sentence.
  const far = planStoreWriteDown([normalizeMark(entryFor({ ...cone, geometry: { at: { ...AT_SEA }, extent: { w: 1, h: 1 } } }))],
    { publishedPathOf: () => null, canonBytesAt: () => null, toFileFrame });
  assert.deepEqual(far.households[0].upserts[0].fileRec.at, AT_SEA);
});

test("THE NEGATIVE: a FILE-framed row at the frozen path is untouched — the guard never reads file numbers as world ones", async (t) => {
  const { repo } = snugShapedWorld(t);
  const toFileFrame = await fileFramer(repo);
  // A seeded row carries `_fileAt`: its numbers are the FILE's, already in the
  // parent's frame. (-8, -6) read as a WORLD point is five kilometres from the
  // harbour and would be refused — so a guard that ran over seeded rows would
  // false-refuse most of the world. It does not run: this sits inside the same
  // `at_frame !== "file"` arm the framer itself is gated on.
  const base = storeRow(MOORING_WORLD);
  const seeded = { ...base, data: { ...base.data, _fileAt: { ...MOORING_FILE_AT } } };
  const e = entryFor(seeded);
  assert.equal(e.at_frame, "file");
  const kept = planStoreWriteDown([normalizeMark(e)], { publishedPathOf: () => MOORING_FILE, canonBytesAt: () => null, toFileFrame });
  assert.deepEqual(kept.households[0].upserts[0].fileRec.at, MOORING_FILE_AT, "left as they are");
  assert.equal(kept.counts.framed, 0);
});

test("THE CONSEQUENCE, stated rather than discovered: a WORDS-ONLY amend of an already-displaced mark is refused too", async (t) => {
  // The ruling's condition is the payload's `at`, and an amend rewrites `data`
  // whole from the claim — so a mark that is ALREADY outside its declared parent
  // carries an outside `at` even when its owner only changed a picture.
  //
  // Measured on the live record at world `6625d737`: NINE standing marks are
  // outside the parent their frozen filing declares, and EIGHT of them declare a
  // REGION whose ring was redrawn by the founder's 2026-08-24 ruling —
  // `WORLD/region-outsiders.md` says so in its own words: "Nothing has been moved
  // and nothing is lost — the ground is exactly where its owner put it; only the
  // region boundary changed."
  //
  // This test argues neither way. It makes the consequence EXECUTABLE, so that
  // whichever shape is ruled, the change is a change to a red line rather than to
  // a silence. The narrowing, if it is taken, is one condition — the move guard's
  // own `geometryMoved(prior, next)` from `world-move-guard.mjs`, beside it — and
  // it is proposed in the lane's report, not taken here.
  const { repo } = snugShapedWorld(t);
  const canon = canonOf(repo);
  const out = await declaredParentGuard("current-the-reader/the-snug-mooring",
    { at: { ...AT_SEA }, image: "a-new-picture.jpg" }, canon, repo);
  assert.ok(out, "TODAY'S SHAPE: the point is outside, so the amend is refused whether or not it moved anything");
});

// ── THE RING ARM, WHICH IS THE COMMON CASE AND NOT THE EXOTIC ONE ───────────
//
// Measured on the live record at world `6625d737`: of the nine standing marks
// outside the parent their frozen filing declares, EIGHT declare a REGION — an
// irregular mark with a `points` ring — and only the Snug mooring declares a
// plain rect. So the ring arm carries most of this guard's real traffic and is
// tested against the clone's own predicate rather than assumed.

test("THE RING: the clone's predicate answers the DRAWN shape, and the sentence says its bounds are a bounding box", { skip: WHY_SKIP }, async () => {
  const { pointWithinMark } = await import(pathToFileURL(join(WORLD, "tools", "world-verbs.mjs")).href);

  // An L, so that a point can be inside the bounding box and outside the shape —
  // which is the whole reason the bbox in the sentence is NAMED as a bbox.
  const region = {
    id: "spar/the-doubled-coast", by: "spar", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 100, h: 100 },
    points: [{ x: -50, y: -50 }, { x: 50, y: -50 }, { x: 50, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 50 }, { x: -50, y: 50 }],
  };
  const inArm = { x: -25, y: 25 };     // in the upright arm of the L
  const inNotch = { x: 25, y: 25 };    // inside the bbox, outside the L
  assert.equal(pointWithinMark(inArm, region), true, "the control: the predicate does hold points in the arm");
  assert.equal(pointWithinMark(inNotch, region), false, "and does not hold the notch — so this probe can fail either way");

  const ask = (at) => outsideDeclaredParent({
    id: "current-the-reader/a-mark", at, points: null,
    parentId: region.id, parent: region, pointWithinMark,
  });
  assert.equal(ask(inArm), null, "a point in the drawn shape is admitted");

  const out = ask(inNotch);
  assert.ok(out, "a point in the NOTCH is refused — coverage, not bounding box");
  assert.equal(out.extent.shape, "ring");
  assert.match(outsideParentBounce(out).hint, /its drawn shape, bounded by x -50…50, y -50…50/,
    "the resident is told the numbers are the shape's BOUNDS, because a bbox printed as the shape lies on every concave stretch");
});

test("THE RING, at the write-down too: a `points` ring outside the parent is refused, not just the centre", async () => {
  const { pointWithinMark } = await import(pathToFileURL(join(WORLD, "tools", "world-verbs.mjs")).href);
  const parent = { id: "the-town/a-yard", at: { x: 0, y: 0 }, extent: { w: 100, h: 100 } };
  const inside = { x: 10, y: 10 };

  assert.equal(outsideDeclaredParent({ id: "x/y", at: inside, points: null, parentId: parent.id, parent, pointWithinMark }), null);
  const out = outsideDeclaredParent({
    id: "x/y", at: inside, points: [[10, 10], [20, 20], [900, 900]],
    parentId: parent.id, parent, pointWithinMark,
  });
  assert.ok(out, "the centre is inside and the third ring point is not — a mark is its whole shape");
  assert.equal(out.which, "points[2]", "and the refusal names WHICH point, so the owner knows where to look");
  assert.deepEqual(out.point, { x: 900, y: 900 });
});

test("THE GUARD ADMITS WHEN IT CANNOT ASK — each arm, said one at a time", async () => {
  const { pointWithinMark } = await import(pathToFileURL(join(WORLD, "tools", "world-verbs.mjs")).href);
  const parent = { id: "the-town/a-yard", at: { x: 0, y: 0 }, extent: { w: 10, h: 10 } };
  const far = { x: 900, y: 900 };
  const base = { id: "x/y", at: far, points: null, parentId: parent.id, parent, pointWithinMark };

  assert.ok(outsideDeclaredParent(base), "the control: with everything present, this point IS refused");
  assert.equal(outsideDeclaredParent({ ...base, parentId: null }), null, "no declared parent");
  assert.equal(outsideDeclaredParent({ ...base, parent: null }), null, "no parent record in canon");
  assert.equal(outsideDeclaredParent({ ...base, parent: { id: parent.id } }), null, "a parent with no ground of its own");
  assert.equal(outsideDeclaredParent({ ...base, pointWithinMark: undefined }), null, "no predicate — the office never invents one");
  assert.equal(outsideDeclaredParent({ ...base, at: null }), null, "no point to place");
  assert.equal(outsideDeclaredParent({ ...base, at: { x: "north", y: null } }), null, "and a point that is not numbers is not a point");
});

test("THE ANCESTOR WALK stops where the framer's does, and the world root is never a parent", () => {
  const R = "WORLD/marks/let-there-be-light";
  const idOf = idOfMarkFileFrom(new Map([
    ["spar/the-doubled-coast", `${R}/the-doubled-coast/mark.md`],
    ["current-the-reader/the-snug-harbour", `${R}/the-doubled-coast/the-snug-harbour/mark.md`],
    ["the-town/let-there-be-light", `${R}/mark.md`],
  ]));

  assert.equal(declaredParentIdOf(`${R}/the-doubled-coast/the-snug-harbour/the-snug-mooring/mark.md`, idOf),
    "current-the-reader/the-snug-harbour", "the NEAREST enclosing mark, not the outermost");
  assert.equal(declaredParentIdOf(`${R}/the-doubled-coast/the-snug-jetty/mark.md`, idOf),
    "spar/the-doubled-coast", "one level up when that is the nearest");
  assert.equal(declaredParentIdOf(`${R}/the-doubled-coast/mark.md`, idOf), null,
    "filed directly under the root: the root is the FRAME, not a parent — the ruling's second sentence");
  assert.equal(declaredParentIdOf(`${R}/nowhere-the-manifest-names/a-mark/mark.md`, idOf), null,
    "an ancestor directory that is not a mark declares nothing");
  assert.equal(declaredParentIdOf("WORLD/marks/current-the-reader/a-cone/mark.md", idOf), null,
    "a mark born after the freeze is filed at its own id — root-framed, no declared parent");
  assert.equal(declaredParentIdOf("", idOf), null);
});
