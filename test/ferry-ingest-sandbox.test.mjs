// ferry-ingest-sandbox.test.mjs — POS-341's last blocker: the ferry's sandbox
// lets the town-index ingest run, and gives it one password, not the file.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/ferry-ingest-sandbox.test.mjs
//
// ── WHAT FAILED (the 2026-10-20 box sitting, RUNBOOK gap 1, found item 1) ────
// In store mode deploy/postmark-ferry.service runs deploy/town-index-ingest.sh as
// meepo under ProtectSystem=strict with ReadWritePaths=/srv/postmark-office. The
// ingest could not read PG_LAW_INGESTER_PASSWORD (it lives only in the root-0600
// world2 env file, which also carries the owner's password), and its clone and
// state directory were read-only. It is the only writer of town_mail_lines, so
// every delivering crossing's store mint decided on stale deliveries and went red.
//
// ── WHAT RUNS HERE ──────────────────────────────────────────────────────────
// 1. The unit's text: the sandbox grants exactly the ingest's two write paths
//    (the paths the script and world2-lib.sh resolve to, read from their text),
//    loads exactly one credential by ID (never a path: a missing absolute path
//    fails the whole unit, every crossing), and never names the world2 env file.
// 2. The SHIPPED SCRIPT, run whole by bash against a scratch lab: a local origin
//    for its clone and a stub for the tool that reports what it was handed. The
//    password comes from $CREDENTIALS_DIRECTORY when the environment has none;
//    the environment still wins (the timer's path); with neither it refuses by
//    name; and a second run waits on the first's lock instead of checking out
//    another sha under it. Part 2 needs bash, flock, git and python3 (the box
//    has all four; the script's JSON escaping is python3); without them it SKIPS.
// 3. ONE COPY (Darko 2026-10-20 15:38): the timer's unit runs the release's
//    script too, keeps its own credential file, and the roll-call's ops-scripts
//    row no longer compares the retired ops copy (nothing execs it).

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { compareFileCopy } from "../tools/box-rollcall.mjs";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(OFFICE, p), "utf8");
const UNIT = read("deploy/postmark-ferry.service");
const SCRIPT = read("deploy/town-index-ingest.sh");
const LIB = read("deploy/world2-lib.sh");
const CRED_ID = "postmark-law-ingester-password";

