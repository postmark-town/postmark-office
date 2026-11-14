// town-tool-sandbox.test.mjs — POS-994 (shape A): the crossing's town tools run
// with none of the ferry's rights, and the client keeps the pull, commit and push.
//
//   node --test test/town-tool-sandbox.test.mjs
//
// What the sandbox denies is the units' lines, so those are pinned here as text,
// and were proved on the box with a transient unit of the same settings
// (POS-994, 2026-11-14 23:16Z: the stamp key, the credential store, /etc's env
// files, /var/backups and /home ENOENT; the clone's tools/ and .git EROFS;
// WHITE_PAGES and TOWN_BULLETIN writable; TCP EAFNOSUPPORT). The exchange and the
// client's checks run for real here, against a scratch town (a bare origin and a
// clone) and a fake sandbox that misbehaves on purpose.
//
// THE CAN-FAIL FLIPS: add an EnvironmentFile= to the sandbox unit, or drop
// PrivateNetwork=, or make .git writable (a BindPaths= on the clone root), or put
// `node tools/ferry.mjs` back in the ferry's chain (each pin goes red); let
// checkRequest accept another tool or clone (the request tests go red); make
// runTool skip symlinksUnder or changedBetween (the refusal tests go red); make
// ferry() commit without the count check (the mismatch test goes red).

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { changedBetween, checkRequest, ferry, fingerprint, runTool, SOCKET, symlinksUnder, TOOLS } from "../tools/town-tool-sandbox.mjs";
import { DECOY_ENV } from "./helpers/town-tool-socket.mjs";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(OFFICE, "tools", "town-tool-sandbox.mjs");
const scratch = mkdtempSync(join(tmpdir(), "postmark-town-tool-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }); } catch { /* litter */ } });

const unit = (name) => readFileSync(join(OFFICE, "deploy", name), "utf8");
const settings = (text) => text.split("\n").filter((l) => /^[A-Za-z]+=/.test(l));
const b64 = (s) => Buffer.from(s).toString("base64");
const GIT_ENV = {
  GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@postmark.invalid",
  GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@postmark.invalid",
};
for (const [k, v] of Object.entries(GIT_ENV)) process.env[k] ??= v;

function ferryPayload() {
  const line = unit("postmark-ferry.service").replace(/\\\n/g, " ").split("\n").find((l) => l.startsWith("ExecStart="));
  const m = /\/bin\/sh -c '([^']*)'\s*$/.exec(line ?? "");
  assert.ok(m, "the ferry's ExecStart is no longer `flock … /bin/sh -c '<script>'`");
  return m[1];
}

// ── the units, as text ──────────────────────────────────────────────────────

test("the sandbox unit: meepo with no environment, no network, and only the clone's two directories writable", () => {
  const s = settings(unit("postmark-town-tool@.service"));
  assert.deepEqual(s.filter((l) => /^(EnvironmentFile|Environment|LoadCredential|SetCredential|PassEnvironment|DynamicUser)=/.test(l)), [],
    "nothing hands a town tool a key or a token");
  for (const line of [
    "ExecStart=/usr/bin/node /srv/postmark-office/tools/town-tool-sandbox.mjs serve --clone /srv/postmark-office/town-clone",
    "StandardInput=socket", "StandardOutput=socket", "User=meepo", "Group=meepo",
    "PrivateNetwork=yes", "IPAddressDeny=any", "RestrictAddressFamilies=AF_UNIX",
    "TemporaryFileSystem=/srv:ro", "TemporaryFileSystem=/etc:ro", "TemporaryFileSystem=/run:ro", "TemporaryFileSystem=/var:ro",
    "TemporaryFileSystem=/opt:ro", "ProtectHome=tmpfs", "ProtectSystem=strict", "PrivateTmp=yes", "NoNewPrivileges=yes",
    "CapabilityBoundingSet=", "MemoryMax=2G", "TasksMax=64", "LimitFSIZE=512M", "CollectMode=inactive-or-failed",
  ]) assert.ok(s.includes(line), `the sandbox unit carries ${line}`);
  assert.deepEqual(s.filter((l) => /^(BindPaths|ReadWritePaths)=/.test(l)),
    ["BindPaths=/srv/postmark-office/town-clone/WHITE_PAGES", "BindPaths=/srv/postmark-office/town-clone/TOWN_BULLETIN"],
    "the only writable places in the clone are the two the tools write; the root, tools/ and .git stay read-only");
  assert.deepEqual(s.filter((l) => /^BindReadOnlyPaths=\/srv/.test(l)),
    ["BindReadOnlyPaths=/srv/postmark-office/tools/town-tool-sandbox.mjs", "BindReadOnlyPaths=/srv/postmark-office/town-clone"],
    "under /srv it sees this tool and the clone, nothing else (not the stamp key, not the credential store)");
  const etc = s.filter((l) => /^BindReadOnlyPaths=\/etc/.test(l)).join(" ");
  for (const word of etc.replace(/^BindReadOnlyPaths=/, "").split(/\s+/)) {
    assert.match(word, /^-?\/etc\/(passwd|group|nsswitch\.conf|ld\.so\.cache|localtime)$/, `${word} is not on /etc's allowlist`);
  }
});

