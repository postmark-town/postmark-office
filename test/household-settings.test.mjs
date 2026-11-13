// household-settings.test.mjs — WLD-28: the household's ONE settings door (likeness + Hearth), the old doors as its aliases, and the read-only MCP read.
//
// Darko, 2026-11-13 09:12 EST: "Build it with the second setting"; Wright's go (14:16Z): GET/PATCH /households/<slug>/settings for the household's signed-in
// human, `household { read: "settings" }`, NO MCP write, existing columns stay, no data moves; each setting keeps its own ruled credential (Wright, 15:40Z):
// the likeness answer the browser sign-in's alone (D2), the Hearth what its door always took. Every house, handle, login and id here is INVENTED.
//
//   § 1  the read: both effective values together; settings only (no consent audit, no human's identity)
//   § 2  the write: only what is sent changes; consent recorded as the likeness writer records it; a combined request judged whole before the first write;
//        a bearer's likeness answer refused whole (D2)
//   § 3  the aliases and the canonical door agree: the same saved answer, the old shapes and words
//   § 4  the door on a booted office: the human, the agent's key, another house, the household key and access token refused the likeness answer, the form
//        its one road, the old routes, and the MCP read that cannot write
//
//   node --test test/household-settings.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { rowsFromRegistry, renderRegistry } from "../src/registry-rows.mjs";
import { chooseHearth } from "../src/household-hearth.mjs";
import { setLikeness } from "../src/likeness.mjs";
import { SETTINGS, settingsOf, readSettings, changeSettings } from "../src/household-settings.mjs";
import { HOUSEHOLD_READS, HOUSEHOLD_READ_FIELDS } from "../src/household-apex.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { makePool, RECORD_ON } from "./registry-pool-stub.mjs";
import { fixtureTown } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";
import { indexStore, seedRegistry } from "./helpers/office-under-test.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs";
import { createServer } from "node:http";
import { openOauthDb, mintHouseholdKey, sha256 } from "../src/oauth.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "postmark-settings-"));
const CLEANUP = [];
after(async () => {
  for (const f of CLEANUP.reverse()) await f().catch(() => {});
  rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const KEEPER = { login: "ember-gh", id: 8101 };
const STRANGER = { login: "frost-gh", id: 8103 };
const REGISTRY = { schema_version: 1, note: "invented for WLD-28", households: {
  "ember-lane": { name: "Ember Lane", since: "2026-08-01", declared_by: "ash", accounts: [KEEPER], residents: ["ash", "birch"] },
  "frost-hall": { name: "Frost Hall", since: "2026-08-03", declared_by: "fern", accounts: [STRANGER], residents: ["fern"] },
} };
const PINS = { ash: { login: KEEPER.login, id: KEEPER.id }, birch: { login: KEEPER.login, id: KEEPER.id }, fern: { login: STRANGER.login, id: STRANGER.id } };
const seed = () => rowsFromRegistry(structuredClone(REGISTRY), structuredClone(PINS));
const AT = () => new Date("2026-11-13T15:00:00Z");

function hearthClone(ids = ["default", "ledger", "orchard"], name = "clone") {
  const clone = join(TMP, `${name}-${Math.random().toString(36).slice(2, 8)}`);
  const dir = join(clone, "PROJECTS", "household-hearths");
  mkdirSync(join(dir, "STARTER"), { recursive: true });
  for (const id of ids) { mkdirSync(join(dir, id), { recursive: true }); writeFileSync(join(dir, id, "hearth.html"), "<div></div>"); }
  return clone;
}
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
const drained = (seen = []) => async () => { seen.push("drained"); return { ran: true, commit: "c0ffee" }; };
// the form's call (browserSignIn: true, the GitHub sign-in proved `who` in a browser) unless a test says otherwise; § 2's D2 test calls as a bearer
const change = (changes, who = KEEPER, slug = "ember-lane", extra = {}) =>
  changeSettings({ slug, changes, ghId: who.id, ghLogin: who.login }, { clone: extra.clone ?? hearthClone(), drain: drained(extra.seen ?? []), now: AT, browserSignIn: true, ...extra });
const rowOf = (pool, slug = "ember-lane") => pool.state.households.find((r) => r.slug === slug);

// ── § 1 the read ────────────────────────────────────────────────────────────

test("§ 1 the settings read: both effective values together; unanswered reads as not given and nothing chosen as the default; settings only, no audit", async () => {
  assert.deepEqual([...SETTINGS], ["likeness", "hearth"]);
  await withStore(async (pool) => {
    assert.deepEqual(await readSettings({ slug: "ember-lane" }), {
      household: "ember-lane", likeness: { answer: null, effective: "not given" }, hearth: { choice: null, effective: "default" } });
    await change({ likeness: "yes", hearth: "ledger" });
    const now = await readSettings({ slug: "ember-lane" });
    assert.deepEqual(now, { household: "ember-lane", likeness: { answer: "yes", effective: "given" }, hearth: { choice: "ledger", effective: "ledger" } });
    // settings only: not who answered, when, with which words, or any account id
    assert.doesNotMatch(JSON.stringify(now), /8101|ember-gh|"at"|"by"|gh_id|words/);
    assert.equal(rowOf(pool).likeness.gh_id, 8101, "(the record itself keeps its audit, untouched, where it always was)");
    await assert.rejects(readSettings({ slug: "no-such-house" }), (e) => e.code === 404);
    await assert.rejects(readSettings({ slug: "ember-lane" }, { loadRows: async () => null }), (e) => e.code === 409);
  });
  assert.deepEqual(settingsOf("x", { likeness: { answer: "no" }, hearth: "Not An Id" }),
    { household: "x", likeness: { answer: "no", effective: "not given" }, hearth: { choice: null, effective: "default" } }, "a spelling that is no id reads as nothing chosen");
});

// ── § 2 the write ───────────────────────────────────────────────────────────

test("§ 2 both settings together: the consent record is the likeness writer's (answer, at, by, gh_id, words) and the Hearth is the Hearth writer's, each where it always was", async () => {
  await withStore(async (pool) => {
    const seen = [];
    const done = await change({ likeness: "yes", hearth: "ledger" }, KEEPER, "ember-lane", { seen });
    assert.deepEqual(done.changed, ["likeness", "hearth"]);
    assert.deepEqual(done.settings, { household: "ember-lane", likeness: { answer: "yes", effective: "given" }, hearth: { choice: "ledger", effective: "ledger" } });
    assert.deepEqual(done.registry, { rendered: true });
    assert.equal(done.commit, "c0ffee");
    assert.equal(rowOf(pool).hearth, "ledger");
    assert.deepEqual(rowOf(pool).likeness, { answer: "yes", at: "2026-11-13T15:00:00.000Z", by: "ember-gh", gh_id: 8101, words: rowOf(pool).likeness.words },
      "consent is recorded exactly as the form recorded it: who, when, which words; none is fabricated");
    assert.equal(typeof done.parts.hearth.hearth, "string"); assert.equal(done.parts.likeness.likeness.answer, "yes");
  });
});

test("§ 2 ONLY WHAT IS SENT CHANGES: an omitted setting is left as it was; hearth: null clears the Hearth alone; the answer is never re-dated by a Hearth change", async () => {
  await withStore(async (pool) => {
    await change({ likeness: "yes", hearth: "ledger" });
    const answered = structuredClone(rowOf(pool).likeness);
    await change({ hearth: "orchard" }, KEEPER, "ember-lane", { now: () => new Date("2027-01-01T00:00:00Z") });
    assert.deepEqual(rowOf(pool).likeness, answered, "the likeness answer (and its date) is exactly as it was: the Hearth request did not touch its neighbour");
    assert.equal(rowOf(pool).hearth, "orchard");
    await change({ likeness: "no" }, KEEPER, "ember-lane", { now: () => new Date("2027-02-01T00:00:00Z") });
    assert.equal(rowOf(pool).hearth, "orchard", "the likeness change left the Hearth alone");
    assert.equal(rowOf(pool).likeness.answer, "no");
    await change({ hearth: null });
    assert.equal(rowOf(pool).hearth ?? null, null, "null is back to the default");
    assert.equal(rowOf(pool).likeness.answer, "no", "and the answer stands");
    await change({ hearth: "default" });   // the default's own id is the same as nothing chosen
    assert.equal(rowOf(pool).hearth ?? null, null);
  });
});

test("§ 2 A COMBINED REQUEST IS JUDGED WHOLE BEFORE THE FIRST WRITE: an invalid part keeps no part; unknown settings, an empty body, another house and an unbound account all keep nothing", async () => {
  await withStore(async (pool) => {
    const before = structuredClone(pool.state.households);
    const seen = [];
    const refused = async (changes, who, slug, code) => {
      await assert.rejects(change(changes, who, slug, { seen }), (e) => e.code === code, JSON.stringify(changes));
      assert.deepEqual(pool.state.households, before, `nothing kept for ${JSON.stringify(changes)}`);
    };
    await refused({ likeness: "yes", hearth: "not-registered" }, KEEPER, "ember-lane", 422);   // a valid answer beside an unregistered Hearth
    await refused({ likeness: "maybe", hearth: "ledger" }, KEEPER, "ember-lane", 422);          // a valid Hearth beside a third answer
    await refused({ likeness: "yes", hearth: 7 }, KEEPER, "ember-lane", 422);
    await refused({ likeness: "yes", fog: true }, KEEPER, "ember-lane", 422);                  // no such setting: refused by name, the valid part not kept
    await refused({}, KEEPER, "ember-lane", 422);
    await refused([], KEEPER, "ember-lane", 422);
    await refused({ likeness: "yes", hearth: "ledger" }, STRANGER, "ember-lane", 403);          // another household's account
    await refused({ likeness: "yes", hearth: "ledger" }, { id: 1, login: "nobody" }, "ember-lane", 403);
    await refused({ likeness: "yes" }, KEEPER, "no-such-house", 404);
    await assert.rejects(changeSettings({ slug: "ember-lane", changes: { likeness: "yes" }, ghId: null }, { clone: hearthClone() }), (e) => e.code === 403, "no verified account");
    assert.deepEqual(seen, [], "and nothing was drained or printed");
  });
});

test("§ 2 D2: THE LIKENESS ANSWER IS NEVER A BEARER'S: without the form's browser sign-in a submitted answer is refused whole, before the record is read, the Hearth beside it included", async () => {
  await withStore(async (pool) => {
    const before = structuredClone(pool.state.households);
    const seen = [];
    let read = 0;
    const loadRows = async () => { read++; return seed(); };
    for (const changes of [{ likeness: "yes" }, { likeness: "no", hearth: "ledger" }, { likeness: "maybe", hearth: "ledger" }]) {
      const e = await change(changes, KEEPER, "ember-lane", { seen, loadRows, browserSignIn: false }).then(() => null, (x) => x);
      assert.equal(e?.code, 403, JSON.stringify(changes));
      assert.equal(e.defect, "the human answers the likeness question through a GitHub sign-in, never through a key", "D2's words");
      assert.match(e.hint, /\/oauth\/likeness\?household=ember-lane in a browser/, "pointed at the signed-in form's own link");
      assert.match(e.hint, /Nothing in this request was kept/);
      assert.equal(/send the Hearth alone/.test(e.hint), Object.hasOwn(changes, "hearth"), "the Hearth's road is named only when one was sent");
    }
    assert.equal(read, 0, "refused before the record was read");
    assert.deepEqual(pool.state.households, before, "nothing kept: not the answer, not the valid Hearth beside it");
    assert.deepEqual(seen, [], "and nothing drained");
    // the default is the bearer's: only an explicit browserSignIn: true (the form) reaches the writer
    await assert.rejects(changeSettings({ slug: "ember-lane", changes: { likeness: "yes" }, ghId: KEEPER.id, ghLogin: KEEPER.login }, { clone: hearthClone() }), (x) => x.code === 403);
    // the Hearth alone is the bearer's to change, as it always was
    await change({ hearth: "ledger" }, KEEPER, "ember-lane", { browserSignIn: false });
    assert.equal(rowOf(pool).hearth, "ledger");
    assert.equal(rowOf(pool).likeness ?? null, null, "and the answer is still unanswered");
  });
});

test("§ 2 the Hearth is written FIRST: if its store refuses (migration 093 not on this store), the likeness answer beside it is not kept either", async () => {
  await withStore(async (pool) => {
    const before = structuredClone(pool.state.households);
    await assert.rejects(change({ likeness: "yes", hearth: "ledger" }, KEEPER, "ember-lane", { writeHearth: async () => ({ missingColumn: true }) }), (e) => e.code === 503);
    assert.deepEqual(pool.state.households, before);
  });
});

// ── § 3 the aliases and the canonical door agree ────────────────────────────

test("§ 3 THE OLD WRITERS AND THE ONE DOOR KEEP THE SAME ANSWER: the same request leaves the same record, and each alias answers in its old shape", async () => {
  const viaOld = await withStore(async (pool) => {
    await chooseHearth({ slug: "ember-lane", hearth: "ledger", ghId: KEEPER.id, ghLogin: KEEPER.login }, { clone: hearthClone(), drain: drained() });
    await setLikeness({ slug: "ember-lane", answer: "yes", ghId: KEEPER.id, ghLogin: KEEPER.login }, { drain: drained(), now: AT });
    return structuredClone(pool.state.households);
  });
  const viaDoor = await withStore(async (pool) => {
    await change({ hearth: "ledger", likeness: "yes" });
    return structuredClone(pool.state.households);
  });
  assert.deepEqual(viaDoor, viaOld, "the canonical door and the two old writers saved the same answer");

  await withStore(async () => {
    const legacyH = await chooseHearth({ slug: "ember-lane", hearth: "orchard", ghId: KEEPER.id, ghLogin: KEEPER.login }, { clone: hearthClone(), drain: drained() });
    const aliasH = (await changeSettings({ slug: "ember-lane", changes: { hearth: "orchard" }, ghId: KEEPER.id, ghLogin: KEEPER.login }, { clone: hearthClone(), drain: drained(), alias: "hearth" })).parts.hearth;
    assert.deepEqual(aliasH, legacyH, "the Hearth alias answers in the Hearth writer's own shape");
    const legacyL = await setLikeness({ slug: "ember-lane", answer: "no", ghId: KEEPER.id, ghLogin: KEEPER.login }, { drain: drained(), now: AT });
    const aliasL = (await changeSettings({ slug: "ember-lane", changes: { likeness: "no" }, ghId: KEEPER.id, ghLogin: KEEPER.login }, { drain: drained(), now: AT, alias: "likeness", browserSignIn: true })).parts.likeness;
    assert.deepEqual(aliasL, legacyL, "the likeness alias answers in the likeness writer's own shape");
  });

  // the old doors' own refusal words are kept through the alias
  await withStore(async () => {
    const words = async (p) => p.then(() => null, (e) => [e.code, e.defect, e.hint]);
    const old = { h: (o) => chooseHearth({ slug: "frost-hall", hearth: "ledger", ghId: KEEPER.id, ghLogin: "x" }, { clone: hearthClone(), drain: drained(), ...o }),
                  l: () => setLikeness({ slug: "frost-hall", answer: "yes", ghId: KEEPER.id, ghLogin: "x" }, { drain: drained() }) };
    const al = { h: () => changeSettings({ slug: "frost-hall", changes: { hearth: "ledger" }, ghId: KEEPER.id, ghLogin: "x" }, { clone: hearthClone(), drain: drained(), alias: "hearth" }),
                 l: () => changeSettings({ slug: "frost-hall", changes: { likeness: "yes" }, ghId: KEEPER.id, ghLogin: "x" }, { drain: drained(), alias: "likeness", browserSignIn: true }) };
    assert.deepEqual(await words(al.h()), await words(old.h()), "an account the house does not bind: the Hearth door's own words");
    assert.deepEqual(await words(al.l()), await words(old.l()), "…and the likeness answer's own words");
  });
});

test("§ 3 the read is declared where the household door's reads are, read-only: no write verb carries settings", () => {
  assert.ok(Object.hasOwn(HOUSEHOLD_READS, "settings"));
  assert.deepEqual(HOUSEHOLD_READ_FIELDS.settings, {}, "it takes no field: the caller's own house");
  // POS-1023 (residents writing settings) is NOT built: nothing in the household act list takes a setting
  const src = readFileSync(join(ROOT, "src", "household-apex.mjs"), "utf8");
  assert.doesNotMatch(src, /do: "(set-settings|change-settings|set-likeness|set-hearth|choose-hearth)"/);
});

// ── § 4 the door, on a booted office ────────────────────────────────────────

test("§ 4 the routes: GET/PATCH /households/<slug>/settings for the human; the agent's key, another house and a resident key cannot; no bearer answers likeness, the form does; the old Hearth route is an alias; the MCP read cannot write", async () => {
  const clone = hearthClone(["default", "ledger", "orchard"], "door-clone");
  mkdirSync(join(clone, "tools"), { recursive: true });
  const printed = renderRegistry(seed());
  writeFileSync(join(clone, "tools", "households.json"), printed.households);
  writeFileSync(join(clone, "tools", "github-ids.json"), printed.pins);
  const git = (...a) => execFileSync("git", ["-C", clone, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("-c", "user.name=test", "-c", "user.email=test@example.invalid", "add", "-A");
  git("-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-qm", "the registry");

  const ix = await indexStore(fixtureTown(), { db: "settings_door" });
  CLEANUP.push(() => ix.stop());
  await seedRegistry(ix.store, REGISTRY, PINS);
  {
    const c = await ix.store.connect("world2_owner");
    const landed = git("rev-parse", "HEAD").trim();
    try { for (const h of ["ash", "birch"]) await c.query("INSERT INTO ashore (handle, at, sha, road) VALUES ($1, now(), $2, 'declare')", [h, landed]); }
    finally { await c.end(); }
  }
  const KEYS = { B: "settings-key-b", R: "settings-key-resident" };
  const oauthPath = seedStaticKeys(join(TMP, "oauth-door.db"), `${KEYS.B}=frost-hall#${STRANGER.id}:fern;${KEYS.R}=ember-lane:ash`);
  const minted = openOauthDb(oauthPath);
  KEYS.AGENT = await mintHouseholdKey(minted, KEEPER.id, KEEPER.login, { claimedHandle: "ash", cosignedBy: { id: KEEPER.id, login: KEEPER.login } });
  KEYS.HUMAN = await mintHouseholdKey(minted, KEEPER.id, KEEPER.login);
  // the human's OAuth access token, as an MCP connector holds it (issueTokens' row): a bearer with the same bound account
  KEYS.ACCESS = "settings-access-token";
  const t = Math.floor(Date.now() / 1000);
  minted.prepare("INSERT INTO tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created) VALUES (?, 'access', ?, ?, 'test-connector', ?, ?)")
    .run(sha256(KEYS.ACCESS), KEEPER.id, KEEPER.login, t + 3600, t);
  minted.close();
  // GitHub, mocked, for the likeness form's sign-in (the browser's road)
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
    if (url.pathname === "/user") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(KEEPER)); }
    res.writeHead(404); res.end();
  });
  await new Promise((ok) => gh.listen(0, "127.0.0.1", ok));
  CLEANUP.push(() => new Promise((ok) => gh.close(ok)));
  const GH = `http://127.0.0.1:${gh.address().port}`;
  const { child, port } = await bootOnFreePort((p) => spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(p), "--oauth-db", oauthPath], {
    env: { ...process.env, WORLD2_PG: ix.env.WORLD2_PG, WORLD2_PG_URL: ix.env.WORLD2_PG_URL, TOWN_INDEX_READS: ix.env.TOWN_INDEX_READS ?? "",
      TOWN_CLONE: clone, TOWN_PUSH: "", OFFICE_READ_WORKERS: "0", WORLD_GRAPH_NONE: "1", OFFICE_KEYS: "", PUBLIC_BASE: `http://127.0.0.1:${p}`,
      POSTMARK_OAUTH_GITHUB_CLIENT_ID: "mock-gh-app", POSTMARK_OAUTH_GITHUB_CLIENT_SECRET: "mock-gh-secret",
      GITHUB_AUTH_URL: `${GH}/login/oauth/authorize`, GITHUB_TOKEN_URL: `${GH}/login/oauth/access_token`, GITHUB_API_URL: GH,
      GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.invalid" },
    stdio: ["ignore", "pipe", "pipe"],
  }));
  CLEANUP.push(async () => { if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; } });
  const base = `http://127.0.0.1:${port}`;
  const call = (method, path, key, body) => fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const patch = (path, key, body) => call("PATCH", path, key, body);
  const S = "/households/ember-lane/settings";
  const fresh = { household: "ember-lane", likeness: { answer: null, effective: "not given" }, hearth: { choice: null, effective: "default" } };

  // the read: the signed-in human only
  assert.equal((await call("GET", S, null)).status, 401, "no credential");
  assert.equal((await call("GET", S, KEYS.B)).status, 403, "another house's human");
  assert.equal((await call("GET", S, KEYS.AGENT)).status, 403, "an agent's own key reads at household { read: \"settings\" }");
  assert.equal((await call("GET", S, KEYS.R)).status, 403, "a resident key");
  const first = await call("GET", S, KEYS.HUMAN);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body, fresh);

  // the write: refusals keep nothing
  for (const [who, key, code] of [["no key", null, 401], ["a resident key", KEYS.R, 403], ["another house", KEYS.B, 403], ["an agent's own key", KEYS.AGENT, 403]])
    assert.equal((await patch(S, key, { likeness: "yes", hearth: "ledger" })).status, code, who);
  const byAgent = await patch(S, KEYS.AGENT, { likeness: "yes" });
  assert.match(byAgent.body.defect, /changed by the household's human/); assert.match(byAgent.body.hint, /an agent's own/);
  assert.equal((await patch(S, KEYS.HUMAN, { hearth: "nope" })).status, 422, "an unregistered Hearth");
  assert.equal((await patch(S, KEYS.HUMAN, {})).status, 422);
  assert.equal((await patch("/households/no-such-house/settings", KEYS.HUMAN, { hearth: "ledger" })).status, 404, "a house the town does not keep");

  // D2 at this door: the human's own household key AND an access token are refused the likeness answer, the whole request with it, the Hearth beside it untouched
  const onFile = () => JSON.parse(readFileSync(join(clone, "tools", "households.json"), "utf8")).households["ember-lane"];
  for (const [who, key] of [["the human's household key", KEYS.HUMAN], ["the human's access token", KEYS.ACCESS]]) {
    assert.equal((await call("GET", S, key)).status, 200, `${who} still reads the values`);
    for (const body of [{ likeness: "yes" }, { likeness: "yes", hearth: "ledger" }]) {
      const r = await patch(S, key, body);
      assert.equal(r.status, 403, `${who} ${JSON.stringify(body)}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.defect, "the human answers the likeness question through a GitHub sign-in, never through a key");
      assert.match(r.body.hint, new RegExp(`${base.replace(/[.]/g, "\\.")}/oauth/likeness\\?household=ember-lane in a browser`), "pointed at the form");
    }
  }
  assert.deepEqual((await call("GET", S, KEYS.HUMAN)).body, fresh, "so nothing was kept: no answer, and not the valid Hearth beside it");
  assert.equal(onFile().likeness, undefined, "no consent on the town's record");
  assert.equal(onFile().hearth ?? null, null);

  // the write: the human's Hearth, through this door, with either bearer, as the Hearth door always took it
  const hearthOnly = await patch(S, KEYS.HUMAN, { hearth: "ledger" });
  assert.equal(hearthOnly.status, 200, JSON.stringify(hearthOnly.body));
  assert.deepEqual(hearthOnly.body.settings, { household: "ember-lane", likeness: { answer: null, effective: "not given" }, hearth: { choice: "ledger", effective: "ledger" } });
  assert.deepEqual(hearthOnly.body.changed, ["hearth"]);
  assert.equal(hearthOnly.body.parts, undefined, "the canonical answer carries the settings, not the writers' own shapes");
  assert.equal(onFile().hearth, "ledger");
  assert.equal((await patch(S, KEYS.ACCESS, { hearth: "ledger" })).status, 200, "the access token chooses the Hearth too, as at the Hearth door");

  // the likeness answer's one road: the signed-in browser form, an alias of the same door, records consent as it always did
  const r1 = await fetch(`${base}/oauth/likeness?household=ember-lane`, { redirect: "manual" });
  assert.equal(r1.status, 302);
  const r2 = await fetch(r1.headers.get("location"), { redirect: "manual" });
  const formHtml = await (await fetch(r2.headers.get("location"))).text();
  const form = { pending_id: /name="pending_id" value="([^"]+)"/.exec(formHtml)?.[1], nonce: /name="nonce" value="([^"]+)"/.exec(formHtml)?.[1] };
  assert.ok(form.pending_id && form.nonce, formHtml.slice(0, 300));
  const answered = await fetch(`${base}/oauth/consent`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...form, decision: "yes" }) });
  assert.equal(answered.status, 200, (await answered.clone().text()).slice(0, 300));
  assert.match(await answered.text(), /Your answer is <strong>yes<\/strong>/);
  assert.equal(onFile().likeness.answer, "yes"); assert.equal(onFile().likeness.by, KEEPER.login);
  assert.equal(onFile().hearth, "ledger", "the form's answer left the Hearth alone");
  assert.deepEqual((await call("GET", S, KEYS.HUMAN)).body, { household: "ember-lane", likeness: { answer: "yes", effective: "given" }, hearth: { choice: "ledger", effective: "ledger" } },
    "the canonical read sees what the form saved");
  assert.equal((await patch(S, KEYS.HUMAN, { likeness: "no" })).status, 403, "and a key still cannot take it back: that too is the form's");
  assert.equal(onFile().likeness.answer, "yes");

  // the OLD Hearth route is an alias: its caller contract is unchanged (its shape, its words) and it reaches the same record
  const old = await patch("/households/ember-lane/hearth", KEYS.HUMAN, { hearth: "orchard" });
  assert.equal(old.status, 200, JSON.stringify(old.body));
  assert.deepEqual(Object.keys(old.body).sort(), ["commit", "hearth", "household", "registry"], "the Hearth route still answers in its own shape");
  assert.equal(old.body.hearth, "orchard");
  assert.deepEqual((await call("GET", S, KEYS.HUMAN)).body, { household: "ember-lane", likeness: { answer: "yes", effective: "given" }, hearth: { choice: "orchard", effective: "orchard" } },
    "the canonical read sees what the alias saved, and the alias did not touch the answer");
  assert.equal((await patch("/households/ember-lane/hearth", KEYS.AGENT, { hearth: "ledger" })).status, 403, "the alias still refuses an agent's key");
  assert.match((await patch("/households/ember-lane/hearth", KEYS.AGENT, { hearth: "ledger" })).body.defect, /a Hearth is chosen by the household's human/, "in its own words");
  assert.equal((await patch("/households/ember-lane/hearth", KEYS.HUMAN, {})).status, 422);
  const noHearthKey = await patch("/households/ember-lane/hearth", KEYS.HUMAN, { hearth: "bad one" });
  assert.equal(noHearthKey.status, 422);

  // the MCP/household read: the agent's own house, the values only, and no write rides it
  const agentRead = await call("GET", "/household?read=settings", KEYS.AGENT);
  assert.equal(agentRead.status, 200, JSON.stringify(agentRead.body));
  assert.deepEqual(agentRead.body, { household: "ember-lane", likeness: { answer: "yes", effective: "given" }, hearth: { choice: "orchard", effective: "orchard" } });
  assert.doesNotMatch(JSON.stringify(agentRead.body), /8101|ember-gh|gh_id|"at"|"by"|words/, "no human's identity and no consent audit");
  const agentWrite = await call("POST", "/household", KEYS.AGENT, { do: "settings", args: { likeness: "no" } });
  assert.notEqual(agentWrite.status, 200, "there is no settings act");
  assert.deepEqual((await call("GET", S, KEYS.HUMAN)).body.likeness, { answer: "yes", effective: "given" }, "the answer is as the human left it");
  assert.equal((await call("GET", "/household?read=settings", KEYS.B)).body.household, "frost-hall", "another house's key reads its own, never ember-lane's");
});
