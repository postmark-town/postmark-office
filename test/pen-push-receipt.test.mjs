// THE PUSH IS NOT THE RECEIPT — THE REMOTE TIP IS.
// Born 2026-08-26: a fund receipt's push lost a race with mail traffic, exited
// clean, and the signed row lived only on the box while the exec reported
// success. These stage the race for real: a bare origin, two clones, one of
// which advances origin between the other's commit and its push.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync, appendFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { LOST_RACE, NOT_LANDED, penCommit } from "../src/write.mjs";

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

// ── POS-922: ITS OWN COMMIT, OR A TRUTHFUL REFUSAL (Wright's review of #955) ──
//
// The pen names the commit it made: found by its message on its base, carried
// through a rebase by its change. It must never take a read that FAILED for an
// absence, and so tell a resident "nothing was recorded, safe to make again"
// over a write that may stand; and never take another write with the same
// message for its own. Each case stages one of those for real: a hook is the
// other writer, and a commit object moved aside is the read that fails.
const hook = (repo, name, body) => writeFileSync(join(repo, ".git", "hooks", name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
const objectOf = (sha) => `.git/objects/$(echo ${sha} | cut -c1-2)/$(echo ${sha} | cut -c3-)`;
const aside = () => join(mkdtempSync(join(tmpdir(), "pen-aside-")), "object");
/** The machinery's throw (an exec trip, logged), not the pen's no-effect refusal. */
const notTheSafeRefusal = (e) => !!e && e.pen !== NOT_LANDED && !/safe to make again|nothing was recorded/.test(String(e.hint ?? ""));
const addsRowTwo = (repo, c) => sh(repo, "diff", `${c}^`, c, "--", "ledger.md").split("\n").includes("+- row two");

test("POS-922: its own commit unreadable as it looks for it (local pen): the pen throws to the machinery, never 'nothing was recorded, safe to make again'", () => {
  const { a } = stage();
  delete process.env.TOWN_PUSH;
  const moved = aside();
  // the other writer commits on top of the pen's commit; then the pen's own
  // commit object cannot be read (the clone holds it: HEAD's parent names it)
  hook(a, "post-commit", `[ -e "${moved}" ] && exit 0
git log -1 --format=%s | grep -qx "row two" || exit 0
own=$(git rev-parse HEAD)
echo paper > paper.md && git add paper.md && git -c user.name=p -c user.email=p@p commit -qm "paper: on top"
mv "${objectOf("$own")}" "${moved}"`);
  appendFileSync(join(a, "ledger.md"), "- row two\n");
  let thrown;
  try { penCommit(a, ["ledger.md"], "row two"); } catch (e) { thrown = e; }
  assert.ok(existsSync(moved), "the hook ran: the pen's own commit was unreadable when it looked for it");
  assert.ok(notTheSafeRefusal(thrown), `a read that failed is no absence: ${thrown?.hint ?? thrown?.message ?? "it answered a sha"}`);
});

test("POS-922: its landing unreadable (pushing pen, the ancestry read fails): the pen throws to the machinery, never the safe-to-repeat refusal", () => {
  const { a } = stage();
  process.env.TOWN_PUSH = "1";
  const moved = aside();
  // at the push, another writer resets the clone (as `restore` does), and the
  // pen's commit object becomes unreadable: the push cannot send it, and
  // `merge-base --is-ancestor` then fails (exit 128), not "no" (1). The clone
  // itself stays readable, so the pen's own restore runs and the answer is the
  // ancestry read's.
  hook(a, "pre-push", `read lref lsha rref rsha
[ -e "${moved}" ] && exit 0
git log -1 --format=%s "$lsha" | grep -qx "row two" || exit 0
git reset -q --hard HEAD~1
mv "${objectOf("$lsha")}" "${moved}"
exit 0`);
  appendFileSync(join(a, "ledger.md"), "- row two\n");
  let thrown;
  try { penCommit(a, ["ledger.md"], "row two"); } catch (e) { thrown = e; }
  assert.ok(existsSync(moved), "the hook ran");
  assert.ok(notTheSafeRefusal(thrown), `an ancestry read that failed is no "not landed": ${thrown?.hint ?? thrown?.message ?? "it answered a sha"}`);
});

test("POS-922: a missing intermediate commit is an unread landing, even when git answers exit 1 with stderr", () => {
  const { a, b } = stage();
  process.env.TOWN_PUSH = "1";
  const moved = aside();
  // The other writer lands this write beneath two commits. Both ends remain
  // readable, but the middle disappears before the receipt's ancestry read.
  hook(a, "pre-push", `read lref lsha rref rsha
[ -e "${moved}" ] && exit 1
(
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
git -C "${b}" fetch -q "${a}" HEAD && git -C "${b}" reset -q --hard FETCH_HEAD || exit 1
echo middle > "${b}/paper.md"
git -C "${b}" add paper.md && git -C "${b}" -c user.name=p -c user.email=p@p commit -qm middle || exit 1
echo tip >> "${b}/paper.md"
git -C "${b}" add paper.md && git -C "${b}" -c user.name=p -c user.email=p@p commit -qm tip || exit 1
git -C "${b}" push -q origin main
) || exit 1
git fetch -q origin main || exit 1
git merge-base --is-ancestor "$lsha" origin/main || exit 1
middle=$(git rev-parse origin/main^)
git reset -q --hard "$lsha^"
mv "${objectOf("$middle")}" "${moved}"
exit 1`);
  appendFileSync(join(a, "ledger.md"), "- row two\n");
  let thrown;
  try { penCommit(a, ["ledger.md"], "row two"); } catch (e) { thrown = e; }
  assert.ok(existsSync(moved), "the hook removed the intermediate commit after proving the write landed");
  const middle = sh(b, "rev-parse", "HEAD^");
  try {
    for (const sha of [sh(b, "rev-parse", "HEAD~2"), sh(b, "rev-parse", "HEAD")])
      assert.doesNotThrow(() => sh(a, "cat-file", "-e", `${sha}^{commit}`), "both ancestry endpoints are readable");
    assert.ok(notTheSafeRefusal(thrown), `a missing middle is unknown, not absent: ${thrown?.hint ?? thrown?.message ?? "it answered a sha"}`);
    assert.match(thrown.message, /merge-base --is-ancestor/, "the receipt's ancestry read, not another failed command, threw");
    assert.match(String(thrown.stderr), /Could not read/, "git disclosed the unread intermediate commit");
  } finally {
    renameSync(moved, join(a, ".git", "objects", middle.slice(0, 2), middle.slice(2)));
  }
});

test("POS-922: its change unreadable after the rebase dropped it as already upstream: the pen throws to the machinery, never the safe-to-repeat refusal", () => {
  const { a, b } = stage();
  process.env.TOWN_PUSH = "1";
  // the same change reaches origin first, so the rebase drops the pen's copy
  appendFileSync(join(b, "ledger.md"), "- row two\n");
  sh(b, "add", "."); sh(b, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "the same row, upstream first");
  sh(b, "push", "-q", "origin", "main");
  const moved = aside();
  // the rebase's checkout of the remote's tip: the commit it left ($1) becomes unreadable
  hook(a, "post-checkout", `[ -e "${moved}" ] && exit 0
git log -1 --format=%s "$1" | grep -qx "row two" || exit 0
mv "${objectOf("$1")}" "${moved}"`);
  appendFileSync(join(a, "ledger.md"), "- row two\n");
  let thrown;
  try { penCommit(a, ["ledger.md"], "row two"); } catch (e) { thrown = e; }
  assert.ok(existsSync(moved), "the hook ran in the rebase");
  assert.ok(notTheSafeRefusal(thrown), `a change that could not be read is no "not upstream": ${thrown?.hint ?? thrown?.message ?? "it answered a sha"}`);
});

/** The other writer: once, right after the pen's commit, a commit of its own on top WITH THE SAME MESSAGE and another change. */
function sameMessageOnTop(a) {
  const marker = aside();
  hook(a, "post-commit", `[ -e "${marker}" ] && exit 0
git log -1 --format=%s | grep -qx "row two" || exit 0
: > "${marker}"
echo paper > paper.md && git add paper.md && git -c user.name=p -c user.email=p@p commit -qm "row two"`);
  return marker;
}

test("POS-922: a same-message commit on top, both rebased: the pen answers the commit that carries ITS change, not the first message that matches", () => {
  const { a, b } = stage();
  process.env.TOWN_PUSH = "1";
  appendFileSync(join(b, "other.md"), "mail traffic\n");
  sh(b, "add", "."); sh(b, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "mail");
  sh(b, "push", "-q", "origin", "main");
  const marker = sameMessageOnTop(a);
  appendFileSync(join(a, "ledger.md"), "- row two\n");
  const c = penCommit(a, ["ledger.md"], "row two");
  assert.ok(existsSync(marker), "the other writer committed on top, with the same message");
  assert.ok(addsRowTwo(a, c), `LAW (POS-922): the answer is this write's own change — ${c.slice(0, 8)} must add its row, not the other write's paper`);
  sh(a, "fetch", "-q", "origin", "main");
  assert.doesNotThrow(() => sh(a, "merge-base", "--is-ancestor", c, "origin/main"), "and it is landed");
});

test("POS-922: a same-message commit on top, the pen's own dropped as already upstream: the pen answers the upstream commit with its change, never the same-message one", () => {
  const { a, b } = stage();
  process.env.TOWN_PUSH = "1";
  appendFileSync(join(b, "ledger.md"), "- row two\n");
  sh(b, "add", "."); sh(b, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "the same row, upstream first");
  sh(b, "push", "-q", "origin", "main");
  const upstream = sh(b, "rev-parse", "HEAD");
  const marker = sameMessageOnTop(a);
  appendFileSync(join(a, "ledger.md"), "- row two\n");
  const c = penCommit(a, ["ledger.md"], "row two");
  assert.ok(existsSync(marker), "the other writer committed on top, with the same message");
  assert.equal(c, upstream, `LAW (POS-922): its change landed as ${upstream.slice(0, 8)}; it answered ${c.slice(0, 8)}, which adds ${addsRowTwo(a, c) ? "its row" : "no row of its"}`);
});
