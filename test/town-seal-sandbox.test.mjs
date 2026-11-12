// town-seal-sandbox.test.mjs — POS-988: the crossing's seal runs with none of
// the ferry's rights, and stays a stage of the crossing.
//
//   node --test test/town-seal-sandbox.test.mjs
//
// What the sandbox denies is the units' lines, so those are pinned here as text:
// postmark-town-seal@.service has no EnvironmentFile, a DynamicUser, no network
// and /srv out of sight but for the one tool; the socket is meepo's, 0600; and
// the ferry's seal stage calls the tool instead of running the town's
// PROJECTS/the-town-seal/*.mjs itself. The exchange's two refusals are run for
// real: the sandbox takes exactly its four inputs, and the client writes exactly
// its two outputs. The crossing around it (the stage, the undo, the witness) is
// run in tick-and-ferry-whole-or-nothing.test.mjs and ferry-witness.test.mjs.
//
// THE CAN-FAIL FLIPS: add an EnvironmentFile= to the sandbox unit, or drop
// PrivateNetwork=, or put `node PROJECTS/the-town-seal/seal.mjs` back in the
// ferry's chain (each pin goes red); let checkFiles accept an extra path (both
// exchange tests go red).

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFiles, client, INPUTS, OUTPUTS, SOCKET } from "../tools/town-seal-sandbox.mjs";
import { DECOY_ENV } from "./helpers/seal-socket.mjs";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(OFFICE, "tools", "town-seal-sandbox.mjs");
const scratch = mkdtempSync(join(tmpdir(), "postmark-seal-sandbox-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }); } catch { /* litter */ } });

const unit = (name) => readFileSync(join(OFFICE, "deploy", name), "utf8");
const settings = (text) => text.split("\n").filter((l) => /^[A-Za-z]+=/.test(l));
const b64 = (s) => Buffer.from(s).toString("base64");

function ferryPayload() {
  const line = unit("postmark-ferry.service").replace(/\\\n/g, " ").split("\n").find((l) => l.startsWith("ExecStart="));
  const m = /\/bin\/sh -c '([^']*)'\s*$/.exec(line ?? "");
  assert.ok(m, "the ferry's ExecStart is no longer `flock … /bin/sh -c '<script>'`");
  return m[1];
}

test("the sandbox unit: no environment, a DynamicUser, no network, and /srv hidden but for the one tool", () => {
  const s = settings(unit("postmark-town-seal@.service"));
  assert.deepEqual(s.filter((l) => /^(EnvironmentFile|Environment|LoadCredential|SetCredential|User|Group)=/.test(l)), [],
    "nothing hands the seal a key, a token or a real user");
  for (const line of [
    "ExecStart=/usr/bin/node /srv/postmark-office/tools/town-seal-sandbox.mjs serve",
    "StandardInput=socket", "StandardOutput=socket",
    "DynamicUser=yes", "PrivateNetwork=yes", "IPAddressDeny=any", "RestrictAddressFamilies=AF_UNIX",
    "TemporaryFileSystem=/srv:ro", "ProtectSystem=strict", "ProtectHome=yes", "PrivateTmp=yes", "NoNewPrivileges=yes",
    "CapabilityBoundingSet=",
    // Truey's review of #1007: AF_UNIX stays open for node, so no filesystem socket may be in sight
    "TemporaryFileSystem=/run:ro", "TemporaryFileSystem=/var:ro",
    "MemoryMax=2G", "TasksMax=64", "LimitFSIZE=512M", "CollectMode=inactive-or-failed",
  ]) assert.ok(s.includes(line), `the sandbox unit carries ${line}`);
  assert.deepEqual(s.filter((l) => /^(BindPaths|BindReadOnlyPaths|ReadWritePaths|ReadOnlyPaths)=/.test(l)),
    ["BindReadOnlyPaths=/srv/postmark-office/tools/town-seal-sandbox.mjs"], "the one path under /srv it can see is the tool, read-only");
});

