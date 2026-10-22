// wld7-restored.test.mjs — a taken class given back by the town's own act (WLD-7, WLD-25/j).
//
// The question at every door is: the dial says `stolen: true` AND the town has not
// restored the class since the dial went on (Wright 2026-10-22, from Darko's WLD-25/j
// at 14:52). When the dial went on is read from the law: the bless of the earliest
// settlement in the newest unbroken run that says stolen. src/restored-classes.mjs.
//
// THE CAN-FAIL FLIPS (each reds a case below): ignore `restored` in stolenRefusal;
// count a restore from before the run began; let a non-town restore count.

import { test } from "node:test";
import assert from "node:assert/strict";
import { restoredSince, stolenSinceOf, readRestored, restoredClass, KEEP_MS, __setRestoredForTest, RESTORE_ROWS_SQL, CLASS_RUN_SQL } from "../src/restored-classes.mjs";
import { classViewOf } from "../src/world-units.mjs";
import { stolenClassRefusal } from "../src/world-stacks.mjs";
import { lawSnapshotFromRows } from "../src/law-classes.mjs";

const SHA = "e".repeat(40);
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const SNAP = lawSnapshotFromRows([cls("thing"), cls("consumable", { extends: "thing" }),
  cls("trinket", { extends: "consumable", dials: { stolen: true, clue: "a synthetic clue" } }), cls("glass-bead", { extends: "trinket" })]);
const restore = (object, at, actor = "the-town") => ({ id: "1", action: "restore", actor, object, at });

test("restoredSince: a town restore of the class at or after the dial went on; nothing else", () => {
  const since = "2026-10-26T06:30:00.000Z";
  assert.equal(restoredSince([restore("trinket", "2026-10-27T18:31:00Z")], "trinket", since), true);
  assert.equal(restoredSince([restore("trinket", since)], "trinket", since), true, "at the instant counts");
  assert.equal(restoredSince([restore("trinket", "2026-10-25T18:00:00Z")], "trinket", since), false, "before the run began: an old restore lifts nothing");
  assert.equal(restoredSince([restore("biscuit", "2026-10-27T18:31:00Z")], "trinket", since), false);
  assert.equal(restoredSince([restore("trinket", "2026-10-27T18:31:00Z", "sbx-cy")], "trinket", since), false, "only the town's own act");
  assert.equal(restoredSince([restore("trinket", "2026-10-27T18:31:00Z")], "trinket", null), false, "no run, nothing to lift");
});

test("when the dial went on: the earliest bless in the newest unbroken run that says stolen", () => {
  const row = (n, stolen, at) => ({ number: n, blessed_at: at, data: { dials: stolen ? { stolen: true } : {} } });
  assert.equal(stolenSinceOf([row(130, true, "2026-10-27T06:30:00Z"), row(129, true, "2026-10-26T18:30:00Z"), row(128, false, "2026-10-26T06:30:00Z")]), "2026-10-26T18:30:00Z");
  assert.equal(stolenSinceOf([row(130, false, "x"), row(129, true, "y")]), null, "the newest law does not say stolen");
  assert.equal(stolenSinceOf([row(130, true, "2026-11-02T06:30:00Z"), row(129, false, "a"), row(128, true, "b")]), "2026-11-02T06:30:00Z", "off and on again: a new run");
});

test("readRestored asks the record once and each taken class's run", async () => {
  const asked = [];
  const query = async (sql, params = []) => {
    asked.push(sql === RESTORE_ROWS_SQL ? "restores" : sql === CLASS_RUN_SQL ? `run ${params[0]}` : "?");
    if (sql === RESTORE_ROWS_SQL) return { rows: [restore("trinket", "2026-10-27T18:31:00Z")] };
    return { rows: [{ number: 130, blessed_at: "2026-10-26T06:30:00Z", data: { dials: { stolen: true } } }] };
  };
  const got = await readRestored({ classes: ["trinket"], query });
  assert.deepEqual(got.get("trinket"), { since: "2026-10-26T06:30:00Z", restored: true });
  assert.deepEqual(asked, ["restores", "run trinket"]);
  assert.deepEqual([...(await readRestored({ classes: [], query })).keys()], [], "nothing taken: nothing asked");
});

test("the one question: the dial on and not restored refuses; restored, the same act is answered as on any day", () => {
  assert.equal(stolenClassRefusal("glass-bead", classViewOf(SNAP, { restored: () => false }))?.code, 423);
  assert.equal(stolenClassRefusal("glass-bead", classViewOf(SNAP, { restored: (c) => c === "trinket" })), null);
  // the view's default is this process's kept read (restoredClass), synchronous
  __setRestoredForTest({ trinket: { since: "2026-10-26T06:30:00Z", restored: true } });
  assert.equal(restoredClass("trinket"), true);
  assert.equal(stolenClassRefusal("glass-bead", classViewOf(SNAP)), null);
  __setRestoredForTest({ trinket: { since: "2026-10-26T06:30:00Z", restored: false } });
  assert.equal(stolenClassRefusal("glass-bead", classViewOf(SNAP))?.code, 423);
  __setRestoredForTest(null);
});

