// sandbox.test.mjs — the local sandbox's two walls (POS-560): the start guard
// (tools/sandbox.mjs § sandboxProblems) and the fence every process it starts
// carries (tools/lib/sandbox-fence.mjs). Neither builds a sandbox: the guard is
// handed what the start would hand it, and the fence runs in child processes
// that try to leave the machine. Nothing here reaches a network.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { sandboxProblems, officeEnvFor, layout, cleanEnv, dirRefusal, namesTheSandbox, DB } from "../tools/sandbox.mjs";
import { LOOPBACK, mediaFile } from "../tools/lib/sandbox-fence.mjs";

const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FENCE = join(OFFICE, "tools", "lib", "sandbox-fence.mjs");
const pem = () => generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });

const DIR = mkdtempSync(join(tmpdir(), "sandbox-guard-"));
test.after(() => rmSync(DIR, { recursive: true, force: true }));
const L = layout(DIR);
const PORT = 15508;
const pg = (role, db = DB) => `postgres://${role}:local@127.0.0.1:${PORT}/${db}`;

/** What the start hands the guard on a good day. */
function good() {
  const seedEnv = {
    TOWN_CLONE: join(L.live, "town-clone"), WORLD_CLONE: join(L.live, "world-clone"), STAMP_KEY: join(L.live, "stamp-key.pem"),
    TOWN_PUSH: "0", WORLD2_PG: "1", WORLD2_PG_URL: pg("office_api"), WORLD2_STANCE_URL: pg("stance_reader"),
    POSTMARK_TOWN_REPO: "postmark-town/postmark", STAMP_LINES: "store",
  };
  const env = officeEnvFor(L, seedEnv, { officePort: 4390, ghPort: 4399 });
  const townKey = pem();
  return {
    env,
    roles: { WORLD2_INGEST_URL: pg("law_ingester"), WORLD2_CLEARING_URL: pg("clearing_job") },
    remotes: { town: [], world: [] },
    townPub: createPublicKey(townKey).export({ type: "spki", format: "pem" }).toString(),
    townKey,
    keyPem: pem(),
    dir: DIR,
    port: PORT,
  };
}

test("the guard: the start's own environment passes", () => {
  assert.deepEqual(sandboxProblems(good()), []);
});

