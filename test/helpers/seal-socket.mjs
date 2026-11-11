// A stand-in for postmark-town-seal.socket (POS-988), for the tests that run the
// ferry's shipped chain. Each connection runs the real
// `tools/town-seal-sandbox.mjs serve` with the connection itself on its stdin
// and stdout, the way systemd's Accept=yes hands it over, so the half-close and
// the answer are the box's exchange. What it does not stand in for is the
// sandbox's denials (DynamicUser, no network, /srv hidden); those are the
// unit's lines, pinned in test/town-seal-sandbox.test.mjs.
//
// The chain under test runs through spawnSync, which blocks this process's
// event loop, so the socket lives in its own process: startSealSocket() spawns
// this file as the server and waits for its socket to exist. POSIX only: the
// sandbox's half reads a socket by file descriptor, which node does not do on
// Windows, so there the tests that reach the seal stage skip (sealSkip).
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const TOOL = join(dirname(HERE), "..", "..", "tools", "town-seal-sandbox.mjs");

export const sealSkip = process.platform === "win32" ? "the sandboxed seal reads its socket by file descriptor, POSIX only" : false;

const servers = [];

/** Start a stand-in socket at `path`; returns `path` once it is listening. */
export function startSealSocket(path) {
  const child = spawn(process.execPath, [HERE, path], { stdio: ["ignore", "ignore", "inherit"], env: { PATH: process.env.PATH } });
  servers.push(child);
  const until = Date.now() + 10000;
  while (!existsSync(path)) {
    if (Date.now() > until) throw new Error(`the seal socket stand-in never listened at ${path}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  return path;
}

/** Stop every stand-in this process started (for `after`). */
export function stopSealSockets() {
  for (const s of servers.splice(0)) s.kill("SIGKILL");
}

if (process.argv[1] === HERE) {
  const path = process.argv[2];
  createServer({ allowHalfOpen: true, pauseOnConnect: true }, (conn) => {
    const child = spawn(process.execPath, [TOOL, "serve"], { stdio: [conn, conn, "inherit"], env: { PATH: process.env.PATH } });
    child.on("spawn", () => conn.destroy());
  }).listen(path);
}
