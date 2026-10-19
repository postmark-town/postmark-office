// admin-role.test.mjs — the town admin role, derived from GitHub (WLD-21; Darko
// 2026-10-18 19:38–19:52, the gap read's G1–G6 ruled 21:23).
//
// The law: a household is admin when a GitHub account on the house's OWN list
// owns the postmark-town org; every resident of it acts with it; it unlocks the
// three passage classes exactly (dungeon, stairs, portal-ground); it is derived
// in one record (role `admin` in the role book) that one refresh writes; a
// failed read keeps the last answer.
//
// Nothing here reaches GitHub, a store or a world clone. The role book is an
// in-memory SQLite paper with the registry's own schema; GitHub is a fetch stub;
// the world's admin-makers module is a stand-in with the module's shape (the
// office's pinned world clone predates it; the real module's own tests are in
// postmark-world tools/admin-makers.test.mjs); the class layer is a synthetic
// law snapshot published through its own query seam, as the candy door's tests
// publish theirs.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-admin-role");
delete process.env.OFFICE_ROLE_GATES; // every office today: roleGate is OPEN, and admin must not be read through it

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const { rolesSchema, grantRole, listRoles, auditTrail } = await import("../src/roles.mjs");
const { asPaper } = await import("../src/paperwork.mjs");
const admin = await import("../src/admin-role.mjs");
const { leaveMarkViaOffice } = await import("../src/world.mjs");
const { reloadLawSnapshot, resetLawSnapshot, LAW_REFRESH_SQLS } = await import("../src/law-snapshot.mjs");
const { makeableKind } = await import("../src/kind-holding.mjs");

const SCRATCH = mkdtempSync(join(tmpdir(), "admin-role-"));
test.after(() => { admin.__adminSeam(null); resetLawSnapshot(); rmSync(SCRATCH, { recursive: true, force: true }); });

// ── the town, as the store's registry holds it ──────────────────────────────
// Starforge's one account is the founder's (keeminlee); wright-starforge owns
// the org too, but no house lists it: a resident pinned to it (`ws`) stands in
// the rook house, whose own account is rookacc. mcd lists two accounts (G1).
const KEEMIN = 67605380, WS = 999001, ROOK = 555, MCD_A = 701, MCD_B = 702;
const registry = { households: {
  starforge: { name: "Starforge", accounts: [{ login: "keeminlee", id: KEEMIN }], residents: ["wright", "rei"] },
  rook: { name: "Rook", accounts: [{ login: "rookacc", id: ROOK }], residents: ["rook", "ws"] },
  mcd: { name: "mcd", accounts: [{ login: "jbmcdan", id: MCD_A }, { login: "j-bracey", id: MCD_B }], residents: ["mac"] },
} };
const pins = { wright: { login: "keeminlee", id: KEEMIN }, ws: { login: "wright-starforge", id: WS } };
const OWNERS = [{ login: "keeminlee", id: KEEMIN }, { login: "wright-starforge", id: WS }];

const book = () => { const db = new DatabaseSync(":memory:"); rolesSchema(db); return asPaper(db); };
const heldIds = async (paper) => (await listRoles(paper, { role: "admin" })).map((r) => String(r.subject)).sort();

// the world module's shape (tools/admin-makers.mjs): the three classes, exactly
const ADMIN_MAKERS = { ADMIN_CLASSES: ["dungeon", "stairs", "portal-ground"], isAdminClass: (k) => ["dungeon", "stairs", "portal-ground"].includes(String(k)) };

// ── the refresh: the role's one writer ──────────────────────────────────────

