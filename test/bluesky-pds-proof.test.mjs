// bluesky-pds-proof.test.mjs — the non-publishing PDS proof's tool, against a FAKE PDS that orders its checks as the real one does (POS-904).
//
//   node --test test/bluesky-pds-proof.test.mjs
//
// This pins the TOOL (what it checks before it calls, what it calls, what it prints and never prints). It is not the proof: the proof is
// the credentialed run against the real PDS, whose three results the PR carries. The fake follows atproto's createRecord.ts and
// actor-store/repo/transactor.ts in order: parse swapCommit as a CID, validate the record key (the lexicon's key schema), THEN compare
// swapCommit with the repo's head and only after that write.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { CID_PATTERN, main, neverACommitCid, proveKeyOnPds, shown } from "../tools/bluesky-pds-proof.mjs";
import { tidFor } from "../src/bluesky-publisher.mjs";

const IDENT = "postmark.town";
const PASSWORD = "synthetic-app-pw-7f3a";
const TOKEN = "synthetic-access-jwt-91c2";
const DID = "did:plc:faketown";
const ENV = { BSKY_IDENTIFIER: IDENT, BSKY_APP_PASSWORD: PASSWORD };
const REAL_TID = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;     // independent of the code under test
const HEAD = "bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5kpqcsgz7soitae";
const KEYS = { legacy: "settlement-187", candidate: tidFor("settlement", 187, "2026-11-22T18:20:11Z") };

/** `honourSwap: false` models a PDS that would write whatever the swap says; `validateKeys: false` one with validation off. */
async function fakePds({ head = HEAD, honourSwap = true, validateKeys = true, echo = false, present = [] } = {}) {
  const records = new Map(present.map((k) => [k, { text: "there" }]));
  const calls = [];
  let writes = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const method = url.pathname.replace("/xrpc/", "");
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      calls.push({ method, body, auth: req.headers.authorization ?? null });
      const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
      if (method === "com.atproto.server.createSession") return send(200, { did: DID, accessJwt: TOKEN, refreshJwt: "r" });
      if (method === "com.atproto.sync.getLatestCommit") return send(200, { cid: head, rev: "3krev" });
      if (method === "com.atproto.repo.getRecord") {
        const k = url.searchParams.get("rkey");
        return records.has(k) ? send(200, { uri: `at://${DID}/app.bsky.feed.post/${k}`, cid: "c", value: records.get(k) }) : send(400, { error: "RecordNotFound", message: `Could not locate record: ${k}` });
      }
      if (method === "com.atproto.repo.createRecord") {
        const b = JSON.parse(body);
        if (echo) return send(400, { error: "InvalidRequest", message: `bad request, password=${PASSWORD} token=${TOKEN}` });
        if (b.swapCommit !== undefined && !/^b[a-z2-7]{58}$/.test(b.swapCommit)) return send(400, { error: "InvalidRequest", message: "invalid cid" });
        if (validateKeys && !REAL_TID.test(b.rkey)) return send(400, { error: "InvalidRequest", message: "Invalid record key for app.bsky.feed.post" });
        if (honourSwap && b.swapCommit !== undefined && b.swapCommit !== head) return send(400, { error: "InvalidSwap", message: `Commit was at ${head}` });
        writes += 1; records.set(b.rkey, b.record);
        return send(200, { uri: `at://${DID}/app.bsky.feed.post/${b.rkey}`, cid: "c" });
      }
      send(404, { error: "MethodNotImplemented" });
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { service: `http://127.0.0.1:${server.address().port}`, calls, records, writes: () => writes,
    creates: () => calls.filter((c) => c.method.endsWith("createRecord")), close: () => new Promise((ok) => server.close(ok)) };
}
const run = (pds, over = {}) => proveKeyOnPds({ keys: KEYS, env: ENV, service: pds.service, timeoutMs: 2000, now: () => new Date("2026-11-23T02:00:00Z"), ...over });

test("neverACommitCid is a valid CIDv1 shape, fixed, and not any head", () => {
  const c = neverACommitCid();
  assert.match(c, CID_PATTERN);
  assert.equal(c, neverACommitCid(), "the same every run");
  assert.notEqual(c, HEAD);
  assert.notEqual(neverACommitCid("other"), c);
});

test("AS THE REAL PDS ORDERS IT: the legacy key is refused by validation, the TID reaches InvalidSwap, both are absent, the head is the head; nothing is written", async () => {
  const pds = await fakePds();
  try {
    const { code, report } = await run(pds);
    assert.equal(code, 0, JSON.stringify(report));
    assert.deepEqual([report.steps.legacy_key.status, report.steps.legacy_key.error], [400, "InvalidRequest"]);
    assert.match(report.steps.legacy_key.message, /^Invalid record key/);
    assert.deepEqual([report.steps.candidate_key.status, report.steps.candidate_key.error], [400, "InvalidSwap"]);
    assert.deepEqual(report.read_back, { legacy_absent: true, candidate_absent: true, head_after: HEAD, head_unchanged: true });
    assert.equal(report.sent_createRecord, 2);
    assert.equal(pds.writes(), 0, "the fake's repo was never written");
    assert.deepEqual(report.steps.preflight, { head_read: true, swap_differs_from_head: true, both_keys_absent: true, would_create: false });
    // every create carried the nonmatching swapCommit, the account's own repo, and no `validate`
    for (const c of pds.creates()) {
      const b = JSON.parse(c.body);
      assert.equal(b.swapCommit, neverACommitCid());
      assert.notEqual(b.swapCommit, HEAD);
      assert.equal(b.repo, DID);
      assert.ok(!("validate" in b), "validation stays on");
    }
    assert.deepEqual(pds.creates().map((c) => JSON.parse(c.body).rkey), [KEYS.legacy, KEYS.candidate]);
    // nothing but the preflight reads happens before the first create
    const order = pds.calls.map((c) => c.method.split(".").pop());
    assert.equal(order.indexOf("createRecord"), order.findIndex((m, i) => m === "createRecord"));
    assert.ok(order.indexOf("getLatestCommit") < order.indexOf("createRecord") && order.indexOf("getRecord") < order.indexOf("createRecord"));
    // the credential, the token and the header are nowhere in the report
    const printed = JSON.stringify(report);
    for (const secret of [PASSWORD, TOKEN, "Bearer"]) assert.ok(!printed.includes(secret), `the report carries ${secret}`);
  } finally { await pds.close(); }
});

