// pos-779-convo-components.test.mjs — the exact epoch components (world2/tools/convo-components.mjs) against the
// vendored fold, on invented points only (POS-779).
//
//   node --test test/pos-779-convo-components.test.mjs
//
// THE ORACLE IS THE PRODUCER'S OWN FOLD: `clusterVoices` from conversations.mjs (the vendored copy of
// voices.mjs), run over the same admitted voices as ONE epoch (`boundaries: []`, no lull). The partitions are
// compared as sets of act ids. Nothing here retypes the chains predicate.

import test from "node:test";
import assert from "node:assert/strict";
import { componentsOf, partitionKey, OverBudget, UnsupportedGeometry } from "../world2/tools/convo-components.mjs";
import { clusterVoices } from "../world2/tools/conversations.mjs";

// a small deterministic generator, so a failing fuzz case is reproducible from its seed
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const mk = (i, x, y, aboard = false) => ({ act_id: String(i), at: 1_000 + i, x, y, aboard, handle: `h${i}` });
const ids = (v) => v.act_id;
const both = async (voices, earshotM, opts = {}) => {
  const oracle = clusterVoices(voices, { earshotM, fadeMs: Infinity, boundaries: [] });
  const mine = await componentsOf(voices, { earshotM, ...opts });
  return {
    want: oracle.map((c) => c.voices.map(ids).sort().join("|")).sort().join("\n"),
    got: partitionKey(mine.components, (i) => voices[i].act_id),
    stats: mine.stats,
  };
};

test("fuzz: random clouds of every density give the oracle's partition (zero, tiny, ordinary and huge earshot; a deck; coincident points)", async () => {
  for (let seed = 1; seed <= 120; seed++) {
    const r = rng(seed);
    const n = 1 + Math.floor(r() * 90);
    const span = [3, 40, 200, 2000][seed % 4];
    const voices = [];
    for (let i = 0; i < n; i++) {
      const snap = r() < 0.15 && voices.length ? voices[Math.floor(r() * voices.length)] : null; // coincident points
      voices.push(mk(i, snap ? snap.x : (r() - 0.5) * span, snap ? snap.y : (r() - 0.5) * span, r() < 0.08));
    }
    for (const E of [0, 0.5, 7, 60, 400, Infinity]) {
      const { want, got } = await both(voices, E);
      assert.equal(got, want, `seed ${seed}, earshot ${E}: same components`);
      const forced = await both(voices, E, { probe: false, prune: false });
      assert.equal(forced.got, want, `seed ${seed}, earshot ${E}: same components with the k-d tree forced`);
    }
  }
});

test("fuzz at the boundary of earshot: voices exactly earshot apart chain, one ulp farther does not (the predicate is <=, on the same doubles)", async () => {
  const E = 60;
  const at = (d) => [mk(1, 0, 0), mk(2, d, 0)];
  assert.equal((await componentsOf(at(60), { earshotM: E })).components.length, 1, "exactly earshot: chains");
  assert.equal((await componentsOf(at(60.00000000000001), { earshotM: E })).components.length, 2, "a hair beyond: does not");
  const diag = [mk(1, 0, 0), mk(2, 36, 48)]; // 3-4-5: exactly 60 on the diagonal
  assert.equal((await componentsOf(diag, { earshotM: E })).components.length, 1);
  for (let seed = 1; seed <= 60; seed++) {
    const r = rng(1000 + seed);
    const voices = Array.from({ length: 70 }, (_, i) => mk(i, Math.round(r() * 12) * 30, Math.round(r() * 12) * 30)); // lattice: many distances exactly 60
    const { want, got } = await both(voices, 60);
    assert.equal(got, want, `lattice seed ${seed}`);
  }
});

test("the deck: every aboard voice is one component, wherever it is, and joins what it is within earshot of", async () => {
  const voices = [mk(1, 0, 0, true), mk(2, 5000, 5000, true), mk(3, 5010, 5000), mk(4, 9000, 0)];
  const { want, got } = await both(voices, 60);
  assert.equal(got, want);
  assert.equal((await componentsOf(voices, { earshotM: 60 })).components.length, 2);
});

