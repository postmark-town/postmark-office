// THE PUSH IS NOT THE RECEIPT — THE REMOTE TIP IS.
// Born 2026-08-26: a fund receipt's push lost a race with mail traffic, exited
// clean, and the signed row lived only on the box while the exec reported
// success. These stage the race for real: a bare origin, two clones, one of
// which advances origin between the other's commit and its push.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { LOST_RACE, penCommit } from "../src/write.mjs";

const sh = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
function stage() {
  const dir = mkdtempSync(join(tmpdir(), "pen-race-"));
  const origin = join(dir, "origin.git"); const a = join(dir, "a"); const b = join(dir, "b");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, a]);
  writeFileSync(join(a, "ledger.md"), "- row one\n");
  sh(a, "add", "."); sh(a, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "seed");
  sh(a, "push", "-q", "origin", "main");
  execFileSync("git", ["clone", "-q", origin, b]);
  return { origin, a, b };
}

test("a pen push that lands returns the sha that is actually on origin", () => {
  const { a } = stage();
  process.env.TOWN_PUSH = "1";
  appendFileSync(join(a, "ledger.md"), "- row two\n");
  const c = penCommit(a, ["ledger.md"], "row two");
  assert.equal(sh(a, "ls-remote", "origin", "refs/heads/main").split("\t")[0], c,
    "the remote tip IS the returned commit — the receipt the 2026-08-26 incident lacked");
});

test("a pen push that loses the race rebases, lands, and returns the LANDED sha — never the orphan", () => {
  const { a, b } = stage();
  process.env.TOWN_PUSH = "1";
  // b advances origin AFTER a's clone: the race, staged
  appendFileSync(join(b, "other.md"), "mail traffic\n");
  sh(b, "add", "."); sh(b, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "mail");
  sh(b, "push", "-q", "origin", "main");
  appendFileSync(join(a, "ledger.md"), "- row two\n");
  const c = penCommit(a, ["ledger.md"], "row two");
  const remoteTip = sh(a, "ls-remote", "origin", "refs/heads/main").split("\t")[0];
  assert.equal(remoteTip, c, "the returned sha is the rebased one that landed, not the local orphan");
  sh(a, "fetch", "-q", "origin", "main");
  assert.doesNotThrow(() => sh(a, "merge-base", "--is-ancestor", c, "origin/main"));
});

// POS-447: a commit DECIDED against its head (the stamp mint) is never rebased.
// `{ rebase: false }` unmakes it and brings the clone up to the remote's tip,
// so the caller decides again from there.
test("{ rebase: false }: a lost race throws LOST_RACE, unmakes the commit, and leaves the clone at the remote's tip, clean", () => {
  const { a, b } = stage();
  process.env.TOWN_PUSH = "1";
  appendFileSync(join(b, "ledger.md"), "- the other writer's row\n");
  sh(b, "add", "."); sh(b, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "theirs");
  sh(b, "push", "-q", "origin", "main");
  appendFileSync(join(a, "ledger.md"), "- row two\n");
  assert.throws(() => penCommit(a, ["ledger.md"], "row two", { rebase: false }), (e) => e.pen === LOST_RACE);
  assert.equal(sh(a, "rev-parse", "HEAD"), sh(b, "rev-parse", "HEAD"), "the clone stands at the remote's tip");
  assert.equal(sh(a, "status", "--porcelain"), "", "clean: the row it lost with is gone");
});

// The restore's other road (write.mjs § restore): when the clone ALSO held a
// commit of its own that origin lacks, `reset --hard` to it and `rebase
// origin/main` conflicts on a ledger both appended to; the rebase is aborted and
// the clone stands at its recorded head, clean. The caller's next try then loses
// again, and the mint refuses after HEAD_TRIES: a refusal, never a rebased line.
test("{ rebase: false }: a clone holding its own unpushed ledger commit stands at it when the catch-up rebase conflicts", () => {
  const { a, b } = stage();
  process.env.TOWN_PUSH = "1";
  appendFileSync(join(a, "ledger.md"), "- a local row nobody pushed\n");
  sh(a, "add", "."); sh(a, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "local");
  const recorded = sh(a, "rev-parse", "HEAD");
  appendFileSync(join(b, "ledger.md"), "- the other writer's row\n");
  sh(b, "add", "."); sh(b, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "theirs");
  sh(b, "push", "-q", "origin", "main");
  appendFileSync(join(a, "ledger.md"), "- row two\n");
  assert.throws(() => penCommit(a, ["ledger.md"], "row two", { rebase: false }), (e) => e.pen === LOST_RACE);
  assert.equal(sh(a, "rev-parse", "HEAD"), recorded, "the clone stands at its recorded head: the conflicting rebase was aborted");
  assert.equal(sh(a, "status", "--porcelain"), "", "clean");
});