test("the socket: the box's path, one unit per connection, meepo's alone", () => {
  const s = settings(unit("postmark-town-seal.socket"));
  for (const line of [`ListenStream=${SOCKET}`, "Accept=yes", "SocketUser=meepo", "SocketGroup=meepo", "SocketMode=0600"]) {
    assert.ok(s.includes(line), `the socket carries ${line}`);
  }
});

test("the ferry's seal stage calls the sandbox, and no longer runs the town's seal code itself", () => {
  const p = ferryPayload();
  assert.match(p, /wstage=seal && \/usr\/bin\/node \/srv\/postmark-office\/tools\/town-seal-sandbox\.mjs --clone "\$TOWN_CLONE" && /,
    "the stage is still named seal, so the witness records it, and its refusal still stops the chain");
  assert.doesNotMatch(p, /node[^&|;]*PROJECTS\/the-town-seal\/[a-z-]+\.mjs/, "no PROJECTS/the-town-seal script runs inside the ferry");
  assert.match(p, /git add PROJECTS\/the-town-seal\/seal\.json PROJECTS\/the-town-seal\/the-town-seal\.html/, "the ferry's own shell still commits the outputs");
  const s = settings(unit("postmark-ferry.service"));
  assert.ok(s.includes("EnvironmentFile=/etc/postmark-office.env"), "the ferry keeps its env; the seal is what no longer shares it");
});

test("checkFiles takes exactly its list, each as base64", () => {
  const ok = Object.fromEntries(OUTPUTS.map((k) => [k, b64("x")]));
  assert.equal(checkFiles(ok, OUTPUTS, "t"), ok);
  assert.throws(() => checkFiles({ ...ok, "tools/ferry.mjs": b64("x") }, OUTPUTS, "t"), /expected exactly/);
  assert.throws(() => checkFiles({ [OUTPUTS[0]]: b64("x") }, OUTPUTS, "t"), /expected exactly/);
  assert.throws(() => checkFiles({ ...ok, [OUTPUTS[1]]: "not base64!" }, OUTPUTS, "t"), /not base64/);
  assert.throws(() => checkFiles({ ...ok, [OUTPUTS[1]]: 7 }, OUTPUTS, "t"), /not base64/);
  assert.throws(() => checkFiles(null, OUTPUTS, "t"), /no file set/);
});

/** One serve, wired with pipes, sent `request`; resolves its answer and exit. POSIX: it reads fd 0 as a socket-like stream. */
function serveOnce(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TOOL, "serve"], { stdio: ["pipe", "pipe", "pipe"], env: DECOY_ENV });
    let out = "", err = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { err += c; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, answer: out ? JSON.parse(out) : null, err }));
    child.stdin.end(request);
  });
}

// POSIX only: serve reads its socket by file descriptor, and the exchange half-closes,
// which a Windows named pipe cannot do (the box and CI are Linux).
const posix = process.platform === "win32" ? "the exchange needs a POSIX socket: a file descriptor and a half-close" : false;

test("the sandbox refuses an input set that is not exactly its four, and runs nothing", { skip: posix }, async () => {
  const files = Object.fromEntries(INPUTS.map((k) => [k, b64("process.exit(0)\n")]));
  const extra = await serveOnce(JSON.stringify({ files: { ...files, "../../etc/escape": b64("x") } }));
  assert.equal(extra.code, 1);
  assert.equal(extra.answer.ok, false);
  assert.equal(extra.answer.stage, "sandbox");
  assert.match(extra.answer.why, /expected exactly/);
  assert.doesNotMatch(extra.err, /\[town-seal\] seal:/, "the seal never ran");
  const junk = await serveOnce("not json");
  assert.deepEqual([junk.code, junk.answer.ok, junk.answer.stage], [1, false, "sandbox"]);
});

