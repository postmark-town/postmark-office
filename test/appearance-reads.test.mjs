// appearance-reads.test.mjs — a real office: the describe door's write reaches
// the read workers by its announcement, and the resident's card carries the
// tree on both skins (WLD-83; the review of office#661, (a) and (d)).
//
// The office runs one read worker whose fold is told never to catch up by
// itself (APPEARANCE_CATCH_UP_MS), so a worker that answers with the new tree
// heard it from the main thread's announcement, and from nothing else.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/appearance-reads.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureTown } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "appearance-reads-key";
let IX = null, tmp = null, proc = null, base = null, skip = false;

before(async () => {
  IX = await indexStore(fixtureTown(), { db: "appearance_reads" });
  if (IX?.store?.skip) { skip = IX.store.skip; return; }
  tmp = mkdtempSync(join(tmpdir(), "appearance-reads-"));
  const { openDynamic } = await import("../src/dynamic-store.mjs");
  openDynamic(join(tmp, "dynamic.db")).close();
  const { openOauthDb } = await import("../src/oauth.mjs");
  openOauthDb(join(tmp, "oauth.db")).close();
  seedStaticKeys(join(tmp, "oauth.db"), `${KEY}=keemin:wright`);
  const booted = await bootOnFreePort((port) => spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"), "--port", String(port),
    "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db"),
  ], {
    env: { ...process.env, ...IX.env, WORLD_GRAPH_NONE: "1", OFFICE_READ_WORKERS: "1", APPEARANCE_CATCH_UP_MS: "600000",
      WORLD_DYNAMIC_DB: join(tmp, "dynamic.db"), TOWN_CLONE: join(ROOT, "town-clone"), TOWN_PUSH: "" },
    stdio: ["ignore", "pipe", "pipe"],
  }), { budgetMs: 30_000 });
  proc = booted.child;
  base = `http://127.0.0.1:${booted.port}`;
  let ready = 0;
  for (let i = 0; i < 300 && ready !== 1; i++) {
    ready = (await (await fetch(`${base}/release`)).json()).read_workers?.ready ?? 0;
    if (ready !== 1) await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(ready, 1, "the office's worker never came up");
});

after(async () => {
  if (proc && proc.exitCode === null) { const gone = new Promise((ok) => proc.on("exit", ok)); proc.kill(); await gone; }
  await IX?.stop?.();
  if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const card = async () => {
  const r = await fetch(`${base}/residents/wright`);
  const body = await r.json();
  return { reader: r.headers.get("x-pm-reader"), status: r.status, body };
};
const mcp = async (name, args) => {
  const r = await fetch(`${base}/mcp`, { method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const text = await r.text();
  const j = JSON.parse(text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data:")).slice(5));
  return JSON.parse(j.result.content[0].text);
};

test("(a) A DESCRIBE IS HEARD BY THE READ WORKER at once: its fold never catches up here, so the announcement is the only road", async (t) => {
  if (skip) return t.skip(skip);
  const warm = await card();
  assert.equal(warm.status, 200);
  assert.equal(warm.reader, "worker-0", "the card is a worker's read");
  assert.equal("appearance" in warm.body, false, "no tree before the describe — the test would prove nothing");
  const out = await mcp("world_describe", { slot: "appearance", value: "a hooded figure", body: "A hooded figure in a grey shawl." });
  assert.equal(out.described, "wright/appearance", JSON.stringify(out).slice(0, 300));
  const after = await card();
  assert.equal(after.reader, "worker-0");
  assert.equal(after.body.appearance?.body, "A hooded figure in a grey shawl.", "the worker answered without the describe the main thread just wrote");
});

test("(d) BOTH SKINS CARRY THE TREE: GET /residents/{handle} and read_resident, a detail included", async (t) => {
  if (skip) return t.skip(skip);
  await mcp("world_describe", { slot: "hood", value: "grey wool", body: "Pulled low." });
  const rest = (await card()).body;
  assert.deepEqual(rest.appearance.predicates.map((p) => [p.id, p.body]), [["wright/appearance.hood", "Pulled low."]]);
  const read = await mcp("read_resident", { handle: "wright" });
  assert.equal(read.appearance?.body, "A hooded figure in a grey shawl.");
  assert.deepEqual(read.appearance.predicates.map((p) => p.slot), ["hood"]);
});
