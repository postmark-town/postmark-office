// stamp-sandbox-pins.test.mjs — the stamp sandbox pins the town it runs, and its OWN re-signed copy of it (POS-1161; POS-994's missing half).
//
// THE DEFECT. The office runs only the town code it pinned (src/town-tool.mjs), at the commit src/town-pins/PINS.json names. The sandbox
// (tools/stamp-sandbox.mjs) (1) cloned the suite's older town (test/clone-pins.json) instead of that commit, so its stamp-mint.mjs was another
// file than the pinned one; and (2) re-signs the ledger under a throwaway key, which rewrites the town's own stamp-pubkey.pem and the
// ruled-welcome signatures inside stamp-verify.mjs, so its clone could never hash to the office's pins whichever commit it started from.
// "THE SANDBOX COULD NOT BE BUILT", on the train itself (runs 44859553405 and 44859198436), blocking every stamp PR.
//
// THE REPAIR, as these tests hold it: the sandbox starts at the PINNED commit (\`--at\` / \`--town\` still choose another), pins its OWN setup commit
// (tools/town-pins.mjs --write --out <sandbox dir>/town-pins) and runs under TOWN_PINS_DIR pointing there. The office's real pins, the money
// target and the mismatch refusal are untouched: a pinned module changed after setup still stops, by name.
//
// The whole sandbox run (a store, the town's history, ~40 minutes) is the command a PR attaches and CI's sandbox job; these are its parts.
//   node --test test/stamp-sandbox-pins.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers/temp-dir.mjs";
import { NO_TOWN, OFFICE_ROOT, townClone, townModuleUrl } from "./fixture-paths.mjs";
import { PIN_ROOT, townTool } from "../src/town-tool.mjs";
import {
  childEnv, closeSandbox, openSandbox, pinnedTownCommit, pinSandboxTown, prepareTown, townCommitOf, townRefToRun,
} from "../tools/stamp-sandbox.mjs";

const TOWN = townClone();
const ENGINE = TOWN ? await import(townModuleUrl("tools", "stamp-mint.mjs")) : null;
const SKIP = !TOWN && NO_TOWN;
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

test("which town: --at, else the office's PINNED commit for the default checkout, else a named checkout's own HEAD", () => {
  const pin = JSON.parse(readFileSync(join(PIN_ROOT, "PINS.json"), "utf8")).town_commit;
  assert.match(pin, /^[0-9a-f]{40}$/);
  assert.equal(pinnedTownCommit(), pin, "read from the office's own PINS.json, never the suite's clone-pins.json");
  assert.equal(townRefToRun({}), pin, "no flag: the code the office itself runs");
  assert.equal(townRefToRun({ townAt: "HEAD" }), "HEAD", "--at HEAD is a paired town PR's checkout (the workflow's town_ref)");
  assert.equal(townRefToRun({ townAt: "abc123" }), "abc123");
  assert.equal(townRefToRun({ townSource: "/some/town" }), null, "--town alone runs that checkout's HEAD, as it always did");
  assert.equal(townRefToRun({ townSource: "/some/town", townAt: "v1" }), "v1");
  const suitePin = JSON.parse(readFileSync(join(OFFICE_ROOT, "test", "clone-pins.json"), "utf8")).town.sha;
  assert.notEqual(townRefToRun({}), suitePin, "the suite's older town is exactly what the sandbox must not default to");
});

test("a checkout that lacks the commit asked for stops the build by name, and never runs another in its place", { skip: SKIP }, () => {
  const dir = tempDir("sandbox-ref-");
  try {
    const repo = join(dir, "town");
    mkdirSync(repo);
    const g = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();
    execFileSync("git", ["init", "-q", repo]);
    writeFileSync(join(repo, "a.txt"), "a");
    g("add", "-A"); g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "one");
    const head = g("rev-parse", "HEAD");
    assert.equal(townCommitOf(repo, head), head);
    assert.equal(townCommitOf(repo, "HEAD"), head);
    const missing = "f".repeat(40);
    assert.throws(() => townCommitOf(repo, missing), (e) => {
      assert.equal(e.setup, true, "a setup failure: exit 2, 'could not be built', not a red step");
      assert.ok(e.message.includes(missing) && /the commit the office pins/.test(e.message) && /fetch origin/.test(e.message), e.message);
      return true;
    });
    assert.throws(() => townCommitOf(repo, "no-such-branch"), (e) => e.setup === true && !/the commit the office pins/.test(e.message));
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});

