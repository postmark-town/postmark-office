// leave-door-nested-fossil-frame.test.mjs — THE CONDEMNED DOOR AMENDS IN THE
// PARENT'S FRAME.
//
// ── THE LIVE CASE ────────────────────────────────────────────────────────────
//
// 2026-09-14T17:02:24.215Z, an amend of `current-the-reader/the-snug-mooring`
// went through `src/leave-exec.mjs` carrying the resident's ABSOLUTE position,
// `at: { x: -358, y: 4972 }` — the mooring's true world point, which is what the
// door's own schema asks a resident to speak. The mooring's filing is nested
// three segments deep (`WORLD/marks/let-there-be-light/the-doubled-coast/
// the-snug-harbour/the-snug-mooring/`), the tree declares `coords: relative`, so
// the fold reads that number as an OFFSET FROM THE HARBOUR'S CENTRE (-350, 4978)
// and composed the mooring to (-708, 9950): five kilometres out to sea. World
// commit `3a3a645c` (the 09-15 sweep) carries the wrong record verbatim; Wright
// restored it by hand on 09-20 (`a7c866f1`). It is the same shape the drain
// already fixed for `vermillion/the-pando-peak` (test/world-drain-frame.test.mjs,
// 2026-08-27) — the office's two other write doors translate correctly and this
// one did not.
//
// ── WHY THE CONVERSION WAS SKIPPED ───────────────────────────────────────────
//
// The frame conversion at `leave-exec.mjs § SCHEMA v3` ran only `if (relativeTree
// && parentId)`, and resolved its origin as `byId.get(parentId)?.at`. A
// sited/parcel mark NEVER carries a parent_id — "geometry decides" — so
// `parentId` is null for every one of them and the whole branch was dead for the
// kind of mark that can be nested. It read as safe because a FRESH sited leave
// files at `WORLD/marks/<by>/<slug>/`, which is root level, where absolute IS the
// file frame and nothing needs shifting. The hole is the AMEND of a mark the
// frozen manifest already nests: gate A hands it the fossil's nested filing, and
// the absolute went in verbatim.
//
// The comment above the conversion promised "if this conversion is ever wrong,
// the lint+fold gate below refuses the write — the door cannot land a misplaced
// record". There is no gate below (a draft costs nothing, 2026-08-22), and the
// Settlement's lint and fold cannot help: a number in the wrong frame parses and
// composes to a real point on real ground, so it reads as a mark that MOVED, not
// one that is misplaced. It did not refuse, twice.
//
// ── WHAT THIS SUITE HOLDS ────────────────────────────────────────────────────
//
// THE FALSIFIER: amend a nested sited fossil through the real executor with an
// absolute `at`; the bytes on disk must carry `worldToFile(absolute, harbour)`,
// and the REAL fold must compose that file back to the absolute the resident
// spoke. On `origin/main` before this fix the file carries the absolute verbatim
// and the fold composes it to the open sea.
//
// THE COMPANION: a fresh sited leave still files at `WORLD/marks/<by>/<slug>/`
// with its absolute unchanged — the fix must not shift a root-level filing.
//
// THE CAN-FAIL FLIP: restore the `parentId`-only origin in src/leave-exec.mjs →
// the falsifier reds with the absolute written verbatim; the companion stays
// green. Run receipt in the hotfix PR.
//
//   node --test test/leave-door-nested-fossil-frame.test.mjs
//
// THE ENGINE IS THE REAL ONE. The fixture copies `tools/*.mjs` out of a world
// checkout, so `loadMarks`/`worldToFile`/`fileToWorld` here are the bytes the
// door imports and the Settlement folds with — a stub that agreed with itself
// would prove nothing about the frame. With no world checkout the suite SKIPS
// and says so; it never passes vacuously.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXEC = join(OFFICE, "src", "leave-exec.mjs");

/** The same search `test/mark-outside-declared-parent.test.mjs` runs, and for the same reason. */
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
const WHY_SKIP = WORLD ? false : "no world checkout found (set POSTMARK_WORLD_CLONE) — the frame assertions need the real fold, not a stub that agrees with itself";

// ── the live numbers, from the record ────────────────────────────────────────
const ROOT_DIR = "WORLD/marks/let-there-be-light";
const COAST_DIR = `${ROOT_DIR}/the-doubled-coast`;
const HARBOUR_DIR = `${COAST_DIR}/the-snug-harbour`;
const MOORING_DIR = `${HARBOUR_DIR}/the-snug-mooring`;
const MOORING_ID = "current-the-reader/the-snug-mooring";

const COAST_WORLD = { x: -400, y: 4923 };      // filed under the root, whose centre is (0,0) — file number IS world
const HARBOUR_FILE = { x: 50, y: 55 };         // what the harbour's file says
const HARBOUR_WORLD = { x: -350, y: 4978 };    // coast + file — THE FRAME the mooring is written in
const MOORING_FILE_BEFORE = { x: -8, y: -6 };  // what the file says as it stands

