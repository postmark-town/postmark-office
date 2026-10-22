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

import { readFileSync } from "node:fs";

export const CHALLENGE_PATH = "/.well-known/openai-apps-challenge";

/** The token to serve, or null when none is configured. Whitespace around it is never part of it. */
export function challengeToken(env = process.env, read = (p) => readFileSync(p, "utf8")) {
  const direct = String(env.OPENAI_APPS_CHALLENGE ?? "").trim();
  if (direct) return direct;
  const file = String(env.OPENAI_APPS_CHALLENGE_FILE ?? "").trim();
  if (!file) return null;
  try {
    const t = read(file).trim();
    return t || null;
  } catch { return null; }
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
