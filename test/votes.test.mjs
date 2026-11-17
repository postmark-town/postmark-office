// votes.test.mjs — the ballot doors: stakeViaOffice, voteList/View, doorstepVotes.
//   node --test test/votes.test.mjs
// Builds a real git town-in-a-bottle with the town's OWN ballot tools copied
// from the office's town clone (the live-import contract under test).
//
// Since POS-349 a ballot is a post and a vote its response: the doors read and
// write the office's record, so this file runs on the suite's store (a real
// Postgres) and each town's ballot file is taken in as its post first, the way
// the office tick does. test/ballot-posts.test.mjs holds the class's own proofs.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { copyTownTools } from "./helpers/town-tools.mjs";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startStore } from "./helpers/embedded-store.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";

const store = await startStore({ db: "votes_test" });
Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api") });
after(() => store.stop());
const { voteList, voteView, doorstepVotes, stakeViaOffice, votesAvailable, __ballotStateForTest } = await import("../src/votes.mjs");
const { ingestBallotFiles } = await import("../src/ballots-store.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const TOWN = resolve(HERE, "..", "town-clone");

const D = (date, id, from, to) => `- ${date} · ${id} · ${from} → ${to} · thread: new`;

// Each test starts from an empty ballot board: the posts and their votes are
// cleared (the act log, append-only, keeps its rows), then the town's file is
// taken in as its post.
async function voteClone({ cap = 12, status = "staking" } = {}) {
  const dir = tempDir("office-votes-");
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  copyTownTools(TOWN, dir);

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(join(dir, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const keyFile = join(dir, "stamp-key.pem");
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));

  writeFileSync(join(dir, "tools", "github-ids.json"),
    JSON.stringify({ wright: { login: "k", id: 7 }, rei: { login: "k", id: 7 } }));

  const lines = [];
  for (let i = 1; i <= 5; i++) lines.push(D("2026-06-12", `w-${i}`, "wright", `f-${i}`));
  for (let i = 1; i <= 5; i++) lines.push(D("2026-06-13", `r-${i}`, "rei", `f-${i}`));
  for (let i = 1; i <= 5; i++) lines.push(D("2026-06-14", `w2-${i}`, "wright", `g-${i}`));
  for (let i = 1; i <= 5; i++) lines.push(D("2026-06-15", `r2-${i}`, "rei", `g-${i}`));
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), `# ledger\n\n${lines.join("\n")}\n`);

  execFileSync(process.execPath, [join(dir, "tools", "stamp-mint.mjs"), "--append", "--key", keyFile, "--repo", dir], { encoding: "utf8" });
  // production runs under stamps-v2 (declared 2026-07-13) — the fixture matches
  execFileSync(process.execPath, [join(dir, "tools", "stamp-mint.mjs"), "--declare-rules", "stamps-v2",
    "--meeps", "postmaster", "--date", "2026-06-20", "--key", keyFile, "--repo", dir], { encoding: "utf8" });

  writeFileSync(join(dir, "WHITE_PAGES", "ballot-name-vote.json"), JSON.stringify({
    topic: "name-vote", status, cap_per_household_per_candidate: cap,
    window: "one week from opening", candidates: ["lumen", "brightwork"],
  }));

  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q"); git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");

  process.env.STAMP_KEY = keyFile;
  delete process.env.TOWN_PUSH;
  const c = await store.connect("world2_owner");
  try { await c.query("DELETE FROM responses WHERE kind = 'vote'"); await c.query("DELETE FROM posts WHERE class = 'ballot'"); }
  finally { await c.end(); }
  await ingestBallotFiles(dir, { hand: "keemin" });
  return dir;
}

const kKey = { household: "keemin", handles: new Set(["wright", "rei"]) };

test("stakeViaOffice: applies, commits, second sibling clips — never bounces", async () => {
  const clone = await voteClone({ cap: 12 });
  const r1 = await stakeViaOffice(clone, { from: "wright", topic: "name-vote", candidate: "lumen", stamps: 10 }, kKey);
  assert.equal(r1.applied, 10);
  assert.equal(r1.vote_minted, true);
  assert.ok(r1.commit, "the stake is a pen commit");

  const r2 = await stakeViaOffice(clone, { from: "rei", topic: "name-vote", candidate: "lumen", stamps: 10 }, kKey);
  assert.equal(r2.applied, 2, "household cap 12 — rei fills the remainder");
  assert.equal(r2.clipped, true);

  const out = execFileSync(process.execPath, [join(clone, "tools", "stamp-verify.mjs"), "--repo", clone], { encoding: "utf8" });
  assert.ok(out.includes("all green"));
  rmSync(clone, { recursive: true, force: true });
});

