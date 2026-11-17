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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "./helpers/temp-dir.mjs";
import { fileURLToPath } from "node:url";
import { sealSkip, startSealSocket, stopSealSockets } from "./helpers/seal-socket.mjs";
import { MODULES, collect, manifest } from "../tools/town-pins.mjs";
import { startToolSocket, stopToolSockets } from "./helpers/town-tool-socket.mjs";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = tempDir("postmark-ferry-witness-");
after(() => { stopSealSockets(); stopToolSockets(); try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }); } catch { /* litter */ } });

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

// POS-994: the ferry, the verify and the quests run in the town-tool sandbox,
// whose tools see PATH, HOME and TOWN_TZ only, so the stubs read their orders
// from the environment merged with an orders file at a fixed path (__ORDERS__,
// filled in per fixture) that runFerry() writes from the same STUB_ values.
const ORDERS = `
import { existsSync, readFileSync } from "node:fs";
export const O = { ...process.env, ...(existsSync("__ORDERS__") ? JSON.parse(readFileSync("__ORDERS__", "utf8")) : {}) };
`;
const CALLS = `
import { appendFileSync } from "node:fs";
import { O } from "./stub-orders.mjs";
export const call = (line) => { if (O.STUB_CALLS) appendFileSync(O.STUB_CALLS, line + "\\n"); };
`;
const TOWN_TOOLS = {
  "tools/stub-orders.mjs": ORDERS,
  "tools/stub-calls.mjs": CALLS,
  // POS-994: the verifier's public key is pinned with it, and the office verifies with the pinned one
  "tools/stamp-pubkey.pem": "a stub public key\n",
  "tools/stamp-verify.mjs": `
import { readFileSync } from "node:fs";
import { call } from "./stub-calls.mjs";
call("verify");
if (readFileSync("${LEDGER}", "utf8").includes("RED")) { console.error("✗ stamp-ledger verification FAILED"); process.exit(1); }
// POS-994: the office runs the pinned verifier's library (src/stamp-verify-pinned.mjs); green here
export function verifyStampLedger() { return { ok: true, lines: 1, minted: 0, notes: [] }; }
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
  // POS-994: it runs --no-git in the sandbox; the client hands the report on.
  "tools/ferry.mjs": `
import { writeFileSync } from "node:fs";
import { call } from "./stub-calls.mjs";
import { O } from "./stub-orders.mjs";
const a = process.argv;
const report = a.includes("--report") ? a[a.indexOf("--report") + 1] : null;
call("ferry " + (a.includes("--no-git") ? "--no-git " : "") + (report ? "--report" : "(no report)"));
if (report) writeFileSync(report, JSON.stringify({ ran: true, crossing: 293, town_sha: null, date: "2026-11-15", delivered: 0, bounced: 0, committed: false, pushed: false, files: [] }) + "\\n");
process.exit(Number(O.STUB_FERRY_EXIT || 0));
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
  // POS-994: the real client, which runs the town's ferry, verify and quests through the socket stand-in
  "tools/town-tool-sandbox.mjs": readFileSync(join(OFFICE, "tools", "town-tool-sandbox.mjs"), "utf8"),
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
  const orders = fwd(join(root, "orders.json"));
  const tools = { ...Object.fromEntries(Object.entries(TOWN_TOOLS).map(([k, v]) => [k, v.replaceAll("__ORDERS__", orders)])), ...sealStubs(fwd(join(root, "seal-ctl.json"))) };
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
  // POS-994: the unit runs the town's modules through the office's loader, as
  // the office's pinned copies. The fake office carries the real loader and pins
  // of THIS fixture's town files, so the shell's control flow runs as on the
  // box: the stubs, checked equal and run from the pins.
  write(office, {
    "src/town-tool.mjs": readFileSync(join(OFFICE, "src", "town-tool.mjs"), "utf8"),
    "src/stamp-verify-pinned.mjs": readFileSync(join(OFFICE, "src", "stamp-verify-pinned.mjs"), "utf8"),
  });
  const present = MODULES.filter((m) => tools[`tools/${m}`] !== undefined);
  const pinned = collect((p) => Buffer.from(tools[p]), present);
  for (const [p, { bytes }] of pinned) write(join(office, "src", "town-pins"), { [p]: bytes });
  write(join(office, "src", "town-pins"), { "PINS.json": JSON.stringify(manifest(pinned, { townCommit: "f".repeat(40), readAt: "2026-11-16T00:00:00Z" })) });
  return { root, origin, town, office, key, tools };
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
  // the sandbox checks the clone against THIS fixture's pins, as the box's checks prod's (POS-994)
  fx.toolSocket ??= startToolSocket(join(fx.root, "tool.sock"), fx.town, { pinsDir: join(fx.office, "src", "town-pins") });
  writeFileSync(join(fx.root, "seal-ctl.json"), JSON.stringify({ calls: join(fx.root, "calls.txt"), verifyExit: extra.STUB_SEAL_VERIFY_EXIT }));
  const script = ferryPayload().replaceAll("/usr/bin/node", "node").replaceAll("/srv/postmark-office", fwd(fx.office));
  const env = { ...process.env, ...GIT_ENV, TOWN_PINS_DIR: "", TOWN_CLONE: fwd(fx.town), STUB_CALLS: join(fx.root, "calls.txt"), INVOCATION_ID: "inv-1", TOWN_SEAL_SOCKET: fx.sealSocket, TOWN_TOOL_SOCKET: fx.toolSocket, ...extra };
  writeFileSync(join(fx.root, "orders.json"), JSON.stringify(Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith("STUB_")))));
  const res = spawnSync(SH, ["-c", script], { cwd: fx.office, encoding: "utf8", timeout: 120000, env });
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

