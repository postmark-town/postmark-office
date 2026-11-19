// bluesky-publisher.test.mjs — the town's day on Bluesky, against a FAKE XRPC server (POS-904 Part 1).
//
// No real credential and no network: a local http server plays the PDS
// (createSession, createRecord, getRecord), with synthetic auth and scripted
// faults. Each case reads what the fake holds afterwards, so "exactly one record"
// is counted, not assumed.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers/temp-dir.mjs";
import {
  BSKY_ENV, MAX_SENDS, XRPC_ERROR_NAMES, crossingEvent, knownName, lockEvent, plainLine, postRecord, publishEvent, readState, recordedEvents, rkeyFor,
  settlementChanges, settlementEvent,
} from "../src/bluesky-publisher.mjs";
import { crossingsFromTown, main, settlementsFromWorld } from "../tools/bluesky-publish.mjs";

// synthetic, and distinctive so a leak is findable in any byte written
const IDENT = "postmark.town";
const PASSWORD = "synthetic-app-pw-7f3a";
const TOKEN = "synthetic-access-jwt-91c2";
const DID = "did:plc:faketown";
const ENV = { BSKY_IDENTIFIER: IDENT, BSKY_APP_PASSWORD: PASSWORD };
const stripped = (s) => s.replace(/[^A-Za-z0-9]/g, "");

/**
 * A fake PDS. `faults` is a queue per method: "500", "400", "drop-after" (create, then cut the connection),
 * "drop-before", "notfound-500", and the echoes: "echo", "echo-500", "echo-stripped", "echo-stripped-500".
 */
async function fakePds({ password = PASSWORD } = {}) {
  const records = new Map();
  const calls = [];
  const faults = { createSession: [], createRecord: [], getRecord: [] };
  let creates = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const method = url.pathname.replace("/xrpc/", "");
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      calls.push({ method, auth: req.headers.authorization ?? null, body });
      const fault = faults[method.split(".").pop()]?.shift();
      const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
      if (fault === "drop-before") return req.socket.destroy();
      if (fault === "500") return send(500, { error: "InternalServerError", message: "the fake is down" });
      // A HOSTILE OR CARELESS PDS: it echoes whatever secret it was given, in its error name and its message,
      // as given or with its separators stripped (an app password abcd-efgh-ijkl-mnop comes back abcdefghijklmnop)
      if (fault?.startsWith("echo")) {
        const sent = (() => { try { return JSON.parse(body || "{}"); } catch { return {}; } })();
        const given = sent.password ?? ((req.headers.authorization ?? "").replace(/^Bearer /, "") || TOKEN);
        const secret = fault.includes("stripped") ? stripped(given) : given;
        return send(fault.endsWith("-500") ? 500 : method.endsWith("createSession") ? 401 : 400,
          { error: secret, message: `refused: identifier=${sent.identifier ?? IDENT} password=${secret} token=${TOKEN} authorization=Bearer ${TOKEN}` });
      }
      if (method === "com.atproto.server.createSession") {
        const b = JSON.parse(body);
        if (fault === "400" || b.identifier !== IDENT || b.password !== password) return send(401, { error: "AuthenticationRequired", message: "Invalid identifier or password" });
        return send(200, { did: DID, handle: IDENT, accessJwt: TOKEN, refreshJwt: "synthetic-refresh" });
      }
      if (method === "com.atproto.repo.createRecord") {
        if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: "AuthenticationRequired" });
        if (fault === "400") return send(400, { error: "InvalidRequest", message: "the fake refuses" });
        const b = JSON.parse(body);
        b.rkey ??= `tid${Date.now()}${creates}`;          // as a PDS does: no key asked for, one is made up
        if (records.has(b.rkey)) return send(400, { error: "InvalidRequest", message: "Record already exists" });
        creates += 1;
        records.set(b.rkey, b.record);
        if (fault === "drop-after") return req.socket.destroy();
        return send(200, { uri: `at://${DID}/${b.collection}/${b.rkey}`, cid: `cid-${b.rkey}` });
      }
      if (method === "com.atproto.repo.getRecord") {
        if (fault === "notfound-500") return send(502, { error: "UpstreamFailure" });
        const rkey = url.searchParams.get("rkey");
        if (!records.has(rkey)) return send(400, { error: "RecordNotFound", message: `Could not locate record: ${rkey}` });
        return send(200, { uri: `at://${DID}/app.bsky.feed.post/${rkey}`, cid: `cid-${rkey}`, value: records.get(rkey) });
      }
      send(404, { error: "MethodNotImplemented" });
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { service: `http://127.0.0.1:${server.address().port}`, records, calls, faults, creates: () => creates, close: () => new Promise((ok) => server.close(ok)) };
}

const EVENT = { kind: "crossing", n: 320, text: "Crossing 320 · Ferry's Daily: A porch hello", link: "https://postmark.town/daily/" };
const run = (pds, dir, over = {}) => publishEvent(over.event ?? EVENT, { stateDir: dir, env: ENV, service: pds.service, timeoutMs: 2000, ...over });
const methods = (pds) => pds.calls.map((c) => c.method.split(".").pop());
const filesIn = (dir) => (existsSync(dir) ? readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("\n") : "");
const assertNoSecret = (text, where, secrets = [PASSWORD, TOKEN]) => {
  for (const s of [...secrets, ...secrets.map(stripped), "Bearer"]) assert.ok(!String(text).includes(s), `${where} carries ${s === "Bearer" ? "an auth header" : `a secret (${s})`}`);
};