test("the refresh grants the house whose OWN account owns the org, and never a resident's pinned account", async () => {
  const paper = book();
  const r = await admin.refreshAdmins({ owners: OWNERS, registry, paper, apply: true });
  assert.equal(r.verified, true);
  assert.deepEqual(await heldIds(paper), [String(KEEMIN)], "keeminlee, on Starforge's own list; wright-starforge is on no house's list");
  assert.deepEqual(admin.adminHouseholdKeys(registry, await heldIds(paper)), ["hh:starforge"]);
  const trail = await auditTrail(paper, { subject: KEEMIN });
  assert.equal(trail[0].action, "grant");
  assert.equal(trail[0].actor, admin.ADMIN_ACTOR, "the audit names the refresh as the writer");
  assert.match(r.receipt, /grant keeminlee; revoke none/);
});

test("--check writes nothing", async () => {
  const paper = book();
  const r = await admin.refreshAdmins({ owners: OWNERS, registry, paper, apply: false });
  assert.equal(r.grant.length, 1);
  assert.deepEqual(await heldIds(paper), [], "nothing granted");
  assert.match(r.receipt, /nothing written/);
});

test("a house with two accounts is admin when either is an owner (G1)", async () => {
  const paper = book();
  await admin.refreshAdmins({ owners: [{ login: "j-bracey", id: MCD_B }], registry, paper, apply: true });
  assert.deepEqual(admin.adminHouseholdKeys(registry, await heldIds(paper)), ["hh:mcd"]);
});

test("a revocation is a refresh that READ the owners and no longer found the account: the row goes, the trail keeps it", async () => {
  const paper = book();
  await admin.refreshAdmins({ owners: OWNERS, registry, paper, apply: true });
  const r = await admin.refreshAdmins({ owners: [{ login: "wright-starforge", id: WS }], registry, paper, apply: true });
  assert.deepEqual(r.revoke.map((x) => x.subject), [String(KEEMIN)]);
  assert.deepEqual(await heldIds(paper), []);
  assert.equal((await auditTrail(paper, { subject: KEEMIN }))[0].action, "revoke");
});

test("a read that fails keeps the last answer and says UNVERIFIED (G4)", async () => {
  const paper = book();
  await admin.refreshAdmins({ owners: OWNERS, registry, paper, apply: true });
  const r = await admin.refreshAdmins({ owners: null, registry, paper, apply: true, note: "GitHub answered 401" });
  assert.equal(r.verified, false);
  assert.match(r.receipt, /UNVERIFIED.*GitHub answered 401.*keeminlee/);
  assert.deepEqual(await heldIds(paper), [String(KEEMIN)], "nothing revoked on a failed read");
});

test("GitHub's owners: an empty list, a refusal or a non-list is a failed read, never 'no owners'", async () => {
  const answer = (status, body) => async () => ({ ok: status === 200, status, json: async () => body });
  await assert.rejects(admin.readOrgOwners({ token: "t", fetchImpl: answer(200, []) }), /listed no owners.*Members: read/);
  await assert.rejects(admin.readOrgOwners({ token: "t", fetchImpl: answer(403, { message: "no" }) }), /403/);
  await assert.rejects(admin.readOrgOwners({ token: "t", fetchImpl: answer(200, { message: "x" }) }), /not a list/);
  await assert.rejects(admin.readOrgOwners({ token: "", fetchImpl: answer(200, OWNERS) }), /no token/);
  const asked = [];
  const owners = await admin.readOrgOwners({ token: "t", fetchImpl: async (url) => { asked.push(url); return { ok: true, status: 200, json: async () => OWNERS }; } });
  assert.deepEqual(owners, OWNERS);
  assert.match(asked[0], /\/orgs\/postmark-town\/members\?role=admin/);
});

// ── the reads: who is admin, and what it unlocks ────────────────────────────

test("every resident of the admin house is admin; a resident whose OWN pinned account owns the org, in another house, is not", async () => {
  const paper = book();
  await admin.refreshAdmins({ owners: OWNERS, registry, paper, apply: true });
  // a row on the pin's account, as if someone had written one: the house's own list is still what is read
  await grantRole(paper, { subject: WS, role: "admin", actor: "test" });
  admin.__adminSeam({ adminMakers: ADMIN_MAKERS, paper, rows: { registry, pins } });
  assert.equal(await admin.householdIsAdmin("wright"), true);
  assert.equal(await admin.householdIsAdmin("rei"), true);
  assert.equal(await admin.householdIsAdmin("ws"), false, "ws's own GitHub account confers nothing; rook's own list holds no admin");
  assert.equal(await admin.householdIsAdmin("nobody-known"), false);
});