/** A small town the sandbox's own setup can run on: the real town's tools and a signed ledger slice, committed. */
function fixtureSandbox() {
  const dir = tempDir("sandbox-pins-");
  const town = join(dir, "sandbox-town");
  const g = (...a) => execFileSync("git", ["-C", town, ...a], { encoding: "utf8" }).trim();
  mkdirSync(join(town, "WHITE_PAGES"), { recursive: true });
  cpSync(join(TOWN, "tools"), join(town, "tools"), { recursive: true });
  cpSync(join(TOWN, "PROJECTS", "the-town-seal"), join(town, "PROJECTS", "the-town-seal"), { recursive: true }); // the seal module the pinned closure reaches
  for (const e of readdirSync(join(TOWN, "WHITE_PAGES"), { withFileTypes: true })) {
    const addr = join(TOWN, "WHITE_PAGES", e.name, "ADDRESS.md");
    if (e.isDirectory() && existsSync(addr)) cpSync(addr, join(town, "WHITE_PAGES", e.name, "ADDRESS.md"));
  }
  const realKey = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
  const canon = ENGINE.parseStampLedger(readFileSync(join(TOWN, "WHITE_PAGES", "stamp-ledger.md"), "utf8")).slice(0, 40).map((e) => e.canonical);
  ENGINE.appendSigned(town, canon, realKey);
  execFileSync("git", ["init", "-q", "-b", "sandbox", town]);
  g("config", "core.autocrlf", "false");
  g("add", "-A"); g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "the town, as the sandbox clones it");
  const { privateKey } = generateKeyPairSync("ed25519");
  const sb = { dir, town, keyPem: privateKey.export({ type: "pkcs8", format: "pem" }), engine: ENGINE, cleanups: [], source: town, store: { url: () => "postgres://none@127.0.0.1:1/none" } };
  const prior = process.env.TOWN_PINS_DIR;
  return { dir, town, sb, g, done: async () => { for (const c of sb.cleanups) await c(); if (prior === undefined) delete process.env.TOWN_PINS_DIR; else process.env.TOWN_PINS_DIR = prior; rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); } };
}

test("THE DEFECT, and its repair: the re-signed clone hashes to the sandbox's OWN pins, never to the office's real ones", { skip: SKIP }, async () => {
  const realBefore = sha256(join(PIN_ROOT, "PINS.json"));
  const f = fixtureSandbox();
  try {
    const ledger = join(f.town, "WHITE_PAGES", "stamp-ledger.md");
    const was = readFileSync(ledger, "utf8");
    prepareTown(f.sb);
    assert.notEqual(readFileSync(ledger, "utf8"), was, "the ledger was re-signed under the sandbox's throwaway key");
    // as it stood: the office's real pins refuse the re-signed clone (its pubkey and verifier moved), whichever commit it began at
    assert.throws(() => townTool(f.town, "stamp-verify.mjs", { root: PIN_ROOT }), (e) => e.code === "TOWN_PIN_MISMATCH");

    const pinned = pinSandboxTown(f.sb);
    const setupCommit = f.g("rev-parse", "HEAD");
    assert.equal(pinned.setupCommit, setupCommit, "pinned AFTER the setup commit (the re-sign and the carried signatures), at that commit");
    assert.equal(pinned.pinsDir, join(f.dir, "town-pins"), "inside the sandbox's directory, outside the clone");
    const pins = JSON.parse(readFileSync(join(pinned.pinsDir, "PINS.json"), "utf8"));
    assert.equal(pins.town_commit, setupCommit);
    assert.ok(pins.files["tools/stamp-verify.mjs"] && pins.files["tools/stamp-mint.mjs"] && pins.files["tools/stamp-pubkey.pem"], "the money modules and the key the verifier trusts are pinned");
    // the key the verifier trusts is the SANDBOX's, as pinned
    assert.equal(readFileSync(join(pinned.pinsDir, "tools", "stamp-pubkey.pem"), "utf8"), readFileSync(join(f.town, "tools", "stamp-pubkey.pem"), "utf8"));

    // the loaders now accept the re-signed clone under the sandbox's pins
    for (const m of ["stamp-mint.mjs", "stamp-verify.mjs", "ballot.mjs"]) assert.doesNotThrow(() => townTool(f.town, m, { root: pinned.pinsDir }), m);
    // and the same clone is still refused under the office's real pins (nothing was loosened)
    assert.throws(() => townTool(f.town, "stamp-verify.mjs", { root: PIN_ROOT }), (e) => e.code === "TOWN_PIN_MISMATCH");

    // children and this process's own office readers run under them
    assert.equal(process.env.TOWN_PINS_DIR, pinned.pinsDir, "in-process office readers");
    delete process.env.TOWN_PINS_DIR; // a child's pins are the SANDBOX's by construction, not by what the parent's environment happened to hold
    assert.equal(childEnv(f.sb).TOWN_PINS_DIR, pinned.pinsDir, "every child process");
    process.env.TOWN_PINS_DIR = "/somewhere/else";
    assert.equal(childEnv(f.sb).TOWN_PINS_DIR, pinned.pinsDir, "and it wins over an inherited one");
    assert.equal(childEnv({ ...f.sb, pinsDir: undefined }).TOWN_PINS_DIR, "/somewhere/else", "before pinning, a child inherits as it always did");
    process.env.TOWN_PINS_DIR = pinned.pinsDir;
    assert.equal(sha256(join(PIN_ROOT, "PINS.json")), realBefore, "the office's real manifest is byte for byte as it was");
  } finally { await f.done(); }
  assert.equal(sha256(join(PIN_ROOT, "PINS.json")), realBefore);
});