// ── the post ─────────────────────────────────────────────────────────────────

test("the rkey is the event: crossing-<n> and settlement-<n>, and nothing else", () => {
  assert.equal(rkeyFor("crossing", 320), "crossing-320");
  assert.equal(rkeyFor("settlement", 175), "settlement-175");
  assert.throws(() => rkeyFor("letter", 1));
  assert.throws(() => rkeyFor("crossing", 3.5));
  assert.deepEqual(BSKY_ENV, ["BSKY_IDENTIFIER", "BSKY_APP_PASSWORD"]);
});

test("the post is an app.bsky.feed.post whose link facet sits on the link's exact UTF-8 bytes, and it fits 300 graphemes", () => {
  const r = postRecord({ text: "Settlement S175 is blessed. New marks published: 10 · household records added: 1.", link: "https://postmark.town/replay/#S175", createdAt: "2026-11-19T04:30:00.000Z" });
  assert.equal(r.$type, "app.bsky.feed.post");
  const buf = Buffer.from(r.text, "utf8");
  const { byteStart, byteEnd } = r.facets[0].index;
  assert.equal(buf.subarray(byteStart, byteEnd).toString("utf8"), "https://postmark.town/replay/#S175", "the facet covers the link and only the link");
  assert.equal(r.facets[0].features[0].uri, "https://postmark.town/replay/#S175");
  const long = postRecord({ text: "é".repeat(400), link: "https://postmark.town/daily/", createdAt: "x" });
  assert.ok([...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(long.text)].length <= 300);
  assert.ok(long.text.endsWith("…\nhttps://postmark.town/daily/"), "cut before the link, never the link");
});

test("payload safety: markdown, links and tags leave a headline as plain words", () => {
  assert.equal(plainLine("**A** [porch](../WHITE_PAGES/x.md) <b>hello</b>  `now`"), "A porch hello now");
});

// ── the two events ───────────────────────────────────────────────────────────

const DAILY = (n, head = "## A porch hello") => `# The office — Ferry's Daily\n\n*Crossing **${n}** · **November 19, 2026 UTC***\n\n**271 letters landed.**\n\n${head}\n\nbody\n`;

test("a crossing posts its Daily's lead headline, judges no age, and has no post without a headline", () => {
  assert.deepEqual(crossingEvent({ markdown: DAILY(320), headline: "A porch hello" }).event,
    { kind: "crossing", n: 320, text: "Crossing 320 · Ferry's Daily: A porch hello", link: "https://postmark.town/daily/" });
  assert.equal(crossingEvent({ markdown: DAILY(317), headline: "x" }).event.n, 317, "an older crossing is still its own event: which are owed is the caller's");
  assert.deepEqual(crossingEvent({ markdown: DAILY(320), headline: null }), { n: 320, skip: "the Daily for crossing 320 has no lead headline yet" });
  assert.match(crossingEvent({ markdown: "no crossing line", headline: "x" }).skip, /names no crossing/);
});

test("a blessed settlement's counts are the literal records added between its tag and the previous one, never a taxonomy, never a guessed zero", () => {
  const before = { published: { "a/x": {}, "b/y": {} }, households: { a: {} } };
  const after = { published: { "a/x": {}, "c/z": {}, "d/w": {} }, households: { a: {}, c: {} } };
  assert.deepEqual(settlementChanges({ before, after }), { marks: 2, households: 1 }, "b/y's retirement is not counted (Part 1 has no retirements)");
  assert.deepEqual(settlementEvent({ n: 175, changes: { marks: 10, households: 1 } }).event,
    { kind: "settlement", n: 175, text: "Settlement S175 is blessed. New marks published: 10 · household records added: 1.", link: "https://postmark.town/replay/#S175" });
  assert.doesNotMatch(settlementEvent({ n: 1, changes: { marks: 0, households: 3 } }).event.text, /joined/i, "a record added is never 'joined'");
  assert.match(settlementEvent({ n: 9, changes: settlementChanges({ before: { published: null }, after }) }).held, /never a guessed count/, "unreadable: held, still owed");
  assert.match(settlementEvent({ n: 9, changes: settlementChanges({ before: { published: {}, households: null }, after }) }).held, /never a guessed count/);
});

// ── the publisher ────────────────────────────────────────────────────────────

test("NORMAL: one session, one createRecord at crossing-320, posted; the next run answers from state with no network", async () => {
  const pds = await fakePds(); const dir = tempDir("bsky-ok-");
  try {
    const r = await run(pds, dir);
    assert.deepEqual([r.outcome, r.rkey, r.sends], ["posted", "crossing-320", 1]);
    assert.equal(r.uri, `at://${DID}/app.bsky.feed.post/crossing-320`);
    assert.deepEqual(methods(pds), ["createSession", "createRecord"]);
    assert.equal(pds.calls[1].auth, `Bearer ${TOKEN}`, "the token goes in the header, to the PDS only");
    assert.equal(pds.records.get("crossing-320").text, "Crossing 320 · Ferry's Daily: A porch hello\nhttps://postmark.town/daily/");
    const again = await run(pds, dir);
    assert.equal(again.outcome, "already");
    assert.equal(pds.calls.length, 2, "no network for an event already posted");
    assertNoSecret(filesIn(dir), "the state"); assertNoSecret(JSON.stringify([r, again]), "the receipts");
  } finally { await pds.close(); }
});

