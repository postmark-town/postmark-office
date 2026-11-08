// quest-board-unavailable.test.mjs — POS-965: a quest board that answers 503 says why, in the office's own log, and a burst of
// board reads answers every one and leaves no connection held.
//
//   node --test test/quest-board-unavailable.test.mjs
//
// Since w46 residents saw GET /quests/<handle> answer 503 "quest board unavailable" in bursts, and the office logged nothing for
// it (only nginx saw it). The route's answer is unchanged here: the same 503 and the same words. What is new is one log line per
// 503, naming the phase that failed and the pen pool's counts (town-index-store.mjs § boardFaultLine), and these two guards:
//   · each of the route's three 503 doors (the store refused, the board's own read failed, its composition failed) is driven for
//     real and its line is read back from the office's stderr, with the answer's words unchanged;
//   · N boards at once, more than the pen pool holds, all answer 200 (nothing is refused for want of a connection), and when
//     they are done the store holds no connection idle in a transaction and the office's pool holds nothing waiting.
// The N-parallel guard is a REGRESSION GUARD for the lifecycle the route has (one short READ ONLY transaction per board, released
// before the composition's own reads), not a reproduction of the w46 burst: the quest route's code is unchanged since w45.12 and
// the burst has not been reproduced on a healthy local store (POS-965's findings).

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fixtureTown, putValues } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { seedTownIndex } from "./helpers/index-to-store.mjs";
import { townClone, townModuleUrl } from "./fixture-paths.mjs";
import { boardFaultLine } from "../src/town-index-store.mjs";
import { openOauthDb } from "../src/oauth.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOWN = townClone();
const tmp = mkdtempSync(join(tmpdir(), "quest-board-unavailable-"));
let s = null, skip = TOWN ? false : "no town clone beside the office: the quest board reads the town's own tools from it";
let api;
const offices = {};
const logs = {};
const HANDLES = ["wright", "limen", "errant", "nobody", "kogane", "seth", "rei", "juno"];

