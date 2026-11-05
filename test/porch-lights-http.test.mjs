// porch-lights-http.test.mjs — WLD-29, the pointer model, OVER THE REAL HTTP
// DOORS: a spawned office (src/server.mjs, its own routing and read worker), on
// the suite's Postgres with synthetic registry/roll/act rows, over the world
// clone. What a page and an agent actually receive:
//
//   GET /world/dials    the blessed settlement's dials, named by that
//                       settlement and its sha — the page's stride
//   GET /world/lights   { crossing, window, lit: [household keys] }: the lit
//                       keys only; a past crossing says so with `lit: null`
//   GET /world/eyes, GET /world/apex
//                       no `dials`, no `activity`; the house in sight carries
//                       `lit`; `mark:` on it carries its porch light
//
// kogane's house on the clone is `hh:shard-house` (its parcel's
// declared_household); the store says kogane-kin lives there and acted now.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixtureTown } from "./fixture.mjs";
import { indexStore, seedRegistry } from "./helpers/office-under-test.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";
import { rowsEnv } from "./helpers/world-rows.mjs";
import { NO_WORLD, OFFICE_ROOT, worldClone } from "./fixture-paths.mjs";
import { currentCrossing } from "../src/crossings.mjs";

const CLONE = worldClone();
const HAVE_CLONE = Boolean(CLONE) && existsSync(join(CLONE, "WORLD", "world-state.json"));
const WHY_NOT = CLONE ? `the world clone at ${CLONE} is missing world-state.json` : NO_WORLD;
const PARCEL = "kogane/the-well-house-parcel";
const AT = "x=3935&y=-385";
const DECLARED = HAVE_CLONE
  ? new Map(JSON.parse(readFileSync(join(CLONE, "WORLD", "world-state.json"), "utf8")).marks.map((m) => [m.id, m.declared_household]))
  : new Map();

// THE HOUSES THIS STORE KNOWS (POS-896). The registry below is the one invented list of households the store is
// seeded with, and it is also what decides a house's light: a house whose declared key is in it is known (lit or
// dark), a house whose declared key is NOT in it is unknown to the store, and its light is `null` (never dark,
// household-activity.mjs § litOf). The world clone puts whatever houses it carries in sight of the standpoint;
// when the pin moves, new houses come into sight that this store has never heard of, and they are unknown. So
// the expectation is a function of the seeded registry and of each house's declared key, not of the clone's list.
const SEEDED_REGISTRY = { schema_version: 1, households: {
  "shard-house": { residents: ["kogane", "kogane-kin"], accounts: [{ login: "kogane-gh", id: 301 }], since: "2026-06-12", declared_by: "kogane" },
} };
const KNOWN_KEYS = new Set(Object.keys(SEEDED_REGISTRY.households).map((slug) => `hh:${slug}`));
const LIT_KEY = "hh:shard-house";   // the one household the store says acted now (see the act seeded in before())

/** What a house in sight must say: lit/dark for a house the store knows, `null` for one it does not. */
const expectedLit = (declaredKey, known = KNOWN_KEYS) => (known.has(declaredKey) ? declaredKey === LIT_KEY : null);

/** Every house in `lits` (id -> lit) whose light is not what the seeded registry and its declared key say. Empty when right. */
function litMismatches(lits, declaredOf, known = KNOWN_KEYS) {
  const out = [];
  for (const [id, lit] of Object.entries(lits)) {
    const want = expectedLit(declaredOf(id), known);
    if (lit !== want) out.push(`${id} (${declaredOf(id)}): lit ${JSON.stringify(lit)}, wanted ${JSON.stringify(want)}`);
  }
  return out;
}

let IX = null, child = null, tmp = null, BASE = null;

