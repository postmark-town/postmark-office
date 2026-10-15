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

const ENV = { WORLD_MOVEMENT_V2: undefined, WORLD_PRESENCE: undefined, WORLD_APEX: "1", WORLD2_PG: "1", WORLD2_PG_URL: "postgres://world-read-shape/none", WORLD_READ_SHAPE: undefined };
const saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
const setEnv = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
for (const [k, v] of Object.entries(ENV)) setEnv(k, v);

const { worldApex, APEX_TOOL, APEX_DESCRIPTION, fieldsFor } = await import("../src/world-apex.mjs");
const { __setPoolForTest } = await import("../src/world2-acts.mjs");
const { toolList } = await import("../src/mcp.mjs");
const { ONE_LINERS, namedFields, shapeRead, readShape, simplifyRing, describeAt, oneLine, paceKmH } = await import("../src/world-read-shape.mjs");
const { TOOLS } = await import("../src/mcp.mjs");

const WHO = "kogane";
const KOGANE_PARCEL = "kogane/the-well-house-parcel";
// PR-3's live lines: the act record's high-water mark and the acts after a cursor's
const LIVE = { rows: [], hw: null };
const KEY = { handles: new Set([WHO]) };
let dir;

before(() => {
  if (!HAVE_CLONE) return;
  dir = mkdtempSync(join(tmpdir(), "read-shape-"));
  execFileSync(process.execPath, [join(OFFICE_ROOT, "src", "world-hydrate.mjs"),
    "--world", CLONE, "--no-db", "--rows-out", join(dir, "rows.json"), "--no-gexf", "--no-lints"],
  { stdio: "ignore", env: { ...process.env, TMP: dir, TEMP: dir, TMPDIR: dir } });
  publishWorld(join(dir, "rows.json"), "the world clone's head");
  __setPoolForTest({ async query(sql, params) {
    const text = String(sql).replace(/\s+/g, " ");
    if (/max\(id\) AS hw, count\(\*\) AS n FROM acts/.test(text)) return { rows: [{ hw: null, n: "0" }] };
    if (/SELECT id, at, crossing, actor, action, payload FROM acts/.test(text)) return { rows: [] };
    // v2's one new read (POS-632): each resident's newest public act. This
    // record holds no acts; the active split is test/world-read-v2.test.mjs's.
    if (/CROSS JOIN LATERAL \(SELECT action, at FROM acts/.test(text)) return { rows: [] };
    if (/^SELECT max\(id\)::text AS hw FROM acts$/.test(text)) return { rows: [{ hw: LIVE.hw }] };
    if (/^SELECT action, at, at_anchor, at_dx, at_dy FROM acts WHERE actor = \$1/.test(text))
      return { rows: [{ action: "say", at: new Date(Date.now() - 4 * 60000), at_anchor: KOGANE_PARCEL, at_dx: 0, at_dy: 0 },
        { action: "note-to-self", at: new Date(Date.now() - 5 * 60000), at_anchor: KOGANE_PARCEL, at_dx: 0, at_dy: 0 }] };
    if (/FROM acts WHERE id > \$1::bigint AND action = ANY/.test(text)) return { rows: LIVE.rows.filter((r) => Number(r.id) > Number(params[0])) };
    if (/FROM acts WHERE action = ANY\(\$1::text\[\]\) ORDER BY id DESC/.test(text)) return { rows: [...LIVE.rows].reverse() };
    // The apex asks the store whose household each ground is (POS-350). This
    // record holds no registry, so every handle is its own household.
    if (/^SELECT handle, household FROM identities/.test(text)) return { rows: [] };
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

// ── v2 (POS-632): the world read v2, opt-in per call ───────────────────────

const URL_RE = /https?:\/\/|\.png\b|\.jpe?g\b|token_url/;
const v2At = (args = {}) => worldApex({ handle: WHO, read_shape: "v2", ...args }, KEY, {});

test("v2: the blocks in read order, and none of v1's keys", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const v2 = await v2At();
  assert.equal(v2.read_shape, "v2");
  const keys = Object.keys(v2);
  for (const k of ["you", "now", "view", "who", "can", "law", "more", "reading_law"]) assert.ok(keys.includes(k), `v2 carries ${k}`);
  for (const k of ["within", "nearby", "records", "ground", "present", "actions", "granted", "actors", "standpoint"])
    assert.ok(!keys.includes(k), `v2 leaves ${k} out`);
  assert.ok("happened" in v2.now, "happened is always present (ruled 20:26)");
  assert.match(v2.now.happened.since, /^crossing \d+$/);
  assert.ok(v2.who.unavailable || (Array.isArray(v2.who.active) && typeof v2.who.around_but_quiet.count === "number"), "who is a block, or says why not");
  assert.equal(v2.you.handle, WHO);
  assert.ok(Array.isArray(v2.heard), "heard is read on the main thread (W4): a list, empty when the room is quiet");
});

test("v2: the view's places are v1's nearby, in the engine's rank, grouped by bearing", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const v1 = await bareAt("v1");
  const v2 = await v2At();
  const groups = Object.entries(v2.view).filter(([k]) => k !== "how");
  assert.deepEqual(groups.flatMap(([, rows]) => rows.map((r) => r.id)).sort(), v1.nearby.map((o) => o.id).sort(), "the same places");
  const rank = new Map(v1.nearby.map((o, i) => [o.id, i]));
  for (const [b, rows] of groups)
    for (let i = 1; i < rows.length; i++) assert.ok(rank.get(rows[i - 1].id) < rank.get(rows[i].id), `${b} keeps the rank`);
  const firsts = groups.map(([, rows]) => rank.get(rows[0].id));
  assert.deepEqual(firsts, [...firsts].sort((a, b) => a - b), "each group sits at its best member's rank");
});

test("v2: no url anywhere in a bare read, and a picture is a flag", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const v2 = await v2At();
  assert.doesNotMatch(JSON.stringify(v2), URL_RE);
  for (const [b, rows] of Object.entries(v2.view)) if (b !== "how") for (const r of rows) if ("image" in r) assert.equal(r.image, true);
});

// THE SIZE BUDGET IS PENDING DARKO (POS-632). The ≤5K was the build's target;
// Darko's 22:33 ruling put every mark's whole body back (bodies win; the lever is
// rows, never bodies), and the budget went to his Call. 8K holds CI meaningful
// meanwhile, on Wright's word.
test("v2: within the budget as the MCP door serves it, at the rig's standpoint (8k, pending Darko on POS-632)", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const served = JSON.stringify(await v2At(), null, 1).length; // mcp.mjs § the answer's text block
  assert.ok(served <= 8000, `v2 served is ${served} characters`);
});

test("v2: every mark the bare read shows carries its whole body (Darko 22:33)", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const { unbodied } = await import("./helpers/mark-bodies.mjs");
  const v2 = await v2At();
  assert.deepEqual(unbodied(v2), []);
  for (const [b, rows] of Object.entries(v2.view)) if (b !== "how") for (const r of rows) assert.equal(typeof r.body, "string", r.id);
  assert.ok(v2.you.within.length >= 1 && v2.you.within.every((m) => typeof m.body === "string" && m.name));
});

test("G4: with no cursor, happened reaches back to the previous crossing's start (review-555 § 2)", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  setEnv("WORLD_MOVEMENT_V2", "1");
  try {
    const v2 = await v2At();
    const { currentCrossing } = await import("../src/crossings.mjs");
    assert.equal(v2.now.happened.since, `crossing ${currentCrossing() - 1}`);
    assert.ok(!v2.now.happened.unavailable, "the delta is read with movement on");
  } finally { setEnv("WORLD_MOVEMENT_V2", undefined); }
});

