// world-drain-frame.test.mjs — THE MOUNTAIN THAT THE MACHINERY MOVED.
//
// ── THE LIVE CASE ────────────────────────────────────────────────────────────
//
// 2026-08-27T01:13:12.971Z, an amend of `vermillion/the-pando-peak` drained, and
// the record that landed on `draft/FluffUPando` said (Wright's revert diff,
// world `577a1b6e`, verbatim):
//
//   -kind: sited
//    by: vermillion
//   -date: 2026-08-27T01:13:12.971Z
//   -at: { x: -95458, y: -95458 }
//   +date: 2026-07-24
//   +at: { x: 0, y: 0 }
//    extent: { w: 3600, h: 3600 }
//
// The file sits at `WORLD/marks/let-there-be-light/pando-peak/the-pando-peak/
// mark.md` — nested under the `pando-peak` region, whose COMPOSED CENTRE is
// exactly (-95458, -95458). The standing record said `at: { x: 0, y: 0 }`,
// meaning "at the centre of pando-peak", which composes to (-95458, -95458) —
// the mountain's true world position. The drained amend wrote the WORLD
// coordinate into that relative frame, so it composed to about
// (-190916, -190916): ~95km outside the world, and the landing that stands on
// this peak went with it. Eleven vessel/timetable tests red at 03:22:57Z; the
// whole town's crossing refused; a human reverted it by hand at 03:50Z.
//
// THE RESIDENT MOVED NOTHING. They restated their mountain's true world position
// — which is precisely what the journal is specified to store. The machinery
// doubled it.
//
// ── WHY IT SURVIVED THE TESTS THAT EXIST ─────────────────────────────────────
//
// `world-drain.test.mjs` carries a test literally named "THE FREEZE — a sited
// draft is never nested, so the write-down's frame conversion has no live caller
// at this door", whose framer THROWS if reached. It passes, and it is not wrong:
// its fixture is a CREATE, `publishedPathOf` answers null for the mark, Gate B
// files it at `WORLD/marks/<by>/<slug>/`, and that really is root-framed.
//
// An AMEND is the other gate. Gate A hands a mark that main already holds its
// FROZEN FOSSIL FILING — three segments deep, nested, relative-framed — so the
// framer IS reached. It then could not answer, because it resolved its origin
// from `parent_id` and a sited mark carries no `parent_id` in the door's
// grammar. `{}` came back, and `{}` reads exactly like "root-level, nothing to
// shift".
//
// The premise was TRUE when it was written and the freeze made it false on
// 2026-08-25. The comment went on being read as current for two days.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers/temp-dir.mjs";

import { fileFramer, planDrain } from "../src/world-drain.mjs";
import { ACTION_LEAVE, CLASS_MARK } from "../src/world-journal.mjs";

const ROOT = "WORLD/marks/let-there-be-light";
const PEAK_FILE = `${ROOT}/pando-peak/the-pando-peak/mark.md`;
const REGION_FILE = `${ROOT}/pando-peak/mark.md`;
// The real numbers, from the live record.
const REGION_CENTRE = { x: -95458, y: -95458 };
const PEAK_WORLD = { x: -95458, y: -95458 };   // the peak stands AT the region's centre

/**
 * A world shaped like the live one in the three ways this bug needed:
 * `coords: relative` declared on the ROOT RECORD (not in the folded state), a
 * `filing-freeze.json` naming the fossil filings, and a folded state carrying
 * the region's composed centre.
 */