test("DENSE UNCONNECTED NEIGHBOURS: two big circles one cell apart that never chain give two components without all-pairs work (shortcuts off, so the k-d tree is what is measured)", async () => {
  // two 1,500-voice disks, centres 80 m apart on x, each of radius 8 m: the nearest cross pair is >= 64 m > 60 m earshot.
  const r = rng(7);
  const disk = (cx, from, count) => Array.from({ length: count }, (_, k) => { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 8; return mk(from + k, cx + Math.cos(a) * d, Math.sin(a) * d); });
  const voices = [...disk(0, 0, 1500), ...disk(80, 1500, 1500)];
  const { want, got, stats } = await both(voices, 60, { probe: false, prune: false });
  assert.equal(got, want);
  assert.equal(want.split("\n").length, 2, "the control premise: they really are two threads");
  // Until the tree kept a bounding box per node this asserted `stats.checks > 100` (the search had to walk). Now the
  // root's box is farther than earshot from every voice of the other disk, so the search ends there: the tree was
  // BUILT and the search cost nothing, which is the point. The ring case below keeps a control that the search walks.
  assert.ok(stats.treesBuilt > 0, "the control: the tree path really ran (not skipped by the shortcuts)");
  const allPairs = 1500 * 1500;
  assert.ok(stats.checks < allPairs / 8, `distance checks ${stats.checks} stay far under the ${allPairs} all-pairs cross checks (measured 186,004 at this size, and about n^1.5 as it grows)`);
  assert.ok(stats.work < allPairs / 8, `total work ${stats.work} is counted and small`);
  const defaults = await componentsOf(voices, { earshotM: 60 });
  assert.ok(defaults.stats.checks < 100, `and with the box-gap pruning on, the far-apart pair costs ${defaults.stats.checks} checks`);
});

test("DENSE UNCONNECTED RINGS: two concentric rings whose boxes overlap but whose voices are all more than earshot apart stay two components, and the search still walks the tree", async () => {
  // radii 31 and 92.5: the nearest cross pair is 61.5 m > 60 m earshot, yet each cell's box is within reach of the other's.
  // The pruning by box gap cannot help here, and neither can the root's box: only a per-node box can.
  const ring = (n, radius, from) => Array.from({ length: n }, (_, k) => { const a = (2 * Math.PI * k) / n; return mk(from + k, 300 + radius * Math.cos(a), 300 + radius * Math.sin(a)); });
  const voices = [...ring(600, 31, 0), ...ring(600, 92.5, 600)];
  const { want, got, stats } = await both(voices, 60);
  assert.equal(got, want);
  assert.equal(want.split("\n").length, 2, "the control premise: two threads");
  assert.ok(stats.treesBuilt > 0 && stats.checks > 100, `the control: the search really walked (${stats.checks} checks, ${stats.treesBuilt} trees)`);
  const allPairs = 600 * 600;
  assert.ok(stats.checks < allPairs / 4, `${stats.checks} checks against ${allPairs} all-pairs cross checks`);
  // the same rings with one voice moved inside earshot: now ONE thread (the search must find a chaining pair, not just prune)
  const joined = voices.map((v, i) => (i === 0 ? { ...v, x: 300 + 31 * 1 + 29, y: 300 } : v)); // ring-1 voice 0 moved out to radius 60 -> 32.5 from ring 2's nearest point
  const j = await both(joined, 60);
  assert.equal(j.got, j.want);
  assert.equal(j.want.split("\n").length, 1, "one moved voice makes them one room");
});

test("a LATE BRIDGE: two circles that never chain are one thread once a voice between them is admitted; without it they stay two", async () => {
  const r = rng(11);
  const disk = (cx, from, count) => Array.from({ length: count }, (_, k) => { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 20; return mk(from + k, cx + Math.cos(a) * d, Math.sin(a) * d); });
  const base = [...disk(0, 0, 300), ...disk(140, 300, 300)];
  const bridge = mk(9999, 70, 0);
  const without = await both(base, 60);
  assert.equal(without.got, without.want);
  assert.equal(without.want.split("\n").length, 2);
  const withIt = await both([...base, bridge], 60);
  assert.equal(withIt.got, withIt.want);
  assert.equal(withIt.want.split("\n").length, 1, "the late voice merges the two circles");
});