test("the socket: the box's path, one unit per connection, meepo's alone", () => {
  const s = settings(unit("postmark-town-tool.socket"));
  for (const line of [`ListenStream=${SOCKET}`, "Accept=yes", "SocketUser=meepo", "SocketGroup=meepo", "SocketMode=0600", "MaxConnections=1"]) {
    assert.ok(s.includes(line), `the socket carries ${line}`);
  }
});

test("the ferry's chain runs the three town tools through the sandbox, and none of them itself", () => {
  const p = ferryPayload();
  const client = "/usr/bin/node /srv/postmark-office/tools/town-tool-sandbox.mjs";
  assert.ok(p.includes(`wstage=ferry && cd "$TOWN_CLONE" && ${client} ferry --clone "$TOWN_CLONE" --report "$wreport" && `),
    "the stage is still named ferry, and the witness still gets its report");
  assert.ok(p.includes(`else ${client} verify --clone "$TOWN_CLONE"; fi`), "both verifies go through the sandbox");
  assert.ok(p.includes(`${client} quests --clone "$TOWN_CLONE"`), "the quest snapshot goes through the sandbox");
  assert.doesNotMatch(p, /\bnode tools\/(ferry|stamp-verify|quest-progress)\.mjs/, "no town tool of these three runs in the ferry's process");
  assert.match(p, /node tools\/stamp-mint\.mjs --append --key/, "the git-mode mint still runs here, until POS-994's B is ruled");
  assert.ok(settings(unit("postmark-ferry.service")).includes("EnvironmentFile=/etc/postmark-office.env"),
    "the ferry keeps its env; the town tools are what no longer share it");
});

test("the tools' command lines are fixed, and the ferry's is --no-git", () => {
  assert.deepEqual(Object.keys(TOOLS).sort(), ["ferry", "quests", "verify"]);
  assert.deepEqual(TOOLS.ferry.argv.slice(0, 2), ["tools/ferry.mjs", "--no-git"]);
  assert.deepEqual(TOOLS.verify.argv, ["tools/stamp-verify.mjs"]);
  assert.deepEqual(TOOLS.quests.argv, ["tools/quest-progress.mjs", "--snapshot"]);
  assert.deepEqual(TOOLS.verify.writes, [], "the verify may change nothing");
});

// ── the request ─────────────────────────────────────────────────────────────

test("checkRequest takes a named tool, this sandbox's own clone, and TOWN_TZ alone", () => {
  const own = "/srv/postmark-office/town-clone";
  assert.deepEqual(checkRequest({ tool: "verify", clone: own }, own), { tool: "verify", env: {} });
  assert.deepEqual(checkRequest({ tool: "ferry", clone: own, env: { TOWN_TZ: "America/New_York" } }, own).env, { TOWN_TZ: "America/New_York" });
  assert.throws(() => checkRequest({ tool: "stamp-mint", clone: own }, own), /no such tool/);
  assert.throws(() => checkRequest({ tool: "toString", clone: own }, own), /no such tool/, "not an inherited name either");
  assert.throws(() => checkRequest({ tool: "verify", clone: "/srv/postmark-office-dev/town-clone" }, own), /serves the clone at/);
  assert.throws(() => checkRequest({ tool: "verify", clone: own, env: { GH_TOKEN: "x" } }, own), /not passed/);
  assert.throws(() => checkRequest({ tool: "verify", clone: own, env: { TOWN_TZ: "a; rm -rf /" } }, own), /not a plain value/);
  assert.throws(() => checkRequest(null, own), /no request/);
});

// ── a scratch town ──────────────────────────────────────────────────────────

let seq = 0;
const g = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (root, files) => {
  for (const [rel, body] of Object.entries(files)) { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); }
};

