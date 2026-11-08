// dev-seed-advance.test.mjs — the dev seed advance is one deliberate tool (POS-791).
//
// deploy/dev-seed-advance.sh runs here whole under bash, with every box command a
// stub on PATH: no box, no Postgres, no sudo. `sudo` drops its flags and execs,
// so the script's `bash -c` law-pen line really runs, with the real
// deploy/world2-lib.sh, and the env file's `grep` is the real one over a fixture
// standing for the box's file. Every other stub logs its call to one file, in
// order, and exits 7 when STUB_FAIL matches the call.

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
const OFFICE_ENV_SECRET = "invented-office-env-password";
const STORE_AT = `postgres://office_api:${OFFICE_ENV_SECRET}@localhost:5432`;

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
  // exec, with the flags off and the law pen's names unset, as the real sudo's env_reset leaves them.
  // The env file's grep is the real one, over the fixture that stands for the box's file.
  sudo: `unset WORLD2_DB STAMP_LINES PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD
while :; do case "\${1:-}" in -n) shift ;; -u) shift 2 ;; *) break ;; esac; done
if [ "$1" = grep ]; then NAME=grep; shift; ${LOGGED}[ "\${!#}" = /etc/postmark-office-dev.env ] || { echo "sudo stub: grep asked of \${!#}" >&2; exit 8; }
  exec grep "\${@:1:$#-1}" "$STUB_OFFICE_ENV"; fi
exec "$@"\n`,
  runuser: 'shift 3; exec "$@"\n', // -u meepo --
  git: `NAME=git; ${LOGGED}case "$*" in
  *" remote get-url --push "*) if [ "$6" != origin ]; then echo "$STUB_PUSH_OTHER"; else case "$2" in *town-clone) echo "$STUB_PUSH_TOWN" ;; *) echo "$STUB_PUSH_WORLD" ;; esac; fi ;;
  *" remote") echo "$STUB_REMOTES" ;;
  *" ls-remote "*) case "$2" in
      *town-clone) printf '%s\\trefs/tags/sandbox/seed\\n' "$STUB_TAG_TOWN" ;;
      *) printf '%s\\trefs/tags/sandbox/seed\\n' "$STUB_TAG_WORLD"
         if [ -n "\${STUB_WORLD_PEELED:-}" ]; then printf '%s\\trefs/tags/sandbox/seed^{}\\n' "$STUB_WORLD_PEELED"; fi ;;
    esac ;;
  *" rev-parse HEAD") echo "$STUB_TOWN_HEAD" ;;
esac\n`,
  // the one node that really runs is the chain comparison, unless a test names what it prints;
  // the rest log their call, and the store identity each would connect with
  node: `if [ "$1" = --input-type=module ]; then
  if [ -n "\${STUB_CHAIN_PRINTS:-}" ]; then cat > /dev/null; echo "$STUB_CHAIN_PRINTS"; else "$STUB_REAL_NODE" "$@" || exit $?; fi
  NAME=node; shift 3; set -- chain-comparison; ${LOGGED}exit 0
fi
NAME=node; ${LOGGED}echo "$1 PGUSER=\${PGUSER:-} PGDATABASE=\${PGDATABASE:-} STAMP_LINES=\${STAMP_LINES:-}" >> "$STUB_ENV_LOG"; exit 0\n`,
  psql: `NAME=psql; ${LOGGED}case "$*" in
  *"SELECT sig"*) cat "$STUB_STORE_SIGS" ;;
  *"SELECT sha"*) echo "$STUB_PIN" ;;
esac\n`,
  systemctl: `NAME=systemctl; ${LOGGED}`,
  // drops its own properties, so the command it runs logs as itself
  "systemd-run": 'while [ "${1#-}" != "$1" ]; do case "$1" in -p) shift 2 ;; *) shift ;; esac; done\nexec "$@"\n',
  realpath: 'for last; do :; done\ncase "$last" in\n  *town-clone) [ -n "${STUB_REAL_TOWN:-}" ] && { echo "$STUB_REAL_TOWN"; exit 0; } ;;\n  *world-clone) [ -n "${STUB_REAL_WORLD:-}" ] && { echo "$STUB_REAL_WORLD"; exit 0; } ;;\nesac\nexec /usr/bin/realpath "$@"\n',
};

