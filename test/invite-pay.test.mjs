// invite-pay.test.mjs — Bring a neighbour's plan (POS-816): who is owed which side, and when.
//   node --test test/invite-pay.test.mjs
// Pure: invented households, an invented ledger (the town's own classifier is
// stood in by a one-line reader of the two invite grammars and the welcome),
// no store, no town, no clock but the one each test names.
//
// The law each falsifier quotes:
//   POS-576/a "10 and 10": an invited household's join bundle is 10 (its welcome's
//     5 and a 5-more line), and its inviter gets 10;
//   POS-576/b "Invitee now, inviter when real": the 5 more at settle; the inviter's
//     10 when the house sends its first letter or claims its home "within 30 days";
//   POS-576/c "let's do 10 a month", counted in the month paid (POS-816/b "Month paid");
//   POS-816/a "A week": the inviter's 10 waits a week after that trigger;
//   POS-816 (2026-11-02 23:56): a held payout waits until lifted; cancelled is
//     never paid and takes no place in the cap; every move carries a reason;
//   POS-576/e "No, never": the town's own house pays neither side. The founders'
//     household did too until POS-816/d (Darko 2026-11-03 09:31 EDT: "this should pay
//     like any other under the new NOMOS"): it pays both sides now, like any other;
//   POS-655 "meeps are credited, not paid": a meep is never the recipient.

import test from "node:test";
import assert from "node:assert/strict";
import {
  planInvitePay, owedLines, ledgerFacts, activationOf, inviterDueAt, settlementAtOrAfter, townDay, townDayGap,
  judgeHoldMove, inviterRecipient, INVITE_HOLD_MS, INVITE_CAP_PER_MONTH, INVITE_HOLD_HANDS, INVITE_ID_RE,
} from "../src/invite-pay.mjs";

// ── the invented town ───────────────────────────────────────────────────────
const INVITED_AT = "2026-10-27T20:39:04.552Z";
const ACTIVATED = "2026-10-28T12:00:00.000Z";          // the first letter, delivered at the noon crossing
const DUE = "2026-11-04T18:00:00.000Z";                // the first settlement at or after a week later
const houses = [
  { slug: "keep", residents: ["dora"], formerly: [] },
  { slug: "castle", residents: ["carl", "cleo"], formerly: [] },
  { slug: "starforge", residents: ["wren"], formerly: [] },
  { slug: "nook", residents: ["nell"], formerly: [] },
];
const invited = (slug, by, named, at = INVITED_AT, residents = [slug === "keep" ? "dora" : `${slug}-r`]) =>
  ({ slug, name: slug, residents, invited_by: { by, named, at } });
const rows = [invited("keep", "castle", "cleo")];

// An invented ledger, read the way the town reads it: the welcome and the two invite grammars.
const WELCOME_RE = /^- (\S+) · MINT → (\S+) · 5 · for: welcome:(\S+) · by: the-town$/;
const INVITE_RE = /^- (\S+) · MINT → (\S+) · (\d+) · for: invite:([^/]+)\/([^/]+)\/(?:(invited)|inviter\/(\S+)) · by: the-town$/;
const engine = { classifyEntry: (line) => {
  let m;
  if ((m = WELCOME_RE.exec(line))) return { kind: "welcome", date: m[1], handle: m[2], household: m[3] };
  if ((m = INVITE_RE.exec(line))) return { kind: "invite", date: m[1], handle: m[2], n: Number(m[3]), invited: m[4], inviter: m[5], side: m[6] ? "invited" : "inviter", activated: m[7] ?? null };
  return { kind: "other" };
} };
const canon = (k) => ({ "gh:4": "hh:keep", "gh:5": "hh:castle" })[k] ?? k;
const ledgerOf = (...lines) => ledgerFacts(lines.map((canonical) => ({ canonical })), { engine, canon });
const WELCOME = "- 2026-10-28 · MINT → dora · 5 · for: welcome:gh:4 · by: the-town";
const INVITED_LINE = "- 2026-10-28 · MINT → dora · 5 · for: invite:hh:keep/hh:castle/invited · by: the-town";
const INVITER_LINE = "- 2026-11-04 · MINT → cleo · 10 · for: invite:hh:keep/hh:castle/inviter/2026-10-28 · by: the-town";
const plan = ({ ledger = ledgerOf(WELCOME), letters = new Map([["keep", ACTIVATED]]), homes = new Map(), holds = new Map(), now = new Date("2026-11-05T00:00:00.000Z"), r = rows } = {}) =>
  planInvitePay({ rows: r, houses, facts: { letters, homes, ashore: new Map() }, ledger, holds, now });
