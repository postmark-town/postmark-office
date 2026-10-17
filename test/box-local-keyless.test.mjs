// box-local-keyless.test.mjs — the box asking itself through its own door is
// not charged the keyless bucket; every caller on the public port still is
// (Darko 2026-10-13, and the review of #516).
//
// The site refresh read the office through https://postmark.town/api, so its
// ~600 keyless GETs a pass came in through nginx and spent one bucket: 17,531
// of a day's 54,823 answered 429. It now reads the office's BOX DOOR, a second
// listener on 127.0.0.1 that no nginx location names (server.mjs § THE BOX
// DOOR). The first build exempted "loopback with no X-Forwarded-For" on the
// public port instead, and the reviewer got through it: nginx's root
// .well-known locations passed the raw URI with no XFF, and a backslash path
// nginx matches there the office's URL parse resolves to any door. So the
// exemption is the door now, and these are the callers, over real sockets:
//   - the box door: never 429, far past the burst, whatever its headers;
//   - the public port from loopback with no XFF (nginx's no-XFF locations):
//     charged — including the reviewer's raw backslash path, and any path;
//   - the public port from loopback with XFF: charged;
//   - the public port from this machine's LAN address: charged, and the box
//     door is not reachable from it at all.
// Burst 3 and a frozen bouncer clock: the fourth charged GET is a 429 by
// arithmetic, not by timing.
//   node --test test/box-local-keyless.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir, networkInterfaces } from "node:os";
import { fixtureTown } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { bootOnFreePort, freePort } from "./spawn-office.mjs";

const STORES = [];
const storeFor = async (town) => { const x = await indexStore(town); STORES.push(x); return x.env; };
test.after(async () => { for (const x of STORES) await x.stop(); });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BURST = 3;
let PORT, BOX, child, tmp, bootLine = "";
let plain, plainBoot = "";
let same, SAME, sameErr = "";

// `env` is an object, or a function of the port the office is given.
const boot = async (town, IX_ENV, env, onOut, onErr = () => {}) => bootOnFreePort((port) => {
  const c = spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"), "--port", String(port),
    "--bouncer-now-ms", String(Date.parse("2026-10-13T14:00:00Z")),
  ], {
    env: {
      ...process.env, WORLD_GRAPH_NONE: "1", ...IX_ENV,
      OFFICE_BOUNCER_KEYLESS_PER_MINUTE: String(BURST),
      OFFICE_BOUNCER_KEYLESS_BURST: String(BURST),
      TOWN_CLONE: join(tmp, "no-clone-here"),
      ...(typeof env === "function" ? env(port) : env),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  c.stdout.on("data", (d) => onOut(String(d)));
  c.stderr.on("data", (d) => onErr(String(d)));
  return c;
});

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-office-box-local-"));
  const town = fixtureTown();
  const IX_ENV = await storeFor(town);
  BOX = await freePort();
  ({ child, port: PORT } = await boot(town, IX_ENV, { OFFICE_BOX_PORT: String(BOX) }, (s) => { bootLine += s; }));
  // An office with no OFFICE_BOX_PORT on a port that is not 4380: no box door.
  ({ child: plain } = await boot(town, IX_ENV, { OFFICE_BOX_PORT: "" }, (s) => { plainBoot += s; }));
  // The operator's slip (the second review of #516): OFFICE_BOX_PORT names the
  // office's own --port. Its own bucket, its own office.
  ({ child: same, port: SAME } = await boot(town, IX_ENV, (port) => ({ OFFICE_BOX_PORT: String(port) }), () => {}, (s) => { sameErr += s; }));
});

