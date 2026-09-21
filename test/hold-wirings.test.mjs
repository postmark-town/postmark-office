// hold-wirings.test.mjs — THE THREE CALL SITES NOBODY WAS WATCHING.
//
// Repair 4, and it is this lane's own lesson finished rather than learned
// again. On its first flip run the lane found F6: deleting the one line that
// puts hold events on the `since:` shelf reddened NOTHING, because five tests
// watched the deriver and none watched the wiring. It fixed that one site and
// did not carry the method to the other three. The reviewer ran the deletions
// and all three were silent:
//
//   · `groundWithinReach`            — no test names it at all
//   · apex `readHoldEffects` → `happenedBlock` — every reference in the suite
//                                      is the pure deriver or hand-injected events
//   · `thingStandsBlock` on `world_investigate` — never driven
//
// Each probe below drives the REAL function against a temp store, in the shape
// of this lane's two door probes and `test/arena.test.mjs`'s hold-door leg.
// Delete the call site each names and one of these reds.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const TMP = mkdtempSync(join(tmpdir(), "hold-wirings-"));
test.after(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* windows holds it a beat */ } });

const NEAR = "wright/a-thing-underfoot";
const FAR = "wright/a-thing-across-town";

/** A world store with two things: one at the caller's feet, one 900 m off. */
async function storeWithThings(file) {
  const { SCHEMA } = await import("../src/world-store.mjs");
  const path = join(TMP, file);
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const meta = db.prepare("INSERT INTO meta VALUES (?, ?)");
  meta.run("hydration_status", "OK");
  meta.run("as_of_world", "f00dcafe");
  const node = db.prepare("INSERT INTO nodes (id, kind, subkind, tier, by, at_x, at_y, extent_w, extent_h, props) VALUES (?,?,?,?,?,?,?,?,?,?)");
  node.run(NEAR, "mark", "sited", "market", "wright", 0, 0, 1, 1, JSON.stringify({ class: "thing", body: "A trued try-square." }));
  node.run(FAR, "mark", "sited", "market", "wright", 900, 0, 1, 1, JSON.stringify({ class: "thing", body: "A thing across town." }));
  db.close();
  return path;
}

