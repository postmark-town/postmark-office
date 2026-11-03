// arrival-source-cosign.test.mjs — the berth co-sign, approved through to a landed source (POS-770, review F-1).
//
// The berth co-sign is one of the two roads into declare-exec, and those two founded 49 of the 53
// houses since 10-15 (the review, from the public tools/households.json). Until this file nothing
// drove a co-sign APPROVE to a recorded source: removing `${fromCarrier()}` from the co-sign form
// stayed green in oauth.test.mjs, cosign-set-down and household-apex (59 of 59, the review's flip F3b),
// because the visitor-pass form was the only page any test read the carrier off.
//
// THE CHAIN, RUN WHOLE, ON A REAL OFFICE (the server), A REAL STORE AND A REAL GIT CLONE:
//   a berth boards and parks its declaration  →  the human opens the co-sign link  →  the page's own
//   inline script fills the form's hidden input from the browser's keep (run here, in a vm, on the page the
//   office actually served)  →  the human approves, and that input is POSTed  →  the office parks the tag
//   against the human's GitHub id and runs the declaration  →  declare-exec lands it as the new house's
//   private came_from.
// Take the carrier off the co-sign form and the script has nothing to fill, nothing is posted, nothing is
// parked and no row lands: this file reds by name. Every name and id below is INVENTED.
//
//   node --test test/arrival-source-cosign.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fixtureTown } from "./fixture.mjs";
import { indexStore, seedRegistry } from "./helpers/office-under-test.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs";
import { REGISTRY_PATH, PINS_PATH, serializeRegistry, serializePins } from "../src/residency.mjs";
import { FROM_KEY } from "../src/arrival-source.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let tmp, clone, ghServer, GH_PORT, child, BASE, IX;
let ghIdentity = { id: 999, login: "keeminlee" };

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-office-cosign-source-"));
  IX = await indexStore(fixtureTown());
  // A real git clone, as declare.test.mjs makes one: the two registers and a gangway, committed, so penCommit has something to commit onto.
  clone = join(tmp, "town-clone");
  mkdirSync(join(clone, "tools"), { recursive: true });
  mkdirSync(join(clone, "HARBOR", "berths"), { recursive: true });
  mkdirSync(join(clone, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(clone, REGISTRY_PATH), serializeRegistry({ schema_version: 1, households: {} }));
  writeFileSync(join(clone, PINS_PATH), serializePins({ wright: { login: "keeminlee", id: 999, pinned: "2026-07-05" } }));
  writeFileSync(join(clone, "HARBOR", "GANGWAY.md"), "---\nstate: open\nsince: 2026-08-06\nruled_by: founder\n---\n\n# The gangway\n");
  const git = (...a) => execFileSync("git", ["-C", clone, ...a], { encoding: "utf8" });
  git("init", "-q"); git("config", "core.autocrlf", "false"); git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  await seedRegistry(IX.store, { schema_version: 1, households: {} }, { wright: { login: "keeminlee", id: 999, pinned: "2026-07-05" } });

  // mock GitHub: authorize redirects straight back; token + user are canned
  ghServer = createServer((req, res) => {
    res.setHeader("connection", "close");
    const url = new URL(req.url, `http://127.0.0.1:${GH_PORT}`);
    if (url.pathname === "/login/oauth/authorize") {
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("code", "gh-mock-code");
      back.searchParams.set("state", url.searchParams.get("state"));
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === "/login/oauth/access_token") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ access_token: "gh-mock-token" }));
    }
    if (url.pathname === "/user") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(ghIdentity));
    }
    res.writeHead(404); res.end();
  });
  await new Promise((ok) => ghServer.listen(0, "127.0.0.1", ok));
  GH_PORT = ghServer.address().port;

  let PORT;
  ({ child, port: PORT } = await bootOnFreePort((port) => spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(port),
    "--oauth-db", seedStaticKeys(join(tmp, "oauth.db"), "statickey=keemin:wright")], {
    env: {
      ...process.env, WORLD_GRAPH_NONE: "1", ...IX.env,
      TOWN_CLONE: clone, TOWN_PUSH: "", TOWN_LOCK: join(tmp, "town.lock"),
      BOT_NAME: "Postmark Pen", BOT_EMAIL: "pen@test.invalid",
      PUBLIC_BASE: `http://127.0.0.1:${port}`,
      POSTMARK_OAUTH_GITHUB_CLIENT_ID: "mock-gh-app",
      POSTMARK_OAUTH_GITHUB_CLIENT_SECRET: "mock-gh-secret",
      GITHUB_AUTH_URL: `http://127.0.0.1:${GH_PORT}/login/oauth/authorize`,
      GITHUB_TOKEN_URL: `http://127.0.0.1:${GH_PORT}/login/oauth/access_token`,
      GITHUB_API_URL: `http://127.0.0.1:${GH_PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })));
  BASE = `http://127.0.0.1:${PORT}`;
});

after(async () => {
  ghServer?.close();
  if (child && child.exitCode === null) {
    const gone = new Promise((ok) => child.on("exit", ok));
    child.kill();
    await gone;
  }
  await IX?.stop();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A berth boards, parks its declaration, and the human (the mock GitHub's identity) opens the co-sign link: the consent page's HTML and its form. */
async function openCoSign(slug, household) {
  const boarded = await fetch(`${BASE}/berth`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug }) });
  assert.equal(boarded.status, 201, `a berth boards: ${await boarded.clone().text()}`);
  const { key } = await boarded.json();
  const begun = await fetch(`${BASE}/household`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ do: "begin", args: { household, card: "A first line about this house.\nA second line." } }),
  });
  assert.equal(begun.status, 200, `begin parks the declaration: ${await begun.clone().text()}`);
  const r1 = await fetch(`${BASE}/oauth/berth-cosign?slug=${slug}`, { redirect: "manual" });
  assert.equal(r1.status, 302, "the co-sign link sends the human to GitHub");
  const r2 = await fetch(r1.headers.get("location"), { redirect: "manual" });
  const r3 = await fetch(r2.headers.get("location"));
  const html = await r3.text();
  assert.equal(r3.status, 200);
  assert.match(html, /Co-sign this residency/, "this is the co-sign page, not the visitor pass");
  return {
    html,
    pending_id: /name="pending_id" value="([^"]+)"/.exec(html)[1],
    nonce: /name="nonce" value="([^"]+)"/.exec(html)[1],
  };
}

