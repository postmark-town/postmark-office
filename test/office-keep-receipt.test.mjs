// office-keep-receipt.test.mjs — the keeping tick leaves exactly ONE receipt per run, naming every step truly (POS-524).
//
//   node --test --test-concurrency=1 test/office-keep-receipt.test.mjs
//
// The SHIPPED TEXT of deploy/office-keep.sh, run whole under dash (the box's
// /bin/sh) or sh, the way test/tick-and-ferry-whole-or-nothing.test.mjs runs
// it. The only edit is the path seam: every absolute path the script names
// (/srv/postmark-office, /srv/postmark-harbor, /var/www/postmark-panes and its
// /tmp prefixes) is moved into this run's own fixture root, and the projection
// asserts none is left. OFFICE_KEEP_LOG and HOUSEHOLD_KEYS_LOG point into the
// same root.
//
// Each run gets a scratch town (a local bare origin plus a clone) and a fake
// office whose every tool is a STUB that keeps only its shell-facing contract
// (an exit code, a ledger append, a line of JSON). The one real module copied
// in is deploy/keep-history.mjs, the writer under test. PATH is ONLY the run's
// own bin: symlinks to a fixed list of real utilities (node, git, mktemp, date,
// cp, cmp, rm, grep, cat, tail, cut, sleep) and a stub flock. Anything else the
// script tried (systemctl, sudo, curl) would not be found and the run would
// fail, so nothing can fall through to a real tool or a real path. No key,
// store, network or production path is touched, and nothing here runs the
// real office-keep.
//
// KEEP_BASELINE_REF=<sha> runs the same tests over that commit's script (the
// baseline-red proof: the train's script leaves no receipt).

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "./helpers/temp-dir.mjs";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = "WHITE_PAGES/stamp-ledger.md";
const GIT_ENV = {
  GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@postmark.invalid",
  GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@postmark.invalid",
  GIT_CONFIG_NOSYSTEM: "1",
};

/** The absolute path of `name` on this process's PATH, or null. */
function which(name) {
  for (const d of String(process.env.PATH || "").split(":")) {
    if (!d) continue;
    try { accessSync(join(d, name), constants.X_OK); return join(d, name); } catch { /* next */ }
  }
  return null;
}
const REAL = ["git", "mktemp", "date", "cp", "cmp", "rm", "grep", "cat", "tail", "cut", "sleep"];
const SH = which("dash") ?? which("sh");
const missing = REAL.filter((n) => !which(n));
const skip = process.platform === "win32" ? "the PATH-only seam needs symlinks and a POSIX shell (CI runs it)"
  : !SH ? "no POSIX shell on this machine"
    : missing.length ? `missing ${missing.join(", ")}` : false;

// ── the stubs: each records its name, then does its one effect, then may hang or refuse ──
const PRELUDE = `
import { appendFileSync } from "node:fs";
const trail = (n) => {
  appendFileSync(process.env.STUB_CALLS, n + "\\n");
  // review-593 a: no child of the tick but the world step may hold a store password
  for (const k of Object.keys(process.env)) if (/^PG_[A-Z0-9_]*_PASSWORD$/.test(k)) appendFileSync(process.env.STUB_CALLS, "LEAK:" + n + ":" + k + "\\n");
};
const outcome = async (n) => {
  if (process.env.STUB_HANG === n) { appendFileSync(process.env.STUB_HANG_MARK, "x"); await new Promise((r) => setTimeout(r, 20000)); }
  if ((process.env.STUB_FAIL || "").split(",").includes(n)) { console.error("stub " + n + ": refused"); process.exit(7); }
};
`;
const plain = (name, effect = "") => `${PRELUDE}\ntrail(${JSON.stringify(name)});\n${effect}\nawait outcome(${JSON.stringify(name)});\n`;

const TOWN_TOOLS = {
  "tools/stamp-verify.mjs": `${PRELUDE}
import { readFileSync } from "node:fs";
trail("verify");
const bad = readFileSync(${JSON.stringify(LEDGER)}, "utf8").split("\\n").findIndex((l) => l.includes("RED"));
if (bad !== -1) { console.log("stamp-ledger verification FAILED: line " + (bad + 1)); process.exit(1); }
`,
  "tools/stamp-mint.mjs": plain("mint", `
if (process.env.STUB_APPEND) for (const r of process.env.STUB_APPEND.split("|")) appendFileSync(${JSON.stringify(LEDGER)}, r + "\\n");`),
  "tools/household-keys.mjs": plain("hhkeys", `
if (!(process.env.STUB_FAIL || "").split(",").includes("hhkeys")) console.log(JSON.stringify({ split_households: [], shared_keys: [] }));`),
};