/** Run `fn` with the store and dynamic env pointed at a fresh temp pair. */
async function withStore(file, fn) {
  const prev = { store: process.env.WORLD_STORE_DB, dyn: process.env.WORLD_DYNAMIC_DB };
  const dir = mkdtempSync(join(TMP, "run-"));
  process.env.WORLD_STORE_DB = await storeWithThings(file);
  process.env.WORLD_DYNAMIC_DB = join(dir, "dynamic.db");
  try { return await fn(); }
  finally {
    for (const [k, v] of [["WORLD_STORE_DB", prev.store], ["WORLD_DYNAMIC_DB", prev.dyn]])
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

// ── WIRING 1 · `read: "take"` reaches `groundWithinReach` ────────────────────

test("WIRING 1 — the ground read is REACHED, and answers about the ground under the caller", async () => {
  await withStore("ground.db", async () => {
    const { groundWithinReach } = await import("../src/world-apex.mjs");
    const answer = await groundWithinReach({ standpoint: { x: 0, y: 0, handle: "wright" } }, { handles: new Set(["wright"]) });
    assert.ok(!answer.unavailable, `the ground read was unavailable: ${answer.unavailable}`);
    const ids = (answer.things ?? []).map((t) => t.thing);
    assert.ok(ids.includes(NEAR), "a thing at the caller's feet is not in the ground read");
    assert.equal(ids.includes(FAR), false, "a thing 900 m off is underfoot to nobody");
    const row = answer.things.find((t) => t.thing === NEAR);
    assert.equal(row.takeable, true, "standing on it, the door admits — and Repair 2 says this read must agree");
    assert.equal(row.distance_m, 0);
    assert.ok(answer.reading_law, "the read must carry its own law, as every other read does");
  });
});

test("...and the take SHADOW carries the ground through — driven, so a discarded answer cannot hide", async () => {
  // ⛔ THIS REPLACED A SOURCE-TEXT DETECTOR, and the reviewer showed exactly
  // why. A grep for `groundWithinReach(` proves the call is WRITTEN; it cannot
  // tell "called" from "called and thrown away". The reviewer kept the call and
  // discarded its answer — `ground: ((await groundWithinReach(oriented, key)),
  // null)` — and all six probes stayed green while `read: "take"` answered
  // `ground: null`. The only check that sees that is one which reads what the
  // shadow RETURNS. So this drives `readDomainFor` itself.
  await withStore("shadow.db", async () => {
    const { readDomainFor } = await import("../src/world-apex.mjs");
    const oriented = { standpoint: { x: 0, y: 0, handle: "wright" } };
    const key = { handles: new Set(["wright"]) };
    const domain = await readDomainFor("take", {}, key, oriented, {});

    assert.ok(domain, "the take shadow answered nothing at all");
    assert.ok(domain.ground, "read: \"take\" answered no ground — walk #12 asked for the ground and this is the answer that carries it");
    assert.ok(!domain.ground.unavailable, `the ground read was unavailable: ${domain.ground.unavailable}`);
    const ids = (domain.ground.things ?? []).map((t) => t.thing);
    assert.ok(ids.includes(NEAR), "the thing at the caller's feet did not reach the shadow's answer");
    assert.equal(ids.includes(FAR), false, "and a thing 900 m off must not");
    // give/drop keep their holdings-only domain, so the shadow must still carry
    // the hands beside the ground rather than having swapped one for the other.
    assert.ok(domain.holdings, "the take shadow lost the caller's own hands");
  });
});

test("...and give/drop are UNCHANGED — their domain is your hands, and only take grew a ground", async () => {
  await withStore("shadow-give.db", async () => {
    const { readDomainFor } = await import("../src/world-apex.mjs");
    const oriented = { standpoint: { x: 0, y: 0, handle: "wright" } };
    const key = { handles: new Set(["wright"]) };
    for (const verb of ["give", "drop"]) {
      const domain = await readDomainFor(verb, {}, key, oriented, {});
      assert.ok(domain.holdings, `read: "${verb}" lost the caller's hands`);
      assert.equal(domain.ground, undefined,
        `read: "${verb}" grew a ground block — those two verbs act on what you hold, so your hands are their whole domain`);
    }
  });
});

// ── WIRING 2 · the apex joins hold effects onto the `since:` shelf ───────────

test("WIRING 2 — `readHoldEffects` reads the journal the office actually writes", async () => {
  await withStore("holds.db", async () => {
    const { openDynamic } = await import("../src/dynamic-store.mjs");
    const { appendJournal, CLASS_HOLDING } = await import("../src/world-journal.mjs");
    const db = openDynamic();
    try {
      appendJournal(db, {
        crossing: 175, actor: "wright", action: "give", object: NEAR,
        at: { anchor: null, dx: 0, dy: 0 }, witnesses: { source: "presence", list: [] },
        cls: CLASS_HOLDING, household: "hh:trueing",
        payload: { thing: NEAR, holder: "ethan-thorne", previous_holder: "wright", made_by: "wright", policy: "cascade" },
        effect: "ethan-thorne holds it now", writtenAt: "2026-09-07T13:57:16Z",
      });
    } finally { db.close(); }

    const { readHoldEffects } = await import("../src/world-hold.mjs");
    const out = await readHoldEffects({ handles: ["wright"], sinceCrossing: 175, nowCrossing: 175 });
    assert.equal(out.readable, true, `the holding record was unreadable: ${out.reason}`);
    assert.equal(out.events.length, 1, "a give written to the journal did not come back out of it");
    assert.equal(out.events[0].kind, "hold-give");
    assert.equal(out.events[0].thing, NEAR);
  });
});

test("...and the `since:` shelf CARRIES the hold event — driven through happenedFor, not read off the source", async () => {
  // The same replacement, for the same reason: a grep proves `holdEffects` is
  // passed; it cannot prove the events arrive. This drives the whole join —
  // journal row in, `happened.to_you` out.
  const prev = { dyn: process.env.WORLD_DYNAMIC_DB, mv2: process.env.WORLD_MOVEMENT_V2 };
  const dir = mkdtempSync(join(TMP, "shelf-"));
  process.env.WORLD_DYNAMIC_DB = join(dir, "dynamic.db");
  // `happenedFor` answers null with the flag off, which is dev's own condition
  // for a store-written position (src/world.mjs § THE WALK GAP).
  process.env.WORLD_MOVEMENT_V2 = "1";
  try {
    const { openDynamic } = await import("../src/dynamic-store.mjs");
    const { appendJournal, CLASS_HOLDING } = await import("../src/world-journal.mjs");
    const { currentCrossing } = await import("../src/crossings.mjs");
    const now = currentCrossing();

    const db = openDynamic();
    try {
      appendJournal(db, {
        crossing: now, actor: "wright", action: "give", object: NEAR,
        at: { anchor: null, dx: 0, dy: 0 }, witnesses: { source: "presence", list: [] },
        cls: CLASS_HOLDING, household: "hh:trueing",
        payload: { thing: NEAR, holder: "ethan-thorne", previous_holder: "wright", made_by: "wright", policy: "cascade" },
        effect: "ethan-thorne holds it now", writtenAt: new Date().toISOString(),
      });
    } finally { db.close(); }

    const { happenedFor } = await import("../src/world-apex.mjs");
    const oriented = { standpoint: { x: 0, y: 0, handle: "wright" }, crossing: { n: now } };
    const block = await happenedFor(oriented, { since: now }, { handles: new Set(["wright"]) });

    assert.ok(block, "the happened path answered nothing — the cursor read is off");
    assert.ok(!block.unavailable, `the delta could not be read: ${block.detail ?? block.unavailable}`);
    const kinds = (block.to_you?.events ?? []).map((e) => e.kind);
    assert.ok(kinds.includes("hold-give"),
      `a give of a thing of mine did not reach happened.to_you (${JSON.stringify(kinds)}) — walk #11's certified zero, back`);
    const ev = block.to_you.events.find((e) => e.kind === "hold-give");
    assert.equal(ev.thing, NEAR);
    assert.equal(ev.from_you, true, "it left wright's hands, and the shelf must say which way");
    assert.equal(block.to_you.complete, true, "every source answered, so the promise is kept");
  } finally {
    for (const [k, v] of [["WORLD_DYNAMIC_DB", prev.dyn], ["WORLD_MOVEMENT_V2", prev.mv2]])
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

// ── WIRING 3 · `world_investigate` carries the `stands` block ────────────────

test("WIRING 3 — `world_investigate` itself carries the `stands` block, driven end to end", async () => {
  // THE REAL DOOR, on a REAL canon mark. The temp world store cannot serve this
  // one: `worldInvestigate` folds canon out of WORLD_CLONE, not `world.db`, so
  // a fixture id would answer "no mark" and never reach the block. So the probe
  // takes a thing that genuinely stands in canon, puts a holding edge for it in
  // front of the door, and asks the focus.
  //
  // ⚑ THE HOLDING EDGE MOVED STORES (POS-162). This probe wrote a
  // `declareAttachment` into a temp `dynamic.db` until 2026-09-21, and that is
  // the read the block no longer makes: both halves come from `acts` now, with
  // no flag and no sqlite under them. The CLAIM is unchanged — the wiring is
  // driven, not the deriver — and only the record the fixture writes to moved.
  // The store legs live in `test/investigate-stands-reads-the-store.test.mjs`.
  const { holdingAct, withActs } = await import("./stands-store-fixture.mjs");
  const { worldMarkById, worldInvestigate } = await import("../src/world.mjs");
  const CANON = "quill-stem/candle-for-the-trail";
  const { mark } = await worldMarkById(CANON);
  assert.ok(mark, `${CANON} must stand in canon for this probe to mean anything`);

  // Before: no holding edge anywhere, so the block is ABSENT and the focus is
  // exactly what it always was. This is the "additive, and absent is the
  // default" claim, driven rather than asserted.
  const before = await withActs([], () => worldInvestigate({ mark: CANON }));
  assert.ok(!before.error, `the focus bounced: ${before.defect}`);
  assert.equal(before.stands, undefined,
    "a mark nobody has ever held must answer byte-for-byte what it answered before this lane");

  // Now somebody holds it.
  const after = await withActs(
    [holdingAct({ id: 1, at: "2026-09-07T21:53:00Z", actor: "wright", action: "take", thing: CANON, holder: "wright" })],
    () => worldInvestigate({ mark: CANON }));
  assert.ok(after.stands, "the holding record knows this thing and the focus does not — walk #12's 536 m, back");
  assert.equal(after.stands.source, "holder");
  assert.equal(after.stands.holder, "wright");
  assert.match(String(after.stands.says), /rides its holder/);
  // AND `at` IS UNTOUCHED. The block sits BESIDE canon's own answer; quietly
  // substituting one for the other is the complaint, not the repair.
  assert.deepEqual(after.at, before.at, "canon's own `at` must not be rewritten by the derived read");
});

test("...and the three sources answer in the law's own order", async () => {
  // The deriver's contract, on hand-built rows: holder first, set-down second,
  // canon's fold only when neither speaks.
  const hold = await import("../src/world-hold.mjs");
  const held = await hold.whereThingStands(NEAR, {
    attachments: [{ target: NEAR, entity: "rei", policy: "cascade", born_at: "2026-09-07T01:00:00Z" }],
    journal: [{ seq: 1, object: NEAR, action: "drop", actor: "wright", class: "holding", at: { anchor: null, dx: 5, dy: 5 } }],
    fold: { x: 900, y: 0 },
    standpointOf: async () => ({ x: 1, y: 2 }),
  });
  assert.equal(held.source, "holder", "a holder outranks a drop act and the fold both");
  assert.deepEqual(held.where, { x: 1, y: 2 });

  const down = await hold.whereThingStands(NEAR, {
    attachments: [{ target: NEAR, entity: "wright", policy: "detach", born_at: "2026-09-07T02:00:00Z" }],
    journal: [{ seq: 1, object: NEAR, action: "drop", actor: "wright", class: "holding", at: { anchor: null, dx: 5, dy: 5 } }],
    fold: { x: 900, y: 0 },
  });
  assert.equal(down.source, "set-down", "a drop act outranks the fold");
  assert.deepEqual(down.where, { x: 5, y: 5 });
});
