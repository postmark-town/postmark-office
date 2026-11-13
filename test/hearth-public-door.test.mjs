// hearth-public-door.test.mjs — the house's PUBLIC reads at the household door, and the Hearth bundle over them (POS-1027).
//
//   node --test test/hearth-public-door.test.mjs
//
//   1. A house NAMED in the call answers from the public record, for anyone with no key: happened carries the public verbs only (an owner-only act the store
//      holds is neither returned nor named anywhere in the payload), `hand` narrows it, closer takes `days: "all"`, and went rows carry a `kind`.
//   2. A key with no `household` keeps its own whole read (no `public` marker, every act of the house); an anonymous call that names no house is refused 401.
//   3. THE HEARTH: `hearth` is the standalone calls made with no key, so each part equals the standalone call and the owner's bundle equals the anonymous one;
//      `days` is one part per ashore member in the house's order, `pairs` is unique and sorted by (a, b); no owner block rides it.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { storeIndexPooled } from "../src/town-index-store.mjs";
import { householdApex } from "../src/household-apex.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { poolFromClone, RECORD_ON } from "./registry-pool-stub.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { putValues, emptyTown } from "./fixture.mjs";
import { PUBLIC_HOUSE_VERBS } from "../src/hearth-public.mjs";

const AS_OF = "housefixture0000000000000000000000000000";
const HOUSE = "fixture-house";
const MEMBERS = ["r000", "r001", "r002", "r-harbor"];
const NOW = Date.parse("2026-09-27T06:00:00Z");
const SECRET = "SENTINEL-private-award-9f3a";

function houseDb() {
  const db = emptyTown();
  const put = (...v) => putValues(db, "meta", v);
  put("as_of", AS_OF);
  put("town_path", "fixture");
  put("hydrated_counts", JSON.stringify({}));
  for (const [i, h] of ["r000", "r001", "r002", "r-stranger"].entries()) {
    putValues(db, "residents", [h, JSON.stringify({ handle: h, is_office: false, last_active: `2026-09-2${i}T10:00:00.000Z`,
      address: { data: { since: "2026-01-01", joined: `2026-06-1${i}` } }, window_state: { hand_set: "2026-08-24", sections: [] } })]);
  }
  // a housemate is never a correspondent: the one outsider, r-stranger, writes to r000 four times and to r001 once, and r000 writes back twice, so the closer page represents the pairs (r-stranger, r000) and (r-stranger, r001) and no other
  const letter = (id, from, to, day) => putValues(db, "letters", [id, from, to, `2026-09-2${day}`, null, "inbox", to, `WHITE_PAGES/${to}/inbox/${id}.md`,
    JSON.stringify({ id, from, to, body: `# ${id}` }), `2026-09-2${day}T08:00:00.000Z`]);
  for (let i = 1; i <= 4; i++) letter(`rs-n${i}`, "r-stranger", "r000", `${i}`);
  letter("rs-n5", "r-stranger", "r001", "5");
  for (let i = 1; i <= 2; i++) letter(`r000-n${i}`, "r000", "r-stranger", `${i + 5}`);
  putValues(db, "mail_state", ["r000", JSON.stringify({ handle: "r000", language: "x", conversations: [], unplaced_bounces: [], summary: {} })]);
  return db;
}

