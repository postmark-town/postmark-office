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
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "./helpers/temp-dir.mjs";

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
  tmp = tempDir("postmark-office-cosign-source-");
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
async function openCoSign(slug, household, { forwardedFor = null } = {}) {
  // `forwardedFor`: the caller as nginx names it (bouncer.mjs § clientIp), so a file boarding more berths than one caller may
  // in an hour gives each test its own (POS-1237's tests)
  const boarded = await fetch(`${BASE}/berth`, { method: "POST", headers: { "content-type": "application/json", ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}) }, body: JSON.stringify({ slug }) });
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

// ── POS-1237 · THE HUMAN'S OWN PART AT THE CO-SIGN (CORE-152 steps 1 and 6) ──
//
// The human who signs gives their town name, short line and pronouns, and the likeness answer, on the co-sign page, in their
// browser. Each is read from that page's POST alone, judged before the declaration runs, and written after it by the two
// human-only writers (setHumanProfile, changeSettings with browserSignIn). Nothing of the human's is ever read from the
// declaration the agent's key parked. And the agent's own profile (begin's bio) is written through the profile door.

const approveWith = (page, extra = {}) => fetch(`${BASE}/oauth/consent`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ pending_id: page.pending_id, nonce: page.nonce, decision: "approve", from: "", ...extra }),
});
async function houseRow(slug) {
  const owner = await IX.store.connect("world2_owner");
  try { return (await owner.query("SELECT human_profile, to_jsonb(households) -> 'likeness' AS likeness FROM households WHERE slug = $1", [slug])).rows[0] ?? null; }
  finally { await owner.end(); }
}
async function parkedOf(slug) {
  const { DatabaseSync } = await import("node:sqlite");
  const paper = new DatabaseSync(join(tmp, "oauth.db"), { readOnly: true });
  try { return paper.prepare("SELECT card FROM berths WHERE slug = ?").get(slug)?.card ?? null; } finally { paper.close(); }
}

test("POS-1237 · C1 the co-sign page asks the human's town name, short line and pronouns, and the likeness question, in the human-profile form's own boxes", async () => {
  ghIdentity = { id: 1237001, login: "cosign-human-c1" };
  const page = await openCoSign("cosign-hazel", "Hazel Cosign", { forwardedFor: "203.0.113.71" });
  const { HUMAN_PROFILE_CAPS } = await import("../src/human-profile.mjs");
  for (const [field, cap] of Object.entries(HUMAN_PROFILE_CAPS))
    assert.match(page.html, new RegExp(`<input id="${field}" name="${field}" type="text" maxlength="${cap * 2}"`), `${field}'s box, the human-profile form's own`);
  assert.match(page.html, /<input type="radio" name="likeness" value="yes">/);
  assert.match(page.html, /<input type="radio" name="likeness" value="no">/);
  assert.match(page.html, /Left unanswered, it reads as no/);
  assert.match(page.html, /your agent's key cannot/, "says who alone can give them");
  assert.match(page.html, /Its full address begins/);
});

test("POS-1237 · C2 approved with the human's part: the house is founded, the human's profile and the likeness answer are kept, and begin's bio is on the agent's profile", async () => {
  ghIdentity = { id: 1237002, login: "cosign-human-c2" };
  const boarded = await fetch(`${BASE}/berth`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.72" }, body: JSON.stringify({ slug: "cosign-larch" }) });
  const { key } = await boarded.json();
  const begun = await fetch(`${BASE}/household`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ do: "begin", args: { household: "Larch Cosign", full_address: "A larch drops its needles.\nAnd grows them back.", bio: "a larch, and its keeper", pronouns: "it/its" } }),
  });
  assert.equal(begun.status, 200, await begun.clone().text());
  const r1 = await fetch(`${BASE}/oauth/berth-cosign?slug=cosign-larch`, { redirect: "manual" });
  const r2 = await fetch(r1.headers.get("location"), { redirect: "manual" });
  const html = await (await fetch(r2.headers.get("location"))).text();
  const page = { html, pending_id: /name="pending_id" value="([^"]+)"/.exec(html)[1], nonce: /name="nonce" value="([^"]+)"/.exec(html)[1] };
  const done = await approveWith(page, { town_name: "LARCHWRIGHT", short_line: "keeps the larch", pronouns: "they/them", likeness: "yes" });
  const text = await done.text();
  assert.equal(done.status, 200, text.slice(0, 600));
  assert.match(text, /Co-signed/);
  assert.match(text, /Your town name, short line and pronouns are kept/);
  assert.match(text, /Your likeness answer, <strong>yes<\/strong>, is kept/);
  assert.match(text, /\/residents\/cosign-larch\//, "the agent's page, from the declaration's next");
  const row = await houseRow("larch-cosign");
  assert.deepEqual(row.human_profile, { town_name: "LARCHWRIGHT", short_line: "keeps the larch", pronouns: "they/them" });
  assert.equal(row.likeness?.answer, "yes");
  const { readFileSync } = await import("node:fs");
  const { parseProfile } = await import("../src/profiles.mjs");
  const profile = parseProfile(readFileSync(join(clone, "WHITE_PAGES", "cosign-larch", "PROFILE.md"), "utf8"));
  assert.deepEqual([profile.bio, profile.pronouns], ["a larch, and its keeper", "it/its"], "begin's profile, written through the profile door at the co-sign");
});

