// convo-edges.mjs — WHERE A CONVERSATION SPLITS: THE PUBLISHED SWEEPS THIS OFFICE HAS READ (POS-779).
//
// A thread splits at a settlement and nowhere else, and the settlement is the crossing's published sweep (the
// `settlement: sweep …` commit on world main), the same edge hearing opens its window at
// (src/hearing-window.mjs). Not a nominal 06:00/18:00 heartbeat: a refused crossing publishes nothing and the
// two differ. Not the store's `settlements` table either: a row exists there only once the keeper has blessed the
// sweep, and the keeper skips some (three publishes sat between S70 and S71), so an epoch drawn between two blessed
// edges can hide a sweep that really split it.
//
// WHAT THE OFFICE HAS READ is what the reader keeps in memory: about a month of sweeps (HEARING_HISTORY). Past
// the oldest of them an epoch's START is unknown, and everything built on these edges says so rather than
// treating that oldest edge as the beginning of the record.
//
// The edges are fed in by the caller (`settlements()` and `hearingWindow(ms)`), so this module reads nothing.

import { createHash } from "node:crypto";

/**
 * The published sweeps at or before `ms`, ascending, with a version that changes when they do.
 *   settlements   () => ms[]      the reader's kept sweeps (may throw: then none)
 *   hearingWindow (ms) => { since }   the window open at `ms` (may throw or answer null)
 */
export function publishedEdges({ settlements, hearingWindow, ms }) {
  let kept = [];
  try { kept = settlements?.() ?? []; } catch { kept = []; }
  let since = null;
  try { since = hearingWindow?.(ms)?.since ?? null; } catch { since = null; }
  const all = [...new Set([...(Array.isArray(kept) ? kept : []), ...(Number.isFinite(since) ? [since] : [])])]
    .filter((m) => Number.isFinite(m) && m <= ms)
    .sort((a, b) => a - b);
  return { list: all, version: createHash("sha256").update(all.join(",")).digest("hex").slice(0, 16) };
}

/**
 * The epochs the edges name, newest first: `{ since, next }` (ms; `next` null for the open one). The oldest
 * known edge starts the oldest epoch; nothing is said about the time before it.
 */
export function epochsOf(edgeList) {
  const out = [];
  for (let i = edgeList.length - 1; i >= 0; i--) out.push({ since: edgeList[i], next: i + 1 < edgeList.length ? edgeList[i + 1] : null });
  return out;
}