test("FALSIFIER: a pinned module that differs from the commit the sandbox pinned still stops, by name", { skip: SKIP }, async () => {
  const f = fixtureSandbox();
  try {
    prepareTown(f.sb);
    const { pinsDir } = pinSandboxTown(f.sb);
    assert.doesNotThrow(() => townTool(f.town, "stamp-mint.mjs", { root: pinsDir }));
    const mint = join(f.town, "tools", "stamp-mint.mjs");
    writeFileSync(mint, `${readFileSync(mint, "utf8")}\n// a mismatching stamp-mint, as a town PR's would be\n`);
    assert.throws(() => townTool(f.town, "stamp-mint.mjs", { root: pinsDir }), (e) => {
      assert.equal(e.code, "TOWN_PIN_MISMATCH");
      assert.match(e.message, /stamp-mint\.mjs is not the copy the office pinned/);
      return true;
    });
    // and a module reached only through another's closure stops the loader that imports it
    f.g("checkout", "-q", "--", "tools/stamp-mint.mjs");
    const reached = JSON.parse(readFileSync(join(pinsDir, "PINS.json"), "utf8")).files["tools/ballot.mjs"].closure.filter((c) => c !== "tools/stamp-mint.mjs");
    assert.ok(reached.length > 0, "ballot.mjs reaches other pinned town files");
    const dep = join(f.town, reached[0]); // a file the loader finds only through ballot.mjs's closure
    writeFileSync(dep, `${readFileSync(dep, "utf8")}\n// changed\n`);
    assert.throws(() => townTool(f.town, "ballot.mjs", { root: pinsDir }), (e) => e.code === "TOWN_PIN_MISMATCH" && e.message.includes(reached[0].replace("tools/", "")));
  } finally { await f.done(); }
});

test("the pins are the sandbox's alone: a failing write is a setup failure by name, and the restore leaves the environment as it was", { skip: SKIP }, async () => {
  const f = fixtureSandbox();
  const before = process.env.TOWN_PINS_DIR;
  try {
    prepareTown(f.sb);
    // an --out inside the clone is refused by the writer: not turned into a bypass
    const inside = { ...f.sb, dir: join(f.town, "inside") };
    mkdirSync(inside.dir);
    assert.throws(() => pinSandboxTown(inside), (e) => e.setup === true && /could not be written/.test(e.message) && /inside the --town checkout/.test(e.message));
    assert.equal(process.env.TOWN_PINS_DIR, before, "a refused pin changes nothing");
    pinSandboxTown(f.sb);
    assert.notEqual(process.env.TOWN_PINS_DIR, before);
    for (const c of f.sb.cleanups.splice(0)) await c();
    assert.equal(process.env.TOWN_PINS_DIR, before, "cleanup restores TOWN_PINS_DIR (set or unset)");
  } finally { await f.done(); }
});

