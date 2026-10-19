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

// WLD-27's doors ship dark by default (src/chests-candy.mjs); these are their own tests, so they run with them open.
process.env.WORLD_CHESTS_CANDY = "1";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-wld27");
const { leaveMarkViaOffice, CANDY_IS_MADE } = await import("../src/world.mjs");
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
  ["lollipop", { extends: "candy", dials: {} }], // a kind of candy that inherits makers: true (POS-692)
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

// ── POS-692: A PLACED CANDY IS REFUSED AT THE DOOR, WITH THE WAY THAT WORKS ──
// amia-semper's four named sweets (S118) were taken here as drafts and refused
// at the crossing as `dropped-unit-unproven: no act`, with no word. The door now
// asks the clearing's own rule (drop-provenance.mjs § isCandyClass, dropRefusalOf).
const placed = { slug: "creek-honey-toffee", kind: "candy", at: { x: 3200, y: -2900 }, extent: { w: 1, h: 1 },
  body: "Creek honey toffee: amber, chewy, warm." };

test("A PLACED CANDY is refused at once, in both spellings and by lineage, with the way candy is made", async () => {
  assert.equal(await sentence({ ...placed }), CANDY_IS_MADE.defect, "kind: candy (amia-semper's shape)");
  assert.equal(await sentence({ ...placed, kind: "sited", class: "candy" }), CANDY_IS_MADE.defect, "the old spelling");
  assert.equal(await sentence({ ...placed, kind: "lollipop" }), CANDY_IS_MADE.defect, "a kind of candy is candy");
  let hint = null;
  try { await leaveMarkViaOffice(process.env.WORLD_CLONE, { ...placed }, one); } catch (e) { hint = e.hint; assert.equal(e.code, 422); }
  assert.ok(hint.includes(`leave-mark { kind: "<a kind>", count: 5, to: "alpha" }`), "the resident's own handle, in the call that works");
  assert.ok(hint.includes(`explain: "candy" lists the kinds`), "where the kinds are found");
  assert.ok(hint.includes("Write to wright"), "how a new kind is asked for (Darko 2026-10-19)");
  assert.match(hint, /Nothing was written\.$/);
  assert.doesNotMatch(hint, /set it down|drop/, "a set-down by kind is not built, so it is not offered");
});

test("a town-only class under candy still says town-only first; a thing is untouched", async () => {
  assert.equal(await sentence({ ...placed, kind: "the-town-alone" }), 'class "the-town-alone" is town-only');
  assert.notEqual(await sentence({ ...placed, kind: "thing" }), CANDY_IS_MADE.defect);
});

test("a candy naming a set-down is PROVED by the record, not waved through: no store here, so it cannot be checked", async () => {
  assert.equal(await sentence({ ...unit }), "the set-down this candy names could not be checked",
    "the door reads the act it names (dropRefusalOf), exactly as the clearing does");
});

test("the hold door's own set-down still files (proved by construction)", async () => {
  const ok = await sentence({ ...unit }, { dropUnit: { actId: 77, label: "test-comets" } });
  assert.notEqual(ok, CANDY_IS_MADE.defect);
  assert.notEqual(ok, "the set-down this candy names could not be checked");
});

// ── POS-692 (kogane's bug post): A MAKE'S ACTOR IS THE TOP-LEVEL HANDLE ──────
// On a two-resident key, world { handle: "kogane", do: "leave-mark", args: { to:
// "kogane", kind: "candy", count: 1 } } bounced "which resident is making these?",
// and handle kogane with by: keith ran as keith. The handle wins; a by naming
// another resident is two actors, refused. (No hold store here: past the actor,
// the make fails later, so the assertions are about which sentence comes back.)
const two = { household: "house-a", handles: new Set(["alpha", "beta"]) };
const makeSays = async (payload) => {
  try { await leaveMarkViaOffice(process.env.WORLD_CLONE, payload, two); return "LANDED"; }
  catch (e) { return String(e.defect ?? e.message); }
};
const make = { to: "alpha", kind: "candy", count: 1 };

test("A MAKE'S ACTOR IS THE TOP-LEVEL HANDLE on a two-resident key; a by naming another is two actors", async () => {
  assert.notEqual(await makeSays({ ...make, handle: "alpha" }), "which resident is making these?", "the handle names who makes");
  assert.equal(await makeSays({ ...make, handle: "alpha", by: "beta" }), 'two residents named: handle "alpha" and by "beta"');
  assert.doesNotMatch(await makeSays({ ...make, handle: "alpha", by: "alpha" }), /two residents named/, "the same resident twice is one");
  assert.doesNotMatch(await makeSays({ ...make, by: "beta", to: "beta" }), /two residents named|which resident/, "by alone still names the maker");
  assert.equal(await makeSays({ ...make }), "which resident is making these?", "neither, on a two-resident key: still asked");
  assert.equal(await makeSays({ ...make, handle: "gamma" }), '"gamma" is not one of your residents');
});
