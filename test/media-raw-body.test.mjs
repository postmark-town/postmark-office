// media-raw-body.test.mjs — POS-818: the media door's raw-body way in, and the
// retired `image` field answering for itself at the MCP door.
//
//   node --import ./test/helpers/sparse-guard.mjs --test --test-concurrency=1 test/media-raw-body.test.mjs
//
// The raw door (media.mjs § uploadMediaBody) is driven over REAL HTTP on an
// ephemeral 127.0.0.1 port: a plain node:http server whose one handler is the
// door itself, with storage stubbed (`put`) and an in-memory ledger, so Node's
// own request parser frames every body exactly as it does in the office. The
// office's routing of POST /media to this door is held at the end of this file,
// against the spawned office itself.
//
// LAW (POS-818, Darko 2026-10-29 12:40 EDT): "oh what? we can have a raw bytes
// upload?? yes let's staff it" — and, through Wright the same minute: "it must
// go through the same byte law, whole decode, quota, dedupe and ledger path as
// image_path and image_url (src/media.mjs's 'a new way IN must never become a
// new way AROUND the byte law')".
// LAW (POS-818/a, Darko 2026-10-29 13:14 EDT): "Require it" — no Content-Length
// is a 411, a declared oversize length a 413, and the actual bytes are still
// capped.
// LAW (POS-818/b, same sitting): "?by=<handle>" — checked against the key's own
// residents; a sole resident needs none.
//
// Env is pinned BEFORE the dynamic imports: media.mjs reads its dials at load.

import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { fixtureTown } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

process.env.R2_ACCOUNT_ID = "test-account";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";
process.env.MEDIA_QUOTA_BYTES = String(8 * 1024 * 1024);

const { uploadMedia, uploadMediaBody, RETIRED_IMAGE } = await import("../src/media.mjs");
const { MAX_IMAGE } = await import("../src/edit.mjs");
const { handleMcp } = await import("../src/mcp.mjs");

// ── fixtures ────────────────────────────────────────────────────────────────
// A real, whole PNG with enough texture to be a few KB, and a JPEG the format
// gate admits (SOI … EOI intact) whose middle libvips cannot decode — the shape
// of every broken original postmark#3022 found.
const PNG = await sharp({ create: { width: 96, height: 64, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 40 } } }).png().toBuffer();
const JPEG = await sharp({ create: { width: 640, height: 400, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 50 } } }).jpeg({ quality: 90 }).toBuffer();
const BROKEN_JPEG = Buffer.concat([JPEG.subarray(0, 600), Buffer.alloc(4000, 0), JPEG.subarray(-2)]);

// Keys by bearer: a household of two (tess, tom), another household (ollie), a sole resident (sol).
const KEYS = {
  "k-two": { household: "pairs", handles: new Set(["tess", "tom"]) },
  "k-other": { household: "others", handles: new Set(["ollie"]) },
  "k-solo": { household: "solos", handles: new Set(["sol"]) },
};

let server, PORT, db, puts;
const outcomes = []; // one settled promise per request the door handled
const freshLedger = () => { db = new DatabaseSync(":memory:"); puts = []; outcomes.length = 0; };
const put = async (objectKey, bytes) => { puts.push({ objectKey, bytes: bytes.length }); };
const originals = () => puts.filter(({ objectKey }) => !/-(?:96|256)\.[a-z]+$/.test(objectKey));
const ledgerRows = () => {
  try { return db.prepare("SELECT household, sha, by_handle FROM media").all(); }
  catch (e) { if (/no such table/.test(e.message)) return []; throw e; }
};

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const key = KEYS[String(req.headers.authorization ?? "").replace(/^Bearer /, "")] ?? null;
    outcomes.push(uploadMediaBody(req, key, db, { query: url.searchParams, put }).then(
      (result) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(result)); return { result }; },
      (e) => {
        if (!res.headersSent && !res.destroyed) {
          res.writeHead(Number.isInteger(e.code) ? e.code : 500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "bounce", defect: e.defect ?? String(e.message), hint: e.hint }));
        }
        return { error: e };
      }));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  PORT = server.address().port;
});
after(async () => { server.closeAllConnections?.(); await new Promise((ok) => server.close(ok)); });

/** POST raw bytes with Node's client (it always declares the length it sends). */
function postRaw(path, body, { key = "k-solo", type = "image/png" } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path, method: "POST", agent: false,
      headers: { "content-type": type, "content-length": String(body.length), ...(key ? { authorization: `Bearer ${key}` } : {}) } });
    req.on("response", (res) => { const parts = []; res.on("data", (c) => parts.push(c)); res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(parts).toString("utf8")) })); });
    req.on("error", reject);
    req.end(body);
  });
}

