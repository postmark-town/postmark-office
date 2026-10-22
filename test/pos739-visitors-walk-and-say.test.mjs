// pos739-visitors-walk-and-say.test.mjs — a visitor walks and says, and every
// heard say carries its speaker's standing (POS-739).
//
// RULED (Darko, 2026-10-22 17:14 and 17:53 EDT): newcomers (berths) may walk
// and say like a resident, with the same walk law, sight and entry refusals;
// walk and say are their only acts. Every heard say carries
// `standing: "visitor"` or `"resident"`, a value so higher tiers can follow.
// The POS-300 rules gate before a berth's first say and the 14-crossing
// sunset stay.
//
// WHAT IS ON TRIAL
//   WALK      a bare berth key walks the real door as `berth-<slug>`, and the
//             record names that body; walking home goes to the quay.
//   STANDS    before it walks a berth stands at the quay (never the Origin),
//             after it walks it stands where the walk put it, and the co-sign's
//             set-down (berthPlace) reads that same place.
//   REFUSED   every other act is refused by its own name, at the gate both
//             doors share; a harbor household walks only as its berth.
//   LABELLED  every voice row says who spoke: visitor or resident.
//   TRUE      the arrival page no longer says "no walks".
//
// The world is a bottle (the harness of test/pos-165-walk-to-a-stop.test.mjs):
// a synthetic git-backed world whose engine is stubbed at the office's own
// import seam, so the walk door runs for real against it.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/pos739-visitors-walk-and-say.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const repo = mkdtempSync(join(tmpdir(), "pos739-world-"));
const pool = mkdtempSync(join(tmpdir(), "pos739-pool-"));
const voicesDir = mkdtempSync(join(tmpdir(), "pos739-voices-"));
after(() => rmSync(repo, { recursive: true, force: true }));
after(() => rmSync(pool, { recursive: true, force: true }));
after(() => rmSync(voicesDir, { recursive: true, force: true }));

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (path, text) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

const QUAY = { id: "the-town/the-quay", at: { x: 1390, y: 5665 } };
const LANTERN = { id: "host/the-lantern", at: { x: 40, y: -20 } };
const sited = (id, at) => {
  const [by] = id.split("/");
  return { id, by, household: by, kind: "sited", tier: by === "the-town" ? "constitution" : "market", at, extent: { w: 9, h: 9 }, body: `${id} stands here` };
};
put("WORLD/marks/let-there-be-light/mark.md",
  "---\nkind: sited\nby: the-town\ntier: market\ndate: 2026-10-22\nat: { x: 0, y: 0 }\nextent: { w: 4, h: 4 }\n---\n\nthe public frame\n");
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("WORLD/world-state.json", JSON.stringify({
  tick: 0, dials: {}, parcels: [], determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [],
  marks: [sited(QUAY.id, QUAY.at), sited(LANTERN.id, LANTERN.at)],
}));
put("seeding/manifest.json", JSON.stringify({ homes: [] }));
put("tools/mark-lint.mjs", "process.exit(0);\n");
put("tools/world-build.mjs", "export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }\n");
put("tools/world-verbs.mjs", `
export function orient(_state, world) { return { seen: world.marks.map((m) => m.id) }; }
export function openYourEyes() { return { fov: { carried: [], far: [], counts: {} }, radial: { byBearing: {}, counts: {} }, tell: () => "" }; }
export function investigate(id, world) { return world.marks.find((m) => m.id === id) ?? null; }
`);
// where-is places a walker at its last departure's end, as the real engine does,
// and nobody else: a berth that has not walked is unplaced, which is the arm the
// office must answer with the quay.
put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function householdOf(handle) { return handle; }
export function parcelFor() { return null; }
export function homeOf() { return { ...NOWHERE }; }
export function whereIs(h, { departures = [] } = {}) {
  const d = departures.filter((x) => x.handle === h).pop();
  return d ? { x: d.toward.x, y: d.toward.y, placed: true, source: "walk", mark_id: null,
    position: { x: d.toward.x, y: d.toward.y, arrived: true, remainingM: 0 } } : { ...NOWHERE };
}
`);
put("tools/walk.mjs", `
export function fractionalCrossing() { return 100.5; }
export function formatDeparture({ handle, from, toward, at }) {
  return \`- 2026-10-22T00:00:00.000Z · \${handle} · from \${from.x},\${from.y} · toward \${toward.x},\${toward.y} · at \${at}\`;
}
export function parseWalkLedger(text) {
  const departures = String(text ?? "").split(/\\r?\\n/).filter((l) => l.startsWith("- ")).map((line) => {
    const handle = line.split(" · ")[1];
    const m = line.match(/toward (-?[\\d.]+),(-?[\\d.]+)/);
    return { handle, line, toward: { x: Number(m?.[1] ?? 0), y: Number(m?.[2] ?? 0) } };
  });
  return { departures, unrecognized: [] };
}
export function currentDeparture(departures, handle) { return departures.filter((d) => d.handle === handle).pop() ?? null; }
export function positionAt(departure) {
  const at = departure?.toward ?? { x: 0, y: 0 };
  return { x: at.x, y: at.y, legM: 0, etaCrossings: 0, standing: true, arrived: true, remainingM: 0 };
}
`);
put("tools/vessel.mjs", "export function servicesFromFold() { return { services: [], errors: [] }; }\nexport function vesselPositionAt() { return null; }\nexport function ashoreOf() { return null; }\n");
put("tools/water.mjs", "export function crossingsOnSegment() { return []; }\n");
put("tools/geometry.mjs", `
export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function pointInRect(px, py, r) { return px >= r.x - r.w / 2 && px <= r.x + r.w / 2 && py >= r.y - r.h / 2 && py <= r.y + r.h / 2; }
export function overlapArea() { return 0; }
export const contains = () => false;
export const marksContain = () => false;
`);
put("tools/marks-fold.mjs", "export function loadMarks() { return []; }\nexport function fold() { return { marks: [] }; }\nexport function placementParent() { return null; }\nexport function marksContain() { return false; }\n");
git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "published main");

