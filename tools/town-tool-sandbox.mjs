#!/usr/bin/env node
// town-tool-sandbox.mjs — the crossing's town tools, run without the ferry's env, key, credential or network
// (POS-994, shape A, Wright's go 2026-11-14 18:05 EST; what it does NOT keep from them is POS-1049, below).
//
//   node /srv/postmark-office/tools/town-tool-sandbox.mjs ferry  --clone <town clone> [--report <file>]   the client (the ferry, as meepo)
//   node /srv/postmark-office/tools/town-tool-sandbox.mjs verify --clone <town clone>
//   node /srv/postmark-office/tools/town-tool-sandbox.mjs quests --clone <town clone>
//   node /srv/postmark-office/tools/town-tool-sandbox.mjs serve  --clone <town clone> [--in-unit]         the sandbox (one connection on fd 0 and 1;
//                                                                                                         --in-unit, the unit's: the straggler kill fails closed)
//
// ── WHY ─────────────────────────────────────────────────────────────────────
// postmark-ferry.service ran three of the town's own tools straight from the live
// clone, as meepo: tools/ferry.mjs, tools/stamp-verify.mjs and
// tools/quest-progress.mjs --snapshot. Running there gave them the whole office
// environment (44 keys), the stamp key, the town push credential (a credential
// store the clone's own .git/config names), the network, and everything else
// meepo can read on the box. Measured on POS-994 (2026-11-14), they need none
// of it:
//   · ferry.mjs reads TOWN_TZ, runs git, and moves mail inside WHITE_PAGES; only
//     its pull, commit and push need the network and the credential, and it has
//     a --no-git switch that skips exactly those three;
//   · stamp-verify.mjs reads the clone and writes nothing;
//   · quest-progress.mjs --snapshot reads the clone and writes
//     TOWN_BULLETIN/quests.md.
// So the three now run in postmark-town-tool@.service, reached through
// postmark-town-tool.socket (meepo only, 0600), and this file's client keeps the
// steps that need rights: the pull before the ferry, and the commit and the push
// after it. The stamp mint is not here: it must hold the key to sign, so a
// sandbox cannot take the key from it (POS-994's B, Darko's call).
//
// ── WHAT THE SANDBOX IS ─────────────────────────────────────────────────────
// It runs as meepo, because the ferry moves meepo's files in the clone, but in
// its own user namespace (PrivateUsers=yes). Without that, a tool could reach
// every other meepo process through /proc: the waiting client's and the
// office's environ, the stamp key through /proc/<pid>/root, their open fds
// (Truey's F1 on #1048, proved on the box 2026-11-14: OPENABLE as meepo, ENOENT
// in the namespace). Beyond that, the unit keeps the secrets out of reach: no
// EnvironmentFile, no network, /srv hidden but for the clone and this file, /etc
// hidden but for the few files node and git read, /home, /root, /var, /run,
// /opt, /mnt, /media and /snap hidden, and in the clone only WHITE_PAGES and
// TOWN_BULLETIN writable. The clone's .git is read-only: a hook or a config line
// planted there would run in the client's next git push, outside the sandbox.
// Before it answers, serve kills every other process left in its instance's
// cgroup, so nothing a tool started outlives the checks the client then makes
// (Truey's F2).
//
// ── THE EXCHANGE ────────────────────────────────────────────────────────────
// The client sends one JSON object, `{ tool, clone, env }`, and half-closes:
// `tool` is one of TOOLS by name, `clone` the realpath of its clone, and `env`
// only TOWN_TZ, if it has one. The sandbox refuses any other tool, a clone that
// is not its own, and any other environment value. It runs the tool's fixed argv
// with the environment PATH, HOME (its own scratch directory) and TOWN_TZ, and
// answers `{ ok, exit, out, err[, report] }`: the tool's stdout and stderr in
// base64, and for the ferry the --report it wrote in the scratch directory. No
// argument from the client reaches the command line.
//
// ── WHAT THE CLIENT CHECKS AFTER EVERY RUN ──────────────────────────────────
// What the sandbox cannot stop is a tool writing where its writable directories
// let it. So the client, before and after each run, reads the clone's own state
// with git and refuses (exit 1, the ferry's undo then puts the clone back) when:
//   · any symlink is now under WHITE_PAGES or TOWN_BULLETIN (no symlink is
//     tracked in the town; one there would turn a later read by office code, which
//     runs with rights, into a read of what it names);
//   · any path outside the tool's own writes changed, by name or by content
//     (verify writes nothing; quests writes TOWN_BULLETIN/quests.md; the ferry
//     writes under WHITE_PAGES);
//   · any gitignored path under the writable directories changed, whatever the
//     tool: git add and git clean pass ignored files by, and office code may read
//     them (Truey's F4).
// For the ferry it also refuses a staged symlink or submodule, a report it can't
// read, and counts that don't match what changed. The report it hands the
// witness is rebuilt from the tool's counts and date alone: the town sha is the
// client's own rev-parse, committed, pushed and files are the client's own
// facts, and the crossing number is the witness's to derive, never the tool's
// word (Truey's F3).
//
// ── NOT COVERED: SIGNALS (Truey's N2 on #1048; POS-1049) ────────────────────
// The tool can still signal other meepo processes: signal permission compares
// uids across user namespaces, and there is no PID namespace here. A PID
// namespace needs systemd 257 (PrivatePIDs) or an unprivileged user namespace,
// which this box's AppArmor refuses (kernel.apparmor_restrict_unprivileged_userns=1,
// probed 2026-11-14: unshare can't write its uid_map). It is MORE than
// availability. A tool can find meepo's pids with kill(pid, 0) and SIGKILL the
// office, and it can SIGKILL the waiting ferry client, its sh and its flock:
//   · then no EXIT trap runs, so there is no undo (or one runs while the tool
//     still writes), and town.lock is released to the next writer;
//   · and what the tool goes on writing in WHITE_PAGES and TOWN_BULLETIN stays
//     there until the next crossing's clean.
// What bounds it here: serve's spawnSync SIGKILLs the tool at STEP_MS (5 min),
// then kills everything it started, and the unit's RuntimeMaxSec (8 min) ends
// the instance. It still can't read a secret, reach the network, or write
// anywhere but those two directories.
//
// Exit codes (client): 0 the tool ran green and every check held; 1 a refusal (the
// tool's own non-zero exit, the sandbox's refusal, a missing socket, a malformed
// answer, a failed check, a failed pull, commit or push), named on stderr;
// 2 bad arguments.
//
// TOWN_TOOL_SOCKET overrides the socket path, for the tests' stand-in of the
// socket unit; on the box it is unset and the client uses SOCKET below.
//
// Built-ins, and from this tree only src/town-tool.mjs (POS-994: the loader that
// checks verify and quests against the pins). Under /srv the sandbox sees this
// file, the clone, and the three read-only paths that check needs:
// src/town-tool.mjs, src/stamp-verify-pinned.mjs and src/town-pins
// (deploy/postmark-town-tool@.service).
//
// ── UAT'S STAMP TRUST (POS-1214) ────────────────────────────────────────────
// On UAT only, the unit's drop-in sets STAMP_UAT_TRUST to one fixed path and
// binds that file and src/stamp-trust.mjs read-only. serve then passes the
// verify tool that PATH (sandboxTrustEnv), never the key's bytes and never
// anything from the client; src/stamp-trust.mjs is imported only then. Without
// it, as in production, nothing here changes.

