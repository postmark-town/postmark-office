// ballot-posts.test.mjs — ballots are posts and votes their responses (POS-349).
//
//   node --test --test-timeout=300000 test/ballot-posts.test.mjs
//
// On the suite's store (a real Postgres, test/helpers/embedded-store.mjs) and a
// town-in-a-bottle holding the town's OWN tools copied from the pool's town
// clone (ballot.mjs, ballot-pass.mjs, stamp-mint.mjs, stamp-verify.mjs, envelope.mjs):
//
//   1. the ingest takes the founder's ballot file in as the town's post, moves
//      it forward as the file moves, writes nothing twice, and refuses a file
//      that goes back;
//   2. the stake door writes the vote and the ledger line together: the clip
//      and the household cap are the town engine's (the mint key), the reads
//      answer the engine's own tally from the posts, and the town verifies;
//   3. the guards: a file the post has not taken in, and a ledger stake the
//      store lacks, refuse before anything is written; --check names the
//      missing line, the backfill records it, and the stake goes through;
//   4. a ledger the pen cannot land rolls the store back: no act, no vote;
//   5. the office's ballot pass writes the SAME bytes as the town's (ledger and
//      receipt), records the vote, and never processes a letter twice;
//   6. the backfill of a ballot staked, mailed and closed the old way: --check
//      equal (counts, stamps), the store's tally equals the engine's, a second
//      run writes nothing, and the rebuild folds the acts into the same rows.
//
// THE FLIP (the lane's paperwork names the red line): take the headroom guard
// out of stakeInStore and 3 goes red: the stake lands past the household cap
// and the town's verifier refuses the ledger.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startStore } from "./helpers/embedded-store.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const TOWN_TOOLS = join(ROOT, "town-clone", "tools");
const TOOL_FILES = ["stamp-mint.mjs", "stamp-verify.mjs", "ballot.mjs", "ballot-pass.mjs", "envelope.mjs"]; // envelope: ballot-pass imports its HANDLE_RE (town c56d61663, POS-386)

const store = await startStore({ db: "ballot_posts_test" });
// A write transaction never spans non-SQL work (Wright's review of #415): the
// whole file runs with the store's idle-in-transaction budget at 2 s, so a
// stake that held its transaction open across the town's verify (or any other
// CPU) is killed here as the mint pass was in the #415 sandbox.
Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), WORLD2_PG_IDLE_TX_MS: "2000" });
delete process.env.TOWN_PUSH;
after(() => store.stop());

const { ingestBallotFiles, stakeInStore, ballotWithVotes, voteRows, townEngine } = await import("../src/ballots-store.mjs");
const { voteList, voteView, doorstepVotes, stakeViaOffice } = await import("../src/votes.mjs");
const { ballotPassRun } = await import("../tools/ballot-pass-run.mjs");
const { backfill, check } = await import("../tools/ballots-backfill.mjs");
const { ballotPostId, stakesOf, tallyOf } = await import("../src/ballots.mjs");
const { dryRun } = await import("../world2/tools/events-rebuild.mjs");
const { penTransaction } = await import("../src/write.mjs");

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = publicKey.export({ type: "spki", format: "pem" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const scratch = mkdtempSync(join(tmpdir(), "ballot-posts-"));
after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }));
const KEY_FILE = join(scratch, "stamp-key.pem");
writeFileSync(KEY_FILE, PEM);
process.env.STAMP_KEY = KEY_FILE;

const D = (date, id, from, to) => `- ${date} · ${id} · ${from} → ${to} · thread: new`;
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
const node = (dir, tool, args) => execFileSync(process.execPath, [join(dir, "tools", tool), ...args], { encoding: "utf8", cwd: dir });