/** A bare origin and a clone of it, with the town's shape and `tools` as its tools. */
function town(tools = {}) {
  const root = join(scratch, `town-${++seq}`);
  const seed = join(root, "seed"), origin = join(root, "town.git"), clone = join(root, "clone");
  put(seed, {
    "WHITE_PAGES/mail-ledger.md": "mail ledger\n", "WHITE_PAGES/stamp-ledger.md": "row 1\n",
    "WHITE_PAGES/alice/outbox/to-bob.md": "a letter\n", "TOWN_BULLETIN/quests.md": "quests\n", "tools/README.md": "town tools\n", ...tools,
  });
  g(root, "init", "-q", "-b", "main", seed);
  g(seed, "config", "core.autocrlf", "false");
  g(seed, "add", "-A");
  g(seed, "commit", "-qm", "founding");
  g(root, "init", "-q", "--bare", "-b", "main", origin);
  g(seed, "push", "-q", origin, "main");
  g(root, "clone", "-q", "-c", "core.autocrlf=false", origin, clone);
  return { root, origin, clone };
}

test("symlinksUnder and fingerprint see what a tool left behind", () => {
  const t = town();
  assert.deepEqual(symlinksUnder(t.clone), []);
  const before = fingerprint(t.clone, []);
  assert.deepEqual(before, {}, "a clean clone has no changed paths");
  appendFileSync(join(t.clone, "WHITE_PAGES/stamp-ledger.md"), "row 2\n");
  const dirty = fingerprint(t.clone, []);
  assert.deepEqual(Object.keys(dirty), ["WHITE_PAGES/stamp-ledger.md"]);
  appendFileSync(join(t.clone, "WHITE_PAGES/stamp-ledger.md"), "row 3, forged\n");
  assert.deepEqual(changedBetween(dirty, fingerprint(t.clone, [])), ["WHITE_PAGES/stamp-ledger.md"],
    "an already-changed file changed again is caught by its digest, not only by git's status");
  assert.deepEqual(fingerprint(t.clone, ["WHITE_PAGES/"]), {}, "a tool's own writes are left out");
});

// POSIX only: serve reads its socket by file descriptor, and the exchange half-closes,
// which a Windows named pipe cannot do (the box and CI are Linux).
const posix = process.platform === "win32" ? "the exchange needs a POSIX socket: a file descriptor and a half-close" : false;

/** One serve over `clone`, wired with pipes, sent `request`; resolves its answer and exit. */
function serveOnce(clone, request) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TOOL, "serve", "--clone", clone], { stdio: ["pipe", "pipe", "pipe"], env: DECOY_ENV });
    let out = "", err = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { err += c; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, answer: out ? JSON.parse(out) : null, err }));
    child.stdin.end(typeof request === "string" ? request : JSON.stringify(request));
  });
}

const ENV_STUB = `import { writeFileSync } from "node:fs";
const a = process.argv, i = a.indexOf("--report");
console.log(JSON.stringify({ argv: a.slice(2), env: Object.keys(process.env).sort(), tz: process.env.TOWN_TZ ?? null }));
if (i !== -1) writeFileSync(a[i + 1], JSON.stringify({ ran: true, from: "the stub" }));
`;

test("serve runs the named tool with PATH, HOME and TOWN_TZ alone, and hands back the ferry's report", { skip: posix }, async () => {
  const t = town({ "tools/ferry.mjs": ENV_STUB, "tools/stamp-verify.mjs": ENV_STUB });
  const clone = realpathSync(t.clone);
  const fr = await serveOnce(clone, { tool: "ferry", clone, env: { TOWN_TZ: "America/New_York" } });
  assert.equal(fr.code, 0, fr.err);
  assert.equal(fr.answer.ok, true);
  const said = JSON.parse(Buffer.from(fr.answer.out, "base64").toString());
  assert.deepEqual(said.env, ["HOME", "PATH", "TOWN_TZ"], "the tool saw no GH_TOKEN, no TOWN_CLONE, no STAMP_KEY (the decoys serve was started with)");
  assert.equal(said.tz, "America/New_York");
  assert.equal(said.argv[0], "--no-git", "the ferry runs --no-git");
  assert.deepEqual(JSON.parse(fr.answer.report), { ran: true, from: "the stub" });
  const v = await serveOnce(clone, { tool: "verify", clone });
  assert.deepEqual(JSON.parse(Buffer.from(v.answer.out, "base64").toString()).argv, [], "the verify gets no arguments");
  assert.equal(v.answer.report, undefined);
});

test("serve refuses another tool, another clone, another env value, or no JSON, and runs nothing", { skip: posix }, async () => {
  const marker = join(scratch, `ran-${Math.random().toString(36).slice(2)}`);
  const t = town({ "tools/stamp-mint.mjs": `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "ran");\n` });
  const clone = realpathSync(t.clone);
  for (const req of [{ tool: "stamp-mint", clone }, { tool: "verify", clone: "/elsewhere" }, { tool: "verify", clone, env: { GH_TOKEN: "x" } }, "not json"]) {
    const r = await serveOnce(clone, req);
    assert.equal(r.code, 1, JSON.stringify(req));
    assert.deepEqual([r.answer.ok, r.answer.stage], [false, "sandbox"]);
  }
  assert.equal(existsSync(marker), false, "the mint was never run");
});

