// bouncer.test.mjs — deterministic clocks over the three in-process layers.

import test from "node:test";
import assert from "node:assert/strict";
import {
  Bouncer,
  boxLocal,
  bulkCost,
  clientIp,
  keyIdForToken,
  townDayWindow,
  worldWriteVerbForRest,
  WORLD_WRITE_VERBS,
} from "../src/bouncer.mjs";

const quiet = () => {};

test("per-key token buckets exhaust with honest retry_after and independent read/write budgets", () => {
  let now = Date.parse("2026-07-29T16:00:00Z");
  const bouncer = new Bouncer({
    limits: { key: { readPerMinute: 2, writePerMinute: 1 } },
    now: () => now,
    log: quiet,
  });

  assert.equal(bouncer.checkKey({ keyId: "key-a", verb: "GET", write: false }), null);
  assert.equal(bouncer.checkKey({ keyId: "key-a", verb: "GET", write: false }), null);
  const readRate = bouncer.checkKey({ keyId: "key-a", verb: "GET", write: false });
  assert.deepEqual(Object.keys(readRate), ["error", "defect", "retry_after_s"]);
  assert.equal(readRate.error, "rate");
  assert.equal(readRate.retry_after_s, 30);

  // Exhausting reads did not touch the write bucket.
  assert.equal(bouncer.checkKey({ keyId: "key-a", verb: "POST", write: true }), null);
  const writeRate = bouncer.checkKey({ keyId: "key-a", verb: "POST", write: true });
  assert.equal(writeRate.error, "rate");
  assert.equal(writeRate.retry_after_s, 60);

  now += 30_000;
  assert.equal(bouncer.checkKey({ keyId: "key-a", verb: "GET", write: false }), null);
  assert.equal(bouncer.checkKey({ keyId: "key-b", verb: "GET", write: false }), null,
    "a second office key owns a separate bucket");
});

test("keyless GET backstop is per IP and permits the configured burst", () => {
  const bouncer = new Bouncer({
    limits: { keyless: { perMinute: 1, burst: 3 } },
    now: () => Date.parse("2026-07-29T16:00:00Z"),
    log: quiet,
  });

  for (let i = 0; i < 3; i++)
    assert.equal(bouncer.checkKeyless({ ip: "192.0.2.10", verb: "GET" }), null);
  const rate = bouncer.checkKeyless({ ip: "192.0.2.10", verb: "GET" });
  assert.equal(rate.error, "rate");
  assert.equal(rate.retry_after_s, 60);
  assert.match(rate.defect, /burst of 3/);
  assert.equal(bouncer.checkKeyless({ ip: "192.0.2.11", verb: "GET" }), null);
});

test("household cap counts only world writes and resets at the top of the hour (founder-ruled 2026-09-03: 200/hour, not /day)", () => {
  let now = Date.parse("2026-07-30T03:59:00Z"); // one minute before the hour turns
  const bouncer = new Bouncer({
    limits: { household: { worldWritesPerHour: 2 } },
    now: () => now,
    log: quiet,
  });

  for (const verb of ["send_letter", "GET", "stake_vote"])
    assert.equal(bouncer.checkHouseholdWorldWrite({ household: "keemin", verb }), null);

  assert.equal(bouncer.checkHouseholdWorldWrite({
    household: "keemin", verb: "world_leave_mark",
  }), null);
  assert.equal(bouncer.checkHouseholdWorldWrite({
    household: "keemin", verb: "world_walk",
  }), null);
  const rate = bouncer.checkHouseholdWorldWrite({
    household: "keemin", verb: "world_stake",
  });
  assert.equal(rate.error, "rate");
  assert.equal(rate.retry_after_s, 60);
  assert.match(rate.defect, /cap is 2/);
  assert.match(rate.defect, /count is 2/);
  assert.match(rate.defect, /2026-07-30T04:00:00\.000Z/);
  assert.match(rate.defect, /per hour/);

  assert.equal(bouncer.checkHouseholdWorldWrite({
    household: "another-house", verb: "world_unstake",
  }), null, "households have independent hourly counts");

  now = Date.parse("2026-07-30T04:00:00Z");
  assert.equal(bouncer.checkHouseholdWorldWrite({
    household: "keemin", verb: "world_note",
  }), null, "the new hour begins exactly at the top of the hour");
});

