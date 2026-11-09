// ballot-full-post.test.mjs — the ballot becomes a full post (POS-983).
//
//   node --import ./test/helpers/sparse-guard.mjs --test --test-timeout=300000 test/ballot-full-post.test.mjs
//
// Darko, POS-684 call 4 and call 5 (2026-11-09): the existing ballot class
// (POS-349) is put up, amended, advanced and closed by the town's hands through
// the post acts; `posts?class=ballot` reads it; choices carry a name, a credit,
// a link and a one-line note and may join while staking runs, keeping their
// stake identity; the count is raw stamps, capped at 20 per household per
// choice, with backing households shown and breaking a tie; every reader
// carries it. On the suite's store (a real Postgres) and a town-in-a-bottle
// holding the town's OWN tools from the pinned clone:
//
//   1. AUTHORITY: a town hand's credential puts a ballot up through the town
//      door; another resident, and an agent's own key standing as a hand,
//      are refused before anything is written. posts?class=ballot reads it.
//   2. THE MONEY PATH: a credited choice joins while staking runs; stakes land
//      through the direct door and by mail on the old choice and the new;
//      the post, the town's engine and its verifier agree, every earlier
//      choice and stake stands, and the stake's answer and the mail receipt
//      name the choice in its words. Two residents of one engine household
//      share the 20 on a choice (a clip, not a bounce) while another choice
//      has its own 20. The close act closes it, and the close ceremony
//      returns every stamp whole.
//   3. THE TERMS ONLY GROW once staking opens: a file that takes a choice
//      away or moves the cap is refused by the ingest, and a closed ballot is
//      not amended.
//   4. THE COUNT: raw stamps, never weighted by breadth; equal raw totals go
//      to more backing households.
//   5. LEGACY: a bare-name ballot (the illuminator-name file's shape) reads
//      with no words, and an act on a legacy staking file keeps the keys it
//      does not name.
//   6. WHOLE OR NOTHING: a file the pen cannot land leaves no act, no post and
//      the file as it stood; a file and post that disagree refuse the act.
//
// THE FLIPS (the lane's paperwork names each red line): the hand gate, the
// append-only rule, the households tie-break and the act's put-back.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { copyTownTools } from "./helpers/town-tools.mjs";
import { join, resolve, dirname } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startStore } from "./helpers/embedded-store.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const TOWN = join(ROOT, "town-clone");

const store = await startStore({ db: "ballot_full_post_test" });
Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), WORLD2_PG_IDLE_TX_MS: "2000" });
delete process.env.TOWN_PUSH;
after(() => store.stop());

const { ingestBallotFiles, ballotWithVotes, ballotActInStore, townEngine } = await import("../src/ballots-store.mjs");
const { voteList, voteView, stakeViaOffice } = await import("../src/votes.mjs");
const { ballotPassRun } = await import("../tools/ballot-pass-run.mjs");
const { check } = await import("../tools/ballots-backfill.mjs");
const { ballotPostId, tallyOf } = await import("../src/ballots.mjs");
const { postAtTown, amendAtTown, advanceAtTown, closeAtTown } = await import("../src/events-store.mjs");
const { postsAtOffice } = await import("../src/town-posts.mjs");

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = publicKey.export({ type: "spki", format: "pem" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const scratch = tempDir("ballot-full-post-");
after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }));
const KEY_FILE = join(scratch, "stamp-key.pem");
writeFileSync(KEY_FILE, PEM);
process.env.STAMP_KEY = KEY_FILE;
process.env.TOWN_LOCK = join(scratch, "town.lock");

const D = (date, id, from, to) => `- ${date} · ${id} · ${from} → ${to} · thread: new`;
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
const node = (dir, tool, args) => execFileSync(process.execPath, [join(dir, "tools", tool), ...args], { encoding: "utf8", cwd: dir });
const verifies = (dir) => spawnSync(process.execPath, [join(dir, "tools", "stamp-verify.mjs"), "--repo", dir], { encoding: "utf8" });
const fileOf = (dir, topic) => JSON.parse(readFileSync(join(dir, "WHITE_PAGES", `ballot-${topic}.json`), "utf8"));

