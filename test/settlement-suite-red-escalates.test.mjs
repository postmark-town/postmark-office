// settlement-suite-red-escalates.test.mjs — THE WIRING, not the module.
//
//   node --test test/settlement-suite-red-escalates.test.mjs
//
// ── WHY THIS EXISTS BESIDE test/settlement-escalate.test.mjs ────────────────
//
// That file proves the escalator: given a receipt it composes the right issue,
// gates the wrong receipt, caps its own list. It proves nothing at all about
// whether `deploy/settlement-auto.sh` ever CALLS it. Measured, on the reviewer's
// flip of PR #55: delete a call site and every other suite stays GREEN. So this
// runs THE REAL SCRIPT, with THE REAL ESCALATOR, a whole crossing in a bottle
// (test/helpers/settlement-bottle.mjs, `realEscalate`), driven to each of its
// exits, asserting what each one said and whether it escalated.
//
// ── REPORT ONLY (POS-1025/c, Darko 2026-11-13) ──────────────────────────────
//
// Founder-ruled 2026-09-16: "a failed settlement should be a crisis", so the
// crossing refused only for harm, and the suite ran after the push as a checker.
// Since the printout, what publishes is decided inside the settlement and
// sealed, so after the seal BOTH only raise alarms: harm named over the printed
// tree, a gate that could not gate, and a world with no gate are each a
// `harm-warning` over a town that published; a red suite is a `suite-warning`.
// The control publishes green and escalates nothing.
//
// ── AND IT CANNOT REACH GITHUB ────────────────────────────────────────────
//
// The observable is the escalator's ISSUE-WANTED line, which it prints when it
// finds no credential. `SETTLEMENT_ESCALATE_CRED` points at a path that is never
// created, so the no-credential path is taken on EVERY box.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SH_OK, bottle, cross } from "./helpers/settlement-bottle.mjs";

const skip = !SH_OK && "no POSIX sh";
const REDS = ["not ok 12 - the-town/pledges names a mark canon does not carry", "not ok 40 - a household line the register has no row for"];

function crossing(opts) {
  const b = bottle({ realEscalate: true, ...opts });
  const run = cross(b, { SETTLEMENT_ESCALATE_CRED: join(b.root, "no-such-credentials") });
  return { ...run, b, escalationLines: run.res.stderr.match(/\[settlement-escalate\][^\n]*/g) ?? [] };
}
/** The whole observable, in one place: did the call site fire, and for which classes. */
const escalatedAs = (run) => [...run.res.stderr.matchAll(/ISSUE-WANTED title: settlement (?:refusal|warning): (\S+)/g)].map((m) => m[1]);

test("THE WIRING · HARM NAMED over the printout is REPORTED: the town publishes, exits 0, and `harm-warning` carries the gate's own rows", { skip }, () => {
  const run = crossing({ harm: true, suiteRed: false });
  assert.equal(run.res.status, 0, `harm holds nothing after the seal: ${run.res.stderr.slice(-800)}`);
  assert.match(run.res.stderr, /HARM NAMED, OR THE GATE COULD NOT GATE — reported/, "the bottle never reached the harm arm");
  assert.equal(run.receipt?.status, "published");
  assert.equal(run.receipt?.harm?.ok, false, "the receipt carries the gate's report");
  assert.deepEqual(run.receipt?.harm?.checks?.find((c) => c.name === "moved")?.rows, ["alpha/one: moved with no act"]);
  assert.deepEqual(escalatedAs(run), ["harm-warning"], "harm reached the exit with no escalation — a crisis that reaches nobody");
  assert.match(run.res.stderr, /alpha\/one: moved with no act/, "the issue names the mark — the whole reason a person can act on it");
  assert.match(run.res.stderr, /THE TOWN IS PUBLISHED, AND THE HARM GATE NAMED HARM OVER IT/);
});

test("THE WIRING · a gate that COULD NOT GATE is reported and escalated — never read as a pass", { skip }, () => {
  const run = crossing({ harm: "crash", suiteRed: false });
  assert.equal(run.res.status, 0, run.res.stderr.slice(-800));
  assert.equal(run.receipt?.status, "published");
  assert.deepEqual(run.receipt?.harm, { ok: false, ran: false, could_not_gate: "harm-gate: could not gate — no WORLD/world-state.json — the fold did not run" });
  assert.deepEqual(escalatedAs(run), ["harm-warning"]);
  assert.match(run.res.stderr, /It said: harm-gate: could not gate/);
});

test("THE WIRING · a world with NO harm gate at its sha is reported and escalated, not published silently ungated", { skip }, () => {
  const run = crossing({ harm: "absent", suiteRed: false });
  assert.equal(run.res.status, 0, run.res.stderr.slice(-800));
  assert.match(run.res.stderr, /no tools\/harm-gate\.mjs at this world sha/);
  assert.equal(run.receipt?.harm?.ran, false);
  assert.match(run.receipt?.harm?.could_not_gate ?? "", /carries no tools\/harm-gate\.mjs/);
  assert.deepEqual(escalatedAs(run), ["harm-warning"]);
});

test("THE WIRING · a RED suite after the push is a WARNING: the town publishes, exits 0, `suite.red` on the receipt, `suite-warning` escalated with the reds", { skip }, () => {
  const run = crossing({ suiteRed: true, suiteReds: REDS });
  assert.equal(run.res.status, 0, `a red checker holds nothing: ${run.res.stderr.slice(-800)}`);
  assert.match(run.res.stderr, /SUITE WARNING/, "the bottle never reached the checker's red arm");
  assert.equal(run.receipt?.status, "published");
  assert.equal(run.receipt?.suite?.red, true);
  assert.deepEqual(run.receipt?.suite?.reds, REDS, "the receipt carries the reds themselves, not a count");
  assert.deepEqual(escalatedAs(run), ["suite-warning"]);
  assert.match(run.res.stderr, /not ok 12 - the-town\/pledges names a mark canon does not carry/);
  assert.match(run.res.stderr, /THE TOWN IS PUBLISHED/, "the issue must say the town published");
  assert.equal(existsSync(join(run.b.office, "settlement-last-suite.log")), true, "the red log is copied where the deploy docs say to look");
});

test("THE CONTROL · no harm and a GREEN suite publishes, exits 0, and escalates nothing", { skip }, () => {
  // Without this, the assertions above are satisfied by a script that escalates
  // on every crossing — which would bury the queue exactly as filing a fresh
  // issue per crossing would.
  const run = crossing({ suiteRed: false });
  assert.equal(run.res.status, 0, run.res.stderr.slice(-800));
  assert.match(run.res.stderr, /harm gate: NO HARM/);
  assert.doesNotMatch(run.res.stderr, /SUITE WARNING|HARM NAMED/);
  assert.equal(run.receipt?.status, "published");
  assert.equal(run.receipt?.harm?.ok, true, "`ok: true` is the receipt that the gate RAN");
  assert.equal(run.receipt?.suite?.red, false, "and `red: false` that the checker ran");
  assert.deepEqual(run.escalationLines, [], "a clean crossing escalated anyway — an alarm that always fires is an alarm nobody reads");
});
