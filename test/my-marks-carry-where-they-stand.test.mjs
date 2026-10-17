// my-marks-carry-where-they-stand.test.mjs — the portfolio door says WHERE
// (2026-09-10).
//
// THE RULING. Keemin, 22:5x EDT: "can we just add coords to my marks?" — yes.
// The `/world/my-marks` published and backed rows carry `at` and `extent`, the
// same two fields the draft and docket rows have always carried, out of the same
// mark record.
//
// WHY IT MATTERS, so nobody "tidies" it back out as portfolio noise: the
// resident view draws "the field of view, plus all of yours whether it holds
// them or not" (Keemin, 2026-08-04) and no longer has a fold to look ids up in.
// A row with no `at` cannot be drawn at all. The rule did not change; the thing
// that used to supply the position went away.
//
// THE POSITION IS CHECKED AGAINST THE RECORD, not against the door's own other
// answer. The fold is read here independently and each row is compared to the
// mark it names — otherwise this file would only assert that the door agrees
// with itself, which it would do just as happily while carrying the wrong
// coordinates.
//
//   node --test test/my-marks-carry-where-they-stand.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { WORLD_CLONE, worldMyMarks } from "../src/world.mjs";
import { backedRow } from "../src/world-stake.mjs";

const TOWN_CLONE = process.env.TOWN_CLONE ?? join(WORLD_CLONE, "..", "town-clone");
const HAVE = existsSync(join(WORLD_CLONE, "WORLD", "world-state.json"))
  && existsSync(join(TOWN_CLONE, "tools", "stamp-mint.mjs"));
const WHY_NOT = `needs a world clone at ${WORLD_CLONE} and a town clone at ${TOWN_CLONE}`;

// ── the pure half: runs anywhere, needs no clone at all ─────────────────────

test("backedRow: the position rides from the mark record, and is ABSENT when there is none", () => {
  const placed = { id: "a/one", by: "a", kind: "sited", tier: "market", body: "b",
    at: { x: 12, y: -34 }, extent: { w: 4, h: 6 } };
  const row = backedRow({ mark: "a/one", holder: "a", n: 3 }, { mark: placed });
  assert.deepEqual(row.at, { x: 12, y: -34 });
  assert.deepEqual(row.extent, { w: 4, h: 6 });

  // A predicated mark HAS no site of its own — the engine skips exactly these
  // (`if (!mk.at) continue`). `at: null` would say "somewhere unknown" about a
  // thing that is nowhere by construction, so the key is absent instead.
  const predicated = { id: "a/two", by: "a", kind: "predicated", body: "p" };
  const flat = backedRow({ mark: "a/two", holder: "a", n: 1 }, { mark: predicated });
  assert.ok(!("at" in flat), "a mark with no site carries no `at` key at all");
  assert.ok(!("extent" in flat), "and no `extent` key");

  // No mark in hand at all: the `unread` sentence already says the record is
  // elsewhere. A null `at` beside it would be a second, weaker way of saying so.
  const unread = backedRow({ mark: "ghost/x", holder: "a", n: 1 }, { mark: null });
  assert.ok(!("at" in unread));
  assert.ok(unread.unread, "and the row still says why it is thin");
});

// ── the door half: the promise, against the record ──────────────────────────

test("FALSIFIER — every placed row the door lists carries its mark's own position", async (t) => {
  if (!HAVE) return t.skip(WHY_NOT);
  const fold = JSON.parse(readFileSync(join(WORLD_CLONE, "WORLD", "world-state.json"), "utf8"));
  const record = new Map((fold.marks ?? []).map((m) => [m.id, m]));

  const answer = await worldMyMarks({ handles: new Set(["wright"]), household: "keeminlee" });
  assert.ok(!answer?.error, `the door bounced: ${JSON.stringify(answer?.defect ?? answer)}`);

  let checked = 0, placed = 0;
  for (const list of ["published", "backed"]) {
    const rows = answer[list];
    assert.ok(Array.isArray(rows) && rows.length, `${list} is empty — this falsifier would be vacuous`);
    for (const row of rows) {
      const mark = record.get(row.id);
      if (!mark) continue;             // a live-layer row canon does not hold; § backedRow's `unread`
      checked++;
      if (mark.at) {
        placed++;
        assert.deepEqual(row.at, mark.at,
          `${list}: ${row.id} stands at ${JSON.stringify(mark.at)} in the record and the row says ${JSON.stringify(row.at)}`);
      } else {
        assert.ok(!("at" in row), `${list}: ${row.id} has no site in the record but the row carries an \`at\``);
      }
      if (mark.extent) assert.deepEqual(row.extent, mark.extent, `${list}: ${row.id}'s extent`);
      else assert.ok(!("extent" in row), `${list}: ${row.id} has no extent in the record but the row carries one`);
    }
  }
  assert.ok(checked >= 20, `only ${checked} rows resolved against the record — too thin to falsify anything`);
  // THE ANTI-VACUITY CLAUSE. If nothing this resident holds were placed, every
  // assertion above would be the absent-key branch and the file would go green
  // against a door that carries no coordinates at all.
  assert.ok(placed >= 5,
    `only ${placed} placed rows — this test cannot tell a door that carries positions from one that does not`);
});

test("the door's other lists and its bound are untouched by the addition", async (t) => {
  if (!HAVE) return t.skip(WHY_NOT);
  const answer = await worldMyMarks({ handles: new Set(["wright"]), household: "keeminlee" });
  // The drafts have always carried geometry; this change was to make the other
  // two lists match them, not to alter them.
  for (const row of answer.drafts ?? [])
    if (row.at) assert.equal(typeof row.at.x, "number", "a draft's own geometry still rides");
  // A BOUND AND ITS COUNT ARE ONE THING. Two fields were added to a row, not a
  // row to a list: the page cap and its counts must read exactly as before.
  assert.equal(typeof answer.counts, "object");
  assert.equal(typeof answer.complete, "boolean");
  assert.ok(answer.published.length <= 20, "the published page is still bounded at 20");
  // `withheld` rides exactly when a page did not hold everything. (It used to be
  // asserted bare: with no store here, `backed` reads the key's own handles
  // since POS-573, the fallback `residents` takes, so this resident's lists can
  // now fit their pages.)
  assert.equal("withheld" in answer, !answer.complete, "and names what it withheld exactly when it withheld something");
});
