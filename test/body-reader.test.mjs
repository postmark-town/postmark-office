// body-reader.test.mjs — the one body reader counts bytes, keeps split characters, and refuses with a 413 (POS-526).
//
//   node --test --test-concurrency=1 test/body-reader.test.mjs
//
// PURE: readBody against a controlled in-memory stream (a PassThrough standing
// in for the request), so every chunk boundary is exactly where the test puts
// it — no socket, no server, no coalescing. Fixed literals only.

import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { readBody, BodyTooLarge, BodyIncomplete, isBodyTooLarge } from "../src/body.mjs";

const tick = () => new Promise((ok) => setImmediate(ok));
const stream = () => new PassThrough();
async function feed(chunks, cap, { end = true } = {}) {
  const req = stream();
  const p = readBody(req, cap);
  p.catch(() => {}); // a rejection before the test awaits it is still the test's to judge
  for (const c of chunks) { req.write(c); await tick(); }
  if (end) req.end();
  return { req, p };
}

const SAMPLES = ["é", "€", "😀", "aé€😀b", '{"card":"ünïcødé € 😀 — ok"}', "日本語のテキスト🙂"];

test("every split of 2-, 3- and 4-byte characters decodes exactly, never U+FFFD", async () => {
  let cases = 0;
  for (const s of SAMPLES) {
    const b = Buffer.from(s, "utf8");
    for (let i = 1; i < b.length; i++) {
      const { p } = await feed([b.subarray(0, i), b.subarray(i)], b.length);
      const got = await p;
      assert.equal(got, s, `${JSON.stringify(s)} split at byte ${i}`);
      assert.equal(got.includes("�"), false);
      cases++;
    }
    const { p } = await feed([...b].map((x) => Buffer.from([x])), b.length); // one byte per chunk
    assert.equal(await p, s, `${JSON.stringify(s)} one byte at a time`);
    cases++;
  }
  assert.ok(cases > 60, `boundaries tried: ${cases}`);
});

test("the cap counts BYTES: exactly the cap passes; one byte over is a 413 even when the string is far shorter", async () => {
  const euros = "€".repeat(10); // 30 bytes, 10 UTF-16 units
  assert.equal(await (await feed([Buffer.from(euros)], 30)).p, euros, "exactly 30 bytes under a 30-byte cap");
  const over = (await feed([Buffer.from(euros)], 29)).p;
  await assert.rejects(over, (e) => e instanceof BodyTooLarge && e.code === 413 && e.cap === 29 && isBodyTooLarge(e),
    "30 bytes under a 29-byte cap, though the string is 10 long");

  const mixed = "a".repeat(5) + "😀"; // 9 bytes, 7 UTF-16 units
  assert.equal(await (await feed([Buffer.from(mixed)], 9)).p, mixed);
  await assert.rejects((await feed([Buffer.from(mixed)], 8)).p, BodyTooLarge);

  const e = new BodyTooLarge(8);
  assert.equal(e.defect, "the request body is too large");
  assert.match(e.hint, /at most 8 bytes/);
});

test("zero, empty and invalid caps are explicit", async () => {
  assert.equal(await (await feed([], 0)).p, "", "an empty body under a zero cap");
  assert.equal(await (await feed([], 10)).p, "", "an empty body");
  await assert.rejects((await feed([Buffer.from("x")], 0)).p, BodyTooLarge, "one byte under a zero cap");
  for (const bad of [-1, 1.5, NaN, Infinity, "10", undefined, null]) {
    const req = stream();
    await assert.rejects(readBody(req, bad), TypeError, `cap ${String(bad)}`);
    assert.equal(req.listenerCount("data"), 0, "nothing was attached for a bad cap");
  }
});

test("over the cap: buffering stops, the rest drains, it settles once, and its listeners are gone", async () => {
  const req = stream();
  let settled = 0;
  const p = readBody(req, 10).then(() => { settled++; }, (e) => { settled++; return e; });
  req.write(Buffer.alloc(11, 0x61));
  const e = await p;
  assert.ok(e instanceof BodyTooLarge);
  for (let i = 0; i < 50; i++) req.write(Buffer.alloc(1000, 0x62)); // keeps coming: drained, not held, no throw
  await tick();
  assert.equal(req.readableFlowing, true, "the stream is drained, not paused or destroyed");
  assert.equal(req.destroyed, false, "no reset: the door can still answer");
  req.end();
  await tick();
  assert.equal(settled, 1, "one settlement, though data and end kept arriving");
  for (const ev of ["data", "end", "aborted", "close"]) assert.equal(req.listenerCount(ev), 0, `no ${ev} listener left`);
  assert.equal(req.listenerCount("error"), 1, "only the no-op error listener remains");
  req.emit("error", new Error("late")); // must not be an unhandled stream error
});

test("abort, error and an early close each reject once, by kind; a late event changes nothing", async () => {
  {
    const req = stream(); const p = readBody(req, 100);
    req.write(Buffer.from("par")); await tick();
    req.emit("aborted");
    await assert.rejects(p, BodyIncomplete);
    req.emit("end"); req.emit("error", new Error("late"));
  }
  {
    const req = stream(); const p = readBody(req, 100);
    const boom = new Error("socket error");
    req.emit("error", boom);
    await assert.rejects(p, (e) => e === boom);
  }
  {
    const req = stream(); const p = readBody(req, 100);
    req.write(Buffer.from("par")); await tick();
    req.destroy();
    await assert.rejects(p, BodyIncomplete);
  }
  {
    const req = stream(); let n = 0;
    const p = readBody(req, 100).then((v) => { n++; return v; });
    req.end(Buffer.from("whole"));
    assert.equal(await p, "whole");
    req.emit("end"); req.emit("close"); req.emit("error", new Error("after"));
    await tick();
    assert.equal(n, 1);
  }
  {
    const ended = stream(); ended.end(); ended.resume(); await tick();
    assert.equal(await readBody(ended, 10), "", "an already-ended request reads as empty");
    const gone = stream(); gone.destroy(); await tick();
    await assert.rejects(readBody(gone, 10), BodyIncomplete, "an already-closed request");
  }
});