test("town-day reset calculation follows daylight-saving boundaries", () => {
  const spring = townDayWindow(
    Date.parse("2026-03-08T06:59:00Z"),
    "America/New_York"
  );
  assert.equal(spring.day, "2026-03-08");
  assert.equal(new Date(spring.resetAtMs).toISOString(), "2026-03-09T04:00:00.000Z");

  const fall = townDayWindow(
    Date.parse("2026-11-01T05:30:00Z"),
    "America/New_York"
  );
  assert.equal(fall.day, "2026-11-01");
  assert.equal(new Date(fall.resetAtMs).toISOString(), "2026-11-02T05:00:00.000Z");
});

test("throttle telemetry counts by layer and verb and emits one safe log line per event", () => {
  const lines = [];
  const bouncer = new Bouncer({
    limits: {
      key: { readPerMinute: 1 },
      keyless: { perMinute: 1, burst: 1 },
      household: { worldWritesPerHour: 1 },
    },
    now: () => Date.parse("2026-07-29T16:00:00Z"),
    log: (line) => lines.push(line),
  });

  bouncer.checkKey({ keyId: "sha256:safe-id", verb: "GET", write: false });
  bouncer.checkKey({ keyId: "sha256:safe-id", verb: "GET", write: false });
  bouncer.checkKeyless({ ip: "192.0.2.10", verb: "GET" });
  bouncer.checkKeyless({ ip: "192.0.2.10", verb: "GET" });
  bouncer.checkHouseholdWorldWrite({ household: "one house", verb: "world_walk" });
  bouncer.checkHouseholdWorldWrite({ household: "one house", verb: "world_walk" });

  assert.deepEqual(bouncer.telemetrySnapshot(), {
    key: { GET: 1 },
    keyless: { GET: 1 },
    household: { world_walk: 1 },
  });
  assert.deepEqual(lines, [
    "bouncer: 429 key GET sha256:safe-id",
    "bouncer: 429 keyless GET 192.0.2.10",
    "bouncer: 429 household world_walk one_house",
  ]);
});

test("credential IDs are stable hashes and REST world doors map to contract verbs", () => {
  const token = "do-not-log-this-office-secret";
  const id = keyIdForToken(token);
  assert.equal(id, keyIdForToken(token));
  assert.match(id, /^sha256:[a-f0-9]{16}$/);
  assert.ok(!id.includes(token));

  assert.equal(worldWriteVerbForRest("POST", "/world/marks"), "world_leave_mark");
  assert.equal(worldWriteVerbForRest("POST", "/world/stake"), "world_stake");
  assert.equal(worldWriteVerbForRest("POST", "/world/unstake"), "world_unstake");
  assert.equal(worldWriteVerbForRest("POST", "/world/walks"), "world_walk");
  assert.equal(worldWriteVerbForRest("GET", "/world/stake"), null);
  assert.equal(worldWriteVerbForRest("POST", "/letters"), null);
});

// ── POS-391 · the address every per-caller limit keys on ─────────────────────

test("the caller is the last X-Forwarded-For hop, else the socket", () => {
  const req = (xff, socket = "127.0.0.1") => ({ headers: xff == null ? {} : { "x-forwarded-for": xff }, socket: { remoteAddress: socket } });
  assert.equal(clientIp(req("198.51.100.7")), "198.51.100.7");
  assert.equal(clientIp(req("203.0.113.9, 198.51.100.7")), "198.51.100.7", "the first hop is the caller's own word; the last is nginx's");
  assert.equal(clientIp(req(null)), "127.0.0.1");
  assert.equal(clientIp({ headers: {} }), "unknown");
});

// ── the box asking itself (Darko 2026-10-13) ──────────────────────────────────

