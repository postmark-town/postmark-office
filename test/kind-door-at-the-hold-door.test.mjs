// kind-door-at-the-hold-door.test.mjs — LOGOS v2 part 2, lane O2: the kind
// door reached through the REAL `world_hold` door (callHoldTool), the flat
// tool's own implementation, with prod's flags (the hold lane flipped, the
// guards on) on a real store, over a throwaway world that holds a published
// Candy Bowl. The office's live collaborators answer: the law snapshot, the
// world's own marks, the reach. Every call here stops at a refusal that only
// the kind door says, and writes nothing — which is the wiring proven: a
// count with no label reaches the kind door, a `label:` reaches #499's.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { markRecord } from "../src/mark-record.mjs";

const WORLD = worldClone();
const store = await startStore({ db: "kind_door_at_the_hold_door" });
const skip = store.skip ?? ((!WORLD && NO_WORLD) || false);
const BOWL = "sbx-ana/the-bowl";
const repo = mkdtempSync(join(tmpdir(), "o2-hold-door-"));
const put = (p, content) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); };
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN", "W2_GUARDS", "WORLD_CLONE", "WORLD_SINGLE_LOG", "WORLD_POOL"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
let pool;

const SHA = "e".repeat(40);
const cls = (key, data = {}) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "class", key, data: { class: key, ...data } });
const prop = (klass, name, dflt, tier, parent = null) => ({ number: 300, tag_sha: SHA, newest: 300, kind: "property",
  key: `${klass}/${name}`, data: { class: klass, parent, name, tier, default: dflt, id: `the-town/${klass}-${name}` } });
const LAW = [
  cls("postmark-node"), cls("mark", { extends: "postmark-node" }), cls("sited", { extends: "mark" }), cls("thing", { extends: "sited" }),
  cls("consumable", { extends: "thing" }), cls("candy", { extends: "consumable" }), cls("pocket-comet", { extends: "candy" }),
  cls("entity", { extends: "postmark-node" }), cls("resident", { extends: "entity" }), cls("halloween-candy-bowl", { extends: "thing" }),
  prop("postmark-node", "makers", false, "constitution"), prop("thing", "makers", true, "constitution"),
  prop("resident", "holder", true, "constitution"), prop("resident", "capacity", 24, "constitution", "holder"),
  prop("thing", "holder", false, "sovereign"), prop("thing", "capacity", 30, "sovereign", "holder"), prop("thing", "open", true, "sovereign", "holder"),
  prop("halloween-candy-bowl", "holder", true, "constitution"),
];

let callHoldTool, resetLawSnapshot;
if (!skip) {
  mkdirSync(join(repo, "tools"), { recursive: true });
  for (const f of readdirSync(join(WORLD, "tools")).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")))
    copyFileSync(join(WORLD, "tools", f), join(repo, "tools", f));
  const root = { id: "the-town/let-there-be-light", by: "the-town", slug: "let-there-be-light", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10000, h: 10000 } };
  const bowl = { id: BOWL, by: "sbx-ana", slug: "the-bowl", kind: "sited", class: "halloween-candy-bowl", at: { x: 300, y: 300 }, extent: { w: 2, h: 2 } };
  // 424 m from the Origin: since world#265 (POS-740) a resident the record places nowhere else stands
  // at the Origin, so the bowl stands out of reach and the reach is still what answers below
  put("WORLD/marks/let-there-be-light/mark.md", markRecord(root, "Synthetic world frame."));
  put("WORLD/marks/sbx-ana/the-bowl/mark.md", markRecord(bowl, "A bowl of candy by the door."));
  put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: [root, bowl] }));
  copyFileSync(join(WORLD, "WORLD", "skeleton.json"), join(repo, "WORLD", "skeleton.json")); // the town's own: the engine reads its elevation and light
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "add", "-A", "WORLD", "tools"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qm", "synthetic canon"]);
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: store.url("office_api") });
  Object.assign(process.env, { WORLD_CLONE: repo, WORLD_SINGLE_LOG: "", WORLD_POOL: "0", WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), W2_PEN: "hold", W2_GUARDS: "1" });
  (await import("../src/world2-pen.mjs")).__setPoolForTest(pool);
  const snap = await import("../src/law-snapshot.mjs");
  resetLawSnapshot = snap.resetLawSnapshot;
  await snap.reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === snap.LAW_REFRESH_SQLS.pin ? [{ newest: 300, pinned: 300 }] : LAW }) });
  ({ callHoldTool } = await import("../src/world-hold.mjs"));
}
after(async () => {
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  resetLawSnapshot?.();
  if (!skip) (await import("../src/world2-pen.mjs")).__setPoolForTest(null);
  if (pool) await pool.end(); await store.stop();
});
const KEY = { household: "sbx-cy", handles: new Set(["sbx-cy"]) };
const units = async () => { const c = await store.connect("world2_owner"); try { return (await c.query("SELECT count(*)::int AS n FROM acts WHERE action LIKE 'units:%'")).rows[0].n; } finally { await c.end(); } };

test("world_hold { kind, count, to: <the published bowl> } reaches the kind door: the bowl is read from the world and the law, and the reach answers", { skip }, async () => {
  await assert.rejects(callHoldTool("world_hold", { kind: "pocket-comet", count: 2, to: BOWL }, KEY), (e) => {
    assert.equal(e.code, 409, `${e.defect} — ${e.hint}`);
    assert.match(e.defect, /you are not standing where sbx-ana\/the-bowl stands/, "past the holder law, at the reach: the resident stands at the Origin, 424 m off");
    return true;
  });
  assert.equal(await units(), 0, "nothing written");
});

test("world_hold { from: <a draft> } and { act: refill, thing: <a draft> } are the kind door's refusals: a draft holds nothing yet", { skip }, async () => {
  await assert.rejects(callHoldTool("world_hold", { from: "sbx-cy/a-draft-bowl" }, KEY), (e) => e.code === 404 && /a draft holds nothing yet/.test(e.hint));
  await assert.rejects(callHoldTool("world_hold", { act: "refill", thing: "sbx-cy/a-draft-bowl", kind: "pocket-comet" }, KEY), (e) => e.code === 404);
  await assert.rejects(callHoldTool("world_hold", { from: BOWL, kind: "no-such-kind" }, KEY), (e) => e.code === 409 && /you are not standing where sbx-ana\/the-bowl stands/.test(e.defect));
  assert.equal(await units(), 0);
});

test("world_hold { from, label } still reaches #499's door (dark under #608), never the kind door", { skip }, async () => {
  await assert.rejects(callHoldTool("world_hold", { from: BOWL, label: "test-comets" }, KEY), (e) => !/draft holds nothing yet|holds nothing$/.test(String(e.hint ?? "")) && /chest/.test(`${e.defect} ${e.hint}`));
  assert.equal(await units(), 0);
});
