// outsider-lens-says-why.test.mjs — POS-823 (Darko, 2026-10-30 16:29 EDT, approving Wright's recommendation):
// "when the World's outsider view changes nothing for a household, say why."
//
// THE REPORT. Errant's bug post: the outsider view changed nothing for them. Their place, errant/the-misfiled-annex, is
// an open `sited` place, so there was nothing for the lens to hide, and the answer never said so. This is the office
// half: `world { lens: "outsider" }` now carries `lens_note` when the lens left what the household sees as it was. The
// World page (the other PR, postmark-world) shows the line as the office sent it and keeps no rule of its own.
//
// LAW §The portal and the dungeon (postmark-world LOGOS/classes.md): "A dungeon is opaque from outside. A resident who
// has not entered it reads it as the dungeon mark alone, with nothing it contains at any depth." Only a closed place
// hides what is inside it, so the lens changes something for a household only when a mark of its own stands in one
// (the office's explain: "lens": "your own marks inside a closed place you have not entered are hidden").
//
// THE PREMISE THIS TEST CORRECTS. The issue reads "a place without an entry is open" as if an entry made a place
// closed. It does not: `entry` is a property of every mark (how it is entered), and only the `dungeon` class hides
// anything. The fay case below gives an open place an entry and shows it is still open to everyone.
//
// What it reads: the REAL engine (copied from the pinned world clone, as wld-9 does) over a synthetic ground, through
// the REAL door (`worldApex`), so the wiring is under test and not only the decision. Not a mock of sight.
// Run: WORLD_CLONE=<the office's world-clone> node --import ./test/helpers/sparse-guard.mjs --test test/outsider-lens-says-why.test.mjs
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const REAL = worldClone();   // the pinned clone, read before WORLD_CLONE is pointed at the fixture below
const HAVE = !!REAL && existsSync(join(REAL, "tools", "portals.mjs"));
const SKIP = !HAVE && (REAL ? `the world clone at ${REAL} predates WLD-5 (no tools/portals.mjs)` : NO_WORLD);

// the exact line a resident or an agent reads (typed here on purpose: a test that imported it would pass any wording)
const LINE = "Nothing here changes: nothing of yours is in a closed place, and a place that isn't closed is open to everyone.";

const SCRATCH = mkdtempSync(join(tmpdir(), "pos823-"));
const repo = join(SCRATCH, "world");
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };

const parcel = (by, x, y) => ({ id: `${by}/parcel`, by, household: by, kind: "parcel", tier: "market", at: { x, y }, extent: { w: 25, h: 25 }, date: "2026-08-01T00:00:00Z", body: `${by}'s ground` });
const sited = (id, by, x, y, w, h, extra = {}) => ({ id, by, kind: "sited", tier: "market", at: { x, y }, extent: { w, h }, date: "2026-08-02T00:00:00Z", body: `${id}.`, ...extra });

const TOWER = "mason/the-tower";
const VAULT = "dan/the-vault";
const MARKS = [
  // ann: an open place with no entry at all (Errant's the-misfiled-annex)
  parcel("ann", 0, 0), sited("ann/the-annex", "ann", 30, 0, 20, 20),
  // fay: an open place that carries an entry, and is no less open for it
  parcel("fay", 0, 400),
  sited("fay/the-gazebo", "fay", 30, 400, 20, 20, { entry: { word: "opposed", consequence: "The gazebo is not for going into." } }),
  // mason: made a closed place (a dungeon); a hall and a lamp stand inside it
  parcel("mason", 1000, 0), sited("mason/the-yard", "mason", 1100, 0, 100, 100),
  sited(TOWER, "mason", 1200, 0, 60, 60, { class: "dungeon" }),
  sited("mason/the-hall", "mason", 1200, 0, 40, 40),
  sited("mason/the-lamp", "mason", 1205, 5, 2, 2),
  // bea: an ordinary household whose note stands inside mason's closed place (her ground is close by, so the note is in her view)
  parcel("bea", 1180, 80), sited("bea/the-note", "bea", 1210, 10, 2, 2),
  // gus and hal: ONE household (a key that holds both); hal's note stands inside mason's closed place, gus's ground is open
  parcel("gus", 1250, 80), sited("hal/the-note", "hal", 1215, 12, 2, 2),
  // dan: owns a closed place with nothing of his own inside it; eve's chest stands in it
  parcel("dan", 0, 1200), sited(VAULT, "dan", 100, 1200, 50, 50, { class: "dungeon" }),
  parcel("eve", 400, 1200), sited("eve/the-chest", "eve", 105, 1205, 2, 2),
];