const db = houseDb();
const IX = await indexStore(db, { db: "hearth_door" });
const IX_RESTORE = await IX.useInProcess();
after(async () => { await IX_RESTORE(); await IX.stop(); });
const scratch = mkdtempSync(join(tmpdir(), "postmark-hearth-door-"));
after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
mkdirSync(join(scratch, "tools"), { recursive: true });
writeFileSync(join(scratch, "tools", "households.json"), JSON.stringify({ households: {
  [HOUSE]: { name: "Fixture", human: "FIX", accounts: [{ login: "fixture", id: 1 }], residents: MEMBERS },
} }));
__setPoolForTest(poolFromClone(scratch));
const keep = { on: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
after(() => {
  __setPoolForTest(null);
  if (keep.on === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = keep.on;
  if (keep.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = keep.url;
});

// the house's acts: public verbs, one private one carrying the sentinel, and the house's own human hand
{
  const owner = await IX.store.connect("world2_owner");
  try {
    const act = (at, actor, action, object, payload = {}) =>
      owner.query("INSERT INTO acts (at, crossing, actor, action, object, class, household, payload) VALUES ($1,1,$2,$3,$4,'voice',$5,$6)",
        [at, actor, action, object, `hh:${HOUSE}`, JSON.stringify(payload)]);
    await act("2026-09-27T01:00:00Z", "r000", "say", "the-town/porch");
    await act("2026-09-27T01:05:00Z", "r001", "walk", "the-town/quay");
    await act("2026-09-27T01:10:00Z", "r000", "award", `${SECRET}/mark`, { note: SECRET });
    await act("2026-09-27T01:15:00Z", `human-of-${HOUSE}`, "say", "the-town/porch");
    await act("2026-09-27T01:20:00Z", "r001", "answer-sign-up", `${SECRET}/event`, { note: SECRET });
  } finally { await owner.end(); }
}

const ctx = (over = {}) => ({ clone: scratch, asOf: AS_OF, nowMs: NOW, ...over });
const anon = (args, over) => householdApex(args, null, ctx(over));
const ownerKey = { household: HOUSE, handles: new Set(["r000", "r001"]) };

test("1 · happened, named: the public verbs only, nothing of a private act in the payload, `hand` narrows", async () => {
  const r = await anon({ read: "happened", household: HOUSE });
  assert.equal(r.error, undefined, JSON.stringify(r));
  assert.equal(r.public, true);
  assert.ok(r.rows.length >= 3, "the say, the walk and the human's say");
  for (const row of r.rows) assert.ok(PUBLIC_HOUSE_VERBS.includes(row.action ?? row.verb ?? row.act), `a public verb: ${JSON.stringify(row)}`);
  assert.ok(!JSON.stringify(r).includes(SECRET), "a private act's words and objects are nowhere in the answer");
  const human = await anon({ read: "happened", household: HOUSE, hand: "human" });
  assert.equal(human.hand, "human");
  assert.equal(human.rows.length, 1);
  const one = await anon({ read: "happened", household: HOUSE, hand: "r001" });
  assert.equal(one.rows.length, 1, "r001's walk; the answer-sign-up is private");
  const bad = await anon({ read: "happened", household: HOUSE, hand: "stranger-no-house" });
  assert.equal(bad.error, "bounce", "a hand the house does not hold is refused by name");
});

test("2 · closer, named: `days: \"all\"` reads the whole record; the default window is the existing one", async () => {
  const all = await anon({ read: "closer", household: HOUSE, days: "all" });
  assert.equal(all.error, undefined, JSON.stringify(all));
  assert.equal(all.public, true);
  assert.equal(all.days, "all");
  assert.equal(all.since_day, null);
  const withHouse = all.rows.find((r) => r.with === "r-stranger");
  assert.ok(withHouse, JSON.stringify(all));
  assert.deepEqual(withHouse.house_members, ["r000", "r001"], "which of the house's residents wrote with them");
  assert.equal(withHouse.letters, 7);
  const week = await anon({ read: "closer", household: HOUSE, days: 7 });
  assert.equal(week.days, 7);
  assert.equal((await anon({ read: "closer", household: HOUSE, days: "forever" })).error, "bounce");
});

test("3 · own key with no household keeps its whole owner read; an anonymous call with no house is 401", async () => {
  const own = await householdApex({ read: "happened" }, ownerKey, ctx());
  assert.equal(own.error, undefined, JSON.stringify(own));
  assert.equal(own.public, undefined, "the owner's read is not marked public");
  assert.ok(JSON.stringify(own).includes(SECRET), "the owner's whole read still holds the owner-only acts");
  const none = await anon({ read: "closer" });
  assert.equal(none.code, 401);
  assert.match(none.hint, /household/);
});

// the walkers roll stamps its own clock on the house part (a number, `at`): it moves between two calls and is not a fact of the house
const steady = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === "at" && typeof x === "number" ? 0 : x)));
const TOWN_TOOLS = { posts: "read_posts", feed: "read_feed", pair: "read_pair" };
const standalone = async (via) => {
  if (via.door === "household") return householdApex({ read: via.read, args: via.args }, null, ctx());
  const { callTool } = await import("../src/mcp.mjs");
  return callTool(TOWN_TOOLS[via.read], via.args, { db: null, key: null, asOf: AS_OF, canWrite: false, clone: scratch });
};

