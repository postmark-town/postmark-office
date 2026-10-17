// mark-stake-lock.mjs — NO STAKE LANDS BEHIND A MARK THAT HAS LEFT (WLD-27, A).
//
// Wright's independent review (AUTHORITY 2026-10-13T05:20:23Z, A): "the stake
// door refuses a mark whose exit act is recorded. The exit commits before
// lateReturns, so no stake can land after it" — and the public withdraw door
// "has the same read-then-write gap". Before this file, a stake that passed its
// door's checks could reach the ledger after a dropped unit's exit was
// recorded (world-units.mjs § markExit) and after the late-return pass had
// read the holders, or after the public withdraw door had read no escrow; the
// stamps then stood behind a mark that had already left.
//
// ── ONE LOCK PER MARK, TAKEN BY EVERY SIDE OF THE RACE ──────────────────────
//
// `wld27-mark:<id>`, a Postgres advisory lock — the shape drop-recovery.mjs
// (`wld27-drop:<id>`) and chest-lock.mjs already use, so no grant, table or
// migration. The ledger is the town clone's file, written by
// world-stake-exec.mjs under the town's flock; the record of a mark leaving is
// an act in the store. The lock is what orders the two:
//
//   · EVERY LEDGER CHANGE ON THE MARK (world-stake-exec.mjs, under the town
//     flock), stake AND unstake, holds the lock (§ withMarkHeld) from before
//     its append until its landing or its rollback is finished. A stake first
//     asks the record whether the mark has left — a dropped unit's exit act,
//     or a withdrawal that is the mark's newest mark act — and refuses before
//     the engine runs if it has. An unstake is never refused: it is how stakes
//     come home. So the ledger file, read by anyone holding the lock, is
//     settled: no appended line still waiting to land or be rolled back.
//   · THE EXIT (world-units.mjs § markExit, § lateReturns): reads the holders
//     under the lock, each time. Its late reads come after its exit act
//     commits, so they see every stake there will ever be on the mark, and
//     never an unstake's zero that a failed landing then undoes. Nothing is
//     held while the returns run, so the exit's own unstakes never wait on it.
//   · THE PUBLIC WITHDRAWAL (world.mjs § withdrawMarkViaOffice): reads the
//     escrow UNDER the lock inside the withdrawal's own write transaction
//     (`withdrawEscrowGuard`): a stake or an unstake either finished — landed
//     or rolled back — before the read, or asks after the withdrawal committed
//     (a stake is then refused).
//   · THE PROMOTION (world2-claims.mjs § promoteDraftOnStake): asks the exit
//     question under the lock inside its own transaction, so a stake on an
//     exited unit's draft never puts it forward.
//
// LOCK ORDER, everywhere: the town flock → the candle (shared) → a drop's lock
// → a mark's lock. The exec holds the flock and then only the mark's; the
// exit's reads, the promotion and the withdrawal never wait on the flock while
// holding the mark's; the tick takes only drops' locks.

import { UNIT_ACTION } from "./world-stacks.mjs";
import { faultLogged } from "./fault-words.mjs"; // the office's own words for its own fault (POS-578)

export const markLockKey = (id) => `wld27-mark:${String(id)}`;
const LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext($1))";

// `acts_object_idx (object, id)` (001) answers both: one mark's acts by id.
const EXIT_SQL = `
  SELECT id::text, action, actor FROM acts
   WHERE object = $1 AND class = 'holding' AND action IN ($2, $3)
   ORDER BY id LIMIT 1`;
const NEWEST_MARK_ACT_SQL = `
  SELECT id::text, action FROM acts
   WHERE object = $1 AND class = 'mark' AND action IN ('leave-mark', 'amend', 'withdraw')
   ORDER BY id DESC LIMIT 1`;

const ROUTE = { [UNIT_ACTION.takeBack]: "taken back", [UNIT_ACTION.consumeInPlace]: "consumed where it stood" };

/** A dropped unit's recorded exit — `{ act, action, by }` — or null. */
export async function exitOf(client, id) {
  const { rows: [r] } = await client.query(EXIT_SQL, [String(id), UNIT_ACTION.takeBack, UNIT_ACTION.consumeInPlace]);
  return r ? { act: r.id, action: r.action, by: r.actor } : null;
}

/**
 * Has this mark left the record? Its dropped unit's exit, or — with
 * `withdrawn` — a withdrawal that is its newest mark act (a mark left again
 * after a withdrawal, or put forward again, stands and is stakeable). The
 * withdrawal half is asked only where the mark's own deed is already on the
 * record: a staked draft's leave act is released by its promotion, before the
 * ledger runs, so the exec sees it; the door's earlier checks would not.
 */
export async function leftOf(client, id, { withdrawn = true } = {}) {
  const exit = await exitOf(client, id);
  if (exit) return { left: "exit", ...exit };
  if (!withdrawn) return null;
  const { rows: [m] } = await client.query(NEWEST_MARK_ACT_SQL, [String(id)]);
  return m?.action === "withdraw" ? { left: "withdrawn", act: m.id } : null;
}

const bounce = (code, defect, hint, extra = {}) => Object.assign(new Error(defect), { code, defect, hint, ...extra });

