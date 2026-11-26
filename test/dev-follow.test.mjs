// dev-follow.test.mjs — the dev office follows the open train, and the dev-preview label (POS-1256).
//
// LAW (Darko, 2026-11-26, POS-1256): "yes please set up 1 2 and 3 now and put the new join flow on it".
// The issue's pieces that touch the office:
//   LAW 2: "A merge into train/<week> triggers the dev carry, unless the merge touches that train's
//          DEPLOY.md dev box steps, which still wait for a hand."
//   LAW 3: "a `dev-preview` label on an office or World PR ... Removing the label returns dev to the train.
//          One holder at a time, and the label says who holds dev."
// SHIPPING.md § 3, the dev office bullet: "First, read that train's deploy/DEPLOY.md for dev box steps ...
// If they wait, the carry waits too: code carried without its box steps fails dev's units."
//
// What these read: the pure decisions (.github/scripts/dev-follow-lib.mjs), the CLI over a REAL git repo with
// its trains and a stubbed `gh` (.github/scripts/dev-follow.mjs, the wiring the workflow runs), and the
// workflow's text for the lines no behavioural test reaches (labelled as pins). Nothing here reaches GitHub
// or a box. The box steps themselves (ssh, rsync, the restart) are release-train.yml's, copied; their first
// real run is by hand on dev.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { tempDir } from "./helpers/temp-dir.mjs";
import {
  LABEL, buildReceipt, decide, devBoxStepsChanged, isDevStepsSection, isOpenTrain, newestTrain, parseTrain, sameSha, sectionsOf,
} from "../.github/scripts/dev-follow-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, ".github", "scripts", "dev-follow.mjs");
const WORKFLOW = readFileSync(join(ROOT, ".github", "workflows", "dev-follow.yml"), "utf8");
const RELEASE_TRAIN = readFileSync(join(ROOT, ".github", "workflows", "release-train.yml"), "utf8");
const REPO = "postmark-town/postmark-office";
const NOW = "2026-11-27T12:00:00.000Z";

// ── the open train ──────────────────────────────────────────────────────────
test("the open train is the newest train: week by number, year first, a suffix after its bare week", () => {
  assert.equal(newestTrain(["train/2026-w48", "train/2026-w49"]), "train/2026-w49");
  assert.equal(newestTrain(["train/2026-w9", "train/2026-w10"]), "train/2026-w10", "numbers, not strings: w10 is after w9");
  assert.equal(newestTrain(["train/2026-w52", "train/2027-w1"]), "train/2027-w1", "the year comes first");
  assert.equal(newestTrain(["train/2026-w35", "train/2026-w35b"]), "train/2026-w35b", "a suffix follows its bare week");
  assert.equal(newestTrain(["main", "train/2026-w49", "train/notes", "release/2026-w50", "hotfix/x"]), "train/2026-w49", "only names like a train count");
  assert.equal(newestTrain(["main", "train/notes"]), null);
  assert.equal(newestTrain([]), null);
});

test("a push to the frozen release's train is not the open train, and a lone train is", () => {
  const trains = ["train/2026-w48", "train/2026-w49"];
  assert.equal(isOpenTrain("train/2026-w49", trains), true);
  assert.equal(isOpenTrain("train/2026-w48", trains), false, "the frozen release's train: dev does not follow it");
  assert.equal(isOpenTrain("train/2026-w49", ["train/2026-w49"]), true);
  assert.equal(parseTrain("train/2026-w49").week, 49);
  assert.equal(parseTrain("train/2026-w49/x"), null);
});

// ── the DEPLOY.md dev box steps ─────────────────────────────────────────────
const DOC = [
  "# Deploying", "", "prelude", "",
  "## The weekly train", "", "Feature branches merge into the train; the DEV office runs it.", "",
  "### Dependencies", "", "`npm ci --omit=dev` runs only when the lock moves.", "",
  "### The dev office's own pins (POS-994)", "", "Box steps, on dev only:", "```sh", "# a shell comment, not a heading", "sudo install -m 644 a b", "```", "",
  "### Static keys leave the env file", "", "Run the import BEFORE the train that carries this", "reaches dev, then prod.", "",
  "### Prod store notes", "", "world2_dev is prod's database.", "",
].join("\n");
const withLine = (doc, from, to) => {
  assert.ok(doc.includes(from), `fixture anchor missing: ${from}`);
  return doc.replace(from, () => to);
};

test("a dev section is one whose heading names dev as a word, or whose body says a release reaches dev", () => {
  const heads = sectionsOf(DOC).filter(isDevStepsSection).map((s) => s.heading);
  assert.deepEqual(heads, ["The dev office's own pins (POS-994)", "Static keys leave the env file"],
    "the pins section by heading, the static-keys one by its wrapped 'reaches dev'; not Dependencies (--omit=dev), not the weekly train (the DEV office), not world2_dev");
});

test("a changed dev section reads as changed, in a heading-named and a phrase-named section", () => {
  assert.equal(devBoxStepsChanged(DOC, withLine(DOC, "sudo install -m 644 a b", "sudo install -m 644 a c")).changed, true);
  assert.equal(devBoxStepsChanged(DOC, withLine(DOC, "Run the import BEFORE", "Run the import after")).changed, true);
  const r = devBoxStepsChanged(DOC, withLine(DOC, "sudo install -m 644 a b", "sudo install -m 644 a c"));
  assert.deepEqual(r.sections, ["The dev office's own pins (POS-994)"]);
});

