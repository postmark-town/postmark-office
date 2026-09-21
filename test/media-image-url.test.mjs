// media-image-url.test.mjs — the media door fetches, so the resident's model
// does not have to spell the file out (2026-09-10). The door opened with
// `image` (base64) alone, which makes the RESIDENT'S OWN MODEL emit the whole
// encoded file as output tokens; a resident said so out loud ("it takes
// forever") and the founder called it a liability needing a hotfix.
//
//   node --test test/media-image-url.test.mjs
//
// WHAT THIS FILE IS FOR, in one line: proving the new way IN did not become a
// way AROUND. Every test here either shows the URL lane landing in the SAME
// place base64 lands (same bytes ⇒ same URL, one quota charge), or shows a wall
// standing — SSRF, size, redirects. Nothing here touches the network: fetch,
// DNS and the R2 put are all injected, so every falsifier can actually fail, on
// any machine, offline. A falsifier that needs the internet to fail is not one.
//
// The path lane (`image_path`) is proven in test/media-image-path.test.mjs.
//
// Env is pinned BEFORE the dynamic import: media.mjs reads its dials at load.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

process.env.R2_ACCOUNT_ID = "test-account";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";
process.env.MEDIA_QUOTA_BYTES = String(1024 * 1024); // roomy: this file is about the lane, not the wall

const { uploadMedia, fetchImageBytes, guardFetchUrl, mediaSourceOf, MEDIA_BASE } = await import("../src/media.mjs");
const { MAX_IMAGE } = await import("../src/edit.mjs");

// the same 1×1 transparent PNG media.test.mjs uses — 70 bytes, real magic + IEND
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG = Buffer.from(PNG_B64, "base64");

const key = (over = {}) => ({ household: "testers", handles: new Set(["tester"]), ...over });
const odb = () => new DatabaseSync(":memory:");
const stubPut = () => { const calls = []; return { calls, put: async (...a) => { calls.push(a); } }; };
// The PUTs of ORIGINALS. Since postmark#2940 a raster upload also puts its two
// small copies (-96, -256) beside the original — held to account in
// test/media-thumbnails.test.mjs; the counts here are about the original.
const originals = (calls) => calls.filter(([k]) => !/-(?:96|256)\.[a-z]+$/.test(k));

// A DNS that answers whatever the test says, so the wall is provable offline.
const dnsSaying = (map) => async (host) => {
  const a = map[host];
  if (!a) throw new Error(`ENOTFOUND ${host}`);
  return (Array.isArray(a) ? a : [a]).map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
};
const PUBLIC_DNS = dnsSaying({ "cdn.example.com": "93.184.216.34" });

// A fetch that answers from a script of responses keyed by URL.
const fetchSaying = (script) => {
  const seen = [];
  return {
    seen,
    fetchImpl: async (url) => {
      seen.push(url);
      const r = script[url];
      if (!r) throw new Error(`no scripted response for ${url}`);
      return r;
    },
  };
};
const bodyOf = (buf) => {
  let sent = false;
  return { getReader: () => ({ read: async () => (sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(buf) })), cancel: async () => {} }) };
};
const ok200 = (buf, headers = {}) => ({
  status: 200, ok: true,
  headers: new Headers({ "content-length": String(buf.length), ...headers }),
  body: bodyOf(buf),
});
const redirectTo = (loc) => ({ status: 302, ok: false, headers: new Headers({ location: loc }), body: null });

// ── the whole point: the new lane lands exactly where the old one lands ──────

