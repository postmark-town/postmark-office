// ferry-witness.test.mjs — POS-907: the ferry unit owes and publishes every
// crossing's witness record, and the witness never changes a crossing's outcome.
//
//   node --test --test-timeout=180000 test/ferry-witness.test.mjs
//
// LAW (Darko, 2026-11-06, POS-907/c, "Keep running"): "if a record fails to
//   publish, the town keeps running and the record is owed. Nothing is rolled
//   back. Quiet and refused crossings get records too."
//
// WHAT RUNS: the SHIPPED `ExecStart` script of deploy/postmark-ferry.service,
// joined as systemd joins it, with `/srv/postmark-office` moved to a fixture
// office root and `/usr/bin/node` to `node` (as test/tick-and-ferry-whole-or-
// nothing.test.mjs runs it). The town's tools are STUBS with the one contract
// the shell reads from each; the witness stub records every call, with the
// clone's cleanliness at that moment, and exits as told. What is under test is
// the shell's control flow around the town's tools/witness-chain.mjs, whose own
// behaviour is the town's suite (town tools/witness-chain.test.mjs).
//
// Runs under `dash` where it exists (the box's /bin/sh), else `sh`; where
// neither is a real shell the file SKIPS rather than passes.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "postmark-ferry-witness-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }); } catch { /* litter */ } });

const works = (shell) => spawnSync(shell, ["-c", "true"], { stdio: "ignore" }).status === 0;
const SH = works("dash") ? "dash" : works("sh") ? "sh" : null;
const skip = SH ? false : "no POSIX shell on this machine";
const fwd = (p) => p.replace(/\\/g, "/");

const LEDGER = "WHITE_PAGES/stamp-ledger.md";
const GIT_ENV = {
  GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@postmark.invalid",
  GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@postmark.invalid",
};

const CALLS = `
import { appendFileSync } from "node:fs";
export const call = (line) => { if (process.env.STUB_CALLS) appendFileSync(process.env.STUB_CALLS, line + "\\n"); };
`;
const TOWN_TOOLS = {
  "tools/stub-calls.mjs": CALLS,
  "tools/stamp-verify.mjs": `
import { readFileSync } from "node:fs";
import { call } from "./stub-calls.mjs";
call("verify");
if (readFileSync("${LEDGER}", "utf8").includes("RED")) { console.error("✗ stamp-ledger verification FAILED"); process.exit(1); }
`,
  // The mint appends to the working-tree ledger, uncommitted, as the real one does
  // before its verify; a RED row then leaves the clone dirty when verify refuses.
  "tools/stamp-mint.mjs": `
import { appendFileSync } from "node:fs";
import { call } from "./stub-calls.mjs";
call("mint");
if (process.env.STUB_APPEND) appendFileSync("${LEDGER}", process.env.STUB_APPEND + "\\n");
`,
  // The ferry's shell-facing contract here: it is passed --report <path>, and
  // writes what it did there (town tools/ferry.mjs § the crossing's report).
  "tools/ferry.mjs": `
import { writeFileSync } from "node:fs";
import { call } from "./stub-calls.mjs";
const a = process.argv;
const report = a.includes("--report") ? a[a.indexOf("--report") + 1] : null;
call("ferry " + (report ? "--report " + report : "(no report)"));
if (report) writeFileSync(report, JSON.stringify({ ran: true, crossing: 293, delivered: 0, bounced: 0 }) + "\\n");
process.exit(Number(process.env.STUB_FERRY_EXIT || 0));
`,
  "tools/quest-progress.mjs": `import { call } from "./stub-calls.mjs"; call("quests");\n`,
  "PROJECTS/the-town-seal/seal.mjs": `import { call } from "../../tools/stub-calls.mjs"; call("seal");\n`,
  "PROJECTS/the-town-seal/verify.mjs": `import { call } from "../../tools/stub-calls.mjs"; call("seal-verify");\n`,
  // THE WITNESS, stubbed: records its verb and arguments, whether the clone was
  // clean when it was called, and exits with STUB_WITNESS_<VERB>_EXIT.
  "tools/witness-chain.mjs": `
import { execFileSync } from "node:child_process";
import { call } from "./stub-calls.mjs";
const [verb, ...rest] = process.argv.slice(2);
const repo = rest[rest.indexOf("--repo") + 1];
const dirty = execFileSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" }).trim();
call("witness " + verb + " " + rest.join(" ") + (dirty ? " [DIRTY CLONE]" : " [clean clone]"));
process.exit(Number(process.env["STUB_WITNESS_" + verb.replace("-", "_").toUpperCase() + "_EXIT"] || 0));
`,
  "TOWN_BULLETIN/quests.md": "quests at the founding\n",
  "PROJECTS/the-town-seal/seal.json": "{\"seal\":\"founding\"}\n",
};
const OFFICE_FILES = {
  "stamp-key.pem": "not a key\n",
  "tools/stamp-verify-owed.mjs": readFileSync(join(OFFICE, "tools", "stamp-verify-owed.mjs"), "utf8"),
  "tools/town-drain-run.mjs": `process.exit(Number(process.env.STUB_DRAIN_EXIT || 0));\n`,
  "tools/ballot-pass-run.mjs": `process.exit(0);\n`,
  "world2/tools/stamp-lines.mjs": `process.exit(0);\n`,
  "deploy/town-index-ingest.sh": "exit 0\n",
};