import { createConnection, Socket } from "node:net";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isPinStop, townToolArgv } from "../src/town-tool.mjs"; // POS-994: verify and quests run the pinned copies

export const SOCKET = "/run/postmark-town-tool.sock";
const REPORT_SLOT = "\0report";
/** The three tools, by name: their fixed argv, and the paths each may change in the clone. */
// POS-994 /b (on #1065): verify and quests run the office's PINNED copies, their argv
// built inside the sandbox by src/town-tool.mjs § townToolArgv, which checks the clone's
// copy and closure against the pins (and runs the verifier with the pinned public key);
// a pin stop there runs nothing and answers stage "pin", which the client exits 3 on.
// The ferry is no pinned module and runs the clone's own, keyless, as it was.
export const TOOLS = {
  ferry: { argv: ["tools/ferry.mjs", "--no-git", "--report", REPORT_SLOT], writes: ["WHITE_PAGES/"] },
  verify: { pinned: "stamp-verify.mjs", args: [], writes: [] },
  quests: { pinned: "quest-progress.mjs", args: ["--snapshot"], writes: ["TOWN_BULLETIN/quests.md"] },
};
/** The clone's directories the sandbox can write (deploy/postmark-town-tool@.service's BindPaths). */
export const WRITABLE = ["WHITE_PAGES", "TOWN_BULLETIN"];
/** The one environment value a tool is given, from the client's own environment. */
export const PASSED_ENV = ["TOWN_TZ"];
const ENV_VALUE = /^[A-Za-z0-9_+\-/]{1,64}$/;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_OUTPUT = 16 * 1024 * 1024;
// The tools' real run times on the box (2026-11-15 00:00Z crossing): the ferry 9 s for 229 letters, a verify well
// under a minute. Five minutes leaves headroom and bounds how long a tool that has killed its client (POS-1049) can
// go on writing before serve SIGKILLs it and everything it started.
const STEP_MS = 5 * 60 * 1000;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    stream.on("data", (c) => {
      total += c.length;
      if (total > MAX_BYTES) { stream.destroy(); reject(new Error(`more than ${MAX_BYTES} bytes`)); return; }
      chunks.push(c);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/** The request, checked against this sandbox's own clone, or a throw naming what is wrong. */
export function checkRequest(req, ownClone) {
  if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("no request");
  if (!Object.hasOwn(TOOLS, req.tool)) throw new Error(`no such tool: ${JSON.stringify(req.tool)?.slice(0, 40)}`);
  if (req.clone !== ownClone) throw new Error(`this sandbox serves the clone at ${ownClone}, not ${JSON.stringify(req.clone)?.slice(0, 200)}`);
  const env = req.env ?? {};
  if (typeof env !== "object" || Array.isArray(env)) throw new Error("env is not an object");
  for (const [k, v] of Object.entries(env)) {
    if (!PASSED_ENV.includes(k)) throw new Error(`env ${k} is not passed to a town tool`);
    if (typeof v !== "string" || !ENV_VALUE.test(v)) throw new Error(`env ${k} is not a plain value`);
  }
  return { tool: req.tool, env };
}

/**
 * THE UAT TRUST'S TRANSPORT (POS-1214): what the sandbox adds to the verifier's
 * environment. Production's unit sets no STAMP_UAT_TRUST, and this answers {}:
 * the verifier's environment is exactly PATH, HOME and TOWN_TZ, as before. UAT's
 * drop-in (deploy/postmark-town-tool@.service-dropin-uat-stamp-trust.conf) sets
 * it to the one fixed path it binds read-only, src/stamp-trust.mjs §
 * UAT_TRUST_PATH, and binds src/stamp-trust.mjs beside the runner. Only that
 * path is passed, never the key's bytes, and only from this unit's own
 * environment: the client's request carries TOWN_TZ alone (checkRequest). The
 * file is checked here by the office's one policy before the verifier runs (the
 * runner checks it again), so a set but unusable trust refuses the request,
 * visibly, and runs nothing. The trust module is imported only when asked for,
 * since production's unit doesn't bind it. `fixedPath` is the test's seam.
 */
export async function sandboxTrustEnv(unitEnv, ownClone, { fixedPath = null } = {}) {
  if (!unitEnv?.STAMP_UAT_TRUST) return {}; // unset or empty: no file bound
  const { UAT_TRUST_ENV, UAT_TRUST_PATH, uatHandoff, StampTrustUnusable } = await import("../src/stamp-trust.mjs");
  const path = fixedPath ?? UAT_TRUST_PATH;
  const asked = unitEnv[UAT_TRUST_ENV];
  if (asked !== path) throw new StampTrustUnusable(asked, `the town-tool sandbox reads UAT's trust only at ${path}, the path its UAT drop-in binds read-only`);
  uatHandoff({ env: { [UAT_TRUST_ENV]: path }, clone: ownClone });
  return { [UAT_TRUST_ENV]: path };
}

/**
 * The other processes in this instance's own cgroup, from /proc/self/cgroup's
 * line and that cgroup's cgroup.procs: what a tool left running. null outside a
 * postmark-town-tool@ instance (a test's stand-in), where there is nothing to kill.
 * THE GUARD THAT IS ENOUGH ALONE is the cgroup: it must be a postmark-town-tool@
 * unit's. Outside one, this kill would take every other process in the caller's
 * cgroup, and on 2026-11-14 a can-fail flip that removed this guard did exactly
 * that to the seat house's shells in /init.scope (no seat was hit). systemd's
 * INVOCATION_ID is a second belt that keeps a plain shell or a test's stand-in
 * out even if the cgroup check is ever wrong, but it is NOT enough alone: every
 * systemd service has one (a CI runner is one).
 */
export function stragglerPids(cgroupText, procsText, self, env = process.env) {
  if (!env.INVOCATION_ID) return null;
  const path = /^0::(\/\S*)$/m.exec(String(cgroupText))?.[1];
  if (!path || !/\/postmark-town-tool@[^/]+\.service$/.test(path)) return null;
  return String(procsText).split("\n").map(Number).filter((p) => Number.isInteger(p) && p > 0 && p !== self);
}

/**
 * Kill every other process in this instance; true only once serve is alone in its cgroup.
 * FREEZE, THEN KILL (Truey's re-review): a read-then-kill loses to a tool that keeps
 * forking, so each round SIGSTOPs what it sees and re-lists until no new pid appears (a
 * stopped process can't fork), and only then SIGKILLs them all.
 * FAIL CLOSED IN THE UNIT: with `required` (serve --in-unit, the unit's ExecStart), a
 * cgroup it can't read or doesn't recognize is a refusal, never a pass. Without it (a
 * test's stand-in) there is nothing to kill and it never kills.
 */
export function killStragglers({ required = false, list = null, signal = (pid, sig) => process.kill(pid, sig), pause = null } = {}) {
  // `list`, `signal` and `pause` are the test's seam (a fake process table); serve passes none of them
  if (!list) {
    let cg = "";
    try { cg = readFileSync("/proc/self/cgroup", "utf8"); } catch { /* read as unknown below */ }
    const path = /^0::(\/\S*)$/m.exec(cg)?.[1];
    list = () => (path ? stragglerPids(cg, readFileSync(`/sys/fs/cgroup${path}/cgroup.procs`, "utf8"), process.pid) : null);
  }
  const nap = new Int32Array(new SharedArrayBuffer(4));
  pause ??= () => Atomics.wait(nap, 0, 0, 20);
  let left;
  try { left = list(); } catch { left = null; }
  if (left === null) return !required;
  for (let round = 0; round < 50 && left.length; round += 1) {
    const frozen = new Set();
    for (let pass = 0; pass < 200 && left.some((p) => !frozen.has(p)); pass += 1) {
      for (const pid of left) {
        if (frozen.has(pid)) continue;
        try { signal(pid, "SIGSTOP"); } catch { /* gone already */ }
        frozen.add(pid);
      }
      left = list();
    }
    console.error(`[town-tool] killing ${frozen.size} process(es) the tool left running`);
    for (const pid of frozen) { try { signal(pid, "SIGKILL"); } catch { /* gone already */ } }
    pause();
    left = list();
  }
  return left.length === 0;
}

/** The sandbox's half: one request on fd 0, one answer on fd 1. Logs go to stderr (the journal). */
export async function serve(cloneArg, { inUnit = false } = {}) {
  const input = new Socket({ fd: 0, readable: true, writable: false, allowHalfOpen: true });
  let answer;
  let dir = null;
  try {
    const ownClone = realpathSync(cloneArg);
    const { tool, env } = checkRequest(JSON.parse((await readAll(input)).toString("utf8")), ownClone);
    dir = mkdtempSync(join(tmpdir(), "town-tool-"));
    const report = join(dir, "report.json");
    // a pin stop throws here, before anything runs, and is answered below as stage "pin"
    const argv = TOOLS[tool].pinned
      ? townToolArgv(ownClone, TOOLS[tool].pinned, TOOLS[tool].args)
      : TOOLS[tool].argv.map((a) => (a === REPORT_SLOT ? report : a));
    // UAT only (POS-1214): the verifier gets the trust file's fixed PATH from this unit's own
    // environment, never from the client and never as key bytes. In production it is {}.
    const trust = tool === "verify" ? await sandboxTrustEnv(process.env, ownClone) : {};
    const r = spawnSync(process.execPath, argv, {
      cwd: ownClone, env: { PATH: "/usr/bin:/bin", HOME: dir, ...env, ...trust }, stdio: ["ignore", "pipe", "pipe"],
      timeout: STEP_MS, killSignal: "SIGKILL", maxBuffer: MAX_OUTPUT,
    });
    const exit = r.status ?? 1;
    console.error(`[town-tool] ${tool}: exit ${exit}${r.signal ? ` (${r.signal})` : ""}${r.error ? ` (${r.error.code})` : ""}`);
    // F2: nothing the tool started may still be writing when the client checks the clone
    if (!killStragglers({ required: inUnit })) throw new Error("this instance can't be cleared of what the tool started");
    answer = {
      ok: exit === 0 && !r.signal && !r.error, exit,
      out: Buffer.from(r.stdout ?? "").toString("base64"), err: Buffer.from(r.stderr ?? "").toString("base64"),
    };
    if (tool === "ferry") answer.report = existsSync(report) ? readFileSync(report, "utf8").slice(0, MAX_OUTPUT) : null;
  } catch (e) {
    console.error(`[town-tool] refused: ${e?.message ?? e}`);
    answer = isPinStop(e)
      ? { ok: false, stage: "pin", file: e.file ?? null, why: String(e.message).slice(0, 300) }
      : { ok: false, stage: "sandbox", why: String(e?.message ?? e).slice(0, 300) };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  const output = new Socket({ fd: 1, readable: false, writable: true });
  await new Promise((resolve) => output.end(JSON.stringify(answer), resolve));
  process.exitCode = answer.ok ? 0 : 1;
}

// ── the client's checks ─────────────────────────────────────────────────────

function git(clone, args, opts = {}) {
  const r = spawnSync("git", ["-C", clone, ...args], { encoding: "utf8", maxBuffer: MAX_BYTES, ...opts });
  if (r.error) throw r.error;
  return r;
}

function mustGit(clone, args, what) {
  const r = git(clone, args);
  if (r.status !== 0) throw new Error(`${what} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

/** Every symlink under the writable directories, as clone-relative paths. */
export function symlinksUnder(clone, dirs = WRITABLE) {
  const found = [];
  const walk = (rel) => {
    let st;
    try { st = lstatSync(join(clone, rel)); } catch (e) { if (e?.code === "ENOENT") return; throw e; }
    if (st.isSymbolicLink()) { found.push(rel); return; }
    if (!st.isDirectory()) return;
    for (const name of readdirSync(join(clone, rel))) walk(`${rel}/${name}`);
  };
  for (const d of dirs) walk(d);
  return found.sort();
}

/**
 * The clone's changed paths outside `allowed` (prefixes, or exact paths), each
 * with a digest of what is on disk: `git status` names a path that changed from
 * HEAD, and the digest catches a path that was already changed and changed again.
 */
export function fingerprint(clone, allowed) {
  const out = mustGit(clone, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames", "--ignored=matching"], "git status");
  const map = {};
  for (const entry of out.split("\0")) {
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const rel = entry.slice(3).replace(/\/$/, "");
    if (code === "!!") {
      // F4: an ignored path under the writable directories is never a tool's to change, whatever the tool
      if (!WRITABLE.some((d) => rel === d || rel.startsWith(`${d}/`))) continue;
      map[`!${rel}`] = `!! ${digestOf(join(clone, rel))}`;
      continue;
    }
    if (allowed.some((a) => (a.endsWith("/") ? rel.startsWith(a) : rel === a))) continue;
    map[rel] = `${code} ${digestOf(join(clone, rel))}`;
  }
  return map;
}

/** What is on disk at `abs`: a link's target, a file's sha256, a directory's entries' digests, or "gone". */
function digestOf(abs) {
  let st;
  try { st = lstatSync(abs); } catch (e) { if (e?.code === "ENOENT") return "gone"; throw e; }
  if (st.isSymbolicLink()) return `link:${readlinkSync(abs)}`;
  if (st.isFile()) return createHash("sha256").update(readFileSync(abs)).digest("hex");
  if (st.isDirectory()) {
    const h = createHash("sha256");
    for (const name of readdirSync(abs).sort()) h.update(`${name}\0${digestOf(join(abs, name))}\0`);
    return `dir:${h.digest("hex")}`;
  }
  return `kind:${st.mode}`;
}

/** What changed between two fingerprints, as names. */
export function changedBetween(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => before[k] !== after[k]).sort();
}

// ── the client ──────────────────────────────────────────────────────────────

/**
 * Run `tool` in the sandbox against `clone`, pass its output through, and check
 * the clone after it. Resolves `{ code, report }`: code 0 green, 1 a refusal.
 */
export async function runTool(tool, clone, { socketPath = process.env.TOWN_TOOL_SOCKET || SOCKET, env = process.env } = {}) {
  const tag = `[town-tool ${tool}]`;
  let real, before;
  try {
    real = realpathSync(clone);
    before = fingerprint(real, TOOLS[tool].writes);
  } catch (e) {
    console.error(`${tag} refused in the clone ${clone}: ${e?.message ?? e}; nothing sent`);
    return { code: 1 };
  }
  const passed = Object.fromEntries(PASSED_ENV.filter((k) => env[k]).map((k) => [k, env[k]]));
  let body;
  try {
    const conn = createConnection({ path: socketPath, allowHalfOpen: true });
    conn.on("connect", () => conn.end(JSON.stringify({ tool, clone: real, env: passed })));
    body = await readAll(conn);
  } catch (e) {
    console.error(`${tag} the town-tool sandbox did not answer at ${socketPath} (${e?.code ?? e?.message ?? e}): is postmark-town-tool.socket installed and listening?`);
    return { code: 1 };
  }
  let answer;
  try {
    answer = JSON.parse(body.toString("utf8"));
    if (typeof answer?.ok !== "boolean") throw new Error("no ok");
  } catch {
    console.error(`${tag} the sandbox's answer is not one (${body.length} bytes)`);
    return { code: 1 };
  }
  if (answer.stage === "sandbox") {
    console.error(`${tag} the sandbox refused the request: ${answer.why ?? "?"}`);
    return { code: 1 };
  }
  if (answer.stage === "pin") {
    // the town's code is not the office's pinned copy: nothing ran; exit 3, the pin stop's number
    console.error(`${tag} ${answer.why ?? "the pin stopped it"}`);
    return { code: 3 };
  }
  for (const k of ["out", "err"]) {
    if (typeof answer[k] !== "string" || answer[k].length % 4 !== 0 || !BASE64.test(answer[k])) {
      console.error(`${tag} the sandbox's answer has no ${k}`);
      return { code: 1 };
    }
  }
  process.stdout.write(Buffer.from(answer.out, "base64"));
  process.stderr.write(Buffer.from(answer.err, "base64"));
  const report = typeof answer.report === "string" ? answer.report : null;
  try {
    const links = symlinksUnder(real);
    if (links.length) throw new Error(`a symlink is now in the clone: ${links.slice(0, 5).join(", ")}`);
    const moved = changedBetween(before, fingerprint(real, TOOLS[tool].writes));
    if (moved.length) throw new Error(`it changed what it may not: ${moved.slice(0, 5).join(", ")}${moved.length > 5 ? ` and ${moved.length - 5} more` : ""}`);
  } catch (e) {
    console.error(`${tag} refused after the run: ${e?.message ?? e}`);
    return { code: 1, report };
  }
  if (!answer.ok) {
    console.error(`${tag} exited ${answer.exit} in the sandbox`);
    return { code: 1, report };
  }
  return { code: 0, report };
}

function pushRetry(clone) {
  const ATTEMPTS = 3;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const push = git(clone, ["push"]);
    if (push.status === 0) { console.log(attempt === 1 ? "git: pushed" : `git: pushed on attempt ${attempt}/${ATTEMPTS}`); return; }
    const why = (push.stderr || push.stdout).trim();
    console.log(`git: push REJECTED (attempt ${attempt}/${ATTEMPTS}):\n  ${why.replace(/\n/g, "\n  ")}`);
    if (attempt === ATTEMPTS) throw new Error(`git push failed after ${ATTEMPTS} attempts:\n${why}`);
    console.log("git: someone landed inside the window — pull --rebase, then push again");
    const rebase = git(clone, ["pull", "--rebase"]);
    if (rebase.status !== 0) {
      git(clone, ["rebase", "--abort"]);
      throw new Error(`git pull --rebase failed after a rejected push:\n${rebase.stderr || rebase.stdout}`);
    }
  }
}

const count = (n) => Number.isInteger(n) && n >= 0;

/**
 * The ferry, whole: pull, the town's ferry.mjs --no-git in the sandbox, then the
 * commit and the push its --no-git skipped, with the same message, the same push
 * retry and the same report fields as ferry.mjs's own (the witness reads them).
 */
export async function ferry(clone, reportPath, opts = {}) {
  let report = { ran: false };
  const finish = (code, error) => {
    if (error) { report.error = error; console.error(`[ferry] ${error}`); }
    if (reportPath) {
      try { writeFileSync(reportPath, `${JSON.stringify(report, null, 1)}\n`, "utf8"); } catch (e) {
        console.error(`[ferry] could not write the report ${reportPath}: ${e?.message ?? e}`);
      }
    }
    return code;
  };
  let real, townSha;
  try {
    real = realpathSync(clone);
    if (mustGit(real, ["remote"], "git remote").trim()) {
      console.log("git: pull");
      const pulled = mustGit(real, ["pull", "--ff-only"], "git pull").trim();
      if (pulled) console.log(`  ${pulled.replace(/\n/g, "\n  ")}`);
    } else console.log("git: no remote — skipping pull");
    // the sha the ferry reads (--no-git, it pulls nothing) is this one; the report names it from here, not from the tool
    townSha = mustGit(real, ["rev-parse", "HEAD"], "git rev-parse").trim();
  } catch (e) {
    return finish(1, e?.message ?? String(e));
  }
  const r = await runTool("ferry", real, opts);
  let said = null;
  if (r.report !== null && r.report !== undefined) {
    try {
      const parsed = JSON.parse(r.report);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) said = parsed;
    } catch { /* an unreadable report is named below */ }
  }
  // F3: the witness signs what this report says, so only the tool's counts and date come from the tool, each
  // checked; the sha is the client's own, and committed, pushed and files are the client's facts. No crossing
  // number: the witness derives it from the decision time when a report names none (town witness-chain.mjs).
  report = {
    ran: said?.ran === true, town_sha: /^[0-9a-f]{40}$/.test(townSha) ? townSha : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(said?.date)) ? said.date : null,
    delivered: count(said?.delivered) ? said.delivered : null, bounced: count(said?.bounced) ? said.bounced : null,
    committed: false, pushed: false, files: [],
  };
  if (r.code !== 0) {
    return finish(1, typeof said?.error === "string" ? `the sandboxed ferry refused: ${said.error.slice(0, 500)}` : "the sandboxed ferry refused");
  }
  try {
    if (!report.ran || report.delivered === null || report.bounced === null || report.date === null) {
      throw new Error("the ferry exited 0 without a readable report (ran, delivered, bounced, date)");
    }
    mustGit(real, ["add", "-A", "--", "WHITE_PAGES"], "git add");
    const raw = mustGit(real, ["diff", "--cached", "--raw", "-z", "--no-renames"], "git diff --cached");
    const staged = [];
    const parts = raw.split("\0");
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const [, newMode] = parts[i].split(" ");
      const rel = parts[i + 1];
      if (newMode === "120000" || newMode === "160000") throw new Error(`the ferry staged a ${newMode === "120000" ? "symlink" : "submodule"}: ${rel}`);
      if (!rel.startsWith("WHITE_PAGES/")) throw new Error(`something outside WHITE_PAGES is staged: ${rel}`);
      staged.push(rel);
    }
    const moved = report.delivered + report.bounced > 0;
    if (moved !== (staged.length > 0)) {
      throw new Error(`the report says ${report.delivered} delivered and ${report.bounced} bounced, and ${staged.length} path(s) changed`);
    }
    if (!moved) return finish(0);
    const message = `ferry: ${report.delivered} delivered, ${report.bounced} bounced (${report.date})`;
    mustGit(real, ["commit", "-q", "-m", message], "git commit");
    console.log(`git: committed — ${message}`);
    report.committed = true;
    // as ferry.mjs: unset before the read, set only by a read that succeeded (POS-907)
    delete report.files;
    const carried = git(real, ["diff-tree", "--no-commit-id", "-r", "--name-only", "--diff-filter=AM", "HEAD"]);
    if (carried.status === 0) report.files = carried.stdout.split("\n").filter(Boolean);
    pushRetry(real);
    report.pushed = true;
  } catch (e) {
    return finish(1, e?.message ?? String(e));
  }
  return finish(0);
}

// Script only when run as one (the realpath compare: deploy/welcome-pass.mjs § entry guard).
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  const [verb, ...rest] = process.argv.slice(2);
  const opt = (name) => { const i = rest.indexOf(name); return i === -1 ? null : rest[i + 1] ?? null; };
  const clone = opt("--clone");
  if (!clone || !(verb === "serve" || Object.hasOwn(TOOLS, verb))) {
    console.error("usage: town-tool-sandbox.mjs <ferry|verify|quests> --clone <town clone> [--report <file>] | serve --clone <town clone> [--in-unit]");
    process.exit(2);
  }
  if (verb === "serve") await serve(clone, { inUnit: rest.includes("--in-unit") });
  else if (verb === "ferry") process.exitCode = await ferry(clone, opt("--report"));
  else process.exitCode = (await runTool(verb, clone)).code;
}
