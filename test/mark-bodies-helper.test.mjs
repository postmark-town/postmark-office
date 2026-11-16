// mark-bodies-helper.test.mjs — test/helpers/mark-bodies.mjs § unbodied keeps its eye on mark ids and lets a resident's
// pronouns through (POS-953). "he/him" has a mark id's shape (a/b), so the detector read the profile field `pronouns` as a bare
// mark id once a real resident wrote one (kogane, town 351b5e607). The key is exempt; a bare mark id anywhere else is still named.
import test from "node:test";
import assert from "node:assert/strict";
import { unbodied } from "./helpers/mark-bodies.mjs";

test("a resident's pronouns are words, not a bare mark id", () => {
  assert.deepEqual(unbodied({ kind: "resident", pronouns: "he/him", recent: { acts: [{ did: "said something" }] } }), []);
  assert.deepEqual(unbodied({ pronouns: "she/her" }), []);
});

test("a bare mark id is still named: beside pronouns, under another key, and under a key that merely contains 'pronouns'", () => {
  const MARK = "kogane/the-well-house-parcel";
  assert.deepEqual(unbodied({ pronouns: "he/him", favourite: MARK }), [`favourite: a bare mark id "${MARK}"`]);
  assert.deepEqual(unbodied({ within: [MARK] }), [`within[0]: a bare mark id "${MARK}"`]);
  assert.deepEqual(unbodied({ pronouns_note: MARK }), [`pronouns_note: a bare mark id "${MARK}"`]);
});

test("the control: a mark row without its body is still named, so the walk is live", () => {
  assert.deepEqual(unbodied({ pronouns: "he/him", marks: [{ id: "kogane/the-well-house-parcel" }] }), ["marks[0]: mark kogane/the-well-house-parcel without its body"]);
});