function liveShapedWorld(t) {
  const repo = tempDir("postmark-drain-frame-");
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const put = (p, text) => {
    mkdirSync(join(repo, p.split("/").slice(0, -1).join("/")), { recursive: true });
    writeFileSync(join(repo, p), text);
  };

  // The clone's own marks-fold, so the framer imports a real `worldToFile`.
  mkdirSync(join(repo, "tools"), { recursive: true });
  writeFileSync(join(repo, "tools", "marks-fold.mjs"), [
    'export const COORDS_FIELD = "coords";',
    'export const COORDS_RELATIVE = "relative";',
    "export const worldToFile = (at, origin) => ({ x: at.x - (origin?.x ?? 0), y: at.y - (origin?.y ?? 0) });",
    "export const fileToWorld = (at, origin) => ({ x: at.x + (origin?.x ?? 0), y: at.y + (origin?.y ?? 0) });",
    "export const ringToFile = (points, origin) => points.map((p) => worldToFile(p, origin));",
    "",
  ].join("\n"));

  const rec = (fields, body) => `---\n${fields.join("\n")}\n---\n\n${body}\n`;
  put(`${ROOT}/mark.md`, rec(["kind: sited", "by: the-town", "tier: constitution",
    "coords: relative", "at: { x: 0, y: 0 }", "extent: { w: 320000, h: 320000 }"], "the frame"));
  put(REGION_FILE, rec(["kind: sited", "by: the-town", `at: ${JSON.stringify(REGION_CENTRE)}`,
    "extent: { w: 8000, h: 8000 }"], "the region north of the terraces"));
  put(PEAK_FILE, rec(["kind: sited", "by: vermillion", "date: 2026-07-24",
    "at: { x: 0, y: 0 }", "extent: { w: 3600, h: 3600 }"], "A mountain kept as one house."));

  // The FOLDED state — composed world coordinates, and deliberately carrying NO
  // `coords` field, exactly as the live world-state.json does not.
  put("WORLD/world-state.json", JSON.stringify({
    marks: [
      { id: "the-town/let-there-be-light", at: { x: 0, y: 0 }, extent: { w: 320000, h: 320000 } },
      { id: "the-town/pando-peak", at: REGION_CENTRE, extent: { w: 8000, h: 8000 } },
      { id: "vermillion/the-pando-peak", at: PEAK_WORLD, extent: { w: 3600, h: 3600 } },
    ],
  }, null, 2));

  // THE FOSSIL MANIFEST — id → directory, never regenerated. Inverting it is how
  // the framer learns which mark owns a directory.
  put("WORLD/filing-freeze.json", JSON.stringify({
    marks: {
      "the-town/pando-peak": `${ROOT}/pando-peak`,
      "vermillion/the-pando-peak": `${ROOT}/pando-peak/the-pando-peak`,
    },
  }, null, 2));

  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "the world");
  return { repo, git };
}

/** The amend exactly as the door writes it: world coordinates, no parent_id. */
const AMEND_ROW = {
  seq: 1, crossing: 152, actor: "vermillion", action: ACTION_LEAVE,
  object: "vermillion/the-pando-peak", class: CLASS_MARK, household: "FluffUPando",
  written_at: "2026-08-27T01:13:12.971Z", at: null, witnesses: null, effect: null,
  payload: {
    slug: "the-pando-peak", by: "vermillion", kind: "sited",
    at: PEAK_WORLD, extent: { w: 3600, h: 3600 },
    body: "A mountain kept as one house.", amend: true,
    // NO parent_id. A sited mark carries none in the door's grammar — this
    // absence is the whole bug, so it is spelled out rather than merely omitted.
  },
};

test("THE LIVE CASE: an amend of a mark filed at a FOSSIL nested path is framed on that path's own parent — the mountain stays where the resident put it", async (t) => {
  const { repo } = liveShapedWorld(t);
  const toFileFrame = await fileFramer(repo);
  assert.equal(typeof toFileFrame, "function", "the tree declares coords: relative, so there is a converter to reach");

  const plan = planDrain([AMEND_ROW], {
    // GATE A: the mark is already filed, so its frozen fossil filing is what
    // comes back — this is the branch a CREATE never takes and the reason the
    // existing freeze test could not see this.
    publishedPathOf: (id) => (id === "vermillion/the-pando-peak" ? PEAK_FILE : null),
    toFileFrame,
  });

  const upsert = plan.households[0].upserts[0];
  assert.equal(upsert.path, PEAK_FILE, "it lands at its fossil filing — nothing moves, per the freeze");
  assert.deepEqual(upsert.fileRec.at, { x: 0, y: 0 },
    "AND ITS at IS THE OFFSET FROM ITS PARENT'S CENTRE. Before this fix it was { x: -95458, y: -95458 } — "
    + "the world coordinate written raw into a relative frame, which composed to ~(-190916, -190916), "
    + "95km outside the world, and refused the whole town's settlement at 03:22:57Z.");

  // THE PROPERTY, stated as the round trip rather than as a number: whatever the
  // file says, composing it against the frame it is written in must give back
  // the world position the resident actually spoke.
  const composed = { x: upsert.fileRec.at.x + REGION_CENTRE.x, y: upsert.fileRec.at.y + REGION_CENTRE.y };
  assert.deepEqual(composed, PEAK_WORLD,
    "the file composes back to exactly the coordinate the journal carried — this is the invariant, and the number above is only one instance of it");
});