let n = 0;
/** A town with wright and rei in one household (one GitHub id), lumen and brightwork on `topic`. */
function town(topic, { cap = 12, status = "staking", mint = true } = {}) {
  const dir = join(scratch, `town-${++n}`);
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  for (const f of TOOL_FILES) copyFileSync(join(TOWN_TOOLS, f), join(dir, "tools", f));
  writeFileSync(join(dir, "tools", "stamp-pubkey.pem"), PUB);
  writeFileSync(join(dir, "tools", "github-ids.json"),
    JSON.stringify({ wright: { login: "k", id: 7 }, rei: { login: "k", id: 7 }, ada: { login: "a", id: 9 } }));
  const lines = [];
  for (let i = 1; i <= 5; i++) lines.push(D("2026-06-12", `w-${i}`, "wright", `f-${i}`));
  for (let i = 1; i <= 5; i++) lines.push(D("2026-06-13", `r-${i}`, "rei", `f-${i}`));
  for (let i = 1; i <= 5; i++) lines.push(D("2026-06-14", `w2-${i}`, "wright", `g-${i}`));
  for (let i = 1; i <= 5; i++) lines.push(D("2026-06-15", `r2-${i}`, "rei", `g-${i}`));
  for (let i = 1; i <= 5; i++) lines.push(D("2026-06-15", `a-${i}`, "ada", `g-${i}`));
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), `# ledger\n\n${lines.join("\n")}\n`);
  if (mint) {
    node(dir, "stamp-mint.mjs", ["--append", "--key", KEY_FILE, "--repo", dir]);
    node(dir, "stamp-mint.mjs", ["--declare-rules", "stamps-v2", "--meeps", "postmaster", "--date", "2026-06-20", "--key", KEY_FILE, "--repo", dir]);
  }
  writeBallot(dir, topic, { cap, status });
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");   // the pen's restore must hand back the bytes it took
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}
function writeBallot(dir, topic, { cap = 12, status = "staking", candidates = ["lumen", "brightwork"] } = {}) {
  writeFileSync(join(dir, "WHITE_PAGES", `ballot-${topic}.json`), JSON.stringify({
    topic, title: `A vote on ${topic}`, status, cap_per_household_per_candidate: cap,
    window: "one week from opening", candidates, notes: ["stakes are escrow"],
  }, null, 2));
}
const ledger = (dir) => readFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
const verifies = (dir) => spawnSync(process.execPath, [join(dir, "tools", "stamp-verify.mjs"), "--repo", dir], { encoding: "utf8" });

async function q(sql, args = []) {
  const c = await store.connect("world2_owner");
  try { return (await c.query(sql, args)).rows; } finally { await c.end(); }
}
const ballotActs = async (topic) => Number((await q("SELECT count(*)::int AS n FROM acts WHERE class = 'ballot' AND object = $1", [ballotPostId(topic)]))[0].n);
const votesOf = async (topic) => (await ballotWithVotes(topic))?.votes ?? [];

const KEY = { household: "keemin", handles: new Set(["wright", "rei"]) };

// ── 1 · the ingest ──────────────────────────────────────────────────────────

test("1 · the founder's file is taken in as the town's post, moves forward with it, and never back", async () => {
  const t = "ingest-vote";
  const dir = town(t, { status: "submissions" });
  await assert.rejects(ingestBallotFiles(dir, { hand: "errant" }), (e) => e.code === 403 && /not a hand/.test(e.defect));

  const first = await ingestBallotFiles(dir, { hand: "keemin" });
  assert.deepEqual(first.topics.map((x) => [x.topic, x.did]), [[t, ["post"]]]);
  const { post } = await ballotWithVotes(t);
  assert.deepEqual([post.id, post.class, post.author, post.state], [`postmark-pen/ballot-${t}`, "ballot", "postmark-pen", "submissions"]);
  assert.deepEqual(post.fields, { topic: t, candidates: ["lumen", "brightwork"], cap_per_household_per_candidate: 12,
    window: "one week from opening", file: `WHITE_PAGES/ballot-${t}.json` });
  const [act] = await q("SELECT actor, action, payload FROM acts WHERE object = $1", [post.id]);
  assert.deepEqual([act.actor, act.action, act.payload.hand], ["postmark-pen", "post", "keemin"]);

  const again = await ingestBallotFiles(dir, { hand: "keemin" });
  assert.deepEqual(again.topics[0].did, [], "a second ingest writes nothing");
  assert.equal(await ballotActs(t), 1);

  writeBallot(dir, t, { status: "staking", candidates: ["lumen", "brightwork", "vela"] });
  const moved = await ingestBallotFiles(dir, { hand: "wright" });
  assert.deepEqual(moved.topics[0].did, ["amend", "advance"], "the new candidate is an amendment, the status an advance");
  const staking = (await ballotWithVotes(t)).post;
  assert.equal(staking.state, "staking");
  assert.deepEqual(staking.fields.candidates, ["lumen", "brightwork", "vela"]);

  writeBallot(dir, t, { status: "closed", candidates: ["lumen", "brightwork", "vela"] });
  assert.deepEqual((await ingestBallotFiles(dir, { hand: "wright" })).topics[0].did, ["close"]);
  writeBallot(dir, t, { status: "staking", candidates: ["lumen", "brightwork", "vela"] });
  const back = await ingestBallotFiles(dir, { hand: "wright" });
  assert.match(back.refused[0].defect, /stands closed and its file says staking/);
  assert.equal((await ballotWithVotes(t)).post.state, "closed", "a ballot never moves back");
  assert.equal(await ballotActs(t), 4);
});

