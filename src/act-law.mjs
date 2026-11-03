// act-law.mjs — an act stands on the law the store has NOW (POS-680, part 2 of 2).
//
// The class layer the doors read (law-snapshot.mjs) and the world graph that
// grants and explains (world-graph-snapshot.mjs) are each refreshed by a
// timer. Between a settlement re-reading its law into the store and the next
// tick, an act would be judged under the law before it. So every world act
// asks first: both pins (a few index lookups), and a moved law or graph is
// loaded before the act runs.
//
// WHEN THE NEW LAW WILL NOT LOAD (G1, Wright 2026-10-23: "which I agree with").
// If the store says the law moved and this process could not load it in time,
// the act is refused with a plain 503 and nothing is done. It is never judged
// under law the store has replaced. A read keeps answering from what stands
// and says so on its own standing (GET /release § law, world_graph).
//
// ONE PIN QUESTION AT A TIME (Wright's Settled on POS-680, 2026-11-03, on the
// round-2 review's F3; "C plus coalescing", decided on Darko's behalf):
//   · "One shared pin session, single-flight. At most one pin session is in
//     flight at a time, across law and graph together. It holds one slot of the
//     existing cap of 2. Within it, ask the law pin, then the graph pin, in
//     sequence." (`askPins`, `pinsInFlight`.)
//   · "Every act arriving while that session is in flight awaits the same
//     answer, within its own deadline. It never opens its own."
//   · "No slot means the plain 503 ... A read always keeps the third
//     connection."
//   · "The reuse rule stands. An act reuses a refresh in flight only if what
//     that refresh put in force matches the shared answer's pin. Otherwise it
//     gets the 503." (law-snapshot.mjs § freshLaw, world-graph-snapshot.mjs
//     § freshGraph.)
// An answer that does not come in time is not an answer: the act could not
// confirm what is in force, and is refused ("an act is never admitted on law
// or graph it hasn't confirmed", the amended Settled, 01:5x EST). The session
// gives up at its deadline for the same reason, so a statement the store ends
// later is never read as "the store could not be asked". A store that cannot
// be asked at all (none engaged, or it refuses the connection) still refuses
// nothing (G1's fallback, kept).
//
// Called at every world act's door: the MCP tools/call gate (mcp.mjs, beside
// the standing gate) and each REST POST /world/* route (server.mjs).

import { freshLaw, PIN_SQL as LAW_PIN_SQL, LAW_REFRESH_DEADLINE_MS } from "./law-snapshot.mjs";
import { freshGraph, PIN_SQL as GRAPH_PIN_SQL } from "./world-graph-snapshot.mjs";
import { startLoad, endLoad, timedSession, servePool, plainRefreshError, MAX_LOADS } from "./snapshot-loads.mjs";

/** The refusal, in one place for both doors. */
export const LAW_MOVED = Object.freeze({
  code: 503,
  defect: "the town's law just changed, and this office has not read the new law yet",
  hint: "nothing was done; ask again in a minute",
});

/** Why an act could not confirm what is in force: no slot for the pin question, or no answer in time. */
const AT_THE_CAP = `this office could not confirm the law and the world graph in force: ${MAX_LOADS} store loads are already running (the cap)`;
const NO_ANSWER = "this office could not confirm the law and the world graph in force: the store did not answer in time";

let pinsInFlight = null; // the one shared pin session (single-flight), until its question has truly ended

/** `promise`, or `late` once `ms` have passed (an unref'd timer, as the refreshers' deadlines are). */
function within(promise, ms, late) {
  if (ms == null) return promise;
  let timer = null;
  const gone = new Promise((resolve) => { timer = setTimeout(resolve, ms, late); timer.unref?.(); });
  return Promise.race([promise, gone]).finally(() => clearTimeout(timer));
}

/**
 * The shared pin answer (§ ONE PIN QUESTION AT A TIME): `{ law, graph }`, the
 * law's pin row and `{ key, settlement }` for the graph's; `{ busy: true }` when
 * no slot was free; `{ late: true }` when no answer came within this act's
 * deadline (or the session's); null when the store could not be asked at all.
 * `lawQuery` and `graphQuery` are a test's invented stores; by default both
 * pins are asked in one timed session on the serve pool.
 */
export function askPins({ lawQuery = null, graphQuery = null, deadlineMs = LAW_REFRESH_DEADLINE_MS } = {}) {
  if (!pinsInFlight) {
    if (!startLoad()) return Promise.resolve({ busy: true });
    let live = null;
    const work = (async () => {
      await null; // the body runs after `pinsInFlight` is set, even when a query throws at once
      let session = null;
      try {
        if (!lawQuery || !graphQuery) session = await timedSession(await servePool());
        const law = (await (lawQuery ?? session.query)(LAW_PIN_SQL)).rows[0] ?? {};
        const pin = (await (graphQuery ?? session.query)(GRAPH_PIN_SQL)).rows[0] ?? null;
        return { law, graph: { key: pin ? `${pin.tag_sha}/${pin.office_sha}` : null, settlement: pin?.settlement ?? null } };
      } catch (e) {
        plainRefreshError(e, "an act's ask of the law's and the world graph's pins"); // the raw error to the log, once per change
        return null;
      } finally {
        await session?.end();
        endLoad();
        if (pinsInFlight === live) pinsInFlight = null;
      }
    })();
    live = within(work, deadlineMs, { late: true });
    pinsInFlight = live;
  }
  return within(pinsInFlight, deadlineMs, { late: true });
}

/** The shared answer's refusal, before either half is settled: no slot, or no answer in time. */
const unconfirmed = (told) => (told?.busy ? AT_THE_CAP : told?.late ? NO_ANSWER : null);

/**
 * Ask both pins (one shared question) and load what moved. Resolves null when
 * the act may go on, or the refusal (`LAW_MOVED` plus `behind`, the sentence
 * saying which copy is behind, or why nothing could be confirmed). `pins`,
 * `law` and `graph` are the seams a test hands in.
 */
export async function lawForAnAct({ pins = askPins, law = freshLaw, graph = freshGraph } = {}) {
  if (forTest && pins === askPins && law === freshLaw && graph === freshGraph) return forTest();
  const told = await pins();
  const none = unconfirmed(told);
  if (none) return { ...LAW_MOVED, behind: none };
  // the law, then the graph: an act holds at most one slot at a time
  const l = await law({ told: told === null ? null : told.law });
  const g = await graph({ told: told === null ? null : told.graph });
  const behind = [l?.behind, g?.behind].filter(Boolean);
  return behind.length ? { ...LAW_MOVED, behind: behind.join("; ") } : null;
}

/** For a read that answers what a class IS (explain:): the same shared ask and loads, and nothing refused. */
export async function lawForAnAnswer({ pins = askPins, law = freshLaw, graph = freshGraph } = {}) {
  answered += 1;
  const told = await pins();
  if (unconfirmed(told)) return; // a read is never refused: it answers from what stands
  await law({ told: told === null ? null : told.law });
  await graph({ told: told === null ? null : told.graph });
}

// ── the test seam (node --test only, as world-graph-snapshot.mjs's are) ─────
let forTest = null;
let answered = 0;
const inNodeTest = () => Boolean(process.env.NODE_TEST_CONTEXT);
/** Tests only: what every door's `lawForAnAct()` answers (null puts the stores back). */
export function __setLawForAnActForTest(fn) {
  if (!inNodeTest()) throw new Error("__setLawForAnActForTest is a test seam and answers only under node --test");
  forTest = fn;
}
/** Tests only: how many times a read asked for the law before it answered. */
export const __answeredForTest = () => answered;
