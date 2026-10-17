// drop-provenance-at-the-clearing.test.mjs — WLD-27: a dropped unit's mark is
// proved against its act at the clearing (Wright, 2026-10-13T01:19:15Z).
//
//   node --test test/drop-provenance-at-the-clearing.test.mjs
//
// A real Postgres (test/helpers/embedded-store.mjs), the whole schema, and the
// real `clearing-job.mjs` run as a child under the `clearing_job` pen. One
// window holds five resident candy claims, each naming `dropped: act:<N>`:
//   · a real matching units:drop act (same actor, same label) → LOCKS;
//   · a fabricated reference (no such act)                    → refused alone;
//   · another resident's drop                                 → refused alone;
//   · the right actor's drop of another label                 → refused alone;
//   · a reference to a non-drop act (a units:give)            → refused alone;
// each refusal named `dropped-unit-unproven: act <N>`, and the window clears —
// one unproven mark never fails or holds the settlement. Synthetic handles and
// labels only.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";
import { dropProvenanceCheck, dropRefId, isCandyClaim } from "../world2/tools/drop-provenance.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JOB = join(ROOT, "world2", "tools", "clearing-job.mjs");
const WIN = 260;

const store = await startStore({ db: "drop_provenance_test" });
after(() => store.stop());
const skip = store.skip ?? false;

const OVERSIZED = "999999999999999999999999999999";   // no bigint can hold it
const BIGINT_MAX = "9223372036854775807";              // the largest act id there could be — none is
const EXACT = "9007199254740993";                      // 2^53 + 1: Number() would make it 2^53

const box = (at) => `((${at.x - 0.5},${at.y - 0.5}),(${at.x + 0.5},${at.y + 0.5}))`;
async function owner(fn) { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } }

