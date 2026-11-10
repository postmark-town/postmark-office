// ballot-human-stake.test.mjs — the household's human stakes on a ballot from the site (POS-502).
//
//   node --import ./test/helpers/sparse-guard.mjs --test --test-timeout=300000 test/ballot-human-stake.test.mjs
//
// Resident-on-behalf v1 (Darko 10-22: "can act OBO of their resident if
// needed"; Wright 11-09 23:48Z): the human picks one of their OWN household's
// residents, that resident's purse pays, and H4 records the human's hand, the
// resident `for`, and the site route. On the suite's store (a real Postgres,
// migration 079 and all) and a town-in-a-bottle holding the pinned town's own
// engine and verifier, through the household door as server.mjs drives it (the
// request's route scope, the requesting key noted, the channel from the header):
//
//   1. THE PREVIEW writes nothing (no line, no commit, no act, no vote) and says
//      what the stake then does, clip and all.
//   2. THE HUMAN'S STAKE: the vote act reads hand "human", for the resident,
//      route "site"; the ledger line is the resident's, `via: web`; the town
//      verifies. Two residents of one household share the cap (the human
//      cannot multiply headroom by switching resident), and a zero outcome is
//      an answer that names its reason.
//   3. THE REFUSALS write nothing: no key, another household's resident, a
//      resident the key does not hold, a choice not on the ballot, a ballot
//      not staking.
//   4. THE OTHER HANDS keep their own: an agent's own key at the site is its
//      own hand; an MCP stake is the resident's, by mcp, `via: api`.
//
// THE FLIPS: the residents carried to the child, an agent's key kept off the
// wheel, the channel's `via`, and the preview's early return.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { copyTownTools } from "./helpers/town-tools.mjs";
import { join, resolve, dirname } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startStore } from "./helpers/embedded-store.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const TOWN = join(ROOT, "town-clone");

const store = await startStore({ db: "ballot_human_stake_test" });
Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), WORLD2_PG_IDLE_TX_MS: "2000" });
delete process.env.TOWN_PUSH;
after(() => store.stop());

const { ingestBallotFiles, ballotWithVotes } = await import("../src/ballots-store.mjs");
const { stakeViaOffice } = await import("../src/votes.mjs");
const { ballotPostId } = await import("../src/ballots.mjs");
const { withRoute, noteRequester, routeOfRequest } = await import("../src/act-provenance.mjs");
const { channelOf } = await import("../src/channel.mjs");

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = publicKey.export({ type: "spki", format: "pem" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const scratch = tempDir("ballot-human-stake-");
after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }));
const KEY_FILE = join(scratch, "stamp-key.pem");
writeFileSync(KEY_FILE, PEM);
process.env.STAMP_KEY = KEY_FILE;
process.env.TOWN_LOCK = join(scratch, "town.lock");

const D = (date, id, from, to) => `- ${date} · ${id} · ${from} → ${to} · thread: new`;
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
const node = (dir, tool, args) => execFileSync(process.execPath, [join(dir, "tools", tool), ...args], { encoding: "utf8", cwd: dir });
const verifies = (dir) => spawnSync(process.execPath, [join(dir, "tools", "stamp-verify.mjs"), "--repo", dir], { encoding: "utf8" });
const ledger = (dir) => readFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), "utf8");

// wright and rei: ONE engine household (one GitHub id), 15 stamps each; ada her own, 10. Cap 20 (call 5a).
let n = 0;
function town(topic, { status = "staking" } = {}) {
  const dir = join(scratch, `town-${++n}`);
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  copyTownTools(TOWN, dir);
  writeFileSync(join(dir, "tools", "stamp-pubkey.pem"), PUB);
  writeFileSync(join(dir, "tools", "github-ids.json"),
    JSON.stringify({ wright: { login: "k", id: 7 }, rei: { login: "k", id: 7 }, ada: { login: "a", id: 9 } }));
  const lines = [];
  const days = { wright: ["2026-06-01", "2026-06-02", "2026-06-03"], rei: ["2026-06-04", "2026-06-05", "2026-06-06"], ada: ["2026-06-07", "2026-06-08"] };
  for (const [who, dates] of Object.entries(days))
    for (const date of dates) for (let i = 1; i <= 5; i++) lines.push(D(date, `${who}-${date}-${i}`, who, `pen-pal-${i}`));
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), `# ledger\n\n${lines.join("\n")}\n`);
  node(dir, "stamp-mint.mjs", ["--append", "--key", KEY_FILE, "--repo", dir]);
  node(dir, "stamp-mint.mjs", ["--declare-rules", "stamps-v2", "--meeps", "postmaster", "--date", "2026-06-20", "--key", KEY_FILE, "--repo", dir]);
  writeFileSync(join(dir, "WHITE_PAGES", `ballot-${topic}.json`), JSON.stringify({ topic, title: `The ${topic} vote`, status,
    cap_per_household_per_candidate: 20, candidates: ["lumen", "vela"], notes: ["stakes are escrow"] }, null, 2));
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}

