// month-close.test.mjs — the monthly close's plan: calendar, order, exclusions, refusals, Starforge, fingerprint (POS-851).
//
//   node --import ./test/helpers/sparse-guard.mjs --import ./test/helpers/town-pins-env.mjs --test test/month-close.test.mjs
//
// The apply (the landing, the failpoints, the stop) is test/month-close-apply.test.mjs.
//
// THE RULING (Darko, 2026-11-13 08:4x EST, on POS-851): "accept." Accepted as Rivet packeted it on 11-01: "fixed order
// darko-fund → keeping-ec2 → meeps-fund, one commit per pot, stop at the first failure, Starforge's amounts by hand, an
// empty pot is an error." The ask (2026-11-01 10:41 EST): "let's for now make it a command that we can run manually".
// Starforge (ECONOMY-DIALS § _starforge_gives, 10:36 EST): "track the number of stamps that we should provisionally have
// minted for ourselves, but not actually mint them yet".
//
// The scratch town (test/helpers/month-close-town.mjs) is order-sensitive on purpose: ana's holo from keeping-ec2 uses
// part of the room her cap leaves for meeps-fund. Synthetic handles, pots and dollars throughout.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { NO_TOWN, townClone } from "./fixture-paths.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { makeTown, provisionalFile, git, MONTH, CLOSE_DATE, NOW } from "./helpers/month-close-town.mjs";
import { engineOf, syncStampLinesVia } from "../src/stamp-lines.mjs";
import { readPins } from "../src/town-tool.mjs";
import {
  MONTH_CLOSE_ORDER, whenRefusals, etDate, readTown, derivePlan, fingerprintOf, planMonthClose, renderPlan, checkAttestations, readProvisional, withEntry,
} from "../src/month-close.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOWN = townClone();
const skip = NO_TOWN && !TOWN ? "no town clone here" : false;
const tmp = tempDir("month-close-");

let store, office, owner;
before(async () => {
  if (skip) return;
  store = await startStore({ db: "month_close_plan" });
  office = await store.connect("office_api");
  owner = await store.connect("world2_owner");
  Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), STAMP_LINES: "store", TOWN_PUSH: "1", BOT_NAME: "postmark-office[bot]", BOT_EMAIL: "office@postmark.invalid" });
});
after(async () => {
  for (const c of [office, owner]) if (c) await c.end().catch(() => {});
  if (store?.stop) await store.stop();
  rmSync(tmp, { recursive: true, force: true });
});

/** A town, its ledger recorded in the store: the store equals the export, as on a healthy box. */
async function freshTown(opts = {}) {
  const t = await makeTown({ tmp, townSource: TOWN, ...opts });
  await owner.query("DELETE FROM stamp_lines");
  t.engine = await engineOf(t.dir);
  await office.query("BEGIN"); await syncStampLinesVia(office, t.dir, { engine: t.engine }); await office.query("COMMIT");
  return t;
}
const plan = (t, over = {}) => planMonthClose({ clone: t.dir, month: MONTH, date: CLOSE_DATE, now: NOW, ...over });
const codes = (r) => r.refusals.map((x) => x.code);
const pure = (t, attested = []) => derivePlan({ engine: t.engine, town: readTown(t.dir, t.engine), month: MONTH, date: CLOSE_DATE, attested });
const byPot = (d, pot) => d.pots.find((p) => p.pot === pot);
const holoOf = (p, handle) => Number(p.lines.map((l) => new RegExp(`· holo · ${handle} · (\\d+) ·`).exec(l)?.[1]).find(Boolean));

// ── the calendar: America/New_York, said out loud ───────────────────────────

test("the calendar: a real month that has ended on the New York clock, a real day on or after the first of the next month, not in the future, not before the ledger's tail", () => {
  const at = (iso, month, date, tailDate = null) => whenRefusals({ month, date, now: new Date(iso), tailDate }).map((r) => r.code);
  assert.deepEqual(at("2026-11-02T16:00:00Z", "2026-10", "2026-11-02"), [], "an ended month, today: clean");
  for (const bad of ["2026-13", "2026-00", "2026-1", "2026-10-01", "", null, "October"]) assert.deepEqual(at("2026-11-02T16:00:00Z", bad, "2026-11-02"), ["invalid-month"], String(bad));
  for (const bad of ["2026-02-30", "2026-11-31", "2026-11-2", "20261102", null]) assert.deepEqual(at("2026-11-02T16:00:00Z", "2026-10", bad), ["invalid-date"], String(bad));
  assert.deepEqual(at("2026-11-02T16:00:00Z", "2026-11", "2026-11-02"), ["month-not-ended", "date-inside-epoch"], "the current month is unended, and a date inside it is inconsistent");
  assert.deepEqual(at("2026-11-02T16:00:00Z", "2026-10", "2026-10-31"), ["date-inside-epoch"], "a date inside the epoch");
  assert.deepEqual(at("2026-11-02T16:00:00Z", "2026-10", "2026-11-03"), ["date-in-future"], "a date after today");
  assert.deepEqual(at("2026-11-02T16:00:00Z", "2026-10", "2026-11-02", "2026-11-03"), ["date-before-tail"], "the ledger is append-only and forward-dated");
  assert.deepEqual(at("2026-12-05T16:00:00Z", "2026-10", "2026-11-30"), [], "a late close, dated in the month after: allowed");
});

