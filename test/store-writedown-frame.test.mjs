// store-writedown-frame.test.mjs — THE SHOP THAT A PICTURE MOVED.
//
// ── THE LIVE CASE (postmark#2865, the third bite) ────────────────────────────
//
// 2026-09-18T05:45Z, the store crossing carried Berthillon's image-only amend
// of `berthillon/le-petit-berthillon` into the world. The Worldkeeper's daily
// (02:01 EDT, S72's second refusal):
//
//   "Before this crossing, `berthillon/le-petit-berthillon` stood at World
//    (221, 95.5), parented to `berthillon/chez-antoine`, with its cones fanned
//    into the shop. The fresh row left the body and 15×12 extent unchanged,
//    replaced the image, and supplied `at: (221, 95.5)` — the shop's existing
//    World position — into its frozen historical path under
//    `the-town/the-town-centre`. The fold treated those World coordinates as
//    legacy coordinates relative to the Town Centre origin (-54, -79.5),
//    producing World (167, 16). The shop moved 54 metres west and 79.5 metres
//    north, lost Chez Antoine as parent, and its standing cone children
//    reparented away."
//
// The settlement commit (world `9b280104`) shows the file exactly:
//
//   -at: { x: 275, y: 175 }
//   +at: { x: 221, y: 95.5 }
//
// THE RESIDENT MOVED NOTHING. #2151's rule stands: the record stores what the
// resident spoke (world), and the carriage into a filing path converts once, at
// the drain's `fileFramer`. This row was carried by a path that did not
// convert — `store-writedown.mjs`, in the drain's place since G1 (2026-09-08),
// handed bytes alone by the fold's entry. The receipt said so in its own
// vocabulary: `serialized_here: 0, supplied_bytes_only: 3`, under a comment
// saying that number should be 0.
//
// ── WHAT THIS FILE PROVES ────────────────────────────────────────────────────
//
// Over a world shaped like the live one (the town-centre frame at its real
// origin, chez-antoine and the shop at their real numbers, a cone at the shop,
// the freeze manifest, `coords: relative` on the root record) and the STORE'S
// EXACT ROW for the amend, read from `world2_dev.marks` on 2026-09-18:
//
//   · the write-down frames the row at its frozen path — the file says
//     (275, 175) again, plus the new picture;
//   · THE WORLD'S OWN FOLD, run over the sketchbook the write-down built, places
//     the shop at (221, 95.5) with chez-antoine as its parent and the cone
//     still parented to the shop — the same three facts the fold reads off
//     canon before the carriage. That is the invariant, and the file's numbers
//     are only one instance of it;
//   · a write-down with no framer REFUSES the nested world-framed row rather
//     than landing it raw; a supplier that does not name the frame is refused
//     the same way;
//   · THE OLD SHAPE, kept as an executable memory: the same bytes carried
//     unframed land the shop at (167, 16) under the town centre — 54 west,
//     79.5 north, exactly the keeper's numbers.
//
// The real fold is borrowed from a world checkout (`POSTMARK_WORLD_CLONE`,
// `WORLD_CLONE`, `../postmark-world`), the way `crossing-registry-real-sweep`
// borrows the real sweep; without one the fold assertions skip BY NAME.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { fileFramer } from "../src/world-drain.mjs";
import { FoldInputRefusal, planStoreWriteDown, normalizeMark, storeWriteDown } from "../src/store-writedown.mjs";
import { frameOfRow, renderedMark } from "../world2/tools/mark-render.mjs";

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
const CENTRE_DIR = `${ROOT}/the-town-centre`;
const SHOP_FILE = `${CENTRE_DIR}/le-petit-berthillon/mark.md`;
const CENTRE_ORIGIN = { x: -54, y: -79.5 };       // the town centre's world position — the frame
const SHOP_WORLD = { x: 221, y: 95.5 };            // where the shop stands, and what the resident spoke
const SHOP_FILE_AT = { x: 275, y: 175 };           // world − origin: what the file at the frozen path must say
const MOVED_TO = { x: 167, y: 16 };                // origin + world: where the raw carriage put it (the keeper's number)
const OLD_IMAGE = "https://media.postmark.town/berthillon-berthillon-home-card.jpg";
const NEW_IMAGE = "https://media.postmark.town/media/devadavisson/312220fe77bc8caf8c0ec8edf40d92b4d345303bba354fed28c31b112ae046b0.jpg";
const BODY = "Le Petit Berthillon — amber-windowed ice-cream shop on the near-bank quay. Marble counter, violet pocket-square, bell that rings once.";

