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
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixtureTown } from "./fixture.mjs";
import { indexStore, seedRegistry } from "./helpers/office-under-test.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";
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

let IX = null, child = null, tmp = null, BASE = null;

before(async () => {
  if (!HAVE_CLONE) return;
  tmp = mkdtempSync(join(tmpdir(), "porch-lights-http-"));
  // the suite's town is rows in the store (POS-656): no office.db, no --db
  IX = await indexStore(fixtureTown(), { db: "porch_lights_http" });
  await seedRegistry(IX.store, { schema_version: 1, households: {
    "shard-house": { residents: ["kogane", "kogane-kin"], accounts: [{ login: "kogane-gh", id: 301 }], since: "2026-06-12", declared_by: "kogane" },
  } }, {});
  const c = await IX.store.connect("world2_owner");
  try {
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('town', 'porch-http-1', now()) ON CONFLICT (repo) DO UPDATE SET sha = EXCLUDED.sha");
    await c.query("INSERT INTO town_roll (town_sha, handle) VALUES ('porch-http-1', 'kogane') ON CONFLICT DO NOTHING");
    await c.query("INSERT INTO acts (at, actor, action, class) VALUES (now(), 'kogane-kin', 'say', 'voice')");
  } finally { await c.end(); }
  ({ child } = await bootOnFreePort((port) => {
    BASE = `http://127.0.0.1:${port}`;
    return spawn(process.execPath, [join(OFFICE_ROOT, "src", "server.mjs"), "--port", String(port), "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db")], {
      env: { ...process.env, ...IX.env, WORLD_GRAPH_NONE: "1", WORLD_APEX: "1", WORLD_CLONE: CLONE, TOWN_CLONE: join(tmp, "no-town-clone"), WORLD_READ_SHAPE: "" },
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
    // every house in sight is lit exactly when its own declared key is the lit one —
    // kogane's neighbour keith shares hh:shard-house on the clone, and is lit too
    const lits = litsOf(r);
    assert.ok(Object.keys(lits).length >= 1, `${what}: a house is in sight`);
    for (const [id, lit] of Object.entries(lits)) assert.equal(lit, DECLARED.get(id) === "hh:shard-house", `${what}: ${id} (${DECLARED.get(id)}) lit ${lit}`);
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