function box({ lib = null, ledger = ["s1", "s2", "s3"], store = ["s1", "s2", "s3"], officeEnvLine = `WORLD2_PG_URL=${STORE_AT}/${SANDBOX}` } = {}) {
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
  if (ledger) writeFileSync(join(tree, "town-clone", "WHITE_PAGES", "stamp-ledger.md"), ledgerOf(ledger));
  const sigs = join(dir, "store-sigs.txt");
  writeFileSync(sigs, store.length ? `${store.join("\n")}\n` : "");
  const creds = join(dir, "world2.env");
  writeFileSync(creds, "PG_LAW_INGESTER_PASSWORD=invented-for-this-test\n");
  const officeEnv = join(dir, "office-dev.env");
  writeFileSync(officeEnv, `WORLD2_PG=1\n${officeEnvLine}\nTOWN_PUSH=0\n`);
  const log = join(dir, "calls.log"), envLog = join(dir, "envs.log");
  writeFileSync(log, "");
  writeFileSync(envLog, "");
  return { bin, tree, log, envLog, sigs, creds, officeEnv };
}

function advance({ args = ["--town", TOWN, "--world", WORLD, "--go"], env = {}, ...setup } = {}) {
  const b = box(setup);
  const base = { ...process.env };
  const pathKey = Object.keys(base).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  base[pathKey] = `${b.bin}${delimiter}${base[pathKey] ?? ""}`;
  for (const k of ["WORLD2_DB", "PGDATABASE", "STUB_FAIL", "STUB_WORLD_PEELED", "STUB_REAL_TOWN", "STUB_REAL_WORLD", "STUB_CHAIN_PRINTS"]) delete base[k];
  const merged = {
    ...base,
    DEV_SEED_ADVANCE_TEST_ROOT: posix(b.tree),
    WORLD2_DB: SANDBOX,
    WORLD2_ENV_FILE: posix(b.creds),
    STUB_LOG: posix(b.log),
    STUB_ENV_LOG: posix(b.envLog),
    STUB_OFFICE_ENV: posix(b.officeEnv),
    STUB_REAL_NODE: posix(process.execPath),
    STUB_STORE_SIGS: posix(b.sigs),
    STUB_REMOTES: "origin",
    STUB_PUSH_TOWN: "DISABLED-dev-channel-never-pushes",
    STUB_PUSH_WORLD: "DISABLED-dev-channel-never-pushes",
    STUB_PUSH_OTHER: "DISABLED-dev-channel-never-pushes",
    STUB_TAG_TOWN: TOWN,
    STUB_TAG_WORLD: WORLD,
    STUB_TOWN_HEAD: TOWN_HEAD,
    STUB_PIN: WORLD,
    ...env,
  };
  for (const [k, v] of Object.entries(merged)) if (v === undefined) delete merged[k];
  const r = spawnSync("bash", [posix(SCRIPT), ...args], { encoding: "utf8", env: merged, timeout: 60_000 });
  const lines = (f) => readFileSync(f, "utf8").split("\n").filter(Boolean);
  return { ...r, calls: lines(b.log), envs: lines(b.envLog), tree: posix(b.tree) };
}

