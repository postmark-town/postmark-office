// pos902-doorstep.mjs — INVENTED households for the bounded-doorstep tests (POS-902). TEST-ONLY; nothing here is a production body.
//
// A prolific house, an ordinary house, an empty one, and the readers `stakesFor` takes, so a test can ask a stakes report of any of them
// with its totals known INDEPENDENTLY of the code under test: the numbers below are written down from how the fixture is built, never
// read back from the function being tested.
//
//   Dates (the published mark's own `date`): risk-00..02 are the newest of all (Nov 20-22), then backed-17..00 (Nov 18..01), then the rest older.
//   prolific  60 published marks: 12 commons at ✦0 (AT RISK), 18 commons with stamps, 15 home-class parcels at ✦0 (never swept),
//             15 founding-estate marks at ✦0 (not in the registry, never swept)            -> count 60, at_risk 12
//   ordinary  8 marks: 1 at risk                                                              -> count 8, at_risk 1
//   empty     none                                                                           -> count 0
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { WORLD_CLONE } from "../../src/world-store.mjs";

export const EXPECTED = Object.freeze({
  prolific: Object.freeze({ handle: "prolific-one", count: 60, atRisk: 12 }),
  ordinary: Object.freeze({ handle: "ordinary-two", count: 8, atRisk: 1 }),
  empty: Object.freeze({ handle: "empty-three", count: 0, atRisk: 0 }),
});
export const HEAD = "9020902090209020902090209020902090209020";
export const NOW = new Date("2026-11-10T04:10:00Z");

const pad = (n) => String(n).padStart(2, "0");

/** The marks, the sweep's registry and the escrow map for the three invented houses (`prolific` renames the big house, so a doorstep test can give it a handle the fixture town knows). */
export function world({ prolific = EXPECTED.prolific.handle } = {}) {
  const marks = [], registry = {}, escrow = new Map();
  const add = (by, slug, { cls, stamps, date, body }) => {
    const id = `${by}/${slug}`;
    marks.push({ id, kind: "sited", by, household: by, at: { x: marks.length, y: 1 }, body, date });
    if (cls) registry[id] = { household: by, path: `WORLD/marks/${by}/${slug}/mark.md`, class: cls };
    escrow.set(id, stamps);
  };
  const p = prolific;
  for (let i = 0; i < 12; i++) add(p, `risk-${pad(i)}`, { cls: "commons", stamps: 0, date: i < 3 ? `2026-11-${20 + i}T10:00:00.000Z` : `2026-10-${pad(1 + i)}T10:00:00.000Z`, body: `a commons mark nobody has stamped yet (${i}). `.repeat(6) });
  for (let i = 0; i < 18; i++) add(p, `backed-${pad(i)}`, { cls: "commons", stamps: 1 + (i % 3), date: `2026-11-${pad(1 + i)}T10:00:00.000Z`, body: `a commons mark with stamps behind it (${i}). `.repeat(6) });
  for (let i = 0; i < 15; i++) add(p, `home-${pad(i)}`, { cls: "home", stamps: 0, date: `2026-08-${pad(1 + i)}T10:00:00.000Z`, body: `a home parcel (${i}). `.repeat(6) });
  for (let i = 0; i < 15; i++) add(p, `founding-${pad(i)}`, { cls: null, stamps: 0, date: `2026-07-${pad(1 + i)}T10:00:00.000Z`, body: `founding estate (${i}). `.repeat(6) });
  const o = EXPECTED.ordinary.handle;
  add(o, "unstamped", { cls: "commons", stamps: 0, date: "2026-11-01T10:00:00.000Z", body: "an ordinary house's unstamped commons mark" });
  for (let i = 0; i < 7; i++) add(o, `kept-${i}`, { cls: i % 2 ? "home" : "commons", stamps: i % 2 ? 0 : 2, date: `2026-10-${pad(2 + i)}T10:00:00.000Z`, body: `an ordinary house's mark ${i}` });
  return { marks, registry, escrow };
}

/** `stakesFor`'s readers over `world()`: the sweep's own rule from the pinned world clone, as test/doorstep-stakes.test.mjs does. */
export async function readers(over = {}, { prolific } = {}) {
  const VERDICT = await import(pathToFileURL(join(WORLD_CLONE, "tools", "unpublish-verdict.mjs")).href);
  const { marks, registry, escrow } = world({ prolific });
  const present = new Set(Object.values(registry).map((e) => e.path));
  return {
    rule: async () => VERDICT.unpublishVerdict,
    pathAt: async () => (path) => present.has(path),
    world: async () => ({ state: { marks }, ref: "origin/main", sha: "abc" }),
    registry: async () => registry,
    escrow: async () => ({ townSha: HEAD, byMark: escrow, reason: null, ingestedAt: "2026-11-10T00:30:00.000Z" }),
    now: NOW,
    ...over,
  };
}
