// candy-and-chest-at-the-door.test.mjs — WLD-27 at the placement door.
//
// Wright, 2026-10-13T00:09Z: candy stays OFF the resident whitelist — a
// resident placing a fresh `class: candy` mark is refused — while the drop's
// own road (world-units.mjs hands `dropUnit` to `leaveMarkViaOffice`) passes the
// class gate for the unit it set down, and only that unit. A chest is
// resident-instantiable, with capacity 1..120, portable true/false and an
// open/closed welcome.
//
// The class layer is a SYNTHETIC law snapshot, published through
// `reloadLawSnapshot`'s own query seam, so the roster gate answers as it would
// on the record; there is no world clone, so a write that passes the gates
// fails later — the assertions are about WHICH sentence comes back.

import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-wld27");
const { leaveMarkViaOffice } = await import("../src/world.mjs");
const { reloadLawSnapshot, resetLawSnapshot, LAW_REFRESH_SQLS } = await import("../src/law-snapshot.mjs");

const CHEST_DIALS = { capacity: 30, capacity_min: 1, capacity_max: 120, first_stock: 30, portable: true, welcome: "open" };
// The makers law (LOGOS v2, O1): "`thing`, `note`, `post` and `predicate` answer true
// … everything under them inherits it (the candy kinds, consumables); a subclass
// sets false only to be the town's alone" (classes.md § makers, ruled 18:44). The
// root states false; `the-town-alone` is a synthetic subclass that sets false.
const CLASS_ROWS = [
  ["postmark-node", { dials: { makers: false } }], ["mark", { extends: "postmark-node" }],
  ["bounty", { extends: "mark", dials: { makers: true } }], ["thing", { extends: "mark", dials: { carry_cap: 24, makers: true } }],
  ["note", { extends: "mark", dials: { makers: true } }], ["idea", { extends: "mark", dials: { makers: true } }],
  ["consumable", { extends: "thing", dials: {} }],
  ["candy", { extends: "consumable", dials: {}, labels: [{ label: "test-comets", name: "Test Comets", creator: "alpha" }] }],
  ["the-town-alone", { extends: "candy", dials: { makers: false } }],
  ["chest", { extends: "thing", dials: CHEST_DIALS }],
  ["lawless", {}],
].map(([key, data]) => ({ number: 250, tag_sha: "f".repeat(40), newest: 250, kind: "class", key, data: { class: key, ...data } }));

await reloadLawSnapshot({ force: true, query: async (sql) =>
  ({ rows: sql === LAW_REFRESH_SQLS.pin ? [{ newest: 250, pinned: 250 }] : CLASS_ROWS }) });
test.after(() => resetLawSnapshot());

const one = { household: "house-a", handles: new Set(["alpha"]) };
const unit = { by: "alpha", slug: "test-comets-77", kind: "sited", at: { x: 3, y: 4 }, extent: { w: 1, h: 1 },
  body: "One Test Comets, set down here.", class: "candy", label: "test-comets", dropped: "act:77", stamps: 1 };
const chest = { slug: "the-bowl", kind: "sited", at: { x: 3, y: 4 }, extent: { w: 1, h: 1 }, body: "A bowl of sweets by the door.", class: "chest" };

const sentence = async (payload, opts) => {
  try { await leaveMarkViaOffice(process.env.WORLD_CLONE, payload, one, opts); return "LANDED"; }
  catch (e) { return String(e.defect ?? e.message); }
};

test("the synthetic law is what the door reads (the roster knows candy and chest)", async () => {
  assert.notEqual(await sentence({ ...chest }), 'unknown class "chest"');
});

test("WHO MAY MAKE IT is the class's makers, inherited down extends (the hand-kept whitelist is retired)", async () => {
  // candy inherits thing's makers: true: "The town makes the candy kinds … and residents may make instances of any of them."
  assert.ok(!/town-only|unknown class/.test(await sentence({ ...unit, dropped: undefined })), "candy passes the class gate on its inherited makers");
  // a subclass that sets makers: false is the town's alone, whatever it extends
  assert.equal(await sentence({ ...unit, class: "the-town-alone", dropped: undefined }), 'class "the-town-alone" is town-only');
  // no class in the lineage states makers: the unread answer is false, the root's own (G2: no floor)
  assert.equal(await sentence({ ...chest, class: "lawless" }), 'class "lawless" is town-only');
  // a chest is a thing, and inherits its makers: true
  assert.ok(!/town-only/.test(await sentence({ ...chest })), "chest inherits thing's makers: true");
});

test("the drop's own road passes the class gate for its own unit", async () => {
  const ok = await sentence({ ...unit }, { dropUnit: { actId: 77, label: "test-comets" } });
  assert.ok(!/town-only|unknown class/.test(ok), `the dropped unit passed the class gate (then: ${ok})`);
  // The drop road's own refusals for ANOTHER unit (another act, another label, not
  // sited) were the hand list's: under the makers law candy is a resident's to
  // make, so those payloads now pass the class gate on candy's own answer.
});

test("a chest's capacity is 1..120; portable is a boolean; welcome is open or closed", async () => {
  for (const c of [0, 121, 2.5, "lots"]) assert.equal(await sentence({ ...chest, capacity: c }), "a chest's capacity is a whole number from 1 to 120", `capacity ${c}`);
  for (const c of [1, 20, 30, 60, 120]) assert.ok(!/capacity/.test(await sentence({ ...chest, capacity: c })), `capacity ${c} passes`);
  assert.equal(await sentence({ ...chest, portable: "no" }), "portable is true or false");
  assert.equal(await sentence({ ...chest, welcome: "maybe" }), "welcome is open or closed");
  assert.equal(await sentence({ ...chest, kind: "parcel", extent: undefined }), "a chest is a sited mark");
});