// The [Service] section's directives, as systemd reads them: comments dropped,
// backslash continuations joined.
function directives(text, name) {
  const section = text.split(/^\[/m).find((s) => s.startsWith(`${name}]`)) ?? "";
  const out = [];
  let cur = null;
  for (const raw of section.split("\n").slice(1)) {
    const line = raw.replace(/\r$/, "");
    if (cur === null && (/^\s*[#;]/.test(line) || line.trim() === "")) continue;
    cur = cur === null ? line : `${cur} ${line.trim()}`;
    if (cur.endsWith("\\")) { cur = cur.slice(0, -1); continue; }
    const i = cur.indexOf("=");
    out.push([cur.slice(0, i).trim(), cur.slice(i + 1).trim()]);
    cur = null;
  }
  return out;
}
const service = directives(UNIT, "Service");
const all = (key) => service.filter(([k]) => k === key).map(([, v]) => v);

// What the script writes, resolved from its own text and the lib's defaults.
const libDefault = (name) => {
  const m = LIB.match(new RegExp(`^${name}="\\$\\{${name}:-([^}]+)\\}"$`, "m"));
  assert.ok(m, `world2-lib.sh no longer defaults ${name} the way this test reads it`);
  return m[1];
};
const LAB = libDefault("WORLD2_LAB");
const STATE_DIR = libDefault("WORLD2_STATE_DIR").replace("$WORLD2_LAB", LAB);
const dirMatch = SCRIPT.match(/^DIR="\$WORLD2_LAB\/([^"]+)"$/m);
assert.ok(dirMatch, "town-index-ingest.sh no longer names its clone the way this test reads it");
const CLONE_DIR = `${LAB}/${dirMatch[1]}`;

test("the unit: the ferry runs the shipped ingest script, so these sandbox lines are the ones it runs under", () => {
  assert.match(all("ExecStart").join("\n"), /\/bin\/bash \/srv\/postmark-office\/deploy\/town-index-ingest\.sh/);
  assert.deepEqual(all("User"), ["meepo"]);
  assert.deepEqual(all("ProtectSystem"), ["strict"], "the sandbox stays strict: the fix grants paths, it does not loosen the system");
  assert.deepEqual(all("NoNewPrivileges"), ["yes"]);
  assert.deepEqual(all("PrivateTmp"), ["yes"], "the script's mktemp lands in the unit's private /tmp");
});

test("the unit: write access is the office tree plus exactly the ingest's clone and state directory, each optional", () => {
  assert.equal(CLONE_DIR, "/srv/world2-lab/ingest-clones/town-index");
  assert.equal(STATE_DIR, "/srv/world2-lab/state");
  assert.deepEqual(all("ReadWritePaths"), ["/srv/postmark-office", `-${CLONE_DIR}`, `-${STATE_DIR}`],
    "nothing wider than the two paths the script writes (not /srv/world2-lab, not ingest-clones), and the '-' keeps a missing one from stopping the crossing");
  assert.match(SCRIPT, /^LOCK="\$WORLD2_STATE_DIR\/\.town-index\.lock"$/m, "the lock lives inside a granted path");
});

test("the unit: the ingest gets ONE credential, by ID from the credstore, and never the world2 env file", () => {
  assert.deepEqual(all("LoadCredential"), [CRED_ID],
    "an ID with no path: systemd looks in /etc/credstore/ and skips a missing one, where a missing absolute path fails every crossing");
  assert.deepEqual(all("LoadCredentialEncrypted"), []);
  assert.deepEqual(all("SetCredential"), [], "the password is never written into the unit text");
  assert.deepEqual(all("EnvironmentFile"), ["/etc/postmark-office.env"]);
  assert.doesNotMatch(service.map(([k, v]) => `${k}=${v}`).join("\n"), /postmark-world2-dev\.env/,
    "the world2 env file carries the owner's password and is never handed to the ferry");
  assert.ok(SCRIPT.includes(`CRED="\${CREDENTIALS_DIRECTORY:-}/${CRED_ID}"`), "the script reads the credential the unit loads, by the same ID");
});

test("one copy: the timer's unit runs the release's script, the file the ferry runs, with its own credential file", () => {
  const timer = directives(read("deploy/postmark-town-index.service"), "Service");
  const get = (key) => timer.filter(([k]) => k === key).map(([, v]) => v);
  assert.deepEqual(get("ExecStart"), ["/bin/bash /srv/postmark-office/deploy/town-index-ingest.sh"],
    "the deployed release's copy, never /srv/world2-lab/ops/ (two copies drift, and the lock only holds when both take it)");
  assert.deepEqual(get("EnvironmentFile"), ["/etc/postmark-world2-dev.env"], "the timer keeps its own credential path");
  assert.deepEqual(get("User"), ["meepo"]);
  assert.match(all("ExecStart").join("\n"), /\/bin\/bash \/srv\/postmark-office\/deploy\/town-index-ingest\.sh/, "and the ferry runs the same file");
});

test("one copy: the roll-call's ops-scripts row no longer compares the retired ops copy, and still compares every other script", () => {
  const manifest = JSON.parse(read("deploy/box-rollcall-manifest.json"));
  const find = (o) => { if (o && typeof o === "object") { if (o.id === "world2-ops-scripts") return o; for (const v of Object.values(o)) { const r = find(v); if (r) return r; } } return null; };
  const row = find(manifest);
  assert.ok(row, "the manifest has no world2-ops-scripts row");
  const box = { "town-index-ingest.sh": "the old copy", "world2-lib.sh": "lib", "world2-ingest.sh": "ingest" };
  const release = { "town-index-ingest.sh": "the release copy", "world2-lib.sh": "lib", "world2-ingest.sh": "ingest" };
  const fake = (over = {}) => ({
    exists: () => true,
    readdir: () => Object.keys(box),
    read: (path) => { const name = path.replace(/\\/g, "/").split("/").pop(); return Buffer.from(path.replace(/\\/g, "/").startsWith("/box/") ? (over[name] ?? box[name]) : release[name]); },
  });
  const c = compareFileCopy("/box/ops", "/release/deploy", new RegExp(row.match), fake());
  assert.deepEqual([c.differing, c.missing, c.scanned], [[], [], 2], "the stale town-index-ingest.sh left on the box reddens nothing");
  const d = compareFileCopy("/box/ops", "/release/deploy", new RegExp(row.match), fake({ "world2-lib.sh": "a drifted lib" }));
  assert.deepEqual(d.differing, ["world2-lib.sh"], "the control: a drifted ops script is still red");
  assert.match(row.retired_copies ?? "", /town-index-ingest\.sh/, "the row says why the copy is not compared");
});

// ── part 2: the shipped script, run whole ─────────────────────────────────────

const works = (cmd, args) => { try { return spawnSync(cmd, args, { stdio: "ignore" }).status === 0; } catch { return false; } };
const missing = [["bash", ["-c", "true"]], ["flock", ["--version"]], ["git", ["--version"]], ["python3", ["-c", "pass"]]]
  .filter(([c, a]) => !works(c, a)).map(([c]) => c);
const skip = missing.length ? `needs ${missing.join(", ")} (the box has them)` : false;

const scratch = mkdtempSync(join(tmpdir(), "ferry-ingest-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }); } catch { /* litter */ } });
const fwd = (p) => p.replace(/\\/g, "/");
const GIT_ENV = {
  GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@postmark.invalid",
  GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@postmark.invalid",
};

// A lab with the clone already made (from a local origin, so nothing touches the
// network) and an office whose ingest tool is a stub: it lists no seals and, for
// the delta, writes down who it connected as and with what, then sleeps if asked.
function lab(name) {
  const root = join(scratch, name);
  const origin = join(root, "origin");
  mkdirSync(origin, { recursive: true });
  const g = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { env: { ...process.env, ...GIT_ENV }, stdio: "pipe" });
  g(origin, "init", "-q", "-b", "main");
  writeFileSync(join(origin, "README.md"), "a town\n");
  g(origin, "add", "-A");
  g(origin, "commit", "-qm", "the town");
  const clone = join(root, "lab", "ingest-clones", "town-index");
  mkdirSync(dirname(clone), { recursive: true });
  execFileSync("git", ["clone", "-q", fwd(origin), fwd(clone)], { stdio: "pipe" });
  const tool = join(root, "office", "world2", "tools", "town-index-ingest.mjs");
  mkdirSync(dirname(tool), { recursive: true });
  writeFileSync(tool, `
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes("--seals-to")) process.exit(0);
const { PGUSER, PGPASSWORD, PGDATABASE } = process.env;
appendFileSync(process.env.STUB_SEEN, JSON.stringify({ at: Date.now(), PGUSER, PGPASSWORD, PGDATABASE }) + "\\n");
if (process.env.STUB_SLEEP_MS) await new Promise((r) => setTimeout(r, Number(process.env.STUB_SLEEP_MS)));
console.log("delta · nothing new");
`);
  const creds = join(root, "creds");
  mkdirSync(creds);
  return { root, clone, creds, state: join(root, "lab", "state"), seen: join(root, "seen.jsonl") };
}

function envFor(l, extra = {}) {
  const env = { ...process.env };
  delete env.PG_LAW_INGESTER_PASSWORD;
  delete env.CREDENTIALS_DIRECTORY;
  for (const k of Object.keys(env)) if (k.startsWith("PG")) delete env[k];
  return {
    ...env,
    WORLD2_LAB: fwd(join(l.root, "lab")),
    WORLD2_OFFICE: fwd(join(l.root, "office")),
    WORLD2_ENV_FILE: fwd(join(l.root, "no-such.env")),   // the world2 env file is unreadable here, as under the ferry
    STAMP_LINES: "off",                                  // set, so the script never reads /etc/postmark-office.env
    STUB_SEEN: fwd(l.seen),
    ...extra,
  };
}
const script = fwd(join(OFFICE, "deploy", "town-index-ingest.sh"));
const runSync = (env) => spawnSync("bash", [script], { env, encoding: "utf8" });
const seen = (l) => existsSync(l.seen) ? readFileSync(l.seen, "utf8").trim().split("\n").map((s) => JSON.parse(s)) : [];
const state = (l) => JSON.parse(readFileSync(join(l.state, "town-index.json"), "utf8"));

test("the script: under the ferry the password comes from $CREDENTIALS_DIRECTORY, and the run ends ok", { skip }, () => {
  const l = lab("cred");
  writeFileSync(join(l.creds, CRED_ID), "from-the-credstore\n");
  const r = runSync(envFor(l, { CREDENTIALS_DIRECTORY: fwd(l.creds) }));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(seen(l).map(({ PGUSER, PGPASSWORD }) => ({ PGUSER, PGPASSWORD })),
    [{ PGUSER: "law_ingester", PGPASSWORD: "from-the-credstore" }], "the pen connects as law_ingester with the credential, its newline trimmed");
  assert.equal(seen(l)[0].PGDATABASE, "world2_dev", "the store's name falls back as it does on the box today");
  assert.equal(state(l).status, "ok");
});

test("the script: the environment still wins over the credential (the timer's path is unchanged)", { skip }, () => {
  const l = lab("env-wins");
  writeFileSync(join(l.creds, CRED_ID), "from-the-credstore\n");
  const r = runSync(envFor(l, { CREDENTIALS_DIRECTORY: fwd(l.creds), PG_LAW_INGESTER_PASSWORD: "from-the-env" }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(seen(l)[0].PGPASSWORD, "from-the-env");
});

test("the script: with neither, it refuses by name, exit 2, and the tool never runs", { skip }, () => {
  const l = lab("neither");
  const r = runSync(envFor(l, { CREDENTIALS_DIRECTORY: fwd(l.creds) }));   // a credentials directory with no such file
  assert.equal(r.status, 2, r.stderr);
  assert.deepEqual(seen(l), []);
  assert.equal(state(l).status, "cannot-run");
  assert.match(state(l).detail, /PG_LAW_INGESTER_PASSWORD unreadable/);
});

test("the script: a second run waits for the first's lock, so two runs never share the checkout", { skip }, async () => {
  const l = lab("two-runs");
  const env = envFor(l, { PG_LAW_INGESTER_PASSWORD: "pw" });
  const exit = (p) => new Promise((res) => p.on("exit", (code) => res(code)));
  const first = spawn("bash", [script], { env: { ...env, STUB_SLEEP_MS: "2500" }, stdio: "ignore" });
  const firstDone = exit(first);
  // the first run is inside its tool (it has written what it saw) before the second starts
  for (let i = 0; i < 200 && seen(l).length === 0; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(seen(l).length, 1, "the first run reached its tool");
  const second = spawn("bash", [script], { env, stdio: "ignore" });
  const [a, b] = await Promise.all([firstDone, exit(second)]);
  assert.deepEqual([a, b], [0, 0]);
  const [s1, s2] = seen(l);
  assert.ok(s2.at - s1.at >= 2000, `the second run's tool started ${s2.at - s1.at} ms after the first's: it waited for the lock`);
});

test("the script: a state directory it cannot write is exit 2 before any git step", { skip: skip || (process.getuid?.() === 0 && "root writes anything") }, () => {
  const l = lab("read-only");
  mkdirSync(l.state, { recursive: true });
  chmodSync(l.state, 0o555);
  try {
    const before = execFileSync("git", ["-C", l.clone, "rev-parse", "HEAD"], { encoding: "utf8" });
    const r = runSync(envFor(l, { PG_LAW_INGESTER_PASSWORD: "pw" }));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /cannot open .*\.town-index\.lock/);
    assert.deepEqual(seen(l), []);
    assert.equal(execFileSync("git", ["-C", l.clone, "rev-parse", "HEAD"], { encoding: "utf8" }), before);
  } finally { chmodSync(l.state, 0o755); }
});
