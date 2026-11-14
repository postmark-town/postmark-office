// town-centre-amend.test.mjs — an amend on the Town Centre's ground is judged by that ground's backing (POS-952).
//
// Wright, 2026-11-09 (POS-952): "an amend to a mark on the town's own constitutional ground (the Town Centre) is
// judged by that ground's standing and backing. groundMinimumStake counts the Town Centre, not only the actor's
// parcels, and putForwardVerdict reads the Centre's backing, so POS-606's signpost amend previews publishes: true.
// Add a test that's red on today's code (release/2026-w46.3) and green after. Nothing more."
// And 14:11Z, the cut: "Town Centre only … an amend to a mark on the Town Centre's ground is judged by the Centre's
// standing and backing; nothing else changes. The test that's red on today's code stays; add one that a non-Centre
// town mark is still judged as before." (T5.)
//
// THE ORACLE IS THE REAL ONE: POS-606's own tool plan (tools/town-signpost-amend.mjs § amendPlan) handed to the
// office's own amend, `journalLeaveMark`, as a preview, against this tree's pinned world clone (the Town Centre is
// `sited`, tier constitution, by the-town: not a parcel) and the town clone's ledger (the escrow behind it). On
// release/2026-w46.3 the preview reads `put_forward: false` (Jetto's prod dry run, 11-08: "publishes: false").
//
//   T1  THE REGRESSION: the signpost amend previews put_forward: true, carried by the Centre's backing, reported
//       truthfully (the mark's own escrow stays 0), and the tool's apply gate passes; nothing is written
//   T2  no bypass, on the same real canon: a resident's mark standing on the town's constitutional ground is not
//       carried by it, and a NEW town mark in the Centre (a leave, not an amend) is not put forward by it
//   T3  the verdict's controls: no backing, a ground with nothing behind it, and a leave all decide as before
//   T4  the ground verdict on synthetic grounds (the canon holds no such case): only the Town Centre, the town's own
//       constitution-tier, non-parcel ground the mark stands on, is named; the same ground under another id, a
//       resident, a non-constitution ground, a mark elsewhere, and a town mark nested in a parcel inside it are not
//   T5  TOWN CENTRE ONLY (Wright 14:11Z): a town mark on another constitutional town ground (the Think Tank, which
//       HOLDS escrow, so the control is not vacuous) is judged as before, and a real one amended end to end too
//
//   node --import ./test/helpers/sparse-guard.mjs --test --test-concurrency=1 test/town-centre-amend.test.mjs

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";
import { amendPlan, applyGate, MARK, OLD_BODY, NEW_BODY } from "../tools/town-signpost-amend.mjs";

const CLONE = join(process.cwd(), "world-clone");
const TOWN = join(process.cwd(), "town-clone");
const CENTRE = "the-town/the-town-centre";
const SKIP = (!existsSync(CLONE) || !existsSync(TOWN)) && "no pinned world and town clones in this tree";
const store = await startStore({ db: "town_centre_amend" });
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN", "W2_GUARDS", "WORLD_CLONE"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
after(async () => {
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  await store.stop();
});
Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), W2_PEN: "mark", W2_GUARDS: "1", WORLD_CLONE: CLONE });

const actsCount = async () => {
  const { default: pg } = await import("pg");
  const c = new pg.Client({ connectionString: store.url("office_api") });
  await c.connect();
  try { return Number((await c.query("SELECT count(*)::int AS n FROM acts")).rows[0].n); }
  finally { await c.end(); }
};

