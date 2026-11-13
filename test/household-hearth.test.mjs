// household-hearth.test.mjs — the Hearth a household CHOSE, kept by the office (POS-962).
//
// Darko 2026-10-22 (POS-684/c): "An office setting", set by a site act, read on every load. Wright 2026-11-09: the saved choice decides what
// the household page draws for everyone; unset keeps the default; a preview never saves; another household cannot change it.
// Every house, handle, login and id here is INVENTED.
//
//   § 1  the registered ids: read from the town clone's folders, never guessed
//   § 2  the writer: chosen, read, printed; unset; refusals; the answer is the record's
//   § 3  the door on a booted office: a signed-in human, the store, the clone, the public read
//
//   node --test test/household-hearth.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, symlinkSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { rowsFromRegistry, registryFromRows, renderPublicRegistry, renderRegistry, HOUSEHOLD_KEYS } from "../src/registry-rows.mjs";
import { publicRegistry } from "../src/registry-public.mjs";
import { chooseHearth, registeredHearths, hearthOf, HEARTH_ID, DEFAULT_HEARTH } from "../src/household-hearth.mjs";
import { setHouseholdHearth } from "../src/registry-store.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { makePool, RECORD_ON } from "./registry-pool-stub.mjs";
import { fixtureTown } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";
import { indexStore, seedRegistry } from "./helpers/office-under-test.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs"; // static keys are store rows (POS-352)
import { openOauthDb, mintHouseholdKey } from "../src/oauth.mjs"; // the key desk's own mint, for the credential class (POS-962 lead FIX)

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "postmark-hearth-"));
const CLEANUP = [];
after(async () => {
  for (const f of CLEANUP.reverse()) await f().catch(() => {});
  rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const KEEPER = { login: "ember-gh", id: 8101 };
const SECOND = { login: "ember-gh-two", id: 8102 };
const STRANGER = { login: "frost-gh", id: 8103 };
const REGISTRY = { schema_version: 1, note: "invented for POS-962", households: {
  "ember-lane": { name: "Ember Lane", since: "2026-08-01", declared_by: "ash", accounts: [KEEPER, SECOND], residents: ["ash", "birch"] },
  "frost-hall": { name: "Frost Hall", since: "2026-08-03", declared_by: "fern", accounts: [STRANGER], residents: ["fern"] },
} };
const PINS = { ash: { login: KEEPER.login, id: KEEPER.id }, birch: { login: KEEPER.login, id: KEEPER.id }, fern: { login: STRANGER.login, id: STRANGER.id } };
const seed = () => rowsFromRegistry(structuredClone(REGISTRY), structuredClone(PINS));

/** A town clone's PROJECTS/household-hearths with the named ids registered (and the infrastructure folder, which is no entry). */
function hearthClone(ids = ["default", "ledger", "orchard"], name = "clone") {
  const clone = join(TMP, `${name}-${Math.random().toString(36).slice(2, 8)}`);
  const dir = join(clone, "PROJECTS", "household-hearths");
  mkdirSync(join(dir, "STARTER"), { recursive: true });
  writeFileSync(join(dir, "STARTER", "hearth.html"), "<div></div>");
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
const drains = (seen) => async () => { seen.push("drained"); return { ran: true, commit: "c0ffee" }; };
const choose = (hearth, who = KEEPER, slug = "ember-lane", extra = {}) =>
  chooseHearth({ slug, hearth, ghId: who.id, ghLogin: who.login }, { clone: extra.clone ?? hearthClone(), drain: drains(extra.seen ?? []), ...extra });
const rowOf = (pool, slug = "ember-lane") => pool.state.households.find((r) => r.slug === slug);

// ── § 1 the registered ids ──────────────────────────────────────────────────

test("§ 1 registered ids are the lowercase folders holding a regular hearth.html: STARTER, links and empty folders are no entry", () => {
  const clone = hearthClone(["default", "ledger"]);
  const dir = join(clone, "PROJECTS", "household-hearths");
  mkdirSync(join(dir, "empty"));
  mkdirSync(join(dir, "Capitals"), { recursive: true }); writeFileSync(join(dir, "Capitals", "hearth.html"), "<div></div>");
  mkdirSync(join(dir, "linked-file")); symlinkSync(join(dir, "ledger", "hearth.html"), join(dir, "linked-file", "hearth.html"));
  symlinkSync(join(dir, "ledger"), join(dir, "linked-dir"));
  assert.deepEqual([...registeredHearths(clone)].sort(), ["default", "ledger"]);
  assert.throws(() => registeredHearths(join(TMP, "no-such-clone")), "an unreadable clone throws; the writer turns that into a 503, never a guess");
});

test("§ 1 the column carries the id's own spelling, and the record reads only an id", () => {
  assert.equal(HOUSEHOLD_KEYS.at(-1), "hearth");
  for (const ok of ["ledger", "a", "x-1", "a".repeat(40)]) assert.equal(HEARTH_ID.test(ok), true, ok);
  for (const bad of ["", "Ledger", "-x", "a".repeat(41), "a b", "a/b", "../x", "<b>", "x\n"]) assert.equal(HEARTH_ID.test(bad), false, JSON.stringify(bad));
  assert.equal(hearthOf({ hearth: "ledger" }), "ledger");
  for (const bad of [null, undefined, 3, "Ledger", "a b", ["ledger"], {}]) assert.equal(hearthOf({ hearth: bad }), null);
  assert.equal(hearthOf(null), null);
});

// ── § 2 the writer ──────────────────────────────────────────────────────────

test("§ 2 chosen -> kept on the row -> read back -> printed on the town's public record; unset prints nothing", async () => {
  await withStore(async (pool) => {
    const seen = [];
    const done = await choose("ledger", KEEPER, "ember-lane", { seen });
    assert.deepEqual([done.household, done.hearth, done.registry, done.commit], ["ember-lane", "ledger", { rendered: true }, "c0ffee"]);
    assert.deepEqual(seen, ["drained"]);
    assert.equal(rowOf(pool).hearth, "ledger");
    const rows = { ...seed(), households: pool.state.households };
    assert.equal(registryFromRows(rows).households["ember-lane"].hearth, "ledger", "the record reads it");
    assert.equal(JSON.parse(renderPublicRegistry(rows).households).households["ember-lane"].hearth, "ledger", "the public print carries it");
    assert.equal(publicRegistry(registryFromRows(rows)).households["ember-lane"].hearth, "ledger", "GET /households carries it");
    assert.equal(JSON.parse(renderPublicRegistry(rows).households).households["frost-hall"].hearth, undefined, "another house chose nothing, and prints no key");
    // the drain law: the printed file folds back to the same rows
    const files = renderPublicRegistry(rows);
    assert.equal(renderPublicRegistry(rowsFromRegistry(JSON.parse(files.households), JSON.parse(files.pins ?? "{}"))).households, files.households);
    // another entry replaces it, any time; the second bound account may; "default" and null both go back
    await choose("orchard", SECOND); assert.equal(rowOf(pool).hearth, "orchard");
    await choose(DEFAULT_HEARTH); assert.equal(rowOf(pool).hearth, null, "choosing the default is choosing nothing");
    await choose("ledger"); await choose(null); assert.equal(rowOf(pool).hearth, null);
    assert.equal(renderPublicRegistry({ ...seed(), households: pool.state.households }).households.includes("hearth"), false, "unset prints no key at all");
  });
});

test("§ 2 an unregistered id, a bad spelling or a non-string is refused by name and writes nothing", async () => {
  await withStore(async (pool) => {
    const before = JSON.stringify(pool.state.households);
    await assert.rejects(choose("not-registered"), (e) => e.code === 422 && /not a registered Hearth/.test(e.defect) && /ledger/.test(e.hint));
    for (const bad of ["Ledger", "../x", "a b", "x".repeat(41)]) await assert.rejects(choose(bad), (e) => e.code === 422, JSON.stringify(bad));
    for (const bad of [7, {}, ["ledger"], true]) await assert.rejects(choose(bad), (e) => e.code === 422, JSON.stringify(bad));
    assert.equal(JSON.stringify(pool.state.households), before);
    // the registration is the clone's, at the write: an entry removed there is refused here
    await assert.rejects(choose("orchard", KEEPER, "ember-lane", { clone: hearthClone(["default", "ledger"]) }), (e) => e.code === 422);
  });
});

test("§ 2 another household, an unbound account, a credential with no account and a missing house refuse and write nothing", async () => {
  await withStore(async (pool) => {
    await choose("ledger");
    const before = JSON.stringify(pool.state.households);
    await assert.rejects(choose("orchard", STRANGER), (e) => e.code === 403 && /does not keep "ember-lane"/.test(e.defect), "B's valid account cannot change A's value");
    await assert.rejects(choose(null, STRANGER), (e) => e.code === 403, "nor unset it");
    await assert.rejects(choose("orchard", KEEPER, "frost-hall"), (e) => e.code === 403, "A's account cannot write B's row");
    await assert.rejects(choose("orchard", { id: null, login: null }), (e) => e.code === 403, "a resident key carries no account: not the human's act");
    await assert.rejects(choose("orchard", KEEPER, "no-such-house"), (e) => e.code === 404);
    await assert.rejects(chooseHearth({ slug: "", hearth: "ledger", ghId: KEEPER.id }, {}), (e) => e.code === 422);
    assert.equal(JSON.stringify(pool.state.households), before, "nothing was written");
    assert.equal(rowOf(pool).hearth, "ledger", "A's choice stands");
  });
});

test("§ 2 the refusals are the writer's own, BEFORE the store: a stranger and a keyless credential never reach the write", async () => {
  await withStore(async () => {
    let writes = 0;
    const spy = async () => { writes++; return { slug: "x" }; };
    await assert.rejects(choose("ledger", STRANGER, "ember-lane", { write: spy }), (e) => e.code === 403);
    await assert.rejects(choose("ledger", { id: null, login: null }, "ember-lane", { write: spy }), (e) => e.code === 403);
    await assert.rejects(choose("not-registered", KEEPER, "ember-lane", { write: spy }), (e) => e.code === 422);
    assert.equal(writes, 0);
  });
});

test("§ 2 the store's own write names the slug AND a binding account, in one statement", async () => {
  await withStore(async (pool) => {
    assert.deepEqual(await setHouseholdHearth({ slug: "ember-lane", hearth: "ledger", ghId: STRANGER.id }), { slug: null });
    assert.equal(rowOf(pool).hearth ?? null, null);
    assert.deepEqual(await setHouseholdHearth({ slug: "ember-lane", hearth: "ledger", ghId: KEEPER.id }), { slug: "ember-lane" });
    assert.equal(rowOf(pool).hearth, "ledger");
  });
});

test("§ 2 a store without 093, an unreadable clone and a lost binding refuse by name; a drain refusal is reported, the choice kept", async () => {
  await withStore(async (pool) => {
    await assert.rejects(choose("ledger", KEEPER, "ember-lane", { write: async () => ({ missingColumn: true }) }), (e) => e.code === 503 && /093/.test(e.hint));
    await assert.rejects(choose("ledger", KEEPER, "ember-lane", { registered: () => { throw new Error("EIO"); } }), (e) => e.code === 503);
    await assert.rejects(choose("ledger", KEEPER, "ember-lane", { write: async () => ({ slug: null }) }), (e) => e.code === 403);
    assert.equal(rowOf(pool).hearth ?? null, null);
    const refused = await choose("ledger", KEEPER, "ember-lane", { drain: async () => ({ refused: "the town is busy" }) });
    assert.deepEqual(refused.registry, { rendered: false, refused: "the town is busy" });
    assert.equal(rowOf(pool).hearth, "ledger", "the store is the record; the file follows at the next crossing");
  });
});

// ── § 3 the door, on a booted office ────────────────────────────────────────

test("§ 3 PATCH /households/<slug>/hearth: a signed-in human of the house chooses; A's choice reads signed-out; B and a resident key cannot touch it", async () => {
  const clone = hearthClone(["default", "ledger", "orchard"], "door-clone");
  mkdirSync(join(clone, "tools"), { recursive: true });
  const printed = renderRegistry(seed());
  writeFileSync(join(clone, "tools", "households.json"), printed.households);
  writeFileSync(join(clone, "tools", "github-ids.json"), printed.pins);
  const git = (...a) => execFileSync("git", ["-C", clone, ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("-c", "user.name=test", "-c", "user.email=test@example.invalid", "add", "-A");
  git("-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-qm", "the registry");

  const ix = await indexStore(fixtureTown(), { db: "hearth_door" });
  CLEANUP.push(() => ix.stop());
  await seedRegistry(ix.store, REGISTRY, PINS);
  // Ember Lane is ashore, as a declared house is (ashore.mjs § recordAshore, the row every landing road writes): a
  // MINTED key resolves its household from the store's pins and the ashore record, where a static key names it outright.
  {
    const c = await ix.store.connect("world2_owner");
    const landed = git("rev-parse", "HEAD").trim();   // the registry's commit in this clone: the house landed there
    try { for (const h of ["ash", "birch"]) await c.query("INSERT INTO ashore (handle, at, sha, road) VALUES ($1, now(), $2, 'declare')", [h, landed]); }
    finally { await c.end(); }
  }
  const KEYS = { A: "hearth-key-a", B: "hearth-key-b", R: "hearth-key-resident" };
  const oauthPath = seedStaticKeys(join(TMP, "oauth-door.db"), `${KEYS.A}=ember-lane#${KEEPER.id}:ash,birch;${KEYS.B}=frost-hall#${STRANGER.id}:fern;${KEYS.R}=ember-lane:ash`);
  // THE CREDENTIAL CLASS THE LEAD REVIEW FOUND (POS-962): keys MINTED by the office's own key desk
  // (oauth.mjs § mintHouseholdKey), one in resident ash's own hand and one in the human's. Both carry the human's
  // GitHub account, the account Ember Lane's record binds, so the bound-account check alone cannot tell them apart.
  const minted = openOauthDb(oauthPath);
  KEYS.AGENT = await mintHouseholdKey(minted, KEEPER.id, KEEPER.login, { claimedHandle: "ash", cosignedBy: { id: KEEPER.id, login: KEEPER.login } });
  KEYS.HUMAN = await mintHouseholdKey(minted, KEEPER.id, KEEPER.login);
  minted.close();
  const { child, port } = await bootOnFreePort((p) => spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(p), "--oauth-db", oauthPath], {
    env: { ...process.env, WORLD2_PG: ix.env.WORLD2_PG, WORLD2_PG_URL: ix.env.WORLD2_PG_URL, TOWN_INDEX_READS: ix.env.TOWN_INDEX_READS ?? "",
      TOWN_CLONE: clone, TOWN_PUSH: "", OFFICE_READ_WORKERS: "0", WORLD_GRAPH_NONE: "1",
      OFFICE_KEYS: "",
      PUBLIC_BASE: `http://127.0.0.1:${p}`,
      GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.invalid" },
    stdio: ["ignore", "pipe", "pipe"],
  }));
  CLEANUP.push(async () => { if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; } });
  const base = `http://127.0.0.1:${port}`;
  const patch = (path, key, body) => fetch(`${base}${path}`, { method: "PATCH", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const savedFor = async (slug) => (await (await fetch(`${base}/households`)).json()).registry?.households?.[slug]?.hearth ?? null;
  const onFile = () => JSON.parse(readFileSync(join(clone, "tools", "households.json"), "utf8")).households;

  assert.equal(await savedFor("ember-lane"), null, "unset reads as nothing: the default");
  assert.equal((await patch("/households/ember-lane/hearth", null, { hearth: "ledger" })).status, 401, "no credential");
  assert.equal((await patch("/households/ember-lane/hearth", KEYS.R, { hearth: "ledger" })).status, 403, "a resident key has no account behind it: not the human's act");
  assert.equal((await patch("/households/ember-lane/hearth", KEYS.B, { hearth: "ledger" })).status, 403, "B's valid session cannot choose for A");
  // the minted agent-held key: the right account, in an agent's hand. Refused at the door, before the law, nothing kept
  const byAgent = await patch("/households/ember-lane/hearth", KEYS.AGENT, { hearth: "ledger" });
  assert.equal(byAgent.status, 403, JSON.stringify(byAgent.body));
  assert.match(byAgent.body.defect, /chosen by the household's human/);
  assert.match(byAgent.body.hint, /an agent's own/);
  assert.equal((await patch("/households/ember-lane/hearth", KEYS.AGENT, { hearth: null })).status, 403, "nor may it unset one");
  assert.equal(await savedFor("ember-lane"), null, "nothing was kept by the refusals");
  assert.doesNotMatch(git("log", "-1", "--format=%B"), /Hearth/, "and no commit was made for them");

  const ok = await patch("/households/ember-lane/hearth", KEYS.A, { hearth: "ledger" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.hearth, "ledger");
  assert.equal(await savedFor("ember-lane"), "ledger", "a fresh, signed-out read uses it, on reload");
  assert.equal(await savedFor("frost-hall"), null, "B is untouched");
  assert.equal(onFile()["ember-lane"].hearth, "ledger", "and it is on the town's public record");
  assert.match(git("log", "-1", "--format=%B"), /ember-lane: the household's Hearth chosen: ledger/);

  assert.equal((await patch("/households/ember-lane/hearth", KEYS.B, { hearth: null })).status, 403, "B cannot unset it either");
  assert.equal((await patch("/households/ember-lane/hearth", KEYS.A, { hearth: "nope" })).status, 422, "an unregistered id");
  assert.equal((await patch("/households/ember-lane/hearth", KEYS.A, {})).status, 422, "no hearth key says so");
  assert.equal(await savedFor("ember-lane"), "ledger", "refusals leave the choice standing");
  assert.equal((await patch("/households/no-such-house/hearth", KEYS.A, { hearth: "ledger" })).status, 404);

  assert.equal((await patch("/households/ember-lane/hearth", KEYS.A, { hearth: null })).status, 200);
  assert.equal(await savedFor("ember-lane"), null, "unset again: the default");
  assert.equal(onFile()["ember-lane"].hearth, undefined);

  // the human's own MINTED household key is the human's: it chooses, as a sign-in does
  const byHuman = await patch("/households/ember-lane/hearth", KEYS.HUMAN, { hearth: "orchard" });
  assert.equal(byHuman.status, 200, JSON.stringify(byHuman.body));
  assert.equal(await savedFor("ember-lane"), "orchard");
  // and the agent's key still cannot move what the human chose
  assert.equal((await patch("/households/ember-lane/hearth", KEYS.AGENT, { hearth: "ledger" })).status, 403);
  assert.equal(await savedFor("ember-lane"), "orchard", "the human's choice stands");
});
