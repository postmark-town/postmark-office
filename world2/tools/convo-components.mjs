// convo-components.mjs — the EXACT conversation components of one settlement's voices (POS-779).
//
// WHAT THIS IS. Inside one settlement a conversation never expires, so the threads of an epoch are the
// CONNECTED COMPONENTS of its eligible voices under voices.mjs `chains` (distance <= earshot, OR both voices
// aboard). The vendored fold (`clusterVoices`, conversations.mjs) finds them by comparing every new voice with
// every open voice: quadratic, 9-19 s of synchronous CPU at 32k voices (the DEV measurement the POS-779 proof
// report holds). This finds the SAME partition with finite, counted work and without holding the thread for
// longer than a slice:
//
//   1. every aboard voice is one component (the deck is one place even though it moves);
//   2. the rest go in a grid whose cell side is earshot/2, so any two voices in one cell chain (their distance
//      is below earshot * 0.71) and a cell is one component at once;
//   3. two cells can only chain if some voice of one is within earshot of some voice of the other. Cells whose
//      boxes are farther apart than earshot are never compared. For the rest, the voices of the smaller cell ask
//      the other cell's k-d tree "is anything within earshot of this point?", stopping at the first yes. So two
//      dense neighbouring cells that do NOT chain cost |small| tree queries, not |A| x |B| pair checks.
//
// WHY NOT A SORT-BY-X SWEEP. A sweep is exact, but with every voice at nearly one x and spread in y it still
// compares everything inside the x window. Dense unconnected neighbours are exactly that shape.
//
// EXACTNESS IS NOT ASSUMED. `test/pos-779-convo-components.test.mjs` runs this and the vendored
// `clusterVoices` (one epoch, no lull) over the same admitted inputs, fuzzed and adversarial, and compares the
// partitions; the predicate counter in `stats` is what shows the dense-neighbour case is not quadratic.
//
// FINITE WORK. Every distance check and tree step is counted in `stats.work`. When the count passes `fuse`
// this THROWS `OverBudget`: it never returns a partial partition as if it were whole (a component cut short is
// a thread that lies). The caller answers "over budget" for that epoch.
//
// SLICES. The work is chunked: after `sliceMs` of synchronous running it yields to the event loop
// (`setImmediate`), so one request never holds the thread for the whole epoch. `maxSliceMs` in the stats is the
// longest synchronous stretch actually measured, so a claim about latency is a measurement.

import { performance } from "node:perf_hooks";

export class OverBudget extends Error {
  constructor(what, detail = {}) { super(`conversation components over budget: ${what}`); this.name = "OverBudget"; this.what = what; this.detail = detail; }
}

/** Geometry this builder will not answer for (it answers "unavailable", never a guess). */
export class UnsupportedGeometry extends Error {
  constructor(what) { super(`conversation components cannot be built exactly for this geometry: ${what}`); this.name = "UnsupportedGeometry"; this.what = what; }
}

const SQRT = Math.sqrt;
/** The cell index window around a cell that can hold a chaining voice. Earshot is 2 cells; one more absorbs the rounding of x / side. */
const WINDOW = 3;

function makeUnionFind(n) {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i) => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    while (parent[i] !== r) { const next = parent[i]; parent[i] = r; i = next; }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return false;
    if (ra < rb) parent[rb] = ra; else parent[ra] = rb; // the smaller index (the earlier voice) stays the root
    return true;
  };
  return { find, union };
}

/**
 * A k-d tree over a cell's points, stored flat. Built iteratively so the caller can yield between ranges:
 * the top-level sort of a 16k-voice cell is the longest synchronous stretch in the whole build.
 */
