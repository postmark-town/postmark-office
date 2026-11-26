// pos-1221-leave-mark-segments.test.mjs — where a leave-mark's handler spends its time, timed step by step (POS-1221; MEASUREMENT ONLY, POS-1110's stance).
//
// Why (POS-1221, 2026-11-24): a leave-mark act's `handler` held the office's main thread for 38.9 s (18:51:46.8Z on prod, the day's worst stall), and the
// act timing (POS-1110) names no step inside it. The brief: "per-step timing segments inside the leave-mark handler (placement, lints and guards, law_moved,
// the write, and whatever else it does), measurement only, no behaviour change, with a test that the segments appear and the answers are byte-identical".
//
//   1. THE JOURNAL PATH (a real Postgres store, the tree's pinned world clone; test/town-centre-amend.test.mjs's harness): a preview of a resident's amend
//      under a request names its steps (m_live, m_ground, m_escrow, m_nest, m_relations) and answers byte for byte what it answers with no request in
//      scope; a real leave names the witness and the write too (m_witness, m_write) and lands one act, as with no request;
//   2. THE HANDLER (leaveMarkViaOffice, the act's own verb): a preview names m_world, m_forecast and m_disclose, and exactly one road for the write
//      (m_journal, or m_draft to the sketchbook, whichever the office takes), and the answer is byte-identical with and without a request;
//   3. NOTHING WITHOUT A REQUEST: with no request in scope no segment is recorded and nothing else changes (actSpan's own rule, read here on this path).
// test/pos-1110-act-timing.test.mjs's worst-case line test carries these names too: the access line still fits its bound with every segment named.
//
// FLIPS (restore with `git checkout HEAD -- src/world.mjs`):
//   · world.mjs § journalLeaveMark: unwrap `m_nest` (call nestingParent directly)     → 1 reds (m_nest absent)
//   · world.mjs § journalLeaveMark: unwrap `m_write`                                   → 1's real leave reds (m_write absent)
//   · world.mjs § leaveMarkAct: unwrap `m_forecast`                                    → 2 reds
//   node --import ./test/helpers/sparse-guard.mjs --test --test-concurrency=1 test/pos-1221-leave-mark-segments.test.mjs

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";
import { newTiming, runTiming, timingLine } from "../src/read-timing.mjs";

const CLONE = join(process.cwd(), "world-clone");
const TOWN = join(process.cwd(), "town-clone");
const SKIP = (!existsSync(CLONE) || !existsSync(TOWN)) && "no pinned world and town clones in this tree";
const store = await startStore({ db: "pos_1221_segments" });
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN", "W2_GUARDS", "WORLD_CLONE", "WORLD_SINGLE_LOG"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
after(async () => {
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  await store.stop();
});
// THE JOURNAL ROAD, prod's flags (mark-footprint-caps.test.mjs's discipline). With WORLD_SINGLE_LOG unset, test 2's leave took the git
// door, whose draft checkout FETCHES origin into the SHARED world clone (world-branches.mjs § ensureDraftCheckout): in CI that moved
// origin/main from the pin to today's World main, and a file running beside this one (read-workers § 6, POS-1238's CI case) heard
// its voices against a settlement edge that had moved mid-test. Test 2 accepts either road; it now takes the journal.
Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), W2_PEN: "mark", W2_GUARDS: "1", WORLD_CLONE: CLONE, WORLD_SINGLE_LOG: "1" });

const within = async (fn) => { const tm = newTiming(); const out = await runTiming(tm, fn); return { out, seg: timingLine(tm, { door: "mcp-act", status: 200 })?.act?.seg ?? {} }; };
// both runs of one act on one wall clock, so the dates an answer carries match (TEST-DESIGN § Clocks); the segments' clock is performance.now, untouched
const pinned = async (fn) => { const real = Date.now; Date.now = () => Date.UTC(2026, 10, 24, 20, 0, 0); try { return await fn(); } finally { Date.now = real; } };
const sameBytes = (a, b, what) => {
  const [x, y] = [JSON.stringify(a), JSON.stringify(b)];
  const at = [...x].findIndex((c, i) => c !== y[i]);
  assert.equal(y, x, `${what}: the answer changed under a request (first difference at ${at}: ${x.slice(Math.max(0, at - 60), at + 80)} | ${y.slice(Math.max(0, at - 60), at + 80)})`);
};
const actsCount = async () => {
  const { default: pg } = await import("pg");
  const c = new pg.Client({ connectionString: store.url("office_api") });
  await c.connect();
  try { return Number((await c.query("SELECT count(*)::int AS n FROM acts")).rows[0].n); }
  finally { await c.end(); }
};
// a mark of no class (POS-1238): the amends below send kind: "sited" alone, and an amend that drops a class the rig's unread
// class layer cannot place is refused by the door's own rule, which is not what these segments measure
const residentMark = (canon) => canon.marks.find((m) => m.by !== "the-town" && m.kind === "sited" && m.class == null && m.at && String(m.id).startsWith(`${m.by}/`)
  && m.parent_id == null && m.at.x > -300 && m.at.x < 300 && m.at.y > -300 && m.at.y < 300);

