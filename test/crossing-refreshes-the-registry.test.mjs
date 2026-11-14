// crossing-refreshes-the-registry.test.mjs — THE REGISTRY CANNOT GO STALE
// AGAIN, AND HERE IS THE PROOF.
//
//   node --test --test-timeout=180000 test/crossing-refreshes-the-registry.test.mjs
//
// ── WHAT IS UNDER TEST ──────────────────────────────────────────────────────
//
// `WORLD/households.json` is the World's only knowledge of which handles form
// one household. It is an export of this office's resolver, and it was written
// into the world by hand: the tool's own header said the refresh was "the
// caller's act". Nobody was that caller after 2026-08-07, and thirty-three days
// later the file named 101 handles while the town named 157.
//
// Three readers take it as live — the fold's parcel-claim cap, the lint's
// consent gate, and the AUTHORSHIP WALL. The first two accept `--households`
// and can be pointed somewhere better. The wall cannot, and it fails silently:
// `settlement-sweep.mjs` leaves a sketchbook it cannot bind ALONE rather than
// refusing it. A stale registry there is not a wrong answer, it is no answer,
// under a receipt that reads exactly like a clean crossing.
//
// So `deploy/settlement-auto.sh` now re-derives the registry at the start of
// every crossing, from the town clone it pinned, and commits it ahead of the
// fold when the mapping moved.
//
// ── THE LAW THIS ASSERTS AGAINST, VERBATIM ──────────────────────────────────
//
// `postmark-world tools/settlement-sweep.mjs`, the authorship wall:
//
//     the wall binds a mark only when `households[record.by]` AND
//     `logins[branchName]` both resolve
//
// Both halves come out of this one file. A handle the registry has never heard
// of fails the first; a sketchbook name its `logins` map cannot bind fails the
// second. The tests below evaluate that conjunction over THE REGISTRY THE
// CROSSING ACTUALLY PUBLISHED — read back out of the fixture's bare origin, not
// out of the working clone — because a registry that never reached origin is a
// registry no PR lane and no later crossing will ever read.
//
// ── THE CAN-FAIL FLIP ───────────────────────────────────────────────────────
//
// F2 is the control and it is the reason to believe F1. It runs the identical
// crossing with `SETTLEMENT_REGISTRY=0` — the one seam — and asserts the wall's
// conjunction FAILS for the same handle. Without it, F1 is an assertion that has
// never been shown capable of going red, which is a green light wired to
// nothing: every other fixture value would satisfy it just as well.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "postmark-hhrefresh-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* litter */ } });

// ── THE OFFICE UNDER TEST (POS-1025) ────────────────────────────────────────
//
// The REAL office — the real export, the real registry comparator, the real
// script, receipt and history — with exactly two tools stood in for the store
// the printout needs: the docket wait (a window, at once) and the printout
// itself (world2/tools/settlement-printout.mjs, a stub of its shell contract).
// Every other file is a symlink to the checkout, so a module it imports
// resolves to the real one. The printout stub records THE REGISTRY IT READ, at
// the instant the fold would read it: that file is this lane's instrument, as
// the stub sweep's was before the printout.
const UNDER_TEST = (() => {
  const root = join(scratch, "office-under-test");
  const STUBBED = new Set(["await-clearing.mjs", "settlement-printout.mjs"]);
  for (const top of readdirSync(OFFICE)) {
    if (top === ".git" || top === "world2") continue;
    mkdirSync(root, { recursive: true });
    symlinkSync(join(OFFICE, top), join(root, top));
  }
  mkdirSync(join(root, "world2", "tools"), { recursive: true });
  for (const w of readdirSync(join(OFFICE, "world2"))) if (w !== "tools") symlinkSync(join(OFFICE, "world2", w), join(root, "world2", w));
  for (const t of readdirSync(join(OFFICE, "world2", "tools"))) if (!STUBBED.has(t)) symlinkSync(join(OFFICE, "world2", "tools", t), join(root, "world2", "tools", t));
  writeFileSync(join(root, "world2", "tools", "await-clearing.mjs"),
    'process.stdout.write(JSON.stringify({ window: 213, cleared_at: "2026-09-08T05:45:44Z", waited_s: 0 }) + "\\n");\n');
  writeFileSync(join(root, "world2", "tools", "settlement-printout.mjs"), `
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
const mode = process.argv[2];
const at = (n) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : null; };
const say = (o) => { process.stdout.write(JSON.stringify(o) + "\\n"); process.exit(0); };
const env = { ...process.env, GIT_AUTHOR_NAME: "printout", GIT_AUTHOR_EMAIL: "p@x.invalid", GIT_COMMITTER_NAME: "printout", GIT_COMMITTER_EMAIL: "p@x.invalid", GIT_AUTHOR_DATE: "2026-09-08T00:00:00Z", GIT_COMMITTER_DATE: "2026-09-08T00:00:00Z" };
const world = at("--world");
const git = (...a) => execFileSync("git", ["-C", world, ...a], { encoding: "utf8", env }).trim();
if (mode === "print") {
  // WHAT THE FOLD WOULD HAVE READ, written outside the repo.
  writeFileSync(process.env.REGISTRY_SEEN_OUT, readFileSync(join(world, "WORLD", "households.json"), "utf8"));
  writeFileSync(join(world, ".git", "printout-stakes.json"), "[]\\n");
  const base = { settlement: 213, window: 212, printout_sha: null, world: git("rev-parse", "HEAD") };
  if (process.env.PRINTOUT_PUBLISHES !== "1")
    say({ status: "quiet", settlement: 214, window: 213, base, written: [], removed: [], reframed: [], summary: { written: 0, unchanged: 0, removed: 0, reframed: 0 }, commit: git("rev-parse", "HEAD") });
  const p = join(world, "WORLD", "marks", "alpha", "one", "mark.md");
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, "---\\nkind: sited\\nby: alpha\\n---\\n\\none\\n");
  git("add", "-A", "--", "WORLD");
  git("commit", "-qm", "settlement: S214 printout — 1 written, 0 removed, 0 re-framed");
  say({ status: "printed", settlement: 214, window: 213, base, written: [{ id: "alpha/one", path: "WORLD/marks/alpha/one/mark.md" }], removed: [], reframed: [], summary: { written: 1, unchanged: 0, removed: 0, reframed: 0 }, commit: git("rev-parse", "HEAD") });
}
if (mode === "tag") {
  const commit = git("rev-parse", at("--commit") + "^{commit}");
  let existing = null; try { existing = git("rev-parse", "--verify", "--quiet", "refs/tags/settlement/S214^{commit}"); } catch { existing = null; }
  // this file's crossings repeat one settlement's number; the tag's own rules are settlement-printout-crossing's
  if (existing) say({ status: "already-tagged", tag: "settlement/S214", commit: existing });
  git("tag", "-a", "settlement/S214", commit, "-m", "settlement: S214");
  say({ status: "tagged", tag: "settlement/S214", commit });
}
if (mode === "record") say({ status: "recorded", settlement: 214, commit: at("--commit"), head_advanced: true });
process.exit(2);
`);
  return root;
})();
// THE STORE the crossing's household export renders (POS-350): the export reads
// the registry from the store, never the fixture town's printouts, so each
// crossing re-states the store from the town seed first.
import { registryStoreForTowns } from "./helpers/office-under-test.mjs";
const REG = await registryStoreForTowns({ db: "refresh_registry_test" });
after(() => REG.stop());


