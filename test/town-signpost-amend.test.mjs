// town-signpost-amend.test.mjs — the one amend of the town's signpost checks the exact record first (POS-606).
//
// Wright's scope word (2026-11-03 22:4x EST): one act, one receipt, the exact current record checked first. These pin
// the plan: the approved text, the record it may replace, and every refusal that writes nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { amendPlan, applyGate, DECLARED_KIND, EXPECTED, MARK, NEW_BODY, OLD_BODY } from "../tools/town-signpost-amend.mjs";

const record = (over = {}) => ({ id: MARK, ...EXPECTED, at: { ...EXPECTED.at }, extent: { ...EXPECTED.extent }, body: OLD_BODY, ...over });
const now = new Date("2026-11-04T12:00:00Z");

test("the approved text is Wright's, 128 characters, and drops the retired bounty", () => {
  assert.equal(NEW_BODY.length, 128);
  assert.ok(!/bounty/i.test(NEW_BODY));
  assert.ok(/Think Tank/.test(NEW_BODY) && /letter/.test(NEW_BODY));
});

test("the record as it has stood since S51: one amend, as the town, of this mark only", () => {
  const { clean, refusal } = amendPlan(record(), [], now);
  assert.equal(refusal, undefined);
  assert.equal(DECLARED_KIND, "sited");
  assert.deepEqual(clean, { slug: "how-ideas-enter", kind: "sited", at: { x: 258, y: -97 }, extent: { w: 3, h: 2 }, body: NEW_BODY, by: "the-town", household: "the-town", date: now.toISOString(), amend: true });
});

test("already amended in canon: refused, nothing written", () => {
  assert.match(amendPlan(record({ body: NEW_BODY }), [], now).refusal, /already amended/);
});

test("an amend already waiting for the crossing: refused, so a second --apply is never a second act", () => {
  assert.match(amendPlan(record(), [{ id: MARK, body: NEW_BODY }], now).refusal, /already applied/);
  assert.match(amendPlan(record(), [{ id: MARK, body: "other" }], now).refusal, /other words/);
  assert.equal(amendPlan(record(), [{ id: "the-town/other", body: "x" }], now).refusal, undefined);
});

test("a record that is not the reviewed one: refused, naming what differs", () => {
  assert.match(amendPlan(record({ body: OLD_BODY + " " }), [], now).refusal, /body is not the one approved/);
  assert.match(amendPlan(record({ at: { x: 259, y: -97 } }), [], now).refusal, /at is/);
  assert.match(amendPlan(record({ extent: { w: 4, h: 2 } }), [], now).refusal, /extent is/);
  assert.match(amendPlan(record({ tier: "commons" }), [], now).refusal, /tier is "commons"/);
  assert.match(amendPlan(record({ by: "someone" }), [], now).refusal, /by is "someone"/);
  assert.match(amendPlan(null, [], now).refusal, /not in canon/);
});

test("the apply writes only when the office's preview says it publishes", () => {
  assert.equal(applyGate({ would: "amend", put_forward: true }), null);
  assert.match(applyGate({ would: "amend", put_forward: false }), /private draft and not publish/);
  assert.match(applyGate({ would: "leave", put_forward: true }), /would not amend/);
  assert.match(applyGate(null), /would not amend/);
});