test("a failed read keeps what stood for the same 30 s: one retry a window, never one per act", async () => {
  __setRestoredForTest(null);
  let asked = 0;
  const failing = async () => { asked += 1; throw new Error("ECONNREFUSED"); };
  const t0 = Date.parse("2026-10-26T07:00:00Z");
  const ask = (t) => restoredClass("trinket", { now: t, query: failing, classes: ["trinket"] });
  const settle = () => new Promise((r) => setImmediate(r));
  assert.equal(ask(t0), false, "before any read, nothing is restored (fail closed)");
  await settle();
  assert.equal(asked, 1, "the first act starts one read, which fails");
  for (const t of [t0 + 1, t0 + 1000, t0 + KEEP_MS - 1]) { assert.equal(ask(t), false); await settle(); }
  assert.equal(asked, 1, "within the keep after a failure, no act asks again");
  ask(t0 + KEEP_MS); await settle();
  assert.equal(asked, 2, "once the keep is out, the next act asks again");
  __setRestoredForTest(null);
});

// THE DIAL AS A PROPERTY NODE (LOGOS v2, property first): the law snapshot reads a class's own
// top-level `stolen` property over its frontmatter dials (law-classes § dialsOf), so the run and
// the list of taken classes read it the same way, or a restore would never lift a property-node dial.
test("the dial written as the class's own property node: the run reads it, and the taken list finds it", async () => {
  const at = (n, at, { prop, dials } = {}) => ({ number: n, blessed_at: at, data: { dials: dials ?? {} }, ...(prop === undefined ? {} : { prop: { class: "trinket", parent: null, name: "stolen", default: prop } }) });
  assert.equal(stolenSinceOf([at(131, "2026-10-27T06:30:00Z", { prop: true }), at(130, "2026-10-26T18:30:00Z", { prop: "true" }), at(129, "x", { prop: false })]), "2026-10-26T18:30:00Z",
    "a property node's true (or its bare word) is the dial on");
  assert.equal(stolenSinceOf([at(131, "y", { prop: false, dials: { stolen: true } })]), null, "the property outranks the frontmatter, as the snapshot reads it");
  assert.equal(stolenSinceOf([at(131, "z", { dials: { stolen: true } })]), "z", "with no property node, the frontmatter dial");
  assert.match(CLASS_RUN_SQL, /p\.kind = 'property' AND p\.key = \$1 \|\| '\/stolen'/);

  const snap = await import("../src/law-snapshot.mjs");
  const SHA2 = "f".repeat(40);
  const rows = [cls("thing"), cls("trinket", { extends: "thing" }),
    { number: 300, tag_sha: SHA2, newest: 300, kind: "property", key: "trinket/stolen", data: { class: "trinket", parent: null, name: "stolen", tier: "sovereign", default: true, id: "the-town/trinket-stolen" } }];
  await snap.reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === snap.LAW_REFRESH_SQLS.pin ? [{ newest: 300, pinned: 300 }] : rows }) });
  try {
    __setRestoredForTest(null);
    const asked = [];
    const t0 = Date.parse("2026-10-27T07:00:00Z");
    restoredClass("trinket", { now: t0, query: async (sql, params) => { asked.push(sql === CLASS_RUN_SQL ? `run ${params[0]}` : "restores"); return { rows: [] }; } });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(asked, ["restores", "run trinket"], "the law's taken classes include one whose dial is a property node");
  } finally { snap.resetLawSnapshot(); __setRestoredForTest(null); }
});

test("the class view reads a property-node dial the same way: taken, and lifted by a restore", () => {
  const snap = lawSnapshotFromRows([cls("thing"), cls("trinket", { extends: "thing", dials: { clue: "frontmatter's clue" } }), cls("glass-bead", { extends: "trinket" }),
    { number: 300, tag_sha: SHA, newest: 300, kind: "property", key: "trinket/stolen", data: { class: "trinket", parent: null, name: "stolen", tier: "sovereign", default: "true", id: "the-town/trinket-stolen" } }]);
  const view = classViewOf(snap, { restored: () => false });
  assert.equal(view.stolenAny(), true);
  assert.equal(view.dials("trinket").clue, "frontmatter's clue", "the frontmatter's other dials still stand");
  assert.ok(stolenClassRefusal("glass-bead", view), "a subclass of a taken class is refused");
  assert.equal(stolenClassRefusal("glass-bead", classViewOf(snap, { restored: () => true })), null, "restored: answered as on any day");
});