// ── 2 · the stake door ──────────────────────────────────────────────────────

test("2 · the stake writes the vote and the line together; the reads answer the engine's tally from the posts", async () => {
  const t = "door-vote";
  const dir = town(t, { cap: 12 });
  await ingestBallotFiles(dir, { hand: "keemin" });

  const r1 = await stakeViaOffice(dir, { from: "wright", topic: t, candidate: "lumen", stamps: 10 }, KEY);
  assert.equal(r1.applied, 10);
  assert.equal(r1.vote_minted, true);
  assert.ok(r1.commit && r1.act_id, `a pen commit and a vote act: ${JSON.stringify(r1)}`);
  const r2 = await stakeViaOffice(dir, { from: "rei", topic: t, candidate: "lumen", stamps: 10 }, KEY);
  assert.deepEqual([r2.applied, r2.clipped, r2.household_headroom_before], [2, true, 2], "one household (one GitHub id): rei fills the remainder");
  const r3 = await stakeViaOffice(dir, { from: "rei", topic: t, candidate: "lumen", stamps: 1 }, KEY);
  assert.deepEqual([r3.applied, r3.act_id], [0, undefined], "a zero fill is an answer and writes nothing");
  assert.match(r3.reason, /headroom/);
  await assert.rejects(stakeViaOffice(dir, { from: "limen", topic: t, candidate: "lumen", stamps: 1 }, KEY), (e) => e.code === 403);

  assert.equal(verifies(dir).status, 0, `the town verifies the ledger the door wrote: ${verifies(dir).stdout}`);
  const votes = await votesOf(t);
  assert.deepEqual(votes.map((v) => [v.handle, v.kind, v.fields.stakes.map((s) => [s.candidate, s.n, s.via])]),
    [["rei", "vote", [["lumen", 2, "api"]]], ["wright", "vote", [["lumen", 10, "api"]]]]);
  const lines = ledger(dir).trimEnd().split("\n");
  const sigs = lines.filter((l) => l.includes(`stake:${t}/`)).map((l) => / · sig: (\S+)$/.exec(l)[1]);
  assert.deepEqual(stakesOf(votes).map((s) => s.sig), sigs, "each vote names its ledger line by signature, in ledger order");
  assert.equal(stakesOf(votes)[0].mint_key, stakesOf(votes)[1].mint_key, "one household, by the engine's mint key");

  // the reads: the engine's own tally from the ledger, answered from the posts
  const { ballot } = await townEngine(dir);
  const engine = ballot.tally(dir, t);
  const view = await voteView(dir, t, KEY);
  assert.deepEqual(view.candidates, engine.candidates, "the store's tally IS the engine's");
  assert.deepEqual([view.topic, view.status, view.cap_per_household_per_candidate, view.window],
    [engine.topic, engine.status, engine.cap_per_household_per_candidate, engine.window]);
  assert.deepEqual(view.your_household.headroom, { lumen: 0, brightwork: 12 });
  const list = await voteList(dir);
  const mine = list.topics.find((x) => x.topic === t);
  assert.deepEqual(mine.candidates, [{ candidate: "lumen", staked: 12 }, { candidate: "brightwork", staked: 0 }]);
  const door = (await doorstepVotes(dir, "rei")).find((x) => x.topic === t);
  assert.deepEqual(door.candidates.lumen, { household_applied: 12, headroom: 0 });
  assert.equal(await voteView(dir, "no-such-topic", KEY), null);
});

// ── 3 · the guards, --check and the backfill ────────────────────────────────

