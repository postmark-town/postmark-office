// bevel-exit-boundaries.test.mjs — WLD-27 first review (Bevel, 2026-10-13): the four
// boundary probes Bevel wrote against office 01abca91, where they were 0/4. Copied
// verbatim below this header as the regression the review asked for ("copy/regress
// in your lane"). The stock probes became real-SQL tests in chest-stock.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callUnits, classViewOf, residentHolds, chestsRead } from '../src/world-units.mjs';
import { UNIT_ACTION, foldUnits, totalOf } from '../src/world-stacks.mjs';

// WLD-27's doors ship dark by default (src/chests-candy.mjs); these are their own tests, so they run with them open.
process.env.WORLD_CHESTS_CANDY = "1";

// Independent synthetic collaborator harness; no live pen, database, ledger,
// resident record or production configuration is invoked.
const label = 'review-comets';
const actor = 'review-taker';
const markId = 'review-author/dropped-comet';
const key = { handles: new Set([actor]) };
const classes = new Map(Object.entries({
  thing: { extends: 'mark', dials: { carry_cap: 24 } },
  consumable: { extends: 'thing', dials: {} },
  candy: { extends: 'consumable', dials: {}, labels: [{ label, name: 'Review Comets', creator: 'review-author' }] },
  chest: { extends: 'thing', dials: { capacity: 30, capacity_min: 1, capacity_max: 120, portable: true, welcome: 'open' } },
}));
function fixture(initialCount = 0) {
  const acts = initialCount ? [{ id: 1, class: 'holding', action: UNIT_ACTION.stock,
    payload: { units: true, moves: [{ from: null, to: actor, label, n: initialCount }] } }] : [];
  const positions = [{ handle: 'review-author', stamps: 1 }, { handle: 'review-staker', stamps: 2 }];
  const returns = [];
  let withdrawals = 0;
  const deps = {
    classes: () => classViewOf({ classes }),
    readRows: async () => ({ units: acts.slice(), attachments: [] }),
    markById: async () => ({ id: markId, by: 'review-author', class: 'candy', kind: 'sited', label, dropped: 'act:41' }),
    reachTake: async () => ({}),
    standpoint: async () => ({ x: 3, y: 4 }),
    householdOf: h => ({ key: `hh:${h}` }),
    household: () => `hh:${actor}`,
    stamp: async () => ({ at: {}, witnesses: [] }),
    crossing: () => 250,
    append: async entry => {
      const id = acts.length + 10;
      acts.push({ id, class: entry.cls, action: entry.action, object: entry.object, payload: entry.payload });
      return { actId: id };
    },
    holders: async () => positions.filter(p => p.stamps > 0),
    unstake: async p => {
      const position = positions.find(x => x.handle === p.handle);
      const n = Math.min(position.stamps, p.stamps);
      position.stamps -= n;
      returns.push({ handle: p.handle, stamps: n });
      return { applied: n };
    },
    markTurn: (id, fn) => fn(), // WLD-27 A: the exit's settled holder reads; no ledger process in this fixture
    withdraw: async () => {
      withdrawals++;
      if (withdrawals === 1) throw new Error('synthetic pen unavailable');
      return { withdrawn: true };
    },
  };
  return { deps, acts, returns, withdrawals: () => withdrawals };
}

test('a cap-refused take-back must not first return other stakers backing', async () => {
  const f = fixture(24);
  await assert.rejects(callUnits('take-back', { thing: markId }, key, actor, f.deps), /24 of 24/);
  assert.equal(totalOf(foldUnits(f.acts), actor), 24);
  assert.equal(f.returns.length, 0, 'refused act must not mutate the synthetic stake positions');
});

test('retry after a failed withdrawal must finish retiring the public dropped mark', async () => {
  const f = fixture();
  const first = await callUnits('take-back', { thing: markId }, key, actor, f.deps);
  assert.equal(first.withdrawn.withdrawn, false);
  const retry = await callUnits('take-back', { thing: markId }, key, actor, f.deps);
  assert.equal(totalOf(foldUnits(f.acts), actor), 1, 'retry does not mint a second unit');
  assert.equal(f.returns.length, 2, 'returns remain once');
  assert.equal(f.withdrawals(), 2, 'retry must reattempt the failed mark withdrawal');
  assert.equal(retry.withdrawn?.withdrawn, true);
});

test('a failed drop cannot restore a 25th carried unit after the freed slot was used', async () => {
  const f = fixture(24);
  const source = 'review-author/source-chest';
  const originalMarkRead = f.deps.markById;
  f.deps.markById = async id => id === source
    ? { id: source, by: 'review-author', class: 'chest' }
    : originalMarkRead(id);
  f.acts.push({ id: 2, class: 'holding', action: UNIT_ACTION.stock,
    payload: { units: true, moves: [{ from: null, to: source, label, n: 1 }] } });
  f.deps.leave = async () => {
    // A second hold uses the slot freed by drop while mark filing is awaited.
    await callUnits('take', { from: source, label }, key, actor, f.deps);
    throw new Error('synthetic mark filing refused');
  };
  await assert.rejects(callUnits('drop', { label }, key, actor, f.deps), e =>
    e.code === 409 && /back in your hands/.test(e.hint));
  assert.equal(totalOf(foldUnits(f.acts), actor), 24, 'compensation must not leave 25 units held');
});

test('a carried chest hidden from the map must appear on its actual holder card', async () => {
  const chest = 'review-author/portable-bag';
  const units = [{ id: 1, class: 'holding', action: UNIT_ACTION.stock,
    payload: { units: true, moves: [{ from: null, to: chest, label, n: 30 }] } }];
  const deps = {
    classes: () => classViewOf({ classes }),
    units: async () => units,
    attachments: async () => [{ entity: actor, target: chest, policy: 'cascade' }],
    marks: async () => [{ id: chest, by: 'review-author', class: 'chest', portable: true }],
  };
  const map = await chestsRead(deps);
  assert.equal(map.chests[0].held_by, actor, 'map read knows which resident carries it');
  const card = await residentHolds(actor, deps);
  assert.ok(card.chests.some(c => c.chest === chest), 'actual holder must receive the carried chest row');
});
