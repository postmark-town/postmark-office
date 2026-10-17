// chests-candy-flag.test.mjs — WLD-27's chest and candy doors ship dark by default (src/chests-candy.mjs).
//
// Office #499 (WLD-27) built chests and candy on candy LABELS and is merged
// into train/2026-w43; Darko ruled the label version out, and at 12:56 on
// 2026-10-16: "#499 still needs a fallback". OFF unless WORLD_CHESTS_CANDY=1:
//   1. the counted-unit door (take/give/drop by label, consume, refill)
//      refuses in the office's own words, before it reads anything;
//   2. a resident's chest (leave_mark { class: "chest" }) refuses;
//   3. the reads offer nothing: GET /world/chests answers no chest;
//   4. the tick's first stock writes nothing, and says why.
// ON (=1) is exactly #499's behaviour, which its own tests hold
// (candy-and-chest-at-the-door, chest-stock, chests-hold-things, world-units,
// bevel-exit-boundaries all run with the flag open).
//
// THE FLIP: make chestsCandyOn answer true by default and § 1–4 go red.

import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";

delete process.env.WORLD_CHESTS_CANDY;
process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-wld27-flag");
const { chestsCandyOn, CHESTS_CANDY_OFF, CHESTS_CANDY_ENV } = await import("../src/chests-candy.mjs");
const { callUnits } = await import("../src/world-units.mjs");
const { stockedOnTick } = await import("../world2/tools/settlements-backfill.mjs");
const { leaveMarkViaOffice } = await import("../src/world.mjs");
const { reloadLawSnapshot, resetLawSnapshot, LAW_REFRESH_SQLS } = await import("../src/law-snapshot.mjs");

// the same synthetic law candy-and-chest-at-the-door.test.mjs reads, so the roster knows chest
const CHEST_DIALS = { capacity: 30, capacity_min: 1, capacity_max: 120, first_stock: 30, portable: true, welcome: "open" };
const CLASS_ROWS = [
  ["bounty", {}], ["thing", { extends: "mark", dials: { carry_cap: 24 } }], ["note", {}], ["idea", {}],
  ["consumable", { extends: "thing", dials: {} }],
  ["candy", { extends: "consumable", dials: {}, labels: [{ label: "test-comets", name: "Test Comets", creator: "alpha" }] }],
  ["chest", { extends: "thing", dials: CHEST_DIALS }],
].map(([key, data]) => ({ number: 250, tag_sha: "f".repeat(40), newest: 250, kind: "class", key, data: { class: key, ...data } }));
await reloadLawSnapshot({ force: true, query: async (sql) =>
  ({ rows: sql === LAW_REFRESH_SQLS.pin ? [{ newest: 250, pinned: 250 }] : CLASS_ROWS }) });
test.after(() => resetLawSnapshot());

const withFlag = async (value, fn) => {
  const keep = process.env[CHESTS_CANDY_ENV];
  if (value == null) delete process.env[CHESTS_CANDY_ENV]; else process.env[CHESTS_CANDY_ENV] = value;
  try { return await fn(); } finally { if (keep == null) delete process.env[CHESTS_CANDY_ENV]; else process.env[CHESTS_CANDY_ENV] = keep; }
};
const one = { household: "house-a", handles: new Set(["alpha"]) };
const chest = { slug: "the-bowl", kind: "sited", at: { x: 3, y: 4 }, extent: { w: 1, h: 1 }, body: "A bowl of sweets by the door.", class: "chest" };
const sentence = async (payload) => {
  try { await leaveMarkViaOffice(process.env.WORLD_CLONE, payload, one); return "LANDED"; }
  catch (e) { return String(e.defect ?? e.message); }
};
// a unit door's collaborators that fail loudly if the door reads anything at all
const untouched = new Proxy({}, { get: (_t, k) => () => { throw new Error(`the closed door read ${String(k)}`); } });

test("0 · OFF by default: only WORLD_CHESTS_CANDY=1 opens the doors", () => {
  assert.equal(chestsCandyOn({}), false);
  for (const v of ["0", "true", "yes", "on", " 1", ""]) assert.equal(chestsCandyOn({ WORLD_CHESTS_CANDY: v }), false, `"${v}"`);
  assert.equal(chestsCandyOn({ WORLD_CHESTS_CANDY: "1" }), true);
});

test("1 · OFF: every counted-unit route refuses in the office's own words, and reads nothing first", async () => {
  for (const route of ["take", "give", "drop", "consume", "consume-in-place", "refill", "take-back", "thing-into-chest", "thing-from-chest"]) {
    await assert.rejects(() => callUnits(route, { label: "test-comets", count: 1, from: "alpha/the-bowl" }, null, "alpha", untouched),
      (e) => e.code === 409 && e.defect === "chests and candy aren't open in town yet" && /nothing was changed/.test(e.hint), route);
  }
});

test("1 · ON: the same route reaches #499's door (it reads the class layer)", async () => {
  await withFlag("1", async () => {
    await assert.rejects(() => callUnits("take", { from: "alpha/the-bowl" }, null, "alpha", untouched), /the closed door read classes/);
  });
});

