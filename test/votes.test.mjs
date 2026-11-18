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
import { mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
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

// ── POS-1140 · a Hearth candidate's design title rides the votes reads ──────────────────────────────────────────────
//
// Darko, 2026-11-18 16:57 EST: "the ballot box shows household names instead of theme/design names for each entry, it should show the theme
// name and by {household}". The votes reads add each candidate's `title`, read from PROJECTS/household-hearths/<candidate>/hearth.md frontmatter at
// the supplied town clone (CORE-126 is the site half). Missing file = no title key (not null, not a guess). Candidate ids, credit, link, note, tallies,
// headroom and staking are unchanged. The fixture SUPPLIES the hearth files (the CI sparse town has none), and each leg first asserts they are there.
// FLIP: take the title spread out of votes.mjs § wordsOf → every title assertion below goes red.

const hearthDir = (clone, id) => join(clone, "PROJECTS", "household-hearths", id);
const putHearth = (clone, id, text) => { mkdirSync(hearthDir(clone, id), { recursive: true }); writeFileSync(join(hearthDir(clone, id), "hearth.md"), text); };
const WINDOW = "---\ntitle: The Working Window\nauthor: the-window-household\n---\n\nA warm window above the dark river.\n";

test("POS-1140 · both reads carry the Hearth design's title; a candidate with no hearth.md carries no title key; nothing else moves", async () => {
  const clone = await voteClone({ cap: 12 });
  const before = await voteList(clone);
  const beforeView = await voteView(clone, "name-vote", kKey);
  assert.ok(before.topics[0].candidates.every((c) => !("title" in c)), "no hearth files, no titles");

  putHearth(clone, "lumen", WINDOW);                          // a titled design; brightwork has no file (the Illuminator case)
  assert.equal(readFileSync(join(hearthDir(clone, "lumen"), "hearth.md"), "utf8"), WINDOW, "the fixture supplies the file (not an absent asset behind an empty assertion)");
  await stakeViaOffice(clone, { from: "wright", topic: "name-vote", candidate: "lumen", stamps: 7 }, kKey);

  const list = await voteList(clone);
  const view = await voteView(clone, "name-vote", kKey);
  const L = list.topics[0].candidates, V = view.candidates;
  assert.equal(L.find((c) => c.candidate === "lumen").title, "The Working Window", "the list");
  assert.equal(V.find((c) => c.candidate === "lumen").title, "The Working Window", "the topic read");
  for (const rows of [L, V]) assert.ok(!("title" in rows.find((c) => c.candidate === "brightwork")), "no file: the key is absent, not null, not the name");
  assert.deepEqual(L.map((c) => c.title ?? null), V.map((c) => c.title ?? null), "list and topic agree");

  // ADDITIVE: strip the title and every other byte of each row is what it was; ids and order, tallies, headroom unchanged
  const strip = (rows) => rows.map(({ title, ...rest }) => rest);
  assert.deepEqual(strip(L).map((c) => c.candidate), before.topics[0].candidates.map((c) => c.candidate), "ids and order");
  assert.deepEqual(strip(L).find((c) => c.candidate === "lumen"), { candidate: "lumen", credit: null, link: null, note: null, added: null, staked: 7, backing_households: 1 });
  assert.deepEqual(Object.keys(V.find((c) => c.candidate === "brightwork")).sort(), Object.keys(beforeView.candidates.find((c) => c.candidate === "brightwork")).sort(), "an untitled row has exactly the keys it had");
  assert.equal(view.your_household.headroom.lumen, 5);
  assert.equal(view.your_household.headroom.brightwork, 12);
  assert.equal(list.topics[0].title, before.topics[0].title, "the ballot's own title is the ballot's, distinct from a candidate's");

  // MCP and REST ask the same two producers: town { read: "votes" } is read_votes
  const { callTool } = await import("../src/mcp.mjs");
  const mcpList = await callTool("read_votes", {}, { canWrite: true, clone });
  const mcpView = await callTool("read_votes", { topic: "name-vote" }, { canWrite: true, clone, key: kKey });
  assert.equal(mcpList.topics[0].candidates.find((c) => c.candidate === "lumen").title, "The Working Window", "town { read: votes }");
  assert.equal(mcpView.candidates.find((c) => c.candidate === "lumen").title, "The Working Window", "town { read: votes, args: { topic } }");
  assert.ok(!("title" in mcpList.topics[0].candidates.find((c) => c.candidate === "brightwork")));
  rmSync(clone, { recursive: true, force: true });
});

test("POS-1140 · the title is read only from a regular hearth.md of a real entry folder, and only its frontmatter title", async () => {
  const { candidateTitle, ENTRY_ID, MAX_HEARTH_MD_BYTES } = await import("../src/candidate-titles.mjs");
  const clone = tempDir("office-votes-titles-");
  const T = (id) => candidateTitle(clone, id);
  putHearth(clone, "kilmartin", "---\ntitle: The Stoop\nauthor: kilmartin\n---\nbody\n");
  putHearth(clone, "default", `---\ntitle: "Postmark's default"\nauthor: postmark\n---\n`);
  putHearth(clone, "quoted", `---\ntitle: "The \\"Quoted\\" One"\n---\n`);
  putHearth(clone, "no-title", "---\nauthor: someone\n---\nbody\n");
  putHearth(clone, "blank-title", "---\ntitle:\nauthor: someone\n---\n");
  putHearth(clone, "no-fence", "title: Not In A Fence\n");
  putHearth(clone, "too-big", `---\ntitle: Huge\n---\n${"x".repeat(MAX_HEARTH_MD_BYTES)}`);
  assert.equal(T("kilmartin"), "The Stoop");
  assert.equal(T("default"), "Postmark's default");
  assert.equal(T("quoted"), 'The "Quoted" One');
  for (const nothing of ["no-title", "blank-title", "no-fence", "too-big", "no-such-folder"]) assert.equal(T(nothing), null, nothing);
  // a link is no entry, and a name that is no folder name never reaches the filesystem
  mkdirSync(hearthDir(clone, "linked"), { recursive: true });
  writeFileSync(join(clone, "outside.md"), "---\ntitle: Outside\n---\n");
  symlinkSync(join(clone, "outside.md"), join(hearthDir(clone, "linked"), "hearth.md"));
  assert.equal(T("linked"), null, "a symlinked hearth.md is not read");
  writeFileSync(join(clone, "PROJECTS", "hearth.md"), "---\ntitle: Up One\n---\n");
  for (const bad of ["..", "../household-hearths/kilmartin", "kilmartin/", "Kilmartin", "a b", "", null, undefined, 7, "x".repeat(41)]) assert.equal(T(bad), null, `${JSON.stringify(bad)}`);
  assert.equal(candidateTitle(null, "kilmartin"), null);
  // the same spelling as the registered entries' (household-hearth.mjs § HEARTH_ID)
  const { HEARTH_ID } = await import("../src/household-hearth.mjs");
  assert.equal(ENTRY_ID.source, HEARTH_ID.source);
  rmSync(clone, { recursive: true, force: true });
});

test("POS-1140 · the votes explain row names the optional candidate title", async () => {
  const { EXPLAIN } = await import("../src/read-grammar.mjs");
  const row = EXPLAIN.town.votes;
  assert.match(row.what, /optional title \(the design's own name; absent when it has none\)/);
  assert.match(row.what, /Hearth design/);
  assert.equal(row.deeper, 'town { read: "votes" }');
});