test("box-local is the box DOOR: a socket the box server accepted, from loopback, whatever its headers or port", () => {
  // The box server records each socket it accepts; nothing else is in the set.
  const boxSockets = new WeakSet();
  const accepted = (remoteAddress, localPort = 4390) => { const s = { remoteAddress, localPort }; boxSockets.add(s); return s; };
  const elsewhere = (remoteAddress, localPort = 4380) => ({ remoteAddress, localPort });
  const req = (socket, headers = {}, url = "/town") => ({ url, headers, socket });
  for (const lo of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(boxLocal(req(accepted(lo)), boxSockets), true, `${lo} through the box door is the box`);
    assert.equal(boxLocal(req(accepted(lo), { "x-forwarded-for": "198.51.100.7" }), boxSockets), true, "the door decides, not a header");
    // nginx's own connections arrive from loopback on the PUBLIC server, with
    // or without XFF and on any path: never the box (the first review of #516).
    assert.equal(boxLocal(req(elsewhere(lo)), boxSockets), false, `${lo} on the public server is a caller`);
    assert.equal(boxLocal(req(elsewhere(lo), {}, "/.well-known/oauth-x\\..\\..\\release"), boxSockets), false, "whatever its path");
    // THE SECOND REVIEW: a public socket whose port NUMBER equals the box's is
    // still not the box. The door is the server object, not the number.
    assert.equal(boxLocal(req(elsewhere(lo, 4390)), boxSockets), false, "a port number is not the door");
  }
  assert.equal(boxLocal(req(accepted("10.0.0.5")), boxSockets), false, "a non-loopback socket is a caller, even through the box door");
  assert.equal(boxLocal(req(accepted("127.0.0.1")), undefined), false, "no box door: nothing is the box");
  assert.equal(boxLocal({ headers: {} }, boxSockets), false, "no socket is never the box");
  assert.equal(boxLocal(req(elsewhere("203.0.113.9"), { "x-real-ip": "127.0.0.1", host: "127.0.0.1:4390" }), boxSockets), false);
});

test("a bulk read's cost: cards by the page's limit, doorsteps by the handles, a digest page by the letter pages it shapes", () => {
  const p = (q) => new URLSearchParams(q);
  assert.equal(bulkCost("/residents", p("cards=1&limit=200")), 200);
  assert.equal(bulkCost("/residents", p("limit=200")), 1, "the roll alone is one read");
  assert.equal(bulkCost("/residents", p("cards=1&limit=2.5")), 2, "a fractional limit is charged as the whole page it pages");
  assert.equal(bulkCost("/doorsteps", p("handles=a,b,c")), 3);
  assert.equal(bulkCost("/letters", p("digests=1&limit=5000")), 25);
  assert.equal(bulkCost("/letters", p("digests=1&limit=99999")), 25, "clamped where the door clamps");
  assert.equal(bulkCost("/letters", p("digests=1")), 1, "the default 50");
  assert.equal(bulkCost("/letters", p("full=1&limit=200")), 1, "a full page is one read, as it always was");
  assert.equal(bulkCost("/bulletin", p("full=1")), 1);
});

// Review of #678, item 2: a stance list writes one act a mark, and is charged so.
test("a stance is a world write, and a list of them is charged its length, whole or not at all", async () => {
  const { worldWriteCost } = await import("../src/bouncer.mjs");
  assert.ok(WORLD_WRITE_VERBS.has("world_declare_stance"));
  assert.equal(worldWriteCost("world_declare_stance", { do: "declare-stance-on", args: { on: ["a/x", "a/y", "a/z"], stance: "welcomed" } }), 3);
  assert.equal(worldWriteCost("world_declare_stance", { on: "a/x", stance: "neutral" }), 1);
  assert.equal(worldWriteCost("world_walk", { args: { on: ["a", "b"] } }), 1, "only the stance's list is counted by length");
  let t = Date.parse("2026-10-21T10:15:00Z");
  const b = new Bouncer({ now: () => t, limits: { household: { worldWritesPerHour: 5 } }, log: quiet });
  assert.equal(b.checkHouseholdWorldWrite({ household: "hh:x", verb: "world_declare_stance", cost: 3 }), null);
  const over = b.checkHouseholdWorldWrite({ household: "hh:x", verb: "world_declare_stance", cost: 3 });
  assert.ok(over, "3 more would pass 5: refused whole");
  assert.match(JSON.stringify(over), /this call writes 3/);
  assert.equal(b.checkHouseholdWorldWrite({ household: "hh:x", verb: "world_declare_stance", cost: 2 }), null, "2 more fit exactly");
  assert.ok(b.checkHouseholdWorldWrite({ household: "hh:x", verb: "world_declare_stance" }), "and the hour is spent");
});
