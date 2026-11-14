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
  // The retry: the store has not recorded it, so the printout prints again; the delta is empty
  // (main already carries it), so it is quiet, and the tag already stands at that commit.
  const retry = cross(b, { PRINTOUT_SAYS: "quiet" });
  assert.equal(retry.res.status, 0, why(retry));
  assert.equal(retry.receipt.tag.status, "already-tagged", "the same number, the same tag, not a second one");
  assert.equal(retry.receipt.record.status, "recorded");
  assert.equal(retry.receipt.settlement, SETTLEMENT);
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