test("3 · a file not yet taken in, and a ledger stake the store lacks, refuse before anything is written", async () => {
  const t = "guard-vote";
  const dir = town(t, { cap: 12 });
  await ingestBallotFiles(dir, { hand: "keemin" });

  // the founder closed the file; the tick has not taken it in
  writeBallot(dir, t, { status: "closed" });
  const before = ledger(dir);
  await assert.rejects(stakeViaOffice(dir, { from: "wright", topic: t, candidate: "lumen", stamps: 3 }, KEY),
    (e) => e.code === 409 && /file and its post disagree/.test(e.defect));
  assert.equal(ledger(dir), before);
  assert.equal(await ballotActs(t), 1);
  writeBallot(dir, t, { status: "staking" });

  // a stake the store never recorded (the old engine, straight to the ledger):
  // the store would see 12 headroom where the ledger sees 4
  const { ballot } = await townEngine(dir);
  ballot.clipApply(dir, { handle: "wright", topic: t, candidate: "lumen", n: 8, via: "api", date: "2026-10-01" }, PEM);
  await assert.rejects(stakeViaOffice(dir, { from: "rei", topic: t, candidate: "lumen", stamps: 10 }, KEY),
    (e) => e.code === 503 && /disagree on ballot "guard-vote" \(headroom 12 from the votes, 4 from the ledger\)/.test(e.defect));
  assert.equal(verifies(dir).status, 0, "nothing past the cap reached the ledger");

  const red = await check(dir);
  assert.equal(red.equal, false);
  assert.ok(red.differences.some((d) => /the ledger's stake wright → lumen · 8 .* is on no vote/.test(d)), red.differences.join("\n"));

  const plan = await backfill(dir, { hand: "keemin" });
  assert.equal(plan.would_record.length, 1);
  assert.equal(await ballotActs(t), 1, "the plan writes nothing");
  const done = await backfill(dir, { hand: "keemin", apply: true });
  assert.equal(done.recorded.length, 1);
  assert.equal((await check(dir)).equal, true);

  const r = await stakeViaOffice(dir, { from: "rei", topic: t, candidate: "lumen", stamps: 10 }, KEY);
  assert.equal(r.applied, 4, "the household's real headroom, once the store holds every stake");
  assert.equal(verifies(dir).status, 0);
  assert.equal((await check(dir)).equal, true);
});

// ── 4 · a ledger the pen cannot land ────────────────────────────────────────

test("4 · a ledger the pen cannot land rolls the store back: no act, no vote, and the clone as it was", async () => {
  const t = "land-vote";
  const dir = town(t, { cap: 12 });
  await ingestBallotFiles(dir, { hand: "keemin" });
  const acts = await ballotActs(t);
  const before = ledger(dir);
  // as stake-exec runs it: the stake inside the pen's transaction, which puts the clone back on a refusal
  const stake = (land) => penTransaction(dir, async () => {
    try { return await stakeInStore({ clone: dir, keyPem: PEM, land,
      payload: { handle: "wright", topic: t, candidate: "lumen", n: 3, via: "api", date: "2026-10-01" } }); }
    catch (e) { if (e.code) return { error: { code: e.code, defect: e.defect } }; throw e; }
  });
  const refused = await stake(() => ({ error: { code: 503, defect: "the town did not take this write", hint: "try again" } }));
  assert.deepEqual(refused.error, { code: 503, defect: "the town did not take this write" });
  assert.equal(await ballotActs(t), acts, "no vote act");
  assert.deepEqual(await votesOf(t), [], "no response");
  assert.equal(ledger(dir), before, "the appended lines are taken back");

  // a land that throws is the pen's own trip, passed on as itself
  await assert.rejects(stake(async () => { throw new Error("the pen tripped"); }),
    (e) => e.message === "the pen tripped" && e.fromLand === true);
  assert.equal(await ballotActs(t), acts, "and still no vote act");
  assert.equal(ledger(dir), before);

  // and the ordinary stake still lands, once
  const ok = await stake(() => ({ commit: "a-commit" }));
  assert.deepEqual([ok.applied, ok.commit], [3, "a-commit"]);
  assert.equal(await ballotActs(t), acts + 1);
});

test("4b · stake-exec on a real remote: a push that cannot land answers 503 and leaves clone and store as they were", async () => {
  const t = "push-vote";
  const dir = town(t, { cap: 12 });
  const origin = join(scratch, `${t}-origin.git`);
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  git(dir, "branch", "-M", "main");
  git(dir, "remote", "add", "origin", origin);
  git(dir, "push", "-q", "-u", "origin", "main");
  await ingestBallotFiles(dir, { hand: "keemin" });
  const acts = await ballotActs(t);
  const head = git(dir, "rev-parse", "HEAD").trim();
  const before = ledger(dir);
  const exec = (payload) => {
    const r = spawnSync(process.execPath, [join(ROOT, "src", "stake-exec.mjs"), JSON.stringify(payload)], { encoding: "utf8",
      env: { ...process.env, TOWN_CLONE: dir, STAMP_KEY: KEY_FILE, TOWN_PUSH: "1", BOT_NAME: "fixture", BOT_EMAIL: "fixture@test.invalid" } });
    assert.equal(r.status, 0, `stake-exec answers rather than trips: ${r.stderr}`);
    return JSON.parse(r.stdout.trim().split("\n").at(-1));
  };
  const payload = { handle: "wright", topic: t, candidate: "lumen", n: 4, via: "api", date: "2026-10-01" };

  git(dir, "remote", "set-url", "--push", "origin", join(scratch, "nowhere.git"));
  const refused = exec(payload);
  assert.equal(refused.error?.code, 503, JSON.stringify(refused));
  assert.equal(refused.error.defect, "the town did not take this write");
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), head, "no commit left behind");
  assert.equal(ledger(dir), before, "no line left behind");
  assert.equal(await ballotActs(t), acts, "no vote act");

  git(dir, "remote", "set-url", "--push", "origin", origin);
  const ok = exec(payload);
  assert.equal(ok.applied, 4, JSON.stringify(ok));
  assert.equal(git(dir, "ls-remote", "origin", "refs/heads/main").split("\t")[0], ok.commit, "the remote holds the stake");
  assert.equal(await ballotActs(t), acts + 1);
  assert.equal((await check(dir)).equal, true);
});