test("the calendar is New York's, across the clocks going back (1 November 2026, 06:00 UTC is when EDT ends): UTC is not the answer", () => {
  const ended = (iso) => whenRefusals({ month: "2026-10", date: "2026-11-01", now: new Date(iso) }).map((r) => r.code);
  assert.deepEqual(ended("2026-11-01T01:00:00Z"), ["month-not-ended", "date-in-future"], "21:00 on 31 October in New York is still October (a UTC reading says 1 November)");
  assert.deepEqual(ended("2026-11-01T03:59:59Z"), ["month-not-ended", "date-in-future"], "23:59:59 on 31 October, one second before");
  assert.deepEqual(ended("2026-11-01T04:00:00Z"), [], "00:00 EDT on 1 November: the month has ended");
  assert.equal(etDate(new Date("2026-11-01T04:30:00Z")), "2026-11-01");
  assert.equal(etDate(new Date("2026-11-01T05:30:00Z")), "2026-11-01", "00:30 EDT, still the first (and 01:30 EST is the repeated hour)");
  assert.equal(etDate(new Date("2026-03-08T06:59:00Z")), "2026-03-08", "01:59 EST, the night the clocks go forward");
  // the scheduled run's own instant, 00:00 on the 2nd (ET): the 2nd, whichever side of the change the 1st fell
  assert.equal(etDate(new Date("2026-11-02T05:00:00Z")), "2026-11-02");
  assert.equal(etDate(new Date("2026-12-02T05:00:00Z")), "2026-12-02");
  assert.equal(etDate(new Date("2026-07-02T04:00:00Z")), "2026-07-02", "in summer, 04:00Z");
});

// ── the planner: the reviewed order, over an in-memory prefix ────────────────

test("THE ORDER: darko-fund → keeping-ec2 → meeps-fund, each derived on the prefix the earlier closes made; an independent preview of meeps-fund on today's ledger is a different number", { skip }, async () => {
  const t = await freshTown();
  const d = pure(t);
  assert.deepEqual(d.pots.filter((p) => p.status === "selected").map((p) => p.pot), [...MONTH_CLOSE_ORDER], "the three, in the reviewed order, whatever order the files sort in");
  assert.deepEqual(d.refusals, []);
  // the control: the fixture CAN express the failure. ec2 gave ana 10 holo; that raises her all-sources base by 10 and her holdings by 10, so the room under floor(0.5 × base) − held is 5, not 10
  const town = readTown(t.dir, t.engine);
  const meta = (id) => JSON.parse(readFileSync(join(t.dir, "WHITE_PAGES", `pot-${id}.json`), "utf8"));
  const alone = t.engine.deriveEpochClose({ entries: town.entries, households: town.households, pot: "meeps-fund", potMeta: meta("meeps-fund"), epoch: MONTH, date: CLOSE_DATE, dial: town.dial });
  assert.equal(alone.ok, true);
  const aloneHolo = alone.rows.find((r) => r.kind === "holo" && r.handle === "ana").n;
  assert.equal(aloneHolo, 10, "on today's ledger ana's room is the full 10");
  assert.equal(holoOf(byPot(d, "meeps-fund"), "ana"), 5, "after ec2's close it is 5: the planner's number (LAW: deriveEpochClose § THE CAP, \"each close raises the ceiling the NEXT close measures against\")");
  assert.notEqual(aloneHolo, holoOf(byPot(d, "meeps-fund"), "ana"), "so a loop of independent previews gives the wrong rows");
  // and the plan's rows are what the engine derives after the earlier rows are appended (the same law, by hand)
  const prefix = [...town.entries.map((e) => ({ canonical: e.canonical }))];
  for (const pot of MONTH_CLOSE_ORDER) {
    const r = t.engine.deriveEpochClose({ entries: prefix, households: town.households, pot, potMeta: meta(pot), epoch: MONTH, date: CLOSE_DATE, dial: town.dial });
    assert.deepEqual(byPot(d, pot).lines, r.rows.map(t.engine.keepingLine), pot);
    for (const row of r.rows) prefix.push({ canonical: t.engine.keepingLine(row) });
  }
  // the prefix chain: each pot's before is the previous pot's after
  const sel = d.pots.filter((p) => p.status === "selected");
  assert.deepEqual(sel.map((p) => [p.ledger_before, p.ledger_after]), [[13, 15], [15, 17], [17, 20]]);
  assert.equal(sel[1].tail_seal_before, sel[0].tail_seal_after, "seal chained");
});

