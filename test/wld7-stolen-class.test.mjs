// wld7-stolen-class.test.mjs — WLD-7: a STOLEN class refuses give, take and drop
// of a whole thing of that class (or of a class under it), with its clue, and
// the same thing moves again once the class is returned.
//
// WHAT THIS SUITE DRIVES: the real hold door (`callHoldTool`) on the hold lane
// as prod runs it (flipped, guards on), against an in-memory record
// (`acts-pen-stub.mjs`) and a synthetic world clone. The class layer is a REAL
// law snapshot, published through `reloadLawSnapshot` — the office's one way of
// learning the law moved — from synthetic rows: the candy class is marked stolen
// and returned by publishing a new snapshot, never by poking a view. Nothing
// here reads a real record, a store or a ledger.
//
//   node --test test/wld7-stolen-class.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const repo = mkdtempSync(join(tmpdir(), "wld7-world-"));
const town = mkdtempSync(join(tmpdir(), "wld7-town-"));
after(() => { sweep(repo); sweep(town); });

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (path, text) => { const full = join(repo, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, text); };

// ── the world in a bottle: cy and dee share a house; eve is another ─────────
const HOME = { x: 1000, y: 1000 };
const thing = (slug, klass, over = {}) => ({ id: `cy/${slug}`, kind: "sited", by: "cy", tier: "home", household: "cy",
  at: HOME, extent: { w: 1, h: 1 }, body: `a synthetic ${klass ?? "unclassed thing"}`, ...(klass ? { class: klass } : {}), ...over });
