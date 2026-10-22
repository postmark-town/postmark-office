// tool-annotations.test.mjs — every tool the door lists declares its three hints (POS-748).
//
// OpenAI's app review (CORE-13) wants readOnlyHint, destructiveHint and openWorldHint
// as explicit booleans on every MCP tool. The one table is src/tool-annotations.mjs;
// these tests hold every listed tool to it, with WORLD_APEX on (prod's seven tools)
// and off (the full flat list, the rollback shape), and on the wire through POST /mcp.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/tool-annotations.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";

const saved = process.env.WORLD_APEX;
after(() => { if (saved === undefined) delete process.env.WORLD_APEX; else process.env.WORLD_APEX = saved; });
const apex = (on) => { process.env.WORLD_APEX = on ? "1" : ""; };

const { toolList, handleMcp, WRITE_TOOLS, TOOLS } = await import("../src/mcp.mjs");
const { TOOL_ANNOTATIONS } = await import("../src/tool-annotations.mjs");

const HINTS = ["readOnlyHint", "destructiveHint", "openWorldHint"];

function holdsAll(tools, mode) {
  for (const t of tools) {
    assert.ok(t.annotations, `${t.name} (${mode}) is listed with no annotations: give it a row in src/tool-annotations.mjs`);
    for (const h of HINTS) assert.equal(typeof t.annotations[h], "boolean", `${t.name} (${mode}): ${h} is not an explicit boolean`);
    assert.deepEqual(Object.keys(t.annotations).sort(), [...HINTS].sort(), `${t.name} (${mode}): only the three hints go on the wire`);
    const why = TOOL_ANNOTATIONS[t.name]?.why;
    assert.ok(typeof why === "string" && why.length > 20, `${t.name} (${mode}) has no one-line reason`);
  }
}

test("WORLD_APEX on (prod's listing): every listed tool declares all three hints, with a reason", () => {
  apex(true);
  const tools = toolList();
  assert.ok(tools.some((t) => t.name === "world") && tools.some((t) => t.name === "doorstep"), "the apex listing is served");
  holdsAll(tools, "apex on");
});

test("WORLD_APEX off (the rollback listing): every flat tool declares all three hints, with a reason", () => {
  apex(false);
  const tools = toolList();
  assert.equal(tools.length, TOOLS.length, "the flag off lists the whole flat set");
  holdsAll(tools, "apex off");
});

test("the table names only tools that exist, and the hints agree with each other and with the auth gate", () => {
  apex(true); const on = toolList(); apex(false); const off = toolList();
  const names = new Set([...on, ...off].map((t) => t.name));
  for (const name of Object.keys(TOOL_ANNOTATIONS)) assert.ok(names.has(name), `${name} has a row but no tool: a stale row`);
  for (const [name, r] of Object.entries(TOOL_ANNOTATIONS)) {
    if (r.readOnlyHint) assert.equal(r.destructiveHint, false, `${name}: a read-only tool can't be destructive`);
    // A tool the office challenges for sign-in because it writes can't call itself read-only.
    if (WRITE_TOOLS.has(name)) assert.equal(r.readOnlyHint, false, `${name} is a WRITE_TOOLS member declared read-only`);
  }
  // The other direction (the review of #723): every tool the table calls a write is
  // in WRITE_TOOLS, so the sign-in gate and the hints can't drift apart unseen. The
  // only exceptions are the three apex doors (writeShaped reads their do:) and
  // read_letter (a read that clears an unread mark, not an act).
  const writesOutsideTheGate = Object.entries(TOOL_ANNOTATIONS)
    .filter(([name, r]) => !r.readOnlyHint && !WRITE_TOOLS.has(name)).map(([name]) => name).sort();
  assert.deepEqual(writesOutsideTheGate, ["household", "read_letter", "town", "world"], "a write the table names is missing from WRITE_TOOLS");
  // The apex doors carry do: acts, so each declares the honest union.
  for (const door of ["world", "household", "town"]) {
    assert.equal(TOOL_ANNOTATIONS[door].readOnlyHint, false, `${door} performs do: acts`);
    assert.match(TOOL_ANNOTATIONS[door].why, /^Mixed: /, `${door}'s reason says it mixes reads and acts`);
  }
  // The two that make the office reach outside Postmark.
  assert.equal(TOOL_ANNOTATIONS.upload_media.openWorldHint, true, "upload_media fetches any public https URL");
  assert.equal(TOOL_ANNOTATIONS.household.openWorldHint, true, "rsvp registers a webhook the office posts to");
});

// POST /mcp, as a client sees it: the hints ride tools/list itself.
function rpc(message) {
  return new Promise((resolve) => {
    const req = new PassThrough(); req.method = "POST"; req.headers = { "content-type": "application/json" };
    let status = 0;
    const res = { headersSent: false, writeHead(s) { status = s; this.headersSent = true; return this; }, setHeader() {}, end(b) { resolve({ status, body: JSON.parse(b) }); } };
    handleMcp(req, res, { asOf: "test" });
    req.end(JSON.stringify(message));
  });
}

test("on the wire: tools/list carries each tool's annotations", async () => {
  apex(true);
  const { status, body } = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  assert.equal(status, 200);
  const tools = body.result.tools;
  assert.ok(tools.length >= 7);
  holdsAll(tools, "wire");
  const doorstep = tools.find((t) => t.name === "doorstep");
  assert.deepEqual(doorstep.annotations, { readOnlyHint: true, destructiveHint: false, openWorldHint: false });
  const world = tools.find((t) => t.name === "world");
  assert.deepEqual(world.annotations, { readOnlyHint: false, destructiveHint: true, openWorldHint: false });
});