test("T1 · THE REGRESSION: POS-606's signpost amend previews put_forward: true, carried by the Town Centre's backing", { skip: SKIP }, async () => {
  const { canonForGuards, journalLeaveMark, amendmentPublishNote } = await import("../src/world.mjs");
  const { guardedLiveMarks } = await import("../src/world2-guards.mjs");
  const { worldStakeRead } = await import("../src/world-stake.mjs");
  const centre = canonForGuards().byId.get(CENTRE);
  assert.deepEqual([centre?.kind, centre?.tier, centre?.by], ["sited", "constitution", "the-town"], "the Centre as served: sited, constitution, the town's; not a parcel");
  const backing = Number((await worldStakeRead({ mark: CENTRE })).escrow);
  assert.ok(backing >= 1, `the Centre has escrow behind it on the town's ledger (77 at the pin): ${backing}`);
  assert.equal(Number((await worldStakeRead({ mark: MARK })).escrow) || 0, 0, "and the signpost itself has none");

  // POS-1031: World #312 put the approved signpost text into canon, so on a World where it has landed the tool's plan is, truthfully, "already amended" and writes nothing; on a World
  // before it, the plan is clean. The test asserts whichever is TRUE of the canon it reads, and then runs the Centre's verdict on a real amendable control: the SAME canon mark
  // (its kind, ground, place, extent and house exactly as canon serves them) carrying the words the tool was approved to replace.
  const real = canonForGuards().byId.get(MARK) ?? null;
  const live = await guardedLiveMarks(null, { actor: "the-town" });
  const truth = amendPlan(real, live);
  if (real?.body === NEW_BODY) assert.deepEqual(truth, { refusal: "already amended: canon carries the approved text; nothing written" }, "canon carries the approved text: the tool refuses, nothing written");
  else assert.equal(truth.refusal, undefined, truth.refusal);
  const plan = amendPlan({ ...real, body: OLD_BODY }, live);
  assert.equal(plan.refusal, undefined, `the amendable control (canon's own mark with the approved-to-replace words) plans an amend: ${plan.refusal}`);
  const before = await actsCount();
  const preview = await journalLeaveMark({ ...plan.clean, preview: true });
  assert.equal(preview.would, "amend");
  assert.equal(preview.parent, CENTRE, "it stands on the Town Centre");
  assert.equal(preview.put_forward, true, "publishes: true (release/2026-w46.3: false)");
  assert.equal(preview._verdict.carried_by, "ground-backing");
  assert.equal(preview._verdict.backed_by, CENTRE);
  assert.equal(preview._verdict.ground_backing, backing, "the Centre's own escrow, as the stake door reads it");
  assert.equal(preview._verdict.escrow_behind, 0, "the mark's own escrow is reported as it is: none");
  assert.equal(preview._verdict.escrow_after, 0, "and nothing is staked");
  assert.equal(preview._ground_min, 1, "the minimum is unchanged: the Centre is no parcel");
  assert.equal(amendmentPublishNote(preview._verdict),
    `✦${backing} stand in escrow behind ${CENTRE}, the town's constitutional ground it stands on — the amendment publishes at the next crossing.`);
  assert.equal(applyGate(preview), null, "the tool's apply gate passes on this preview");
  assert.equal(await actsCount(), before, "the preview wrote nothing");
});

test("T2 · no bypass on the same canon: a resident's mark on the town's constitutional ground is never carried by it, and a NEW town mark in the Centre is not put forward by it", { skip: SKIP }, async () => {
  const { canonForGuards, journalLeaveMark } = await import("../src/world.mjs");
  const canon = canonForGuards();
  // a resident's own mark standing on the town's constitutional ground (the first canon has near the Centre), amended by its author
  const resident = canon.marks.find((m) => m.by !== "the-town" && m.kind === "sited" && m.at && String(m.id).startsWith(`${m.by}/`)
    && m.parent_id == null && m.at.x > -300 && m.at.x < 300 && m.at.y > -300 && m.at.y < 300);
  assert.ok(resident, "a resident's sited mark near the Centre in canon");
  const r = await journalLeaveMark({ slug: resident.id.slice(resident.by.length + 1), kind: "sited", at: resident.at, extent: resident.extent, body: `${resident.body ?? ""} (amended)`,
    by: resident.by, household: resident.household, date: new Date().toISOString(), amend: true, preview: true });
  assert.equal(r?.preview, true, `${resident.id}'s amend previews: ${JSON.stringify(r).slice(0, 300)}`);
  const ground = canon.byId.get(r.parent);
  assert.deepEqual([ground?.by, ground?.tier, ground?.kind === "parcel"], ["the-town", "constitution", false],
    `${resident.id} stands on the town's own constitutional ground (${r.parent})`);
  assert.notEqual(r._verdict?.carried_by, "ground-backing", `${resident.id}: the Centre's backing never carries a resident's amend`);
  assert.equal(r._verdict?.backed_by, undefined);
  // a NEW town mark in the Centre, left (not amended) with no stake: the ground's backing does not put it forward
  const fresh = await journalLeaveMark({ slug: "pos-952-a-new-town-mark", kind: "sited", at: { x: 258, y: -90 }, extent: { w: 2, h: 2 },
    body: "A new town mark.", by: "the-town", household: "the-town", date: new Date().toISOString(), preview: true });
  assert.equal(fresh?.preview, true, `the new town mark previews: ${JSON.stringify(fresh).slice(0, 300)}`);
  assert.equal(fresh.parent, CENTRE);
  assert.equal(fresh.put_forward, false, "a leave is not an amend: nothing carries a new mark but its own stake");
});

