// openai-apps-challenge.test.mjs — the ChatGPT app directory's domain check (POS-749).
//
// OpenAI reads https://postmark.town/.well-known/openai-apps-challenge and wants the
// exact token back as plain text. The token comes from the box (an env value or a
// file), never from code, and the door answers 404 until it is set. This drives the
// office over HTTP: the file lands while the office runs and is served with no restart.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/openai-apps-challenge.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureTown } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";
import { challengeToken, CHALLENGE_PATH, TOKEN_MAX } from "../src/openai-apps-challenge.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let child, tmp, BASE, ix, TOKEN_FILE;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-office-apps-challenge-"));
  TOKEN_FILE = join(tmp, "openai-apps-challenge"); // not written yet: the door starts unset
  ix = await indexStore(fixtureTown());
  let port;
  ({ child, port } = await bootOnFreePort((p) => spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(p),
    "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db")], {
    env: { ...process.env, WORLD_GRAPH_NONE: "1", TOWN_CLONE: join(tmp, "no-clone-here"), WORLD_CLONE: join(tmp, "no-world-clone"),
      VOICES_LOG: join(tmp, "voices.jsonl"), TOWN_PUSH: "", WORLD_STORE_DB: join(tmp, "no-world.db"),
      ...ix.env, OFFICE_READ_WORKERS: "0", OPENAI_APPS_CHALLENGE: "", OPENAI_APPS_CHALLENGE_FILE: TOKEN_FILE },
    stdio: ["ignore", "pipe", "pipe"],
  })));
  BASE = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((ok) => child.on("exit", ok));
    child.kill();
    await gone;
  }
  await ix?.stop();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("the token: the env value wins, then the file; whitespace trimmed; unset, empty or unreadable is none", () => {
  const files = { "/t": "  file-token\n" };
  const read = (p) => { if (!(p in files)) throw new Error("ENOENT"); return files[p]; };
  assert.equal(challengeToken({}, read), null);
  assert.equal(challengeToken({ OPENAI_APPS_CHALLENGE: "  " }, read), null);
  assert.equal(challengeToken({ OPENAI_APPS_CHALLENGE_FILE: "/missing" }, read), null);
  assert.equal(challengeToken({ OPENAI_APPS_CHALLENGE_FILE: "/t" }, read), "file-token");
  assert.equal(challengeToken({ OPENAI_APPS_CHALLENGE: "env-token\n", OPENAI_APPS_CHALLENGE_FILE: "/t" }, read), "env-token");
  files["/t"] = "\n";
  assert.equal(challengeToken({ OPENAI_APPS_CHALLENGE_FILE: "/t" }, read), null, "an empty file is no token");
});

test("over HTTP: 404 while unset, then the bare token as text/plain once the file lands, with no restart", async () => {
  const before = await fetch(`${BASE}${CHALLENGE_PATH}`);
  assert.equal(before.status, 404, "unset answers 404");
  await before.text();

  const token = "oai-apps-challenge-0123456789abcdef";
  writeFileSync(TOKEN_FILE, `${token}\n`);
  const r = await fetch(`${BASE}${CHALLENGE_PATH}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /^text\/plain/);
  assert.equal(await r.text(), token, "exactly the token: no JSON, no newline");

  const head = await fetch(`${BASE}${CHALLENGE_PATH}`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(token.length));
});

// The review of office#724: this door answers anyone, so only a token may ever leave it.
test("only a token is served: a file past 512 bytes, or with whitespace inside, is refused as if unset", () => {
  const files = {};
  const read = (p) => files[p];
  const env = { OPENAI_APPS_CHALLENGE_FILE: "/f" };
  files["/f"] = "a".repeat(TOKEN_MAX);
  assert.equal(challengeToken(env, read), "a".repeat(TOKEN_MAX), "a token at the cap is served");
  files["/f"] = "a".repeat(TOKEN_MAX + 1);
  assert.equal(challengeToken(env, read), null, "one byte past the cap is not a token");
  files["/f"] = "OPENAI_APPS_CHALLENGE_FILE=/etc/x\nSTAMP_LINES=store\n";
  assert.equal(challengeToken(env, read), null, "an env file has whitespace inside it, so it is not a token");
  files["/f"] = "two words";
  assert.equal(challengeToken(env, read), null, "one space inside is enough");
  assert.equal(challengeToken({ OPENAI_APPS_CHALLENGE: "env value with spaces" }, read), null, "the env value is held to the same rule");
  assert.equal(challengeToken({ OPENAI_APPS_CHALLENGE: "x".repeat(TOKEN_MAX + 1) }, read), null, "and to the same cap");
});

test("over HTTP: an env-file-shaped file is never published; the door answers 404", async () => {
  const secretish = `PEN_TOKEN=ghp_not_a_real_secret_0123456789\nSTAMP_LINES=store\n${"#".repeat(600)}\n`;
  writeFileSync(TOKEN_FILE, secretish);
  const r = await fetch(`${BASE}${CHALLENGE_PATH}`);
  const body = await r.text();
  assert.equal(r.status, 404);
  assert.ok(!body.includes("PEN_TOKEN") && !body.includes("ghp_"), "nothing of the file reaches the answer");
});

test("nginx sends the exact path to the office, as it sends the oauth discovery", () => {
  const conf = readFileSync(join(ROOT, "deploy", "nginx-api.conf"), "utf8").replace(/#[^\n]*/g, "");
  const m = conf.match(/location\s*=\s*\/\.well-known\/openai-apps-challenge\s*\{([^}]*)\}/);
  assert.ok(m, "deploy/nginx-api.conf has no location for the challenge: postmark.town's root would 404 it from the site's webroot");
  assert.match(m[1], /proxy_pass\s+http:\/\/127\.0\.0\.1:4380;/, "the location reaches the office, path unstripped");
});