test("4 · the Hearth: every part is its recorded standalone call, made with no key; the owner's bundle is the anonymous one", async () => {
  const bundle = await anon({ read: "hearth", household: HOUSE });
  assert.equal(bundle.error, undefined, JSON.stringify(bundle));
  assert.equal(bundle.read, "hearth");
  assert.equal(bundle.household, HOUSE);
  assert.deepEqual(Object.keys(bundle.parts), ["house", "posts", "closer", "went", "happened", "feed", "days", "pairs"]);
  assert.ok(!JSON.stringify(bundle).includes(SECRET), "no private act in any part");
  const single = ["house", "closer", "went", "happened", "feed"].map((k) => bundle.parts[k]);
  const list = [...bundle.parts.posts, ...bundle.parts.days, ...bundle.parts.pairs];
  assert.equal(bundle.parts.posts.length, 2);
  assert.deepEqual(bundle.parts.posts.map((p) => p.via.args.class), ["idea", "bug"]);
  for (const p of [...single, ...list]) assert.deepEqual(steady(p.data), steady(await standalone(p.via)), `${p.via.door}/${p.via.read} ${JSON.stringify(p.via.args)} equals its standalone call`);
  assert.deepEqual(bundle.parts.closer.via, { door: "household", read: "closer", args: { household: HOUSE, limit: 10 } });
  assert.deepEqual(bundle.parts.went.via.args, { household: HOUSE, view: "went", limit: 20 });
  assert.deepEqual(bundle.parts.happened.via.args, { household: HOUSE, limit: 20 });
  assert.deepEqual(bundle.parts.feed.via.args, { household: HOUSE, sort: "newest", limit: 20 });
  const owner = await householdApex({ read: "hearth", household: HOUSE }, ownerKey, ctx());
  assert.deepEqual(steady(owner), steady(bundle), "an owner's bundle is the anonymous bundle: no owner overlay");
  for (const k of ["owner", "registry", "needs_you", "mail"]) assert.ok(!(k in bundle) && !(k in bundle.parts), k);
});

test("5 · days: one per ashore member in the house's order, today UTC; pairs: unique and sorted by (a, b), from the closer page", async () => {
  const bundle = await anon({ read: "hearth", household: HOUSE });
  const { days, pairs } = bundle.parts;
  assert.deepEqual(days.map((d) => d.via.args.handle), ["r000", "r001", "r002"], "r-harbor is not ashore and has no day");
  assert.ok(days.every((d) => d.via.args.date === "2026-09-27"), "the current UTC date");
  const keys = pairs.map((p) => `${p.via.args.a}/${p.via.args.b}`);
  assert.deepEqual(keys, ["r000/r-stranger", "r001/r-stranger"]);
  assert.deepEqual(keys, [...new Set(keys)].sort());
});

test("6 · an unknown house is refused, not bundled empty", async () => {
  const r = await anon({ read: "hearth", household: "no-such-house" });
  assert.equal(r.error, "bounce");
  assert.equal((await anon({ read: "hearth" })).code, 422);
});