test("a change elsewhere in DEPLOY.md, or in whitespace and line endings only, changes nothing", () => {
  assert.equal(devBoxStepsChanged(DOC, withLine(DOC, "world2_dev is prod's database.", "world2_dev is prod's database, renamed later.")).changed, false, "a prod section");
  assert.equal(devBoxStepsChanged(DOC, withLine(DOC, "`npm ci --omit=dev` runs", "`npm ci --omit=dev` still runs")).changed, false, "a body that only mentions dev");
  assert.equal(devBoxStepsChanged(DOC, DOC.replaceAll("\n", "\r\n")).changed, false, "CRLF");
  assert.equal(devBoxStepsChanged(DOC, withLine(DOC, "Run the import BEFORE the train", "Run the import   BEFORE   the\ntrain")).changed, false, "rewrapped");
  assert.equal(devBoxStepsChanged(DOC, DOC).changed, false);
});

test("a comment line inside a code fence is not a heading: it neither splits a section nor makes one", () => {
  const fenced = withLine(DOC, "# a shell comment, not a heading", "# The dev rehearsal comment inside the fence");
  assert.equal(devBoxStepsChanged(DOC, fenced).changed, true, "the fenced text is the pins section's body, so editing it counts there");
  const outside = ["## A", "```", "# dev heading look-alike", "x", "```", "## B", "body"].join("\n");
  assert.deepEqual(sectionsOf(outside).map((s) => s.heading), ["", "A", "B"], "no section starts inside the fence");
  assert.equal(sectionsOf(outside).some(isDevStepsSection), false);
});

test("a dev section added, removed or reworded between two copies counts, and an absent copy is read as empty", () => {
  const added = `${DOC}\n### The dev seed advance\n\nSteps.\n`;
  assert.deepEqual(devBoxStepsChanged(DOC, added).sections, ["The dev seed advance"]);
  assert.deepEqual(devBoxStepsChanged(added, DOC).sections, ["The dev seed advance"], "removed");
  assert.equal(devBoxStepsChanged(null, DOC).changed, true, "no copy before, dev sections after");
  assert.equal(devBoxStepsChanged(null, null).changed, false);
  const twice = `${DOC}\n### The dev rehearsal\n\nA.\n\n### The dev rehearsal\n\nB.\n`;
  assert.equal(devBoxStepsChanged(twice, twice.replace("\nB.\n", "\nC.\n")).changed, true, "a repeated heading is told apart by its place");
});

test("reads the live deploy/DEPLOY.md: its dev box-steps sections are found, and a one-word edit inside one is seen", () => {
  const live = readFileSync(join(ROOT, "deploy", "DEPLOY.md"), "utf8");
  const heads = sectionsOf(live).filter(isDevStepsSection).map((s) => s.heading);
  for (const known of ["The dev rehearsal (POS-354, POS-366; first run Saturday 2026-10-10)", "The dev office's own pins (POS-994)", "The dev seed advance (POS-791)"]) {
    assert.ok(heads.includes(known), `the live file's dev section is not found: ${known} (found: ${heads.join(" | ")})`);
  }
  assert.ok(heads.length >= 4, `the denominator is ${heads.length} dev sections; the phrase rule should add the static-keys one`);
  const edited = live.replace("sudo systemctl start postmark-dev-freshen.service     # stands back", () => "sudo systemctl start postmark-dev-freshen.service     # EDITED stands back");
  assert.notEqual(edited, live, "the edit anchor exists in the live file");
  assert.equal(devBoxStepsChanged(live, edited).changed, true);
  const prodEdit = live.replace("# Deploying the office to the box (EC2, nginx/Ubuntu)", () => "# Deploying the office to the box (EC2, nginx/Ubuntu) EDITED");
  assert.equal(devBoxStepsChanged(live, prodEdit).changed, false, "the title line is no dev section");
});

// ── shas and the receipt ────────────────────────────────────────────────────
test("sameSha: a full sha and its 7-character prefix are one commit; two different ones, and a too-short prefix, are not", () => {
  const a = "e987b5d" + "0".repeat(33);
  assert.equal(sameSha(a, "e987b5d"), true);
  assert.equal(sameSha("e987b5d", a), true);
  assert.equal(sameSha(a, "e987b5e" + "0".repeat(33)), false);
  assert.equal(sameSha(a, "e987b5"), false, "six characters name nothing");
  assert.equal(sameSha(undefined, a), false);
});

test("the receipt has the five keys release-train.yml writes, in its order, and adds a holder only for a PR", () => {
  const stage = RELEASE_TRAIN.slice(RELEASE_TRAIN.indexOf("writeFileSync(\"stage/release.json\""));
  const keys = [...stage.slice(0, stage.indexOf("}, null, 2)")).matchAll(/^\s+(\w+): /gm)].map((m) => m[1]);
  assert.deepEqual(keys, ["tag", "sha", "deployed_at", "target", "run"], "the workflow's keys, read from it");
  const sha = "a".repeat(40);
  const train = buildReceipt({ tag: "train/2026-w49", sha, runUrl: "https://example.test/run/1", now: NOW });
  assert.deepEqual(Object.keys(train), keys);
  assert.equal(train.target, "dev");
  assert.equal("holder" in train, false, "a train carry has no holder");
  const holder = { pr: 7, by: "a-person", sha, since: NOW, prior: { tag: "train/2026-w49", sha: "b".repeat(40) } };
  const pr = buildReceipt({ tag: "pr/7", sha, runUrl: "https://example.test/run/2", holder, now: NOW });
  assert.deepEqual(Object.keys(pr), [...keys, "holder"]);
  assert.deepEqual(pr.holder, holder);
});

