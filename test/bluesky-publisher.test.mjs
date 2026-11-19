// bluesky-publisher.test.mjs — the town's day on Bluesky, against a FAKE XRPC server (POS-904 Part 1).
//
// No real credential and no network: a local http server plays the PDS
// (createSession, createRecord, getRecord), with synthetic auth and scripted
// faults. Each case reads what the fake holds afterwards, so "exactly one record"
// is counted, not assumed.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers/temp-dir.mjs";
import {
  BSKY_ENV, MAX_SENDS, crossingEvent, lockEvent, plainLine, plainName, postRecord, publishEvent, readState, rkeyFor, settlementChanges, settlementEvent,
} from "../src/bluesky-publisher.mjs";
import { crossingFromTown, main, settlementFromWorld } from "../tools/bluesky-publish.mjs";

// synthetic, and distinctive so a leak is findable in any byte written
const IDENT = "postmark.town";
const PASSWORD = "synthetic-app-pw-7f3a";
const TOKEN = "synthetic-access-jwt-91c2";
const DID = "did:plc:faketown";
const ENV = { BSKY_IDENTIFIER: IDENT, BSKY_APP_PASSWORD: PASSWORD };

/** A fake PDS. `faults` is a queue per method: "500", "400", "drop-after" (create, then cut the connection), "drop-before", "notfound-500". */
async function fakePds() {
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
      // A HOSTILE OR CARELESS PDS: it echoes whatever secret it was given, in its error name and its message
      if (fault?.startsWith("echo")) {
        const sent = (() => { try { return JSON.parse(body || "{}"); } catch { return {}; } })();
        const secret = sent.password ?? (req.headers.authorization ?? "").replace(/^Bearer /, "") ?? "";
        return send(fault === "echo-500" ? 500 : method.endsWith("createSession") ? 401 : 400,
          { error: secret || TOKEN, message: `refused: identifier=${sent.identifier ?? IDENT} password=${secret} token=${TOKEN} authorization=Bearer ${TOKEN}` });
      }
      if (method === "com.atproto.server.createSession") {
        const b = JSON.parse(body);
        if (fault === "400" || b.identifier !== IDENT || b.password !== PASSWORD) return send(401, { error: "AuthenticationRequired", message: "Invalid identifier or password" });
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
const assertNoSecret = (text, where) => { for (const s of [PASSWORD, TOKEN, "Bearer"]) assert.ok(!String(text).includes(s), `${where} carries ${s === "Bearer" ? "an auth header" : "a secret"}`); };

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

test("a crossing posts its Daily's lead headline, for the current crossing or the one before, and never a Daily left standing", () => {
  assert.deepEqual(crossingEvent({ markdown: DAILY(320), headline: "A porch hello", current: 320 }).event,
    { kind: "crossing", n: 320, text: "Crossing 320 · Ferry's Daily: A porch hello", link: "https://postmark.town/daily/" });
  assert.equal(crossingEvent({ markdown: DAILY(319), headline: "A porch hello", current: 320 }).event.n, 319, "curated after the next boat sailed: still its own crossing");
  assert.match(crossingEvent({ markdown: DAILY(317), headline: "x", current: 320 }).skip, /not the current crossing \(320\) or the one before/);
  assert.match(crossingEvent({ markdown: DAILY(320), headline: null, current: 320 }).skip, /no lead headline/);
  assert.match(crossingEvent({ markdown: "no crossing line", headline: "x", current: 320 }).skip, /names no crossing/);
});

test("a blessed settlement's counts are the literal records added between its tag and the previous one, never a taxonomy, never a guessed zero", () => {
  const before = { published: { "a/x": {}, "b/y": {} }, households: { a: {} } };
  const after = { published: { "a/x": {}, "c/z": {}, "d/w": {} }, households: { a: {}, c: {} } };
  assert.deepEqual(settlementChanges({ before, after }), { marks: 2, households: 1 }, "b/y's retirement is not counted (Part 1 has no retirements)");
  assert.deepEqual(settlementEvent({ n: 175, changes: { marks: 10, households: 1 } }).event,
    { kind: "settlement", n: 175, text: "Settlement S175 is blessed. New marks published: 10 · household records added: 1.", link: "https://postmark.town/replay/#S175" });
  assert.doesNotMatch(settlementEvent({ n: 1, changes: { marks: 0, households: 3 } }).event.text, /joined/i, "a record added is never 'joined'");
  assert.match(settlementEvent({ n: 9, changes: settlementChanges({ before: { published: null }, after }) }).skip, /never a guessed count/);
  assert.match(settlementEvent({ n: 9, changes: settlementChanges({ before: { published: {}, households: null }, after }) }).skip, /never a guessed count/);
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

test("a lock whose holder is gone is taken over; a live holder's is not", () => {
  const dir = tempDir("bsky-lock-");
  writeFileSync(join(dir, "crossing-1.lock"), "999999999");
  const taken = lockEvent(dir, "crossing-1");
  assert.ok(taken, "a dead pid's lock is stale");
  assert.equal(lockEvent(dir, "crossing-1"), null, "this live process holds it now");
  taken.release();
  assert.ok(!existsSync(join(dir, "crossing-1.lock")));
});

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

test("SECRET ECHO, a secret shaped like a plain name: an alphanumeric password echoed as the error name is still withheld", async () => {
  const pds = await fakePds(); const dir = tempDir("bsky-echo2-");
  try {
    const plainPw = "SyntheticPlainPw7f3a";                             // passes the name pattern: only the secret check can stop it
    const env = { BSKY_IDENTIFIER: IDENT, BSKY_APP_PASSWORD: plainPw };
    pds.faults.createSession.push("echo");
    const r = await run(pds, dir, { env });
    assert.equal(r.outcome, "waiting");
    assert.ok(!(filesIn(dir) + JSON.stringify(r)).includes(plainPw), "the echoed password is not kept as the error's name");
  } finally { await pds.close(); }
});

test("plainName keeps a plain error name and withholds anything else", () => {
  assert.equal(plainName("RecordNotFound", [IDENT, PASSWORD]), "RecordNotFound");
  assert.equal(plainName("synthetic-app-pw-7f3a", []), null, "not a plain identifier");
  assert.equal(plainName("SyntheticPlainPw7f3a", ["SyntheticPlainPw7f3a"]), null, "a plain name that is a secret");
  assert.equal(plainName(undefined), null);
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

const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" } }).trim();
function world({ tags }) {
  const repo = tempDir("bsky-world-");
  git(repo, "init", "-q", "-b", "main");
  mkdirSync(join(repo, "WORLD"), { recursive: true });
  for (const t of tags) {
    writeFileSync(join(repo, "WORLD", "settlement-publications.json"), JSON.stringify({ version: 1, published: Object.fromEntries(t.marks.map((m) => [m, { household: "h", path: `WORLD/marks/${m}/mark.md`, class: "home" }])) }));
    writeFileSync(join(repo, "WORLD", "households.json"), JSON.stringify({ households: Object.fromEntries(t.households.map((h) => [h, {}])) }));
    git(repo, "add", "-A");
    execFileSync("git", ["-C", repo, "commit", "-qm", "settlement: sweep"], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x", GIT_COMMITTER_DATE: t.date, GIT_AUTHOR_DATE: t.date } });
    if (t.n != null) git(repo, "tag", "-a", `settlement/S${t.n}`, "-m", `S${t.n}`);
  }
  return repo;
}
const NOW = Date.parse("2026-11-19T06:30:00Z");
const TAGS = [
  { n: 174, date: "2026-11-18T18:20:00Z", marks: ["a/x", "b/y"], households: ["a"] },
  { n: 175, date: "2026-11-19T06:20:00Z", marks: ["a/x", "c/z", "d/w", "e/v"], households: ["a", "c"] },
];

test("SETTLEMENT FROM THE WORLD: the newest BLESSED tag against the one before; a mechanical publish with no tag is not a blessing", () => {
  const repo = world({ tags: [...TAGS, { n: null, date: "2026-11-19T06:25:00Z", marks: ["a/x", "c/z", "d/w", "e/v", "f/u"], households: ["a", "c", "f"] }] });
  const r = settlementFromWorld(repo, { now: NOW });
  assert.deepEqual(r.event, { kind: "settlement", n: 175, text: "Settlement S175 is blessed. New marks published: 3 · household records added: 1.", link: "https://postmark.town/replay/#S175" },
    "counted from S174 to S175's tags; the untagged commit after them changes nothing");
  assert.match(settlementFromWorld(repo, { now: NOW + 2 * 86400_000 }).skip, /more than a day old: never posted late/);
  assert.equal(settlementFromWorld(repo, { n: 175, now: NOW + 2 * 86400_000 }).event.n, 175, "an explicit --settlement is the operator's own ask");
  assert.match(settlementFromWorld(repo, { n: 176, now: NOW }).skip, /no settlement\/S176 .*: not blessed/);
  assert.match(settlementFromWorld(repo, { n: 174, now: NOW }).skip, /no earlier blessed settlement/);
});

test("CROSSING FROM THE TOWN: the Daily committed at HEAD, never the working tree", () => {
  const repo = tempDir("bsky-town-");
  git(repo, "init", "-q", "-b", "main");
  mkdirSync(join(repo, "TOWN_BULLETIN"), { recursive: true });
  writeFileSync(join(repo, "TOWN_BULLETIN", "ferrys-daily.md"), DAILY(320, "## A porch hello"));
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "Ferry | curate crossing 320");
  writeFileSync(join(repo, "TOWN_BULLETIN", "ferrys-daily.md"), DAILY(320, "## An uncommitted draft headline"));
  const r = crossingFromTown(repo, { now: Date.parse("2026-11-19T00:50:00Z") });
  assert.equal(r.event.text, "Crossing 320 · Ferry's Daily: A porch hello");
});

test("THE CLI END TO END: one JSON receipt line, the exit codes, --state required, and no secret on stdout", async () => {
  const pds = await fakePds();
  try {
    const repo = world({ tags: TAGS });
    const state = tempDir("bsky-cli-state-");
    const lines = [];
    const go = (argv, env = ENV) => main(argv, { env, now: () => NOW, out: (l) => lines.push(l) });
    assert.equal(await go(["settlement", "--world", repo]), 2, "--state is required");
    assert.equal(await go(["settlement", "--world", repo, "--state", state, "--service", pds.service]), 0);
    assert.deepEqual(JSON.parse(lines.at(-1)), { event: "settlement 175", rkey: "settlement-175", outcome: "posted", sends: 1, uri: `at://${DID}/app.bsky.feed.post/settlement-175` });
    assert.equal(await go(["settlement", "--world", repo, "--state", state, "--service", pds.service]), 0);
    assert.equal(JSON.parse(lines.at(-1)).outcome, "already");
    assert.equal(await go(["settlement", "--world", repo, "--state", state, "--service", pds.service], {}), 0, "already posted: answered before the credential is looked for");
    assert.equal(await go(["settlement", "--world", repo, "--state", tempDir("bsky-cli-other-"), "--service", pds.service], {}), 3, "unconfigured is 3");
    assert.equal(pds.creates(), 1);
    assertNoSecret(lines.join("\n"), "stdout");
  } finally { await pds.close(); }
});