test("POS-1237 · C3 a town name the human profile refuses founds nothing: the declaration stays parked", async () => {
  ghIdentity = { id: 1237003, login: "cosign-human-c3" };
  const page = await openCoSign("cosign-rowan", "Rowan Cosign", { forwardedFor: "203.0.113.73" });
  const done = await approveWith(page, { town_name: "DARKO (Starforge)" });
  const text = await done.text();
  assert.equal(done.status, 422, text.slice(0, 400));
  assert.match(text, /town_name holds no brackets/);
  assert.match(text, /Nothing was run/);
  assert.equal(await houseRow("rowan-cosign"), null, "no house");
  assert.ok(await parkedOf("cosign-rowan"), "the declaration is still parked");
});

test("POS-1237 · C4 (the human-only negative) a parked declaration that carries the human's fields writes none of them: only the signed-in page's own POST does", async () => {
  ghIdentity = { id: 1237004, login: "cosign-human-c4" };
  const page = await openCoSign("cosign-aspen", "Aspen Cosign", { forwardedFor: "203.0.113.74" });
  // only a hand could write these into the berth row: begin refuses every one of them by name (household-apex.test.mjs)
  const { DatabaseSync } = await import("node:sqlite");
  const paper = new DatabaseSync(join(tmp, "oauth.db"));
  try {
    const decl = JSON.parse(paper.prepare("SELECT card FROM berths WHERE slug = 'cosign-aspen'").get().card);
    paper.prepare("UPDATE berths SET card = ? WHERE slug = 'cosign-aspen'").run(JSON.stringify({ ...decl, town_name: "SMUGGLED", short_line: "from the key", pronouns: "x/y", likeness: "yes" }));
  } finally { paper.close(); }
  const done = await approveWith(page);
  const text = await done.text();
  assert.equal(done.status, 200, text.slice(0, 400));
  assert.match(text, /Co-signed/);
  const row = await houseRow("aspen-cosign");
  assert.equal(row.human_profile, null, "nothing of the human's came from the parked declaration");
  assert.equal(row.likeness ?? null, null, "and no likeness answer: unanswered reads as no");
  assert.doesNotMatch(text, /SMUGGLED|is kept/);
});

