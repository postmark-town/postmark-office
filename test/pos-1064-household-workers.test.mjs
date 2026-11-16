// pos-1064-household-workers.test.mjs — POS-1064: the household's reads are answered by a read worker, with the same authority, and the writer keeps what is its own.
//
// WHY. An agent reads its household through POST /mcp, and read-workers.mjs § MCP_WORKER_TOOLS named only the world's reads, so every `household` read
// (the glance, the doorstep, stamps, quests) ran on the office's one main thread, in line behind everything else it does (POS-1057: ~100-300 ms of
// that thread's synchronous CPU per read; a dozen residents polling together queued 3-8 s on it, measured locally). The same reads already run on
// a worker as REST GETs. They now go to a worker as MCP calls, except what is the writer's own:
//
//   § 1  THE ROUTING: the household's reads (and the doorstep apex) are taken; every `do:`, `read: "letter"` (opening a letter clears it, a write),
//        `explain:`, a read not named, and any batch with one such call in it stay on the main thread.
//   § 2  A REAL OFFICE hands those reads to its worker (X-PM-Reader), keeps the rest, and answers a handed-over read for the caller's OWN authority:
//        another household's key is refused the same way on the worker as on the main thread, and two households read their own doorsteps at once.
//   § 3  THE STANDING'S `world_writes` IS THE BOUNCER'S LIVE BUDGET, main-thread memory: a worker's own bouncer is empty. The main thread reads it
//        at admission and hands it over, so the worker states the number the 429 enforces.
//
// FLIPS. Drop `household` from `mcpWorkerTakes`: § 2's reads answer without a worker header. Take `read: "letter"` too and § 1 goes red. Drop the
// handed budget (`wantsWorldWrites`/`worldWriteBudget` in server.mjs) and § 3's worker answer says the used count of an empty bouncer, not the main thread's.
//
//   node --test test/pos-1064-household-workers.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureTown } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";
import { mcpWorkerTakes, wantsWorldWrites, wantsEarshot } from "../src/read-workers.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";
import { indexStore, seedRegistry } from "./helpers/office-under-test.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const haveClone = existsSync(join(WORLD_CLONE, "WORLD", "walk-ledger.md"));
const call = (name, args) => [{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }];

test("§ 1 the household's reads go to a worker; acts, opening a letter, explain, unnamed reads and mixed batches stay home", () => {
  for (const read of ["doorstep", "stamps", "quests", "stances", "outcomes", "stakes", "waiting", "marks", "needs-you", "happened", "closer", "posts", "standing"])
    assert.equal(mcpWorkerTakes(call("household", { read, handle: "wright" })), true, `household read:${read}`);
  assert.equal(mcpWorkerTakes(call("household", { read_shape: "v2" })), true, "the glance");
  assert.equal(mcpWorkerTakes(call("household", {})), true, "the bare standing");
  assert.equal(mcpWorkerTakes(call("doorstep", {})), true, "the doorstep apex");
  assert.equal(mcpWorkerTakes(call("doorstep", { read: "bundle" })), true);
  // what is the writer's own
  assert.equal(mcpWorkerTakes(call("household", { read: "letter", id: "x" })), false, "opening a letter clears it for the caller: a write");
  assert.equal(mcpWorkerTakes(call("household", { do: "send", args: { to: "limen", body: "hi" } })), false, "an act");
  assert.equal(mcpWorkerTakes(call("household", { do: "mark-all-read" })), false);
  assert.equal(mcpWorkerTakes(call("household", { read: "doorstep", do: "send" })), false, "a read and an act together are not a read");
  assert.equal(mcpWorkerTakes(call("household", { explain: "send" })), false);
  assert.equal(mcpWorkerTakes(call("household", { read: "mail", view: "inbox" })), false, "a read this lane did not audit keeps its thread");
  assert.equal(mcpWorkerTakes(call("doorstep", { do: "send" })), false);
  assert.equal(mcpWorkerTakes(call("doorstep", { read: "other" })), false);
  assert.equal(mcpWorkerTakes([...call("household", { read: "doorstep" }), ...call("household", { read: "letter", id: "x" })]), false, "a batch goes only if every call does");
  assert.equal(mcpWorkerTakes([...call("household", { read: "doorstep" }), ...call("world", { do: "say", args: { text: "hi" } })]), false);
  // the enrichments the handover carries
  assert.equal(wantsWorldWrites(call("household", {})), true);
  assert.equal(wantsWorldWrites(call("household", { read: "standing" })), true);
  assert.equal(wantsWorldWrites(call("household", { read: "doorstep" })), false);
  assert.equal(wantsWorldWrites(call("household", { do: "send" })), false);
  assert.equal(wantsEarshot(call("doorstep", {}), "v0"), true, "the doorstep's world item is a v2 read: it carries heard");
  assert.equal(wantsEarshot(call("household", { read: "doorstep" }), "v0"), false);
});