const startOffice = (name, townClone, env) => new Promise((ok, no) => {
  const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0",
    "--oauth-db", (() => { const p = join(tmp, `${name}-oauth.db`); openOauthDb(p).close(); return p; })(), "--roles-db", join(tmp, `${name}-roles.db`)], {
    env: { ...process.env, WORLD_GRAPH_NONE: "1", TOWN_CLONE: townClone, WORLD_CLONE: join(tmp, "no-world-clone"), VOICES_LOG: join(tmp, `${name}-voices.jsonl`),
      TOWN_PUSH: "", WORLD_STORE_DB: join(tmp, "no-world.db"), OFFICE_READ_WORKERS: "0",
      WORLD2_PG: undefined, WORLD2_PG_URL: undefined, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  logs[name] = [];
  child.stderr.on("data", (d) => logs[name].push(String(d)));
  const t = setTimeout(() => no(new Error(`${name}: the office never listened`)), 30_000);
  child.stdout.on("data", (d) => { const m = /listening on :(\d+)/.exec(String(d)); if (m) { clearTimeout(t); offices[name] = { child, base: `http://127.0.0.1:${m[1]}` }; ok(); } });
  child.on("exit", (c) => no(new Error(`${name}: the office exited early (${c})`)));
});

before(async () => {
  if (skip) return;
  s = await startStore();
  if (s.skip) { skip = s.skip; return; }
  const { townDay } = await import(townModuleUrl("tools", "quest-progress.mjs"));
  const db = fixtureTown();
  const put = (...v) => putValues(db, "meta", v);
  put("quest_registry", readFileSync(join(TOWN, "quest-registry.json"), "utf8"));
  put("quest_day", townDay());
  const qp = (...v) => putValues(db, "quest_progress", v, ["handle", "send", "receive", "house_size", "house_send", "house_receive", "sent_to", "heard_from"]);
  for (const h of HANDLES) qp(h, 2, 1, 1, 2, 1, JSON.stringify(["limen"]), JSON.stringify(["limen"]));
  const w = await s.connect("law_ingester");
  await seedTownIndex(w, db);
  await w.end();
  api = await s.connect("office_api");

  // the healthy office; one whose store is gone; one whose clone has no quest tools (the board's composition fails)
  await startOffice("healthy", TOWN, { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
  await startOffice("cut-off", TOWN, { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://office_api:x@127.0.0.1:9/none" });
  const bare = join(tmp, "bare-town");
  mkdirSync(bare, { recursive: true });
  writeFileSync(join(bare, "quest-registry.json"), readFileSync(join(TOWN, "quest-registry.json"), "utf8"));
  await startOffice("no-tools", bare, { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
});

after(async () => {
  for (const { child } of Object.values(offices)) if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
  if (api) await api.end().catch(() => {});
  if (s?.stop) await s.stop();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const fault = (name) => logs[name].join("").split("\n").filter((l) => l.startsWith("[quest-board] unavailable"));
const waitForFault = async (name, ms = 5_000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms;) { if (fault(name).length) return fault(name); await new Promise((ok) => setTimeout(ok, 50)); }
  return fault(name);
};

test("boardFaultLine names the phase, the handle, the error and the pen pool, and carries nothing else", () => {
  const e = Object.assign(new Error("the store's pen pool had no free connection within 10000 ms (it holds 3)\n  at secret"), { name: "StoreAcquireTimeout", code: "store-acquire-timeout" });
  const line = boardFaultLine({ handle: "kogane", phase: "store", error: e, pool: { max: 3, total: 3, idle: 0, waiting: 5 } });
  assert.equal(line, '[quest-board] unavailable (store) for "kogane": StoreAcquireTimeout store-acquire-timeout: the store\'s pen pool had no free connection within 10000 ms (it holds 3) at secret; pen pool max 3 total 3 idle 0 waiting 5');
  assert.equal(boardFaultLine({ handle: "x", phase: "read", error: "plain text", pool: null }), '[quest-board] unavailable (read) for "x": Error: plain text; pen pool not built');
  assert.ok(boardFaultLine({ handle: "x", phase: "compose", error: new Error("y".repeat(900)) }).length < 400, "a long message is cut");
});

test("the store refused: 503 with the town-index words, and the log says phase store", async (t) => {
  if (skip) return t.skip(skip);
  const r = await fetch(`${offices["cut-off"].base}/quests/wright`);
  assert.equal(r.status, 503);
  assert.match((await r.json()).defect, /town index \(the store\) cannot be reached/, "the answer's words are unchanged");
  const lines = await waitForFault("cut-off");
  assert.equal(lines.length, 1, `one line per 503: ${JSON.stringify(lines)}`);
  assert.match(lines[0], /^\[quest-board\] unavailable \(store\) for "wright": /);
});

test("the board's composition failed: the same 'quest board unavailable' 503, and the log says phase compose", async (t) => {
  if (skip) return t.skip(skip);
  const r = await fetch(`${offices["no-tools"].base}/quests/wright`);
  assert.equal(r.status, 503);
  const body = await r.json();
  assert.equal(body.defect, "quest board unavailable", "the answer's words are unchanged");
  assert.match(body.hint, /couldn't read the quest registry from its clone/);
  const lines = await waitForFault("no-tools");
  assert.equal(lines.length, 1, `one line per 503: ${JSON.stringify(lines)}`);
  assert.match(lines[0], /^\[quest-board\] unavailable \(compose\) for "wright": /);
  assert.match(lines[0], /pen pool (max \d+ total \d+ idle \d+ waiting \d+|not built)/);
});

test("a healthy board logs nothing: 200s leave no fault line (the control for the two above)", async (t) => {
  if (skip) return t.skip(skip);
  const r = await fetch(`${offices.healthy.base}/quests/wright`);
  assert.equal(r.status, 200);
  assert.equal(fault("healthy").length, 0);
});

test("N boards at once, more than the pen pool holds: all 200, no fault line, no connection left idle in a transaction", async (t) => {
  if (skip) return t.skip(skip);
  const N = 24; // the pen pool holds 3
  const answers = await Promise.all(Array.from({ length: N }, async (_, i) => {
    const r = await fetch(`${offices.healthy.base}/quests/${HANDLES[i % HANDLES.length]}`);
    await r.arrayBuffer();
    return r.status;
  }));
  assert.deepEqual(answers, Array(N).fill(200), `every board answered: ${JSON.stringify(answers)}`);
  assert.equal(fault("healthy").length, 0, "and none logged a fault");
  // after the burst the store holds nothing in a transaction (the office's own connections are named postmark-office:…)
  const held = (await api.query(
    "SELECT application_name, state, now() - state_change AS age FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%' AND application_name LIKE 'postmark-office:%'")).rows;
  assert.deepEqual(held, [], "no office connection is idle in a transaction after the burst");
});