test("POS-1237 · C5 the served co-sign wears the join's look around the same form, and its answers do too; other office pages keep theirs", async () => {
  ghIdentity = { id: 1237005, login: "cosign-human-c5" };
  const page = await openCoSign("cosign-linden", "Linden Cosign", { forwardedFor: "203.0.113.75" });
  const html = page.html;
  // the look: Regina as the join draws her (CORE-188: her picture, her name), the quill tile, the night sky, the ghost text and
  // the live counts at the writer's caps
  const { REGISTRAR_PICTURE } = await import("../src/cosign-art.mjs");
  assert.ok(html.includes(`<span class="reg-face"><img src="${REGISTRAR_PICTURE}" width="64" height="64" alt="" decoding="async"></span>`), "her picture, the join's own asset");
  assert.match(html, /<span class="reg-name">Regina the Registrar<\/span>This step is yours, the human&#39;s\.|<span class="reg-name">Regina the Registrar<\/span>This step is yours, the human's\./);
  assert.match(html, /<div class="jf-art"><svg class="pm-pixart"/);
  assert.match(html, /radial-gradient\(120% 90% at 50% -10%,#1c2c4f/);
  const { HUMAN_PROFILE_CAPS } = await import("../src/human-profile.mjs");
  for (const [field, cap] of Object.entries(HUMAN_PROFILE_CAPS)) {
    assert.match(html, new RegExp(`name="${field}" type="text" maxlength="${cap * 2}" value="" placeholder="[^"]+" data-count="${cap}"`), `${field}: ghost and count`);
    assert.match(html, new RegExp(`data-for="${field}" aria-live="polite">0 / ${cap}<`));
  }
  assert.match(html, /<script>\(function\(\)\{var countedLength=function countedLength/, "the counts are live, by the writer's count");
  assert.doesNotMatch(html, /<input[^>]*\schecked/, "the likeness answer starts unchosen");
  assert.match(html, /<input type="radio" name="likeness" value="yes">/);
  // the same form: method, action, the bound pair, the carrier, the two answers
  assert.match(html, /<form method="post" action="http:\/\/127\.0\.0\.1:\d+\/oauth\/consent">/);
  assert.match(html, /<input type="hidden" name="pending_id" value="[^"]+">\s*<input type="hidden" name="nonce" value="[^"]+">/);
  assert.match(html, /data-pm-from/);
  assert.match(html, /<button class="pm-btn" name="decision" value="approve">Co-sign the residency<\/button>/);
  assert.match(html, /<button class="pm-btn ghost" name="decision" value="deny">Cancel<\/button>/);
  // the human's refusal, in the same look, still founds nothing
  const denied = await fetch(`${BASE}/oauth/consent`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ pending_id: page.pending_id, nonce: page.nonce, decision: "deny" }) });
  const deniedText = await denied.text();
  assert.equal(denied.status, 200);
  assert.match(deniedText, /<h1 class="jf-q">Not co-signed<\/h1>/);
  assert.match(deniedText, /class="reg-face"|class="jf-art"/);
  assert.equal(await houseRow("linden-cosign"), null, "nothing founded");
  // the road's own refusals wear it too (the w49 finish: a tester's link to a sunset berth stays in the join's look), same words and code
  const lost = await fetch(`${BASE}/oauth/berth-cosign?slug=no-such-berth-c5`);
  const lostText = await lost.text();
  assert.equal(lost.status, 404);
  assert.match(lostText, /<h1 class="jf-q">No such berth<\/h1>/);
  assert.match(lostText, /That berth isn't at the harbor — it may have sunset\./);
  assert.match(lostText, /radial-gradient\(120% 90% at 50% -10%,#1c2c4f/);
  // every page off the berth co-sign's road keeps the plain look (here the claim co-sign's)
  const other = await fetch(`${BASE}/oauth/claim-cosign?ask=no-such-ask-c5`);
  const otherText = await other.text();
  assert.equal(other.status, 404);
  assert.match(otherText, /<h1>Postmark — the town office<\/h1>/);
  assert.doesNotMatch(otherText, /reg-face|jf-art|radial-gradient/);
});

test("POS-1237 · C6 a declaration the door refuses at the approval answers in the join's look, its words escaped, and founds nothing", async () => {
  ghIdentity = { id: 1237006, login: "cosign-human-c6" };
  // a house name that makes no key of 2–40 characters: begin parks it, the declaration judges it at the approval
  const page = await openCoSign("cosign-bounce", "The Very Long Household Name Of Hollow Oak By The Sea", { forwardedFor: "203.0.113.76" });
  const done = await fetch(`${BASE}/oauth/consent`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ pending_id: page.pending_id, nonce: page.nonce, decision: "approve" }) });
  const text = await done.text();
  assert.equal(done.status, 409, text.slice(0, 300));
  assert.match(text, /<h1 class="jf-q">The declaration bounced<\/h1>/, "the road's look, not the plain page");
  assert.match(text, /radial-gradient\(120% 90% at 50% -10%,#1c2c4f/);
  assert.match(text, /The door refused it \(<code>household<\/code>\): <strong>a household&#39;s name must make a key of 2–40 characters/, "the door's own words, escaped");
  assert.match(text, /Nothing was founded and nothing is stuck/);
  assert.doesNotMatch(text, /<h1>Postmark — the town office<\/h1>/);
});

// ── POS-1237 · THE CHOSEN FINAL HANDLE (Wright: "the office carries the chosen final handle separately from the temporary berth slug") ──
//
// begin's declaration already had `handle`; the co-sign overrode it with the berth's slug. Now the handle the agent chose rides the
// parked declaration, apart from the slug, and the human's co-sign declares IT: a short temporary berth admits a 32–40-character
// resident through the same human-confirmation road, with no new route, kind or store. Flip: put `pending.slug` back over the
// declaration's handle in oauth.mjs (the co-sign's `wanted`) and H1 reds by name.

const LONG36 = "harbor-lantern-keeper-of-the-quay-01";
const LONG40 = "a-resident-whose-name-fills-the-forty-xx";

async function boardAndBegin(slug, ip, args) {
  const boarded = await fetch(`${BASE}/berth`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ slug }) });
  assert.equal(boarded.status, 201, await boarded.clone().text());
  const { key } = await boarded.json();
  const begun = await fetch(`${BASE}/household`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ do: "begin", args: { full_address: "A name chosen long.\nAnd kept.", ...args } }),
  });
  return { key, begun, body: await begun.json() };
}
async function coSignPage(slug) {
  const r1 = await fetch(`${BASE}/oauth/berth-cosign?slug=${slug}`, { redirect: "manual" });
  const r2 = await fetch(r1.headers.get("location"), { redirect: "manual" });
  const html = await (await fetch(r2.headers.get("location"))).text();
  return { html, pending_id: /name="pending_id" value="([^"]+)"/.exec(html)[1], nonce: /name="nonce" value="([^"]+)"/.exec(html)[1] };
}
const bareStanding = async (key) => (await fetch(`${BASE}/household`, { headers: { authorization: `Bearer ${key}` } })).json();

