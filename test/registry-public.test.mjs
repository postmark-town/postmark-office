// registry-public.test.mjs — public reads never carry a household's private human name (POS-394).
//
// RULED (Darko, 2026-10-05): household and resident pages print the household's
// display name, NEVER the private human name. Wright, 2026-10-12: the office's
// public /households and any public read carrying a registry row omit `human`.
//
// Every house, handle and name here is INVENTED. PRIVATE_SENTINEL is the private
// name; the instrument is "does that string, or a `human` key, reach a public
// payload", and the positive control is that the PRIVATE fold still holds it.
//
//   § 1  the projection: no human key, everything else kept in order, input untouched
//   § 2  GET /households (pure): whole and ?h=, the private fold as control, 422/503 kept
//   § 3  the per-resident household block: no human key, house and members kept
//   § 4  the house bundle: name kept, no human
//   § 5  a booted office on a real store: /households and a resident card over REST
//   § 6  the residency plan's name, printed into the public join PR, is never the human

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { rowsFromRegistry, registryFromRows, pinsFromRows } from "../src/registry-rows.mjs";
import { publicRegistry, publicHouse, PRIVATE_HOUSE_KEYS } from "../src/registry-public.mjs";
import { householdsRead } from "../src/households-read.mjs";
import { householdLookupOf } from "../src/households.mjs";
import { houseBundle } from "../src/house-bundle.mjs";
import { planRegistryJoin, joinBody, registryNote } from "../src/residency.mjs";
import { putValues, emptyTown, fixtureTown } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";
import { indexStore, seedRegistry } from "./helpers/office-under-test.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "postmark-registry-public-"));
const CLEANUP = [];
after(async () => {
  for (const f of CLEANUP.reverse()) await f().catch(() => {});
  rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const PRIVATE_SENTINEL = "PRIVATE_SENTINEL_q7zx_human";
const PRIVATE_SENTINEL_2 = "PRIVATE_SENTINEL_m4kd_human";

// Three invented houses: one with a display name AND a private human, one with a
// name and no human, one with a private human and no display name at all.
const REGISTRY = { schema_version: 1, note: "invented for POS-394", households: {
  "lantern-row": { name: "Lantern Row", human: PRIVATE_SENTINEL, since: "2026-08-01", declared_by: "postmaster",
    accounts: [{ login: "lr-gh", id: 9101 }], residents: ["postmaster", "wick"] },
  "moss-cottage": { name: "Moss Cottage", since: "2026-08-02", declared_by: "fennel",
    accounts: [{ login: "mc-gh", id: 9102 }], residents: ["fennel"] },
  "unnamed-hall": { human: PRIVATE_SENTINEL_2, since: "2026-08-03", declared_by: "quill",
    accounts: [{ login: "uh-gh", id: 9103 }], residents: ["quill"] },
} };
const PINS = { postmaster: { login: "lr-gh", id: 9101, pinned: "2026-08-01" }, wick: { login: "lr-gh", id: 9101 },
  fennel: { login: "mc-gh", id: 9102 }, quill: { login: "uh-gh", id: 9103 } };
const ROWS = rowsFromRegistry(REGISTRY, PINS);

const leaks = (x) => { const s = typeof x === "string" ? x : JSON.stringify(x); return s.includes(PRIVATE_SENTINEL) || s.includes(PRIVATE_SENTINEL_2); };
const houseKeys = (registry) => Object.values(registry.households).flatMap((h) => Object.keys(h));

// ── § 1 the projection ──────────────────────────────────────────────────────

test("§ 1 the projection drops the human KEY and nothing else, in order, and never touches its input", () => {
  assert.deepEqual(PRIVATE_HOUSE_KEYS, ["human"]);
  const priv = registryFromRows(ROWS);
  const before = JSON.stringify(priv);
  assert.equal(leaks(priv), true, "CONTROL: the private fold holds the private names (the instrument can see them)");
  const pub = publicRegistry(priv);
  assert.equal(JSON.stringify(priv), before, "the private object is unchanged, byte for byte");
  assert.equal(leaks(pub), false, "no private name in the public face");
  assert.equal(houseKeys(pub).includes("human"), false, "not even as a key");
  for (const [slug, rec] of Object.entries(priv.households))
    assert.deepEqual(Object.keys(pub.households[slug]), Object.keys(rec).filter((k) => k !== "human"), `${slug}: every other key, in order`);
  assert.deepEqual(Object.keys(pub), Object.keys(priv), "the registry's own key order");
  assert.equal(pub.households["lantern-row"].name, "Lantern Row");
  assert.deepEqual(pub.households["lantern-row"].residents, ["postmaster", "wick"]);
  assert.equal("name" in pub.households["unnamed-hall"], false, "a house with no display name gets none invented, and no human in its place");
  // a null human, beside a consent-like opaque marker: the human KEY goes regardless of its value, every other key stays
  assert.deepEqual(publicHouse({ name: "Tidewater", human: null, human_shown: "opaque-marker-1", residents: ["a"] }),
    { name: "Tidewater", human_shown: "opaque-marker-1", residents: ["a"] }, "a null human is still dropped as a key; the marker is kept as given");
  assert.deepEqual(publicHouse({ human: PRIVATE_SENTINEL, human_shown: "opaque-marker-2", name: "Tidewater" }),
    { human_shown: "opaque-marker-2", name: "Tidewater" }, "a marker never turns the human back on");
  assert.equal(publicHouse(null), null);
  assert.equal(publicRegistry(null), null);
});

// ── § 2 GET /households, pure ───────────────────────────────────────────────

test("§ 2 /households whole and ?h=: no private name, the rest as the drain's objects", async () => {
  const whole = await householdsRead({}, { rows: ROWS });
  assert.equal(whole.status, 200);
  assert.equal(leaks(whole.body), false, "the whole registry carries no private name");
  assert.equal(houseKeys(whole.body.registry).includes("human"), false);
  assert.deepEqual(whole.body.registry, publicRegistry(registryFromRows(ROWS)));
  assert.deepEqual(whole.body.pins, pinsFromRows(ROWS), "pins unchanged");
  assert.deepEqual(Object.keys(whole.body.registry.households), ["lantern-row", "moss-cottage", "unnamed-hall"], "house order kept");

  const some = await householdsRead({ h: "wick,quill,nobody" }, { rows: ROWS });
  assert.equal(some.status, 200);
  assert.equal(leaks(some.body), false, "the filtered read carries no private name");
  assert.deepEqual(Object.keys(some.body.registry.households), ["lantern-row", "unnamed-hall"], "membership resolution unchanged");
  assert.deepEqual(some.body.handles, ["wick", "quill", "nobody"]);
  assert.deepEqual(Object.keys(some.body.pins), ["quill", "wick"]);

  assert.equal(leaks(registryFromRows(ROWS)), true, "CONTROL: the store's fold the drain prints still holds the names");
  assert.equal((await householdsRead({ h: "" }, { rows: ROWS })).status, 422);
  assert.equal((await householdsRead({}, { rows: null })).status, 503);
});

// ── § 3 the per-resident household block ────────────────────────────────────

test("§ 3 the household block: no human key, the house and its members kept", () => {
  const priv = registryFromRows(ROWS);
  const before = JSON.stringify(priv);
  const of = householdLookupOf(priv, pinsFromRows(ROWS));
  assert.deepEqual(of("wick"), { key: "hh:lantern-row", slug: "lantern-row", residents: ["postmaster", "wick"] });
  assert.deepEqual(of("quill"), { key: "hh:unnamed-hall", slug: "unnamed-hall", residents: ["quill"] });
  assert.deepEqual(of("stray"), { key: "solo:stray", slug: null, residents: ["stray"] }, "a household of one: no human key either");
  assert.equal(leaks([of("wick"), of("quill"), of("postmaster")]), false);
  assert.equal(JSON.stringify(priv), before, "the registry handed in is unchanged");
});

// ── § 4 the house bundle ────────────────────────────────────────────────────

test("§ 4 the house bundle names the house and never its human", async () => {
  const db = emptyTown();
  putValues(db, "meta", ["as_of", "fixture-as-of"]);
  const none = async () => ({});
  const readers = {
    registry: { registry: registryFromRows(ROWS), pins: pinsFromRows(ROWS), from: "injected" },
    stances: async () => ({ awaiting: [], standing: [], complete: true }), stakesFor: async () => ({ rows: [] }),
    lastActiveFor: async () => new Map(), walkers: async () => ({ walkers: [] }), claimEffects: async () => ({ events: [] }), standsOf: none,
  };
  for (const [house, name] of [["lantern-row", "Lantern Row"], ["unnamed-hall", null]]) {
    const h = await houseBundle({ household: house }, { db, key: null, meta: { as_of: "fixture-as-of" }, asOf: "fixture-as-of", clone: TMP, odb: null, nowMs: Date.parse("2026-10-12T00:00:00Z"), readers });
    assert.equal(h.refused, undefined, JSON.stringify(h.refused ?? null));
    assert.equal(h.household, house);
    assert.equal(h.name, name, `${house}: the display name, or null when it has none`);
    assert.equal("human" in h, false, `${house}: no human key`);
    assert.equal(leaks(h), false, `${house}: no private name anywhere in the bundle`);
  }
});

// ── § 5 a booted office on a real store ─────────────────────────────────────

test("§ 5 over REST, public, on a real store: /households and a resident card carry no private name", async () => {
  const town = fixtureTown();
  const clone = join(TMP, "town-clone");
  mkdirSync(join(clone, "tools"), { recursive: true });
  mkdirSync(join(clone, "WHITE_PAGES"), { recursive: true });
  const ix = await indexStore(town, { db: "registry_public" });
  CLEANUP.push(() => ix.stop());
  await seedRegistry(ix.store, REGISTRY, PINS);
  const { child, port } = await bootOnFreePort((p) => spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(p),
    "--oauth-db", join(TMP, "oauth.db")], {
    env: { ...process.env, WORLD2_PG: ix.env.WORLD2_PG, WORLD2_PG_URL: ix.env.WORLD2_PG_URL, TOWN_INDEX_READS: ix.env.TOWN_INDEX_READS ?? "",
      TOWN_CLONE: clone, TOWN_PUSH: "", OFFICE_READ_WORKERS: "0", WORLD_GRAPH_NONE: "1", OFFICE_KEYS: "" },
    stdio: ["ignore", "pipe", "pipe"],
  }));
  CLEANUP.push(async () => { if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; } });
  const base = `http://127.0.0.1:${port}`;

  const whole = await fetch(`${base}/households`);
  assert.equal(whole.status, 200);
  const wholeText = await whole.text();
  assert.equal(leaks(wholeText), false, "the raw public body carries no private name");
  const wb = JSON.parse(wholeText);
  assert.equal(houseKeys(wb.registry).includes("human"), false);
  assert.equal(wb.registry.households["lantern-row"].name, "Lantern Row", "the display name is served");
  assert.deepEqual(wb.registry.households["lantern-row"].residents, ["postmaster", "wick"]);
  assert.deepEqual(wb.pins.postmaster, PINS.postmaster, "pins as stored");

  const some = await fetch(`${base}/households?h=quill`);
  const someText = await some.text();
  assert.equal(some.status, 200);
  assert.equal(leaks(someText), false, "the filtered public body carries no private name");
  assert.deepEqual(Object.keys(JSON.parse(someText).registry.households), ["unnamed-hall"]);

  const card = await fetch(`${base}/residents/postmaster`);
  const cardText = await card.text();
  assert.equal(card.status, 200, cardText.slice(0, 200));
  assert.equal(leaks(cardText), false, "the resident card carries no private name");
  const hh = JSON.parse(cardText).household;
  assert.deepEqual(hh, { key: "hh:lantern-row", slug: "lantern-row", residents: ["postmaster", "wick"] }, "the card's household block: the house, its members, no human key");
});