process.env.WORLD_CLONE = repo;
process.env.WORLD_POOL_DIR = pool;
process.env.WORLD_POOL_SIZE = "2";
delete process.env.HARBOR_WRITES;

const { walkViaOffice, residentStandpoint, berthPlace, chooseStandpoint } = await import("../src/world.mjs");
const { visitorGated, harborGated, visitorBounceFor } = await import("../src/harbor-gate.mjs");
const { standingOf, SPEAKER_STANDINGS, VISITOR_ACTS } = await import("../src/speaker-standing.mjs");
const { createVoices } = await import("../src/voices.mjs");
const { heardBlock } = await import("../src/world-read-v2.mjs");

// A bare berth's key, as oauth.mjs § berthLookup hands it over.
const berthKey = (slug) => ({ berth: true, slug, household: null, handles: new Set(), cosigned: false, rulesRead: true });
// A co-signed household still at the harbor that boarded as a berth.
const harborBerthKey = { household: "newhuman", handles: new Set(["newcomer"]), harbor: true, berth: "wanderer", slug: "wanderer" };
const houseA = { household: "house-a", handles: new Set(["alpha"]) };
const ledger = () => readFileSync(join(repo, "WORLD", "walk-ledger.md"), "utf8");

// ── WALK ─────────────────────────────────────────────────────────────────────

test("FALSIFIER: a bare berth walks the real door as its visitor body, and the record names that body", async () => {
  const walk = await walkViaOffice(repo, { mark_id: LANTERN.id }, berthKey("wanderer"));
  assert.equal(walk.handle, "berth-wanderer", "the walk was not the berth's own body");
  assert.equal(walk.mark_id, LANTERN.id);
  assert.ok(walk.ledger?.commit, "the walk was not recorded like a resident's");
  assert.match(ledger(), /· berth-wanderer · .*toward 40,-20/, "the record does not name the visitor's walk");
});

test("a visitor walks under the same walk law: a law node with no place is refused as it is for a resident", async () => {
  await assert.rejects(() => walkViaOffice(repo, { mark_id: "the-town/no-such-mark" }, berthKey("wanderer")),
    (e) => { assert.equal(e.code, 422); assert.match(String(e.defect), /no mark/); return true; });
});