test("A SWAP THAT EQUALS THE HEAD would be an ordinary create: the run stops before any createRecord", async () => {
  const pds = await fakePds({ head: neverACommitCid() });
  try {
    const { code, report } = await run(pds);
    assert.equal(code, 3);
    assert.match(report.stopped, /differs from the head: a create could succeed, so none is sent/);
    assert.equal(pds.creates().length, 0);
    assert.equal(pds.writes(), 0);
  } finally { await pds.close(); }
});

test("A KEY THAT ALREADY HOLDS A RECORD is not a proof: stopped before any createRecord", async () => {
  for (const present of [[KEYS.candidate], [KEYS.legacy]]) {
    const pds = await fakePds({ present });
    try {
      const { code, report } = await run(pds);
      assert.equal(code, 3);
      assert.match(report.stopped, /did not read RecordNotFound \(a record is there\)/);
      assert.equal(pds.creates().length, 0);
    } finally { await pds.close(); }
  }
});

test("A PDS THAT DOES NOT BEHAVE AS EXPECTED is reported as such, never as a pass: validation off answers InvalidSwap for the legacy key", async () => {
  const pds = await fakePds({ validateKeys: false });
  try {
    const { code, report } = await run(pds);
    assert.equal(code, 1);
    assert.match(report.verdict, /^NOT AS EXPECTED/);
    assert.equal(report.steps.legacy_key.error, "InvalidSwap");
    assert.equal(pds.writes(), 0, "and the swap still wrote nothing");
  } finally { await pds.close(); }
});

test("IF A CREATE WOULD ANSWER 200 the run stops at once: the second call is not made, and the read-back names what stands", async () => {
  const pds = await fakePds({ honourSwap: false, validateKeys: false });
  try {
    const { code, report } = await run(pds);
    assert.equal(code, 1);
    assert.match(report.stopped, /UNEXPECTED: the legacy-key createRecord answered 200\. The second call is NOT made/);
    assert.equal(pds.creates().length, 1);
    assert.equal(report.read_back.legacy_absent, false);
  } finally { await pds.close(); }
});

test("A SERVER'S WORDS ARE PRINTED ONLY WHEN THEY HOLD NO SECRET: an echoed password or token is withheld", async () => {
  const pds = await fakePds({ echo: true });
  try {
    const { report } = await run(pds);
    const printed = JSON.stringify(report);
    for (const secret of [PASSWORD, TOKEN]) assert.ok(!printed.includes(secret));
    assert.equal(report.steps.legacy_key.message, "(withheld)");
  } finally { await pds.close(); }
  assert.deepEqual(shown({ error: "InvalidSwap", message: "Commit was at x" }, [PASSWORD]), { error: "InvalidSwap", message: "Commit was at x" });
  assert.equal(shown({ message: "y".repeat(500) }, []).message.length, 120);
});

test("NO CREDENTIAL, no session, an unreadable head: nothing is created, and the stop says why", async () => {
  const pds = await fakePds();
  try {
    let r = await run(pds, { env: { BSKY_IDENTIFIER: IDENT } });
    assert.equal(r.code, 3); assert.equal(pds.calls.length, 0, "nothing read or sent without both names");
    r = await run(pds, { keys: { legacy: KEYS.legacy, candidate: "not-a-tid" } });
    assert.match(r.report.stopped, /candidate key is not shaped like a TID/);
    r = await run(pds, { keys: { legacy: KEYS.candidate, candidate: KEYS.candidate } });
    assert.match(r.report.stopped, /already shaped like a TID/);
    assert.equal(pds.creates().length, 0);
  } finally { await pds.close(); }
});

test("THE CLI: usage is exit 2, a settlement with no world is usage, an event with no instant sends nothing", async () => {
  assert.equal(await main([], { env: ENV, out: () => {} }), 2);
  assert.equal(await main(["--settlement", "187"], { env: ENV, out: () => {} }), 2, "a settlement names its world");
  assert.equal(await main(["--settlement", "x", "--world", "/nonexistent"], { env: ENV, out: () => {} }), 2);
  const pds = await fakePds();
  try {
    assert.equal(await main(["--settlement", "187", "--world", "/nonexistent-world", "--service", pds.service], { env: ENV, out: () => {} }), 3, "no tag, no instant, no key");
    const lines = [];
    assert.equal(await main(["--crossing", "327", "--service", pds.service], { env: ENV, out: (l) => lines.push(l) }), 0, lines.join("\n"));
    const report = JSON.parse(lines.join("\n"));
    assert.deepEqual(report.keys, { legacy: "crossing-327", candidate: tidFor("crossing", 327, Date.UTC(2026, 5, 12) + 327 * 12 * 3600e3) });
    assert.equal(pds.writes(), 0);
  } finally { await pds.close(); }
});