before(async () => {
  if (!HAVE_CLONE) return;
  tmp = mkdtempSync(join(tmpdir(), "porch-lights-http-"));
  // the suite's town is rows in the store (POS-656): no office.db, no --db
  IX = await indexStore(fixtureTown(), { db: "porch_lights_http" });
  await seedRegistry(IX.store, SEEDED_REGISTRY, {});
  const c = await IX.store.connect("world2_owner");
  try {
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('town', 'porch-http-1', now()) ON CONFLICT (repo) DO UPDATE SET sha = EXCLUDED.sha");
    await c.query("INSERT INTO town_roll (town_sha, handle) VALUES ('porch-http-1', 'kogane') ON CONFLICT DO NOTHING");
    await c.query("INSERT INTO acts (at, actor, action, class) VALUES (now(), 'kogane-kin', 'say', 'voice')");
  } finally { await c.end(); }
  // THE CLASS LAYER, AS PROD READS IT (POS-703). Since LOGOS v2 part 2 a class's
  // dials are its `kind: property` nodes and the class mark's frontmatter
  // `dials:` is empty, so the page's stride (the-town/resident's
  // pace_km_per_crossing) is read only through the class layer. With
  // WORLD_GRAPH_NONE this office had none, and the table found the stride in the
  // old frontmatter alone. Now it stands on the clone's own graph, hydrated here.
  const rowsOut = join(tmp, "rows.json");
  const h = spawnSync(process.execPath, [join(OFFICE_ROOT, "src", "world-hydrate.mjs"), "--world", CLONE, "--no-db", "--rows-out", rowsOut, "--office", OFFICE_ROOT, "--no-lints", "--no-gexf"], { encoding: "utf8" });
  if (h.status !== 0) throw new Error(`hydrating the clone exited ${h.status}
${h.stdout}
${h.stderr}`);
  const rows = JSON.parse(readFileSync(rowsOut, "utf8"));
  const graph = rowsEnv(rows.tables ?? rows, tmp);
  ({ child } = await bootOnFreePort((port) => {
    BASE = `http://127.0.0.1:${port}`;
    return spawn(process.execPath, [join(OFFICE_ROOT, "src", "server.mjs"), "--port", String(port), "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db")], {
      env: { ...process.env, ...IX.env, ...graph, WORLD_APEX: "1", WORLD_CLONE: CLONE, TOWN_CLONE: join(tmp, "no-town-clone"), WORLD_READ_SHAPE: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }));
});

after(async () => {
  if (child && child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
  await IX?.stop();
  if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const get = async (path) => { const r = await fetch(`${BASE}${path}`); return { status: r.status, body: await r.json() }; };
const litsOf = (r) => Object.fromEntries([...(r.within ?? []), ...(r.nearby ?? []), ...(r.objects ?? [])].filter((o) => "lit" in o).map((o) => [o.id, o.lit]));

test("GET /world/dials: the blessed settlement's dials, named by the settlement and its sha (the tag's commit — never a branch head)", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const { status, body } = await get("/world/dials");
  assert.equal(status, 200, JSON.stringify(body).slice(0, 200));
  const tag = execFileSync("git", ["-C", CLONE, "describe", "--tags", "--abbrev=0", "--match", "settlement/*", "HEAD"], { encoding: "utf8" }).trim();
  const sha = execFileSync("git", ["-C", CLONE, "rev-parse", `${tag}^{commit}`], { encoding: "utf8" }).trim();
  assert.equal(body.sha, sha, `the snapshot is ${tag}'s commit`);
  assert.equal(body.settlement, tag.replace("settlement/", ""));
  assert.ok(Number(body.dials["the-town/resident"]?.pace_km_per_crossing) > 0, "the page's stride is here");
  assert.doesNotMatch(JSON.stringify(body.dials), /"body"|"by"/, "dials only");
  assert.deepEqual((await get("/world/dials")).body, body, "the same settlement, the same answer");
});

test("GET /world/lights: the lit household keys only — today's crossing for a bare or empty ask; a past crossing says historical with `lit: null`", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const C = currentCrossing();
  for (const q of ["", "?crossing=", `?crossing=${C}`, "?crossing=-2"]) {
    const { status, body } = await get(`/world/lights${q}`);
    assert.equal(status, 200);
    assert.deepEqual(body, { crossing: C, window: 1, lit: ["hh:shard-house"] }, `${q || "bare"}: ${JSON.stringify(body)}`);
  }
  for (const q of [`?crossing=${C - 3}`, "?crossing=0"]) {
    const { body } = await get(`/world/lights${q}`);
    assert.equal(body.lit, null, `${q}: a past crossing is not a dark town`);
    assert.equal(body.historical, true);
    assert.match(body.note, /activity isn't kept per crossing/);
  }
});

test("GET /world/eyes and GET /world/apex: no `dials`, no `activity`, no house map; the house in sight is lit; mark: on it says its last active crossing", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const C = currentCrossing();
  const eyes = (await get(`/world/eyes?${AT}`)).body;
  const apex = (await get(`/world/apex?${AT}`)).body;
  for (const [what, r] of [["eyes", eyes], ["apex", apex]]) {
    assert.ok(!r.error, `${what}: ${JSON.stringify(r).slice(0, 200)}`);
    for (const k of ["dials", "activity"]) assert.ok(!(k in r), `${what} carries \`${k}\``);
    assert.doesNotMatch(JSON.stringify(r), /kogane-kin|"house_of"|"households"/, `${what}: no member, no map`);
    // every house in sight is lit exactly when its own declared key is the lit one, dark when the store knows it and
    // it did not act, and `null` (unknown, never dark) when the store's registry does not name it —
    // kogane's neighbour keith shares hh:shard-house on the clone, and is lit too
    const lits = litsOf(r);
    assert.ok(Object.keys(lits).length >= 1, `${what}: a house is in sight`);
    assert.deepEqual(litMismatches(lits, (id) => DECLARED.get(id)), [], `${what}: every light is the seeded registry's answer`);
    assert.ok(Object.keys(lits).some((id) => DECLARED.get(id) === LIT_KEY), `${what}: the lit house is in sight, so the loop above is not vacuous`);
    // a per-house unknown is not the whole answer being unknown: the sentence is for a slow or unread store, or a past crossing
    assert.ok(!("lit_unknown" in r), `${what}: known lights need no sentence`);
    assert.ok(!Object.hasOwn(r.records ?? {}, "the-town/resident"), `${what}: no class by name`);
  }
  assert.equal(litsOf(apex)[PARCEL], true, "the apex shows kogane's own parcel, lit");
  const focus = (await get(`/world/apex?${AT}&mark=${encodeURIComponent(PARCEL)}`)).body.focus;
  assert.equal(focus?.porch_light?.lit, true, JSON.stringify(focus?.porch_light));
  assert.equal(focus.porch_light.last_active_crossing, C);
  assert.deepEqual(Object.keys(focus.porch_light).sort(), ["crossing", "last_active_crossing", "lit", "means"], "when, and what lights a house — nothing else");
  assert.doesNotMatch(JSON.stringify(focus.porch_light), /kogane-kin|"who"|"house_of"/, "never who");
  assert.match(focus.porch_light.means, /C or C-1/);
  const notHouse = (await get(`/world/apex?${AT}&mark=${encodeURIComponent("the-town/let-there-be-light")}`)).body.focus;
  assert.ok(notHouse && !notHouse.error && !("porch_light" in notHouse), "a mark that is not a house carries no light");
  const past = (await get(`/world/apex?${AT}&crossing=${C - 3}`)).body;
  assert.equal(litsOf(past)[PARCEL], null, "a past crossing's house is unknown, not dark");
  assert.match(past.lit_unknown, /activity isn't kept per crossing/);
});

// ── THE DETECTORS (POS-896): invented houses, the seeded registry held fixed, and a wrong light for each branch ──
// No clone and no office: these run on the expectation alone, so they run (and can fail) wherever the file is read.
const INVENTED = new Map([
  ["invented/known-lit-house", "hh:shard-house"],      // in the registry, the household that acted now
  ["invented/unknown-house", "hh:not-in-the-registry"], // declared to a household the store has never heard of
]);
const declaredOfInvented = (id) => INVENTED.get(id);

test("detector · the right lights are accepted: a known acting house lit, a house the store does not name unknown (null)", () => {
  assert.deepEqual(litMismatches({
    "invented/known-lit-house": true, "invented/unknown-house": null,
  }, declaredOfInvented), []);
});

test("detector · an unknown house reported dark is refused by name (an unknown house is null, never dark)", () => {
  assert.deepEqual(litMismatches({ "invented/unknown-house": false }, declaredOfInvented),
    ['invented/unknown-house (hh:not-in-the-registry): lit false, wanted null']);
});

test("detector · an unknown house reported lit is refused by name", () => {
  assert.deepEqual(litMismatches({ "invented/unknown-house": true }, declaredOfInvented),
    ['invented/unknown-house (hh:not-in-the-registry): lit true, wanted null']);
});

test("detector · a known acting house reported unknown or dark is refused by name", () => {
  assert.deepEqual(litMismatches({ "invented/known-lit-house": null }, declaredOfInvented),
    ['invented/known-lit-house (hh:shard-house): lit null, wanted true']);
  assert.deepEqual(litMismatches({ "invented/known-lit-house": false }, declaredOfInvented),
    ['invented/known-lit-house (hh:shard-house): lit false, wanted true']);
});

test("detector · a household added to the registry turns the same house from unknown (null) to known and dark (false): the expectation follows the registry, not the clone", () => {
  const keys = (registry) => new Set(Object.keys(registry.households).map((slug) => `hh:${slug}`));
  const withMoss = keys({ households: { ...SEEDED_REGISTRY.households, "moss-house": {} } });
  const declaredOf = () => "hh:moss-house";
  assert.deepEqual(litMismatches({ "invented/moss-house": null }, declaredOf), [], "the seeded registry does not name it: unknown is right");
  assert.deepEqual(litMismatches({ "invented/moss-house": null }, declaredOf, withMoss),
    ['invented/moss-house (hh:moss-house): lit null, wanted false'], "once the registry names it, unknown is wrong");
  assert.deepEqual(litMismatches({ "invented/moss-house": false }, declaredOf, withMoss), [], "and dark is right");
});
