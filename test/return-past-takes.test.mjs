// return-past-takes.test.mjs — the one-time return of past sweep takes to their
// households' drafts (WLD-51; Darko, 2026-10-15 19:06: "return them quietly
// as private drafts at ✦0 … by the same pen").
//
//   node --test test/return-past-takes.test.mjs
//
// THE RIG is taken-to-drafts.test.mjs's: a real Postgres with the whole schema
// (076 included), and the run made under the `clearing_job` pen, because the
// return is the insert 076's trigger narrows and only Postgres can say what it
// lets in. The run is called on a small list here; the committed list is the
// prod review, pinned below by its count and its exclusions.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { startStore } from "./helpers/embedded-store.mjs";
import { PAST_TAKES, refusalFor, returnPastTakes } from "../world2/tools/return-past-takes.mjs";

const WIN = 240, OLD = 195;
const store = await startStore({ db: "return_past_takes_test" });
after(() => store.stop());
const skip = store.skip ?? false;

const box = (at, ext) => `((${at.x - ext.w / 2},${at.y - ext.h / 2}),(${at.x + ext.w / 2},${at.y + ext.h / 2}))`;
const EXT = { w: 4, h: 4 };
const id = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function owner(fn) { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } }
const read = (sql, args = []) => owner(async (c) => (await c.query(sql, args)).rows);

