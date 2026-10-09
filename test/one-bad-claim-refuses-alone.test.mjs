// one-bad-claim-refuses-alone.test.mjs — ONE BAD CLAIM REFUSES ONLY ITSELF (POS-356).
//
//   node --test test/one-bad-claim-refuses-alone.test.mjs
//
// THE INSTANCE. At 06:00Z on 2026-10-04 window 228 held ten lawful claims and one
// from gabo, who stood in the town's households file and not in the store's roll.
// The clearing's first `ownerHouseholdFor` threw NO_SUCH_HOUSE, the one
// transaction rolled back, and every claim in the window waited a night with S93.
//
// THE RULING (Darko, 2026-10-04, R5 in docs/2026-10-04/design-notes/
// world-reads-the-store-rulings.md): "a refusal cannot hold anyone's marks". A
// claim that cannot be materialized refuses itself, with its cause on that
// resident's outcome, and the rest of the docket locks. The whole window refuses
// only where nothing can be judged at all: a store or a registry that cannot be
// read.
//
// THE RIG. The real `clearing-job.mjs` as a child under the `clearing_job` pen,
// against a real Postgres (test/helpers/embedded-store.mjs), because the failures
// that refuse one row (the slug key, the parent key) are constraints only Postgres
// raises, and the isolation is a savepoint only Postgres honours.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";
import { claimEffectsFrom, refusedRowsFrom } from "../src/claim-effects.mjs";
import { currentCrossing } from "../src/crossings.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JOB = join(ROOT, "world2", "tools", "clearing-job.mjs");

const TOWN_SHA = "t".repeat(40);
const LAW_SHA = "l".repeat(40);
const WINDOW = 228;
// Nine housed claimants and gabo, whose house the store's roll does not carry.
const HOUSED = ["ada", "bram", "cleo", "dov", "esme", "finn", "gus", "hale", "iris"];
const HOUSELESS = "gabo";

const store = await startStore({ db: "claim_isolation_test" });
after(() => store.stop()); // a store never stopped left its server running on every run (POS-479)
const skip = store.skip ?? false;

async function owner(fn) {
  const c = await store.connect("world2_owner");
  try { return await fn(c); } finally { await c.end(); }
}

/** Window 227 closed, 228 open, nine houses on the roll, one sited claim each plus gabo's. Returns claim ids by slug. */
async function seed({ extra = [] } = {}) {
  return owner(async (c) => {
    await c.query("TRUNCATE escrow_projection, claims, marks, windows, projection_heads, households, household_pins CASCADE");
    for (const id of [WINDOW - 1, WINDOW]) {
      const opens = new Date(Date.UTC(2026, 9, 3, 6) + (id - (WINDOW - 1)) * 12 * 3600e3).toISOString();
      await c.query(
        `INSERT INTO windows (id, opens_at, closes_at, status, cleared_at)
         VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4)`,
        [id, opens, id === WINDOW ? "open" : "closed", id === WINDOW ? null : opens]);
    }
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now())", [LAW_SHA, TOWN_SHA]);
    for (const [i, h] of HOUSED.entries()) {
      await c.query(
        `INSERT INTO households (slug, ord, name, residents, since, declared_by)
         VALUES ($1, $2, $3, ARRAY[$1], '2026-08-01', $1)`, [h, i, h.toUpperCase()]);
      await c.query(
        `INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ($1, $1, $2, '2026-08-01')`, [h, 200 + i]);
    }
    const ids = {};
    const claims = [...[...HOUSED, HOUSELESS].map((h, i) => ({ claimant: h, slug: `${h}/a-lamp-${i}`, at: 20 * i })), ...extra];
    for (const k of claims) {
      const geometry = JSON.stringify({ slug: k.slug, at: { x: k.at, y: k.at }, extent: { w: 2, h: 2 } });
      const { rows: [row] } = await c.query(
        `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug, parent)
         VALUES ($1, 'sited', $2, $2, 'pending', $3, $4, box(point($5,$5), point($5 + 2, $5 + 2)), 0,
                 '{"date":"2026-10-03"}', $6, $7)
         RETURNING id::text`,
        [WINDOW, k.claimant, `A lamp left by ${k.claimant}.`, geometry, k.at, k.slug, k.parent ? ids[k.parent] : null]);
      ids[k.slug] = row.id;
      // Somebody's stamps behind every mark, so step 5.5's commons gate passes and each test reads its own cause.
      await c.query(
        `INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k)
         VALUES ($1, $2, $3, $4, $4, 1, 1) ON CONFLICT DO NOTHING`, [TOWN_SHA, k.slug, k.claimant, `hh:${k.claimant}`]);
    }
    return ids;
  });
}

