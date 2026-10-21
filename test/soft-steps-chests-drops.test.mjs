// soft-steps-chests-drops.test.mjs — the keep tick's chests and drops steps reach
// the one alarm route (POS-627, from review-612's POS-612 re-check).
//
//   node --test test/soft-steps-chests-drops.test.mjs
//
// settlements-backfill.mjs --apply runs four soft steps after the settlement
// rows: carried, chests, amends and drops. Each is non-fatal by design (rows
// written stay written, the run exits 0, `settlements` reads ok), so a step
// failing on every tick alarmed nowhere. POS-612 recorded carried and amends as
// their own keep steps; this does the same for chests (WLD-27's first stock)
// and drops (WLD-27 F0's orphaned set-downs).
//
// THE LINES ARE THE STEPS' OWN. Every line below is produced by the real step
// function (stockedOnTick, chestsAfterCarried, stockChests on a store that
// answers the law query, dropsRecoveredOnTick), so a reworded line reds here
// instead of silently reading "refused" on the box.
//
// ONE MAPPING WAS A DECISION, not a reading (Wright 10-14): public world main
// declares no chest class (the candy heist is the private spire fork), so on
// prod the chests step answers "not stocked — the law at S<n> declares no chest
// class" on every tick. That is the honest empty, like "stocked 0": ok, with the
// reason prereq:chest_class kept on the receipt so the dress rehearsal can watch it
// turn into "stocked N" once the class lands. A store
// with no ingested law at all is a broken prerequisite: refused prereq:law, and
// so is "no chest class" while a NEWER blessing's law is not ingested yet (a
// stalled ingest could be hiding the class; review-612 F1).
//
// AND ONE RULING ON DROPS (Wright 10-14, review-612 F2): a guard's designed
// bounce is undecided, asked again: ok. A write the store refused (a raw error,
// or a filed drop whose resolution could not be recorded) fails again every
// tick: it is its own `N failed (…)` segment, read refused write-failed.
//
// THE CAN-FAIL FLIPS: drop `keep_step chests` or `keep_step drops` from
// office-keep.sh; drop either from SOFT_STEPS or from the manifest; read any
// chests or drops line as ok. Each reds a case below.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  softStepStatus, SOFT_STEP_RULES, stockedOnTick, chestsAfterCarried, dropsRecoveredOnTick,
} from "../world2/tools/settlements-backfill.mjs";
import { stockChests } from "../world2/tools/chest-stock.mjs";
import { SOFT_STEPS, STEPS, buildReceipt, appendReceipt, judgeKeep, REASON_RE } from "../deploy/keep-history.mjs";

// WLD-27's doors ship dark by default (src/chests-candy.mjs); these are their own tests, so they run with them open.
process.env.WORLD_CHESTS_CANDY = "1";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A client that answers the law query with `lawRows` and every other query with no rows. */
const lawClient = (lawRows) => ({ query: async (sql) => (/law_projection/.test(sql) ? { rows: lawRows } : { rows: [] }) });
const LAW_ROW = { number: 108, tag_sha: "a".repeat(40), newest: 108, kind: "class", key: "candy", data: {} };