test("POS-1237 · H1 a short temporary berth admits a different 36-character chosen resident through the human's co-sign; the berth's key upgrades to that household", async () => {
  ghIdentity = { id: 1237101, login: "final-human-h1" };
  const { key, begun, body } = await boardAndBegin("fh-short", "203.0.113.81", { household: "Final Handle One", handle: LONG36 });
  assert.equal(begun.status, 200, JSON.stringify(body));
  assert.equal(body.result.handle, LONG36, "begin answers the resident the co-sign will declare");
  assert.equal(body.result.berth, "fh-short", "and the berth it stands on, apart");
  assert.equal(JSON.parse(await parkedOf("fh-short")).handle, LONG36, "parked on the declaration, apart from the slug");
  const before = await bareStanding(key);
  assert.equal(before.declaration?.handle, LONG36, "the berth's own status reads the chosen handle");
  // parked identity is not ownership: nothing is founded, no card, no house, until the human signs
  assert.equal(await houseRow("final-handle-one"), null);
  const { existsSync, readFileSync } = await import("node:fs");
  assert.equal(existsSync(join(clone, "WHITE_PAGES", LONG36)), false, "no address before the click");
  const page = await coSignPage("fh-short");
  assert.match(page.html, /The agent at berth <strong>fh-short<\/strong>/, "the berth is named as where the agent stands");
  assert.match(page.html, new RegExp(`<strong>${LONG36}</strong> as its first resident`), "the page names the CHOSEN resident");
  assert.doesNotMatch(page.html, /<strong>fh-short<\/strong> as its first resident/);
  const done = await approveWith(page);
  const text = await done.text();
  assert.equal(done.status, 200, text.slice(0, 500));
  assert.match(text, new RegExp(`<strong class="jf-wrap">${LONG36}</strong> as its first resident`), "the success copy names the admitted resident, in a run that wraps at the phone frame");
  assert.ok(existsSync(join(clone, "WHITE_PAGES", LONG36, "ADDRESS.md")), "the chosen resident's address is written");
  assert.equal(existsSync(join(clone, "WHITE_PAGES", "fh-short")), false, "the berth's slug is not admitted as a resident");
  assert.match(readFileSync(join(clone, "WHITE_PAGES", LONG36, "ADDRESS.md"), "utf8"), new RegExp(`handle: ${LONG36}`));
  assert.ok(await houseRow("final-handle-one"), "the house stands");
  // the same key, grown standing: it resolves to the household the human actually admitted, holding the chosen handle
  const after = await bareStanding(key);
  assert.ok(JSON.stringify(after).includes(LONG36), `the same key answers as the household holding ${LONG36}: ${JSON.stringify(after).slice(0, 400)}`);
  assert.ok(!JSON.stringify(after.residents ?? []).includes("fh-short"), "not the berth slug");
});