const one = (p, slug = "keep") => p.invitations.find((x) => x.household === slug);

// ── the amounts and the lines ───────────────────────────────────────────────

test("the amounts: the invited side is asked for 5 beside its welcome, the inviter side for 10, each naming both houses", () => {
  // LAW POS-576/a: "10 and 10"; POS-816: the 5 more is its own line, linked to both households.
  const p = plan();
  assert.deepEqual(one(p).invited_side, { status: "owed", to: "dora", amount: 5,
    line: { side: "invited", handle: "dora", invited: "hh:keep", inviter: "hh:castle" } });
  assert.deepEqual(one(p).inviter_side, { status: "owed", due: DUE, to: "cleo", amount: 10, nth_this_month: 1,
    line: { side: "inviter", handle: "cleo", invited: "hh:keep", inviter: "hh:castle", activated: "2026-10-28" } });
  assert.deepEqual(owedLines(p).map((l) => l.side), ["invited", "inviter"], "the invited side first: it follows its welcome");
});

test("the invited side: owed only once its welcome is on the ledger, to the welcome's own recipient, with no wait and no hold", () => {
  // LAW POS-576/b: "Invitee now".
  assert.equal(one(plan({ ledger: ledgerOf() })).invited_side.status, "waiting", "no welcome yet: nothing owed");
  const held = plan({ holds: new Map([["keep", { state: "held", moves: [] }]]), letters: new Map() });
  assert.equal(one(held).invited_side.status, "owed", "a hold is on the inviter's 10 only; the 5 more never waits on it");
  assert.equal(one(held, "keep").invited_side.to, "dora");
});

test("never twice: a side the ledger already pays reads paid, and asks for nothing", () => {
  const p = plan({ ledger: ledgerOf(WELCOME, INVITED_LINE, INVITER_LINE) });
  assert.deepEqual(one(p).invited_side, { status: "paid", to: "dora", on: "2026-10-28" });
  assert.deepEqual(one(p).inviter_side, { status: "paid", to: "cleo", on: "2026-11-04" });
  assert.deepEqual(owedLines(p), [], "nothing asked twice");
  // the control: the same invitation, nothing paid, asks for both
  assert.equal(owedLines(plan()).length, 2);
  // a welcome under the account spelling is the house's welcome
  assert.equal(one(plan({ ledger: ledgerOf(WELCOME) })).welcome.to, "dora");
});

// ── the 30 days ─────────────────────────────────────────────────────────────

test("the 30 days: the first letter or home within 30 town days of the invitation's town day activates it; after, nothing is owed", () => {
  // LAW POS-576/b: "its first letter or its home within 30 days", counted as the town's judge counts it
  // (Wright, on Darko's behalf, 2026-11-03: "the town's judge is the law, so the office's 30 days must be exactly the judge's").
  // Until 2026-11-03 this asserted the 30 days as 30×24 hours of the invitation's instant: one second past them read late,
  // and 2026-11-27T00:00Z read lapsed. Both are still the 30th town day, and the judge pays them.
  const at = INVITED_AT; // town day 2026-10-27; the 30th town day after it is 2026-11-26
  const day30 = new Date(Date.parse(at) + 30 * 864e5).toISOString();
  assert.equal(activationOf({ at, letter: day30 }).status, "activated", "the 30th day's own instant is within");
  assert.equal(activationOf({ at, letter: new Date(Date.parse(day30) + 1000).toISOString() }).status, "activated", "a second past 30×24 hours is still the 30th town day");
  const end = "2026-11-27T05:00:00.000Z"; // the first instant of town day 2026-11-27, midnight EST
  assert.equal(activationOf({ at }).by, end, "the 30 days end where the 31st town day begins");
  assert.equal(activationOf({ at, letter: "2026-11-27T04:59:59.999Z" }).status, "activated", "the 30th town day's last instant");
  assert.equal(activationOf({ at, letter: end }).status, "late", "the 31st town day's first instant");
  assert.equal(activationOf({ at, home: "2026-10-29T06:00:00.000Z", letter: "2026-10-30T00:00:00.000Z" }).through, "first home", "the earlier of the two");
  assert.equal(one(plan({ letters: new Map([["keep", end]]), now: new Date("2026-12-30T00:00:00.000Z") })).inviter_side.status, "late");
  assert.equal(one(plan({ letters: new Map(), now: new Date(end) })).inviter_side.status, "lapsed", "lapsed when the 30 days end, not before");
  assert.equal(one(plan({ letters: new Map(), now: new Date("2026-11-27T04:59:59.999Z") })).inviter_side.status, "waiting", "still waiting on the 30th town day's last instant");
  assert.equal(one(plan({ letters: new Map(), now: new Date("2026-11-20T00:00:00.000Z") })).inviter_side.status, "waiting", "the 30 days still running");
});

