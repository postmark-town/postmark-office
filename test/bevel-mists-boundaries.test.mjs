// bevel-mists-boundaries.test.mjs — Bevel's WLD-38 FIRST REVIEW probes (2026-10-13T05:53Z), carried from
// /tmp/bevel-wld38-r1-fng299e_/test/bevel-mists-boundaries.test.mjs (red at 9830d697: 5 of 5). The ONE change: the engine is imported from WORLD_CLONE (CI's pinned world)
// instead of Bevel's scratch-exported ../engine/ copy, and the file skips by name without it; the assertions are Bevel's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const ENGINE = process.env.WORLD_CLONE ? join(process.env.WORLD_CLONE, 'tools', 'world-engine.mjs') : null;
const engine = ENGINE && existsSync(ENGINE) ? await import(pathToFileURL(ENGINE).href) : null;
const skip = !engine && 'no WORLD_CLONE (the World engine is read from it)';
import { forecastMists, householdMistsForecast, samplesOf, footprintState } from '../src/mists-forecast.mjs';
import { crossingSailsAt } from '../src/crossings.mjs';
const nowMs = Date.parse(crossingSailsAt(300));
const season = {
  border_m: { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 },
  schedule: [{ crossing: 300, front_m: 0 }, { crossing: 310, front_m: 500 }],
  fringe_m: 100, density: { from: 1, to: 1 }, clearings_m: [],
};
const ring = [{x:710,y:0},{x:720,y:0},{x:720,y:10},{x:710,y:10}];
test('Bevel: malformed border must not become an empty clear forecast', { skip }, async () => {
  const bad = { ...season }; delete bad.border_m;
  const f = await forecastMists({engine,skeleton:{mists:bad},footprints:[{id:'sbx-a/mark',ring}],nowMs});
  assert.match(f.unavailable ?? '', /^mists-forecast-unavailable:/, JSON.stringify(f));
});
test('Bevel: null skeleton means unreadable, not known absent season', { skip }, async () => {
  const f = await forecastMists({engine,skeleton:null,footprints:[{id:'sbx-a/mark',ring}],nowMs});
  assert.match(f.unavailable ?? '', /^mists-forecast-unavailable:/, JSON.stringify(f));
});
const deps = () => ({
  pointed: () => true,
  household: async () => ({residents:['sbx-a','sbx-b']}),
  publishedMarks: () => [{id:'sbx-a/mark',by:'sbx-a'},{id:'sbx-b/mark',by:'sbx-b'}],
  skeleton: () => ({mists:season}), engine: async () => engine,
  ringOf: async () => ring,
});
test('Bevel: registry unavailable is disclosed rather than silently reducing a household to one resident', { skip }, async () => {
  const d=deps();d.household=async()=>null;
  const f=await householdMistsForecast('sbx-a',{nowMs,deps:d});
  assert.match(f?.unavailable ?? '',/^mists-forecast-unavailable:/,JSON.stringify(f));
});
test('Bevel: failed footprint read cannot silently omit an affected household mark', { skip }, async () => {
  const d=deps();d.ringOf=async()=>{throw new Error('synthetic geometry read failed');};
  const f=await householdMistsForecast('sbx-a',{nowMs,deps:d});
  assert.match(f?.unavailable ?? '',/^mists-forecast-unavailable:/,JSON.stringify(f));
});
test('Bevel: a wall slit shorter than the five-metre sample step is still coverage', { skip }, async () => {
  // Circle centred(0,0),radius10 clears the endpoints of a horizontal side.
  // The clear box starts atx10. Points nearx9.5,y1 are outside BOTH; the
  // sample grid only seesx9(in circle),x11(in box), so misses that wall slit.
  const mists={border_m:{minX:10,minY:-100,maxX:100,maxY:100},fringe_m:0,
    clearings_m:[{x:0,y:0,r_m:10}],schedule:[{crossing:300,front_m:0},{crossing:301,front_m:0}]};
  const narrow=[{x:9,y:1},{x:11,y:1},{x:11,y:2},{x:9,y:2}];
  const state=engine.mistsAt(300,mists);
  assert.equal(engine.mistsHere({x:9.99,y:1.5},state).inWall,true,'real engine witness inside the footprint');
  assert.equal(engine.mistsHere({x:9,y:1},state).inWall,false);
  assert.equal(footprintState(engine,state,samplesOf(narrow)),'wall','sub-step crossing must not disappear between samples');
});
