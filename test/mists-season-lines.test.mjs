// mists-season-lines.test.mjs — the season's lines the office carries (POS-551):
// the ferryman's word on a few boats, the ferry's word on the ride line while the
// Mists stand, and the `air` the bare world read carries in the engine's words.
//
// Every one is keyed on the crossing number or on the world's own Mists schedule,
// and every one is ABSENT otherwise, so each block below is held byte-identical
// to the one it always was away from the season.
//
// Run: WORLD_CLONE=<a world checkout> node --test test/mists-season-lines.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { CROSSING_EPOCH_UTC, CROSSING_MS, FERRYMAN_CROSSINGS, FERRYMAN_LINE, ferrymanFor, nextCrossingForDoorstep, nextCrossingForReceipt } from "../src/crossings.mjs";
import { transportAt, stopUnderfoot } from "../src/world-ride.mjs";
import { vesselServiceFrom } from "../src/world-movement.mjs";
import { NO_WORLD, OFFICE_ROOT, worldClone } from "./fixture-paths.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";

const HOUR = 3600 * 1000;
// an instant one hour into the interval whose boat is crossing `n`
const beforeBoat = (n) => CROSSING_EPOCH_UTC + (n - 1) * CROSSING_MS + HOUR;

// ── THE FERRYMAN ─────────────────────────────────────────────────────────────

test("the ferryman speaks on boats 244, 272, 282 and 284, and on no other", () => {
  assert.deepEqual([...FERRYMAN_CROSSINGS], [244, 272, 282, 284]);
  for (let n = 0; n <= 400; n += 1)
    assert.equal(ferrymanFor(n), FERRYMAN_CROSSINGS.includes(n) ? FERRYMAN_LINE : null, `boat ${n}`);
  assert.equal(FERRYMAN_LINE, "The ferryman asks that no letter be addressed past the mist.");
});

test("next_crossing on the doorstep: the ferryman's own field on his boats; the old block, key for key, on every other", () => {
  for (const n of [197, 203, 243, 245, 271, 273, 283, 285]) {
    const b = nextCrossingForDoorstep(beforeBoat(n));
    assert.equal(b.crossing, n);
    assert.deepEqual(Object.keys(b), ["crossing", "at", "sentence"], `boat ${n}: the block it always was`);
  }
  for (const n of FERRYMAN_CROSSINGS) {
    const b = nextCrossingForDoorstep(beforeBoat(n));
    assert.equal(b.crossing, n);
    assert.deepEqual(Object.keys(b), ["crossing", "at", "sentence", "ferryman"]);
    assert.equal(b.ferryman, FERRYMAN_LINE);
    assert.doesNotMatch(b.sentence, /ferryman|mist/, "the boat's sentence is untouched; the word is its own field");
  }
});

test("next_crossing on the send receipt: the same, for the boat the letter rides", () => {
  for (const n of [243, 245]) assert.deepEqual(Object.keys(nextCrossingForReceipt(beforeBoat(n))), ["crossing", "at", "minutes_away", "sentence"]);
  const on = nextCrossingForReceipt(beforeBoat(244));
  assert.deepEqual(Object.keys(on), ["crossing", "at", "minutes_away", "sentence", "ferryman"]);
  assert.equal(on.ferryman, FERRYMAN_LINE);
  // a retry read after its own boat sailed names the boat it goes on now, and the word follows that boat
  const retry = nextCrossingForReceipt(beforeBoat(245), { writtenAt: beforeBoat(244) });
  assert.match(retry.sentence, /this crossing has sailed/);
  assert.equal(retry.crossing, 245);
  assert.equal("ferryman" in retry, false);
});

// ── THE RIDE LINE ────────────────────────────────────────────────────────────

const CLONE = worldClone();
const HAVE_CLONE = Boolean(CLONE) && existsSync(join(CLONE, "WORLD", "world-state.json")) && existsSync(join(CLONE, "tools", "marks-fold.mjs"));
const WHY_NOT = CLONE ? `the world clone at ${CLONE} is missing WORLD/world-state.json or tools/marks-fold.mjs` : NO_WORLD;
const WHARF = "sol-of-garrison/grove-wharf";
const RIDE_CLAUSE = " (she will not steer north of the mist).";

// The real works, folded by the world's own tool (world-ride.test.mjs § vehicleWorld).
async function vehicleWorld() {
  const FOLD = await import(pathToFileURL(join(CLONE, "tools", "marks-fold.mjs")).href);
  const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
  const stakesRaw = read(join(CLONE, "WORLD", "stakes.json"));
  return FOLD.fold({
    marks: FOLD.loadMarks(join(CLONE, "WORLD", "marks")),
    terrain: read(join(CLONE, "WORLD", "terrain.json")),
    stakes: Array.isArray(stakesRaw) ? stakesRaw : (stakesRaw?.stakes ?? []),
    prev: read(join(CLONE, "WORLD", "world-state.json")),
    tick: 0,
    households: read(join(CLONE, "WORLD", "households.json"))?.households ?? null,
  });
}
// the same world with a Mists schedule on its terrain, starting at `first`
const withMists = (w, first) => ({ ...w, terrain: { ...(w.terrain ?? {}), mists: { schedule: [{ crossing: first, front_m: 0, veil: 0.1 }] } } });