const has = (cmd) => { try { execFileSync("sh", ["-c", cmd], { stdio: "ignore" }); return true; } catch { return false; } };
// The chain is POSIX-shell shaped. Where `sh` is not a real shell these SKIP
// rather than pass: a silent pass on a box that cannot run a crossing is the
// "reached for something easier than the behaviour" defect.
const SH_OK = has("sh -c 'true'");

// The handle that joins AFTER the standing registry was generated. Everything
// below asks one question about it: can the wall see it after one crossing.
const NEWCOMER = "berthillon";
const NEWCOMER_LOGIN = "berthillon-hub";
const NEWCOMER_ID = 314022791;
const OLD_STAMP = "2026-08-07T12:58:17.724Z";

let seq = 0;

/**
 * ONE CROSSING, IN A BOTTLE — the settlement-source-flip harness, with a
 * registry in the store.
 *
 * The fixture town carries `tools/github-ids.json`, which `runCrossing`
 * re-states into the store (REG.seedFromSync) before every crossing; since
 * POS-350 `tools/world-households-export.mjs` renders that store alone
 * (`identities`, the pins, the declared houses) and reads no town ledger.
 */
function crossing(label, { env = {}, pins = null, declared = null, reuse = null, breakExport = false } = {}) {
  if (reuse) return runCrossing(reuse, { env });

  const root = join(scratch, `${label}-${++seq}`);
  const bin = join(root, "bin");
  const origin = join(root, "world.git");
  const sweepClone = join(root, "sweep");
  const townOrigin = join(root, "town.git");
  const townClone = join(root, "town");
  const seed = join(root, "seed");
  const harbor = join(root, "harbor");
  mkdirSync(bin, { recursive: true });
  mkdirSync(harbor, { recursive: true });

  const g = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "seed", GIT_AUTHOR_EMAIL: "seed@postmark.invalid",
      GIT_COMMITTER_NAME: "seed", GIT_COMMITTER_EMAIL: "seed@postmark.invalid",
      GIT_AUTHOR_DATE: "2026-08-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-08-01T00:00:00Z",
    },
  });

  // ── the world: canon, ONE SKETCHBOOK, and A REGISTRY THAT PREDATES IT ──────
  //
  // The standing registry knows `alpha` and does not know the newcomer. That is
  // the 2026-08-07 file in miniature, and it is the input every test here
  // varies exactly one thing about.
  mkdirSync(join(seed, "WORLD", "marks", "alpha", "published-note"), { recursive: true });
  mkdirSync(join(seed, "tools"), { recursive: true });
  writeFileSync(join(seed, "WORLD", "marks", "alpha", "published-note", "mark.md"),
    "---\nkind: sited\nby: alpha\ndate: 2026-08-01\n---\n\nalpha published this\n");
  writeFileSync(join(seed, "WORLD", "households.json"), `${JSON.stringify({
    generated_at: OLD_STAMP,
    source: "the fixture's standing registry — deliberately older than the newcomer's pin",
    // The store's spelling (POS-350): alpha is pinned and no house holds the
    // account, so `identities` answers `solo:alpha` (Darko 10-04's rule), the
    // pin's login binds its `gh:<id>`, and the second key binds alpha's own
    // sketchbook name to the household.
    households: { alpha: "solo:alpha" },
    logins: { alpha: "solo:alpha", "alpha-hub": "gh:1" },
  }, null, 2)}\n`);
  // the harm gate, reported after the seal (POS-1025/c): a fixture world that
  // carries none would raise an alarm on every printout, so the bottle answers
  // it: no harm, nothing to name
  writeFileSync(join(seed, "tools", "harm-gate.mjs"),
    'process.stdout.write(JSON.stringify({ ok: true, base: "HEAD", before: 1, after: 1, checks: [] }) + "\\n");\n');
  writeFileSync(join(seed, "package.json"), JSON.stringify({ name: "world-fixture", scripts: { test: "node -e \"\"", "test:candle": "node -e \"\"" } }));
  g(".", "init", "-q", "-b", "main", seed);
  g(seed, "config", "user.email", "seed@postmark.invalid");
  g(seed, "config", "user.name", "seed");
  g(seed, "add", "-A");
  g(seed, "commit", "-qm", "canon");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { stdio: "ignore" });
  g(seed, "remote", "add", "origin", origin);
  g(seed, "push", "-q", "origin", "main");
  g(seed, "branch", `draft/${NEWCOMER_LOGIN}`, "main");
  g(seed, "push", "-q", "origin", `draft/${NEWCOMER_LOGIN}`);
  execFileSync("git", ["clone", "-q", origin, sweepClone], { stdio: "ignore" });
  execFileSync("git", ["-C", sweepClone, "config", "user.email", "sweep@postmark.invalid"], { stdio: "ignore" });
  execFileSync("git", ["-C", sweepClone, "config", "user.name", "sweep"], { stdio: "ignore" });

  // ── the town: a stake deriver AND a household resolver, at a pinned sha ────
  const townSeed = join(root, "town-seed");
  mkdirSync(join(townSeed, "tools"), { recursive: true });
  writeFileSync(join(townSeed, "tools", "world-stake.mjs"),
    'process.stdout.write(JSON.stringify([{ holder: "alpha", mark: "alpha/one", n: 1, weight: 3, tick: 0 }]) + "\\n");\n');
  const pinRows = pins ?? {
    alpha: { login: "alpha-hub", id: 1 },
    [NEWCOMER]: { login: NEWCOMER_LOGIN, id: NEWCOMER_ID },
  };
  writeFileSync(join(townSeed, "tools", "github-ids.json"), `${JSON.stringify(pinRows, null, 2)}\n`);
  // The declared houses, when a test names some (seed-registry-cli.mjs reads them into the store).
  if (declared) writeFileSync(join(townSeed, "tools", "households.json"), `${JSON.stringify(declared, null, 2)}\n`);
  // NO ENGINE (POS-350): the export renders the STORE's registry, which
  // `runCrossing` re-states from this seed's pins, and reads no town ledger, so
  // the fixture town carries no `stamp-mint.mjs` for it to fall back on.
  if (breakExport) {
    // A STORE THE EXPORT CANNOT READ — the state where the crossing must refuse
    // rather than fold on a registry it cannot vouch for. (Until POS-350 this
    // was a town whose resolver threw; the export reads no town since then, so
    // the trip moved to the one source it does read.)
    env = { ...env, WORLD2_PG_URL: "postgres://office_api@127.0.0.1:9/none" };
  }
  g(".", "init", "-q", "-b", "main", townSeed);
  g(townSeed, "config", "user.email", "seed@postmark.invalid");
  g(townSeed, "config", "user.name", "seed");
  g(townSeed, "add", "-A");
  g(townSeed, "commit", "-qm", "town");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", townOrigin], { stdio: "ignore" });
  g(townSeed, "remote", "add", "origin", townOrigin);
  g(townSeed, "push", "-q", "origin", "main");
  execFileSync("git", ["clone", "-q", townOrigin, townClone], { stdio: "ignore" });

  return runCrossing(root, { env });
}