test("FAILURE THEN SUCCESS: a 500 on the first send is asked about (absent), then the one retry posts: two sends, one record", async () => {
  const pds = await fakePds(); const dir = tempDir("bsky-retry-");
  try {
    pds.faults.createRecord.push("500");
    const r = await run(pds, dir);
    assert.deepEqual([r.outcome, r.sends], ["posted", 2]);
    assert.deepEqual(methods(pds), ["createSession", "createRecord", "getRecord", "createRecord"]);
    assert.equal(pds.records.size, 1);
  } finally { await pds.close(); }
});

test("LOST RESPONSE AFTER AN ACCEPTED CREATE: the record is made, the answer never comes; getRecord finds it, and nothing is created twice", async () => {
  const pds = await fakePds(); const dir = tempDir("bsky-lost-");
  try {
    pds.faults.createRecord.push("drop-after");
    const r = await run(pds, dir);
    assert.deepEqual([r.outcome, r.sends], ["reconciled", 1]);
    assert.equal(pds.creates(), 1, "exactly one record was ever created");
    assert.deepEqual(methods(pds), ["createSession", "createRecord", "getRecord"]);
    assert.equal(readState(dir, "crossing-320").status, "posted");
    assert.equal((await run(pds, dir)).outcome, "already");
    assert.equal(pds.creates(), 1);
  } finally { await pds.close(); }
});

test("PERMANENT FAILURE: refused twice, the key confirmed empty each time: failed, logged, and never sent again", async () => {
  const pds = await fakePds(); const dir = tempDir("bsky-perm-");
  try {
    pds.faults.createRecord.push("400", "400");
    const r = await run(pds, dir);
    assert.deepEqual([r.outcome, r.sends], ["failed", MAX_SENDS]);
    assert.equal(pds.records.size, 0);
    const before = pds.calls.length;
    const again = await run(pds, dir);
    assert.equal(again.outcome, "failed");
    assert.equal(pds.calls.length, before, "a failed event is never sent a third time");
    const st = readState(dir, "crossing-320");
    assert.deepEqual(st.attempts.filter((a) => a.step === "createRecord" && a.outcome !== "sending").map((a) => a.outcome), ["refused", "refused"]);
  } finally { await pds.close(); }
});

test("RESTART MID-SEND: a state left 'sending' is reconciled first; a record there is delivered, and none is created", async () => {
  const pds = await fakePds(); const dir = tempDir("bsky-restart-");
  try {
    // the earlier process sent, the PDS took it, and the process died before writing the answer
    pds.records.set("crossing-320", { text: "x" });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "crossing-320.json"), JSON.stringify({ v: 1, event: { kind: "crossing", n: 320 }, rkey: "crossing-320", status: "sending", sends: 1, attempts: [], payload: { text: EVENT.text, link: EVENT.link, created_at: "2026-11-19T00:50:00.000Z" } }));
    const r = await run(pds, dir);
    assert.deepEqual([r.outcome, r.sends], ["reconciled", 1]);
    assert.ok(!methods(pds).includes("createRecord"), "nothing created over an event already delivered");
    assert.match(readState(dir, "crossing-320").attempts.at(-1).detail ?? "", /kept, never overwritten/, "a record with other words is kept, and the state says so");
  } finally { await pds.close(); }
});

test("RESTART MID-SEND, the key empty: the one remaining send is made, with the words first composed", async () => {
  const pds = await fakePds(); const dir = tempDir("bsky-restart2-");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "crossing-320.json"), JSON.stringify({ v: 1, event: { kind: "crossing", n: 320 }, rkey: "crossing-320", status: "sending", sends: 1, attempts: [], payload: { text: "Crossing 320 · Ferry's Daily: the first headline", link: EVENT.link, created_at: "2026-11-19T00:50:00.000Z" } }));
    const r = await run(pds, dir, { event: { ...EVENT, text: "Crossing 320 · Ferry's Daily: a re-tended headline" } });
    assert.deepEqual([r.outcome, r.sends], ["posted", 2]);
    assert.match(pds.records.get("crossing-320").text, /the first headline/, "a retry sends the payload bound on first sight");
  } finally { await pds.close(); }
});

test("AN UNREADABLE STATE FILE is held: nothing sent, so a lost history never becomes a fresh event with two new sends", async () => {
  const pds = await fakePds(); const dir = tempDir("bsky-torn-");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "crossing-320.json"), "{ not json");
    const r = await run(pds, dir);
    assert.equal(r.outcome, "held");
    assert.equal(pds.calls.length, 0);
  } finally { await pds.close(); }
});

test("AN UNANSWERABLE getRecord: an ambiguous send whose fate cannot be told sends nothing more; the next run asks again and reconciles", async () => {
  const pds = await fakePds(); const dir = tempDir("bsky-unknown-");
  try {
    pds.faults.createRecord.push("drop-after");
    pds.faults.getRecord.push("notfound-500");
    const r = await run(pds, dir);
    assert.deepEqual([r.outcome, r.sends], ["waiting", 1]);
    assert.equal(pds.creates(), 1);
    const next = await run(pds, dir);
    assert.deepEqual([next.outcome, next.sends], ["reconciled", 1]);
    assert.equal(pds.creates(), 1, "still exactly one record");
  } finally { await pds.close(); }
});

