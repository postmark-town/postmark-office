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
//   POS-576/e "No, never": the founders' household and the town pay neither side.

import test from "node:test";
import assert from "node:assert/strict";
import {
  planInvitePay, owedLines, ledgerFacts, activationOf, inviterDueAt, settlementAtOrAfter, townDay,
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

test("the 30 days: the first letter or home within 30 days of the invitation activates it; after, nothing is owed", () => {
  // LAW POS-576/b: "its first letter or its home within 30 days".
  const at = INVITED_AT;
  const day30 = new Date(Date.parse(at) + 30 * 864e5).toISOString();
  assert.equal(activationOf({ at, letter: day30 }).status, "activated", "the 30th day's own instant is within");
  assert.equal(activationOf({ at, letter: new Date(Date.parse(day30) + 1000).toISOString() }).status, "late");
  assert.equal(activationOf({ at, home: "2026-10-29T06:00:00.000Z", letter: "2026-10-30T00:00:00.000Z" }).through, "first home", "the earlier of the two");
  const late = plan({ letters: new Map([["keep", new Date(Date.parse(day30) + 1000).toISOString()]]), now: new Date("2026-12-30T00:00:00.000Z") });
  assert.equal(one(late).inviter_side.status, "late");
  const lapsed = plan({ letters: new Map(), now: new Date("2026-11-27T00:00:00.000Z") });
  assert.equal(one(lapsed).inviter_side.status, "lapsed");
  assert.equal(one(plan({ letters: new Map(), now: new Date("2026-11-20T00:00:00.000Z") })).inviter_side.status, "waiting", "the 30 days still running");
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
  assert.ok(INVITE_ID_RE.test("invite/the-keep") && !INVITE_ID_RE.test("invite/../x") && !INVITE_ID_RE.test("report/12345678"));
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

// ── founders ────────────────────────────────────────────────────────────────

test("founders: an invitation from the founders' household or the town's own pays neither side", () => {
  // LAW POS-576/e (Darko 2026-10-22 22:06): "No, never".
  const r = [invited("nook", "starforge", "wren")];
  const ledger = ledgerOf("- 2026-10-28 · MINT → nell · 5 · for: welcome:hh:nook · by: the-town");
  const p = plan({ r, ledger, letters: new Map([["nook", ACTIVATED]]) });
  assert.equal(one(p, "nook").refused, "founders");
  assert.deepEqual([one(p, "nook").invited_side.status, one(p, "nook").inviter_side.status], ["refused", "refused"]);
  assert.deepEqual(owedLines(p), []);
  assert.deepEqual(owedLines(plan({ r: [invited("hall", "the-town", "pen")], ledger: ledgerOf("- 2026-10-28 · MINT → hall-r · 5 · for: welcome:hh:hall · by: the-town") })), []);
  // the control: the same invitation from an ordinary house asks for both
  assert.equal(owedLines(plan({ r: [invited("nook", "castle", "cleo")], ledger, letters: new Map([["nook", ACTIVATED]]) })).length, 2);
});

test("the recipient: the inviter's resident the join named, else that house's first", () => {
  assert.equal(inviterRecipient("cleo", ["carl", "cleo"]), "cleo");
  assert.equal(inviterRecipient("hh:castle", ["carl", "cleo"]), "carl", "a house named: its first resident");
  assert.equal(inviterRecipient("stranger", ["carl", "cleo"]), "carl");
  assert.equal(inviterRecipient("x", []), null);
  const nobody = planInvitePay({ rows, houses: houses.map((h) => (h.slug === "castle" ? { ...h, residents: [] } : h)), facts: { letters: new Map([["keep", ACTIVATED]]) }, ledger: ledgerOf(WELCOME), holds: new Map(), now: new Date("2026-11-05T00:00:00.000Z") });
  assert.equal(one(nobody).inviter_side.status, "waiting", "a house with no resident on record receives nothing yet");
});
