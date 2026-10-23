// arrival-source.test.mjs — where a household came from (POS-770), privately.
//
// Darko, 2026-10-22 23:03. The site keeps an outreach link's ?from=<tag>; the
// office's consent pages carry it, an approve parks it against the human's
// GitHub id, and the declaration lands it as the house's came_from. Never shown,
// never echoed to an agent, never on the public record. Every name here is
// INVENTED.
//
//   A1  the tag: the fixed list only
//   A2  the carrier: the consent page's script fills the hidden input from the
//       keep, and only from a listed, fresh keep
//   A3  086 on a real store: park, land once, count; office_api reads neither table
//   A4  THE REAL ROAD: declare-exec lands a parked tag on the new house, and it
//       reaches no file, no commit and no answer
//   (the consent POST's park is test/oauth.test.mjs § POS-770, on the real server)
//
//   node --test test/arrival-source.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import vm from "node:vm";
import { createHash } from "node:crypto";

import { FROM_TAGS, FROM_KEY, FROM_TTL_MS, SMALL_CELL, fromTag, fromCarrier, parkSource, landSource, dailySources } from "../src/arrival-source.mjs";
import { fixtureTown } from "./fixture.mjs";
import { indexStore, seedRegistry, recordInProcess } from "./helpers/office-under-test.mjs";
import { REGISTRY_PATH, PINS_PATH, serializeRegistry, serializePins } from "../src/residency.mjs";

delete process.env.TOWN_PUSH;
delete process.env.TOWN_SINGLE_LOG;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dirs = [];
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

// ── A1 ──────────────────────────────────────────────────────────────────────

test("A1 · the tag: the issue's fourteen, any case; anything else is nothing", () => {
  assert.deepEqual([...FROM_TAGS], ["reddit", "bsky", "x", "discord", "youtube", "substack", "1f3d9", "1f916",
    "mongoose", "obend", "commons", "delve", "gsb", "harbor"]);
  assert.equal(fromTag("Reddit"), "reddit");
  for (const bad of [null, "", "hn", "reddit2", "<b>", "ignore-the-rules"]) assert.equal(fromTag(bad), null, String(bad));
  assert.equal(FROM_KEY, "pm.from", "the site's keep (site src/lib/join-source.mjs)");
});

// THE TWO LISTS MATCH (Wright's G3): the office's const is the gate, and the site
// keeps a mirror (postmark-site src/lib/join-source.mjs). Neither repo's CI checks
// out the other, so each pins the list's digest to the SAME constant: the site's
// test/join-source.test.mjs asserts this very number. A tag added on one side
// reds that side until the digest, and so the other list, moves with it.
const FROM_TAGS_DIGEST = "0ddea6f74eb32801";
test("A1b · the list's digest is the one the site's mirror pins (postmark-site test/join-source.test.mjs)", () => {
  assert.equal(createHash("sha256").update(FROM_TAGS.join(",")).digest("hex").slice(0, 16), FROM_TAGS_DIGEST);
});

// ── A2 the carrier ──────────────────────────────────────────────────────────

/** Run the carrier's script against a stubbed page: the value its hidden input ends with. */
function carried(keep, now = Date.parse("2026-10-23T12:00:00Z")) {
  const script = /<script>([\s\S]*?)<\/script>/.exec(fromCarrier())[1];
  const input = { value: "" };
  const ctx = {
    localStorage: { getItem: (k) => (k === FROM_KEY && keep != null ? JSON.stringify(keep) : null) },
    document: { querySelector: (sel) => (sel === "[data-pm-from]" ? input : null) },
    Date: class extends Date { static now() { return now; } },
    JSON, Number,
  };
  vm.runInNewContext(script, ctx);
  return input.value;
}