/** The first complete HTTP/1.1 response in `buf` ({ status, text }), or null while it is still arriving. */
function parseResponse(buf) {
  const text = buf.toString("latin1");
  const m = /^HTTP\/1\.1 (\d{3})/.exec(text);
  const split = text.indexOf("\r\n\r\n");
  if (!m || split === -1) return null;
  const head = text.slice(0, split);
  let rest = buf.subarray(split + 4);
  const len = /\r\ncontent-length: *(\d+)/i.exec(head);
  if (len) return rest.length >= Number(len[1]) ? { status: Number(m[1]), text: rest.subarray(0, Number(len[1])).toString("utf8") } : null;
  if (!/\r\ntransfer-encoding: *chunked/i.test(head)) return { status: Number(m[1]), text: "" };
  const parts = [];
  for (;;) {
    const eol = rest.indexOf("\r\n");
    if (eol === -1) return null;
    const size = parseInt(rest.subarray(0, eol).toString("latin1"), 16);
    if (size === 0) return { status: Number(m[1]), text: Buffer.concat(parts).toString("utf8") };
    if (rest.length < eol + 2 + size + 2) return null;
    parts.push(rest.subarray(eol + 2, eol + 2 + size));
    rest = rest.subarray(eol + 2 + size + 2);
  }
}

/**
 * Write a request byte for byte on a bare socket:`head` is the request line
 * and headers, `body` whatever follows. Resolves the first response's status
 * and body, or `{ status: null }` if none arrives within `waitMs` — which is
 * how "answered before the body was read" is measured: the body is never sent.
 */
function rawRequest({ head, body = Buffer.alloc(0), endAfter = false, waitMs = 4000, port = PORT }) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    let got = Buffer.alloc(0), done = false;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); resolve(v); };
    const timer = setTimeout(() => finish({ status: null, text: got.toString("utf8") }), waitMs);
    sock.on("data", (c) => {
      got = Buffer.concat([got, c]);
      const parsed = parseResponse(got);
      if (parsed) finish(parsed);
    });
    sock.on("error", () => finish({ status: null, text: got.toString("utf8") }));
    sock.on("close", () => finish({ status: null, text: got.toString("utf8") }));
    sock.write(Buffer.concat([Buffer.from(head.replace(/\n/g, "\r\n") + "\r\n\r\n", "latin1"), body]));
    if (endAfter) sock.end();
  });
}
const headFor = ({ path = "/media", key = "k-solo", type = "image/png", length, chunked = false } = {}) => [
  `POST ${path} HTTP/1.1`, "Host: 127.0.0.1", `Content-Type: ${type}`, ...(key ? [`Authorization: Bearer ${key}`] : []), "Connection: close",
  ...(chunked ? ["Transfer-Encoding: chunked"] : []), ...(length === undefined ? [] : [`Content-Length: ${length}`]),
].join("\n");

// ── the one path: dedupe across ways in, and the whole decode ───────────────

test("a raw PNG answers the SAME media URL as the JSON door for the same bytes, and the second spends nothing", async () => {
  freshLedger();
  const raw = await postRaw("/media", PNG);
  assert.equal(raw.status, 200, JSON.stringify(raw.json));
  assert.equal(raw.json.via, "bytes", "the raw body walked in through the in-process seam");
  assert.equal(raw.json.bytes, PNG.length);
  assert.equal(raw.json.type, "image/png");
  // the JSON door's handler (image_url, fetch injected so it runs offline), the same bytes, the same ledger
  const served = {
    fetchImpl: async () => ({ status: 200, ok: true, headers: new Headers({ "content-length": String(PNG.length) }),
      body: { getReader: () => { let sent = false; return { read: async () => (sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(PNG) })), cancel: async () => {} }; } } }),
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  };
  const viaJson = await uploadMedia({ image_url: "https://fixture.example.com/same.png" }, KEYS["k-solo"], db, { put, ...served });
  assert.equal(viaJson.url, raw.json.url, "LAW 'the same dedupe path': one file, one URL, whichever way it came in");
  assert.equal(viaJson.sha, raw.json.sha);
  assert.equal(viaJson.already, true, "the JSON door found the raw upload's row");
  const again = await postRaw("/media", PNG);
  assert.equal(again.json.url, raw.json.url);
  assert.equal(again.json.already, true, "and the raw door finds its own");
  assert.equal(originals().length, 1, "one original was put, ever");
  assert.equal(ledgerRows().length, 1, "one ledger row");
  assert.equal(ledgerRows()[0].by_handle, "sol", "a sole resident needs no by");
});

