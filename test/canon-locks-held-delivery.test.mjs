// canon-locks-held-delivery.test.mjs — the held holder REACHES the notary's judgement through the real
// STANDING_SELECT (POS-765).
//
// canon-locks.test.mjs proves the judgement on hand-built rows, and a hand-built row carrying `held_by` proves
// nothing about whether the query ever delivers it. So this file puts INVENTED marks in a REAL Postgres (the
// suite's store, helpers/embedded-store.mjs: this tree's own server or an own one, never WORLD2_PG_URL or a
// real store) and runs the notary's own STANDING_SELECT and ESCROW_BY_SHA_SELECT through canonLockFindings, as
// falsifier-canon-locks.mjs does:
//
//   a held thing (published by its holder, no place) at ✦0           → not unbacked
//   a placed commons thing at ✦0 at the same projected sha          → still unbacked
//   the held one, set down (the stored row now has no holder)        → unbacked at the NEXT read
//
// THE CAN-FAIL FLIPS:
//   drop `m.data->'held_by' AS held_by` from STANDING_SELECT         → the delivery tests red (held_by never arrives, the held thing is listed)
//   cast it to text again (`->>`)                                    → the raw-value test reds (a stored JSON false or object arrives as the text "false" or "{…}", and a placed commons zero disappears)
//   delete `if (heldBy(r)) continue;` in canonLockFindings           → the held thing is listed in both
//
// Every mark and handle is invented. Run: node --test test/canon-locks-held-delivery.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startStore } from "./helpers/embedded-store.mjs";
import { STANDING_SELECT, ESCROW_BY_SHA_SELECT, canonLockFindings } from "../world2/tools/canon-locks.mjs";

const store = await startStore({ db: "canon_locks_held_test" });
after(() => store.stop());
const skip = store.skip ?? false;

const WIN = 177;
const SHA = "723005e502a761b11959b43f271c29c824063d8f";
const HELD = "sbx-ana/a-brass-lamp", PLACED = "sbx-ana/a-placed-lamp";
const HELD_ID = "c0000000-0000-4000-8000-000000000001", PLACED_ID = "c0000000-0000-4000-8000-000000000002";

/** the store as it stands: the lamp held by sbx-bo (or set down), and a placed lamp, both ✦0 at the locking sha */
async function seed({ lampHeld, extras = [] }) {
  const c = await store.connect("world2_owner");
  try {
    await c.query("TRUNCATE escrow_projection, claims, marks, windows CASCADE");
    await c.query(`INSERT INTO windows (id, opens_at, closes_at, status, cleared_at, town_sha)
                   VALUES ($1, '2026-10-19T00:00:00Z', '2026-10-19T12:00:00Z', 'closed', '2026-10-19T12:00:00Z', $2)`, [WIN, SHA]);
    // the projection holds the locking sha (another mark is staked there), so a zero here is JUDGEABLE
    await c.query(`INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k)
                   VALUES ($1, 'somebody/else', 'sbx-cy', 'hh:cy', 'hh:other', 4, 1)`, [SHA]);
    const place = JSON.stringify({ at: { x: 10, y: 10 }, extent: { w: 1, h: 1 } });
    await c.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
                   VALUES ($1, $2, 'thing', 'sbx-ana', 'hh:ana', 'A placed lamp.', $3, '((9.5,9.5),(10.5,10.5))'::box, 'standing', $4, $5)`,
      [PLACED_ID, PLACED, place, WIN, JSON.stringify({ tier: "market" })]);
    if (lampHeld) {
      await c.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
                     VALUES ($1, $2, 'thing', 'sbx-ana', 'hh:ana', 'A brass lamp.', NULL, NULL, 'standing', $3, $4)`,
        [HELD_ID, HELD, WIN, JSON.stringify({ tier: "market", held_by: "sbx-bo", _placed: { at: { x: 3, y: 3 } } })]);
    } else {
      await c.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
                     VALUES ($1, $2, 'thing', 'sbx-ana', 'hh:ana', 'A brass lamp.', $3, '((2.5,2.5),(3.5,3.5))'::box, 'standing', $4, $5)`,
        [HELD_ID, HELD, JSON.stringify({ at: { x: 3, y: 3 }, extent: { w: 1, h: 1 } }), WIN, JSON.stringify({ tier: "market" })]);
    }
    // extra placed things at ✦0 whose stored `held_by` is the given JSON value (or none), each on a place of its own
    let n = 0;
    for (const [slug, value, placed] of extras) {
      n += 1;
      const data = value === undefined ? { tier: "market" } : { tier: "market", held_by: value };
      const where = JSON.stringify({ at: { x: 40 + 3 * n, y: 40 }, extent: { w: 1, h: 1 } });
      await c.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
                     VALUES ($1, $2, 'thing', 'sbx-ana', 'hh:ana', 'An invented thing.', $3, $4::box, 'standing', $5, $6)`,
        [`c0000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`, slug, placed ? where : null,
          placed ? `((${39.5 + 3 * n},39.5),(${40.5 + 3 * n},40.5))` : null, WIN, JSON.stringify(data)]);
    }
  } finally { await c.end(); }
}