test("the 30 days are town days, across both clock changes and in an ordinary month, and the shown deadline is the enforced one", () => {
  // The review's March case (finding 2): invited 2027-02-13T04:00Z (town day 02-12, 23:00 EST), activated exactly
  // 30×24 hours later, 2027-03-15T04:00Z (town day 03-15, 00:00 EDT): town day +31, refused by the judge and so here.
  const at = "2027-02-13T04:00:00.000Z";
  const edge = "2027-03-15T04:00:00.000Z";
  assert.equal(Date.parse(edge) - Date.parse(at), 30 * 864e5, "exactly 30×24 hours");
  assert.equal(townDayGap(at, edge), 31, "town day +31 across the March change");
  assert.equal(activationOf({ at, letter: edge }).status, "late", "the office refuses what the judge refuses");
  assert.equal(activationOf({ at, letter: "2027-03-15T03:59:59.999Z" }).status, "activated", "a millisecond earlier is town day 03-14, +30");
  // The case the ruling turns on (round 2's question 2): an ordinary month, the 30th town day, later in the day
  // than the invitation's clock time, so past 30×24 hours. The judge pays it; until 2026-11-03 the office read it late.
  const jan = "2027-01-10T15:00:00.000Z";                                 // town day 01-10, 10:00 EST
  const pastHours = "2027-02-09T23:00:00.000Z";                           // town day 02-09 (+30), 18:00 EST: 30×24 hours + 8
  assert.ok(Date.parse(pastHours) - Date.parse(jan) > 30 * 864e5);
  assert.equal(townDayGap(jan, pastHours), 30);
  assert.equal(activationOf({ at: jan, letter: pastHours }).status, "activated", "the 30th town day, whatever its hour");
  // the shown deadline (round 2's note 1): invited 2027-02-13T04:30Z (02-12, 23:30 EST), nothing yet. The 30 days end at
  // 2027-03-15T04:00Z (midnight EDT); at 04:10Z the row is lapsed, exactly as a letter then is late.
  const lateNight = "2027-02-13T04:30:00.000Z";
  assert.equal(activationOf({ at: lateNight }).by, "2027-03-15T04:00:00.000Z");
  assert.equal(activationOf({ at: lateNight, now: new Date("2027-03-15T04:10:00.000Z") }).status, "lapsed");
  assert.equal(activationOf({ at: lateNight, letter: "2027-03-15T04:10:00.000Z" }).status, "late");
  assert.equal(activationOf({ at: lateNight, now: new Date("2027-03-15T03:59:59.999Z") }).status, "waiting");
  // November: invited on town day 2026-10-02, the 31st town day is 11-02, the day after the change, so it begins at midnight EST
  assert.equal(activationOf({ at: "2026-10-02T12:00:00.000Z" }).by, "2026-11-02T05:00:00.000Z");
});