test("serve passes a tool's own refusal through as ok:false with its exit", { skip: posix }, async () => {
  const t = town({ "tools/stamp-verify.mjs": `console.error("✗ stamp-ledger verification FAILED"); process.exit(1);\n` });
  const clone = realpathSync(t.clone);
  const r = await serveOnce(clone, { tool: "verify", clone });
  assert.equal(r.code, 1);
  assert.deepEqual([r.answer.ok, r.answer.exit], [false, 1]);
  assert.match(Buffer.from(r.answer.err, "base64").toString(), /verification FAILED/);
});

// ── the client, against a fake sandbox that does what a bad tool would ──────

/** A fake sandbox: on each request it runs `act(clone)` (the tool's effect) and answers `answer`. */
async function fakeSandbox(clone, act, answer) {
  const path = join(scratch, `fake-${Math.random().toString(36).slice(2)}.sock`);
  const received = [];
  const server = createServer({ allowHalfOpen: true }, (conn) => {
    let got = "";
    conn.on("data", (c) => { got += c; });
    conn.on("end", () => {
      received.push(JSON.parse(got));
      act?.(clone);
      conn.end(JSON.stringify({ ok: true, exit: 0, out: b64(""), err: b64(""), ...answer }));
    });
  });
  await new Promise((r) => server.listen(path, r));
  return { path, received, close: () => new Promise((r) => server.close(r)) };
}

async function withFake(clone, act, answer, fn) {
  const s = await fakeSandbox(clone, act, answer);
  try { return await fn(s); } finally { await s.close(); }
}

test("the client sends the tool, its clone's realpath and TOWN_TZ, nothing else", { skip: posix }, async () => {
  const t = town();
  await withFake(t.clone, null, {}, async (s) => {
    const r = await runTool("verify", t.clone, { socketPath: s.path, env: { TOWN_TZ: "UTC", GH_TOKEN: "never-sent", STAMP_KEY: "never" } });
    assert.equal(r.code, 0);
      assert.deepEqual(s.received, [{ tool: "verify", clone: realpathSync(t.clone), env: { TOWN_TZ: "UTC" } }]);
  });
});

test("a symlink the tool leaves in a writable directory is refused", { skip: posix }, async () => {
  const t = town();
  const secret = join(scratch, `stamp-key-${seq}.pem`);
  writeFileSync(secret, "NOT A KEY\n");
  await withFake(t.clone, (c) => symlinkSync(secret, join(c, "WHITE_PAGES/bob/inbox-link.md")), {}, async (s) => {
    mkdirSync(join(t.clone, "WHITE_PAGES/bob"), { recursive: true });
    assert.equal((await runTool("ferry", t.clone, { socketPath: s.path, env: {} })).code, 1);
  });
});

test("a verify that writes anything is refused, even to a file the mint already changed", { skip: posix }, async () => {
  const t = town();
  appendFileSync(join(t.clone, "WHITE_PAGES/stamp-ledger.md"), "row 2, the mint's\n");
  await withFake(t.clone, (c) => appendFileSync(join(c, "WHITE_PAGES/stamp-ledger.md"), "row 3, not the mint's\n"), {}, async (s) => {
    assert.equal((await runTool("verify", t.clone, { socketPath: s.path, env: {} })).code, 1);
  });
  const quiet = town();
  appendFileSync(join(quiet.clone, "WHITE_PAGES/stamp-ledger.md"), "row 2, the mint's\n");
  await withFake(quiet.clone, null, {}, async (s) => {
    assert.equal((await runTool("verify", quiet.clone, { socketPath: s.path, env: {} })).code, 0, "the control: a verify that writes nothing passes over the mint's dirt");
  });
});

test("the quests may write quests.md and nothing else", { skip: posix }, async () => {
  const t = town();
  await withFake(t.clone, (c) => writeFileSync(join(c, "TOWN_BULLETIN/quests.md"), "new board\n"), {}, async (s) => {
    assert.equal((await runTool("quests", t.clone, { socketPath: s.path, env: {} })).code, 0);
  });
  await withFake(t.clone, (c) => writeFileSync(join(c, "WHITE_PAGES/alice/outbox/to-bob.md"), "rewritten\n"), {}, async (s) => {
    assert.equal((await runTool("quests", t.clone, { socketPath: s.path, env: {} })).code, 1);
  });
});