const GHOST = "cy/test-ghost", WOBBLY = "cy/test-wobbly";
const COMET = "cy/test-comet-bar", LOLLY = "cy/test-lolly", TOASTER = "cy/test-toaster", TIN = "cy/test-tin", PLAIN = "cy/test-pebble";
const PUBLISHED = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 20000, h: 20000 }, body: "the world frame" },
  { id: "cy/the-plot", by: "cy", kind: "parcel", tier: "home", at: HOME, extent: { w: 25, h: 25 }, body: "cy's plot" },
  { id: "dee/the-plot", by: "dee", kind: "parcel", tier: "home", at: { x: 1002, y: 1000 }, extent: { w: 25, h: 25 }, body: "dee's plot" },
  { id: "eve/the-plot", by: "eve", kind: "parcel", tier: "home", at: { x: 1004, y: 1000 }, extent: { w: 25, h: 25 }, body: "eve's plot" },
  thing("test-comet-bar", "candy"),
  thing("test-lolly", "lollipop"),            // candy by inheritance: lollipop → candy → consumable → thing
  thing("test-toaster", "thing"),
  thing("test-tin", "chest", { portable: true, capacity: 10 }),
  thing("test-pebble", null),                 // unclassed
  thing("test-ghost", "ghost"),               // a class the law does not hold
  thing("test-wobbly", "wobbly"),             // a class whose ancestor the law does not hold
];
put("tools/world-build.mjs", `export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }\n`);
put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function homeOf(handle, world) {
  const parcel = (world?.parcels ?? []).find((p) => p.household === handle);
  if (!parcel) return { ...NOWHERE };
  return { x: parcel.at.x, y: parcel.at.y, placed: true, source: "parcel", mark_id: parcel.id, parcel };
}
export function whereIs(handle, { world = null } = {}) { return homeOf(handle, world); }
export function publicResidents() { return []; }
`);
put("tools/world-verbs.mjs", `
export function containmentChain(pos, marks) {
  return (marks ?? [])
    .filter((m) => m.at && m.extent && Math.abs(pos.x - m.at.x) <= m.extent.w / 2 && Math.abs(pos.y - m.at.y) <= m.extent.h / 2)
    .sort((a, b) => (b.extent.w * b.extent.h) - (a.extent.w * a.extent.h))
    .map((m) => ({ id: m.id, by: m.by, tier: m.tier, body: m.body }));
}
export function orient() { return { seen: [] }; }
export function investigate() { return null; }
`);
put("tools/marks-fold.mjs", `
export function loadMarks() { return []; }
export const PARCEL_EXTENT_M = 25;
export const PARCEL_CLAIM_CAP = 3;
export const PARCEL_CAP_LAW_DATE = "2026-07-30";
export function marksContain(outer, inner) {
  if (!outer?.at || !outer?.extent || !inner?.at) return false;
  return Math.abs(inner.at.x - outer.at.x) <= outer.extent.w / 2 && Math.abs(inner.at.y - outer.at.y) <= outer.extent.h / 2;
}
`);
put("tools/geometry.mjs", `
export const rect = (m) => ({ x0: m.at.x - m.extent.w / 2, x1: m.at.x + m.extent.w / 2, y0: m.at.y - m.extent.h / 2, y1: m.at.y + m.extent.h / 2 });
export function overlapArea(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}
`);
put("seeding/manifest.json", JSON.stringify({ homes: [] }));
put("WORLD/households.json", JSON.stringify({ households: { cy: "gh:1", dee: "gh:1", eve: "gh:2" } }));
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("WORLD/world-state.json", JSON.stringify({
  tick: 0, dials: {}, marks: PUBLISHED,
  parcels: PUBLISHED.filter((m) => m.kind === "parcel").map((m) => ({ id: m.id, household: m.by, at: m.at, extent: m.extent })),
  determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [],
}));
put("WORLD/filing-freeze.json", JSON.stringify({ frozen_at: "2026-08-25", marks: {} }));
git("init", "-q", "-b", "main");
git("-c", "user.email=test@postmark.town", "-c", "user.name=wld7 fixture", "add", "-A");
git("-c", "user.email=test@postmark.town", "-c", "user.name=wld7 fixture", "commit", "-qm", "synthetic canon");
git("branch", "-q", "draft/cyhouse");

const { rowsFromRegistry } = await import("../src/registry-rows.mjs");
const REGISTRY_ROWS = rowsFromRegistry({ households: {
  "cy-house": { residents: ["cy", "dee"], accounts: [{ login: "cy-gh", id: 1 }] },
  "eve-house": { residents: ["eve"], accounts: [{ login: "eve-gh", id: 2 }] },
} }, {});

const ENV = { WORLD_CLONE: repo, TOWN_CLONE: town, WORLD_SINGLE_LOG: "1", W2_GUARDS: "1", W2_PEN: "mark,hold", WORLD2_CANDLE: "1", TOWN_PUSH: "" };
const savedEnv = Object.fromEntries([...Object.keys(ENV), "WORLD2_PG", "WORLD2_PG_URL", "WORLD_FREEZE"].map((k) => [k, process.env[k]]));
Object.assign(process.env, ENV);
const { installActsPen, uninstallActsPen, readHoldsFrom, RECORD_ON } = await import("./acts-pen-stub.mjs");
process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
const claimsPen = await import("../src/world2-claims.mjs");
let unread = () => {};
let pen;
const fresh = async () => {
  uninstallActsPen();
  pen = installActsPen({ households: REGISTRY_ROWS.households });
  claimsPen.__setPoolForTest(pen);
  unread(); unread = await readHoldsFrom(pen);
  // Bevel's fixture adapter (first review; credited): the stub has no reader for
  // the unit rows (world2-guards § pgHoldingRows), which chest dispatch reads.
  // This answers exactly that statement — the class filter, at/id order — from
  // the same pen rows; every other query keeps the stub's own answer.
  const query = pen.query.bind(pen);
  pen.query = async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, " ").trim();
    if (/^SELECT id, at, crossing, actor, action, object, at_anchor, at_dx, at_dy, witnesses, class, payload, effect, household FROM acts WHERE class = \$1 ORDER BY acts\.at, acts\.id$/i.test(text)) {
      const rows = pen.rows().filter((r) => r.class === params[0])
        .sort((a, b) => Number(new Date(a.at)) - Number(new Date(b.at)) || Number(a.id) - Number(b.id));
      return { rows, rowCount: rows.length };
    }
    return query(sql, params);
  };
  return pen;
};

// ── the law, published the office's own way ────────────────────────────────
const { reloadLawSnapshot, resetLawSnapshot, lawSnapshot, PIN_SQL } = await import("../src/law-snapshot.mjs");
const LABELS = [{ label: "test-comets", name: "Test Comets", creator: "cy" }];
const LAW = () => ({
  "postmark-node": { dials: {} },
  mark: { extends: "postmark-node", dials: {} },
  thing: { extends: "mark", dials: {} },
  consumable: { extends: "thing", dials: {} },
  candy: { extends: "consumable", dials: {}, labels: LABELS },
  lollipop: { extends: "candy", dials: {} },
  chest: { extends: "thing", dials: { capacity: 30, capacity_min: 1, capacity_max: 120, portable: true, welcome: "open" } },
  wobbly: { extends: "nowhere", dials: {} },
});
let blessing = 0;
/** Publish `classes` as the newest blessing's law, through reloadLawSnapshot. */
async function publish(classes) {
  blessing += 1;
  const n = blessing;
  const query = async (sql) => (sql === PIN_SQL
    ? { rows: [{ newest: n, pinned: n }] }
    : { rows: Object.entries(classes).map(([key, data]) => ({ number: n, tag_sha: `${String(n).padStart(4, "0")}feedface`, newest: n, kind: "class", key, data: structuredClone(data) })) });
  const r = await reloadLawSnapshot({ query });
  assert.equal(r.changed, true, "the snapshot was published");
  assert.equal(lawSnapshot().pin.settlement, n);
}
// Darko's exact sentence (AUTHORITY 2026-10-13T14:53:34.636Z), as a fixture — the door reads the class's own clue
const CLUE = "No such thing as candy exists";
const stolen = (over = {}) => { const l = LAW(); l.candy.dials = { stolen: true, clue: CLUE }; Object.assign(l, over); return l; };

after(() => {
  unread(); uninstallActsPen(); claimsPen.__setPoolForTest(null); resetLawSnapshot();
  for (const [k, v] of Object.entries(savedEnv)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
});

const hold = await import("../src/world-hold.mjs");
const CY = { household: "cyhouse", handles: new Set(["cy"]) };
const DEE = { household: "cyhouse", handles: new Set(["dee"]) };
const EVE = { household: "evehouse", handles: new Set(["eve"]) };
const door = (args, key) => hold.callHoldTool("world_hold", args, key).then((r) => ({ r }), (e) => ({ e }));
const { guardedAttachments } = await import("../src/world2-guards.mjs");
/** Who holds `id`, as the door's own holder check reads it. */
const holderOf = async (id) => hold.liveHolder(await guardedAttachments(), id);
/** Everything a refusal must leave alone: the acts, the docket, who holds what. */
const census = async (ids) => JSON.stringify({ acts: pen.rows().map((a) => [a.id, a.action, a.object]), claims: pen.claims().length, holders: await Promise.all(ids.map(holderOf)) });

// THE RESIDENT'S WORDS (WLD-7 stolen correction): the headline is the class's
// own clue; the explanation is Wright's proposed sentence (AUTHORITY
// 2026-10-13T14:54:34.436Z) — Darko may change it at the sitting.
const EXPLAIN = (c) => `the ${c} has been stolen; nothing moves until it is returned. Nothing was recorded.`;
function refusedStolen(out, klass, clue = CLUE) {
  assert.equal(out.r, undefined, `admitted: ${JSON.stringify(out.r)}`);
  assert.equal(out.e.code, 423, `${out.e.code} ${out.e.defect}`);
  assert.equal(out.e.defect, clue, "the headline is the class's clue");
  assert.equal(out.e.hint, EXPLAIN(klass), "the explanation, exactly");
  assert.equal(out.e.stolen, klass, "the refusal names the stolen class in `stolen`");
  assert.ok(!("taken" in out.e), "no `taken` field rides any refusal");
}

// ── 1 · one candy, normal → stolen → returned, through the real door ────────

test("WHOLE CANDY, ONE OBJECT: take works; stolen refuses give, drop and take with the clue and moves nothing; returned, the same object gives and drops again", async () => {
  await fresh();
  await publish(LAW());
  const t = await door({ thing: COMET, handle: "cy" }, CY);
  assert.equal(t.r?.did, "take", JSON.stringify(t.e ?? t.r));

  await publish(stolen());
  const before = await census([COMET]);
  refusedStolen(await door({ thing: COMET, to: "dee", handle: "cy" }, CY), "candy");    // give
  refusedStolen(await door({ thing: COMET, handle: "cy" }, CY), "candy");               // drop (cy holds it)
  assert.equal(await census([COMET]), before, "no act, no claim, no holder moved — and no set-down amend was filed");
  assert.equal(await holderOf(COMET), "cy", "a refusal is not a disappearance: cy still holds it");
  // the class is still registered, its labels and identity intact — only the flag moved
  const snap = lawSnapshot();
  assert.deepEqual(snap.classes.get("candy").labels, LABELS);
  assert.equal(snap.classes.get("candy").extends, "consumable");
  // the read stays truthful while the class is stolen
  const reads = await hold.callHoldTool("world_holdings", { handle: "cy" }, CY);
  assert.deepEqual(reads.holding.map((h) => h.thing), [COMET]);

  await publish(LAW());
  const g = await door({ thing: COMET, to: "dee", handle: "cy" }, CY);
  assert.equal(g.r?.did, "give", JSON.stringify(g.e ?? g.r));
  const d = await door({ thing: COMET, handle: "dee" }, DEE);
  assert.equal(d.r?.did, "drop", JSON.stringify(d.e ?? d.r));
  assert.equal(await holderOf(COMET), null, "the same object, not a recreated one, stands on the ground");
  // and a take from the ground while stolen is refused too (the third face)
  await publish(stolen());
  const b2 = await census([COMET]);
  refusedStolen(await door({ thing: COMET, handle: "cy" }, CY), "candy");
  assert.equal(await census([COMET]), b2);
});

test("INHERITED, DEEPER, ITS OWN CLUE: a lollipop is candy; a stolen lollipop answers its own clue; a blank clue answers the fallback", async () => {
  await fresh();
  await publish(stolen());
  refusedStolen(await door({ thing: LOLLY, handle: "cy" }, CY), "candy");
  await publish({ ...LAW(), lollipop: { extends: "candy", dials: { stolen: true, clue: "Test clue: a stick, licked clean." } } });
  refusedStolen(await door({ thing: LOLLY, handle: "cy" }, CY), "lollipop", "Test clue: a stick, licked clean.");
  const comet = await door({ thing: COMET, handle: "cy" }, CY);
  assert.equal(comet.r?.did, "take", "a stolen subclass does not take its parent with it");
  await publish(stolen({ candy: { ...LAW().candy, dials: { stolen: true, clue: "   " } } }));
  refusedStolen(await door({ thing: LOLLY, handle: "cy" }, CY), "candy", "the candy has been stolen.");
});

test("NO ALIAS: `taken` is not read as stolen — taken:true alone moves; taken:true with stolen:false moves; taken:false with stolen:true refuses", async () => {
  await fresh();
  const withDials = (dials) => ({ ...LAW(), candy: { ...LAW().candy, dials } });
  for (const dials of [{ taken: true, clue: CLUE }, { taken: true, stolen: false, clue: CLUE }]) {
    await publish(withDials(dials));
    const t = await door({ thing: COMET, handle: "cy" }, CY);
    assert.equal(t.r?.did, "take", `${JSON.stringify(dials)} must not refuse: ${t.e?.code} ${t.e?.defect}`);
    const d = await door({ thing: COMET, handle: "cy" }, CY);
    assert.equal(d.r?.did, "drop", `${JSON.stringify(dials)}: ${d.e?.defect}`);
  }
  await publish(withDials({ taken: false, stolen: true, clue: CLUE }));
  refusedStolen(await door({ thing: COMET, handle: "cy" }, CY), "candy");
  // and an unknown class reads a stolen class, never a taken one, by name
  const draft = "cy/test-unpublished-draft-2";
  const u = await door({ thing: draft, handle: "cy" }, CY);
  assert.equal(u.e?.reason, "stolen-class-unknown");
  assert.match(u.e.defect, /can't tell whether .* is of a stolen class right now/);
  assert.match(u.e.hint, /^a class is stolen, and this one's class/);
  assert.ok(!/taken/.test(JSON.stringify(u.e)), "no old wording on the unknown-class refusal");
  await publish(withDials({ taken: true }));
  const quiet = await door({ thing: draft, handle: "cy" }, CY);
  assert.equal(quiet.r?.did, "take", "taken:true is not a heist: an unknown class is not refused for it");
});

test("THE WORDS: the headline is the class's clue (Darko's sentence in this fixture); a blank clue falls back exactly; the explanation is exact", async () => {
  await fresh();
  await publish(stolen());
  const r = await door({ thing: COMET, handle: "cy" }, CY);
  refusedStolen(r, "candy");
  assert.equal(r.e.defect, "No such thing as candy exists", "the fixture carries Darko's exact sentence, no punctuation added");
  await publish(stolen({ candy: { ...LAW().candy, dials: { stolen: true } } }));
  const fallback = await door({ thing: COMET, handle: "cy" }, CY);
  refusedStolen(fallback, "candy", "the candy has been stolen.");
  await publish(stolen({ candy: { ...LAW().candy, dials: { stolen: true, clue: "Another law's own clue." } } }));
  refusedStolen(await door({ thing: COMET, handle: "cy" }, CY), "candy", "Another law's own clue.");
});

test("ONLY `true` IS STOLEN: absent, false, and the string \"true\" leave candy moving", async () => {
  await fresh();
  for (const dials of [{}, { stolen: false, clue: "x" }, { stolen: "true", clue: "x" }, { stolen: 1 }]) {
    await publish({ ...LAW(), candy: { ...LAW().candy, dials } });
    const t = await door({ thing: COMET, handle: "cy" }, CY);
    assert.equal(t.r?.did, "take", `${JSON.stringify(dials)}: ${t.e?.defect}`);
    const d = await door({ thing: COMET, handle: "cy" }, CY);
    assert.equal(d.r?.did, "drop", `${JSON.stringify(dials)}: ${d.e?.defect}`);
  }
});

test("NOT CANDY: a toaster, an unclassed pebble and a chest move while candy is stolen — a chest of candy units is still a chest", async () => {
  await fresh();
  await publish(stolen());
  // the tin holds candy units: its own class is still chest
  pen.seedAct({ class: "holding", actor: "the-town", action: "units:stock", object: TIN, at: new Date(),
    payload: { units: true, moves: [{ from: null, to: TIN, label: "test-comets", n: 5 }] } });
  for (const id of [TOASTER, PLAIN, TIN]) {
    const t = await door({ thing: id, handle: "cy" }, CY);
    assert.equal(t.r?.did, "take", `${id}: ${t.e?.code} ${t.e?.defect}`);
    const g = await door({ thing: id, to: "dee", handle: "cy" }, CY);
    assert.equal(g.r?.did, "give", `${id}: ${g.e?.code} ${g.e?.defect}`);
  }
});

test("THE OTHER GATES FIRST: a wrong key, the freeze and a give of what you do not hold keep their own refusals while candy is stolen — no clue leaks past them", async () => {
  await fresh();
  await publish(stolen());
  const before = await census([COMET]);
  const wrongKey = await door({ thing: COMET, handle: "cy" }, EVE);
  assert.equal(wrongKey.e?.code, 403, JSON.stringify(wrongKey.e ?? wrongKey.r));
  assert.doesNotMatch(String(wrongKey.e.defect), /jars/);
  process.env.WORLD_FREEZE = "1";
  try {
    const frozen = await hold.callHoldTool("world_hold", { thing: COMET, handle: "cy" }, CY);
    assert.equal(frozen.code, 503);
    assert.match(frozen.defect, /frozen/);
  } finally { delete process.env.WORLD_FREEZE; }
  const unheld = await door({ thing: COMET, to: "dee", handle: "eve" }, EVE);
  assert.ok(unheld.e && unheld.e.code !== 423, `a give of what eve does not hold must refuse as before, not with the clue: ${JSON.stringify(unheld.e ?? unheld.r)}`);
  assert.doesNotMatch(String(unheld.e.defect), /jars/);
  assert.equal(await census([COMET]), before);
});

// ── 2 · the boundary: the law the TURN reads, not the law the call came in on

/** Hold the hold queue shut until the returned function is called. */
function shutTheQueue() {
  let open;
  const gate = new Promise((r) => { open = r; });
  const blocker = hold.holdTurn(() => gate);
  return async () => { open(); await blocker; };
}
const settle = () => new Promise((r) => setTimeout(r, 300)); // the call's door-side reads (reach, the mark) are in-memory

test("QUEUED, THEN STOLEN: a give admitted at the door while candy was unstolen, waiting in the queue when the stolen law is published, is refused in its turn — nothing recorded", async () => {
  await fresh();
  await publish(LAW());
  assert.equal((await door({ thing: COMET, handle: "cy" }, CY)).r?.did, "take");
  const before = await census([COMET]);
  const release = shutTheQueue();
  const pending = door({ thing: COMET, to: "dee", handle: "cy" }, CY);
  await settle();                  // the door has asked reach and read the mark; the act waits for its turn
  await publish(stolen());          // ← the publication lands while the give waits
  await release();
  refusedStolen(await pending, "candy");
  assert.equal(await census([COMET]), before, "nothing reached the record");
});

test("QUEUED, THEN RETURNED: a give that came in while candy was stolen, waiting when the class is returned, goes through in its turn", async () => {
  await fresh();
  await publish(LAW());
  assert.equal((await door({ thing: COMET, handle: "cy" }, CY)).r?.did, "take");
  await publish(stolen());
  const release = shutTheQueue();
  const pending = door({ thing: COMET, to: "dee", handle: "cy" }, CY);
  await settle();
  await publish(LAW());            // ← returned while the give waits
  await release();
  const out = await pending;
  assert.equal(out.r?.did, "give", JSON.stringify(out.e ?? out.r));
  assert.equal(await holderOf(COMET), "dee");
});

// ── 3 · what cannot be read is not proof of unstolen ─────────────────────────

function unknownClass(out) {
  assert.equal(out.r, undefined, `admitted: ${JSON.stringify(out.r)}`);
  assert.equal(out.e.code, 503, `${out.e.code} ${out.e.defect}`);
  assert.equal(out.e.reason, "stolen-class-unknown");
  assert.match(out.e.defect, /can't tell whether .* is of a stolen class right now/);
}

test("A THING CANON DOES NOT HOLD: moves on an ordinary day; refused by name, retryably, while a class is stolen", async () => {
  await fresh();
  await publish(LAW());
  const draft = "cy/test-unpublished-draft";
  const t = await door({ thing: draft, handle: "cy" }, CY);
  assert.equal(t.r?.did, "take", JSON.stringify(t.e ?? t.r));
  await publish(stolen());
  const before = await census([draft]);
  unknownClass(await door({ thing: draft, handle: "cy" }, CY));
  assert.equal(await census([draft]), before);
});

test("A CLASS THE LAW LACKS, AN ANCESTOR IT LACKS: both move on an ordinary day; both refused by name while candy is stolen", async () => {
  await fresh();
  await publish(LAW());
  for (const id of [GHOST, WOBBLY]) {
    const t = await door({ thing: id, handle: "cy" }, CY);
    assert.equal(t.r?.did, "take", `${id}: ${JSON.stringify(t.e ?? t.r)}`);
  }
  await publish(stolen());
  const before = await census([GHOST, WOBBLY]);
  for (const id of [GHOST, WOBBLY]) unknownClass(await door({ thing: id, to: "dee", handle: "cy" }, CY));
  assert.equal(await census([GHOST, WOBBLY]), before);
});

// Bevel's first review, R1 through the public dispatcher (credited): a thing
// held by a chest is routed to thing-from-chest, which must not read a missing
// canon class as `thing`.
test("R1 · THE PUBLIC DOOR, A CHEST'S UNCANONED THING: refused by name while candy is stolen, the chest keeps it; moves on an ordinary day", async () => {
  const seedInTin = (id) => {
    const entry = hold.holdingEntry({ did: "give", thing: id, holder: TIN, previous_holder: "cy", made_by: "cy", declared_by: "cy", policy: "cascade", at: new Date().toISOString() },
      { crossing: 1, at: {}, witnesses: [], cls: "holding", household: "cyhouse" });
    pen.seedAct({ ...entry, class: entry.cls, at: new Date() });
  };
  await fresh();
  await publish(stolen());
  const unknown = "cy/not-on-canon";
  seedInTin(unknown);
  assert.equal(await holderOf(unknown), TIN, "the fixture puts it in the tin");
  const before = await census([unknown]);
  unknownClass(await door({ thing: unknown, handle: "cy" }, CY));
  assert.equal(await census([unknown]), before);
  assert.equal(await holderOf(unknown), TIN);
  await publish(LAW());
  const ok = await door({ thing: unknown, handle: "cy" }, CY);
  assert.equal(ok.r?.did, "take", JSON.stringify(ok.e ?? ok.r));
  assert.equal(await holderOf(unknown), "cy");
});

// Bevel's first review, R2 through the public dispatcher (credited).
test("R2 · THE PUBLIC DOOR, A MIXED CHEST: the selected candy refuses with the clue while stolen, an unregistered label refuses by name; both move on an ordinary day", async () => {
  await fresh();
  for (const label of ["retired-label", "test-comets"])
    pen.seedAct({ class: "holding", actor: "the-town", action: "units:stock", object: TIN, at: new Date(),
      payload: { units: true, moves: [{ from: null, to: TIN, label, n: 2 }] } });
  await publish(stolen());
  const before = await census([TIN]);
  refusedStolen(await door({ from: TIN, label: "test-comets", count: 1, handle: "cy" }, CY), "candy");
  unknownClass(await door({ from: TIN, label: "retired-label", count: 1, handle: "cy" }, CY));
  assert.equal(await census([TIN]), before);
  await publish(LAW());
  for (const label of ["test-comets", "retired-label"]) {
    const t = await door({ from: TIN, label, count: 1, handle: "cy" }, CY);
    assert.equal(t.r?.count, 1, `${label}: ${JSON.stringify(t.e ?? t.r)}`);
  }
});

// ── Wright 10:36:28.315Z, through the public door (Bevel's second-review probes,
// credited, with the ordinary-day return added) ──────────────────────────────

test("ORDER · THE PUBLIC DOOR, consume of an unregistered held label: 422 ordinary, the named 503 while stolen, 422 once returned — nothing written", async () => {
  await fresh();
  await publish(LAW());
  pen.seedAct({ class: "holding", actor: "the-town", action: "units:stock", object: "cy", at: new Date(),
    payload: { units: true, moves: [{ from: null, to: "cy", label: "retired-label", n: 1 }] } });
  const args = { act: "consume", label: "retired-label", handle: "cy" };
  assert.equal((await door(args, CY)).e?.code, 422, "ordinary validation remains");
  const before = await census([]);
  await publish(stolen());
  unknownClass(await door(args, CY));
  assert.equal(await census([]), before, "no effect on refusal");
  await publish(LAW());
  assert.equal((await door(args, CY)).e?.code, 422);
  assert.equal(await census([]), before);
});

test("ORDER · THE PUBLIC DOOR, a held thing canon does not show into a chest: 409 ordinary, the named 503 while stolen, 409 once returned — the same object stays in hand", async () => {
  await fresh();
  await publish(LAW());
  const id = "cy/missing-canon-held-thing";
  assert.equal((await door({ thing: id, handle: "cy" }, CY)).r?.did, "take");
  const args = { thing: id, to: TIN, handle: "cy" };
  const ordinary = await door(args, CY);
  assert.equal(ordinary.e?.code, 409, "ordinary unpublished-thing validation remains");
  assert.match(ordinary.e.defect, /does not stand on the world/);
  const before = await census([id]);
  await publish(stolen());
  unknownClass(await door(args, CY));
  assert.equal(await census([id]), before, "the original holder and record remain");
  await publish(LAW());
  assert.match((await door(args, CY)).e?.defect ?? "", /does not stand on the world/);
  assert.equal(await holderOf(id), "cy");
});

// ── THE COLD-START WINDOW (Wright 10:36:28.315Z: accepted, disclosed) ────────

test("COLD START · before this process's first law snapshot nothing can be known stolen: the whole-object guard is inert and candy moves; the unit door keeps its own pre-WLD-7 'class layer could not be read' 503", async () => {
  await fresh();
  resetLawSnapshot();
  assert.equal(lawSnapshot(), null, "no snapshot has been published in this process");
  const t = await door({ thing: COMET, handle: "cy" }, CY);
  assert.equal(t.r?.did, "take", `the bootstrap window admits: ${JSON.stringify(t.e ?? t.r)}`);
  const d = await door({ thing: COMET, handle: "cy" }, CY);
  assert.equal(d.r?.did, "drop", JSON.stringify(d.e ?? d.r));
  pen.seedAct({ class: "holding", actor: "the-town", action: "units:stock", object: "cy", at: new Date(),
    payload: { units: true, moves: [{ from: null, to: "cy", label: "test-comets", n: 1 }] } });
  const u = await door({ act: "consume", handle: "cy" }, CY);
  assert.equal(u.e?.code, 503);
  assert.match(u.e.defect, /class layer could not be read/);
  assert.equal(u.e.reason, undefined, "not the stolen-class refusal: nothing is known stolen");
});
