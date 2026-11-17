// human-profile.test.mjs — POS-721, small: the household's human's town name, short line and pronouns.
//
// LAW (Wright, settled 2026-11-06 00:51:44Z): "three optional fields on the household's human: a town
// name, a short line and pronouns. The human sets them by their own act on the site, and the public reads
// show them ("by <alias> for rei"). No real-world name is stored."
// RULED (Darko, 2026-11-17 00:31Z): POS-721/b "DARKO (Starforge) is fine": the house is said beside the town
// name; POS-721/c "Human only, like likeness": a browser sign-in form, never a key, an access token included.
//
// Every house, handle, login, id, token and name here is INVENTED.
//
//   § 1  the record: the tail column renders in template order when set and is no key at all when not
//   § 1b the public print (POS-845's named list): the profile is named, cut to its three text fields,
//        and the private name stays off it
//   § 2  the fields: judged as the resident's profile door judges its own, one line of text, and no
//        text-direction control
//   § 2b the writer's refusals, in order: any caller but the browser form (403), the fields, then no
//        such house (404), an unbound account (403), and a store without 098 (503), each keeping nothing
//   § 3  the store write, on a real Postgres: merge, clear, nothing left is NULL, another house's
//        account writes nothing, 098's shape refuses anything else, and the landed probe answers
//   § 4  the reads: every phrase that names the house's human says the town name, with the house beside it
//   § 5  on a booted office: every key at PATCH /households/{slug}/human is refused (a household key AND
//        a signed-in access token) and pointed at the form; the form refuses another house's account,
//        shows the house's own its fields, saves and clears; the town's file, GET /households, the
//        glance and the happened reads follow, and the private name is in none of them
//
//   node --test test/human-profile.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";

