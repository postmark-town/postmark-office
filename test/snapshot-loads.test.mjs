// snapshot-loads.test.mjs — a store that hangs never takes the serve pool with
// it (POS-680; src/snapshot-loads.mjs).
//
// A law or world graph refresh is let go at its deadline and the next tick
// asks again. If that were all, a store that hangs every statement would fill
// the office's 3-connection serve pool with abandoned loads, one per tick, and
// every other read on the pool would stall behind them. Two rules prevent it,
// and this file holds both against the suite's store (a real Postgres) and the
// office's own serve pool (world2-serve.mjs § world2Pool):
//
//   the cap      at most MAX_LOADS (2) refreshes, law and graph together, run
//                at once; a tick at the cap is skipped and says so;
//   the timeout  each refresh reads in its own transaction with SET LOCAL
//                statement_timeout, so Postgres cancels what was let go and
//                the connection comes back.
//
// And what GET /release shows of it all stays in the office's own words: the
// store's text (a cancelled statement, a relation), the role and the host
// never reach that keyless page (POS-663's rule).
//
// THE HANG: another session holds ACCESS EXCLUSIVE locks on `settlements` and
// `world_graphs`, so every refresh statement waits on a lock (a lock wait
// counts toward statement_timeout).
//
// THE FLIPS: no cap (the pool fills, a plain read waits, and the case reds);
// no SET LOCAL statement_timeout (the two loads at the cap never end, no
// third refresh ever starts, and the case reds); a refresh keeping the
// store's own text (the release case reds).

process.env.LAW_REFRESH_DEADLINE_MS = "150";
process.env.WORLD_GRAPH_REFRESH_DEADLINE_MS = "150";
process.env.REFRESH_STATEMENT_TIMEOUT_MS = "400";

import { test } from "node:test";
import assert from "node:assert/strict";

const { startStore, NO_STORE } = await import("./helpers/embedded-store.mjs");
const { writeLaw } = await import("../world2/tools/law-ingest.mjs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (pred, ms = 3_000) => { const end = Date.now() + ms; while (!pred() && Date.now() < end) await sleep(10); return pred(); };
const cls = (key, data = {}) => ({ kind: "class", path: `WORLD/marks/the-town/${key}/mark.md`, key, data: { class: key, ...data } });

test("a store that hangs every refresh statement: the refreshers hold at most the cap of connections, a plain read on the pool still answers, the store cancels what was let go, and the law loads once the store answers", async (t) => {
  let s;
  try { s = await startStore({ db: "snapshot_loads" }); } catch { return t.skip(NO_STORE); }
  const [pen, owner, locker] = [await s.connect("law_ingester"), await s.connect("world2_owner"), await s.connect("world2_owner")];
  t.after(async () => { for (const c of [pen, owner, locker]) await c.end().catch(() => {}); await s.stop(); });
  await writeLaw(pen, { lawSha: "c".repeat(40), rows: [cls("thing"), cls("resident")], identities: [], blessed: true });
  await owner.query("INSERT INTO settlements (number, tag_sha, published_at) VALUES (1, $1, now())", ["c".repeat(40)]);

  // the office's own serve pool, on this store
  Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
  const serve = await import("../src/world2-serve.mjs");
  const law = await import("../src/law-snapshot.mjs");
  const graph = await import("../src/world-graph-snapshot.mjs");
  const { MAX_LOADS, loadsStanding } = await import("../src/snapshot-loads.mjs");
  const pool = await serve.world2Pool();
  t.after(async () => { law.resetLawSnapshot(); graph.resetWorldGraph(); serve.__setPoolForTest(null); await pool.end().catch(() => {}); });

  // the hang: every refresh statement waits on a lock
  await locker.query("BEGIN");
  await locker.query("LOCK TABLE settlements, world_graphs IN ACCESS EXCLUSIVE MODE");
  law.startLawRefresher({ intervalMs: 40 });
  graph.startWorldGraphRefresher({ intervalMs: 40 });

  let maxHeld = 0, probing = false, slowest = 0;
  const probes = [];
  const sample = setInterval(() => { if (!probing) maxHeld = Math.max(maxHeld, pool.totalCount - pool.idleCount); }, 5);
  t.after(() => clearInterval(sample));
  for (let i = 0; i < 6; i++) {
    await sleep(250);
    probing = true;
    const t0 = Date.now();
    probes.push(await Promise.race([pool.query("SELECT 1 AS one").then((r) => r.rows[0].one), sleep(1_500).then(() => "no answer in 1.5 s")]));
    slowest = Math.max(slowest, Date.now() - t0);
    probing = false;
  }
  clearInterval(sample);
  const during = { law: law.lawRefreshStanding(), graph: graph.worldGraphRefreshStanding(), loads: loadsStanding() };

  assert.ok(maxHeld <= MAX_LOADS, `the refreshers held ${maxHeld} of the pool's connections at once (the cap is ${MAX_LOADS})`);
  assert.deepEqual(probes, [1, 1, 1, 1, 1, 1], `a plain read on the pool waited behind the refreshers (slowest ${slowest} ms): ${JSON.stringify(probes)}`);
  assert.ok(during.loads.skipped_at_cap > 0, "ticks at the cap were skipped, and counted");
  assert.ok(during.law.abandoned + during.graph.abandoned > MAX_LOADS,
    `no refresh after the first ${MAX_LOADS} ever started: the store never ended what was let go (${JSON.stringify(during)})`);
  assert.equal(law.lawSnapshot(), null, "nothing loaded while the store hung");

  // what GET /release would show right now: the office's own words only
  const release = JSON.stringify({ law: law.lawForRelease(), world_graph: graph.worldGraphForRelease() });
  assert.match(release, /the record did not answer|refreshes are still running|was let go/, `the release names no reason at all: ${release}`);
  for (const raw of [/canceling statement/i, /statement timeout/i, /\brelation\b/i, /office_api|world2_owner|law_ingester|snapshot_reader/, /127\.0\.0\.1|localhost/, /\bpostgres(ql)?:\/\//i, /ECONN|ETIMEDOUT/])
    assert.doesNotMatch(release, raw, `GET /release would carry raw store text (${raw}): ${release}`);

  // the store answers again: the next tick loads the law, no restart
  await locker.query("COMMIT");
  assert.ok(await until(() => law.lawSnapshot()?.pin.settlement === 1), `the law never loaded once the store answered: ${JSON.stringify(law.lawRefreshStanding())}`);
  assert.ok(await until(() => loadsStanding().running === 0), "every slot came back");
  // and the timeout was scoped to the refresh's own transaction: the pool's next user is unbounded
  assert.equal((await pool.query("SHOW statement_timeout")).rows[0].statement_timeout, (await owner.query("SHOW statement_timeout")).rows[0].statement_timeout);
});