// ── 5 · the office's ballot pass is byte-equal to the town's ────────────────

test("5 · the office's pass writes the town pass's bytes, records the vote, and reads a letter once", async () => {
  const t = "mail-vote";
  const letters = [
    ["wright-2026-10-01-to-postmaster-my-ballot", "wright", "lumen", "7"],
    ["rei-2026-10-01-to-postmaster-ours", "rei", "lumen", "9"],
    ["ada-2026-10-01-to-postmaster-a-ballot", "ada", "nobody", "2"],
  ];
  const mk = () => {
    const dir = town(t, { cap: 12 });
    const inbox = join(dir, "WHITE_PAGES", "postmaster", "inbox");
    mkdirSync(inbox, { recursive: true });
    for (const [id, from, cand, stamps] of letters)
      writeFileSync(join(inbox, `${id}.md`), `---\nid: ${id}\nfrom: ${from}\nto: postmaster\nstake_topic: ${t}\nstake_candidate: ${cand}\nstake_stamps: ${stamps}\n---\n\nmy ballot\n`);
    git(dir, "add", "-A");
    git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "letters");
    return dir;
  };
  const townSide = mk();
  const officeSide = mk();
  node(townSide, "ballot-pass.mjs", ["--key", KEY_FILE, "--repo", townSide, "--date", "2026-10-01"]);
  await ingestBallotFiles(officeSide, { hand: "keemin" });
  const r = await ballotPassRun(officeSide, PEM, "2026-10-01");
  assert.deepEqual([r.processed, r.receipts, r.held], [3, 3, []]);

  assert.equal(ledger(officeSide), ledger(townSide), "the ledger, byte for byte");
  const outbox = (d) => join(d, "WHITE_PAGES", "postmaster", "outbox");
  const files = readdirSync(outbox(townSide)).sort();
  assert.deepEqual(readdirSync(outbox(officeSide)).sort(), files);
  for (const f of files) assert.equal(readFileSync(join(outbox(officeSide), f), "utf8"), readFileSync(join(outbox(townSide), f), "utf8"), f);
  assert.equal(git(officeSide, "status", "--porcelain"), "", "each ballot landed by the pen, nothing left for the ferry's commit");

  const votes = await votesOf(t);
  assert.deepEqual(stakesOf(votes).map((s) => [s.handle, s.n, s.via]),
    [["rei", 9, "mail:rei-2026-10-01-to-postmaster-ours"], ["wright", 3, "mail:wright-2026-10-01-to-postmaster-my-ballot"]],
    "the letters in name order, as the town's pass reads them: rei's 9, then wright clipped to the household's 3");
  assert.equal(verifies(officeSide).status, 0);
  assert.equal((await check(officeSide)).equal, true);

  const second = await ballotPassRun(officeSide, PEM, "2026-10-01");
  assert.equal(second.processed, 0, "a letter is read once");
});

