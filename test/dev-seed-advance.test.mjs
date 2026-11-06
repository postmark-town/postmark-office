// dev-seed-advance.test.mjs — the dev seed advance is one deliberate tool (POS-791).
//
// deploy/dev-seed-advance.sh runs here whole under bash, with every box command a
// stub on PATH: no box, no Postgres, no sudo. `sudo` drops its flags and execs,
// so the script's `bash -c` law-pen line really runs, with the real
// deploy/world2-lib.sh. Every other stub logs its call to one file, in order, and
// exits 7 when STUB_FAIL matches the call.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { tempDir } from "./helpers/temp-dir.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "deploy", "dev-seed-advance.sh");
const posix = (p) => p.replaceAll("\\", "/");
const skip = spawnSync("bash", ["-c", "exit 0"]).status === 0 ? false : "no bash on this host";

const SANDBOX = "w2_devsandbox_20260925";
const TOWN = "a".repeat(40), WORLD = "b".repeat(40), OLD = "c".repeat(40);
const TOWN_HEAD = "d".repeat(40);

/** The ledger's parser, in the town's shape (tools/stamp-mint.mjs § parseStampLedger). */
const STAMP_MINT = `export function parseStampLedger(text) {
  return text.split("\\n").filter((l) => l.startsWith("- ")).map((raw) => {
    const m = /^(.*) · sig: (\\S+)$/.exec(raw);
    return { canonical: m[1], sig: m[2], raw };
  });
}\n`;
const ledgerOf = (sigs) => `# the stamp ledger\n\n${sigs.map((s, i) => `- line ${i + 1} · sig: ${s}`).join("\n")}\n`;

// Every stub logs its name and arguments, then fails if STUB_FAIL matches them.
const LOGGED = 'echo "$NAME $*" >> "$STUB_LOG"\nif [ -n "${STUB_FAIL:-}" ] && [[ "$NAME $*" =~ $STUB_FAIL ]]; then echo "$NAME: stubbed failure" >&2; exit 7; fi\n';
const STUBS = {
  // exec, with the flags off; the env file's grep stands alone, since the box's file isn't here
  sudo: `while :; do case "\${1:-}" in -n) shift ;; -u) shift 2 ;; *) break ;; esac; done
if [ "$1" = grep ]; then NAME=grep; shift; ${LOGGED}exit "\${STUB_ENV_GREP:-0}"; fi
exec "$@"\n`,
  runuser: 'shift 3; exec "$@"\n', // -u meepo --
  git: `NAME=git; ${LOGGED}case "$*" in
  *" remote get-url --push "*) case "$2" in *town-clone) echo "$STUB_PUSH_TOWN" ;; *) echo "$STUB_PUSH_WORLD" ;; esac ;;
  *" remote") echo origin ;;
  *" ls-remote "*) case "$2" in
      *town-clone) printf '%s\\trefs/tags/sandbox/seed\\n' "$STUB_TAG_TOWN" ;;
      *) printf '%s\\trefs/tags/sandbox/seed\\n' "$STUB_TAG_WORLD"
         if [ -n "\${STUB_WORLD_PEELED:-}" ]; then printf '%s\\trefs/tags/sandbox/seed^{}\\n' "$STUB_WORLD_PEELED"; fi ;;
    esac ;;
  *" rev-parse HEAD") echo "$STUB_TOWN_HEAD" ;;
esac\n`,
  // the one node that really runs is the chain comparison; the rest are logged
  node: `if [ "$1" = --input-type=module ]; then "$STUB_REAL_NODE" "$@" || exit $?; NAME=node; shift 3; set -- chain-comparison; ${LOGGED}exit 0; fi
NAME=node; ${LOGGED}exit 0\n`,
  psql: `NAME=psql; ${LOGGED}case "$*" in
  *"SELECT sig"*) cat "$STUB_STORE_SIGS" ;;
  *"SELECT sha"*) echo "$STUB_PIN" ;;
esac\n`,
  systemctl: `NAME=systemctl; ${LOGGED}`,
  // drops its own properties, so the command it runs logs as itself
  "systemd-run": 'while [ "${1#-}" != "$1" ]; do case "$1" in -p) shift 2 ;; *) shift ;; esac; done\nexec "$@"\n',
  realpath: 'for last; do :; done\ncase "$last" in *town-clone) [ -n "${STUB_REAL_TOWN:-}" ] && { echo "$STUB_REAL_TOWN"; exit 0; } ;; esac\nexec /usr/bin/realpath "$@"\n',
};