test("the client exits 1 on a refusal, a tool's own failure, a malformed answer, or no sandbox", { skip: posix }, async () => {
  const t = town();
  for (const answer of [{ ok: false, stage: "sandbox", why: "no" }, { ok: false, exit: 3 }, { out: 7 }]) {
    await withFake(t.clone, null, answer, async (s) => {
      assert.equal((await runTool("verify", t.clone, { socketPath: s.path, env: {} })).code, 1, JSON.stringify(answer));
    });
  }
  assert.equal((await runTool("verify", t.clone, { socketPath: join(scratch, "no-such.sock"), env: {} })).code, 1);
});

// ── the ferry, whole ────────────────────────────────────────────────────────

const DELIVER = (c) => {
  mkdirSync(join(c, "WHITE_PAGES/bob/inbox"), { recursive: true });
  writeFileSync(join(c, "WHITE_PAGES/bob/inbox/from-alice.md"), "a letter\n");
  rmSync(join(c, "WHITE_PAGES/alice/outbox/to-bob.md"));
  appendFileSync(join(c, "WHITE_PAGES/mail-ledger.md"), "- delivered alice → bob\n");
};
const REPORT = (delivered, bounced = 0) => JSON.stringify({ ran: true, crossing: 293, town_sha: "a".repeat(40), date: "2026-11-15", delivered, bounced, committed: false, pushed: false, files: [] });

test("the ferry commits and pushes what the sandboxed ferry moved, with ferry.mjs's message and report fields", { skip: posix }, async () => {
  const t = town();
  const report = join(t.root, "report.json");
  await withFake(t.clone, DELIVER, { report: REPORT(1) }, async (s) => {
    assert.equal(await ferry(t.clone, report, { socketPath: s.path, env: {} }), 0);
  });
  assert.equal(g(t.origin, "log", "-1", "--format=%s", "main").trim(), "ferry: 1 delivered, 0 bounced (2026-11-15)", "pushed, with the town's own message");
  assert.equal(g(t.clone, "status", "--porcelain").trim(), "", "nothing left behind");
  const r = JSON.parse(readFileSync(report, "utf8"));
  assert.deepEqual([r.committed, r.pushed, r.delivered], [true, true, 1]);
  assert.deepEqual(r.files.sort(), ["WHITE_PAGES/bob/inbox/from-alice.md", "WHITE_PAGES/mail-ledger.md"], "the files the commit carried (added or changed), as the witness reads them");
});

test("a quiet crossing commits nothing and still writes its report", { skip: posix }, async () => {
  const t = town();
  const head = g(t.clone, "rev-parse", "HEAD").trim();
  const report = join(t.root, "report.json");
  await withFake(t.clone, null, { report: REPORT(0) }, async (s) => {
    assert.equal(await ferry(t.clone, report, { socketPath: s.path, env: {} }), 0);
  });
  assert.equal(g(t.clone, "rev-parse", "HEAD").trim(), head);
  assert.deepEqual(JSON.parse(readFileSync(report, "utf8")).committed, false);
});

test("the ferry refuses counts that don't match what moved, and a report it can't read, committing nothing", { skip: posix }, async () => {
  for (const [act, rep] of [[DELIVER, REPORT(0)], [null, REPORT(2)], [DELIVER, "not json"], [DELIVER, null]]) {
    const t = town();
    const head = g(t.clone, "rev-parse", "HEAD").trim();
    await withFake(t.clone, act, { report: rep }, async (s) => {
      assert.equal(await ferry(t.clone, join(t.root, "report.json"), { socketPath: s.path, env: {} }), 1, String(rep));
    });
    assert.equal(g(t.clone, "rev-parse", "HEAD").trim(), head, "no commit");
    assert.equal(g(t.origin, "rev-parse", "main").trim(), head, "no push");
  }
});

test("the ferry pulls before it runs, so the crossing sails on the town's newest commit", { skip: posix }, async () => {
  const t = town();
  const other = join(t.root, "other");
  g(t.root, "clone", "-q", t.origin, other);
  writeFileSync(join(other, "WHITE_PAGES/carol.md"), "carol joined\n");
  g(other, "add", "-A");
  g(other, "commit", "-qm", "carol");
  g(other, "push", "-q");
  await withFake(t.clone, DELIVER, { report: REPORT(1) }, async (s) => {
    assert.equal(await ferry(t.clone, null, { socketPath: s.path, env: {} }), 0);
  });
  assert.equal(g(t.origin, "log", "--format=%s", "-2", "main").trim(), "ferry: 1 delivered, 0 bounced (2026-11-15)\ncarol");
});