/**
 * MOVE THE TOWN WITHOUT MOVING THE MAPPING — the state no test asked for, and
 * the one the first cut of this lane refused.
 *
 * The export writes `WORLD/households.json` only when the MAPPING moved, so a
 * registry nothing changed keeps its older `town_sha`. The real town takes
 * 150-300 commits a day, so two crossings never pin the same sha. A guard that
 * compares the file's stamp to the crossing's pin therefore refuses every
 * crossing after a quiet one, and the town settles only on the days somebody
 * joins. This commits a file the resolver does not read, so `origin/main` moves
 * and the households do not.
 */
function moveTownWithoutMovingTheMapping(root, note) {
  const townSeed = join(root, "town-seed");
  const g = (...a) => execFileSync("git", ["-C", townSeed, ...a], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "seed", GIT_AUTHOR_EMAIL: "seed@postmark.invalid",
      GIT_COMMITTER_NAME: "seed", GIT_COMMITTER_EMAIL: "seed@postmark.invalid",
    },
  });
  const before = g("rev-parse", "main").trim();
  writeFileSync(join(townSeed, `a-letter-${note}.md`), `the town moved: ${note}
`);
  g("add", "-A");
  g("commit", "-qm", `town moves, households do not: ${note}`);
  g("push", "-q", "origin", "main");
  const after = g("rev-parse", "main").trim();
  assert.notEqual(after, before, "the fixture town must actually move, or this proves nothing");
  return { before, after };
}