function box({ lib = null, ledger = ["s1", "s2", "s3"], store = ["s1", "s2", "s3"] } = {}) {
  const dir = tempDir("dev-seed-advance-");
  const bin = join(dir, "bin"), tree = join(dir, "srv-dev");
  mkdirSync(bin);
  for (const [name, body] of Object.entries(STUBS)) writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}`, { mode: 0o755 });
  mkdirSync(join(tree, "deploy"), { recursive: true });
  if (lib) writeFileSync(join(tree, "deploy", "world2-lib.sh"), lib);
  else copyFileSync(join(ROOT, "deploy", "world2-lib.sh"), join(tree, "deploy", "world2-lib.sh"));
  mkdirSync(join(tree, "town-clone", "tools"), { recursive: true });
  mkdirSync(join(tree, "town-clone", "WHITE_PAGES"), { recursive: true });
  mkdirSync(join(tree, "world-clone"), { recursive: true });
  writeFileSync(join(tree, "town-clone", "tools", "stamp-mint.mjs"), STAMP_MINT);
  writeFileSync(join(tree, "town-clone", "WHITE_PAGES", "stamp-ledger.md"), ledgerOf(ledger));
  const sigs = join(dir, "store-sigs.txt");
  writeFileSync(sigs, store.length ? `${store.join("\n")}\n` : "");
  const creds = join(dir, "world2.env");
  writeFileSync(creds, "PG_LAW_INGESTER_PASSWORD=invented-for-this-test\n");
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  return { bin, tree, log, sigs, creds };
}

function advance({ args = ["--town", TOWN, "--world", WORLD, "--go"], env = {}, ...setup } = {}) {
  const b = box(setup);
  const base = { ...process.env };
  const pathKey = Object.keys(base).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  base[pathKey] = `${b.bin}${delimiter}${base[pathKey] ?? ""}`;
  for (const k of ["WORLD2_DB", "PGDATABASE", "STUB_FAIL", "STUB_WORLD_PEELED", "STUB_REAL_TOWN", "STUB_ENV_GREP"]) delete base[k];
  const merged = {
    ...base,
    DEV_SEED_ADVANCE_TEST_ROOT: posix(b.tree),
    WORLD2_DB: SANDBOX,
    WORLD2_ENV_FILE: posix(b.creds),
    STUB_LOG: posix(b.log),
    STUB_REAL_NODE: posix(process.execPath),
    STUB_STORE_SIGS: posix(b.sigs),
    STUB_PUSH_TOWN: "DISABLED-dev-channel-never-pushes",
    STUB_PUSH_WORLD: "DISABLED-dev-channel-never-pushes",
    STUB_TAG_TOWN: TOWN,
    STUB_TAG_WORLD: WORLD,
    STUB_TOWN_HEAD: TOWN_HEAD,
    STUB_PIN: WORLD,
    ...env,
  };
  for (const [k, v] of Object.entries(merged)) if (v === undefined) delete merged[k];
  const r = spawnSync("bash", [posix(SCRIPT), ...args], { encoding: "utf8", env: merged, timeout: 60_000 });
  return { ...r, calls: readFileSync(b.log, "utf8").split("\n").filter(Boolean), tree: posix(b.tree) };
}

// Each act's mark in the log, in the script's order. Reads are not among them.
const ACTS = [
  ["the freshen", /^systemctl start postmark-dev-freshen\.service$/],
  ["the trim", /^psql .*DELETE FROM stamp_lines WHERE seq > \d+/],
  ["the sync", /^node world2\/tools\/stamp-lines\.mjs --sync --clone /],
  ["the verify", /^node world2\/tools\/stamp-lines\.mjs --verify --clone /],
  ["the reseed", /^node world2\/tools\/town-index-ingest\.mjs .*--seed --reseed$/],
  ["the law", /^node world2\/tools\/law-ingest\.mjs --law-repo /],
  ["the preflight", /^node tools\/dev-rehearsal\.mjs --user meepo --only preflight$/],
];
const actsIn = (calls) => calls.flatMap((c) => ACTS.filter(([, re]) => re.test(c)).map(([name]) => name));
const WRITE_VERB = /^git .* (fetch|tag|push|reset|switch|commit) /;
const assertNothingWrote = (r) => {
  assert.deepEqual(actsIn(r.calls), [], "no step ran");
  assert.deepEqual(r.calls.filter((c) => WRITE_VERB.test(c)), [], "no git write");
};

// ── (a) without --go it writes nothing ───────────────────────────────────────

test("without --go it prints the plan and runs nothing at all, not even a read", { skip }, () => {
  const r = advance({ args: ["--town", TOWN, "--world", WORLD] });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls, [], "not one box command was called");
  assert.match(r.stdout, /Nothing ran/);
  for (const [word, sha] of [["town", TOWN], ["world", WORLD]]) assert.match(r.stdout, new RegExp(`${word} ${sha}`));
  for (const step of ["retag", "freshen", "stamp-lines --sync, then --verify", "--seed --reseed", "law-ingest", "--only preflight"]) assert.ok(r.stdout.includes(step), step);
});

test("a missing or short sha is usage, and runs nothing, --go or not", { skip }, () => {
  for (const args of [[], ["--go"], ["--town", TOWN, "--go"], ["--town", "abc123", "--world", WORLD, "--go"], ["--town", TOWN, "--world", WORLD, "--force"]]) {
    const r = advance({ args });
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, /usage:/);
    assert.deepEqual(r.calls, []);
  }
});

// ── (b) prod's database, or a clone that isn't dev's, is refused before any step ──

test("no WORLD2_DB is refused before any box command, naming the fall-back to prod", { skip }, () => {
  const r = advance({ env: { WORLD2_DB: undefined } });
  assert.equal(r.status, 9);
  assert.match(r.stderr, /REFUSED: no WORLD2_DB is set.*world2_dev, PROD's store/);
  assert.deepEqual(r.calls, []);
});

test("a WORLD2_DB that isn't the sandbox is refused before any box command, prod's among them", { skip }, () => {
  for (const db of ["world2_dev", "world2", `${SANDBOX}x`]) {
    const r = advance({ env: { WORLD2_DB: db } });
    assert.equal(r.status, 9, db);
    assert.match(r.stderr, new RegExp(`REFUSED: WORLD2_DB is ${db}, not the dev sandbox`));
    assert.deepEqual(r.calls, [], db);
  }
});

test("a law pen that lands on prod's database is refused before any step (DEPLOY step 7's assert)", { skip }, () => {
  const r = advance({ lib: 'w2_pgenv() { export PGDATABASE=world2_dev PGUSER="$1"; }\n' });
  assert.equal(r.status, 9, r.stderr);
  assert.match(r.stderr, /REFUSED: world2_dev is not the dev sandbox/);
  assertNothingWrote(r);
});

test("a law pen with no readable password is refused before any step", { skip }, () => {
  const r = advance({ env: { WORLD2_ENV_FILE: "/nonexistent/world2.env", PG_LAW_INGESTER_PASSWORD: undefined } });
  assert.equal(r.status, 9, r.stderr);
  assert.match(r.stderr, /REFUSED: the law pen does not reach/);
  assertNothingWrote(r);
});

test("a dev office env file that doesn't name the sandbox is refused before any step", { skip }, () => {
  const r = advance({ env: { STUB_ENV_GREP: "1" } });
  assert.equal(r.status, 9, r.stderr);
  assert.match(r.stderr, /REFUSED: \/etc\/postmark-office-dev\.env does not name/);
  assertNothingWrote(r);
});

test("a clone with a real push URL is refused before any step, whichever clone", { skip }, () => {
  const real = "https://github.com/postmark-town/postmark.git";
  for (const [key, clone] of [["STUB_PUSH_TOWN", "town-clone"], ["STUB_PUSH_WORLD", "world-clone"]]) {
    const r = advance({ env: { [key]: real } });
    assert.equal(r.status, 9, r.stderr);
    assert.match(r.stderr, new RegExp(`REFUSED: .*${clone}'s remote origin can push`));
    assert.doesNotMatch(r.stderr, /github\.com/, "the URL itself is not printed");
    assertNothingWrote(r);
  }
});

