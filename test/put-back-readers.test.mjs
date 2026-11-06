// put-back-readers.test.mjs — WLD-138 B: every reader of holds, attachments and made things reads the
// `put-back` face (Wright, AUTHORITY 2026-11-04T16:00:21.585Z, constraint 4: "a falsifier per reader"),
// and the made record restores across a kept base or window boundary, including when the original
// make predates the window (constraint 3). PURE: rows in, answers out; the store-backed doors are
// proved in set-down-holder-put-back.test.mjs. Invented ids and handles only.
//
//   node --test test/put-back-readers.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { foldMade, PUT_BACK_FACE, madeNamesParams, setDownWords, holdsWords } from "../src/named-making.mjs";
import { HOLD_FACES, ATTACHMENT_ACTIONS, attachmentRecords } from "../world2/tools/guard-reads.mjs";
import { holdRecordKeeper } from "../src/hold-record.mjs";
import { ownershipEvents, foldOwners, ownershipOf } from "../src/ownership.mjs";
import { liveHolder, holdingsOf, holdEffectsFrom } from "../src/world-hold.mjs";
import { holdPrintout } from "../world2/tools/hold-through.mjs";
import { HOLDER_NOT_ON_THE_WORLD } from "../src/world-kinds.mjs";

const BAG = "sbx-cy/a-bag", SLIP = "sbx-cy/a-slip";
const MADE = { id: BAG, by: "sbx-cy", slug: "a-bag", kind: "thing", body: "A cloth bag.", holder: true, capacity: 30 };
const at = (id) => new Date(1_800_000_000_000 + id * 1000).toISOString();
// holding rows, as guard-reads § holdingRowOf / hold-record readers give them
const hrow = (seq, action, payload) => ({ seq, class: "holding", action, object: BAG, actor: "sbx-cy", payload: { thing: BAG, ...payload } });
const MAKE = hrow(1, "make", { holder: "sbx-cy", policy: "cascade", made: MADE });
const SET_DOWN = hrow(5, "set-down", { holder: null, previous_holder: "sbx-cy", policy: "detach", made_by: "sbx-cy", set_down: { at: { x: 1, y: 1 }, draft: BAG } });
const PUT_BACK = hrow(9, PUT_BACK_FACE, { holder: "sbx-cy", policy: "cascade", made_by: "sbx-cy", made: MADE, put_back: { set_down: "5", draft: BAG, make: "1" } });
// the same three as `acts` rows, for the attachment reader
const act = (r) => ({ id: r.seq, at: at(r.seq), actor: r.actor, action: r.action, payload: r.payload });

test("the face is in the one list every hold read asks (HOLD_FACES, ATTACHMENT_ACTIONS) and in the made-names read", () => {
  assert.ok(HOLD_FACES.includes("put-back"));
  assert.ok(ATTACHMENT_ACTIONS.includes("put-back"));
  assert.ok(madeNamesParams([BAG])[1].includes("put-back"));
});

test("READER guard-reads § attachmentRecords: a put-back is a live hold row, its holder the hands it came back to (strict: never refused)", () => {
  const { rows, refusals } = attachmentRecords([MAKE, SET_DOWN, PUT_BACK].map(act), { strict: true });
  assert.deepEqual(refusals, []);
  assert.deepEqual(rows.map((r) => [r.target, r.policy, r.era]), [[BAG, "cascade", "live"], [BAG, "detach", "live"], [BAG, "cascade", "live"]]);
  assert.equal(rows[2].entity, "sbx-cy", "the put-back's holder: the hands it came back to");
});

test("READER world-hold § liveHolder / holdingsOf: last row wins, so the bag is in hand again, and the slip is still the bag's", () => {
  const { rows } = attachmentRecords([MAKE, act({ ...hrow(2, "make", { holder: BAG, policy: "cascade" }), object: SLIP, payload: { thing: SLIP, holder: BAG, policy: "cascade" } }), SET_DOWN, PUT_BACK].map((r) => (r.id ? r : act(r))));
  assert.equal(liveHolder(rows, BAG), "sbx-cy");
  assert.deepEqual(holdingsOf(rows, "sbx-cy"), [BAG]);
  assert.deepEqual(holdingsOf(rows, BAG), [SLIP]);
  // set down and not put back: in no one's hands
  const { rows: pending } = attachmentRecords([MAKE, SET_DOWN].map(act));
  assert.deepEqual(holdingsOf(pending, "sbx-cy"), []);
});

test("READER named-making § foldMade: set down lets it go, put back takes it back AS THE MAKE'S OWN RECORD; a put-back carrying another id's record is not read", () => {
  assert.equal(foldMade([MAKE, SET_DOWN]).has(BAG), false);
  assert.deepEqual(foldMade([MAKE, SET_DOWN, PUT_BACK]).get(BAG), MADE);
  const wrong = hrow(9, PUT_BACK_FACE, { holder: "sbx-cy", policy: "cascade", made: { ...MADE, id: "sbx-cy/another" } });
  assert.equal(foldMade([MAKE, SET_DOWN, wrong]).has(BAG), false);
});