// The amend's absolute. DELIBERATELY NOT the mooring's current point: restating
// (-358, 4972) would translate to exactly the offset already on disk, and a door
// that wrote nothing at all would pass. This moves the mooring four metres east
// and three north, still inside the harbour, so "wrote the offset", "wrote the
// absolute" and "wrote nothing" are three distinguishable files.
const AMEND_WORLD = { x: -354, y: 4975 };
const AMEND_FILE = { x: -4, y: -3 };           // worldToFile(AMEND_WORLD, HARBOUR_WORLD)
const AT_SEA = { x: -704, y: 9953 };           // where the raw carriage lands it: harbour + the world number

const FRESH_SLUG = "the-quay-card";
const FRESH_WORLD = { x: -356, y: 4974 };

const mark = (fields, body) => `---\n${fields.join("\n")}\n---\n\n${body}\n`;

/**
 * A world in a bottle, shaped like the live one in the four ways this defect
 * needed: `coords: relative` on the ROOT RECORD, the harbour nested under the
 * coast so the mooring's frame is not the world's, a `filing-freeze.json` naming
 * the mooring's fossil filing, and the REAL engine under `tools/`.
 */
function bottledWorld(t) {
  const repo = mkdtempSync(join(tmpdir(), "pos181-nested-fossil-frame-"));
  t.after(() => { try { rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } });
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const put = (p, text) => {
    mkdirSync(join(repo, dirname(p)), { recursive: true });
    writeFileSync(join(repo, p), text);
  };

  put(`${ROOT_DIR}/mark.md`, mark([
    "kind: sited", "by: the-town", "tier: constitution", "date: 2026-07-22",
    "at: { x: 0, y: 0 }", "extent: { w: 320000, h: 320000 }", "coords: relative", "mechanic: light",
  ], "Let there be light."));
  put(`${COAST_DIR}/mark.md`, mark([
    "kind: sited", "by: spar", "date: 2026-07-23",
    `at: { x: ${COAST_WORLD.x}, y: ${COAST_WORLD.y} }`, "extent: { w: 1790, h: 1688 }",
  ], "The stretch of shore my house throws its light across."));
  put(`${HARBOUR_DIR}/mark.md`, mark([
    "kind: sited", "by: current-the-reader", "date: 2026-09-18T21:27:07.265Z",
    `at: { x: ${HARBOUR_FILE.x}, y: ${HARBOUR_FILE.y} }`, "extent: { w: 30, h: 22 }",
  ], "A harbour-stone pub at the tide's edge."));
  put(`${MOORING_DIR}/mark.md`, mark([
    "kind: sited", "by: current-the-reader", "date: 2026-09-14T17:02:24.215Z",
    `at: { x: ${MOORING_FILE_BEFORE.x}, y: ${MOORING_FILE_BEFORE.y} }`, "extent: { w: 8, h: 10 }",
  ], "The Snug's dock at the pub door."));

  // THE FREEZE. The manifest names the mooring's filing and nothing else, so the
  // mooring is a fossil (gate A hands it this nested path) and every other mark
  // in the bottle is a new mark that files at its id.
  put("WORLD/filing-freeze.json", JSON.stringify({ marks: { [MOORING_ID]: MOORING_DIR } }, null, 2));
  put("seeding/manifest.json", JSON.stringify({ homes: [] }));

  // THE REAL ENGINE, byte for byte: every non-test module under the world
  // checkout's tools/, so `marks-fold.mjs` resolves its own imports.
  mkdirSync(join(repo, "tools"), { recursive: true });
  for (const f of readdirSync(join(WORLD, "tools")))
    if (f.endsWith(".mjs") && !f.endsWith(".test.mjs")) copyFileSync(join(WORLD, "tools", f), join(repo, "tools", f));

  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "published main: the coast, the harbour, the mooring");
  return { repo, git };
}

/** Spawn the executor the way world.mjs does: one JSON argv, the clone by env. */
function leave(repo, payload) {
  const r = spawnSync(process.execPath, [EXEC, JSON.stringify(payload)], {
    encoding: "utf8",
    env: { ...process.env, WORLD_CLONE: repo, TOWN_PUSH: "", WORLD_POOL_SLOT: "", WORLD_SHARED_CLONE: "",
      BOT_NAME: "fixture", BOT_EMAIL: "fixture@test.invalid" },
  });
  assert.equal(r.status, 0, `the executor tripped: ${r.stderr}`);
  const line = r.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  return JSON.parse(line);
}

/** The fold, from the bottle's own tools/ — the same bytes the door imported. */
const engineOf = (repo) => import(pathToFileURL(join(repo, "tools", "marks-fold.mjs")).href);

