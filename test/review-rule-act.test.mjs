// review-rule-act.test.mjs — A REVIEW RULING WRITES ITS ACT (POS-405, office#350).
//
//   node --test test/review-rule-act.test.mjs
//
// THE INSTANCE. `world2/tools/review-rule.mjs` wrote its act with an INSERT
// naming `acts.journal_seq`, which migration 025 dropped. Every ruling on a
// contested claim committed and then lost its act ("column journal_seq does not
// exist"), and `--journal-only`, the repair, failed the same way. No test ran
// the tool, so nothing noticed.
//
// THE RIG. The real tool as a child, under its two pens (`clearing_job` for the
// ruling, `office_api` for the act), against a real Postgres carrying the whole
// current schema (test/helpers/embedded-store.mjs), so a column the schema no
// longer has is a red here rather than on dev.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(ROOT, "world2", "tools", "review-rule.mjs");

const HELD = 227;   // the closed window the candle held the contest in
const OPEN = 228;   // the window the ruling lands in

const store = await startStore({ db: "review_rule_act_test" });
after(() => store.stop());
const skip = store.skip ?? false;

async function owner(fn) {
  const c = await store.connect("world2_owner");
  try { return await fn(c); } finally { await c.end(); }
}
const read = (sql, args = []) => owner(async (c) => (await c.query(sql, args)).rows);

/** Window 227 closed with two overlapping claims held for REVIEW, 228 open. Returns the two claim ids. */
async function seed() {
  return owner(async (c) => {
    await c.query("TRUNCATE acts, claims, marks, windows CASCADE");
    for (const id of [HELD, OPEN]) {
      const opens = new Date(Date.UTC(2026, 9, 3, 6) + (id - HELD) * 12 * 3600e3).toISOString();
      await c.query(
        `INSERT INTO windows (id, opens_at, closes_at, status, cleared_at)
         VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4)`,
        [id, opens, id === OPEN ? "open" : "closed", id === OPEN ? null : opens]);
    }
    const ids = [];
    for (const [i, h] of ["ada", "bram"].entries()) {
      const slug = `${h}/the-long-field`;
      const geometry = JSON.stringify({ slug, at: { x: i, y: i }, extent: { w: 4, h: 4 } });
      const { rows: [row] } = await c.query(
        `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
         VALUES ($1, 'sited', $2, $2, 'held_review', $3, $4, box(point($5,$5), point($5 + 4, $5 + 4)), 0, '{}', $6)
         RETURNING id::text`,
        [HELD, h, `A field ${h} would walk.`, geometry, i, slug]);
      ids.push(row.id);
    }
    return ids;
  });
}

function rule(args, { act = true } = {}) {
  const r = spawnSync(process.execPath, [TOOL, ...args], {
    cwd: ROOT, encoding: "utf8",
    env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      WORLD2_CLEARING_URL: store.url("clearing_job"),
      ...(act ? { WORLD2_OFFICE_URL: store.url("office_api") } : {}),
    },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const reviewActs = () => read(
  "SELECT id::text, actor, action, class, object, payload FROM acts WHERE class = 'review' ORDER BY id");

test("a ruling commits and writes its act on the current schema", { skip }, async () => {
  const [ada, bram] = await seed();
  const run = rule(["--claim", ada, "--rule", "refuse", "--by", "wright", "--because", "the ground was already spoken for"]);
  assert.equal(run.code, 0, `the ruling and its act must both land:\n${run.out}`);
  assert.doesNotMatch(run.out, /ACT DID NOT LAND/);

  const claims = await read("SELECT id::text, status FROM claims ORDER BY id");
  assert.deepEqual(claims.map((c) => c.status), ["refused", "refused"], "the whole contest is refused");

  const acts = await reviewActs();
  assert.equal(acts.length, 1, "one act for one ruling");
  assert.equal(acts[0].actor, "wright");
  assert.equal(acts[0].action, "rule");
  assert.equal(acts[0].payload.claim, ada);
  assert.equal(acts[0].payload.rule, "refuse");
  assert.deepEqual(acts[0].payload.contest.map((o) => o.claim).sort(), [ada, bram].sort());
  assert.match(run.out, new RegExp(`act ${acts[0].id} · class review action rule`));
});

test("--journal-only writes the act for a ruling that committed without one, once", { skip }, async () => {
  const [ada] = await seed();
  const held = rule(["--claim", ada, "--rule", "hold", "--by", "wright", "--because", "waiting on the neighbours"], { act: false });
  assert.equal(held.code, 1, `a ruling whose act did not land is not a green run:\n${held.out}`);
  assert.match(held.out, /THE RULING STANDS BUT ITS ACT DID NOT LAND/);
  assert.deepEqual(await reviewActs(), [], "no act yet");

  const repair = rule(["--claim", ada, "--journal-only"]);
  assert.equal(repair.code, 0, `the repair must write the act:\n${repair.out}`);
  const acts = await reviewActs();
  assert.equal(acts.length, 1);
  assert.equal(acts[0].payload.rule, "hold");
  assert.match(repair.out, new RegExp(`journalled: acts ${acts[0].id}`));

  const again = rule(["--claim", ada, "--journal-only"]);
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /already journalled/);
  assert.equal((await reviewActs()).length, 1, "acts is append-only, so the repair never writes a second row");
});
