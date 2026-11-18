// mists-withdrawn-forecast.test.mjs — WLD-147: the Mists are WITHDRAWN, and the forecast reads it.
//
//   WORLD_CLONE=<tree>/world-clone node --import ./test/helpers/sparse-guard.mjs --test test/mists-withdrawn-forecast.test.mjs
//   MISTS_WITHDRAWN_WORLD=<a world tree whose tools/world-engine.mjs knows `withdrawn_from`>   (optional; see below)
//
// LAW (WLD-147; Darko, 2026-11-02 17:06 EST, in chat, RULED: "full removal for mists"): the world's record
// names `withdrawn_from`, "from crossing N there are no Mists at all. mistsAt answers null, so there is no wall,
// no fringe, no veil, no slowed walk and no season line, and every telling is the one it would be with no Mists
// in the record" (postmark-world#355, tools/mists-record.mjs).
//
// THE DEFECT THIS HOLDS. `reachOf` (src/mists-forecast.mjs) walked every crossing from now to the schedule's last
// keyframe and threw `the engine gives no Mists state for crossing N` on the engine's null: with a withdrawn
// record that null is the answer, and every household doorstep with a published mark carried
// `mists-forecast-unavailable` from the moment the world's blessing landed (measured 2026-11-02 over 129 probe
// footprints and 23 clocks, 1829 of 2967 forecasts and every doorstep block).
//
// THE RECORD IS THE WORLD'S OWN: test/fixtures/mists-record-wld147.json is the `mists` block of postmark-world#355
// at its head 16ca9c188 (the writer's output, not a retelling). Every number below is derived from it, so a later
// move of the dial (289, 290, 291) moves nothing here.
//
// THE ENGINE. The office's pinned world predates #355, so its engine does not yet answer null at `withdrawn_from`.
// The same legs therefore run twice:
//   · the CONTRACT DOUBLE: the pinned engine with the one line #355 adds (null from `withdrawn_from`), labelled so;
//   · the REAL ENGINE: whichever of MISTS_WITHDRAWN_WORLD's and the pinned world's engine really answers null
//     there. Until the pin carries #355 and the env names no such tree it SKIPS, saying so in its title (a skip is
//     not a pass), and it checks the double against the real engine when it does run.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { worldClone } from "./fixture-paths.mjs";
import { lastStandingKeyframe } from "./helpers/mists-standing.mjs";
import { forecastMists, householdMistsForecast, reachOf, MISTS_FORECAST_UNAVAILABLE } from "../src/mists-forecast.mjs";
import { crossingSailsAt } from "../src/crossings.mjs";

const RECORD = JSON.parse(readFileSync(new URL("./fixtures/mists-record-wld147.json", import.meta.url), "utf8"));
const W = RECORD.withdrawn_from;
const FIRST = RECORD.schedule[0].crossing;
assert.ok(Number.isInteger(W) && W > FIRST, "the fixture names a withdrawal after the season's first crossing");

// the record as it stood before the withdrawal: no `withdrawn_from`, no keyframe at or after it
const CONTROL = (() => { const c = { ...RECORD, schedule: RECORD.schedule.filter((k) => k.crossing < W) }; delete c.withdrawn_from; return c; })();

const loadEngine = async (root) => {
  const file = root ? join(String(root), "tools", "world-engine.mjs") : null;
  return file && existsSync(file) ? import(pathToFileURL(file).href) : null;
};
const knowsWithdrawal = (eng) => typeof eng?.mistsAt === "function" && !!eng.mistsAt(W - 1, RECORD) && eng.mistsAt(W, RECORD) === null;
const pinned = await loadEngine(worldClone());
const named = await loadEngine(process.env.MISTS_WITHDRAWN_WORLD);
const REAL = [named, pinned].find(knowsWithdrawal) ?? null;
// the one line #355 adds to the engine, over whatever engine is pinned
const withdrawing = (eng) => ({ ...eng, mistsAt: (c, m) => (Number.isFinite(m?.withdrawn_from) && (c | 0) >= m.withdrawn_from ? null : eng.mistsAt(c, m)) });

