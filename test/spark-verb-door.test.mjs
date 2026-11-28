// spark-verb-door.test.mjs — world { do: "spark" } through the REAL leave-mark door (POS-1222).
//
// test/spark-verb.test.mjs proves the call the verb builds. This file hands that call to the real door (world.mjs §
// leaveMarkViaOffice) on an embedded store, against the pinned world clone's canon (its spark class, its locked radius), so:
//   D1  a preview writes NOTHING: no act, no draft, no stake — the verb's preview is leave-mark's preview
//   D2  BYTE-IDENTICAL: the verb's answer, less its own `spark` block, is exactly what the equivalent hand-written leave-mark
//       answers, field for field (the clock fields aside, which are each call's own instant)
//   D3  put_forward reaches the door's stake: the door's preview answers the staked placement (it would publish) for put_forward: 1,
//       and the draft placement for none
//   D4  a parent never reaches the door, and a spark the World's own rule refuses is refused by the door in the World's words
// Every house, handle and mark here is invented. The law fixture is the spark class and its own properties, as WLD-173 declares
// them (the pinned clone's mark/spark/*): the office reads them through the law snapshot, as on prod.
//   node --import ./test/helpers/sparse-guard.mjs --test --test-concurrency=1 test/spark-verb-door.test.mjs

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";

const CLONE = join(process.cwd(), "world-clone");
const SKIP = !existsSync(join(CLONE, "tools", "spark.mjs")) && "no pinned world clone with the spark class (World #391) in this tree";
const store = await startStore({ db: "spark_verb_door" });
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN", "W2_GUARDS", "WORLD_CLONE", "WORLD_SINGLE_LOG"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
// THE JOURNAL ROAD (prod's flags), as test/mark-footprint-caps.test.mjs runs it: nothing here goes through the git door's exec
Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), W2_PEN: "mark", W2_GUARDS: "1", WORLD_CLONE: CLONE, WORLD_SINGLE_LOG: "1" });
const { reloadLawSnapshot, resetLawSnapshot, LAW_REFRESH_SQLS } = await import("../src/law-snapshot.mjs");
after(async () => {
  resetLawSnapshot();
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  await store.stop();
});

// the spark class and its properties, read off the pinned clone's own property marks (WLD-173: mark/spark/spark-*/mark.md: its
// sovereign parts, its makers and its locked radius), so the fixture is the law as the clone holds it, never a copy kept here
const SHA = "e".repeat(40);
const SPARK_DIR = join(CLONE, "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/mark/spark");
const classRow = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const propRow = (klass, name, dflt, tier, id) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property", key: `${klass}/${name}`,
  data: { class: klass, parent: null, name, tier, default: dflt, id } });
async function sparkProps() {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { pathToFileURL } = await import("node:url");
  const fold = await import(pathToFileURL(join(CLONE, "tools", "marks-fold.mjs")));
  return readdirSync(SPARK_DIR).filter((d) => d.startsWith("spark-")).map((d) => {
    const rec = fold.parseRecord(readFileSync(join(SPARK_DIR, d, "mark.md"), "utf8"), `${d}/mark.md`);
    return propRow("spark", rec.name, rec.default ?? null, rec.tier, `the-town/${d}`);
  });
}
async function sparkLaw() {
  const props = await sparkProps();
  assert.ok(props.some((p) => p.data.name === "recounting") && props.some((p) => p.data.name === "makers"), "the clone's spark class carries its properties");
  const rows = [classRow("mark"), classRow("spark", { extends: "mark" }), ...props];
  await reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === LAW_REFRESH_SQLS.pin ? [{ newest: 300, pinned: 300 }] : rows }) });
  const { resetClassRosterCache } = await import("../src/world-classes.mjs");
  resetClassRosterCache();
}