// POS-994 (Truey's review of #1065, findings 3 and 7): the town's code is not the
// office's pinned copy. The mint step stops by name (the door's exit 3), and the
// crossing is STILL witnessed: owe-open runs (it never reads the clone), the stopped
// owe-mail is owed as incomplete with "town-pin-mismatch: <file>", and the stopped
// publish leaves it owed for the first publish after the re-pin.
test("A PIN STOP is witnessed: the mint stops by name, and the crossing is owed as town-pin-mismatch", { skip: fskip }, () => {
  const fx = fixture();
  const env = CONFIGURED(fx);
  // a town change the office has not reviewed: a file in every stub's closure
  writeFileSync(join(fx.town, "tools", "stub-calls.mjs"), readFileSync(join(fx.town, "tools", "stub-calls.mjs"), "utf8") + "// a town change\n");
  execFileSync("git", ["-C", fx.town, "commit", "-qam", "an unreviewed change"], { env: { ...process.env, ...GIT_ENV } });
  const r = runFerry(fx, env);
  assert.equal(r.status, 3, `the pin stop is the crossing's exit: ${r.stderr}`);
  assert.match(r.stderr, /\[town-tool\] the town's tools\/stub-calls\.mjs is not the copy the office pinned/);
  assert.ok(!r.calls.some((c) => c.startsWith("mint")), "the town's mint never ran");
  assert.equal(r.witness[0], `witness owe-open --owed ${env.WITNESS_OWED} --kind mail-crossing --attempt ferry-inv-1 [clean clone]`, "opened, from the pinned copy, though the clone differs");
  assert.ok(r.witness.includes(`witness owe-incomplete --owed ${env.WITNESS_OWED} --kind mail-crossing --attempt ferry-inv-1 --why town-pin-mismatch: tools/stub-calls.mjs [clean clone]`),
    `the outcome is owed, by name: ${r.witness.join(" | ")}`);
  assert.ok(!r.witness.some((c) => c.startsWith("witness publish")), "the publish the pin stopped did not run");
  assert.match(r.stderr, /the record is owed, not published \(town-pin-mismatch: tools\/stub-calls\.mjs\)/);
});


test("A CLEAN CROSSING is owed with its stage and exit, from a clean clone, and then published", { skip: fskip }, () => {
  const fx = fixture();
  const env = CONFIGURED(fx);
  const r = runFerry(fx, env);
  assert.equal(r.status, 0, r.stderr);
  const ferry = r.calls.find((c) => c.startsWith("ferry "));
  assert.equal(ferry, "ferry --no-git --report", "the ferry runs --no-git in the sandbox and is asked for its report (POS-994)");
  // the client hands the sandbox's report on to the unit's own path, which the witness reads
  const report = /wreport=(\S+);/.exec(ferryPayload())[1];
  assert.equal(JSON.parse(readFileSync(report, "utf8")).ran, true, "the report reached the unit's path");
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
  assert.match(r.stderr, /\[witness\] the outcome of this crossing could not be composed \(owe-mail failed after stage done, exit 0\): it is owed as incomplete/);
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
