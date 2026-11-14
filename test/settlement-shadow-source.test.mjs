// settlement-shadow-source.test.mjs — THE REHEARSAL REHEARSES THE CROSSING THE BOX RUNS (2026-09-25; POS-1025).
//
//   node --test test/settlement-shadow-source.test.mjs
//
// The finding this file was born on (2026-09-25 10:23Z): the shadow said WOULD-REFUSE over a git-era
// drawer the box's store crossing never read, because it rehearsed a different crossing than the one
// the box ran. The rule it holds: THE SHADOW REHEARSES THE CROSSING THE BOX RUNS. Since the printout
// (POS-1025) that crossing is the printout's, so the shadow runs the same docket question and the same
// printout, dry, in its own clone; the drawers, the sweep and SETTLEMENT_SOURCE went with the cutover.
//
// Real: deploy/settlement-shadow.sh and deploy/shadow-refs-reset.sh. Stubbed, in the settlement bottle
// (test/helpers/settlement-bottle.mjs): the docket and the printout, which read a store; the world's
// harm gate and suite are the bottle's fixture world's.
//
// THE VERDICT FOLLOWS THE RULINGS: only a refused printout is a would-refuse (it holds the town); a
// harm finding or a red suite is a would-settle with its warning named (POS-1025/c: after the seal
// they only alarm).

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OFFICE, SH_OK, GIT_ENV, g, bottle, originRefs } from "./helpers/settlement-bottle.mjs";

const skip = !SH_OK && "no POSIX sh";
let seq = 0;

function rehearse(b, env = {}) {
  for (const f of ["settlement-shadow.sh", "shadow-refs-reset.sh"]) copyFileSync(join(OFFICE, "deploy", f), join(b.office, "deploy", f));
  const n = ++seq;
  const report = join(b.root, "harbor", `shadow-${n}.json`);
  const stubLog = join(b.root, `shadow-stubs-${n}.log`);
  const before = originRefs(b.origin);
  const res = spawnSync("sh", [join(b.office, "deploy", "settlement-shadow.sh")], {
    encoding: "utf8",
    env: {
      ...process.env, ...GIT_ENV,
      OFFICE_ROOT: b.office, TOWN_CLONE: b.townClone, WORLD_CLONE: b.worldClone,
      SHADOW_CLONE: join(b.root, `shadow-clone-${n}`), SHADOW_REPORT: report,
      WORLD2_CLEARING_URL: "postgres://nobody@127.0.0.1:1/world2_rehearsal",
      STUB_LOG: stubLog, STORE_WRITES: join(b.root, `shadow-store-${n}.log`),
      ...env,
    },
  });
  let verdict = null;
  try { verdict = JSON.parse(readFileSync(report, "utf8")); } catch { /* none */ }
  let stubs = [];
  try { stubs = readFileSync(stubLog, "utf8").split("\n").filter(Boolean); } catch { /* none */ }
  return { res, verdict, stubs, before, after: originRefs(b.origin), clone: join(b.root, `shadow-clone-${n}`) };
}

test("the shadow rehearses the crossing's printout: the newest closed window, printed DRY, nothing committed, nothing pushed", { skip }, () => {
  const b = bottle({ suiteRed: false });
  const r = rehearse(b);
  assert.equal(r.res.status, 0, r.res.stderr);
  assert.equal(r.verdict.status, "would-settle");
  assert.equal(r.verdict.window, 213);
  assert.equal(r.verdict.settlement, 214);
  assert.match(r.verdict.detail, /^S214 \(window 213\) would print 1 written, 1 removed, 0 re-framed over world [0-9a-f]{40}$/);
  assert.match(r.stubs.find((l) => l.startsWith("await-clearing")) ?? "", /--rehearse/, "the shadow's question: the newest closed window");
  const print = r.stubs.find((l) => l.startsWith("settlement-printout print")) ?? "";
  assert.match(print, /--window 213 --dry-run/);
  assert.equal(r.stubs.some((l) => /^settlement-printout (tag|record)/.test(l)), false, "no tag and no record, ever");
  assert.equal(r.after, r.before, "origin is untouched");
  assert.doesNotMatch(g(r.clone, "log", "--format=%s", "main"), /printout/, "and nothing was committed in its own clone");
  assert.equal("source" in r.verdict, false, "the retired source is no field of the verdict");
});

test("a printout that would REFUSE is the shadow's would-refuse, in the printout's own words, and exits 1", { skip }, () => {
  const b = bottle({ suiteRed: false });
  const r = rehearse(b, { PRINTOUT_SAYS: "refused" });
  assert.equal(r.res.status, 1);
  assert.equal(r.verdict.status, "would-refuse");
  assert.match(r.verdict.detail, /^the printout would refuse: reframe-refused — the frame alpha\/old-hall cannot keep alpha\/one exactly/);
});

test("harm and a red suite are WARNINGS on a would-settle (POS-1025/c), named in the verdict", { skip }, () => {
  const b = bottle({ harm: true, suiteRed: true });
  const r = rehearse(b);
  assert.equal(r.res.status, 0, r.res.stderr);
  assert.equal(r.verdict.status, "would-settle");
  assert.match(r.verdict.detail, /WARNINGS: the harm gate would name harm or could not gate \(moved: alpha\/one: moved with no act\) — an alarm, POS-1025\/c; the grammar suite would go red \(1 not ok\) — a warning;/);
});

test("a window whose seal is already printed is a would-settle with nothing to print", { skip }, () => {
  const b = bottle({ suiteRed: false });
  const r = rehearse(b, { PRINTOUT_SAYS: "already-printed" });
  assert.equal(r.res.status, 0, r.res.stderr);
  assert.equal(r.verdict.status, "would-settle");
  assert.match(r.verdict.detail, /^window 213's seal \(S214\) is already-printed; the next crossing prints the next seal$/);
});
