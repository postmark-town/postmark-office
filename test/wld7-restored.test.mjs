// wld7-restored.test.mjs — a taken class given back by the town's own act (WLD-7, WLD-25/j).
//
// The question at every door is: the dial says `stolen: true` AND the town has not
// restored the class since the dial went on (Wright 2026-10-22, from Darko's WLD-25/j
// at 14:52). When the dial went on is read from the law: the bless of the earliest
// settlement in the newest unbroken run that says stolen. src/restored-classes.mjs.
//
// THE CAN-FAIL FLIPS (each reds a case below): keep a read taken against the old law
// after a publish (POS-680); ignore `restored` in stolenRefusal;
// count a restore from before the run began; let a non-town restore count.

import { test } from "node:test";
import assert from "node:assert/strict";
import { restoredSince, stolenSinceOf, readRestored, restoredClass, KEEP_MS, __setRestoredForTest, RESTORE_ROWS_SQL, CLASS_RUN_SQL,
  refreshRestored, restoredStanding } from "../src/restored-classes.mjs";
import { reloadLawSnapshot, resetLawSnapshot, PIN_SQL } from "../src/law-snapshot.mjs";
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

test("a read started against the old law and finishing after a publish never replaces the keep or clears stale (POS-680)", async () => {
  __setRestoredForTest({ trinket: { since: "2026-10-26T06:30:00.000Z", restored: true } });
  const settle = () => new Promise((r) => setImmediate(r));
  // the store: the first read (against the old law) is held on its way back, and would say "not restored";
  // every ask after it finds the store down
  let release;
  const gate = new Promise((r) => { release = r; });
  let calls = 0;
  const query = async (sql) => {
    calls += 1;
    if (calls > 2) throw new Error("ECONNREFUSED");
    if (calls === 1) await gate;
    return sql === RESTORE_ROWS_SQL ? { rows: [] } : { rows: [{ number: 130, blessed_at: "2026-10-26T06:30:00Z", data: { dials: { stolen: true } } }] };
  };
  const oldRead = refreshRestored({ query, classes: ["trinket"] });
  await settle();
  // a new law is published while that read is out (the trinket still taken): the keep goes stale, and no
  // second read starts beside the first
  const published = await reloadLawSnapshot({ query: async (sql) => (sql === PIN_SQL ? { rows: [{ newest: 131, pinned: 131 }] }
    : { rows: [{ number: 131, tag_sha: "d".repeat(40), newest: 131, kind: "class", key: "trinket", data: { class: "trinket", dials: { stolen: true } } }] }) });
  assert.equal(published.changed, true);
  assert.equal(restoredStanding().stale, true);
  release();
  await oldRead;
  for (let i = 0; i < 5; i++) await settle();   // and the re-ask against the new law, which finds the store down
  assert.equal(restoredClass("trinket", { now: Date.now(), query }), true, "the old-law read replaced the keep");
  assert.equal(restoredStanding().stale, true, "the old-law read cleared stale: the keep would claim the new law's answer");
  assert.ok(calls >= 3, "the read thrown away was asked again, against the new law");
  __setRestoredForTest(null);
  resetLawSnapshot();
});