let seq = 0;
const write = (root, files) => {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
};

function fixture({ ledger = ["row 1"], witnessTool = true } = {}) {
  const root = join(scratch, `run-${++seq}`);
  const origin = join(root, "town.git");
  const seed = join(root, "seed");
  const town = join(root, "town");
  const office = join(root, "office");
  const g = (...a) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...GIT_ENV } });
  const tools = { ...TOWN_TOOLS };
  if (!witnessTool) delete tools["tools/witness-chain.mjs"];
  write(seed, { ...tools, [LEDGER]: ledger.map((l) => `${l}\n`).join("") });
  g("init", "-q", "-b", "main", seed);
  g("-C", seed, "config", "core.autocrlf", "false");
  g("-C", seed, "add", "-A");
  g("-C", seed, "commit", "-qm", "founding");
  g("init", "-q", "--bare", "-b", "main", origin);
  g("-C", seed, "push", "-q", origin, "main");
  g("clone", "-q", "-c", "core.autocrlf=false", origin, town);
  write(office, OFFICE_FILES);
  return { root, town, office };
}

/** The ferry's ExecStart payload, joined the way systemd joins it. */
function ferryPayload() {
  const unit = readFileSync(join(OFFICE, "deploy", "postmark-ferry.service"), "utf8");
  const line = unit.replace(/\\\n/g, " ").split("\n").find((l) => l.startsWith("ExecStart="));
  const m = /\/bin\/sh -c '([^']*)'\s*$/.exec(line ?? "");
  assert.ok(m, "the ExecStart is no longer `flock … /bin/sh -c '<script>'`");
  return m[1];
}

function runFerry(fx, extra = {}) {
  const script = ferryPayload().replaceAll("/usr/bin/node", "node").replaceAll("/srv/postmark-office", fwd(fx.office));
  const res = spawnSync(SH, ["-c", script], {
    cwd: fx.office, encoding: "utf8", timeout: 120000,
    env: { ...process.env, ...GIT_ENV, TOWN_CLONE: fwd(fx.town), STUB_CALLS: join(fx.root, "calls.txt"), INVOCATION_ID: "inv-1", ...extra },
  });
  const calls = existsSync(join(fx.root, "calls.txt")) ? readFileSync(join(fx.root, "calls.txt"), "utf8").trim().split("\n") : [];
  return { ...res, calls, witness: calls.filter((c) => c.startsWith("witness ")) };
}

const CONFIGURED = (fx) => ({ WITNESS_KEY: join(fx.root, "witness-key.pem"), WITNESS_OWED: join(fx.root, "owed") });

