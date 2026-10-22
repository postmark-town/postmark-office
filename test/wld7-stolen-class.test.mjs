// wld7-stolen-class.test.mjs — WLD-7: a class TAKEN by the town's own act (dials.stolen) refuses give, take and drop
// of a whole thing of that class (or of a class under it), with its clue, and
// the same thing moves again once the class is returned.
//
// WHAT THIS SUITE DRIVES: the real hold door (`callHoldTool`) on the hold lane
// as prod runs it (flipped, guards on), against an in-memory record
// (`acts-pen-stub.mjs`) and a synthetic world clone. The class layer is a REAL
// law snapshot, published through `reloadLawSnapshot` — the office's one way of
// learning the law moved — from synthetic rows: the trinket class is marked stolen
// and returned by publishing a new snapshot, never by poking a view. Nothing
// here reads a real record, a store or a ledger.
//
// Ported from Jetto's refit (58b633b8) to the w44 train, with a
// stub class and a synthetic clue. Its unit and chest cases (the label lane, closed on w44)
// are replaced by wld7-taken-kinds.test.mjs, which drives every kind door.
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
const BEAD = "cy/test-bead", BAUBLE = "cy/test-bauble", TOASTER = "cy/test-toaster", TIN = "cy/test-tin", PLAIN = "cy/test-pebble";
const PUBLISHED = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 20000, h: 20000 }, body: "the world frame" },
  { id: "cy/the-plot", by: "cy", kind: "parcel", tier: "home", at: HOME, extent: { w: 25, h: 25 }, body: "cy's plot" },
  { id: "dee/the-plot", by: "dee", kind: "parcel", tier: "home", at: { x: 1002, y: 1000 }, extent: { w: 25, h: 25 }, body: "dee's plot" },
  { id: "eve/the-plot", by: "eve", kind: "parcel", tier: "home", at: { x: 1004, y: 1000 }, extent: { w: 25, h: 25 }, body: "eve's plot" },
  thing("test-bead", "trinket"),
  thing("test-bauble", "bauble"),            // trinket by inheritance: bauble → trinket → consumable → thing
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
const DROP_SWEEP = /^SELECT nonce FROM acts WHERE COALESCE\(household, ''\) = \$1 AND actor = \$2 AND action = 'units:drop-sweep'/i;
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
    if (DROP_SWEEP.test(text)) return { rows: [], rowCount: 0 };
    return query(sql, params);
  };
  // …and #503's drop-sweep cursor (WLD-27, now on the train), asked through a
  // pooled client (officeRead) when a chest dispatch reads the set-down units
  // still out: this rig has none. That one statement only; the rest is the stub's.
  if (typeof pen.connect === "function") {
    const connect = pen.connect.bind(pen);
    pen.connect = async (...a) => {
      const c = await connect(...a);
      const q = c.query.bind(c);
      c.query = async (sql, params = []) => (DROP_SWEEP.test(String(sql).replace(/\s+/g, " ").trim()) ? { rows: [], rowCount: 0 } : q(sql, params));
      return c;
    };
  }
  return pen;
};