const OFFICE_FILES = {
  "stamp-key.pem": "not a key\n",
  // POS-341: the arrival check is the office's owed-tolerant verify, the REAL
  // tool, over the town's stub verify above (which records "verify" in the trail)
  "tools/stamp-verify-owed.mjs": readFileSync(join(OFFICE, "tools", "stamp-verify-owed.mjs"), "utf8"),
  "deploy/registry-file.mjs": plain("registry", `
import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], "{}\\n");`),
  "deploy/settle-pass.mjs": plain("settle"),
  "tools/standing-drain.mjs": plain("standing"),
  "tools/gangway-drain.mjs": plain("gangway"),
  // the welcome pass appends its row; STUB_LOCK_INDEX then takes the clone's
  // index lock, so a roll-back's `git reset` cannot run (the roll-back failure)
  "deploy/welcome-pass.mjs": plain("welcome", `
import { join } from "node:path";
import { writeFileSync } from "node:fs";
const town = process.argv[process.argv.indexOf("--town") + 1];
if (process.env.STUB_WELCOME) appendFileSync(join(town, ${JSON.stringify(LEDGER)}), process.env.STUB_WELCOME + "\\n");
if (process.env.STUB_LOCK_INDEX) writeFileSync(join(town, ".git", "index.lock"), "");`),
  "tools/bug-stage-plan.mjs": plain("bugstage"),
  "tools/ballots-backfill.mjs": plain("ballots"),
  // STAMP_LINES=store: the store's mint pass appends and commits its own lines
  "world2/tools/stamp-mint-run.mjs": plain("mint-run", `
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const clone = process.argv[process.argv.indexOf("--clone") + 1];
if (process.env.STUB_APPEND && !(process.env.STUB_FAIL || "").split(",").includes("mint-run")) {
  for (const r of process.env.STUB_APPEND.split("|")) appendFileSync(join(clone, ${JSON.stringify(LEDGER)}), r + "\\n");
  execFileSync("git", ["-C", clone, "commit", "-qam", "mint: store pass"]);
  execFileSync("git", ["-C", clone, "push", "-q"]);
}`),
  "world2/tools/stamp-lines.mjs": plain("sync"),
  // The run prints its four soft steps' lines, as the real tool does (POS-612,
  // POS-627); STUB_<STEP>_FAIL makes one a non-fatal failure, which leaves the
  // run's exit 0. `--soft-step <step>` is softStepStatus's shell contract on
  // that output (stdin): the step's done line (wrote, stocked, restored) → ok,
  // any other line → refused write-failed, no line → notrun. It records no
  // call: it is a reading.
  "world2/tools/settlements-backfill.mjs": `${PRELUDE}
import { readFileSync } from "node:fs";
const at = process.argv.indexOf("--soft-step");
if (at !== -1) {
  const step = process.argv[at + 1];
  const line = readFileSync(0, "utf8").split("\\n").find((l) => l.startsWith(step + ": "));
  const done = ["wrote", "stocked", "restored"].some((w) => line?.startsWith(step + ": " + w + " "));
  console.log(!line ? "notrun" : done ? "ok" : "refused write-failed");
  process.exit(0);
}
trail("settlements");
await outcome("settlements");
console.log("0 rows written");
console.log(process.env.STUB_CARRIED_FAIL ? "carried: NOT recorded (non-fatal) — stub" : "carried: wrote 0; the table holds 0");
console.log(process.env.STUB_CHESTS_FAIL ? "chests: NOT stocked (non-fatal) — stub" : "chests: stocked 0");
console.log(process.env.STUB_AMENDS_FAIL ? "amends: NOT recorded (non-fatal) — stub" : "amends: wrote 0; the table holds 0");
console.log(process.env.STUB_DROPS_FAIL ? "drops: NOT reconciled (non-fatal) — stub" : "drops: restored 0");
`,
  "world2/tools/position-snapshot.mjs": plain("positions", `console.log("positions: none owed");`),
  // The world step (POS-268 5b; review-593 a and c), in shell builtins only, since the run's PATH
  // has no env or sed: it records which store passwords it was handed, and STUB_FAIL=world makes it
  // exit 4 (the credential unreadable).
  "deploy/office-world-hydrate.sh": [
    "#!/bin/sh",
    "echo world >> \"$STUB_CALLS\"",
    ...["PG_WORLD2_OWNER_PASSWORD", "PG_OFFICE_API_PASSWORD", "PG_LAW_INGESTER_PASSWORD", "PG_SNAPSHOT_READER_PASSWORD"]
      .map((k) => "[ -n \"${" + k + ":-}\" ] && echo WORLD-SAW:" + k + " >> \"$STUB_CALLS\""),
    "case \",${STUB_FAIL:-},\" in *,world,*) exit 4;; esac",
    "exit 0",
    "",
  ].join("\n"),
  "deploy/publish-windows.mjs": plain("publish", `
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const out = process.argv[process.argv.indexOf("--out") + 1];
if (!(process.env.STUB_FAIL || "").split(",").includes("publish")) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, "published"), "yes\\n"); }`),
};