/** What the file on disk actually says, read off the bytes and not off an answer. */
const atLineOf = (git, branch, path) => {
  const text = git("show", `${branch}:${path}`);
  const m = text.match(/^at:\s*\{\s*x:\s*(-?[\d.]+),\s*y:\s*(-?[\d.]+)\s*\}\s*$/m);
  assert.ok(m, `no at: line in ${path}:\n${text}`);
  return { x: Number(m[1]), y: Number(m[2]) };
};

test("THE FALSIFIER: an amend of a NESTED sited fossil writes the offset against its frame, not the resident's absolute", { skip: WHY_SKIP }, async (t) => {
  const { repo, git } = bottledWorld(t);
  const { loadMarks, worldToFile, fileToWorld } = await engineOf(repo);

  // The precondition, asserted rather than assumed: the fold frames the mooring
  // on the harbour. If the bottle ever stops reproducing that, this test must
  // say so instead of quietly measuring something else.
  const before = loadMarks(join(repo, "WORLD", "marks"));
  const moorBefore = before.find((m) => m.id === MOORING_ID);
  assert.deepEqual(moorBefore?._origin, HARBOUR_WORLD, "the bottle must frame the mooring on the harbour's composed centre");
  assert.deepEqual(worldToFile(AMEND_WORLD, HARBOUR_WORLD), AMEND_FILE, "the expected offset is the engine's own arithmetic, not a number typed here");

  const out = leave(repo, {
    slug: "the-snug-mooring", kind: "sited", amend: true,
    at: { ...AMEND_WORLD }, extent: { w: 8, h: 10 },
    body: "The Snug's dock at the pub door — said again, four metres east.",
    by: "current-the-reader", household: "current-the-reader", date: "2026-09-21",
  });
  assert.equal(out.error, undefined, `the door bounced the amend: ${JSON.stringify(out.error)}`);
  assert.equal(out.id, MOORING_ID);
  assert.equal(out.moved, false, "the fossil is amended in place — its filing never moves");

  // THE BYTES. The file carries the offset against the harbour; it must not
  // carry the absolute, and it must not still carry what it said before.
  const written = atLineOf(git, "draft/current-the-reader", `${MOORING_DIR}/mark.md`);
  assert.deepEqual(written, AMEND_FILE,
    `the file must carry worldToFile(absolute, harbour) = ${JSON.stringify(AMEND_FILE)}; it says ${JSON.stringify(written)}`);
  assert.notDeepEqual(written, AMEND_WORLD, "the absolute went in verbatim — this is the defect");
  assert.notDeepEqual(written, MOORING_FILE_BEFORE, "the door wrote nothing at all");

  // THE ROUND TRIP, both ways: the engine's own inverse, and the whole fold over
  // the tree the door left behind.
  assert.deepEqual(fileToWorld(written, HARBOUR_WORLD), AMEND_WORLD, "the written offset must compose back to the absolute the resident spoke");
  const after = loadMarks(join(repo, "WORLD", "marks"));
  const moorAfter = after.find((m) => m.id === MOORING_ID);
  assert.deepEqual(moorAfter.at, AMEND_WORLD, "the fold must place the mooring where the resident said");
  assert.notDeepEqual(moorAfter.at, AT_SEA, "the fold placed it five kilometres out to sea");
});

test("THE COMPANION: a FRESH sited leave still files at WORLD/marks/<by>/<slug>/ with its absolute unchanged", { skip: WHY_SKIP }, async (t) => {
  const { repo, git } = bottledWorld(t);
  const { loadMarks } = await engineOf(repo);

  const out = leave(repo, {
    slug: FRESH_SLUG, kind: "sited",
    at: { ...FRESH_WORLD }, extent: { w: 1, h: 1 },
    body: "A card left on the quay.",
    by: "current-the-reader", household: "current-the-reader", date: "2026-09-21",
  });
  assert.equal(out.error, undefined, `the door bounced the fresh leave: ${JSON.stringify(out.error)}`);
  assert.equal(out.dir, `current-the-reader/${FRESH_SLUG}`, "a mark the manifest does not name files at its id");

  const path = `WORLD/marks/current-the-reader/${FRESH_SLUG}/mark.md`;
  assert.deepEqual(atLineOf(git, "draft/current-the-reader", path), FRESH_WORLD,
    "a root-level filing IS the world frame — the absolute goes in unshifted");
  const fresh = loadMarks(join(repo, "WORLD", "marks")).find((m) => m.id === `current-the-reader/${FRESH_SLUG}`);
  assert.deepEqual(fresh?._origin, { x: 0, y: 0 }, "the fold frames it on the world's centre");
  assert.deepEqual(fresh?.at, FRESH_WORLD, "and composes it exactly where the resident said");
});