const INVITE_TOWN = process.env.INVITE_TOWN_CLONE || null;
test(`the 30 days are exactly the town judge's: identical results across 2026-11-01, 2027-03-14 and an ordinary month ${INVITE_TOWN ? "" : "(skipped: needs postmark#4424's judge: set INVITE_TOWN_CLONE)"}`,
  { skip: INVITE_TOWN ? false : "needs postmark#4424's judge (unshipped): set INVITE_TOWN_CLONE" }, async () => {
    // Wright, on Darko's behalf, after round 2: "the town's judge is the law, so the office's 30 days must be exactly the judge's".
    const { pathToFileURL } = await import("node:url");
    const { join } = await import("node:path");
    const town = await import(pathToFileURL(join(INVITE_TOWN, "tools", "stamp-mint.mjs")).href);
    const { townDayStart, addTownDays } = await import("../src/invite-pay.mjs");
    const judged = (at, act) => {
      const line = town.inviteInviterLine({ date: townDay(inviterDueAt(act)), handle: "cleo", invited: "hh:keep", inviter: "hh:castle", activated: townDay(act) });
      return town.judgeInviteLine(town.classifyEntry(line), {
        canon: (k) => k, invitationOf: (k) => (k === "hh:keep" ? { by: "castle", named: "cleo", at } : null),
        houseAt: () => "hh:castle", isMeep: () => false, state: town.inviteState(),
      });
    };
    // three windows of invitations, every 61 minutes, whose 30th town day falls across the change (or no change)
    const windows = { "2026-11-01": ["2026-09-28", "2026-10-05"], "2027-03-14": ["2027-02-08", "2027-02-15"], "ordinary 2027-01": ["2027-01-05", "2027-01-09"] };
    for (const [name, [from, to]] of Object.entries(windows)) {
      let paid = 0, refused = 0;
      for (let t = Date.parse(`${from}T00:00:00Z`); t < Date.parse(`${to}T00:00:00Z`); t += 61 * 6e4) {
        const at = new Date(t).toISOString();
        const day = townDay(at);
        const s30 = Date.parse(townDayStart(addTownDays(day, 30))), s31 = Date.parse(townDayStart(addTownDays(day, 31)));
        const hours = t + 30 * 864e5;
        const s0 = Date.parse(townDayStart(day)); // the day before the invitation's is refused by both (the floor)
        const acts = [s0 - 1, s0, s30 - 1, s30, s31 - 1, s31, s31 + 1, hours - 1000, hours, hours + 1000];
        for (let a = s30 - 12 * 36e5; a < s31 + 12 * 36e5; a += 2 * 36e5) acts.push(a);
        for (const ms of acts) {
          const act = new Date(ms).toISOString();
          const office = activationOf({ at, letter: act }).status === "activated";
          const why = judged(at, act);
          assert.equal(office, why === null, `${name}: ${at} → ${act}: the office says ${office ? "pay" : "late"}, the judge ${why ?? "pays"}`);
          if (why !== null) assert.match(why, /more than 30 days after the invitation|before the invitation/, `${name}: the judge refuses only for the 30 days`);
          office ? (paid += 1) : (refused += 1);
        }
      }
      assert.ok(paid > 500 && refused > 500, `${name}: both sides of the edge met (${paid} paid by both, ${refused} refused by both)`);
    }
  });

// ── the week ────────────────────────────────────────────────────────────────

test("the week: the inviter's 10 falls due at the first settlement a week after the activation, and not a moment before", () => {
  // LAW POS-816/a: "A week".
  assert.equal(INVITE_HOLD_MS, 7 * 864e5);
  assert.equal(inviterDueAt(ACTIVATED), DUE, "12:00Z + 7 days is 12:00Z; the next settlement is 18:00Z");
  assert.equal(inviterDueAt("2026-10-28T06:00:00.000Z"), "2026-11-04T06:00:00.000Z", "a settlement's own instant is due at that settlement");
  assert.equal(one(plan({ now: new Date("2026-11-04T17:59:59.000Z") })).inviter_side.status, "in-week");
  assert.equal(one(plan({ now: new Date(DUE) })).inviter_side.status, "owed");
  // the town's verifier holds a seven-town-day floor: the due day is never fewer than seven after the activation's,
  // across the November clock change too (the activation at 00:30 EDT on 11-01)
  for (const a of ["2026-11-01T04:30:00.000Z", "2026-11-01T05:59:00.000Z", "2026-03-07T05:30:00.000Z", ACTIVATED, "2026-10-28T23:59:00.000Z"]) {
    const gap = (Date.parse(`${townDay(inviterDueAt(a))}T00:00:00Z`) - Date.parse(`${townDay(a)}T00:00:00Z`)) / 864e5;
    assert.ok(gap >= 7, `${a}: due ${inviterDueAt(a)} is only ${gap} town days later`);
  }
  assert.equal(settlementAtOrAfter("2026-10-22T23:00:00.000Z"), "2026-10-23T06:00:00.000Z");
});

// ── the hold ────────────────────────────────────────────────────────────────