// The lock is the box's: fd 9 is the town lock, fd 8 the receipt log's.
const FLOCK_STUB = `#!/bin/sh
fd=""; for a in "$@"; do fd="$a"; done
[ "$fd" = 9 ] && [ -n "$STUB_LOCK_WORK_FAIL" ] && exit 1
[ "$fd" = 8 ] && [ -n "$STUB_LOCK_RECEIPT_FAIL" ] && exit 1
exit 0
`;

const write = (root, files, mode) => {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body, mode ? { mode } : undefined);
  }
};

let scratch = null;
let seq = 0;
/** A fresh fixture: a bare origin and clone with the given ledger, a fake office, a bin, a harbor. */
function fixture(ledger = ["row 1", "row 2"], { realFlock = false } = {}) {
  scratch ??= tempDir("postmark-keep-receipt-");
  const root = join(scratch, `run-${++seq}`);
  const fx = {
    root, origin: join(root, "town.git"), town: join(root, "town"), office: join(root, "office"),
    bin: join(root, "bin"), harbor: join(root, "harbor"), tmp: join(root, "tmp"), panes: join(root, "panes"),
  };
  const g = (...a) => execFileSync(which("git"), a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...GIT_ENV } });
  fx.g = g;
  const seed = join(root, "seed");
  write(seed, { ...TOWN_TOOLS, [LEDGER]: ledger.map((l) => `${l}\n`).join("") });
  g("init", "-q", "-b", "main", seed);
  g("-C", seed, "config", "core.autocrlf", "false");
  g("-C", seed, "add", "-A");
  g("-C", seed, "commit", "-qm", "founding");
  g("init", "-q", "--bare", "-b", "main", fx.origin);
  g("-C", seed, "push", "-q", fx.origin, "main");
  g("clone", "-q", "-c", "core.autocrlf=false", fx.origin, fx.town);
  g("-C", fx.town, "config", "user.email", "pen@postmark.invalid");
  g("-C", fx.town, "config", "user.name", "pen");
  // the box's refusals, on demand: the origin refuses a push, the clone a commit
  write(fx.origin, { "hooks/pre-receive": `#!/bin/sh\n[ -z "$STUB_REJECT_PUSH" ]\n` }, 0o755);
  write(fx.town, { ".git/hooks/pre-commit": `#!/bin/sh\n[ -z "$STUB_REJECT_COMMIT" ]\n` }, 0o755);
  write(fx.office, OFFICE_FILES);
  write(fx.office, { "deploy/keep-history.mjs": readFileSync(join(OFFICE, "deploy", "keep-history.mjs"), "utf8") });
  for (const d of [fx.bin, fx.harbor, fx.tmp]) mkdirSync(d, { recursive: true });
  symlinkSync(process.execPath, join(fx.bin, "node"));
  symlinkSync(SH, join(fx.bin, "sh"));   // the tick runs its world step as `sh deploy/office-world-hydrate.sh`
  for (const n of REAL) symlinkSync(which(n), join(fx.bin, n));
  if (realFlock) symlinkSync(which("flock"), join(fx.bin, "flock"));
  else write(fx.bin, { flock: FLOCK_STUB }, 0o755);
  return fx;
}