test("DUPLICATE AND CONCURRENT HOOKS: two runs at once for one event make one record; the other is busy or finds it posted", async () => {
  const pds = await fakePds(); const dir = tempDir("bsky-concurrent-");
  try {
    const rs = await Promise.all([run(pds, dir), run(pds, dir), run(pds, dir)]);
    assert.equal(pds.creates(), 1);
    assert.equal(rs.filter((r) => r.outcome === "posted").length, 1, JSON.stringify(rs));
    assert.ok(rs.every((r) => ["posted", "busy", "already"].includes(r.outcome)), JSON.stringify(rs));
  } finally { await pds.close(); }
});

// ── the lock ─────────────────────────────────────────────────────────────────

const locksIn = (dir) => readdirSync(dir).filter((f) => /\.(lock|free)\.\d+$/.test(f)).sort();

test("a lock whose holder is gone is taken over by the next number; a live holder's is not; release frees it", () => {
  const dir = tempDir("bsky-lock-");
  writeFileSync(join(dir, "crossing-1.lock.1"), "999999999");
  const taken = lockEvent(dir, "crossing-1");
  assert.ok(taken, "a dead pid's lock is stale");
  assert.deepEqual(locksIn(dir), ["crossing-1.lock.2"], "taken by the next number; the stale one cleared beneath it");
  assert.equal(lockEvent(dir, "crossing-1"), null, "this live process holds it now");
  taken.release();
  assert.deepEqual(locksIn(dir), ["crossing-1.free.2"]);
  const next = lockEvent(dir, "crossing-1");
  assert.deepEqual(locksIn(dir), ["crossing-1.lock.3"], "a freed lock is taken by the next number, never reused");
  next.release();
  writeFileSync(join(dir, "crossing-12.lock.9"), String(process.pid));
  const again = lockEvent(dir, "crossing-1");
  assert.ok(again, "crossing-12's live lock is not crossing-1's");
  assert.deepEqual(locksIn(dir), ["crossing-1.lock.4", "crossing-12.lock.9"]);
  again.release();
});

test("A STALE OBSERVER NEVER DISPLACES A FRESH HOLDER, EVEN FOR A MOMENT: B sees the dead holder, A takes the lock, B carries on: B leaves, A's lock is never touched, and no third contender gets in", async () => {
  const dir = tempDir("bsky-lock-race-");
  writeFileSync(join(dir, "crossing-1.lock.1"), "999999999");
  let a = null; let aFiles = null; let watcher = null;
  const touched = [];
  const b = lockEvent(dir, "crossing-1", { pid: 999999998, pause: (point) => {
    if (point !== "takeover" || a) return;
    // B has read the dead holder and is about to act on that observation; A arrives now and takes it
    a = lockEvent(dir, "crossing-1");
    aFiles = Object.fromEntries(locksIn(dir).map((f) => [f, readFileSync(join(dir, f), "utf8")]));
    // from here every move or removal in the directory is seen, however brief (a rename away and back included)
    watcher = watch(dir, (ev, f) => touched.push(`${ev} ${f}`));
  } });
  await new Promise((ok) => setTimeout(ok, 200));
  watcher.close();
  assert.ok(a, "A took the stale lock");
  assert.equal(b, null, "B's stale observation cannot take a lock a live process now holds");
  assert.deepEqual(touched.filter((t) => Object.keys(aFiles).some((f) => t.endsWith(` ${f}`))), [], "A's lock was never moved or removed, even for a moment");
  assert.deepEqual(Object.fromEntries(locksIn(dir).map((f) => [f, readFileSync(join(dir, f), "utf8")])), aFiles);
  assert.equal(lockEvent(dir, "crossing-1"), null, "a third contender finds A holding it");
  a.release();
});

// A real process holds the lock and is killed (so its pid is dead), then two
// real processes contend for the stale lock with refusing sends. Each is held at
// the publisher's own seam ("takeover": it has read the dead holder and is about
// to act; "locked": it holds the lock) to force the review's interleaving: both
// read the dead holder, A takes the lock, then B acts on its stale observation.
const SRC = new URL("../src/bluesky-publisher.mjs", import.meta.url).href;
const DEAD_HOLDER = `
const [src, dir, sync] = process.argv.slice(1);
const { lockEvent } = await import(src);
const { writeFileSync } = await import("node:fs");
lockEvent(dir, "crossing-320");
writeFileSync(sync + "/D.locked", "");
setInterval(() => {}, 1000);
`;
const CONTENDER = `
const [src, dir, service, sync, name] = process.argv.slice(1);
const { publishEvent } = await import(src);
const { existsSync, writeFileSync } = await import("node:fs");
const nap = new Int32Array(new SharedArrayBuffer(4));
const hold = (point) => {
  writeFileSync(sync + "/" + name + "." + point, "");
  while (!existsSync(sync + "/" + name + "." + point + ".go")) Atomics.wait(nap, 0, 0, 5);
};
const r = await publishEvent({ kind: "crossing", n: 320, text: "Crossing 320 · Ferry's Daily: A porch hello", link: "https://postmark.town/daily/" },
  { stateDir: dir, env: process.env, service, timeoutMs: 5000, pause: hold });
process.stdout.write(JSON.stringify(r));
`;
const node = (code, args) => {
  const child = spawn(process.execPath, ["--input-type=module", "-e", code, ...args], { env: { ...process.env, ...ENV }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; let err = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });
  const done = new Promise((ok) => child.on("exit", (code) => ok({ code, out, err })));
  return { child, done, exited: () => child.exitCode !== null || child.signalCode !== null };
};
const until = async (cond, what) => {
  for (let i = 0; i < 2000; i++) { if (cond()) return; await new Promise((ok) => setTimeout(ok, 10)); }
  throw new Error(`timed out waiting for ${what}`);
};

