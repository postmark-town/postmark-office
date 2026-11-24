// settlement-printout-crossing.test.mjs — THE CROSSING PRINTS, TAGS AND RECORDS ITS SEALED SETTLEMENT (POS-1025).
//
//   node --test test/settlement-printout-crossing.test.mjs
//
// deploy/settlement-auto.sh, the REAL script, in the bottle (test/helpers/settlement-bottle.mjs):
// the printout is a stub of its shell contract and the tag it cuts is a real annotated tag the
// crossing pushes. The tool's own behaviour is test/settlement-printout.test.mjs's, over a real
// store and the real world; this file holds the crossing to what it does with each answer.
//
// The rulings it answers: POS-1025/a "Every settlement" (the tag is cut only after a successful
// printout, a retry keeps its number, old tags are never rewritten), POS-1025/c "Report only"
// (after the seal the checks only alarm), and the disposition's "a disagreement refuses and alarms;
// a stale replay never moves canon back".

import test from "node:test";
import assert from "node:assert/strict";
import { g, bottle, cross, SH_OK, SETTLEMENT } from "./helpers/settlement-bottle.mjs";

const skip = !SH_OK && "no POSIX sh";
const why = (run) => `exit ${run.res.status}\n${run.res.stderr}`;
const TAG = `settlement/S${SETTLEMENT}`;
const tagOnOrigin = (b) => { try { return g(b.origin, "rev-parse", "--verify", "--quiet", `refs/tags/${TAG}^{commit}`); } catch { return null; } };
const calls = (run, mode) => run.stubs.filter((l) => l.startsWith(`settlement-printout ${mode}`));
const historyLines = (run) => (run.history ?? "").split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("a REFUSED printout publishes nothing — no push, no tag, no record — and alarms as a terminal class", { skip }, () => {
  const b = bottle({ suiteRed: false });
  const run = cross(b, { PRINTOUT_SAYS: "refused" });
  assert.equal(run.res.status, 1, why(run));
  assert.equal(run.after, run.before, "origin is as it was: not even the registry commit is pushed");
  assert.equal(run.receipt.status, "refused");
  assert.equal(run.receipt.class, "printout-refused");
  assert.deepEqual(run.receipt.printout, {
    ran: true, status: "refused", refused: "reframe-refused",
    detail: "the frame alpha/old-hall cannot keep alpha/one exactly", reframe: { id: "alpha/one" },
  });
  assert.match(run.receipt.detail, /^the printout refused: reframe-refused — /);
  assert.equal(calls(run, "tag").length + calls(run, "record").length, 0, "nothing after a refused printout");
  assert.match(run.escalations ?? "", /FILED printout/);
  assert.match(run.res.stderr, /window 213 stays sealed and unprinted; the next crossing's delta carries it/);
  const [line] = historyLines(run);
  assert.equal(line.class, "printout-refused");
  assert.equal(line.recorded, null, "nothing was printed, so nothing was owed a record");
});

test("the tag is cut at the PUSHED printout and pushed; the record names that same commit", { skip }, () => {
  const b = bottle({ suiteRed: false });
  const run = cross(b);
  assert.equal(run.res.status, 0, why(run));
  const main = g(b.origin, "rev-parse", "main");
  assert.equal(run.receipt.world_to, main);
  assert.equal(tagOnOrigin(b), main);
  assert.match(g(b.origin, "for-each-ref", "--format=%(contents)", `refs/tags/${TAG}`), /digest: d{64}/, "an annotated tag naming the digest");
  assert.match(calls(run, "tag")[0], new RegExp(`--window 213 --commit ${main}`));
  assert.equal(run.storeWrites.trim(), `RECORDED 213 ${main}`);
  assert.deepEqual(run.receipt.tag, { status: "tagged", tag: TAG, commit: main, digest: "d".repeat(64) });
  assert.equal(run.receipt.record.status, "recorded");
  assert.equal(run.receipt.settlement, SETTLEMENT);
  assert.equal(historyLines(run)[0].recorded, true);
  assert.equal(run.escalations, null, "a clean printout tells nobody");
});

test("a tag that already stands ELSEWHERE on origin is never moved: the town is published, the record withheld, a person told", { skip }, () => {
  const b = bottle({ suiteRed: false });
  // someone's settlement/S214 already on origin, at canon's commit
  const canon = g(b.origin, "rev-parse", "main");
  g(b.worldClone, "fetch", "-q", "origin");
  g(b.worldClone, "tag", "-a", TAG, canon, "-m", "settlement: S214 (an earlier hand's)");
  g(b.worldClone, "push", "-q", "origin", `refs/tags/${TAG}`);
  const run = cross(b);
  assert.equal(run.res.status, 0, why(run));
  assert.equal(run.receipt.status, "published", "main published: the printout is not undone by its tag");
  assert.equal(tagOnOrigin(b), canon, "the standing tag did not move");
  assert.equal(run.receipt.tag.status, "refused");
  assert.equal(run.receipt.tag.refused, "tag-conflict");
  assert.equal(run.receipt.record, null, "no record for a settlement whose tag disagrees");
  assert.equal(run.storeWrites, null);
  assert.match(run.escalations ?? "", /FILED tag/);
  assert.equal(historyLines(run)[0].recorded, false);
});

test("a record that fails after the tag: published, tagged, recorded false, a person told — and a retry finishes it under the same number", { skip }, () => {
  const b = bottle({ suiteRed: false });
  const run = cross(b, { PRINTOUT_RECORD: "fail" });
  assert.equal(run.res.status, 0, why(run));
  assert.equal(run.receipt.status, "published");
  assert.equal(tagOnOrigin(b), g(b.origin, "rev-parse", "main"));
  assert.equal(run.receipt.record.status, "refused");
  assert.match(run.escalations ?? "", /FILED tag/);
  assert.equal(historyLines(run)[0].recorded, false);
  // The retry: the store has not recorded it, and its printout already stands on main (the real tool
  // finds it by subject, settlement-printout.mjs § printoutOnMain), so nothing is printed twice: that
  // commit is tagged (already, by the first attempt) and recorded, under the same number.
  const printedAt = g(b.origin, "rev-parse", "main");
  const retry = cross(b, { PRINTOUT_SAYS: "already-on-main" });
  assert.equal(retry.res.status, 0, why(retry));
  assert.equal(retry.receipt.status, "quiet");
  assert.match(retry.receipt.detail, /^S214's printout already stood on main at [0-9a-f]{12} from an earlier attempt; this crossing tagged and recorded it$/);
  assert.equal(retry.receipt.tag.status, "already-tagged", "the same number, the same tag, not a second one");
  assert.equal(retry.receipt.record.status, "recorded");
  assert.equal(retry.storeWrites.trim(), `RECORDED 213 ${printedAt}`, "the record names the first attempt's printout");
  assert.equal(retry.receipt.settlement, SETTLEMENT);
  assert.equal(g(b.origin, "log", "--format=%s", "main").split("\n").filter((s) => s.startsWith("settlement: S214 printout")).length, 1, "one printout commit for one number");
  assert.equal(historyLines(retry)[0].recorded, true);
});

test("a retry AFTER the record finds it already printed: quiet, and neither the tag nor the record is asked again", { skip }, () => {
  const b = bottle({ suiteRed: false });
  const run = cross(b, { PRINTOUT_SAYS: "already-printed" });
  assert.equal(run.res.status, 0, why(run));
  assert.equal(run.receipt.status, "quiet");
  assert.match(run.receipt.detail, /^S214 was already printed at [0-9a-f]{12}; nothing left to do$/);
  assert.equal(calls(run, "tag").length + calls(run, "record").length, 0);
  assert.equal(historyLines(run)[0].recorded, true);
});

test("the harm gate judges the PRINTOUT: its acts are the printout's written and removed marks, over the base before it", { skip }, () => {
  const b = bottle({ suiteRed: false });
  const run = cross(b);
  assert.equal(run.res.status, 0, why(run));
  const gate = run.stubs.find((l) => l.startsWith("harm-gate "));
  assert.ok(gate, "the gate ran");
  assert.match(gate, /ACTS \{"published":\[\{"id":"alpha\/one"\}\],"unpublished":\[\{"id":"alpha\/old"\}\],"withdrawn":\[\],"reframed":\[\]\}/);
  // --base is main after the registry and the photograph, before the printout
  const base = /--base ([0-9a-f]{40})/.exec(gate)[1];
  assert.equal(g(run.clone, "rev-parse", "main^"), base);
  assert.match(gate, /--stakes \S+\/\.git\/printout-stakes\.json/);
  assert.equal(run.receipt.harm.ok, true);
});

test("a quiet or already-printed settlement runs neither the harm gate nor the suite — nothing was printed to judge", { skip }, () => {
  const b = bottle();
  for (const says of ["quiet", "already-printed"]) {
    const run = cross(b, { PRINTOUT_SAYS: says });
    assert.equal(run.res.status, 0, why(run));
    assert.equal(run.stubs.some((l) => l.startsWith("harm-gate ")), false, `${says}: no harm gate`);
    assert.equal(run.receipt.harm, null);
    assert.equal(run.receipt.suite, null, `${says}: no suite`);
    assert.equal(run.escalations, null, `${says}: a red suite fixture it never ran tells nobody`);
  }
});

// ── THE SEALS (POS-1025/d; Wright 2026-11-22 03:26Z) ──────────────────────────────────────────────────────────

test("the crossing PAYS AND SEALS the saved decisions through its docket before anything prints, and pays only on a real crossing: --town-returns with SETTLEMENT_DRY unset, never under any SETTLEMENT_DRY", { skip }, () => {
  const b = bottle({ suiteRed: false });
  const real = cross(b, { SEAL_PAID: "1" });
  assert.equal(real.res.status, 0, why(real));
  const [seal] = real.stubs.filter((l) => l.startsWith("settlement-seal "));
  assert.match(seal, /^settlement-seal --through 213 --town-clone \S+ --town-returns$/);
  assert.ok(real.stubs.indexOf(seal) < real.stubs.findIndex((l) => l.startsWith("settlement-printout print")), "sealed before it prints");
  assert.deepEqual(real.receipt.seal.sealed.map((s) => [s.window, s.settlement, s.town_return?.id]), [[213, 214, "town-return:S214"]], "the receipt names what it paid, under the town's once-only id");
  assert.match(real.res.stderr, /\[settlement-auto\] seal: S214 \(paid 2✦\)/);
  const zero = cross(b, { SETTLEMENT_DRY: "0" });
  assert.match(zero.stubs.find((l) => l.startsWith("settlement-seal ")), /^settlement-seal --through 213 --town-clone \S+$/, "SETTLEMENT_DRY=0: no writer, the gate alone decides");
  const dry = cross(b, { SETTLEMENT_DRY: "1" });
  assert.match(dry.stubs.find((l) => l.startsWith("settlement-seal ")), /^settlement-seal --through 213 --town-clone \S+ --dry-run$/, "DRY: nothing paid or sealed");
  assert.equal(dry.receipt.seal.status, "dry");
});

test("A BLOCKED SETTLEMENT ALARMS LIKE ONE: nothing sealed past it, printed or pushed; the receipt names its removal, its stakers and the reason; class seal-blocked, and a person is told", { skip }, () => {
  const b = bottle({ suiteRed: false });
  const run = cross(b, { SEAL_SAYS: "blocked" });
  assert.equal(run.res.status, 1, why(run));
  assert.equal(run.after, run.before, "origin is as it was");
  assert.equal(calls(run, "print").length + calls(run, "tag").length + calls(run, "record").length, 0, "nothing printed, tagged or recorded");
  assert.equal(run.receipt.status, "refused");
  assert.equal(run.receipt.class, "seal-blocked");
  const blocked = run.receipt.seal.blocked;
  assert.deepEqual([blocked.settlement, blocked.window, blocked.removal, blocked.day], [214, 213, "S214", "2026-10-01"]);
  assert.deepEqual(blocked.held[0].stakers, { "alpha/old-hall": [{ handle: "bo", n: 2 }] }, "its stakers, by name");
  assert.match(blocked.reason, /stamps still stand on alpha\/old-hall \(2✦\)/);
  assert.deepEqual(run.receipt.seal.waiting, [{ window: 214, settlement: 215 }], "and the settlements waiting behind it");
  assert.match(run.receipt.detail, /^the settlement is BLOCKED: S214 \(window 213\) cannot be sealed until its town return clears: stamps still stand/);
  assert.match(run.res.stderr, /SETTLEMENT BLOCKED — its town return is held; nothing is sealed past it and nothing is printed \(TOP PRIORITY: SHIPPING § 9\)/);
  assert.match(run.escalations ?? "", /FILED seal-blocked/);
  assert.equal(historyLines(run)[0].class, "seal-blocked");
});

test("a seal that REFUSES (out of order, a store that went away) prints nothing and says so by name", { skip }, () => {
  const b = bottle({ suiteRed: false });
  const run = cross(b, { SEAL_SAYS: "refused" });
  assert.equal(run.res.status, 1, why(run));
  assert.equal(calls(run, "print").length, 0);
  assert.equal(run.receipt.status, "refused");
  assert.equal(run.receipt.seal.status, "refused");
  assert.match(run.receipt.detail, /^the saved decisions could not be sealed: out-of-order — S214 waits for S213$/);
});
