// ground-lands-on-entry.test.mjs — a ground sets you down only when you entered it.
//
// WLD-6 A (RULED by Darko 2026-10-16 20:04): entering a ground sets you down at its
// landing point even behind the Mists' wall, written as a landing (WLD-63 row 68 B).
// review-shelter's required fix: set down ONLY when the enter actually put the
// ground on the entrant's stack. Refused terms, a refused door, awaiting and
// already-within all answer with no `.error`, and the old guard
// (`!result?.error`) landed a ghost for every one of them.
//
// Each case is a REAL enter answer from enterViaOffice over the clone's verbs, handed
// to the apex's own guard (world-apex.mjs § groundLandsAfterEnter) with the ground's
// lookup and the land pen faked, so the test sees exactly whether a landing is written.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { enterViaOffice } from "../src/world-crossings.mjs";
import { groundLandsAfterEnter, enteredTheTarget, enterTargetOfArgs } from "../src/world-apex.mjs";
import { mistsGroundCheck } from "../src/world.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const CLONE = worldClone();
const HAVE = !!CLONE && existsSync(join(CLONE, "tools", "enter-exit.mjs"));
const SKIP = !HAVE && (CLONE ? `the world clone at ${CLONE} has no tools/enter-exit.mjs` : NO_WORLD);
const grammarOf = async () => import(pathToFileURL(join(CLONE, "tools", "enter-exit.mjs")).href);

// three grounds side by side: an open parlor, a locked one, and one with terms
const marks = () => [
  { id: "g/parlor", kind: "sited", by: "g", at: { x: 0, y: 0 }, extent: { w: 20, h: 20 }, body: "An open parlor." },
  { id: "g/locked", kind: "sited", by: "g", at: { x: 40, y: 0 }, extent: { w: 20, h: 20 }, body: "A locked parlor.",
    entry: { word: "opposed", consequence: "The door is barred." } },
  { id: "g/club", kind: "sited", by: "g", at: { x: 80, y: 0 }, extent: { w: 20, h: 20 }, body: "A club.",
    entry: { word: "welcomed", edge: "member", consequence: "You agree to the club's rules." } },
];
const key = (...h) => ({ handles: new Set(h) });
const row = (mark) => `- 2026-10-16T20:00:00.000Z · ann · enters ${mark} · ferry 299.0000 · word neutral`;

async function office({ standing, ledger = "" }) {
  const thresholds = await grammarOf();
  let text = ledger;
  return {
    world: async () => ({ marks: marks() }),
    ledger: async () => text,
    standpointOf: async (who) => ({ ...standing, name: who }),
    acts: async () => [],
    now: () => 300,
    record: async (p) => {
      text += p.lines.join("\n") + "\n";
      const acts = thresholds.parseEnterExitLedger(text).acts;
      return { lines: p.lines, within: thresholds.occupancyAt(acts, 300).get(p.handle) ?? [], commit: "deadbeef", pushed: false };
    },
    walking: async () => null,
    stop: async () => {},
    land: async () => {},
  };
}

// THE WALL, READ FOR REAL (review-600's nit): the world's own skeleton and the
// office's own wall check (world.mjs § mistsGroundCheck, the one the landing used
// to ask) say this point stands behind the Mists' wall now, far past the border.
const SKELETON_PATH = CLONE ? join(CLONE, "WORLD", "skeleton.json") : null;
const SKELETON = SKELETON_PATH && existsSync(SKELETON_PATH) ? JSON.parse(readFileSync(SKELETON_PATH, "utf8")) : null;
const BEHIND = SKELETON?.mists?.border_m ? { x: 0, y: SKELETON.mists.border_m.minY - 5000 } : { x: -9, y: -9 };
const nowCrossing = () => (Date.now() - Date.UTC(2026, 5, 12)) / (12 * 3600 * 1000);

/** The apex's own guard, with every ground declaring its landing point behind the wall and the pen observed. */
async function afterEnter(args, result) {
  const written = [];
  const placed = await groundLandsAfterEnter(args, result, key("ann"), "ann", {
    ground: async (target) => ({ place: { ground: target }, landing: { at: BEHIND } }),
    landAt: async (_clone, w) => { written.push(w); },
  });
  return { placed, written };
}