test("the hold: held waits until lifted, lifted pays when due, cancelled is never paid", () => {
  // LAW POS-816 (2026-11-02 23:56): "A held payout waits until it is lifted. Cancelling is its own act and needs a reason."
  const at = (state) => one(plan({ holds: new Map([["keep", { state, moves: [] }]]) })).inviter_side.status;
  assert.equal(at("held"), "held");
  assert.equal(at("lifted"), "owed", "lifted: paid when due");
  assert.equal(at("cancelled"), "cancelled");
  assert.equal(owedLines(plan({ holds: new Map([["keep", { state: "held", moves: [] }]]) })).filter((l) => l.side === "inviter").length, 0);
  assert.equal(owedLines(plan()).filter((l) => l.side === "inviter").length, 1, "the control: no hold, it pays");
});

test("the hold's moves: each needs a reason, cancelled is final, and only the named moves exist", () => {
  assert.deepEqual(judgeHoldMove({ to: "held", note: "looks like a second account" }, "open"), { to: "held", note: "looks like a second account" });
  assert.match(judgeHoldMove({ to: "held" }, "open").defect, /each carry a reason/);
  assert.match(judgeHoldMove({ to: "lifted", note: "x" }, "open").defect, /not held/);
  assert.deepEqual(judgeHoldMove({ to: "lifted", note: "checked with them" }, "held"), { to: "lifted", note: "checked with them" });
  assert.deepEqual(judgeHoldMove({ to: "held", note: "again" }, "lifted").to, "held", "held again in the week");
  assert.equal(judgeHoldMove({ to: "cancelled", note: "a second account" }, "open").to, "cancelled", "cancelled without a hold first");
  assert.match(judgeHoldMove({ to: "lifted", note: "x" }, "cancelled").defect, /cancelled payout is final/);
  assert.match(judgeHoldMove({ to: "paid", note: "x" }, "open").defect, /is not a move/);
  assert.match(judgeHoldMove({ to: "held", note: "x".repeat(601) }, "open").defect, /over 600/);
  assert.deepEqual(INVITE_HOLD_HANDS, ["little-bird", "keemin"], "Little Bird, and Darko as her backup");
  assert.ok(INVITE_ID_RE.test("invite:the-keep") && !INVITE_ID_RE.test("invite:../x") && !INVITE_ID_RE.test("report/12345678"));
  // A resident whose handle is "invite" posts as invite/<slug>: an ordinary post, never an invitation
  assert.equal(INVITE_ID_RE.test("invite/the-keep"), false, "a resident's post id can never be routed to the hold");
});

// ── the cap ─────────────────────────────────────────────────────────────────

test("the cap: at most 10 paid a month per inviting house, counted in the month paid; a cancelled one takes no place", () => {
  // LAW POS-576/c: "let's do 10 a month"; POS-816/b: "Month paid".
  assert.equal(INVITE_CAP_PER_MONTH, 10);
  const lodges = Array.from({ length: 12 }, (_, i) => invited(`lodge${i + 1}`, "castle", "cleo", "2026-10-02T12:00:00.000Z"));
  const letters = new Map(lodges.map((r, i) => [r.slug, `2026-10-${String(5 + i).padStart(2, "0")}T12:00:00.000Z`]));
  const now = new Date("2026-11-20T12:00:00.000Z");
  const p = plan({ r: lodges, letters, now, ledger: ledgerOf() });
  const status = (s) => one(p, s).inviter_side.status;
  assert.equal(lodges.filter((r) => status(r.slug) === "owed").length, 10);
  assert.deepEqual([status("lodge11"), status("lodge12")], ["over-cap", "over-cap"], "the eleventh and twelfth, due last, wait");
  // paid lines already in November count against November
  const four = ledgerOf(...Array.from({ length: 4 }, (_, i) => `- 2026-11-0${i + 1} · MINT → cleo · 10 · for: invite:hh:other${i}/hh:castle/inviter/2026-10-20 · by: the-town`));
  assert.equal(lodges.filter((r) => one(plan({ r: lodges, letters, now, ledger: four }), r.slug).inviter_side.status === "owed").length, 6);
  // ten paid in OCTOBER do not count against November: the month paid
  const october = ledgerOf(...Array.from({ length: 10 }, (_, i) => `- 2026-10-${String(20 + i).padStart(2, "0")} · MINT → cleo · 10 · for: invite:hh:old${i}/hh:castle/inviter/2026-10-10 · by: the-town`));
  assert.equal(lodges.filter((r) => one(plan({ r: lodges, letters, now, ledger: october }), r.slug).inviter_side.status === "owed").length, 10);
  // a cancelled one takes no place: cancel two of the first ten, and the eleventh and twelfth are paid
  const holds = new Map([["lodge1", { state: "cancelled", moves: [] }], ["lodge2", { state: "cancelled", moves: [] }]]);
  const withCancels = plan({ r: lodges, letters, now, ledger: ledgerOf(), holds });
  assert.deepEqual(["lodge11", "lodge12"].map((s) => one(withCancels, s).inviter_side.status), ["owed", "owed"]);
  // and a HELD one takes no place either until it is paid
  const withHolds = plan({ r: lodges, letters, now, ledger: ledgerOf(), holds: new Map([["lodge1", { state: "held", moves: [] }]]) });
  assert.equal(one(withHolds, "lodge11").inviter_side.status, "owed");
  // the cap is the inviter's only: every invited side is still owed (here, none has a welcome, so all wait)
  assert.ok(p.invitations.every((x) => x.invited_side.status === "waiting"));
});

