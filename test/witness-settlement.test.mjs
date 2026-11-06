// witness-settlement.test.mjs — POS-907: every decided settlement is a record in
// the town's witness chain, and the witness never changes a settlement's outcome.
//
//   node --test --test-timeout=180000 test/witness-settlement.test.mjs
//
// LAW (Darko, 2026-11-06, POS-907/a, "One chain"): mail crossings and
//   settlements are records in one chain in the town repo.
// LAW (POS-907/c, "Keep running"): "if a record fails to publish, the town keeps
//   running and the record is owed. Nothing is rolled back."
//
// Two halves. THE TOOL (world2/tools/witness-settlement.mjs) against a town clone
// whose tools/witness-chain.mjs is a STUB recording each call: what it owes,
// when, and under which lock. Then THE CROSSING: the shipped
// deploy/settlement-auto.sh, run to its first refusal, with the town's REAL
// witness, publishing into a scratch town. The real witness is the town's code
// and is not in this office's pinned town-clone until the town half ships, so
// that half SKIPS, saying so in its title, unless POSTMARK_TOWN_WITNESS_TREE
// names a town tree that has tools/witness-chain.mjs.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { settlementDecided } from "../world2/tools/witness-settlement.mjs";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(OFFICE, "world2", "tools", "witness-settlement.mjs");
const scratch = mkdtempSync(join(tmpdir(), "postmark-witness-settlement-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }); } catch { /* litter */ } });

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@postmark.invalid",
  GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@postmark.invalid",
};
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const sh = (s) => s.repeat(40).slice(0, 40);
let seq = 0;
const dir = (name) => { const d = join(scratch, `${name}-${++seq}`); mkdirSync(d, { recursive: true }); return d; };

const receipt = (over = {}) => JSON.stringify({ at: "2026-11-06T18:00:03Z", status: "refused", detail: "an invented refusal", town_sha: sh("a"), world_from: sh("b"), world_to: "", ...over }, null, 1) + "\n";

// ── the composer ────────────────────────────────────────────────────────────

test("COMPOSE: the receipt's own bytes, its instant, the shas it read, and the attempt; a refusal binds no World files", () => {
  const text = receipt();
  const d = settlementDecided({ receiptText: text, attempt: "2", event: "2026-11-06T18:00:01Z" });
  assert.equal(d.kind, "settlement");
  assert.equal(d.event, "settlement:2026-11-06T18:00:01Z");
  assert.equal(d.attempt, "2");
  assert.equal(d.decided_at, "2026-11-06T18:00:03Z", "the receipt's instant, so the same decision recomposes to the same outcome");
  assert.deepEqual(d.outcome, { status: "refused", detail: "an invented refusal" });
  assert.deepEqual(d.inputs, { town_sha: sh("a"), world_from: sh("b") });
  assert.deepEqual(d.results, {}, "no world_to on a refusal, so none is claimed");
  assert.deepEqual(d.artifacts, []);
  assert.equal(d.receipt.text, text);
  assert.equal(settlementDecided({ receiptText: text, attempt: "", event: "e" }).attempt, "final");
  assert.deepEqual(settlementDecided({ receiptText: text, attempt: "2", event: "2026-11-06T18:00:01Z" }), d, "deterministic");
});

test("COMPOSE: a published settlement binds every World file it changed, by digest at world_to, and a removed one as absent", () => {
  const world = dir("world");
  git(world, "init", "-q", "-b", "main");
  mkdirSync(join(world, "STATE", "log"), { recursive: true });
  writeFileSync(join(world, "WORLD.md"), "before\n");
  writeFileSync(join(world, "gone.md"), "to be removed\n");
  git(world, "add", "-A"); git(world, "commit", "-qm", "from");
  const from = git(world, "rev-parse", "HEAD").trim();
  writeFileSync(join(world, "WORLD.md"), "after\n");
  writeFileSync(join(world, "STATE", "log", "294.jsonl"), "{}\n");
  rmSync(join(world, "gone.md"));
  git(world, "add", "-A"); git(world, "commit", "-qm", "to");
  const to = git(world, "rev-parse", "HEAD").trim();
  const d = settlementDecided({ receiptText: receipt({ status: "published", world_from: from, world_to: to }), attempt: "1", event: "e", sweep: world });
  assert.deepEqual(d.results, { world_to: to });
  assert.deepEqual(d.artifacts.map((a) => [a.path, a.commit, a.sha256 === null]), [
    ["STATE/log/294.jsonl", to, false], ["WORLD.md", to, false], ["gone.md", to, true],
  ]);
});

// ── the tool, against a stub town witness ───────────────────────────────────

function stubTown() {
  const town = dir("town");
  mkdirSync(join(town, "tools"), { recursive: true });
  writeFileSync(join(town, "tools", "witness-chain.mjs"), `
import { appendFileSync, readFileSync } from "node:fs";
const [verb, ...rest] = process.argv.slice(2);
const stdin = verb === "owe" ? readFileSync(0, "utf8") : "";
appendFileSync(process.env.STUB_CALLS, JSON.stringify({ verb, rest, stdin, locked: process.env.STUB_LOCK_SEEN ?? null }) + "\\n");
process.exit(Number(process.env["STUB_" + verb.toUpperCase() + "_EXIT"] || 0));
`);
  return town;
}
function runTool(town, { attempt = "1", rec = receipt(), env = {} } = {}) {
  const d = dir("run");
  const receiptPath = join(d, "settlement-auto.json");
  writeFileSync(receiptPath, rec);
  const calls = join(d, "calls.jsonl");
  const r = spawnSync(process.execPath, [TOOL, "--receipt", receiptPath, "--attempt", attempt, "--event", "2026-11-06T18:00:01Z", "--town", town, "--lock", join(d, "town.lock")], {
    encoding: "utf8",
    env: { ...process.env, WITNESS_KEY: join(d, "key.pem"), WITNESS_OWED: join(d, "owed"), STUB_CALLS: calls, ...env },
  });
  const seen = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  return { ...r, seen, lock: join(d, "town.lock") };
}

test("NOT CONFIGURED: no WITNESS_KEY, no call, exit 0, said once", () => {
  const r = runTool(stubTown(), { env: { WITNESS_KEY: "" } });
  assert.equal(r.status, 0);
  assert.deepEqual(r.seen, []);
  assert.match(r.stderr, /not configured \(WITNESS_KEY, WITNESS_OWED\): this settlement owes no record/);
});

test("A RACE INSIDE THE RETRY is not a decision yet: nothing is owed", () => {
  const r = runTool(stubTown(), { attempt: "2", rec: receipt({ status: "race" }) });
  assert.equal(r.status, 0);
  assert.deepEqual(r.seen, []);
  assert.match(r.stderr, /lost a race: not a decision yet/);
  const final = runTool(stubTown(), { attempt: "", rec: receipt({ status: "race" }) });
  assert.equal(final.seen[0]?.verb, "owe", "a race that outlived its retries is a decision, and is owed");
});

test("A DECIDED SETTLEMENT is owed (the composed outcome, on stdin), then published under the town lock", () => {
  const r = runTool(stubTown());
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.seen.map((c) => c.verb), ["owe", "publish"]);
  const owed = JSON.parse(r.seen[0].stdin);
  assert.equal(owed.kind, "settlement");
  assert.equal(owed.outcome.status, "refused");
  const hasFlock = spawnSync("flock", ["--version"], { stdio: "ignore" }).status === 0;
  if (hasFlock) assert.ok(existsSync(r.lock), "publish ran under flock on the town lock");
  assert.ok(r.seen[1].rest.includes("--key"));
});