test("STALE TAKEOVER ACROSS PROCESSES, with refusing sends: one holder, and the PDS's count of createRecord requests is the journal's count, never past two", async () => {
  const pds = await fakePds(); const dir = tempDir("bsky-xproc-"); const sync = tempDir("bsky-xproc-sync-");
  try {
    pds.faults.createRecord.push("400", "400", "400", "400");           // every send this case makes is refused
    const d = node(DEAD_HOLDER, [SRC, dir, sync]);
    await until(() => existsSync(join(sync, "D.locked")), "the first holder");
    d.child.kill("SIGKILL"); await d.done;                                // its lock stays, naming a dead pid
    const go = (f) => writeFileSync(join(sync, `${f}.go`), "");
    const A = node(CONTENDER, [SRC, dir, pds.service, sync, "A"]);
    const B = node(CONTENDER, [SRC, dir, pds.service, sync, "B"]);
    await until(() => existsSync(join(sync, "A.takeover")) && existsSync(join(sync, "B.takeover")), "both to read the dead holder");
    go("A.takeover");
    await until(() => existsSync(join(sync, "A.locked")), "A to hold the lock");
    go("B.takeover");                                                    // B acts on its stale observation now
    await until(() => B.exited() || existsSync(join(sync, "B.locked")), "B to leave or take the lock");
    const bHeld = existsSync(join(sync, "B.locked"));
    go("A.locked"); go("B.locked"); go("B.takeover");                     // let whoever holds go, together
    const [a, b] = await Promise.all([A.done, B.done]);
    const ra = JSON.parse(a.out || "{}"); const rb = JSON.parse(b.out || "{}");
    const sent = methods(pds).filter((m) => m === "createRecord").length;
    const st = readState(dir, "crossing-320");
    const journal = st.attempts.filter((x) => x.step === "createRecord" && x.outcome === "sending").length;
    assert.equal(sent, st.sends, `the PDS saw ${sent} createRecord requests; the journal says ${st.sends}`);
    assert.equal(journal, sent, "every send the PDS saw is one 'sending' line in the journal");
    assert.ok(sent <= MAX_SENDS, `never past ${MAX_SENDS} sends (saw ${sent})`);
    assert.equal(bHeld, false, "B never held the lock while A did");
    assert.equal(rb.outcome, "busy", JSON.stringify(rb) + b.err);
    assert.deepEqual([ra.outcome, ra.sends], ["failed", MAX_SENDS], JSON.stringify(ra) + a.err);
  } finally { await pds.close(); }
});

// ── a refusal's words ────────────────────────────────────────────────────────

test("NO SESSION: a refused login spends no send, is recorded once however often it repeats, and nothing is created", async () => {
  const pds = await fakePds(); const dir = tempDir("bsky-auth-");
  try {
    const wrong = { BSKY_IDENTIFIER: IDENT, BSKY_APP_PASSWORD: "synthetic-wrong-pw" };
    for (let i = 0; i < 3; i++) assert.equal((await run(pds, dir, { env: wrong })).outcome, "waiting");
    const st = readState(dir, "crossing-320");
    assert.equal(st.sends, 0);
    assert.equal(st.attempts.filter((a) => a.step === "session").length, 1, "one line, not one per tick");
    assert.ok(!filesIn(dir).includes("synthetic-wrong-pw"));
  } finally { await pds.close(); }
});

test("SECRET ECHO: a PDS that answers with the password and the token, in its error name and its message, leaves no byte of either in state or receipt", async () => {
  // review of #1148 at 8327313b: the server's raw error and message were composed into the refusal, then the state and receipt
  const pds = await fakePds(); const dir = tempDir("bsky-echo-");
  try {
    const receipts = [];
    pds.faults.createSession.push("echo");                              // the login refused, echoing the password
    receipts.push(await run(pds, dir));
    pds.faults.createRecord.push("echo-500");                           // an ambiguous send echoing the token
    pds.faults.getRecord.push("echo");                                  // and a getRecord that echoes it too
    receipts.push(await run(pds, dir));
    pds.faults.createRecord.push("echo");                               // the second send refused outright, echoing the token
    receipts.push(await run(pds, dir));
    assert.deepEqual(receipts.map((r) => r.outcome), ["waiting", "waiting", "failed"], JSON.stringify(receipts));
    const written = filesIn(dir) + JSON.stringify(receipts);
    assertNoSecret(written, "state and receipts");
    assert.match(written, /createSession: HTTP 401 \(unnamed\)/, "a refusal still names its method and status, and that its name was withheld");
    assert.equal(pds.creates(), 0);
  } finally { await pds.close(); }
});

test("SECRET ECHO, TRANSFORMED: an app password abcd-efgh-ijkl-mnop echoed back as abcdefghijklmnop (and the token stripped likewise) is never kept", async () => {
  // review of #1148 at 054812e7: a stripped echo is a plain identifier holding no secret verbatim, so a shape test kept it
  const password = "abcd-efgh-ijkl-mnop";
  const pds = await fakePds({ password }); const dir = tempDir("bsky-echo3-");
  try {
    const env = { BSKY_IDENTIFIER: IDENT, BSKY_APP_PASSWORD: password };
    const receipts = [];
    pds.faults.createSession.push("echo-stripped");
    receipts.push(await run(pds, dir, { env }));
    pds.faults.createRecord.push("echo-stripped-500");
    pds.faults.getRecord.push("echo-stripped");
    receipts.push(await run(pds, dir, { env }));
    pds.faults.createRecord.push("echo-stripped");
    receipts.push(await run(pds, dir, { env }));
    assert.deepEqual(receipts.map((r) => r.outcome), ["waiting", "waiting", "failed"], JSON.stringify(receipts));
    assertNoSecret(filesIn(dir) + JSON.stringify(receipts), "state and receipts", [password, TOKEN]);
    assert.ok(!(filesIn(dir) + JSON.stringify(receipts)).includes("abcdefghijklmnop"));
  } finally { await pds.close(); }
});

