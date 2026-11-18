// arrival-source-shorts.test.mjs — per-short visit counts in the arrivals read (POS-1125; Darko, CON-25/b, 2026-11-18:
// "Yes, build it now, as the Arti recommends").
//
// A tagged link may also carry a short's id (`?from=youtube&s=<short id>`). tools/arrivals.mjs counts VISITS per short id,
// beside the tag totals it already prints, from the operator-piped access log, and never stores the id anywhere: not on a
// household, not in pm.from, not in a consent, a park or a landing. The joins' `<3` fold is the store's and is untouched.
//
// SYNTHETIC TRAFFIC ONLY: every line, address, agent and id below is invented. No live log is read.
//
//   S1  per short id, per tag, per ET day: separate ids, separate tags, the same id under two tags, two days
//   S2  what is not counted: no tag, an off-list tag, no/empty/malformed `s`, non-page-views (API, asset, 404, POST)
//   S3  the old read is unchanged: tag and referrer totals, ET days, `since`, the settled `<3` row, the old text byte for byte
//   S4  AGGREGATE ONLY: the JSON and the text carry tag, id, count and day; no address, agent, path, query, referrer URL or raw line,
//       and the fold's own output holds nothing of the parsed records
//   S5  the command, as the operator runs it (log piped in): the same counts, nothing else
//   S6  the id stays out of every other surface: the carrier, the keep's key, and the park/land/daily source writers' source text
//
//   node --test test/arrival-source-shorts.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseLine, isPageView, tagOf, shortOf, SHORT_ID, foldLog, report, printReport } from "../tools/arrivals.mjs";
import { FROM_KEY, fromCarrier } from "../src/arrival-source.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// One day's lines, in the box's vhost format. 04:00Z-05:00Z on 10-23 is 00:00-01:00 EDT on 10-23; 03:30Z on 10-23 is 23:30 EDT on 10-22.
const at = (day, hms) => `${day}:${hms} +0000`;
const L = (when, target, { status = 200, method = "GET", ref = "-", ip = "192.0.2.77", ua = "Mozilla/5.0 (X11; fixture)" } = {}) =>
  `postmark.town ${ip} - - [${when}] "${method} ${target} HTTP/2.0" ${status} 512 "${ref}" "${ua}"`;
const D22 = (hms) => at("22/Oct/2026", hms), D23 = (hms) => at("23/Oct/2026", hms);

const COUNTED = [
  L(D22("15:00:00"), "/join/?from=youtube&s=AaAa1111111"),
  L(D22("15:01:00"), "/join/?from=youtube&s=AaAa1111111", { ip: "192.0.2.78" }),
  L(D22("15:02:00"), "/join/?from=youtube&s=BbBb2222222"),
  L(D22("15:03:00"), "/llms.txt?s=AaAa1111111&from=YouTube"),                  // order and case of the tag do not matter; the id is case-sensitive
  L(D22("15:04:00"), "/join/?from=tiktok&s=AaAa1111111"),                       // the same id under another tag is its own count
  L(D22("15:05:00"), "/join/?from=tiktok&s=aaaa1111111"),                       // and ids are case-sensitive: this is a different short
  L(D23("03:30:00"), "/join/?from=youtube&s=AaAa1111111"),                      // 23:30 on 10-22 in New York: the ET day, not the UTC one
  L(D23("05:00:00"), "/join/?from=youtube&s=AaAa1111111"),                      // 01:00 on 10-23
  L(D23("05:01:00"), "/join/?from=reddit&s=Zz_9-xYz0Ab", { status: 302 }),      // a redirect is a page view; `_` and `-` are in an id
];
const NOT_COUNTED = [
  L(D22("16:00:00"), "/join/?s=AaAa1111111"),                                   // no tag: not a tagged arrival
  L(D22("16:01:00"), "/join/?from=hn&s=AaAa1111111"),                           // an off-list tag
  L(D22("16:02:00"), "/join/?from=youtube"),                                    // a tag with no short: a visit, not a short visit
  L(D22("16:03:00"), "/join/?from=youtube&s="),                                 // an empty id
  L(D22("16:04:00"), "/join/?from=youtube&s=has%20space"),                      // not an id
  L(D22("16:05:00"), "/join/?from=youtube&s=a%40b.example"),                    // an address does not pass for an id
  L(D22("16:06:00"), `/join/?from=youtube&s=${"x".repeat(65)}`),               // too long
  L(D22("16:07:00"), "/api/doorstep/wick?from=youtube&s=AaAa1111111"),          // the office's API
  L(D22("16:08:00"), "/_astro/a.js?from=youtube&s=AaAa1111111"),                // an asset
  L(D22("16:09:00"), "/join/?from=youtube&s=AaAa1111111", { status: 404 }),     // a 404
  L(D22("16:10:00"), "/join/?from=youtube&s=AaAa1111111", { method: "POST" }),  // not a GET
  "not a log line at all",
];
const LOG = [...COUNTED, ...NOT_COUNTED];
const parsed = () => LOG.map(parseLine);