const actsCount = async () => {
  const { default: pg } = await import("pg");
  const c = new pg.Client({ connectionString: store.url("office_api") });
  await c.connect();
  try { return Number((await c.query("SELECT count(*)::int AS n FROM acts")).rows[0].n) + Number((await c.query("SELECT count(*)::int AS n FROM claims")).rows[0].n); }
  finally { await c.end(); }
};
const KEY = { household: "spark-fixture-house", handles: new Set(["spark-fixture"]) };
// far from every published mark, so no ground question changes between two calls
const HERE = { x: 41000, y: 41000 };
let n = 0;
const fields = (extra = {}) => ({ handle: "spark-fixture", recounting: `A walk by the water, the ${++n}th`, experienced_at: "2026-11-20T10:00:00.000Z", at: HERE, ...extra });
/** The verb, with the office's own readers but the slug lookup and leave-mark real. */
const verb = async (f) => {
  const V = await import("../src/spark-verb.mjs");
  return V.sparkAct(f, KEY, {}, V.OFFICE_READERS);
};
const leave = async (payload) => {
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  return leaveMarkViaOffice(process.env.WORLD_CLONE, payload, KEY);
};
/** An answer with each call's own instants taken out: what is left must agree byte for byte. */
const timeless = (o) => JSON.parse(JSON.stringify(o, (k, v) => (["date", "at_iso", "now", "as_of", "planned_at"].includes(k) ? "<instant>" : v)));

test("D1 · A PREVIEW WRITES NOTHING: the verb's preview is leave-mark's, no act, no draft, no stake", { skip: SKIP }, async () => {
  await sparkLaw();
  const before = await actsCount();
  const out = await verb(fields({ preview: true }));
  assert.equal(out.preview, true, `leave-mark's own preview answered: ${JSON.stringify(out).slice(0, 400)}`);
  assert.equal(out.spark.publish.preview, true);
  const staked = await verb(fields({ preview: true, put_forward: 1 }));
  assert.equal(staked.preview, true);
  assert.equal(await actsCount(), before, "no act and no claim was written by either preview");
});

test("D2 · BYTE-IDENTICAL: the verb's answer, less its spark block, is exactly the equivalent hand-written leave-mark's", { skip: SKIP }, async () => {
  await sparkLaw();
  const f = fields({ preview: true, picture: "https://media.postmark.town/spark-fixture/a.jpg", acts: [101, 102] });
  const { spark: block, ...viaVerb } = await verb(f);
  // the leave-mark a resident would have written by hand, from the verb's own answer of what it called
  const hand = { handle: "spark-fixture", kind: "spark", slug: block.leave_mark.args.slug, body: f.recounting, at: HERE, extent: { w: 120, h: 120 },
    properties: { recounting: f.recounting, experienced_at: f.experienced_at, picture: f.picture, acts: [101, 102] }, preview: true };
  assert.deepEqual(block.leave_mark.args, hand, "the call is the hand-written one");
  const direct = await leave(hand);
  assert.deepEqual(timeless(viaVerb), timeless(direct), "the same door, the same call, the same answer");
});

test("D3 · PUT_FORWARD reaches the door's stake: staked, the preview answers the stake it would take; unstaked, the draft", { skip: SKIP }, async () => {
  await sparkLaw();
  const staked = await verb(fields({ preview: true, put_forward: 1 }));
  const draft = await verb(fields({ preview: true }));
  assert.equal(staked.spark.leave_mark.args.stamps, 1);
  assert.equal("stamps" in draft.spark.leave_mark.args, false);
  // the door's own answer: put_forward is whether this act would put the mark on the docket the next settlement plans from
  assert.equal(staked.put_forward, true, `staked, the door would put it forward: ${JSON.stringify(staked).slice(0, 300)}`);
  assert.equal(staked.stamps?.this_act?.requested, 1, "and the stake it asks the ledger for is the put_forward's");
  // the control: the same call without put_forward is the household's draft, and the door says how to put it forward later
  assert.equal(draft.put_forward, false, "unstaked, the door keeps it a draft");
  assert.equal(draft.stamps, undefined, "no stake was asked for");
  assert.equal(draft.publishing?.to_publish?.do, "stake");
});

test("D4 · a parent never reaches the door; a spark the World's rule refuses is refused in the World's words, and nothing is written", { skip: SKIP }, async () => {
  await sparkLaw();
  const before = await actsCount();
  await assert.rejects(verb(fields({ parent_id: "spark-fixture/elsewhere" })), (e) => e?.code === 422 && /a spark takes no parent_id/.test(e.defect));
  // an experienced_until before its experienced_at: the World's sparkProblems, through the door (the verb adds no check of its own)
  await assert.rejects(verb(fields({ experienced_until: "2026-11-19T10:00:00.000Z" })), (e) => e?.code === 422 && /is before experienced_at/.test(e.defect));
  assert.equal(await actsCount(), before, "nothing was written");
});