test("THE CONTROL: a CREATE still files at its id and its numbers still reach the file unshifted", async (t) => {
  const { repo } = liveShapedWorld(t);
  const toFileFrame = await fileFramer(repo);
  const create = {
    ...AMEND_ROW, seq: 2, object: "vermillion/a-new-cairn",
    payload: { ...AMEND_ROW.payload, slug: "a-new-cairn", at: { x: 4242, y: -17 }, amend: false },
  };
  const plan = planDrain([create], { publishedPathOf: () => null, toFileFrame });
  const upsert = plan.households[0].upserts[0];
  assert.equal(upsert.path, "WORLD/marks/vermillion/a-new-cairn/mark.md",
    "Gate B files a mark with no filing at its identity");
  assert.deepEqual(upsert.fileRec.at, { x: 4242, y: -17 },
    "and WORLD/marks/<by>/<slug>/ is framed on the world, so nothing shifts — the freeze test's premise, still true for a create");
});

test("THE FRAMER answers from the PATH, and falls back to parent_id — never guesses", async (t) => {
  const { repo } = liveShapedWorld(t);
  const framer = await fileFramer(repo);

  assert.deepEqual(framer({ at: PEAK_WORLD, points: null, parent_id: null, path: PEAK_FILE }),
    { at: { x: 0, y: 0 } }, "the path names the enclosing mark, and its composed centre is the frame");

  assert.deepEqual(framer({ at: { x: 111, y: 222 }, points: null, parent_id: "the-town/pando-peak", path: null }),
    { at: { x: 111 - REGION_CENTRE.x, y: 222 - REGION_CENTRE.y } },
    "parent_id still works — predicated and naming marks carry one and nothing about them changed");

  assert.deepEqual(framer({ at: { x: 5, y: 6 }, points: null, parent_id: null, path: "WORLD/marks/vermillion/a-new-cairn/mark.md" }),
    {}, "a path with no enclosing mark gets NO conversion, which is the right answer for a root-framed file");

  assert.deepEqual(framer({ at: { x: 5, y: 6 }, points: null, parent_id: null, path: `${ROOT}/some-unknown-thing/deeper/mark.md` }),
    {}, "and an ancestor the manifest does not name is not guessed at — null means do not convert");
});

test("THE OLD SHAPE IS THE BUG, kept as an executable memory: a framer answering only from parent_id writes the world coordinate raw", async (t) => {
  const { repo } = liveShapedWorld(t);
  const framer = await fileFramer(repo);
  // Exactly what the pre-fix framer did — resolve from parent_id alone — on
  // exactly the live payload. This is what shipped, and what it produced.
  const parentIdOnly = ({ at, parent_id }) => {
    const state = JSON.parse(execFileSync("git", ["-C", repo, "show", "main:WORLD/world-state.json"], { encoding: "utf8" }));
    const origin = parent_id ? state.marks.find((m) => m.id === parent_id)?.at : null;
    return origin ? { at: { x: at.x - origin.x, y: at.y - origin.y } } : {};
  };
  const broken = planDrain([AMEND_ROW], { publishedPathOf: () => PEAK_FILE, toFileFrame: parentIdOnly });
  assert.deepEqual(broken.households[0].upserts[0].fileRec.at, PEAK_WORLD,
    "the world coordinate, raw, in a relative-framed file — 95km of error, produced silently");

  const fixed = planDrain([AMEND_ROW], { publishedPathOf: () => PEAK_FILE, toFileFrame: framer });
  assert.notDeepEqual(fixed.households[0].upserts[0].fileRec.at, PEAK_WORLD,
    "and the fix must actually differ from it, or this whole file asserts nothing");
});
