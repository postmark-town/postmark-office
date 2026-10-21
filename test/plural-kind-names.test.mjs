// plural-kind-names.test.mjs — a kind's name for a count, one helper (POS-741, POS-743).
//
// The hold lane said "2 hoard-coinss" and "23 lanternchewss": its plural added an s
// to a name that already ended in one, in two copies (kind-holding.mjs and
// world-stacks.mjs). Now there is one, world-stacks.mjs § plural, and both lines read it.
//
// THE CAN-FAIL FLIP: drop the "already ends in s" arm; every case naming hoard-coins
// or lanternchews reds.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { plural, holdingDisplay } from "../src/world-stacks.mjs";
import { blurOf } from "../src/kind-holding.mjs";

const extendsOf = (c) => ({ "hoard-coins": "candy", lanternchews: "candy", "pocket-comet": "candy", candy: "consumable", consumable: "thing", toaster: "thing" }[c] ?? null);

test("one plural: a name already ending in s is left alone; y becomes ies; one stays one", () => {
  assert.equal(plural("hoard-coins", 2), "hoard-coins");
  assert.equal(plural("lanternchews", 23), "lanternchews");
  assert.equal(plural("candy", 21), "candies");
  assert.equal(plural("pocket-comet", 18), "pocket-comets");
  assert.equal(plural("thing", 22), "things");
  assert.equal(plural("hoard-coins", 1), "hoard-coins");
  assert.equal(plural("toy", 2), "toys", "a vowel and y takes an s");
});

test("both holding lines read it: the blur and the holding's display", () => {
  assert.equal(blurOf({ edges: [{ kind: "hoard-coins", count: 2 }], extendsOf }).shows, "2 hoard-coins");
  assert.deepEqual(blurOf({ edges: [{ kind: "lanternchews", count: 23 }], extendsOf, sharp: true }).kinds, [{ kind: "lanternchews", count: 23, shows: "23 lanternchews" }]);
  assert.equal(blurOf({ edges: [{ kind: "hoard-coins", count: 2 }, { kind: "pocket-comet", count: 3 }], extendsOf }).shows, "5 candies");
  assert.equal(holdingDisplay([{ class: "lanternchews", count: 23 }, { class: "hoard-coins", count: 2 }], extendsOf).text, "25 candies");
  assert.equal(holdingDisplay([{ class: "lanternchews", count: 23 }], extendsOf).text, "23 lanternchews");
});

test("there is one copy: kind-holding.mjs declares no plural of its own", () => {
  const src = readFileSync(new URL("../src/kind-holding.mjs", import.meta.url), "utf8");
  assert.equal(/const plural\s*=/.test(src), false);
  assert.match(src, /import \{[^}]*\bplural\b[^}]*\} from "\.\/world-stacks\.mjs"/);
});