/**
 * THE STORE'S ROW, verbatim: `world2_dev.marks` for `berthillon/le-petit-berthillon`
 * as read through `snapshot_reader` on 2026-09-18 after the 05:45Z crossing.
 * `geometry.at` is the world position; `data` is the claim's, rewritten whole
 * by `materialize.mjs § materializeClaims` on the amend — so no `_fileAt`, and
 * that absence is the whole case.
 */
const STORE_ROW = {
  slug: "berthillon/le-petit-berthillon", kind: "sited", owner: "berthillon", household: "gh:314022791",
  locked_window: 196, status: "standing",
  geometry: { at: { ...SHOP_WORLD }, slug: "berthillon/le-petit-berthillon", extent: { h: 12, w: 15 } },
  data: {
    by: "berthillon", date: "2026-09-18T04:48:37.857Z", kind: "sited", tier: "market", image: NEW_IMAGE,
    _act_id: "6607", parent_id: "berthillon/chez-antoine", _journal_seq: null,
  },
  body: BODY,
};

const rec = (fields, body) => `---\n${fields.join("\n")}\n---\n\n${body}\n`;

/**
 * A world shaped like the live one in every way this carriage touched: the
 * root declares `coords: relative`; the town centre is a constitution frame at
 * (-54, -79.5); chez-antoine (25×25, home) and the shop (15×12) are filed under
 * it at (275, 175) — the file's numbers, composing to (221, 95.5); one cone
 * stands at the shop's centre, filed at its root-framed identity path; the
 * freeze manifest names the fossil filings. The REAL fold writes the folded
 * state, exactly as the settlement clone's main carries it.
 */
function liveShapedWorld(t) {
  const repo = mkdtempSync(join(tmpdir(), "postmark-storewd-frame-"));
  t.after(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* litter */ } });
  const put = (p, text) => { mkdirSync(join(repo, dirname(p)), { recursive: true }); writeFileSync(join(repo, p), text); };
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  cpSync(join(WORLD, "tools"), join(repo, "tools"), { recursive: true });
  put("package.json", JSON.stringify({ name: "world-fixture", type: "module" }));
  put("WORLD/skeleton.json", `${JSON.stringify({ features: [], physics_registry: {} }, null, 2)}\n`);
  put("WORLD/households.json", `${JSON.stringify({ households: { devadavisson: "gh:314022791" }, logins: { devadavisson: "gh:314022791" } }, null, 2)}\n`);

  put(`${ROOT}/mark.md`, rec(["kind: sited", "by: the-town", "tier: constitution", "date: 2026-07-22",
    "at: { x: 0, y: 0 }", "extent: { w: 320000, h: 320000 }", "coords: relative"], "Let there be light."));
  put(`${CENTRE_DIR}/mark.md`, rec(["by: the-town", "kind: sited", "date: 2026-07-23", "tier: constitution",
    `at: { x: ${CENTRE_ORIGIN.x}, y: ${CENTRE_ORIGIN.y} }`, "extent: { w: 2092, h: 1745 }", "pre: true"], "Lanterns burn late along the river quay."));
  put(`${CENTRE_DIR}/chez-antoine/mark.md`, rec(["kind: sited", "by: berthillon", "date: 2026-08-25",
    `at: { x: ${SHOP_FILE_AT.x}, y: ${SHOP_FILE_AT.y} }`, "extent: { w: 25, h: 25 }"], "Chez Antoine — the house behind the shop."));
  put(SHOP_FILE, rec(["kind: sited", "by: berthillon", "date: 2026-08-28T07:09:00.392Z",
    `at: { x: ${SHOP_FILE_AT.x}, y: ${SHOP_FILE_AT.y} }`, "extent: { w: 15, h: 12 }", `image: ${OLD_IMAGE}`], BODY));
  put("WORLD/marks/berthillon/cone-reine-claude-2026-09-17/mark.md", rec(["kind: sited", "by: berthillon",
    "date: 2026-09-17T13:09:17.838Z", `at: { x: ${SHOP_WORLD.x}, y: ${SHOP_WORLD.y} }`, "extent: { w: 1, h: 1 }"], "A reine-claude cone, handed over the counter."));

  // THE FOSSIL MANIFEST — id → directory, minted once. The framer inverts it.
  put("WORLD/filing-freeze.json", `${JSON.stringify({
    frozen_at: "2026-08-25",
    marks: {
      "the-town/the-town-centre": CENTRE_DIR,
      "berthillon/chez-antoine": `${CENTRE_DIR}/chez-antoine`,
      "berthillon/le-petit-berthillon": `${CENTRE_DIR}/le-petit-berthillon`,
    },
  }, null, 2)}\n`);

  git("init", "-q", "-b", "main");
  execFileSync(process.execPath, [join(repo, "tools", "marks-fold.mjs")], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "canon");
  return { repo, git };
}

