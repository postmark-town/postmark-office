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
//   § 1  the projection: no human key, every named key kept in order, input untouched
//   § 2  GET /households (pure): whole and ?h=, the private fold as control, 422/503 kept
//   § 3  the per-resident household block: no human key, house and members kept
//   § 4  the house bundle: name kept, no human
//   § 5  a booted office on a real store: /households and a resident card over REST
//   § 6  the residency plan's name, printed into the public join PR, is never the human
//   § 7  the named list (POS-726): nothing unnamed rides, at any level, and the input is untouched
//   § 8  the FIX round (POS-726): declared shapes for home_images and accounts, non-object houses and
//        pins, and a column the file's grammar adds later stays private

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

import { rowsFromRegistry, registryFromRows, pinsFromRows, renderRegistry, renderPublicRegistry } from "../src/registry-rows.mjs";
import { publicRegistry, publicHouse, publicPins, PRIVATE_HOUSE_KEYS } from "../src/registry-public.mjs";
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

test("§ 1 the projection drops the human KEY, keeps every named key in order, and never touches its input", () => {
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
  // a null human, beside a consent-like opaque marker: the human KEY goes regardless of its value.
  // Until 2026-11-03 these asserted the marker was "kept as given": POS-394's projection copied every key
  // but `human`. POS-726's named list sends only the keys named public, so an unnamed marker is left out too.
  assert.deepEqual(publicHouse({ name: "Tidewater", human: null, human_shown: "opaque-marker-1", residents: ["a"] }),
    { name: "Tidewater", residents: ["a"] }, "a null human is still dropped as a key, and the unnamed marker with it");
  assert.deepEqual(publicHouse({ human: PRIVATE_SENTINEL, human_shown: "opaque-marker-2", name: "Tidewater" }),
    { name: "Tidewater" }, "a marker never turns the human back on, and is not public itself");
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
  // the house's index is the store's, over this empty town (POS-268)
  const sx = await indexStore(db, { db: "registry_public_house" });
  CLEANUP.push(() => sx.stop());
  const ix = (await import("../src/town-index-store.mjs")).storeIndexPooled(TMP, { env: sx.env });
  const none = async () => ({});
  const readers = {
    registry: { registry: registryFromRows(ROWS), pins: pinsFromRows(ROWS), from: "injected" },
    stances: async () => ({ awaiting: [], standing: [], complete: true }), stakesFor: async () => ({ rows: [] }),
    lastActiveFor: async () => new Map(), walkers: async () => ({ walkers: [] }), claimEffects: async () => ({ events: [] }), standsOf: none,
  };
  for (const [house, name] of [["lantern-row", "Lantern Row"], ["unnamed-hall", null]]) {
    const h = await houseBundle({ household: house }, { ix, key: null, asOf: "fixture-as-of", clone: TMP, odb: null, nowMs: Date.parse("2026-10-12T00:00:00Z"), readers });
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
  // `likeness` (WLD-83): the house's answer to the likeness question, never the human who gave it
  assert.deepEqual(hh, { key: "hh:lantern-row", slug: "lantern-row", residents: ["postmaster", "wick"], likeness: "not given" }, "the card's household block: the house, its members, its likeness answer, no human key");
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

// ── § 7 the named list (POS-726) ────────────────────────────────────────────
//
// LAW (Darko's picker answer on POS-845, 2026-11-03 05:53Z): the public line is a "Named list".
// Wright's hand-back on POS-726: only fields named public are sent; a new field is private until named.
//
// Each sentinel sits where a field nobody named could arrive: a registry meta key; a house column a
// later migration adds (what `registryFromRows` would hand over once HOUSEHOLD_KEYS grows; the fold
// cannot carry one today, so this level is held here, on the function the door and the drain call); an
// unnamed key inside an account, a likeness answer and an invitation; an object under a resident's
// handle in `home_images`; an object put under a NAMED house key; a pin key, and an object under a
// named pin key. Every house, handle, login and id is invented. The input is deep-frozen, so a
// projection that wrote into it would throw here instead of quietly changing the private record.

const S726 = Object.freeze({
  meta: "SENT_P726_meta", house: "SENT_P726_house", account: "SENT_P726_account", likeness: "SENT_P726_likeness",
  invite: "SENT_P726_invite", image: "SENT_P726_image", underNamed: "SENT_P726_under_named",
  pin: "SENT_P726_pin", underPin: "SENT_P726_under_pin", human: PRIVATE_SENTINEL,
});
const leaks726 = (x) => Object.entries(S726).filter(([, s]) => JSON.stringify(x).includes(s)).map(([k]) => k).sort();
const deepFreeze = (o) => {
  if (o !== null && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
};
const IMG = "https://media.postmark.town/media/p726/pell.png";
const IMG2 = "https://media.postmark.town/media/p726/otter.png";

const PRIVATE_726 = () => ({ schema_version: 1, note: "invented for POS-726", extra_meta: S726.meta, households: {
  "ember-loft": { name: "Ember Loft", human: S726.human,
    accounts: [{ login: "el-gh", id: 9811, secret: S726.account }, { login: "el2-gh", id: 9812 }],
    residents: ["pell", "otter-q"], since: "2026-09-01", member_of: "the-harbor", declared_by: "pell",
    formerly: ["old-loft"], provisional: true,
    home_images: { pell: IMG, "otter-q": { url: IMG2, secret: S726.image } },
    likeness: { answer: "yes", at: "2026-10-20T00:00:00.000Z", by: "el-gh", gh_id: 9811, words: "v1", secret: S726.likeness },
    invited_by: { by: "wren-c", named: "wren-c", at: "2026-09-01T00:00:00.000Z", secret: S726.invite },
    a_later_column: S726.house },
  "tarn-yard": { name: { shown: "Tarn Yard", secret: S726.underNamed }, accounts: [{ login: "ty-gh", id: 9813 }],
    residents: ["tarn"], since: "2026-09-02", declared_by: "tarn" },
} });

// What the public read may show of it, written out by hand: every named key, in the record's own order.
const PUBLIC_726 = { schema_version: 1, note: "invented for POS-726", households: {
  "ember-loft": { name: "Ember Loft",
    accounts: [{ login: "el-gh", id: 9811 }, { login: "el2-gh", id: 9812 }],
    residents: ["pell", "otter-q"], since: "2026-09-01", member_of: "the-harbor", declared_by: "pell",
    formerly: ["old-loft"], provisional: true,
    home_images: { pell: IMG },
    likeness: { answer: "yes", at: "2026-10-20T00:00:00.000Z", by: "el-gh", gh_id: 9811, words: "v1" },
    invited_by: { by: "wren-c", named: "wren-c", at: "2026-09-01T00:00:00.000Z" } },
  "tarn-yard": { accounts: [{ login: "ty-gh", id: 9813 }], residents: ["tarn"], since: "2026-09-02", declared_by: "tarn" },
} };

test("§ 7 the named list: nothing unnamed rides at any level of a house, every named value survives in order, the input is untouched", () => {
  const priv = deepFreeze(PRIVATE_726());
  const before = JSON.stringify(priv);
  assert.deepEqual(leaks726(priv), ["account", "house", "human", "image", "invite", "likeness", "meta", "underNamed"],
    "CONTROL: the private object carries every house-side sentinel (the instrument can see them)");
  const pub = publicRegistry(priv);
  assert.deepEqual(leaks726(pub), [], "no sentinel reaches the public face (the list names each one that does)");
  assert.deepEqual(pub, PUBLIC_726, "exactly the named public values");
  assert.equal(JSON.stringify(pub), JSON.stringify(PUBLIC_726), "in the record's own key order");
  assert.equal(JSON.stringify(priv), before, "the private object is unchanged, byte for byte");
  // the house projection alone, on the house a later column was added to
  assert.deepEqual(publicHouse(priv.households["ember-loft"]), PUBLIC_726.households["ember-loft"]);
});

test("§ 7 the named list: a meta value that is not a single value has no named shape (the fold refuses one first)", () => {
  const pub = publicRegistry(deepFreeze({ schema_version: 1, note: { text: "n", secret: S726.meta }, households: {} }));
  assert.deepEqual(pub, { schema_version: 1, households: {} });
});

test("§ 7 the named list: pins carry their named keys holding single values; handles, order and input kept", () => {
  const pins = deepFreeze({
    "otter-q": { login: "el-gh", id: 9811, pinned: "2026-09-01", renamed: "a rename", note: "a pin note", retired: "2026-10-01", renamed_to: "otter-r" },
    pell: { login: "el-gh", id: 9811, pinned: "2026-09-01", secret: S726.pin },
    tarn: { login: "ty-gh", id: 9813, note: { text: "n", secret: S726.underPin } },
  });
  const before = JSON.stringify(pins);
  assert.deepEqual(leaks726(pins), ["pin", "underPin"], "CONTROL: the private pins carry both pin sentinels");
  const pub = publicPins(pins);
  assert.deepEqual(leaks726(pub), [], "no pin sentinel is public");
  assert.equal(JSON.stringify(pub), JSON.stringify({
    "otter-q": { login: "el-gh", id: 9811, pinned: "2026-09-01", renamed: "a rename", note: "a pin note", retired: "2026-10-01", renamed_to: "otter-r" },
    pell: { login: "el-gh", id: 9811, pinned: "2026-09-01" },
    tarn: { login: "ty-gh", id: 9813 },
  }), "every named pin value, in order; the unnamed key and the object under `note` are left out");
  assert.equal(JSON.stringify(pins), before, "the pins handed in are unchanged");
  assert.equal(publicPins(null), null);
});

// ── § 8 the FIX round (POS-726) ─────────────────────────────────────────────
//
// LAW (Rivet's FIX brief on POS-726, 2026-11-03 17:58Z, on the frontier review): "A named scalar is not a
// license for arbitrary keys/objects below it; lists/nested fields keep their existing DECLARED shapes."
// `home_images` is what its one writer writes (registry-store.mjs § setHomeImage: "a picture can only ever
// land on the house the resident stands in at that moment") and its reader reads (registry-rows.mjs §
// homePictureIn: "Only an entry for one of THAT house's own residents counts, so a picture left behind when a
// resident moved house reads as none"), URL text under a resident's handle. An account is an object in a
// list, cut to `login` and `id`. And from the same brief: "a new field admitted by file grammar alone must
// STILL stay private until the independent public list names it."
//
// Every house, handle, login, id and URL is invented. `gone-wren` lives in odd-shed and left a picture on
// fen-hollow. The two numbers are sentinels too: they may only ever appear where they were put.

const S8 = Object.freeze({
  left: "SENT_P726_left_behind", alone: "SENT_P726_left_alone", list: "SENT_P726_image_list", mapless: "SENT_P726_image_not_a_map",
  bare: "SENT_P726_bare_account", nested: "SENT_P726_nested_account", account: "SENT_P726_fix_account",
  num: "72600931", numAccount: "72600932",
  houseList: "SENT_P726_house_list", houseFlat: "SENT_P726_house_flat", pinList: "SENT_P726_pin_list", pinFlat: "SENT_P726_pin_flat",
});
const leaks8 = (x) => Object.entries(S8).filter(([, s]) => JSON.stringify(x).includes(s)).map(([k]) => k).sort();
const media8 = (name) => `https://media.postmark.town/media/p726/${name}.png`;

const PRIVATE_FIX = () => ({ schema_version: 1, note: "invented for POS-726's FIX round", households: {
  "fen-hollow": { name: "Fen Hollow", human: PRIVATE_SENTINEL,
    accounts: [{ login: "fh-gh", id: 9821 }, S8.bare, Number(S8.numAccount), null, true, [{ login: S8.nested, id: 9822 }],
      { login: "fh2-gh", id: 9823, secret: S8.account }],
    residents: ["fen", "reed-b", "moss-c", "lark-d", "tern-e", "kit-f"], since: "2026-09-04", declared_by: "fen",
    home_images: { fen: IMG, "gone-wren": media8(S8.left), "reed-b": Number(S8.num), "moss-c": true, "lark-d": null, "tern-e": "",
      "kit-f": [media8(S8.list)] } },
  "lone-barn": { name: "Lone Barn", accounts: { login: "lb-gh", id: 9824 }, residents: ["barn"], since: "2026-09-05", declared_by: "barn",
    home_images: { "moved-x": media8(S8.alone) } },
  "odd-shed": { name: "Odd Shed", accounts: [{ login: "os-gh", id: 9825 }], residents: ["shed", "gone-wren"], since: "2026-09-06",
    declared_by: "shed", home_images: media8(S8.mapless) },
} });

// What the public read may show of it, by hand: the account objects in order, cut to login and id; only fen's
// own picture; no `accounts` where it is not a list, no `home_images` where no picture is left.
const PUBLIC_FIX = { schema_version: 1, note: "invented for POS-726's FIX round", households: {
  "fen-hollow": { name: "Fen Hollow", accounts: [{ login: "fh-gh", id: 9821 }, { login: "fh2-gh", id: 9823 }],
    residents: ["fen", "reed-b", "moss-c", "lark-d", "tern-e", "kit-f"], since: "2026-09-04", declared_by: "fen", home_images: { fen: IMG } },
  "lone-barn": { name: "Lone Barn", residents: ["barn"], since: "2026-09-05", declared_by: "barn" },
  "odd-shed": { name: "Odd Shed", accounts: [{ login: "os-gh", id: 9825 }], residents: ["shed", "gone-wren"], since: "2026-09-06", declared_by: "shed" },
} };

test("§ 8 home_images keeps only this house's residents' URL text, accounts only their objects; the valid values survive in order, the input is untouched", () => {
  const priv = deepFreeze(PRIVATE_FIX());
  const before = JSON.stringify(priv);
  assert.deepEqual(leaks8(priv), ["account", "alone", "bare", "left", "list", "mapless", "nested", "num", "numAccount"],
    "CONTROL: the private object carries every bad entry (the instrument can see them)");
  const pub = publicRegistry(priv);
  assert.deepEqual(leaks8(pub), [], "no bad entry reaches the public face (the list names each one that does)");
  assert.deepEqual(pub, PUBLIC_FIX, "exactly the declared shapes' values");
  assert.equal(JSON.stringify(pub), JSON.stringify(PUBLIC_FIX), "in the record's own order");
  assert.equal(leaks(pub), false, "and no private human");
  assert.equal(JSON.stringify(priv), before, "the private object is unchanged, byte for byte");
});

test("§ 8 a house or a pin that is not an object reads as null (the fold never builds one; held on the functions the door and the drain call)", () => {
  const reg = deepFreeze({ schema_version: 1, households: {
    "list-house": [{ name: "Listed", human: PRIVATE_SENTINEL, secret: S8.houseList }],
    "flat-house": S8.houseFlat,
    "kept-house": { name: "Kept", human: PRIVATE_SENTINEL },
  } });
  assert.deepEqual(leaks8(reg), ["houseFlat", "houseList"], "CONTROL: the input carries both house sentinels");
  const pub = publicRegistry(reg);
  assert.deepEqual(leaks8(pub), [], "neither reaches the public face");
  assert.equal(leaks(pub), false, "and no private human, even inside a list");
  assert.equal(JSON.stringify(pub), JSON.stringify({ schema_version: 1, households: { "list-house": null, "flat-house": null, "kept-house": { name: "Kept" } } }));
  const pins = deepFreeze({ "list-pin": [{ login: "lp-gh", id: 9841, secret: S8.pinList }], "flat-pin": S8.pinFlat, kept: { login: "kp-gh", id: 9842 } });
  assert.deepEqual(leaks8(pins), ["pinFlat", "pinList"], "CONTROL: the pins carry both pin sentinels");
  const pubPins = publicPins(pins);
  assert.deepEqual(leaks8(pubPins), []);
  assert.equal(JSON.stringify(pubPins), JSON.stringify({ "list-pin": null, "flat-pin": null, kept: { login: "kp-gh", id: 9842 } }));
  assert.deepEqual([publicHouse(null), publicHouse("a value"), publicHouse([{ name: "x" }])], [null, null, null]);
});

// THE INSTRUMENT for "a later column stays private". The three files the public answer is made in are copied
// from this checkout's src/ into a scratch folder, with every other import pointed back at the real src/ file,
// and the COPY of registry-rows.mjs's grammar grows by one name at each level: a house column (HOUSEHOLD_KEYS),
// a pin column (PIN_KEYS, and its spelling in PIN_COLUMN), and a key in each nested template (ACCOUNT_KEYS,
// LIKENESS_KEYS, INVITED_BY_KEYS). Each edit is anchored on its declaration line and refuses unless that line
// is there exactly once, so a rename reds here loudly rather than passing on an ungrown copy. A second copy
// also names the new keys in registry-public.mjs's lists, which is the control that the copies are the code
// under test and that the instrument can see a named field ride.
// What it cannot see: a public list derived from some other source of names (the row's own keys are § 7's
// to hold), or a grammar written anywhere but those declaration lines.
const SRC = join(ROOT, "src");
const COPIED = Object.freeze(["registry-rows.mjs", "registry-public.mjs", "households-read.mjs"]);
const LATER = Object.freeze({ house: "a_later_column", pin: "a_later_pin_key", pinColumn: "a_later_pin_col",
  account: "a_later_account_key", likeness: "a_later_likeness_key", invite: "a_later_invite_key" });
const GROW = Object.freeze({ "registry-rows.mjs": [
  ["export const HOUSEHOLD_KEYS = Object.freeze([", LATER.house], ["export const PIN_KEYS = Object.freeze([", LATER.pin],
  ["export const ACCOUNT_KEYS = Object.freeze([", LATER.account], ["export const LIKENESS_KEYS = Object.freeze([", LATER.likeness],
  ["export const INVITED_BY_KEYS = Object.freeze([", LATER.invite],
] });
const NAME = Object.freeze({ "registry-public.mjs": [
  ["const PUBLIC_HOUSE_KEYS = Object.freeze([", LATER.house], ["const PUBLIC_PIN_KEYS = Object.freeze([", LATER.pin],
  ["const PUBLIC_ACCOUNT_KEYS = Object.freeze([", LATER.account], ["const PUBLIC_LIKENESS_KEYS = Object.freeze([", LATER.likeness],
  ["const PUBLIC_INVITED_BY_KEYS = Object.freeze([", LATER.invite],
] });

/** `insert` right after the one line `anchor`; refuses unless the anchor is there exactly once. */
function insertAfter(text, anchor, insert, file) {
  const parts = text.split(anchor);
  assert.equal(parts.length - 1, 1, `${file}: the line ${JSON.stringify(anchor)} is there exactly once (this test's copy is out of step with the source)`);
  return parts.join(anchor + insert);
}

/** The three files copied to `dir`, the grammar grown (and with `named`, the public lists naming it too); answers an importer. */
function sourceCopy(dir, { named }) {
  mkdirSync(dir, { recursive: true });
  for (const f of COPIED) {
    let text = readFileSync(join(SRC, f), "utf8")
      .replace(/from "\.\/([\w.-]+\.mjs)"/g, (m, name) => (COPIED.includes(name) ? m : `from ${JSON.stringify(pathToFileURL(join(SRC, name)).href)}`));
    const stray = [...text.matchAll(/(?:from\s+|import\()\s*["'](\.\.?\/[^"']+)["']/g)].map((m) => m[1]).filter((p) => !COPIED.includes(p.slice(2)));
    assert.deepEqual(stray, [], `${f}: every import of a file not copied points at the real src/`);
    for (const [anchor, key] of GROW[f] ?? []) text = insertAfter(text, anchor, `${JSON.stringify(key)}, `, f);
    if (f === "registry-rows.mjs") text = insertAfter(text, "const PIN_COLUMN = Object.freeze({", ` ${LATER.pin}: ${JSON.stringify(LATER.pinColumn)},`, f);
    if (named) for (const [anchor, key] of NAME[f] ?? []) text = insertAfter(text, anchor, `${JSON.stringify(key)}, `, f);
    writeFileSync(join(dir, f), text);
  }
  return (f) => import(pathToFileURL(join(dir, f)).href);
}

const LATER_SENT = Object.freeze({ house: "SENT_P726_later_house", pin: "SENT_P726_later_pin", account: "SENT_P726_later_account",
  likeness: "SENT_P726_later_likeness", invite: "SENT_P726_later_invite" });
const leaksLater = (s) => Object.entries(LATER_SENT).filter(([, v]) => String(s).includes(v)).map(([k]) => k).sort();
const ALL_LATER = Object.keys(LATER_SENT).sort();

/** Invented rows with a sentinel in each place the grown grammar adds: the real fold's rows, plus the two new
 *  columns set on them (the real fold has no column for either, which is the point). */
function laterRows() {
  const rows = rowsFromRegistry({ schema_version: 1, note: "invented for POS-726's FIX round", households: {
    "ash-croft": { name: "Ash Croft", human: PRIVATE_SENTINEL,
      accounts: [{ login: "ac-gh", id: 9831, [LATER.account]: LATER_SENT.account }], residents: ["ash"], since: "2026-09-03", declared_by: "ash",
      likeness: { answer: "yes", at: "2026-10-21T00:00:00.000Z", by: "ac-gh", gh_id: 9831, words: "v1", [LATER.likeness]: LATER_SENT.likeness },
      invited_by: { by: "wren-c", named: "wren-c", at: "2026-09-03T00:00:00.000Z", [LATER.invite]: LATER_SENT.invite } },
  } }, { ash: { login: "ac-gh", id: 9831, pinned: "2026-09-03" } });
  rows.households[0][LATER.house] = LATER_SENT.house;
  rows.pins[0][LATER.pinColumn] = LATER_SENT.pin;
  return deepFreeze(rows);
}

test("§ 8 a later column stays private: grow the file's grammar in a copy of the source, and neither the printout nor the read carries it", async () => {
  const rows = laterRows();
  const before = JSON.stringify(rows);
  const grown = sourceCopy(join(TMP, "grammar-grown"), { named: false });
  const named = sourceCopy(join(TMP, "grammar-grown-and-named"), { named: true });
  const g = { rows: await grown("registry-rows.mjs"), read: await grown("households-read.mjs") };
  const n = { rows: await named("registry-rows.mjs"), read: await named("households-read.mjs") };

  const priv = g.rows.renderRegistry(rows);
  assert.deepEqual(leaksLater(priv.households + priv.pins), ALL_LATER,
    "CONTROL 1: the grown grammar's private render prints every new field, so the fold carries each one to the public cut");
  const realPriv = renderRegistry(rows);
  assert.deepEqual(leaksLater(realPriv.households + realPriv.pins), ["account", "invite", "likeness"],
    "CONTROL 1b: the real grammar has no house or pin column for them (only jsonb's unnamed keys reach its private render), so growth is what puts them in front of the cut");
  const nPub = n.rows.renderPublicRegistry(rows);
  const nWhole = await n.read.householdsRead({}, { rows });
  assert.deepEqual({ printout: leaksLater(nPub.households + nPub.pins), read: leaksLater(JSON.stringify(nWhole.body)) }, { printout: ALL_LATER, read: ALL_LATER },
    "CONTROL 2: once the public lists name them too, every new field rides: the instrument sees a named field, in the copy under test");

  const pub = g.rows.renderPublicRegistry(rows);
  const whole = await g.read.householdsRead({}, { rows });
  const some = await g.read.householdsRead({ h: "ash" }, { rows });
  assert.deepEqual([whole.status, some.status], [200, 200]);
  assert.deepEqual({ printout: leaksLater(pub.households + pub.pins), whole: leaksLater(JSON.stringify(whole.body)), narrowed: leaksLater(JSON.stringify(some.body)) },
    { printout: [], whole: [], narrowed: [] },
    "grown and not named: no new field reaches the printout or the read (the map names each level that does)");
  const real = renderPublicRegistry(rows);
  assert.deepEqual([pub.households, pub.pins], [real.households, real.pins], "the same bytes the real source prints: growing the grammar alone changed nothing public");
  assert.equal(leaks(pub.households) || leaks(JSON.stringify(whole.body)), false, "and no private human");
  assert.equal(JSON.stringify(rows), before, "the rows handed in are unchanged");
});
