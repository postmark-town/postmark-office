// origin-name.test.mjs — the grid origin {0,0} is named THE ORIGIN, and the
// office is the door that says so (#2752, Keemin 2026-09-13: "can we just…
// call 0,0 the Origin?").
//
// Why this file exists: the origin used to borrow the word "quay" — the
// spectator standpoint read "the quay (Ferry's crossing)" — while the only mark
// actually named `the-town/the-quay` stands thirty metres from nothing in the
// Long Run at (1390, 5665). Two quays, and the one a resident met first was the
// one that is not a place. The name is now the Origin, and these are the two
// standpoints where a resident meets it.
//
// WHAT IS UNDER TEST IS THE OFFICE'S OWN WORD. Both strings are the door's
// vocabulary over the engine's answer — `src/world.mjs` says so above
// `homeCoords`: "the door's own vocabulary (`from`, and the Origin default for
// the unplaced) is the office's to speak". So the spectator half calls the
// module's standpoint chooser directly, and the no-ground half stubs the ENGINE
// at the path the office loads it from and reads the phrasing the office puts
// over it.
//
// THE SPECTATOR HALF IS THE PUBLISHED STRING. `chooseStandpoint(...).coords` is
// spread verbatim into the apex's `standpoint` (src/world.mjs, the two
// `standpoint: { ...at, stance: choice.stance }` assemblies), which is what
// `GET /world/apex` serves keyless and what the World page shows. Asserting the
// chooser is asserting the door, without standing up a server.
//
//   node --test test/origin-name.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── the engine, stubbed at the office's own import seam ──────────────────────
// The office loads the world's `tools/where-is.mjs` out of WORLD_CLONE at act
// time. A stub that answers "unplaced" is the whole engine input the no-ground
// branch needs, and it keeps this file free of a git clone and a fold.
const clone = mkdtempSync(join(tmpdir(), "postmark-origin-name-"));
mkdirSync(join(clone, "tools"), { recursive: true });
writeFileSync(join(clone, "tools", "where-is.mjs"),
  "export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });\n"
  + "export function homeOf() { return { ...NOWHERE }; }\n"
  + "export function whereIs() { return { ...NOWHERE }; }\n");
process.env.WORLD_CLONE = clone;
process.on("exit", () => rmSync(clone, { recursive: true, force: true }));

const { chooseStandpoint, homeCoords } = await import("../src/world.mjs");

test("FALSIFIER — the spectator standpoint's `from` is the Origin", () => {
  // keyless, and a key that holds no residents: both are the spectator shape
  const keyless = chooseStandpoint({}, null);
  const visitor = chooseStandpoint({}, { handles: new Set() });

  assert.equal(keyless.coords.from, "the Origin");
  assert.equal(visitor.coords.from, "the Origin");
  assert.equal(keyless.stance, "spectator");
  // the name is the origin's, so it must arrive on the origin's coordinates
  assert.deepEqual({ x: keyless.coords.x, y: keyless.coords.y }, { x: 0, y: 0 });

  // and the retired word is gone from the string a resident reads
  assert.doesNotMatch(keyless.coords.from, /quay/i,
    "the origin no longer borrows the quay's name — the-town/the-quay is a mark in the Long Run");

  // ANTI-VACUITY: the chooser still answers something else for a real standpoint,
  // so an assertion above cannot be passing because every call returns one string
  assert.equal(chooseStandpoint({ x: 5, y: -6 }, { handles: new Set(["alpha"]) }).coords.from, "coords");
});

test("FALSIFIER — the no-ground standpoint ends with the Origin, on the Origin", async () => {
  const at = await homeCoords("nobody-lives-here-xyz", { marks: [], parcels: [] });

  assert.ok(at.from.endsWith("— the Origin"),
    `the unplaced are stood at the Origin and told so, got: ${at.from}`);
  assert.equal(at.from, "nobody-lives-here-xyz has no ground on the map yet — the Origin");
  assert.deepEqual({ x: at.x, y: at.y }, { x: 0, y: 0 },
    "a standpoint must be a point, and the default point is the Origin");
  assert.doesNotMatch(at.from, /quay/i);
});