test("stakeViaOffice: zero-fill is an answer; wrong handle is a 403; bad status is a 409", async () => {
  const clone = await voteClone({ cap: 10 }); // wright's balance is 10 — one stake fills the household cap exactly
  await stakeViaOffice(clone, { from: "wright", topic: "name-vote", candidate: "lumen", stamps: 10 }, kKey);
  const r = await stakeViaOffice(clone, { from: "rei", topic: "name-vote", candidate: "lumen", stamps: 3 }, kKey);
  assert.equal(r.applied, 0);
  assert.ok(r.reason.includes("headroom"));

  await assert.rejects(() => stakeViaOffice(clone, { from: "limen", topic: "name-vote", candidate: "lumen", stamps: 1 }, kKey),
    (e) => e.code === 403);
  rmSync(clone, { recursive: true, force: true });

  const early = await voteClone({ status: "submissions" });
  await assert.rejects(() => stakeViaOffice(early, { from: "wright", topic: "name-vote", candidate: "lumen", stamps: 1 }, kKey),
    (e) => e.code === 409 && /not staking/.test(e.defect));
  rmSync(early, { recursive: true, force: true });
});

test("voteList + voteView: tallies, headroom for the signed-in household", async () => {
  const clone = await voteClone({ cap: 12 });
  assert.equal(votesAvailable(clone), true);
  await stakeViaOffice(clone, { from: "wright", topic: "name-vote", candidate: "lumen", stamps: 7 }, kKey);

  const list = await voteList(clone);
  assert.equal(list.topics.length, 1);
  assert.equal(list.topics[0].topic, "name-vote");
  assert.equal(list.topics[0].candidates.find((c) => c.candidate === "lumen").staked, 7);

  const view = await voteView(clone, "name-vote", kKey);
  assert.equal(view.candidates[0].candidate, "lumen");
  assert.equal(view.candidates[0].households.length, 1);
  assert.equal(view.your_household.headroom.lumen, 5);
  assert.equal(view.your_household.headroom.brightwork, 12);

  assert.equal(await voteView(clone, "no-such-topic", kKey), null);
  rmSync(clone, { recursive: true, force: true });
});

test("doorstepVotes: open topics with the household's applied + headroom", async () => {
  const clone = await voteClone({ cap: 12 });
  await stakeViaOffice(clone, { from: "wright", topic: "name-vote", candidate: "lumen", stamps: 4 }, kKey);
  const v = await doorstepVotes(clone, "rei");
  assert.equal(v.length, 1);
  assert.equal(v[0].topic, "name-vote");
  assert.equal(v[0].candidates.lumen.household_applied, 4, "rei sees wright's stake — same household");
  assert.equal(v[0].candidates.lumen.headroom, 8);
  rmSync(clone, { recursive: true, force: true });
});

// POS-1057: the doorstep's votes section folded the town's whole stamp ledger once per resident to read one household key.
// votes.mjs keeps the fold while the clone's HEAD and the two working-tree files it reads stand.
// FLIPS, in votes.mjs § ballotStateKey: (a) drop the ledger's stamp from the key → the appended line is not seen (red at
// "a line appended"); (b) drop the commit from the key → the commit is not seen (red at "a commit").
test("POS-1057 · the ledger's fold is kept while the clone stands, and a ledger line or a commit moves it", async () => {
  const clone = await voteClone({ cap: 12 });
  const { ballotState } = await import(pathToFileURL(join(clone, "tools", "ballot.mjs")).href);
  const first = await __ballotStateForTest(clone);
  assert.equal(await __ballotStateForTest(clone), first, "the second read is the first read's fold, not another");
  assert.equal(first.householdOf("rei", "2026-11-17"), ballotState(clone).householdOf("rei", "2026-11-17"), "and it answers what the engine's own fold answers");

  // a line appended before its commit: the working tree's ledger moved
  await stakeViaOffice(clone, { from: "wright", topic: "name-vote", candidate: "lumen", stamps: 4 }, kKey);
  const staked = await __ballotStateForTest(clone);
  assert.notEqual(staked, first, "a line appended to the ledger is a new fold");
  assert.equal(staked.stakes.length, ballotState(clone).stakes.length, "which holds the stake the old one did not");
  assert.equal(staked.stakes.length, first.stakes.length + 1);

  // a commit that touches neither file's bytes: HEAD moved
  const held = await __ballotStateForTest(clone);
  assert.equal(held, staked, "kept again once it stands");
  execFileSync("git", ["-C", clone, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "--allow-empty", "-m", "a commit"], { encoding: "utf8" });
  assert.notEqual(await __ballotStateForTest(clone), held, "a commit is a new fold");
  rmSync(clone, { recursive: true, force: true });
});