test("SECRET ECHO, a secret shaped like a plain name: an alphanumeric password echoed as the error name is still withheld", async () => {
  const plainPw = "SyntheticPlainPw7f3a";
  const pds = await fakePds({ password: plainPw }); const dir = tempDir("bsky-echo2-");
  try {
    const env = { BSKY_IDENTIFIER: IDENT, BSKY_APP_PASSWORD: plainPw };
    pds.faults.createSession.push("echo");
    const r = await run(pds, dir, { env });
    assert.equal(r.outcome, "waiting");
    assert.ok(!(filesIn(dir) + JSON.stringify(r)).includes(plainPw), "the echoed password is not kept as the error's name");
  } finally { await pds.close(); }
});

test("knownName keeps only a known error name, and never one that holds or is held in a secret", () => {
  assert.equal(knownName("RecordNotFound", XRPC_ERROR_NAMES, [IDENT, PASSWORD]), "RecordNotFound");
  assert.equal(knownName("abcdefghijklmnop", XRPC_ERROR_NAMES, ["abcd-efgh-ijkl-mnop"]), null, "a plain identifier that is not a known name");
  assert.equal(knownName("SomethingPlain", XRPC_ERROR_NAMES), null);
  assert.equal(knownName("InvalidRequest", XRPC_ERROR_NAMES, ["xInvalidRequestx"]), null, "the direct secret exclusion stands");
  assert.equal(knownName(undefined, XRPC_ERROR_NAMES), null);
});

test("UNCONFIGURED: without both env names nothing is read or sent", async () => {
  const pds = await fakePds(); const dir = tempDir("bsky-unconf-");
  try {
    const r = await run(pds, dir, { env: { BSKY_IDENTIFIER: IDENT } });
    assert.equal(r.outcome, "unconfigured");
    assert.equal(pds.calls.length, 0);
  } finally { await pds.close(); }
});

// ── the CLI, on scratch clones ───────────────────────────────────────────────

const GIT_ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" };
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", env: { ...process.env, ...GIT_ENV } }).trim();
/** One sweep commit of the World's two records, tagged settlement/S<n> when `n` is given (`-f` re-blesses). */
function bless(repo, t, { force = false } = {}) {
  writeFileSync(join(repo, "WORLD", "settlement-publications.json"), JSON.stringify({ version: 1, published: Object.fromEntries(t.marks.map((m) => [m, { household: "h", path: `WORLD/marks/${m}/mark.md`, class: "home" }])) }));
  writeFileSync(join(repo, "WORLD", "households.json"), t.broken ? "{ torn" : JSON.stringify({ households: Object.fromEntries(t.households.map((h) => [h, {}])) }));
  git(repo, "add", "-A");
  execFileSync("git", ["-C", repo, "commit", "-qm", "settlement: sweep"], { env: { ...process.env, ...GIT_ENV, GIT_COMMITTER_DATE: t.date, GIT_AUTHOR_DATE: t.date } });
  if (t.n != null) git(repo, "tag", ...(force ? ["-f"] : []), "-a", `settlement/S${t.n}`, "-m", `S${t.n}`);
}
function world({ tags }) {
  const repo = tempDir("bsky-world-");
  git(repo, "init", "-q", "-b", "main");
  mkdirSync(join(repo, "WORLD"), { recursive: true });
  for (const t of tags) bless(repo, t);
  return repo;
}
const NOW = Date.parse("2026-11-19T06:30:00Z");
const DAY = 86400_000;
const TAGS = [
  { n: 172, date: "2026-11-17T18:20:00Z", marks: ["a/x"], households: ["a"] },
  { n: 173, date: "2026-11-18T06:20:00Z", marks: ["a/x", "b/y"], households: ["a"] },
  { n: 174, date: "2026-11-18T18:20:00Z", marks: ["a/x", "b/y", "g/t"], households: ["a", "g"] },
  { n: 175, date: "2026-11-19T06:20:00Z", marks: ["a/x", "c/z", "d/w", "e/v"], households: ["a", "c", "g"] },
];
const later = (n, k, extra = {}) => ({ n, date: new Date(NOW + k * DAY).toISOString(), marks: ["a/x", ...Array.from({ length: n - 170 }, (_, i) => `m/${i}`)], households: ["a", "c", "g"], ...extra });
const cli = (pds, { now = () => NOW, env = ENV } = {}) => {
  const lines = [];
  const go = async (argv, over = {}) => {
    const mark = lines.length;
    const code = await main([...argv, "--service", pds.service], { env: over.env ?? env, now: over.now ?? now, out: (l) => lines.push(l) });
    return { code, out: lines.slice(mark).map((l) => JSON.parse(l)) };
  };
  return { go, lines };
};
const said = (r) => r.out.map((l) => `${l.event ?? l.kind} ${l.outcome}`);