test("an undecodable body is refused whole: no put, no ledger row", async () => {
  freshLedger();
  assert.equal(BROKEN_JPEG.at(-1), 0xd9, "the enclosure is intact, so only the whole decode can refuse it");
  const r = await postRaw("/media", BROKEN_JPEG, { type: "image/jpeg" });
  assert.equal(r.status, 422, JSON.stringify(r.json));
  assert.match(r.json.defect, /not a whole JPG/, "LAW 'whole decode': the refusal is the decoder's own");
  assert.equal(puts.length, 0, "nothing reached storage");
  assert.deepEqual(ledgerRows(), [], "nothing reached the ledger");
});

test("the label routes, the bytes decide: a JPEG labelled image/png is a JPEG; text labelled image/png is refused", async () => {
  freshLedger();
  const jpeg = await postRaw("/media", JPEG, { type: "image/png" });
  assert.equal(jpeg.status, 200, JSON.stringify(jpeg.json));
  assert.equal(jpeg.json.type, "image/jpeg", "MIME is not proof of anything");
  const text = await postRaw("/media", Buffer.from("this is not an image at all, whatever the header says"), { type: "image/png" });
  assert.equal(text.status, 422);
  assert.match(text.json.defect, /not a JPEG, PNG, WebP, or SVG image/);
  assert.equal(originals().length, 1, "only the real JPEG was stored");
});

// ── the length rule (/a) ────────────────────────────────────────────────────

test("no Content-Length (a chunked body) is a 411, answered before the body is read", async () => {
  freshLedger();
  const r = await rawRequest({ head: headFor({ chunked: true }) }); // headers only: not one chunk is ever sent
  assert.equal(r.status, 411, `LAW /a "Require it": got ${r.status} (${r.text.slice(0, 160)})`);
  assert.match(JSON.parse(r.text).defect, /needs a Content-Length/);
  assert.equal(puts.length, 0);
});

test("a declared length over the cap is a 413 before a byte of the body is read; exactly the cap is read and judged", async () => {
  freshLedger();
  const over = await rawRequest({ head: headFor({ length: MAX_IMAGE + 1 }) }); // the body is never sent
  assert.equal(over.status, 413, `LAW /a: a declared oversize length is refused unread, got ${over.status}`);
  assert.match(JSON.parse(over.text).defect, /larger than 1\.5 MB/);
  assert.match(JSON.parse(over.text).hint, /none of it was read/);
  const atCap = await postRaw("/media", Buffer.alloc(MAX_IMAGE, 0x41));
  assert.equal(atCap.status, 422, "exactly the cap passes the size rule and meets the byte law");
  assert.match(atCap.json.defect, /not a JPEG, PNG, WebP, or SVG image/);
  assert.equal(puts.length, 0);
});

test("a lying length (more bytes sent than declared) is refused, with no put and no ledger row", async () => {
  freshLedger();
  const declared = PNG.length - 10;
  const r = await rawRequest({ head: headFor({ length: declared }), body: Buffer.concat([PNG, Buffer.alloc(64, 0x20)]) });
  // Node's parser frames the body by the declared length, so the door reads
  // exactly `declared` bytes (a PNG cut short) and the excess is parsed as a
  // malformed next request, which Node itself answers 400 and closes. Which of
  // the two refusals reaches the wire first is a race; both are refusals.
  assert.ok([400, 422].includes(r.status), `the wire carries a refusal, got ${r.status} (${r.text.slice(0, 160)})`);
  const [settled] = await Promise.all(outcomes);
  assert.ok(settled.error, "the door refused what it read");
  assert.equal(settled.error.code, 422, "LAW 'the byte law': the bytes inside the declared length are judged as an image");
  assert.match(settled.error.defect, /ends mid-stream/);
  assert.equal(puts.length, 0, "nothing reached storage");
  assert.deepEqual(ledgerRows(), [], "nothing reached the ledger");
});

test("a body shorter than its declared length is never stored", async () => {
  freshLedger();
  await rawRequest({ head: headFor({ length: PNG.length + 100 }), body: PNG, endAfter: true, waitMs: 1500 });
  assert.equal(outcomes.length, 1, "the door saw the request");
  const [settled] = await Promise.all(outcomes);
  assert.ok(settled.error, "the door refused it");
  assert.equal(settled.error.name, "BodyIncomplete", `the read ended short: ${settled.error.name}`);
  assert.equal(puts.length, 0);
  assert.deepEqual(ledgerRows(), []);
});

