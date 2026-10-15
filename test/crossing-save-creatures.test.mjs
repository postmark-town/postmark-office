// crossing-save-creatures.test.mjs — the creatures in the save and in the falsifier (WLD-56 part 4).
//
//   before launch  no creature row and no photograph: the save writes what it
//                  always did, byte for byte, and no creatures.json.
//   the save       every creature row rides the log whole (`creature` for the
//                  town's, `creature-act` for the creature's own), the meta counts
//                  them, and creatures.json is the world's own photograph at the
//                  boundary: the newest older photograph plus the rows since.
//   parity         a chain of saves photographs what the whole record folds to.
//   the tamper     drop a spawn from the log, or change a mood in the photograph,
//                  and the replay check names the creature.
//
// The fixture world carries the world's REAL tools/ (copied from the pinned
// world clone): the photograph and the fold are the world's code, never a copy
// of it. With no world clone the cases skip and say why.

import { test as nodeTest, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { fixtureWorldDb, mainShaOf, scratchDir } from "./dynamic-fixture.mjs";
import { NO_WORLD_DB, rowsEnv } from "./helpers/world-rows.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);

const scratch = scratchDir("save-creatures");
/** A world clone whose tools/ are the pinned world's own, and an empty world. */
function realToolsClone() {
  const repo = mkdtempSync(join(tmpdir(), "postmark-save-creatures-world-"));
  cpSync(join(worldClone(), "tools"), join(repo, "tools"), { recursive: true, filter: (p) => !/\.test\.mjs$/.test(p) });
  mkdirSync(join(repo, "WORLD", "marks"), { recursive: true });
  writeFileSync(join(repo, "WORLD", "walk-ledger.md"), "# Walk ledger\n");
  writeFileSync(join(repo, "WORLD", "marks", ".keep"), "");
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "fixture world with the world's own tools");
  return repo;
}
const repo = NO_WORLD ? null : realToolsClone();
const sweep = (d) => { try { if (d) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
after(() => { sweep(scratch); sweep(repo); });

const STATE = repo ? join(repo, "STATE") : null;
const FIX = join(scratch, "record.json");
const worldDbPath = join(scratch, "world.db");
const cm = NO_WORLD ? null : await import(pathToFileURL(join(repo, "tools", "creatures.mjs")).href);
const walk = NO_WORLD ? null : await import(pathToFileURL(join(repo, "tools", "walk.mjs")).href);
const start = (n) => walk.CROSSING_EPOCH_UTC + n * walk.CROSSING_MS;
const N = 300;
const B = NO_WORLD ? 0 : start(N);
const H = 3600_000, MIN = 60_000;
const MID = B + H;
const NEXT = B + 12 * H + 2 * MIN;
const iso = (ms) => new Date(ms).toISOString();

const env = () => ({ ...process.env, WORLD_CLONE: repo, ...(existsSync(worldDbPath) ? rowsEnv(worldDbPath, scratch) : { WORLD_STORE_DB: NO_WORLD_DB }),
  WORLD_EMISSIONS: "1", TOWN_PUSH: "" });
const save = (atMs) => JSON.parse(execFileSync(process.execPath, [join("tools", "crossing-save.mjs"), "--world", repo, "--record-fixture", FIX,
  "--at", iso(atMs), "--state", STATE, "--json"], { encoding: "utf8", env: env(), stdio: ["ignore", "pipe", "pipe"] }));

// The creatures' rows as the store holds them: the tick's (the-town) and the creature's own.
let id = 0;
const row = (at, actor, action, object, payload) => ({ id: ++id, at: iso(at), actor, action, object, payload });
const spawn = (cid, kind, at, x, y) => row(at + 20_000, "the-town", "spawn", cid,
  { kind, crossing: Math.floor((at - walk.CROSSING_EPOCH_UTC) / walk.CROSSING_MS), x, y, at: iso(at), fades_at: iso(at + 12 * H), moods: { fear: 1, curiosity: 1 }, flags: [] });
function creatureRecord() {
  id = 0;
  return [
    row(start(N - 1) + 5_000, "the-town", "seed", "window-299", { crossing: N - 1, world_sha: "0".repeat(40), commitment: "c299" }),
    spawn("creature:wolf-299-1", "wolf", B - 2 * H, 1000, 2000),
    // a raven whose fade is never written (an office outage): the written fold
    // keeps it, so only the photographs carry it forward
    spawn("creature:raven-299-2", "raven", B - H, -3000, 100),
    row(B + 5_000, "the-town", "reveal", "window-299", { crossing: N - 1, secret: "s299" }),
    row(B + 6_000, "the-town", "seed", "window-300", { crossing: N, world_sha: "0".repeat(40), commitment: "c300" }),
    row(B + 20 * MIN, "creature:wolf-299-1", "react", "9001",
      { to: "kai", verb: "walk", reaction: "stalk", roll: 7, judged_by: "code", moods_after: { fear: 2, curiosity: 1 }, flags_after: ["wary"] }),
    spawn("creature:bat-300-1", "bat", B + 30 * MIN, -500, 300),
    row(B + 40 * MIN, "creature:bat-300-1", "react", "9002", { to: "kai", verb: "say", reaction: "flee", roll: 3, judged_by: "code", moods_after: { fear: 3, curiosity: 1 }, flags_after: [] }),
    row(B + 40 * MIN, "creature:bat-300-1", "withdraw", "creature:bat-300-1", { reason: "fled", after: "9002" }),
    spawn("creature:raven-300-1", "raven", B + 6 * H, 40, -60),
    row(B + 10 * H + 20_000, "the-town", "withdraw", "creature:wolf-299-1", { reason: "faded", fades_at: iso(B + 10 * H) }),
    row(B + 18 * H + 20_000, "the-town", "withdraw", "creature:raven-300-1", { reason: "faded", fades_at: iso(B + 18 * H) }),
    spawn("creature:wolf-301-1", "wolf", B + 20 * H, 700, 700),
  ];
}
let record;
const writeRecord = () => writeFileSync(FIX, JSON.stringify(record));

beforeEach(() => {
  if (NO_WORLD) return;
  if (existsSync(STATE)) rmSync(STATE, { recursive: true, force: true });
  record = { movements: [], attachments: [], say_acts: [], centres: {}, creature_acts: [] };
  writeRecord();
  fixtureWorldDb(worldDbPath, { sha: mainShaOf(repo), departures: [] });
});

const linesOf = (n) => readFileSync(join(STATE, "log", `${n}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const photo = (n) => JSON.parse(readFileSync(join(STATE, "snapshot", String(n), "creatures.json"), "utf8"));
const replay = async () => (await import("../tools/crossing-replay-check.mjs")).replayCheck({ stateDir: STATE, repo, fixture: record });

test("before the launch: no creature row, no creatures.json, and the meta counts what they always did", async () => {
  save(MID);
  assert.equal(existsSync(join(STATE, "snapshot", String(N), "creatures.json")), false);
  assert.deepEqual(JSON.parse(readFileSync(join(STATE, "log", `${N}.meta.json`), "utf8")).counts, { departure: 0, attachment: 0, emission: 0 });
  const v = await replay();
  assert.equal(v.equal, true, v.problems?.join(" | "));
  assert.equal(v.counts.compared_creatures, 0);
});

test("the save: every creature row rides the log whole, typed, and creatures.json is the world's photograph at the boundary", async () => {
  record.creature_acts = creatureRecord();
  writeRecord();
  const r = save(MID);
  const lines = linesOf(N).filter((l) => l.type === "creature" || l.type === "creature-act");
  const inWindow = record.creature_acts.filter((a) => Date.parse(a.at) >= B && Date.parse(a.at) < MID);
  assert.deepEqual(lines.map((l) => [l.type, l.actor, l.action, l.object]),
    inWindow.map((a) => [a.actor === "the-town" ? "creature" : "creature-act", a.actor, a.action, a.object]), "every row in the window, in order, typed by whose it is");
  assert.deepEqual(lines.find((l) => l.action === "react" && l.object === "9001").payload, inWindow.find((a) => a.object === "9001").payload, "whole");
  const meta = JSON.parse(readFileSync(join(STATE, "log", `${N}.meta.json`), "utf8"));
  assert.deepEqual(meta.counts, { departure: 0, attachment: 0, emission: 0, creature: 3, "creature-act": 3 }, "the creature types are counted, never NaN");
  const p = photo(N);
  assert.deepEqual(p, cm.creaturesSnapshot(N, B, null, record.creature_acts), "the world's own photograph");
  assert.deepEqual(p.creatures.map((c) => c.id), ["creature:raven-299-2", "creature:wolf-299-1"], "299's wolf and raven are out at the boundary; the bat comes later and rides the log");
  assert.equal(r.crossings_written.at(-1).creatures, 2);
  const v = await replay();
  assert.equal(v.equal, true, v.problems.join(" | "));
  assert.equal(v.counts.compared_creatures, 2, "the wolf (its reaction's moods and flags folded from the log) and the raven; the bat fled");
  assert.deepEqual([v.counts.applied.creature, v.counts.applied["creature-act"], v.counts.applied.unknown], [3, 3, 0]);
});

test("parity: the next save photographs from the older photograph and the rows since, and equals the whole record's fold", async () => {
  record.creature_acts = creatureRecord();
  writeRecord();
  save(MID);
  const r = save(NEXT);
  assert.deepEqual(r.crossings_written.map((c) => c.crossing), [N, N + 1]);
  assert.deepEqual(photo(N + 1), cm.creaturesSnapshot(N + 1, start(N + 1), null, record.creature_acts), "chained = whole");
  assert.deepEqual(photo(N + 1).creatures.map((c) => c.id), ["creature:raven-299-2", "creature:raven-300-1"], "the wolf faded, the bat fled; 300's raven is out, and 299's raven's fade is unwritten");
  const again = save(NEXT);
  assert.deepEqual(again.files_changed, [], "the same record at the same instant: the same bytes");
  assert.equal((await replay()).equal, true);
  // a third save stands on the photograph of N (the newest older than the crossing it may close) and the rows since
  save(start(N + 2) + 2 * MIN);
  assert.deepEqual(photo(N + 2), cm.creaturesSnapshot(N + 2, start(N + 2), null, record.creature_acts), "base plus delta = the whole record");
  assert.deepEqual(photo(N + 2).creatures.map((c) => c.id), ["creature:raven-299-2", "creature:wolf-301-1"], "299's raven rides only the photographs: its rows are older than the base");
  const v = await replay();
  assert.equal(v.equal, true, v.problems.join(" | "));
});

test("TAMPER: a spawn dropped from the log, or a place changed in the photograph, is named by the replay check", async () => {
  record.creature_acts = creatureRecord();
  writeRecord();
  save(MID + 6 * H);
  assert.equal((await replay()).equal, true, "clean first");
  const lp = join(STATE, "log", `${N}.jsonl`);
  const kept = readFileSync(lp, "utf8");
  writeFileSync(lp, kept.split("\n").filter((l) => !(l.includes("\"spawn\"") && l.includes("creature:raven-300-1"))).join("\n"));
  const v = await replay();
  assert.equal(v.equal, false);
  assert.ok(v.problems.some((p) => p.startsWith("CREATURE ONLY IN THE RECORD: creature:raven-300-1")), v.problems.join(" | "));
  writeFileSync(lp, kept);
  const pp = join(STATE, "snapshot", String(N), "creatures.json");
  const ph = JSON.parse(readFileSync(pp, "utf8"));
  ph.creatures.find((c) => c.id === "creature:wolf-299-1").x += 1;
  writeFileSync(pp, JSON.stringify(ph));
  const w = await replay();
  assert.equal(w.equal, false);
  assert.ok(w.problems.some((p) => p.startsWith("CREATURE creature:wolf-299-1:")), w.problems.join(" | "));
});
