// date-filter.test.mjs — `since` / `until` are ISO dates (bare, or any ISO timestamp: an offset is converted to UTC, no zone reads as UTC),
// and the MCP door refuses anything else with a 422 that names the field and says what to send.
//
//   node --test test/date-filter.test.mjs
//
// The apex re-enters callTool for the flat verb, so `town { read: "letters" }` and the flat
// `list_letters` share one guard; both are asked here. (The HTTP routes and the rpc door
// are in server.test.mjs.) The guard answers before any store is read, so no fixture is needed.

import test from "node:test";
import assert from "node:assert/strict";

import { dateFilterDefect, isIsoDateFilter } from "../src/date-filter.mjs";
import { callTool } from "../src/mcp.mjs";

const ctx = { key: null, asOf: null, canWrite: false, clone: null, pen: null, odb: null };

test("a bare date and any ISO timestamp read; a word, a US date and an impossible date do not", () => {
  for (const ok of ["2026-10-01", "2026-07-03T08:30Z", "2026-07-03T08:30:00Z", "2026-07-03T08:30:00.000Z", "2024-02-29",
    "2026-07-03T08:30:00+00:00", "2026-07-03T08:30:00+02:00", "2026-07-03T08:30", "2026-07-03T08:30:00", "2026-07-03T08:30:00.123456"])
    assert.equal(isIsoDateFilter(ok), true, ok);
  for (const bad of ["yesterday", "10/01/2026", "2026-10-1", "2026-02-30", "2026-13-01", "2026-07-03T25:00:00Z", "2026-07-03T08:30:00+25:00", "2026-07-03Tnoon"])
    assert.equal(isIsoDateFilter(bad), false, bad);
});

test("a readable timestamp is handed down as its UTC moment; a bare date is left as sent", () => {
  const cases = [
    ["2026-07-03T08:30:00+00:00", "2026-07-03T08:30:00.000Z"],
    ["2026-07-03T08:30:00+02:00", "2026-07-03T06:30:00.000Z"],
    ["2026-07-03T08:30:00-05:30", "2026-07-03T14:00:00.000Z"],
    ["2026-07-03T08:30", "2026-07-03T08:30:00.000Z"],
    ["2026-07-03T08:30:00", "2026-07-03T08:30:00.000Z"],
    ["2026-07-03T08:30:00.5Z", "2026-07-03T08:30:00.500Z"],
    ["2026-07-03T23:30:00-01:00", "2026-07-04T00:30:00.000Z"],
    ["2026-07-03", "2026-07-03"],
  ];
  for (const [sent, handed] of cases) {
    const opts = { since: sent, until: sent };
    assert.equal(dateFilterDefect(opts), null, sent);
    assert.deepEqual(opts, { since: handed, until: handed }, sent);
  }
});

test("over HTTP a single space before an HH:MM offset is the `+` a query string decoded; MCP does not read it so", () => {
  const http = { since: "2026-07-03T08:30:00 02:00" };
  assert.equal(dateFilterDefect(http), null);
  assert.equal(http.since, "2026-07-03T06:30:00.000Z");
  assert.equal(dateFilterDefect({ since: "2026-07-03T08:30:00 02:00" }, undefined, "mcp").field, "since");
  assert.equal(dateFilterDefect({ since: "2026-07-03 08:30" }).field, "since");
});

test("the defect says UTC and the hint is the door's own spelling", () => {
  const mcp = dateFilterDefect({ since: "yesterday" }, undefined, "mcp");
  assert.equal(mcp.code, 422);
  assert.equal(mcp.field, "since");
  assert.match(mcp.defect, /an offset is converted to UTC; no zone reads as UTC/);
  assert.equal(mcp.hint, 'send since: "2026-10-01"');
  assert.equal(dateFilterDefect({ until: "soon" }).hint, "send ?until=2026-10-01", "HTTP is the default door");
});

test("list_letters and town { read: \"letters\" } both bounce since: \"yesterday\" as a 422 naming `since`", async () => {
  const flat = await callTool("list_letters", { since: "yesterday" }, ctx);
  const apex = await callTool("town", { read: "letters", args: { since: "yesterday" } }, ctx);
  for (const [door, r] of [["list_letters", flat], ["town { read: letters }", apex]]) {
    assert.equal(r.error, "bounce", door);
    assert.equal(r.code, 422, door);
    assert.equal(r.field, "since", door);
    assert.match(r.defect, /^since must be an ISO date/, door);
    assert.equal(r.hint, 'send since: "2026-10-01"', door);
  }
});

test("each list verb refuses its own bad filter: until on list_commits, since on list_mail and list_residents", async () => {
  for (const [name, args, field] of [
    ["list_commits", { until: "10/01/2026" }, "until"],
    ["list_mail", { handle: "wright", since: "2026-10-1" }, "since"],
    ["list_residents", { since: "yesterday" }, "since"],
  ]) {
    const r = await callTool(name, args, ctx);
    assert.equal(r.code, 422, name);
    assert.equal(r.field, field, name);
  }
});
