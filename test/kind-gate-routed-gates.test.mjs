// kind-gate-routed-gates.test.mjs — each gate behind the leave door that #613
// routed through the class lineage, pinned in the new form on its own (LOGOS v2
// part 2, O2; review-613's follow-up).
//
// kind-gate-both-forms.test.mjs holds the door's matrix: what it accepts and the
// form it writes. Five gates behind it were routed from a literal `kind ===
// "sited"` to world-grants § isSited, and the matrix stays green with any of
// them flipped back, because none of its cases reaches what they decide. Each
// test here goes red on its own gate's flip:
//
//   groundNoteOf       a new-form thing on your own ground is told your ground
//   overhangOf         a new-form thing straddling the mark you stand in is told so
//   nestingParent      a new-form thing nests by its geometry, never by a parent_id
//                      it happened to carry (that edge is a description's)
//   discloseOverhang   the door's own answer carries that overhang
//   the claims pen     a new-form ringed row is boxed by its ring
//                      (world2-claims § claimTxFromJournal)
//
// And the defence in depth at the door's § THE FORM IT IS WRITTEN IN: a class
// whose lineage is parcel's is never written as its own kind, so `kind: sited,
// class: parcel` can never file `kind: parcel` and pass as a parcel.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/kind-gate-routed-gates.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const repo = mkdtempSync(join(tmpdir(), "kind-gates-world-"));
const town = mkdtempSync(join(tmpdir(), "kind-gates-town-"));
after(() => { sweep(repo); sweep(town); });
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (root, path, text) => { const full = join(root, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, text); };

// ── the world in a bottle (kind-gate-both-forms.test.mjs's), with an engine that nests ──
//
// Keith stands at his yard's centre (the bottle's where-is puts a resident at
// their own parcel's centre). The garage is elsewhere, so a thing in the yard
// nests in the yard by geometry and never in the garage.
const GARAGE_AT = { x: 3978, y: -398 };
const YARD_AT = { x: 4100, y: -300 };
const PUBLISHED = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 20000, h: 20000 }, body: "the world frame" },
  { id: "keith/the-garage", by: "keith", kind: "sited", tier: "home", at: GARAGE_AT, extent: { w: 20, h: 20 }, body: "one bay door up" },
  { id: "keith/the-yard", by: "keith", kind: "parcel", tier: "home", at: YARD_AT, extent: { w: 25, h: 25 }, body: "the yard behind the garage" },
];
put(repo, "tools/world-build.mjs", `export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }\n`);
put(repo, "tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function homeOf(handle, world) {
  const parcel = (world?.parcels ?? []).find((p) => p.household === handle);
  if (!parcel) return { ...NOWHERE };
  return { x: parcel.at.x, y: parcel.at.y, placed: true, source: "parcel", mark_id: parcel.id, parcel };
}
export function whereIs(handle, { world = null } = {}) { return homeOf(handle, world); }
export function publicResidents() { return []; }
`);
put(repo, "tools/world-verbs.mjs", `
export function containmentChain(pos, marks) {
  return (marks ?? [])
    .filter((m) => m.at && m.extent && Math.abs(pos.x - m.at.x) <= m.extent.w / 2 && Math.abs(pos.y - m.at.y) <= m.extent.h / 2)
    .sort((a, b) => (b.extent.w * b.extent.h) - (a.extent.w * a.extent.h))
    .map((m) => ({ id: m.id, by: m.by, tier: m.tier, body: m.body }));
}
export function orient() { return { seen: [] }; }
export function investigate() { return null; }
export function pointWithinMark(p, m) {
  return Boolean(m?.at && m?.extent) && Math.abs(p.x - m.at.x) <= m.extent.w / 2 && Math.abs(p.y - m.at.y) <= m.extent.h / 2;
}
`);
// The engine's nesting contract, as the office hands it over (world.mjs §
// nestingParent): a candidate the office hands a \`_parentMarkId\` is a
// description and nests under it; any other nests by geometry, in the smallest
// mark that wholly contains it, else the world root.
put(repo, "tools/marks-fold.mjs", `
export function loadMarks() { return []; }
export const PARCEL_EXTENT_M = 25;
export const PARCEL_CLAIM_CAP = 3;
export const PARCEL_CAP_LAW_DATE = "2026-07-30";
export function marksContain(outer, inner) {
  if (!outer?.at || !outer?.extent || !inner?.at) return false;
  return Math.abs(inner.at.x - outer.at.x) <= outer.extent.w / 2
      && Math.abs(inner.at.y - outer.at.y) <= outer.extent.h / 2;
}
const inside = (o, i) => o.at && o.extent && i.at && i.extent
  && i.at.x - i.extent.w / 2 >= o.at.x - o.extent.w / 2 && i.at.x + i.extent.w / 2 <= o.at.x + o.extent.w / 2
  && i.at.y - i.extent.h / 2 >= o.at.y - o.extent.h / 2 && i.at.y + i.extent.h / 2 <= o.at.y + o.extent.h / 2;