// ── the decision ────────────────────────────────────────────────────────────
const SHA = (c) => c.repeat(40);
const TRAINS = ["train/2026-w48", "train/2026-w49"];
const HEADS = { "train/2026-w48": SHA("1"), "train/2026-w49": SHA("2") };
const clean = () => ({ changed: false, sections: [] });
const dirty = () => ({ changed: true, sections: ["The dev office's own pins (POS-994)"] });
const free = { readable: true, tag: "train/2026-w49", sha: SHA("3"), holder: null };
const HOLDER = { pr: 5, by: "first-labeler", sha: SHA("5"), since: "2026-11-27T09:00:00.000Z", prior: { tag: "train/2026-w49", sha: SHA("3") } };
const held = { readable: true, tag: "pr/5", sha: SHA("5"), holder: HOLDER };
const holderOpen = { number: 5, state: "open", headRepo: REPO, headSha: SHA("5"), labels: [LABEL] };
const pr = (over = {}) => ({ number: 7, state: "open", headSha: SHA("7"), headRepo: REPO, labels: [LABEL], ...over });
const prEvent = (action, over = {}, sender = "second-labeler") => ({ kind: "pr", action, labelName: LABEL, sender, pr: pr(over) });
const run = (over) => decide({
  event: { kind: "push", branch: "train/2026-w49" }, repo: REPO, trains: TRAINS, trainHeads: HEADS, box: free, holderPr: null,
  labelerPermission: "write", stepsChanged: clean, now: NOW, ...over,
});
const asked = () => {
  const calls = [];
  return { calls, fn: (baseline, target) => { calls.push([baseline, target]); return clean(); } };
};

test("a push to the open train carries its head, with the train's name as the tag", () => {
  const r = run({});
  assert.equal(r.status, "carry");
  assert.deepEqual(r.target, { tag: "train/2026-w49", sha: HEADS["train/2026-w49"], ref: "train/2026-w49" });
  assert.equal(r.holder, null);
});

test("a push to the frozen release's train carries nothing, and does not even read the box steps", () => {
  const q = asked();
  const r = run({ event: { kind: "push", branch: "train/2026-w48" }, stepsChanged: q.fn });
  assert.equal(r.status, "noop");
  assert.match(r.reason, /not the open train/);
  assert.deepEqual(q.calls, []);
});

test("a push that changes the dev box steps carries nothing: 'dev waits for a hand', on the merged PR and in the reason", () => {
  const r = run({ stepsChanged: dirty });
  assert.equal(r.status, "wait");
  assert.equal(r.target, null);
  assert.ok(r.reason.startsWith(`dev waits for a hand: DEPLOY.md dev box steps changed in ${HEADS["train/2026-w49"].slice(0, 7)}`), r.reason);
  assert.deepEqual(r.notices.map((n) => [n.to, n.sha, n.when]), [["commit", HEADS["train/2026-w49"], "now"]]);
  assert.match(r.notices[0].body, /dev waits for a hand/);
});

test("the box steps are read against what dev carries, so a push after a held one cannot slip the first one's code in", () => {
  const q = asked();
  run({ stepsChanged: q.fn });
  assert.deepEqual(q.calls, [[SHA("3"), HEADS["train/2026-w49"]]], "baseline = dev's carried sha, target = the head, not the push's parent");
});

test("a push when dev already runs that head carries nothing; an unreadable dev carries nothing and says why", () => {
  assert.equal(run({ box: { ...free, sha: HEADS["train/2026-w49"].slice(0, 7) } }).status, "noop", "a 7-character carried sha is the same commit");
  const r = run({ box: { readable: false } });
  assert.equal(r.status, "wait");
  assert.match(r.reason, /no readable release\.json/);
});