async function q(sql, args = []) {
  const c = await store.connect("world2_owner");
  try { return (await c.query(sql, args)).rows; } finally { await c.end(); }
}
const voteActs = (topic) => q("SELECT actor, hand, for_handle, route, payload FROM acts WHERE class = 'ballot' AND action = 'vote' AND object = $1 ORDER BY id", [ballotPostId(topic)]);

// the household's human, signed in on the site: an OAuth key holds the whole house (named-hand.mjs § handsOf)
const HUMAN = { household: "keeminlee", handles: new Set(["wright", "rei"]) };
// another household's human
const ADA = { household: "ada", handles: new Set(["ada"]) };
// rei's agent's own key, in the same house
const REI_AGENT = { household: "keeminlee", handles: new Set(["wright", "rei"]), heldBy: "resident", claimedHandle: "rei" };

/** One request at the household door as server.mjs drives it: the route scope, the requester noted, the channel from the header. */
function atTheDoor(headers, key, fields) {
  const req = { url: "/household", headers };
  return withRoute(routeOfRequest(req), async () => {
    if (key) noteRequester(key);
    return stakeViaOffice(process.env.TOWN_CLONE, fields, key, { channel: channelOf(headers) });
  });
}
const SITE = { "x-postmark-channel": "web" };
const refusedWith = (p, code, re) => assert.rejects(p, (e) => {
  assert.equal(e.code, code, `${e.code}: ${e.defect}`);
  if (re) assert.match(`${e.defect} ${e.hint ?? ""}`, re);
  return true;
});

// ── 1 · the preview ─────────────────────────────────────────────────────────

test("1 · the preview writes nothing, and says what the stake then does", async () => {
  const t = "preview-vote";
  const dir = town(t);
  process.env.TOWN_CLONE = dir;
  await ingestBallotFiles(dir, { hand: "keemin" });
  const before = { ledger: ledger(dir), head: git(dir, "rev-parse", "HEAD").trim() };

  const p = await atTheDoor(SITE, HUMAN, { from: "rei", topic: t, candidate: "lumen", stamps: 25, preview: true });
  assert.equal(p.preview, true);
  assert.deepEqual([p.requested, p.applied, p.clipped, p.household_headroom_before, p.household_headroom_after, p.balance_before, p.vote_minted],
    [25, 15, true, 20, 5, 15, true], "rei's 25 would clip to her 15 stamps; the first stake mints +1");
  assert.equal(p.balance_after, 1);
  assert.match(p.to_confirm, /stake-vote/);
  assert.ok(p.nothing_written);
  assert.equal(ledger(dir), before.ledger, "no line");
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), before.head, "no commit");
  assert.equal(git(dir, "status", "--porcelain").trim(), "", "nothing left on the clone");
  assert.deepEqual(await voteActs(t), [], "no act");
  assert.deepEqual((await ballotWithVotes(t)).votes, [], "no vote");

  // the stake it previewed does exactly that
  const s = await atTheDoor(SITE, HUMAN, { from: "rei", topic: t, candidate: "lumen", stamps: 25 });
  assert.deepEqual([s.applied, s.household_headroom_after, s.balance_after, s.vote_minted], [p.applied, p.household_headroom_after, p.balance_after, p.vote_minted]);

  // a preview of a zero outcome names its reason, and writes nothing either
  const z = await atTheDoor(SITE, HUMAN, { from: "wright", topic: t, candidate: "lumen", stamps: 10, preview: true });
  assert.deepEqual([z.applied, z.household_headroom_before], [5, 5], "wright has the household's 5 left on lumen");
  const head = git(dir, "rev-parse", "HEAD").trim();
  await refusedWith(atTheDoor(SITE, HUMAN, { from: "rei", topic: t, candidate: "lumen", stamps: 1, preview: "yes" }), 422, /preview is true or false/);
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), head);
});