/** The refusal a stake on a mark that has left gets, before any stamp moves or any claim is put forward. */
export function leftRefusal(id, left) {
  return left.left === "exit"
    ? bounce(409, `"${id}" has left the world — its unit was ${ROUTE[left.action] ?? "taken"} (act ${left.act})`,
      "a dropped unit's mark stops being a mark when it is taken back or consumed, and nothing can be staked on it after that. Nothing was staked and your stamps are untouched.",
      { stakeLeft: left })
    : bounce(409, `"${id}" was withdrawn (act ${left.act})`,
      "a withdrawn mark has nothing for stamps to stand behind; leave it again to bring it back. Nothing was staked and your stamps are untouched.",
      { stakeLeft: left });
}

/** Under the mark's lock in `client`'s transaction: refuse a stake on a mark that has left. */
export const stakeGuard = (id, { withdrawn = false } = {}) => async (client) => {
  await client.query(LOCK_SQL, [markLockKey(id)]);
  const left = await leftOf(client, id, { withdrawn });
  if (left) throw leftRefusal(id, left);
};

// THE LOCK HELD ACROSS A WHOLE LEDGER CHANGE (Bevel's first review of #503,
// R1). A stake or an unstake is not settled when its line is appended: the
// exec then commits and lands it, and a landing that fails rolls the ledger
// file back (penTransaction) — so a reader between the append and the landing
// can see an escrow that is about to un-happen (an unstake's zero that
// returns to 2; a stake's line that vanishes). The exec therefore holds the
// mark's lock from before its append until its landing or rollback is DONE,
// and every reader that decides on the escrow takes the same lock: what it
// reads is a settled ledger. A SESSION lock on a dedicated connection, not a
// transaction's, because the landing is git work (a push in production) that
// must not hold a transaction open against the store's idle budget; a crashed
// exec's connection closes and the lock goes with it. Session and transaction
// advisory locks on one key exclude each other, so the readers keep their
// transaction-scoped form.
const SESSION_LOCK_SQL = "SELECT pg_advisory_lock(hashtext($1))";
const SESSION_UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtext($1))";

/**
 * Run `fn(client)` holding the mark's lock on its own connection, for as long
 * as `fn` runs. An office pointed at no record has nothing to order against
 * (no withdrawal or exit can be recorded there) and runs `fn(null)` as before;
 * an office pointed at one it cannot reach refuses — an unanswered question
 * is not a "no", and an unlocked ledger change is the race this closes.
 */
export async function withMarkHeld(id, fn, { env = process.env, refusal = "nothing was changed on the ledger", connection = "own" } = {}) {
  const { world2Enabled } = await import("./world2-acts.mjs");
  if (!world2Enabled(env)) return fn(null);
  // "own": a dedicated client — the exec's, a short-lived process a pool would
  // keep alive. "pool": a connection of the office's pen pool, given back.
  let c, done;
  try {
    if (connection === "pool") {
      c = await (await import("./world2-pen.mjs")).penLockConnection(env);
      done = (broken) => c.release(broken ? true : undefined);
    } else {
      const { default: pg } = await import("pg");
      const { storePoolOptions } = await import("./store-pool.mjs");
      c = new pg.Client(storePoolOptions(env, { name: "mark-lock", max: 1 }));
      await c.connect();
      done = () => c.end();
    }
  } catch (e) {
    throw bounce(503, "the record could not be reached to order this change on the mark",
      `${refusal} — try again; ${faultLogged("the record could not be reached to order this change on the mark", e)}`);
  }
  const key = markLockKey(id);
  let broken = false;
  try {
    await c.query(SESSION_LOCK_SQL, [key]);
    return await fn(c);
  } finally {
    await c.query(SESSION_UNLOCK_SQL, [key]).catch(() => { broken = true; });
    await Promise.resolve(done(broken)).catch(() => {});
  }
}

/**
 * THE STAKE'S QUESTION, asked under the held lock before the engine runs: a
 * mark whose dropped unit has left, or whose newest mark act is a withdrawal,
 * takes no stake. `client` is withMarkHeld's (null: no record to ask).
 */
export async function stakeRefusalUnderLock(client, id) {
  if (!client) return null;
  const left = await leftOf(client, id, { withdrawn: true });
  return left ? leftRefusal(id, left) : null;
}

/**
 * THE PUBLIC WITHDRAWAL'S SIDE, as its write transaction's guard: under the
 * mark's lock, the escrow is read again and a staked mark is refused. `escrow`
 * answers the stamps standing on the mark, or throws when the ledger cannot be
 * read — and an unreadable ledger refuses, never reads as "nothing staked".
 */
export const withdrawEscrowGuard = ({ mark, escrow }) => async (client) => {
  // THE CANDLE FIRST, shared, as the docket half of this same withdrawal takes
  // it anyway: every transaction that holds both takes the candle before the
  // mark (the promotion does), so none waits on the other in reverse.
  const { DOOR_SHARES_THE_CANDLE } = await import("../world2/tools/candle-lock.mjs");
  await client.query(DOOR_SHARES_THE_CANDLE);
  await client.query(LOCK_SQL, [markLockKey(mark)]);
  let n;
  try { n = await escrow(mark); }
  catch (e) {
    throw bounce(503, `the stakes on "${mark}" could not be read`,
      `a mark is withdrawn only when nothing is staked on it, and the ledger did not answer — your mark is exactly as it was; try again; ${faultLogged(`the stakes on "${mark}" could not be read`, e)}`);
  }
  if (Number(n) > 0) throw bounce(409, `${n}✦ stand in escrow on "${mark}" — a staked mark cannot be withdrawn`,
    "a stake landed while the withdrawal was being made — your own stake comes back with world_unstake; another's must be unstaked by its owner. Nothing was withdrawn.");
};