test("a receipt dated after the month ends is in the roll the town's close takes whole: the plan says so, in a note, and does not window or refuse", { skip }, async () => {
  const t = await freshTown({ ledger: (M, { gift, stake, receipt }) => [M.rulesLine("2026-06-12"), gift("ana", 20), gift("bo", 100), gift("cy", 100), gift("dee", 10), gift("wright", 100),
    stake("cy", "darko-fund", 12), stake("bo", "keeping-ec2", 40), stake("bo", "meeps-fund", 40),
    receipt("darko-fund", "dee", 20, "t-dee-1"), receipt("keeping-ec2", "ana", 150, "t-ana-ec2"), receipt("meeps-fund", "ana", 200, "t-ana-meeps"),
    M.potReceiptLine({ date: "2026-11-01", pot: "keeping-ec2", rail: "stripe", usd: 3, from: "dee", ref: "t-first-of-november" })] });
  const d = pure(t);
  assert.deepEqual(d.refusals, []);
  assert.deepEqual(byPot(d, "keeping-ec2").late_receipts, [{ date: "2026-11-01", usd: 3, from: "dee", ref: "t-first-of-november" }]);
  assert.equal(byPot(d, "keeping-ec2").report.receipts, 2, "the town's law counts it: the roll is whole, windowed by nothing");
  assert.equal(byPot(d, "darko-fund").late_receipts, undefined);
  const text = renderPlan({ ok: true, refusals: [], plan: { month: MONTH, date: CLOSE_DATE, tz: "America/New_York", order: [...MONTH_CLOSE_ORDER], town_commit: "0".repeat(40), ledger: { lines_before: 1, lines_after: 1 }, pots: d.pots }, fingerprint: "f" });
  assert.ok(text.includes("NOTE: 1 unsettled receipt(s) dated on or after 2026-11-01 (2026-11-01 $3 t-first-of-november)"), text);
});

test("not this command's: a once pot, a draft pot and the reserved treasury; an open monthly pot outside the reviewed order refuses, and is never closed in file order", { skip }, async () => {
  const t = await freshTown();
  const d = pure(t);
  assert.deepEqual(d.pots.filter((p) => p.status === "skipped").map((p) => [p.pot, p.code]).sort(), [["meeps-home", "once"], ["next-thing", "not-open"]], "the once pot and the draft pot are skipped, by name and reason, never closed");
  assert.ok(!d.pots.some((p) => p.pot === "treasury"), "the reserved treasury is not a pot this command knows");
  writeFileSync(join(t.dir, "WHITE_PAGES", "pot-aaa-late.json"), JSON.stringify({ pot: "aaa-late", status: "open", beneficiary: "keeper", epoch_cadence: "monthly", target_usd_per_epoch: 10 }));
  const late = pure(t);
  assert.deepEqual(late.refusals.map((r) => [r.code, r.pot]), [["unordered-pot", "aaa-late"]], "unknown eligible pots are reported, not appended");
  assert.deepEqual(late.pots.filter((p) => p.status === "selected").map((p) => p.pot), [...MONTH_CLOSE_ORDER], "and the three are still planned in order (the refusal is the plan's, not a re-ordering)");
  writeFileSync(join(t.dir, "WHITE_PAGES", "pot-aaa-late.json"), JSON.stringify({ pot: "aaa-late", status: "open", beneficiary: "keeper", epoch_cadence: "weekly", target_usd_per_epoch: 10 }));
  assert.deepEqual(pure(t).refusals.map((r) => r.code), ["unordered-pot"], "an open pot of a cadence this command does not know is refused too");
  writeFileSync(join(t.dir, "WHITE_PAGES", "pot-aaa-late.json"), "{not json");
  assert.deepEqual(pure(t).refusals.map((r) => r.code), ["unreadable-pot"]);
});

