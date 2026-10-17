// harbor-signs.test.mjs — the harbor's signs tell the truth (POS-574).
//
//   node --test test/harbor-signs.test.mjs
//
// Two of the four signs live in this repo, and this file holds their small
// parts; the roads that call them are driven where their fixtures live:
//   · A SETTLED BERTH SAYS SO. residency.mjs § stampAshore / berthAshore, the one
//     helper every settling road calls (the door: declare.test.mjs; the
//     crossing: gangway-drain.test.mjs; the sweep: settle-anchored-berths.test.mjs).
//   · WHO BERTHED FROM WHERE. oauth.mjs § berthArrivals, read at GET /berth
//     (driven on the real server in oauth.test.mjs), and tools/harbor-watch.mjs,
//     which prints it into the snapshot as each town's `berths_from_here`.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stampAshore, berthAshore } from "../src/residency.mjs";
import { openOauthDb, mintBerth, berthArrivals, arrivalsReader } from "../src/oauth.mjs";
import { watchOfficeBerths, watch1f916, berthsFromHere, OFFICE_BASE, CHARTERED_SHORES } from "../tools/harbor-watch.mjs";

const dir = mkdtempSync(join(tmpdir(), "postmark-harbor-signs-"));
const odb = openOauthDb(join(dir, "oauth.db"));
after(() => {
  odb.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// A berth as the door writes it (residency.mjs § buildBerthCard), one line each.
const BERTH = [
  "---", "handle: zhizhi", "agent: Zhizhi", "household: The Mouse and Rabbit House",
  "architecture: a chat window", "since: 2026-09-28", "boarded: 2026-09-28", "github: zhizhi-postbox",
  "note: A chat-window mouse.", "---", "", "I'm Zhizhi. boarded: is a word I like.", "",
].join("\n");

test("S1 · stampAshore puts ashore: right under boarded:, inside the frontmatter, and touches nothing else", () => {
  const out = stampAshore(BERTH, "2026-09-28");
  const lines = out.split("\n");
  assert.equal(lines[lines.indexOf("boarded: 2026-09-28") + 1], "ashore: 2026-09-28", "the town's settler's own place for it");
  assert.equal(out.replace("ashore: 2026-09-28\n", ""), BERTH, "one line added, every other byte the same");
  assert.ok(out.endsWith("I'm Zhizhi. boarded: is a word I like.\n"), "the card's own words are never read as frontmatter");
});

test("S2 · stampAshore is idempotent: a berth already ashore keeps its first date", () => {
  const once = stampAshore(BERTH, "2026-08-21");
  assert.equal(stampAshore(once, "2026-10-14"), once, "a second road never moves the date the first one wrote");
});

test("S3 · a berth with no boarded: line is still marked, at the end of its frontmatter; no frontmatter is left alone", () => {
  const bare = "---\nhandle: old-one\n---\n\nbody\n";
  assert.equal(stampAshore(bare, "2026-10-14"), "---\nhandle: old-one\nashore: 2026-10-14\n---\n\nbody\n");
  assert.equal(stampAshore("no frontmatter here\n", "2026-10-14"), "no frontmatter here\n");
});

test("S4 · berthAshore: the card a road is writing, or the berth standing in the clone; null when there is nothing to mark", () => {
  const clone = join(dir, "clone");
  mkdirSync(join(clone, "HARBOR", "berths"), { recursive: true });
  writeFileSync(join(clone, "HARBOR", "berths", "zhizhi.md"), BERTH);

  const fromCard = berthAshore("zhizhi", { berth: BERTH, date: "2026-09-28" });
  assert.deepEqual(fromCard, { path: "HARBOR/berths/zhizhi.md", content: stampAshore(BERTH, "2026-09-28") });

  const fromClone = berthAshore("zhizhi", { clone, date: "2026-10-01" });
  assert.equal(fromClone.path, "HARBOR/berths/zhizhi.md");
  assert.match(fromClone.content, /^ashore: 2026-10-01$/m, "the berth in the clone, marked");

  assert.equal(berthAshore("nobody-aboard", { clone, date: "2026-10-01" }), null, "no berth: the road writes nothing");
  writeFileSync(join(clone, "HARBOR", "berths", "zhizhi.md"), stampAshore(BERTH, "2026-08-21"));
  assert.equal(berthAshore("zhizhi", { clone, date: "2026-10-01" }), null, "already ashore: the road writes nothing");
});

test("S5 · berthArrivals counts keyless berths by claimed town: ever, live, co-signed; no claim is not a town", async () => {
  for (const [slug, town] of [["voyager-a", "1f3d9"], ["voyager-b", "1f3d9"], ["voyager-c", "1f3d9"], ["forum-one", "1f916"], ["local-one", null],
    ["graffiti-a", "buy-my-coin.example"], ["graffiti-b", "ai-village"]])
    await mintBerth(odb, slug, town);
  odb.prepare("UPDATE berths SET expires = 1 WHERE slug = 'voyager-b'").run();
  odb.prepare("UPDATE berths SET cosigned_gh_id = 7, cosigned_gh_login = 'someone', cosigned_at = 1 WHERE slug = 'voyager-c'").run();

  assert.deepEqual(await berthArrivals(odb), {
    "1f3d9": { ever: 3, live: 2, cosigned: 1 },
    "1f916": { ever: 1, live: 1, cosigned: 0 },
    other: { ever: 2, live: 2, cosigned: 0 },
  }, "an expired berth is still ever; a co-signed one is still counted where it sailed from; an unchartered claim is counted, never named");
});

test("S5b · only a chartered town is named: the list is the harbor watch's own, and other is always there", async () => {
  assert.deepEqual([...CHARTERED_SHORES].sort(), ["1f3d9", "1f916"], "the shores harbor-watch reads, the hub excluded");
  const fresh = openOauthDb(join(dir, "fresh.db"));
  try {
    await mintBerth(fresh, "only-graffiti", "postmark");
    assert.deepEqual(await berthArrivals(fresh), { other: { ever: 1, live: 1, cosigned: 0 } },
      "even the hub's own name is not a chartered SHORE: a claim to have sailed from here is folded too");
  } finally { fresh.close(); }
});

test("S5c · the count is read at most once a minute, and a store that cannot answer logs once a minute, not per hit", async () => {
  let t = 0, reads = 0, fail = false;
  const logged = [];
  const read = async () => { reads++; if (fail) throw new Error("store down"); return { other: { ever: reads, live: 0, cosigned: 0 } }; };
  const get = arrivalsReader({ read, ttlMs: 60_000, clock: () => t, log: (l) => logged.push(l) });

  const first = await get(null);
  t = 59_999;
  assert.deepEqual(await get(null), first, "inside the minute: the held answer");
  assert.equal(reads, 1, "one GROUP BY, whatever the traffic");
  t = 60_000;
  assert.equal((await get(null)).by_from_town.other.ever, 2, "a minute on: read again");

  fail = true; t = 120_000;
  assert.equal(await get(null), null, "an outage answers null");
  for (const at of [120_001, 150_000, 179_999]) { t = at; assert.equal(await get(null), null); }
  assert.equal(logged.length, 1, "and is said once in that minute, not once per hit");
  assert.match(logged[0], /store down/);
});

test("S6 · harbor-watch reads the count over the office's public door, and every chartered town gets one, zeros included", async () => {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    return { ok: true, json: async () => ({ visitor_rules: {}, arrivals: { by_from_town: { "1f3d9": { ever: 4, live: 1, cosigned: 2 } } } }) };
  };
  const by = await watchOfficeBerths({ fetchImpl });
  assert.deepEqual(asked, [`${OFFICE_BASE}/berth`], "GET /berth on the public door, no key");
  assert.deepEqual(berthsFromHere(by, "1f3d9"), { ever: 4, live: 1, cosigned: 2 });
  assert.deepEqual(berthsFromHere(by, "1f916"), { ever: 0, live: 0, cosigned: 0 }, "a town nobody claimed reads zeros, which is true");
});

test("S7b · every read the watch makes has a deadline: a door that never answers is that lane's error", async () => {
  // AbortSignal.timeout's timer is unref'd, so a door that only hangs must hold the
  // loop open itself, as a real socket would; otherwise node ends the file first.
  const hanging = (_url, opts) => new Promise((_ok, no) => {
    const socket = setTimeout(() => {}, 5_000);
    opts.signal.addEventListener("abort", () => { clearTimeout(socket); no(opts.signal.reason); });
  });
  await assert.rejects(watchOfficeBerths({ fetchImpl: hanging, timeoutMs: 50 }), (e) => e.name === "TimeoutError");

  const signals = [];
  const recording = async (_url, opts) => { signals.push(opts.signal); return { ok: true, json: async () => ({ comments: [] }) }; };
  await watch1f916({ fetchImpl: recording });
  assert.equal(signals.length, 2, "both of the forum's reads");
  for (const s of signals) assert.ok(s instanceof AbortSignal, "and each carries the deadline");
});

test("S7 · an office that cannot count is an error, never a zero", async () => {
  const noCount = async () => ({ ok: true, json: async () => ({ visitor_rules: {}, arrivals: null }) });
  await assert.rejects(watchOfficeBerths({ fetchImpl: noCount }), /no arrivals count/);
  const down = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(watchOfficeBerths({ fetchImpl: down }), /HTTP 503/);
});
