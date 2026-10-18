// holder-nesting.test.mjs — plumb-nest-guard (2026-10-17): how deep things nest.
//
// The give of a whole thing into a holder walked only 64 holders up looking for
// the thing, so a deep enough nesting could defeat the loop check and write a
// loop into the holding record; and nothing capped how deep things nest. Each
// test here is a falsifier: it fails on train/2026-w43 @ dd226dbd and passes
// with world-hold.mjs § HOW DEEP THINGS NEST.
//
//   1. a holder far more than 64 levels inside the thing is still refused;
//   2. a give that would leave a thing, or what it holds, past the ceiling is
//      refused in the door's voice, and one at the ceiling stands;
//   3. a loop already in the rows ends the walk (no hang) and the give refuses.
//
// The kind door (`callKinds`, src/world-kinds.mjs) with every collaborator
// injected over an in-memory record, as kind-door.test.mjs drives it. The
// helpers are read through a namespace import, so on the old code they are
// absent and the test fails rather than the file failing to load.

import { test } from "node:test";
import assert from "node:assert/strict";
import { callKinds } from "../src/world-kinds.mjs";
import { classViewOf } from "../src/world-units.mjs";
import { lawSnapshotFromRows } from "../src/law-classes.mjs";
import * as hold from "../src/world-hold.mjs";

const SHA = "c".repeat(40);
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property",
  key: parent ? `${klass}/${parent}/${name}` : `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const SNAP = lawSnapshotFromRows([
  cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }),
  cls("thing", { extends: "sited" }), cls("halloween-candy-bag", { extends: "thing" }),
  cls("entity", { extends: "postmark-node" }), cls("resident", { extends: "entity" }),
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"),
  prop("thing", "min", 1, "constitution", "capacity"), prop("thing", "max", 120, "constitution", "capacity"),
  prop("thing", "open", true, "sovereign", "holder"), prop("thing", "portable", true, "sovereign"),
  prop("halloween-candy-bag", "holder", true, "constitution"), prop("halloween-candy-bag", "capacity", 200, "sovereign", "holder"),
  prop("halloween-candy-bag", "max", 200, "constitution", "capacity"),
]);

const ME = "sbx-cy", LAMP = "sbx-cy/a-lamp";
const bag = (name) => `sbx-cy/${name}`;
const markOf = (id) => (id === LAMP ? { id, by: ME, kind: "thing", at: { x: 5, y: 6 } } : { id, by: ME, kind: "halloween-candy-bag", at: { x: 5, y: 6 } });
const row = (entity, target) => ({ entity, target, policy: "cascade", born_at: "2026-10-17T00:00:00Z" });
/** `prefix-0` in `top`'s hands (or standing in it), `prefix-1` inside it, and so on down to `prefix-<n>`. */
const chain = (prefix, n, top = ME) => Array.from({ length: n + 1 }, (_, k) => row(k ? bag(`${prefix}-${k - 1}`) : top, bag(`${prefix}-${k}`)));

function world(things) {
  const acts = [];
  const deps = {
    classes: () => classViewOf(SNAP),
    readRows: async () => ({ units: acts.slice(), attachments: things }),
    markById: async (id) => (String(id).startsWith("sbx-cy/") ? markOf(String(id)) : null),
    reachTake: async () => ({ reach: { stands: true } }),
    reachGive: async () => ({ stands: true }),
    standpoint: async () => ({ x: 5, y: 6 }),
    householdOf: (h) => ({ key: `hh:${h}`, house: `hh:${h}` }),
    append: async (entry) => { acts.push({ id: acts.length + 100, class: entry.cls, action: entry.action, payload: entry.payload }); return { actId: acts.length + 99 }; },
    stamp: async (actor) => ({ at: `2026-10-17T06:00:00Z@${actor}#${acts.length}`, witnesses: [] }),
    crossing: () => 260,
    household: () => "hh:test",
  };
  return { deps, acts };
}
const give = (w, thing, to) => callKinds("thing-into-holder", { thing, to }, { handles: new Set([ME]) }, ME, w.deps);

test("1 · a holder 70 levels inside the thing is refused: the loop check walks the whole way up", { timeout: 10_000 }, async () => {
  const w = world(chain("b", 70));
  await assert.rejects(give(w, bag("b-0"), bag("b-70")),
    (e) => e.code === 422 && e.defect === `${bag("b-70")} is inside ${bag("b-0")}` && /Nothing was changed\.$/.test(e.hint));
  assert.equal(w.acts.length, 0, "nothing was written");
  // the helper agrees, and reaches the top
  const { chain: up, loop } = hold.holderChain(chain("b", 70), bag("b-70"));
  assert.deepEqual([up.length, up.at(-2), up.at(-1), loop], [70, bag("b-0"), ME, false]);
});

test("2 · the depth ceiling: a thing at 16 deep stands, at 17 it is refused in the door's voice", { timeout: 10_000 }, async () => {
  assert.equal(hold.NEST_DEPTH_MAX, 16);
  // b-0 in my hands holds b-1 one deep, ... b-15 is 15 deep, b-16 is 16 deep
  const at16 = world([...chain("b", 16), row(ME, LAMP)]);
  const ok = await give(at16, LAMP, bag("b-15"));
  assert.deepEqual([ok.did, ok.to], ["give", bag("b-15")], "the lamp lands 16 deep");
  const at17 = world([...chain("b", 16), row(ME, LAMP)]);
  await assert.rejects(give(at17, LAMP, bag("b-16")),
    (e) => e.code === 422 && e.defect === `${LAMP} would be nested 17 deep` && e.hint === "the town holds things at most 16 deep. Nothing was changed.");
  assert.equal(at17.acts.length, 0, "nothing was written");
});

test("2b · the ceiling counts what the thing holds: a bag of 16 levels into another bag is refused, of 15 it stands", { timeout: 10_000 }, async () => {
  // y-0 in my hands holds y-1 ... y-16 sits 16 deep; giving y-0 into `outer` pushes y-16 to 17
  const deep = world([...chain("y", 16), row(ME, bag("outer"))]);
  await assert.rejects(give(deep, bag("y-0"), bag("outer")),
    (e) => e.code === 422 && e.defect === `what ${bag("y-0")} holds would be nested 17 deep` && /at most 16 deep\. Nothing was changed\.$/.test(e.hint));
  assert.equal(deep.acts.length, 0);
  const fits = world([...chain("y", 15), row(ME, bag("outer"))]);
  assert.equal((await give(fits, bag("y-0"), bag("outer"))).did, "give");
  assert.equal(hold.nestedHeight(chain("y", 16), bag("y-0")), 16);
});

test("3 · a loop already in the rows ends the walk: no hang, and a give into it is refused", { timeout: 10_000 }, async () => {
  // p holds q and q holds p: a record no door should have written, read as it stands
  const loopRows = [row(bag("p"), bag("q")), row(bag("q"), bag("p")), row(ME, LAMP)];
  const w = world(loopRows);
  await assert.rejects(give(w, LAMP, bag("q")),
    (e) => e.code === 422 && e.defect === `the record holds a loop above ${bag("q")}` && /Nothing was changed\.$/.test(e.hint));
  assert.equal(w.acts.length, 0);
  assert.deepEqual(hold.holderChain(loopRows, bag("q")), { chain: [bag("p")], loop: true });
  assert.equal(hold.nestedHeight(loopRows, bag("p")), 1, "the walk down visits each thing once and stops");
  assert.equal(hold.nestedHeight(loopRows, LAMP), 0);
});