// Was "URL ≡ base64" until POS-150 retired the base64 lane. The equivalence it
// proved was never really about base64 — it was that the address is content-
// addressed and the quota charges the FILE, not the door. Two different URLs
// answering the same bytes prove exactly that, and they prove it against a
// lane that still exists.
test("two URLs, the same bytes: one address, one charge", async () => {
  const db = odb();
  const { calls, put } = stubPut();
  const url = "https://cdn.example.com/photo.png";
  const mirror = "https://cdn.example.com/copy.png"; // same host: the stub DNS knows one name, and the point is the BYTES
  const { fetchImpl } = fetchSaying({ [url]: ok200(PNG), [mirror]: ok200(PNG) });

  const viaUrl = await uploadMedia({ image_url: url }, key(), db, { put, fetchImpl, lookup: PUBLIC_DNS });
  assert.match(viaUrl.url, new RegExp(`^${MEDIA_BASE.replace(/[/.]/g, "\\$&")}/media/testers/[0-9a-f]{64}\\.png$`));
  assert.equal(viaUrl.bytes, 70);
  assert.equal(viaUrl.type, "image/png");
  assert.equal(viaUrl.via, "image_url", "the receipt names which lane the bytes walked");
  assert.equal(viaUrl.quota.used, 70);
  assert.equal(originals(calls).length, 1, "one object written");

  const viaMirror = await uploadMedia({ image_url: mirror }, key(), db, { put, fetchImpl, lookup: PUBLIC_DNS });
  assert.equal(viaMirror.url, viaUrl.url, "content-addressed: which URL the bytes were fetched from cannot change the address");
  assert.equal(viaMirror.already, true);
  assert.equal(viaMirror.quota.used, 70, "one charge for one file, however it arrived");
  assert.equal(originals(calls).length, 1, "and storage was written exactly once");
});

// ── the SSRF wall ───────────────────────────────────────────────────────────

test("the wall: loopback, private, CGNAT and link-local addresses are refused before any fetch", async () => {
  const cases = [
    ["localhost", "127.0.0.1"],
    ["metadata.example", "169.254.169.254"],
    ["inside.example", "10.1.2.3"],
    ["inside2.example", "172.20.0.5"],
    ["inside3.example", "192.168.1.1"],
    ["cgnat.example", "100.64.0.1"],
    ["v6loop.example", "::1"],
    ["v6ula.example", "fd00::1"],
    ["v6ll.example", "fe80::1"],
    ["mapped.example", "::ffff:127.0.0.1"],
  ];
  for (const [host, addr] of cases) {
    const { fetchImpl, seen } = fetchSaying({});
    await assert.rejects(
      fetchImageBytes(`https://${host}/x.png`, { fetchImpl, lookup: dnsSaying({ [host]: addr }) }),
      (e) => e.code === 403 && e.defect.includes(addr),
      `${host} → ${addr} must be refused`);
    assert.equal(seen.length, 0, `${addr}: nothing reached the network`);
  }
});

// ── the IPv6 spellings, which the first cut of this wall let straight through ─
//
// `parseInt("::ffff:7f00:1".split(":")[0] || "0", 16)` is 0, and 0 passed every
// range test — so a LITERAL in the URL walked in, with no race and no attacker
// DNS. The reviewer's round proved it on the real code (2026-09-10). These
// three cases use the REAL resolver on purpose: `dns.lookup` of a literal is a
// parse, not a network call, so the falsifier stays offline while exercising
// the exact path the bypass used — including the WHATWG URL parser rewriting
// the dotted spelling into the hex one before the wall ever sees it.

test("the wall: an IPv4 address wearing an IPv6 coat is refused in EVERY spelling", async () => {
  for (const url of [
    "https://[::ffff:127.0.0.1]/x.png",      // v4-mapped, dotted — the parser rewrites this to hex
    "https://[0:0:0:0:0:ffff:7f00:1]/x.png", // v4-mapped, uncompressed hex
    "https://[::ffff:7f00:1]/x.png",         // v4-mapped, compressed hex
    "https://[::ffff:10.0.0.1]/x.png",       // v4-mapped, private rather than loopback
    "https://[::127.0.0.1]/x.png",           // v4-COMPAT, the deprecated cousin
    "https://[2002:7f00:1::]/x.png",         // 6to4 carrying 127.0.0.1
    "https://[2002:a00:1::]/x.png",          // 6to4 carrying 10.0.0.1
    "https://[64:ff9b::7f00:1]/x.png",       // NAT64 carrying 127.0.0.1
    "https://[::1]/x.png",
    "https://[::]/x.png",
    "https://[fd00::1]/x.png",
    "https://[fe80::1]/x.png",
    "https://[ff02::1]/x.png",
  ]) {
    const seen = [];
    // permissive: if the wall lets this through, the fetch SUCCEEDS and the
    // rejection never happens — so this test can actually fail.
    const fetchImpl = async (u) => { seen.push(u); return ok200(PNG); };
    await assert.rejects(fetchImageBytes(url, { fetchImpl }), (e) => e.code === 403, url);
    assert.equal(seen.length, 0, `${url}: nothing reached the network`);
  }
});