/** the notary's own read of the store, then its own judgement (falsifier-canon-locks.mjs, without the clone) */
async function notary(extraSlugs = []) {
  const c = await store.connect("world2_owner");
  try {
    const { rows } = await c.query(STANDING_SELECT);
    const { rows: e } = await c.query(ESCROW_BY_SHA_SELECT);
    const escrowBySha = new Map(e.map((r) => [`${r.town_sha}|${r.mark}`, Number(r.n)]));
    const register = { slugs: new Set([HELD, PLACED, ...extraSlugs]), sha: "0".repeat(40) };
    return { rows, findings: canonLockFindings(rows, register, { unmaterializedRows: [], escrowBySha }) };
  } finally { await c.end(); }
}

test("POS-765 · the held holder arrives in the standing row from the store, and the held ✦0 thing is not unbacked while the placed one is", { skip }, async () => {
  await seed({ lampHeld: true });
  const { rows, findings } = await notary();
  const held = rows.find((r) => r.slug === HELD), placed = rows.find((r) => r.slug === PLACED);
  assert.equal(held.held_by, "sbx-bo", "STANDING_SELECT delivers the stored holder (a dropped column would leave it undefined)");
  assert.equal(held.tier, "market", "beside the tier, in the same row");
  assert.equal(placed.held_by, null, "a placed thing has no holder");
  assert.equal(findings.escrow_compared, 1, "only the placed lamp is compared");
  assert.deepEqual(findings.unbacked.map((u) => u.slug), [PLACED], "the held lamp is no commons finding; the placed one still is");
  assert.deepEqual(findings.absent, [], "canon carries both in this fixture");
});

test("POS-765 · set down, the same lamp is judged at the NEXT read: the store row has no holder now", { skip }, async () => {
  await seed({ lampHeld: false });
  const { rows, findings } = await notary();
  assert.equal(rows.find((r) => r.slug === HELD).held_by, null);
  assert.deepEqual(findings.unbacked.map((u) => u.slug).sort(), [HELD, PLACED].sort(), "placed at ✦0 on commons, it is a finding like any other");
  assert.equal(findings.escrow_compared, 2);
});

test("POS-765 · the stored holder arrives as the JSON VALUE it is, so a placed commons zero with a JSON false or object holder is still unbacked while the string \"false\" is held", { skip }, async () => {
  const stored = [["sbx-ana/with-false", false, true], ["sbx-ana/with-object", { by: "sbx-bo" }, true], ["sbx-ana/with-string-false", "false", false], ["sbx-ana/with-none", undefined, true]];
  await seed({ lampHeld: true, extras: stored });
  const { rows, findings } = await notary(stored.map(([s]) => s));
  const of = (slug) => rows.find((r) => r.slug === slug).held_by;
  assert.strictEqual(of("sbx-ana/with-false"), false, "transported as the JSON boolean, not the text \"false\"");
  assert.deepEqual(of("sbx-ana/with-object"), { by: "sbx-bo" }, "transported as the JSON object, not its text");
  assert.strictEqual(of("sbx-ana/with-string-false"), "false", "a stored string stays a string");
  assert.strictEqual(of("sbx-ana/with-none"), null, "no holder stays none");
  assert.strictEqual(of(HELD), "sbx-bo");
  assert.deepEqual(findings.unbacked.map((u) => u.slug).sort(), [PLACED, "sbx-ana/with-false", "sbx-ana/with-none", "sbx-ana/with-object"].sort(),
    "a non-string holder is no holder under the existing contract; the string \"false\" and the real holder are held");
});
