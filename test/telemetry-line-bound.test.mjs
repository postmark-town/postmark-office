// telemetry-line-bound.test.mjs — the shared access log stays atomically
// appendable when N read workers write to it (runbook DEC-4 / G3, conductor-
// accepted repair 2026-09-08).
//
// THE CLASS. A POSIX `O_APPEND` write is atomic only up to PIPE_BUF (4096 on
// Linux). Past that the kernel may split it, and two workers writing long lines
// at the same instant interleave — two unparseable lines where there were two
// good ones. Every reader of this file does `try { JSON.parse } catch
// { continue }`, so a torn line is dropped in SILENCE and takes the innocent
// partner line with it.
//
// This file drives `accessLine` rather than grepping `telemetry.mjs` for a
// `.slice(` — a check on the code's text is not a check on its behaviour, which
// is the carry this whole lane keeps meeting.

import test from "node:test";
import assert from "node:assert/strict";
import { accessLine, PATH_MAX, LINE_MAX } from "../src/telemetry.mjs";

const bytes = (s) => Buffer.byteLength(s, "utf8");

const entry = (over = {}) => ({
  ts: "2026-09-08T21:00:00.000Z",
  ip: "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
  method: "GET",
  path: "/town",
  status: 200,
  ms: 12,
  ua: "x".repeat(120),
  household: "keemin",
  mcp: null,
  ...over,
});

test("an ordinary line is untouched — the cap is a ceiling, not a haircut", () => {
  const line = accessLine(entry());
  const back = JSON.parse(line);
  assert.equal(back.path, "/town");
  assert.equal(back.household, "keemin");
  assert.equal(back.ua.length, 120);
  assert.ok(bytes(line) < 400, `an ordinary line should stay small, got ${bytes(line)}`);
});

test("A LONG PATHNAME — the case that actually happens — stays under PIPE_BUF", () => {
  // MEASURED against the real server before this repair: a 6,000-character
  // pathname produced a 6,143-byte line. nginx passes a request line up to
  // large_client_header_buffers (8k default), so this is reachable from
  // outside rather than a laboratory curiosity.
  const line = accessLine(entry({ path: "/" + "a".repeat(6000) }));
  assert.ok(bytes(line) + 1 <= LINE_MAX, `line was ${bytes(line) + 1} bytes with the newline`);
  const back = JSON.parse(line);
  assert.equal(back.path.length, PATH_MAX, "the path is capped, not dropped — it still says which door was knocked on");
  assert.ok(back.path.startsWith("/aaa"), "and it keeps the FRONT of the path, which is the part that names the door");
});

test("PERCENT-ENCODED UTF-8 — the worst case — stays under PIPE_BUF", () => {
  // The nastiest shape, and the one a hand-written bound would have missed:
  // `url.pathname` keeps the percent-encoding, so each 4-byte character becomes
  // TWELVE characters. Measured before the repair: 1,200 emoji produced a
  // 14,543-byte line, more than three times the bound.
  const line = accessLine(entry({ path: "/" + encodeURIComponent("\u{1F600}".repeat(1200)) }));
  assert.ok(bytes(line) + 1 <= LINE_MAX, `line was ${bytes(line) + 1} bytes with the newline`);
});

test("A QUERY STRING IS NOT THE CAUSE, and the lane's first write-up said it was", () => {
  // server.mjs logs `url.pathname` with the query already stripped, so a query
  // string never reaches this line. Kept as a test because the report named the
  // wrong mechanism, and a corrected claim with no check is a claim that drifts
  // back. If someone ever starts logging the query, this goes red and they will
  // read the bound before they ship it.
  const line = accessLine(entry({ path: "/town" }));
  assert.equal(JSON.parse(line).path, "/town");
  assert.ok(bytes(line) < 400);
});