test("payload: the witness lines carry nothing systemd would expand before sh reads them", () => {
  const p = ferryPayload();
  assert.doesNotMatch(p, /%/, "a percent sign is a systemd specifier");
  assert.doesNotMatch(p, /\$\{/, "a braced dollar is systemd's variable");
  assert.match(p, /witness "\$rc"/, "the witness rides the exit trap");
});

test("NOT CONFIGURED: no witness key, no witness call; the crossing is what it was", { skip }, () => {
  const fx = fixture();
  const r = runFerry(fx);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.witness, []);
  assert.match(r.stderr, /\[witness\] not configured \(WITNESS_KEY, WITNESS_OWED\): this crossing owes no record/);
});

test("A CLEAN CROSSING is owed with its stage and exit, from a clean clone, and then published", { skip }, () => {
  const fx = fixture();
  const env = CONFIGURED(fx);
  const r = runFerry(fx, env);
  assert.equal(r.status, 0, r.stderr);
  const ferry = r.calls.find((c) => c.startsWith("ferry "));
  const report = ferry.replace("ferry --report ", "");
  assert.notEqual(report, "(no report)", "the ferry is asked for its report");
  assert.equal(r.witness.length, 2, r.calls.join("\n"));
  assert.equal(r.witness[0], `witness owe-mail --repo ${fwd(fx.town)} --owed ${env.WITNESS_OWED} --attempt ferry-inv-1 --exit 0 --stage done --ferry-report ${report} [clean clone]`);
  assert.equal(r.witness[1], `witness publish --repo ${fwd(fx.town)} --owed ${env.WITNESS_OWED} --key ${env.WITNESS_KEY} [clean clone]`);
  assert.equal(r.calls.at(-1), r.witness[1], "the witness is the last thing the crossing does");
});

test("A REFUSED CROSSING is witnessed too: the stage it stopped at, its exit, after the clone is put back; the exit stays the refusal's", { skip }, () => {
  const fx = fixture();
  const r = runFerry(fx, { ...CONFIGURED(fx), STUB_APPEND: "a minted row the verify refuses: RED" });
  assert.equal(r.status, 1, "the crossing's own refusal is unchanged");
  assert.ok(r.calls.includes("mint"), "the refused step wrote first, so the clone was dirty when it refused");
  assert.match(r.witness[0], /^witness owe-mail .* --exit 1 --stage verify .*\[clean clone\]$/, r.calls.join("\n"));
  assert.match(r.witness[1], /^witness publish /);
  assert.match(r.stderr, /a gate refused \(exit 1\)/);
});

test("A CROSSING REFUSED AT THE DRAIN names the drain, before any mail moved", { skip }, () => {
  const fx = fixture();
  const r = runFerry(fx, { ...CONFIGURED(fx), STUB_DRAIN_EXIT: "1" });
  assert.equal(r.status, 1);
  assert.ok(!r.calls.some((c) => c.startsWith("ferry ")), "the ferry never ran");
  assert.match(r.witness[0], /--exit 1 --stage drain /);
});

test("KEEP RUNNING: a witness that cannot owe or publish changes nothing about the crossing", { skip }, () => {
  const fx = fixture();
  const r = runFerry(fx, { ...CONFIGURED(fx), STUB_WITNESS_OWE_MAIL_EXIT: "1", STUB_WITNESS_PUBLISH_EXIT: "3" });
  assert.equal(r.status, 0, 'LAW: "the town keeps running"');
  assert.equal(r.witness.length, 2, "publish still runs after a failed owe: older owed records are still paid");
  assert.match(r.stderr, /\[witness\] the outcome of this crossing could not be owed/);
  assert.match(r.stderr, /\[witness\] the record is owed, not published: the next crossing or settlement pays it/);

  const refused = fixture({ ledger: ["a RED line"] });
  const rr = runFerry(refused, { ...CONFIGURED(refused), STUB_WITNESS_PUBLISH_EXIT: "1" });
  assert.equal(rr.status, 1, "and a refused crossing keeps its own exit when the witness fails as well");
});

test("A TOWN CLONE WITHOUT THE WITNESS TOOL (before the town half ships) is a no-op, said once", { skip }, () => {
  const fx = fixture({ witnessTool: false });
  const r = runFerry(fx, CONFIGURED(fx));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.witness, []);
  assert.match(r.stderr, /the town clone has no tools\/witness-chain\.mjs yet: no record/);
});
