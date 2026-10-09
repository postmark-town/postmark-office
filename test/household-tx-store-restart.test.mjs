// household-tx-store-restart.test.mjs — a store restart never crashes the office
// through `withHousehold` (POS-484, POS-480's twin).
//
// `world2-claims.mjs § withHousehold` checks a client out of the pool for a
// household's transaction. It installed no 'error' listener, and pg emits a
// session the server ended while the client was not mid-query as an 'error'
// event on the client: unheard, that kills the process. And after a failed
// ROLLBACK it called a plain `release()`, which could hand a client still inside
// the transaction, `app.household` still set, to the next caller (POS-370).
//
// A restart ends every session with a fast shutdown: each backend gets SIGTERM
// and sends FATAL 57P01, "terminating connection due to administrator command".
// `pg_terminate_backend` sends that same SIGTERM to one backend, so these tests
// end the household's session that way and leave the tree's shared server up
// (every file in a pool tree uses it). The lane also stopped the tree's own
// server mid-transaction, by hand; see POS-484's report.
//
// Each case runs in a child process, because the defect is the process dying:
//
//   H1  the session ends while the client is idle inside the transaction: the
//       process stays up, withHousehold throws, and the next pooled client is a
//       new session outside any transaction
//   H2  the session ends mid-query: the same
//   H3  a ROLLBACK that fails on a live connection: the client is destroyed, so
//       the next caller gets a new session, never the open transaction with
//       another house's `app.household`
//
//   node --test test/household-tx-store-restart.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLAIMS = pathToFileURL(join(ROOT, "src", "world2-claims.mjs")).href;

let store = null;
let skip = false;
try { store = await startStore({ db: "household_tx_restart" }); }
catch (e) { skip = `no embedded Postgres: ${String(e?.message ?? e).slice(0, 120)}`; }

// The office's side, in a child: a pool of ONE client (so "the next client" is
// the one given back, if it was given back), and the pool's own error listener,
// which the office has from watchPoolErrors. Only the checked-out client is
// left without one: that is withHousehold's to hold.
const CHILD = `
import pg from "pg";
import { withHousehold } from ${JSON.stringify(CLAIMS)};
const URL = process.env.STORE_URL, CASE = process.env.CASE;
const p = new pg.Pool({ connectionString: URL, max: 1 });
p.on("error", () => {});
const admin = new pg.Client({ connectionString: URL });
admin.on("error", () => {});
await admin.connect();
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const out = { case: CASE };
try {
  await withHousehold(p, "hh:hearth", async (c) => {
    const { rows: [{ pid }] } = await c.query("SELECT pg_backend_pid() AS pid");
    out.pid = pid;
    if (CASE === "idle") {
      await admin.query("SELECT pg_terminate_backend($1)", [pid]);
      await wait(300); // the FATAL reaches the client while it waits inside the transaction
      await c.query("SELECT 1");
    } else if (CASE === "mid-query") {
      await Promise.all([
        c.query("SELECT pg_sleep(5)"),
        wait(300).then(() => admin.query("SELECT pg_terminate_backend($1)", [pid])),
      ]);
    } else if (CASE === "rollback") {
      const send = c.query.bind(c);
      c.query = (sql, ...rest) => (sql === "ROLLBACK"
        ? Promise.reject(new Error("the ROLLBACK's answer was lost")) : send(sql, ...rest));
      throw new Error("the door's own work failed");
    }
  });
  out.threw = null;
} catch (e) { out.threw = String(e?.message ?? e); }
await wait(300); // anything the dead session still has to say
const next = await p.connect();
const { rows: [row] } = await next.query(
  "SELECT pg_backend_pid() AS pid, xact_start = query_start AS fresh, current_setting('app.household', true) AS household" +
  " FROM pg_stat_activity WHERE pid = pg_backend_pid()");
next.release();
out.next = row;
console.log("RESULT " + JSON.stringify(out));
await admin.end();
await p.end();
`;

function run(kase) {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", CHILD], {
    cwd: ROOT, encoding: "utf8", timeout: 30_000,
    env: { ...process.env, STORE_URL: store.url("office_api"), CASE: kase },
  });
  const line = (r.stdout ?? "").split(/\r?\n/).find((l) => l.startsWith("RESULT "));
  return { status: r.status, signal: r.signal, stderr: r.stderr ?? "", out: line ? JSON.parse(line.slice(7)) : null };
}

// The head of a crash names it ("Unhandled 'error' event"); its tail is the error object's fields.
const said = (r) => r.stderr.split(/\r?\n/).filter((l) => /\S/.test(l)).slice(0, 8).join(" | ").slice(0, 600);

function assertSurvived(r, what) {
  assert.equal(r.status, 0,
    `${what}: the process stays up (exit ${r.status}${r.signal ? `, ${r.signal}` : ""}): ${said(r)}`);
  assert.ok(r.out, `${what}: the child reported: ${said(r)}`);
}

function assertNextIsClean(r, what) {
  assert.notEqual(r.out.next.pid, r.out.pid,
    `${what}: the next pooled client is a new session, not the one given back (next: ${JSON.stringify(r.out.next)})`);
  assert.equal(r.out.next.fresh, true, `${what}: the next pooled client is not inside an earlier transaction`);
  assert.ok(!r.out.next.household, `${what}: and carries no app.household (got ${JSON.stringify(r.out.next.household)})`);
}

test("H1 the session ends while the client waits inside the transaction: the process stays up and withHousehold throws", { skip }, () => {
  const r = run("idle");
  assertSurvived(r, "idle");
  assert.ok(r.out.threw, "withHousehold throws, so the door answers its own refusal");
  assert.match(r.stderr, /\[world2-claims\] a household connection failed \(hh:hearth\): terminating connection due to administrator command/,
    "the lost session is named in the log");
  assertNextIsClean(r, "idle");
});

test("H2 the session ends mid-query: the process stays up and withHousehold throws", { skip }, () => {
  const r = run("mid-query");
  assertSurvived(r, "mid-query");
  assert.match(r.out.threw ?? "", /terminat/i, "the query's own rejection reaches the caller");
  assertNextIsClean(r, "mid-query");
});

test("H3 a ROLLBACK that fails on a live connection: the client is destroyed, never handed to the next caller", { skip }, () => {
  const r = run("rollback");
  assertSurvived(r, "rollback");
  assert.equal(r.out.threw, "the door's own work failed", "the caller sees the door's error, not the ROLLBACK's");
  assertNextIsClean(r, "rollback");
});

after(async () => { await store?.stop(); });