test("chests: the step's own lines, from its own functions, read as ruled", async () => {
  // ok: the stock ran (nothing owed is `stocked 0`)
  const none = await stockedOnTick(lawClient([LAW_ROW, { ...LAW_ROW, key: "chest", data: { dials: {} } }]), { crossing: () => 0 });
  assert.match(none.line, /^chests: stocked 0/);
  assert.equal(softStepStatus(none.line, "chests"), "ok");
  // ok: the law declares no chest class (prod's public world, every tick)
  const noClass = await stockChests(lawClient([LAW_ROW]));
  assert.equal(noClass.line, "chests: not stocked — the law at S108 declares no chest class — nothing to stock");
  assert.equal(softStepStatus(noClass.line, "chests"), "ok prereq:chest_class",
    "the honest empty: ok, and the reason keeps it visible until the class lands (Wright 10-14)");
  const r = buildReceipt({ stepsText: "chests\tok\tprereq:chest_class", source: "scheduled", run: "t", started: "2026-10-14T19:07:00Z", at: "2026-10-14T19:08:00Z", exit: 0 });
  assert.deepEqual(r.steps.chests, { s: "ok", r: "prereq:chest_class" }, "the receipt keeps the reason on an ok step");
  assert.deepEqual(judgeKeep(appendReceipt("", r), { steps: ["chests"], n: 1, staleMinutes: 45, now: Date.parse("2026-10-14T19:09:00Z") }), [],
    "and the roll-call reads it as ok: no alarm");
  // refused prereq:law: no chest class, but a NEWER blessing's law is not
  // ingested yet — the class may be there, so this is a stalled ingest, never
  // the honest empty (review-612 F1)
  const stalled = await stockChests(lawClient([{ ...LAW_ROW, number: 105, newest: 108 }]));
  assert.equal(stalled.line, "chests: not stocked — the law at S105 declares no chest class, and S108's law is not ingested yet — nothing is stocked until it is");
  assert.equal(softStepStatus(stalled.line, "chests"), "refused prereq:law");
  // refused prereq:law: no ingested law at all
  const noLaw = await stockChests(lawClient([]));
  assert.match(noLaw.line, /^chests: not stocked — the store holds no settlement whose law is ingested/);
  assert.equal(softStepStatus(noLaw.line, "chests"), "refused prereq:law");
  // refused prereq:carried: held behind a carried step that did not settle
  const held = await chestsAfterCarried(null, { verdict: "error" });
  assert.match(held.line, /^chests: not stocked this tick — the carried step did not settle/);
  assert.equal(softStepStatus(held.line, "chests"), "refused prereq:carried");
  // refused write-failed: the stock threw
  const threw = await stockedOnTick(null, { stock: async () => { throw new Error("boom"); }, crossing: () => 0 });
  assert.equal(threw.line, "chests: NOT stocked (non-fatal) — boom");
  assert.equal(softStepStatus(threw.line, "chests"), "refused write-failed");
});

/**
 * A store, scripted, for the REAL recoverOrphanDrops: two set-downs older than a
 * tick above a cursor of 0. Act 10's row is gone, so the guard BOUNCES it (a
 * designed `defect`: undecided, asked again). Act 20's undo INSERT is refused
 * by the store as a raw error (`permission denied`) when `rawFails` is set.
 */
function dropsStore({ acts = ["10"], rawFails = false, filed = null, resolutionFails = false } = {}) {
  const at = new Date(Date.now() - 60 * 60e3).toISOString();
  return {
    query: async (sql, params = []) => {
      const q = String(sql);
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(q)) return { rows: [] };
      if (/max\(id\)/.test(q)) return { rows: [{ id: acts.at(-1) }] };
      if (params.length === 5) return { rows: acts.map((id) => ({ id, actor: "keith", at, household: "hh:keith", payload: { label: "lantern" }, undone: null, resolved: null })) };
      if (/INSERT INTO acts/i.test(q)) {
        if (rawFails && String(params[3] ?? "").includes('"undoes"')) throw new Error("permission denied for table acts");
        if (resolutionFails && String(params[3] ?? "").includes('"resolves"')) throw new Error("permission denied for table acts");
        return { rows: [{ id: "99" }] };
      }
      // a filed drop: its claim names it (act:<filed>), so the guard bounces it as FILED
      if (/data->>'dropped'/.test(q)) return { rows: filed && params[0] === `act:${filed}` ? [{ id: "c1", slug: "keith/lantern", status: "pending" }] : [] };
      // the drop's own row: act 10's is gone, so the guard bounces it
      if (params.length === 2 && acts.includes(String(params[0]))) return { rows: String(params[0]) === "10" ? [] : [{ actor: "keith", household: "hh:keith", payload: { label: "lantern" } }] };
      return { rows: [] };
    },
  };
}