test("v2: with presence off, who says so rather than showing an empty room", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  setEnv("WORLD_PRESENCE", undefined);
  const v2 = await v2At();
  assert.match(v2.who.unavailable ?? "", /presence is not switched on/);
});

test("v2: diagnostics rides v2 only, and cards: has nothing to size there", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const d = await v2At({ diagnostics: true });
  assert.ok(d.diagnostics?.law, "the full law block is behind the flag");
  assert.ok(!("diagnostics" in await v2At()));
  assert.equal((await worldApex({ handle: WHO, diagnostics: true }, KEY, {})).code, 422);
  assert.equal((await v2At({ cards: "names" })).code, 422);
  assert.equal((await v2At({ telling: true })).code, 422, "v2 tells no prose; v1 does (review-555 nit)");
});

test("v2: the per-call shape wins over the process's, both ways; v1 is the bytes it was", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const v1 = JSON.stringify(await bareAt("v1"));
  setEnv("WORLD_READ_SHAPE", "v2");
  try {
    assert.equal(JSON.stringify(await worldApex({ handle: WHO, read_shape: "v1" }, KEY, { readShape: readShape() })), v1, "read_shape: v1 under a v2 office is today's v1");
    assert.equal((await worldApex({ handle: WHO }, KEY, { readShape: readShape() })).read_shape, "v2", "the office's default is v2 when the env says so");
  } finally { setEnv("WORLD_READ_SHAPE", undefined); }
  assert.equal((await v2At()).read_shape, "v2", "a REST call that asks gets v2 too (W1)");
  assert.ok(!("read_shape" in await worldApex({ handle: WHO }, KEY, {})), "a REST call that does not ask is v0, as ever");
});