test("T4 · the ground verdict on synthetic grounds: only the Town Centre, the town's own constitution-tier ground the mark stands on, is named as backing", { skip: SKIP }, async () => {
  const { __groundMinimumStakeForTest: ground, TOWN_CENTRE } = await import("../src/world.mjs");
  assert.equal(TOWN_CENTRE, CENTRE);
  // the served canon holds no non-constitution town ground and no fit resident case, so these grounds are synthetic,
  // far from any real mark, judged by the real containment engine. The square IS the Centre by id unless told otherwise.
  const square = (over = {}) => ({ id: CENTRE, by: "the-town", household: "the-town", kind: "sited", tier: "constitution",
    at: { x: 10000, y: 10000 }, extent: { w: 100, h: 100 }, points: [[9950, 9950], [10050, 9950], [10050, 10050], [9950, 10050]], ...over });
  const canonOf = (...marks) => ({ marks, byId: new Map(marks.map((m) => [m.id, m])), ids: new Set(marks.map((m) => m.id)) });
  const sign = (by = "the-town") => ({ slug: "a-test-sign", by, kind: "sited", at: { x: 10010, y: 10010 }, extent: { w: 3, h: 2 } });
  const g = await ground(sign(), canonOf(square()));
  assert.equal(g.backing, CENTRE, "the Town Centre it stands on");
  assert.equal((await ground(sign(), canonOf(square({ id: "the-town/a-test-square" })))).backing, undefined,
    "Town Centre only (Wright 14:11Z): the same constitutional town ground under any other id is judged as before");
  assert.equal(g.min, 1, "no parcel: the minimum is unchanged");
  assert.equal(g.ground, null, "and it is not called the actor's ground");
  assert.equal((await ground(sign("moss"), canonOf(square()))).backing, undefined, "a resident's mark there is the commons it always was");
  assert.equal((await ground(sign(), canonOf(square({ tier: "market" })))).backing, undefined, "a town ground that is not constitution-tier is not");
  assert.equal((await ground({ ...sign(), at: { x: 20000, y: 20000 } }, canonOf(square()))).backing, undefined, "a mark standing elsewhere is not");
  // "that ground" is the one it STANDS ON, never a wider one around it: inside a resident's parcel within the square
  const parcel = { id: "moss/a-test-plot", by: "moss", household: "moss", kind: "parcel", tier: "home",
    at: { x: 10010, y: 10010 }, extent: { w: 20, h: 20 }, points: [[10000, 10000], [10020, 10000], [10020, 10020], [10000, 10020]] };
  assert.equal((await ground(sign(), canonOf(square(), parcel))).backing, undefined, "a town mark nested in someone's parcel is not backed by the square around it");
});