/** The script under test: the shipped text (or KEEP_BASELINE_REF's), every absolute path moved into the fixture. */
function projected(fx) {
  const ref = process.env.KEEP_BASELINE_REF;
  let text = ref
    ? execFileSync(which("git"), ["-C", OFFICE, "show", `${ref}:deploy/office-keep.sh`], { encoding: "utf8" })
    : readFileSync(join(OFFICE, "deploy", "office-keep.sh"), "utf8");
  for (const [from, to] of [["/srv/postmark-office", fx.office], ["/srv/postmark-harbor", fx.harbor],
    ["/var/www/postmark-panes", fx.panes], ["/tmp/postmark-tick", join(fx.tmp, "postmark-tick")]]) {
    assert.ok(text.includes(from), `the script no longer names ${from}; the seam would miss it`);
    text = text.replaceAll(from, to);
  }
  // every absolute path left on a line the shell runs (comments may name the box's files) is the fixture's
  const code = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n").replaceAll(fx.root, "FIXTURE");
  const left = code.match(/(?<![\w.-])\/(?:srv|var|etc|tmp|usr|opt|home|root)\/[^\s"']*/g);
  assert.equal(left, null, `the projection left an absolute path: ${left}`);
  const out = join(fx.root, "office-keep.sh");
  writeFileSync(out, text);
  return out;
}

function envFor(fx, extra = {}) {
  return {
    ...GIT_ENV,
    PATH: fx.bin, HOME: fx.root, LANG: "C",
    TOWN_CLONE: fx.town, WORLD_CLONE: fx.town, TOWN_LOCK: join(fx.root, "town.lock"),
    OFFICE_KEEP_LOG: join(fx.harbor, "office-keep.jsonl"),
    HOUSEHOLD_KEYS_LOG: join(fx.harbor, "household-keys.jsonl"),
    STUB_CALLS: join(fx.root, "calls.txt"), STUB_HANG_MARK: join(fx.root, "hanging"),
    ...extra,
  };
}

const run = (fx, extra) => spawnSync(SH, [projected(fx)], { cwd: fx.office, env: envFor(fx, extra), encoding: "utf8", timeout: 120000 });

/** Start the run, wait for the stub named by STUB_HANG to hang, then TERM the whole process group (a stopped unit's cgroup). */
async function runStopped(fx, extra) {
  const child = spawn(SH, [projected(fx)], { cwd: fx.office, env: envFor(fx, extra), detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  const done = new Promise((ok) => child.on("exit", (code, signal) => ok({ code, signal })));
  for (let i = 0; i < 600 && !existsSync(join(fx.root, "hanging")); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(existsSync(join(fx.root, "hanging")), "the stub never reached its hang");
  await new Promise((r) => setTimeout(r, 200));
  process.kill(-child.pid, "SIGTERM");
  const r = await done;
  return { ...r, stderr };
}

const logText = (fx, name = "office-keep.jsonl") => (existsSync(join(fx.harbor, name)) ? readFileSync(join(fx.harbor, name), "utf8") : "");
const receipts = (fx) => logText(fx).split("\n").filter(Boolean).map((l) => JSON.parse(l));
/** The run's ONE receipt: asserts there is exactly one line, and it is keep-v1. */
function receipt(fx) {
  const lines = logText(fx).split("\n").filter(Boolean);
  assert.equal(lines.length, 1, `exactly one receipt per run; the log holds ${lines.length}`);
  const r = JSON.parse(lines[0]);
  assert.equal(r.v, 1);
  assert.equal(r.kind, "office-keep");
  return r;
}
const calls = (fx) => (existsSync(join(fx.root, "calls.txt")) ? readFileSync(join(fx.root, "calls.txt"), "utf8").trim().split("\n") : []);
const status = (fx) => fx.g("-C", fx.town, "status", "--porcelain", "--untracked-files=all").trim();
const published = (fx) => existsSync(join(fx.panes, "live", "published"));
/** No SNAP and no HOLD directory left behind: the cleanup ran after the receipt. */
const tmpLeft = (fx) => readdirSync(fx.tmp);
/** Every step's status as `s` or `s:r`, for one exact comparison. */
const steps = (r) => Object.fromEntries(Object.entries(r.steps).map(([k, v]) => [k, v.r ? `${v.s}:${v.r}` : v.s]));

// The quiet tick with one row owed: everything ok, the switch off.
const GREEN = {
  lock: "ok", pull: "ok", fetch: "ok", registry: "ok", settle: "ok", standing: "ok", gangway: "ok",
  mint: "ok", welcome: "ok", bugstage: "ok", ballots: "ok", verify: "ok", commit: "ok", push: "ok",
  sync: "ok:switch-off", rollback: "ok:not-needed", snapshot: "ok", settlements: "ok", carried: "ok", chests: "ok", amends: "ok", drops: "ok", positions: "ok",
  hhkeys: "ok", hhkeys_log: "ok", world: "ok", publish: "ok",
};
const OWED = { STUB_APPEND: "mint row 3" };

test("all green: one receipt, every step ok, source scheduled, the run's own id, and SNAP cleaned after it", { skip }, () => {
  const fx = fixture();
  const r = run(fx, { ...OWED, INVOCATION_ID: "0123456789abcdef0123456789abcdef" });
  assert.equal(r.status, 0, r.stderr);
  const rec = receipt(fx);
  assert.deepEqual(steps(rec), GREEN);
  assert.equal(rec.source, "scheduled");
  assert.equal(rec.run, "0123456789abcdef0123456789abcdef");
  assert.equal(rec.exit, 0);
  assert.equal(Object.hasOwn(rec, "signal"), false);
  assert.deepEqual(tmpLeft(fx), [], "SNAP and HOLD are gone");
  assert.equal(status(fx), "");
  assert.ok(published(fx));
  assert.doesNotMatch(r.stderr, /RECEIPT NOT WRITTEN/);
});

test("the quiet tick (nothing owed): verify, commit, push and sync are ok with the reason no-change", { skip }, () => {
  const fx = fixture();
  const r = run(fx, {});
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(steps(receipt(fx)), { ...GREEN, verify: "ok:no-change", commit: "ok:no-change", push: "ok:no-change", sync: "ok:no-change" });
});

test("by-hand: POSTMARK_KEEP_SOURCE=by-hand is recorded; an id the log cannot hold becomes `unnamed`, and the line stays JSON", { skip }, () => {
  const fx = fixture();
  const r = run(fx, { POSTMARK_KEEP_SOURCE: "by-hand", INVOCATION_ID: "x\"},{\"source\":\"scheduled" });
  assert.equal(r.status, 0, r.stderr);
  const rec = receipt(fx);
  assert.equal(rec.source, "by-hand");
  assert.equal(rec.run, "unnamed");
  const odd = fixture();
  run(odd, { POSTMARK_KEEP_SOURCE: "cron" });
  assert.equal(receipt(odd).source, "unknown", "a source the writer does not know is written as unknown, never dropped");
});

// Each soft failure alone: the step's own status, every later step still runs and is ok, one receipt, exit 0.
const SOFT = [
  ["registry", { STUB_FAIL: "registry" }, { registry: "refused:exit:7" }],
  ["settle", { STUB_FAIL: "settle" }, { settle: "refused:exit:7" }],
  ["standing", { STUB_FAIL: "standing" }, { standing: "refused:exit:7" }],
  ["gangway", { STUB_FAIL: "gangway" }, { gangway: "refused:exit:7" }],
  ["welcome (its row still lands, a later success)", { STUB_FAIL: "welcome", STUB_WELCOME: "welcome row 4" }, { welcome: "refused:exit:7" }],
  ["bugstage", { STUB_FAIL: "bugstage" }, { bugstage: "refused:exit:7" }],
  ["ballots", { STUB_FAIL: "ballots" }, { ballots: "refused:exit:7" }],
  // a failed run prints no soft-step lines, so carried and amends never ran
  ["settlements", { STUB_FAIL: "settlements" }, { settlements: "refused:exit:7", carried: "notrun", chests: "notrun", amends: "notrun", drops: "notrun" }],
  // POS-612: each soft step's failure leaves the run's exit 0 and settlements ok,
  // and is recorded as its own step so the roll-call can alarm on it
  ["carried (non-fatal: settlements stays ok)", { STUB_CARRIED_FAIL: "1" }, { carried: "refused:write-failed" }],
  ["amends (non-fatal: settlements stays ok)", { STUB_AMENDS_FAIL: "1" }, { amends: "refused:write-failed" }],
  // POS-627: the same for the chest stock and the orphaned set-downs
  ["chests (non-fatal: settlements stays ok)", { STUB_CHESTS_FAIL: "1" }, { chests: "refused:write-failed" }],
  ["drops (non-fatal: settlements stays ok)", { STUB_DROPS_FAIL: "1" }, { drops: "refused:write-failed" }],
  ["positions", { STUB_FAIL: "positions" }, { positions: "refused:exit:7" }],
  ["hhkeys (the predicate left no JSON: the append succeeds, the step is refused)", { STUB_FAIL: "hhkeys" }, { hhkeys: "refused:unchecked" }],
];
for (const [name, env, expect] of SOFT) {
  test(`soft · ${name}: refused in the receipt, later work runs, one receipt, exit 0`, { skip }, () => {
    const fx = fixture();
    const r = run(fx, { ...OWED, ...env });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(steps(receipt(fx)), { ...GREEN, ...expect });
    assert.ok(published(fx), "the panes still published");
    assert.equal(status(fx), "", "the clone ends clean");
    assert.deepEqual(tmpLeft(fx), []);
  });
}

test("soft · hhkeys_log: the household-keys line cannot be written — write-failed, observable apart from the predicate", { skip }, () => {
  const fx = fixture();
  const r = run(fx, { ...OWED, HOUSEHOLD_KEYS_LOG: join(fx.root, "no-such-dir", "household-keys.jsonl") });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(steps(receipt(fx)), { ...GREEN, hhkeys_log: "refused:write-failed" });
  assert.match(r.stderr, /household keys line NOT written/);
});

test("mint · a ledger that arrives red: mint refused ledger-red (exit 0 is not a mint), the passes after it notrun", { skip }, () => {
  const fx = fixture(["row 1", "a line RED since 13:59Z"]);
  const r = run(fx, { ...OWED, STUB_WELCOME: "a welcome" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(steps(receipt(fx)), {
    ...GREEN, mint: "refused:ledger-red", welcome: "notrun", bugstage: "notrun", ballots: "notrun",
    verify: "notrun", commit: "notrun", push: "notrun", sync: "notrun", rollback: "ok:not-needed",
  });
  assert.deepEqual(calls(fx).slice(0, 6), ["registry", "settle", "standing", "gangway", "verify", "settlements"]);
  assert.ok(published(fx));
});

test("mint · the pass cannot make its arrival copy (HOLD): mint refused prep-failed, nothing written, the tick goes on", { skip }, () => {
  const fx = fixture();
  // mktemp refuses ONLY the mint pass's HOLD template; every other call is the real one
  unlinkSync(join(fx.bin, "mktemp"));
  write(fx.bin, { mktemp: `#!/bin/sh\ncase "$*" in *postmark-tick-hold*) [ -n "$STUB_HOLD_FAIL" ] && exit 1;; esac\nexec ${which("mktemp")} "$@"\n` }, 0o755);
  const head = fx.g("-C", fx.town, "rev-parse", "HEAD");
  const r = run(fx, { ...OWED, STUB_HOLD_FAIL: "1" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(steps(receipt(fx)), {
    ...GREEN, mint: "refused:prep-failed", welcome: "notrun", bugstage: "notrun", ballots: "notrun",
    verify: "notrun", commit: "notrun", push: "notrun", sync: "notrun", rollback: "ok:not-needed",
  });
  assert.equal(calls(fx).includes("mint"), false, "nothing was minted without an arrival copy");
  assert.equal(fx.g("-C", fx.town, "rev-parse", "HEAD"), head);
  assert.equal(status(fx), "");
  assert.ok(published(fx));
});

test("mint · the mint itself fails: mint-failed, the roll-back runs, nothing after it in the pass", { skip }, () => {
  const fx = fixture();
  const r = run(fx, { ...OWED, STUB_FAIL: "mint" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(steps(receipt(fx)), {
    ...GREEN, mint: "refused:mint-failed", welcome: "notrun", bugstage: "notrun", ballots: "notrun",
    verify: "notrun", commit: "notrun", push: "notrun", sync: "notrun", rollback: "ok:rolled-back",
  });
  assert.equal(status(fx), "", "the appended row was put back");
  assert.ok(published(fx));
});

test("mint · the verify after the write is red: verify-red, rolled back, nothing committed", { skip }, () => {
  const fx = fixture();
  const head = fx.g("-C", fx.town, "rev-parse", "HEAD");
  const r = run(fx, { ...OWED, STUB_WELCOME: "a welcome the verify refuses: RED" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(steps(receipt(fx)), {
    ...GREEN, verify: "refused:verify-red", commit: "notrun", push: "notrun", sync: "notrun", rollback: "ok:rolled-back",
  });
  assert.equal(fx.g("-C", fx.town, "rev-parse", "HEAD"), head);
  assert.equal(status(fx), "");
  assert.match(r.stderr, /mint catch-up ROLLED BACK/);
});

test("mint · the roll-back itself fails: rollback refused rollback-failed, and the tick still finishes", { skip }, () => {
  const fx = fixture();
  const r = run(fx, { ...OWED, STUB_WELCOME: "RED", STUB_LOCK_INDEX: "1" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(steps(receipt(fx)), {
    ...GREEN, verify: "refused:verify-red", commit: "notrun", push: "notrun", sync: "notrun", rollback: "refused:rollback-failed",
  });
  assert.match(r.stderr, /ROLL-BACK FAILED/);
  assert.ok(published(fx));
});

test("mint · the commit is refused: commit-failed, rolled back, push and sync notrun", { skip }, () => {
  const fx = fixture();
  const r = run(fx, { ...OWED, STUB_REJECT_COMMIT: "1" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(steps(receipt(fx)), { ...GREEN, commit: "refused:commit-failed", push: "notrun", sync: "notrun", rollback: "ok:rolled-back" });
  assert.equal(status(fx), "");
});

test("mint · the push fails AFTER the commit: commit ok, push refused, the local commit stays (no roll-back), sync notrun", { skip }, () => {
  const fx = fixture();
  const pushed = fx.g("-C", fx.origin, "rev-parse", "main");
  const r = run(fx, { ...OWED, STUB_REJECT_PUSH: "1" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(steps(receipt(fx)), { ...GREEN, push: "refused:push-failed", sync: "notrun", rollback: "ok:not-needed" });
  assert.equal(fx.g("-C", fx.origin, "rev-parse", "main"), pushed, "origin did not move");
  assert.notEqual(fx.g("-C", fx.town, "rev-parse", "HEAD"), pushed, "the local commit is kept, as before");
});

test("mint · STAMP_LINES=store: the store's mint and the sync are recorded; a failed sync is sync-failed", { skip }, () => {
  const fx = fixture();
  const r = run(fx, { STAMP_LINES: "store", STUB_APPEND: "store row 3", STUB_WELCOME: "welcome row 4" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(steps(receipt(fx)), { ...GREEN, sync: "ok" });
  assert.ok(calls(fx).includes("mint-run"));
  const bad = fixture();
  const r2 = run(bad, { STAMP_LINES: "store", STUB_APPEND: "store row 3", STUB_WELCOME: "welcome row 4", STUB_FAIL: "sync" });
  assert.equal(r2.status, 0, r2.stderr);
  assert.deepEqual(steps(receipt(bad)), { ...GREEN, sync: "refused:sync-failed" });
  const failed = fixture();
  run(failed, { STAMP_LINES: "store", STUB_APPEND: "store row 3", STUB_FAIL: "mint-run" });
  assert.equal(steps(receipt(failed)).mint, "refused:mint-failed");
});

test("fatal · the pull fails: the tick fails with git's code, and its receipt says pull refused and nothing after it ran", { skip }, () => {
  const fx = fixture();
  const r = run(fx, { TOWN_CLONE: join(fx.root, "not-a-clone") });
  assert.notEqual(r.status, 0);
  const rec = receipt(fx);
  assert.equal(rec.exit, r.status, "the receipt carries the tick's own exit");
  const s = steps(rec);
  assert.equal(s.lock, "ok");
  assert.equal(s.pull, `refused:exit:${r.status}`);
  for (const id of ["fetch", "registry", "mint", "snapshot", "settlements", "hhkeys", "publish"]) assert.equal(s[id], "notrun", id);
  assert.equal(published(fx), false);
  assert.deepEqual(tmpLeft(fx), []);
});

test("fatal · the town lock is not taken: lock refused, exit kept", { skip }, () => {
  const fx = fixture();
  const r = run(fx, { STUB_LOCK_WORK_FAIL: "1" });
  assert.equal(r.status, 1);
  const s = steps(receipt(fx));
  assert.equal(s.lock, "refused:exit:1");
  assert.equal(s.pull, "notrun");
});

test("fatal · the panes publish fails: publish refused, the tick fails as before, the receipt is still written", { skip }, () => {
  const fx = fixture();
  const r = run(fx, { ...OWED, STUB_FAIL: "publish" });
  assert.equal(r.status, 7);
  assert.deepEqual(steps(receipt(fx)), { ...GREEN, publish: "refused:exit:7" });
  assert.equal(receipts(fx)[0].exit, 7);
});

test("TERM while a step runs: one receipt, exit 143, signal TERM, the step and everything after it notrun", { skip }, async () => {
  const fx = fixture();
  const r = await runStopped(fx, { ...OWED, STUB_HANG: "settle" });
  assert.equal(r.code, 143, r.stderr);
  const rec = receipt(fx);
  assert.equal(rec.signal, "TERM");
  assert.equal(rec.exit, 143);
  const s = steps(rec);
  assert.deepEqual([s.lock, s.pull, s.fetch, s.registry], ["ok", "ok", "ok", "ok"]);
  for (const id of ["settle", "mint", "snapshot", "publish"]) assert.equal(s[id], "notrun", id);
  assert.deepEqual(tmpLeft(fx), [], "SNAP removed after the receipt");
});

test("TERM while the mint pass is armed: the roll-back is never reported as not needed", { skip }, async () => {
  const fx = fixture();
  const r = await runStopped(fx, { ...OWED, STUB_HANG: "welcome", STUB_WELCOME: "welcome row 4" });
  assert.equal(r.code, 143, r.stderr);
  const s = steps(receipt(fx));
  assert.equal(s.mint, "ok");
  assert.ok(["ok:rolled-back", "notrun"].includes(s.rollback), `rollback reads ${s.rollback}`);
  // the subshell's own trap puts the clone back (POS-295), whatever the receipt caught of it
  for (let i = 0; i < 100 && status(fx) !== ""; i++) await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(status(fx), "");
});

test("receipt failures are loud and change nothing: the receipt lock not free, its directory missing, the log unwritable", { skip }, () => {
  const fx = fixture();
  const r = run(fx, { ...OWED, STUB_LOCK_RECEIPT_FAIL: "1" });
  assert.equal(r.status, 0, "the tick's exit is its own");
  assert.equal(logText(fx), "", "no receipt");
  assert.match(r.stderr, /RECEIPT NOT WRITTEN — the receipt log's lock was not free within 20 s/);
  assert.ok(published(fx));

  const gone = fixture();
  const r2 = run(gone, { ...OWED, OFFICE_KEEP_LOG: join(gone.root, "no-such-dir", "office-keep.jsonl") });
  assert.equal(r2.status, 0);
  assert.match(r2.stderr, /RECEIPT NOT WRITTEN — .*office-keep\.jsonl\.lock could not be opened/);

  const dir = fixture();
  mkdirSync(join(dir.harbor, "office-keep.jsonl"));
  const r3 = run(dir, { ...OWED });
  assert.equal(r3.status, 0);
  assert.match(r3.stderr, /keep-history: .*EISDIR/);
  assert.match(r3.stderr, /RECEIPT NOT WRITTEN to .*the tick's work is unaffected/);

  // and a fatal tick keeps its fatal exit when its receipt also fails
  const both = fixture();
  const r4 = run(both, { STUB_LOCK_RECEIPT_FAIL: "1", TOWN_CLONE: join(both.root, "not-a-clone") });
  assert.notEqual(r4.status, 0);
  assert.match(r4.stderr, /RECEIPT NOT WRITTEN/);
  for (const f of [fx, gone, dir, both]) assert.deepEqual(tmpLeft(f), []);
});

test("overlapping finishers (the real flock): six ticks finishing at once into one log lose no receipt", { skip: skip || (!which("flock") && "no flock here") }, async () => {
  const runs = Array.from({ length: 6 }, () => fixture(["row 1"], { realFlock: true }));
  const shared = join(runs[0].harbor, "shared.jsonl");
  const ids = runs.map((_, i) => `overlap-${i}`);
  const results = await Promise.all(runs.map((fx, i) => new Promise((ok) => {
    const c = spawn(SH, [projected(fx)], { cwd: fx.office, env: envFor(fx, { OFFICE_KEEP_LOG: shared, INVOCATION_ID: ids[i] }), stdio: "ignore" });
    c.on("exit", (code) => ok(code));
  })));
  assert.deepEqual(results, [0, 0, 0, 0, 0, 0]);
  const lines = readFileSync(shared, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.run).sort(), [...ids].sort(), "every run's receipt, once");
});

// ── THE WORLD STEP: A RECEIPT, AND THE ONLY CHILD WITH A STORE PASSWORD (review-593 a, c) ──

const STORE_PASSWORDS = { PG_WORLD2_OWNER_PASSWORD: "owner", PG_OFFICE_API_PASSWORD: "api", PG_LAW_INGESTER_PASSWORD: "law", PG_SNAPSHOT_READER_PASSWORD: "reader" };

test("review-593 a: the four store passwords reach no child of the tick; the world step alone is handed the law pen's", { skip }, () => {
  const fx = fixture();
  const r = run(fx, { ...OWED, ...STORE_PASSWORDS });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(calls(fx).filter((l) => l.startsWith("LEAK:")), [], "no stub (stamp-verify, stamp-mint, household-keys, every pass) sees a PG_*_PASSWORD");
  assert.deepEqual(calls(fx).filter((l) => l.startsWith("WORLD-SAW:")), ["WORLD-SAW:PG_LAW_INGESTER_PASSWORD"], "the world step: the law pen's, and no other");
  assert.ok(calls(fx).includes("hhkeys") && calls(fx).includes("verify"), "the control: the town-repo tools ran in this run");
  assert.deepEqual(steps(receipt(fx)), GREEN);
});

test("review-593 c: a world step that fails is refused on the receipt with its exit code, and the tick goes on to the panes", { skip }, () => {
  const fx = fixture();
  const r = run(fx, { ...OWED, STUB_FAIL: "world" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(steps(receipt(fx)), { ...GREEN, world: "refused:exit:4" });
  assert.equal(published(fx), true, "the panes still publish");
});
