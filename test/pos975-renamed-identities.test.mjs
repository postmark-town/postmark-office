// pos975-renamed-identities.test.mjs — the restore rehearsal's town check knows a
// canonical rename from an orphan (POS-975).
//
// Jetto's S3 restore rehearsal read RED on two world identities the town's roll
// does not carry, `dylan-android-husband` and `wesley-seeker`. Both are renamed
// residents whose old key the registry keeps on purpose, retired, with
// `renamed_to` and the same GitHub id as the new one (town `f9ecbe4f9`, 08-04;
// town `880390274`, 09-09: "old handle kept as retired — a handle is a key into
// history"). The falsifier now reads that from the town checkout it already
// holds at the roll's sha, and nothing else: an unknown identity, or rename
// evidence that is absent or does not hang together, stays RED.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { identitiesOutsideTheRoll } from "../world2/tools/falsifier-projection-equality.mjs";
import { readPins } from "../src/household-logins.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";

// The four entries exactly as the town's tools/github-ids.json carries them
// (town main 701a7ff2b9d97c68bc1af23362c05b859f002c12, 2026-11-16).
const TOWN_PINS = Object.freeze({
  "dylan-android-husband": { login: "XAesirX", id: 312413958, retired: "2026-08-04", renamed_to: "dylan" },
  dylan: { login: "XAesirX", id: 312413958 },
  "wesley-seeker": { login: "wesleymons22-coder", id: 324643059, pinned: "2026-09-04", retired: "2026-09-09", renamed_to: "eloise-stellanova" },
  "eloise-stellanova": { login: "wesleymons22-coder", id: 324643059, pinned: "2026-09-04" },
});
// The roll carries the new handles (WHITE_PAGES was renamed), not the old ones.
const ROLL = new Set(["dylan", "eloise-stellanova", "astra-first", "berthillon"]);
// The world store keeps both keys of each renamed resident, as 055 does.
const IDENTITIES = ["astra-first", "berthillon", "dylan", "dylan-android-husband", "eloise-stellanova", "wesley-seeker"];

test("POS-975 · the rehearsal's false orphan: read without the town's pins, the two renamed keys are orphans", () => {
  assert.deepEqual(identitiesOutsideTheRoll(IDENTITIES, ROLL, {}),
    { orphans: ["dylan-android-husband", "wesley-seeker"], renamed: [] });
});

test("POS-975 · with the town's own pins, both are the same residents, renamed, and nothing is an orphan", () => {
  const out = identitiesOutsideTheRoll(IDENTITIES, ROLL, TOWN_PINS);
  assert.deepEqual(out.orphans, []);
  assert.deepEqual(out.renamed, [
    { handle: "dylan-android-husband", renamed_to: "dylan", id: 312413958, retired: "2026-08-04" },
    { handle: "wesley-seeker", renamed_to: "eloise-stellanova", id: 324643059, retired: "2026-09-09" },
  ]);
});

test("POS-975 · an identity the town has never heard of stays an orphan beside the renames", () => {
  const out = identitiesOutsideTheRoll([...IDENTITIES, "stranger"], ROLL, TOWN_PINS);
  assert.deepEqual(out.orphans, ["stranger"]);
  assert.equal(out.renamed.length, 2);
});

test("POS-975 · rename evidence that is absent or does not hang together lets nothing through", () => {
  const base = { "old-key": { login: "x", id: 7, retired: "2026-10-01", renamed_to: "new-key" }, "new-key": { login: "x", id: 7 } };
  const roll = new Set(["new-key"]);
  const red = (pins, why, rollSet = roll) =>
    assert.deepEqual(identitiesOutsideTheRoll(["old-key"], rollSet, pins).orphans, ["old-key"], why);
  // control: the whole evidence passes
  assert.deepEqual(identitiesOutsideTheRoll(["old-key"], roll, base), { orphans: [], renamed: [{ handle: "old-key", renamed_to: "new-key", id: 7, retired: "2026-10-01" }] });
  red({ ...base, "old-key": { ...base["old-key"], retired: undefined } }, "a renamed_to without a retirement");
  red({ ...base, "old-key": { login: "x", id: 7, retired: "2026-10-01" } }, "retired with no successor: retirement alone is not a rename");
  red({ "old-key": base["old-key"] }, "a successor the pins do not carry");
  red({ ...base, "new-key": { ...base["new-key"], retired: "2026-10-02" } }, "a successor itself retired");
  red({ ...base, "new-key": { login: "x", id: 8 } }, "a successor on another GitHub account");
  red({ ...base, "old-key": { ...base["old-key"], id: undefined }, "new-key": { login: "x" } }, "no account on either side");
  red(base, "a successor the roll does not carry", new Set());
  red({ ...base, "old-key": { ...base["old-key"], renamed_to: "constructor" } }, "a successor named after an object key");
  red(null, "no pins at all");
});

test("POS-975 · one hop only: a rename of a rename is not followed", () => {
  const pins = {
    a: { id: 1, retired: "2026-09-01", renamed_to: "b" },
    b: { id: 1, retired: "2026-10-01", renamed_to: "c" },
    c: { id: 1 },
  };
  const out = identitiesOutsideTheRoll(["a", "b"], new Set(["c"]), pins);
  assert.deepEqual(out.orphans, ["a"], "a's successor b is retired, so a stays RED");
  assert.deepEqual(out.renamed.map((r) => r.handle), ["b"]);
});

test("POS-975 · the pins are the town checkout's own tools/github-ids.json; a checkout without one renames nothing", () => {
  const town = tempDir("pos975-town-");
  assert.deepEqual(identitiesOutsideTheRoll(IDENTITIES, ROLL, readPins(town)).orphans, ["dylan-android-husband", "wesley-seeker"]);
  mkdirSync(join(town, "tools"), { recursive: true });
  writeFileSync(join(town, "tools", "github-ids.json"), JSON.stringify(TOWN_PINS, null, 2));
  assert.deepEqual(identitiesOutsideTheRoll(IDENTITIES, ROLL, readPins(town)).orphans, []);
});