export function containmentParentOf(c, all) {
  if (c._parentMarkId) return c._parentMarkId;
  const area = (m) => m.extent.w * m.extent.h;
  const up = all.filter((m) => m.id !== c.id && m.id !== "the-town/let-there-be-light" && inside(m, c) && area(m) > area(c))
    .sort((a, b) => area(a) - area(b))[0];
  return up ? up.id : "the-town/let-there-be-light";
}
`);
put(repo, "tools/geometry.mjs", `
export const rect = (m) => ({ x0: m.at.x - m.extent.w / 2, x1: m.at.x + m.extent.w / 2, y0: m.at.y - m.extent.h / 2, y1: m.at.y + m.extent.h / 2 });
export function overlapArea(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}
`);
put(repo, "seeding/manifest.json", JSON.stringify({ homes: [] }));
put(repo, "WORLD/households.json", JSON.stringify({ households: { keith: "gh:1" } }));
put(repo, "WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put(repo, "WORLD/world-state.json", JSON.stringify({
  tick: 0, dials: {}, marks: PUBLISHED,
  parcels: PUBLISHED.filter((m) => m.kind === "parcel").map((m) => ({ id: m.id, household: m.by, at: m.at, extent: m.extent })),
  determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [],
}));
put(repo, "WORLD/filing-freeze.json", JSON.stringify({ frozen_at: "2026-08-25", marks: {} }));
git("init", "-q", "-b", "main");
git("config", "user.email", "test@postmark.town");
git("config", "user.name", "kind-gates falsifier");
git("add", "-A");
git("commit", "-qm", "canon: keith's garage and yard");
git("branch", "-q", "draft/keithhouse");

const { rowsFromRegistry } = await import("../src/registry-rows.mjs");
const REGISTRY_ROWS = rowsFromRegistry({ households: {
  "keith-house": { residents: ["keith"], accounts: [{ login: "keith-gh", id: 1 }] },
} }, {});

process.env.WORLD_CLONE = repo;
process.env.TOWN_CLONE = town;
process.env.WORLD_SINGLE_LOG = "1";
process.env.W2_GUARDS = "1";
process.env.W2_PEN = "mark,hold";
process.env.WORLD2_CANDLE = "1";
process.env.TOWN_PUSH = "";

const { installActsPen, uninstallActsPen, RECORD_ON } = await import("./acts-pen-stub.mjs");
process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
const claimsPen = await import("../src/world2-claims.mjs");
let pen = null;
const fresh = () => { uninstallActsPen(); pen = installActsPen({ marks: [], households: REGISTRY_ROWS.households }); claimsPen.__setPoolForTest(pen); return pen; };
fresh();
after(() => { uninstallActsPen(); claimsPen.__setPoolForTest(null); delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; });

const world = await import("../src/world.mjs");
const { reloadLawSnapshot, resetLawSnapshot, LAW_REFRESH_SQLS } = await import("../src/law-snapshot.mjs");
after(() => resetLawSnapshot());

// W2's class tree (postmark-world b12b7156) as the office's class layer.
const SHA = "e".repeat(40);
const row = (key, ext, makers) => ({ number: 260, tag_sha: SHA, newest: 260, kind: "class", key,
  data: { class: key, ...(ext ? { extends: ext } : {}), ...(makers === undefined ? {} : { dials: { makers } }) } });
const W2 = { "postmark-node": null, mark: "postmark-node", sited: "mark", thing: "sited", parcel: "sited", predicate: "mark", naming: "predicate" };
await reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === LAW_REFRESH_SQLS.pin ? [{ newest: 260, pinned: 260 }]
  : [row("postmark-node", null, false), row("mark", "postmark-node"), row("sited", "mark", true), row("thing", "sited", true),
    row("parcel", "sited"), row("predicate", "mark"), row("naming", "predicate")] }) });
const extendsOf = (name) => W2[String(name)] ?? null;

const KEITH = { household: "keithhouse", handles: new Set(["keith"]) };
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const YARD = { id: "keith/the-yard", by: "keith", kind: "parcel", at: YARD_AT, extent: { w: 25, h: 25 } };

// ── the pure gates ───────────────────────────────────────────────────────────

test("groundNoteOf: a new-form thing on your own ground is told your ground, exactly as a kind: sited one is", () => {
  const ask = (kind) => world.groundNoteOf({ kind, at: YARD_AT, extent: { w: 1, h: 1 }, own: [YARD], onOwnGround: true, nearM: 25, extendsOf });
  const sited = ask("sited");
  assert.ok(sited?.your_ground?.length, `the old form is told its ground: ${JSON.stringify(sited)}`);
  assert.deepEqual(ask("thing"), sited, "kind: thing stands as sited by its lineage, and is told the same");
  assert.equal(ask("parcel"), null, "a parcel is its own ground: no note, as before");
  assert.equal(ask("predicate"), null, "a description has no ground of its own");
});

test("overhangOf: a new-form thing straddling the mark you stand in is told it overhangs it", () => {
  const ask = (kind) => world.overhangOf({ id: "keith/a-long-bench", kind, parent: "the-town/let-there-be-light", at: YARD_AT,
    extent: { w: 40, h: 2 }, standing: { placed: true, x: YARD_AT.x, y: YARD_AT.y },
    spine: [{ id: "the-town/let-there-be-light" }, { id: "keith/the-yard" }], extendsOf });
  const sited = ask("sited");
  assert.equal(sited?.standing_in, "keith/the-yard", `the old form is told: ${JSON.stringify(sited)}`);
  assert.deepEqual(ask("thing"), sited, "kind: thing is told the same");
  assert.equal(ask("predicate"), null, "a description has no ground to overhang");
});

// ── the gates the door reaches ───────────────────────────────────────────────

test("nestingParent: a new-form thing nests by its geometry, never under a parent_id it carried", async () => {
  fresh();
  const leave = (spelling, slug) => world.leaveMarkViaOffice(repo, { by: "keith", slug, ...spelling, parent_id: "keith/the-garage",
    at: YARD_AT, extent: { w: 1, h: 1 }, body: "A pine crate, nailed shut.", preview: true }, KEITH);
  const old = await leave({ kind: "sited", class: "thing" }, "a-crate-old");
  assert.equal(old.parent, "keith/the-yard", `the old form nests in the yard it stands in: ${JSON.stringify(old.parent)}`);
  const neu = await leave({ kind: "thing" }, "a-crate-new");
  assert.equal(neu.kind, "thing", "the preview answers in the new form");
  assert.equal(neu.parent, "keith/the-yard", "the new form nests there too, never in the garage its stray parent_id named");
});

test("discloseOverhang: the door's answer tells a new-form thing it overhangs the mark its author stands in", async () => {
  fresh();
  const leave = (spelling, slug) => world.leaveMarkViaOffice(repo, { by: "keith", slug, ...spelling,
    at: YARD_AT, extent: { w: 40, h: 2 }, body: "A long bench, longer than the yard." }, KEITH);
  const old = await leave({ kind: "sited", class: "thing" }, "a-long-bench-old");
  assert.equal(old.overhang?.standing_in, "keith/the-yard", `the old form is told: ${JSON.stringify(old.overhang)}`);
  const neu = await leave({ kind: "thing" }, "a-long-bench-new");
  assert.equal(parse(pen.claims().at(-1).data).kind, "thing", "written in the new form");
  assert.equal(neu.overhang?.standing_in, "keith/the-yard", `the new form is told the same: ${JSON.stringify(neu.overhang)}`);
});

// ── the claims pen ───────────────────────────────────────────────────────────

// A ring that disagrees with the at/extent sent (kinofire's 10-02 shape: at at
// the corner), reaching the pen by another road than the door, which derives
// the box itself.
const RING = [[0, 0], [10, 0], [10, 4], [0, 4], [0, 0]];
function recordingClient() {
  const asked = [];
  return {
    async query(sql, params = []) {
      const q = String(sql).replace(/\s+/g, " ").trim();
      asked.push({ q, params });
      if (/^SELECT id FROM windows/i.test(q)) return { rows: [{ id: 226 }], rowCount: 1 };
      if (/^INSERT INTO claims/i.test(q)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    inserted() {
      const ins = asked.find((a) => /^INSERT INTO claims/i.test(a.q));
      return ins ? { geometry: JSON.parse(ins.params[5]), bbox: ins.params[6] } : null;
    },
  };
}
const rowOf = (payload) => ({ class: "mark", action: "leave-mark", actor: payload.by, object: `${payload.by}/${payload.slug}`, payload: JSON.stringify(payload) });

test("the claims pen: a new-form ringed row is boxed by its ring, exactly as a kind: sited one is", async () => {
  const file = async (spelling, slug) => {
    const c = recordingClient();
    await claimsPen.claimTxFromJournal(c, rowOf({ by: "keith", slug, ...spelling, at: { x: 0, y: 0 }, extent: { w: 1, h: 1 },
      points: RING, body: "A bench along the fence.", put_forward: true }), 9001, { household: "keith-house" });
    return c.inserted();
  };
  const old = await file({ kind: "sited", class: "thing" }, "a-fence-bench-old");
  assert.deepEqual({ at: old.geometry.at, extent: old.geometry.extent }, { at: { x: 5, y: 2 }, extent: { w: 10, h: 4 } }, "the old form is boxed by its ring");
  const neu = await file({ kind: "thing" }, "a-fence-bench-new");
  assert.deepEqual({ at: neu.geometry.at, extent: neu.geometry.extent }, { at: { x: 5, y: 2 }, extent: { w: 10, h: 4 } }, "kind: thing is boxed the same");
  assert.equal(neu.bbox, old.bbox, "and its bbox column is the ring's box");
});

// ── defence in depth: the form written ───────────────────────────────────────

test("THE FORM IT IS WRITTEN IN never writes a parcel lineage as its own kind: kind: sited + class: parcel stays that", async () => {
  fresh();
  const r = await world.leaveMarkViaOffice(repo, { by: "keith", slug: "a-parcel-by-class", kind: "sited", class: "parcel",
    at: YARD_AT, extent: { w: 1, h: 1 }, body: "A mark that names the parcel class." }, KEITH);
  assert.ok(r?.id, JSON.stringify(r));
  const c = pen.claims().at(-1);
  assert.equal(c.class, "sited", "the claim's kind column is never parcel: no parcel dial, cap or overlap law was asked of it");
  assert.equal(parse(c.data).class, "parcel", "it keeps the class it named, in the old form");
});