async function buildKd(idx, xs, ys, { due, tick }) {
  const order = Int32Array.from(idx);
  const axisOf = new Uint8Array(order.length);
  // each node's bounding box of its whole subtree, kept at the node's own slot: a search skips a subtree whose
  // box is farther than earshot from the query, which is what keeps two dense cells that do NOT chain cheap
  const bx0 = new Float64Array(order.length), bx1 = new Float64Array(order.length);
  const by0 = new Float64Array(order.length), by1 = new Float64Array(order.length);
  const todo = [0, order.length, 0];
  while (todo.length) {
    const axis = todo.pop(), hi = todo.pop(), lo = todo.pop();
    if (hi <= lo) continue;
    // the box of [lo, hi), taken before the sort (membership of the range is all it needs)
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = lo; k < hi; k++) {
      const i = order[k];
      if (xs[i] < x0) x0 = xs[i];
      if (xs[i] > x1) x1 = xs[i];
      if (ys[i] < y0) y0 = ys[i];
      if (ys[i] > y1) y1 = ys[i];
    }
    const mid = (lo + hi) >> 1;
    if (hi - lo <= 1) { bx0[mid] = x0; bx1[mid] = x1; by0[mid] = y0; by1[mid] = y1; continue; }
    const key = axis === 0 ? xs : ys;
    const slice = Array.from(order.subarray(lo, hi)).sort((p, q) => key[p] - key[q] || p - q);
    order.set(slice, lo);
    const m = (lo + hi) >> 1;
    axisOf[m] = axis;
    bx0[m] = x0; bx1[m] = x1; by0[m] = y0; by1[m] = y1;
    todo.push(lo, m, axis ^ 1, m + 1, hi, axis ^ 1);
    if (due()) await tick();
  }
  return { order, axisOf, bx0, bx1, by0, by1 };
}

function kdAny(tree, xs, ys, qx, qy, r, r2, counter) {
  const { order, axisOf, bx0, bx1, by0, by1 } = tree;
  const stack = [0, order.length];
  // a subtree is skipped only when its box is PROVABLY out of reach: the box distance is a lower bound of every
  // point's distance, and the margin keeps a rounding difference between two hypots from ever deciding it
  const reach = r * (1 + 1e-9) + 1e-9;
  while (stack.length) {
    const hi = stack.pop(), lo = stack.pop();
    if (hi <= lo) continue;
    counter.work += 1;
    const mid = (lo + hi) >> 1;
    const gx = Math.max(0, bx0[mid] - qx, qx - bx1[mid]), gy = Math.max(0, by0[mid] - qy, qy - by1[mid]);
    if (Math.hypot(gx, gy) > reach) continue;
    const i = order[mid];
    const dx = xs[i] - qx, dy = ys[i] - qy;
    counter.checks += 1;
    // the same predicate as `chains`, on the same numbers: Math.hypot(a - b) <= earshot
    if (Math.hypot(dx, dy) <= r) return true;
    if (hi - lo === 1) continue;
    const axis = axisOf[mid];
    const diff = axis === 0 ? qx - xs[i] : qy - ys[i];
    // the near half always; the far half only when the splitting plane is within reach
    const nearIsLow = diff < 0;
    if (Math.abs(diff) <= r) {
      stack.push(nearIsLow ? mid + 1 : lo, nearIsLow ? hi : mid);
      stack.push(nearIsLow ? lo : mid + 1, nearIsLow ? mid : hi);
    } else if (nearIsLow) stack.push(lo, mid);
    else stack.push(mid + 1, hi);
  }
  return false;
}

/**
 * The connected components of `voices` (each `{ x, y, aboard }`, already admitted: eligibility and epoch are
 * the caller's), as arrays of indices into `voices`, each ascending, the list ordered by its first index.
 *
 * Async only to yield between slices. Pure: it reads nothing but its arguments.
 *
 * `earshotM`: a finite number >= 0, or Infinity (everyone chains). Anything else (NaN, negative, text) is refused: a dial that is not a distance is a corrupt read, not a rule.
 * `probe` / `prune`: switches for the two shortcuts (the bounded probe, the box-gap pruning); on by default, they exist so a test can force the k-d tree path and show the work it costs.
 * `fuse`: the most work units (distance checks plus tree steps plus cell pairs) it will spend, else OverBudget.
 */
