// world-read-shape.test.mjs — the bare world read's shape switch (POS-486).
//
// WORLD_READ_SHAPE=v0|v1|v2 picks the default bare read while fresh test agents
// measure the candidates (tools/read-eval/). Unset, the read is byte-identical
// to the read before the switch: the same object comes back, and the tool's
// description and schema are the very objects they were.
//
// ── THE RIG ─────────────────────────────────────────────────────────────────
//
// ride-bounce-names-the-stops.test.mjs's: the real world clone, hydrated to rows
// and published as the world graph snapshot, and a record holding no acts.
// kogane stands where the clone puts her, on her own parcel.
//
// Run: WORLD_CLONE=<a world checkout> node --test test/world-read-shape.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NO_WORLD, OFFICE_ROOT, worldClone } from "./fixture-paths.mjs";
import { publishWorld } from "./helpers/world-rows.mjs";

const CLONE = worldClone();
const HAVE_CLONE = Boolean(CLONE) && existsSync(join(CLONE, "WORLD", "world-state.json"));
const WHY_NOT = CLONE ? `the world clone at ${CLONE} is missing world-state.json` : NO_WORLD;

const ENV = { WORLD_APEX: "1", WORLD2_PG: "1", WORLD2_PG_URL: "postgres://world-read-shape/none", WORLD_READ_SHAPE: undefined };
const saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
const setEnv = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
for (const [k, v] of Object.entries(ENV)) setEnv(k, v);

const { worldApex, APEX_TOOL, APEX_DESCRIPTION, fieldsFor } = await import("../src/world-apex.mjs");
const { __setPoolForTest } = await import("../src/world2-acts.mjs");
const { toolList } = await import("../src/mcp.mjs");
const { ONE_LINERS, namedFields, shapeRead, readShape, simplifyRing } = await import("../src/world-read-shape.mjs");

const WHO = "kogane";
const KEY = { handles: new Set([WHO]) };
let dir;

before(() => {
  if (!HAVE_CLONE) return;
  dir = mkdtempSync(join(tmpdir(), "read-shape-"));
  execFileSync(process.execPath, [join(OFFICE_ROOT, "src", "world-hydrate.mjs"),
    "--world", CLONE, "--no-db", "--rows-out", join(dir, "rows.json"), "--no-gexf", "--no-lints"],
  { stdio: "ignore", env: { ...process.env, TMP: dir, TEMP: dir, TMPDIR: dir } });
  publishWorld(join(dir, "rows.json"), "the world clone's head");
  __setPoolForTest({ async query(sql) {
    const text = String(sql).replace(/\s+/g, " ");
    if (/max\(id\) AS hw, count\(\*\) AS n FROM acts/.test(text)) return { rows: [{ hw: null, n: "0" }] };
    if (/SELECT id, at, crossing, actor, action, payload FROM acts/.test(text)) return { rows: [] };
    throw new Error(`the record was asked something it does not answer: ${text.slice(0, 160)}`);
  } });
});

