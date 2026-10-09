// world-compact-read.test.mjs — the world tool says how big a bare call is, and
// `compact: true` answers the same ids small (POS-377, postmark-town/postmark#3393).
//
// ── THE SIGHTING ────────────────────────────────────────────────────────────
//
// Voss, a new resident: `world` with no `read:` returned about 74,000
// characters, a third of a 200k context, and the tool's description said
// nothing about size. Every new agent pays it on its first call. Voss's order:
// (1) a size line in the description naming the cheap reads; (2) `compact:
// true`, ids, coordinates and distances with no bodies or predicate blocks.
//
// ── THE RIG ─────────────────────────────────────────────────────────────────
//
// The real world clone, hydrated to rows and published as the world graph
// snapshot, and a record holding no passages. kogane stands where the clone
// puts her. The bare read and the compact read are asked at the same
// standpoint and compared id for id.
//
// Run: WORLD_CLONE=<a world checkout> node --test test/world-compact-read.test.mjs

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

const ENV = { WORLD_APEX: "1", WORLD2_PG: "1", WORLD2_PG_URL: "postgres://world-compact-read/none" };
const saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
for (const [k, v] of Object.entries(ENV)) process.env[k] = v;

const { worldApex } = await import("../src/world-apex.mjs");
const { toolList } = await import("../src/mcp.mjs");
const { __setPoolForTest } = await import("../src/world2-acts.mjs");
const { __forgetPassages } = await import("../src/enter-exit-ledger.mjs");

const WHO = "kogane";
const KEY = { handles: new Set([WHO]) };
const CEILING = 10_000; // the issue's check: a compact bare call is under 10k characters
let dir, bare, compact;

before(async () => {
  if (!HAVE_CLONE) return;
  dir = mkdtempSync(join(tmpdir(), "world-compact-"));
  execFileSync(process.execPath, [join(OFFICE_ROOT, "src", "world-hydrate.mjs"),
    "--world", CLONE, "--no-db", "--rows-out", join(dir, "rows.json"), "--no-gexf", "--no-lints"],
  { stdio: "ignore", env: { ...process.env, TMP: dir, TEMP: dir, TMPDIR: dir } });
  publishWorld(join(dir, "rows.json"), "the world clone's head");
  __forgetPassages();
  __setPoolForTest({ async query(sql) {
    const text = String(sql).replace(/\s+/g, " ");
    if (/max\(id\) AS hw, count\(\*\) AS n FROM acts/.test(text)) return { rows: [{ hw: null, n: "0" }] };
    if (/SELECT id, at, crossing, actor, action, payload FROM acts/.test(text)) return { rows: [] };
    throw new Error(`the record was asked something it does not answer: ${text.slice(0, 160)}`);
  } });
  bare = await worldApex({ handle: WHO }, KEY);
  compact = await worldApex({ handle: WHO, compact: true }, KEY);
});

after(() => {
  __setPoolForTest(null); __forgetPassages();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const size = (v) => JSON.stringify(v).length;

test("tools/list: the world tool says how big a bare call is, names the cheap reads, and declares compact", () => {
  const world = toolList().find((t) => t.name === "world");
  assert.ok(world, "the apex is listed with WORLD_APEX=1");
  assert.match(world.description, /a bare call returns roughly 50–80k characters as of 2026-10/, "an estimate, dated, never a flat claim");
  assert.match(world.description, /typically about 10k/);
  assert.match(world.inputSchema.properties.compact.description, /Typically about 10k characters/);
  assert.match(world.inputSchema.properties.compact.description, /A bare read only: with do: or read: it changes nothing/);
  assert.doesNotMatch(JSON.stringify(world), /[Uu]nder 10k/, "no flat ceiling the town will outgrow");
  for (const cheap of ["compact: true", 'mark: \\"<id>\\"', 'find: \\"<q>\\"', 'read: \\"<action>\\"', 'cards: \\"names\\"'])
    assert.ok(JSON.stringify(world.description).includes(cheap), `the size line names ${cheap}`);
  assert.equal(world.inputSchema.properties.compact?.type, "boolean", "compact is a declared field, or the closed schema bounces it");
});

test("compact: under 10k characters where the bare read is several times that", { skip: !HAVE_CLONE && WHY_NOT }, () => {
  assert.equal(bare.error, undefined, JSON.stringify(bare).slice(0, 300));
  assert.equal(compact.error, undefined, JSON.stringify(compact).slice(0, 300));
  assert.ok(size(compact) < CEILING, `compact was ${size(compact)} characters (bare ${size(bare)})`);
  assert.ok(size(bare) > 3 * size(compact), `bare ${size(bare)} vs compact ${size(compact)}: the dial must actually shrink the read`);
  assert.equal(compact.compact, true);
  assert.match(compact.compact_note, /mark:/);
});

test("compact: the same ids, the same acts, the same grants", { skip: !HAVE_CLONE && WHY_NOT }, () => {
  const ids = (r) => ({
    within: r.within.map((m) => m.id),
    nearby: r.nearby.map((m) => m.id),
    records: Object.keys(r.records),
    actions: r.actions.map((e) => e.action),
    granted: r.granted,
    standpoint: r.standpoint,
  });
  assert.deepEqual(ids(compact), ids(bare));
});

test("compact: coordinates and distances stay; bodies, predicate values, ring points and cards go", { skip: !HAVE_CLONE && WHY_NOT }, () => {
  for (const m of compact.within) assert.equal("body" in m, false, `${m.id} kept its body`);
  for (const [id, m] of Object.entries(compact.records)) {
    for (const gone of ["body", "value", "points", "dials", "weight_parts"]) assert.equal(gone in m, false, `${id} kept ${gone}`);
    const full = bare.records[id];
    if (full.at) assert.deepEqual(m.at, full.at, `${id}'s coordinates`);
    assert.equal(m.kind, full.kind);
  }
  assert.ok(Object.values(bare.records).some((m) => m.body), "the rig needs records with bodies to drop");
  assert.ok(compact.nearby.length && compact.nearby.every((o) => o.at && Number.isFinite(o.distance_m)), "nearby keeps where each is and how far");
  for (const e of compact.actions) assert.deepEqual(Object.keys(e).sort(), ["action", "via"], `${e.action}'s card rode a compact read`);
});

test("without compact the bare read is unchanged: full cards, bodies, no compact keys", { skip: !HAVE_CLONE && WHY_NOT }, () => {
  assert.equal("compact" in bare, false);
  assert.ok(bare.actions.every((e) => e.fields), "the default carries the fields a caller composes an act with");
  assert.ok(bare.within.some((m) => m.body));
});
