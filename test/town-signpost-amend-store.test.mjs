// town-signpost-amend-store.test.mjs — the signpost's one amend, end to end on a real store (POS-606).
//
//   node --import ./test/helpers/sparse-guard.mjs --test --test-concurrency=1 test/town-signpost-amend-store.test.mjs
//
// THE RIG. A real Postgres (test/helpers/embedded-store.mjs) with the whole schema, the office pointed at it the
// way the pen tests point it (kind-door-on-the-pen.test.mjs), and canon read from this tree's world clone, where
// `the-town/how-ideas-enter` stands as it has since S51. The tool's own plan is handed to the office's own amend,
// `journalLeaveMark`: the dry run's preview writes nothing, the gate reads its verdict, and the write is ONE act, as
// the town, carrying the approved words.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";
import { amendPlan, applyGate, MARK, NEW_BODY } from "../tools/town-signpost-amend.mjs";

const CLONE = join(process.cwd(), "world-clone");
const store = await startStore({ db: "town_signpost_amend" });
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN", "W2_GUARDS", "WORLD_CLONE"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
after(async () => {
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  await store.stop();
});
Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), W2_PEN: "mark", W2_GUARDS: "1", WORLD_CLONE: CLONE });

const actsFor = async () => {
  const { default: pg } = await import("pg");
  const c = new pg.Client({ connectionString: store.url("office_api") });
  await c.connect();
  try { return (await c.query("SELECT actor, household, action, object, payload FROM acts WHERE object = $1 ORDER BY id", [MARK])).rows; }
  finally { await c.end(); }
};

test("dry run, the gate, and the write: nothing on the preview, one act as the town", { skip: !existsSync(CLONE) && "no world clone in this tree" }, async () => {
  const { canonForGuards, journalLeaveMark } = await import("../src/world.mjs");
  const { guardedLiveMarks } = await import("../src/world2-guards.mjs");
  const live = () => guardedLiveMarks(null, { actor: "the-town" });

  const plan = amendPlan(canonForGuards().byId.get(MARK) ?? null, await live());
  assert.equal(plan.refusal, undefined, plan.refusal);

  const preview = await journalLeaveMark({ ...plan.clean, preview: true });
  assert.equal(preview.preview, true);
  assert.equal(preview.would, "amend");
  assert.equal(preview.parent, "the-town/the-town-centre", "declared sited, it nests where the record's placementParent already does");
  assert.equal(preview.dir, "the-town/how-ideas-enter", "at the same path");
  assert.deepEqual(await actsFor(), [], "the dry run wrote nothing");
  // this store holds no ground registry, so the town owns no ground here and the preview says the amend would not
  // publish: the tool's --apply refuses on that, writing nothing (the box's own dry run reads the real ground)
  assert.equal(preview.put_forward, false);
  assert.match(applyGate(preview), /private draft and not publish/);

  // the office's write itself, as the tool's apply makes it once the gate passes: one act, as the town
  await journalLeaveMark(plan.clean);
  const acts = await actsFor();
  assert.equal(acts.length, 1, "the apply wrote one act");
  assert.equal(acts[0].actor, "the-town");
  assert.equal(acts[0].household, "solo:the-town", "the record's own declared_household (world-state: solo:the-town)");
  assert.equal(acts[0].payload.body, NEW_BODY);

  // A second --apply refusing on the waiting amend (amendPlan's live check) is pinned in town-signpost-amend.test.mjs.
  // This store files the act but no claim for an unregistered town, so its live layer stays empty; on the box, a
  // second --dry-run after the apply must read REFUSED (the apply's runbook line on POS-606).
});