test("admin is read from the book, never through roleGate: an empty book makes nobody admin with OFFICE_ROLE_GATES unset", async () => {
  admin.__adminSeam({ adminMakers: ADMIN_MAKERS, paper: book(), rows: { registry, pins } });
  assert.equal(await admin.householdIsAdmin("wright"), false);
  admin.__adminSeam({ adminMakers: ADMIN_MAKERS, paper: null, rows: { registry, pins } });
  assert.equal(await admin.householdIsAdmin("wright"), false, "a book that cannot be opened is no admin");
});

test("the three classes exactly, and nothing when the world does not carry the module", async () => {
  const paper = book();
  await admin.refreshAdmins({ owners: OWNERS, registry, paper, apply: true });
  admin.__adminSeam({ adminMakers: ADMIN_MAKERS, paper, rows: { registry, pins } });
  for (const k of ["dungeon", "stairs", "portal-ground"]) assert.equal(await admin.adminMakes(k, "wright"), true, k);
  for (const k of ["parcel", "vehicle", "arena", "adversary"]) assert.equal(await admin.adminMakes(k, "wright"), false, k);
  admin.__adminSeam({ adminMakers: null, paper, rows: { registry, pins } });
  assert.equal(await admin.adminMakes("dungeon", "wright"), false, "the strict direction");
});

test("explain's makers answer for the three classes says who else makes them (G6), and only for them", async () => {
  admin.__adminSeam({ adminMakers: ADMIN_MAKERS, paper: book(), rows: { registry, pins } });
  const dungeon = await admin.withAdminMakers({ explains: "dungeon", makers: { value: false, from: "the-town/dungeon" } });
  assert.equal(dungeon.makers.who, "false: the town's, and admin households' (owners of the postmark-town GitHub organisation)");
  assert.equal((await admin.withAdminMakers({ explains: "vehicle", makers: { value: false, from: "the-town/vehicle" } })).makers.who, undefined);
  assert.equal((await admin.withAdminMakers({ explains: "thing", makers: { value: true, from: "the-town/thing" } })).makers.who, undefined);
});

// ── the door: leave-mark ────────────────────────────────────────────────────

const CLASS_ROWS = [
  ["postmark-node", { dials: { makers: false } }], ["mark", { extends: "postmark-node" }],
  ["thing", { extends: "mark", dials: { makers: true } }],
  ["dungeon", { extends: "mark", dials: { makers: false } }], ["stairs", { extends: "mark", dials: { makers: false } }],
  ["portal-ground", { extends: "mark", dials: { makers: false } }],
  ["vehicle", { extends: "portal-ground", dials: { makers: false } }], ["arena", { extends: "portal-ground" }],
  ["parcel", { extends: "mark", dials: { makers: false } }],
].map(([key, data]) => ({ number: 250, tag_sha: "f".repeat(40), newest: 250, kind: "class", key, data: { class: key, ...data } }));

const sentence = async (payload, key) => {
  try { await leaveMarkViaOffice(process.env.WORLD_CLONE, payload, key); return "LANDED"; }
  catch (e) { return String(e.defect ?? e.message); }
};
const at = (klass, by, slug = `a-${klass}`) => ({ by, slug, kind: "sited", class: klass, at: { x: 3, y: 4 }, extent: { w: 4, h: 4 }, body: `A ${klass}.` });
const WRIGHT = { household: "keeminlee", handles: new Set(["wright"]) };
const ROOKS = { household: "rookacc", handles: new Set(["rook", "ws"]) };