test("1 · the journal path: a preview names its steps and answers byte for byte as with no request; a real leave names the witness and the write", { skip: SKIP }, async () => {
  const { canonForGuards, journalLeaveMark } = await import("../src/world.mjs");
  const resident = residentMark(canonForGuards());
  assert.ok(resident, "control: a resident's sited mark near the Centre in canon");
  const amend = () => ({ slug: resident.id.slice(resident.by.length + 1), kind: "sited", at: resident.at, extent: resident.extent, body: `${resident.body ?? ""} (amended)`,
    by: resident.by, household: resident.household, date: new Date(Date.now()).toISOString(), amend: true, preview: true });
  const bare = await pinned(() => journalLeaveMark(amend()));
  assert.equal(bare?.preview, true, `control: the amend previews: ${JSON.stringify(bare).slice(0, 200)}`);
  const timed = await pinned(() => within(() => journalLeaveMark(amend())));
  // LAW (POS-1221): "measurement only, no behaviour change … the answers are byte-identical"
  sameBytes(bare, timed.out, "the amend's preview");
  // LAW (POS-1221): "per-step timing segments inside the leave-mark handler (placement, lints and guards, … the write …)"
  for (const name of ["m_live", "m_ground", "m_escrow", "m_nest", "m_relations"])
    assert.ok(timed.seg[name]?.n >= 1 && Number.isFinite(timed.seg[name].sum_ms), `the preview's step ${name} is timed: ${JSON.stringify(timed.seg)}`);
  assert.equal(timed.seg.m_write, undefined, "a preview writes nothing, so no write is timed");
  // a real leave (a new mark, nothing amended) lands one act and names the witness and the write
  const before = await actsCount();
  const leave = { slug: "pos-1221-a-timed-leave", kind: "sited", at: { x: resident.at.x + 1, y: resident.at.y + 1 }, extent: { w: 1, h: 1 }, body: "A mark left under a request.",
    by: resident.by, household: resident.household, date: new Date().toISOString() };
  const wrote = await within(() => journalLeaveMark(leave));
  assert.ok(wrote.out?.id && !wrote.out.preview, `the leave landed: ${JSON.stringify(wrote.out).slice(0, 200)}`);
  assert.equal(await actsCount(), before + 1, "control: one act was written, as with no request");
  for (const name of ["m_live", "m_nest", "m_relations", "m_witness", "m_write"])
    assert.ok(wrote.seg[name]?.n === 1, `the leave's step ${name} is timed once: ${JSON.stringify(wrote.seg)}`);
});

test("2 · the handler: a preview through the act's own verb names the world, the forecast, the journal and the disclosures, byte-identical", { skip: SKIP }, async () => {
  const { canonForGuards, leaveMarkViaOffice } = await import("../src/world.mjs");
  const resident = residentMark(canonForGuards());
  const key = { household: resident.household ?? `house-${resident.by}`, handles: new Set([resident.by]) };
  const payload = () => ({ handle: resident.by, slug: resident.id.slice(resident.by.length + 1), kind: "sited", at: resident.at, extent: resident.extent,
    body: `${resident.body ?? ""} (amended)`, amend: true, preview: true });
  const run = async () => { try { return await leaveMarkViaOffice(CLONE, payload(), key); } catch (e) { return { thrown: { code: e.code ?? null, defect: e.defect ?? String(e.message) } }; } };
  const bare = await pinned(run);
  const timed = await pinned(() => within(run));
  sameBytes(bare, timed.out, "the handler's preview");
  assert.ok(!bare.thrown, `control: the handler answered rather than refused: ${JSON.stringify(bare).slice(0, 300)}`);
  for (const name of ["m_world", "m_forecast", "m_disclose"])
    assert.ok(timed.seg[name]?.n >= 1, `the handler's step ${name} is timed: ${JSON.stringify(timed.seg)}`);
  // the write's road is the office's own decision (the journal, or a draft to the sketchbook): exactly one of the two is timed, once
  const roads = ["m_journal", "m_draft"].filter((n) => timed.seg[n]);
  assert.equal(roads.length, 1, `exactly one road for the write is timed: ${JSON.stringify(timed.seg)}`);
  assert.equal(timed.seg[roads[0]].n, 1);
  if (roads[0] === "m_journal") assert.ok(timed.seg.m_journal.sum_ms + 0.5 >= (timed.seg.m_nest?.sum_ms ?? 0), "the journal's steps nest inside m_journal");
});

test("3 · with no request in scope, the leave-mark path records nothing and answers as ever", { skip: SKIP }, async () => {
  const { canonForGuards, journalLeaveMark } = await import("../src/world.mjs");
  const { currentTiming } = await import("../src/read-timing.mjs");
  assert.equal(currentTiming(), undefined, "control: no request in scope here");
  const resident = residentMark(canonForGuards());
  const r = await journalLeaveMark({ slug: resident.id.slice(resident.by.length + 1), kind: "sited", at: resident.at, extent: resident.extent, body: "probe",
    by: resident.by, household: resident.household, date: new Date().toISOString(), amend: true, preview: true });
  assert.equal(r?.preview, true);
});