test("KEEP RUNNING: an owe or a publish that fails leaves the tool at exit 0, saying what is owed", () => {
  const oweFails = runTool(stubTown(), { env: { STUB_OWE_EXIT: "1" } });
  assert.equal(oweFails.status, 0);
  assert.deepEqual(oweFails.seen.map((c) => c.verb), ["owe"], "nothing is published from a debt that was never written");
  assert.match(oweFails.stderr, /could not be owed/);
  const pubFails = runTool(stubTown(), { env: { STUB_PUBLISH_EXIT: "3" } });
  assert.equal(pubFails.status, 0, 'LAW: "the record is owed"');
  assert.match(pubFails.stderr, /the record is owed, not published/);
});

// ── the crossing, with the town's real witness ──────────────────────────────

const TOWN_TREE = process.env.POSTMARK_TOWN_WITNESS_TREE || join(OFFICE, "town-clone");
const HAS_WITNESS = existsSync(join(TOWN_TREE, "tools", "witness-chain.mjs"));
const SH_OK = spawnSync("sh", ["-c", "true"], { stdio: "ignore" }).status === 0;
const crossingSkip = !SH_OK ? "no POSIX sh"
  : !HAS_WITNESS ? `skipped until the town's witness ships: no tools/witness-chain.mjs in ${TOWN_TREE} (set POSTMARK_TOWN_WITNESS_TREE to a town tree that has it)` : false;
const WITNESS_FILES = ["tools/witness-chain.mjs", "tools/stamp-mint.mjs", "tools/crossings.mjs", "PROJECTS/the-town-seal/seal.mjs"];

