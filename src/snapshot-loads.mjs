// snapshot-loads.mjs — what the law and world graph refreshers share (POS-680).
//
// Both refreshers (law-snapshot.mjs, world-graph-snapshot.mjs) read through
// the office's serve pool, which holds 3 connections and also answers the
// office's other store reads. A refresh let go at its deadline keeps running,
// so two rules keep a store that hangs from taking the pool with it:
//
//   ONE CAP FOR BOTH. At most MAX_LOADS refreshes, law and graph together, run
//   at once, counting ones let go that have not finished. A refresh asked for
//   at the cap does not start (the tick skips) and the health line says so.
//   Two of three connections, so a read always has one.
//
//   THE STORE ENDS WHAT WAS LET GO. A refresh reads in its own READ ONLY
//   transaction with `SET LOCAL statement_timeout`, a little above the
//   deadline, so Postgres cancels a statement that hangs (a lock wait
//   included) and the connection comes back to the pool. Scoped to that
//   transaction: the setting never reaches the connection's next user.
//
// The same lesson store-refresh.mjs carries for the poll (POS-639): a JS race
// frees the caller and NOT the connection, so the bound must be Postgres's.
// A connection that dies without an answer is the one thing neither rule
// ends; the cap bounds it at MAX_LOADS, and /release names it.

import { causeKind, errorSaid, PLAIN_REASONS } from "./fault-words.mjs";

/** Refreshes (law and graph together) allowed to run at once, counting ones let go that have not finished. */
export const MAX_LOADS = Number(process.env.REFRESH_MAX_LOADS ?? 2);
/** The server-side limit on each statement a refresh sends (ms): a little above the 3 s deadline. */
export const REFRESH_STATEMENT_TIMEOUT_MS = Number(process.env.REFRESH_STATEMENT_TIMEOUT_MS ?? 4_000);

const loads = { running: 0, skipped: 0 };

/** Take a slot for a refresh, or false at the cap (and the skip is counted). */
export function startLoad() {
  if (loads.running >= MAX_LOADS) { loads.skipped += 1; return false; }
  loads.running += 1;
  return true;
}
/** Give the slot back when the refresh has finished, however it finished. */
export function endLoad() { loads.running = Math.max(0, loads.running - 1); }

// ── A REFRESH'S ERROR, IN PLAIN WORDS (POS-663's rule; Wright's review of #761) ──
// The refreshers' standing rides GET /release, a keyless page. A store's own
// text can name a role, a host or a relation, so what a refresh keeps is the
// plain reason (fault-words.mjs § PLAIN_REASONS), and the raw error goes to
// the log, once per change of what it said (a store that is down is asked
// every tick, and the log is not a second outage).
const lastSaid = new Map();
/** The plain reason a refresh failed, its raw error logged beside `what` when it changed. */
export function plainRefreshError(e, what) {
  if (e?.own_words === true) return String(e.message);
  const said = errorSaid(e);
  const reason = PLAIN_REASONS[causeKind(e) ?? "record"];
  if (lastSaid.get(what) !== said) {
    lastSaid.set(what, said);
    console.error(`[office] ${what} could not be read (${reason}): ${said}`);
  }
  return reason;
}

/** For the health line: how many refreshes run now, the cap, and how many ticks were skipped at it. */
export const loadsStanding = () => ({ running: loads.running, max: MAX_LOADS, skipped_at_cap: loads.skipped });

/**
 * A read session on the serve pool for one refresh: its own client, in a READ
 * ONLY transaction whose statements the store cancels after `timeoutMs`.
 * `{ query(sql, params), end() }`; `end` commits and returns the client, or
 * throws the client away if the transaction cannot be closed.
 */
export async function timedSession(pool, { timeoutMs = REFRESH_STATEMENT_TIMEOUT_MS } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}`);
  } catch (e) {
    client.release(true);
    throw e;
  }
  let ended = false;
  return {
    query: (sql, params) => client.query(sql, params),
    end: async () => {
      if (ended) return;
      ended = true;
      // a statement the store cancelled leaves the transaction aborted: ROLLBACK closes it either way
      try { await client.query("ROLLBACK"); client.release(); } catch { client.release(true); }
    },
  };
}

/** The office's serve pool, or a throw naming why there is none (the refreshers' own words before this file). */
export async function servePool() {
  const { world2ServeEnabled, world2Pool } = await import("./world2-serve.mjs");
  if (!world2ServeEnabled()) throw new Error("the world 2.0 store is not engaged at this office (WORLD2_PG/WORLD2_PG_URL)");
  return world2Pool();
}
