// manifest-keyed-reads.test.mjs — GET /'s auth line says which reads need a key,
// and the doors agree (POS-525, office #348).
//
// The office's three accounts of auth disagreed with each other and with the
// code: CONTRACT.md § MCP skin said MCP reads need no key, the server header said
// REST reads need one, and GET / said "every GET here is public" while six reads
// answered 401. GET / now names those reads (`auth.keyed_reads`), and this file
// asks every door the manifest lists, with no key:
//
//   · a read in `keyed_reads` answers 401;
//   · every other read in `reads` answers anything but 401;
//   · POST /mcp answers 401, initialize included (CONTRACT.md § Auth).
//
// The list is written by hand: the routes are an if-chain in server.mjs, each
// asking for its own key, with no table to build it from. This file is what keeps
// the hand-written list true. A new keyed read reddens the first leg until it is
// named; a read that stops asking for a key reddens the second.
//
//   node --test test/manifest-keyed-reads.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureTown } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { removeTempDir, tempDir } from "./helpers/temp-dir.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = tempDir("manifest-keyed-reads-");
let ix = null, office = null;

before(async () => {
  const town = fixtureTown();
  ix = await indexStore(town, { db: "manifest_keyed_reads" });
  const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0",
    "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db")], {
    env: { ...process.env, TOWN_CLONE: join(tmp, "no-clone-here"), WORLD_CLONE: join(tmp, "no-world-clone"), VOICES_LOG: join(tmp, "voices.jsonl"),
      TOWN_PUSH: "", WORLD_APEX: "1", WORLD_STORE_DB: join(tmp, "no-world.db"), ...ix.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error(`the office never listened: ${stderr.slice(-600)}`)), 30_000);
    child.stdout.on("data", (d) => { const m = /listening on :(\d+)/.exec(String(d)); if (m) { clearTimeout(t); office = { child, base: `http://127.0.0.1:${m[1]}` }; ok(); } });
    child.on("exit", (c) => no(new Error(`the office exited early (${c}): ${stderr.slice(-600)}`)));
  });
});

after(async () => {
  const child = office?.child;
  if (child && child.exitCode === null) child.kill();
  await ix?.stop();
  await removeTempDir(tmp, { children: [child] });
});

// A manifest entry as a request: placeholders filled, optional query dropped.
const askable = (entry) => entry
  .replace(/\[[^\]]*\]/g, "")
  .replace(/\{(handle|h|host|author)\}/g, "wright")
  .replace(/\{[^}]+\}/g, "x")
  .replace(/=(&|$)/g, "=x$1");

async function statusOf(path) {
  const ac = new AbortController();
  const res = await fetch(`${office.base}${path}`, { signal: ac.signal });
  ac.abort(); // a stream that did answer is not read to its end
  return res.status;
}

test("GET /'s keyed reads answer 401 with no key, and every other read it lists does not", async (t) => {
  const manifest = await (await fetch(`${office.base}/`)).json();
  const keyed = manifest.auth?.keyed_reads;
  assert.ok(Array.isArray(keyed) && keyed.length, `the manifest names its keyed reads: ${JSON.stringify(manifest.auth)}`);
  assert.doesNotMatch(manifest.auth.none, /every GET here is public$/, "and no longer says every GET is public");

  const wrong = [];
  for (const entry of keyed) {
    const s = await statusOf(askable(entry));
    t.diagnostic(`keyed  ${entry} → ${s}`);
    if (s !== 401) wrong.push(`${entry} answered ${s} with no key, and the manifest says it needs one`);
  }
  for (const entry of manifest.reads.filter((r) => !keyed.includes(r))) {
    const s = await statusOf(askable(entry));
    t.diagnostic(`public ${entry} → ${s}`);
    if (s === 401) wrong.push(`${entry} answered 401 with no key, and the manifest lists it as public`);
  }
  assert.deepEqual(wrong, []);
});

test("POST /mcp asks for a key for everything, initialize included (CONTRACT.md § Auth)", async () => {
  const res = await fetch(`${office.base}/mcp`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "pos-525", version: "0" } } }) });
  assert.equal(res.status, 401, "an anonymous initialize is refused");
  assert.match(res.headers.get("www-authenticate") ?? "", /resource_metadata/, "with the discovery header a connector signs in from");
});