// ── who uploads (/b) ────────────────────────────────────────────────────────

test("?by= is checked against the key's own residents; a household of several must name one", async () => {
  freshLedger();
  const none = await postRaw("/media", PNG, { key: "k-two" });
  assert.equal(none.status, 422, "LAW /b: a multi-resident key with no by is refused, never guessed");
  assert.match(none.json.defect, /which resident uploads this/);
  const stranger = await postRaw("/media?by=ollie", PNG, { key: "k-two" });
  assert.equal(stranger.status, 403, "LAW /b: a key never names another household's resident");
  assert.match(stranger.json.defect, /"ollie" is not one of your residents/);
  assert.equal(puts.length, 0, "neither refusal stored anything");
  const named = await postRaw("/media?by=tom", PNG, { key: "k-two" });
  assert.equal(named.status, 200, JSON.stringify(named.json));
  assert.deepEqual(ledgerRows().map((r) => [r.household, r.by_handle]), [["pairs", "tom"]]);
});

test("the query takes by and nothing else, once", async () => {
  freshLedger();
  const odd = await postRaw("/media?by=sol&image_url=https://example.com/x.png", PNG);
  assert.equal(odd.status, 422);
  assert.match(odd.json.defect, /does not take: image_url/);
  const twice = await postRaw("/media?by=tess&by=tom", PNG, { key: "k-two" });
  assert.equal(twice.status, 422);
  assert.match(twice.json.defect, /send one by, not 2/);
  assert.equal(puts.length, 0);
});

// ── part 1: the retired field answers for itself at the MCP door ───────────

async function mcpCall(name, args) {
  const raw = JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } });
  const req = Object.assign(Readable.from([Buffer.from(raw)]), { method: "POST", headers: { "content-type": "application/json" } });
  let body = "";
  await new Promise((ok) => {
    const res = {
      headersSent: false, setHeader() {}, hasHeader() { return false; }, getHeader() { return undefined; },
      writeHead() { this.headersSent = true; return this; },
      end(chunk) { if (chunk) body += chunk; ok(); },
    };
    handleMcp(req, res, { key: KEYS["k-solo"], canWrite: false, asOf: "test", odb: null });
  });
  const rpc = JSON.parse(body);
  return { body, isError: rpc.result?.isError, answer: rpc.result ? JSON.parse(rpc.result.content[0].text) : rpc };
}

test("upload_media { image } from a stale client gets the retirement answer, which never echoes the bytes", async () => {
  const payload = PNG.toString("base64");
  const { body, isError, answer } = await mcpCall("upload_media", { image: payload });
  assert.equal(isError, true);
  assert.equal(answer.defect, "the media door no longer takes inline base64", `POS-818 part 1: the retired field answers for itself, not "${answer.defect}"`);
  assert.equal(answer.defect, RETIRED_IMAGE?.defect, "in the one sentence media.mjs keeps for it");
  assert.match(answer.hint, /stale/, "it says why the client still offers it");
  assert.match(answer.hint, /reconnect/, "and what fixes that");
  assert.ok(answer.hint.includes("image_path") && answer.hint.includes("image_url"), "and the live ways in");
  assert.equal(body.includes(payload.slice(0, 40)), false, "the answer carries none of the caller's base64");
});

test("every other unknown upload_media argument still meets the unknown-argument check", async () => {
  const junk = await mcpCall("upload_media", { image_url: "https://example.com/x.png", junk: 1 });
  assert.match(junk.answer.defect, /unknown argument "junk" for upload_media/, "the generic check is not weakened");
  const near = await mcpCall("upload_media", { images: "AAAA" });
  assert.match(near.answer.defect, /unknown argument "images" for upload_media/, "only the one retired name is special");
});

// ── the office's own route: POST /media sends an image/* body to the raw door ─
//
// The office itself (src/server.mjs) on an ephemeral 127.0.0.1 port, with the
// suite's synthetic fixture town, three invented static keys, no town clone and
// NO STORAGE CREDENTIALS, so the media door answers "not yet open" once a call
// has passed every gate in front of storage. That answer is the receipt that
// the raw body reached uploadMedia; nothing is ever stored.

