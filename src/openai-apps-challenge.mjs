// openai-apps-challenge.mjs — OpenAI's domain check for the ChatGPT app directory (POS-749).
//
// The portal hands out a token once the submission is started and checks that
//   https://postmark.town/.well-known/openai-apps-challenge
// answers it: the exact token as plain text, not JSON, not a list. The challenge
// base is an HTTPS origin on the MCP server's host or an allowed parent, and paths
// are ignored, so for https://postmark.town/api/mcp the check reads the root of
// postmark.town (OpenAI's "Submitting apps" help article, § Domain verification).
//
// postmark.town's root is the site's static webroot, which can't read anything at
// request time. So nginx sends this one path to the office, exactly as it sends
// /.well-known/oauth-* (deploy/nginx-api.conf), and the office answers here.
//
// THE TOKEN ARRIVES WITH NO CODE CHANGE. Either is enough:
//   OPENAI_APPS_CHALLENGE=<token>             in /etc/postmark-office.env (a restart picks it up)
//   OPENAI_APPS_CHALLENGE_FILE=<path>         a file on the box holding the token, read on
//                                             every request, so it can land or change later
//                                             with no restart
// The env value wins when both are set. Unset, empty or unreadable: 404, the same as
// any door the office doesn't have.
//
// ONLY A TOKEN IS EVER SERVED (the review of office#724). This door answers anyone,
// so a wrong path in OPENAI_APPS_CHALLENGE_FILE (the env file itself, say) must never
// publish that file. A token is one short word: at most TOKEN_MAX bytes are read, a
// longer file is refused unread past the cap, and anything with whitespace inside it
// after trimming is not a token. Either way the door answers 404, as if unset.

import { openSync, readSync, closeSync } from "node:fs";

export const CHALLENGE_PATH = "/.well-known/openai-apps-challenge";
export const TOKEN_MAX = 512;

/** At most TOKEN_MAX + 1 bytes of a file: one byte past the cap is enough to know it is too long. */
function readCapped(path) {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(TOKEN_MAX + 1);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString("utf8");
  } finally { closeSync(fd); }
}

/** A trimmed value that can only be a token: non-empty, within the cap, no whitespace inside. */
function asToken(raw) {
  const t = String(raw ?? "").trim();
  if (!t || Buffer.byteLength(t) > TOKEN_MAX || /\s/.test(t)) return null;
  return t;
}

/** The token to serve, or null when none is configured (or what is configured is not a token). */
export function challengeToken(env = process.env, read = readCapped) {
  const direct = String(env.OPENAI_APPS_CHALLENGE ?? "").trim();
  if (direct) return asToken(direct);
  const file = String(env.OPENAI_APPS_CHALLENGE_FILE ?? "").trim();
  if (!file) return null;
  let raw;
  try { raw = read(file); } catch { return null; }
  if (Buffer.byteLength(String(raw ?? "")) > TOKEN_MAX) return null;
  return asToken(raw);
}

/** Answer GET or HEAD on CHALLENGE_PATH: the bare token, or a 404 while none is set. */
export function serveChallenge(req, res, env = process.env, read) {
  const token = challengeToken(env, read);
  if (!token) {
    res.writeHead(404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    return res.end(JSON.stringify({ error: "bounce", code: 404, defect: "no such door", hint: "the ChatGPT app directory's challenge token is not set on this office" }));
  }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "content-length": Buffer.byteLength(token), "cache-control": "no-store" });
  return res.end(req.method === "HEAD" ? undefined : token);
}