// ── § 6 the residency plan → the public join PR ─────────────────────────────

test("§ 6 a house with no display name: the join plan, the HOLD note and the PR body name it by slug, never its human", () => {
  const registry = { schema_version: 1, households: {
    // no display name, a private human: the fallback this lane removes
    "brine-hall": { human: PRIVATE_SENTINEL, since: "2026-08-04", declared_by: "kelp",
      accounts: [{ login: "bh-gh", id: 9201 }], residents: ["kelp"] },
    // a house already keyed once (formerly), no display name, a private human: the 'chosen, already' path
    "old-key": { human: PRIVATE_SENTINEL_2, since: "2026-08-05", declared_by: "fen", formerly: ["older-key"],
      accounts: [{ login: "ok-gh", id: 9301 }], residents: ["fen"] },
    // the control: a display name is used as before
    "tide-house": { name: "Tide House", human: PRIVATE_SENTINEL, since: "2026-08-06", declared_by: "gull",
      accounts: [{ login: "th-gh", id: 9401 }], residents: ["gull"] },
  } };
  const date = "2026-10-12";
  const before = JSON.stringify(registry);
  // an account the house never listed asks in by name: the cold HOLD (appended, not vouched)
  const hold = planRegistryJoin(registry, { handle: "newt", household: "brine-hall", ghId: 9999, ghLogin: "stranger-gh", date });
  assert.deepEqual([hold.action, hold.vouched, hold.name], ["appended", false, "brine-hall"], "the slug, not the human");
  const who = { handle: "newt", agent: "Newt", ghLogin: "stranger-gh", ghId: 9999 };
  const note = registryNote(hold, who);
  const body = joinBody(who, hold);
  assert.match(note, /\*\*brine-hall\*\*/);
  assert.match(body, /\*\*brine-hall\*\*/);
  assert.equal(leaks(note) || leaks(body), false, "the public PR prose carries no private name");
  // the house's own account naming a NEW key on an already-keyed house: 'chosen', already
  const already = planRegistryJoin(registry, { handle: "fen-two", household: "A Brand New Name", ghId: 9301, ghLogin: "ok-gh", date });
  assert.deepEqual([already.action, already.already, already.name], ["chosen", true, "old-key"], "the slug, not the human");
  assert.equal(leaks([already.name, already.houseLine]), false);
  // the control: a display name still names the house
  const named = planRegistryJoin(registry, { handle: "tern", household: "tide-house", ghId: 9998, ghLogin: "other-gh", date });
  assert.equal(named.name, "Tide House");
  assert.equal(leaks(joinBody({ ...who, handle: "tern" }, named)), false);
  assert.equal(JSON.stringify(registry), before, "the registry handed in is unchanged");
  assert.equal(leaks(registry), true, "CONTROL: the private record still holds the names");
});