test("the wall: a hostname whose AAAA is a mapped loopback is refused by name", async () => {
  const seen = [];
  const fetchImpl = async (u) => { seen.push(u); return ok200(PNG); };
  await assert.rejects(
    fetchImageBytes("https://sneaky.example/x.png", { fetchImpl, lookup: dnsSaying({ "sneaky.example": "::ffff:7f00:1" }) }),
    (e) => e.code === 403 && /7f00/.test(e.defect));
  assert.equal(seen.length, 0);
});

// The control that keeps the fix from being "refuse all IPv6": a wall that
// refuses the whole public internet is not a wall, it is an outage. This is
// also the test that goes red if `hextets` is ever made to fail closed on
// everything.
test("the wall does not refuse the public internet: a v6-only host is fetched", async () => {
  const url = "https://v6.example.com/photo.png";
  const { fetchImpl } = fetchSaying({ [url]: ok200(PNG) });
  const b = await fetchImageBytes(url, { fetchImpl, lookup: dnsSaying({ "v6.example.com": "2606:4700::6810:85e5" }) });
  assert.equal(b.length, 70);
});

test("the wall: one private address among several is enough to refuse", async () => {
  const { fetchImpl, seen } = fetchSaying({});
  await assert.rejects(
    fetchImageBytes("https://split.example/x.png", { fetchImpl, lookup: dnsSaying({ "split.example": ["93.184.216.34", "127.0.0.1"] }) }),
    (e) => e.code === 403);
  assert.equal(seen.length, 0);
});

test("the wall: only https, only port 443, never a URL carrying credentials", async () => {
  const { fetchImpl, seen } = fetchSaying({});
  const opts = { fetchImpl, lookup: PUBLIC_DNS };
  await assert.rejects(fetchImageBytes("http://cdn.example.com/x.png", opts), (e) => e.code === 422 && /https only/.test(e.defect));
  await assert.rejects(fetchImageBytes("file:///etc/passwd", opts), (e) => e.code === 422 && /https only/.test(e.defect));
  await assert.rejects(fetchImageBytes("ftp://cdn.example.com/x.png", opts), (e) => e.code === 422 && /https only/.test(e.defect));
  await assert.rejects(fetchImageBytes("data:image/png;base64,AAAA", opts), (e) => e.code === 422);
  await assert.rejects(fetchImageBytes("https://cdn.example.com:5432/x.png", opts), (e) => e.code === 422 && /port 443 only/.test(e.defect));
  await assert.rejects(fetchImageBytes("https://user:pw@cdn.example.com/x.png", opts), (e) => e.code === 422 && /credentials/.test(e.defect));
  await assert.rejects(fetchImageBytes("not a url at all", opts), (e) => e.code === 422);
  assert.equal(seen.length, 0, "not one of these reached the network");
});

test("the wall walks every redirect hop: a public host that 302s to loopback is refused there", async () => {
  const first = "https://cdn.example.com/photo.png";
  const { fetchImpl, seen } = fetchSaying({ [first]: redirectTo("https://localhost/secret.png") });
  await assert.rejects(
    fetchImageBytes(first, { fetchImpl, lookup: dnsSaying({ "cdn.example.com": "93.184.216.34", localhost: "127.0.0.1" }) }),
    (e) => e.code === 403 && /127\.0\.0\.1/.test(e.defect));
  assert.deepEqual(seen, [first], "the office asked the public host and stopped at the hop");
});