before(() => {
  if (SKIP) return;
  cpSync(join(REAL, "tools"), join(repo, "tools"), { recursive: true });   // the real engine, as wld-9 does
  put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: MARKS, parcels: MARKS.filter((m) => m.kind === "parcel"), households: {}, determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [] }));
  put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {}, elevation: { fog_ceiling_m: 22 }, light: { dawn_pole_m: { x: 5000, y: -5000 }, dark_pole_m: { x: -5000, y: 5000 } }, far_features: [] }));
  put("WORLD/walk-ledger.md", "# Walk ledger\n");
  put("seeding/manifest.json", JSON.stringify({ homes: [] }));
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main"); git("add", "-A");
  git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "fixture pos823");
});
after(() => { try { rmSync(SCRATCH, { recursive: true, force: true }); } catch { /* litter */ } });

process.env.WORLD_CLONE = repo;
process.env.WORLD_STORE_DB = join(SCRATCH, "none.db");
process.env.WORLD_DYNAMIC_DB = join(SCRATCH, "dynamic.db");
delete process.env.WORLD_EMISSIONS;
delete process.env.WORLD_PRESENCE;

let apex, world, verbs, portals;
before(async () => {
  if (SKIP) return;
  process.env.WORLD_APEX = "1";
  apex = await import("../src/world-apex.mjs");
  world = await import("../src/world.mjs");
  verbs = await import(pathToFileURL(join(REAL, "tools", "world-verbs.mjs")).href);
  portals = await import(pathToFileURL(join(REAL, "tools", "portals.mjs")).href);
});

const key = (...handles) => ({ household: "h", handles: new Set(handles) });
const ids = (r) => (r.nearby ?? []).map((o) => o.id);
const lensRead = async (handle, k = key(handle), extra = {}) => {
  const r = await apex.worldApex({ handle, lens: "outsider", ...extra }, k);
  assert.ok(!r.error, JSON.stringify(r).slice(0, 300));
  assert.equal(r.lens, "outsider", "it is an outsider read");
  return r;
};
const ownRead = async (handle, k = key(handle)) => {
  const r = await apex.worldApex({ handle }, k);
  assert.ok(!r.error, JSON.stringify(r).slice(0, 300));
  return r;
};

test("PRIMARY · an open place with no entry: the outsider read says why it changed nothing (Errant's the-misfiled-annex)", { skip: SKIP }, async () => {
  const own = await ownRead("ann");
  const r = await lensRead("ann");
  assert.deepEqual(ids(r), ids(own), "control: the lens really did change nothing for ann (she sees the same marks)");
  assert.ok(ids(r).includes("ann/the-annex"), "control: the annex is in her view, and in a stranger's");
  // ⚑ THE FLIP: drop the withLensNote call after the lens stamp in worldApexAnswer → lens_note is gone and this reds
  assert.equal(r.lens_note, LINE, "LAW §the dungeon: only a closed place hides what is inside it — ann owns none, so there was nothing to hide, and the read says so");
  assert.equal(typeof r.lens_note, "string");
});

test("an entry does not close a place: an open place that carries an entry is still open to everyone, and the read still says so", { skip: SKIP }, async () => {
  const gazebo = MARKS.find((m) => m.id === "fay/the-gazebo");
  assert.equal(gazebo.entry.word, "opposed", "fixture: the gazebo has an entry");
  const stranger = world.sightedWorld({ marks: MARKS }, { verbs, handle: "zed", stack: [], key: key("zed") });
  assert.ok(stranger.marks.some((m) => m.id === "fay/the-gazebo"), "control: a stranger who entered nothing sees the gazebo, entry and all");
  const r = await lensRead("fay");
  assert.equal(r.lens_note, LINE);
});