test("while a PR holds dev, a push to the train carries nothing and says who holds it", () => {
  const r = run({ box: held, holderPr: holderOpen });
  assert.equal(r.status, "wait");
  assert.match(r.reason, /held by PR #5 \(labelled by first-labeler\)/);
  assert.equal(r.target, null);
});

test("a holder that has closed, lost its label or moved to a fork no longer holds dev: the train carries, and clears the holder", () => {
  for (const gone of [{ ...holderOpen, state: "closed" }, { ...holderOpen, labels: [] }, { ...holderOpen, headRepo: "someone/fork" }, null]) {
    const q = asked();
    const r = run({ box: held, holderPr: gone, stepsChanged: q.fn });
    assert.equal(r.status, "carry", JSON.stringify(gone));
    assert.equal(r.holder, null);
    assert.deepEqual(q.calls[0][0], SHA("3"), "the baseline is what dev had before the preview, not the preview's commit");
  }
});

test("the label on a free dev carries the PR's head as the holder, who labelled it, and what dev ran before", () => {
  const r = run({ event: prEvent("labeled") });
  assert.equal(r.status, "carry");
  assert.deepEqual(r.target, { tag: "pr/7", sha: SHA("7"), ref: "pull/7/head" });
  assert.deepEqual(r.holder, { pr: 7, by: "second-labeler", sha: SHA("7"), since: NOW, prior: { tag: "train/2026-w49", sha: SHA("3") } });
  assert.deepEqual(r.notices.map((n) => [n.to, n.number, n.when]), [["pr", 7, "after-carry"]]);
  assert.deepEqual(r.unlabel, []);
});

test("a second label while dev is held is refused, names the holder, and takes its own label off", () => {
  const r = run({ event: prEvent("labeled"), box: held, holderPr: holderOpen });
  assert.equal(r.status, "refuse");
  assert.deepEqual(r.unlabel, [7]);
  assert.equal(r.target, null);
  assert.match(r.notices[0].body, /held by PR #5 \(labelled by first-labeler, head 5555555, since 2026-11-27T09:00:00.000Z\)/);
  assert.equal(r.notices[0].number, 7);
  assert.equal(r.notices[0].when, "now");
});

test("a second label is refused even when the label event for the first was dropped and this one is a synchronize", () => {
  const r = run({ event: prEvent("synchronize"), box: held, holderPr: holderOpen });
  assert.equal(r.status, "refuse");
  assert.deepEqual(r.unlabel, [7]);
});

test("a push to the holder PR re-carries the new head, keeping who labelled it and since when", () => {
  const q = asked();
  const r = run({ event: prEvent("synchronize", { number: 5, headSha: SHA("6") }, "someone-who-pushed"), box: held, holderPr: holderOpen, stepsChanged: q.fn });
  assert.equal(r.status, "carry");
  assert.deepEqual(r.target.sha, SHA("6"));
  assert.deepEqual(r.holder, { pr: 5, by: "first-labeler", sha: SHA("6"), since: HOLDER.since, prior: HOLDER.prior });
  assert.deepEqual(q.calls, [[SHA("3"), SHA("6")]], "the baseline stays what dev had before the preview");
  assert.equal(run({ event: prEvent("synchronize", { number: 5, headSha: SHA("5") }), box: held, holderPr: holderOpen }).status, "noop", "the same head again carries nothing");
});

test("removing the label, or closing a merged or unmerged PR, from the holder returns dev to the open train's head", () => {
  for (const action of ["unlabeled", "closed"]) {
    const event = prEvent(action, { number: 5, labels: action === "unlabeled" ? [] : [LABEL], state: action === "closed" ? "closed" : "open" });
    const r = run({ event, box: held, holderPr: holderOpen });
    assert.equal(r.status, "carry", action);
    assert.deepEqual(r.target, { tag: "train/2026-w49", sha: HEADS["train/2026-w49"], ref: "train/2026-w49" });
    assert.equal(r.holder, null);
    assert.deepEqual(r.notices.map((n) => [n.number, n.when]), [[5, "after-carry"]]);
  }
});

test("the label coming off a PR that does not hold dev (the refused one) changes nothing", () => {
  for (const action of ["unlabeled", "closed"]) {
    const r = run({ event: prEvent(action, { number: 7, labels: [] }), box: held, holderPr: holderOpen });
    assert.equal(r.status, "noop", action);
    assert.equal(r.target, null);
  }
});

test("a release whose return to the train would change the dev box steps waits for a hand instead of carrying", () => {
  const r = run({ event: prEvent("unlabeled", { number: 5, labels: [] }), box: held, holderPr: holderOpen, stepsChanged: dirty });
  assert.equal(r.status, "wait");
  assert.match(r.reason, /dev waits for a hand/);
  assert.equal(r.target, null);
  assert.deepEqual(r.notices.map((n) => [n.number, n.when]), [[5, "now"]]);
});

test("a PR that changes the dev box steps is refused on a free dev, and kept on its old head when it already holds dev", () => {
  const fresh = run({ event: prEvent("labeled"), stepsChanged: dirty });
  assert.equal(fresh.status, "refuse");
  assert.deepEqual(fresh.unlabel, [7]);
  const sync = run({ event: prEvent("synchronize", { number: 5, headSha: SHA("6") }), box: held, holderPr: holderOpen, stepsChanged: dirty });
  assert.equal(sync.status, "wait");
  assert.deepEqual(sync.unlabel, []);
  assert.match(sync.notices[0].body, /Dev keeps the previous head, 5555555/);
});

test("a PR from a fork never goes on dev, whatever its labels", () => {
  const r = run({ event: prEvent("labeled", { headRepo: "someone/postmark-office" }) });
  assert.equal(r.status, "refuse");
  assert.deepEqual(r.unlabel, [7]);
  assert.match(r.notices[0].body, /fork never goes on dev/);
  assert.equal(run({ event: prEvent("labeled", { headRepo: null }) }).status, "refuse", "a fork whose repository is gone");
});

test("only someone with write access puts a PR on dev: read, triage, none and an unreadable permission are refused", () => {
  for (const labelerPermission of ["read", "triage", "none", null, undefined]) {
    const r = run({ event: prEvent("labeled"), labelerPermission });
    assert.equal(r.status, "refuse", String(labelerPermission));
    assert.deepEqual(r.unlabel, [7]);
  }
  for (const labelerPermission of ["write", "maintain", "admin"]) assert.equal(run({ event: prEvent("labeled"), labelerPermission }).status, "carry", labelerPermission);
});

test("a PR event that is not about the dev-preview label, an unlabelled PR, or a closed one changes nothing", () => {
  assert.equal(run({ event: { ...prEvent("labeled"), labelName: "stamp-sandbox" } }).status, "noop");
  assert.equal(run({ event: prEvent("synchronize", { labels: ["stamp-sandbox"] }) }).status, "noop", "no dev-preview label");
  assert.equal(run({ event: prEvent("reopened", { state: "closed" }) }).status, "noop");
});

test("an unreadable dev is refused for a label, and a dev with no prior commit waits on the box steps rather than guessing", () => {
  const r = run({ event: prEvent("labeled"), box: { readable: false } });
  assert.equal(r.status, "refuse");
  const noPrior = run({ box: { ...held, holder: { ...HOLDER, prior: null } }, holderPr: null });
  assert.equal(noPrior.status, "wait", "dev's last box-steps state is unknown");
});

// ── the CLI over a real git repo, with a stubbed gh ─────────────────────────
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (dir, ...a) => execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...a], { encoding: "utf8", env: gitEnv }).trim();