test("the sandbox answers with the two outputs only when seal and verify both exit 0, with an empty environment", { skip: posix }, async () => {
  const seal = `import { writeFileSync } from "node:fs";
writeFileSync("PROJECTS/the-town-seal/seal.json", JSON.stringify(Object.keys(process.env).sort()));
writeFileSync("PROJECTS/the-town-seal/the-town-seal.html", Buffer.from([0xff, 0x00, 0x7b]));
`;
  const files = { [INPUTS[0]]: b64(seal), [INPUTS[1]]: b64("process.exit(0)\n"), [INPUTS[2]]: b64("{}"), [INPUTS[3]]: b64("ledger\n") };
  const green = await serveOnce(JSON.stringify({ files }));
  assert.equal(green.code, 0, green.err);
  assert.deepEqual(Object.keys(green.answer.files).sort(), [...OUTPUTS].sort());
  assert.deepEqual(JSON.parse(Buffer.from(green.answer.files[OUTPUTS[0]], "base64").toString()), ["PATH"], "the seal saw PATH and nothing else");
  assert.deepEqual([...Buffer.from(green.answer.files[OUTPUTS[1]], "base64")], [0xff, 0x00, 0x7b], "byte-exact, not utf8-mangled");

  const red = await serveOnce(JSON.stringify({ files: { ...files, [INPUTS[1]]: b64("process.exit(3)\n") } }));
  assert.equal(red.code, 1);
  assert.deepEqual(red.answer, { ok: false, stage: "verify", exit: 3 });
});

/** A fake sandbox that answers every connection with `answer`, and keeps what each one sent in `received`. */
async function fakeSandbox(answer) {
  const path = process.platform === "win32" ? `\\\\.\\pipe\\postmark-seal-test-${process.pid}-${Math.random().toString(36).slice(2)}` : join(scratch, `fake-${Math.random().toString(36).slice(2)}.sock`);
  const received = [];
  const server = createServer({ allowHalfOpen: true }, (conn) => {
    let got = "";
    conn.on("data", (c) => { got += c; });
    conn.on("end", () => { received.push(got); conn.end(typeof answer === "string" ? answer : JSON.stringify(answer)); });
  });
  await new Promise((r) => server.listen(path, r));
  return { path, received, close: () => new Promise((r) => server.close(r)) };
}

function cloneWithInputs() {
  const clone = mkdtempSync(join(scratch, "clone-"));
  for (const rel of INPUTS) { mkdirSync(dirname(join(clone, rel)), { recursive: true }); writeFileSync(join(clone, rel), `${rel} at the founding\n`); }
  return clone;
}

test("the client writes exactly the two outputs, and refuses an answer naming any other path, writing nothing", { skip: posix }, async () => {
  const clone = cloneWithInputs();
  const html = join(clone, OUTPUTS[1]);
  const evil = await fakeSandbox({ ok: true, files: { [OUTPUTS[0]]: b64("new seal\n"), [OUTPUTS[1]]: b64("<p>new</p>\n"), "tools/ferry.mjs": b64("owned\n") } });
  try {
    assert.equal(await client(clone, evil.path), 1);
  } finally { await evil.close(); }
  assert.equal(readFileSync(join(clone, OUTPUTS[0]), "utf8"), `${OUTPUTS[0]} at the founding\n`, "nothing written");
  assert.equal(existsSync(html), false);
  assert.equal(existsSync(join(clone, "tools", "ferry.mjs")), false);

  const good = await fakeSandbox({ ok: true, files: { [OUTPUTS[0]]: b64("new seal\n"), [OUTPUTS[1]]: b64("<p>new</p>\n") } });
  try {
    assert.equal(await client(clone, good.path), 0);
  } finally { await good.close(); }
  assert.equal(readFileSync(join(clone, OUTPUTS[0]), "utf8"), "new seal\n");
  assert.equal(readFileSync(html, "utf8"), "<p>new</p>\n");
});

test("the client exits 1 on a refusal, a malformed answer, or no sandbox at all", { skip: posix }, async () => {
  const clone = cloneWithInputs();
  for (const answer of [{ ok: false, stage: "verify", exit: 1 }, "not json", { ok: true }]) {
    const s = await fakeSandbox(answer);
    try { assert.equal(await client(clone, s.path), 1, JSON.stringify(answer)); } finally { await s.close(); }
  }
  const missing = process.platform === "win32" ? "\\\\.\\pipe\\postmark-seal-no-such" : join(scratch, "no-such.sock");
  assert.equal(await client(clone, missing), 1);
  assert.equal(await client(join(scratch, "no-clone-here"), missing), 1, "a clone without the inputs is a refusal too");
});