test("S1 · visits per short id, per tag, per ET day: separate ids, separate tags, the same id under two tags, two days", () => {
  const { shorts } = foldLog(parsed());
  assert.deepEqual(shorts, {
    "2026-10-22": {
      youtube: { AaAa1111111: 4, BbBb2222222: 1 },   // two on the 22nd, the 23:30-EDT one and the 15:03 llms.txt one with the tag spelled YouTube
      tiktok: { AaAa1111111: 1, aaaa1111111: 1 },
    },
    "2026-10-23": { youtube: { AaAa1111111: 1 }, reddit: { "Zz_9-xYz0Ab": 1 } },
  });
});

test("S2 · what is not counted as a short visit: no tag, an off-list tag, no or malformed id, and anything that is not a page view", () => {
  const only = foldLog(NOT_COUNTED.map(parseLine));
  assert.deepEqual(only.shorts, {}, "nothing in the not-counted set is a short visit");
  assert.equal(shortOf("from=youtube&s=AaAa1111111"), "AaAa1111111");
  for (const bad of ["", "from=youtube", "s=", "s=a b", "s=a%40b.example", "s=%E2%9C%A6", `s=${"x".repeat(65)}`, "s=a/b", "s=a?b"]) assert.equal(shortOf(bad), null, bad);
  assert.equal(shortOf(`s=${"x".repeat(64)}`), "x".repeat(64), "64 is the longest");
  assert.match("AaAa1111111", SHORT_ID);
  // a short is only ever read beside a listed tag
  assert.equal(tagOf("s=AaAa1111111"), null);
  assert.equal(isPageView(parseLine(NOT_COUNTED[7])), false);
});

test("S3 · the old read is unchanged: tag and referrer totals, ET days, since, the settled <3 cell, and the old text byte for byte", () => {
  const folded = foldLog(parsed());
  // every short visit is also a visit of its tag, and a tag-only visit (no s) is still counted: nothing the old read counted moved
  assert.equal(folded.visits["2026-10-22"].youtube, 10, "youtube on the 22nd: the 5 short visits and the 5 page views whose s was absent, empty or not an id");
  const oldRead = foldLog(parsed().map((r) => (r ? { ...r, query: r.query.replace(/&?s=[^&]*/, "").replace(/^&/, "") } : r)));
  assert.deepEqual(folded.visits, oldRead.visits, "stripping every s= from the log changes no tag total");
  assert.deepEqual(folded.referrers, oldRead.referrers, "nor any referrer total");
  assert.deepEqual(foldLog(parsed(), { since: new Date("2026-10-23T04:00:00Z") }).shorts, { "2026-10-23": { youtube: { AaAa1111111: 1 }, reddit: { "Zz_9-xYz0Ab": 1 } } }, "since drops older lines from the short counts too");
  const rows = report({ ...folded, settled: [{ day: "2026-10-22", tag: "youtube", n: "<3" }, { day: "2026-10-22", tag: "reddit", n: 4 }], agents: [] });
  assert.deepEqual(rows.map((r) => r.day), ["2026-10-23", "2026-10-22"], "newest first");
  assert.deepEqual(rows[1].settled, { youtube: "<3", reddit: 4 }, "the store's folded cell passes through exactly as it was");
  // a day with no short prints exactly the old text; a day with some adds one line, last
  const plain = report({ visits: { "2026-10-22": { reddit: 2 } }, referrers: { "2026-10-22": { "www.reddit.com": 1 } }, settled: [{ day: "2026-10-22", tag: "bsky", n: 4 }, { day: "2026-10-22", tag: "reddit", n: "<3" }], agents: [{ day: "2026-10-22", town: "1f3d9", n: 2 }] });
  assert.equal(printReport(plain), "2026-10-22 (ET)\n  visits    reddit 2\n  settled   bsky 4 · reddit <3\n  agents    1f3d9 2\n  referrers www.reddit.com 1\n");
  assert.equal(printReport(plain, { log: false }).includes("shorts"), false);
  assert.deepEqual(plain[0].shorts, {}, "the JSON row gains an empty shorts, and keeps every key it had");
});