let tmp, IX;
const KEY = "pos1064-wright-key", KEY2 = "pos1064-limen-key";
before(async () => {
  if (!haveClone) return;
  tmp = mkdtempSync(join(tmpdir(), "pos1064-"));
  IX = await indexStore(fixtureTown());
  // both keys' houses are declared in the store's registry, so the glance (which reads the house) answers a standing instead of the door's 422
  await seedRegistry(IX.store, { schema_version: 1, note: "invented for POS-1064", households: {
    keemin: { name: "Keemin", since: "2026-08-01", declared_by: "wright", accounts: [{ login: "keemin-gh", id: 8201 }], residents: ["wright"] },
    limenhouse: { name: "Limen House", since: "2026-08-01", declared_by: "limen", accounts: [{ login: "limen-gh", id: 8202 }], residents: ["limen"] },
  } }, { wright: { login: "keemin-gh", id: 8201 }, limen: { login: "limen-gh", id: 8202 } });
  const { openDynamic } = await import("../src/dynamic-store.mjs");
  openDynamic(join(tmp, "dynamic.db")).close();
  const { openOauthDb } = await import("../src/oauth.mjs");
  openOauthDb(join(tmp, "oauth.db")).close();
  seedStaticKeys(join(tmp, "oauth.db"), `${KEY}=keemin:wright;${KEY2}=limenhouse:limen`);
});
after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