/**
 * RE-STATE THE TOWN'S PINS (and its declared houses), commit and push, so the
 * next crossing pins a town whose store says something new. Answers the new sha.
 */
function restateTown(root, { pins = null, declared = null }) {
  const townSeed = join(root, "town-seed");
  const g = (...a) => execFileSync("git", ["-C", townSeed, ...a], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "seed", GIT_AUTHOR_EMAIL: "seed@postmark.invalid",
      GIT_COMMITTER_NAME: "seed", GIT_COMMITTER_EMAIL: "seed@postmark.invalid",
    },
  });
  if (pins) writeFileSync(join(townSeed, "tools", "github-ids.json"), `${JSON.stringify(pins, null, 2)}\n`);
  if (declared) writeFileSync(join(townSeed, "tools", "households.json"), `${JSON.stringify(declared, null, 2)}\n`);
  g("add", "-A");
  g("commit", "-qm", "the town's pins move");
  g("push", "-q", "origin", "main");
  return g("rev-parse", "main").trim();
}

/**
 * PUT A REGISTRY ON WORLD MAIN BY HAND (through a scratch clone of the
 * fixture's origin): the state of a world whose file was rendered before the
 * export carried `pinned_ids`.
 */
function publishRegistry(root, registry) {
  const dir = join(root, `hand-${++seq}`);
  execFileSync("git", ["clone", "-q", join(root, "world.git"), dir], { stdio: "ignore" });
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_NAME: "hand", GIT_AUTHOR_EMAIL: "hand@postmark.invalid", GIT_COMMITTER_NAME: "hand", GIT_COMMITTER_EMAIL: "hand@postmark.invalid" },
  });
  writeFileSync(join(dir, "WORLD", "households.json"), `${JSON.stringify(registry, null, 2)}\n`);
  g("commit", "-qam", "a registry rendered before pinned_ids");
  g("push", "-q", "origin", "main");
}

function runCrossing(root, { env = {} } = {}) {
  const sweepClone = join(root, "sweep");
  const townClone = join(root, "town");
  const origin = join(root, "world.git");
  const harbor = join(root, "harbor");
  const seen = join(root, `registry-seen-${++seq}.json`);

  REG.seedFromSync(join(root, "town-seed"));
  const res = spawnSync("sh", [join(UNDER_TEST, "deploy", "settlement-auto.sh")], {
    encoding: "utf8",
    env: {
      ...process.env,
      OFFICE_ROOT: UNDER_TEST,
      TOWN_CLONE: townClone,
      WORLD_CLONE: sweepClone,
      SETTLEMENT_CLONE: sweepClone,
      SETTLEMENT_REPORT: join(harbor, "settlement-auto.json"),
      SETTLEMENT_HISTORY: join(harbor, "settlement-auto-history.jsonl"),
      SETTLEMENT_ATTEMPT: "1",
      // the photograph is test/state-log-through-the-clearing's; this file's question is the registry
      SETTLEMENT_STATE_LOG: "0",
      // an alarm in this bottle prints ISSUE-WANTED rather than reaching GitHub
      SETTLEMENT_ESCALATE_CRED: join(root, "no-such-credentials"),
      REGISTRY_SEEN_OUT: seen,
      ...REG.env,
      ...env,
    },
  });

  let receipt = null;
  try { receipt = JSON.parse(readFileSync(join(harbor, "settlement-auto.json"), "utf8")); } catch { /* none */ }
  let registrySeen = null;
  try { registrySeen = JSON.parse(readFileSync(seen, "utf8")); } catch { /* the printout never ran */ }

  // WHAT REACHED ORIGIN. The clone's copy is what the crossing wrote; origin's
  // is what it PUBLISHED, and only the second is a receipt that could not exist
  // if the step had silently done nothing.
  let published = null;
  try {
    published = JSON.parse(execFileSync("git", ["-C", origin, "show", "main:WORLD/households.json"], { encoding: "utf8" }));
  } catch { /* origin has no registry */ }

  return { root, origin, sweepClone, res, receipt, registrySeen, published };
}

/**
 * THE AUTHORSHIP WALL'S OWN CONJUNCTION, quoted from settlement-sweep.mjs and
 * evaluated here rather than paraphrased: "the wall binds a mark only when
 * `households[record.by]` AND `logins[branchName]` both resolve".
 */