import { rowsFromRegistry, renderRegistry, renderPublicRegistry, registryFromRows, HOUSEHOLD_KEYS, HUMAN_PROFILE_KEYS } from "../src/registry-rows.mjs";
import { publicHouse } from "../src/registry-public.mjs";
import { judgeHumanProfile, setHumanProfile, HUMAN_PROFILE_CAPS } from "../src/human-profile.mjs";
import { setHouseholdHumanProfile, loadRegistryRows } from "../src/registry-store.mjs";
import { humanPhrase, happenedRow, happenedKey } from "../src/household-read-v2.mjs";
import { landedIn } from "../world2/tools/migrations-landed.mjs";
import { fixtureTown } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";
import { indexStore, seedRegistry, recordInProcess } from "./helpers/office-under-test.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "postmark-human-profile-"));
const CLEANUP = [];
after(async () => {
  for (const f of CLEANUP.reverse()) await f().catch(() => {});
  rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const KEEPER = { login: "lr-keeper-gh", id: 9201 };
const STRANGER = { login: "uh-stranger-gh", id: 9203 };
// The private-name column's invented value (019's `human`). Nothing this change answers or reads may carry it.
const PRIVATE_NAME = "Avery Realname-Quill";
const REGISTRY = { schema_version: 1, note: "invented for POS-721", households: {
  "lantern-row": { name: "Lantern Row", human: PRIVATE_NAME, since: "2026-08-01", declared_by: "postmaster",
    accounts: [KEEPER], residents: ["postmaster", "wright"] },
  "unnamed-hall": { since: "2026-08-03", declared_by: "limen", accounts: [STRANGER], residents: ["limen"] },
} };
const PINS = {
  postmaster: { login: KEEPER.login, id: KEEPER.id, pinned: "2026-08-01" },
  wright: { login: KEEPER.login, id: KEEPER.id },
  limen: { login: STRANGER.login, id: STRANGER.id },
};
const seed = () => rowsFromRegistry(structuredClone(REGISTRY), structuredClone(PINS));
const FULL = { town_name: "DARKO", short_line: "builds lanterns", pronouns: "he/him" };

test("§ 1 human_profile is the tail column; nothing set renders no key, a set profile renders in template order and folds back", () => {
  assert.equal(HOUSEHOLD_KEYS.at(-1), "human_profile");
  assert.deepEqual(HUMAN_PROFILE_KEYS, ["town_name", "short_line", "pronouns"]);
  const rows = seed();
  assert.ok(!renderRegistry(rows).households.includes("human_profile"), "no house has one: the file carries no key, so the first crossing rewrites nothing");
  // the store hands jsonb back key-sorted (by length, then bytes); the file's order is the template's
  rows.households.find((h) => h.slug === "lantern-row").human_profile = { pronouns: "he/him", town_name: "DARKO", short_line: "builds lanterns" };
  const printed = renderRegistry(rows).households;
  const block = printed.slice(printed.indexOf('"human_profile"'));
  assert.ok(block.indexOf('"town_name"') < block.indexOf('"short_line"') && block.indexOf('"short_line"') < block.indexOf('"pronouns"'), block.slice(0, 160));
  assert.deepEqual(registryFromRows(rows).households["lantern-row"].human_profile, FULL);
  // the file and the store fold alike: the printed profile reads back into the same row
  assert.deepEqual(rowsFromRegistry(JSON.parse(printed), structuredClone(PINS)).households.find((h) => h.slug === "lantern-row").human_profile, FULL);
});

test("§ 1b the public print names the profile (POS-845's named list): cut to its three text fields, in template order, and the private name is never on it", () => {
  const rows = seed();
  assert.ok(!renderPublicRegistry(rows).households.includes("human_profile"), "nothing set: the public file carries no key, as before");
  rows.households.find((h) => h.slug === "lantern-row").human_profile = { pronouns: "he/him", town_name: "DARKO", short_line: "builds lanterns" };
  const printed = renderPublicRegistry(rows).households;
  const house = JSON.parse(printed).households["lantern-row"];
  // LAW (Wright, settled 2026-11-06): "the public reads show them"
  assert.deepEqual(house.human_profile, FULL, "the public print carries the profile the human set");
  assert.deepEqual(Object.keys(house.human_profile), ["town_name", "short_line", "pronouns"], "in the template's order");
  assert.ok(!printed.includes(PRIVATE_NAME), "and never the private name");
  assert.equal(Object.hasOwn(house, "human"), false);
  // the public file folds back to the same row, so the drain's law (public render of the files' rows === the files) holds
  assert.equal(renderPublicRegistry(rowsFromRegistry(JSON.parse(printed), structuredClone(PINS))).households, printed);
  // a value outside the writer's shape is not carried: other keys, non-text, empty text, or no object at all
  assert.deepEqual(publicHouse({ name: "X", human_profile: { town_name: "DARKO", real_name: "Avery", pronouns: 7, short_line: "" } }).human_profile, { town_name: "DARKO" });
  assert.equal(Object.hasOwn(publicHouse({ name: "X", human_profile: { pronouns: null } }), "human_profile"), false, "nothing left: no key");
  assert.equal(Object.hasOwn(publicHouse({ name: "X", human_profile: "DARKO" }), "human_profile"), false, "not an object: no profile");
});

test("§ 2 the fields are judged as the resident's profile door judges its own: text, trimmed, capped in code points, one line; an empty string clears; nothing else is a field", () => {
  const refused = (body, re) => assert.throws(() => judgeHumanProfile(body), (e) => e.code === 422 && re.test(e.defect), JSON.stringify(body));
  assert.deepEqual(judgeHumanProfile({ town_name: "  DARKO  ", pronouns: "" }), { set: { town_name: "DARKO" }, clear: ["pronouns"] });
  assert.deepEqual(judgeHumanProfile({ short_line: "   " }), { set: {}, clear: ["short_line"] }, "whitespace alone is a clear, as at the resident's door");
  refused({}, /^send at least one of town_name, short_line, pronouns$/);
  refused({ name: "Avery" }, /^name is not a field of the human's profile$/);
  refused({ town_name: "DARKO", human: "Avery" }, /^human is not a field of the human's profile$/);
  refused({ town_name: 7 }, /^town_name must be text$/);
  refused({ short_line: "two\nlines" }, /^short_line is one line$/);
  refused({ short_line: "two\r\nlines" }, /^short_line is one line$/);
  // one line means no control character and no line or paragraph separator either: each would break the phrase that says the name
  refused({ town_name: "DAR\tKO" }, /^town_name is one line$/);
  const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);   // built, so the source holds no raw separator
  refused({ town_name: `DARKO${LS}Row` }, /^town_name is one line$/);
  refused({ pronouns: `he${PS}him` }, /^pronouns is one line$/);
  refused({ town_name: "DAR\u0000KO" }, /^town_name is one line$/);
  assert.deepEqual(judgeHumanProfile({ town_name: "Ðárkø the Lamplighter" }).set, { town_name: "Ðárkø the Lamplighter" }, "letters of any script are one line");
  // THE TEXT-DIRECTION CONTROLS, refused by name, every one of them (U+202A to U+202E, U+2066 to U+2069): one at the end of a
  // town name would turn the rest of "by … for rei" around wherever bidi is honoured. Built from code points, never typed raw.
  const turns = [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
  for (const n of turns) refused({ town_name: `DARKO${String.fromCharCode(n)}` }, /^town_name carries a text-direction control$/);
  refused({ short_line: `a ${String.fromCharCode(0x202e)}line` }, /^short_line carries a text-direction control$/);
  // the neighbours stay: the marks just outside both ranges, and the zero-width joiner that holds an emoji family together
  // (just below U+202A is U+2029, the paragraph separator, which the one-line rule already refuses)
  for (const n of [0x2064, 0x2065, 0x206a])
    assert.equal(judgeHumanProfile({ town_name: `DARKO${String.fromCharCode(n)}` }).set.town_name.length, 6, n.toString(16));
  const family = ["👩", "👧"].join(String.fromCharCode(0x200d));
  assert.deepEqual(judgeHumanProfile({ town_name: `DARKO ${family}` }).set, { town_name: `DARKO ${family}` }, "a ZWJ emoji is one line");
  refused({ town_name: "x".repeat(73) }, /^town_name is longer than 72 characters$/);
  assert.equal(judgeHumanProfile({ town_name: "x".repeat(72) }).set.town_name.length, 72);
  refused({ short_line: "y".repeat(241) }, /^short_line is longer than 240 characters$/);
  // counted in code points, as the resident's door counts them: 56 moons are 56 characters, not 112
  assert.equal([...judgeHumanProfile({ pronouns: "🌙".repeat(56) }).set.pronouns].length, 56);
  refused({ pronouns: "🌙".repeat(57) }, /^pronouns is longer than 56 characters$/);
  refused(null, /one JSON object/);
  refused(["DARKO"], /one JSON object/);
  assert.deepEqual(HUMAN_PROFILE_CAPS, { town_name: 72, short_line: 240, pronouns: 56 });
});

test("§ 2b the writer refuses in order, keeping nothing: any caller but the browser form first, the fields before the record is read, then no such house 404, an unbound account 403, a store without 098 503", async () => {
  const calls = [];
  const loadRows = async () => { calls.push("read"); return seed(); };
  const write = async (w) => { calls.push(`write ${w.slug}`); return { slug: w.slug, human_profile: w.set }; };
  const drain = async () => { calls.push("drain"); return { ran: true, commit: "c0ffee" }; };
  const io = { loadRows, write, drain, clone: null, browserSignIn: true };
  const refusal = async (args, code, re, deps = io) => {
    calls.length = 0;
    await assert.rejects(setHumanProfile(args, deps), (e) => e.code === code && re.test(e.defect), JSON.stringify(args));
    return [...calls];
  };
  // LAW (POS-721/c, Darko 2026-11-17: "Human only, like likeness"): only the office's browser sign-in form sets it. Any other caller,
  // even with a bound account and a good body, is refused before anything is read, and pointed at the form.
  const NOT_BY_KEY = /^the household's human sets their profile through a GitHub sign-in, never through a key$/;
  for (const deps of [{ ...io, browserSignIn: false }, { loadRows, write, drain, clone: null }, { ...io, browserSignIn: "true" }])
    assert.deepEqual(await refusal({ slug: "lantern-row", body: FULL, ghId: KEEPER.id }, 403, NOT_BY_KEY, deps), [], "refused before the record is read");
  await assert.rejects(setHumanProfile({ slug: "lantern-row", body: FULL, ghId: KEEPER.id }, { loadRows, write, drain }),
    (e) => /\/oauth\/human\?household=lantern-row/.test(e.hint), "the refusal names the form");
  // the fields are judged first: a bad body never reads the record
  assert.deepEqual(await refusal({ slug: "lantern-row", body: { name: "Avery" }, ghId: KEEPER.id }, 422, /^name is not a field/), []);
  assert.deepEqual(await refusal({ slug: "lantern-row", body: FULL, ghId: null }, 401, /^no signed-in account$/), []);
  // the record: no such house, and a house this account does not keep, are refused before any write
  assert.deepEqual(await refusal({ slug: "no-such-house", body: FULL, ghId: KEEPER.id }, 404, /^no household "no-such-house"$/), ["read"]);
  assert.deepEqual(await refusal({ slug: "lantern-row", body: FULL, ghId: STRANGER.id }, 403, /^this account does not keep "lantern-row"$/), ["read"]);
  // a store without the column: the write answers missingColumn, and nothing is drained
  const noColumn = { ...io, write: async () => { calls.push("write"); return { missingColumn: true }; } };
  assert.deepEqual(await refusal({ slug: "lantern-row", body: FULL, ghId: KEEPER.id }, 503, /^the human's profile is not on this store yet$/, noColumn), ["read", "write"]);
  // the record unbinds between the read and the write: the statement's own binding answers no row, and nothing is drained
  const raced = { ...io, write: async () => { calls.push("write"); return { slug: null }; } };
  assert.deepEqual(await refusal({ slug: "lantern-row", body: FULL, ghId: KEEPER.id }, 403, /^this account does not keep "lantern-row"$/, raced), ["read", "write"]);
  // and the control: the bound account's request reads, writes and drains, in that order
  calls.length = 0;
  const done = await setHumanProfile({ slug: "lantern-row", body: FULL, ghId: KEEPER.id }, io);
  assert.deepEqual(calls, ["read", "write lantern-row", "drain"]);
  assert.deepEqual(done, { household: "lantern-row", human_profile: FULL, registry: { rendered: true }, commit: "c0ffee" });
});

test("§ 3 on a real Postgres: one statement merges and clears, a profile left empty is NULL, another house's account writes nothing, the private name is untouched, and 098's shape refuses anything else", async () => {
  const ix = await indexStore(null, { db: "human_profile_store" });
  CLEANUP.push(() => ix.stop());
  await seedRegistry(ix.store, REGISTRY, PINS);
  const restore = await recordInProcess(ix.store);
  CLEANUP.push(restore);
  const house = async () => (await loadRegistryRows()).households.find((h) => h.slug === "lantern-row");
  assert.equal((await house()).human_profile ?? null, null, "seeded: nothing set");

  assert.deepEqual(await setHouseholdHumanProfile({ slug: "lantern-row", set: { town_name: "DARKO", pronouns: "he/him" }, clear: [], ghId: KEEPER.id }),
    { slug: "lantern-row", human_profile: { town_name: "DARKO", pronouns: "he/him" } });
  // a second change names two fields: the one nobody named keeps its value
  await setHouseholdHumanProfile({ slug: "lantern-row", set: { short_line: "builds lanterns" }, clear: ["pronouns"], ghId: KEEPER.id });
  assert.deepEqual((await house()).human_profile, { town_name: "DARKO", short_line: "builds lanterns" });
  // another house's account: no row, and nothing changed
  assert.deepEqual(await setHouseholdHumanProfile({ slug: "lantern-row", set: { town_name: "MALLORY" }, clear: [], ghId: STRANGER.id }), { slug: null });
  assert.deepEqual((await house()).human_profile, { town_name: "DARKO", short_line: "builds lanterns" });
  // clearing what is left stores NULL, never {}
  assert.deepEqual(await setHouseholdHumanProfile({ slug: "lantern-row", set: {}, clear: ["town_name", "short_line"], ghId: KEEPER.id }),
    { slug: "lantern-row", human_profile: null });
  assert.equal((await house()).human_profile ?? null, null);
  // the private name is its own column, and no write here touched it
  assert.equal((await house()).human, PRIVATE_NAME);

  const pen = await ix.store.connect("office_api");
  try {
    // 098's shape, as the office's own pen: nothing but the three fields, each a string, and never an empty object
    for (const bad of ["{}", '{"name": "Avery"}', '{"town_name": 7}', "[]", '"DARKO"'])
      await assert.rejects(pen.query("UPDATE households SET human_profile = $1::jsonb WHERE slug = 'lantern-row'", [bad]), (e) => e.code === "23514", bad);
    await pen.query(`UPDATE households SET human_profile = '{"pronouns": "they/them"}'::jsonb WHERE slug = 'lantern-row'`);
    // the landed probe reads this store's 098 as landed
    const [r] = await landedIn((q) => pen.query(q), ["098_household_human_profile.sql"]);
    assert.deepEqual(r, { file: "098_household_human_profile.sql", state: "landed" });
  } finally { await pen.end(); }

  // A STORE WITHOUT 098 (the code can deploy before the box migration): the column taken off this test store by its owner.
  // Every registry read still answers, the house reading "nothing set", and the writer answers missingColumn rather than throwing.
  const own = await ix.store.connect("world2_owner");
  try { await own.query("ALTER TABLE households DROP COLUMN human_profile"); } finally { await own.end(); }
  const before098 = await house();
  assert.equal(before098.slug, "lantern-row", "the registry read answers on a store without 098");
  assert.equal(before098.human_profile ?? null, null, "and reads nothing set");
  assert.deepEqual(await setHouseholdHumanProfile({ slug: "lantern-row", set: { town_name: "DARKO" }, clear: [], ghId: KEEPER.id }), { missingColumn: true });
});

test("§ 4 every phrase that names the house's human says the town name with the house beside it when set, and the house's words when not", () => {
  assert.equal(humanPhrase("Lantern Row"), "Lantern Row's human", "unchanged with nothing set");
  assert.equal(humanPhrase("Lantern Row", null, { forWhom: "wright" }), "Lantern Row's human for wright");
  assert.equal(humanPhrase("Lantern Row", FULL), "DARKO (he/him), Lantern Row's human");
  // LAW (POS-721/b, Darko 2026-11-17 00:31Z): "DARKO (Starforge) is fine": the "for" phrase says the house beside the town name
  assert.equal(humanPhrase("Lantern Row", FULL, { forWhom: "wright" }), "DARKO (Lantern Row) for wright", "the house told apart, as ruled");
  assert.equal(humanPhrase("Starforge", { town_name: "DARKO" }, { forWhom: "rei" }), "DARKO (Starforge) for rei", "the ruling's own example, whole");
  // two humans who both call themselves DARKO read differently in every phrase
  assert.notEqual(humanPhrase("Lantern Row", { town_name: "DARKO" }, { forWhom: "rei" }), humanPhrase("Starforge", { town_name: "DARKO" }, { forWhom: "rei" }));
  assert.notEqual(humanPhrase("Lantern Row", { town_name: "DARKO" }), humanPhrase("Starforge", { town_name: "DARKO" }));
  assert.equal(humanPhrase("Lantern Row", { town_name: "DARKO" }), "DARKO, Lantern Row's human", "no pronouns, no brackets");
  assert.equal(humanPhrase("Lantern Row", { pronouns: "he/him", short_line: "hi" }), "Lantern Row's human", "pronouns and a line alone name no one");
  // a house with no display name is said by its slug once a town name is set; with nothing set, its words are as before
  assert.equal(humanPhrase(null, FULL, { houseSlug: "unnamed-hall" }), "DARKO (he/him), unnamed-hall's human");
  assert.equal(humanPhrase(null, FULL, { forWhom: "limen", houseSlug: "unnamed-hall" }), "DARKO (unnamed-hall) for limen");
  assert.equal(humanPhrase(null, null, { forWhom: "limen", houseSlug: "unnamed-hall" }), "the house's human for limen", "nothing set: exactly as before");
  // the happened read, from the record's own hand and for (079), and from a row before it
  const atTheWheel = { actor: "wright", hand: "human", for_handle: "wright", route: "site", action: "say", at: "2026-11-06T00:00:00Z" };
  assert.equal(happenedRow(atTheWheel, { houseName: "Lantern Row", human: FULL }).by, "DARKO (Lantern Row) for wright");
  assert.equal(happenedRow(atTheWheel, { houseName: "Lantern Row" }).by, "Lantern Row's human for wright");
  assert.equal(happenedRow({ actor: "human-of-lantern-row", action: "say" }, { houseName: "Lantern Row", human: FULL }).by, "DARKO (he/him), Lantern Row's human");
  assert.equal(happenedRow({ actor: "wright", hand: "wright", for_handle: "wright", action: "say" }, { houseName: "Lantern Row", human: FULL }).by, "wright",
    "a resident's own act names the resident");
  assert.equal(happenedKey("Lantern Row"), "by <resident> · by Lantern Row's human (acting themselves) · by Lantern Row's human for <resident> (at its wheel)");
  assert.equal(happenedKey("Lantern Row", FULL), "by <resident> · by DARKO (he/him), Lantern Row's human (acting themselves) · by DARKO (Lantern Row) for <resident> (at its wheel)");
  assert.equal(happenedRow(atTheWheel, { houseName: null, human: FULL, houseSlug: "lantern-row" }).by, "DARKO (lantern-row) for wright", "happenedRow carries the slug through");
});

test("§ 5 on a booted office: no key at PATCH sets it (a household key and a signed-in access token alike); the browser form refuses another house's account, saves and clears for the house's own, and every read follows without the private name", async () => {
  // GitHub, stood in: the sign-in answers as whoever `identity` names, as the likeness form's test does
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

  // the town clone the drain prints into: a real git repo holding today's files, so a commit is the instrument
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

  const ix = await indexStore(fixtureTown(), { db: "human_profile_door" });
  CLEANUP.push(() => ix.stop());
  await seedRegistry(ix.store, REGISTRY, PINS);
  const oauthDb = join(TMP, "oauth.db");
  const { child, port } = await bootOnFreePort((p) => spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(p), "--oauth-db", oauthDb], {
    env: { ...process.env, WORLD2_PG: ix.env.WORLD2_PG, WORLD2_PG_URL: ix.env.WORLD2_PG_URL, TOWN_INDEX_READS: ix.env.TOWN_INDEX_READS ?? "",
      TOWN_CLONE: clone, TOWN_PUSH: "", OFFICE_READ_WORKERS: "0", WORLD_GRAPH_NONE: "1", OFFICE_KEYS: "", PUBLIC_BASE: `http://127.0.0.1:${p}`,
      POSTMARK_OAUTH_GITHUB_CLIENT_ID: "mock-gh-app", POSTMARK_OAUTH_GITHUB_CLIENT_SECRET: "mock-gh-secret",
      GITHUB_AUTH_URL: `${GH}/login/oauth/authorize`, GITHUB_TOKEN_URL: `${GH}/login/oauth/access_token`, GITHUB_API_URL: GH,
      GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.invalid" },
    stdio: ["ignore", "pipe", "pipe"],
  }));
  CLEANUP.push(async () => { if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; } });
  const base = `http://127.0.0.1:${port}`;

  // three invented credentials, as the sign-in and the key desk would have stored them (by hash)
  const { DatabaseSync } = await import("node:sqlite");
  const hash = (t) => createHash("sha256").update(t).digest("base64url");
  const keeperSignIn = randomBytes(24).toString("base64url");
  const strangerSignIn = randomBytes(24).toString("base64url");
  const agentKey = "pmk_" + randomBytes(24).toString("base64url");   // the key a signed-in human mints for their shell agent
  const odb = new DatabaseSync(oauthDb);
  const nowS = Math.floor(Date.now() / 1000);
  const ins = odb.prepare("INSERT INTO tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created) VALUES (?, ?, ?, ?, ?, ?, ?)");
  ins.run(hash(keeperSignIn), "access", KEEPER.id, KEEPER.login, "test", nowS + 3600, nowS);
  ins.run(hash(strangerSignIn), "access", STRANGER.id, STRANGER.login, "test", nowS + 3600, nowS);
  ins.run(hash(agentKey), "household", KEEPER.id, KEEPER.login, null, nowS + 3600, nowS);
  odb.close();

  const patch = (body, token, slug = "lantern-row") => fetch(`${base}/households/${slug}/human`, {
    method: "PATCH", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const inFile = () => JSON.parse(readFileSync(join(clone, "tools", "households.json"), "utf8")).households["lantern-row"].human_profile;
  const commits = () => Number(git("rev-list", "--count", "HEAD").trim());
  const glance = async () => (await fetch(`${base}/household?read_shape=v2`, { headers: { authorization: `Bearer ${keeperSignIn}` } })).json();

  // link -> GitHub -> the office's form, as a browser walks it; then the form's own POST
  const open = async (slug, as) => {
    identity = as;
    const r1 = await fetch(`${base}/oauth/human?household=${slug}`, { redirect: "manual" });
    if (r1.status !== 302) return { status: r1.status, html: await r1.text() };
    const r2 = await fetch(r1.headers.get("location"), { redirect: "manual" });
    const r3 = await fetch(r2.headers.get("location"));
    const html = await r3.text();
    return { status: r3.status, html,
      pending_id: /name="pending_id" value="([^"]+)"/.exec(html)?.[1], nonce: /name="nonce" value="([^"]+)"/.exec(html)?.[1],
      value: (f) => new RegExp(`name="${f}" type="text" maxlength="\\d+" value="([^"]*)"`).exec(html)?.[1] };
  };
  const submit = (form, fields, decision = "save") => fetch(`${base}/oauth/consent`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ pending_id: form.pending_id, nonce: form.nonce, decision, ...fields }),
  }).then(async (r) => ({ status: r.status, html: await r.text() }));

  // LAW (POS-721/c, Darko 2026-11-17: "Human only, like likeness"): NO KEY SETS IT. A household key, AND a GitHub-signed-in
  // access token of the very account the house binds (what an MCP connector or a shell agent holds), are refused alike, before
  // the body is read, and pointed at the form.
  const c0 = commits();
  assert.equal((await patch({ town_name: "DARKO" }, null)).status, 401, "no key at the door");
  for (const [who, token] of [["a household key", agentKey], ["the house's own access token", keeperSignIn], ["another house's access token", strangerSignIn]]) {
    const r = await patch({ town_name: "DARKO" }, token);
    assert.equal(r.status, 403, `${who}: ${JSON.stringify(r.body)}`);
    assert.match(r.body.defect, /^the household's human sets their profile through a GitHub sign-in, never through a key$/, who);
    assert.match(r.body.hint, /\/oauth\/human\?household=lantern-row/, `${who}: the refusal names the form`);
  }
  assert.equal(inFile(), undefined, "nothing a key sent reached the file");
  assert.equal(commits(), c0, "and nothing a key sent committed");

  // the form: a missing house, and another house's account, never see it
  assert.equal((await fetch(`${base}/oauth/human?household=no-such-house`, { redirect: "manual" })).status, 404);
  const refused = await open("lantern-row", STRANGER);
  assert.equal(refused.status, 403, refused.html.slice(0, 300));
  assert.match(refused.html, /does not bind/);
  assert.equal(refused.pending_id, undefined, "another house's account is never shown the form");

  // the house's own account: the form, empty before anything is set, and a refusal that keeps nothing
  const first = await open("lantern-row", KEEPER);
  assert.equal(first.status, 200, first.html.slice(0, 300));
  assert.deepEqual(["town_name", "short_line", "pronouns"].map(first.value), ["", "", ""]);
  assert.ok(!first.html.includes(PRIVATE_NAME), "the form never shows the private name");
  const turned = await submit(first, { town_name: `DARKO${String.fromCharCode(0x202e)}`, short_line: "", pronouns: "" });
  assert.equal(turned.status, 422, turned.html.slice(0, 300));
  assert.match(turned.html, /town_name carries a text-direction control/);
  assert.equal(inFile(), undefined, "a refused save keeps nothing");
  assert.equal((await submit(first, FULL)).status, 400, "a form is used once: its nonce is spent");
  const cancelled = await open("lantern-row", KEEPER);
  assert.equal((await submit(cancelled, FULL, "cancel")).status, 200);
  assert.equal(inFile(), undefined, "cancel keeps nothing");
  assert.equal(commits(), c0, "and nothing refused or cancelled committed");

  const form = await open("lantern-row", KEEPER);
  const set = await submit(form, FULL);
  assert.equal(set.status, 200, set.html.slice(0, 400));
  assert.match(set.html, /Your town name: <strong>DARKO<\/strong>/);
  assert.match(set.html, /on the town's record now/);
  assert.ok(!set.html.includes(PRIVATE_NAME), "the answer never carries the private name");
  assert.deepEqual(inFile(), FULL, "the town's file carries the profile");
  assert.match(git("log", "-1", "--format=%B"), /lantern-row: the human's profile \(town_name set, short_line set, pronouns set\) \(POS-721\)/);
  assert.ok(!readFileSync(join(clone, "tools", "households.json"), "utf8").includes(PRIVATE_NAME), "and the town's file never the private name");
  assert.equal(commits(), c0 + 1, "one drain commit");
  // the public registry read carries it too, signed out
  const listed = await (await fetch(`${base}/households`)).json();
  assert.deepEqual(listed.registry?.households?.["lantern-row"]?.human_profile, FULL, JSON.stringify(listed).slice(0, 400));
  assert.ok(!JSON.stringify(listed).includes(PRIVATE_NAME), "GET /households never says the private name");

  const seen = await glance();
  assert.equal(seen.house?.human, "DARKO (he/him), Lantern Row's human", JSON.stringify(seen).slice(0, 600));
  assert.equal(seen.house.human_line, "builds lanterns");
  assert.ok(!JSON.stringify(seen).includes(PRIVATE_NAME), "the glance never says the private name");

  // THE "BY" PHRASES, through the real reads (LAW, Wright 2026-11-06: "the public reads show them ("by <alias> for rei")"):
  // the human's own act (human-of-*), and an act at a resident's wheel (079's hand and for), both inside the 12-hour window
  const owner = await ix.store.connect("world2_owner");
  try {
    await owner.query("INSERT INTO acts (at, crossing, actor, action, object, class, household, payload) VALUES (now(), 1, 'human-of-lantern-row', 'say', 'the-town/porch', 'voice', 'hh:lantern-row', '{}')");
    await owner.query("INSERT INTO acts (at, crossing, actor, action, object, class, household, payload, hand, for_handle, route) VALUES (now(), 1, 'wright', 'say', 'the-town/quay', 'voice', 'hh:lantern-row', '{}', 'human', 'wright', 'site')");
  } finally { await owner.end(); }
  const BYS = ["DARKO (Lantern Row) for wright", "DARKO (he/him), Lantern Row's human"];
  const own = await (await fetch(`${base}/household?read=happened`, { headers: { authorization: `Bearer ${keeperSignIn}` } })).json();
  assert.deepEqual((own.rows ?? []).map((r) => r.by).sort(), BYS, `the house's own happened read: ${JSON.stringify(own).slice(0, 600)}`);
  const pub = await (await fetch(`${base}/household?read=happened&household=lantern-row`)).json();
  assert.equal(pub.public, true, JSON.stringify(pub).slice(0, 300));
  assert.deepEqual((pub.rows ?? []).map((r) => r.by).sort(), BYS, `the public happened read (POS-1027): ${JSON.stringify(pub).slice(0, 600)}`);
  assert.ok(!JSON.stringify(pub).includes(PRIVATE_NAME), "the public happened read never says the private name");
  const lines = (await glance()).happened;
  assert.ok(lines?.rows?.some((l) => l.includes("by DARKO (he/him), Lantern Row's human")), JSON.stringify(lines));
  assert.equal(lines.key, "by <resident> · by DARKO (he/him), Lantern Row's human (acting themselves) · by DARKO (Lantern Row) for <resident> (at its wheel)");

  // the form opens filled with what is set; emptying a field clears it and keeps the others
  const again = await open("lantern-row", KEEPER);
  assert.deepEqual(["town_name", "short_line", "pronouns"].map(again.value), ["DARKO", "builds lanterns", "he/him"]);
  const cleared = await submit(again, { town_name: "DARKO", short_line: "builds lanterns", pronouns: "" });
  assert.equal(cleared.status, 200, cleared.html.slice(0, 300));
  assert.deepEqual(inFile(), { town_name: "DARKO", short_line: "builds lanterns" }, "clearing one keeps the others");
  assert.equal((await glance()).house.human, "DARKO, Lantern Row's human");

  const none = await submit(await open("lantern-row", KEEPER), { town_name: "", short_line: "", pronouns: "" });
  assert.equal(none.status, 200);
  assert.match(none.html, /Nothing is set now/);
  assert.equal(inFile(), undefined, "nothing set: the file carries no key again");
  const back = await glance();
  assert.equal(back.house.human, "Lantern Row's human");
  assert.equal(back.house.human_line, undefined);
});