async function office(workers, extraEnv = {}) {
  const { child: proc, port } = await bootOnFreePort((port) => spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"), "--port", String(port), "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, `roles-${workers}.db`),
  ], {
    env: { ...process.env, ...IX?.env, WORLD_GRAPH_NONE: "1", WORLD_APEX: "1", OFFICE_READ_WORKERS: String(workers), WORLD_DYNAMIC_DB: join(tmp, "dynamic.db"), TOWN_CLONE: join(ROOT, "town-clone"), ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  }), { budgetMs: 30_000 });
  const gone = new Promise((ok) => proc.on("exit", ok));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 300; i++) {
    const ready = (await (await fetch(`${base}/release`)).json()).read_workers?.ready ?? 0;
    if (ready === workers) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const post = async (key, name, args) => {
    const res = await fetch(`${base}/mcp`, { method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    const text = await res.text();
    let answer = null;
    try { answer = JSON.parse(JSON.parse(text).result?.content?.[0]?.text ?? "null"); } catch { /* a refusal or a transport error: the text says */ }
    return { status: res.status, reader: res.headers.get("x-pm-reader"), text, answer };
  };
  return { base, post, stop: async () => { proc.kill(); await gone; } };
}

const skip = () => !haveClone && `needs the world clone at ${WORLD_CLONE}`;

test("§ 2 a real office answers the household's reads on its worker, for the caller's own authority, and keeps the rest", { skip: skip() }, async () => {
  const o = await office(1);
  try {
    for (const [args, label] of [[{ read: "doorstep", handle: "wright" }, "doorstep"], [{ read: "stamps", handle: "wright" }, "stamps"], [{ read: "quests", handle: "wright" }, "quests"], [{ read_shape: "v2" }, "glance"], [{ read: "standing" }, "standing"], [{}, "bare"]]) {
      const r = await o.post(KEY, "household", args);
      assert.equal(r.status, 200, `${label}: ${r.text.slice(0, 300)}`);
      assert.equal(r.reader, "worker-0", `${label} was answered on the main thread`);
      assert.ok(r.answer && !r.answer.error, `${label}: ${r.text.slice(0, 300)}`);
    }
    const door = await o.post(KEY, "doorstep", {});
    assert.equal(door.reader, "worker-0", "the doorstep apex was answered on the main thread");
    assert.ok(door.answer && !door.answer.error, door.text.slice(0, 300));
    // the writer's own stay home
    const letter = await o.post(KEY, "household", { read: "letter", id: "no-such-letter" });
    assert.equal(letter.reader, null, "opening a letter was handed to a worker");
    const act = await o.post(KEY, "household", { do: "mark-all-read" });
    assert.equal(act.reader, null, "an act was handed to a worker");
    const mail = await o.post(KEY, "household", { read: "mail", view: "inbox", handle: "wright" });
    assert.equal(mail.reader, null, "an unaudited read was handed to a worker");
    // two households at once, each its own
    const [a, b] = await Promise.all([o.post(KEY, "household", { read: "doorstep", handle: "wright" }), o.post(KEY2, "household", { read: "doorstep", handle: "limen" })]);
    assert.notEqual(JSON.stringify(a.answer), JSON.stringify(b.answer), "two households read the same doorstep");
    assert.match(JSON.stringify(a.answer), /wright/);
    assert.match(JSON.stringify(b.answer), /limen/);
  } finally { await o.stop(); }
});

test("§ 2b the worker's answer is the main thread's (same office code, workers off)", { skip: skip() }, async () => {
  const w = await office(1);
  const m = await office(0);
  try {
    // AUTHORITY: what a key may see is decided by the same code on either thread. A stranger asking for wright's house gets, on the worker, exactly what the main thread gives it
    // (here the doorstep is the town's public view of wright: no unread count, no own-only blocks), and wright's own key gets more.
    const asStranger = { read: "doorstep", handle: "wright" };
    const own = (await w.post(KEY, "household", asStranger)).answer, strangerW = await w.post(KEY2, "household", asStranger), strangerM = await m.post(KEY2, "household", asStranger);
    assert.equal(strangerW.reader, "worker-0");
    assert.equal(strangerM.reader, null);
    const strip0 = (a) => JSON.stringify(a, (k, v) => (/^(as_of|asOf|generated|now|at_ms|ts)$/.test(k) ? undefined : v));
    assert.equal(strip0(strangerW.answer), strip0(strangerM.answer), "a stranger's doorstep read differs between the worker and the main thread");
    assert.notEqual(strip0(own), strip0(strangerW.answer), "the owner's read and a stranger's are the same bytes: the caller's authority did not reach the worker");
    for (const args of [{ read: "stamps", handle: "wright" }, { read: "quests", handle: "wright" }, { read: "needs-you" }]) {
      const [x, y] = [await w.post(KEY, "household", args), await m.post(KEY, "household", args)];
      assert.equal(x.reader, "worker-0");
      assert.equal(y.reader, null);
      const strip = (a) => JSON.stringify(a, (k, v) => (/^(as_of|asOf|generated|now|at_ms|ts)$/.test(k) ? undefined : v));
      assert.equal(strip(x.answer), strip(y.answer), `household ${JSON.stringify(args)}: the worker's answer differs from the main thread's`);
    }
  } finally { await w.stop(); await m.stop(); }
});

test("§ 3 the standing's world_writes is the main thread's live budget, handed over, not an empty worker bouncer's", { skip: skip() }, async () => {
  const o = await office(1);
  try {
    const before = (await o.post(KEY, "household", { read: "standing" })).answer?.world_writes;
    // a counted world act (walk) is charged at admission, on the main thread, whatever the act then answers
    const act = await o.post(KEY, "world", { do: "walk", args: { to: { x: 1, y: 1 } } });
    assert.equal(act.reader, null, "the act is the writer's");
    const mainSays = await (await fetch(`${o.base}/household?read=standing`, { headers: { authorization: `Bearer ${KEY}` } })).json();   // REST /household: main only
    const viaWorker = await o.post(KEY, "household", { read: "standing" });
    assert.equal(viaWorker.reader, "worker-0");
    assert.ok(mainSays.world_writes, "the main thread states a world_writes block");
    assert.deepEqual(viaWorker.answer.world_writes, mainSays.world_writes, `the worker said ${JSON.stringify(viaWorker.answer.world_writes)} (before the act: ${JSON.stringify(before)}), the bouncer says ${JSON.stringify(mainSays.world_writes)}`);
    const glance = await o.post(KEY, "household", { read_shape: "v2" });
    assert.equal(glance.reader, "worker-0");
    assert.ok(glance.answer && !glance.answer.error, `the glance did not answer: ${glance.text.slice(0, 300)}`);
    // the glance states the standing's budget as "used/cap this hour" under law.world_writes
    const w = mainSays.world_writes;
    assert.equal(glance.answer.law?.world_writes, `${w.used}/${w.cap} this ${w.per ?? "hour"}`, "the glance carries the main thread's number (absent is a failure, not a pass)");
  } finally { await o.stop(); }
});

// § 4 (POS-1064/b): the access line carries the doorstep and household doors' path-tagged timing, one line per request, written by the main thread, joined across the handover.
test("§ 4 the access line carries each doorstep/household read's timing: worker route with queue and worker leases, main route without, one line each, nothing else tagged", { skip: skip() }, async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const logs = mkdtempSync(join(tmpdir(), "pos1064-access-"));
  const o = await office(1, { OFFICE_ACCESS_LOG_DIR: logs });
  try {
    const mcpDoor = await o.post(KEY, "household", { read: "doorstep", handle: "wright" });   // MCP, handed to the worker
    const mcpMail = await o.post(KEY, "household", { read: "mail", view: "inbox", handle: "wright" });   // MCP, kept on the main thread
    const restDoor = await fetch(`${o.base}/doorstep/wright`);                                      // REST, handed to the worker
    const restHouse = await fetch(`${o.base}/household`, { headers: { authorization: `Bearer ${KEY}` } });   // REST, main only
    const plain = await fetch(`${o.base}/town`);                                                    // not a doorstep/household door
    for (const r of [mcpDoor, restDoor, restHouse, plain]) assert.ok((r.status ?? 0) >= 200);
    assert.equal(mcpDoor.reader, "worker-0"); assert.equal(mcpMail.reader, null);
    await new Promise((r) => setTimeout(r, 300));   // the line is written on finish
    const lines = readdirSync(logs).flatMap((f) => readFileSync(join(logs, f), "utf8").split("\n").filter(Boolean)).map((l) => JSON.parse(l));
    const timed = lines.filter((l) => l.timing);
    const by = (door, route) => timed.filter((l) => l.timing.door === door && l.timing.route === route);
    const mcpW = by("mcp", "worker"), mcpM = by("mcp", "main"), restW = by("doorstep", "worker"), restM = by("household", "main");
    assert.equal(mcpW.length, 1, JSON.stringify(timed.map((l) => l.timing)));
    assert.equal(mcpM.length, 1);
    assert.equal(restW.length, 1);
    assert.equal(restM.length, 1);
    assert.equal(lines.filter((l) => l.path === "/town").every((l) => !l.timing), true, "a door outside the family carries no timing");
    if (process.env.POS1064_PRINT_TIMING) for (const l of timed) console.log("TIMING", JSON.stringify({ path: l.path, status: l.status, ms: l.ms, timing: l.timing }));   // the operator's example line
    const w = mcpW[0].timing;
    assert.equal(w.worker, 0); assert.equal(w.tries, 1);
    assert.ok(w.queue_ms != null && w.queue_ms >= 0 && w.exec_ms != null && w.return_ms != null, "the handover's phases are all measured");
    assert.ok(w.leases.worker && w.leases.worker.n >= 1, "the worker's own pen leases are joined to the request");
    assert.ok(w.bundle && w.bundle.n >= 1, "the bundle ran on the worker");
    assert.equal(w.read, "doorstep");
    assert.equal(mcpM[0].timing.queue_ms, null); assert.equal(mcpM[0].timing.leases.worker, null);
    assert.equal(restM[0].timing.route, "main");
    assert.notEqual(w.rid, restW[0].timing.rid, "one id per request");
    // the line holds one request: no worker wrote a second
    assert.equal(lines.filter((l) => l.path === "/doorstep/wright").length, 1);
    for (const l of timed) assert.ok(Buffer.byteLength(JSON.stringify(l)) + 1 <= 4000, "within the access log's atomic bound");
  } finally { await o.stop(); rmSync(logs, { recursive: true, force: true }); }
});
