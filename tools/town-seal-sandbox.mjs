#!/usr/bin/env node
// town-seal-sandbox.mjs — the crossing's seal, run with none of the ferry's rights
// (POS-988; the shape Wright picked 2026-11-10, (b′)).
//
//   node /srv/postmark-office/tools/town-seal-sandbox.mjs --clone <town clone>   the client (the ferry, as meepo)
//   node /srv/postmark-office/tools/town-seal-sandbox.mjs serve                  the sandbox (one connection on fd 0 and 1)
//
// ── WHY ─────────────────────────────────────────────────────────────────────
// The ferry's seal stage ran the town's PROJECTS/the-town-seal/seal.mjs and
// verify.mjs straight from the clone, inside postmark-ferry.service: as meepo,
// with the whole office environment, the stamp key and the town push credential
// in reach, and the network. Measured on POS-988 (2026-11-10), the pair needs
// none of it: no environment, no credential, no network, no child process. It
// reads WHITE_PAGES/mail-ledger.md and seal.json, and writes seal.json and
// the-town-seal.html next to itself. So the pair now runs in
// postmark-town-seal@.service, a DynamicUser with no environment, no network
// and /srv out of sight, reached through postmark-town-seal.socket (meepo only,
// 0600). meepo gains no right by it: it only connects to a socket.
//
// ── WHAT STAYS EXACTLY AS IT WAS ────────────────────────────────────────────
// The seal is still a stage of the crossing (`wstage=seal`), so POS-907's
// witness record names it; a refusal still exits 1, so the ferry's EXIT trap
// puts the clone back (whole or nothing); and the ferry's own shell still
// commits and pushes the two outputs, in the same order. Splitting the seal
// into units that run after the ferry exits would have taken it out of the
// crossing's witness record, which is why it is a socket the chain calls.
//
// ── THE EXCHANGE ────────────────────────────────────────────────────────────
// The client reads the four INPUTS from the clone and sends them as one JSON
// object, `{ files: { <path>: <base64> } }`, then half-closes. The sandbox
// writes them into a scratch tree under its private /tmp, runs seal.mjs and
// then verify.mjs there with an empty environment (PATH only), and answers with
// `{ ok: true, files: { <the two OUTPUTS>: <base64> } }` only when both exit 0,
// else `{ ok: false, stage, exit }`. Base64, so the outputs come back
// byte-exact and a mail-less crossing still diffs clean. Each side refuses a
// file set that is not exactly its own list, so neither can be made to read or
// write any other path. The client writes only the two OUTPUTS, by name.
//
// Exit codes (client): 0 sealed and written; 1 a refusal (the sandbox's, a
// missing socket, a malformed answer), named on stderr; 2 bad arguments.
//
// TOWN_SEAL_SOCKET overrides the socket path, for the tests' stand-in of the
// socket unit; on the box it is unset and the client uses SOCKET below.
//
// Built-ins only, and nothing imported from this tree: the sandbox can see this
// one file and nothing else under /srv (deploy/postmark-town-seal@.service).

import { createConnection, Socket } from "node:net";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SOCKET = "/run/postmark-town-seal.sock";
export const SEAL = "PROJECTS/the-town-seal/seal.mjs";
export const VERIFY = "PROJECTS/the-town-seal/verify.mjs";
export const INPUTS = [SEAL, VERIFY, "PROJECTS/the-town-seal/seal.json", "WHITE_PAGES/mail-ledger.md"];
export const OUTPUTS = ["PROJECTS/the-town-seal/seal.json", "PROJECTS/the-town-seal/the-town-seal.html"];
// The box's inputs are about 12 MB and its outputs about 19 MB (2026-11-10), base64 a third more.
const MAX_BYTES = 256 * 1024 * 1024;
const STEP_MS = 10 * 60 * 1000;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Exactly `names`, each a base64 string, or a throw naming what is wrong. */
export function checkFiles(files, names, what) {
  if (!files || typeof files !== "object" || Array.isArray(files)) throw new Error(`${what}: no file set`);
  const got = Object.keys(files).sort();
  const want = [...names].sort();
  if (got.length !== want.length || got.some((k, i) => k !== want[i])) {
    throw new Error(`${what}: expected exactly ${want.join(", ")}; got ${got.join(", ") || "nothing"}`);
  }
  for (const k of want) {
    if (typeof files[k] !== "string" || files[k].length % 4 !== 0 || !BASE64.test(files[k])) throw new Error(`${what}: ${k} is not base64`);
  }
  return files;
}

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