// Marks retired at window 195 (2026-09-17), before 076: no cause.
async function seed() {
  await owner(async (c) => {
    await c.query("TRUNCATE acts, escrow_projection, claims, marks, windows, projection_heads, households, household_pins CASCADE");
    for (const w of [OLD - 1, OLD, WIN]) {
      const opens = new Date(Date.UTC(2026, 8, 17, 5, 45, 40) + (w - OLD) * 12 * 3600e3).toISOString();
      await c.query(`INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4)`,
        [w, opens, w === WIN ? "open" : "closed", w === WIN ? null : opens]);
    }
    await c.query(`INSERT INTO households (slug, ord, name, residents, since, declared_by, accounts)
                   VALUES ('starforge', 0, 'Starforge', ARRAY['rei','wright'], '2026-08-01', 'rei', '[{"id": 201, "login": "rei"}]'),
                          ('rabbit', 1, 'Rabbit', ARRAY['sable','quibble'], '2026-08-01', 'sable', '[]')`);
    await c.query(`INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ('rei', 'rei', 201, '2026-08-01'), ('wright', 'wright-starforge', 202, '2026-08-01'),
                   ('sable', 'sable', 204, '2026-08-01'), ('quibble', 'quibble', 205, '2026-08-01')`);
    let n = 0;
    const mark = async (slug, ownerHandle, household, status = "retired", data = {}) => {
      const mid = id(++n), at = { x: 1000 + n * 10, y: 1000 }, geometry = JSON.stringify({ at, extent: EXT });
      await c.query(`INSERT INTO claims (id, window_id, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, slug)
                     VALUES ($1, $2, 'sited', $3, $4, 'locked', now(), $5, $6, $7::box, 1, $8, $9)`,
        [mid, OLD - 1, ownerHandle, household, `${slug}, as it stood.`, geometry, box(at, EXT), JSON.stringify({ by: ownerHandle, ...data }), slug]);
      await c.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, retired_window, data)
                     VALUES ($1, $2, 'sited', $3, $4, $5, $6, $7::box, $8, $9, $10, $11)`,
        [mid, slug, ownerHandle, household, `${slug}, as it stood.`, geometry, box(at, EXT), status, OLD - 1, status === "retired" ? OLD : null, JSON.stringify({ by: ownerHandle, ...data })]);
      return mid;
    };
    await mark("rei/the-lantern", "rei", "gh:201", "retired", { _act_id: "9", _journal_seq: 3 });
    await mark("wright/the-bench", "wright", "hh:starforge");
    await mark("sable/the-withdrawn-kite", "sable", "hh:rabbit");
    await mark("sable/the-mooncakes", "sable", "hh:rabbit");
    await mark("sable/the-standing-gate", "sable", "hh:rabbit", "standing");
    await mark("sable/the-ingested-stone", "sable", "hh:rabbit");
    await c.query("UPDATE marks SET retired_cause = 'marks-ingest' WHERE slug = 'sable/the-ingested-stone'");
    // the author's own withdraw act; quibble carrying the mooncakes (last holding act: take)
    await c.query(`INSERT INTO acts (at, actor, class, action, object, payload) VALUES
      (now(), 'sable', 'mark', 'withdraw', 'sable/the-withdrawn-kite', '{}'),
      (now(), 'quibble', 'holding', 'take', NULL, '{"thing": "sable/the-mooncakes", "holder": "quibble"}')`);
  });
}

const run = async (list, opts = {}) => {
  const c = await store.connect("clearing_job");
  try { return await returnPastTakes((t, a) => c.query(t, a), { list, ...opts }); } finally { await c.end(); }
};
const L = (...slugs) => slugs.map((s) => [s, "1984062faa76"]);

test("THE COMMITTED LIST: 64 marks, 16 owners' worth; none of the ruled exclusions, nor the second carried box", () => {
  assert.equal(PAST_TAKES.length, 64);
  assert.equal(new Set(PAST_TAKES.map(([s]) => s)).size, 64, "no mark twice");
  assert.equal(new Set(PAST_TAKES.map(([s]) => s.split("/")[0])).size, 16);
  const listed = new Set(PAST_TAKES.map(([s]) => s));
  for (const out of ["little-bird/a-box-of-nine-mooncakes", "little-bird/a-box-of-nine-at-the-snug-mooring",
    "the-town/pledges", "darko/the-second-foundation-stone", "wright/final-unstaked", "little-bird/the-second-spoon-verdict",
    "mari/first-night-garland~retired@211", "vireo/the-understory", "current-the-reader/the-beer-mat"])
    assert.equal(listed.has(out), false, `${out} is not returned`);
  for (const [, commit] of PAST_TAKES) assert.match(commit, /^[0-9a-f]{12}$/);
});

test("THE VERDICT, pure: retired by the sweep, never withdrawn, carried by no one, with no live claim", () => {
  const ok = { status: "retired", retired_cause: null, withdrawn: false, last_holding: null, live: false };
  assert.equal(refusalFor(ok), null);
  assert.equal(refusalFor({ ...ok, retired_cause: "settlement-unpublish" }), null);
  assert.equal(refusalFor({ ...ok, last_holding: "drop:neth" }), null, "a dropped thing is carried by no one");
  assert.match(refusalFor(undefined), /holds no mark/);
  assert.match(refusalFor({ ...ok, status: "standing" }), /standing, not retired/);
  assert.match(refusalFor({ ...ok, retired_cause: "marks-ingest" }), /by marks-ingest/);
  assert.match(refusalFor({ ...ok, withdrawn: true }), /withdrew it/);
  assert.match(refusalFor({ ...ok, last_holding: "take:quibble" }), /carries it now \(take:quibble\)/);
  assert.match(refusalFor({ ...ok, live: true }), /live claim/);
  assert.match(refusalFor(ok, false), /does not show the sweep taking it/);
});

test("THE DRY RUN prints the plan and writes nothing", { skip }, async () => {
  await seed();
  const plan = await run(L("rei/the-lantern", "wright/the-bench"));
  assert.deepEqual(plan, { dry_run: true, would_return: 2, owners: 2, marks: [
    { slug: "rei/the-lantern", commit: "1984062faa76", owner: "rei", household: "gh:201", window: OLD },
    { slug: "wright/the-bench", commit: "1984062faa76", owner: "wright", household: "hh:starforge", window: OLD },
  ] });
  assert.deepEqual(await read("SELECT count(*)::int AS n FROM claims WHERE status = 'draft'"), [{ n: 0 }]);
  assert.deepEqual(await read("SELECT count(*)::int AS n FROM marks WHERE retired_cause IS NOT NULL AND retired_cause <> 'marks-ingest'"), [{ n: 0 }]);
});

test("APPLY: each returns as a private draft at ✦0 in its own house at its take's window, the cause is named, the plumbing stays behind, and no alert is raised", { skip }, async () => {
  await seed();
  const out = await run(L("rei/the-lantern", "wright/the-bench"), { apply: true });
  assert.deepEqual(out, { ran: true, returned: [{ slug: "rei/the-lantern", household: "gh:201" }, { slug: "wright/the-bench", household: "hh:starforge" }],
    kept: [], unreturned: [], count: 2, owners: 2 });
  const drafts = await read(`SELECT slug, claimant, household, stake, window_id, data FROM claims WHERE status = 'draft' ORDER BY slug`);
  assert.deepEqual(drafts.map((d) => [d.slug, d.claimant, d.household, d.stake, d.window_id]), [
    ["rei/the-lantern", "rei", "gh:201", 0, OLD], ["wright/the-bench", "wright", "hh:starforge", 0, OLD]]);
  assert.deepEqual(drafts[0].data, { by: "rei", _returned: { mark: id(1), window: OLD, cause: "settlement-unpublish" } }, "no _act_id, no _journal_seq");
  assert.deepEqual(await read("SELECT slug, retired_cause FROM marks WHERE slug IN ('rei/the-lantern', 'wright/the-bench') ORDER BY slug"),
    [{ slug: "rei/the-lantern", retired_cause: "settlement-unpublish" }, { slug: "wright/the-bench", retired_cause: "settlement-unpublish" }]);
  // QUIETLY: the mark-taken alert (src/alerts.mjs, part 4) shows for 14 settlements (7 days) after the
  // take, and these were taken at window 195, weeks before any run of this tool
  const [{ opened }] = await read("SELECT opens_at AS opened FROM windows WHERE id = $1", [OLD]);
  assert.ok(Date.now() - new Date(opened).getTime() > 7 * 24 * 3600e3, "every return here is of a take older than the alert's life");
  const again = await run(L("rei/the-lantern"), { apply: true });
  assert.deepEqual([again.returned, again.kept], [[], [{ slug: "rei/the-lantern" }]], "a second run writes nothing twice");
});

test("ONE THAT DOES NOT VERIFY REFUSES THE WHOLE RUN, by name, and nothing is written", { skip }, async () => {
  await seed();
  const out = await run(L("rei/the-lantern", "sable/the-withdrawn-kite", "sable/the-mooncakes", "sable/the-standing-gate", "sable/the-ingested-stone", "nobody/at-all"), { apply: true });
  assert.equal(out.ran, false);
  assert.deepEqual(out.refused.map((r) => r.slug), ["sable/the-withdrawn-kite", "sable/the-mooncakes", "sable/the-standing-gate", "sable/the-ingested-stone", "nobody/at-all"]);
  assert.match(out.refused[1].why, /carries it now \(take:quibble\)/);
  assert.deepEqual(await read("SELECT count(*)::int AS n FROM claims WHERE status = 'draft'"), [{ n: 0 }], "the lantern, which verified, was not returned either");
  assert.deepEqual(await read("SELECT retired_cause FROM marks WHERE slug = 'rei/the-lantern'"), [{ retired_cause: null }]);
});