test("5b · a ballot the store cannot judge now is HELD: no receipt, nothing written", async () => {
  const t = "held-vote";
  const dir = town(t, { cap: 12 });
  const inbox = join(dir, "WHITE_PAGES", "postmaster", "inbox");
  mkdirSync(inbox, { recursive: true });
  writeFileSync(join(inbox, "wright-x.md"), `---\nid: wright-x\nfrom: wright\nto: postmaster\nstake_topic: ${t}\nstake_candidate: lumen\nstake_stamps: 3\n---\n\nhi\n`);
  await ingestBallotFiles(dir, { hand: "keemin" });
  writeBallot(dir, t, { status: "closed" });   // the file moved; the post has not
  const before = ledger(dir);
  const r = await ballotPassRun(dir, PEM, "2026-10-01");
  assert.equal(r.held.length, 1);
  assert.match(r.held[0].defect, /file and its post disagree/);
  assert.equal(r.receipts, 0);
  assert.equal(ledger(dir), before);
  const outbox = join(dir, "WHITE_PAGES", "postmaster", "outbox");
  assert.ok(!existsSync(outbox) || readdirSync(outbox).length === 0, "no receipt");
  assert.equal((await ballotPassRun(dir, PEM, "2026-10-01")).processed, 1, "a held letter is read again at the next crossing");
});

// ── 6 · the backfill of a ballot run the old way ────────────────────────────

test("6 · a ballot staked, mailed and closed the old way backfills to the same votes, and --check is equal", async () => {
  const t = "old-vote";
  const dir = town(t, { cap: 12 });
  const { ballot } = await townEngine(dir);
  ballot.clipApply(dir, { handle: "wright", topic: t, candidate: "lumen", n: 5, via: "api", date: "2026-07-20" }, PEM);
  ballot.clipApply(dir, { handle: "ada", topic: t, candidate: "brightwork", n: 4, via: "mail:ada-1", date: "2026-07-21" }, PEM);
  ballot.clipApply(dir, { handle: "rei", topic: t, candidate: "lumen", n: 9, via: "api", date: "2026-07-22" }, PEM);
  ballot.clipApply(dir, { handle: "ada", topic: t, candidate: "lumen", n: 2, via: "api", date: "2026-07-23" }, PEM);
  writeBallot(dir, t, { status: "closed" });
  node(dir, "ballot.mjs", ["--close", t, "--date", "2026-07-27", "--key", KEY_FILE, "--repo", dir]);
  assert.equal(verifies(dir).status, 0);
  const engine = ballot.tally(dir, t);

  const plan = await backfill(dir, { hand: "keemin" });
  assert.deepEqual(plan.ingest.topics.find((x) => x.topic === t).did, ["post"]);
  assert.equal(plan.would_record.length, 4);
  assert.equal(await ballotActs(t), 0, "the plan writes nothing");

  const done = await backfill(dir, { hand: "keemin", apply: true });
  assert.equal(done.recorded.length, 4);
  const c = await check(dir);
  assert.equal(c.equal, true, c.differences.join("\n"));
  assert.deepEqual(c.ballots.find((b) => b.topic === t), { topic: t, ledger: 4, store: 4, staked: { lumen: 14, brightwork: 4 } }, "wright 5, rei clipped to 7, ada 2; ada 4");

  const one = await ballotWithVotes(t);
  assert.equal(one.post.state, "closed");
  assert.deepEqual(tallyOf(one.post, one.votes).candidates, engine.candidates, "the store's tally IS the engine's, households and all");
  assert.equal(stakesOf(one.votes).find((s) => s.handle === "wright").mint_key, stakesOf(one.votes).find((s) => s.handle === "rei").mint_key);

  const again = await backfill(dir, { hand: "keemin", apply: true });
  assert.deepEqual([again.recorded.length, again.ingest.topics.find((x) => x.topic === t).did], [0, []], "a second run writes nothing");

  const c2 = await store.connect("office_api");
  try {
    const r = await dryRun(c2);
    assert.equal(r.equal, true, r.drift.join("\n"));
    assert.ok(r.counts.ballots >= 1 && r.counts.votes >= 3, JSON.stringify(r.counts));
  } finally { await c2.end(); }
});

// ── 7 · between the deploy and the first tick (Wright's review of #415) ─────