// ── the probe footprints, derived from the record ───────────────────────────
const B = RECORD.border_m;
const sq = (id, x, y, s = 40) => ({ id, ring: [{ x: x - s / 2, y: y - s / 2 }, { x: x + s / 2, y: y - s / 2 }, { x: x + s / 2, y: y + s / 2 }, { x: x - s / 2, y: y + s / 2 }] });
const midY = (B.minY + B.maxY) / 2;
const FULL = lastStandingKeyframe(RECORD).front_m;
const WALLED = sq("probe/walled", B.maxX - FULL + 120, midY);               // wholly behind the east wall once the front has crept in
const CLEAR = sq("probe/clear", (B.minX + B.maxX) / 2, midY);                // the middle of the town: no Mists ever reach it
const FOOTPRINTS = [WALLED, CLEAR];
const at = (c) => Date.parse(crossingSailsAt(c)) + 1000;                     // one second into crossing c
const dateOf = (c) => crossingSailsAt(c).slice(0, 10);
const forecast = (eng, record, c, footprints = FOOTPRINTS) => forecastMists({ engine: eng, skeleton: { mists: record }, footprints, nowMs: at(c) });
const withoutSeasonEnd = ({ season_ends, ...rest }) => rest;

const deps = (eng, record = RECORD) => ({
  pointed: () => true,
  household: async (h) => ({ residents: [String(h)] }),
  publishedMarks: () => FOOTPRINTS.map((f) => ({ id: f.id, by: "probe" })),
  skeleton: () => ({ mists: record }),
  engine: async () => eng,
  ringOf: async (m) => FOOTPRINTS.find((f) => f.id === m.id).ring,
});

