// holder-word-at-the-door.test.mjs — LOGOS v2 part 2, lane O2; review-610 S8.
//
// Ruled 16:03: "a holder is anything with `holder: true`"; on thing, `holder`
// is sovereign (default false), and with it true `capacity` (sovereign, within
// 1–120) and `open` (sovereign) apply; `portable` is sovereign on thing. So the
// leave door writes a maker's own holding word for any thing — within the
// bounds, refusing out-of-bounds with the holding law's own sentence, and never
// writing a constitution property (the Bowl's holder is the town's).
//
// The class layer is a W1-shaped law snapshot, published through
// reloadLawSnapshot's seam (candy-and-chest-at-the-door.test.mjs's pattern);
// the gates are asked first, and the git lane then writes a passing mark into a
// throwaway world, read back.

import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";
import { markRecord } from "../src/mark-record.mjs";

const WORLD = worldClone();
const skip = (!WORLD && NO_WORLD) || false;
const repo = mkdtempSync(join(tmpdir(), "o2-holder-word-"));
const put = (p, content) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); };
if (!skip) {
  mkdirSync(join(repo, "tools"), { recursive: true });
  for (const f of readdirSync(join(WORLD, "tools")).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")))
    copyFileSync(join(WORLD, "tools", f), join(repo, "tools", f));
  const root = { id: "the-town/let-there-be-light", by: "the-town", slug: "let-there-be-light", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10000, h: 10000 } };
  put("WORLD/marks/let-there-be-light/mark.md", markRecord(root, "Synthetic world frame."));
  put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: [root] }));
  copyFileSync(join(WORLD, "WORLD", "skeleton.json"), join(repo, "WORLD", "skeleton.json"));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "add", "-A", "WORLD", "tools"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qm", "synthetic canon"]);
  Object.assign(process.env, { WORLD_CLONE: repo, WORLD_SINGLE_LOG: "", WORLD_POOL: "0", WORLD2_PG: "", TOWN_CLONE: join(repo, "no-town"), TOWN_PUSH: "", BOT_NAME: "fixture", BOT_EMAIL: "fixture@test.invalid" });
  delete process.env.WORLD2_PG_URL;
}