test("2 · OFF: a resident's chest refuses at the leave door; ON: it passes the gate as #499 built it", async () => {
  assert.equal(await sentence({ ...chest }), CHESTS_CANDY_OFF.defect);
  const on = await withFlag("1", () => sentence({ ...chest }));
  assert.ok(on !== CHESTS_CANDY_OFF.defect && !/town-only|unknown class/.test(on), `ON passed the class gate (then: ${on})`);
});

test("4 · OFF: the tick's first stock writes nothing and says why; ON: it stocks", async () => {
  let called = 0;
  const stock = async () => { called++; return { line: "chests: 1 stocked" }; };
  const off = await stockedOnTick(null, { stock, crossing: () => 1 });
  assert.equal(called, 0, "the closed tick asked the store for nothing");
  assert.equal(off.verdict, "ok");
  assert.match(off.line, /^chests: not stocked — chests and candy are off at this office \(WORLD_CHESTS_CANDY unset\)$/);
  const on = await withFlag("1", () => stockedOnTick(null, { stock, crossing: () => 1 }));
  assert.equal(called, 1);
  assert.equal(on.line, "chests: 1 stocked");
});

test("3 · OFF: the reads offer nothing (pinned in source: GET /world/chests, the doorstep's holds, world_holdings' units)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
  const server = src("src/server.mjs");
  const at = server.indexOf('if (path === "/world/chests") {');
  assert.ok(at > 0);
  const route = server.slice(at, server.indexOf("m.chestsRead()", at));
  assert.match(route, /if \(!chestsCandyOn\(\)\) return j\(res, 200, \{ chests: \[\], count: 0, off: CHESTS_CANDY_OFF\.defect \}\);/,
    "GET /world/chests answers no chest before it reads one");
  assert.match(src("src/doorstep-bundle.mjs"), /if \(\(await import\("\.\/chests-candy\.mjs"\)\)\.chestsCandyOn\(\)\) try \{   \/\/ dark by default[^\n]*\n\s*const \{ residentHolds \}/,
    "the doorstep reads holdings only with the doors open");
  assert.match(src("src/world-hold.mjs"), /\.\.\.\(\(await import\("\.\/chests-candy\.mjs"\)\)\.chestsCandyOn\(\) \? \{ units: await unitsHeldBy\(actor\) \} : \{\}\)/,
    "world_holdings carries units only with the doors open");
});

test("4 · OFF: the tick's line grades as a switch, not a failure: softStepStatus answers `ok switch-off`, so the roll-call stays quiet", async () => {
  const { softStepStatus } = await import("../world2/tools/settlements-backfill.mjs");
  const off = await stockedOnTick(null, { stock: async () => ({ line: "x" }), crossing: () => 1 });
  assert.equal(softStepStatus(off.line, "chests"), "ok switch-off");
  // the neighbours are unchanged
  assert.equal(softStepStatus("chests: stocked 2", "chests"), "ok");
  assert.equal(softStepStatus("chests: something else", "chests"), "refused write-failed");
});

test("2 · OFF: the town-only hint does not offer chest among what a resident may make", async () => {
  const candy = { slug: "a-sweet", kind: "sited", at: { x: 3, y: 4 }, extent: { w: 1, h: 1 }, body: "A sweet.", class: "candy" };
  let hint = null;
  try { await leaveMarkViaOffice(process.env.WORLD_CLONE, candy, one); } catch (e) { hint = String(e.hint ?? ""); }
  // LOGOS v2 (O1): the hand-kept list this hint used to recite is retired; who
  // may make a class is its own `makers`, and the refusal names where that was
  // set (or that the class layer could not be read). So the hint offers no list
  // of classes at all, and so never offers chest, whatever the flag says.
  assert.ok(hint != null, "the door refused the candy");
  assert.doesNotMatch(hint, /\bchest\b/);
  assert.doesNotMatch(hint, /residents may instantiate only/);
  let onHint = null;
  await withFlag("1", async () => { try { await leaveMarkViaOffice(process.env.WORLD_CLONE, candy, one); } catch (e) { onHint = String(e.hint ?? ""); } });
  assert.doesNotMatch(onHint ?? "", /residents may instantiate only/);
});

test("3 · OFF, behaviourally: a spawned office's GET /world/chests answers no chest and says why", { timeout: 60_000 }, async (t) => {
  const { spawn } = await import("node:child_process");
  const { mkdtempSync } = await import("node:fs");
  const { bootOnFreePort } = await import("./spawn-office.mjs");
  const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
  const tmp = mkdtempSync(join(tmpdir(), "chests-candy-flag-"));
  const env = { ...process.env, TOWN_CLONE: join(tmp, "no-clone"), WORLD_CLONE: join(tmp, "no-world"), TOWN_PUSH: "", OFFICE_READ_WORKERS: "0",
    WORLD_STORE_DB: join(tmp, "no-world.db"), WORLD_GRAPH_NONE: "1", TOWN_INDEX_READS: undefined, WORLD2_PG: undefined, WORLD2_PG_URL: undefined };
  delete env.WORLD_CHESTS_CANDY;
  const { child, port } = await bootOnFreePort((p) => spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(p),
    "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db")], { env, stdio: ["ignore", "pipe", "pipe"] }));
  t.after(async () => { if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; } });
  const r = await fetch(`http://127.0.0.1:${port}/world/chests`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { chests: [], count: 0, off: CHESTS_CANDY_OFF.defect });
});
