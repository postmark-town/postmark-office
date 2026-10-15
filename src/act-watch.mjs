// act-watch.mjs — the act doors' one hook for creatures (POS-637 PR-B; W1).
//
// RULED (Darko, Sitting E, 2026-10-14 21:31): a creature has an awareness ring
// and no verbs of its own; every ordinary public act a resident takes inside
// the ring has an effect, and the reaction comes back in the actor's own
// answer. So every door that performs one of those acts (the apex, the flat
// MCP tools and REST alike) has to hand its act to the creatures, and the
// answer has to wait for them, bounded.
//
// THE HOOK IS AROUND THE IMPLEMENTATIONS, NOT THE DOORS (W1). `perceived(run)`
// wraps each act implementation's whole body: worldSay, worldSayHuman,
// walkViaOffice, leaveMarkViaOffice (world.mjs), enterViaOffice and
// exitViaOffice (world-crossings.mjs), callHoldTool (world-hold.mjs) and
// callWorldStakeTool (world-stake.mjs, where a private draft's leave-mark is
// released into `acts`). Every door reaches those functions, so every door
// perceives alike.
//
// THE TRIGGER IS THE ROW, NOT THE ARGUMENTS. Inside the scope, the pen tells
// this file every `acts` row it inserted (world2-pen.mjs § insertAct), and the
// crossing pass, which writes in a child process, tells it the act id the
// child answered (world-apex.mjs § crossingDeps.record). So a creature reacts
// only to an act that reached the record: never a private draft (it has no
// row), never a bounce, and never a note. Which rows count is the world's law
// (RING_VERBS), read by the hook.
//
// AN ACT WITH NO CREATURE ALIVE COSTS NOTHING. Until the hook says a creature
// is living (`creaturesAwake`), `perceived` is `run()` and nothing more: no
// scope, no import, no query.
//
// NESTED IS ONE ACT. An act implementation that calls another (a walk that
// exits first, an enter that stops the walk) is inside the outer scope, and
// the inner call adds its rows to it. The hook picks one trigger per call.

import { AsyncLocalStorage } from "node:async_hooks";

const watch = new AsyncLocalStorage();
let awake = false;

/** The hook's switch: true while at least one creature is living in this process. */
export function setCreaturesAwake(on) { awake = !!on; }
export const creaturesAwake = () => awake;

/**
 * An acts row the pen inserted, inside a watched act. `row` is the normalized
 * row (world-journal.mjs § normalizeRow), or `{ actor, action }` alone when the
 * write happened in another process and only its id came back.
 */
export function noteActWritten(row, id) {
  const s = watch.getStore();
  if (!s || s.closed || id == null) return;
  s.rows.push({ ...row, id: String(id) });
}

/**
 * Run one act implementation, and hand what it wrote to the creatures. The
 * answer is the implementation's own, with `creatures` added when any creature
 * answered. A creature never fails an act: a fault in the hook is logged and
 * the answer goes out as it was.
 */
export async function perceived(run) {
  if (!awake || watch.getStore()) return run();
  const s = { rows: [], closed: false };
  // The hook runs AFTER `watch.run` has returned, so it is outside the watch by
  // construction: a creature's own write is never taken for the act's row.
  const result = await watch.run(s, run);
  s.closed = true;
  if (!s.rows.length) return result;
  try {
    const { creaturesAnswer } = await import("./creatures-hook.mjs");
    return await creaturesAnswer(s.rows, result);
  } catch (e) {
    console.error(`[creatures] the hook tripped; the act answers without them (${String(e?.message ?? e).slice(0, 200)})`);
    return result;
  }
}

/** Whether this code runs inside a watched act (tests: a creature's write must not). */
export const insideWatchedAct = () => !!watch.getStore();