function clear() {
  const r = spawnSync(process.execPath, [JOB, "--window", String(WINDOW)], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const read = (sql, args = []) => owner(async (c) => (await c.query(sql, args)).rows);

/** Everything a clearing can move: the claims, the marks, the windows. */
const register = async () => ({
  claims: await read("SELECT id::text, status, refusal_check, decided_at FROM claims ORDER BY id"),
  marks: await read("SELECT id::text, slug, status, household, locked_window FROM marks ORDER BY slug"),
  windows: await read("SELECT id, status, receipts FROM windows ORDER BY id"),
});

/** The window refused whole: nothing moved, every claim still pending, the window still open. */
async function assertNothingMoved(run, cause) {
  assert.equal(run.code, 1, `the whole window must refuse when ${cause}:\n${run.out}`);
  assert.match(run.out, new RegExp(`CLEARING FAILED window ${WINDOW}`));
  const after = await register();
  assert.deepEqual([...new Set(after.claims.map((c) => c.status))], ["pending"], "no claim was ruled on");
  assert.deepEqual(after.marks, [], "no mark was filed");
  assert.equal(after.windows.find((w) => w.id === WINDOW).status, "open", "the window is still owed, and the next tick closes it");
}

test("one claimant with no house refuses only its claim, and the other nine lock", { skip }, async () => {
  const ids = await seed();
  const run = clear();
  assert.equal(run.code, 0, `the window must clear: on 2026-10-04 it rolled back whole:\n${run.out}`);

  const gabo = (await read("SELECT status, refusal_check, decided_at, slug, window_id, submitted_at FROM claims WHERE id = $1", [ids[`${HOUSELESS}/a-lamp-9`]]))[0];
  assert.equal(gabo.status, "refused");
  assert.equal(gabo.refusal_check,
    "unfileable: no such household stands in the town for gabo: the town's roll does not name gabo, so this mark had no household " +
    "to stand in. Nothing else waited on it. Once your house is on the roll, put the mark forward again.",
    "the cause is in the join door's own words, and it names the resident");

  const locked = await read("SELECT claimant FROM claims WHERE status = 'locked' ORDER BY claimant");
  assert.deepEqual(locked.map((r) => r.claimant), HOUSED, "the other nine lock");
  const marks = await read("SELECT owner, household FROM marks WHERE status = 'standing' ORDER BY owner");
  assert.deepEqual(marks, HOUSED.map((h) => ({ owner: h, household: `hh:${h}` })), "nine marks stand, and none for the claim that refused");

  const [w] = await read("SELECT status, receipts FROM windows WHERE id = $1", [WINDOW]);
  assert.equal(w.status, "closed");
  assert.equal(w.receipts.six_count.locked, 9);
  assert.equal(w.receipts.six_count.refused, 1);
  assert.deepEqual(w.receipts.unfileable.map((u) => u.slug), [`${HOUSELESS}/a-lamp-9`],
    "the window's own record names the claimant the roll does not carry (the 10-04 case)");
  assert.deepEqual(await read("SELECT status FROM windows WHERE id = $1", [WINDOW + 1]), [{ status: "open" }], "the successor opened");

  // THE SENTENCE THEY READ. The doorstep's `outcomes` and my-marks' `refused` are
  // both derived from this row by claim-effects.mjs; my-marks says the check whole.
  const now = currentCrossing(new Date(gabo.decided_at).getTime());
  const events = claimEffectsFrom({ rows: [gabo], sinceCrossing: now - 2, nowCrossing: now, mine: () => true });
  const [refused] = events.filter((e) => e.kind === "claim-refused");
  assert.equal(refused.cause, "quarantined", "the bulletin word Darko ruled for unfileable (2026-10-08)");
  assert.equal(refused.summary, "gabo/a-lamp-9 was refused at candle 228 — quarantined", "the doorstep outcome's sentence");
  const [said] = refusedRowsFrom(events);
  assert.match(said.says, /^refused at candle 228: unfileable: no such household stands in the town for gabo/);
});

test("a claim the store will not file refuses alone at the filing, and the rest still lock", { skip }, async () => {
  // Two shapes Postgres refuses ONE ROW for: a mark continuing gabo's (whose claim
  // refused, so its parent never lands: marks_parent_fkey), and a second new mark
  // under a name another claim in this window takes first (marks_slug_key).
  const ids = await seed({ extra: [
    { claimant: "ada", slug: "ada/under-gabos-lamp", at: 300, parent: `${HOUSELESS}/a-lamp-9` },
    { claimant: "bram", slug: "cleo/a-lamp-2", at: 340 },
  ] });
  const run = clear();
  assert.equal(run.code, 0, `one row the store refuses must never roll a window back:\n${run.out}`);

  const [child] = await read("SELECT status, refusal_check FROM claims WHERE id = $1", [ids["ada/under-gabos-lamp"]]);
  assert.equal(child.status, "refused");
  assert.match(child.refusal_check, /^unfileable: the mark ada\/under-gabos-lamp continues is not in the world \(it did not lock\)/);
  assert.match(child.refusal_check, /\(store: marks_parent_fkey\)$/);

  const twins = await read("SELECT claimant, status, refusal_check FROM claims WHERE slug = 'cleo/a-lamp-2' ORDER BY claimant");
  assert.deepEqual(twins.map((t) => [t.claimant, t.status]), [["bram", "refused"], ["cleo", "locked"]], "the first filed keeps the name");
  assert.match(twins[0].refusal_check, /^unfileable: another mark already carries the name cleo\/a-lamp-2/);

  const locked = await read("SELECT count(*)::int AS n FROM claims WHERE status = 'locked'");
  assert.equal(locked[0].n, 9, "the nine lawful claims lock beside the three that refused");
  const [{ n: standing }] = await read("SELECT count(*)::int AS n FROM marks WHERE status = 'standing'");
  assert.equal(standing, 9, "a savepoint took back each refused row and nothing else");

  const [w] = await read("SELECT receipts FROM windows WHERE id = $1", [WINDOW]);
  assert.deepEqual(w.receipts.six_count, { locked: 9, refused: 3, held_review: 0, retracted_before_close: 0, pending_carried: 0 });
  assert.deepEqual(w.receipts.unfileable.map((u) => u.slug).sort(), ["ada/under-gabos-lamp", "cleo/a-lamp-2", `${HOUSELESS}/a-lamp-9`].sort(),
    "the window's own record names the claims the store would not file");
});

test("a registry that names no houses (NO_RECORD) still refuses the whole window", { skip }, async () => {
  await seed();
  await owner((c) => c.query("TRUNCATE households, household_pins CASCADE"));
  const run = clear();
  await assertNothingMoved(run, "the registry names no houses");
  assert.match(run.out, /cannot read the town's roll/);
});

test("a registry that cannot be read still refuses the whole window", { skip }, async () => {
  await seed();
  await owner((c) => c.query("REVOKE SELECT ON households FROM clearing_job"));
  try {
    const run = clear();
    await assertNothingMoved(run, "the roll cannot be read");
    assert.match(run.out, /permission denied/);
  } finally {
    await owner((c) => c.query("GRANT SELECT ON households TO clearing_job"));
  }
});

test("a store that will not take the pen's writes refuses the whole window, never one claim", { skip }, async () => {
  await seed();
  await owner((c) => c.query("REVOKE INSERT ON marks FROM clearing_job"));
  try {
    const run = clear();
    await assertNothingMoved(run, "the store refuses the pen");
    assert.match(run.out, /permission denied/);
    assert.doesNotMatch(run.out, /refused alone/, "a store fault is not blamed on a resident's claim");
  } finally {
    await owner((c) => c.query("GRANT INSERT ON marks TO clearing_job"));
  }
});

test("a second run of the same window is idempotent", { skip }, async () => {
  await seed();
  const first = clear();
  assert.equal(first.code, 0, first.out);
  const once = await register();
  const second = clear();
  assert.match(second.out, /window 228 is not open/, "a closed window is never cleared twice");
  assert.deepEqual(await register(), once, "the second run moves nothing: the refusal stands as written, and the nine stay locked");
});