// Each act's mark in the log, in the script's order. Reads are not among them.
const ACTS = [
  ["the freshen", /^systemctl start postmark-dev-freshen\.service$/],
  ["the trim", /^psql .*DELETE FROM stamp_lines WHERE seq > \d+/],
  ["the sync", /^node world2\/tools\/stamp-lines\.mjs --sync --clone /],
  ["the verify", /^node world2\/tools\/stamp-lines\.mjs --verify --clone /],
  ["the reseed", /^node world2\/tools\/town-index-ingest\.mjs .*--seed --reseed$/],
  ["the law", /^node world2\/tools\/law-ingest\.mjs --law-repo /],
  ["the snapshot", /^node src\/world-hydrate\.mjs .*--to-store$/],
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
  for (const step of ["retag", "freshen", "stamp-lines --sync, then --verify", "--seed --reseed", "law-ingest", "world-hydrate --to-store", "--only preflight"]) assert.ok(r.stdout.includes(step), step);
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

// The script's own reason: "stamp-lines reaches the store through this file's URL, so it is checked too."
// Each line runs the script's real pattern through the real grep, over a real file.
const ENV_LINES_REFUSED = {
  "prod's store": `WORLD2_PG_URL=${STORE_AT}/world2_dev`,
  "prod's store, double-quoted": `WORLD2_PG_URL="${STORE_AT}/world2_dev"`,
  "prod's store with the sandbox's name in its query": `WORLD2_PG_URL=${STORE_AT}/world2_dev?options=/${SANDBOX}`,
  "no database, the sandbox's name in the query": `WORLD2_PG_URL=${STORE_AT}?options=/${SANDBOX}`,
  "no database, the sandbox's name in the fragment": `WORLD2_PG_URL=${STORE_AT}#/${SANDBOX}`,
  "a path that only ends in the sandbox's name": `WORLD2_PG_URL=${STORE_AT}/world2_dev/${SANDBOX}`,
  "a longer name than the sandbox's": `WORLD2_PG_URL=${STORE_AT}/${SANDBOX}x`,
  "no WORLD2_PG_URL in the file": `WORLD2_CLEARING_URL=${STORE_AT}/${SANDBOX}`,
  "the sandbox's URL commented out": `#WORLD2_PG_URL=${STORE_AT}/${SANDBOX}`,
};
for (const [what, officeEnvLine] of Object.entries(ENV_LINES_REFUSED)) {
  test(`a dev office env file is refused before any step: ${what}`, { skip }, () => {
    const r = advance({ officeEnvLine });
    assert.equal(r.status, 9, r.stderr);
    assert.match(r.stderr, /REFUSED: \/etc\/postmark-office-dev\.env does not name/);
    assert.ok(!(r.stdout + r.stderr).includes(OFFICE_ENV_SECRET), "the URL's password is not printed");
    assertNothingWrote(r);
  });
}

const ENV_LINES_PASSED = {
  "the sandbox's URL, bare": `WORLD2_PG_URL=${STORE_AT}/${SANDBOX}`,
  "double-quoted": `WORLD2_PG_URL="${STORE_AT}/${SANDBOX}"`,
  "with a query": `WORLD2_PG_URL=${STORE_AT}/${SANDBOX}?sslmode=require`,
  "double-quoted, with a query": `WORLD2_PG_URL="${STORE_AT}/${SANDBOX}?sslmode=require"`,
  "the postgresql scheme": `WORLD2_PG_URL=postgresql://office_api:${OFFICE_ENV_SECRET}@localhost:5432/${SANDBOX}`,
};
for (const [what, officeEnvLine] of Object.entries(ENV_LINES_PASSED)) {
  // Past the refusals, and stopped by a tag off the pair: step 1 is the first thing after them.
  test(`a dev office env file naming the sandbox passes: ${what}`, { skip }, () => {
    const r = advance({ officeEnvLine, env: { STUB_TAG_TOWN: OLD } });
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /STOPPED at step 1 \(the retag\)/);
    assert.ok(r.calls.some((c) => c.startsWith("grep ") && c.endsWith(" /etc/postmark-office-dev.env")), r.calls.join("\n"));
    assert.ok(!(r.stdout + r.stderr).includes(OFFICE_ENV_SECRET), "the URL's password is not printed");
    assertNothingWrote(r);
  });
}

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

