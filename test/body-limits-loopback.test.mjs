// body-limits-loopback.test.mjs — every request-body door answers an oversize body with a real 413, over real HTTP (POS-526).
//
//   node --test --test-concurrency=1 test/body-limits-loopback.test.mjs
//
// The office itself (src/server.mjs) on an ephemeral 127.0.0.1 port, with the
// suite's synthetic fixture db, one invented static key, no store, no town
// clone and no network beyond the loopback. Each door is sent one byte past its
// cap, by Content-Length and by chunked encoding, and must answer a COMPLETE
// 413 in its own shape (CONTRACT.md § Error shape) — never a reset — with no
// act, tool or record touched, and the office must serve the next request.
// Bodies are fixed filler; nothing real is read or sent.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureTown } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "pos526-loopback-key";
let child, PORT, tmp, ix, oauthPath, stderr = "";

before(async () => {
  tmp = tempDir("postmark-office-pos526-");
  // the town index the office reads: the store, seeded from the fixture town (POS-656)
  ix = await indexStore(fixtureTown(), { db: "pos526_loopback" });
  oauthPath = seedStaticKeys(join(tmp, "oauth.db"), `${KEY}=pos526house:wright`);
  ({ child, port: PORT } = await bootOnFreePort((port) => spawn(process.execPath,
    [join(ROOT, "src", "server.mjs"), "--port", String(port), "--oauth-db", oauthPath], {
      env: {
        PATH: process.env.PATH, HOME: tmp, WORLD_GRAPH_NONE: "1", ...ix.env,
        TOWN_CLONE: join(tmp, "no-town-clone"), TOWN_PUSH: "",
        PUBLIC_BASE: `http://127.0.0.1:${port}`,
        POSTMARK_OAUTH_GITHUB_CLIENT_ID: "pos526-mock-app", POSTMARK_OAUTH_GITHUB_CLIENT_SECRET: "pos526-mock-secret",
        GITHUB_AUTH_URL: "http://127.0.0.1:9/never", GITHUB_TOKEN_URL: "http://127.0.0.1:9/never", GITHUB_API_URL: "http://127.0.0.1:9",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })));
  child.stderr.on("data", (d) => { stderr += d; });
});
after(async () => {
  if (child && child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
  await ix?.stop();
});

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * POST `body` to `path`; resolves the COMPLETE response { status, headers, text }
 * or rejects with the socket error (a reset is a failure, never a pass). Writes
 * in `chunk`-byte pieces with `delay` ms between them; stops writing once the
 * answer has arrived, then drops the socket (the client giving up mid-upload).
 */
function send(path, body, { chunked = false, chunk = 64 * 1024, delay = 0, headers = {}, extra = 0 } = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  return new Promise((resolve, reject) => {
    let answered = false;
    const req = http.request({
      host: "127.0.0.1", port: PORT, path, method: "POST", agent: false,
      headers: { "content-type": "application/json", ...headers,
        ...(chunked ? { "transfer-encoding": "chunked" } : { "content-length": String(buf.length + extra) }) },
    });
    req.setNoDelay(true);
    req.on("response", (res) => {
      const parts = [];
      res.on("data", (c) => parts.push(c));
      res.on("end", () => {
        answered = true;
        resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(parts).toString("utf8") });
        req.destroy();
      });
      res.on("error", (e) => { if (!answered) reject(e); });
    });
    req.on("error", (e) => { if (!answered) reject(e); });
    (async () => {
      for (let i = 0; i < buf.length && !answered && !req.destroyed; i += chunk) {
        req.write(buf.subarray(i, i + chunk));
        if (delay) await sleep(delay);
      }
      for (let i = 0; i < extra && !answered && !req.destroyed; i += 1024) { // keeps sending past the cap
        req.write(Buffer.alloc(Math.min(1024, extra - i), 0x20));
        await sleep(5);
      }
      if (!answered && !req.destroyed) req.end();
    })().catch(() => {});
  });
}
const get = (path) => new Promise((resolve, reject) => {
  http.get({ host: "127.0.0.1", port: PORT, path, agent: false }, (res) => {
    const parts = []; res.on("data", (c) => parts.push(c)); res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(parts).toString("utf8") }));
  }).on("error", reject);
});
const auth = { authorization: `Bearer ${KEY}` };
const filler = (n) => {
  const head = '{"pad":"', tail = '"}';
  return Buffer.concat([Buffer.from(head), Buffer.alloc(n - head.length - tail.length, 0x61), Buffer.from(tail)]);
};
const form = (n) => Buffer.concat([Buffer.from("pad="), Buffer.alloc(n - 4, 0x61)]);
/** Every row in the key store and in the office's store, counted per table: a refused body must change none of them. */
async function rows() {
  const out = {};
  const d = new DatabaseSync(oauthPath, { readOnly: true });
  try {
    for (const { name: t } of d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all())
      out[`oauth.${t}`] = d.prepare(`SELECT count(*) AS n FROM "${t}"`).get().n;
  } finally { d.close(); }
  const c = await ix.store.connect("world2_owner");
  try {
    const tables = (await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name")).rows;
    for (const { table_name: t } of tables) out[`store.${t}`] = Number((await c.query(`SELECT count(*) AS n FROM "${t}"`)).rows[0].n);
  } finally { await c.end(); }
  return out;
}
const bounce413 = (r, what) => {
  assert.equal(r.status, 413, `${what}: status`);
  const b = JSON.parse(r.text);
  assert.equal(b.error, "bounce", what);
  assert.equal(b.code, 413, what);
  assert.equal(b.refused, true, what);
  assert.equal(b.defect, "the request body is too large", what);
  assert.match(b.hint, /at most \d+ bytes/, what);
  assert.equal("result" in b, false, `${what}: a refusal has no result`);
};

test("REST (the shared reader, POST /berth, 10 000 bytes): one byte over is a whole 413 bounce, by Content-Length and by chunks", async () => {
  const before = await rows();
  bounce413(await send("/berth", filler(10_001)), "content-length");
  bounce413(await send("/berth", filler(10_001), { chunked: true, chunk: 997 }), "chunked");
  const exact = await send("/berth", Buffer.from(JSON.stringify({ slug: "Not A Slug!", pad: "a".repeat(10_000 - 36) }).padEnd(10_000, " ")));
  assert.notEqual(exact.status, 413, "exactly the cap is read and judged by the door");
  assert.equal(exact.status, 422, "and the door answers its own refusal");
  const malformed = await send("/berth", "{not json");
  assert.equal(malformed.status, 400, "malformed JSON keeps its 400");
  assert.match(JSON.parse(malformed.text).defect, /not JSON/);
  assert.deepEqual(await rows(), before, "nothing minted or written");
});

test("POST /residency and POST /letters (200 000 bytes): one byte over is a whole 413 bounce", async () => {
  const before = await rows();
  bounce413(await send("/residency", filler(200_001), { headers: auth }), "residency, content-length");
  bounce413(await send("/residency", filler(200_001), { headers: auth, chunked: true }), "residency, chunked");
  bounce413(await send("/letters", filler(200_001), { headers: auth }), "letters, content-length");
  bounce413(await send("/letters", filler(200_001), { headers: auth, chunked: true }), "letters, chunked");
  assert.deepEqual(await rows(), before, "no join PR, no letter, no record");
});

test("the media door keeps its own cap (3 000 000 bytes): over is 413, exactly the cap is read", async () => {
  bounce413(await send("/media", filler(3_000_001), { headers: auth }), "media");
  assert.notEqual((await send("/media", filler(3_000_000), { headers: auth })).status, 413, "exactly 3 000 000 bytes is not refused for size");
});

test("MCP (3 000 000 bytes): one byte over is a whole 413 carrying a JSON-RPC error, no tool run", async () => {
  const before = await rows();
  for (const chunked of [false, true]) {
    const r = await send("/mcp", filler(3_000_001), { headers: auth, chunked });
    assert.equal(r.status, 413, `chunked=${chunked}`);
    const b = JSON.parse(r.text);
    assert.equal(b.jsonrpc, "2.0");
    assert.equal(b.id, null, "no id is known before the body parses");
    assert.equal(b.error.code, -32600);
    assert.match(b.error.message, /the request body is too large/);
  }
  assert.deepEqual(await rows(), before);
});

test("OAuth (100 000 bytes): one byte over is a whole 413 { error, error_description } on token, register and the browser's consent", async () => {
  const before = await rows();
  for (const [path, headers] of [
    ["/oauth/token", { "content-type": "application/x-www-form-urlencoded" }],
    ["/oauth/register", { "content-type": "application/json" }],
    ["/oauth/consent", { "content-type": "application/x-www-form-urlencoded", accept: "text/html" }],
  ]) {
    const r = await send(path, path === "/oauth/register" ? filler(100_001) : form(100_001), { headers });
    assert.equal(r.status, 413, path);
    assert.match(String(r.headers["content-type"]), /application\/json/, `${path}: JSON, not the browser page`);
    const b = JSON.parse(r.text);
    assert.equal(b.error, "invalid_request", path);
    assert.match(b.error_description, /the request body is too large/, path);
  }
  assert.deepEqual(await rows(), before, "no client, code or token written");
});

test("valid Unicode survives a byte-split upload through a real door (OAuth registration echoes the name)", async () => {
  const name = "Kettle 🫖 — café ümlaut 😀 日本";
  const body = Buffer.from(JSON.stringify({ redirect_uris: ["http://localhost:4545/cb"], client_name: name }), "utf8");
  const r = await send("/oauth/register", body, { chunk: 1, delay: 1 });
  assert.equal(r.status, 201, r.text.slice(0, 200));
  assert.equal(JSON.parse(r.text).client_name, name, "every multi-byte character arrived whole");
});

test("a slow upload that keeps going past the cap gets its 413 mid-stream, and the office serves the next request", async () => {
  const r = await send("/berth", filler(9_000), { chunk: 1_000, delay: 5, extra: 50_000 });
  bounce413(r, "slow, past the cap");
  const next = await get("/");
  assert.equal(next.status, 200, "the office is still serving");
  assert.doesNotMatch(stderr, /ERR_HTTP_HEADERS_SENT|write after end|Cannot set headers/, "no second response was attempted");
});