test("mistsStand: from the schedule's first crossing on, and never without a schedule or a crossing", async () => {
  const { mistsStand } = await import("../src/world.mjs");
  const w = { terrain: { mists: { schedule: [{ crossing: 244 }, { crossing: 272 }] } } };
  assert.equal(mistsStand(w, 243), false);
  assert.equal(mistsStand(w, 244), true);
  assert.equal(mistsStand(w, 400), true);
  assert.equal(mistsStand(w, null), false, "a caller that names no crossing gets the old line");
  assert.equal(mistsStand({ terrain: {} }, 300), false, "no schedule, no Mists");
  assert.equal(mistsStand(null, 300), false);
});

test("the ride line: the ferry's word on the Mists while they stand; the old line before them and with no crossing named", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const { transportBlock } = await import("../src/world.mjs");
  const w = withMists(await vehicleWorld(), 244);
  const { service } = await vesselServiceFrom(w, { repo: CLONE });
  const plain = transportAt(WHARF, service, w);
  assert.ok(plain.line.endsWith(".") && !plain.line.includes("mist"), "the line it always was");
  const seasoned = transportAt(WHARF, service, w, { season: true });
  assert.equal(seasoned.line, plain.line.slice(0, -1) + RIDE_CLAUSE);
  assert.deepEqual(seasoned.ride_to, plain.ride_to, "only the line moves");
  const wharf = { x: -1380, y: -2543 };
  assert.equal(stopUnderfoot(wharf, service, w), WHARF);
  assert.deepEqual(await transportBlock(w, wharf), plain, "no crossing named: unchanged");
  assert.deepEqual(await transportBlock(w, wharf, { crossing: 243 }), plain, "the crossing before the Mists: unchanged");
  assert.equal((await transportBlock(w, wharf, { crossing: 244 })).line, seasoned.line);
  assert.equal((await transportBlock(w, wharf, { crossing: 290 })).line, seasoned.line);
  assert.deepEqual(await transportBlock(await vehicleWorld(), wharf, { crossing: 290 }), plain, "a world with no schedule: unchanged at any crossing");
});

test("both doors that carry the transport line name their crossing", () => {
  const src = readFileSync(join(OFFICE_ROOT, "src", "world.mjs"), "utf8");
  const calls = src.match(/transportBlock\(w, at[^)]*\)/g) ?? [];
  assert.equal(calls.length, 2, "orient and the eyes");
  for (const c of calls) assert.equal(c, "transportBlock(w, at, { crossing })");
});

// ── THE AIR ──────────────────────────────────────────────────────────────────
//
// The office authors none of the air's words: `worldAir` hands the engine the
// `you` and the crossing `worldOrient` already returned, and carries back what
// it says. Driven in a child process against a stand-in engine in a git repo of
// its own, so WORLD_CLONE names nothing but it.

function standInEngine(verbsSource) {
  const dir = tempDir("postmark-office-air-");
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, "tools", "world-verbs.mjs"), verbsSource);
  writeFileSync(join(dir, "tools", "world-build.mjs"), "export function assembleWorld() { return {}; }\n");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "a stand-in engine");
  return dir;
}
function airFrom(engineDir, oriented) {
  const script = `const { worldAir } = await import(${JSON.stringify(pathToFileURL(join(OFFICE_ROOT, "src", "world.mjs")).href)});
process.stdout.write(JSON.stringify(await worldAir(${JSON.stringify(oriented)})));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8", env: { ...process.env, WORLD_CLONE: engineDir }, stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(out);
}
const YOU = { light: { level: 0.42, inDarkness: false }, fog: { thickness: 0.1, inFog: true, aboveFog: false }, mists: { veil: 0.3 } };

test("worldAir: the engine's line for the orient it is handed, and null whenever the engine tells none or cannot", () => {
  const telling = standInEngine("export function airLine(you, n) { return you?.mists ? `air at ${n}: light ${you.light.level}` : null; }\n");
  assert.equal(airFrom(telling, { you: YOU, crossing: { n: 272 } }), "air at 272: light 0.42");
  const { mists, ...noMists } = YOU;
  assert.equal(airFrom(telling, { you: noMists, crossing: { n: 243 } }), null, "the engine tells no air: none carried");
  assert.equal(airFrom(telling, { crossing: { n: 272 } }), null, "no `you`: none carried");
  const older = standInEngine("export function orient() { return {}; }\n");
  assert.equal(airFrom(older, { you: YOU, crossing: { n: 272 } }), null, "an engine with no airLine: none carried");
  const throwing = standInEngine("export function airLine() { throw new Error('no'); }\n");
  assert.equal(airFrom(throwing, { you: YOU, crossing: { n: 272 } }), null, "never takes the read down");
});

test("the bare world read carries `air` beside its crossing, and only when there is one", () => {
  const src = readFileSync(join(OFFICE_ROOT, "src", "world-apex.mjs"), "utf8");
  assert.match(src, /const air = await worldAir\(oriented\);/);
  assert.match(src, /    crossing: oriented\.crossing,\n    \.\.\.\(air \? \{ air \} : \{\}\),\n/);
});