// THE RULING (Darko, 2026-11-18 16:5x EST, on #1139): an empty or below-floor pot is SKIPPED WITH A NOTE, and the other pots still close.
test("an empty pot in the middle is skipped with a note and the other two close, on the prefix the first one made; Starforge attesting it blocks (no entry for a pot no close settles)", { skip }, async () => {
  const t = await freshTown({ ledger: (M, { gift, stake, receipt }) => [M.rulesLine("2026-06-12"), gift("ana", 20), gift("bo", 100), gift("cy", 100), gift("dee", 10), gift("wright", 100),
    stake("cy", "darko-fund", 12), stake("bo", "meeps-fund", 40), receipt("darko-fund", "dee", 20, "t-dee-1"), receipt("meeps-fund", "ana", 200, "t-ana-meeps")] });
  const d = pure(t);
  assert.deepEqual(d.refusals, [], "the month is not refused");
  assert.deepEqual(d.pots.filter((p) => p.order).map((p) => [p.pot, p.status, p.code ?? null]), [["darko-fund", "selected", null], ["keeping-ec2", "skipped", "empty"], ["meeps-fund", "selected", null]]);
  assert.match(byPot(d, "keeping-ec2").reason, /nothing to close this month: .*no open stakes, no unsettled receipts/, "a plain reason in the plan");
  assert.equal(byPot(d, "meeps-fund").ledger_before, byPot(d, "darko-fund").ledger_after, "the skipped pot adds nothing to the prefix: meeps-fund is derived on darko-fund's");
  assert.match(renderPlan({ ok: true, refusals: [], plan: { month: MONTH, date: CLOSE_DATE, tz: "America/New_York", order: [...MONTH_CLOSE_ORDER], town_commit: "0".repeat(40), ledger: { lines_before: 1, lines_after: 1 }, pots: d.pots }, fingerprint: "f" }), /\[SKIPPED\] keeping-ec2 \(#2\) — nothing to close this month/);
  assert.deepEqual(pure(t, [{ pot: "keeping-ec2", usd: 40, ref: "inv-1" }]).refusals.map((r) => r.code), ["attested-empty-pot"]);
  // the skip is in the fingerprint: a receipt arriving for the empty pot changes it
  const fp = () => { const town = readTown(t.dir, t.engine); const x = derivePlan({ engine: t.engine, town, month: MONTH, date: CLOSE_DATE, attested: [] }); return fingerprintOf({ month: MONTH, date: CLOSE_DATE, town, plan: { pots: x.pots }, attested: [], townCommit: readPins().town_commit, engineSeals: x.seals }); };
  const a = fp();
  t.M.appendSigned(t.dir, [t.M.potReceiptLine({ date: "2026-10-20", pot: "keeping-ec2", rail: "stripe", usd: 150, from: "ana", ref: "t-ec2-late" })], t.pem);
  assert.notEqual(fp(), a);
  assert.equal(byPot(pure(t), "keeping-ec2").status, "selected", "and with a receipt it closes");
});

test("every reviewed pot empty is a plan with NOTHING TO APPLY, said plainly, not an error", { skip }, async () => {
  const t = await freshTown({ ledger: (M, { gift }) => [M.rulesLine("2026-06-12"), gift("ana", 20)] });
  const d = pure(t);
  assert.deepEqual(d.refusals, []);
  assert.deepEqual(d.pots.filter((p) => p.order).map((p) => [p.pot, p.status, p.code]), [["darko-fund", "skipped", "empty"], ["keeping-ec2", "skipped", "empty"], ["meeps-fund", "skipped", "empty"]]);
  const r = await plan(t);
  assert.equal(r.ok, true, JSON.stringify(r.refusals));
  assert.match(r.fingerprint, /^[0-9a-f]{64}$/);
  assert.match(renderPlan(r), /NOTHING TO APPLY: .* This is a plan, not an error\./);
});

test("an elastic pot below its floor, and a pot with no stakes and no receipts, are skipped; any OTHER refusal of the town's engine (a pot with no beneficiary) still blocks", { skip }, async () => {
  const t = await freshTown({ ledger: (M, { gift, stake, receipt }) => [M.rulesLine("2026-06-12"), gift("ana", 20), gift("bo", 100), gift("dee", 10),
    stake("bo", "keeping-ec2", 40), receipt("keeping-ec2", "ana", 150, "t-1"), receipt("darko-fund", "dee", 3, "t-2")] });
  const d = pure(t);
  assert.match(byPot(d, "meeps-fund").reason, /nothing to close/, "no stakes and no receipts: the engine's own words");
  assert.match(byPot(d, "darko-fund").reason, /rolled \$3 of the \$5 its close needs/, "the elastic floor");
  assert.deepEqual(d.pots.filter((p) => p.order).map((p) => p.status), ["skipped", "selected", "skipped"]);
  assert.deepEqual(d.refusals, []);
  const noBen = await freshTown({ pots: { "keeping-ec2": { pot: "keeping-ec2", status: "open", epoch_cadence: "monthly", target_usd_per_epoch: 150 } } });
  assert.deepEqual(pure(noBen).refusals.map((r) => r.code), ["close-refused"], "a pot that cannot close for a reason other than being empty still stops the month");
});

test("a month nothing closes in is an error, never a quiet success: none of the reviewed pots exists", { skip }, async () => {
  const t = await freshTown({ pots: { "meeps-home": { pot: "meeps-home", status: "open", beneficiary: "keeper", target_usd_per_epoch: 859, epoch_cadence: "once", closes_at_fill: true } } });
  assert.deepEqual(codes({ refusals: pure(t).refusals }), ["nothing-to-close"]);
});

// ── Starforge: provisional, never a receipt, never in the real rows ─────────

test("STARFORGE: the real close is derived WITHOUT its dollars, byte for byte; the counterfactual is a separate typed result and only its credit is kept", { skip }, async () => {
  const t = await freshTown();
  const att = [{ pot: "keeping-ec2", usd: 40, ref: "inv-1" }, { pot: "meeps-fund", usd: 100, ref: "inv-2" }];
  const without = pure(t), withIt = pure(t, att);
  for (const pot of MONTH_CLOSE_ORDER) {
    assert.deepEqual(byPot(withIt, pot).lines, byPot(without, pot).lines, `${pot}: the real rows do not move when Starforge's dollars are attested`);
    const chain = (d) => { const p = byPot(d, pot); return [p.ledger_before, p.ledger_after, p.tail_seal_before, p.tail_seal_after]; };
    assert.deepEqual(chain(withIt), chain(without), `${pot}: the real ledger prefix is the same length and the same seal chain: the simulated receipt never joined it`);
  }
  assert.deepEqual(withIt.ledger, without.ledger, "and the plan's ledger span is the same");
  assert.ok(!withIt.pots.flatMap((p) => p.lines ?? []).some((l) => /starforge|wright/.test(l) && /holo/.test(l)), "no real holo row for the credited household");
  assert.ok(!withIt.pots.flatMap((p) => p.lines ?? []).some((l) => /pot-receipt/.test(l)), "no receipt");
  const ec2 = byPot(withIt, "keeping-ec2").provisional, meeps = byPot(withIt, "meeps-fund").provisional;
  // ec2: D = 150 + 40 = 190 ≥ 150, mass 40 (wright has no stakes there): floor(40 · 40 / 190) = 8, under a cap room of floor(0.5 × 100) = 50
  assert.equal(ec2.entry.holo_would_mint, 8);
  assert.equal(ec2.entry.usd, 40); assert.equal(ec2.entry.epoch, MONTH); assert.equal(ec2.entry.pot, "keeping-ec2"); assert.equal(ec2.entry.date, CLOSE_DATE);
  assert.match(ec2.entry.why, /\(ref: inv-1\)/, "the operator's reference rides in why");
  assert.match(ec2.entry.computed, /Starforge excluded/);
  // meeps-fund: D = 200 + 100 = 300 ≥ 200; wright's own 10 are excluded from the mass that sizes wright's mint: S = 50, 50 − 10 = 40, floor(40 · 100 / 300) = 13
  assert.equal(meeps.entry.holo_would_mint, 13, "the household's own stakes are excluded from the mass that sizes its mint");
  assert.equal(meeps.counterfactual.stakes_open, 50);
  // no other household is touched: ana's real mint stays what the real close says, and wright's stakes come home whole in the real rows
  assert.equal(holoOf(byPot(withIt, "meeps-fund"), "ana"), 5);
  assert.ok(byPot(withIt, "meeps-fund").lines.some((l) => / → wright · 10 · for: pot-return:/.test(l)));
  // total_holo_would_mint is recomputed from the entries
  const prov = readProvisional(t.dir);
  assert.equal(withEntry(withEntry(prov.data, ec2.entry), meeps.entry).total_holo_would_mint, 21);
  // earlier provisional entries are never an input: a second month's counterfactual on the same ledger is the same number
  const prior = provisionalFile([{ date: "2026-10-01", pot: "keeping-ec2", epoch: "2026-09", usd: 999, holo_would_mint: 999, why: "an earlier month", computed: "x" }]);
  const t2 = await freshTown({ provisional: prior });
  assert.equal(byPot(pure(t2, att), "keeping-ec2").provisional.entry.holo_would_mint, 8, "an earlier provisional entry is not a cap holding for the next counterfactual");
  // a pot with nothing attested keeps no provisional entry
  assert.equal(byPot(withIt, "darko-fund").provisional, undefined);
});

test("STARFORGE: amounts are attested by a hand and checked; nothing is inferred from a shortfall; a once pot, an unknown pot and a pot with no file refuse", { skip }, async () => {
  const t = await freshTown();
  const bad = (raw) => checkAttestations(raw).refusals.map((r) => r.code);
  assert.deepEqual(bad([{ pot: "keeping-ec2", usd: 0, ref: "x" }]), ["bad-attestation"], "whole dollars of at least 1");
  assert.deepEqual(bad([{ pot: "keeping-ec2", usd: 1.5, ref: "x" }]), ["bad-attestation"]);
  assert.deepEqual(bad([{ pot: "keeping-ec2", usd: 5 }]), ["bad-attestation"], "a reference is required: no dollar without the payment it names");
  assert.deepEqual(bad([{ pot: "keeping-ec2", usd: 5, ref: "  " }]), ["bad-attestation"]);
  assert.deepEqual(bad([{ pot: "keeping-ec2", usd: 5, ref: "x", why: "extra" }]), ["bad-attestation"], "exactly { pot, usd, ref }: no field can smuggle a number in");
  assert.deepEqual(bad([{ pot: "keeping-ec2", usd: 5, ref: "x" }, { pot: "keeping-ec2", usd: 6, ref: "y" }]), ["bad-attestation"], "one contribution per pot-month");
  assert.deepEqual(bad({ pot: "keeping-ec2" }), ["bad-attestation"], "an array");
  assert.deepEqual(checkAttestations(null).list, []);
  const refused = (att) => pure(t, att).refusals.map((r) => r.code);
  assert.deepEqual(refused([{ pot: "meeps-home", usd: 20, ref: "x" }]), ["attested-unknown-pot"], "a once pot is not in the reviewed order");
  assert.deepEqual(refused([{ pot: "no-such-pot", usd: 20, ref: "x" }]), ["attested-unknown-pot"]);
  assert.deepEqual(pure(t, []).refusals, [], "and with none attested the month plans clean: the shortfall to a posted need is not read as Starforge's gift");
  assert.equal(byPot(pure(t, []), "keeping-ec2").provisional, undefined);
});

test("STARFORGE: replay and conflict. A matching entry for a closed month is already complete; a different one, an entry with no close, and a close with no entry all STOP, never append or overwrite", { skip }, async () => {
  const att = [{ pot: "keeping-ec2", usd: 40, ref: "inv-1" }];
  const closedLedger = (M, { gift, stake, receipt }) => [M.rulesLine("2026-06-12"), gift("ana", 20), gift("bo", 100), gift("cy", 100), gift("dee", 10), gift("wright", 100),
    stake("bo", "keeping-ec2", 40), receipt("keeping-ec2", "ana", 150, "t-ana-ec2"),
    "- 2026-11-02 · stake:pot/keeping-ec2 → bo · 40 · for: pot-return:2026-10", "- 2026-11-02 · holo · ana · 10 · pot:keeping-ec2 · epoch:2026-10 · ref: t-ana-ec2"];
  const entry = (over = {}) => ({ date: CLOSE_DATE, pot: "keeping-ec2", epoch: MONTH, usd: 40, holo_would_mint: 8, why: "operator-attested Starforge contribution (ref: inv-1)", computed: "c", ...over });
  const pots = { "keeping-ec2": { pot: "keeping-ec2", status: "open", beneficiary: "keeper", epoch_cadence: "monthly", target_usd_per_epoch: 150 } };
  const run = async (provisional, attested, ledger = closedLedger) => { const t = await freshTown({ ledger, provisional, pots }); return pure(t, attested); };
  const done = await run(provisionalFile([entry()]), att);
  assert.deepEqual([byPot(done, "keeping-ec2").status, done.refusals], ["already-complete", []], "closed, and the entry matches the attestation: already complete, nothing to do");
  assert.equal(byPot(await run(provisionalFile([]), []), "keeping-ec2").status, "already-complete", "closed with nothing attested: reported complete");
  assert.deepEqual((await run(provisionalFile([entry({ usd: 41 })]), att)).refusals.map((r) => r.code), ["provisional-conflict"], "a different amount");
  assert.deepEqual((await run(provisionalFile([entry({ why: "someone else's payment (ref: other)" })]), att)).refusals.map((r) => r.code), ["provisional-conflict"], "a different reference");
  const ref10 = { pot: "keeping-ec2", usd: 40, ref: "inv-10" };
  assert.deepEqual((await run(provisionalFile([entry({ why: "operator-attested Starforge contribution (ref: inv-10)" })]), att)).refusals.map((r) => r.code), ["provisional-conflict"], "stored inv-10, attested inv-1: a reference that merely starts with the attested one is a different payment");
  assert.deepEqual((await run(provisionalFile([entry()]), [ref10])).refusals.map((r) => r.code), ["provisional-conflict"], "stored inv-1, attested inv-10: the other direction");
  assert.deepEqual((await run(provisionalFile([entry({ why: "operator-attested Starforge contribution (ref: inv-10)" })]), [ref10])).refusals, [], "and the same reference, inv-10 against inv-10, still matches");
  assert.deepEqual((await run(provisionalFile([entry(), entry()]), att)).refusals.map((r) => r.code), ["provisional-conflict"], "two entries for one pot-month");
  assert.deepEqual((await run(provisionalFile([]), att)).refusals.map((r) => r.code), ["closed-without-provisional"], "closed, attested, no entry: a reconciliation, not an append");
  const open = (M, { gift, stake, receipt }) => [M.rulesLine("2026-06-12"), gift("ana", 20), gift("bo", 100), gift("wright", 100), stake("bo", "keeping-ec2", 40), receipt("keeping-ec2", "ana", 150, "t-ana-ec2")];
  assert.deepEqual((await run(provisionalFile([entry()]), att, open)).refusals.map((r) => r.code), ["provisional-without-close"], "an entry for a pot this run would close: a reconciliation");
  assert.deepEqual((await run(provisionalFile([entry()]), [], open)).refusals.map((r) => r.code), ["provisional-without-close"], "even when nothing is attested now");
  // the entry for ANOTHER epoch (or the once pot's "once") is not this month's
  assert.equal((await run(provisionalFile([entry({ epoch: "2026-09" }), entry({ pot: "meeps-home", epoch: "once", holo_would_mint: null })]), att, open)).refusals.length, 0);
});

// ── the fingerprint: every input is in it ───────────────────────────────────

test("THE FINGERPRINT binds every governing input: the ledger head, a receipt, the registry, pot metadata, the law, the ordered set, the month, the date, the attestation; and nothing else", { skip }, async () => {
  const t = await freshTown();
  const fp = (attested = [], over = {}) => {
    const town = readTown(t.dir, t.engine);
    const month = over.month ?? MONTH, date = over.date ?? CLOSE_DATE;
    const d = derivePlan({ engine: t.engine, town, month, date, attested, ...(over.order ? { order: over.order } : {}) });
    return fingerprintOf({ month, date, town, plan: { pots: d.pots }, attested, townCommit: readPins().town_commit, engineSeals: d.seals });
  };
  const base = fp();
  assert.equal(fp(), base, "deterministic");
  assert.match(base, /^[0-9a-f]{64}$/);
  const seen = new Set([base]);
  const moves = (label, f) => { const before = fp(); f(); const after = fp(); assert.notEqual(after, before, label); seen.add(after); };
  const file = (rel) => join(t.dir, rel);
  const bytes = (rel) => readFileSync(file(rel));
  const restore = (rel, was) => writeFileSync(file(rel), was);

  moves("a new receipt (the ledger head)", () => { t.M.appendSigned(t.dir, [t.M.potReceiptLine({ date: "2026-10-20", pot: "meeps-fund", rail: "stripe", usd: 5, from: "dee", ref: "t-late" })], t.pem); });
  moves("a new household (the registry)", () => { mkdirSync(file("WHITE_PAGES/newcomer"), { recursive: true }); writeFileSync(file("WHITE_PAGES/newcomer/ADDRESS.md"), "---\nhandle: newcomer\n---\n"); });
  const potRel = "WHITE_PAGES/pot-keeping-ec2.json", potWas = bytes(potRel);
  moves("pot metadata (a posted need)", () => writeFileSync(file(potRel), potWas.toString().replace("150", "140")));
  restore(potRel, potWas);
  const dialRel = "ECONOMY-DIALS.json", dialWas = bytes(dialRel);
  moves("the law (rho in the keeping dial)", () => writeFileSync(file(dialRel), dialWas.toString().replace('"rho":0.5', '"rho":0.4')));
  restore(dialRel, dialWas);
  const provRel = "WHITE_PAGES/starforge-provisional.json", provWas = bytes(provRel);
  moves("the provisional record", () => writeFileSync(file(provRel), provWas.toString().replace("a synthetic", "another synthetic")));
  restore(provRel, provWas);
  assert.notEqual(fp(), base, "(the ledger and registry above stay moved: this one is the control that the base moved)");
  // fresh base for the inputs that are arguments
  const b2 = fp();
  for (const [label, v] of [["the order (a reviewed pot dropped)", fp([], { order: ["keeping-ec2", "meeps-fund"] })], ["the month", fp([], { month: "2026-09" })], ["the date", fp([], { date: "2026-11-01" })],
    ["an attestation", fp([{ pot: "keeping-ec2", usd: 40, ref: "inv-1" }])], ["the attested amount", fp([{ pot: "keeping-ec2", usd: 41, ref: "inv-1" }])], ["the attested reference", fp([{ pot: "keeping-ec2", usd: 40, ref: "inv-9" }])]]) {
    assert.notEqual(v, b2, label); assert.ok(!seen.has(v), `${label}: a new number`); seen.add(v);
  }
  // and what is NOT governed: an unrelated town file (a resident's letter) does not move it
  const b3 = fp();
  mkdirSync(file("WHITE_PAGES/ana/outbox"), { recursive: true }); writeFileSync(file("WHITE_PAGES/ana/outbox/letter.md"), "hello");
  assert.equal(fp(), b3, "a letter is not an input: a town that merely moved on does not refuse an apply");
});

// ── the dry run: refusals, and no side effects ──────────────────────────────

test("the dry run refuses, naming each: the store switch off, a dirty clone, a store that is not the export, a ledger behind the mail, a bad month", { skip }, async () => {
  const t = await freshTown();
  const ok = await plan(t);
  assert.deepEqual(ok.refusals, [], "the healthy town plans clean");
  assert.match(ok.fingerprint, /^[0-9a-f]{64}$/);
  assert.match(renderPlan(ok), /plan fingerprint: [0-9a-f]{64}\ndry run: nothing was appended, pushed or signed\./);

  assert.deepEqual(codes(await plan(t, { env: { ...process.env, STAMP_LINES: "" } })), ["store-not-on"], "the plain-Git fallback is never inherited silently");
  assert.equal((await plan(t, { env: { ...process.env, STAMP_LINES: "" } })).fingerprint, null, "a refused plan has nothing to apply");

  writeFileSync(join(t.dir, "WHITE_PAGES", "pot-keeping-ec2.json"), readFileSync(join(t.dir, "WHITE_PAGES", "pot-keeping-ec2.json"), "utf8").replace("150", "151"));
  assert.deepEqual(codes(await plan(t)), ["clone-dirty"]);
  git(t.dir, "checkout", "-q", "--", "WHITE_PAGES/pot-keeping-ec2.json");

  t.M.appendSigned(t.dir, [t.M.potReceiptLine({ date: "2026-10-21", pot: "meeps-fund", rail: "stripe", usd: 5, from: "dee", ref: "t-ahead" })], t.pem);
  git(t.dir, "add", "-A"); git(t.dir, "-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "a receipt the store lacks");
  assert.ok(codes(await plan(t)).includes("store-unverified"), "the export is ahead of the store: unverified, so nothing is planned on it");

  const t2 = await freshTown();
  mkdirSync(join(t2.dir, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(t2.dir, "WHITE_PAGES", "mail-ledger.md"), "# ledger\n\n- 2026-10-20 · m-1 · ana → bo · thread: new\n");
  git(t2.dir, "add", "-A"); git(t2.dir, "-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "mail the ledger has not minted");
  assert.deepEqual(codes(await plan(t2)), ["ledger-unsettled"], "mints owed: the tail is not settled, and the town's own verifier says so");

  const t3 = await freshTown();
  assert.deepEqual(codes(await plan(t3, { month: "2026-13" })), ["invalid-month"]);
  assert.deepEqual(codes(await plan(t3, { month: "2026-11", date: "2026-11-02" })), ["month-not-ended", "date-inside-epoch"]);
  assert.deepEqual(codes(await plan(t3, { attestations: [{ pot: "keeping-ec2", usd: 0, ref: "x" }] })), ["bad-attestation"]);
  assert.deepEqual(codes(await plan(t3, { attestations: [{ pot: "keeping-ec2", usd: 40, ref: "x" }], now: new Date("2026-11-02T16:00:00Z"), date: "2026-11-02" })), [], "(and a good attestation plans)");
});

test("a provisional record that is not the public file's own shape is never rewritten on a guess, and is never created", { skip }, async () => {
  const t = await freshTown({ provisional: `{"what":"x","credited_to":"wright","entries":[ ],"total_holo_would_mint":0}\n` });
  const att = [{ pot: "keeping-ec2", usd: 40, ref: "inv-1" }];
  assert.deepEqual(codes(await plan(t, { attestations: att })), ["provisional-unreadable"], "it does not round-trip byte for byte through JSON");
  assert.deepEqual(codes(await plan(t)), ["provisional-unreadable"], "and the file is read as it stands even with nothing attested (it is in the fingerprint)");
  const none = await freshTown({ provisional: null });
  assert.deepEqual(codes(await plan(none, { attestations: att })), ["no-provisional-record"]);
  assert.deepEqual(codes(await plan(none)), [], "no attestation, no record needed");
  assert.equal(existsSync(join(none.dir, "WHITE_PAGES", "starforge-provisional.json")), false, "never created");
});

test("THE DRY RUN WRITES NOTHING AND LOADS NO SIGNER: clone, remote and store are as they were; the key file is never read (a read log, with a positive control)", { skip }, async () => {
  const t = await freshTown({});
  const logFile = join(tmp, "reads.log");
  const preload = join(tmp, "read-log.mjs");
  writeFileSync(preload, `import fs from "node:fs";\nimport { syncBuiltinESMExports } from "node:module";\nconst orig = fs.readFileSync;\nfs.readFileSync = function (p, ...a) { if (String(p).includes("stamp-key")) fs.appendFileSync(${JSON.stringify(logFile)}, String(p) + "\\n"); return orig.call(this, p, ...a); };\nsyncBuiltinESMExports();\n`);
  const head = () => [git(t.dir, "rev-parse", "HEAD").trim(), git(t.dir, "status", "--porcelain").trim(), git(`${t.dir}.git`, "rev-parse", "main").trim()].join("|");
  const rows = async () => Number((await office.query("SELECT count(*) n FROM stamp_lines")).rows[0].n);
  const before = [head(), await rows(), t.ledgerText()];
  const att = join(tmp, "att.json");
  writeFileSync(att, JSON.stringify([{ pot: "keeping-ec2", usd: 40, ref: "inv-1" }]));
  const env = { ...process.env, STAMP_KEY: t.keyFile, TOWN_CLONE: t.dir };
  const r = spawnSync(process.execPath, ["--import", `file:///${preload.replace(/\\/g, "/")}`, join(ROOT, "tools", "month-close.mjs"), "plan", "--month", MONTH, "--date", CLOSE_DATE, "--starforge-file", att], { cwd: ROOT, env, encoding: "utf8" });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /plan fingerprint: [0-9a-f]{64}/);
  assert.deepEqual([head(), await rows(), t.ledgerText()], before, "nothing appended, pushed or recorded");
  assert.equal(existsSync(logFile), false, "the key file was never read by the dry run");
  // the control: the same preload does log a read of a key, so an empty log means something
  const probe = spawnSync(process.execPath, ["--import", `file:///${preload.replace(/\\/g, "/")}`, "-e", `require("node:fs").readFileSync(${JSON.stringify(t.keyFile)}, "utf8")`], { env, encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  assert.match(readFileSync(logFile, "utf8"), /stamp-key/, "the instrument is live");
});