test("POS-1237 · H2 a 40-character chosen handle is admitted too (the town's accepted ceiling)", async () => {
  ghIdentity = { id: 1237102, login: "final-human-h2" };
  const { begun, body } = await boardAndBegin("fh-forty", "203.0.113.82", { household: "Final Handle Forty", handle: LONG40 });
  assert.equal(begun.status, 200, JSON.stringify(body));
  const done = await approveWith(await coSignPage("fh-forty"));
  assert.equal(done.status, 200, (await done.text()).slice(0, 400));
  const { existsSync } = await import("node:fs");
  assert.ok(existsSync(join(clone, "WHITE_PAGES", LONG40, "ADDRESS.md")));
});

test("POS-1237 · H3 a begin that omits the handle is the old road: the berth's own name is the resident, the page and the answer say so", async () => {
  ghIdentity = { id: 1237103, login: "final-human-h3" };
  const { begun, body } = await boardAndBegin("fh-legacy", "203.0.113.83", { household: "Final Handle Legacy" });
  assert.equal(begun.status, 200, JSON.stringify(body));
  assert.equal(body.result.handle, "fh-legacy");
  assert.equal(JSON.parse(await parkedOf("fh-legacy")).handle, undefined, "nothing invented on the declaration");
  const page = await coSignPage("fh-legacy");
  assert.match(page.html, /<strong>fh-legacy<\/strong> as its first resident/);
  const done = await approveWith(page);
  assert.equal(done.status, 200, (await done.text()).slice(0, 300));
  const { existsSync } = await import("node:fs");
  assert.ok(existsSync(join(clone, "WHITE_PAGES", "fh-legacy", "ADDRESS.md")));
});