test("S4 · AGGREGATE ONLY: the output holds tag, id, count and day, and nothing of the records it was folded from", () => {
  const folded = foldLog(parsed());
  const rows = report({ ...folded, settled: [], agents: [] });
  const text = printReport(rows);
  const json = JSON.stringify(rows);
  for (const leak of ["192.0.2", "Mozilla", "fixture", "/join/", "/llms.txt", "?from", "&s=", "postmark.town", "HTTP/2.0", "a%40b", "has%20space", "has space", "example", "not a log line"])
    for (const [what, out] of [["text", text], ["json", json]]) assert.ok(!out.includes(leak), `${what} must not carry ${leak}`);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["agents", "day", "referrers", "settled", "shorts", "visits"], "the row keys: the old ones and shorts");
  // the shapes: shorts is tag -> id -> number, visits tag -> number, day a date
  for (const row of rows) {
    assert.match(row.day, /^\d{4}-\d{2}-\d{2}$/);
    for (const [tag, ids] of Object.entries(row.shorts)) {
      assert.match(tag, /^[a-z0-9]+$/);
      for (const [id, n] of Object.entries(ids)) { assert.match(id, SHORT_ID); assert.ok(Number.isInteger(n) && n > 0); }
    }
  }
  // the fold itself hands back counts only: no parsed record, no timestamp object, no address
  assert.deepEqual(Object.keys(folded).sort(), ["referrers", "shorts", "visits"]);
  const walk = (v) => (typeof v === "object" && v !== null ? Object.values(v).flatMap(walk) : [v]);
  assert.ok(walk(folded.shorts).every((n) => Number.isInteger(n)), "every leaf of shorts is a count");
  const day22 = text.split("\n\n").find((b) => b.startsWith("2026-10-22")).split("\n").filter(Boolean);
  assert.deepEqual(day22.slice(0, 2), ["2026-10-22 (ET)", "  visits    youtube 10 · tiktok 2"], "the old lines come first and print as they did");
  const shortsLine = day22.at(-1);
  assert.match(shortsLine, /^  shorts    youtube\/AaAa1111111 4 · /, "the busiest first");
  assert.deepEqual(shortsLine.slice("  shorts    ".length).split(" · ").sort(), ["tiktok/AaAa1111111 1", "tiktok/aaaa1111111 1", "youtube/AaAa1111111 4", "youtube/BbBb2222222 1"]);
});

test("S5 · the command as the operator runs it: a log piped in prints the short counts as JSON and text, and nothing else", () => {
  // the store-less read: no WORLD2_PG_URL means the settled and agent parts are empty, exactly as `node tools/arrivals.mjs` runs without a store
  const input = LOG.join("\n") + "\n";
  const run = (...flags) => spawnSync(process.execPath, [join(ROOT, "tools", "arrivals.mjs"), "--log", "-", "--days", "400", ...flags],
    { input, encoding: "utf8", env: { ...process.env, WORLD2_PG_URL: "", WORLD2_PG: "" } });
  const j = run("--json");
  if (j.status !== 0 && /store|connect|ECONN|WORLD2/i.test(j.stderr)) return; // no store in this environment: the in-process legs above are the proof
  assert.equal(j.status, 0, j.stderr);
  const rows = JSON.parse(j.stdout);
  const d22 = rows.find((r) => r.day === "2026-10-22");
  assert.deepEqual(d22?.shorts?.youtube, { AaAa1111111: 4, BbBb2222222: 1 });
  assert.ok(!j.stdout.includes("192.0.2") && !j.stdout.includes("Mozilla"));
});

test("S6 · the id stays out of every other surface: the carrier, the keep's key, and the sources that park, land and count households", () => {
  assert.equal(FROM_KEY, "pm.from");
  assert.ok(!/\bs=|short/i.test(fromCarrier()), "the consent carrier carries a listed tag and no short id");
  const source = readFileSync(join(ROOT, "src", "arrival-source.mjs"), "utf8");
  assert.ok(!/shortOf|SHORT_ID|short id|\bshort\b/i.test(source), "src/arrival-source.mjs (park, land, the daily cells, the carrier) never names a short");
  const sql = readFileSync(join(ROOT, "world2", "schema", "086_arrival_sources.sql"), "utf8");
  assert.ok(!/short/i.test(sql), "and the store's table and its <3 fold know none");
});