test("openSandbox runs the town at the commit asked for, not the checkout's HEAD; its setup and its own pins follow from there", { skip: SKIP }, async () => {
  const f = fixtureSandbox();
  let sb = null;
  try {
    // the checkout the sandbox clones: the fixture town as commit A, then a HEAD (B) that changes a pinned module
    f.g("tag", "A");
    const A = f.g("rev-parse", "HEAD");
    const mintFile = join(f.town, "tools", "stamp-mint.mjs");
    const atA = readFileSync(mintFile, "utf8");
    writeFileSync(mintFile, `${atA}\n// B: a later town\n`);
    writeFileSync(join(f.town, "WHITE_PAGES", "mail-ledger.md"), "# Mail ledger\n\n- 2026-06-01 · a → b · hello\n");
    f.g("add", "-A"); f.g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "B");
    const B = f.g("rev-parse", "HEAD");
    assert.notEqual(A, B);
    // the mail ledger the clock reads must exist at A as well
    f.g("checkout", "-q", "-B", "side", A);
    writeFileSync(join(f.town, "WHITE_PAGES", "mail-ledger.md"), "# Mail ledger\n\n- 2026-06-01 · a → b · hello\n");
    f.g("add", "-A"); f.g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "A with its mail ledger");
    const A2 = f.g("rev-parse", "HEAD");
    f.g("checkout", "-q", "sandbox");
    assert.equal(f.g("rev-parse", "HEAD"), B);
    f.g("branch", "-D", "side"); // A2 is now reachable from NO ref, as a commit the workflow fetched by sha into town-clone is (FETCH_HEAD only)

    sb = await openSandbox({ townSource: f.town, townAt: A2 });
    assert.equal(sb.sourceSha, A2, "the commit asked for");
    assert.equal(sb.townAt, A2);
    assert.equal(git(sb.town, "rev-parse", "HEAD"), A2, "the sandbox's town stands on it");
    assert.equal(readFileSync(join(sb.town, "tools", "stamp-mint.mjs"), "utf8"), atA, "A's stamp-mint, not the checkout HEAD's");
    assert.equal(git(sb.town, "remote"), "", "no remote: nothing can push");
    await closeSandbox(sb);
    sb = null;
    // --town alone is that checkout's own HEAD, as it always was
    sb = await openSandbox({ townSource: f.town });
    assert.equal(sb.sourceSha, B);
    assert.equal(sb.townAt, null);
    await closeSandbox(sb);
    sb = null;
    // a commit the checkout lacks is the build's own stop
    await assert.rejects(openSandbox({ townSource: f.town, townAt: "e".repeat(40) }), (e) => e.setup === true && /does not hold e{40}/.test(e.message));
  } finally { if (sb) await closeSandbox(sb); await f.done(); }
});

test("the CLI: --at needs a ref, and --help teaches the pinned default and the sandbox's own pins", () => {
  const run = (...args) => spawnSync(process.execPath, [join(OFFICE_ROOT, "tools", "stamp-sandbox.mjs"), ...args], { encoding: "utf8", env: { ...process.env, WORLD2_PG_URL: "" } });
  const help = run("--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--at <town ref>/);
  assert.match(help.stdout, /the town commit the office pins/);
  const bad = run("--at");
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--at names a town ref/);
  const unknown = run("--atx", "1");
  assert.equal(unknown.status, 2);
});

test("the header teaches it: the pinned default, --at, and the sandbox's own pins with the writer's route", () => {
  const src = readFileSync(join(OFFICE_ROOT, "tools", "stamp-sandbox.mjs"), "utf8");
  for (const needle of ["WHICH TOWN (POS-1161)", "ITS OWN PINS (POS-1161", "tools/town-pins.mjs --write --town <clone> --ref <setup commit> --out", "TOWN_PINS_DIR", "--at HEAD"])
    assert.ok(src.includes(needle), `the header names: ${needle}`);
});