/**
 * What the browser would POST in the `from` input: the page's OWN inline script, taken from the HTML the office
 * served, run against a stubbed page whose localStorage holds `keep`. "" when the page has no carrier.
 */
function carriedBy(html, keep) {
  const at = html.indexOf("data-pm-from");
  if (at < 0) return "";
  const script = /<script>([\s\S]*?)<\/script>/.exec(html.slice(at))?.[1];
  if (!script) return "";
  const input = { value: "" };
  vm.runInNewContext(script, {
    localStorage: { getItem: (k) => (k === FROM_KEY && keep != null ? JSON.stringify(keep) : null) },
    document: { querySelector: (sel) => (sel === "[data-pm-from]" ? input : null) },
    Date, JSON, Number,
  });
  return input.value;
}

const approve = (page, from) => fetch(`${BASE}/oauth/consent`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ pending_id: page.pending_id, nonce: page.nonce, decision: "approve", from }),
});

async function sourceOf(household) {
  const owner = await IX.store.connect("world2_owner");
  try { return (await owner.query("SELECT tag FROM arrival_sources WHERE household = $1", [household])).rows; }
  finally { await owner.end(); }
}

test("F-1 · a co-sign approve lands the source: the page's own carrier fills the form, the approve parks it, the declaration lands it on the new house", async () => {
  ghIdentity = { id: 770101, login: "cosign-human-a" };
  const page = await openCoSign("cosign-willow", "Willow Cosign");
  assert.match(page.html, /<input type="hidden" name="from" value="" data-pm-from>/, "the carrier rides the co-sign form, empty until the keep fills it");
  const from = carriedBy(page.html, { tag: "reddit", at: Date.now() - 864e5 });
  assert.equal(from, "reddit", "the script on THIS page fills the input from a fresh listed keep");
  const done = await approve(page, from);
  const text = await done.text();
  assert.equal(done.status, 200, text.slice(0, 400));
  assert.match(text, /Co-signed/, "the co-sign ran the declaration");
  assert.deepEqual(await sourceOf("willow-cosign"), [{ tag: "reddit" }], "and the new house's private source is the tag the browser kept");
  assert.doesNotMatch(text, /reddit|came_from/, "the page that answers the approve never says it");
});

test("F-1 control · the same co-sign with no keep in the browser founds the house and records no source", async () => {
  ghIdentity = { id: 770102, login: "cosign-human-b" };
  const page = await openCoSign("cosign-alder", "Alder Cosign");
  const from = carriedBy(page.html, null);
  assert.equal(from, "", "no keep, nothing carried");
  const done = await approve(page, from);
  const text = await done.text();
  assert.equal(done.status, 200, text.slice(0, 400));
  assert.match(text, /Co-signed/, "the house is founded all the same");
  assert.deepEqual(await sourceOf("alder-cosign"), [], "no keep, no row");
});