test("POS-1237 · H4 the normal refusals at begin, by name and writing nothing: grammar, length, reserved, prefix, taken", async () => {
  const cases = [
    ["Not_Well Formed", 422], ["a", 422], ["x".repeat(41), 422],
    ["postmaster", 409], ["berth-someone", 409], ["human-of-someone", 409], ["wright", 409], ["the-lighthouse", 422],
  ];
  let n = 0;
  for (const [handle, code] of cases) {
    const slug = `fh-ref-${n}`;
    const { begun, body } = await boardAndBegin(slug, `203.0.113.${90 + n}`, { household: "Refused Handle", handle });
    n++;
    assert.equal(begun.status, code, `${handle}: ${JSON.stringify(body)}`);
    assert.equal(body.field, "handle", `${handle} is refused by its field`);
    assert.equal(await parkedOf(slug), null, `${handle}: nothing parked`);
  }
});

test("POS-1237 · H4b (Wright's w49 read) a chosen handle starting the- or berth- is refused at begin with words that name the rule; the- in the berth desk's own words", async () => {
  // the berth desk's refusal of the same prefix, as it answers a slug today
  const desk = await fetch(`${BASE}/berth`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.120" }, body: JSON.stringify({ slug: "the-lighthouse" }) });
  const deskBody = await desk.json();
  assert.equal(desk.status, 422);
  const { begun: the, body: theBody } = await boardAndBegin("fh-the-0", "203.0.113.121", { household: "Refused Handle", handle: "the-lighthouse" });
  assert.equal(the.status, 422, JSON.stringify(theBody));
  assert.equal(theBody.defect, '"the-lighthouse" wears the town\'s own prefix');
  assert.equal(theBody.hint, "the-* is the town's namespace and berth-* is added for you — pick a plain name");
  assert.equal(theBody.hint, deskBody.hint, "the same rule, in the berth desk's own words");
  assert.equal(await parkedOf("fh-the-0"), null);
  const { begun: berth, body: berthBody } = await boardAndBegin("fh-berth-0", "203.0.113.122", { household: "Refused Handle", handle: "berth-lighthouse" });
  assert.equal(berth.status, 409, JSON.stringify(berthBody));
  assert.match(berthBody.hint, /wears the berth- reserved prefix \(the reserved-prefix rule: no resident handle begins with berth- or human-of-\)/, "the town's rule, named");
  // a plain chosen handle at the 2 and 40 edges still parks (the range is the ruled 2–40)
  for (const [i, handle] of [["2", "ab"], ["40", "c".repeat(40)]]) {
    const { begun } = await boardAndBegin(`fh-edge-${i}`, `203.0.113.12${3 + Number(i === "40")}`, { household: `Edge House ${i}`, handle });
    assert.equal(begun.status, 200, `${handle.length} characters parks`);
  }
});

test("POS-1237 · H5 a handle taken or malformed by the time of the click is refused at the co-sign, and founds nothing", async () => {
  ghIdentity = { id: 1237105, login: "final-human-h5" };
  for (const [slug, handle, ip] of [["fh-late-a", "wright", "203.0.113.101"], ["fh-late-b", "Bad Handle", "203.0.113.102"]]) {
    const { begun } = await boardAndBegin(slug, ip, { household: `Late ${slug}`, handle: "a-handle-free-at-begin-time" });
    assert.equal(begun.status, 200);
    const { DatabaseSync } = await import("node:sqlite");
    const paper = new DatabaseSync(join(tmp, "oauth.db"));
    try {   // the handle the town took (or a hand wrote) between begin and the click
      const decl = JSON.parse(paper.prepare("SELECT card FROM berths WHERE slug = ?").get(slug).card);
      paper.prepare("UPDATE berths SET card = ? WHERE slug = ?").run(JSON.stringify({ ...decl, handle }), slug);
    } finally { paper.close(); }
    const done = await approveWith(await coSignPage(slug));
    const text = await done.text();
    assert.ok(done.status >= 400 && done.status < 500, `${handle}: ${done.status} ${text.slice(0, 300)}`);
    assert.match(text, /bounced/);
    assert.equal(await houseRow(`late-${slug}`), null, "nothing founded");
    assert.ok(await parkedOf(slug), "the declaration stays parked");
  }
});
