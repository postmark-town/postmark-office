// terms-seen.test.mjs — the law you were shown, named on a repeat act (POS-697 G5a).
//
// Darko 2026-10-19 09:21, option (c): whole the first time, named after;
// any change to the law shows it whole again; quoted prose is not law; the
// memory forgets toward the whole law, never away from it.
//
// Run: node --test test/terms-seen.test.mjs

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { termsId, termsOnce, namedTerms, forgetShown, SEEN_FOR_MS } from "../src/terms-seen.mjs";

const law = (version = 9, quoted = "a grove") => {
  const t = {
    reading_law: "…",
    binds: { from: "the-town/resident", class: "resident", version, blurb: "b", dials: { pace_km_per_crossing: 60 }, text: "t" },
    means: { from: "the-town/depart", class: "depart", dials: {}, text: "m" },
    articles: [{ id: "the-town/let-there-be-light", text: "Let there be light." }],
    quoted: [{ id: "sol/the-grove", author: "sol", text: quoted }],
    budget: { cap_chars: 4000, used_chars: 1339 },
  };
  return { ...t, id: termsId(t) };
};
const T0 = Date.parse("2026-10-19T13:00:00Z");

beforeEach(() => forgetShown());

test("the first act under a body of law shows it whole; a repeat names it, pinned by its id", () => {
  const t = law();
  assert.equal(termsOnce("wright", t, "walk", { nowMs: T0 }), t);
  const again = termsOnce("wright", t, "walk", { nowMs: T0 + 60_000 });
  assert.deepEqual(again, namedTerms(t, "walk"));
  assert.deepEqual(again.binds, { from: "the-town/resident", version: 9 });
  assert.equal(again.means, "the-town/depart");
  assert.equal(again.whole, 'world { read: "walk" }');
  assert.ok(JSON.stringify(again, null, 1).length < 400, "a fraction of the whole");
});

test("any change to the law changes its id, and it is shown whole again", () => {
  termsOnce("wright", law(9), "walk", { nowMs: T0 });
  const bumped = law(10);
  assert.notEqual(bumped.id, law(9).id);
  assert.equal(termsOnce("wright", bumped, "walk", { nowMs: T0 + 1 }), bumped);
});

test("quoted prose is not law: a new place's words do not change the id", () => {
  assert.equal(law(9, "a grove").id, law(9, "a marquee").id);
});

test("fail-safe: forgetting, another standpoint, an old showing or no id all show the law whole", () => {
  const t = law();
  termsOnce("wright", t, "say", { nowMs: T0 });
  assert.equal(termsOnce("rei", t, "say", { nowMs: T0 + 1 }), t, "another resident was not shown it");
  assert.equal(termsOnce("wright", t, "say", { nowMs: T0 + SEEN_FOR_MS + 1 }), t, "older than this crossing and the last");
  forgetShown();
  assert.equal(termsOnce("wright", t, "say", { nowMs: T0 + SEEN_FOR_MS + 2 }), t, "a restart forgets toward the whole law");
  assert.equal(termsOnce(null, t, "say", { nowMs: T0 }), t);
  const noId = { ...t, id: undefined };
  assert.equal(termsOnce("wright", noId, "say", { nowMs: T0 }), noId);
});