test("THE BOUND HOLDS WHEN THE FIELDS NOBODY CAPPED GO LONG", () => {
  // `household`, `mcp` and `ip` are bounded by convention, not by code. A bound
  // that rests on convention fails the week somebody changes the convention, so
  // the length check runs after the slice and this is what proves it does.
  const line = accessLine(entry({
    path: "/" + "p".repeat(6000),
    household: "h".repeat(5000),
    mcp: "m".repeat(5000),
    ua: "u".repeat(5000),
  }));
  assert.ok(bytes(line) + 1 <= LINE_MAX, `line was ${bytes(line) + 1} bytes with the newline`);
  const back = JSON.parse(line);
  assert.equal(back.truncated, true, "a line that had to drop the readers' own fields must SAY so");
  // and it keeps exactly what the three readers consume
  assert.equal(back.ts, "2026-09-08T21:00:00.000Z");
  assert.ok("household" in back && "mcp" in back);
});

test("every line this function can produce is parseable — the whole point", () => {
  const shapes = [
    entry(),
    entry({ path: "/" + "a".repeat(9999) }),
    entry({ path: null }),
    entry({ path: undefined }),
    entry({ household: null, mcp: "world_orient" }),
    entry({ path: "/" + encodeURIComponent("\u{1F600}".repeat(2000)), household: "h".repeat(9999) }),
  ];
  for (const s of shapes) {
    const line = accessLine(s);
    assert.doesNotThrow(() => JSON.parse(line), `unparseable line for ${String(s.path).slice(0, 20)}`);
    assert.ok(bytes(line) + 1 <= LINE_MAX, `over the bound: ${bytes(line) + 1}`);
    assert.ok(!line.includes("\n"), "a newline inside a line would tear the record by itself");
  }
});

test("the bound is BELOW PIPE_BUF, not at it — the newline is part of the write", () => {
  assert.ok(LINE_MAX < 4096, `LINE_MAX ${LINE_MAX} must leave room under PIPE_BUF for the newline and a margin`);
  assert.ok(PATH_MAX > 0 && PATH_MAX < LINE_MAX);
});

// POS-1064/b: a doorstep or household line carries `timing` (read-timing.mjs). It is kept ahead of the call's shape, and when it must go the line SAYS so.
const TIMING = { v: 1, rid: "0123456789ab", door: "doorstep", route: "worker", worker: 0, tries: 1, ok: true, status: 200, admit_ms: 1.1, queue_ms: 0.3, exec_ms: 1116.4, total_ms: 1120,
  bundle: { n: 1, sum_ms: 1114.1, max_ms: 1114.1 }, leases: { main: { n: 0 }, worker: { n: 11, failed: 0, acquire_ms: { sum: 5.6, max: 3.6 }, held_ms: { sum: 318.4, max: 183.7 }, failed_wait_ms: 0 } }, cov: "pen" };

test("timing rides an ordinary line and a long path's line whole; the call's shape gives way before it, named as dropped", () => {
  const ordinary = JSON.parse(accessLine(entry({ call: { read: "doorstep" }, timing: TIMING })));
  assert.deepEqual(ordinary.timing, TIMING);
  const longPath = accessLine(entry({ path: "/" + "a".repeat(6000), call: { read: "doorstep" }, timing: TIMING }));
  assert.ok(bytes(longPath) + 1 <= LINE_MAX);
  assert.deepEqual(JSON.parse(longPath).timing, TIMING, "a long path never costs the measurement");
  // a call big enough to push the line over after the path is dropped: the call goes, the timing stays, and the line says what was dropped
  const heavy = accessLine(entry({ path: "/" + "a".repeat(6000), call: { blob: "z".repeat(3500) }, timing: TIMING }));
  const back = JSON.parse(heavy);
  assert.ok(bytes(heavy) + 1 <= LINE_MAX);
  assert.deepEqual(back.timing, TIMING);
  assert.equal(back.call_dropped, true);
  assert.equal(back.call, null);
});

test("when timing itself cannot fit, the last resort says `timing_dropped`: no timing and no timing_dropped is an unmeasured request, never a cut one", () => {
  const huge = accessLine(entry({ household: "h".repeat(9999), timing: { ...TIMING, filler: "t".repeat(9999) } }));
  const back = JSON.parse(huge);
  assert.ok(bytes(huge) + 1 <= LINE_MAX);
  assert.equal(back.timing, undefined);
  assert.equal(back.timing_dropped, true);
  assert.equal(back.truncated, true);
  assert.equal(JSON.parse(accessLine(entry({ household: "h".repeat(9999) }))).timing_dropped, undefined, "a line that never had timing does not claim to have dropped one");
});