function legs(label, eng, skip) {
  const t = (name, fn) => test(`${label} · ${name}`, { skip }, fn);

  // the oracle for when the wall first takes ground of WALLED: the engine's own mistsHere at its eastmost edge (the
  // first part of it the creeping front passes), crossing by crossing, independent of reachOf's coverage
  const wallAt = () => {
    const east = { x: Math.max(...WALLED.ring.map((p) => p.x)), y: midY };
    for (let c = FIRST; c < W; c += 1) if (eng.mistsHere(east, eng.mistsAt(c, RECORD)).inWall) return c;
    return null;
  };

  t("the premise: the engine answers a state at every crossing before the withdrawal and null from it (the reach is real, not vacuous)", () => {
    for (const c of [FIRST, FIRST + 10, W - 2, W - 1]) assert.ok(eng.mistsAt(c, RECORD), `a state at crossing ${c}`);
    for (const c of [W, W + 1, W + 100]) assert.equal(eng.mistsAt(c, RECORD), null, `no Mists at crossing ${c}`);
    const wall = wallAt();
    assert.ok(Number.isInteger(wall) && wall > FIRST && wall <= W - 1, `the probe's wall arrives within the season (crossing ${wall})`);
    assert.equal(eng.mistsHere({ x: CLEAR.ring[0].x, y: midY }, eng.mistsAt(W - 1, RECORD)).inWall, false, "the middle of the town is clear at the season's fullest");
  });

  t("BEFORE THE WITHDRAWAL the forecast carries no error: the walled mark is reached, the clear one is not, and the season ends at the withdrawal", async () => {
    const wall = wallAt();
    for (const now of [FIRST, wall - 3, wall, W - 2, W - 1]) {
      const f = await forecast(eng, RECORD, now);
      assert.equal(f.unavailable, undefined, `crossing ${now}: no ${MISTS_FORECAST_UNAVAILABLE} (${f.unavailable})`);
      assert.deepEqual(f.reaches.map((r) => r.mark), [WALLED.id], `crossing ${now}: only the walled mark is reached`);
      const reached = f.reaches[0].wall;
      assert.deepEqual([reached.crossing, reached.now, reached.date], [Math.max(now, wall), wall <= now, dateOf(Math.max(now, wall))], `crossing ${now}: the wall's arrival, by the engine's own interpolation`);
      assert.equal(f.season_ends, W, "the season ends at the withdrawal");
      assert.deepEqual(f.as_of, { crossing: now, date: dateOf(now) });
    }
  });

  t("AT AND AFTER THE WITHDRAWAL the forecast is empty and clean: no error, nothing reached, however far on", async () => {
    for (const now of [W, W + 1, W + 100]) {
      const f = await forecast(eng, RECORD, now);
      assert.deepEqual(f, { as_of: { crossing: now, date: dateOf(now) }, season_ends: W, reaches: [] }, `crossing ${now}`);
    }
  });

  t("THE DOORSTEP BLOCK: a house with a mark the wall will reach is told so before the withdrawal, and the block is gone from it (never unavailable) at and after it", async () => {
    const wall = wallAt();
    const before = await householdMistsForecast("probe", { nowMs: at(wall - 3), deps: deps(eng) });
    assert.equal(before.unavailable, undefined, `no error on the doorstep (${before.unavailable})`);
    assert.deepEqual([before.serves, before.args, before.reaches.map((r) => r.mark), before.season_ends], ["world.mists", { handle: "probe" }, [WALLED.id], W]);
    for (const now of [W, W + 1]) assert.equal(await householdMistsForecast("probe", { nowMs: at(now), deps: deps(eng) }), null, `crossing ${now}: nothing to say`);
  });

  t("reachOf, asked directly: the last crossing before the withdrawal answers, the withdrawal's own never throws, and a mark never reached is null at both ends", () => {
    assert.deepEqual(reachOf(eng, RECORD, WALLED.ring, W - 1), { fringe: W - 1, wall: W - 1 }, "already behind the wall, at the season's last crossing");
    assert.deepEqual(reachOf(eng, RECORD, CLEAR.ring, FIRST), { fringe: null, wall: null }, "the middle of the town, asked across the whole season");
    for (const now of [W, W + 7]) assert.deepEqual(reachOf(eng, RECORD, WALLED.ring, now), { fringe: null, wall: null }, `from crossing ${now} there is nothing to reach`);
  });

  t("A WITHDRAWAL AT THE SEASON'S FIRST CROSSING never had a season: empty and clean, not 'the engine gives no state' (the first-crossing check yields to the withdrawal)", async () => {
    const never = { ...RECORD, withdrawn_from: FIRST };
    for (const now of [0, FIRST, W + 5]) {
      const f = await forecast(eng, never, now);
      assert.deepEqual(f, { as_of: { crossing: now, date: dateOf(now) }, season_ends: FIRST, reaches: [] }, `crossing ${now}`);
    }
  });

  t("NOTHING MOVES BEFORE THE WITHDRAWAL: the withdrawn record tells every clock as the record without it does, but for `season_ends`", async () => {
    let reached = 0;
    for (const now of [0, FIRST - 1, FIRST, FIRST + 14, W - 3, W - 2, W - 1]) {
      const f = await forecast(eng, RECORD, now), c = await forecast(eng, CONTROL, now);
      assert.deepEqual(withoutSeasonEnd(f), withoutSeasonEnd(c), `crossing ${now}`);
      assert.equal(c.season_ends, W - 1, "the control's season ends at its last keyframe, as it always did");
      reached += f.reaches.length;
    }
    assert.ok(reached > 0, "the comparison saw reaches (a control that finds nothing compares nothing)");
  });

  t("A WITHDRAWAL BEYOND EVERY CLOCK changes only `season_ends`; one that is not a finite number is no withdrawal at all, as in the engine", async () => {
    for (const now of [0, FIRST + 14, W - 1]) {
      const far = await forecast(eng, { ...CONTROL, withdrawn_from: 100000 }, now), plain = await forecast(eng, CONTROL, now);
      assert.deepEqual(withoutSeasonEnd(far), withoutSeasonEnd(plain), `crossing ${now}`);
      assert.equal(far.season_ends, 100000);
      for (const bad of [null, "289", NaN, undefined]) assert.deepEqual(await forecast(eng, { ...CONTROL, withdrawn_from: bad }, now), plain, `crossing ${now}, withdrawn_from ${String(bad)}`);
    }
  });
}

legs("CONTRACT DOUBLE (the pinned engine, null from `withdrawn_from` as postmark-world#355 makes it)", pinned ? withdrawing(pinned) : null, !pinned && "no WORLD_CLONE with an engine (the pinned world's tools/world-engine.mjs)");

legs("REAL ENGINE (postmark-world#355 and after)", REAL,
  !REAL && "no engine that answers null at `withdrawn_from`: the pinned world's predates WLD-147 (postmark-world#355); set MISTS_WITHDRAWN_WORLD=<a world tree with it>, or move the pin");

test("REAL ENGINE · the contract double is the engine's own contract: it answers null exactly where the real engine does, on the world's record", { skip: !REAL || !pinned ? "no real engine that knows `withdrawn_from` (see the REAL ENGINE legs), or no pinned engine to double" : false }, () => {
  const double = withdrawing(pinned);
  for (const c of [0, FIRST - 1, FIRST, W - 1, W, W + 1, W + 100]) assert.equal(double.mistsAt(c, RECORD) === null, REAL.mistsAt(c, RECORD) === null, `crossing ${c}`);
});
