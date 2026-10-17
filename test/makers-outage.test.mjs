// makers-outage.test.mjs — an unreadable class layer is an outage at the leave door, never "town-only" (review-606 B2).
//
// With no class layer at all, the roster stands on its floor and nobody can say
// who may make a thing: the door answers 503 with the floor's own disclosure,
// as the roster bounce does, rather than refusing a lawful class as the town's.
// A class whose lineage dangles (it extends a class the layer does not hold) is
// the same: unknown, not false.

import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-makers-outage");
const { leaveMarkViaOffice } = await import("../src/world.mjs");
const { reloadLawSnapshot, resetLawSnapshot, LAW_REFRESH_SQLS } = await import("../src/law-snapshot.mjs");
const { resetClassRosterCache } = await import("../src/world-classes.mjs");

const one = { household: "house-a", handles: new Set(["alpha"]) };
const thing = { by: "alpha", slug: "a-stool", kind: "sited", at: { x: 3, y: 4 }, extent: { w: 1, h: 1 }, body: "A stool.", class: "thing" };
const answer = async (payload) => {
  try { await leaveMarkViaOffice(process.env.WORLD_CLONE, payload, one); return { landed: true }; }
  catch (e) { return { code: e.code, defect: String(e.defect ?? e.message), hint: String(e.hint ?? "") }; }
};

test("no class layer: the roster's floor, and a lawful thing is an outage (503), never town-only", async () => {
  resetLawSnapshot(); resetClassRosterCache();
  const a = await answer({ ...thing });
  assert.equal(a.code, 503, JSON.stringify(a));
  assert.equal(a.defect, 'who may make a "thing" could not be read');
  assert.match(a.hint, /nothing was written/);
  assert.match(a.hint, /NOTE: .*floor/, "the floor's own disclosure rides the answer");
  assert.doesNotMatch(a.defect, /town-only/);
});

test("a lineage that dangles is unknown, not false: 503", async () => {
  const SHA = "d".repeat(40);
  const rows = [["postmark-node", { dials: { makers: false } }], ["orphan", { extends: "a-class-the-layer-does-not-hold" }], ["thing", { extends: "postmark-node", dials: { makers: true } }]]
    .map(([key, data]) => ({ number: 290, tag_sha: SHA, newest: 290, kind: "class", key, data: { class: key, ...data } }));
  await reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === LAW_REFRESH_SQLS.pin ? [{ newest: 290, pinned: 290 }] : rows }) });
  resetClassRosterCache();
  try {
    const a = await answer({ ...thing, class: "orphan" });
    assert.equal(a.code, 503, JSON.stringify(a));
    assert.equal(a.defect, 'who may make a "orphan" could not be read');
    const b = await answer({ ...thing });
    assert.doesNotMatch(b.defect ?? "", /could not be read|town-only/, "a readable lineage that states true passes the class gate");
  } finally { resetLawSnapshot(); resetClassRosterCache(); }
});