function crossingFixture() {
  const root = dir("crossing");
  const keys = () => { const { privateKey, publicKey } = generateKeyPairSync("ed25519"); return { priv: privateKey.export({ type: "pkcs8", format: "pem" }), pub: publicKey.export({ type: "spki", format: "pem" }) }; };
  const witness = keys();
  const stamp = keys();
  // the town: its real witness tools, the published witness key, a different stamp key
  const seed = join(root, "town-seed");
  for (const f of WITNESS_FILES) { mkdirSync(dirname(join(seed, f)), { recursive: true }); copyFileSync(join(TOWN_TREE, f), join(seed, f)); }
  mkdirSync(join(seed, "WITNESS"), { recursive: true });
  writeFileSync(join(seed, "WITNESS", "witness-pubkey.pem"), witness.pub);
  writeFileSync(join(seed, "tools", "stamp-pubkey.pem"), stamp.pub);
  git(root, "init", "-q", "-b", "main", seed);
  git(seed, "add", "-A"); git(seed, "commit", "-qm", "the town");
  const townOrigin = join(root, "town.git");
  git(root, "init", "-q", "--bare", "-b", "main", townOrigin);
  git(seed, "push", "-q", townOrigin, "main");
  const town = join(root, "town");
  git(root, "clone", "-q", townOrigin, town);
  // the world: one commit, a sweep clone of it
  const wseed = join(root, "world-seed");
  mkdirSync(join(wseed, "WORLD"), { recursive: true });
  writeFileSync(join(wseed, "WORLD", "households.json"), "{}\n");
  git(root, "init", "-q", "-b", "main", wseed);
  git(wseed, "add", "-A"); git(wseed, "commit", "-qm", "the world");
  const worldOrigin = join(root, "world.git");
  git(root, "init", "-q", "--bare", "-b", "main", worldOrigin);
  git(wseed, "push", "-q", worldOrigin, "main");
  const sweep = join(root, "sweep");
  git(root, "clone", "-q", worldOrigin, sweep);
  const harbor = join(root, "harbor");
  mkdirSync(harbor, { recursive: true });
  const key = join(root, "witness-key.pem");
  writeFileSync(key, witness.priv);
  return { root, town, townOrigin, sweep, harbor, key, owed: join(root, "owed") };
}

function runCrossing(fx, env = {}) {
  return spawnSync("sh", [join(OFFICE, "deploy", "settlement-auto.sh")], {
    encoding: "utf8", cwd: OFFICE, timeout: 170000,
    env: {
      ...GIT_ENV,
      OFFICE_ROOT: OFFICE, TOWN_CLONE: fx.town, WORLD_CLONE: fx.sweep, SETTLEMENT_CLONE: fx.sweep,
      SETTLEMENT_REPORT: join(fx.harbor, "settlement-auto.json"), SETTLEMENT_HISTORY: join(fx.harbor, "history.jsonl"),
      SETTLEMENT_ATTEMPT: "1", TOWN_LOCK: join(fx.root, "town.lock"),
      WITNESS_KEY: fx.key, WITNESS_OWED: fx.owed,
      // no store: the crossing refuses at its first store read, the earliest decision it can reach
      WORLD2_PG: "", WORLD2_PG_URL: "",
      ...env,
    },
  });
}

test(`THE CROSSING: a refused settlement is a signed record on the town's chain, and the crossing's exit is its own${crossingSkip ? ` (${crossingSkip})` : ""}`, { skip: crossingSkip }, () => {
  const fx = crossingFixture();
  const r = runCrossing(fx);
  assert.notEqual(r.status, 0, "the crossing refused, as it would have without the witness");
  const rec = JSON.parse(readFileSync(join(fx.harbor, "settlement-auto.json"), "utf8"));
  assert.equal(rec.status, "refused", r.stderr.slice(-2000));
  const names = git(fx.townOrigin, "ls-tree", "--name-only", "main:WITNESS/records").trim().split("\n");
  assert.deepEqual(names, ["00000001.json"], `one record reached the town:\n${r.stderr.slice(-2000)}`);
  const record = JSON.parse(git(fx.townOrigin, "show", "main:WITNESS/records/00000001.json"));
  const d = record.body.decided;
  assert.deepEqual([d.kind, d.attempt, d.outcome.status], ["settlement", "1", "refused"]);
  assert.match(d.event, /^settlement:\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(d.receipt.text, readFileSync(join(fx.harbor, "settlement-auto.json"), "utf8"), "the record carries the receipt the harbor serves, byte for byte");
  assert.equal(readdirSync(fx.owed).filter((n) => n.endsWith(".json")).length, 0, "the owed queue is paid");
});

test(`THE CROSSING, DRY: a dry run decides nothing and is witnessed as nothing${crossingSkip ? ` (${crossingSkip})` : ""}`, { skip: crossingSkip }, () => {
  const fx = crossingFixture();
  runCrossing(fx, { SETTLEMENT_DRY: "1", SETTLEMENT_SOURCE: "store", SETTLEMENT_CLONE: join(fx.root, "dry-sweep") });
  assert.equal(spawnSync("git", ["-C", fx.townOrigin, "rev-parse", "--verify", "-q", "main:WITNESS/records"]).status === 0, false, "no record");
  assert.ok(!existsSync(fx.owed) || readdirSync(fx.owed).length === 0, "and nothing owed");
});