test("the hold's evidence: every row carries the inviter's paid count for the month, the held and in-week rows too", () => {
  // POS-816 review, finding 3. Little Bird's list (CORE-26 2026-10-29): "the inviter's paid-invite count for the month".
  // castle has 3 paid in November; four invitations of its stand held, in their week, owed, and still waiting.
  const three = Array.from({ length: 3 }, (_, i) => `- 2026-11-0${i + 1} · MINT → cleo · 10 · for: invite:hh:prior${i}/hh:castle/inviter/2026-10-20 · by: the-town`);
  const r = ["a-held", "b-week", "c-owed", "d-waiting"].map((s) => invited(s, "castle", "cleo", "2026-10-27T12:00:00.000Z"));
  const letters = new Map([["a-held", "2026-11-01T12:00:00.000Z"], ["b-week", "2026-11-18T12:00:00.000Z"], ["c-owed", "2026-11-02T12:00:00.000Z"]]);
  const p = plan({ r, letters, ledger: ledgerOf(...three), holds: new Map([["a-held", { state: "held", moves: [] }]]), now: new Date("2026-11-20T12:00:00.000Z") });
  assert.deepEqual(r.map((x) => one(p, x.slug).inviter_side.status), ["held", "in-week", "owed", "waiting"]);
  for (const x of r) assert.deepEqual(one(p, x.slug).inviter_paid_this_month, { month: "2026-11", paid: 3 }, `${x.slug}: the count is on its row`);
  // the control: an inviter with none paid this month reads 0, never a missing field
  assert.deepEqual(one(plan(), "keep").inviter_paid_this_month, { month: "2026-11", paid: 0 });
});

// ── the founders pay like any other; the town's own house does not ──────────

test("founders: an invitation from the founders' household pays both sides like any other's, cap included; the town's own house still pays neither", () => {
  // LAW POS-816/d (Darko 2026-11-03 09:31 EDT): "this should pay like any other under the new NOMOS".
  // Until 2026-11-03 this asserted POS-576/e ("No, never", 2026-10-22 22:06): an invitation from
  // starforge read refused "founders" on both sides and owed nothing.
  const r = [invited("nook", "starforge", "wren")];
  const ledger = ledgerOf("- 2026-10-28 · MINT → nell · 5 · for: welcome:hh:nook · by: the-town");
  const letters = new Map([["nook", ACTIVATED]]);
  const p = plan({ r, ledger, letters });
  assert.equal(one(p, "nook").refused, undefined, "no refusal: starforge is a household like another");
  assert.deepEqual(one(p, "nook").invited_side, { status: "owed", to: "nell", amount: 5,
    line: { side: "invited", handle: "nell", invited: "hh:nook", inviter: "hh:starforge" } });
  assert.deepEqual(one(p, "nook").inviter_side, { status: "owed", due: DUE, to: "wren", amount: 10, nth_this_month: 1,
    line: { side: "inviter", handle: "wren", invited: "hh:nook", inviter: "hh:starforge", activated: "2026-10-28" } });
  assert.deepEqual(owedLines(p).map((l) => [l.side, l.handle, l.inviter]), [["invited", "nell", "hh:starforge"], ["inviter", "wren", "hh:starforge"]],
    "both sides, asked for exactly as an ordinary house's are");
  // like any other includes the cap: starforge with ten paid in November waits for a month with room
  const ten = ledgerOf("- 2026-10-28 · MINT → nell · 5 · for: welcome:hh:nook · by: the-town",
    ...Array.from({ length: 10 }, (_, i) => `- 2026-11-0${i % 9 + 1} · MINT → wren · 10 · for: invite:hh:old${i}/hh:starforge/inviter/2026-10-20 · by: the-town`));
  assert.equal(one(plan({ r, ledger: ten, letters }), "nook").inviter_side.status, "over-cap", "the founders' house is held to the 10 a month like any other");
  // the town's own house still pays neither side (it is the town's, not a household's)
  const hall = plan({ r: [invited("hall", "the-town", "pen")], ledger: ledgerOf("- 2026-10-28 · MINT → hall-r · 5 · for: welcome:hh:hall · by: the-town"), letters: new Map([["hall", ACTIVATED]]) });
  assert.equal(one(hall, "hall").refused, "town");
  assert.deepEqual([one(hall, "hall").invited_side, one(hall, "hall").inviter_side], [{ status: "refused", why: "town" }, { status: "refused", why: "town" }]);
  assert.deepEqual(owedLines(hall), []);
  // the control: the same invitation from an ordinary house asks for both
  assert.equal(owedLines(plan({ r: [invited("nook", "castle", "cleo")], ledger, letters })).length, 2);
});