// ── 2 · the human's stake ───────────────────────────────────────────────────

test("2 · the human stakes as their resident: H4 says human, for the resident, by the site; the line is the resident's, via web; one household's cap is shared", async () => {
  const t = "human-vote";
  const dir = town(t);
  process.env.TOWN_CLONE = dir;
  await ingestBallotFiles(dir, { hand: "keemin" });

  const s1 = await atTheDoor(SITE, HUMAN, { from: "wright", topic: t, candidate: "vela", stamps: 12 });
  assert.deepEqual([s1.applied, s1.clipped, s1.household_headroom_after], [12, false, 8]);
  let acts = await voteActs(t);
  assert.deepEqual(acts.map((a) => [a.actor, a.hand, a.for_handle, a.route]), [["wright", "human", "wright", "site"]],
    "the human's hand, for wright, by the site (act-provenance.mjs § the human acts for a resident)");
  assert.match(ledger(dir), /- \d{4}-\d{2}-\d{2} · wright → stake:human-vote\/vela · 12 · via: web/, "the line is wright's own, via web");

  // the human switches to rei: the household's 20 on vela is shared, so rei's 12 clips to the 8 left
  const s2 = await atTheDoor(SITE, HUMAN, { from: "rei", topic: t, candidate: "vela", stamps: 12 });
  assert.deepEqual([s2.requested, s2.applied, s2.clipped, s2.household_headroom_before, s2.household_headroom_after], [12, 8, true, 8, 0],
    "two residents of one household cannot multiply its headroom");
  // and with nothing left, the stake is an answer naming why, writing nothing
  const lines = ledger(dir);
  const s3 = await atTheDoor(SITE, HUMAN, { from: "wright", topic: t, candidate: "vela", stamps: 1 });
  assert.deepEqual([s3.applied, s3.reason], [0, "your household has no headroom left on this candidate"]);
  assert.equal(ledger(dir), lines);
  // another choice has its own 20
  const s4 = await atTheDoor(SITE, HUMAN, { from: "rei", topic: t, candidate: "lumen", stamps: 3 });
  assert.deepEqual([s4.applied, s4.household_headroom_before], [3, 20]);

  acts = await voteActs(t);
  assert.deepEqual(acts.map((a) => [a.actor, a.hand, a.for_handle, a.route, a.payload.via]),
    [["wright", "human", "wright", "site", "web"], ["rei", "human", "rei", "site", "web"], ["rei", "human", "rei", "site", "web"]]);
  assert.equal(verifies(dir).status, 0, "the town verifies every line");
  assert.equal(git(dir, "status", "--porcelain").trim(), "", "each stake landed by the pen");
});

// ── 3 · the refusals ────────────────────────────────────────────────────────

