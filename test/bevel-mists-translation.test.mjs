// bevel-mists-translation.test.mjs — Bevel's WLD-38 third-review probe (2026-10-13T06:28Z), carried from
// /tmp/bevel-wld38-r3-bb9_d9f8/test/bevel-mists-translation.test.mjs (red at 5852c7f5). The ONE change: the engine is imported from WORLD_CLONE (CI's pinned world)
// instead of Bevel's scratch-exported ../engine copy, and it skips by name without one; the assertions are Bevel's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const ENGINE = process.env.WORLD_CLONE ? join(process.env.WORLD_CLONE, 'tools', 'world-engine.mjs') : null;
const engine = ENGINE && existsSync(ENGINE) ? await import(pathToFileURL(ENGINE).href) : null;
const skip = !engine && 'no WORLD_CLONE (the World engine is read from it)';
import { coverage, footprintState } from '../src/mists-forecast.mjs';

test('Bevel: moving the same nonzero-area footprint cannot turn its interior wall pocket clear', { skip }, () => {
  // The submitted four-clearing pocket, scaled to centimetres, then translated
  // to ordinary map coordinates. Geometry and engine witness stay identical.
  for (const offset of [0, 5000]) {
    const s = 0.008;
    const square = [[-8,-8],[8,-8],[8,8],[-8,8]].map(([x,y]) => ({x:offset+x*s,y:offset+y*s}));
    const mists = {
      border_m:{minX:offset+10,minY:offset+10,maxX:offset+20,maxY:offset+20},
      fringe_m:0,
      clearings_m:[[-10,-10],[10,-10],[10,10],[-10,10]].map(([x,y])=>({x:offset+x*s,y:offset+y*s,r_m:12*s})),
      schedule:[{crossing:300,front_m:0},{crossing:301,front_m:0}],
    };
    const state = engine.mistsAt(300,mists);
    assert.equal(engine.mistsHere({x:offset,y:offset},state).inWall,true);
    assert.equal(coverage(square,state.clear,state.clearings).covered,false,'area solver itself sees the hole');
    assert.equal(footprintState(engine,state,square),'wall',`same 0.128m square at offset${offset} is an area, not a line`);
  }
});