test("CONSTRAINT 3 · across the kept base and the window: the make (and the set-down) folded into the base, the put-back in the window; the make before every window; and the put-back itself moved into the base", async () => {
  // foldMade on its own, base then window
  const base = foldMade([MAKE, SET_DOWN]); // the make predates the window entirely: the base no longer holds it
  assert.deepEqual(foldMade([PUT_BACK], base).get(BAG), MADE, "restored from the put-back's own record");
  assert.deepEqual(foldMade([SET_DOWN, PUT_BACK], foldMade([MAKE])).get(BAG), MADE, "make in the base, set-down and put-back in the window");
  // the keeper itself (hold-record.mjs), with a window so narrow the cutoff advances past each row
  const holding = [MAKE, SET_DOWN, PUT_BACK, ...Array.from({ length: 6 }, (_, i) => ({ seq: 20 + i, class: "holding", action: "units:give", object: "sbx-zz", payload: { moves: [] } }))];
  const readers = {
    readTop: async () => String(Math.max(...holding.map((r) => r.seq))),
    readHolding: async ({ afterId = null } = {}) => holding.filter((r) => afterId == null || r.seq > afterId),
    readAttachments: async () => [],
  };
  for (const width of [1, 3, 8, 50]) {
    const k = holdRecordKeeper({ ...readers, width });
    const rec = await k.now();
    assert.deepEqual(rec.made.get(BAG), MADE, `width ${width}: cutoff ${rec.cutoff}`);
  }
  // a set-down newer than the put-back (set down again): gone again, whatever the base holds
  const again = hrow(12, "set-down", { holder: null, previous_holder: "sbx-cy", policy: "detach", made_by: "sbx-cy", set_down: { draft: BAG } });
  assert.equal(foldMade([again], foldMade([MAKE, SET_DOWN, PUT_BACK])).has(BAG), false);
});

test("READER ownership § ownershipEvents/foldOwners: a put-back moves no ownership and opens no outing (it comes back to the house it was set down from)", () => {
  const owners = foldOwners(ownershipEvents([MAKE, SET_DOWN, PUT_BACK]));
  assert.deepEqual(ownershipOf(owners, BAG), { owner: "sbx-cy", outing: null });
});

test("READER hold-through § holdPrintout: the clearing after a put-back prints nothing for the holder (it is in hand, as a thing made in hand is never printed) and leaves what it holds as it was", () => {
  const atts = [
    { act_id: "1", entity: "sbx-cy", target: BAG, policy: "cascade", born_at: at(1) },
    { act_id: "3", entity: BAG, target: "sbx-ana/a-cone", policy: "cascade", born_at: at(3) }, // a published cone given into the bag
    { act_id: "5", entity: null, target: BAG, policy: "detach", born_at: at(5) },
    { act_id: "9", entity: "sbx-cy", target: BAG, policy: "cascade", born_at: at(9) },
  ];
  const cone = { id: "77", slug: "sbx-ana/a-cone", kind: "thing", owner: "sbx-ana", geometry: null, data: { held_by: BAG } };
  const plan = holdPrintout({ attachments: atts, rows: [cone], setDowns: new Set(["5"]) });
  assert.equal(plan.prints.find((p) => p.slug === BAG), undefined, "the holder is not printed");
  assert.equal(plan.prints.find((p) => p.slug === "sbx-ana/a-cone"), undefined, "the cone is printed held by the bag already: nothing to change");
  // the control: the cone's row read as somewhere else is printed back into the bag, never loose
  const loose = holdPrintout({ attachments: atts, rows: [{ ...cone, data: {}, geometry: { at: { x: 1, y: 1 } } }], setDowns: new Set(["5"]) });
  assert.equal(loose.prints.find((p) => p.slug === "sbx-ana/a-cone")?.data?.held_by, BAG);
});

test("READER world-hold § holdEffectsFrom: a put-back is told as what happened, never as a hand-over", () => {
  const told = holdEffectsFrom({ rows: [{ ...PUT_BACK, crossing: 7 }], handles: ["sbx-cy"], sinceCrossing: 0, nowCrossing: 9 });
  assert.equal(told.length, 1);
  assert.match(told[0].summary, /sbx-cy\/a-bag came back to sbx-cy, whole, its draft withdrawn before it published/);
  assert.doesNotMatch(told[0].summary, /handed/);
});

test("F3 · the words: a holder not on the world is never said to hold nothing; a full set-down says what it holds and what that means; an empty one says what it always did", () => {
  assert.doesNotMatch(HOLDER_NOT_ON_THE_WORLD, /a draft holds nothing yet|gives them up/);
  assert.match(HOLDER_NOT_ON_THE_WORLD, /keeps what it holds, inside it, but nothing goes in or comes out until it publishes/);
  assert.match(HOLDER_NOT_ON_THE_WORLD, /on the commons only with a stamp behind it/);
  assert.equal(holdsWords({ things: 2, units: 5 }), "2 whole things and 5 units");
  assert.equal(holdsWords({}), null);
  const full = setDownWords({ id: BAG, maker: "sbx-cy", stake: "bounced", holds: "1 whole thing" });
  assert.match(full, /publishes only with one behind it .*holding 1 whole thing: they stay inside it and publish with it/);
  assert.equal(setDownWords({ id: BAG, maker: "sbx-cy", stake: "free" }),
    "sbx-cy/a-bag is set down where you stood, as sbx-cy's draft, on its own ground, free: it publishes at the next settlement");
});