test("the lens hides something of the household's: no line (a closed place she has not entered, with her mark in it)", { skip: SKIP }, async () => {
  // mason made the closed place and has his hall and lamp in it
  const own = await ownRead("mason");
  const r = await lensRead("mason");
  assert.ok(ids(own).includes("mason/the-hall") && ids(own).includes("mason/the-lamp"), "control: his own sight holds the hall and the lamp");
  assert.ok(!ids(r).includes("mason/the-hall") && !ids(r).includes("mason/the-lamp"), "control: the lens hides them, as it hides them from a stranger");
  assert.ok(ids(r).includes(TOWER), "control: the closed place itself stands, as it does for anyone");
  // No single flip reds this one: the sight comparison and the closed-place check each withhold the line for mason
  // (he owns the closed place), so removing either alone leaves it green. Each has its own falsifier: the comparison's
  // is the injected sight below, the check's is dan. Removing BOTH tells mason "nothing changes" over two vanished marks.
  assert.equal(r.lens_note, undefined, "the line must not appear where the view does hide something");
  // and bea, an ordinary household with one note inside someone else's closed place
  const beaOwn = await ownRead("bea");
  const bea = await lensRead("bea");
  assert.ok(ids(beaOwn).includes("bea/the-note"), "control: her own sight holds her note");
  assert.ok(!ids(bea).includes("bea/the-note"), "control: the lens hides it");
  assert.equal(bea.lens_note, undefined);
});

test("one household, two residents: a mark of the OTHER resident inside a closed place counts (the household is the unit, not the handle standing)", { skip: SKIP }, async () => {
  const k = key("gus", "hal");
  const own = await ownRead("gus", k);
  const r = await lensRead("gus", k);
  assert.ok(ids(own).includes("hal/the-note"), "control: the household's sight holds hal's note");
  assert.ok(!ids(r).includes("hal/the-note"), "control: the lens hides it");
  assert.equal(r.lens_note, undefined);
});

test("the owner of a closed place gets no line even where the lens moved nothing: the reason would be false for him", { skip: SKIP }, async () => {
  const own = await ownRead("dan");
  const r = await lensRead("dan");
  assert.deepEqual(ids(r), ids(own), "control: the lens changed nothing for dan (his vault stands either way; eve's chest is hidden either way)");
  assert.ok(ids(r).includes(VAULT) && !ids(r).includes("eve/the-chest"), "control: the vault is a closed place and keeps eve's chest from sight");
  // ⚑ THE FLIP: drop the closed-place check in lensNoteFor → dan is told "nothing of yours is in a closed place" about his own vault; this reds
  assert.equal(r.lens_note, undefined, "nothing of yours is in a closed place would be false of a household that owns one");
  const eve = await lensRead("eve");
  assert.equal(eve.lens_note, undefined, "and eve's chest stands in one");
});

test("no lens, no change: a read without the lens carries neither the stamp nor the line", { skip: SKIP }, async () => {
  const r = await ownRead("ann");
  assert.equal(Object.hasOwn(r, "lens"), false);
  assert.equal(Object.hasOwn(r, "lens_note"), false);
  const other = await apex.worldApex({ handle: "ann", lens: "" }, key("ann"));
  assert.equal(Object.hasOwn(other, "lens_note"), false, "an empty lens is no lens");
});

test("a keyless look through the lens has no household to speak to: it is stamped, and says nothing more", { skip: SKIP }, async () => {
  const r = await apex.worldApex({ lens: "outsider", x: 0, y: 0 }, null);
  assert.ok(!r.error, JSON.stringify(r).slice(0, 200));
  assert.equal(r.lens, "outsider");
  assert.equal(Object.hasOwn(r, "lens_note"), false);
});

test("the v2 blocks read whole carry the line too: read: \"view\" under the lens", { skip: SKIP }, async () => {
  const ann = await apex.worldApex({ read: "view", lens: "outsider", handle: "ann" }, key("ann"));
  assert.ok(!ann.error, JSON.stringify(ann).slice(0, 300));
  assert.equal(ann.lens, "outsider");
  // ⚑ THE FLIP: drop the withLensNote call on the block-read branch → a block read never says why; this reds
  assert.equal(ann.lens_note, LINE);
  const mason = await apex.worldApex({ read: "view", lens: "outsider", handle: "mason" }, key("mason"));
  assert.equal(mason.lens, "outsider");
  assert.equal(mason.lens_note, undefined);
});