test("a long moving chain (each voice chains with only its neighbours) is one component", async () => {
  const voices = Array.from({ length: 900 }, (_, i) => mk(i, i * 40, (i % 7) * 3));
  const { want, got } = await both(voices, 60);
  assert.equal(got, want);
  assert.equal(want.split("\n").length, 1);
});

test("degenerate earshot: zero chains only coincident points; Infinity chains every placed voice", async () => {
  const pts = [mk(1, 1, 1), mk(2, 1, 1), mk(3, 1, 2), mk(4, -0, 0), mk(5, 0, 0)];
  assert.deepEqual((await componentsOf(pts, { earshotM: 0 })).components.map((c) => c.map((i) => pts[i].act_id)), [["1", "2"], ["3"], ["4", "5"]], "-0 and 0 are the same point");
  assert.equal((await componentsOf(pts, { earshotM: Infinity })).components.length, 1);
});

test("an earshot that is not a distance is refused, never guessed at", async () => {
  await assert.rejects(componentsOf([mk(1, 0, 0)], { earshotM: -5 }), UnsupportedGeometry);
  await assert.rejects(componentsOf([mk(1, 0, 0), mk(2, 1, 0)], { earshotM: "far" }), UnsupportedGeometry);
  await assert.rejects(componentsOf([mk(1, 0, 0)], { earshotM: NaN }), UnsupportedGeometry);
});

test("geometry the grid cannot name exactly is refused: a point so far out that two cells collapse", async () => {
  await assert.rejects(componentsOf([mk(1, 1e30, 0), mk(2, 1e30 + 1e15, 0)], { earshotM: 60 }), UnsupportedGeometry);
});

test("a voice with no finite point can only be on the deck; it never joins by distance", async () => {
  const voices = [{ ...mk(1, NaN, NaN) }, mk(2, 0, 0), { ...mk(3, NaN, 0, true) }];
  const mine = await componentsOf(voices, { earshotM: 60 });
  assert.equal(mine.components.length, 3);
});

test("the work FUSE is real: past it the build throws OverBudget and returns no partition at all", async () => {
  const voices = Array.from({ length: 400 }, (_, i) => mk(i, (i % 20) * 30, Math.floor(i / 20) * 30));
  await assert.rejects(componentsOf(voices, { earshotM: 60, fuse: 50 }), (e) => e instanceof OverBudget && /work fuse/.test(e.message));
  const ok = await componentsOf(voices, { earshotM: 60 });
  assert.ok(ok.stats.work > 50, "the control: the same input passes under the default fuse, so the fuse is what stopped it");
});

test("SLICES: the work yields to the event loop and the longest synchronous stretch is reported (a fake clock proves the mechanism)", async () => {
  let t = 0, yields = 0;
  const voices = Array.from({ length: 600 }, (_, i) => mk(i, (i % 30) * 25, Math.floor(i / 30) * 25));
  const mine = await componentsOf(voices, { earshotM: 60, sliceMs: 1, now: () => (t += 0.25), yieldFn: async () => { yields += 1; } });
  assert.ok(yields > 3, `yielded ${yields} times under a 1 ms slice`);
  assert.equal(mine.stats.slices, yields);
  assert.ok(mine.stats.maxSliceMs < 5, `a slice never ran long: ${mine.stats.maxSliceMs}`);
  const oracle = clusterVoices(voices, { earshotM: 60, fadeMs: Infinity, boundaries: [] });
  assert.equal(partitionKey(mine.components, (i) => voices[i].act_id), oracle.map((c) => c.voices.map(ids).sort().join("|")).sort().join("\n"), "yielding does not change the answer");
});

test("an empty epoch is no components", async () => {
  assert.deepEqual((await componentsOf([], { earshotM: 60 })).components, []);
});