after(() => {
  __setPoolForTest(null);
  for (const [k, v] of Object.entries(saved)) setEnv(k, v);
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A bare read as the MCP door makes it at `shape` (undefined = the var unset): the door passes the shape in ctx. */
async function bareAt(shape, args = {}) {
  setEnv("WORLD_READ_SHAPE", shape);
  try { return await worldApex({ handle: WHO, ...args }, KEY, shape ? { readShape: readShape() } : {}); }
  finally { setEnv("WORLD_READ_SHAPE", undefined); }
}

// ── v0: nothing moves ───────────────────────────────────────────────────────

test("v0 is the default: unset, empty or unknown, and the switch hands back the very answer it was given", () => {
  assert.equal(readShape({}), "v0");
  assert.equal(readShape({ WORLD_READ_SHAPE: "" }), "v0");
  assert.equal(readShape({ WORLD_READ_SHAPE: "v1" }), "v1");
  assert.equal(readShape({ WORLD_READ_SHAPE: "v9" }), "v0", "an unknown shape is v0, never a guess");
  const answer = { records: { a: { id: "a", weight_parts: {} } }, actions: [{ action: "say" }] };
  assert.equal(shapeRead(answer, { shape: "v0" }), answer, "the same object, untouched");
});

test("v0: the bare read, the tool's description and its schema are byte-identical with the var unset and set to v0", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const unset = JSON.stringify(await bareAt(undefined));
  assert.equal(JSON.stringify(await bareAt("v0")), unset);
  assert.ok(!unset.includes("read_shape"), "v0 carries no shape marker");
  const listed = (shape) => { setEnv("WORLD_READ_SHAPE", shape); try { return JSON.stringify(toolList().find((t) => t.name === "world")); } finally { setEnv("WORLD_READ_SHAPE", undefined); } };
  assert.equal(listed("v0"), listed(undefined));
  assert.equal(APEX_TOOL.description, APEX_DESCRIPTION, "v0 describes itself in the words it had");
  assert.deepEqual(APEX_TOOL.inputSchema.properties.cards.enum, ["names"], "v0's cards take only names");
  assert.equal(APEX_TOOL.inputSchema, APEX_TOOL.inputSchema, "the same schema object every time at v0");
});

// ── the one-liners ──────────────────────────────────────────────────────────

test("every field a one-liner names is a field of that act's real schema, and every required field is named", () => {
  for (const [action, { fields }] of Object.entries(ONE_LINERS)) {
    const real = fieldsFor(action);
    assert.ok(Object.keys(real).length || fields.length === 0, `${action} has a schema`);
    for (const name of namedFields(fields))
      assert.ok(name in real, `${action}'s line names "${name}", which its schema (${Object.keys(real).join(", ")}) does not take`);
    const named = new Set(namedFields(fields));
    for (const [name, spec] of Object.entries(real))
      if (spec?.required) assert.ok(named.has(name), `${action}'s line leaves out its required field "${name}"`);
  }
});

// ── v1 and v2 ───────────────────────────────────────────────────────────────

test("v1: bodies kept, records lean, polygons said, the ground by name, each act one line", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const full = await bareAt(undefined);
  const lean = await bareAt("v1");
  assert.equal(lean.read_shape, "v1");
  const named = new Set([...full.within.map((m) => m.id), ...full.nearby.map((o) => o.id)]);
  for (const id of named) {
    assert.ok(lean.records[id], `${id} is named by the read and keeps its record`);
    assert.equal(lean.records[id].body, full.records[id].body, `${id} keeps its body`);
  }
  for (const [id, rec] of Object.entries(lean.records)) {
    assert.ok(!("weight_parts" in rec), `${id} drops weight_parts`);
    if (full.records[id].weight !== undefined) assert.equal(rec.weight, full.records[id].weight, `${id} keeps its weight total`);
    for (const k of Object.keys(rec)) assert.ok(["id", "by", "kind", "class", "tier", "at", "extent", "body", "weight", "image", "dials", "shape", "vertices", "points"].includes(k), `${id} carries ${k}`);
    if (full.records[id].points?.length) {
      assert.equal(rec.shape, "polygon");
      assert.equal(rec.vertices, full.records[id].points.length);
      const inside = full.within.some((m) => m.id === id);
      if (inside) assert.ok(rec.points.length <= 8 && rec.points.length >= 3, `${id} (within) keeps an outline of at most 8`);
      else assert.ok(!("points" in rec), `${id} (not within) is said, not drawn`);
    }
  }
  assert.ok(lean.records["the-town/resident"]?.dials, "the mover's class keeps the pace the walk is priced by");
  const groundIds = Object.keys(full.records).filter((id) => !named.has(id) && full.records[id].kind !== "class");
  assert.ok(groundIds.length > 0, "the rig's read carries a ground set");
  assert.deepEqual(lean.ground.map((g) => g.id), groundIds, "the ground set becomes names, in order");
  for (const g of lean.ground) { assert.equal(typeof g.title, "string"); assert.ok(!(g.id in lean.records)); }
  assert.deepEqual(lean.actions.map((a) => a.action), full.actions.map((a) => a.action), "the same acts, one line each");
  for (const a of lean.actions) assert.match(a.line, /Fields: .+\.$|No fields\.$/);
  assert.deepEqual(lean.granted, full.granted, "what is open is the same; only how much is said changes");
  assert.ok(JSON.stringify(lean).length < JSON.stringify(full).length / 2, "the lean read is less than half the size");
});

test("v1: cards: \"full\" gives today's cards back, and cards: \"names\" is the dial it always was", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const full = await bareAt(undefined);
  assert.deepEqual((await bareAt("v1", { cards: "full" })).actions, full.actions);
  assert.deepEqual((await bareAt("v1", { cards: "names" })).actions, (await bareAt(undefined, { cards: "names" })).actions);
});

test("v2: the acts by name only", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const full = await bareAt(undefined);
  const v2 = await bareAt("v2");
  assert.deepEqual(v2.actions, full.actions.map((a) => a.action));
  assert.equal(v2.read_shape, "v2");
  assert.match(v2.cards_note, /cards: "full"/);
});

test("v1/v2: the description says the lean read and its size, and cards takes \"full\"", () => {
  for (const shape of ["v1", "v2"]) {
    setEnv("WORLD_READ_SHAPE", shape);
    try {
      assert.match(APEX_TOOL.description, /SIZE: a bare call is the lean read, roughly \d+k characters as of 2026-10/);
      assert.doesNotMatch(APEX_TOOL.description, /50–80k/);
      assert.doesNotMatch(APEX_TOOL.description, /the full mark record/);
      assert.deepEqual(APEX_TOOL.inputSchema.properties.cards.enum, ["names", "full"]);
    } finally { setEnv("WORLD_READ_SHAPE", undefined); }
  }
});

test("an outline keeps at most 8 vertices, from the ring itself", () => {
  const ring = Array.from({ length: 20 }, (_, i) => [Math.round(100 * Math.cos(i / 20 * 2 * Math.PI)), Math.round(100 * Math.sin(i / 20 * 2 * Math.PI))]);
  const out = simplifyRing(ring, 8);
  assert.equal(out.length, 8);
  for (const p of out) assert.ok(ring.some((q) => q[0] === p[0] && q[1] === p[1]), "every kept vertex is one of the ring's");
});
