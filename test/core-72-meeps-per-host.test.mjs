// CORE-72 — one meeps probe per host. The PC's watcher lands meeps.json (probe `meeps`, unchanged);
// the watcher on town-rig lands meeps-town-rig.json (probe `meeps_town_rig`). Same classifier, same 15 minutes.
// Only the two meeps probes are read here; every other probe of the tick is whatever a dead network makes it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tick, classifyMeeps, CONFIG, MINUTE } from "../tools/site-sentinel.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";

const T0 = Date.parse("2026-11-17T12:00:00Z");
const rec = (over = {}) => JSON.stringify({ schema: 1, generated_at: new Date(T0 - MINUTE).toISOString(), status: "OK", summary: "all 9 meeps answering", problems: [], meeps: {}, ...over });
const deadFetch = async () => ({ ok: false, status: 404, headers: { get: () => null }, text: async () => "", json: async () => null });
const noExec = () => "";
const GREEN_DISK = () => ({ path: "/", usedPct: 62, freeBytes: 14 * 2 ** 30 });

// `pc` / `rig` are the file's text, or null for "never landed".
async function probesFor({ pc, rig }) {
  const dir = tempDir("core72-meeps-");
  const pcPath = join(dir, "meeps.json");
  const rigPath = join(dir, "meeps-town-rig.json");
  if (pc != null) writeFileSync(pcPath, pc);
  if (rig != null) writeFileSync(rigPath, rig);
  const config = { ...CONFIG, meeps: { ...CONFIG.meeps, path: pcPath }, meepsTownRig: { ...CONFIG.meepsTownRig, path: rigPath } };
  const t = await tick({ token: "fixture-token", fetchImpl: deadFetch, exec: noExec, state: {}, nowMs: T0, config, readDisk: GREEN_DISK });
  return { pcPath, rigPath, meeps: t.probes.find((p) => p.key === "meeps"), rigProbe: t.probes.find((p) => p.key === "meeps_town_rig") };
}

test("config: the PC's probe keeps its key, label, path and window; town-rig's has its own", () => {
  // FLIP: change any of the four fields of CONFIG.meeps in tools/site-sentinel.mjs.
  assert.equal(CONFIG.meeps.key, "meeps");
  assert.equal(CONFIG.meeps.label, "the meeps");
  assert.equal(CONFIG.meeps.path, "/srv/postmark-sentinel/meeps.json");
  assert.equal(CONFIG.meeps.staleAfterMs, 15 * MINUTE);
  // FLIP: change the path, key or window on the `meepsTownRig` line.
  assert.equal(CONFIG.meepsTownRig.key, "meeps_town_rig");
  assert.equal(CONFIG.meepsTownRig.label, "the meeps on town-rig");
  assert.equal(CONFIG.meepsTownRig.path, "/srv/postmark-sentinel/meeps-town-rig.json");
  assert.equal(CONFIG.meepsTownRig.staleAfterMs, 15 * MINUTE);
});

test("both files fresh and OK: both probes OK, and `meeps` is exactly what classifyMeeps says of the PC's file", async () => {
  const pc = rec();
  const r = await probesFor({ pc, rig: rec({ summary: "all 3 meeps answering on town-rig" }) });
  // FLIP: remove `meepsTownRig` from the `for (const mcfg of [...])` list in tick §10 and rigProbe is undefined.
  assert.equal(r.meeps.verdict, "OK");
  assert.equal(r.rigProbe.verdict, "OK");
  assert.equal(r.rigProbe.label, "the meeps on town-rig");
  assert.equal(r.rigProbe.kind, "meeps");
  const alone = classifyMeeps({ raw: pc, nowMs: T0, staleAfterMs: 15 * MINUTE, path: r.pcPath });
  // FLIP: make the loop push a different label/kind/reason shape for the first entry.
  assert.deepEqual(r.meeps, { key: "meeps", label: "the meeps", kind: "meeps", verdict: alone.verdict, reason: alone.reason, detail: alone.detail });
});

test("town-rig's file DOWN: `meeps_town_rig` is DOWN and the PC's `meeps` stays OK", async () => {
  const r = await probesFor({ pc: rec(), rig: rec({ status: "DOWN", summary: "STUCK Rei: an input in local-conv-333" }) });
  // FLIP: point the town-rig entry's path at the PC's file (CONFIG.meepsTownRig.path) and rigProbe turns OK.
  assert.equal(r.rigProbe.verdict, "DOWN");
  assert.match(r.rigProbe.reason, /STUCK Rei/);
  // FLIP: let the loop share one raw between the entries and `meeps` turns DOWN.
  assert.equal(r.meeps.verdict, "OK");
});

test("town-rig's file missing or 16 minutes old is STALE, and the PC's `meeps` is unmoved", async () => {
  const gone = await probesFor({ pc: rec(), rig: null });
  // FLIP: make a missing file read as OK or UNKNOWN in the loop's catch (readError handling).
  assert.equal(gone.rigProbe.verdict, "STALE");
  assert.match(gone.rigProbe.reason, /no meeps record at .*meeps-town-rig\.json/);
  assert.equal(gone.meeps.verdict, "OK");

  const old = await probesFor({ pc: rec(), rig: rec({ generated_at: new Date(T0 - 16 * MINUTE).toISOString() }) });
  // FLIP: change `staleAfterMs` on the `meepsTownRig` line to 20 * MINUTE.
  assert.equal(old.rigProbe.verdict, "STALE");
  assert.match(old.rigProbe.reason, /16m.*old|old/);
  assert.equal(old.meeps.verdict, "OK");
});

test("the PC's file alone still drives `meeps` exactly as before, whatever town-rig's file says", async () => {
  const down = rec({ status: "DOWN", summary: "STUCK Rei: an input in local-conv-333" });
  const r = await probesFor({ pc: down, rig: null });
  // FLIP: key `meeps` off the town-rig entry instead of config.meeps in the loop's first slot.
  assert.equal(r.meeps.verdict, "DOWN");
  assert.equal(r.meeps.reason, "STUCK Rei: an input in local-conv-333");
  assert.equal(r.rigProbe.verdict, "STALE");
  const stale = await probesFor({ pc: rec({ generated_at: new Date(T0 - 16 * MINUTE).toISOString() }), rig: rec() });
  assert.equal(stale.meeps.verdict, "STALE");
  assert.equal(stale.rigProbe.verdict, "OK");
});
