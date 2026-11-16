// A stand-in for postmark-town-tool.socket (POS-994), for the tests that run the
// ferry's shipped chain. Each connection runs the real
// `tools/town-tool-sandbox.mjs serve --clone <clone>` with the connection itself
// on its stdin and stdout, the way systemd's Accept=yes hands it over, so the
// exchange is the box's. What it does not stand in for is the unit's denials
// (no env file, no network, /srv and /etc hidden, the clone read-only but two
// directories); those are the unit's lines, pinned in
// test/town-tool-sandbox.test.mjs and proved on the box (POS-994).
//
// The chain under test runs through spawnSync, which blocks this process's event
// loop, so the socket lives in its own process (as test/helpers/seal-socket.mjs).
// POSIX only: serve reads its socket by file descriptor.
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(import.meta.url);
const TOOL = join(dirname(HERE), "..", "..", "tools", "town-tool-sandbox.mjs");

export const toolSkip = process.platform === "win32" ? "the sandboxed town tools read their socket by file descriptor, POSIX only" : false;

/** What serve is started with here: PATH, plus values a town tool must never see. */
export const DECOY_ENV = { PATH: process.env.PATH, GH_TOKEN: "decoy-not-a-token", TOWN_CLONE: "/decoy/town-clone", STAMP_KEY: "/decoy/stamp-key.pem" };

const servers = [];

/**
 * Start a stand-in socket at `path` serving `clone`; returns `path` once it is listening.
 * POS-994: serve checks the clone against the office's pins before verify and quests
 * run; `pinsDir` names a fixture's own (TOWN_PINS_DIR in serve's env, never the tool's).
 */
export function startToolSocket(path, clone, { pinsDir = "" } = {}) {
  const child = spawn(process.execPath, [HERE, path, clone, pinsDir], { stdio: ["ignore", "ignore", "inherit"], env: { PATH: process.env.PATH } });
  servers.push(child);
  const until = Date.now() + 10000;
  while (!existsSync(path)) {
    if (Date.now() > until) throw new Error(`the town-tool socket stand-in never listened at ${path}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  return path;
}

/** Stop every stand-in this process started (for `after`). */
export function stopToolSockets() {
  for (const s of servers.splice(0)) s.kill("SIGKILL");
}

if (process.argv[1] === HERE) {
  const [path, clone, pinsDir] = process.argv.slice(2);
  const env = pinsDir ? { ...DECOY_ENV, TOWN_PINS_DIR: pinsDir } : DECOY_ENV;
  createServer({ allowHalfOpen: true, pauseOnConnect: true }, (conn) => {
    // DECOY: serve itself is started with what a careless unit could hand it, so
    // the tests see serve's own scrub (its tools get PATH, HOME and TOWN_TZ only).
    const child = spawn(process.execPath, [TOOL, "serve", "--clone", clone], { stdio: [conn, conn, "inherit"], env });
    child.on("spawn", () => conn.destroy());
  }).listen(path);
}
