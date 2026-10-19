// home-act-crash.test.mjs — POS-709: an empty home update answers its resident, never the process.
//
// On 2026-10-19 a resident's home update carrying a picture and a nonce, and no
// prose, killed postmark-office six times. updateHomeAct split the picture off
// and called the paper door WITHOUT awaiting it; flag-on the door is async, so
// its 422 "nothing to write" became a rejection nobody held, and Node's default
// exit took the office down. These drive the real routes on a spawned office,
// and the process floor (src/rejection-guard.mjs) in a real child process.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/home-act-crash.test.mjs

import "./helpers/drain-pen.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

import { fixtureTown } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";
import { openOauthDb } from "../src/oauth.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs";
import { rejectionLine } from "../src/rejection-guard.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
delete process.env.TOWN_PUSH; // nothing here may leave the machine

const STORES = [];
test.after(async () => { for (const x of STORES) await x.stop(); });

function townClone() {
  const dir = mkdtempSync(join(tmpdir(), "pm-pos709-"));
  mkdirSync(join(dir, "WHITE_PAGES", "wright", "HOME"), { recursive: true });
  writeFileSync(join(dir, "WHITE_PAGES", "wright", "ADDRESS.md"), "---\nhandle: wright\ngithub: gh-wright\nsince: 2026-01-01\n---\n\n# wright\n");
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, "tools", "households.json"), JSON.stringify({ schema_version: 1, households: {} }, null, 2) + "\n");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q"); git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}

// A media-door URL, so the picture passes its own check and the call reaches the paper door.
const PICTURE = "https://media.postmark.town/media/wright/c218583a550b5487f700fbf374eb49d1505591c5c7d620dfbae208943af579d3.png";

test("POS-709 · an empty home update with a picture answers 422 on both skins, and the office answers the next request", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "pm-pos709-srv-"));
  const clone = townClone();
  let child;
  const stderr = [];
  try {
    const store = await indexStore(fixtureTown());
    STORES.push(store);
    const odbPath = join(tmp, "oauth.db");
    openOauthDb(odbPath).close();
    const KEY = "pos709key";
    let PORT;
    ({ child, port: PORT } = await bootOnFreePort((port) => {
      const c = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(port), "--oauth-db", seedStaticKeys(odbPath, `${KEY}=keemin:wright`)], {
        env: {
          ...process.env, WORLD_GRAPH_NONE: "1", ...store.env, TOWN_SINGLE_LOG: "1",
          TOWN_CLONE: clone, WORLD_CLONE: join(tmp, "no-world"), VOICES_LOG: join(tmp, "voices.jsonl"), TOWN_PUSH: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      c.stderr.on("data", (d) => stderr.push(String(d)));
      return c;
    }));
    const BASE = `http://127.0.0.1:${PORT}`;
    const auth = { authorization: `Bearer ${KEY}`, "content-type": "application/json" };
    const alive = async (why) => {
      const r = await fetch(`${BASE}/release`).catch((e) => ({ status: `refused (${e.cause?.code ?? e.message})` }));
      assert.equal(r.status, 200, `${why}: the office must answer the next request; stderr:\n${stderr.join("").slice(-1500)}`);
      assert.equal(child.exitCode, null, `${why}: the office process is still up`);
    };

    // The household apex, the listed way (the incident's skin).
    const apexRes = await fetch(`${BASE}/household`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ do: "home", handle: "wright", image: PICTURE, nonce: "pos709-a" }),
    });
    const apex = await apexRes.json();
    await new Promise((ok) => setTimeout(ok, 300)); // a stray rejection fires on the next ticks
    await alive("after the apex's empty home update");
    assert.deepEqual([apex.code, apex.defect], [422, "nothing to write"], `the resident gets the 422: ${JSON.stringify(apex).slice(0, 400)}`);

    // The flat tool, the same act. Its schema refuses a nonce, so its empty
    // update is prose that is only whitespace: any paper bounce took this path.
    const rpc = await (await fetch(`${BASE}/mcp`, {
      method: "POST", headers: { ...auth, accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "update_home", arguments: { handle: "wright", image: PICTURE, body: "  " } } }),
    })).json();
    const flat = JSON.parse(rpc.result.content[0].text);
    await new Promise((ok) => setTimeout(ok, 300));
    await alive("after the flat tool's empty home update");
    assert.deepEqual([flat.error, flat.refused, flat.defect], ["bounce", true, "empty body"], `the flat tool answers the bounce (MCP carries no HTTP code): ${JSON.stringify(flat).slice(0, 400)}`);

    assert.doesNotMatch(stderr.join(""), /\[unhandled-rejection\]/, "the route answered its own 422; nothing reached the process floor");
  } finally {
    if (child && child.exitCode === null) {
      const gone = new Promise((ok) => child.on("exit", ok));
      child.kill();
      await gone;
    }
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(clone, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("POS-709 · the process floor: a stray rejection is logged loudly and the process keeps running", () => {
  const guard = pathToFileURL(join(ROOT, "src", "rejection-guard.mjs")).href;
  const script = `
    import { installRejectionGuard } from ${JSON.stringify(guard)};
    installRejectionGuard();
    Promise.reject(Object.assign(new Error("nothing to write"), { code: 422, defect: "nothing to write" }));
    setTimeout(() => console.log("still serving"), 200);`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 20_000 });
  assert.equal(r.status, 0, `the process stays up and exits on its own: status ${r.status}\n${r.stderr}`);
  assert.match(r.stdout, /still serving/);
  assert.match(r.stderr, /\[unhandled-rejection\] #1 the office kept serving/);
  assert.match(r.stderr, /code=422 defect="nothing to write"/);
});

test("POS-709 · the floor's line names a non-Error reason too", () => {
  assert.match(rejectionLine("plain string", 3), /^\[unhandled-rejection\] #3 .*\nplain string$/s);
  assert.match(rejectionLine(undefined, 4), /#4 .*\nundefined$/s);
});

test("POS-709 · a picture with prose that lands carries the paper's receipt (it was spread as a Promise, so the answer had none)", async () => {
  const { updateHomeAct } = await import("../src/edit.mjs");
  const clone = townClone();
  const dir = mkdtempSync(join(tmpdir(), "pm-pos709-odb-"));
  const o = openOauthDb(join(dir, "oauth.db"));
  process.env.TOWN_SINGLE_LOG = "1";
  try {
    const kept = [];
    const keep = async (a) => { kept.push(a); return { picture: a.url, household: "keemin" }; };
    const key = { household: "keemin", handles: new Set(["wright"]), ghId: "42", ghLogin: "keeminlee" };
    const r = await updateHomeAct({ handle: "wright", image: PICTURE, title: "The Rail House", body: "a house on the rail" },
      key, fixtureTown(), clone, o, { keep });
    assert.ok(r.commit, `the pen commit rides the answer: ${JSON.stringify(r)}`);
    assert.ok(r.logged?.seq, "and the log row it wrote");
    assert.deepEqual(r.picture, { picture: PICTURE, household: "keemin" });
    assert.equal(kept.length, 1);
  } finally {
    delete process.env.TOWN_SINGLE_LOG;
    o.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    rmSync(clone, { recursive: true, force: true, maxRetries: 5 });
  }
});