test("G9: read: \"view\" is the whole view, ranked as the glance ranks it, with more seats", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const glance = await v2At();
  const whole = await worldApex({ handle: WHO, read: "view", args: { limit: 30 } }, KEY, {});
  assert.equal(whole.read, "view");
  const ids = (v) => Object.entries(v).filter(([k]) => k !== "how").flatMap(([, rows]) => rows.map((r) => r.id));
  assert.ok(ids(whole.view).length >= ids(glance.view).length, "at least the glance's places");
  for (const id of ids(glance.view)) assert.ok(ids(whole.view).includes(id), `${id} is in the whole view too`);
  assert.doesNotMatch(JSON.stringify(whole), URL_RE);
  assert.equal((await worldApex({ handle: WHO, read: "view", args: { bogus: 1 } }, KEY, {})).code, 422, "a field the read does not take is refused by name");
  const { unbodied } = await import("./helpers/mark-bodies.mjs");
  assert.deepEqual(unbodied(whole), [], "every place in the whole view carries its whole body (Darko 22:33)");
  assert.deepEqual(unbodied(await worldApex({ handle: WHO, read: "happening" }, KEY, {})), [], "an event's place and a departure's destination too");
});

test("G9: read: \"who\", \"happened\" and \"happening\" answer their block whole, under its own name", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  for (const block of ["who", "happened", "happening"]) {
    const r = await worldApex({ handle: WHO, read: block }, KEY, {});
    assert.equal(r.read, block);
    assert.ok(block in r, `${block} rides under its own name`);
    assert.deepEqual(Object.keys(r).sort(), ["read", block, "cursor", "reading_law"].sort());
  }
});

test("PR-3: every v2 read hands back a cursor; passing it back reads only what came after it, live", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const { CURSOR_RE, decodeCursor } = await import("../src/read-grammar.mjs");
  setEnv("WORLD_MOVEMENT_V2", "1");
  LIVE.rows = [];
  LIVE.hw = "100";
  try {
    const first = await v2At();
    assert.match(first.cursor, CURSOR_RE);
    assert.equal(decodeCursor(first.cursor).hw, "100", "the record's high-water mark at this read");
    assert.ok(first.more.includes(`since: "${first.cursor}"`), "the more line carries this read's own cursor (PR-5)");
    LIVE.rows = [{ id: "101", actor: "elowen", action: "walk", at: new Date(), at_anchor: KOGANE_PARCEL, at_dx: 3, at_dy: 0 }];
    LIVE.hw = "101";
    const next = await v2At({ since: first.cursor });
    assert.equal(next.now.happened.since, "your last read (the cursor)");
    assert.deepEqual(next.now.happened.around_you.events.map((e) => e.who), ["elowen"], "only the act after the cursor");
    assert.equal(next.now.happened.complete, true, "nothing was cut");
    const old = await v2At({ since: "c1.0.0.100" });
    assert.equal(old.now.happened.complete, false, "a reach back past the last 14 crossings is clamped, and said");
    assert.match(old.now.happened.reach, /clamped to the last 14 crossings/);
    assert.equal(decodeCursor(next.cursor).hw, "101");
    LIVE.rows = [];
    const quiet = await v2At({ since: next.cursor });
    assert.equal(quiet.now.happened.around_you.count, 0, "nothing new is a true answer");
  } finally { setEnv("WORLD_MOVEMENT_V2", undefined); LIVE.rows = []; LIVE.hw = null; }
});