test("the comparison is the claim: if the lens hid anything of the household's by any other means, the line is withheld even where no closed place is in play", { skip: SKIP }, async () => {
  // a sight that, under the lens, drops ann's open annex: a way of hiding that is not a dungeon (what the engine might one day add)
  const dropsTheAnnexUnderTheLens = async (w, _handle, _key, { lens = null } = {}) =>
    (lens ? { ...w, marks: (w.marks ?? []).filter((m) => m.id !== "ann/the-annex") } : w);
  assert.equal(await world.lensNoteFor({ handle: "ann" }, key("ann")), LINE, "control: with the engine's own sight the line stands for ann");
  // ⚑ THE FLIP: drop the sight comparison in lensNoteFor → the line is said over a view that did change, and this reds
  assert.equal(await world.lensNoteFor({ handle: "ann" }, key("ann"), { sight: dropsTheAnnexUnderTheLens }), null,
    "the lens moved the household's view, whatever moved it: no line");
  assert.equal(world.yoursAreInAClosedPlace(MARKS, world.ownersOf("ann", key("ann")), portals), false, "control: and no closed place is in play, so only the comparison could have withheld it");
});

test("the reason is true: a mark that is a closed place, or stands in one, is in a closed place; an open one is not", { skip: SKIP }, async () => {
  const { yoursAreInAClosedPlace, ownersOf } = world;
  const inClosed = (handle, k = key(handle)) => yoursAreInAClosedPlace(MARKS, ownersOf(handle, k), portals);
  assert.equal(inClosed("ann"), false);
  assert.equal(inClosed("fay"), false, "an entry on an open place is not a closed place");
  assert.equal(inClosed("mason"), true, "owns the closed place itself");
  assert.equal(inClosed("bea"), true, "her note stands inside one");
  assert.equal(inClosed("gus", key("gus", "hal")), true, "hal is one of the household");
  assert.equal(inClosed("gus", key("gus")), false, "and gus alone is not");
  assert.equal(inClosed("dan"), true, "owns one with nothing of his inside");
  assert.equal(inClosed("eve"), true, "her chest stands inside one");
  assert.equal(inClosed("nobody", key()), false, "a household with no marks has none in a closed place");
  // a predicate rides its parent: a naming under a note that stands in the closed place is inside it too
  const underTheNote = { id: "zoe/naming", by: "zoe", kind: "naming", parent: "bea/the-note", body: "n" };
  assert.equal(yoursAreInAClosedPlace(MARKS, new Set(["zoe"]), portals), false, "control: zoe has no mark yet");
  assert.equal(yoursAreInAClosedPlace([...MARKS, underTheNote], new Set(["zoe"]), portals), true, "zoe's naming rides a note that stands in the closed place");
  // an engine that cannot say what a closed place is cannot vouch for the reason: it is treated as closed and the line is withheld
  assert.equal(yoursAreInAClosedPlace(MARKS, new Set(["ann"]), {}), true, "no dungeonsOf: not vouched for");
});

test("standing inside your own closed place moves nothing, and still earns no line", { skip: SKIP }, async () => {
  const inside = { verbs, handle: "mason", stack: [TOWER, "mason/the-hall"], key: key("mason") };
  const yours = world.sightedWorld({ marks: MARKS }, inside);
  const stranger = world.sightedWorld({ marks: MARKS }, { ...inside, lens: "outsider" });
  assert.deepEqual(stranger.marks.map((m) => m.id).sort(), yours.marks.map((m) => m.id).sort(), "control: the lens moves nothing for someone standing inside");
  assert.equal(world.yoursAreInAClosedPlace(MARKS, world.ownersOf("mason", key("mason")), portals), true, "but his marks are in a closed place, so the reason stays withheld");
});

test("explain: \"lens_note\" says what the line is, in the grammar's fixed shape", { skip: SKIP }, async () => {
  const { explainAnswer } = await import("../src/read-grammar.mjs");
  const e = explainAnswer("world", "lens_note");
  assert.equal(e.explains, "lens_note");
  assert.match(e.what, /outsider lens changed nothing/);
  assert.match(e.detail, /closed place/);
});
