// pos-779-vendor-equality.test.mjs — the vendored thread derivation against its producer, and the pin that says so (POS-779).
//
// world2/tools/conversations.mjs VENDORS `chains`, `clusterVoices` and `threadOf` from src/voices.mjs: the thread derivation is
// 1.0's law about its own speech, and a re-expression would be a twin. `VENDOR.voices.blob` names the voices.mjs it was taken
// from; the operator-run falsifier (falsifier-conversations-equality.mjs C2/C3) compares the two on the real record. This file is
// the part that runs on every commit, on invented voices:
//
//   · PRODUCER vs PORT, in process: `clusterVoices` from voices.mjs and from the vendored copy on seeded clouds with settlement
//     boundaries, a deck, ties and coincident points; and the whole page, paged — voices.mjs's own `conversations()` (over a log
//     written in its own format) against `conversationsOf`, thread for thread, including the `before` page and its cursor.
//   · THE PIN: the recorded blob is the blob of the voices.mjs in THIS checkout. A change to voices.mjs that does not re-pin reds
//     here; a re-pin without the equality above holding is what the equality catches.
//
//   node --test test/pos-779-vendor-equality.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-xyz");
const producer = await import("../src/voices.mjs");
const port = await import("../world2/tools/conversations.mjs");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const T0 = Date.UTC(2026, 9, 1, 0, 0, 0), H = 3600_000;

/** Seeded random voices over three places, a deck, ties and coincident points, and sorted settlement boundaries. */
function cloud(seed) {
  const r = rng(seed);
  const n = 40 + Math.floor(r() * 120);
  const voices = [];
  for (let i = 0; i < n; i++) {
    const place = Math.floor(r() * 3);
    const spread = r() < 0.2 ? 400 : 70;
    const at = T0 + Math.floor(r() * 30 * H);
    voices.push({
      handle: `h${Math.floor(r() * 12)}`, text: `t${i}`,
      at: r() < 0.15 && voices.length ? voices[voices.length - 1].at : at, // ties
      x: place * 1000 + (r() < 0.1 ? 0 : r() * spread), y: r() < 0.1 ? 0 : r() * spread,
      place: r() < 0.5 ? "the quay" : null, aboard: r() < 0.08,
    });
  }
  voices.sort((a, b) => a.at - b.at);
  const edges = [T0 - H, T0 + 7 * H, T0 + 14 * H, T0 + 22 * H].filter(() => r() < 0.9);
  return { voices, edges: edges.length ? edges : [T0 - H] };
}
const shape = (cs) => JSON.stringify(cs.map((c) => ({ latest: c.latest, voices: c.voices.map((v) => `${v.at}|${v.handle}|${v.text}`) })));

test("clusterVoices: the vendored copy and voices.mjs agree on 60 seeded clouds with settlement boundaries", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const { voices, edges } = cloud(seed);
    for (const earshotM of [60, 25, 0]) {
      assert.equal(shape(port.clusterVoices(voices, { earshotM, boundaries: edges })), shape(producer.clusterVoices(voices, { earshotM, boundaries: edges })), `seed ${seed} earshot ${earshotM}`);
    }
    // the sound class's own lull path (no boundaries) is the one other caller, and it must agree too
    assert.equal(shape(port.clusterVoices(voices, { earshotM: 60, fadeMs: 30 * 60_000 })), shape(producer.clusterVoices(voices, { earshotM: 60, fadeMs: 30 * 60_000 })), `seed ${seed} lull`);
  }
});

test("the page: voices.mjs's own conversations() over a log, against conversationsOf, thread for thread, first page and every page behind it", () => {
  const dir = mkdtempSync(join(tmpdir(), "pos779-vendor-"));
  let checked = 0, paged = 0;
  try {
    for (let seed = 101; seed <= 130; seed++) {
      const { voices, edges } = cloud(seed);
      const log = join(dir, `voices-${seed}.jsonl`);
      writeFileSync(log, voices.map((v) => JSON.stringify({ at: new Date(v.at).toISOString(), handle: v.handle, text: v.text, x: v.x, y: v.y, place: v.place, aboard: v.aboard })).join("\n") + "\n");
      const now = T0 + 40 * H;
      const oracle = producer.createVoices({
        standpoint: async () => null, logPath: () => log, now: () => now,
        earshotM: 60, fadeMs: 5 * 60_000, settlements: () => edges, memoryMax: Infinity,
        hearingWindow: () => ({ since: edges[edges.length - 1], source: "the test's sweeps", disclosure: null }),
      });
      for (const closedMax of [2, 1000]) {
        let before = null;
        for (let hop = 0; hop < 50; hop++) {
          const theirs = oracle.conversations({ closedMax, before });
          const mine = port.conversationsOf(voices, { now, earshotM: 60, boundaries: edges, fadeMs: 5 * 60_000, closedMax, before });
          for (const k of ["earshot_m", "fade_minutes", "close_minutes"]) assert.equal(mine[k], theirs[k], `${k} (seed ${seed})`);
          assert.equal(JSON.stringify(mine.live), JSON.stringify(theirs.live), `live threads (seed ${seed} hop ${hop})`);
          assert.equal(JSON.stringify(mine.closed), JSON.stringify(theirs.closed), `closed page (seed ${seed} closedMax ${closedMax} hop ${hop})`);
          assert.equal(mine.earlier.remaining, theirs.earlier.remaining, `remaining (seed ${seed} hop ${hop})`);
          assert.equal(mine.earlier.before, theirs.earlier.before, `cursor (seed ${seed} hop ${hop})`);
          checked += theirs.live.length + theirs.closed.length;
          if (before != null) paged += 1;
          if (!theirs.earlier.remaining) break;
          before = Date.parse(theirs.earlier.before);
        }
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.ok(checked > 100, `a comparison of ${checked} threads, not an empty one`);
  assert.ok(paged > 10, `${paged} pages behind a cursor were compared, not only first pages`);
});

const blobOf = (path) => execFileSync("git", ["-C", ROOT, "hash-object", path], { encoding: "utf8" }).trim();

test("THE PIN: VENDOR.voices.blob is the blob of the voices.mjs in this checkout, and its `at` commit carries that same blob", () => {
  const v = port.VENDOR.voices;
  assert.equal(v.path, "src/voices.mjs");
  assert.equal(blobOf("src/voices.mjs"), v.blob, "voices.mjs moved: re-check the vendored copy (the equality tests above) and re-pin");
  let atBlob = null;
  try { atBlob = execFileSync("git", ["-C", ROOT, "rev-parse", `${v.at}:src/voices.mjs`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* a checkout without that commit */ }
  if (atBlob != null) assert.equal(atBlob, v.blob, "the commit named in `at` does not hold the blob named");
});