/** An origin with main, a frozen train (w48), an open train (w49), and a feature branch; and a clone that holds only the open train. */
const worlds = new Map();
function world(opts) {
  // Built once per shape: every test reads it (each `cli` call writes only its own run folder under `base`).
  if (opts.fresh) return buildWorld(opts); // a test that fetches into the clone gets its own
  const key = String(opts.headChangesDevSteps);
  if (!worlds.has(key)) worlds.set(key, buildWorld(opts));
  return worlds.get(key);
}
function buildWorld({ headChangesDevSteps }) {
  const base = tempDir("dev-follow-");
  const origin = join(base, "origin.git");
  const seed = join(base, "seed");
  const clone = join(base, "clone");
  mkdirSync(seed);
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
  execFileSync("git", ["init", "-q", "-b", "main", seed]);
  const commit = (msg, file, text) => { mkdirSync(join(seed, "deploy"), { recursive: true }); writeFileSync(join(seed, file), text); git(seed, "add", "."); git(seed, "commit", "-qm", msg); return git(seed, "rev-parse", "HEAD"); };
  const c1 = commit("c1", "deploy/DEPLOY.md", DOC);
  git(seed, "remote", "add", "origin", origin);
  git(seed, "branch", "train/2026-w48");
  git(seed, "checkout", "-q", "-b", "train/2026-w49");
  const c2 = commit("c2 prod text", "deploy/DEPLOY.md", withLine(DOC, "world2_dev is prod's database.", "world2_dev is prod's database, again."));
  const head = headChangesDevSteps ? commit("c3 dev steps", "deploy/DEPLOY.md", withLine(DOC, "sudo install -m 644 a b", "sudo install -m 644 a c")) : c2;
  git(seed, "checkout", "-q", "-b", "feature", "main");
  const feature = commit("feature", "feature.txt", "the PR's code\n");
  git(seed, "push", "-q", "origin", "main", "train/2026-w48", "train/2026-w49", "feature");
  execFileSync("git", ["clone", "-q", "--single-branch", "--branch", "train/2026-w49", pathToFileURL(origin).href, clone]); // a file URL, so only reachable objects travel (a path clone copies every object)
  return { base, clone, c1, c2, head, feature };
}

const STUB = [
  'import { appendFileSync, readFileSync } from "node:fs";',
  "const fx = JSON.parse(readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  "const argv = process.argv.slice(2);",
  "const input = argv.includes('--input') ? readFileSync(0, 'utf8') : '';",
  "appendFileSync(process.env.STUB_CALLS, JSON.stringify({ argv, input }) + '\\n');",
  "const path = argv.find((a) => a.startsWith('repos/'));",
  "const method = argv.includes('-X') ? argv[argv.indexOf('-X') + 1] : 'GET';",
  "const key = method + ' ' + path;",
  "if (!(key in fx)) { console.error('stub: no fixture for ' + key); process.exit(1); }",
  "console.log(JSON.stringify(fx[key]));",
].join("\n");