// ── the law, published the office's own way ────────────────────────────────
const { reloadLawSnapshot, resetLawSnapshot, lawSnapshot, PIN_SQL } = await import("../src/law-snapshot.mjs");
const LABELS = [{ label: "test-beads", name: "Test Beads", creator: "cy" }];
const LAW = () => ({
  "postmark-node": { dials: {} },
  mark: { extends: "postmark-node", dials: {} },
  thing: { extends: "mark", dials: {} },
  consumable: { extends: "thing", dials: {} },
  trinket: { extends: "consumable", dials: {}, labels: LABELS },
  bauble: { extends: "trinket", dials: {} },
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
// a synthetic clue — the door reads the class's own
const CLUE = "Not a single trinket is left in town.";
const stolen = (over = {}) => { const l = LAW(); l.trinket.dials = { stolen: true, clue: CLUE }; Object.assign(l, over); return l; };

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

// THE RESIDENT'S WORDS: the headline is the class's own clue; the explanation is exact.
const EXPLAIN = (c) => `the ${c} has been stolen; nothing moves until it is returned. Nothing was recorded.`;
function refusedStolen(out, klass, clue = CLUE) {
  assert.equal(out.r, undefined, `admitted: ${JSON.stringify(out.r)}`);
  assert.equal(out.e.code, 423, `${out.e.code} ${out.e.defect}`);
  assert.equal(out.e.defect, clue, "the headline is the class's clue");
  assert.equal(out.e.hint, EXPLAIN(klass), "the explanation, exactly");
  assert.equal(out.e.stolen, klass, "the refusal names the stolen class in `stolen`");
  assert.ok(!("taken" in out.e), "no `taken` field rides any refusal");
}

// ── 1 · one trinket, normal → stolen → returned, through the real door ────────

test("WHOLE TRINKET, ONE OBJECT: take works; stolen refuses give, drop and take with the clue and moves nothing; returned, the same object gives and drops again", async () => {
  await fresh();
  await publish(LAW());
  const t = await door({ thing: BEAD, handle: "cy" }, CY);
  assert.equal(t.r?.did, "take", JSON.stringify(t.e ?? t.r));

  await publish(stolen());
  const before = await census([BEAD]);
  refusedStolen(await door({ thing: BEAD, to: "dee", handle: "cy" }, CY), "trinket");    // give
  refusedStolen(await door({ thing: BEAD, handle: "cy" }, CY), "trinket");               // drop (cy holds it)
  assert.equal(await census([BEAD]), before, "no act, no claim, no holder moved — and no set-down amend was filed");
  assert.equal(await holderOf(BEAD), "cy", "a refusal is not a disappearance: cy still holds it");
  // the class is still registered, its labels and identity intact — only the flag moved
  const snap = lawSnapshot();
  assert.deepEqual(snap.classes.get("trinket").labels, LABELS);
  assert.equal(snap.classes.get("trinket").extends, "consumable");
  // the read stays truthful while the class is stolen
  const reads = await hold.callHoldTool("world_holdings", { handle: "cy" }, CY);
  assert.deepEqual(reads.holding.map((h) => h.thing), [BEAD]);

  await publish(LAW());
  const g = await door({ thing: BEAD, to: "dee", handle: "cy" }, CY);
  assert.equal(g.r?.did, "give", JSON.stringify(g.e ?? g.r));
  const d = await door({ thing: BEAD, handle: "dee" }, DEE);
  assert.equal(d.r?.did, "drop", JSON.stringify(d.e ?? d.r));
  assert.equal(await holderOf(BEAD), null, "the same object, not a recreated one, stands on the ground");
  // and a take from the ground while stolen is refused too (the third face)
  await publish(stolen());
  const b2 = await census([BEAD]);
  refusedStolen(await door({ thing: BEAD, handle: "cy" }, CY), "trinket");
  assert.equal(await census([BEAD]), b2);
});

test("INHERITED, DEEPER, ITS OWN CLUE: a bauble is trinket; a stolen bauble answers its own clue; a blank clue answers the fallback", async () => {
  await fresh();
  await publish(stolen());
  refusedStolen(await door({ thing: BAUBLE, handle: "cy" }, CY), "trinket");
  await publish({ ...LAW(), bauble: { extends: "trinket", dials: { stolen: true, clue: "Test clue: a stick, licked clean." } } });
  refusedStolen(await door({ thing: BAUBLE, handle: "cy" }, CY), "bauble", "Test clue: a stick, licked clean.");
  const comet = await door({ thing: BEAD, handle: "cy" }, CY);
  assert.equal(comet.r?.did, "take", "a stolen subclass does not take its parent with it");
  await publish(stolen({ trinket: { ...LAW().trinket, dials: { stolen: true, clue: "   " } } }));
  refusedStolen(await door({ thing: BAUBLE, handle: "cy" }, CY), "trinket", "the trinket has been stolen.");
});

test("NO ALIAS: `taken` is not read as stolen — taken:true alone moves; taken:true with stolen:false moves; taken:false with stolen:true refuses", async () => {
  await fresh();
  const withDials = (dials) => ({ ...LAW(), trinket: { ...LAW().trinket, dials } });
  for (const dials of [{ taken: true, clue: CLUE }, { taken: true, stolen: false, clue: CLUE }]) {
    await publish(withDials(dials));
    const t = await door({ thing: BEAD, handle: "cy" }, CY);
    assert.equal(t.r?.did, "take", `${JSON.stringify(dials)} must not refuse: ${t.e?.code} ${t.e?.defect}`);
    const d = await door({ thing: BEAD, handle: "cy" }, CY);
    assert.equal(d.r?.did, "drop", `${JSON.stringify(dials)}: ${d.e?.defect}`);
  }
  await publish(withDials({ taken: false, stolen: true, clue: CLUE }));
  refusedStolen(await door({ thing: BEAD, handle: "cy" }, CY), "trinket");
});

test("THE WORDS: the headline is the class's clue (a synthetic sentence in this fixture); a blank clue falls back exactly; the explanation is exact", async () => {
  await fresh();
  await publish(stolen());
  const r = await door({ thing: BEAD, handle: "cy" }, CY);
  refusedStolen(r, "trinket");
  assert.equal(r.e.defect, "Not a single trinket is left in town.", "the fixture carries Darko's exact sentence, no punctuation added");
  await publish(stolen({ trinket: { ...LAW().trinket, dials: { stolen: true } } }));
  const fallback = await door({ thing: BEAD, handle: "cy" }, CY);
  refusedStolen(fallback, "trinket", "the trinket has been stolen.");
  await publish(stolen({ trinket: { ...LAW().trinket, dials: { stolen: true, clue: "Another law's own clue." } } }));
  refusedStolen(await door({ thing: BEAD, handle: "cy" }, CY), "trinket", "Another law's own clue.");
});

test("ONLY `true` IS STOLEN: absent, false, and the string \"true\" leave trinket moving", async () => {
  await fresh();
  for (const dials of [{}, { stolen: false, clue: "x" }, { stolen: "true", clue: "x" }, { stolen: 1 }]) {
    await publish({ ...LAW(), trinket: { ...LAW().trinket, dials } });
    const t = await door({ thing: BEAD, handle: "cy" }, CY);
    assert.equal(t.r?.did, "take", `${JSON.stringify(dials)}: ${t.e?.defect}`);
    const d = await door({ thing: BEAD, handle: "cy" }, CY);
    assert.equal(d.r?.did, "drop", `${JSON.stringify(dials)}: ${d.e?.defect}`);
  }
});

test("NOT TRINKET: a toaster, an unclassed pebble and a chest move while trinket is stolen — a chest of trinket units is still a chest", async () => {
  await fresh();
  await publish(stolen());
  // the tin holds trinket units: its own class is still chest
  pen.seedAct({ class: "holding", actor: "the-town", action: "units:stock", object: TIN, at: new Date(),
    payload: { units: true, moves: [{ from: null, to: TIN, label: "test-beads", n: 5 }] } });
  for (const id of [TOASTER, PLAIN, TIN]) {
    const t = await door({ thing: id, handle: "cy" }, CY);
    assert.equal(t.r?.did, "take", `${id}: ${t.e?.code} ${t.e?.defect}`);
    const g = await door({ thing: id, to: "dee", handle: "cy" }, CY);
    assert.equal(g.r?.did, "give", `${id}: ${g.e?.code} ${g.e?.defect}`);
  }
});

test("THE OTHER GATES FIRST: a wrong key, the freeze and a give of what you do not hold keep their own refusals while trinket is stolen — no clue leaks past them", async () => {
  await fresh();
  await publish(stolen());
  const before = await census([BEAD]);
  const wrongKey = await door({ thing: BEAD, handle: "cy" }, EVE);
  assert.equal(wrongKey.e?.code, 403, JSON.stringify(wrongKey.e ?? wrongKey.r));
  assert.doesNotMatch(String(wrongKey.e.defect), /jars/);
  process.env.WORLD_FREEZE = "1";
  try {
    const frozen = await hold.callHoldTool("world_hold", { thing: BEAD, handle: "cy" }, CY);
    assert.equal(frozen.code, 503);
    assert.match(frozen.defect, /frozen/);
  } finally { delete process.env.WORLD_FREEZE; }
  const unheld = await door({ thing: BEAD, to: "dee", handle: "eve" }, EVE);
  assert.ok(unheld.e && unheld.e.code !== 423, `a give of what eve does not hold must refuse as before, not with the clue: ${JSON.stringify(unheld.e ?? unheld.r)}`);
  assert.doesNotMatch(String(unheld.e.defect), /jars/);
  assert.equal(await census([BEAD]), before);
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

test("QUEUED, THEN STOLEN: a give admitted at the door while trinket was unstolen, waiting in the queue when the stolen law is published, is refused in its turn — nothing recorded", async () => {
  await fresh();
  await publish(LAW());
  assert.equal((await door({ thing: BEAD, handle: "cy" }, CY)).r?.did, "take");
  const before = await census([BEAD]);
  const release = shutTheQueue();
  const pending = door({ thing: BEAD, to: "dee", handle: "cy" }, CY);
  await settle();                  // the door has asked reach and read the mark; the act waits for its turn
  await publish(stolen());          // ← the publication lands while the give waits
  await release();
  refusedStolen(await pending, "trinket");
  assert.equal(await census([BEAD]), before, "nothing reached the record");
});

test("QUEUED, THEN RETURNED: a give that came in while trinket was stolen, waiting when the class is returned, goes through in its turn", async () => {
  await fresh();
  await publish(LAW());
  assert.equal((await door({ thing: BEAD, handle: "cy" }, CY)).r?.did, "take");
  await publish(stolen());
  const release = shutTheQueue();
  const pending = door({ thing: BEAD, to: "dee", handle: "cy" }, CY);
  await settle();
  await publish(LAW());            // ← returned while the give waits
  await release();
  const out = await pending;
  assert.equal(out.r?.did, "give", JSON.stringify(out.e ?? out.r));
  assert.equal(await holderOf(BEAD), "dee");
});

// ── 3 · ONLY TRINKET IS REFUSED (Darko, 2026-10-13 17:57, on WLD-1: "collateral
// breakage is a platform bug"): what cannot be told to be trinket gets exactly its
// ordinary day's answer while the trinket is stolen. (These were refused by name,
// 503 "stolen-class-unknown", until that ruling.)

test("A THING CANON DOES NOT HOLD: its ordinary day's answer, the same while trinket is stolen (a class that cannot be told is never refused as stolen)", async () => {
  await fresh();
  await publish(LAW());
  const draft = "cy/test-unpublished-draft";
  const ordinary = await door({ thing: draft, handle: "cy" }, CY);
  await publish(stolen());
  const taken = await door({ thing: draft, handle: "cy" }, CY);
  assert.deepEqual([taken.e?.code, taken.e?.defect, taken.r?.did], [ordinary.e?.code, ordinary.e?.defect, ordinary.r?.did], JSON.stringify(taken.e ?? taken.r));
  assert.notEqual(taken.e?.code, 423);
});

test("A CLASS THE LAW LACKS, AN ANCESTOR IT LACKS: both move on an ordinary day and while trinket is stolen", async () => {
  await fresh();
  await publish(LAW());
  for (const id of [GHOST, WOBBLY]) {
    const t = await door({ thing: id, handle: "cy" }, CY);
    assert.equal(t.r?.did, "take", `${id}: ${JSON.stringify(t.e ?? t.r)}`);
  }
  await publish(stolen());
  for (const id of [GHOST, WOBBLY]) {
    const g = await door({ thing: id, to: "dee", handle: "cy" }, CY);
    assert.equal(g.r?.did, "give", `${id}: ${JSON.stringify(g.e ?? g.r)}`);
    assert.equal(await holderOf(id), "dee");
  }
});

// Bevel's first review, R1 through the public dispatcher (credited): a thing
// held by a chest is routed to thing-from-chest.
test("COLD START · before this process's first law snapshot nothing can be known stolen: the whole-object guard is inert and trinket moves; the unit door keeps its own pre-WLD-7 'class layer could not be read' 503", async () => {
  await fresh();
  resetLawSnapshot();
  assert.equal(lawSnapshot(), null, "no snapshot has been published in this process");
  const t = await door({ thing: BEAD, handle: "cy" }, CY);
  assert.equal(t.r?.did, "take", `the bootstrap window admits: ${JSON.stringify(t.e ?? t.r)}`);
  const d = await door({ thing: BEAD, handle: "cy" }, CY);
  assert.equal(d.r?.did, "drop", JSON.stringify(d.e ?? d.r));
  pen.seedAct({ class: "holding", actor: "the-town", action: "units:stock", object: "cy", at: new Date(),
    payload: { units: true, moves: [{ from: null, to: "cy", label: "test-beads", n: 1 }] } });
  const u = await door({ act: "consume", handle: "cy" }, CY);
  assert.equal(u.e?.code, 503);
  assert.match(u.e.defect, /class layer could not be read/);
  assert.equal(u.e.reason, undefined, "not the stolen-class refusal: nothing is known stolen");
});