test("the recipient: the inviter's resident the join named, else that house's first, and never a meep", () => {
  assert.equal(inviterRecipient("cleo", ["carl", "cleo"]), "cleo");
  assert.equal(inviterRecipient("hh:castle", ["carl", "cleo"]), "carl", "a house named: its first resident");
  assert.equal(inviterRecipient("stranger", ["carl", "cleo"]), "carl");
  assert.equal(inviterRecipient("x", []), null);
  // POS-655 (meeps are credited, not paid) beside POS-816/d: with the founders' half repealed a join can name
  // the Starforge household whole, which lists meeps first (live: architect, illuminator, ...). The 10 goes
  // to the first resident who is not one, or to nobody: the town's judge would refuse a meep on every tick.
  const isMeep = (h) => ["architect", "registrar"].includes(h);
  assert.equal(inviterRecipient("hh:starforge", ["architect", "registrar", "wren", "wick"], isMeep), "wren", "a house named whole: its first resident who is not a meep");
  assert.equal(inviterRecipient("wick", ["architect", "registrar", "wren", "wick"], isMeep), "wick", "a resident the join named is paid when they are not one");
  assert.equal(inviterRecipient("hh:starforge", ["architect", "registrar"], isMeep), null, "a house of nothing but meeps receives nothing");
  assert.equal(inviterRecipient("hh:starforge", ["architect", "wren"]), "architect", "the control: with no law handed in, nobody is a meep here (the town's judge still holds it)");
  // through the plan, where the town's meep law rides the ledger the plan reads (invite-facts.mjs § townInviteLedger)
  const sfHouses = houses.map((h) => (h.slug === "starforge" ? { ...h, residents: ["architect", "wren"] } : h));
  const nookLedger = (...extra) => ledgerOf("- 2026-10-28 · MINT → nell · 5 · for: welcome:hh:nook · by: the-town", ...extra);
  const planWith = (ledger) => planInvitePay({ rows: [invited("nook", "starforge", "hh:starforge")], houses: sfHouses,
    facts: { letters: new Map([["nook", ACTIVATED]]) }, ledger, holds: new Map(), now: new Date("2026-11-05T00:00:00.000Z") });
  const lawful = Object.assign(nookLedger(), { isMeep: (h) => h === "architect" });
  assert.equal(one(planWith(lawful), "nook").inviter_side.to, "wren", "the plan skips the meep");
  assert.deepEqual(owedLines(planWith(lawful)).map((l) => l.handle), ["nell", "wren"]);
  assert.equal(one(planWith(nookLedger()), "nook").inviter_side.to, "architect", "the control: without the law the first resident is chosen, which is what the law moves");
  const nobody = planInvitePay({ rows, houses: houses.map((h) => (h.slug === "castle" ? { ...h, residents: [] } : h)), facts: { letters: new Map([["keep", ACTIVATED]]) }, ledger: ledgerOf(WELCOME), holds: new Map(), now: new Date("2026-11-05T00:00:00.000Z") });
  assert.equal(one(nobody).inviter_side.status, "waiting", "a house with no resident on record receives nothing yet");
});