function cli(w, sub, flags, { fixture = {}, event } = {}) {
  const dir = join(w.base, `run-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir);
  writeFileSync(join(dir, "stub.mjs"), STUB);
  writeFileSync(join(dir, "fixture.json"), JSON.stringify(fixture));
  if (event) writeFileSync(join(dir, "event.json"), JSON.stringify(event));
  const out = join(dir, "github-output.txt");
  writeFileSync(out, "");
  const r = spawnSync(process.execPath, [CLI, sub, ...flags(dir)], {
    cwd: w.clone, encoding: "utf8",
    env: { ...gitEnv, DEV_FOLLOW_GH: join(dir, "stub.mjs"), STUB_FIXTURE: join(dir, "fixture.json"), STUB_CALLS: join(dir, "calls.jsonl"), GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: join(dir, "summary.md") },
  });
  const read = (f) => { try { return readFileSync(join(dir, f), "utf8"); } catch { return ""; } };
  const outputs = Object.fromEntries(read("github-output.txt").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  const calls = read("calls.jsonl").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { r, dir, outputs, calls, plan: read("plan.json") ? JSON.parse(read("plan.json")) : null, summary: read("summary.md") };
}
const planFlags = (event, boxJson) => (dir) => {
  if (boxJson !== undefined) writeFileSync(join(dir, "box.json"), JSON.stringify(boxJson));
  return ["--event-name", event.name, "--event-path", join(dir, "event.json"), "--repo", REPO, "--box", join(dir, "box.json"), "--out", join(dir, "plan.json"), "--now", NOW, "--git-dir", "."];
};
const pushEvent = (branch) => ({ name: "push", body: { ref: `refs/heads/${branch}` } });
const prBody = (action, number, headSha, labels, extra = {}) => ({ action, label: { name: LABEL }, sender: { login: "second-labeler" }, pull_request: { number, state: "open", head: { sha: headSha, repo: { full_name: REPO } }, labels: labels.map((name) => ({ name })) }, ...extra });

test("CLI, a push to the open train: the real trains and DEPLOY.md say carry, with full shas in the outputs and the plan", () => {
  const w = world({ headChangesDevSteps: false });
  const ev = pushEvent("train/2026-w49");
  const c = cli(w, "plan", planFlags(ev, { tag: "train/2026-w48", sha: w.c1.slice(0, 7) }), { event: ev.body });
  assert.equal(c.r.status, 0, c.r.stderr);
  assert.equal(c.outputs.carry, "true");
  assert.equal(c.outputs.tag, "train/2026-w49");
  assert.equal(c.outputs.sha, w.head, "the open train's head on origin, in full");
  assert.equal(c.plan.status, "carry");
  assert.match(c.summary, /Dev office: carry/);
});

test("CLI, a push whose DEPLOY.md changes a dev section: nothing carried, the commit's PR is told, the run says it waits", () => {
  const w = world({ headChangesDevSteps: true });
  const ev = pushEvent("train/2026-w49");
  const c = cli(w, "plan", planFlags(ev, { tag: "train/2026-w48", sha: w.c1 }), { event: ev.body });
  assert.equal(c.r.status, 0, c.r.stderr);
  assert.equal(c.outputs.carry, "false");
  assert.equal(c.outputs.status, "wait");
  assert.match(c.r.stdout, /::warning::dev waits for a hand: DEPLOY\.md dev box steps changed in /);
  assert.deepEqual(c.plan.notices.map((n) => n.to), ["commit"]);
});

test("CLI, a push to the frozen release's train: nothing carried; and dev's baseline missing from this clone waits, never guesses", () => {
  const w = world({ headChangesDevSteps: false });
  const frozen = pushEvent("train/2026-w48");
  const f = cli(w, "plan", planFlags(frozen, { tag: "x", sha: w.c1 }), { event: frozen.body });
  assert.equal(f.outputs.carry, "false");
  assert.equal(f.outputs.status, "noop");
  const open = pushEvent("train/2026-w49");
  const gone = cli(w, "plan", planFlags(open, { tag: "x", sha: "deadbee" }), { event: open.body });
  assert.equal(gone.outputs.status, "wait", "a carried commit this repository does not have");
  assert.match(gone.plan.reason, /not in this repository's history/);
});

test("CLI, the label: the PR's head is fetched by its sha (this clone has only the train), carried as the holder, tagged pr/<n>", () => {
  const w = world({ headChangesDevSteps: false, fresh: true });
  assert.notEqual(spawnSync("git", ["-C", w.clone, "cat-file", "-e", `${w.feature}^{commit}`]).status, 0, "the clone does not hold the PR's head before the run");
  const ev = { name: "pull_request", body: prBody("labeled", 7, w.feature, [LABEL]) };
  const fixture = { [`GET repos/${REPO}/collaborators/second-labeler/permission`]: { permission: "write" } };
  const c = cli(w, "plan", planFlags(ev, { tag: "train/2026-w49", sha: w.c2 }), { event: ev.body, fixture });
  assert.equal(c.r.status, 0, c.r.stderr);
  assert.equal(c.outputs.carry, "true");
  assert.equal(c.outputs.tag, "pr/7");
  assert.equal(c.outputs.sha, w.feature);
  assert.deepEqual(c.plan.holder, { pr: 7, by: "second-labeler", sha: w.feature, since: NOW, prior: { tag: "train/2026-w49", sha: w.c2 } });
});

test("CLI, the label while a PR holds dev: refused, and the holder's PR is looked up live, not trusted from the file", () => {
  const w = world({ headChangesDevSteps: false });
  const holder = { pr: 5, by: "first-labeler", sha: w.feature, since: NOW, prior: { tag: "train/2026-w49", sha: w.c2 } };
  const ev = { name: "pull_request", body: prBody("labeled", 7, w.feature, [LABEL]) };
  const fixture = {
    [`GET repos/${REPO}/collaborators/second-labeler/permission`]: { permission: "write" },
    [`GET repos/${REPO}/pulls/5`]: { number: 5, state: "open", head: { sha: w.feature, repo: { full_name: REPO } }, labels: [{ name: LABEL }] },
  };
  const c = cli(w, "plan", planFlags(ev, { tag: "pr/5", sha: w.feature, holder }), { event: ev.body, fixture });
  assert.equal(c.r.status, 0, c.r.stderr);
  assert.equal(c.outputs.status, "refuse");
  assert.equal(c.outputs.carry, "false");
  assert.deepEqual(c.plan.unlabel, [7]);
  assert.ok(c.calls.some((x) => x.argv.includes(`repos/${REPO}/pulls/5`)), "the holder PR was read from GitHub");
  const stale = cli(w, "plan", planFlags(ev, { tag: "pr/5", sha: w.feature, holder }), { event: ev.body, fixture: { ...fixture, [`GET repos/${REPO}/pulls/5`]: { number: 5, state: "closed", head: { sha: w.feature, repo: { full_name: REPO } }, labels: [] } } });
  assert.equal(stale.outputs.status, "carry", "the same file with the holder PR closed on GitHub: dev is free");
});

test("CLI, the holder's label comes off: dev goes back to the open train's head; and a plan whose gh lookup of the holder fails treats dev as free", () => {
  const w = world({ headChangesDevSteps: false });
  const holder = { pr: 5, by: "first-labeler", sha: w.feature, since: NOW, prior: { tag: "train/2026-w49", sha: w.c2 } };
  const ev = { name: "pull_request", body: prBody("unlabeled", 5, w.feature, []) };
  const c = cli(w, "plan", planFlags(ev, { tag: "pr/5", sha: w.feature, holder }), { event: ev.body });
  assert.equal(c.r.status, 0, c.r.stderr);
  assert.equal(c.outputs.tag, "train/2026-w49");
  assert.equal(c.outputs.sha, w.head);
  assert.equal(c.plan.holder, null);
});

test("CLI receipt: the plan becomes the stage's release.json, with the holder for a PR and without one for a train", () => {
  const w = world({ headChangesDevSteps: false });
  const holder = { pr: 7, by: "x", sha: w.feature, since: NOW, prior: { tag: "t", sha: w.c2 } };
  const mk = (extra) => (dir) => {
    writeFileSync(join(dir, "plan.json"), JSON.stringify({ status: "carry", target: { tag: extra ? "pr/7" : "train/2026-w49", sha: w.feature }, holder: extra ? holder : null }));
    return ["--plan", join(dir, "plan.json"), "--run", "https://example.test/run/9", "--out", join(dir, "release.json")];
  };
  for (const withHolder of [true, false]) {
    const c = cli(w, "receipt", mk(withHolder));
    assert.equal(c.r.status, 0, c.r.stderr);
    const written = JSON.parse(readFileSync(join(c.dir, "release.json"), "utf8"));
    assert.equal(written.run, "https://example.test/run/9");
    assert.equal(written.target, "dev");
    assert.equal("holder" in written, withHolder);
  }
  const none = cli(w, "receipt", (dir) => { writeFileSync(join(dir, "plan.json"), JSON.stringify({ status: "wait" })); return ["--plan", join(dir, "plan.json"), "--run", "u", "--out", join(dir, "release.json")]; });
  assert.notEqual(none.r.status, 0, "a plan that carries nothing writes no receipt");
});

test("CLI notify: the refusal comments on the PR and takes the label off; the carried notice waits for after the carry", () => {
  const w = world({ headChangesDevSteps: false });
  const plan = {
    status: "refuse", unlabel: [7],
    notices: [{ when: "now", to: "pr", number: 7, body: "Dev is held." }, { when: "after-carry", to: "pr", number: 7, body: "Dev runs this." }, { when: "now", to: "commit", sha: w.c2, body: "waits" }],
  };
  const fixture = {
    [`GET repos/${REPO}/issues/7/comments`]: [[{ id: 99, body: "an unrelated comment", user: { type: "User" } }]],
    [`POST repos/${REPO}/issues/7/comments`]: {},
    [`DELETE repos/${REPO}/issues/7/labels/${LABEL}`]: {},
    [`GET repos/${REPO}/commits/${w.c2}/pulls`]: [{ number: 3 }],
    [`POST repos/${REPO}/issues/3/comments`]: {},
  };
  const flags = (when) => (dir) => { writeFileSync(join(dir, "plan.json"), JSON.stringify(plan)); return ["--plan", join(dir, "plan.json"), "--repo", REPO, "--when", when]; };
  const now = cli(w, "notify", flags("now"), { fixture });
  assert.equal(now.r.status, 0, now.r.stderr);
  const posted = now.calls.filter((c) => c.argv.includes("POST")).map((c) => [c.argv.find((a) => a.startsWith("repos/")), JSON.parse(c.input).body]);
  assert.deepEqual(posted.map((p) => p[0]), [`repos/${REPO}/issues/7/comments`, `repos/${REPO}/issues/3/comments`]);
  assert.match(posted[0][1], /^<!-- dev-preview-holder -->\nDev is held\.$/, "the PR comment is the sticky one");
  assert.ok(now.calls.some((c) => c.argv.includes("DELETE") && c.argv.includes(`repos/${REPO}/issues/7/labels/${LABEL}`)), "the label is taken off");
  assert.equal(posted.some((p) => /Dev runs this/.test(p[1])), false, "the after-carry notice is not posted yet");
  const after = cli(w, "notify", flags("after-carry"), { fixture });
  assert.equal(after.r.status, 0, after.r.stderr);
  assert.deepEqual(after.calls.filter((c) => c.argv.includes("POST")).map((c) => JSON.parse(c.input).body), ["<!-- dev-preview-holder -->\nDev runs this."]);
  assert.equal(after.calls.some((c) => c.argv.includes("DELETE")), false, "no label is touched after a carry");
});

test("CLI notify updates the one sticky comment in place when it is already there", () => {
  const w = world({ headChangesDevSteps: false });
  const plan = { notices: [{ when: "now", to: "pr", number: 7, body: "Newer." }], unlabel: [] };
  const fixture = {
    [`GET repos/${REPO}/issues/7/comments`]: [[{ id: 41, body: "<!-- dev-preview-holder -->\nOlder.", user: { type: "Bot" } }]],
    [`PATCH repos/${REPO}/issues/comments/41`]: {},
  };
  const c = cli(w, "notify", (dir) => { writeFileSync(join(dir, "plan.json"), JSON.stringify(plan)); return ["--plan", join(dir, "plan.json"), "--repo", REPO, "--when", "now"]; }, { fixture });
  assert.equal(c.r.status, 0, c.r.stderr);
  assert.equal(c.calls.filter((x) => x.argv.includes("POST")).length, 0, "no second comment");
  assert.match(c.calls.find((x) => x.argv.includes("PATCH")).input, /Newer\./);
});

// ── the workflow's text: pins, labelled as such ─────────────────────────────
// TEXT PINS (the weakest instrument; the behaviour above is what they stand beside). They read what no
// behavioural test here reaches: the triggers, the fork guard, the concurrency, the dev-only target.
const code = WORKFLOW.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

test("pin: the workflow runs on pushes to train/** and on the PR label events, and never on pull_request_target", () => {
  assert.match(code, /^on:\n {2}push:\n {4}branches: \["train\/\*\*"\]\n {2}pull_request:\n {4}types: \[labeled, unlabeled, synchronize, reopened, closed\]/m);
  assert.doesNotMatch(code, /pull_request_target/);
  assert.doesNotMatch(code, /workflow_dispatch/, "no manual door onto dev from here: the hand carry and release-train.yml's dispatch are those");
});

test("pin: the job skips a fork's PR and any PR event that is not about dev-preview, before it takes the dev lock", () => {
  assert.match(code, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(code, /github\.event\.label\.name == 'dev-preview'/);
  assert.match(code, /contains\(github\.event\.pull_request\.labels\.\*\.name, 'dev-preview'\)/);
  const job = code.slice(code.indexOf("  carry:"));
  assert.ok(job.indexOf("if: >-") < job.indexOf("concurrency:"), "the job's `if` is above its concurrency, and the concurrency is the job's, not the workflow's");
  assert.doesNotMatch(code.slice(0, code.indexOf("jobs:")), /concurrency:/, "a workflow-level group would queue every skipped PR event");
});

test("pin: one dev deploy at a time on release-train.yml's dev group, and never cancelling a running one", () => {
  assert.match(code, /concurrency:\n {6}group: office-deploy-dev\n {6}cancel-in-progress: false/);
  assert.match(RELEASE_TRAIN, /group: office-deploy-\$\{\{ github\.event\.inputs\.target \|\| 'prod' \}\}/, "the group name it shares is the one release-train.yml computes for its dev dispatch");
  assert.doesNotMatch(code, /cancel-in-progress: true/);
});

test("pin: the target is dev's root, service and port, fixed in the file, never an input or a prod value", () => {
  assert.match(code, /DEV_ROOT: \/srv\/postmark-office-dev\n {2}DEV_SERVICE: postmark-office-dev\n {2}DEV_PORT: "4381"/);
  assert.doesNotMatch(code, /\/srv\/postmark-office(?!-dev)\b/, "no prod root");
  assert.doesNotMatch(code, /\b4380\b/, "no prod port");
  assert.doesNotMatch(code, /github\.event\.inputs|inputs\./, "nothing here is chosen by an input");
  assert.doesNotMatch(code, /refs\/tags|git (tag|push)/, "no tag is cut and nothing is pushed");
});

test("pin: the permissions are contents read and pull-requests write, and the box secrets are used by name", () => {
  assert.match(code, /^permissions:\n {2}contents: read\n {2}pull-requests: write\n/m);
  assert.deepEqual([...new Set([...code.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]))].sort(), ["EC2_HOST", "EC2_SSH_KEY", "EC2_USER"]);
  assert.match(code, /OFFICE_DEV_FOLLOW/, "the adoption gate");
});

test("pin: the box's deploy script is taken from main and its preflight is called with the sha and the hand-carry event", () => {
  assert.match(code, /git show refs\/remotes\/origin\/main:deploy\/remote-deploy\.sh/);
  assert.match(code, /'\$REMOTE' preflight '\$DEV_ROOT' '\$DEV_SERVICE' '\$DEV_PORT' '\$SHA' '\$EVENT'/);
  assert.match(code, /EVENT: hand-carry/);
  const sync = code.slice(code.indexOf("- name: Copy the commit onto dev"), code.indexOf("- name: Restart and probe"));
  assert.match(sync, /rsync -az --exclude='\/\*\/'/, "root files without --delete");
  assert.match(sync, /rsync -az --delete/, "the repo-owned directories with it");
  assert.match(code, /grep -vx -e telemetry -e \.github -e \.omc/, "the three names the release train never syncs");
});

test("pin: a PR event checks out the base branch's scripts, not the PR's, and archives with LF endings", () => {
  assert.match(code, /ref: \$\{\{ github\.event\.pull_request\.base\.ref \|\| github\.sha \}\}/);
  assert.match(code, /git -c core\.autocrlf=false -c core\.eol=lf archive "\$SHA"/);
});
