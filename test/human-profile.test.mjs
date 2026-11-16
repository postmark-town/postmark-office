// human-profile.test.mjs — POS-721, small: the household's human's town name, short line and pronouns.
//
// LAW (Wright, settled 2026-11-06 00:51:44Z): "three optional fields on the household's human: a town
// name, a short line and pronouns. The human sets them by their own act on the site, and the public reads
// show them ("by <alias> for rei"). No real-world name is stored."
//
// Every house, handle, login, id, token and name here is INVENTED.
//
//   § 1  the record: the tail column renders in template order when set and is no key at all when not
//   § 1b the public print (POS-845's named list): the profile is named, cut to its three text fields,
//        and the private name stays off it
//   § 2  the fields: judged as the resident's profile door judges its own, one line of text
//   § 2b the writer's refusals, in order: the fields first, then no such house (404), an unbound
//        account (403), and a store without 098 (503), each keeping nothing
//   § 3  the store write, on a real Postgres: merge, clear, nothing left is NULL, another house's
//        account writes nothing, 098's shape refuses anything else, and the landed probe answers
//   § 4  the reads: every phrase that names the house's human says the town name and pronouns
//   § 5  the door on a booted office: no key, an agent's key and another house's sign-in are refused;
//        the house's sign-in sets and clears, the town's file and the glance follow, and the private
//        name is in neither answer
//
//   node --test test/human-profile.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
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

test("§ 2b the writer refuses in order, keeping nothing: the fields before the record is read, then no such house 404, an unbound account 403, a store without 098 503", async () => {
  const calls = [];
  const loadRows = async () => { calls.push("read"); return seed(); };
  const write = async (w) => { calls.push(`write ${w.slug}`); return { slug: w.slug, human_profile: w.set }; };
  const drain = async () => { calls.push("drain"); return { ran: true, commit: "c0ffee" }; };
  const io = { loadRows, write, drain, clone: null };
  const refusal = async (args, code, re, deps = io) => {
    calls.length = 0;
    await assert.rejects(setHumanProfile(args, deps), (e) => e.code === code && re.test(e.defect), JSON.stringify(args));
    return [...calls];
  };
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
});

test("§ 4 every phrase that names the house's human says the town name and pronouns when set, and the house's words when not", () => {
  assert.equal(humanPhrase("Lantern Row"), "Lantern Row's human", "unchanged with nothing set");
  assert.equal(humanPhrase("Lantern Row", null, { forWhom: "wright" }), "Lantern Row's human for wright");
  assert.equal(humanPhrase("Lantern Row", FULL), "DARKO (he/him), Lantern Row's human");
  assert.equal(humanPhrase("Lantern Row", FULL, { forWhom: "wright" }), "DARKO (he/him) for wright");
  assert.equal(humanPhrase("Lantern Row", { town_name: "DARKO" }), "DARKO, Lantern Row's human", "no pronouns, no brackets");
  assert.equal(humanPhrase("Lantern Row", { pronouns: "he/him", short_line: "hi" }), "Lantern Row's human", "pronouns and a line alone name no one");
  assert.equal(humanPhrase(null, FULL), "DARKO (he/him), the house's human");
  // the happened read, from the record's own hand and for (079), and from a row before it
  const atTheWheel = { actor: "wright", hand: "human", for_handle: "wright", route: "site", action: "say", at: "2026-11-06T00:00:00Z" };
  assert.equal(happenedRow(atTheWheel, { houseName: "Lantern Row", human: FULL }).by, "DARKO (he/him) for wright");
  assert.equal(happenedRow(atTheWheel, { houseName: "Lantern Row" }).by, "Lantern Row's human for wright");
  assert.equal(happenedRow({ actor: "human-of-lantern-row", action: "say" }, { houseName: "Lantern Row", human: FULL }).by, "DARKO (he/him), Lantern Row's human");
  assert.equal(happenedRow({ actor: "wright", hand: "wright", for_handle: "wright", action: "say" }, { houseName: "Lantern Row", human: FULL }).by, "wright",
    "a resident's own act names the resident");
  assert.equal(happenedKey("Lantern Row"), "by <resident> · by Lantern Row's human (acting themselves) · by Lantern Row's human for <resident> (at its wheel)");
  assert.equal(happenedKey("Lantern Row", FULL), "by <resident> · by DARKO (he/him), Lantern Row's human (acting themselves) · by DARKO (he/him) for <resident> (at its wheel)");
});

test("§ 5 the door on a booted office: no key 401, an agent's key 403, another house's sign-in 403; the house's sign-in sets and clears, the file and the glance follow, and the private name is in neither", async () => {
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

  const c0 = commits();
  assert.equal((await patch({ town_name: "DARKO" }, null)).status, 401, "no key at the door");
  const agent = await patch({ town_name: "DARKO" }, agentKey);
  assert.equal(agent.status, 403, JSON.stringify(agent.body));
  assert.match(agent.body.defect, /^the household's human sets their profile after a GitHub sign-in$/);
  const stranger = await patch({ town_name: "MALLORY" }, strangerSignIn);
  assert.equal(stranger.status, 403, JSON.stringify(stranger.body));
  assert.match(stranger.body.defect, /^this account does not keep "lantern-row"$/);
  const unknown = await patch({ name: "Avery" }, keeperSignIn);
  assert.equal(unknown.status, 422);
  assert.match(unknown.body.defect, /^name is not a field of the human's profile$/);
  assert.equal(inFile(), undefined, "nothing refused reached the file");
  assert.equal(commits(), c0, "and nothing refused committed");

  const set = await patch(FULL, keeperSignIn);
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.deepEqual(set.body.human_profile, FULL);
  assert.deepEqual(set.body.registry, { rendered: true });
  assert.ok(!JSON.stringify(set.body).includes(PRIVATE_NAME), "the answer never carries the private name");
  assert.deepEqual(inFile(), FULL, "the town's file carries the profile");
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

  const cleared = await patch({ pronouns: "" }, keeperSignIn);
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body.human_profile, { town_name: "DARKO", short_line: "builds lanterns" }, "clearing one keeps the others");
  assert.equal((await glance()).house.human, "DARKO, Lantern Row's human");

  const none = await patch({ town_name: "", short_line: "" }, keeperSignIn);
  assert.equal(none.status, 200);
  assert.equal(none.body.human_profile, null);
  assert.equal(inFile(), undefined, "nothing set: the file carries no key again");
  const back = await glance();
  assert.equal(back.house.human, "Lantern Row's human");
  assert.equal(back.house.human_line, undefined);
});