// ── the size wall, and the redirect ceiling ─────────────────────────────────

test("oversize is refused on the DECLARED length, before the body is read", async () => {
  const url = "https://cdn.example.com/huge.png";
  let readCalled = false;
  const resp = {
    status: 200, ok: true,
    headers: new Headers({ "content-length": String(MAX_IMAGE + 1) }),
    body: { getReader: () => ({ read: async () => { readCalled = true; return { done: true }; }, cancel: async () => {} }) },
  };
  const { fetchImpl } = fetchSaying({ [url]: resp });
  await assert.rejects(fetchImageBytes(url, { fetchImpl, lookup: PUBLIC_DNS }),
    (e) => e.code === 413 && /larger than/.test(e.defect));
  assert.equal(readCalled, false, "the office never began reading the body");
});

test("a lying Content-Length does not get past: the stream is capped as it arrives", async () => {
  const url = "https://cdn.example.com/liar.png";
  const chunk = Buffer.alloc(256 * 1024, 7);
  let cancelled = false, chunks = 0;
  const resp = {
    status: 200, ok: true,
    headers: new Headers({ "content-length": "70" }), // the sender's claim, and a lie
    body: { getReader: () => ({
      read: async () => { chunks++; return { done: false, value: new Uint8Array(chunk) }; },
      cancel: async () => { cancelled = true; },
    }) },
  };
  const { fetchImpl } = fetchSaying({ [url]: resp });
  await assert.rejects(fetchImageBytes(url, { fetchImpl, lookup: PUBLIC_DNS }), (e) => e.code === 413);
  assert.ok(cancelled, "the office hung up rather than reading on");
  assert.ok(chunks <= Math.ceil(MAX_IMAGE / chunk.length) + 1, `it stopped near the ceiling, not at the end (${chunks} chunks)`);
});

test("redirects: a chain of three lands, a chain of four is refused", async () => {
  const mk = (n) => `https://cdn.example.com/hop${n}.png`;
  const three = fetchSaying({
    [mk(0)]: redirectTo(mk(1)), [mk(1)]: redirectTo(mk(2)), [mk(2)]: redirectTo(mk(3)), [mk(3)]: ok200(PNG),
  });
  const landed = await fetchImageBytes(mk(0), { fetchImpl: three.fetchImpl, lookup: PUBLIC_DNS });
  assert.equal(landed.length, 70);
  assert.equal(three.seen.length, 4, "three redirects followed, the fourth request is the file");

  const four = fetchSaying({
    [mk(0)]: redirectTo(mk(1)), [mk(1)]: redirectTo(mk(2)), [mk(2)]: redirectTo(mk(3)),
    [mk(3)]: redirectTo(mk(4)), [mk(4)]: ok200(PNG),
  });
  await assert.rejects(fetchImageBytes(mk(0), { fetchImpl: four.fetchImpl, lookup: PUBLIC_DNS }),
    (e) => e.code === 422 && /redirects more than 3/.test(e.defect));
  assert.equal(four.seen.length, 4, "it refused at the fourth hop rather than following it");
});

test("a relative Location is resolved against the hop it came from", async () => {
  const first = "https://cdn.example.com/a/photo.png";
  const { fetchImpl, seen } = fetchSaying({
    [first]: redirectTo("../b/real.png"),
    "https://cdn.example.com/b/real.png": ok200(PNG),
  });
  const b = await fetchImageBytes(first, { fetchImpl, lookup: PUBLIC_DNS });
  assert.equal(b.length, 70);
  assert.equal(seen[1], "https://cdn.example.com/b/real.png");
});