test("the guard refuses anything that could reach prod or dev, each by name", () => {
  const cases = [
    ["a store on another host", (g) => { g.env.WORLD2_PG_URL = "postgres://office_api:x@192.0.2.1:5432/sandbox"; }, /WORLD2_PG_URL names 192\.0\.2\.1, not this machine/],
    ["PROD's store by name", (g) => { g.roles.WORLD2_CLEARING_URL = pg("clearing_job", "world2_dev"); }, /WORLD2_CLEARING_URL names world2_dev: PROD's store/],
    ["the rehearsal copy", (g) => { g.env.WORLD2_STANCE_URL = pg("stance_reader", "world2_rehearsal"); }, /world2_rehearsal: PROD's store or its rehearsal copy/],
    ["another tree's database", (g) => { g.env.WORLD2_PG_URL = pg("office_api", "t1234_1_office"); }, /names the database t1234_1_office, not the sandbox's/],
    ["another tree's Postgres", (g) => { g.env.WORLD2_PG_URL = `postgres://office_api:local@127.0.0.1:15501/${DB}`; }, /dials port 15501, not this tree's own Postgres \(15508\)/],
    ["the real GitHub", (g) => { g.env.GITHUB_API_URL = "https://api.github.com"; }, /GITHUB_API_URL names api\.github\.com/],
    ["the town's site", (g) => { g.env.PUBLIC_BASE = "https://postmark.town"; }, /PUBLIC_BASE names postmark\.town/],
    ["a push", (g) => { g.env.TOWN_PUSH = "1"; }, /TOWN_PUSH is 1, not 0/],
    ["no fence", (g) => { delete g.env.NODE_OPTIONS; }, /the fence .* is not loaded/],
    ["git off file://", (g) => { delete g.env.GIT_ALLOW_PROTOCOL; }, /git is not held to file:\/\//],
    ["a real R2 credential", (g) => { g.env.R2_SECRET_ACCESS_KEY = "real-looking-secret"; }, /R2_SECRET_ACCESS_KEY is not the sandbox's stand-in/],
    ["a box path", (g) => { g.env.STAMP_KEY = "/srv/postmark-office/stamp-key.pem"; }, /STAMP_KEY names a box path/],
    ["a clone outside the sandbox", (g) => { g.env.TOWN_CLONE = resolve(OFFICE, "..", "office-1", "town-clone"); }, /TOWN_CLONE names .*, outside the sandbox's folder/],
    ["a clone with a remote", (g) => { g.remotes.town = ["origin\thttps://github.com/postmark-town/postmark.git (fetch)"]; }, /the town clone has a remote/],
    ["prod's key", (g) => { g.keyPem = g.townKey; }, /the sandbox's stamp key is the town's \(prod's\) key/],
    // libpq's other two roads to a store: PG* and a keyword string
    ["PGHOST off this machine", (g) => { g.env.PGHOST = "192.0.2.1"; }, /PGHOST names 192\.0\.2\.1, not this machine/],
    ["PGDATABASE = PROD's store", (g) => { g.env.PGDATABASE = "world2_dev"; }, /PGDATABASE names world2_dev: PROD's store/],
    ["PGPORT on another tree", (g) => { g.env.PGPORT = "15501"; }, /PGPORT is 15501, not this tree's own Postgres/],
    ["a service file", (g) => { g.env.PGSERVICE = "prod"; }, /PGSERVICE is set/],
    ["a keyword string off this machine", (g) => { g.roles.WORLD2_INGEST_URL = "host=192.0.2.1 port=5432 dbname=sandbox user=law_ingester"; }, /WORLD2_INGEST_URL names 192\.0\.2\.1, not this machine/],
    ["a keyword string naming PROD's store", (g) => { g.env.WORLD2_PG_URL = "host=127.0.0.1 port=15508 dbname=world2_dev user=office_api"; }, /WORLD2_PG_URL names world2_dev: PROD's store/],
    ["a quoted keyword host", (g) => { g.env.WORLD2_STANCE_URL = "dbname=sandbox host='192.0.2.1'"; }, /WORLD2_STANCE_URL names 192\.0\.2\.1, not this machine/],
    ["no proof of the key", (g) => { g.townPub = null; }, /cannot be proved not prod's/],
  ];
  for (const [name, spoil, needle] of cases) {
    const g = good();
    spoil(g);
    const p = sandboxProblems(g);
    assert.ok(p.some((x) => needle.test(x)), `${name}: expected ${needle}, got ${JSON.stringify(p)}`);
  }
});

test("the guard passes a keyword string and PG* that stay on this tree's own Postgres", () => {
  const g = good();
  Object.assign(g.env, { PGHOST: "127.0.0.1", PGPORT: String(PORT), PGDATABASE: DB });
  g.roles.WORLD2_INGEST_URL = `host=127.0.0.1 port=${PORT} dbname=${DB} user=law_ingester`;
  assert.deepEqual(sandboxProblems(g), []);
});

test("--dir: only a postmark-sandbox-* folder directly under the temp dir (drop deletes it whole; reset cleans its clones)", () => {
  const temp = tmpdir();
  assert.equal(dirRefusal(join(temp, "postmark-sandbox-office-8"), { temp }), null);
  for (const [dir, needle] of [
    [OFFICE, /is not directly under the temp dir/],
    [resolve(OFFICE, ".."), /is not directly under the temp dir/],
    [temp, /is not directly under the temp dir/],
    [join(temp, "postmark-sandbox-office-8", "live"), /is not directly under the temp dir/],
    [join(temp, "office-store-abc"), /is not named postmark-sandbox-/],
    [join(temp, "postmark-sandbox-"), /is not named postmark-sandbox-/],
    [join(temp, "postmark-sandbox-x", ".."), /is not directly under the temp dir/],
  ]) assert.match(dirRefusal(dir, { temp }) ?? "accepted", needle, dir);
});

test("down kills only a process whose command line names the sandbox (a pid in run.json may be reused)", () => {
  const dir = "G:\\temp\\postmark-sandbox-office-8";
  assert.equal(namesTheSandbox('"E:\\nodejs\\node.exe" tools/sandbox.mjs up', dir), true);
  assert.equal(namesTheSandbox("node G:\\Postmark\\pool\\office-8\\tools\\sandbox.mjs up --port 4590", dir), true);
  assert.equal(namesTheSandbox("node src\\server.mjs --port 4590 --db G:\\temp\\postmark-sandbox-office-8\\live\\office.db", dir), true);
  assert.equal(namesTheSandbox("node G:/temp/postmark-sandbox-office-8/live/world-clone/spectator/server.mjs", dir), true);
  assert.equal(namesTheSandbox("node tools\\loam-api.mjs", dir), false);
  assert.equal(namesTheSandbox("node tools/sandbox.mjs status", dir), false);
  assert.equal(namesTheSandbox("node G:/temp/postmark-sandbox-office-80/live/x.mjs", dir), false);
  assert.equal(namesTheSandbox("", dir), false);
});

test("the children's base environment carries no store, key, bucket, token or remote", () => {
  const e = cleanEnv({ PATH: "x", PGHOST: "box", WORLD2_PG_URL: "postgres://x", R2_SECRET_ACCESS_KEY: "s", GH_TOKEN: "t", GITHUB_API_URL: "u",
    STAMP_KEY: "k", TOWN_CLONE: "c", NODE_OPTIONS: "--require x", OFFICE_KEYS: "a=b", SETTLEMENT_ESCALATE_CRED: "c", EMBEDDED_PG_DIR: "keep" });
  assert.deepEqual(Object.keys(e).sort(), ["EMBEDDED_PG_DIR", "PATH"]);
});

test("the fence: loopback is the only host, and a media key never climbs out of its folder", () => {
  for (const h of [undefined, "", "localhost", "127.0.0.1", "127.9.9.9", "::1", "[::1]", "::ffff:127.0.0.1"]) assert.equal(LOOPBACK(h), true, String(h));
  for (const h of ["postmark.town", "media.postmark.town", "api.github.com", "10.0.0.1", "0.0.0.0", "192.0.2.1", "127.0.0.1.nip.io"]) assert.equal(LOOPBACK(h), false, h);
  assert.equal(mediaFile(DIR, "/postmark-media/media/sb-lantern/abc.png"), join(DIR, "media", "sb-lantern", "abc.png"));
  assert.equal(mediaFile(DIR, "/postmark-media/../../etc/passwd"), null);
  assert.equal(mediaFile(DIR, "/postmark-media/media/%2e%2e/%2e%2e/%2e%2e/x"), null);
});

/** A child process under the fence, running `code`; answers its stdout lines. */
function fenced(code, extra = {}) {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    encoding: "utf8", timeout: 30_000,
    env: { ...cleanEnv(), SANDBOX_FENCE: "1", NODE_OPTIONS: `--import=${pathToFileURL(FENCE).href}`, ...extra },
  });
  assert.equal(r.error, undefined, String(r.error));
  return { out: r.stdout.trim().split("\n"), err: r.stderr, code: r.status };
}

test("the fence, in a child: fetch and raw sockets to any other host are refused before a byte leaves; loopback answers", () => {
  const r = fenced(`
    import net from "node:net";
    import { createServer } from "node:http";
    const tryFetch = async (u) => { try { await fetch(u); return "reached"; } catch (e) { return e.cause?.code ?? e.code ?? e.message; } };
    console.log("fetch-town " + await tryFetch("https://postmark.town/"));
    console.log("fetch-github " + await tryFetch("https://api.github.com/"));
    const sock = await new Promise((ok) => { const s = net.connect({ host: "192.0.2.1", port: 22 }); s.on("error", (e) => ok(e.code)); s.on("connect", () => ok("connected")); });
    console.log("socket-box " + sock);
    const srv = createServer((q, a) => a.end("here")); await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
    const t = await (await fetch("http://127.0.0.1:" + srv.address().port + "/")).text();
    console.log("fetch-loopback " + t); srv.close();
    const open = createServer(); await new Promise((ok) => open.listen(0, ok));
    console.log("listen-no-host " + open.address().address); open.close();
  `);
  assert.deepEqual(r.out, ["fetch-town SANDBOX_FENCE", "fetch-github SANDBOX_FENCE", "socket-box SANDBOX_FENCE", "fetch-loopback here", "listen-no-host 127.0.0.1"], r.err);
});

test("the fence, in a child: the media endpoint's R2 PUT lands in the sandbox's folder and nowhere else", () => {
  const media = mkdtempSync(join(tmpdir(), "sandbox-media-"));
  try {
    const r = fenced(`
      const put = await fetch("https://acct.r2.cloudflarestorage.com/postmark-media/media/sb-lantern/feed.png", { method: "PUT", body: Buffer.from("png-bytes"), headers: { "content-type": "image/png" } });
      console.log("put " + put.status);
      const get = await fetch("https://acct.r2.cloudflarestorage.com/postmark-media/media/sb-lantern/feed.png");
      console.log("get " + get.status + " " + await get.text());
    `, { SANDBOX_MEDIA_DIR: media });
    assert.deepEqual(r.out, ["put 200", "get 200 png-bytes"], r.err);
    assert.equal(readFileSync(join(media, "media", "sb-lantern", "feed.png"), "utf8"), "png-bytes");
    // without a media folder the PUT is refused, never sent
    const off = fenced(`try { await fetch("https://acct.r2.cloudflarestorage.com/b/k", { method: "PUT", body: "x" }); console.log("sent"); } catch (e) { console.log(e.code); }`);
    assert.deepEqual(off.out, ["SANDBOX_FENCE"], off.err);
  } finally { rmSync(media, { recursive: true, force: true }); }
});

test("the fence is inert without SANDBOX_FENCE=1 (only the sandbox sets it)", () => {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `import net from "node:net"; const before = net.Socket.prototype.connect; await import(${JSON.stringify(pathToFileURL(FENCE).href)}); console.log(net.Socket.prototype.connect === before ? "untouched" : "patched");`],
    { encoding: "utf8", env: cleanEnv() });
  assert.equal(r.stdout.trim(), "untouched", r.stderr);
  assert.ok(existsSync(FENCE));
});