after(async () => {
  for (const c of [child, plain, same]) if (c && c.exitCode === null) {
    const gone = new Promise((ok) => c.on("exit", ok));
    c.kill();
    await gone;
  }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const statuses = async (host, port, n, headers = {}, path = "/town") => {
  const out = [];
  for (let i = 0; i < n; i++) out.push((await fetch(`http://${host}:${port}${path}`, { headers })).status);
  return out;
};
// A request written byte for byte, as nginx forwards one: the raw target, no
// normalising client in between.
const raw = (port, target, host = "127.0.0.1") => new Promise((ok, no) => {
  const s = net.connect(port, host, () => s.write(`GET ${target} HTTP/1.1\r\nHost: postmark.town\r\nConnection: close\r\n\r\n`));
  let buf = "";
  s.on("data", (d) => { buf += d; });
  s.on("end", () => ok(Number(buf.slice(9, 12))));
  s.on("error", no);
});
const B = String.fromCharCode(92); // a backslash, which nginx does not treat as a separator

test("the box door: never charged, far past the burst, whatever its headers say", async () => {
  assert.match(bootLine, new RegExp(`box door 127\\.0\\.0\\.1:${BOX}`), "the boot line names the door");
  assert.deepEqual(await statuses("127.0.0.1", BOX, BURST * 4), Array(BURST * 4).fill(200));
  assert.deepEqual(await statuses("127.0.0.1", BOX, BURST * 2, { "x-forwarded-for": "203.0.113.70" }), Array(BURST * 2).fill(200),
    "the door decides, not a header");
});

// The tests below run in file order and share one bucket: every public-port
// request from loopback with no XFF is keyed on 127.0.0.1, and the frozen clock
// never refills it. The box door above spent none of it.

test("REVIEWER'S FALSIFIER: a backslash path through nginx's oauth location reaches a door and is charged", async () => {
  // The review of #516: nginx matches this target as /.well-known/oauth-…, and
  // the office's URL parse resolves it to /town. Sent raw over a loopback
  // socket with no XFF, exactly as nginx's root .well-known location sent it.
  // At the first build's head this answered 200 twelve times.
  const target = `/.well-known/oauth-x${B}..${B}..${B}town`;
  const got = [];
  for (let i = 0; i < BURST * 4; i++) got.push(await raw(PORT, target));
  assert.equal(got[0], 200, "the office answers /town for the backslash path (the route really is reached)");
  assert.deepEqual(got.slice(0, BURST + 1), [...Array(BURST).fill(200), 429], `got ${got.join(",")}`);
});

test("the public port from loopback with no X-Forwarded-For is a caller: the same spent bucket", async () => {
  // what nginx's no-XFF locations delivered, and what the first build exempted
  assert.deepEqual(await statuses("127.0.0.1", PORT, BURST), Array(BURST).fill(429));
});

test("a public-port request is never box-local, whatever its path", async () => {
  // With the 127.0.0.1 bucket spent, every path, raw or normalised, is still
  // answered 429, so none of them was waved through. (/release and the bare
  // index are not here: they answer before the keyless bucket for everyone.)
  for (let i = 0; i <= BURST; i++) await raw(PORT, "/town");
  for (const target of ["/town", "/bulletin", "/residents?cards=1", `/.well-known/oauth-x${B}..${B}..${B}bulletin`,
    `/.well-known/openid-configuration${B}..${B}..${B}town`, "/.well-known/oauth-x/../../town"]) {
    assert.equal(await raw(PORT, target), 429, `${JSON.stringify(target)} on the public port`);
  }
});

test("the public port from loopback WITH X-Forwarded-For is nginx carrying a caller: charged", async () => {
  assert.deepEqual(await statuses("127.0.0.1", PORT, BURST + 1, { "x-forwarded-for": "203.0.113.7" }), [...Array(BURST).fill(200), 429]);
});

// The machine's own non-internal IPv4: a real socket whose remote address is
// not loopback. A host with none cannot ask this question, and says so rather
// than reading as a pass.
const lan = Object.values(networkInterfaces()).flat()
  .find((i) => i && i.family === "IPv4" && !i.internal)?.address;

test("a non-loopback caller: charged on the public port, and the box door is not there at all", { skip: lan ? false : "this host has no non-loopback IPv4 to connect from" }, async () => {
  assert.deepEqual(await statuses(lan, PORT, BURST + 1), [...Array(BURST).fill(200), 429], `connected via ${lan}`);
  await assert.rejects(fetch(`http://${lan}:${BOX}/town`), "the box door listens on 127.0.0.1 only");
});

test("an office on a port other than 4380 opens no box door unless OFFICE_BOX_PORT names one", () => {
  assert.match(plainBoot, /listening on/);
  assert.doesNotMatch(plainBoot, /box door/, "the dev office (:4381) must never hold prod's 4390");
});

// ── the second review of #516 (its falsifiers, folded in) ───────────────────

test("REVIEWER'S FALSIFIER: OFFICE_BOX_PORT equal to --port never makes the public port box-local", async () => {
  assert.match(sameErr, new RegExp(`OFFICE_BOX_PORT ${SAME} is this office's own --port`), "the slip is refused by name at boot");
  const got = await statuses("127.0.0.1", SAME, BURST + 1);
  assert.deepEqual(got, [...Array(BURST).fill(200), 429], `public port with box port == public port: ${got}`);
});

test("REVIEWER'S FALSIFIER: the box door refuses IPv6 loopback and every LAN address", async () => {
  await assert.rejects(fetch(`http://[::1]:${BOX}/town`), "IPv6 loopback must not reach the box door");
  const lan6 = Object.values(networkInterfaces()).flat()
    .find((i) => i && i.family === "IPv6" && !i.internal && !i.address.startsWith("fe80"))?.address;
  if (lan6) await assert.rejects(fetch(`http://[${lan6}]:${BOX}/town`), `the box door refuses ${lan6}`);
  // the LAN IPv4 refusal is asserted in the non-loopback test above
});