/** The sandbox's half: one request on fd 0, one answer on fd 1. Logs go to stderr (the journal). */
export async function serve() {
  const input = new Socket({ fd: 0, readable: true, writable: false, allowHalfOpen: true });
  let answer;
  let dir = null;
  try {
    const req = JSON.parse((await readAll(input)).toString("utf8"));
    const files = checkFiles(req?.files, INPUTS, "the inputs");
    dir = mkdtempSync(join(tmpdir(), "town-seal-"));
    for (const rel of INPUTS) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), Buffer.from(files[rel], "base64"));
    }
    for (const [stage, rel] of [["seal", SEAL], ["verify", VERIFY]]) {
      const r = spawnSync(process.execPath, [rel], {
        cwd: dir, env: { PATH: "/usr/bin:/bin" }, stdio: ["ignore", 2, 2], timeout: STEP_MS,
      });
      const exit = r.status ?? 1;
      console.error(`[town-seal] ${stage}: exit ${exit}${r.signal ? ` (${r.signal})` : ""}${r.error ? ` (${r.error.code})` : ""}`);
      if (exit !== 0 || r.signal || r.error) { answer = { ok: false, stage, exit }; break; }
    }
    answer ??= { ok: true, files: Object.fromEntries(OUTPUTS.map((rel) => [rel, readFileSync(join(dir, rel)).toString("base64")])) };
  } catch (e) {
    console.error(`[town-seal] refused: ${e?.message ?? e}`);
    answer = { ok: false, stage: "sandbox", why: String(e?.message ?? e).slice(0, 300) };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  const output = new Socket({ fd: 1, readable: false, writable: true });
  await new Promise((resolve) => output.end(JSON.stringify(answer), resolve));
  process.exitCode = answer.ok ? 0 : 1;
}

/** The ferry's half: send the clone's inputs, write the two outputs back, or exit 1 naming why. */
export async function client(clone, socketPath = process.env.TOWN_SEAL_SOCKET || SOCKET) {
  let files;
  try {
    files = Object.fromEntries(INPUTS.map((rel) => [rel, readFileSync(join(clone, rel)).toString("base64")]));
  } catch (e) {
    console.error(`[seal] the seal's inputs are not all in ${clone}: ${e?.message ?? e}`);
    return 1;
  }
  let body;
  try {
    const conn = createConnection({ path: socketPath, allowHalfOpen: true });
    conn.on("connect", () => conn.end(JSON.stringify({ files })));
    body = await readAll(conn);
  } catch (e) {
    console.error(`[seal] the seal sandbox did not answer at ${socketPath} (${e?.code ?? e?.message ?? e}): is postmark-town-seal.socket installed and listening?`);
    return 1;
  }
  let answer;
  try {
    answer = JSON.parse(body.toString("utf8"));
  } catch {
    console.error(`[seal] the seal sandbox's answer is not JSON (${body.length} bytes): nothing written`);
    return 1;
  }
  if (answer?.ok !== true) {
    console.error(`[seal] the sandboxed seal refused at ${answer?.stage ?? "?"}${answer?.exit != null ? ` (exit ${answer.exit})` : ""}${answer?.why ? `: ${answer.why}` : ""}`);
    return 1;
  }
  try {
    checkFiles(answer.files, OUTPUTS, "the answer");
  } catch (e) {
    console.error(`[seal] ${e.message}: nothing written`);
    return 1;
  }
  for (const rel of OUTPUTS) writeFileSync(join(clone, rel), Buffer.from(answer.files[rel], "base64"));
  console.log(`[seal] sealed in the sandbox: ${OUTPUTS.join(", ")}`);
  return 0;
}

// Script only when run as one (the realpath compare: deploy/welcome-pass.mjs § entry guard).
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv[0] === "serve") {
    await serve();
  } else {
    const i = argv.indexOf("--clone");
    const clone = i === -1 ? null : argv[i + 1];
    if (!clone) {
      console.error("usage: town-seal-sandbox.mjs --clone <town clone> | serve");
      process.exit(2);
    }
    process.exitCode = await client(clone);
  }
}