test("7 · a ballot the tick has not taken in is never read as gone; the tick takes it in whole, once", async () => {
  const t = "window-vote";
  const fresh = "fresh-vote";
  const dir = town(t, { cap: 12 });
  const { ballot } = await townEngine(dir);
  ballot.clipApply(dir, { handle: "wright", topic: t, candidate: "lumen", n: 5, via: "api", date: "2026-07-20" }, PEM);
  ballot.clipApply(dir, { handle: "ada", topic: t, candidate: "brightwork", n: 3, via: "api", date: "2026-07-21" }, PEM);
  writeBallot(dir, t, { status: "closed" });
  writeBallot(dir, fresh, { status: "submissions", candidates: ["a", "b"] });

  // the deploy has landed and the tick has not run: no post stands for either file
  await assert.rejects(voteList(dir), (e) => e.code === 503 && e.defect === `the office has not taken ballot "${t}" into its record yet` && /:07, :22, :37 and :52/.test(e.hint),
    "a staked ballot is refused by name, never listed as gone");
  await assert.rejects(voteView(dir, t, KEY), (e) => e.code === 503 && /"window-vote"/.test(e.defect));
  await assert.rejects(voteView(dir, fresh, KEY), (e) => e.code === 503, "a file with no post is not a 404");

  // a transaction that fails after the post writes neither the post nor its votes
  const failed = await ingestBallotFiles(dir, { hand: "keemin",
    inTransaction: async (client, post, topic) => { if (topic === t) { const { refuse } = await import("../src/events.mjs"); throw refuse(503, "the record went away", "try again"); } } });
  assert.deepEqual(failed.refused.map((r) => r.topic), [t]);
  assert.equal(await ballotActs(t), 0, "the post did not land without its votes");

  // the tick: ballots-backfill --apply, as deploy/office-keep.sh runs it
  const tick = spawnSync(process.execPath, [join(ROOT, "tools", "ballots-backfill.mjs"), "--town", dir, "--hand", "keemin", "--apply", "--quiet"], { encoding: "utf8", env: process.env });
  assert.equal(tick.status, 0, `${tick.stdout}${tick.stderr}`);
  const list = await voteList(dir);
  const mine = list.topics.find((x) => x.topic === t);
  assert.deepEqual([mine.status, mine.candidates], ["closed", [{ candidate: "lumen", staked: 5 }, { candidate: "brightwork", staked: 3 }]]);
  assert.ok(list.topics.some((x) => x.topic === fresh), "the fresh ballot is listed once it is taken in");
  assert.equal(list.awaiting_intake, undefined);
  assert.equal((await check(dir)).equal, true);

  const again = spawnSync(process.execPath, [join(ROOT, "tools", "ballots-backfill.mjs"), "--town", dir, "--hand", "keemin", "--apply", "--quiet"], { encoding: "utf8", env: process.env });
  assert.equal(again.status, 0);
  assert.equal(again.stdout.trim(), "", "a quiet tick with nothing to do says nothing");
  assert.equal(await ballotActs(t), 3, "the post and two votes, written once");
});

// ── 8 · with the stamp lines in the store (POS-341's STAMP_LINES=store) ─────

test("8 · STAMP_LINES=store: a stake's vote and its stamp_lines rows land in one transaction, at the door and in the pass", async () => {
  const t = "lines-vote";
  const dir = town(t, { cap: 12 });
  const inbox = join(dir, "WHITE_PAGES", "postmaster", "inbox");
  mkdirSync(inbox, { recursive: true });
  writeFileSync(join(inbox, "rei-l.md"), `---\nid: rei-l\nfrom: rei\nto: postmaster\nstake_topic: ${t}\nstake_candidate: brightwork\nstake_stamps: 2\n---\n\nhi\n`);
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "a letter");
  await ingestBallotFiles(dir, { hand: "keemin" });
  await q("DELETE FROM stamp_lines");   // this test's ledger is the store's chain, from its first line
  const { verifyStampLinesVia } = await import("../src/stamp-lines.mjs");
  const verified = async () => {
    const c = await store.connect("office_api");
    try { return await verifyStampLinesVia(c, dir); } finally { await c.end(); }
  };

  const r = spawnSync(process.execPath, [join(ROOT, "src", "stake-exec.mjs"),
    JSON.stringify({ handle: "wright", topic: t, candidate: "lumen", n: 4, via: "api", date: "2026-10-01" })],
  { encoding: "utf8", env: { ...process.env, TOWN_CLONE: dir, STAMP_KEY: KEY_FILE, STAMP_LINES: "store" } });
  const out = JSON.parse(r.stdout.trim().split("\n").at(-1));
  assert.equal(out.applied, 4, `${r.stdout}${r.stderr}`);
  const v1 = await verified();
  assert.equal(v1.ok, true, v1.problems.join("\n"));
  assert.equal(v1.held, v1.exported, "the store's chain holds every line the export holds, the stake's included");

  const pass = await ballotPassRun(dir, PEM, "2026-10-01", { env: { ...process.env, STAMP_LINES: "store" } });
  assert.deepEqual([pass.processed, pass.receipts, pass.held], [1, 1, []]);
  const v2 = await verified();
  assert.equal(v2.ok, true, v2.problems.join("\n"));
  assert.equal(v2.held, v1.held + 2, "the mailed stake's line and its first-stake mint were recorded with its vote");
  assert.equal((await check(dir)).equal, true);
});