test("SETTLEMENTS FROM THE WORLD: every blessed tag in range, oldest first, each counted against the one before; a mechanical publish with no tag is not a blessing", () => {
  const repo = world({ tags: [...TAGS, { n: null, date: "2026-11-19T06:25:00Z", marks: ["a/x", "c/z", "d/w", "e/v", "f/u"], households: ["a", "c", "f", "g"] }] });
  const found = settlementsFromWorld(repo, { from: 174 });
  assert.deepEqual(found.map((e) => e.event.text), [
    "Settlement S174 is blessed. New marks published: 1 · household records added: 1.",
    "Settlement S175 is blessed. New marks published: 3 · household records added: 1.",
  ], "the untagged commit after S175 changes nothing");
  assert.deepEqual(settlementsFromWorld(repo, { from: 172, to: 173 }).map((e) => e.event?.n ?? `skip ${e.n}`), ["skip 172", 173], "the first blessing has nothing to count against");
});

test("CROSSINGS FROM THE TOWN: every crossing with a curated Daily in the committed history, its newest headlined version, never the working tree", () => {
  const repo = tempDir("bsky-town-");
  git(repo, "init", "-q", "-b", "main");
  mkdirSync(join(repo, "TOWN_BULLETIN"), { recursive: true });
  const curate = (n, head) => { writeFileSync(join(repo, "TOWN_BULLETIN", "ferrys-daily.md"), DAILY(n, head)); git(repo, "add", "-A"); git(repo, "commit", "-qm", `Ferry | curate crossing ${n}`); };
  curate(318, "## The lamp on the quay");
  curate(319, "no lead heading yet");
  curate(319, "## Rain over the sorting room");
  curate(320, "## A porch hello");
  curate(321, "no lead heading yet");                                  // being curated: not yet an event
  writeFileSync(join(repo, "TOWN_BULLETIN", "ferrys-daily.md"), DAILY(321, "## An uncommitted draft headline"));
  assert.deepEqual(crossingsFromTown(repo, { from: 319 }).events.map((e) => e.event.text),
    ["Crossing 319 · Ferry's Daily: Rain over the sorting room", "Crossing 320 · Ferry's Daily: A porch hello"]);
  assert.deepEqual(crossingsFromTown(repo, { from: 318, to: 318 }).events.map((e) => e.event.n), [318]);
  assert.match(crossingsFromTown(tempDir("bsky-not-a-town-"), { from: 1 }).held, /cannot be read/);
});

test("THE OPERATOR STARTS IT, THEN AFTER EACH WITH NO AGE: nothing is chosen until --settlement <n>; every blessing above it posts, two between runs are two posts, days late or not", async () => {
  const pds = await fakePds();
  try {
    const repo = world({ tags: TAGS });
    const state = tempDir("bsky-cli-after-");
    const { go } = cli(pds);
    let r = await go(["settlement", "--world", repo, "--state", state]);
    assert.deepEqual([r.code, said(r)], [3, ["settlement unstarted"]]);
    assert.match(r.out[0].detail, /name the first with --settlement <n>/);
    assert.equal(pds.calls.length, 0, "nothing chosen, nothing sent");
    r = await go(["settlement", "--world", repo, "--state", state, "--settlement", "174"]);
    assert.deepEqual([r.code, said(r)], [0, ["settlement 174 posted"]], "the operator's first event, alone");
    r = await go(["settlement", "--world", repo, "--state", state]);
    assert.deepEqual([r.code, said(r)], [0, ["settlement 175 posted"]]);
    r = await go(["settlement", "--world", repo, "--state", state]);
    assert.deepEqual([r.code, said(r)], [0, ["settlement skipped"]], "nothing new");
    bless(repo, later(176, 1)); bless(repo, later(177, 2));
    r = await go(["settlement", "--world", repo, "--state", state], { now: () => NOW + 5 * DAY });
    assert.deepEqual([r.code, said(r)], [0, ["settlement 176 posted", "settlement 177 posted"]], "two blessings between runs, both, oldest first, days later");
    r = await go(["settlement", "--world", repo, "--state", state, "--settlement", "173"]);
    assert.deepEqual([r.code, said(r)], [0, ["settlement 173 posted"]], "a named event below the floor is that one alone");
    r = await go(["settlement", "--world", repo, "--state", state]);
    assert.deepEqual(said(r), ["settlement skipped"], "and it moved no floor: no backfill of S172");
    assert.deepEqual([...pds.records.keys()], ["settlement-174", "settlement-175", "settlement-176", "settlement-177", "settlement-173"]);
    assert.equal(pds.creates(), 5);
  } finally { await pds.close(); }
});