describe("the spawned office's POST /media", () => {
  const OFFICE_KEYS = "pos818-two=pos818pairs:tess,tom;pos818-other=pos818others:ollie;pos818-solo=pos818solo:sol";
  let child, OFFICE, tmp, ix;
  before(async () => {
    tmp = tempDir("postmark-office-pos818-");
    ix = await indexStore(fixtureTown(), { db: "pos818_raw_media" });
    const oauthPath = seedStaticKeys(join(tmp, "oauth.db"), OFFICE_KEYS);
    ({ child, port: OFFICE } = await bootOnFreePort((port) => spawn(process.execPath,
      [join(ROOT, "src", "server.mjs"), "--port", String(port), "--oauth-db", oauthPath], {
        env: {
          PATH: process.env.PATH, HOME: tmp, WORLD_GRAPH_NONE: "1", ...ix.env,
          TOWN_CLONE: join(tmp, "no-town-clone"), TOWN_PUSH: "",
          PUBLIC_BASE: `http://127.0.0.1:${port}`,
          POSTMARK_OAUTH_GITHUB_CLIENT_ID: "pos818-mock-app", POSTMARK_OAUTH_GITHUB_CLIENT_SECRET: "pos818-mock-secret",
          GITHUB_AUTH_URL: "http://127.0.0.1:9/never", GITHUB_TOKEN_URL: "http://127.0.0.1:9/never", GITHUB_API_URL: "http://127.0.0.1:9",
        },
        stdio: ["ignore", "pipe", "pipe"],
      })));
  });
  after(async () => {
    if (child && child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
    await ix?.stop();
  });
  const office = (opts) => rawRequest({ ...opts, port: OFFICE });
  const json = (r) => { try { return JSON.parse(r.text); } catch { return {}; } };

  test("no key is a 401 before the body is read", async () => {
    // The write tier refuses a keyless call before any POST route runs
    // (server.mjs § write tier), so the raw door inherits the household-key
    // law rather than restating it; the route's own 401 line stands behind it.
    const r = await office({ head: headFor({ key: null, length: PNG.length }) }); // the body is never sent
    assert.equal(r.status, 401, `got ${r.status} (${r.text.slice(0, 160)})`);
    assert.match(json(r).defect, /no key at the door|an upload needs a key/);
  });

  test("the length rule holds at the office: a chunked body is a 411 and a declared oversize length a 413, both unread", async () => {
    const chunked = await office({ head: headFor({ key: "pos818-two", chunked: true }) });
    assert.equal(chunked.status, 411, `LAW /a: got ${chunked.status} (${chunked.text.slice(0, 160)})`);
    const over = await office({ head: headFor({ key: "pos818-two", length: MAX_IMAGE + 1 }) });
    assert.equal(over.status, 413, `LAW /a: got ${over.status} (${over.text.slice(0, 160)})`);
    assert.match(json(over).defect, /larger than 1\.5 MB/);
  });

  test("an image/* body reaches the media door's own gates: by, then the not-yet-open answer", async () => {
    const two = await office({ head: headFor({ key: "pos818-two", length: PNG.length }), body: PNG });
    assert.equal(two.status, 422, `LAW /b: a household of two must name its uploader; got ${two.status} (${two.text.slice(0, 160)})`);
    assert.match(json(two).defect, /which resident uploads this/);
    const stranger = await office({ head: headFor({ path: "/media?by=ollie", key: "pos818-two", length: PNG.length }), body: PNG });
    assert.equal(stranger.status, 403, `LAW /b: got ${stranger.status} (${stranger.text.slice(0, 160)})`);
    const solo = await office({ head: headFor({ key: "pos818-solo", length: PNG.length }), body: PNG });
    assert.equal(solo.status, 409, `a sole resident passes every gate up to storage; got ${solo.status} (${solo.text.slice(0, 160)})`);
    assert.match(json(solo).defect, /the media door is not yet open/);
  });

  test("CONTROL: the JSON door answers exactly as before", async () => {
    const body = Buffer.from(JSON.stringify({ image_url: "https://example.com/x.png" }));
    const viaJson = await office({ head: headFor({ key: "pos818-solo", type: "application/json", length: body.length }), body });
    assert.equal(viaJson.status, 409, `got ${viaJson.status} (${viaJson.text.slice(0, 160)})`);
    assert.match(json(viaJson).defect, /the media door is not yet open/);
    const legacy = Buffer.from(JSON.stringify({ image: "AAAA" }));
    const old = await office({ head: headFor({ key: "pos818-solo", type: "application/json", length: legacy.length }), body: legacy });
    assert.equal(old.status, 422);
    assert.match(json(old).defect, /upload_media does not take: image/, "the REST JSON door keeps its own unknown-field answer");
  });
});