// ── 9 · no transaction spans the verify; a ballot that moves is judged again ─

test("9 · the pass verifies with no transaction open: a writer on the ballot waits for nothing, and a ballot that moved is judged again", async () => {
  const t = "slow-vote";
  const dir = town(t, { cap: 12 });
  const inbox = join(dir, "WHITE_PAGES", "postmaster", "inbox");
  mkdirSync(inbox, { recursive: true });
  writeFileSync(join(inbox, "wright-s.md"), `---
id: wright-s
from: wright
to: postmaster
stake_topic: ${t}
stake_candidate: lumen
stake_stamps: 4
---

hi
`);
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "a letter");
  await ingestBallotFiles(dir, { hand: "keemin" });
  const id = ballotPostId(t);
  const real = (repo) => { const r = spawnSync(process.execPath, [join(repo, "tools", "stamp-verify.mjs")], { cwd: repo, encoding: "utf8" }); return { ok: r.status === 0, out: r.stdout }; };

  const probes = [];
  let calls = 0;
  const verify = async (repo) => {
    calls++;
    // A slow verify: three seconds, past the file's 2 s idle budget (the
    // town's verify on the real ledger, under load).
    await new Promise((r) => setTimeout(r, 3000));
    return real(repo);
  };
  // While the pass is in its verify (the first time), another writer takes the
  // ballot post's row lock and casts a vote from another household: the first
  // waits for nothing (lock_timeout 1 s), the second moves the ballot.
  const probe = (async () => {
    while (calls === 0) await new Promise((r) => setTimeout(r, 50));
    const c = await store.connect("office_api");
    try {
      const t0 = Date.now();
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout = '1s'");
      await c.query("SELECT id FROM posts WHERE id = $1 FOR UPDATE", [id]);
      await c.query("COMMIT");
      probes.push({ ok: true, ms: Date.now() - t0 });
    } catch (e) { probes.push({ ok: false, error: e.message }); await c.query("ROLLBACK").catch(() => {}); }
    finally { await c.end(); }
    const { officeWrite } = await import("../src/world2-pen.mjs");
    const { castVote, ballotRow } = await import("../src/ballots-store.mjs");
    await officeWrite(async (client) => castVote(client, await ballotRow(client, id), { handle: "ada", candidate: "brightwork", n: 1,
      mint_key: "gh:9", date: "2026-10-01", via: "probe", sig: "probe-sig", now: Date.now() }));
  })();
  const r = await ballotPassRun(dir, PEM, "2026-10-01", { verify });
  await probe;
  assert.deepEqual(probes, [probes[0]].filter((x) => x.ok), `a writer took the ballot's row during the verify: ${JSON.stringify(probes)}`);
  assert.equal(calls, 2, "the ballot moved during the first verify, so the stake was judged (and verified) again");
  assert.deepEqual([r.processed, r.receipts, r.held], [1, 1, []], JSON.stringify(r.held));
  const lines = ledger(dir).split("\n").filter((l) => l.includes(`stake:${t}/`));
  assert.equal(lines.length, 1, "the first try's line was put back: one stake line, not two");
  const mine = stakesOf(await votesOf(t)).filter((s) => s.handle === "wright");
  assert.deepEqual(mine.map((s) => [s.n, s.via]), [[4, "mail:wright-s"]]);
  assert.equal(git(dir, "status", "--porcelain"), "", "ledger and receipt landed in one commit; nothing left behind");
  assert.equal(verifies(dir).status, 0);
});