// ── NO SYMLINK IS FOLLOWED (Truey's review of #1007, the blocker) ──────────
// The client runs as meepo: a committed symlink at an input would have it read
// what the link names (the stamp key) and hand it to the sandbox, and one at an
// output, or at a directory above one, would have it write the sandbox's answer
// through the link (office code). Each case plants one, against a fake sandbox
// that records what it received, and holds the link's target byte-unchanged.
// THE CAN-FAIL FLIP: make plainPath return join(clone, rel) without the walk;
// all three cases go red (the marker reaches the sandbox, the targets change).

const GOOD = { ok: true, files: { [OUTPUTS[0]]: b64("written by the answer\n"), [OUTPUTS[1]]: b64("<p>written by the answer</p>\n") } };

test("a symlink at an output: refused, nothing sent, and the link's target untouched", { skip: posix }, async () => {
  const clone = cloneWithInputs();
  const target = join(scratch, `office-code-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(target, "office code\n");
  symlinkSync(target, join(clone, OUTPUTS[1]));
  const s = await fakeSandbox(GOOD);
  try { assert.equal(await client(clone, s.path), 1); } finally { await s.close(); }
  assert.equal(readFileSync(target, "utf8"), "office code\n", "the answer was never written through the link");
  assert.deepEqual(s.received, [], "the client refused before it connected");
  assert.equal(readFileSync(join(clone, OUTPUTS[0]), "utf8"), `${OUTPUTS[0]} at the founding\n`, "and wrote no other output either");
});

test("a symlinked directory above the outputs: refused, and the directory it names untouched", { skip: posix }, async () => {
  const clone = cloneWithInputs();
  const elsewhere = mkdtempSync(join(scratch, "elsewhere-"));
  const dir = dirname(join(clone, OUTPUTS[0]));
  for (const rel of INPUTS.filter((r) => r.startsWith("PROJECTS/the-town-seal/"))) writeFileSync(join(elsewhere, basename(rel)), `${rel} elsewhere\n`);
  rmSync(dir, { recursive: true });
  symlinkSync(elsewhere, dir, "dir");
  const s = await fakeSandbox(GOOD);
  try { assert.equal(await client(clone, s.path), 1); } finally { await s.close(); }
  assert.equal(readFileSync(join(elsewhere, "seal.json"), "utf8"), "PROJECTS/the-town-seal/seal.json elsewhere\n");
  assert.equal(existsSync(join(elsewhere, "the-town-seal.html")), false);
  assert.deepEqual(s.received, []);
});

test("a symlink at an input: refused, and what it names never reaches the sandbox", { skip: posix }, async () => {
  const clone = cloneWithInputs();
  const secret = join(scratch, `stamp-key-${Math.random().toString(36).slice(2)}.pem`);
  writeFileSync(secret, "MARKER-NOT-A-KEY\n");
  rmSync(join(clone, INPUTS[3]));
  symlinkSync(secret, join(clone, INPUTS[3]));
  const s = await fakeSandbox(GOOD);
  try { assert.equal(await client(clone, s.path), 1); } finally { await s.close(); }
  const sent = s.received.join("");
  assert.ok(!sent.includes(b64("MARKER-NOT-A-KEY\n")) && !sent.includes("MARKER-NOT-A-KEY"), "the marker never left the client");
  assert.deepEqual(s.received, []);

  // the control: the same clone with a regular file there is accepted
  rmSync(join(clone, INPUTS[3]));
  writeFileSync(join(clone, INPUTS[3]), "the ledger\n");
  const ok = await fakeSandbox(GOOD);
  try { assert.equal(await client(clone, ok.path), 0); } finally { await ok.close(); }
  assert.equal(ok.received.length, 1, "one request went out");
  assert.equal(readFileSync(join(clone, OUTPUTS[1]), "utf8"), "<p>written by the answer</p>\n");
});