/**
 * The real fold over a ref of the fixture: materialize the ref's `WORLD/` blob
 * by blob (no `tar` — Windows' reads `C:` as a host), borrow the same tools,
 * run `marks-fold.mjs`, read what it placed.
 */
function foldAt({ repo, git }, ref) {
  const dir = mkdtempSync(join(tmpdir(), "postmark-storewd-fold-"));
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
    return { shop: of("berthillon/le-petit-berthillon"), cone: of("berthillon/cone-reine-claude-2026-09-17"), house: of("berthillon/chez-antoine") };
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* litter */ } }
}

const foldInput = (marks) => ({
  marks, stakes: [],
  as_of: { window: 196, world_sha: "5b8b05b776cf8a44b97fb557689618e7f47071e2", town_sha: "422dbe6f2b5b4fc0eaae69c5f2c8058d259d8d98" },
  selection: { by: "docket", window: 196, docket_claims: 1, carried_absent: { checked: true, count: 0 } },
});

/** The fold's entry, for the store's row — what `foldDelta` hands the write-down. */
const entryFor = (row) => ({
  slug: row.slug, kind: row.kind, by: row.owner, household: row.household, locked_window: row.locked_window,
  status: row.status, founder_commit: null, ...renderedMark(row),
});

test("the store's row is WORLD-framed, and the entry says so beside the bytes", () => {
  assert.equal(frameOfRow(STORE_ROW), "world", "an amended row carries no `_fileAt` — its numbers are the resident's world position");
  assert.equal(frameOfRow({ ...STORE_ROW, data: { ...STORE_ROW.data, _fileAt: { x: 275, y: 175 } } }), "file",
    "a seeded row keeps the file's own numbers, and says so");
  assert.equal(frameOfRow({ ...STORE_ROW, geometry: null }), null, "no geometry, no frame to name");
  const e = entryFor(STORE_ROW);
  assert.equal(e.at_frame, "world");
  assert.match(e.bytes, /^at: \{ x: 221, y: 95\.5 \}$/m, "the bytes carry the world number — exactly what the crossing wrote raw");
  assert.deepEqual(e.fileRec.at, SHOP_WORLD);
});