test("OWED EVENTS ARE CARRIED WITH THEIR OWN WORDS: a crossing left waiting is reconciled after the Daily moves on and days pass, then the newer crossings post", async () => {
  const pds = await fakePds();
  try {
    const repo = tempDir("bsky-town-carry-");
    git(repo, "init", "-q", "-b", "main");
    mkdirSync(join(repo, "TOWN_BULLETIN"), { recursive: true });
    const curate = (n, head) => { writeFileSync(join(repo, "TOWN_BULLETIN", "ferrys-daily.md"), DAILY(n, head)); git(repo, "add", "-A"); git(repo, "commit", "-qm", `Ferry | curate crossing ${n}`); };
    curate(319, "## Rain over the sorting room");
    const state = tempDir("bsky-cli-carry-");
    const { go } = cli(pds);
    let r = await go(["crossing", "--town", repo, "--state", state]);
    assert.deepEqual(said(r), ["crossing unstarted"]);
    r = await go(["crossing", "--town", repo, "--state", state, "--crossing", "319"]);
    assert.deepEqual(said(r), ["crossing 319 posted"]);
    curate(320, "## A porch hello");
    pds.faults.createRecord.push("drop-after"); pds.faults.getRecord.push("notfound-500");
    r = await go(["crossing", "--town", repo, "--state", state]);
    assert.deepEqual([r.code, said(r)], [3, ["crossing 320 waiting"]], "sent, its fate not yet told");
    curate(320, "## A porch hello, re-tended");
    curate(321, "## The night boat");
    curate(322, "## Frost on the ledgers");
    r = await go(["crossing", "--town", repo, "--state", state], { now: () => NOW + 3 * DAY });
    assert.deepEqual([r.code, said(r)], [0, ["crossing 320 reconciled", "crossing 321 posted", "crossing 322 posted"]],
      "the owed crossing first, from its own state, though HEAD names 322 and three days passed");
    assert.match(pds.records.get("crossing-320").text, /A porch hello\n/, "its words are the ones first composed");
    assert.equal(pds.creates(), 4, "one record per crossing");
  } finally { await pds.close(); }
});

test("NO GAP BELOW THE FLOOR: discovery stops at an event it cannot record (held, busy, unconfigured), and a named event above the floor posts every owed one up to it", async () => {
  const pds = await fakePds();
  try {
    const repo = world({ tags: TAGS });
    const state = tempDir("bsky-cli-gap-");
    const { go } = cli(pds);
    await go(["settlement", "--world", repo, "--state", state, "--settlement", "175"]);
    bless(repo, later(176, 1, { broken: true })); bless(repo, later(177, 1));
    let r = await go(["settlement", "--world", repo, "--state", state]);
    assert.deepEqual([r.code, said(r)], [3, ["settlement 176 held"]], "S176's record cannot be read: S177 waits behind it");
    assert.deepEqual(recordedEvents(state, "settlement").map((e) => e.n), [175], "the floor did not pass S176");
    bless(repo, later(176, 1), { force: true });                        // the keeper re-blesses S176 on a readable record
    r = await go(["settlement", "--world", repo, "--state", state]);
    assert.deepEqual(said(r), ["settlement 176 posted", "settlement 177 posted"]);
    bless(repo, later(178, 2)); bless(repo, later(179, 2));
    const other = lockEvent(state, "settlement-178");                    // another run holds S178
    r = await go(["settlement", "--world", repo, "--state", state]);
    assert.deepEqual([r.code, said(r)], [0, ["settlement 178 busy"]], "S179 is not posted past a busy S178");
    other.release();
    r = await go(["settlement", "--world", repo, "--state", state], { env: {} });
    assert.deepEqual([r.code, said(r)], [3, ["settlement 178 unconfigured"]]);
    r = await go(["settlement", "--world", repo, "--state", state]);
    assert.deepEqual(said(r), ["settlement 178 posted", "settlement 179 posted"]);
    bless(repo, later(180, 3)); bless(repo, later(181, 3)); bless(repo, later(182, 3));
    r = await go(["settlement", "--world", repo, "--state", state, "--settlement", "181"]);
    assert.deepEqual(said(r), ["settlement 180 posted", "settlement 181 posted"], "named above the floor: every owed one up to it, never past S180");
    r = await go(["settlement", "--world", repo, "--state", state, "--settlement", "190"]);
    assert.deepEqual(said(r), ["settlement 182 posted"], "an unblessed name posts the owed ones below it and nothing else");
    assert.equal(pds.creates(), 8);
  } finally { await pds.close(); }
});

test("THE CLI END TO END: one JSON receipt line, the exit codes, --state required, and no secret on stdout", async () => {
  const pds = await fakePds();
  try {
    const repo = world({ tags: TAGS });
    const state = tempDir("bsky-cli-state-");
    const { go, lines } = cli(pds);
    assert.equal((await main(["settlement", "--world", repo])), 2, "--state is required");
    assert.equal((await main(["settlement", "--world", repo, "--state", state, "--settlement", "x"])), 2, "a settlement number");
    let r = await go(["settlement", "--world", repo, "--state", state, "--settlement", "S175"]);
    assert.equal(r.code, 0);
    assert.deepEqual(r.out, [{ event: "settlement 175", rkey: "settlement-175", outcome: "posted", sends: 1, uri: `at://${DID}/app.bsky.feed.post/settlement-175` }]);
    r = await go(["settlement", "--world", repo, "--state", state, "--settlement", "175"]);
    assert.deepEqual([r.code, r.out[0].outcome], [0, "already"]);
    r = await go(["settlement", "--world", repo, "--state", state], { env: {} });
    assert.deepEqual([r.code, said(r)], [0, ["settlement skipped"]], "nothing owed: answered before the credential is looked for");
    r = await go(["settlement", "--world", repo, "--state", tempDir("bsky-cli-other-"), "--settlement", "175"], { env: {} });
    assert.deepEqual([r.code, said(r)], [3, ["settlement 175 unconfigured"]]);
    r = await go(["settlement", "--world", repo, "--state", state, "--settlement", "999"]);
    assert.equal(r.code, 0);
    pds.faults.createRecord.push("400", "400");
    r = await go(["settlement", "--world", repo, "--state", tempDir("bsky-cli-fail-"), "--settlement", "174"]);
    assert.deepEqual([r.code, said(r)], [1, ["settlement 174 failed"]]);
    assert.equal(pds.creates(), 1);
    assertNoSecret(lines.join("\n"), "stdout");
  } finally { await pds.close(); }
});
