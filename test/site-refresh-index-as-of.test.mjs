// site-refresh-index-as-of.test.mjs — POS-1034: the box's site refresh asks the office's index version, keys on it, and hands the pass's sample to the stamp.
//
// THE INSTANCE. The site builds its resident lists from the office's API, which reads the office's town index; the index can catch up while the town, site main,
// the tag and the world stand still (Meddy, 2026-11-13). The key ignored it, so the next tick said "nothing moved". deploy/site-refresh-selftest.sh drives the whole
// control flow on a POSIX box (flock, rsync) in its disposable harness: index-only advance builds, an unchanged one is quiet, the old key fails that case, a
// blip is not an input, and an advance mid-build converges inside the same budgets. THIS file runs anywhere node and bash do and holds the three small facts the
// harness leans on: `index_as_of()` run VERBATIM against a real local HTTP server, and where the version enters the key, the stamp's environment and the state.
//
//   node --test test/site-refresh-index-as-of.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const SCRIPT = readFileSync(new URL("../deploy/site-refresh.sh", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function fn(name) {
  const m = SCRIPT.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}\\n`, "m"));
  assert.ok(m, `deploy/site-refresh.sh no longer defines ${name}()`);
  return m[0];
}

// a local office: answers /residents with whatever the test hands it, and records what it was asked
const asked = [];
let reply = () => ({ status: 200, headers: {} });
const server = createServer((req, res) => {
  asked.push({ url: req.url, auth: req.headers.authorization ?? null, cookie: req.headers.cookie ?? null });
  const r = reply(req);
  res.writeHead(r.status, { "content-type": "application/json", ...r.headers });
  res.end("[]");
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
after(() => new Promise((ok) => server.close(ok)));
const API = `http://127.0.0.1:${server.address().port}`;

/** `index_as_of`, verbatim, under the script's own shell options (`set -Eeuo pipefail`), against `api`. Async: this process IS the office, and a blocked loop would answer nothing. */
function ask(api = API) {
  return new Promise((ok) => {
    const p = spawn("bash", ["-c", `set -Eeuo pipefail\nAPI=${JSON.stringify(api)}\n${fn("index_as_of")}\nout="$(index_as_of)"\nprintf '%s' "$out"`]);
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { err += d; });
    p.on("close", (status) => ok({ out, status, err }));
  });
}

test("the version is the office's own header, asked of the box door keylessly, and printed bare", async () => {
  asked.length = 0;
  reply = () => ({ status: 200, headers: { "x-postmark-town-index-as-of": "a".repeat(40) } });
  const r = await ask();
  assert.deepEqual([r.status, r.out], [0, "a".repeat(40)]);
  assert.equal(asked.length, 1, "one bounded request");
  assert.equal(asked[0].url, "/residents?limit=1", "the cheapest read of the very route the site's fetch walks");
  assert.deepEqual([asked[0].auth, asked[0].cookie], [null, null], "no credential rides it");
  // header names are case-insensitive on the wire; a proxy may fold them either way
  reply = () => ({ status: 200, headers: { "X-Postmark-Town-Index-As-Of": "Idx.7:b" } });
  assert.equal((await ask()).out, "Idx.7:b");
});

test("UNKNOWN prints nothing and never fails the run (under set -Eeuo pipefail): no header, a 503, an unreachable office, an unreadable value", async () => {
  for (const [what, r] of [
    ["no header", () => ({ status: 200, headers: {} })],
    ["a 503", () => ({ status: 503, headers: { "x-postmark-town-index-as-of": "b".repeat(40) } })],
    ["a value with spaces", () => ({ status: 200, headers: { "x-postmark-town-index-as-of": "two words" } })],
    ["a value over the stamper's bound", () => ({ status: 200, headers: { "x-postmark-town-index-as-of": "c".repeat(81) } })],
    ["a value with shell metacharacters", () => ({ status: 200, headers: { "x-postmark-town-index-as-of": "x;rm" } })],
  ]) {
    reply = r;
    const got = await ask();
    assert.deepEqual([got.status, got.out], [0, ""], what);
  }
  const closed = await ask("http://127.0.0.1:9");   // nothing listens: the connection is refused
  assert.deepEqual([closed.status, closed.out], [0, ""], "an unreachable office is unknown, not an outage");
});

test("where the version goes: into the key (kept while unreadable), the pass's own sample into the stamper's env, and the state", () => {
  const survey = fn("survey");
  assert.match(survey, /INDEX_AS_OF="\$\(index_as_of\)"/, "survey asks it");
  assert.match(survey, /\[ -z "\$INDEX_AS_OF" \] \|\| INDEX_KEYED="\$INDEX_AS_OF"/, "a read version becomes the keyed one; an unreadable one leaves it");
  assert.match(survey, /world:\$WORLD_TAGS\$\{INDEX_KEYED:\+ index:\$INDEX_KEYED\}"/, "the key carries it after the world tags, and nothing at all when none was ever read");
  const build = fn("build_once");
  const taken = build.indexOf('local index_seen="$INDEX_AS_OF"');
  assert.ok(taken > 0 && taken < build.indexOf("git -C \"$TOWN\" checkout"), "the pass takes its sample before anything in the pass runs");
  assert.match(build, /BUILD_CROSSING="\$crossing" \\\n\s+BUILD_TOWN_INDEX_AS_OF="\$index_seen" \\/, "the stamper is handed the pass's sample, beside the crossing");
  assert.equal(build.split("INDEX_AS_OF").length - 1, 2, "the pass reads INDEX_AS_OF once (the sample) and says it once (this count catches a later, newer read being stamped)");
  assert.match(build, /"index_as_of": "%s"[\s\S]*"\$index_seen"/, "and the state records the same sample, never a newer look");
});
