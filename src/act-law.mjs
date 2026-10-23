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
// Called at every world act's door: the MCP tools/call gate (mcp.mjs, beside
// the standing gate) and each REST POST /world/* route (server.mjs).

import { freshLaw } from "./law-snapshot.mjs";
import { freshGraph } from "./world-graph-snapshot.mjs";

/** The refusal, in one place for both doors. */
export const LAW_MOVED = Object.freeze({
  code: 503,
  defect: "the town's law just changed, and this office has not read the new law yet",
  hint: "nothing was done; ask again in a minute",
});

/**
 * Ask both pins and load what moved. Resolves null when the act may go on, or
 * the refusal (`LAW_MOVED` plus `behind`, the sentence saying which copy is
 * behind). `law` and `graph` are the seams a test hands in.
 */
export async function lawForAnAct({ law = freshLaw, graph = freshGraph } = {}) {
  if (forTest && law === freshLaw && graph === freshGraph) return forTest();
  const [l, g] = await Promise.all([law(), graph()]);
  const behind = [l?.behind, g?.behind].filter(Boolean);
  return behind.length ? { ...LAW_MOVED, behind: behind.join("; ") } : null;
}

/** For a read that answers what a class IS (explain:): the same two asks, and nothing refused. */
export async function lawForAnAnswer({ law = freshLaw, graph = freshGraph } = {}) {
  answered += 1;
  await Promise.all([law(), graph()]);
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