test("drops: undecided (a guard's designed bounce) is ok; a write the store refused is its own `failed` segment and refused (Wright 10-14, review-612 F2)", async () => {
  const quiet = await dropsRecoveredOnTick(null, { recover: async () => ({ line: "drops: restored 0" }), crossing: () => 0 });
  assert.equal(softStepStatus(quiet.line, "drops"), "ok");
  // the real recovery, a defect only: undecided, asked again — the design
  const bounced = await dropsRecoveredOnTick(dropsStore({ acts: ["10"] }), { crossing: () => 0 });
  assert.match(bounced.line, /^drops: restored 0 · 1 undecided, asked again next tick \(act 10: act 10 is not a set-down\)$/);
  assert.equal(softStepStatus(bounced.line, "drops"), "ok", "a designed bounce is the step working, not failing");
  // the real recovery, a raw store error beside it: a failure, not a pending decision
  const raw = await dropsRecoveredOnTick(dropsStore({ acts: ["10", "20"], rawFails: true }), { crossing: () => 0 });
  assert.match(raw.line, / · 1 undecided, asked again next tick \(act 10: act 10 is not a set-down\) · 1 failed \(act 20: permission denied for table acts\)$/);
  assert.equal(softStepStatus(raw.line, "drops"), "refused write-failed", "a write that fails every tick must alarm");
  // a filed drop whose resolution the store would not record (every e2): failed too
  const unresolved = await dropsRecoveredOnTick(dropsStore({ acts: ["20"], filed: "20", resolutionFails: true }), { crossing: () => 0 });
  assert.match(unresolved.line, / · 1 failed \(act 20: filed, but its resolution could not be recorded: permission denied for table acts\)$/);
  assert.equal(softStepStatus(unresolved.line, "drops"), "refused write-failed");
  // the whole step throwing is refused too
  const threw = await dropsRecoveredOnTick(null, { recover: async () => { throw new Error("boom"); }, crossing: () => 0 });
  assert.equal(threw.line, "drops: NOT reconciled (non-fatal) — boom");
  assert.equal(softStepStatus(threw.line, "drops"), "refused write-failed");
});

test("every step: no line is notrun, a line nobody wrote a rule for is refused, and every reason is one the receipt keeps", () => {
  for (const step of ["carried", "chests", "amends", "drops", "endings"]) {
    assert.equal(softStepStatus("0 rows written", step), "notrun", step);
    assert.equal(softStepStatus(`${step}: something new`, step), "refused write-failed", step);
  }
  assert.deepEqual(Object.keys(SOFT_STEP_RULES), ["carried", "amends", "chests", "drops", "endings"]);
  const reasons = new Set(Object.values(SOFT_STEP_RULES).flat().map(([, w]) => w.split(" ")[1]).filter(Boolean));
  for (const r of [...reasons, "write-failed"]) assert.match(r, REASON_RE, r);
});

test("office-keep.sh records chests and drops as their own keep steps, from the run's own output", () => {
  const sh = readFileSync(join(OFFICE, "deploy", "office-keep.sh"), "utf8").replace(/\r\n/g, "\n");
  const lines = sh.split("\n");
  for (const step of ["carried", "chests", "amends", "drops", "endings"]) {
    const want = `keep_step ${step} $(printf '%s\\n' "$settled" | node world2/tools/settlements-backfill.mjs --soft-step ${step} 2>/dev/null || echo notrun)`;
    assert.ok(lines.includes(want), `${step}: ${want}`);
    assert.ok(sh.indexOf(want) > sh.indexOf("keep_step settlements ok"), `${step} is read after the run that printed its line`);
  }
});

test("the roll-call alarms on three scheduled ticks whose chests or drops step was refused, though settlements read ok", () => {
  const manifest = JSON.parse(readFileSync(join(OFFICE, "deploy", "box-rollcall-manifest.json"), "utf8"));
  const keepRow = manifest.units.find((r) => r.unit === "postmark-office-keep.timer");
  // the receipt's block: the keep row carries two outcomes since POS-268 5b (outcomes[])
  const keep = { outcome: [keepRow.outcome, ...(keepRow.outcomes ?? [])].find((o) => o?.kind === "keep_steps") };
  for (const step of ["chests", "drops"]) {
    assert.ok(SOFT_STEPS.includes(step), `${step} is a soft step`);
    assert.ok(STEPS.includes(step), `${step} is in the receipt's step list`);
    assert.ok(keep.outcome.steps.includes(step), `the manifest's keep outcome judges ${step}`);
  }
  const T = Date.parse("2026-10-14T19:07:00Z");
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
  for (const [step, reason] of [["chests", "prereq:law"], ["drops", "write-failed"]]) {
    let log = "";
    for (let i = 0; i < 3; i++) {
      const okSteps = SOFT_STEPS.filter((s) => s !== step).map((s) => `${s}\tok\t`).join("\n");
      log = appendReceipt(log, buildReceipt({
        stepsText: `${okSteps}\n${step}\trefused\t${reason}`, source: "scheduled", run: `r${i}`,
        started: iso(T + i * 15 * 60e3), at: iso(T + i * 15 * 60e3 + 60e3), exit: 0 }));
    }
    const alarms = judgeKeep(log, { steps: keep.outcome.steps, n: 3, staleMinutes: 45, now: T + 32 * 60e3 });
    assert.deepEqual(alarms, [`${step} has not been ok on the last 3 scheduled ticks (refused, refused, refused)`], step);
  }
});