test("a clone whose real path leaves the dev tree is refused before any step", { skip }, () => {
  const r = advance({ env: { STUB_REAL_TOWN: "/srv/postmark-office/town-clone" } });
  assert.equal(r.status, 9, r.stderr);
  assert.match(r.stderr, /REFUSED: .*is really \/srv\/postmark-office\/town-clone, outside the dev tree/);
  assertNothingWrote(r);
});

test("the test seam can't name prod's tree, however it is spelled", { skip }, () => {
  for (const tree of ["/srv/postmark-office", "/srv/postmark-office/", "/srv//postmark-office", "/srv/postmark-office-dev/../postmark-office"]) {
    const r = advance({ env: { DEV_SEED_ADVANCE_TEST_ROOT: tree } });
    assert.equal(r.status, 9, tree);
    assert.match(r.stderr, /REFUSED: .* is not the dev office's tree/, tree);
    assert.deepEqual(r.calls, [], tree);
  }
});

// ── (c) the steps run in order ───────────────────────────────────────────────

test("the steps run in order, and the last line names the full rehearsal as the person's next step", { skip }, () => {
  const r = advance();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(actsIn(r.calls), ACTS.map(([name]) => name));
  const lsRemotes = r.calls.findIndex((c) => / ls-remote /.test(c));
  assert.ok(lsRemotes !== -1 && lsRemotes < r.calls.findIndex((c) => ACTS[0][1].test(c)), "the retag's read comes before the freshen");
  assert.ok(r.calls.some((c) => c === `node world2/tools/town-index-ingest.mjs --town-repo ${r.tree}/town-clone --sha ${TOWN_HEAD} --seed --reseed`), "reseeded at the clone's head");
  assert.ok(r.calls.some((c) => c === `node world2/tools/law-ingest.mjs --law-repo ${r.tree}/world-clone --sha ${WORLD}`), "the law at the given world sha");
  assert.deepEqual(r.calls.filter((c) => WRITE_VERB.test(c)), [], "it writes no git of its own: the freshen does");
  assert.match(r.stdout.trim().split("\n").at(-1), /full rehearsal is yours: .*dev-rehearsal\.mjs --user meepo --report /);
});

test("a real advance: the trim keeps only what the store and the new seed's ledger share, and the sync records the rest", { skip }, () => {
  // The old seed's three lines and two rehearsal lines; the new seed runs to six.
  // Trimming to the ledger's length (6) would delete nothing and --verify would red.
  const r = advance({ store: ["s1", "s2", "s3", "rehearsal4", "rehearsal5"], ledger: ["s1", "s2", "s3", "s4", "s5", "s6"] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /the store holds 5 line\(s\), the clone's ledger 6, and they agree through line 3/);
  assert.ok(r.calls.some((c) => /DELETE FROM stamp_lines WHERE seq > 3$/.test(c)), r.calls.join("\n"));
});

test("an unchanged seed: the trim is DEPLOY's DELETE at the ledger's length", { skip }, () => {
  const r = advance({ store: ["s1", "s2", "s3", "rehearsal4"], ledger: ["s1", "s2", "s3"] });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.calls.some((c) => /DELETE FROM stamp_lines WHERE seq > 3$/.test(c)), r.calls.join("\n"));
});

test("a store that lost the agreement at line 1, or that is empty, trims to nothing and the sync fills it", { skip }, () => {
  for (const store of [["other1", "other2"], []]) {
    const r = advance({ store, ledger: ["s1", "s2"] });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.calls.some((c) => /DELETE FROM stamp_lines WHERE seq > 0$/.test(c)), r.calls.join("\n"));
  }
});

// ── the retag: this box can't push it, so it stops and prints it ─────────────

test("origin's tag is not the pair: stops at step 1 having written nothing, and prints the retag for the repo that differs", { skip }, () => {
  const r = advance({ env: { STUB_TAG_WORLD: OLD } });
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /STOPPED at step 1 \(the retag\)/);
  assert.match(r.stderr, new RegExp(`postmark-town/postmark-world: origin has ${OLD}`));
  assert.ok(r.stderr.includes(`git tag -f sandbox/seed ${WORLD} && git push --force origin refs/tags/sandbox/seed`));
  assert.ok(!r.stderr.includes(`git tag -f sandbox/seed ${TOWN}`), "the town's tag is already right");
  assertNothingWrote(r);
});