test("a host that never answers is a 504, not a hang", async () => {
  const fetchImpl = (url, { signal }) => new Promise((_, no) => {
    signal.addEventListener("abort", () => no(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  await assert.rejects(
    fetchImageBytes("https://cdn.example.com/slow.png", { fetchImpl, lookup: PUBLIC_DNS, timeoutMs: 40 }),
    (e) => e.code === 504 && /did not answer/.test(e.defect));
});

test("a 404 at the far end is the resident's bounce, not a 500", async () => {
  const url = "https://cdn.example.com/gone.png";
  const { fetchImpl } = fetchSaying({ [url]: { status: 404, ok: false, headers: new Headers({}), body: null } });
  await assert.rejects(fetchImageBytes(url, { fetchImpl, lookup: PUBLIC_DNS }),
    (e) => e.code === 422 && /answered 404/.test(e.defect));
});

test("bytes are still the law on the URL lane: an HTML page fetched as an image bounces before storage", async () => {
  const url = "https://cdn.example.com/notanimage";
  const html = Buffer.from("<!doctype html><title>hello</title>");
  const { fetchImpl } = fetchSaying({ [url]: ok200(html) });
  const { calls, put } = stubPut();
  await assert.rejects(uploadMedia({ image_url: url }, key(), odb(), { put, fetchImpl, lookup: PUBLIC_DNS }),
    (e) => e.code === 422 && /JPEG, PNG, WebP, or SVG/.test(e.defect));
  assert.equal(calls.length, 0, "nothing reached storage");
});

// ── one image per call, and the bounce that teaches the order ───────────────

test("exactly one input, the empty call names the lanes cheapest-first, and base64 is gone by name", () => {
  assert.equal(mediaSourceOf({ image_url: "https://x/y.png" }), "image_url");
  assert.equal(mediaSourceOf({ image_url: "https://x/y.png", image: "" }), "image_url", "an empty string is not an input");

  assert.throws(() => mediaSourceOf({ image_path: "HOME/a.png", image_url: "https://x/y.png" }),
    (e) => e.code === 422 && /send one image, not 2/.test(e.defect));

  // POS-150. `image` is not an input any more, and the refusal for one says so
  // rather than pretending no image was sent.
  const legacy = (() => { try { mediaSourceOf({ image: PNG_B64 }); return null; } catch (e) { return e; } })();
  assert.equal(legacy.code, 422);
  assert.match(legacy.defect, /no longer takes inline base64/);
  assert.ok(legacy.hint.includes("image_path") && legacy.hint.includes("image_url"),
    "one sentence, both doors that work");

  const empty = (() => { try { mediaSourceOf({}); return null; } catch (e) { return e; } })();
  assert.equal(empty.code, 422);
  assert.ok(empty.hint.indexOf("image_path") < empty.hint.indexOf("image_url"), "the hint teaches the cheapest lane first");
  assert.doesNotMatch(empty.hint, /base64/, "the empty call no longer advertises a door that is closed");
});

test("the gates still stand in front of the URL lane", async () => {
  const url = "https://cdn.example.com/photo.png";
  const { fetchImpl } = fetchSaying({ [url]: ok200(PNG) });
  await assert.rejects(uploadMedia({ image_url: url }, null, odb(), { fetchImpl, lookup: PUBLIC_DNS }), (e) => e.code === 401);
  await assert.rejects(
    uploadMedia({ image_url: url }, { berth: true, slug: "wanderer" }, odb(), { fetchImpl, lookup: PUBLIC_DNS }),
    (e) => e.code === 403 && /berth/.test(e.defect));
  await assert.rejects(
    uploadMedia({ image_url: url, by: "someone-else" }, key(), odb(), { fetchImpl, lookup: PUBLIC_DNS }),
    (e) => e.code === 403 && /not one of your residents/.test(e.defect));
});

test("the wall's own shape: guardFetchUrl hands back the parsed URL when it passes", async () => {
  const u = await guardFetchUrl("https://cdn.example.com/a/b.png?v=2#frag", { lookup: PUBLIC_DNS });
  assert.equal(u.hostname, "cdn.example.com");
  assert.equal(u.pathname, "/a/b.png");
  assert.equal(u.search, "?v=2", "a query string is the host's business — this is not the mark door's allowlist");
});