test("THE LIVE CASE, at the plan: the row lands at its frozen path FRAMED — the file says (275, 175) again, with the new picture", async (t) => {
  const { repo } = liveShapedWorld(t);
  const toFileFrame = await fileFramer(repo);
  assert.equal(typeof toFileFrame, "function", "the tree declares coords: relative, so there is a converter to reach");

  const m = normalizeMark(entryFor(STORE_ROW));
  const plan = planStoreWriteDown([m], {
    publishedPathOf: (id) => (id === "berthillon/le-petit-berthillon" ? SHOP_FILE : null),   // GATE A
    canonBytesAt: () => null,
    toFileFrame,
  });
  const u = plan.households[0].upserts[0];
  assert.equal(u.path, SHOP_FILE, "Gate A: the frozen filing, nothing moves");
  assert.deepEqual(u.fileRec.at, SHOP_FILE_AT,
    "the file's number is the offset from the town centre's origin — 275/175, what the file said before the amend");
  assert.match(u.bytes, /^at: \{ x: 275, y: 175 \}$/m);
  assert.match(u.bytes, new RegExp(`^image: ${NEW_IMAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), "the picture changed — that is what the amend was");
  assert.equal(plan.counts.framed, 1);
  assert.deepEqual(plan.framed[0], { id: "berthillon/le-petit-berthillon", path: SHOP_FILE, from: { at: SHOP_WORLD, points: null }, to: { at: SHOP_FILE_AT } });

  // THE PROPERTY, as the round trip: whatever the file says, composed against
  // the frame it is written in, is the position the resident spoke.
  assert.deepEqual({ x: u.fileRec.at.x + CENTRE_ORIGIN.x, y: u.fileRec.at.y + CENTRE_ORIGIN.y }, SHOP_WORLD);
});

test("THE FOLD'S WORD: after the carriage the world's own fold places the shop where it stood, chez-antoine still its parent, the cone still the shop's", { skip: WHY_SKIP }, async (t) => {
  const w = liveShapedWorld(t);
  const before = foldAt(w, "main");
  // The control, read off canon rather than typed: the three facts the amend
  // must leave alone.
  assert.deepEqual(before.shop.at, SHOP_WORLD);
  assert.equal(before.shop.parent, "berthillon/chez-antoine");
  assert.equal(before.cone.parent, "berthillon/le-petit-berthillon");

  const report = storeWriteDown({
    repo: w.repo, input: foldInput([entryFor(STORE_ROW)]), at: Date.parse("2026-09-18T05:45:00.000Z"),
    toFileFrame: await fileFramer(w.repo),
  });
  assert.equal(report.written, 1);
  assert.equal(report.framer, true);
  assert.equal(report.framed.length, 1, "the receipt names the row the framer touched");
  const branch = report.households[0].branch;
  const written = w.git("show", `${branch}:${SHOP_FILE}`);
  assert.match(written, /^at: \{ x: 275, y: 175 \}$/m, "the sketchbook carries the framed number");
  assert.match(written, /312220fe77bc8caf8c0ec8edf40d92b4d345303bba354fed28c31b112ae046b0/, "and the new picture");

  const after = foldAt(w, branch);
  assert.deepEqual(after.shop.at, SHOP_WORLD, "the shop stands where it stood");
  assert.equal(after.shop.parent, "berthillon/chez-antoine", "chez-antoine is still its parent");
  assert.equal(after.cone.parent, "berthillon/le-petit-berthillon", "the cone is still the shop's");
  assert.deepEqual(after.house, before.house, "and the house did not move either");
});

test("THE OLD SHAPE IS THE BUG, kept as an executable memory: the same bytes carried unframed put the shop at (167, 16) under the town centre", { skip: WHY_SKIP }, (t) => {
  const w = liveShapedWorld(t);
  // Exactly what shipped: the store's bytes, filed by Gate A, with nothing
  // between the row and the file. A supplier saying `file` for a world number
  // is the one way to make today's write-down do it.
  const report = storeWriteDown({
    repo: w.repo, input: foldInput([{ ...entryFor(STORE_ROW), at_frame: "file" }]), at: Date.parse("2026-09-18T05:45:00.000Z"),
    toFileFrame: null,
  });
  assert.equal(report.framed.length, 0);
  const after = foldAt(w, report.households[0].branch);
  assert.deepEqual(after.shop.at, MOVED_TO, "54 west, 79.5 north — the keeper's numbers, produced silently under a green suite");
  assert.equal(after.shop.parent, "the-town/the-town-centre", "chez-antoine is no longer its parent");
  assert.equal(after.cone.parent, "berthillon/chez-antoine", "and the cone has reparented away from the shop");
});

test("NO FRAMER, NO CARRIAGE: a world-framed row at a nested path refuses rather than landing raw", async (t) => {
  const { repo } = liveShapedWorld(t);
  const e = (() => { try { storeWriteDown({ repo, input: foldInput([entryFor(STORE_ROW)]), at: Date.now() }); return null; } catch (x) { return x; } })();
  assert.ok(e instanceof FoldInputRefusal, "a refusal, under its own name");
  assert.equal(e.reason, "mark-frame-unavailable");
  assert.match(e.detail, /le-petit-berthillon lands at the nested filing/);

  // A supplier that did not say which frame the numbers are in is refused the
  // same way — the plan will not guess.
  const framer = await fileFramer(repo);
  const unnamed = (() => { try { storeWriteDown({ repo, input: foldInput([{ ...entryFor(STORE_ROW), at_frame: undefined }]), at: Date.now(), toFileFrame: framer }); return null; } catch (x) { return x; } })();
  assert.equal(unnamed?.reason, "mark-frame-unnamed");

  // Bytes alone — what the fold's entry handed the write-down until today — are
  // refused at a nested path too: the bytes can be seen to carry a position
  // and cannot be framed, and that is exactly the crossing that moved the shop.
  const { fileRec: _r, body: _b, at_frame: _f, ...bytesOnly } = entryFor(STORE_ROW);
  const raw = (() => { try { storeWriteDown({ repo, input: foldInput([bytesOnly]), at: Date.now(), toFileFrame: framer }); return null; } catch (x) { return x; } })();
  assert.equal(raw?.reason, "mark-frame-unnamed");
  assert.match(raw?.detail ?? "", /handed bytes with no record/);

  // And a frame the framer cannot resolve — a nested path under a directory the
  // manifest does not name, and no `parent_id` to fall back on (a sited mark
  // carries none in the door's grammar; Berthillon's row happened to) — refuses
  // rather than converting by guesswork.
  const noParent = { ...STORE_ROW, data: { ...STORE_ROW.data } };
  delete noParent.data.parent_id;
  const orphan = (() => {
    try {
      planStoreWriteDown([normalizeMark({ ...entryFor(noParent), slug: "berthillon/somewhere-else" })], {
        publishedPathOf: () => `${ROOT}/no-such-frame/somewhere-else/mark.md`, canonBytesAt: () => null, toFileFrame: framer,
      });
      return null;
    } catch (x) { return x; }
  })();
  assert.equal(orphan?.reason, "mark-frame-unresolved");
});

test("THE CONTROLS: a root-framed row is untouched, and a FILE-framed row at a nested path keeps the file's own numbers", async (t) => {
  const { repo } = liveShapedWorld(t);
  const toFileFrame = await fileFramer(repo);

  // A create — Gate B files it at its identity, root-framed; the world number is the file number.
  const cone = { ...STORE_ROW, slug: "berthillon/cone-cassis-noir-2026-09-18", geometry: { at: { x: 221, y: 95.5 }, extent: { w: 1, h: 1 } },
    data: { by: "berthillon", date: "2026-09-18T06:00:00.000Z", kind: "sited", _act_id: "6608" }, body: "A cassis-noir cone." };
  const create = planStoreWriteDown([normalizeMark(entryFor(cone))], { publishedPathOf: () => null, canonBytesAt: () => null, toFileFrame });
  assert.equal(create.households[0].upserts[0].path, "WORLD/marks/berthillon/cone-cassis-noir-2026-09-18/mark.md");
  assert.deepEqual(create.households[0].upserts[0].fileRec.at, { x: 221, y: 95.5 }, "nothing shifts at the root");
  assert.equal(create.counts.framed, 0);

  // A seeded row at the frozen path — `_fileAt` present — is the file's own
  // numbers already, and the framer is not run over them (it would subtract
  // the origin a second time: the doubling #2151 was filed on).
  const seeded = { ...STORE_ROW, data: { ...STORE_ROW.data, _fileAt: { ...SHOP_FILE_AT }, _origin: { ...CENTRE_ORIGIN } } };
  const e = entryFor(seeded);
  assert.equal(e.at_frame, "file");
  assert.deepEqual(e.fileRec.at, SHOP_FILE_AT, "the renderer wrote the file's numbers");
  const kept = planStoreWriteDown([normalizeMark(e)], { publishedPathOf: () => SHOP_FILE, canonBytesAt: () => null, toFileFrame });
  assert.deepEqual(kept.households[0].upserts[0].fileRec.at, SHOP_FILE_AT, "left as they are");
  assert.equal(kept.counts.framed, 0);
});

test("the unchanged economy compares the FRAMED bytes against canon — a re-run of the same amend writes nothing", async (t) => {
  const w = liveShapedWorld(t);
  const toFileFrame = await fileFramer(w.repo);
  // Canon as it would stand after the first carriage: the framed bytes at the path.
  const first = planStoreWriteDown([normalizeMark(entryFor(STORE_ROW))], { publishedPathOf: () => SHOP_FILE, canonBytesAt: () => null, toFileFrame });
  const canon = first.households[0].upserts[0].bytes;
  const again = planStoreWriteDown([normalizeMark(entryFor(STORE_ROW))], { publishedPathOf: () => SHOP_FILE, canonBytesAt: (p) => (p === SHOP_FILE ? canon : null), toFileFrame });
  assert.equal(again.counts.written, 0, "the same row, the same frame, the same bytes: unchanged");
  assert.equal(again.counts.unchanged, 1);
  assert.equal(again.counts.framed, 1, "framed, then found unchanged — the framer ran before the comparison, which is the only order that makes the comparison mean anything");
});