test("both tags off: both retags are printed", { skip }, () => {
  const r = advance({ env: { STUB_TAG_TOWN: OLD, STUB_TAG_WORLD: OLD } });
  assert.equal(r.status, 3);
  assert.ok(r.stderr.includes(`git tag -f sandbox/seed ${TOWN}`));
  assert.ok(r.stderr.includes(`git tag -f sandbox/seed ${WORLD}`));
  assertNothingWrote(r);
});

test("an annotated tag is read by the commit it points at", { skip }, () => {
  // the tag object has its own sha (OLD here); the commit it points at is the pair's
  const r = advance({ env: { STUB_TAG_WORLD: OLD, STUB_WORLD_PEELED: WORLD } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /origin's sandbox\/seed is this pair/);
});

// ── (d) a failing step stops the rest and is named ───────────────────────────

const FAILS = [
  { fail: "^systemctl start postmark-dev-freshen", step: 2, name: "the freshen", ran: 0 },
  { fail: "^psql .*DELETE FROM stamp_lines", step: 3, name: "the stamp chain: trim, sync, verify", ran: 1 },
  { fail: "^node .*stamp-lines\\.mjs --sync", step: 3, name: "the stamp chain: trim, sync, verify", ran: 2 },
  { fail: "^node .*stamp-lines\\.mjs --verify", step: 3, name: "the stamp chain: trim, sync, verify", ran: 3 },
  { fail: "^node .*town-index-ingest", step: 4, name: "the town index, reseeded at the clone's head", ran: 4 },
  { fail: "^node .*law-ingest", step: 5, name: "the world law, ingested forward", ran: 5 },
  { fail: "^node tools/dev-rehearsal", step: 6, name: "the preflight", ran: 6 },
];

for (const { fail, step, name, ran } of FAILS) {
  test(`a failing step stops the rest and is named: ${fail}`, { skip }, () => {
    const r = advance({ env: { STUB_FAIL: fail } });
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.stderr.includes(`STOPPED at step ${step} (${name})`), r.stderr);
    assert.deepEqual(actsIn(r.calls).slice(0, ran), ACTS.slice(0, ran).map(([n]) => n), "everything before it ran");
    assert.equal(actsIn(r.calls).length, ran + 1, "the failing act is the last one");
    assert.doesNotMatch(r.stdout, /full rehearsal is yours/);
  });
}

test("a world-law pin that law-ingest held stops at step 5, though law-ingest exited 0", { skip }, () => {
  const r = advance({ env: { STUB_PIN: OLD } });
  assert.equal(r.status, 1, r.stderr);
  assert.ok(r.stderr.includes(`STOPPED at step 5 (the world law, ingested forward): the world-law pin stands at ${OLD}, not ${WORLD}`), r.stderr);
  assert.ok(!actsIn(r.calls).includes("the preflight"));
});