test("a real entry lands you at the ground's landing point, behind the Mists' wall included", { skip: SKIP }, async (t) => {
  const wall = await mistsGroundCheck(CLONE, async () => SKELETON, [BEHIND], Math.floor(nowCrossing()));
  if (!wall?.wall) { t.skip("this world's Mists do not stand over the landing point now, so the wall cannot be proven absent"); return; }
  assert.deepEqual(wall, { wall: { x: BEHIND.x, y: BEHIND.y } }, "the office's own wall check would refuse this landing point");
  const deps = await office({ standing: { x: 0, y: 0 } });
  const answer = await enterViaOffice(CLONE, { mark: "g/parlor" }, key("ann"), deps);
  assert.ok(answer.entered.includes("g/parlor"), "the enter put the parlor on the stack");
  const { placed, written } = await afterEnter({ mark: "g/parlor" }, answer);
  assert.deepEqual(written, [{ who: "ann", at: BEHIND, via: "g/parlor", why: "ground", key: key("ann") }],
    "and the landing is written there anyway: WLD-6 A asks no wall check");
  assert.equal(placed.ground, "g/parlor");
  assert.match(placed.note, /the ground placed you/);
});

test("refused at the door: no landing", { skip: SKIP }, async () => {
  const deps = await office({ standing: { x: 40, y: 0 } });
  const answer = await enterViaOffice(CLONE, { mark: "g/locked" }, key("ann"), deps);
  assert.equal(answer.error, undefined, "a refusal answers with no .error, which is why the old guard landed it");
  assert.ok(answer.refused, "refused at the threshold");
  const { placed, written } = await afterEnter({ mark: "g/locked" }, answer);
  assert.equal(placed, null);
  assert.deepEqual(written, []);
});

test("terms shown and not yet accepted (awaiting): no landing; accepted: the landing", { skip: SKIP }, async () => {
  const deps = await office({ standing: { x: 80, y: 0 } });
  const asked = await enterViaOffice(CLONE, { mark: "g/club" }, key("ann"), deps);
  assert.ok(asked.awaiting, "the club shows its terms and waits");
  assert.deepEqual((await afterEnter({ mark: "g/club" }, asked)).written, []);
  const accepted = await enterViaOffice(CLONE, { mark: "g/club", accept: true }, key("ann"), deps);
  assert.ok(accepted.entered.includes("g/club"));
  assert.equal((await afterEnter({ mark: "g/club", accept: true }, accepted)).written.length, 1);
});

test("already within: no landing (nothing was crossed)", { skip: SKIP }, async () => {
  const deps = await office({ standing: { x: 0, y: 0 }, ledger: row("g/parlor") + "\n" });
  const answer = await enterViaOffice(CLONE, { mark: "g/parlor" }, key("ann"), deps);
  assert.deepEqual(answer.entered, []);
  assert.deepEqual((await afterEnter({ mark: "g/parlor" }, answer)).written, []);
});

test("the guard itself: only an answer whose `entered` names the target, and never an error", () => {
  assert.equal(enteredTheTarget({ entered: ["a", "g/parlor"] }, "g/parlor"), true);
  assert.equal(enteredTheTarget({ entered: ["a"] }, "g/parlor"), false, "entering something else on the way is not entering the ground");
  assert.equal(enteredTheTarget({ entered: [], already: true }, "g/parlor"), false);
  assert.equal(enteredTheTarget({ error: "bounce", entered: ["g/parlor"] }, "g/parlor"), false);
  assert.equal(enteredTheTarget({ entered: ["g/parlor"] }, ""), false);
  assert.equal(enterTargetOfArgs({ mark_id: " g/parlor " }), "g/parlor", "landOnEnter's own parse");
});

test("a landing that cannot be written says so, never null", async () => {
  const placed = await groundLandsAfterEnter({ mark: "g/parlor" }, { entered: ["g/parlor"] }, key("ann"), "ann", {
    ground: async (t) => ({ place: { ground: t }, landing: { at: { x: 0, y: 0 } } }),
    landAt: async () => { throw new Error("the town lock is busy (synthetic)"); },
  });
  assert.equal(placed.ground, "g/parlor");
  assert.match(placed.refused, /could not set you down at its landing point/);
});