test("PR-4: investigate: on a resident rides the bare read, v1 and v2, with public acts only", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  for (const shape of [undefined, "v2"]) {
    const r = await worldApex({ handle: WHO, investigate: WHO, ...(shape ? { read_shape: shape } : {}) }, KEY, {});
    assert.ok(!r.error, JSON.stringify(r).slice(0, 300));
    assert.equal(r.investigated?.kind, "resident", `investigated rides ${shape ?? "v0"}`);
    assert.deepEqual(r.investigated.recent.acts.map((a) => a.did), ["said something"], "the say as the fact of it; the note never");
    assert.ok(!JSON.stringify(r.investigated).includes("note-to-self"));
    const { unbodied } = await import("./helpers/mark-bodies.mjs");
    assert.deepEqual(unbodied(r.investigated), [], "every mark under investigated carries its body");
  }
  assert.ok(!("investigated" in await v2At()), "absent when not asked");
  assert.equal((await worldApex({ handle: WHO, investigate: KOGANE_PARCEL }, KEY, {})).code, 422, "a mark is mark:'s");
  assert.equal((await worldApex({ handle: WHO, investigate: WHO, mark: KOGANE_PARCEL }, KEY, {})).code, 422, "one focus at a time");
  assert.equal((await worldApex({ handle: WHO, investigate: WHO, read: "view" }, KEY, {})).code, 422);
  // a creature (POS-637 PR-C): one no fold holds is "no creature", or the law is unreadable and it says so
  const creature = (await v2At({ investigate: "creature:wolf-270-1" })).investigated;
  assert.ok(creature.code === 404 || /creatures' law cannot be read/.test(creature.unavailable ?? ""), JSON.stringify(creature).slice(0, 200));
});

test("explain: every key of the real v2 read at the rig's standpoint has a row", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const { unexplained } = await import("../src/read-grammar.mjs");
  assert.deepEqual(unexplained("world", await v2At(), 2), []);
  assert.deepEqual(unexplained("world", await v2At({ diagnostics: true }), 2), []);
  assert.deepEqual(unexplained("world", await v2At({ investigate: WHO }), 2), []);
});

test("v1: the description says the lean read and its size, and cards takes \"full\"", () => {
  for (const shape of ["v1"]) {
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

test("a description that moved fails soft: the v0 words come back, nothing throws (#455 review, finding 2)", () => {
  const moved = "a description someone rewrote";
  assert.equal(describeAt(moved, "v1"), moved);
  assert.notEqual(describeAt(APEX_DESCRIPTION, "v1"), APEX_DESCRIPTION, "the real description still swaps; this test is the loud signal when it stops");
});

// ── the numbers in the lines, held against their sources (#455 review, finding 5) ──

test("walk's pace is the resident class's dial: the read's own dial gives the line, and a changed dial changes it", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const full = await bareAt(undefined);
  const dial = full.records["the-town/resident"]?.dials?.pace_km_per_crossing;
  assert.ok(Number(dial) > 0, "the read carries the pace dial");
  const lean = await bareAt("v1");
  assert.ok(lean.actions.find((a) => a.action === "walk").line.includes(`about ${dial / 12} km an hour`), "the line says the dial's pace");
  const walk = full.actions.find((a) => a.action === "walk");
  assert.match(oneLine(walk, { pace: paceKmH({ pace_km_per_crossing: 120 }) }).line, /about 10 km an hour/);
  assert.doesNotMatch(oneLine(walk).line, /km an hour/, "with no dial in hand the line names no speed");
});

test("leave-mark's ≤150 and 1✦ are the door's own: the body cap and the commons stake as the act's schema states them", () => {
  const lm = TOOLS.find((t) => t.name === "world_leave_mark");
  assert.match(lm.inputSchema.properties.body.description, /maximum 150 characters/, "the body cap the line repeats");
  assert.match(lm.description, /pass stamps: 1 to stake it/, "the commons stake the line repeats");
  assert.ok(ONE_LINERS["leave-mark"].fields.includes("body (≤150)"));
  assert.match(ONE_LINERS["leave-mark"].says, /elsewhere you stake 1✦/);
});

test("v2: the description says the v2 read and its size, and read_shape is on every shape's schema", () => {
  setEnv("WORLD_READ_SHAPE", "v2");
  try {
    assert.match(APEX_TOOL.description, /SIZE: a bare call is the world read v2, roughly 5k characters/);
  } finally { setEnv("WORLD_READ_SHAPE", undefined); }
  assert.deepEqual(APEX_TOOL.inputSchema.properties.read_shape.enum, ["v1", "v2"], "W1: a caller picks v1 or v2; v0 stays the REST cockpit's and the env's");
});

test("the lean read's stated size is near what it measures at the rig's standpoint", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  for (const shape of ["v1"]) {
    const chars = JSON.stringify(await bareAt(shape)).length;
    setEnv("WORLD_READ_SHAPE", shape);
    try {
      const stated = Number(/the lean read, roughly (\d+)k characters/.exec(APEX_TOOL.description)?.[1]) * 1000;
      assert.ok(chars > stated * 0.5 && chars < stated * 1.5, `${shape}: measured ${chars}, stated roughly ${stated}`);
    } finally { setEnv("WORLD_READ_SHAPE", undefined); }
  }
});
