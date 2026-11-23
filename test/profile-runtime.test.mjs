// profile-runtime.test.mjs — the ONE rule for a profile's optional runtime (POS-583, Darko 2026-11-13: "One runtime field, surfaced").
//
// The profile door and the join steps judge and write the runtime through src/profile-runtime.mjs. These tests hold the two together:
// the join's judgment and first-write bytes are the profile door's own, so they cannot drift into two rules, and the shared module
// stays free of imports (pulling the profile door, and through it media.mjs, into the join's module graph moved when media.mjs read
// its environment: test/household-media.test.mjs went red on it).
//
//   node --test test/profile-runtime.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { RUNTIME_MAX, runtimeValue, foundedProfileFile } from "../src/profile-runtime.mjs";
// media before edit, as every file that loads the profile door does (the two modules import each other)
import "../src/media.mjs";
import { updateProfile } from "../src/edit.mjs";
import { editClone, fixtureKey, fixtureTown } from "./fixture.mjs";

delete process.env.TOWN_PUSH;
const db = fixtureTown();
// a clone whose resident has NO profile yet (the fixture's wright keeps one): the first write is what a join does
const bareClone = () => { const c = editClone(); rmSync(join(c, "WHITE_PAGES", "wright", "PROFILE.md"), { force: true }); return c; };
const outcome = (fn) => { try { return { value: fn() }; } catch (e) { return { code: e.code, defect: e.defect, hint: e.hint }; } };

const CASES = [
  undefined, null, "", "   ", "\n\t", " Claude Code on Opus 4.8 ", "a".repeat(72), "a".repeat(73), "\u{1F600}".repeat(72), "\u{1F600}".repeat(73),
  "  " + "b".repeat(72) + "  ", 7, true, {}, ["a"],
];

test("the rule: omitted, null and blank say nothing; text is trimmed; 72 Unicode characters, not UTF-16 units; non-text is refused by name", () => {
  assert.equal(RUNTIME_MAX, 72);
  assert.equal(runtimeValue(undefined), "");
  assert.equal(runtimeValue(null), "");
  assert.equal(runtimeValue("  \n "), "");
  assert.equal(runtimeValue("  Claude Code on Opus 4.8 "), "Claude Code on Opus 4.8");
  assert.equal(runtimeValue("\u{1F600}".repeat(72)).length, 144, "72 characters are within the limit even where they are 144 UTF-16 units");
  const over = outcome(() => runtimeValue("a".repeat(73)));
  assert.deepEqual([over.code, over.defect], [422, "runtime is longer than 72 characters"]);
  assert.equal(outcome(() => runtimeValue("\u{1F600}".repeat(73))).code, 422);
  for (const bad of [7, true, {}, ["a"]]) assert.deepEqual(outcome(() => runtimeValue(bad)).defect, "runtime must be text", JSON.stringify(bad));
});

test("the profile door's own writes agree with the join's judgment on every case (same limit, same trimming, same refusals), apart from the door's own explicit clear", () => {
  for (const said of CASES) {
    if (said === undefined || said === null) continue; // omitted leaves the profile alone, and the door refuses null as non-text: the join treats both as "nothing said"
    const clone = bareClone();
    const door = outcome(() => updateProfile({ handle: "wright", runtime: said }, fixtureKey, db, clone));
    const join_ = outcome(() => runtimeValue(said));
    if (join_.code) {
      assert.equal(door.code, join_.code, JSON.stringify(said));
      assert.equal(door.defect, join_.defect, `the same sentence: ${JSON.stringify(said).slice(0, 30)}`);
    } else if (join_.value === "") {
      assert.equal(door.value?.commit ?? null, null, "a blank founds nothing at the door either");
      assert.equal(existsSync(join(clone, "WHITE_PAGES", "wright", "PROFILE.md")), false);
    } else {
      assert.equal(door.code, undefined, `the door takes what the join takes: ${JSON.stringify(said).slice(0, 30)}`);
    }
  }
});

test("the join founds PROFILE.md in the profile door's own first-write bytes", () => {
  for (const said of [" Claude Code on Opus 4.8 ", "a \"quoted\" line: with a colon", "\u{1F600} café — ünï", "a".repeat(72)]) {
    const clone = bareClone();
    updateProfile({ handle: "wright", runtime: said }, fixtureKey, db, clone);
    const real = readFileSync(join(clone, "WHITE_PAGES", "wright", "PROFILE.md"), "utf8");
    assert.equal(foundedProfileFile(said), real, `byte for byte: ${JSON.stringify(said).slice(0, 40)}`);
  }
  for (const nothing of [undefined, null, "", "   "]) assert.equal(foundedProfileFile(nothing), null, `${JSON.stringify(nothing)} founds no profile`);
  assert.throws(() => foundedProfileFile("a".repeat(73)), (e) => e.code === 422);
});

test("the shared module imports nothing, so the join's module graph never loads the profile door or media.mjs", () => {
  const src = readFileSync(new URL("../src/profile-runtime.mjs", import.meta.url), "utf8");
  assert.equal(/^\s*import\s/m.test(src), false);
  for (const f of ["declare.mjs", "residency.mjs", "join-bind.mjs", "town-drain.mjs"]) {
    const text = readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
    assert.equal(/from "\.\/edit\.mjs"/.test(text), false, `${f} must not import the profile door`);
  }
});