test("3 · signed out, another household's resident, a resident the key does not hold, a choice not on the ballot, a ballot not staking: refused, nothing written", async () => {
  const t = "refusal-vote";
  const dir = town(t);
  process.env.TOWN_CLONE = dir;
  await ingestBallotFiles(dir, { hand: "keemin" });
  const before = { ledger: ledger(dir), head: git(dir, "rev-parse", "HEAD").trim() };

  await refusedWith(atTheDoor(SITE, null, { from: "rei", topic: t, candidate: "lumen", stamps: 1 }), 403, /not one of your residents/);
  await refusedWith(atTheDoor(SITE, ADA, { from: "rei", topic: t, candidate: "lumen", stamps: 1 }), 403, /"rei" is not one of your residents/);
  await refusedWith(atTheDoor(SITE, HUMAN, { from: "ada", topic: t, candidate: "lumen", stamps: 1 }), 403, /"ada" is not one of your residents/);
  await refusedWith(atTheDoor(SITE, HUMAN, { from: "rei", topic: t, candidate: "nobody", stamps: 1 }), 422, /not on the ballot/);
  await refusedWith(atTheDoor(SITE, HUMAN, { from: "rei", topic: t, candidate: "lumen", stamps: 0 }), 422, /at least 1/);
  await refusedWith(atTheDoor(SITE, HUMAN, { from: "rei", topic: t, candidate: "nobody", stamps: 1, preview: true }), 422, /not on the ballot/);

  const closed = "closed-vote";
  const dir2 = town(closed, { status: "submissions" });
  process.env.TOWN_CLONE = dir2;
  await ingestBallotFiles(dir2, { hand: "keemin" });
  await refusedWith(atTheDoor(SITE, HUMAN, { from: "rei", topic: closed, candidate: "lumen", stamps: 1 }), 409, /not staking/);

  process.env.TOWN_CLONE = dir;
  assert.equal(ledger(dir), before.ledger);
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), before.head);
  assert.deepEqual(await voteActs(t), []);
  assert.deepEqual(await voteActs(closed), []);
});

// ── 3b · the household door itself ──────────────────────────────────────────

test("3b · household { do: \"stake-vote\" } from the site, as the site calls it: preview, then the stake, by the human's hand, via web", async () => {
  const t = "door-vote";
  const dir = town(t);
  process.env.TOWN_CLONE = dir;
  await ingestBallotFiles(dir, { hand: "keemin" });
  const { householdApex } = await import("../src/household-apex.mjs");
  const door = (args) => withRoute("site", async () => { noteRequester(HUMAN); return householdApex({ do: "stake-vote", args }, HUMAN, { clone: dir, canWrite: true, channel: "web" }); });
  const unwrap = (r) => (r?.result && typeof r.result === "object" ? r.result : r);

  const p = unwrap(await door({ from: "rei", topic: t, candidate: "vela", stamps: 4, preview: true }));
  assert.deepEqual([p.preview, p.applied], [true, 4], JSON.stringify(p).slice(0, 300));
  assert.deepEqual(await voteActs(t), []);
  const s = unwrap(await door({ from: "rei", topic: t, candidate: "vela", stamps: 4 }));
  assert.equal(s.applied, 4, JSON.stringify(s).slice(0, 300));
  assert.deepEqual((await voteActs(t)).map((a) => [a.hand, a.for_handle, a.route, a.payload.via]), [["human", "rei", "site", "web"]]);
  const refused = await door({ from: "ada", topic: t, candidate: "vela", stamps: 1 });
  assert.ok(refused.refused === true || refused.error === "bounce", JSON.stringify(refused).slice(0, 300));
  assert.equal((await voteActs(t)).length, 1);
});

// ── 4 · the other hands ─────────────────────────────────────────────────────

test("4 · an agent's own key at the site stakes as its own hand; an MCP stake is the resident's, by mcp, via api", async () => {
  const t = "hands-vote";
  const dir = town(t);
  process.env.TOWN_CLONE = dir;
  await ingestBallotFiles(dir, { hand: "keemin" });

  await atTheDoor(SITE, REI_AGENT, { from: "rei", topic: t, candidate: "lumen", stamps: 2 });
  const mcp = { url: "/mcp", headers: {} };
  await withRoute(routeOfRequest(mcp), async () => { noteRequester(HUMAN); return stakeViaOffice(dir, { from: "wright", topic: t, candidate: "lumen", stamps: 2 }, HUMAN); });
  await atTheDoor({}, HUMAN, { from: "wright", topic: t, candidate: "vela", stamps: 1 });

  assert.deepEqual((await voteActs(t)).map((a) => [a.actor, a.hand, a.for_handle, a.route, a.payload.via]), [
    ["rei", "rei", "rei", "site", "web"],          // an agent's own key is never the human's wheel, whatever header it sends
    ["wright", "wright", "wright", "mcp", "api"],   // the resident's own stake, by mcp
    ["wright", "wright", "wright", "api", "api"],   // the REST door, no site header
  ]);
  assert.equal(verifies(dir).status, 0);
});