test("a visitor's walk home goes to its berth at the quay", async () => {
  const walk = await walkViaOffice(repo, {}, berthKey("homebody"));
  assert.deepEqual(walk.toward, QUAY.at, "home for a visitor is the quay");
  assert.match(String(walk.toward_is), /your berth, at the quay/);
});

test("a resident's key cannot walk a berth's body, and a berth key walks no resident", async () => {
  await assert.rejects(() => walkViaOffice(repo, { handle: "berth-wanderer", x: 1, y: 1 }, houseA),
    (e) => { assert.equal(e.code, 403); return true; });
  await assert.rejects(() => walkViaOffice(repo, { handle: "alpha", x: 1, y: 1 }, berthKey("wanderer")),
    (e) => { assert.equal(e.code, 403); return true; });
});

test("a household still at the harbor walks as its berth, and never as its own resident", async () => {
  const walk = await walkViaOffice(repo, { x: 50, y: 50 }, harborBerthKey);
  assert.equal(walk.handle, "berth-wanderer");
  await assert.rejects(() => walkViaOffice(repo, { handle: "newcomer", x: 50, y: 50 }, harborBerthKey),
    (e) => { assert.equal(e.code, 403); assert.match(String(e.defect), /harbor/); return true; });
});

// ── STANDS ───────────────────────────────────────────────────────────────────

test("FALSIFIER: an unwalked berth stands at the quay, never the Origin; a walked one where it walked", async () => {
  const before = await residentStandpoint("berth-never-walked");
  assert.deepEqual({ x: before.x, y: before.y }, QUAY.at, "an unwalked visitor stood somewhere other than the quay");
  assert.equal(before.source, "berth");

  await walkViaOffice(repo, { x: 300, y: 400 }, berthKey("strider"));
  const after_ = await residentStandpoint("berth-strider");
  assert.deepEqual({ x: after_.x, y: after_.y }, { x: 300, y: 400 }, "the visitor's say and eyes did not follow its walk");
});

test("the co-sign sets a walked berth down where it walked, and an unwalked one at the quay", async () => {
  await walkViaOffice(repo, { x: 310, y: 410 }, berthKey("settler"));
  const walked = await berthPlace("settler");
  assert.deepEqual({ x: walked.x, y: walked.y }, { x: 310, y: 410 });
  const still = await berthPlace("stayed-put");
  assert.deepEqual({ x: still.x, y: still.y }, QUAY.at);
  assert.equal(still.mark, QUAY.id);
});

test("a berth key stands as its body for every read, unless a harbor household names its own resident", () => {
  assert.deepEqual(chooseStandpoint({}, berthKey("wanderer")), { stance: "embodied", handle: "berth-wanderer", visitor: true });
  assert.equal(chooseStandpoint({}, harborBerthKey).handle, "berth-wanderer");
  assert.equal(chooseStandpoint({ handle: "newcomer" }, harborBerthKey).handle, "newcomer");
  assert.equal(chooseStandpoint({}, houseA).handle, "alpha", "a resident's stance moved");
});

// ── REFUSED ──────────────────────────────────────────────────────────────────

test("FALSIFIER: a bare berth may walk and say and arrive, and every other act is refused by name", () => {
  const bare = berthKey("wanderer");
  for (const verb of ["world_say", "world_walk", "world_enter", "world_exit", "world_ride", "household_begin", "declare_household", "request_residency"])
    assert.ok(!visitorGated(bare, verb), `${verb} must stay open to a visitor`);
  for (const verb of ["world_leave_mark", "world_stake", "send_letter", "world_take", "strike", "world", "town_post", "/letters"])
    assert.ok(visitorGated(bare, verb), `${verb} must be refused to a visitor`);
  const r = visitorBounceFor("world_leave_mark");
  assert.equal(r.code, 403);
  assert.match(r.defect, /"leave_mark" comes with residency/);
  assert.equal(r.standing, "visitor");
  assert.deepEqual([...VISITOR_ACTS].sort(), ["enter", "exit", "ride", "say", "walk"]);
  for (const verb of ["world_enter", "world_exit", "world_ride"])
    assert.ok(!harborGated(harborBerthKey, verb), `a harbor household that boarded as a berth may ${verb} as it`);
});

