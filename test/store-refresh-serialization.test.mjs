// store-refresh-serialization.test.mjs — the office's index refresh holds ONE pen
// connection per thread, at boot and on every tick: the probe, then the roll, each
// on its own (POS-815).
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/store-refresh-serialization.test.mjs
//
// THE DEFECT. server.mjs read the roll and the probe at the same time, so the poll
// held two pen connections at once, and the boot read ran beside the poll's
// guard, so a boot read still waiting when the first tick came started a second
// pair. Measured here on the old code: FOUR of thread 0's pen sessions blocked at
// once. The pen is three per pool instance (world2-pen.mjs § pool); the old
// boot's two concurrent first asks can build two instances there (the separately
// reported lazy-init race, not changed by this file), which is how four exceed
// three. Darko 2026-10-29: "Serialize them", "Probe first". So each refresh is
// the probe, then the roll, and the boot read is the same guarded tick as the
// interval's.
//
// THE INSTRUMENT IS THE REAL OFFICE. A spawned src/server.mjs on a store of this
// file's own, with no read worker (so its pen is thread 0's, `postmark-office:pen:t0`)
// and a short test-only poll interval. A separate session holds town_residents,
// which both readers' first statement over the residents waits on, so every refresh
// statement the office has started sits in pg_stat_activity blocked by that session.
// Each blocked session is named by its own statement: the probe's (`json::jsonb`)
// or the roll's (`SELECT handle, json FROM town_residents`). No request is sent
// while it is counted, and nothing else in a fresh office reads town_residents.
//
// Selective failures, never a shared refusal: a reader fails alone when the test
// cancels ITS backend (pg_cancel_backend), named by its statement, or when its own
// statement reaches the office's unchanged 10 s statement_timeout. A roll left
// waiting outlives the boot's 10 s race, so the office is seen listening while
// that read still holds the guard and the ticks after it skip. And a roll is
// made to wait alone by Postgres's lock queue: a second locker queued behind a
// waiting probe takes the table the moment the probe's transaction ends, so the
// roll after it waits while the probe has already published.
//
// Every row is a fixed synthetic literal; no fixture town, no clone, no card.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { startStore } from "./helpers/embedded-store.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "refresh-serial-"));
const CLEANUP = [];
after(async () => {
  for (const f of CLEANUP.reverse()) await f().catch(() => {});
  try { rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ }
});

const AS_OF_A = "aaaaaaaaaaaa0000000000000000000000000001";
const AS_OF_B = "bbbbbbbbbbbb0000000000000000000000000002";
const POLL_MS = 200;
const PEN_T0 = "postmark-office:pen:t0";
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const kindOf = (sql) => (/json::jsonb/.test(sql) ? "probe" : /^SELECT handle, json FROM town_residents/.test(sql.trim()) ? "roll" : "other");

