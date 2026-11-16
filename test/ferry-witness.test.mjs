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
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { sealSkip, startSealSocket, stopSealSockets } from "./helpers/seal-socket.mjs";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "postmark-ferry-witness-"));
after(() => { stopSealSockets(); try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }); } catch { /* litter */ } });

const works = (shell) => spawnSync(shell, ["-c", "true"], { stdio: "ignore" }).status === 0;
const SH = works("dash") ? "dash" : works("sh") ? "sh" : null;
const skip = SH ? false : "no POSIX shell on this machine";
// A crossing that gets past the quests reaches the seal stage, which needs the socket stand-in (POSIX only).
const fskip = skip || sealSkip;
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
  // THE WITNESS, stubbed: records its verb and arguments, whether the clone was
  // clean when it was called, and exits with STUB_WITNESS_<VERB>_EXIT.
  "tools/witness-chain.mjs": `
import { execFileSync } from "node:child_process";
import { call } from "./stub-calls.mjs";
const [verb, ...rest] = process.argv.slice(2);
const repo = rest.includes("--repo") ? rest[rest.indexOf("--repo") + 1] : process.env.TOWN_CLONE;
const dirty = execFileSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" }).trim();
call("witness " + verb + " " + rest.join(" ") + (dirty ? " [DIRTY CLONE]" : " [clean clone]"));
process.exit(Number(process.env["STUB_WITNESS_" + verb.replace("-", "_").toUpperCase() + "_EXIT"] || 0));
`,
  "TOWN_BULLETIN/quests.md": "quests at the founding\n",
  "PROJECTS/the-town-seal/seal.json": "{\"seal\":\"founding\"}\n",
  "PROJECTS/the-town-seal/the-town-seal.html": "<p>founding</p>\n",
  "WHITE_PAGES/mail-ledger.md": "the mail ledger at the founding\n",
};
// POS-988: the seal pair runs in the sandbox, which is sent only its own four
// files and no environment, so these stubs stand alone and take their orders
// from a control file at a fixed path that runFerry() writes. They rewrite the
// two outputs unchanged, as a mail-less crossing's real seal does.
const sealStubs = (ctl) => ({
  "PROJECTS/the-town-seal/seal.mjs": `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const ctl = existsSync(${JSON.stringify(ctl)}) ? JSON.parse(readFileSync(${JSON.stringify(ctl)}, "utf8")) : {};
if (ctl.calls) appendFileSync(ctl.calls, "seal\\n");
writeFileSync("PROJECTS/the-town-seal/seal.json", readFileSync("PROJECTS/the-town-seal/seal.json"));
writeFileSync("PROJECTS/the-town-seal/the-town-seal.html", "<p>founding</p>\\n");
`,
  "PROJECTS/the-town-seal/verify.mjs": `
import { appendFileSync, existsSync, readFileSync } from "node:fs";
const ctl = existsSync(${JSON.stringify(ctl)}) ? JSON.parse(readFileSync(${JSON.stringify(ctl)}, "utf8")) : {};
if (ctl.calls) appendFileSync(ctl.calls, "seal-verify\\n");
process.exit(Number(ctl.verifyExit || 0));
`,
});
const OFFICE_FILES = {
  "stamp-key.pem": "not a key\n",
  // POS-988: the real client, which sends the seal to the socket stand-in
  "tools/town-seal-sandbox.mjs": readFileSync(join(OFFICE, "tools", "town-seal-sandbox.mjs"), "utf8"),
  "tools/stamp-verify-owed.mjs": readFileSync(join(OFFICE, "tools", "stamp-verify-owed.mjs"), "utf8"),
  // STUB_DRAIN_HANG names a marker: the drain writes it and then hangs, so a test
  // can kill the crossing mid-run, as an OOM or a stop timeout would.
  "tools/town-drain-run.mjs": `
import { writeFileSync } from "node:fs";
if (process.env.STUB_DRAIN_HANG) { writeFileSync(process.env.STUB_DRAIN_HANG, "draining\\n"); await new Promise((r) => setTimeout(r, 60000)); }
process.exit(Number(process.env.STUB_DRAIN_EXIT || 0));
`,
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

// THE TOWN'S REAL WITNESS, for the cases that need its queue and publisher. It
// is the town's code and not in this office's pinned town-clone until the town
// half ships, so those cases SKIP, saying so, unless POSTMARK_TOWN_WITNESS_TREE
// names a town tree that has it.
const TOWN_TREE = process.env.POSTMARK_TOWN_WITNESS_TREE || join(OFFICE, "town-clone");
const REAL_FILES = ["tools/witness-chain.mjs", "tools/stamp-mint.mjs", "tools/crossings.mjs", "PROJECTS/the-town-seal/seal.mjs"];
const realSkip = !SH ? "no POSIX shell on this machine"
  : !existsSync(join(TOWN_TREE, "tools", "witness-chain.mjs")) ? `skipped until the town's witness ships: no tools/witness-chain.mjs in ${TOWN_TREE} (set POSTMARK_TOWN_WITNESS_TREE)` : false;

function fixture({ ledger = ["row 1"], witnessTool = true, realWitness = false } = {}) {
  const root = join(scratch, `run-${++seq}`);
  const origin = join(root, "town.git");
  const seed = join(root, "seed");
  const town = join(root, "town");
  const office = join(root, "office");
  const g = (...a) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...GIT_ENV } });
  const tools = { ...TOWN_TOOLS, ...sealStubs(fwd(join(root, "seal-ctl.json"))) };
  if (!witnessTool || realWitness) delete tools["tools/witness-chain.mjs"];
  let key = null;
  if (realWitness) {
    for (const f of REAL_FILES) tools[f] = readFileSync(join(TOWN_TREE, f), "utf8");
    // the real stamp-mint replaces the stub; the mint step's stub is not needed here
    const pair = () => generateKeyPairSync("ed25519");
    const witness = pair();
    tools["WITNESS/witness-pubkey.pem"] = witness.publicKey.export({ type: "spki", format: "pem" });
    tools["tools/stamp-pubkey.pem"] = pair().publicKey.export({ type: "spki", format: "pem" });
    key = join(root, "witness-key.pem");
    mkdirSync(root, { recursive: true });
    writeFileSync(key, witness.privateKey.export({ type: "pkcs8", format: "pem" }));
  }
  write(seed, { ...tools, [LEDGER]: ledger.map((l) => `${l}\n`).join("") });
  g("init", "-q", "-b", "main", seed);
  g("-C", seed, "config", "core.autocrlf", "false");
  g("-C", seed, "add", "-A");
  g("-C", seed, "commit", "-qm", "founding");
  g("init", "-q", "--bare", "-b", "main", origin);
  g("-C", seed, "push", "-q", origin, "main");
  g("clone", "-q", "-c", "core.autocrlf=false", origin, town);
  write(office, OFFICE_FILES);
  return { root, origin, town, office, key };
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
  fx.sealSocket ??= startSealSocket(join(fx.root, "seal.sock"));
  writeFileSync(join(fx.root, "seal-ctl.json"), JSON.stringify({ calls: join(fx.root, "calls.txt"), verifyExit: extra.STUB_SEAL_VERIFY_EXIT }));
  const script = ferryPayload().replaceAll("/usr/bin/node", "node").replaceAll("/srv/postmark-office", fwd(fx.office));
  const res = spawnSync(SH, ["-c", script], {
    cwd: fx.office, encoding: "utf8", timeout: 120000,
    env: { ...process.env, ...GIT_ENV, TOWN_CLONE: fwd(fx.town), STUB_CALLS: join(fx.root, "calls.txt"), INVOCATION_ID: "inv-1", TOWN_SEAL_SOCKET: fx.sealSocket, ...extra },
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

test("NOT CONFIGURED: no witness key, no witness call; the crossing is what it was", { skip: fskip }, () => {
  const fx = fixture();
  const r = runFerry(fx);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.witness, []);
  assert.match(r.stderr, /\[witness\] not configured \(WITNESS_KEY, WITNESS_OWED\): this crossing owes no record/);
});

test("A CLEAN CROSSING is owed with its stage and exit, from a clean clone, and then published", { skip: fskip }, () => {
  const fx = fixture();
  const env = CONFIGURED(fx);
  const r = runFerry(fx, env);
  assert.equal(r.status, 0, r.stderr);
  const ferry = r.calls.find((c) => c.startsWith("ferry "));
  const report = ferry.replace("ferry --report ", "");
  assert.notEqual(report, "(no report)", "the ferry is asked for its report");
  assert.equal(r.witness.length, 3, r.calls.join("\n"));
  assert.equal(r.witness[0], `witness owe-open --owed ${env.WITNESS_OWED} --kind mail-crossing --attempt ferry-inv-1 [clean clone]`);
  assert.equal(r.calls[0], r.witness[0], "the crossing is owed before it does anything (Rivet's FIX: an outcome must never vanish)");
  assert.equal(r.witness[1], `witness owe-mail --repo ${fwd(fx.town)} --owed ${env.WITNESS_OWED} --attempt ferry-inv-1 --exit 0 --stage done --ferry-report ${report} [clean clone]`);
  assert.equal(r.witness[2], `witness publish --repo ${fwd(fx.town)} --owed ${env.WITNESS_OWED} --key ${env.WITNESS_KEY} [clean clone]`);
  assert.equal(r.calls.at(-1), r.witness[2], "the witness is the last thing the crossing does");
});

test("A REFUSED CROSSING is witnessed too: the stage it stopped at, its exit, after the clone is put back; the exit stays the refusal's", { skip }, () => {
  const fx = fixture();
  const r = runFerry(fx, { ...CONFIGURED(fx), STUB_APPEND: "a minted row the verify refuses: RED" });
  assert.equal(r.status, 1, "the crossing's own refusal is unchanged");
  assert.ok(r.calls.includes("mint"), "the refused step wrote first, so the clone was dirty when it refused");
  assert.match(r.witness[1], /^witness owe-mail .* --exit 1 --stage verify .*\[clean clone\]$/, r.calls.join("\n"));
  assert.match(r.witness[2], /^witness publish /);
  assert.match(r.stderr, /a gate refused \(exit 1\)/);
});

test("A CROSSING REFUSED AT THE DRAIN names the drain, before any mail moved", { skip }, () => {
  const fx = fixture();
  const r = runFerry(fx, { ...CONFIGURED(fx), STUB_DRAIN_EXIT: "1" });
  assert.equal(r.status, 1);
  assert.ok(!r.calls.some((c) => c.startsWith("ferry ")), "the ferry never ran");
  assert.match(r.witness[0], /^witness owe-open /, "opened before the drain");
  assert.match(r.witness[1], /--exit 1 --stage drain /);
});

// POS-988: the seal runs in its sandbox, and stays a stage of the crossing, so a
// refusal there is the crossing's refusal at `seal`, witnessed after the undo.
test("A CROSSING REFUSED AT THE SANDBOXED SEAL is witnessed at the seal stage, after the clone is put back", { skip: fskip }, () => {
  const fx = fixture();
  const r = runFerry(fx, { ...CONFIGURED(fx), STUB_SEAL_VERIFY_EXIT: "1" });
  assert.equal(r.status, 1, "the sandbox's refusal is the crossing's");
  assert.ok(r.calls.includes("seal") && r.calls.includes("seal-verify"), r.calls.join("\n"));
  assert.match(r.stderr, /\[seal\] the sandboxed seal refused at verify \(exit 1\)/);
  assert.match(r.witness[1], /^witness owe-mail .* --exit 1 --stage seal .*\[clean clone\]$/, r.calls.join("\n"));
  assert.match(r.witness[2], /^witness publish /);
});

test("KEEP RUNNING: a witness that cannot owe or publish changes nothing about the crossing", { skip: fskip }, () => {
  const fx = fixture();
  const r = runFerry(fx, { ...CONFIGURED(fx), STUB_WITNESS_OWE_MAIL_EXIT: "1", STUB_WITNESS_PUBLISH_EXIT: "3" });
  assert.equal(r.status, 0, 'LAW: "the town keeps running"');
  assert.deepEqual(r.witness.map((c) => c.split(" ")[1]), ["owe-open", "owe-mail", "owe-incomplete", "publish"],
    "a crossing whose outcome cannot be composed is owed as incomplete, then published: it never vanishes");
  assert.match(r.witness[2], /--kind mail-crossing --attempt ferry-inv-1 --why owe-mail failed after stage done, exit 0/);
  assert.match(r.stderr, /\[witness\] the outcome of this crossing could not be composed: it is owed as incomplete/);
  assert.match(r.stderr, /\[witness\] the record is owed, not published: the next crossing or settlement pays it/);

  const refused = fixture({ ledger: ["a RED line"] });
  const rr = runFerry(refused, { ...CONFIGURED(refused), STUB_WITNESS_PUBLISH_EXIT: "1" });
  assert.equal(rr.status, 1, "and a refused crossing keeps its own exit when the witness fails as well");
});

test(`A CROSSING KILLED MID-RUN (SIGKILL: no trap runs) leaves its open entry, and the next publish records it as incomplete${realSkip ? ` (${realSkip})` : ""}`, { skip: realSkip }, async () => {
  const fx = fixture({ realWitness: true });
  const owedDir = join(fx.root, "owed");
  const marker = join(fx.root, "draining");
  const script = ferryPayload().replaceAll("/usr/bin/node", "node").replaceAll("/srv/postmark-office", fwd(fx.office));
  const child = spawn(SH, ["-c", script], {
    cwd: fx.office,
    env: { ...process.env, ...GIT_ENV, TOWN_CLONE: fwd(fx.town), INVOCATION_ID: "inv-killed", WITNESS_KEY: fx.key, WITNESS_OWED: owedDir, STUB_DRAIN_HANG: marker },
  });
  const exited = new Promise((ok) => child.on("exit", (code, signal) => ok(signal)));
  for (let i = 0; i < 200 && !existsSync(marker); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(existsSync(marker), "the crossing reached its drain");
  child.kill("SIGKILL");
  assert.equal(await exited, "SIGKILL");

  const entries = readdirSync(owedDir).filter((n) => n.endsWith(".json"));
  assert.equal(entries.length, 1, "the run's debt survived its death");
  const open = JSON.parse(readFileSync(join(owedDir, entries[0]), "utf8"));
  assert.deepEqual([open.state, open.kind, open.attempt, open.holder.pid], ["open", "mail-crossing", "ferry-inv-killed", child.pid], "held by the unit's own shell");

  const pub = spawnSync(process.execPath, [join(fx.town, "tools", "witness-chain.mjs"), "publish", "--repo", fx.town, "--owed", owedDir, "--key", fx.key], { encoding: "utf8" });
  assert.equal(pub.status, 0, pub.stderr);
  const record = JSON.parse(execFileSync("git", ["-C", fx.origin, "show", "main:WITNESS/records/00000001.json"], { encoding: "utf8" }));
  assert.deepEqual([record.body.decided.kind, record.body.decided.attempt, record.body.decided.outcome.status], ["mail-crossing", "ferry-inv-killed", "incomplete"],
    'LAW: "the record is owed" — the crossing that died is in the chain, said to be incomplete');
});

test("A TOWN CLONE WITHOUT THE WITNESS TOOL (before the town half ships) is a no-op, said once", { skip: fskip }, () => {
  const fx = fixture({ witnessTool: false });
  const r = runFerry(fx, CONFIGURED(fx));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.witness, []);
  assert.match(r.stderr, /the town clone has no tools\/witness-chain\.mjs yet: no record/);
});