export async function componentsOf(voices, { earshotM, fuse = 50_000_000, sliceMs = 8, probe = true, prune = true, now = () => performance.now(), yieldFn = () => new Promise((r) => setImmediate(r)) } = {}) {
  const n = voices.length;
  const stats = { voices: n, work: 0, checks: 0, cells: 0, cellPairs: 0, cellPairsPruned: 0, treesBuilt: 0, slices: 0, maxSliceMs: 0 };
  if (n === 0) return { components: [], stats };
  const { find, union } = makeUnionFind(n);
  let sliceStart = now();
  // sync check; only a slice that has run long enough costs an await
  const due = () => {
    if (stats.work > fuse) throw new OverBudget("work fuse", { work: stats.work, fuse });
    return now() - sliceStart >= sliceMs;
  };
  const tick = async () => {
    if (!due()) return;
    stats.maxSliceMs = Math.max(stats.maxSliceMs, now() - sliceStart);
    stats.slices += 1;
    await yieldFn();
    sliceStart = now();
  };

  // 1. the deck: every aboard voice is one component (voices.mjs `chains`: both aboard)
  let deck = -1;
  for (let i = 0; i < n; i++) if (voices[i].aboard) { if (deck < 0) deck = i; else union(i, deck); }

  const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = Number(voices[i].x); ys[i] = Number(voices[i].y); }
  // `chains` uses Math.hypot on the raw difference; a voice with no finite point can only be on the deck
  const placed = [];
  for (let i = 0; i < n; i++) if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) placed.push(i);

  const E = Number(earshotM);
  if (E === Infinity) {
    for (let k = 1; k < placed.length; k++) { union(placed[k], placed[0]); stats.work += 1; }
  } else if (E === 0) {
    // only a voice at the very same point chains: dist <= 0
    const at = new Map();
    for (const i of placed) {
      const key = `${xs[i] + 0},${ys[i] + 0}`;
      if (at.has(key)) union(i, at.get(key)); else at.set(key, i);
      stats.work += 1;
      if ((stats.work & 1023) === 0) if (due()) await tick();
    }
  } else if (E > 0 && Number.isFinite(E)) {
    const side = E / 2;
    // refuse geometry whose cell indices cannot be told apart in doubles (the neighbour window would be wrong)
    const SAFE = 2 ** 50;
    // cells by (cx, cy) in two levels of Map: no key string per voice and per neighbour lookup (cx and cy are integers below
    // 2^50, so each is its own exact key); `cellList` keeps the first-seen order a single Map of strings kept
    const cols = new Map();
    const cellList = [];
    for (const i of placed) {
      const cx = Math.floor(xs[i] / side), cy = Math.floor(ys[i] / side);
      if (!(Math.abs(cx) < SAFE) || !(Math.abs(cy) < SAFE)) throw new UnsupportedGeometry("a voice lies so far from the origin, relative to earshot, that its grid cell cannot be named exactly");
      let col = cols.get(cx);
      if (!col) cols.set(cx, col = new Map());
      let c = col.get(cy);
      if (!c) { col.set(cy, c = { cx, cy, idx: [], minx: Infinity, maxx: -Infinity, miny: Infinity, maxy: -Infinity, tree: null }); cellList.push(c); }
      c.idx.push(i);
      if (xs[i] < c.minx) c.minx = xs[i];
      if (xs[i] > c.maxx) c.maxx = xs[i];
      if (ys[i] < c.miny) c.miny = ys[i];
      if (ys[i] > c.maxy) c.maxy = ys[i];
      stats.work += 1;
      if ((stats.work & 1023) === 0) if (due()) await tick();
    }
    stats.cells = cellList.length;
    // 2. a cell is one component
    for (const c of cellList) for (let k = 1; k < c.idx.length; k++) union(c.idx[k], c.idx[0]);
    // 3. neighbouring cells: one ordered pair at a time
    const r2 = E * E;
    let visited = 0;
    for (const a of cellList) {
      // a cell with no neighbour in the window reaches no checkpoint below: 32,000 lonely cells are 1.5M lookups, a slice at a time
      if ((++visited & 127) === 0 && due()) await tick();
      for (let dx = 0; dx <= WINDOW; dx++) { // each unordered pair once: the window's later half (dx > 0, or dx = 0 with dy > 0)
        const col = cols.get(a.cx + dx); // one column lookup per dx, not one per cell of the window
        if (!col) continue;
        for (let dy = dx === 0 ? 1 : -WINDOW; dy <= WINDOW; dy++) {
          const b = col.get(a.cy + dy);
          if (!b) continue;
          stats.cellPairs += 1;
          stats.work += 1;
          if (find(a.idx[0]) === find(b.idx[0])) continue; // already one component: nothing to learn
          // the boxes' gap: beyond earshot nothing can chain
          const gx = Math.max(0, a.minx - b.maxx, b.minx - a.maxx), gy = Math.max(0, a.miny - b.maxy, b.miny - a.maxy);
          if (prune && Math.hypot(gx, gy) > E) { stats.cellPairsPruned += 1; continue; }
          const [small, big] = a.idx.length <= b.idx.length ? [a, b] : [b, a];
          let chained = false;
          // a bounded probe first: two cells that do chain (the usual neighbours) are found in a few hundred
          // checks, and the tree is built only for a pair the probe cannot settle
          const probeA = probe ? Math.min(small.idx.length, 8) : 0, probeB = Math.min(big.idx.length, 64);
          for (let p = 0; p < probeA && !chained; p++) {
            const i = small.idx[p];
            for (let q = 0; q < probeB; q++) {
              const j = big.idx[q];
              stats.work += 1; stats.checks += 1;
              if (Math.hypot(xs[i] - xs[j], ys[i] - ys[j]) <= E) { chained = true; break; }
            }
          }
          if (chained) { union(a.idx[0], b.idx[0]); if (due()) await tick(); continue; }
          if (!big.tree) { big.tree = await buildKd(big.idx, xs, ys, { due, tick }); stats.treesBuilt += 1; stats.work += big.idx.length; }
          for (const i of small.idx) {
            // skip a voice whose point is too far from the whole other cell to reach it
            const ex = Math.max(0, big.minx - xs[i], xs[i] - big.maxx), ey = Math.max(0, big.miny - ys[i], ys[i] - big.maxy);
            stats.work += 1;
            if (prune && Math.hypot(ex, ey) > E) continue;
            if (kdAny(big.tree, xs, ys, xs[i], ys[i], E, r2, stats)) { chained = true; break; }
            if (due()) await tick();
          }
          if (chained) union(a.idx[0], b.idx[0]);
          if (due()) await tick();
        }
      }
    }
  } else {
    throw new UnsupportedGeometry(`earshot ${String(earshotM)} is not a distance`);
  }

  if (due()) await tick();
  // The root of a set is its smallest index (`union` keeps the earlier voice as the root), so a component is born at the
  // index that is its own root, in increasing order of first index, and its members arrive ascending: no map, no sort, and a
  // slice at a time (32,000 singleton threads made the old map-and-sort one 30-40 ms stretch).
  const slot = new Int32Array(n);
  const components = [];
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (r === i) { slot[i] = components.length; components.push([i]); } else components[slot[r]].push(i);
    if ((i & 1023) === 1023 && due()) await tick();
  }
  stats.maxSliceMs = Math.max(stats.maxSliceMs, now() - sliceStart);
  return { components, stats };
}

/** The partition as a canonical string set, for comparing two builders: each component's members joined, components sorted. */
export function partitionKey(components, idOf) {
  return components.map((c) => c.map(idOf).sort().join("|")).sort().join("\n");
}