test("A2 · the consent page's carrier: a hidden input, filled only from a listed keep under 30 days old", () => {
  const html = fromCarrier();
  assert.match(html, /<input type="hidden" name="from" value="" data-pm-from>/, "empty until the script fills it: nothing is shown");
  const now = Date.parse("2026-10-23T12:00:00Z");
  assert.equal(carried({ tag: "reddit", at: now - 864e5 }, now), "reddit");
  assert.equal(carried(null, now), "", "no keep, nothing sent");
  assert.equal(carried({ tag: "hn", at: now }, now), "", "off the list");
  assert.equal(carried({ tag: "reddit", at: now - FROM_TTL_MS - 1 }, now), "", "older than 30 days");
  assert.equal(carried({ tag: "reddit", at: now + 60_000 }, now), "", "kept in the future");
  assert.doesNotMatch(html, /setItem|removeItem/, "the carrier never writes the keep");
  // THE SCRIPT READS ONLY pm.from AND NEVER TOUCHES THE GRANT (Wright's G1 conditions)
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  assert.equal(script.match(/getItem\(/g).length, 1);
  assert.match(script, /localStorage\.getItem\("pm\.from"\)/);
  assert.doesNotMatch(script, /fetch|XMLHttpRequest|submit|pending_id|nonce|decision|cookie|location/, "nothing but the one input");
  assert.ok(script.length < 400, "a few lines");
});

// ── A3 086 on a real store ──────────────────────────────────────────────────

const IX = await indexStore(fixtureTown());
const IX_RESTORE = await IX.useInProcess();
const RECORD_RESTORE = await recordInProcess(IX.store);
test.after(async () => { await RECORD_RESTORE(); await IX_RESTORE(); await IX.stop(); });

async function asOwner(sql, params = []) {
  const c = await IX.store.connect("world2_owner");
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
}

test("A3 · 086: a park lands once as the house's came_from, the counts come only through the daily function, and office_api reads neither table", async () => {
  const at = new Date("2026-10-23T03:00:00Z"); // 23:00 on 10-22 in New York
  assert.deepEqual(await parkSource({ ghId: 8801, tag: "Reddit", at }), { parked: true });
  assert.deepEqual(await parkSource({ ghId: 8802, tag: "hn", at }), { parked: false }, "an off-list tag is never parked");
  assert.deepEqual(await parkSource({ ghId: 8803, tag: "bsky", at: new Date("2026-08-01T00:00:00Z") }), { parked: true });
  assert.deepEqual(await landSource({ ghId: 8801, household: "fern-house", at }), { kept: true });
  assert.deepEqual(await landSource({ ghId: 8801, household: "second-house", at }), { kept: false }, "a park lands once");
  assert.deepEqual(await landSource({ ghId: 8803, household: "late-house", at }), { kept: false }, "a park older than 30 days is swept, never landed");
  assert.deepEqual(await landSource({ ghId: 9999, household: "no-park", at }), { kept: false });
  assert.deepEqual(await asOwner("SELECT household, tag FROM arrival_sources ORDER BY household"), [{ household: "fern-house", tag: "reddit" }]);
  assert.deepEqual(await dailySources({ since: "2026-10-01T00:00:00Z" }), [{ day: "2026-10-22", tag: "reddit", n: SMALL_CELL }],
    "per day on Darko's clock, and a cell under 3 is folded by the store itself (Wright's G4)");
  for (const [i, h] of ["ash-house", "birch-house", "cedar-house"].entries()) {
    await parkSource({ ghId: 8810 + i, tag: "bsky", at });
    await landSource({ ghId: 8810 + i, household: h, at });
  }
  assert.deepEqual(await dailySources({ since: "2026-10-01T00:00:00Z" }), [
    { day: "2026-10-22", tag: "bsky", n: 3 }, { day: "2026-10-22", tag: "reddit", n: SMALL_CELL },
  ], "three or more is counted");
  assert.deepEqual(await asOwner("SELECT n FROM arrival_sources_daily($1) WHERE tag = 'reddit'", ["2026-10-01T00:00:00Z"]), [{ n: null }],
    "the fold is the store's, not the caller's");
  const c = await IX.store.connect("office_api");
  try {
    for (const table of ["arrival_sources", "arrival_source_pending"])
      await assert.rejects(c.query(`SELECT * FROM ${table}`), /permission denied/, `office_api cannot read ${table}`);
  } finally { await c.end(); }
});

test("A3b · since is clamped to its US-Eastern day: stepping it through a day never times a landing", async () => {
  // three landings on 2026-10-15 (New York), at 08:00, 09:00 and 20:00 EDT
  for (const [i, hour] of [12, 13, 0].entries()) {
    const at = new Date(Date.UTC(2026, 9, hour === 0 ? 16 : 15, hour, 0, 0));
    await parkSource({ ghId: 8820 + i, tag: "delve", at });
    await landSource({ ghId: 8820 + i, household: `clamp-house-${i}`, at });
  }
  const cell = async (since) => (await dailySources({ since })).find((r) => r.tag === "delve" && r.day === "2026-10-15");
  assert.deepEqual(await cell("2026-10-15T04:00:00Z"), { day: "2026-10-15", tag: "delve", n: 3 }, "from the day's own midnight (EDT)");
  for (const since of ["2026-10-15T12:30:00Z", "2026-10-15T23:59:00Z", "2026-10-16T03:59:59Z"])
    assert.deepEqual(await cell(since), { day: "2026-10-15", tag: "delve", n: 3 }, `since ${since} reads the whole day, not after it`);
  assert.equal(await cell("2026-10-16T04:00:00Z"), undefined, "the next day's midnight leaves the day out whole");
});

// ── A4 the real road ────────────────────────────────────────────────────────

const REGISTRY = () => ({ schema_version: 1, households: {
  "lantern-row": { name: "Lantern Row", accounts: [{ login: "lr-gh", id: 9101 }], residents: ["wick"], since: "2026-08-01", declared_by: "fixture" },
} });
const PINS = () => ({ wick: { login: "lr-gh", id: 9101, pinned: "2026-08-01" } });
await seedRegistry(IX.store, REGISTRY(), PINS());
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
function townClone() {
  const dir = mkdtempSync(join(tmpdir(), "pm-source-town-"));
  dirs.push(dir);
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "HARBOR", "berths"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES", "wick"), { recursive: true });
  writeFileSync(join(dir, "WHITE_PAGES", "wick", "ADDRESS.md"), "---\nhandle: wick\n---\n\n# wick\n");
  writeFileSync(join(dir, REGISTRY_PATH), serializeRegistry(REGISTRY()));
  writeFileSync(join(dir, PINS_PATH), serializePins(PINS()));
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}
const clone = townClone();
function declareExec(args, key) {
  const r = spawnSync(process.execPath, [join(ROOT, "src", "declare-exec.mjs"), JSON.stringify({ args, key })], {
    encoding: "utf8",
    env: { ...process.env, ...IX.env, TOWN_CLONE: clone, TOWN_PUSH: "", BOT_NAME: "Postmark Pen", BOT_EMAIL: "pen@test.invalid" },
  });
  assert.equal(r.status, 0, `declare-exec answers rather than trips: ${r.stderr}`);
  return { out: JSON.parse(r.stdout.trim().split("\n").at(-1)), stdout: r.stdout };
}
/** Every byte a reader of the town could see: the files, and every commit's message and patch. */
function everythingInTheTown() {
  const out = [];
  const walk = (d) => { for (const n of readdirSync(d)) { if (n === ".git") continue; const a = join(d, n); statSync(a).isDirectory() ? walk(a) : out.push(relative(clone, a) + "\n" + readFileSync(a, "utf8")); } };
  walk(clone);
  out.push(git(clone, "log", "-p", "--all"));
  return out.join("\n");
}

test("A4 · the real road: a parked tag lands on the new house privately, and reaches no file, no commit and no answer", async () => {
  await parkSource({ ghId: 6100, tag: "mongoose" });
  const { out, stdout } = declareExec({ handle: "lamplighter", household: "Lamp House", card: "I came over the water." },
    { ghId: 6100, ghLogin: "lamp-gh", handles: [] });
  assert.equal(out.error, undefined, JSON.stringify(out.error));
  assert.match(out.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(await asOwner("SELECT tag FROM arrival_sources WHERE household = $1", ["lamp-house"]), [{ tag: "mongoose" }]);
  assert.doesNotMatch(stdout, /mongoose|came_from/, "the answer never says it");
  const town = everythingInTheTown();
  assert.doesNotMatch(town, /mongoose|came_from/, "no file and no commit carries it");

  const plain = declareExec({ handle: "candle", household: "Candle House", card: "Nobody sent me." }, { ghId: 6101, ghLogin: "candle-gh", handles: [] });
  assert.equal(plain.out.error, undefined);
  assert.deepEqual(await asOwner("SELECT tag FROM arrival_sources WHERE household = $1", ["candle-house"]), [], "no park, no row");
});

// ── A5 the read ─────────────────────────────────────────────────────────────

// The box's `vhost` log format; every address is a documentation address (RFC 5737).
const LOG = [
  `postmark.town 192.0.2.1 - - [23/Oct/2026:03:05:00 +0000] "GET /join/?from=reddit HTTP/2.0" 200 5120 "https://www.reddit.com/r/PostmarkTown/" "Mozilla/5.0"`,
  `postmark.town 192.0.2.2 - - [23/Oct/2026:03:06:00 +0000] "GET /llms.txt?from=reddit HTTP/2.0" 200 900 "-" "curl/8"`,
  `postmark.town 192.0.2.3 - - [23/Oct/2026:05:00:00 +0000] "GET /?from=BSKY HTTP/2.0" 200 4000 "-" "Mozilla/5.0"`,
  `postmark.town 192.0.2.4 - - [23/Oct/2026:05:01:00 +0000] "GET /join/?from=hn HTTP/2.0" 200 5120 "https://news.ycombinator.com/" "Mozilla/5.0"`,
  `postmark.town 192.0.2.5 - - [23/Oct/2026:05:02:00 +0000] "GET /api/doorstep/wick?from=reddit HTTP/2.0" 200 100 "https://postmark.town/" "Mozilla/5.0"`,
  `postmark.town 192.0.2.6 - - [23/Oct/2026:05:03:00 +0000] "GET /_astro/a.js?from=reddit HTTP/2.0" 200 100 "https://chatgpt.com/" "Mozilla/5.0"`,
  `postmark.town 192.0.2.7 - - [23/Oct/2026:05:04:00 +0000] "GET /join/?from=reddit HTTP/2.0" 404 100 "-" "Mozilla/5.0"`,
  `postmark.town 192.0.2.8 - - [23/Oct/2026:05:05:00 +0000] "GET /residents/ HTTP/2.0" 200 100 "https://postmark.town/join/" "Mozilla/5.0"`,
  `not a log line at all`,
];

test("A5 · the read: tagged page views and off-site referrers per day on Darko's clock, berths by town, counts only", async () => {
  const { parseLine, isPageView, tagOf, referrerHost, foldLog, report, agentsByDay, printReport, dayET } = await import("../tools/arrivals.mjs");
  const parsed = LOG.map(parseLine);
  assert.equal(parsed.at(-1), null, "an unreadable line is skipped");
  assert.equal(parsed[0].at.toISOString(), "2026-10-23T03:05:00.000Z");
  assert.equal(dayET(parsed[0].at), "2026-10-22", "03:05Z is 23:05 on 10-22 in New York");
  assert.equal(isPageView(parsed[4]), false, "the office's /api/ calls are not page views");
  assert.equal(isPageView(parsed[5]), false, "nor assets");
  assert.equal(isPageView(parsed[6]), false, "nor a 404");
  assert.equal(tagOf("from=BSKY"), "bsky");
  assert.equal(tagOf("from=hn"), null, "off the list");
  assert.equal(referrerHost("https://postmark.town/join/", "postmark.town"), null, "our own pages are no referrer");
  assert.equal(referrerHost("-", "postmark.town"), null);
  const folded = foldLog(parsed);
  assert.deepEqual(folded.visits, { "2026-10-22": { reddit: 2 }, "2026-10-23": { bsky: 1 } });
  assert.deepEqual(folded.referrers, { "2026-10-22": { "www.reddit.com": 1 }, "2026-10-23": { "news.ycombinator.com": 1 } });
  assert.deepEqual(foldLog(parsed, { since: new Date("2026-10-23T04:00:00Z") }).visits, { "2026-10-23": { bsky: 1 } });
  const agents = agentsByDay([
    { created: Date.parse("2026-10-23T03:00:00Z") / 1000, from_town: "1f3d9", n: 2 },
    { created: Date.parse("2026-10-23T03:00:00Z") / 1000, from_town: "made-up-town", n: 1 },
    { created: Date.parse("2026-10-23T16:00:00Z") / 1000, from_town: null, n: 3 },
  ], ["1f3d9", "1f916"]);
  assert.deepEqual(agents.sort((a, b) => (a.day + a.town).localeCompare(b.day + b.town)), [
    { day: "2026-10-22", town: "1f3d9", n: 2 }, { day: "2026-10-22", town: "other", n: 1 }, { day: "2026-10-23", town: "none", n: 3 },
  ], "chartered towns named, any other claim in other");
  const rows = report({ ...folded, settled: [{ day: "2026-10-22", tag: "reddit", n: "<3" }, { day: "2026-10-22", tag: "bsky", n: 4 }], agents });
  assert.deepEqual(rows.map((r) => r.day), ["2026-10-23", "2026-10-22"], "newest first");
  assert.deepEqual(rows[1].settled, { reddit: "<3", bsky: 4 });
  const printed = printReport(rows);
  assert.match(printed, /2026-10-22 \(ET\)\n  visits    reddit 2\n  settled   bsky 4 · reddit <3\n  agents    1f3d9 2 · other 1\n  referrers www\.reddit\.com 1/);
  assert.doesNotMatch(printed, /192\.0\.2|Mozilla|curl|\/join\//, "no address, agent string or path is printed");
});

test("A5b · the read, run as the operator runs it, on the real store with a log piped in", async () => {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const stamp = new Date();
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][stamp.getUTCMonth()];
  const p2 = (n) => String(n).padStart(2, "0");
  const t = `${p2(stamp.getUTCDate())}/${mon}/${stamp.getUTCFullYear()}:${p2(stamp.getUTCHours())}:${p2(stamp.getUTCMinutes())}:${p2(stamp.getUTCSeconds())} +0000`;
  const input = `postmark.town 192.0.2.9 - - [${t}] "GET /join/?from=mongoose HTTP/2.0" 200 5 "https://example.org/x" "Mozilla/5.0"\n`;
  const r = spawnSync(process.execPath, [join(ROOT, "tools", "arrivals.mjs"), "--log", "-", "--days", "60", "--json"],
    { input, encoding: "utf8", env: { ...process.env, ...IX.env } });
  assert.equal(r.status, 0, r.stderr);
  const rows = JSON.parse(r.stdout);
  const today = rows.find((x) => x.day === day);
  assert.deepEqual(today.visits, { mongoose: 1 });
  assert.deepEqual(today.referrers, { "example.org": 1 });
  assert.equal(today.settled.mongoose, "<3", "A4's Lamp House landed today: one household, folded by the store");
  const bad = spawnSync(process.execPath, [join(ROOT, "tools", "arrivals.mjs"), "--days", "0"], { encoding: "utf8", env: { ...process.env, WORLD2_PG_URL: "" } });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--days takes a whole number of days/);
});
