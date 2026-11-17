// movement-fixture.mjs — a running ferry service in a bottle, for Stage D.
//
// Two things, and nothing else:
//
//   a world CLONE   a git repo with a `main` carrying the world's REAL
//                   `tools/walk.mjs`, `tools/vessel.mjs` and `tools/geometry.mjs`
//                   — copied, not reimplemented. The dynamic-layer fixture
//                   writes a faithful MINIATURE of walk.mjs because what it
//                   falsifies is whether the saved bytes carry enough to
//                   reconstitute a world, and the arithmetic cancels on both
//                   sides of that comparison. Here it does not cancel: what is
//                   under test IS the arithmetic — where a scheduled boat is at
//                   an instant, and whether standing on her deck at a cast-off
//                   carries you. A miniature timetable would only ever prove
//                   that the miniature agrees with itself.
//
//   a MARKS ARRAY   a two-stop line and a vessel with a real footprint. Passed
//                   to the movement module directly, because `movementStandpoint`
//                   takes the folded world as an argument — so a fixture world
//                   needs no directory tree, no fold, and no lint.
//
// The clone must be a git repo with a main branch because the office reads
// engine code AT A REF and never from a working tree; a fixture that skipped
// that would be testing an import path the office does not use.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers/temp-dir.mjs";

import { WORLD_CLONE } from "../src/world-store.mjs";

/** The three modules the movement path actually loads at a ref. */
export const ENGINE_FILES = ["walk.mjs", "vessel.mjs", "geometry.mjs"];

// The world's own clock, restated here ONLY as a test's way of naming an
// instant — every arithmetic answer comes from the copied modules.
export const EPOCH = Date.UTC(2026, 5, 12);
export const CROSSING_MS = 12 * 3600 * 1000;
export const atCrossing = (fc) => EPOCH + fc * CROSSING_MS;

// A short line so a leg is minutes rather than hours: two stops 4 km apart at
// 40 km per crossing is a 0.1-crossing sailing, which lets a test watch a whole
// voyage — cast off, under way, berthed — inside one crossing.
export const QUAY = { x: 0, y: 0 };
export const FAR_SHORE = { x: 4000, y: 0 };

export function fixtureMarks({ pace = 40 } = {}) {
  return [
    { id: "the-town/the-quay", kind: "sited", by: "the-town", at: { ...QUAY }, extent: { w: 20, h: 20 } },
    { id: "the-town/the-far-shore", kind: "sited", by: "the-town", at: { ...FAR_SHORE }, extent: { w: 20, h: 20 } },
    // The vessel is a mark with an extent, because boarding is presence inside
    // her footprint and a boat with no footprint has no deck to stand on.
    { id: "the-town/the-post-office", kind: "sited", by: "the-town", at: { ...QUAY }, extent: { w: 10, h: 26 } },
    // The class fields ride the fixture's marks directly. The LIVE world's fold
    // drops `class:`/`mobility:` (they reach the office through world.db), and
    // `carriersWithDisclosure` prefers the fold whenever it has them — so a
    // fixture that declares them exercises the same carrier derivation without
    // needing a hydrated store, and it is also what the fold will look like the
    // day the world's own generator carries the fields through.
    {
      id: "the-town/the-wheelhouse", kind: "sited", by: "the-town", at: { x: 0, y: 1 }, extent: { w: 4, h: 2 },
      mechanic: "timetable", class: "timetable", mobility: "derived",
      timetable: {
        vessel: "the-town/the-post-office",
        pace,
        stops: [
          { mark: "the-town/the-post-office", departs: ["06:00Z"] },
          { mark: "the-town/the-far-shore", departs: ["18:00Z"] },
        ],
      },
    },
  ];
}

/** A git world clone carrying the real engine at `main`. Caller removes it. */
export function makeWorldClone({ from = WORLD_CLONE } = {}) {
  const dir = tempDir("stageD-world-");
  mkdirSync(join(dir, "tools"), { recursive: true });
  for (const f of ENGINE_FILES) copyFileSync(join(from, "tools", f), join(dir, "tools", f));
  writeFileSync(join(dir, "README.md"), "movement fixture world\n", "utf8");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "fixture@postmark.test");
  git("config", "user.name", "fixture");
  git("add", "-A");
  git("commit", "-q", "-m", "the engine at a ref");
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A walk-record departure in the shape walk.mjs and vessel.mjs both read. */
export const departure = ({ handle, from, toward, at, within = null, to = null, pace = null }) => ({
  iso: new Date(atCrossing(at)).toISOString(),
  handle, from, toward, at, targetExtent: within, targetMarkId: to, pace,
});