test("leave-mark: an admin household makes a dungeon and a stair; another household is refused in today's words; admin never makes a parcel or a vehicle", async () => {
  await reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === LAW_REFRESH_SQLS.pin ? [{ newest: 250, pinned: 250 }] : CLASS_ROWS }) });
  const paper = book();
  await admin.refreshAdmins({ owners: OWNERS, registry, paper, apply: true });
  await grantRole(paper, { subject: WS, role: "admin", actor: "test" }); // the pin's account, which must confer nothing
  admin.__adminSeam({ adminMakers: ADMIN_MAKERS, paper, rows: { registry, pins } });

  for (const k of ["dungeon", "stairs", "portal-ground"])
    assert.doesNotMatch(await sentence(at(k, "wright"), WRIGHT), /town-only|unknown class/, `wright (Starforge, admin) passes the class gate for a ${k}`);
  assert.equal(await sentence(at("dungeon", "rook"), ROOKS), 'class "dungeon" is town-only', "a non-admin house: today's words (G6)");
  assert.equal(await sentence(at("stairs", "ws"), ROOKS), 'class "stairs" is town-only', "an org owner's own account, in a non-admin house");
  for (const k of ["parcel", "vehicle", "arena"])
    assert.equal(await sentence(at(k, "wright"), WRIGHT), `class "${k}" is town-only`, `admin does not make a ${k}`);
  assert.doesNotMatch(await sentence(at("thing", "rook"), ROOKS), /town-only/, "makers still answers first");
});

test("make-by-count never reads admin: a dungeon is not made by count, even for an admin household", async () => {
  const paper = book();
  await admin.refreshAdmins({ owners: OWNERS, registry, paper, apply: true });
  admin.__adminSeam({ adminMakers: ADMIN_MAKERS, paper, rows: { registry, pins } });
  const ext = { dungeon: "mark", mark: "postmark-node" };
  const view = { record: (k) => k in ext || k === "postmark-node", extendsOf: (k) => ext[k] ?? null,
    property: (n, p) => (p === "makers" ? { value: false, from: "dungeon" } : null) };
  assert.throws(() => makeableKind("dungeon", view), (e) => /town's to make/.test(e.defect ?? e.message));
});

// ── the desk and the printout ───────────────────────────────────────────────

test("tools/roles.mjs refuses to grant or revoke admin by hand: the refresh is the one writer", () => {
  for (const cmd of ["grant", "revoke"]) {
    const r = spawnSync(process.execPath, [join(OFFICE, "tools", "roles.mjs"), cmd, "--role", "admin", "--gh-id", String(KEEMIN), "--db", join(SCRATCH, "roles.db"), "--actor", "test"], { encoding: "utf8" });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /derived from GitHub/);
  }
});

test("the crossing commits a registry whose admins moved, even when no handle did", () => {
  const world = join(SCRATCH, "world");
  mkdirSync(join(world, "WORLD"), { recursive: true });
  const base = { generated_at: "2026-10-18T18:00:00.000Z", town_sha: "a".repeat(40), households: { wright: "hh:starforge" }, logins: { keeminlee: "hh:starforge" } };
  writeFileSync(join(world, "WORLD", "households.json"), `${JSON.stringify({ ...base, admins: [] }, null, 2)}\n`);
  const fresh = join(SCRATCH, "fresh.json");
  writeFileSync(fresh, `${JSON.stringify({ ...base, generated_at: "2026-10-19T06:00:00.000Z", admins: ["hh:starforge"] }, null, 2)}\n`);
  const r = spawnSync(process.execPath, [join(OFFICE, "deploy", "settlement-registry.mjs"), "--fresh", fresh, "--world", world, "--town-sha", "a".repeat(40)], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const receipt = JSON.parse(r.stdout);
  assert.equal(receipt.changed, true, "admins is substance");
  assert.deepEqual(receipt.admins_gained, ["hh:starforge"]);
  assert.deepEqual(JSON.parse(readFileSync(join(world, "WORLD", "households.json"), "utf8")).admins, ["hh:starforge"]);
});
