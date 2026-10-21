// likeness.test.mjs — the household's human's answer to the likeness question (WLD-83).
//
// Darko, 2026-10-19: a single yes/no from the human, through a GitHub sign-in,
// default no, on the record (18:24, 18:59 D2); a no stops made media, never
// display (D1); every household with a picture is asked now (19:04 D9).
//
// Every house, handle, login and id here is INVENTED.
//
//   § 1  the record: the column renders when answered and is no key at all when not
//   § 2  the one writer: yes or no only, the binding account only, then the drain
//   § 3  the gate and the question: given only on yes; asked only while unanswered
//   § 4  needs-you: the house is asked while a resident has a picture or appearance
//   § 5  the form on a booted office: GitHub, the anchor check, the answer, the card
//
//   node --test test/likeness.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { rowsFromRegistry, renderRegistry, registryFromRows, HOUSEHOLD_KEYS } from "../src/registry-rows.mjs";
import {
  setLikeness, likenessGiven, likenessQuestionFor, likenessNeed, likenessOfHouse, accountBinds,
  withLikenessQuestion, LIKENESS_WORDS, LIKENESS_WORDS_VERSION,
} from "../src/likeness.mjs";
import { setHouseholdLikeness } from "../src/registry-store.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { makePool, RECORD_ON } from "./registry-pool-stub.mjs";
import { fixtureTown } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";
import { indexStore, seedRegistry } from "./helpers/office-under-test.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "postmark-likeness-"));
const CLEANUP = [];
after(async () => {
  for (const f of CLEANUP.reverse()) await f().catch(() => {});
  rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const KEEPER = { login: "lr-gh", id: 9101 };
const STRANGER = { login: "uh-gh", id: 9103 };
const REGISTRY = { schema_version: 1, note: "invented for WLD-83", households: {
  "lantern-row": { name: "Lantern Row", since: "2026-08-01", declared_by: "postmaster",
    accounts: [KEEPER], residents: ["postmaster", "wick", "wright"] },
  "unnamed-hall": { since: "2026-08-03", declared_by: "quill", accounts: [STRANGER], residents: ["quill"] },
} };
const PINS = { postmaster: { login: KEEPER.login, id: KEEPER.id, pinned: "2026-08-01" }, wick: { login: KEEPER.login, id: KEEPER.id },
  wright: { login: KEEPER.login, id: KEEPER.id },
  quill: { login: STRANGER.login, id: STRANGER.id } };
const seed = () => rowsFromRegistry(structuredClone(REGISTRY), structuredClone(PINS));

/** Run `fn` with the office pointed at an in-memory store seeded from REGISTRY. */
async function withStore(fn, pool = makePool(seed())) {
  __setPoolForTest(pool);
  const was = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  Object.assign(process.env, RECORD_ON);
  try { return await fn(pool); }
  finally {
    __setPoolForTest(null);
    if (was.pg === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = was.pg;
    if (was.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = was.url;
  }
}
// The drain's commit, recorded rather than performed (home-picture.test.mjs's seam).
const recordingDrain = (seen) => async () => { seen.push("drained"); return { ran: true, commit: "c0ffee" }; };
const AT = () => new Date("2026-10-21T12:00:00.000Z");

// ── § 1 the record ──────────────────────────────────────────────────────────

test("§ 1 likeness is the tail column; unanswered renders no key, answered renders in template order", () => {
  assert.equal(HOUSEHOLD_KEYS.at(-1), "likeness", "the newest optional column joins the tail");
  const rows = seed();
  assert.ok(rows.households.every((r) => r.likeness === null), "no key folds to NULL: never answered");
  assert.equal(renderRegistry(rows).households.includes("likeness"), false, "an unanswered registry prints exactly as before");
  // jsonb hands keys back sorted by (length, bytes); the render puts them back.
  rows.households[0].likeness = { words: LIKENESS_WORDS_VERSION, gh_id: 9101, by: "lr-gh", at: "2026-10-21T12:00:00.000Z", answer: "yes" };
  const printed = JSON.parse(renderRegistry(rows).households).households["lantern-row"];
  assert.deepEqual(Object.keys(printed.likeness), ["answer", "at", "by", "gh_id", "words"]);
  assert.equal(Object.keys(printed).at(-1), "likeness");
  assert.deepEqual(rowsFromRegistry(JSON.parse(renderRegistry(rows).households), PINS).households[0].likeness.answer, "yes",
    "the printed answer folds back: the round trip holds");
});

// ── § 2 the one writer ──────────────────────────────────────────────────────

test("§ 2 setLikeness writes yes or no for a binding account, drains, and says what it kept", async () => {
  await withStore(async (pool) => {
    const seen = [];
    const done = await setLikeness({ slug: "lantern-row", answer: "yes", ghId: KEEPER.id, ghLogin: KEEPER.login },
      { drain: recordingDrain(seen), now: AT });
    assert.equal(done.household, "lantern-row");
    assert.deepEqual(done.likeness, { answer: "yes", at: "2026-10-21T12:00:00.000Z", by: "lr-gh", words: LIKENESS_WORDS_VERSION });
    assert.deepEqual(done.registry, { rendered: true });
    assert.deepEqual(seen, ["drained"], "the drain ran once, after the store write");
    const row = pool.state.households.find((r) => r.slug === "lantern-row");
    assert.deepEqual(row.likeness, { answer: "yes", at: "2026-10-21T12:00:00.000Z", by: "lr-gh", gh_id: 9101, words: LIKENESS_WORDS_VERSION });
    await setLikeness({ slug: "lantern-row", answer: "no", ghId: KEEPER.id, ghLogin: KEEPER.login }, { drain: recordingDrain(seen), now: AT });
    assert.equal(row.likeness.answer, "no", "an answer can be changed: the newest one is the record");
  });
});

test("§ 2 setLikeness refuses a third answer, a missing sign-in, and an account the house does not bind", async () => {
  await withStore(async (pool) => {
    const seen = [];
    const deps = { drain: recordingDrain(seen), now: AT };
    for (const answer of ["maybe", "neutral", "", undefined, "YES"])
      await assert.rejects(setLikeness({ slug: "lantern-row", answer, ghId: KEEPER.id }, deps), (e) => e.code === 422, `"${answer}" is not an answer`);
    await assert.rejects(setLikeness({ slug: "lantern-row", answer: "yes" }, deps), (e) => e.code === 401, "no signed-in account, no answer");
    await assert.rejects(setLikeness({ slug: "lantern-row", answer: "yes", ghId: STRANGER.id, ghLogin: STRANGER.login }, deps),
      (e) => e.code === 403 && /does not keep "lantern-row"/.test(e.defect), "another house's account answers nothing");
    assert.equal(pool.state.households.find((r) => r.slug === "lantern-row").likeness, null, "nothing was written");
    assert.deepEqual(seen, [], "and nothing was drained");
  });
});

test("§ 2 the store's write names the slug AND the account, in one statement", async () => {
  await withStore(async () => {
    const wrong = await setHouseholdLikeness({ slug: "lantern-row", likeness: { answer: "yes", gh_id: STRANGER.id } });
    assert.deepEqual(wrong, { slug: null }, "an account the row does not bind writes no row");
    const right = await setHouseholdLikeness({ slug: "lantern-row", likeness: { answer: "yes", gh_id: KEEPER.id } });
    assert.deepEqual(right, { slug: "lantern-row" });
  });
});

// ── § 3 the gate and the question ───────────────────────────────────────────

test("§ 3 the gate: given only on yes; no, never answered and an unreadable record are all not given", async () => {
  assert.equal(likenessOfHouse({ likeness: { answer: "yes" } }), "given");
  assert.equal(likenessOfHouse({ likeness: { answer: "no" } }), "not given");
  assert.equal(likenessOfHouse({ likeness: null }), "not given");
  assert.equal(likenessOfHouse(undefined), "not given");
  assert.equal(accountBinds({ accounts: [KEEPER] }, 9101), true);
  assert.equal(accountBinds({ accounts: [KEEPER] }, "9101"), true, "an id from a form or a query compares as a number");
  assert.equal(accountBinds({ accounts: [KEEPER] }, 9103), false);
  await withStore(async (pool) => {
    assert.equal(await likenessGiven("wick"), false, "never answered: no");
    pool.state.households.find((r) => r.slug === "lantern-row").likeness = { answer: "no" };
    assert.equal(await likenessGiven("wick"), false, "answered no: no");
    pool.state.households.find((r) => r.slug === "lantern-row").likeness = { answer: "yes" };
    assert.equal(await likenessGiven("wick"), true, "answered yes: given, for every resident of the house");
    assert.equal(await likenessGiven("postmaster"), true);
    assert.equal(await likenessGiven("quill"), false, "another house's answer is not this one's");
    assert.equal(await likenessGiven("nobody-here"), false, "a handle no house holds is never given");
  });
  assert.equal(await likenessGiven("wick", { registry: null, env: {} }), false, "a record that cannot be read is not a yes");
});

test("§ 3 the question rides an answer only while the house has not answered", async () => {
  await withStore(async (pool) => {
    const q = await likenessQuestionFor("wick");
    assert.equal(q.household, "lantern-row");
    assert.match(q.link, /\/oauth\/likeness\?household=lantern-row$/);
    assert.match(q.hand_it_over, /no key can answer it/);
    const out = await withLikenessQuestion({ updated: "wick" }, "wick");
    assert.deepEqual(out.likeness_question, q, "a picture just set carries the question");
    pool.state.households.find((r) => r.slug === "lantern-row").likeness = { answer: "no" };
    assert.equal(await likenessQuestionFor("wick"), null, "answered (even no): not asked again");
    assert.deepEqual(await withLikenessQuestion({ updated: "wick" }, "wick"), { updated: "wick" }, "the answer is left exactly as the door made it");
  });
  assert.deepEqual(await withLikenessQuestion({ updated: "wick" }, "wick", { env: {} }), { updated: "wick" },
    "an unreadable record invents no question");
});

test("§ 3 the words carry the PG-13 promise, what yes and no mean, and the take-down road", () => {
  assert.match(LIKENESS_WORDS.promise, /strictly PG-13/);
  assert.match(LIKENESS_WORDS.promise, /illegal, graphic or sexual/);
  assert.match(LIKENESS_WORDS.yes_means, /publish by default/);
  assert.match(LIKENESS_WORDS.yes_means, /take it down/);
  assert.match(LIKENESS_WORDS.take_down, /letter to darko/);
  assert.match(LIKENESS_WORDS.no_means, /still show in town/);
  assert.match(LIKENESS_WORDS.talk_it_over, /talk it over with your resident/);
});

test("§ 3 the picture doors ask it: the household act's profile with an image carries the question, without one does not", async () => {
  const { MEDIA_BASE } = await import("../src/media.mjs");
  const { householdApex } = await import("../src/household-apex.mjs");
  const { TOOLS } = await import("../src/mcp.mjs");
  const { editClone } = await import("./fixture.mjs");
  const schemas = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.properties ?? {}]));
  const key = { household: "keemin", handles: new Set(["wright"]) };
  const FACE = `${MEDIA_BASE}/media/keemin/${"a1".repeat(32)}.png`;
  const clone = editClone();
  CLEANUP.push(async () => rmSync(clone, { recursive: true, force: true, maxRetries: 5 }));
  const was = process.env.TOWN_PUSH; delete process.env.TOWN_PUSH;
  try {
    await withStore(async () => {
      const set = await householdApex({ do: "profile", args: { handle: "wright", image: FACE } }, key, { db: fixtureTown(), clone, schemas });
      assert.equal(set.code, undefined, JSON.stringify(set).slice(0, 300));
      assert.equal(set.result?.likeness_question?.household, "lantern-row", "a picture just set asks the question");
      const bio = await householdApex({ do: "profile", args: { handle: "wright", bio: "a line of my own" } }, key, { db: fixtureTown(), clone, schemas });
      assert.equal(bio.code, undefined, JSON.stringify(bio).slice(0, 300));
      assert.equal("likeness_question" in bio.result, false, "an edit with no picture does not");
    });
  } finally { if (was !== undefined) process.env.TOWN_PUSH = was; }
});

// ── § 4 needs-you ───────────────────────────────────────────────────────────

test("§ 4 needs-you asks an unanswered house whose residents have a picture or an appearance, and no other", async () => {
  await withStore(async (pool) => {
    const pictured = new Set(["wick"]);
    const withLikeness = async (handles) => handles.filter((h) => pictured.has(h));
    const asked = await likenessNeed("lantern-row", ["postmaster", "wick"], { withLikeness });
    assert.equal(asked.rows.length, 1);
    assert.deepEqual(asked.rows[0].residents, ["wick"], "only the residents with a likeness are named");
    assert.match(asked.rows[0].link, /household=lantern-row/);
    assert.match(asked.rows[0].cause, /until they do, the answer is no/);
    pictured.clear();
    assert.deepEqual(await likenessNeed("lantern-row", ["postmaster", "wick"], { withLikeness }), { rows: [] },
      "nothing to depict: nothing to ask");
    pictured.add("wick");
    pool.state.households.find((r) => r.slug === "lantern-row").likeness = { answer: "no" };
    assert.deepEqual(await likenessNeed("lantern-row", ["postmaster", "wick"], { withLikeness }), { rows: [] },
      "answered: off the list");
  });
  const blind = await likenessNeed("lantern-row", ["wick"], { env: {} });
  assert.deepEqual(blind.rows, []);
  assert.match(blind.unavailable, /unknown, not none/, "an unreadable record says so rather than reading as nothing waits");
});

test("§ 4 residentsWithLikeness reads a picture from either key, or an appearance root", async () => {
  const { residentsWithLikeness } = await import("../src/likeness.mjs");
  const clone = join(TMP, "pictures");
  const profile = (h, fm) => { mkdirSync(join(clone, "WHITE_PAGES", h), { recursive: true }); writeFileSync(join(clone, "WHITE_PAGES", h, "PROFILE.md"), `---\n${fm}\n---\n`); };
  profile("filed", 'avatar: "avatar.png"');
  profile("linked", 'avatar_url: "https://media.postmark.town/media/x/ab.png"');
  profile("plain", 'bio: "no picture here"');
  const nodes = new Map([["described/appearance", {}]]);
  assert.deepEqual(await residentsWithLikeness(["filed", "linked", "plain", "described", "nobody"], { clone, nodes }),
    ["filed", "linked", "described"]);
});

// ── § 5 the form on a booted office ─────────────────────────────────────────

test("§ 5 the form: a stranger is refused, the household's account answers, the record and the card follow", async () => {
  let identity = KEEPER;
  const gh = createServer((req, res) => {
    res.setHeader("connection", "close");
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/login/oauth/authorize") {
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("code", "gh-mock-code");
      back.searchParams.set("state", url.searchParams.get("state"));
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === "/login/oauth/access_token") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ access_token: "gh-mock-token" })); }
    if (url.pathname === "/user") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(identity)); }
    res.writeHead(404); res.end();
  });
  await new Promise((ok) => gh.listen(0, "127.0.0.1", ok));
  CLEANUP.push(() => new Promise((ok) => gh.close(ok)));
  const GH = `http://127.0.0.1:${gh.address().port}`;

  // The town clone the drain prints into: a real git repo holding today's files,
  // so the answer's commit is the instrument.
  const clone = join(TMP, "town-clone");
  mkdirSync(join(clone, "tools"), { recursive: true });
  mkdirSync(join(clone, "WHITE_PAGES"), { recursive: true });
  const printed = renderRegistry(seed());
  writeFileSync(join(clone, "tools", "households.json"), printed.households);
  writeFileSync(join(clone, "tools", "github-ids.json"), printed.pins);
  const git = (...a) => execFileSync("git", ["-C", clone, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("-c", "user.name=test", "-c", "user.email=test@example.invalid", "add", "-A");
  git("-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-qm", "the registry");

  const ix = await indexStore(fixtureTown(), { db: "likeness_form" });
  CLEANUP.push(() => ix.stop());
  await seedRegistry(ix.store, REGISTRY, PINS);
  const { child, port } = await bootOnFreePort((p) => spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(p),
    "--oauth-db", join(TMP, "oauth.db")], {
    env: { ...process.env, WORLD2_PG: ix.env.WORLD2_PG, WORLD2_PG_URL: ix.env.WORLD2_PG_URL, TOWN_INDEX_READS: ix.env.TOWN_INDEX_READS ?? "",
      TOWN_CLONE: clone, TOWN_PUSH: "", OFFICE_READ_WORKERS: "0", WORLD_GRAPH_NONE: "1", OFFICE_KEYS: "",
      PUBLIC_BASE: `http://127.0.0.1:${p}`,
      POSTMARK_OAUTH_GITHUB_CLIENT_ID: "mock-gh-app", POSTMARK_OAUTH_GITHUB_CLIENT_SECRET: "mock-gh-secret",
      GITHUB_AUTH_URL: `${GH}/login/oauth/authorize`, GITHUB_TOKEN_URL: `${GH}/login/oauth/access_token`, GITHUB_API_URL: GH,
      GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.invalid" },
    stdio: ["ignore", "pipe", "pipe"],
  }));
  CLEANUP.push(async () => { if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; } });
  const base = `http://127.0.0.1:${port}`;

  // link -> GitHub -> the office's screen, as a browser walks it
  const open = async (slug, as) => {
    identity = as;
    const r1 = await fetch(`${base}/oauth/likeness?household=${slug}`, { redirect: "manual" });
    if (r1.status !== 302) return { status: r1.status, html: await r1.text() };
    const r2 = await fetch(r1.headers.get("location"), { redirect: "manual" });
    const r3 = await fetch(r2.headers.get("location"));
    const html = await r3.text();
    return { status: r3.status, html,
      pending_id: /name="pending_id" value="([^"]+)"/.exec(html)?.[1], nonce: /name="nonce" value="([^"]+)"/.exec(html)?.[1] };
  };
  const answer = (form, decision) => fetch(`${base}/oauth/consent`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ pending_id: form.pending_id, nonce: form.nonce, decision }),
  }).then(async (r) => ({ status: r.status, html: await r.text() }));
  const card = async (h) => (await (await fetch(`${base}/residents/${h}`)).json()).household;

  assert.equal((await fetch(`${base}/oauth/likeness?household=no-such-house`, { redirect: "manual" })).status, 404);

  const refused = await open("lantern-row", STRANGER);
  assert.equal(refused.status, 403, refused.html.slice(0, 300));
  assert.match(refused.html, /does not bind/);
  assert.equal(refused.pending_id, undefined, "a stranger is never shown the buttons");

  assert.equal((await card("postmaster")).likeness, "not given", "before any answer, the card reads not given");

  const form = await open("lantern-row", KEEPER);
  assert.equal(form.status, 200, form.html.slice(0, 300));
  assert.match(form.html, /strictly PG-13/);
  assert.match(form.html, /still show in town/);
  assert.match(form.html, /letter to darko/);
  assert.match(form.html, /not answered yet, which reads as <strong>no<\/strong>/);
  assert.match(form.html, /value="yes"/);
  assert.match(form.html, /value="no"/);

  const yes = await answer(form, "yes");
  assert.equal(yes.status, 200, yes.html.slice(0, 400));
  assert.match(yes.html, /Your answer is <strong>yes<\/strong>/);
  assert.equal((await card("postmaster")).likeness, "given", "the card reads the record at once");
  const onFile = JSON.parse(readFileSync(join(clone, "tools", "households.json"), "utf8")).households["lantern-row"].likeness;
  assert.equal(onFile.answer, "yes", "the answer is on the town's public record");
  assert.equal(onFile.by, KEEPER.login);
  assert.equal(onFile.words, LIKENESS_WORDS_VERSION);
  assert.match(git("log", "-1", "--format=%B"), /lantern-row: the likeness question answered yes/, "one commit says what was answered");
  assert.equal(JSON.parse(readFileSync(join(clone, "tools", "households.json"), "utf8")).households["unnamed-hall"].likeness, undefined,
    "another house is untouched");

  const replay = await answer(form, "no");
  assert.equal(replay.status, 400, "a used form answers nothing a second time");
  assert.equal((await card("postmaster")).likeness, "given");

  const again = await open("lantern-row", KEEPER);
  assert.match(again.html, /Your answer now: <strong>yes<\/strong>/, "the form shows the standing answer");
  const blank = await answer(again, "maybe");
  assert.equal(blank.status, 400);
  assert.match(blank.html, /Nothing was changed/);

  // THE BUTTON'S OWN CHECK, on the real store: the write names the slug AND an
  // account the row binds, so an account the record stopped binding between the
  // screen and the button writes nothing.
  assert.deepEqual(await setHouseholdLikeness({ slug: "lantern-row", likeness: { answer: "no", gh_id: STRANGER.id } }, ix.env),
    { slug: null }, "another house's account writes no row");
  assert.equal((await card("postmaster")).likeness, "given", "and the answer stands");

  const third = await open("lantern-row", KEEPER);
  const no = await answer(third, "no");
  assert.equal(no.status, 200);
  assert.match(no.html, /Your answer is <strong>no<\/strong>/);
  assert.equal((await card("postmaster")).likeness, "not given", "a no takes the yes back");
});