async function seed({ edges = false } = {}) {
  return owner(async (c) => {
    await c.query("TRUNCATE acts, escrow_projection, claims, marks, windows, projection_heads, households, household_pins CASCADE");
    for (const id of [WIN - 1, WIN]) {
      const opens = new Date(Date.UTC(2026, 9, 12, 18) + (id - WIN + 1) * 12 * 3600e3).toISOString();
      await c.query(`INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4)`,
        [id, opens, id === WIN ? "open" : "closed", id === WIN ? null : opens]);
    }
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now())", ["l".repeat(40), "t".repeat(40)]);
    await c.query(`INSERT INTO households (slug, ord, name, residents, since, declared_by)
       VALUES ('sbx-cy-house', 0, 'Cy', ARRAY['sbx-cy'], '2026-08-01', 'sbx-cy'), ('sbx-bo-house', 1, 'Bo', ARRAY['sbx-bo'], '2026-08-01', 'sbx-bo')`);
    await c.query(`INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ('sbx-cy', 'sbx-cy', 901, '2026-08-01'), ('sbx-bo', 'sbx-bo', 902, '2026-08-01')`);
    const act = async (actor, action, payload) => (await c.query(
      `INSERT INTO acts (at, crossing, actor, action, class, payload, household) VALUES (now(), 260.1, $1, $2, 'holding', $3, $4) RETURNING id`,
      [actor, action, JSON.stringify(payload), `hh:${actor}-house`])).rows[0].id;
    const drop = (actor, label) => act(actor, "units:drop", { units: true, moves: [{ from: actor, to: null, label, n: 1 }], label });
    const ids = {
      real: await drop("sbx-cy", "test-comets"),
      bos: await drop("sbx-bo", "test-comets"),
      otherLabel: await drop("sbx-cy", "test-drops"),
      give: await act("sbx-cy", "units:give", { units: true, moves: [{ from: "sbx-cy", to: "sbx-bo", label: "test-comets", n: 1 }] }),
    };
    const claim = async (slug, dropped, x) => (await c.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
       VALUES ($1, 'sited', 'sbx-cy', 'hh:sbx-cy-house', 'pending', 'One Test Comets, set down here.', $2, $3::box, 0, $4, $5) RETURNING id::text`,
      [WIN, JSON.stringify({ slug, at: { x, y: 0 }, extent: { w: 1, h: 1 } }), box({ x, y: 0 }),
       JSON.stringify({ class: "candy", label: "test-comets", dropped, date: "2026-10-13" }), slug])).rows[0].id;
    const claims = {
      real: await claim("sbx-cy/test-comets-real", `act:${ids.real}`, 5000),
      fabricated: await claim("sbx-cy/test-comets-fake", "act:999999", 5010),
      actor: await claim("sbx-cy/test-comets-bos", `act:${ids.bos}`, 5020),
      label: await claim("sbx-cy/test-comets-label", `act:${ids.otherLabel}`, 5030),
      nondrop: await claim("sbx-cy/test-comets-give", `act:${ids.give}`, 5040),
    };
    if (edges) {
      // A real drop whose id is past Number's exact range: 2^53 + 1 rounds to
      // 2^53 as a JS number, so only the exact decimal text can find it.
      ids.exact = (await c.query(
        `INSERT INTO acts (id, at, crossing, actor, action, class, payload, household) OVERRIDING SYSTEM VALUE
         VALUES ($1::bigint, now(), 260.1, 'sbx-cy', 'units:drop', 'holding', $2, 'hh:sbx-cy-house') RETURNING id::text`,
        [EXACT, JSON.stringify({ units: true, moves: [{ from: "sbx-cy", to: null, label: "test-comets", n: 1 }], label: "test-comets" })])).rows[0].id;
      claims.oversized = await claim("sbx-cy/test-comets-huge", `act:${OVERSIZED}`, 5050);
      claims.bigintMax = await claim("sbx-cy/test-comets-max", `act:${BIGINT_MAX}`, 5060);
      claims.exact = await claim("sbx-cy/test-comets-exact", `act:${EXACT}`, 5070);
    }
    return { ids, claims };
  });
}

function clear() {
  const r = spawnSync(process.execPath, [JOB, "--window", String(WIN)], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

test("THE CLEARING PROVES EACH DROPPED UNIT: the real one locks, every unproven one is refused alone, the window clears", { skip }, async () => {
  const { ids, claims } = await seed();
  const run = clear();
  assert.equal(run.code, 0, run.out);
  const rows = await owner(async (c) => (await c.query("SELECT id::text, status, refusal_check FROM claims WHERE window_id = $1", [WIN])).rows);
  const by = new Map(rows.map((r) => [r.id, r]));
  assert.equal(by.get(claims.real).status, "locked", `the real drop is proved and locks (${by.get(claims.real).refusal_check})`);
  const expect = { fabricated: "999999", actor: ids.bos, label: ids.otherLabel, nondrop: ids.give };
  for (const [k, n] of Object.entries(expect)) {
    assert.equal(by.get(claims[k]).status, "refused", k);
    assert.equal(by.get(claims[k]).refusal_check, `dropped-unit-unproven: act ${n}`, k);
  }
  const [w] = await owner(async (c) => (await c.query("SELECT status FROM windows WHERE id = $1", [WIN])).rows);
  assert.equal(w.status, "closed", "four unproven marks did not fail or hold the window");
  const [m] = await owner(async (c) => (await c.query("SELECT count(*)::int AS n FROM marks WHERE slug LIKE 'sbx-cy/test-comets-%'")).rows);
  assert.equal(m.n, 1, "only the proved unit became a mark");
});

test("AN IMPOSSIBLE OR HUGE REFERENCE IS REFUSED ALONE, BY ITS OWN NUMBER: an act id past bigint, the bigint ceiling, and a real drop past Number's exact range", { skip }, async () => {
  const { ids, claims } = await seed({ edges: true });
  assert.equal(ids.exact, EXACT, "the fixture drop sits at exactly 2^53 + 1");
  const run = clear();
  assert.equal(run.code, 0, run.out);
  const rows = await owner(async (c) => (await c.query("SELECT id::text, status, refusal_check FROM claims WHERE window_id = $1", [WIN])).rows);
  const by = new Map(rows.map((r) => [r.id, r]));
  for (const k of ["real", "exact"]) assert.equal(by.get(claims[k]).status, "locked", `${k} locks (${by.get(claims[k]).refusal_check})`);
  const expect = { oversized: OVERSIZED, bigintMax: BIGINT_MAX, fabricated: "999999", actor: ids.bos, label: ids.otherLabel, nondrop: ids.give };
  for (const [k, n] of Object.entries(expect)) {
    assert.equal(by.get(claims[k]).status, "refused", k);
    assert.equal(by.get(claims[k]).refusal_check, `dropped-unit-unproven: act ${n}`, `${k} is named by its own number, unrounded`);
  }
  const [w] = await owner(async (c) => (await c.query("SELECT status FROM windows WHERE id = $1", [WIN])).rows);
  assert.equal(w.status, "closed", "an impossible reference did not fail or hold the window");
});

test("the pure check: shape, act, action, actor, label, and the town's own candy untouched", () => {
  const claim = { claimant: "sbx-cy", class: "sited", data: { class: "candy", label: "l", dropped: "act:7" } };
  const drop = { id: 7, action: "units:drop", class: "holding", actor: "sbx-cy", payload: { label: "l", moves: [{ from: "sbx-cy", to: null, label: "l", n: 1 }] } };
  assert.equal(dropProvenanceCheck(claim, drop), null);
  assert.equal(dropProvenanceCheck(claim, null), "dropped-unit-unproven: act 7");
  assert.equal(dropProvenanceCheck(claim, { ...drop, action: "drop" }), "dropped-unit-unproven: act 7", "a thing's legacy drop is not a unit drop");
  assert.equal(dropProvenanceCheck({ ...claim, data: { ...claim.data, dropped: undefined } }, drop), "dropped-unit-unproven: no act");
  assert.equal(dropProvenanceCheck(claim, { ...drop, payload: { ...drop.payload, moves: [{ from: "sbx-bo", to: null, label: "l", n: 1 }] } }), "dropped-unit-unproven: act 7", "the unit left someone else's hands");
  assert.equal(dropRefId(`act:${BIGINT_MAX}`), BIGINT_MAX, "the ceiling is a possible id");
  assert.equal(dropRefId("act:9223372036854775808"), null, "one past it is not");
  assert.equal(dropRefId(`act:${EXACT}`), EXACT, "exact text, never a rounded number");
  assert.equal(dropRefId("act:0"), null);
  assert.equal(dropProvenanceCheck({ ...claim, data: { ...claim.data, dropped: `act:${OVERSIZED}` } }, null), `dropped-unit-unproven: act ${OVERSIZED}`);
  assert.equal(isCandyClaim({ ...claim, claimant: "the-town" }), false);
  assert.equal(isCandyClaim({ ...claim, data: { class: "thing" } }), false);
});
