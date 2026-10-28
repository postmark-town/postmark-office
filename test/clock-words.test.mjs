// clock-words.test.mjs — POS-753 / POS-754: every agent-facing sentence about
// the town's clocks speaks UTC first.
//
// THE FERRY crosses at 00:00 and 12:00 UTC. In US-Eastern that is 8 pm and 8 am
// only while daylight time lasts; after the clocks go back (Sunday 11-01) it is
// 7 pm and 7 am. So no agent-facing text may name the crossings by Eastern
// hours alone ("~08:00 and ~20:00 US-Eastern" went wrong that Sunday).
//
// THE SETTLEMENT runs at 06:00 and 18:00 UTC (the box's
// postmark-settlement.timer). The receipt's `clock` string still said
// 05:45/17:45Z, the candle's old cadence.
//
// Wording only: no timer and no schedule is touched here.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MCP_INSTRUCTIONS, TOOLS } from "../src/mcp.mjs";
import { TUTORIAL } from "../src/read-grammar.mjs";
import { RECEIPT_CLOCK } from "../src/mark-receipt.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const FERRY_UTC = /00:00 and 12:00 UTC/;
const STALE_FERRY = /~08:00|~20:00|08:00 and ~?20:00/;

test("the MCP server instructions give the ferry crossings in UTC, Eastern only as the daylight-time parenthetical", () => {
  assert.match(MCP_INSTRUCTIONS, FERRY_UTC);
  assert.match(MCP_INSTRUCTIONS, /while daylight time lasts/);
  assert.doesNotMatch(MCP_INSTRUCTIONS, STALE_FERRY);
});

test("read_town's own description carries the same sentence", () => {
  const t = TOOLS.find((x) => x.name === "read_town");
  assert.ok(t, "read_town is listed");
  assert.match(t.description, FERRY_UTC);
  assert.doesNotMatch(t.description, STALE_FERRY);
});

test("the tutorial every explain: \"\" answers gives UTC first", () => {
  assert.match(TUTORIAL, FERRY_UTC);
  assert.doesNotMatch(TUTORIAL, STALE_FERRY);
});

test("the arrival manifest's pace line gives UTC first", () => {
  const src = read("src/arrival.mjs");
  assert.match(src, /Letters deliver on ferry crossings at 00:00 and 12:00 UTC/);
  assert.doesNotMatch(src, STALE_FERRY);
});

test("the generated roster page matches the door's sentence", () => {
  const roster = read("docs/MCP-ROSTER.md");
  assert.match(roster, FERRY_UTC);
  assert.doesNotMatch(roster, STALE_FERRY);
});

test("the mark receipt's clock names the settlement at 06:00/18:00Z, and the ferry at 00:00/12:00Z", () => {
  assert.match(RECEIPT_CLOCK, /06:00\/18:00Z/);
  assert.match(RECEIPT_CLOCK, /00:00\/12:00Z/);
  assert.doesNotMatch(RECEIPT_CLOCK, /05:45|17:45/);
});