const wallBinds = (registry, by, branch) =>
  Boolean(registry?.households?.[by]) && Boolean(registry?.logins?.[branch.replace(/^draft\//, "").toLowerCase()]);

test("F1 · a handle pinned after the standing registry's stamp is in the registry the crossing publishes, and the wall can bind it", { skip: !SH_OK && "no POSIX sh" }, () => {
  const c = crossing("refresh", { env: {} });
  assert.equal(c.res.status, 0, `the crossing must complete: ${c.res.stderr}`);

  // The published file, out of the bare origin.
  assert.ok(c.published, "the crossing must have published a registry to origin");
  assert.notEqual(c.published.generated_at, OLD_STAMP,
    "the published registry still carries the stamp it had before the crossing — nothing was refreshed");
  assert.ok(c.published.town_sha, "the published registry must name the town it was derived from");
  assert.equal(c.published.households[NEWCOMER], `solo:${NEWCOMER}`,
    `${NEWCOMER} was pinned after ${OLD_STAMP} and the crossing must have grouped them`);

  // THE BEHAVIOUR, not the bytes: the wall's conjunction over what shipped.
  assert.equal(wallBinds(c.published, NEWCOMER, `draft/${NEWCOMER_LOGIN}`), true,
    "the wall must bind the newcomer's mark: households[by] and logins[branch] both resolve");

  // And the fold read the refreshed file, not the one main was carrying.
  assert.equal(c.registrySeen.households[NEWCOMER], `solo:${NEWCOMER}`,
    "the fold must have read the REFRESHED registry — the refresh has to land before the fold, not beside it");

  // The receipt says the crossing looked.
  assert.equal(c.receipt.registry.ran, true);
  assert.equal(c.receipt.registry.changed, true);
  assert.deepEqual(c.receipt.registry.added, [NEWCOMER]);
  assert.equal(c.receipt.registry.previous_generated_at, OLD_STAMP,
    "the receipt names the stamp it replaced, which is how the gap closing is visible rather than taken on trust");
});

test("F2 · THE FLIP — skip the step and the same wall cannot bind the same handle", { skip: !SH_OK && "no POSIX sh" }, () => {
  // The control for F1. One seam, one variable, and it must go the other way.
  const c = crossing("flip", { env: { SETTLEMENT_REGISTRY: "0" } });
  assert.equal(c.res.status, 0, `the crossing must still complete with the step disabled: ${c.res.stderr}`);

  assert.equal(c.published.generated_at, OLD_STAMP,
    "with the step disabled, origin must still carry the registry it had");
  assert.equal(c.published.households[NEWCOMER], undefined);
  assert.equal(wallBinds(c.published, NEWCOMER, `draft/${NEWCOMER_LOGIN}`), false,
    "and the wall must NOT be able to bind the newcomer — if it can, F1 proves nothing about the refresh");
  assert.equal(wallBinds(c.registrySeen, NEWCOMER, `draft/${NEWCOMER_LOGIN}`), false,
    "the fold read the stale registry, which is the state this whole lane is about");

  // ── A NAMED ABSENCE, AND IT MUST BE LOUD ──────────────────────────────────
  //
  // `ran: false` alone was what this asserted, and it was not enough: a reader
  // scanning receipts needs the crossing to SAY it folded on a registry nothing
  // checked. `verified: false` is that word and `bypass: true` says a person
  // meant it.
  assert.equal(c.receipt.registry.ran, false);
  assert.equal(c.receipt.registry.verified, false,
    "an unverified crossing must say so on the receipt — one that reads like an ordinary crossing is the "
    + "2026-08-07 shape in this lane's own clothes");
  assert.equal(c.receipt.registry.bypass, true, "and that a person meant it");
  assert.match(String(c.receipt.registry.reason), /SETTLEMENT_REGISTRY=0/);
  assert.match(c.res.stderr, /REGISTRY UNVERIFIED \(bypass\)/,
    "and the crossing shouts it where the operator watching the run will see it");

  // (The World sweep that took `--registry-unverified` was retired with the
  // printout, POS-1025; the receipt and the journal above are where the bypass
  // is stated now, and the printout read the stale file, as registrySeen shows.)
});

test("F13 · THE CROSSING AFTER A QUIET ONE PUBLISHES — the town moves, the mapping does not", { skip: !SH_OK && "no POSIX sh" }, () => {
  // THE BLOCKER THIS LANE SHIPPED AND REVIEW CAUGHT. The export writes the file
  // only when the MAPPING moved, so a registry nothing changed keeps its older
  // `town_sha`. The first cut then demanded that stamp EQUAL the sha the
  // crossing pinned — and the real town takes 150-300 commits a day, so two
  // crossings never pin the same sha. Every crossing after a quiet one would
  // have refused, and the town would have settled only on the days somebody
  // joined. The export's own header says the sentence that refutes it: "an older
  // town_sha means the mapping has not changed since — never that nobody
  // looked."
  //
  // No test asked for this state, which is why it shipped: F3 runs a second
  // crossing over a town that has NOT moved, so the two shas are equal and the
  // defect is invisible.
  const first = crossing("quiet-then-move", { env: {} });
  assert.equal(first.res.status, 0, first.res.stderr);
  const stampAfterFirst = first.published.town_sha;
  assert.ok(stampAfterFirst, "the first crossing must have written a stamped registry");

  const moved = moveTownWithoutMovingTheMapping(first.root, "one");
  const second = runCrossing(first.root, { env: {} });

  assert.equal(second.res.status, 0,
    `the crossing after a quiet one MUST complete — this is the blocker: ${second.res.stderr}`);
  assert.equal(second.receipt.registry.ran, true);
  assert.equal(second.receipt.registry.changed, false, "the mapping did not move, so nothing was rewritten");
  assert.equal(second.receipt.registry.verified, true, "…and the crossing verified it anyway, which is the point");

  // THE TWO FACTS ARE DIFFERENT, AND THAT IS THE WHOLE LESSON.
  assert.equal(second.receipt.registry.verified_at, moved.after,
    "`verified_at` is the town this crossing CHECKED against");
  assert.equal(second.published.town_sha, stampAfterFirst,
    "…while the file keeps the stamp of the town it was DERIVED from");
  assert.notEqual(second.receipt.registry.verified_at, second.published.town_sha,
    "they differ, and a guard that compares them for equality refuses a town that is merely alive");

  // AND THE RECEIPT'S OWN `town_sha` NAMES THE FILE THAT STANDS, not the
  // derivation this crossing threw away. It did not, until the two-crossing
  // rehearsal's receipt was read back against origin: a crossing that wrote
  // nothing reported the fresh derivation's stamp, which is a value from a
  // different source than the field names — the very class this lane is about.
  assert.equal(second.receipt.registry.town_sha, second.published.town_sha,
    "the receipt's town_sha must be the stamp the committed registry carries");
  assert.equal(second.receipt.registry.town_sha, stampAfterFirst);

  // And a THIRD crossing, because "after a quiet one" must not be a one-off.
  moveTownWithoutMovingTheMapping(first.root, "two");
  const third = runCrossing(first.root, { env: {} });
  assert.equal(third.res.status, 0, `and the one after that: ${third.res.stderr}`);
  assert.equal(third.receipt.registry.changed, false);
});

test("F16 · every crossing STATES something about the registry on its receipt, verified or bypassed", { skip: !SH_OK && "no POSIX sh" }, () => {
  // The sweep's `--registry-verified-at`/`--registry-unverified` flags were this
  // construction's seam until the printout retired the sweep (POS-1025). The
  // claim now lives on the receipt, and a crossing that states neither is the
  // regression that would put the town back where it was in August, silently.
  const verified = crossing("states-verified", { env: {} });
  assert.equal(verified.receipt.registry.verified, true);
  assert.match(String(verified.receipt.registry.verified_at), /^[0-9a-f]{40}$/,
    "a crossing that refreshed names the sha it verified against");
  const bypassed = crossing("states-bypass", { env: { SETTLEMENT_REGISTRY: "0" } });
  assert.equal(bypassed.receipt.registry.verified, false);
  assert.equal(bypassed.receipt.registry.bypass, true,
    "a crossing that skipped the refresh must say so, or nobody can tell it from one that forgot");
});

test("F17 · VERIFIED IMPLIES STAMPED — an unstamped standing registry is rewritten even when the mapping matches", { skip: !SH_OK && "no POSIX sh" }, () => {
  // The premise the world's one remaining refusal rests on. That side refuses a
  // caller claiming VERIFIED over a registry the export has never written, and
  // it tells the two apart by the absence of `town_sha`. The claim is only sound
  // if a verified registry is always a written one — so the refresh rewrites
  // whenever the standing file is unstamped, mapping or no mapping.
  //
  // Without it, a first refresh that happened to find the mapping already
  // correct would leave the file unattributable while the crossing declared it
  // verified: a claim neither side could check, which is the 2026-08-07 state
  // with a fresh receipt on top.
  const pins = { alpha: { login: "alpha-hub", id: 1 } };   // exactly what the fixture registry holds
  const c = crossing("verified-implies-stamped", { env: {},pins });

  assert.equal(c.res.status, 0, c.res.stderr);
  assert.equal(c.receipt.registry.changed, true,
    "the mapping did NOT move — the rewrite happened because the standing file carried no town_sha");
  assert.deepEqual(c.receipt.registry.added, [], "…and it is not a membership change: nothing was added");
  assert.deepEqual(c.receipt.registry.removed, []);
  assert.deepEqual(c.receipt.registry.rekeyed, []);
  assert.ok(c.published.town_sha,
    "the published registry is stamped, so `verified implies stamped` holds and the world's refusal is sound");
  assert.deepEqual(c.published.households, { alpha: "solo:alpha" },
    "and the mapping itself is untouched, which is what makes this a stamping and not a migration");
});

test("F3 · a second crossing over an unchanged town commits nothing and stays quiet", { skip: !SH_OK && "no POSIX sh" }, () => {
  const first = crossing("idem", { env: {} });
  assert.equal(first.res.status, 0, first.res.stderr);
  const firstSha = execFileSync("git", ["-C", first.origin, "rev-parse", "main"], { encoding: "utf8" }).trim();

  const second = runCrossing(first.root, { env: {} });
  assert.equal(second.res.status, 0, second.res.stderr);
  const secondSha = execFileSync("git", ["-C", second.origin, "rev-parse", "main"], { encoding: "utf8" }).trim();

  // The export re-stamps `generated_at` on every run, so a refresh that copied
  // unconditionally would put a commit on world main every twelve hours forever.
  assert.equal(secondSha, firstSha,
    "an unchanged town must move nothing: the substance is compared, not the stamp");
  assert.equal(second.receipt.registry.ran, true, "and the crossing still LOOKED — that is the whole receipt");
  assert.equal(second.receipt.registry.changed, false);
  assert.equal(second.receipt.status, "quiet",
    "a crossing that published nothing and changed no registry is quiet, as it always was");
});

test("F4 · a registry-only crossing publishes and still reports `quiet`, so the starving detector is not fed", { skip: !SH_OK && "no POSIX sh" }, () => {
  // The sweep publishes nothing; the registry moves. Main advances, so the old
  // `main != origin/main` test would have called this `published` with six zero
  // channels — and settlement-history's `--recurring` reads exactly that word to
  // decide whether the town has settled in three days.
  const c = crossing("registry-only", { env: {} });
  assert.equal(c.res.status, 0, c.res.stderr);
  assert.equal(c.receipt.status, "quiet",
    "a registry refresh must never be able to answer `has this town settled` with yes");
  assert.equal(c.receipt.registry.changed, true);
  assert.ok(c.published.households[NEWCOMER], "and it must still have PUBLISHED the registry, not merely written it");
  assert.notEqual(c.receipt.world_to, c.receipt.world_from,
    "the receipt names what actually landed on origin");
});

test("F5 · an export that trips refuses the crossing rather than folding on a registry nobody can vouch for", { skip: !SH_OK && "no POSIX sh" }, () => {
  const c = crossing("broken-export", { env: {},breakExport: true });
  assert.equal(c.res.status, 1, "a registry that cannot be derived is a refusal, not a quiet fallback");
  assert.equal(c.receipt.status, "refused");
  assert.match(String(c.receipt.detail), /household registry could not be re-derived/);
  assert.equal(c.registrySeen, null, "and nothing was printed — the printout never ran");
  assert.equal(c.published.generated_at, OLD_STAMP, "origin is untouched");
});

test("F6 · the stamp must name the tree the values came from, or nothing is written", () => {
  // The unit, driven directly, because the chain's guard against it can only
  // fire when an export and a crossing disagree — which on a real box means
  // never, and on a real box that is when it matters.
  const root = mkdtempSync(join(scratch, "stamp-"));
  const world = join(root, "world");
  mkdirSync(join(world, "WORLD"), { recursive: true });
  writeFileSync(join(world, "WORLD", "households.json"), `${JSON.stringify({ generated_at: OLD_STAMP, households: { alpha: "gh:1" }, logins: {} }, null, 2)}\n`);
  const fresh = join(root, "fresh.json");
  writeFileSync(fresh, `${JSON.stringify({
    generated_at: "2026-09-09T00:00:00.000Z", town_sha: "a".repeat(40),
    households: { alpha: "gh:1", [NEWCOMER]: `gh:${NEWCOMER_ID}` }, logins: {},
  }, null, 2)}\n`);

  const bad = spawnSync(process.execPath, [join(OFFICE, "deploy", "settlement-registry.mjs"),
    "--fresh", fresh, "--world", world, "--town-sha", "b".repeat(40)], { encoding: "utf8" });
  assert.equal(bad.status, 1, "a stamp naming another tree must refuse");
  assert.match(JSON.parse(bad.stdout).refused, /names a different town/);
  assert.equal(JSON.parse(readFileSync(join(world, "WORLD", "households.json"), "utf8")).generated_at, OLD_STAMP,
    "and it must have written NOTHING — a refusal that half-writes is worse than the staleness it refused");

  const good = spawnSync(process.execPath, [join(OFFICE, "deploy", "settlement-registry.mjs"),
    "--fresh", fresh, "--world", world, "--town-sha", "a".repeat(40)], { encoding: "utf8" });
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).changed, true);
  assert.equal(JSON.parse(readFileSync(join(world, "WORLD", "households.json"), "utf8")).households[NEWCOMER], `gh:${NEWCOMER_ID}`);
});

test("F7 · the refresh lands BEFORE the printout, as its own commit, and both reach origin in that order (POS-1025)", { skip: !SH_OK && "no POSIX sh" }, () => {
  // The printout's fold reads WORLD/households.json, so the refresh must be on
  // main before the printout looks; and the printout requires a clean world, so
  // the refresh commits on its own rather than riding the printout's commit.
  const c = crossing("ordered", { env: { PRINTOUT_PUBLISHES: "1" } });
  assert.equal(c.res.status, 0, c.res.stderr);
  assert.equal(c.receipt.status, "published");
  const log = execFileSync("git", ["-C", c.origin, "log", "-2", "--format=%s", "main"], { encoding: "utf8" }).trim().split("\n");
  assert.equal(log[0], "settlement: S214 printout — 1 written, 0 removed, 0 re-framed", "the printout is main's newest commit");
  assert.equal(c.receipt.registry.commit, execFileSync("git", ["-C", c.origin, "rev-parse", "main^"], { encoding: "utf8" }).trim(),
    "and the registry's commit is its parent");
  assert.equal(c.registrySeen.households[NEWCOMER], `solo:${NEWCOMER}`, "the printout read the refreshed registry");
  assert.equal(c.receipt.registry.households, 2);
});

// ── PINNED IDS ARE SUBSTANCE (WLD-122, office#796 review F1) ─────────────────
//
// The PR lane binds an author by `pinned_ids` alone (World tools/lane-author.mjs).
// While the comparator above read only households, logins and admins, a crossing
// that moved nothing else never rendered the field onto main, and an id that was
// re-pinned or left out kept its authority on main. Each test below runs the real
// export through a real crossing and reads what reached origin, with households,
// logins and admins shown unchanged, so `pinned_ids` is the only thing that moved.
// THE FLIP: drop `pinned_ids` from `substance` in deploy/settlement-registry.mjs
// and all three go red.

const sameOtherMaps = (a, b, why) => {
  assert.deepEqual(a.households, b.households, `${why}: households must not have moved`);
  assert.deepEqual(a.logins, b.logins, `${why}: logins must not have moved`);
  assert.deepEqual(a.admins ?? [], b.admins ?? [], `${why}: admins must not have moved`);
};

test("P1 · a world rendered before pinned_ids gets them on the next crossing, even a quiet one", { skip: !SH_OK && "no POSIX sh" }, () => {
  const first = crossing("pins-materialise", { env: {} });
  assert.equal(first.res.status, 0, first.res.stderr);
  assert.ok(first.published.pinned_ids && Object.keys(first.published.pinned_ids).length, "the export renders pinned_ids");
  const { pinned_ids, pinned_ids_note, ...before } = first.published;
  publishRegistry(first.root, before); // stamped, the same mapping, no pinned_ids: world main before #796
  moveTownWithoutMovingTheMapping(first.root, "pins");
  const second = runCrossing(first.root, { env: {} });
  assert.equal(second.res.status, 0, second.res.stderr);
  sameOtherMaps(second.published, before, "a quiet crossing");
  assert.equal(second.receipt.registry.changed, true, "pinned_ids moved, so the registry is rewritten");
  assert.deepEqual(second.published.pinned_ids, pinned_ids, "and world main now carries them");
});

// A house that lists two accounts under one login: the login keeps binding the
// house when its pin moves from one account to the other, so only the id moves.
const KILN = { schema_version: 1, households: { "kiln-house": {
  name: "Kiln House", since: "2026-01-01", declared_by: "alpha", residents: ["alpha"],
  accounts: [{ login: "alpha-hub", id: 900000401 }, { login: "alpha-hub", id: 900000402 }],
} } };
const KILN_PINS = (id) => ({ alpha: { login: "alpha-hub", id }, [NEWCOMER]: { login: NEWCOMER_LOGIN, id: NEWCOMER_ID } });

test("P2 · a re-pin to another account of the same house moves the id on main, and the old id binds nothing", { skip: !SH_OK && "no POSIX sh" }, () => {
  const first = crossing("pins-repin", { env: {},pins: KILN_PINS(900000401), declared: KILN });
  assert.equal(first.res.status, 0, first.res.stderr);
  assert.equal(first.published.pinned_ids["900000401"], "hh:kiln-house");
  restateTown(first.root, { pins: KILN_PINS(900000402) });
  const second = runCrossing(first.root, { env: {} });
  assert.equal(second.res.status, 0, second.res.stderr);
  sameOtherMaps(second.published, first.published, "a re-pin within the house");
  assert.equal(second.receipt.registry.changed, true);
  assert.equal(second.published.pinned_ids["900000402"], "hh:kiln-house", "the new account binds the house");
  assert.equal(Object.hasOwn(second.published.pinned_ids, "900000401"), false, "the old account binds nothing on main");
});

test("P3 · an id the export stops binding (now on two houses' lists) is gone from main", { skip: !SH_OK && "no POSIX sh" }, () => {
  const first = crossing("pins-conflict", { env: {},pins: KILN_PINS(900000401), declared: KILN });
  assert.equal(first.res.status, 0, first.res.stderr);
  assert.equal(first.published.pinned_ids["900000401"], "hh:kiln-house");
  // a second house lists the same account: the export leaves the id out, and names it
  const ash = { "ash-house": { name: "Ash House", since: "2026-01-01", declared_by: "ash", residents: [], accounts: [{ login: "ash-hub", id: 900000401 }] } };
  restateTown(first.root, { declared: { schema_version: 1, households: { ...ash, ...KILN.households } } });
  const second = runCrossing(first.root, { env: {} });
  assert.equal(second.res.status, 0, second.res.stderr);
  sameOtherMaps(second.published, first.published, "a conflict on the account lists");
  assert.equal(second.receipt.registry.changed, true);
  assert.equal(Object.hasOwn(second.published.pinned_ids, "900000401"), false, "a conflicted id binds nothing on main");
  assert.equal(second.published.pinned_ids[String(NEWCOMER_ID)], first.published.pinned_ids[String(NEWCOMER_ID)], "the other bindings stand");
});