test("POS-815 · the index refresh reads the probe, then the roll, one pen connection at boot and on every tick, each failing alone", { timeout: 90_000 }, async (t) => {
  const store = await startStore({ db: "refresh_serial" });
  CLEANUP.push(() => store.stop());
  // the index's owner writes the synthetic rows and moves the head, as an ingest would
  const ingester = await store.connect("world2_owner");
  CLEANUP.push(() => ingester.end());
  await ingester.query("INSERT INTO town_meta (key, value, digest) VALUES ('as_of', $1, 'synthetic')", [AS_OF_A]);
  for (const [h, d] of [["ada", "Ada"], ["bo", "Bo"]])
    await ingester.query("INSERT INTO town_residents (handle, json, digest) VALUES ($1, $2, 'synthetic')", [h, JSON.stringify({ display: d })]);

  const su = await store.connect("postgres");
  CLEANUP.push(() => su.end());
  /** The office's thread-0 pen sessions blocked by `locker`, named by their statement. */
  const blockedBy = async (locker) => (await su.query(
    `SELECT pid, query FROM pg_stat_activity
      WHERE datname = $1 AND application_name = $2 AND $3 = ANY(pg_blocking_pids(pid))`,
    [store.database, PEN_T0, locker.pid])).rows.map((r) => ({ pid: r.pid, kind: kindOf(r.query) }));
  const BOUND_WAIT = 15_000; // past the office's 10 s boot race and its 10 s statement bound, both unchanged
  const until = async (what, fn, ms = 8_000) => {
    const end = Date.now() + ms;
    for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) assert.fail(`${what}, within ${ms} ms\n${said.slice(-1500)}`); await sleep(25); }
  };
  const locker = async () => {
    const c = await store.connect("law_ingester");
    c.pid = (await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    CLEANUP.push(() => c.end());
    return c;
  };

  // town_residents held BEFORE the office starts, so its boot read waits from its first ask
  const first = await locker();
  await first.query("BEGIN");
  await first.query("LOCK TABLE town_residents IN ACCESS EXCLUSIVE MODE");

  let said = "";
  const office = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0",
    "--oauth-db", join(TMP, "oauth.db"), "--roles-db", join(TMP, "roles.db")], {
    // an explicit env: the store of this file, no worker, the short test poll; nothing inherited but the path and the guard
    env: {
      PATH: process.env.PATH, HOME: TMP, NODE_OPTIONS: process.env.NODE_OPTIONS ?? "",
      ...(process.env.POSTMARK_SPARSE_MISSES ? { POSTMARK_SPARSE_MISSES: process.env.POSTMARK_SPARSE_MISSES } : {}),
      WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), OFFICE_READ_WORKERS: "0",
      OFFICE_RELOAD_POLL_MS: String(POLL_MS), WORLD_GRAPH_NONE: "1", ARRIVAL_TICK: "off",
      OFFICE_KEYS: "", TOWN_PUSH: "", OFFICE_BOX_PORT: "0",
      TOWN_CLONE: join(TMP, "no-clone"), WORLD_CLONE: join(TMP, "no-world-clone"), WORLD_DYNAMIC_DB: join(TMP, "dynamic.db"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  office.stdout.on("data", (x) => { said += String(x); });
  office.stderr.on("data", (x) => { said += String(x); });
  CLEANUP.push(async () => { office.kill(); });
  const says = (re, ms) => until(`the office said ${re}`, () => re.test(said), ms);

  await t.test("boot and the ticks after it: one blocked refresh read, the probe's; the roll has not started", async () => {
    await until("the boot read reached the store", async () => (await blockedBy(first)).length > 0);
    let max = 0;
    const seen = new Set();
    const end = Date.now() + 8 * POLL_MS;
    while (Date.now() < end) {
      const b = await blockedBy(first);
      max = Math.max(max, b.length);
      for (const s of b) seen.add(s.kind);
      await sleep(20);
    }
    assert.equal(max, 1, `the refresh held ${max} pen connections at once across boot and 8 ticks (seen: ${[...seen]}); it may hold one`);
    assert.deepEqual([...seen], ["probe"], "the probe is read first, and the roll waits for it");
  });

  await t.test("a refused probe still reads the roll, and the roll waits alone", async () => {
    const [probe] = await blockedBy(first);
    await su.query("SELECT pg_cancel_backend($1)", [probe.pid]);
    const b = await until("the roll started after the probe was refused", async () => {
      const now = await blockedBy(first);
      return now.length && now.every((s) => s.kind === "roll") ? now : null;
    });
    assert.equal(b.length, 1, "only the roll waits");
  });

  await t.test("the 10 s boot bound lets the office listen while the roll still waits; the ticks after it skip; the roll ends at its own statement bound and the next tick reads the index", async () => {
    // the roll from the case above, still waiting: NOT cancelled, so the boot read outlives the boot's 10 s race
    const [roll] = await blockedBy(first);
    assert.equal(roll?.kind, "roll", "the roll is the read still waiting");
    await says(/listening on :\d+ — as-of unknown/, BOUND_WAIT);
    const atListen = await blockedBy(first);
    assert.deepEqual(atListen.map((b) => [b.pid, b.kind]), [[roll.pid, "roll"]], "the office listened with the same roll still waiting, and nothing beside it");
    // the interval's ticks after the boot returned: each skips while the boot's read is in flight
    let max = 0;
    const end = Date.now() + 5 * POLL_MS;
    while (Date.now() < end) {
      const b = await blockedBy(first);
      max = Math.max(max, b.length);
      assert.ok(b.every((x) => x.pid === roll.pid), `a tick started a read beside the boot's: ${JSON.stringify(b)}`);
      await sleep(20);
    }
    assert.equal(max, 1, "five ticks after listening, still the one roll");
    await says(/the store read has not answered within 10s/, BOUND_WAIT);
    // Postgres's own statement_timeout (STORE_READ_BOUND_MS, unchanged) ends the roll; its connection comes home,
    // and only then does a tick read again: the next probe waits on a session of its own turn
    const next = await until("the roll ended at its statement bound and the next tick's probe waits", async () => {
      const b = await blockedBy(first);
      return b.length === 1 && b[0].kind === "probe" ? b[0] : null;
    }, BOUND_WAIT);
    const { rows: [was] } = await su.query("SELECT state FROM pg_stat_activity WHERE pid = $1", [roll.pid]);
    assert.ok(!was || was.state === "idle" || next.pid === roll.pid, `the timed-out roll's connection was given back, not left in its transaction: ${JSON.stringify(was)}`);
    await first.query("ROLLBACK");
    await says(/\[office\] index reloaded — as-of aaaaaaaaaaaa \(was unknown\)/);
  });

  await t.test("a refused roll leaves the probe it followed published: the as-of moves", async () => {
    // the table first, then the new head: no tick can read the new head whole in between
    await first.query("BEGIN");
    await first.query("LOCK TABLE town_residents IN ACCESS EXCLUSIVE MODE");
    await ingester.query("UPDATE town_meta SET value = $1 WHERE key = 'as_of'", [AS_OF_B]);
    await until("the probe of the new head waits", async () => (await blockedBy(first)).some((s) => s.kind === "probe"));
    // a second locker queued behind the waiting probe: it takes the table when the probe's transaction ends
    const second = await locker();
    await second.query("BEGIN");
    const queued = second.query("LOCK TABLE town_residents IN ACCESS EXCLUSIVE MODE");
    await until("the second locker is queued", async () => (await su.query(
      "SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'", [second.pid])).rowCount === 1);
    await first.query("ROLLBACK");
    await queued;
    const [roll] = await until("the roll waits behind the second locker", async () => {
      const b = await blockedBy(second);
      return b.length === 1 && b[0].kind === "roll" ? b : null;
    });
    await su.query("SELECT pg_cancel_backend($1)", [roll.pid]);
    await says(/\[office\] index reloaded — as-of bbbbbbbbbbbb \(was aaaaaaaaaaaa\)/);
    await second.query("ROLLBACK");
  });

  await t.test("every refused read gave its connection back: no pen session is left inside a transaction", async () => {
    await sleep(3 * POLL_MS);
    const { rows } = await su.query(
      "SELECT state, count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND application_name = $2 GROUP BY state",
      [store.database, PEN_T0]);
    const by = Object.fromEntries(rows.map((r) => [r.state, r.n]));
    assert.equal((by["idle in transaction"] ?? 0) + (by["idle in transaction (aborted)"] ?? 0), 0, `pen sessions: ${JSON.stringify(by)}`);
    assert.ok(Object.values(by).reduce((a, b) => a + b, 0) <= 3, `the pen holds at most its three: ${JSON.stringify(by)}`);
  });
});