// wright and rei are ONE engine household (one GitHub id), 15 stamps each; ada is her own, 10.
// The mint caps a household's sends at 5 a day, so each resident's letters are on days of their own.
let n = 0;
function town({ ballot = null } = {}) {
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
  if (ballot) writeFileSync(join(dir, "WHITE_PAGES", `ballot-${ballot.topic}.json`), JSON.stringify(ballot, null, 2));
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
const ballotActs = async (topic) => (await q("SELECT action, actor, payload FROM acts WHERE class = 'ballot' AND object = $1 AND action <> 'vote' ORDER BY id", [ballotPostId(topic)]));

// a human's household key holds every handle it lists: wright is a town hand (named-hand.mjs § handsOf)
const HANDS = { household: "keemin", handles: new Set(["wright", "rei"]) };
// ada's own household key: a resident, not a hand
const ADA = { household: "ada", handles: new Set(["ada"]) };
// rei's agent's own key, in the same house as wright: it stands as rei and no other
const REI_AGENT = { household: "keemin", handles: new Set(["wright", "rei"]), heldBy: "resident", claimedHandle: "rei" };

const refusedWith = (p, code, re) => assert.rejects(p, (e) => {
  assert.equal(e.code, code, `${e.code}: ${e.defect}`);
  if (re) assert.match(`${e.defect} ${e.hint ?? ""}`, re);
  return true;
});

// ── 1 · authority, and the read ─────────────────────────────────────────────

test("1 · only a town hand's own credential puts a ballot up, and posts?class=ballot reads it", async () => {
  const t = "hearth-one";
  const dir = town();
  process.env.TOWN_CLONE = dir;
  const up = { class: "ballot", topic: t, title: "Choose the town's Hearth",
    body: "Which household design becomes the Hearth.\nEntries: https://postmark.town/hearth/", window: "four weeks",
    choices: [{ name: "ember-house", credit: "ada", link: "https://github.com/postmark-town/postmark/pull/1", note: "a hearth with a reading nook" }] };

  await refusedWith(postAtTown(up, ADA), 403, /only the town's hands/);
  await refusedWith(postAtTown({ ...up, handle: "wright" }, REI_AGENT), 403, /not this key's own hand/);
  await refusedWith(postAtTown({ ...up, handle: "ada" }, HANDS), 403, /not one of your residents/);
  assert.equal(existsSync(join(dir, "WHITE_PAGES", `ballot-${t}.json`)), false, "a refused act writes no file");
  assert.deepEqual(await ballotActs(t), [], "a refused act writes no act");

  const head = git(dir, "rev-parse", "HEAD").trim();
  const a = await postAtTown(up, HANDS);
  assert.equal(a.hand, "wright");
  assert.deepEqual(a.did, ["post"]);
  assert.deepEqual([a.post.id, a.post.class, a.post.author, a.post.state], [ballotPostId(t), "ballot", "postmark-pen", "submissions"]);
  assert.match(a.receipt, /by wright's hand/);
  // the file and the post are one: the pen committed the file the act wrote, and the post took it in
  assert.notEqual(git(dir, "rev-parse", "HEAD").trim(), head);
  assert.equal(git(dir, "status", "--porcelain").trim(), "", "the act's file is committed, nothing left loose");
  assert.equal(a.commit, git(dir, "rev-parse", "HEAD").trim());
  const file = fileOf(dir, t);
  assert.deepEqual([file.status, file.cap_per_household_per_candidate, file.candidates], ["submissions", 20, ["ember-house"]],
    "the cap is the ruled 20 per household per choice");
  assert.deepEqual(file.notes, ["Which household design becomes the Hearth.", "Entries: https://postmark.town/hearth/"]);
  assert.match(file.choices["ember-house"].added, /^\d{4}-\d{2}-\d{2}$/);
  const [act] = await ballotActs(t);
  assert.deepEqual([act.actor, act.action, act.payload.hand], ["postmark-pen", "post", "wright"]);
  assert.equal((await ingestBallotFiles(dir, { hand: "keemin" })).topics.find((x) => x.topic === t).did.length, 0,
    "the tick finds the file and the post already one");

  // a topic is put up once
  await refusedWith(postAtTown(up, HANDS), 409, /already up/);

  // posts?class=ballot: the full post — its body, its terms, each choice in its words, its history
  const list = await postsAtOffice({ class: "ballot" }, { townClone: dir });
  assert.deepEqual(list.finished, ["closed"]);
  const p = list.posts.find((x) => x.id === ballotPostId(t));
  assert.equal(p.body, up.body);
  assert.equal(p.title, up.title);
  assert.deepEqual(p.choices, [{ candidate: "ember-house", credit: "ada", link: up.choices[0].link, note: "a hearth with a reading nook", added: file.choices["ember-house"].added }]);
  assert.deepEqual(p.history.map((h) => [h.stage, h.hand]), [["submissions", "wright"]]);
  const one = await postsAtOffice({ class: "ballot", post: ballotPostId(t) }, { townClone: dir });
  assert.equal(one.post.id, ballotPostId(t));

  // nor does a non-hand carry it, at any verb
  const id = ballotPostId(t);
  await refusedWith(amendAtTown({ post: id, title: "mine now" }, ADA), 403);
  await refusedWith(advanceAtTown({ post: id, to: "staking" }, ADA), 403);
  await refusedWith(closeAtTown({ post: id }, ADA), 403);
  await refusedWith(advanceAtTown({ post: id, to: "staking", handle: "wright" }, REI_AGENT), 403);
  assert.equal((await ballotWithVotes(t)).post.state, "submissions");
  assert.equal(fileOf(dir, t).status, "submissions");
});

// ── 2 · the money path ──────────────────────────────────────────────────────

test("2 · a credited choice joins while staking runs; direct and mail stakes land on old and new; post, engine and verifier agree; the 20 is shared by one household and the close returns everything", async () => {
  const t = "hearth-two";
  const dir = town();
  process.env.TOWN_CLONE = dir;
  const id = ballotPostId(t);
  await postAtTown({ class: "ballot", topic: t, title: "The Hearth", choices: [{ name: "lumen" }, { name: "brightwork", credit: "dot" }] }, HANDS);
  // a choice is not staked before staking opens
  await refusedWith(stakeViaOffice(dir, { from: "wright", topic: t, candidate: "lumen", stamps: 1 }, HANDS), 409, /not staking/);
  const adv = await advanceAtTown({ post: id, to: "staking" }, HANDS);
  assert.deepEqual([adv.post.state, fileOf(dir, t).status], ["staking", "staking"]);
  await refusedWith(advanceAtTown({ post: id, to: "staking" }, HANDS), 409);

  // stakes on the original choices
  const s1 = await stakeViaOffice(dir, { from: "wright", topic: t, candidate: "lumen", stamps: 4 }, HANDS);
  assert.equal(s1.applied, 4);
  assert.deepEqual(s1.choice, { candidate: "lumen", credit: null, link: null, note: null, added: s1.choice.added, staked: 4, backing_households: 1 },
    "the answer carries the choice's standing with this stake in it");

  // a credited choice joins while staking runs
  const vela = { name: "vela", credit: "ada", link: "https://github.com/postmark-town/postmark/pull/2", note: "a quiet one" };
  const am = await amendAtTown({ post: id, choices: [vela] }, HANDS);
  assert.deepEqual(am.post.fields.candidates, ["lumen", "brightwork", "vela"], "the new choice joins at the end; every name before it stands in its place");
  assert.equal(am.post.state, "staking");
  assert.deepEqual(fileOf(dir, t).candidates, ["lumen", "brightwork", "vela"]);
  // a choice named again has the words it is sent with replaced, and keeps its place and stakes
  await amendAtTown({ post: id, choices: [{ name: "lumen", note: "the first entry" }] }, HANDS);
  assert.deepEqual(fileOf(dir, t).candidates, ["lumen", "brightwork", "vela"]);
  assert.equal(fileOf(dir, t).choices.lumen.note, "the first entry");
  // a name the ledger could not carry is refused
  await refusedWith(amendAtTown({ post: id, choices: [{ name: "two words" }] }, HANDS), 422, /letters, digits and hyphens/);
  await refusedWith(amendAtTown({ post: id, choices: [{ name: "x", link: "javascript:alert(1)" }] }, HANDS), 422, /https/);

  // THE CAP: wright and rei are one engine household — 20 on vela between them, clipped, never bounced
  const s2 = await stakeViaOffice(dir, { from: "wright", topic: t, candidate: "vela", stamps: 9 }, HANDS);
  assert.deepEqual([s2.applied, s2.clipped], [9, false]);
  assert.deepEqual(s2.choice, { candidate: "vela", credit: "ada", link: vela.link, note: "a quiet one", added: s2.choice.added, staked: 9, backing_households: 1 },
    "the stake's answer names the choice in its words, and its standing");
  const s3 = await stakeViaOffice(dir, { from: "rei", topic: t, candidate: "vela", stamps: 14 }, HANDS);
  assert.deepEqual([s3.requested, s3.applied, s3.clipped, s3.household_headroom_before, s3.household_headroom_after], [14, 11, true, 11, 0],
    "rei's 14 clips to the 11 the household has left of 20 on vela");
  assert.deepEqual([s3.choice.staked, s3.choice.backing_households], [20, 1], "rei backs vela in wright's household: still ONE household, not two");
  // a stake with nothing left to apply is an answer, and it still names the choice and its standing
  const s3b = await stakeViaOffice(dir, { from: "rei", topic: t, candidate: "vela", stamps: 2 }, HANDS);
  assert.deepEqual([s3b.applied, s3b.reason], [0, "your household has no headroom left on this candidate"]);
  assert.deepEqual([s3b.choice.credit, s3b.choice.note, s3b.choice.staked, s3b.choice.backing_households], ["ada", "a quiet one", 20, 1]);
  // …and another choice has its own 20: rei's stake on lumen is not touched by vela's
  const s4 = await stakeViaOffice(dir, { from: "rei", topic: t, candidate: "lumen", stamps: 3 }, HANDS);
  assert.deepEqual([s4.applied, s4.household_headroom_before], [3, 16], "lumen's headroom is 20 less wright's 4 there, nothing of vela's");
  // ada's own household has its own 20 on vela
  const s5 = await stakeViaOffice(dir, { from: "ada", topic: t, candidate: "vela", stamps: 2 }, ADA);
  assert.deepEqual([s5.applied, s5.household_headroom_before], [2, 20]);
  assert.deepEqual([s5.choice.staked, s5.choice.backing_households], [22, 2], "ada's is a second household");

  // BY MAIL, on the old choice and the new
  const inbox = join(dir, "WHITE_PAGES", "postmaster", "inbox");
  mkdirSync(inbox, { recursive: true });
  const letter = (lid, from, cand, stamps) => writeFileSync(join(inbox, `${lid}.md`),
    `---\nid: ${lid}\nfrom: ${from}\nto: postmaster\nstake_topic: ${t}\nstake_candidate: ${cand}\nstake_stamps: ${stamps}\n---\n\nmy ballot\n`);
  letter("ada-2026-11-09-to-postmaster-vela", "ada", "vela", 3);
  letter("ada-2026-11-09-to-postmaster-bright", "ada", "brightwork", 1);
  // rei's household has nothing left on vela: this one applies zero
  letter("rei-2026-11-09-to-postmaster-vela", "rei", "vela", 2);
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "three ballots by mail");
  const mail = await ballotPassRun(dir, PEM, "2026-11-09");
  assert.deepEqual([mail.processed, mail.receipts, mail.held], [3, 3, []]);
  const outbox = join(dir, "WHITE_PAGES", "postmaster", "outbox");
  const receiptFor = (lid) => readdirSync(outbox).map((f) => readFileSync(join(outbox, f), "utf8")).find((s) => s.includes(`receipt_for: ${lid}`));
  const receipt = receiptFor("ada-2026-11-09-to-postmaster-vela");
  assert.match(receipt, /\*\*3 of 3\*\* stamp\(s\) staked on \*\*vela\*\*/);
  assert.match(receipt, /^\*\*vela\*\*: by ada · a quiet one · https:\/\/github\.com\/postmark-town\/postmark\/pull\/2 · 2 households backing it, 25 stamp\(s\) staked$/m,
    "the mail receipt names the choice in its words and its standing, this stake in it");
  assert.match(receiptFor("ada-2026-11-09-to-postmaster-bright"), /^\*\*brightwork\*\*: by dot · 1 household backing it, 1 stamp\(s\) staked$/m);
  const zero = receiptFor("rei-2026-11-09-to-postmaster-vela");
  assert.match(zero, /no stamps could apply/);
  assert.match(zero, /^\*\*vela\*\*: by ada · a quiet one · https:\/\/github\.com\/postmark-town\/postmark\/pull\/2 · 2 households backing it, 25 stamp\(s\) staked$/m,
    "a zero-applied receipt keeps the choice's words and its standing; rei's house is counted once");

  // THE POST, THE ENGINE AND THE VERIFIER AGREE
  assert.equal(verifies(dir).status, 0, `the town's verifier: ${verifies(dir).stdout}${verifies(dir).stderr}`);
  const c = await check(dir);
  assert.equal(c.equal, true, c.differences.join("\n"));
  const { ballot } = await townEngine(dir);
  const engine = ballot.tally(dir, t);
  const one = await ballotWithVotes(t);
  assert.deepEqual(one.post.fields.candidates, ballot.readBallot(dir, t).candidates, "the post's choices are the file's, in its order");
  const mine = tallyOf(one.post, one.votes);
  const shape = (rows) => rows.map(({ candidate, staked, households }) => ({ candidate, staked, households }));
  assert.deepEqual(shape(mine.candidates), shape(engine.candidates), "the store's tally IS the engine's");
  assert.deepEqual(mine.candidates.map((x) => [x.candidate, x.staked, x.backing_households]),
    [["vela", 25, 2], ["lumen", 7, 1], ["brightwork", 1, 1]], "raw stamps: wright 9 + rei 11 + ada 2 + ada 3 by mail on vela");

  // every reader carries the words and the count
  const view = await voteView(dir, t, HANDS);
  assert.deepEqual([view.title, view.post], ["The Hearth", id]);
  assert.deepEqual(view.candidates.map((x) => [x.candidate, x.credit, x.note, x.backing_households]),
    [["vela", "ada", "a quiet one", 2], ["lumen", null, "the first entry", 1], ["brightwork", "dot", null, 1]]);
  assert.deepEqual(view.your_household.headroom, { vela: 0, lumen: 13, brightwork: 20 });
  const list = (await voteList(dir)).topics.find((x) => x.topic === t);
  assert.deepEqual(list.candidates.map((x) => [x.candidate, x.staked, x.backing_households, x.link]),
    [["vela", 25, 2, vela.link], ["lumen", 7, 1, null], ["brightwork", 1, 1, null]]);

  // THE CLOSE: the act closes the file and the post; the ceremony returns every stamp whole
  const before = ballot.ballotState(dir).balances;
  const closed = await closeAtTown({ post: id }, HANDS);
  assert.deepEqual([closed.post.state, fileOf(dir, t).status], ["closed", "closed"]);
  assert.match(closed.returns, /ballot\.mjs --close hearth-two/);
  await refusedWith(stakeViaOffice(dir, { from: "ada", topic: t, candidate: "vela", stamps: 1 }, ADA), 409, /not staking/);
  await refusedWith(amendAtTown({ post: id, choices: [{ name: "late" }] }, HANDS), 409, /closed/);
  await refusedWith(closeAtTown({ post: id }, HANDS), 409, /already closed/);
  node(dir, "ballot.mjs", ["--close", t, "--date", "2026-11-10", "--key", KEY_FILE, "--repo", dir]);
  assert.equal(verifies(dir).status, 0);
  const after = ballot.ballotState(dir).balances;
  assert.deepEqual(["wright", "rei", "ada"].map((h) => after.get(h) - before.get(h)), [13, 14, 6], "every stake returns whole: wright 4+9, rei 11+3, ada 2+3+1");
  assert.deepEqual((await ballotWithVotes(t)).post.fields.candidates, ["lumen", "brightwork", "vela"]);
  assert.deepEqual((await postsAtOffice({ class: "ballot", post: id }, { townClone: dir })).post.history.map((h) => h.stage),
    ["submissions", "staking", "closed"]);
});

// ── 3 · once staking opens, the terms only grow ─────────────────────────────

test("3 · once staking opens nothing is taken away: a file that drops a choice or moves the cap is refused by name, and the post stands", async () => {
  const t = "grow-only";
  const dir = town({ ballot: { topic: t, title: "Grow only", status: "submissions", cap_per_household_per_candidate: 20, candidates: ["a", "b"] } });
  await ingestBallotFiles(dir, { hand: "keemin" });
  // before staking, the hand may reshape it freely
  writeFileSync(join(dir, "WHITE_PAGES", `ballot-${t}.json`), JSON.stringify({ topic: t, title: "Grow only", status: "staking", cap_per_household_per_candidate: 20, candidates: ["b", "c"] }));
  assert.deepEqual((await ingestBallotFiles(dir, { hand: "keemin" })).topics.find((x) => x.topic === t).did, ["amend", "advance"]);
  for (const [why, body, re] of [
    ["a choice taken away", { candidates: ["c"] }, /lose or move "b"/],
    ["a choice renamed", { candidates: ["bee", "c"] }, /lose or move "b"/],
    ["the order moved", { candidates: ["c", "b"] }, /lose or move/],
    ["the cap moved", { candidates: ["b", "c"], cap_per_household_per_candidate: 10 }, /cap would move from 20 to 10/],
  ]) {
    writeFileSync(join(dir, "WHITE_PAGES", `ballot-${t}.json`), JSON.stringify({ topic: t, title: "Grow only", status: "staking", cap_per_household_per_candidate: 20, ...body }));
    const r = await ingestBallotFiles(dir, { hand: "keemin" });
    const refused = r.refused.find((x) => x.topic === t);
    assert.ok(refused, why);
    assert.match(refused.defect, re, why);
  }
  const { post } = await ballotWithVotes(t);
  assert.deepEqual([post.state, post.fields.candidates, post.fields.cap_per_household_per_candidate], ["staking", ["b", "c"], 20]);
  // a choice joining at the end is taken in
  writeFileSync(join(dir, "WHITE_PAGES", `ballot-${t}.json`), JSON.stringify({ topic: t, title: "Grow only", status: "staking", cap_per_household_per_candidate: 20, candidates: ["b", "c", "d"] }));
  assert.deepEqual((await ingestBallotFiles(dir, { hand: "keemin" })).topics.find((x) => x.topic === t).did, ["amend"]);
});

// ── 4 · the count ───────────────────────────────────────────────────────────

test("4 · the count is raw stamps, never weighted by breadth, and equal raw totals go to more backing households", () => {
  const post = { state: "staking", fields: { topic: "count", candidates: ["narrow", "broad", "tied-one", "tied-two"], cap_per_household_per_candidate: 20 } };
  let act = 0;
  const vote = (handle, stakes) => ({ handle, fields: { stakes: stakes.map(([candidate, n, mint_key]) => ({ act: ++act, candidate, n, mint_key })) } });
  const votes = [
    // narrow: 6 raw from ONE household (two residents of it); broad: 5 raw from TWO.
    // A breadth-weighted count would put broad first; the ruled count (call 5b) is raw.
    vote("wright", [["narrow", 4, "gh:7"], ["tied-one", 2, "gh:7"]]),
    vote("rei", [["narrow", 2, "gh:7"]]),
    vote("dot", [["broad", 3, "solo:dot"], ["tied-two", 1, "solo:dot"]]),
    vote("ada", [["broad", 2, "gh:9"], ["tied-two", 1, "gh:9"]]),
  ];
  const t = tallyOf(post, votes);
  assert.deepEqual(t.candidates.map((c) => [c.candidate, c.staked, c.backing_households]),
    [["narrow", 6, 1], ["broad", 5, 2], ["tied-two", 2, 2], ["tied-one", 2, 1]],
    "raw leads; at 2 each, tied-two's two households lead tied-one's one, though tied-one is first in the file");
  assert.deepEqual(t.candidates[0].households.map((h) => [h.household, h.applied, Object.keys(h.handles).sort()]), [["gh:7", 6, ["rei", "wright"]]],
    "two residents of one engine household are one backing household");
  // with no stakes anywhere, the file's order stands
  assert.deepEqual(tallyOf(post, []).candidates.map((c) => c.candidate), ["narrow", "broad", "tied-one", "tied-two"]);
});

// ── 5 · legacy ──────────────────────────────────────────────────────────────

test("5 · a bare-name ballot reads with no words, and an act on a legacy file keeps every key it does not name", async () => {
  const dir = town({ ballot: { topic: "illuminator-like", title: "Name the Illuminator", status: "closed", cap_per_household_per_candidate: 20,
    window: "one week", opens: "2026-07-20", closes: "2026-07-27", candidates: ["Iris", "Alba"], notes: ["stakes are escrow"],
    board: "TOWN_BULLETIN/README.md", result: "Iris, 77–50" } });
  writeFileSync(join(dir, "WHITE_PAGES", "ballot-legacy-staking.json"), JSON.stringify({ topic: "legacy-staking", title: "An older vote",
    status: "staking", cap_per_household_per_candidate: 20, candidates: ["Iris"], board: "TOWN_BULLETIN/README.md", opens: "2026-11-01" }, null, 2));
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "an older staking vote");
  process.env.TOWN_CLONE = dir;
  await ingestBallotFiles(dir, { hand: "keemin" });

  const legacy = (await voteList(dir)).topics.find((x) => x.topic === "illuminator-like");
  assert.deepEqual(legacy.candidates, [
    { candidate: "Iris", credit: null, link: null, note: null, added: null, staked: 0, backing_households: 0 },
    { candidate: "Alba", credit: null, link: null, note: null, added: null, staked: 0, backing_households: 0 },
  ]);
  const { post } = await ballotWithVotes("illuminator-like");
  assert.equal(post.fields.choices, undefined, "a bare-name file's post carries no choices map");
  await refusedWith(amendAtTown({ post: post.id, title: "renamed" }, HANDS), 409, /closed/);

  // an act on the legacy staking file: the choice joins, its words beside it, every other key as it was
  await amendAtTown({ post: ballotPostId("legacy-staking"), choices: [{ name: "Vera", credit: "ada" }] }, HANDS);
  const f = fileOf(dir, "legacy-staking");
  assert.deepEqual([f.candidates, f.board, f.opens, f.status], [["Iris", "Vera"], "TOWN_BULLETIN/README.md", "2026-11-01", "staking"]);
  assert.deepEqual(Object.keys(f.choices), ["Vera"], "only the choice given words carries them; Iris stays a bare name");
  const view = await voteView(dir, "legacy-staking", null);
  assert.deepEqual(view.candidates.map((x) => [x.candidate, x.credit]), [["Iris", null], ["Vera", "ada"]]);
});

// ── 6 · whole or nothing ────────────────────────────────────────────────────

test("6 · a file the pen cannot land leaves no act and the file as it stood; a file the office has not taken in refuses the act", async () => {
  const t = "whole";
  const dir = town();
  process.env.TOWN_CLONE = dir;
  const path = join(dir, "WHITE_PAGES", `ballot-${t}.json`);

  // a put-up whose push cannot land: no file, no post, no act
  const notLanded = () => ({ error: { code: 503, defect: "the pen could not land the commit", hint: "nothing was recorded" } });
  await refusedWith(ballotActInStore({ clone: dir, verb: "post", args: { topic: t, title: "Whole" }, hand: "wright", today: "2026-11-09", land: notLanded }), 503, /could not land/);
  assert.equal(existsSync(path), false);
  assert.equal(await ballotWithVotes(t), null);
  assert.deepEqual(await ballotActs(t), []);

  await postAtTown({ class: "ballot", topic: t, title: "Whole", choices: [{ name: "a" }] }, HANDS);
  const bytes = readFileSync(path, "utf8");
  // an amend whose push cannot land: the file is put back byte for byte, and the post did not move
  await refusedWith(ballotActInStore({ clone: dir, verb: "amend", args: { post: ballotPostId(t), choices: [{ name: "b" }] }, hand: "wright", today: "2026-11-09", land: notLanded }), 503);
  assert.equal(readFileSync(path, "utf8"), bytes);
  assert.deepEqual((await ballotWithVotes(t)).post.fields.candidates, ["a"]);
  assert.equal((await ballotActs(t)).length, 1);

  // the founder's hand moved the file and the tick has not taken it in: an act refuses rather than carry it in
  writeFileSync(path, JSON.stringify({ ...JSON.parse(bytes), title: "Edited by hand" }, null, 2));
  await refusedWith(amendAtTown({ post: ballotPostId(t), choices: [{ name: "b" }] }, HANDS), 409, /file and its post disagree/);
  // the hand of the ingest itself is judged as before
  await refusedWith(ballotActInStore({ clone: dir, verb: "close", args: { post: ballotPostId(t) }, hand: "ada", today: "2026-11-09" }), 403, /not a hand/);
});