const { leaveMarkViaOffice } = await import("../src/world.mjs");
const { reloadLawSnapshot, resetLawSnapshot, LAW_REFRESH_SQLS } = await import("../src/law-snapshot.mjs");
const SHA = "a".repeat(40);
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property",
  key: `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const LAW = [
  cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }), cls("thing", { extends: "sited" }),
  cls("bounty", { extends: "mark" }),
  cls("halloween-candy-bowl", { extends: "thing" }), cls("halloween-candy-bag", { extends: "thing" }),
  prop("postmark-node", "makers", false, "constitution"), prop("sited", "makers", true, "constitution"), prop("thing", "makers", true, "constitution"),
  prop("bounty", "makers", true, "constitution"),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"),
  prop("thing", "min", 1, "constitution", "capacity"), prop("thing", "max", 120, "constitution", "capacity"),
  prop("thing", "open", true, "sovereign", "holder"), prop("thing", "portable", true, "sovereign"),
  prop("halloween-candy-bowl", "holder", true, "constitution"),
  prop("halloween-candy-bag", "holder", true, "constitution"), prop("halloween-candy-bag", "capacity", 200, "sovereign", "holder"),
  prop("halloween-candy-bag", "max", 200, "constitution", "capacity"),
];
await reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === LAW_REFRESH_SQLS.pin ? [{ newest: 300, pinned: 300 }] : LAW }) });
test.after(() => resetLawSnapshot());

const KEY = { household: "o2-holder", handles: new Set(["cy"]) };
let n = 0;
const thing = (over) => ({ slug: `a-thing-${++n}`, kind: "sited", at: { x: 3, y: 4 }, extent: { w: 1, h: 1 }, body: "A thing of mine.", class: "thing", ...over });
const sentence = async (payload) => {
  try { const r = await leaveMarkViaOffice(repo, payload, KEY); return r?.error ? String(r.defect) : "LANDED"; }
  catch (e) { return String(e.defect ?? e.message); }
};

test("S8 · a maker's holding word on a thing passes the door within its bounds", { skip }, async () => {
  for (const over of [{ holder: true }, { holder: true, capacity: 50, open: false }, { holder: true, capacity: 1 }, { holder: true, capacity: 120 }, { portable: false }])
    assert.equal(await sentence(thing(over)), "LANDED", JSON.stringify(over));
  assert.equal(await sentence(thing({ class: "halloween-candy-bag", capacity: 150 })), "LANDED", "a bag's own bound is 200, above thing's 120");
});

test("S8 · out of bounds is refused with the holding law's sentence, never clamped", { skip }, async () => {
  assert.equal(await sentence(thing({ holder: true, capacity: 500 })), "a capacity of 500 is outside 1..120, the bounds its class sets");
  assert.equal(await sentence(thing({ holder: true, capacity: 0 })), "a capacity of 0 is outside 1..120, the bounds its class sets");
  assert.equal(await sentence(thing({ class: "halloween-candy-bag", capacity: 250 })), "a capacity of 250 is outside 1..200, the bounds its class sets");
  assert.equal(await sentence(thing({ holder: true, capacity: 2.5 })), "capacity is a whole number");
  assert.equal(await sentence(thing({ holder: "maybe" })), "holder is true or false");
});

test("S8 · capacity and open need a holder; a constitution property is the town's; a non-thing carries none", { skip }, async () => {
  assert.equal(await sentence(thing({ capacity: 10 })), "capacity and open belong to a holder");
  assert.equal(await sentence(thing({ open: false })), "capacity and open belong to a holder");
  assert.equal(await sentence(thing({ class: "halloween-candy-bowl", holder: false })), "holder is the town's on a halloween-candy-bowl");
  assert.match(await sentence({ slug: "a-notice", kind: "sited", at: { x: 3, y: 4 }, extent: { w: 1, h: 1 }, body: "A notice.", class: "bounty", ask: "Fix it", reward: 1, holder: true }), /belong to a thing/);
});

test("S8 · the record carries the word: a thing left with holder, capacity and open reads them back from its file", { skip }, async () => {
  const r = await leaveMarkViaOffice(repo, thing({ slug: "my-crate", holder: true, capacity: 12, open: false }), KEY);
  const text = execFileSync("git", ["-C", repo, "show", `draft/o2-holder:WORLD/marks/${r.dir}/mark.md`], { encoding: "utf8" });
  assert.match(text, /^holder: true$/m);
  assert.match(text, /^capacity: 12$/m);
  assert.match(text, /^open: false$/m);
});

test("S8 · holderWordOf, the door's one adjudication, pure: the bounds, the tier, the holder", async () => {
  const { holderWordOf } = await import("../src/kind-holding.mjs");
  const { lawSnapshotFromRows, snapProperty } = await import("../src/law-classes.mjs");
  const snap = lawSnapshotFromRows(LAW);
  const cp = (n, p) => snapProperty(snap, n, p);
  const ext = (n) => snap.classes.get(String(n))?.extends ?? null;
  assert.deepEqual(holderWordOf({ payload: { holder: true, capacity: 12, open: false }, klass: "thing", classProperty: cp, extendsOf: ext }), { holder: true, capacity: 12, open: false });
  assert.equal(holderWordOf({ payload: {}, klass: "thing", classProperty: cp, extendsOf: ext }), null);
  assert.throws(() => holderWordOf({ payload: { holder: true, capacity: 121 }, klass: "thing", classProperty: cp, extendsOf: ext }), /a capacity of 121 is outside 1\.\.120/);
  assert.throws(() => holderWordOf({ payload: { holder: false }, klass: "halloween-candy-bowl", classProperty: cp, extendsOf: ext }), /the town's on a halloween-candy-bowl/);
});