test("a second remote that can push is refused before any step, though origin can't", { skip }, () => {
  const r = advance({ env: { STUB_REMOTES: "origin fork", STUB_PUSH_OTHER: "https://github.com/postmark-town/postmark.git" } });
  assert.equal(r.status, 9, r.stderr);
  assert.match(r.stderr, /REFUSED: .*town-clone's remote fork can push/);
  assertNothingWrote(r);
});

test("a clone whose real path leaves the dev tree is refused before any step, whichever clone", { skip }, () => {
  for (const [key, clone] of [["STUB_REAL_TOWN", "town-clone"], ["STUB_REAL_WORLD", "world-clone"]]) {
    const r = advance({ env: { [key]: `/srv/postmark-office/${clone}` } });
    assert.equal(r.status, 9, r.stderr);
    assert.match(r.stderr, new RegExp(`REFUSED: .*is really /srv/postmark-office/${clone}, outside the dev tree`));
    assertNothingWrote(r);
  }
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
  assert.ok(r.calls.some((c) => c === `node src/world-hydrate.mjs --world ${r.tree}/world-clone --office ${r.tree} --to-store`), "the snapshot, by sandbox-reset.sh's line");
  assert.deepEqual(r.calls.filter((c) => WRITE_VERB.test(c)), [], "it writes no git of its own: the freshen does");
  assert.match(r.stdout.trim().split("\n").at(-1), /full rehearsal is yours: .*dev-rehearsal\.mjs --user meepo --report /);
});

test("the law pen's three writes connect as law_ingester, to the sandbox, with the store's stamp chain", { skip }, () => {
  // DEPLOY step 7's line: "export WORLD2_DB=w2_devsandbox_20260925 STAMP_LINES=store", then w2_pgenv law_ingester.
  const r = advance();
  assert.equal(r.status, 0, r.stderr);
  for (const tool of ["world2/tools/town-index-ingest.mjs", "world2/tools/law-ingest.mjs", "src/world-hydrate.mjs"]) {
    assert.ok(r.envs.includes(`${tool} PGUSER=law_ingester PGDATABASE=${SANDBOX} STAMP_LINES=store`), `${tool}: ${r.envs.join("\n")}`);
  }
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
  { fail: "^node .*world-hydrate", step: 6, name: "the world graph snapshot, rebuilt from the seed", ran: 6 },
  { fail: "^node tools/dev-rehearsal", step: 7, name: "the preflight", ran: 7 },
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

test("a world-law pin that law-ingest held stops at step 5, though law-ingest exited 0, and names the remedy", { skip }, () => {
  const r = advance({ env: { STUB_PIN: OLD } });
  assert.equal(r.status, 1, r.stderr);
  assert.ok(r.stderr.includes(`STOPPED at step 5 (the world law, ingested forward): the world-law pin stands at ${OLD}, not ${WORLD}`), r.stderr);
  // With the row gone, law-ingest's pinMove reads "no pin yet" and moves it (test/law-pin-forward.test.mjs).
  assert.ok(r.stderr.includes(`sudo -u postgres psql -d ${SANDBOX} -v ON_ERROR_STOP=1 -c "SET ROLE world2_owner; DELETE FROM projection_heads WHERE repo = 'world-law'"`), r.stderr);
  assert.deepEqual(actsIn(r.calls).slice(-1), ["the law"], "neither the snapshot nor the preflight ran");
});

// ── a chain comparison that fails stops before the trim can read it ─────────

for (const [what, setup, how] of [
  ["the store can't be read", { env: { STUB_FAIL: "^psql .*SELECT sig" } }, "could not compare"],
  ["the clone's ledger can't be read", { ledger: null }, "could not compare"],
  ["it prints words, not counts", { env: { STUB_CHAIN_PRINTS: "no counts here" } }, "not three counts"],
]) {
  test(`a chain comparison that fails stops at step 3, before the trim: ${what}`, { skip }, () => {
    const r = advance(setup);
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.stderr.includes(`STOPPED at step 3 (the stamp chain: trim, sync, verify)`), r.stderr);
    assert.ok(r.stderr.includes(how), r.stderr);
    assert.deepEqual(actsIn(r.calls), ["the freshen"], "the freshen ran, and nothing after it");
  });
}
