import test from "node:test";
import assert from "node:assert/strict";

import { handleOauth } from "../src/oauth.mjs";

function responseRecorder() {
  return {
    headersSent: false,
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(chunk = "") {
      this.body += String(chunk ?? "");
    },
  };
}

test("#2766 an unexpected OAuth failure renders a small HTML page instead of rejecting to the JSON outer catch", async () => {
  const req = {
    method: "GET",
    url: "/oauth/github/callback?state=broken-fixture",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  };
  const res = responseRecorder();
  const ctx = {
    // The callback reads its pending row first. This deliberately makes that
    // read fail, which is the class #2766 exposed: an exception outside the
    // callback's deliberate HTML branches.
    odb: { prepare() { throw new Error("fixture-only internal failure"); } },
    db: null,
    clone: "",
  };

  const rejected = await handleOauth(req, res, ctx).then(() => null, (error) => error);

  assert.equal(rejected, null,
    "a browser-facing OAuth failure must be answered here, not rejected to server.mjs's JSON bounce");
  assert.equal(res.status, 500);
  assert.match(String(res.headers?.["content-type"] ?? ""), /^text\/html\b/i);
  assert.match(res.body, /office tripped/i);
  assert.match(res.body, /nothing was authorized/i);
  assert.doesNotMatch(res.body, /fixture-only internal failure/i,
    "the human page must not leak the internal exception text");
});

// THE OTHER HALF OF THE ISSUE'S FALSIFIER: "the same error on an API path still
// answers the JSON bounce". `handleOauth` also serves the three
// `/.well-known/...` discovery routes, and those are probed and PARSED by MCP
// clients, not read by a human. Without a path/Accept test the browser page
// would be served to a parser.
//
// Discovery reads no record since POS-480 (the sweep runs after the answer,
// never ahead of the route), so a failing store no longer reaches it. The
// failure here is the route's first internal act instead: taking its paper.
const failingCtx = () => ({
  get odb() { throw new Error("fixture-only internal failure"); },
  db: null,
  clone: "",
});

test("#2766 the same failure on a machine-facing discovery route still rejects to the JSON bounce", async () => {
  const ctx = failingCtx();

  for (const url of [
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource/api/mcp",
    "/.well-known/openid-configuration",
  ]) {
    const res = responseRecorder();
    const req = { method: "GET", url, headers: { accept: "application/json" }, socket: { remoteAddress: "127.0.0.1" } };
    const rejected = await handleOauth(req, res, ctx).then(() => null, (error) => error);

    assert.notEqual(rejected, null,
      `${url} is parsed by a client, not read by a human — it must reach server.mjs's JSON bounce`);
    assert.equal(res.headersSent, false,
      `${url} must not have been answered here at all`);
  }
});

// ...and a human who types a discovery URL into the address bar is still a human.
// The Accept header is the only thing that separates them on these paths, which is
// exactly the disjunction the issue spells: path starts with /oauth, OR Accept
// prefers text/html.
test("#2766 a browser on a discovery route is still answered as HTML", async () => {
  const res = responseRecorder();
  const req = {
    method: "GET",
    url: "/.well-known/oauth-authorization-server",
    headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    socket: { remoteAddress: "127.0.0.1" },
  };
  const ctx = failingCtx();

  const rejected = await handleOauth(req, res, ctx).then(() => null, (error) => error);

  assert.equal(rejected, null);
  assert.equal(res.status, 500);
  assert.match(String(res.headers?.["content-type"] ?? ""), /^text\/html\b/i);
  assert.match(res.body, /office tripped/i);
});

// THE TOKEN ENDPOINT AND REGISTRATION ARE A CLIENT'S (POS-480, review of #449
// finding 6). Both live under /oauth, but a connector calls and parses them:
// a failure there must reach the JSON bounce, never the human's HTML page, even
// when the client's Accept would let a browser through.
test("#2766 a failure at /oauth/token or /oauth/register rejects to the JSON bounce: a client parses those", async () => {
  for (const url of ["/oauth/token", "/oauth/register"]) {
    for (const accept of ["application/json", "text/html,*/*"]) {
      const res = responseRecorder();
      const req = { method: "POST", url, headers: { accept }, socket: { remoteAddress: "127.0.0.1" } };
      const rejected = await handleOauth(req, res, failingCtx()).then(() => null, (error) => error);
      assert.notEqual(rejected, null, `${url} (Accept: ${accept}) is a client's door: it must reach server.mjs's JSON bounce`);
      assert.equal(res.headersSent, false, `${url} must not have been answered here at all`);
    }
  }
});