test("T5 · TOWN CENTRE ONLY (Wright 14:11Z): a town mark on another constitutional town ground is judged as before, even where that ground HAS escrow", { skip: SKIP }, async () => {
  const { canonForGuards, journalLeaveMark, putForwardVerdict, __groundMinimumStakeForTest: ground } = await import("../src/world.mjs");
  const { worldStakeRead } = await import("../src/world-stake.mjs");
  const canon = canonForGuards();
  // THE THINK TANK: constitution-tier, sited, the town's, not the Centre, and it HOLDS escrow on the pinned ledger, so
  // this control cannot pass for want of backing: the general reading would carry a town amend there, this one must not.
  const TANK = "the-town/the-think-tank";
  const tank = canon.byId.get(TANK);
  assert.deepEqual([tank?.by, tank?.tier, tank?.kind], ["the-town", "constitution", "sited"]);
  const tankEscrow = Number((await worldStakeRead({ mark: TANK })).escrow) || 0;
  assert.ok(tankEscrow >= 1, `the Think Tank holds escrow (✦1 at the pin): ${tankEscrow}`);
  const inTank = { slug: "pos-952-a-probe-in-the-tank", by: "the-town", kind: "sited", at: { ...tank.at }, extent: { w: 2, h: 2 } };
  const here = await journalLeaveMark({ ...inTank, body: "probe", household: "the-town", date: new Date().toISOString(), preview: true });
  assert.equal(here.parent, TANK, "a town mark at that spot stands on the Think Tank (the preview's own nesting answer)");
  const g = await ground(inTank, canon);
  assert.equal(g.backing, undefined, "the Think Tank is not named as backing: only the Centre is");
  assert.equal(g.min, 1);
  // the verdict the amend chain forms from that answer, the tank's escrow notwithstanding: a draft, as before
  const v = putForwardVerdict({ amending: true, escrowBehind: 0, groundMin: g.min, backedBy: g.backing ?? null, groundBacking: g.backing ? tankEscrow : 0 });
  assert.equal(v.put_forward, false, "judged as before: the mark's own escrow, of which it has none");
  // and END TO END on a real town mark standing on another constitutional ground (the Keeping Works, unbacked):
  // the amend preview carries nothing from its ground
  let probed = null;
  for (const m of canon.marks.filter((x) => x.by === "the-town" && x.kind === "sited" && x.at && x.id !== CENTRE).slice(0, 60)) {
    const r = await journalLeaveMark({ slug: m.id.slice("the-town/".length), kind: "sited", at: m.at, extent: m.extent, points: m.points,
      body: `${m.body ?? ""} (amended)`, by: "the-town", household: "the-town", date: new Date().toISOString(), amend: true, preview: true });
    const p = canon.byId.get(r?.parent);
    if (r?.preview && r.parent !== CENTRE && p?.by === "the-town" && p?.tier === "constitution") { probed = { m, r }; break; }
  }
  assert.ok(probed, "a real town mark standing on a constitutional town ground other than the Centre");
  assert.notEqual(probed.r._verdict?.carried_by, "ground-backing", `${probed.m.id} on ${probed.r.parent}: not carried by its ground`);
  assert.equal(probed.r._verdict?.backed_by, undefined);
});

test("T3 · the verdict's controls: no backing, a backing of nothing, a leave, and a stake decide exactly as before", async () => {
  const { putForwardVerdict, amendmentPublishNote } = await import("../src/world.mjs");
  const base = { amending: true, escrowBehind: 0, groundMin: 1 };
  assert.equal(putForwardVerdict(base).put_forward, false, "commons, nothing behind it: a draft, as before");
  assert.equal(putForwardVerdict({ ...base, backedBy: CENTRE, groundBacking: 0 }).put_forward, false, "a ground with nothing behind it carries nothing");
  assert.equal(putForwardVerdict({ ...base, groundBacking: 77 }).put_forward, false, "a backing with no named ground is not read");
  assert.equal(putForwardVerdict({ ...base, amending: false, backedBy: CENTRE, groundBacking: 77 }).put_forward, false, "a leave is not an amend");
  const carried = putForwardVerdict({ ...base, backedBy: CENTRE, groundBacking: 77 });
  assert.deepEqual([carried.put_forward, carried.carried_by, carried.backed_by, carried.ground_backing, carried.escrow_behind], [true, "ground-backing", CENTRE, 77, 0]);
  // the mark's own escrow still carries itself, named as before
  const own = putForwardVerdict({ ...base, escrowBehind: 2, backedBy: CENTRE, groundBacking: 77 });
  assert.deepEqual([own.carried_by, own.backed_by], ["standing-escrow", undefined]);
  assert.match(amendmentPublishNote(own), /^✦2 already stand in escrow behind it/);
  // a stake that clears the ground is the stake's, as before
  assert.equal(putForwardVerdict({ ...base, staking: true, stamps: 1, backedBy: CENTRE, groundBacking: 77 }).carried_by, "stake");
});