test("the visitor gate never touches a resident, a settled household, or a harbor household (the harbor gate is theirs)", () => {
  assert.ok(!visitorGated(houseA, "world_leave_mark"));
  assert.ok(!visitorGated({ visitor: true }, "send_letter"));
  assert.ok(!visitorGated(harborBerthKey, "send_letter"));
  assert.ok(!visitorGated(null, "send_letter"));
  assert.ok(harborGated(harborBerthKey, "send_letter"), "the harbor still holds a harbor household's durable acts");
  assert.ok(!harborGated(harborBerthKey, "world_walk"), "a harbor household that boarded as a berth walks as it");
  assert.ok(harborGated({ household: "h", handles: new Set(["h1"]), harbor: true }, "world_walk"),
    "a harbor household that never boarded has no visitor body to walk");
});

// ── LABELLED ─────────────────────────────────────────────────────────────────

test("FALSIFIER: every heard say carries its speaker's standing, as a value", async () => {
  assert.deepEqual([...SPEAKER_STANDINGS], ["visitor", "resident"]);
  assert.equal(standingOf("berth-newcomer"), "visitor");
  assert.equal(standingOf("rei"), "resident");
  assert.equal(standingOf("human-of-starforge"), "resident");
  assert.equal(standingOf("berthillon"), "resident", "a resident whose name starts with berth (no hyphen) was heard as a visitor");

  let t = Date.UTC(2026, 9, 22, 22, 0, 0);
  const at = { "berth-newcomer": { x: 0, y: 0 }, rei: { x: 5, y: 0 } };
  const store = createVoices({
    standpoint: async (handle) => ({ handle, placed: true, x: at[handle].x, y: at[handle].y, aboard: false, moving: false }),
    place: async () => "the ground",
    logPath: join(voicesDir, "voices.jsonl"),
    now: () => t,
    hearingWindow: () => ({ since: t - 3_600_000, source: "the bench", disclosure: null }),
  });
  await store.say("berth-newcomer", "hello, what should I notice first?");
  t += 1000;
  const reply = await store.say("rei", "welcome!");
  const byHandle = (rows) => Object.fromEntries(rows.map((v) => [v.handle, v.standing]));
  assert.deepEqual(byHandle(reply.voices), { "berth-newcomer": "visitor", rei: "resident" }, "the say's voices");
  const heard = await store.heardAt({ x: 0, y: 0 });
  assert.deepEqual(byHandle(heard), { "berth-newcomer": "visitor", rei: "resident" }, "heardAt");
  assert.deepEqual(byHandle(reply.conversation.record), { "berth-newcomer": "visitor", rei: "resident" }, "the room's record");
  const [thread] = (await store.conversations()).live;
  assert.deepEqual(byHandle(thread.voices), { "berth-newcomer": "visitor", rei: "resident" }, "the conversations page");
  assert.deepEqual(heardBlock(heard).map((h) => h.standing), ["visitor", "resident"], "the v2 glance's heard");
});

test("FALSIFIER: no resident can be heard as a visitor — the door refuses a handle wearing berth-", async () => {
  const { validateResidencyRequest } = await import("../src/residency.mjs");
  assert.throws(() => validateResidencyRequest({ handle: "berth-sly", card: "hello" }, null),
    (e) => e.code === 409 && /reserved prefix/.test(e.defect), "a resident could take a handle the town hears as a visitor");
  assert.equal(standingOf("berth-sly"), "visitor", "the label is the visitor's, which is why the door must hold it");
});

// ── TRUE ─────────────────────────────────────────────────────────────────────

test("the arrival page tells a berth it walks and says, and no longer says it cannot walk", async () => {
  const { arrivalPage } = await import("../src/arrival.mjs");
  const got = (await arrivalPage(repo)).board_a_berth.what_you_get;
  assert.doesNotMatch(got, /no walks/);
  assert.match(got, /walk/);
  assert.match(got, /standing: "visitor"/);
  assert.match(got, /Marks, stakes, mail, takes and fights come with residency/);
});
