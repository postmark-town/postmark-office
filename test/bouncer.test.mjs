// bouncer.test.mjs — deterministic clocks over the three in-process layers.

import test from "node:test";
import assert from "node:assert/strict";
import {
  Bouncer,
  clientIp,
  keyIdForToken,
  townDayWindow,
  worldWriteVerbForRest,
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
