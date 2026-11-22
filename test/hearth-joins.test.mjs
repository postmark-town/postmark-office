// hearth-joins.test.mjs — a merged Hearth design joins the Hearth ballot by itself, and its entry pay is queued (STAR-237).
//
//   node --import ./test/helpers/sparse-guard.mjs --test --test-timeout=300000 test/hearth-joins.test.mjs
//
// Darko, 2026-11-22: "for the ballot, why doesn't it automatically appear?" / "yes pleae". Wright's fit: "queue, not run. POS-632's
// hand-reviewed pass stands for the Hearth quest too, and the owed row with the digest is right. ... add the choice through the
// ballot's own amend door (town_amend, the office pen as one of the town's hands), not by writing the JSON directly, so every
// addition lands in the act log as today's did (act 59699)."
//
// On the suite's store (a real Postgres) and a fixture town (the pinned town's own tools, invented residents and designs, a real
// git history whose first-parent commits are the merges), through deploy/hearth-joins.mjs's own run():
//
//   1. A NEW MERGED DESIGN JOINS ONCE, through the amend act: at the end of the ballot, credit/link/note/added as ruled, one act in
//      the log (actor the pen, hand "office"), the town file and the post one truth, one town commit, nothing loose.
//   2. A RE-RUN ADDS NOTHING: no act, no commit, the file's bytes as they were; and nothing already a candidate is rewritten.
//   3. AN UNBOUND AUTHOR IS SKIPPED (no such resident, no author line), and named.
//   4. NO JOIN AFTER THE WINDOW CLOSES: the window is read from the ballot's own words; a design merged after it never joins, one
//      merged inside it still does on a late tick; a closed ballot takes none; a window it cannot read refuses by name.
//   5. THE PAY IS QUEUED, NEVER RUN: owed entries raise ONE row carrying the digest the quest pass itself prints for the same
//      clone; nothing owed raises none (and clears a stale one); the ledger is never touched; --dry writes nothing.
//   6. THE HAND IS THE TICK'S ALONE: the town door and the founder's-file ingest refuse "office", even to a key holding a resident
//      of that name.
//
// THE FLIPS (the lane's paperwork names each red line): the window, the already-a-candidate skip, the binding, the machine hand,
// the no-row-when-nothing-owed rule, the row's write.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { copyTownTools } from "./helpers/town-tools.mjs";
import { pinTown } from "./helpers/pinned-town.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const TOWN = join(ROOT, "town-clone");

const store = await startStore({ db: "hearth_joins_test" });
Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), WORLD2_PG_IDLE_TX_MS: "2000", TOWN_TZ: "America/New_York" });
delete process.env.TOWN_PUSH;
delete process.env.OFFICE_KEEP;
delete process.env.INVOCATION_ID;
after(() => store.stop());

const { ingestBallotFiles, ballotActInStore } = await import("../src/ballots-store.mjs");
const { ballotPostId, BALLOT_HANDS, MACHINE_HANDS } = await import("../src/ballots.mjs");
const { amendAtTown } = await import("../src/events-store.mjs");
const { run, main, planJoins, joinThrough, noteOf, owedRowOf, HAND } = await import("../deploy/hearth-joins.mjs");
const { main: questMain } = await import("../tools/quest-pay-plan.mjs");
const { REASON_RE } = await import("../deploy/keep-history.mjs");

const { publicKey } = generateKeyPairSync("ed25519");
const PUB = publicKey.export({ type: "spki", format: "pem" });
const scratch = tempDir("hearth-joins-");
after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }));
process.env.TOWN_LOCK = join(scratch, "town.lock");

// each fixture town is its own ballot topic: the suite's store is shared, and a ballot's terms only grow
const topics = new Map();
const topicOf = (dir) => topics.get(dir);
const postOfDir = (dir) => ballotPostId(topicOf(dir));
const H = "PROJECTS/household-hearths";
const WINDOW = "New designs join through Sun 6 Dec; staking closes Sun 13 Dec";
const LINK = (name) => `https://github.com/postmark-town/postmark/tree/main/${H}/${name}`;
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
const at = (iso) => ({ GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso });
// the run's town day is a parameter (the store's own clock, which the act is stamped on, is the real one: a future crossing is refused)
const DAY = "2026-12-02";

async function q(sql, args = []) {
  const c = await store.connect("world2_owner");
  try { return (await c.query(sql, args)).rows; } finally { await c.end(); }
}
const ballotActs = (dir) => q("SELECT id, action, actor, payload FROM acts WHERE class = 'ballot' AND object = $1 ORDER BY id", [postOfDir(dir)]);
const amends = async (dir) => (await ballotActs(dir)).filter((a) => a.action === "amend");
const filePath = (dir) => join(dir, "WHITE_PAGES", `ballot-${topicOf(dir)}.json`);
const fileOf = (dir) => JSON.parse(readFileSync(filePath(dir), "utf8"));
const postOf = async (dir) => (await q("SELECT state, fields FROM posts WHERE id = $1", [postOfDir(dir)]))[0];

// ada, ben and cy are bound residents (a pin each, a house each); "ghost" is bound to nothing.
// default is the town's own design (author postmark): already on the ballot, bound to no resident.
let n = 0;
async function town({ window = WINDOW, status = "staking", entries = [], onBallot = ["default"] } = {}) {
  const dir = join(scratch, `town-${++n}`);
  const TOPIC = `hearth-default-${n}`;
  topics.set(dir, TOPIC);
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  copyTownTools(TOWN, dir);
  // the fixture's town opens the Hearth quest (the live town did at its ship); every other word of its engine is the pinned town's own
  const mint = readFileSync(join(dir, "tools", "stamp-mint.mjs"), "utf8");
  const closed = "'hearth-entry': Object.freeze({ amount: 10, once_per: 'household', from: null, until: null })";
  assert.equal(mint.split(closed).length, 2, "the pinned town names the hearth-entry quest once, closed");
  writeFileSync(join(dir, "tools", "stamp-mint.mjs"), mint.replace(closed, () => "'hearth-entry': Object.freeze({ amount: 10, once_per: 'household', from: '2026-11-01', until: null })"));
  writeFileSync(join(dir, "tools", "stamp-pubkey.pem"), PUB);
  writeFileSync(join(dir, "tools", "github-ids.json"), JSON.stringify({ ada: { login: "ada-gh", id: 91 }, ben: { login: "ben-gh", id: 92 }, cy: { login: "cy-gh", id: 93 } }));
  writeFileSync(join(dir, "tools", "households.json"), JSON.stringify({ households: { "ada-house": { residents: ["ada"] }, "ben-house": { residents: ["ben"] }, "cy-house": { residents: ["cy"] } } }));
  const ballot = {
    topic: TOPIC, title: "Postmark's default Hearth", status, cap_per_household_per_candidate: 20, window,
    candidates: [...onBallot], notes: ["Back the designs you'd like every new house to open in."],
    choices: Object.fromEntries(onBallot.map((c) => [c, { credit: "Postmark", link: LINK(c), note: `${c}, the town's own`, added: "2026-11-15" }])),
  };
  writeFileSync(join(dir, "WHITE_PAGES", `ballot-${TOPIC}.json`), JSON.stringify(ballot, null, 2));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "config", "user.name", "fixture"); git(dir, "config", "user.email", "fixture@test.invalid");
  const put = (p, t) => { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), t); };
  put(`${H}/STARTER/hearth.html`, "<hearth-house></hearth-house>\n");
  put(`${H}/STARTER/hearth.md`, "---\nauthor: your-household-slug\n---\n");
  put(`${H}/default/hearth.html`, "<hearth-house></hearth-house>\n");
  put(`${H}/default/hearth.md`, "---\ntitle: Postmark's default\nauthor: postmark\n---\n\nThe default.\n");
  git(dir, "add", "-A");
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "fixture town"], { env: { ...process.env, ...at("2026-11-14T15:00:00Z") } });
  for (const e of entries) {
    put(`${H}/${e.name}/hearth.html`, "<hearth-house></hearth-house>\n");
    put(`${H}/${e.name}/hearth.md`, `---\ntitle: ${e.name}\n${e.author === undefined ? "" : `author: ${e.author}\n`}---\n\n${e.line ?? `${e.name}'s design.`}\n`);
    git(dir, "add", "-A");
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", `${e.name}: a Hearth`], { env: { ...process.env, ...at(e.merged) } });
  }
  process.env.TOWN_PINS_DIR = pinTown(dir); // the office reads the PINNED copy of the town's tools: a fixture is pinned to itself
  process.env.TOWN_CLONE = dir;
  await ingestBallotFiles(dir, { hand: "keemin" }); // the post and the file are one before the tick comes
  return dir;
}

const lines = () => { const out = []; const err = []; return { out, err, log: (s) => out.push(s), error: (s) => err.push(s), all: () => [...out, ...err].join("\n") }; };
const doRun = (dir, over = {}) => {
  const l = lines();
  const owed = over.owedFile ?? join(scratch, `owed-${topicOf(dir)}.json`);
  return run({ town: dir, topic: topicOf(dir), today: DAY, log: l.log, err: l.error, ...over, owedFile: owed }).then((rc) => ({ rc, l, owed }));
};
const E = (name, author, merged, line) => ({ name, author, merged, line });

// ── 0 · the words the step reads ────────────────────────────────────────────

test("0 · the join window is read from the ballot's own words, and never from the clock", () => {
  assert.equal(joinThrough(WINDOW, "2026-11-15"), "2026-12-06");
  assert.equal(joinThrough(WINDOW, "2026-11-15"), joinThrough(WINDOW, "2026-11-30"), "the same ballot, the same day");
  assert.equal(joinThrough("New designs join through 6 Dec 2027", "2026-11-15"), "2027-12-06", "a year it names wins");
  assert.equal(joinThrough("New designs join through Sun 3 Jan; staking closes", "2026-11-15"), "2027-01-03", "a date before the ballot began is next year's");
  assert.equal(joinThrough("New designs join through Mon 6 Dec", "2026-11-15"), null, "a weekday that is not that date's reads as nothing, never as a guess");
  assert.equal(joinThrough("New designs join through 31 Feb", "2026-11-15"), null, "a day that does not exist");
  assert.equal(joinThrough("staking closes Sun 13 Dec", "2026-11-15"), null, "a window with no join day");
});

test("0 · a note is the design's first line, one line, at most 200 characters", () => {
  assert.equal(noteOf("A den in the\n snow,\twarm."), "A den in the snow, warm.");
  assert.equal(noteOf("a\u0000b\u007fc"), "a b c", "a control character would refuse the whole amend");
  const long = noteOf(`${"word ".repeat(80)}end`);
  assert.ok(Array.from(long).length <= 200 && long.endsWith("…"), `cut at a word with an ellipsis (${Array.from(long).length})`);
  assert.equal(Array.from(noteOf("é".repeat(300))).length, 200, "counted in characters, never in code units");
});

// ── 1 · a new merged design joins once, through the amend act ───────────────

test("1 · a merged design joins at the end of the ballot through the amend act, as the office's hand, in one act and one town commit", async () => {
  const dir = await town({ entries: [E("ember", "ada", "2026-11-20T15:00:00Z", "A hearth with a reading nook,\nby a window.\n\nA second paragraph, which the ballot never shows."), E("mist", "ben", "2026-12-01T15:00:00Z")] });
  const head = git(dir, "rev-parse", "HEAD").trim();
  assert.deepEqual((await ballotActs(dir)).map((a) => a.action), ["post"], "the ingest put the ballot up and nothing else");
  const { rc, l } = await doRun(dir);
  assert.equal(rc, 4, `ok, and the pay is owed: ${l.all()}`);
  const file = fileOf(dir);
  assert.deepEqual(file.candidates, ["default", "ember", "mist"], "joins at the END, in merge order, nothing moved");
  assert.deepEqual(file.choices.ember, { credit: "ada", link: LINK("ember"), note: "A hearth with a reading nook, by a window.", added: "2026-12-02" },
    "credit, link, note (the first paragraph, as the site reads it) and the town day it joined");
  assert.deepEqual(file.choices.default, { credit: "Postmark", link: LINK("default"), note: "default, the town's own", added: "2026-11-15" }, "the town's own words are as they were");
  assert.equal(file.choices.mist.credit, "ben");
  // the act log, as act 59699 was: the pen, the amend, the hand — and one act for both designs
  const acts = await amends(dir);
  assert.equal(acts.length, 1, "one amend for the tick's joins");
  assert.deepEqual([acts[0].actor, acts[0].payload.post, acts[0].payload.hand, [...acts[0].payload.changed].sort()], ["postmark-pen", postOfDir(dir), HAND, ["candidates", "choices"]]);
  assert.equal(HAND, "office");
  assert.deepEqual(acts[0].payload.fields.candidates, ["default", "ember", "mist"]);
  // the post and the file are one truth, and the town holds one commit for it
  const post = await postOf(dir);
  assert.deepEqual([post.state, post.fields.candidates], ["staking", ["default", "ember", "mist"]]);
  assert.deepEqual(post.fields.choices, file.choices);
  assert.equal(git(dir, "rev-list", "--count", `${head}..HEAD`).trim(), "1");
  assert.match(git(dir, "log", "-1", "--format=%s"), /^ballot: hearth-default-\d+ · amend \(by office's hand, via postmark-office/);
  assert.equal(git(dir, "status", "--porcelain").trim(), "", "nothing left loose");
  assert.equal((await ingestBallotFiles(dir, { hand: "keemin" })).topics.find((x) => x.topic === topicOf(dir)).did.length, 0, "the tick's ingest finds the file and the post already one");
});

// ── 2 · a re-run adds nothing ───────────────────────────────────────────────

test("2 · a re-run adds nothing: no act, no commit, the file as it was; a candidate's own words are never replaced", async () => {
  const dir = await town({ entries: [E("ember", "ada", "2026-11-20T15:00:00Z")] });
  assert.equal((await doRun(dir)).rc, 4);
  const [head, bytes, acts] = [git(dir, "rev-parse", "HEAD").trim(), readFileSync(filePath(dir), "utf8"), (await ballotActs(dir)).length];
  // a hand tends the words afterwards: the tick leaves them alone
  const tended = JSON.parse(bytes); tended.choices.ember.note = "A hand's own words."; tended.choices.default.note = "The town's, tended.";
  writeFileSync(filePath(dir), JSON.stringify(tended, null, 2)); git(dir, "commit", "-qam", "a hand tends the words");
  await ingestBallotFiles(dir, { hand: "keemin" });
  const [head2, bytes2, acts2] = [git(dir, "rev-parse", "HEAD").trim(), readFileSync(filePath(dir), "utf8"), (await ballotActs(dir)).length];
  const { rc, l } = await doRun(dir);
  assert.equal(rc, 4, "still owed, still ok");
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), head2, "no commit");
  assert.equal(readFileSync(filePath(dir), "utf8"), bytes2, "the file's bytes, tended words and all");
  assert.equal((await ballotActs(dir)).length, acts2, "no act");
  assert.notEqual(bytes2, bytes);
  assert.notEqual(head2, head);
  assert.equal(acts2, acts + 1, "only the hand's ingest after the join");
  assert.doesNotMatch(l.all(), /amended|CANNOT/, l.all());
});

// ── 3 · an unbound author is skipped ────────────────────────────────────────

test("3 · an author bound to no resident, or a design that names none, is skipped and named; a bound one still joins", async () => {
  const dir = await town({ entries: [E("ghost-den", "ghost", "2026-11-21T15:00:00Z"), E("anon", undefined, "2026-11-21T16:00:00Z"), E("cy-nook", "cy-house", "2026-11-22T15:00:00Z")] });
  const { rc, l } = await doRun(dir);
  assert.equal(rc, 4, l.all());
  assert.deepEqual(fileOf(dir).candidates, ["default", "cy-nook"], "ghost-den and anon do not join");
  assert.match(l.all(), /not joining ghost-den: its author "ghost" is bound to no resident here/);
  assert.match(l.all(), /not joining anon: its hearth\.md names no author/);
  assert.equal(fileOf(dir).choices["cy-nook"].credit, "cy-house", "a household's slug is the author line as written; the binding is what let it in");
  const only = await town({ entries: [E("ghost-den", "ghost", "2026-11-21T15:00:00Z")] });
  const r = await doRun(only);
  assert.equal(r.rc, 0, "an unbound design is by design: not a refusal, and nothing owed for it");
  assert.deepEqual(fileOf(only).candidates, ["default"]);
  assert.equal((await amends(only)).length, 0, "no design to join, no act");
  assert.equal((await amends(dir)).length, 1, "the first town's one amend stands");
});

// ── 4 · no join after the window closes ─────────────────────────────────────

test("4 · a design joins only if merged by the last join day AND run by the day after it; a closed ballot takes none", async () => {
  // Sun 6 Dec 2026 is the last join day (New York): 2026-12-07T04:59Z is still that Sunday night, 05:00Z is Monday
  const dir = await town({ entries: [E("on-time", "ada", "2026-12-07T04:59:00Z"), E("too-late", "ben", "2026-12-07T05:00:00Z")] });
  const r = await doRun(dir, { today: "2026-12-07" });
  assert.deepEqual(fileOf(dir).candidates, ["default", "on-time"], "merged late on the Sunday, added by the Monday's tick (the day's grace)");
  assert.match(r.l.all(), /not joining too-late: merged 2026-12-07, after the join window closed on 2026-12-06/);
  // the run-day edge: a design merged 12-01 (inside the window) joins on a 12-07 tick, not on a 12-08 tick or a 12-12 one
  const edge = async (today) => { const d = await town({ entries: [E("early", "ada", "2026-12-01T15:00:00Z")] }); const x = await doRun(d, { today }); return [fileOf(d).candidates, x.l.all()]; };
  assert.deepEqual((await edge("2026-12-07"))[0], ["default", "early"], "the day after the last join day: still in");
  const [c8, l8] = await edge("2026-12-08");
  assert.deepEqual(c8, ["default"], "the second day after: nothing joins, whatever its merge day");
  assert.match(l8, /not joining early: the run day 2026-12-08 is past the join window \(through 2026-12-06/);
  assert.deepEqual((await edge("2026-12-12"))[0], ["default"], "a tick of the staking week adds nothing to a ballot being staked");
  const closed = await town({ status: "closed", entries: [E("ember", "ada", "2026-11-20T15:00:00Z")] });
  const c = await doRun(closed);
  assert.deepEqual(fileOf(closed).candidates, ["default"], "a closed ballot is the record of its vote");
  assert.match(c.l.all(), /the ballot stands closed: nothing joins it now/);
  assert.equal(c.rc, 4, "the pay is still owed to the household that made it");
  const odd = await town({ window: "New designs join until the sixth", entries: [E("ember", "ada", "2026-11-20T15:00:00Z")] });
  const o = await doRun(odd);
  assert.equal(o.rc, 1, "a window this step cannot read is refused by name, not read as open");
  assert.deepEqual(fileOf(odd).candidates, ["default"]);
  assert.match(o.l.all(), /names no day new designs join through that this step can read/);
});

// ── 5 · the pay, queued, never run ──────────────────────────────────────────

test("5 · owed entries raise ONE row with the digest the quest pass itself prints for the same clone; the ledger is never touched", async () => {
  const dir = await town({ entries: [E("ember", "ada", "2026-11-20T15:00:00Z"), E("mist", "ben", "2026-12-01T15:00:00Z"), E("ada-two", "ada", "2026-12-01T16:00:00Z")] });
  const { rc, l, owed } = await doRun(dir);
  assert.equal(rc, 4);
  const row = JSON.parse(readFileSync(owed, "utf8"));
  assert.deepEqual([row.kind, row.quest, row.date, row.stamps], ["owed-quest-pay", "hearth-entry", "2026-12-02", 20], "ada's second design is the same household: one 10, not two");
  assert.deepEqual(row.entries.map((e) => [e.ref, e.handle, e.household, e.n, e.author]), [
    ["hearth:ember", "ada", "gh:91", 10, "ada"], ["hearth:mist", "ben", "gh:92", 10, "ben"]]);
  // the SAME digest the by-hand pass prints for the same clone and day: the step plans with its functions, never its own arithmetic
  const printed = []; const code = await questMain(["--town", dir, "--quest", "hearth-entry", "--date", "2026-12-02"], { log: (s) => printed.push(s), err: (s) => printed.push(`ERR ${s}`), env: {} });
  assert.equal(code, 0, printed.join("\n"));
  assert.equal(row.digest, /^digest: (sha256:[0-9a-f]{16})$/m.exec(printed.join("\n"))?.[1], "the row's digest is the pass's own");
  assert.match(row.apply, /^node tools\/quest-pay-plan\.mjs --town \S+ --quest hearth-entry --date 2026-12-02 --apply --key \S+ --expect sha256:[0-9a-f]{16}$/);
  assert.ok(row.apply.endsWith(`--expect ${row.digest}`), "the command that applies exactly this plan");
  assert.match(row.plan, /^quest pay plan for hearth-entry — 4 Hearth entr\(ies\) qualify, 0 already paid, 2 pay nothing, 2 owed \(20 stamps\), dated 2026-12-02/,
    "the town's own default and ada's second design pay nothing");
  assert.match(l.all(), /OWED hearth:ember · ada · gh:91 · 10/);
  assert.equal(existsSync(join(dir, "WHITE_PAGES", "stamp-ledger.md")), false, "nothing signed, nothing minted, no ledger line: the pass is queued, never run");
  // the same plan on the next tick leaves the row as it was
  const stamp = readFileSync(owed, "utf8");
  assert.equal((await doRun(dir, { owedFile: owed })).rc, 4);
  assert.equal(readFileSync(owed, "utf8"), stamp, "an unchanged row is not rewritten");
});

test("5 · nothing owed raises no row, and clears a stale one", async () => {
  const dir = await town({ entries: [E("ghost-den", "ghost", "2026-11-21T15:00:00Z")] });
  const owed = join(scratch, "owed-none.json");
  const a = await doRun(dir, { owedFile: owed });
  assert.equal(a.rc, 0);
  assert.equal(existsSync(owed), false, "no row when nothing is owed");
  writeFileSync(owed, JSON.stringify({ v: 1, kind: "owed-quest-pay", quest: "hearth-entry", date: "2026-12-01", digest: "sha256:0123456789abcdef", entries: [{ ref: "hearth:old" }] }));
  const b = await doRun(dir, { owedFile: owed });
  assert.equal(b.rc, 0);
  const cleared = JSON.parse(readFileSync(owed, "utf8"));
  assert.deepEqual([cleared.entries, cleared.digest, cleared.stamps], [[], null, 0], "a paid entry's row reads as cleared, never as live");
  assert.equal(owedRowOf({ rows: [{ owed: false, why: "already paid" }], digest: "d", date: "2026-12-02", town: "/t" }), null);
});

test("5 · --dry prints what it would amend and raise, and writes nothing", async () => {
  const dir = await town({ entries: [E("ember", "ada", "2026-11-20T15:00:00Z", "A hearth with a reading nook.")] });
  const head = git(dir, "rev-parse", "HEAD").trim();
  const owed = join(scratch, "owed-dry.json");
  const l = lines();
  const rc = await run({ town: dir, topic: topicOf(dir), owedFile: owed, dry: true, today: DAY, log: l.log, err: l.error });
  assert.equal(rc, 4, l.all());
  assert.match(l.all(), /DRY: would amend postmark-pen\/ballot-hearth-default-\d+ as office's hand, adding 1 choice\(s\) at the end: ember/);
  assert.match(l.all(), /ember · credit ada · https:\/\/github\.com\/postmark-town\/postmark\/tree\/main\/PROJECTS\/household-hearths\/ember/);
  assert.match(l.all(), /DRY: would raise one owed row/);
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), head);
  assert.deepEqual(fileOf(dir).candidates, ["default"]);
  assert.equal(existsSync(owed), false);
  assert.equal((await amends(dir)).length, 0, "a dry run makes no act");
  assert.equal(await main(["--town", dir, "--dry", "--topic", topicOf(dir)], process.env), 4, "the command's --dry is the same run");
  assert.equal(await main([], process.env), 2, "no --town is the usage");
  // the command itself, as the box's read before install runs it (a child process over the same clone)
  const child = spawnSync(process.execPath, [join(ROOT, "deploy", "hearth-joins.mjs"), "--town", dir, "--dry", "--topic", topicOf(dir)], { encoding: "utf8", cwd: ROOT, env: process.env });
  assert.equal(child.status, 4, child.stderr);
  assert.match(child.stdout, /DRY: would amend postmark-pen\/ballot-hearth-default-\d+ as office's hand, adding 1 choice\(s\) at the end: ember/);
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), head, "the child wrote nothing either");
});

test("5 · the plan is pure over its facts: the join list and the row, in order, from fixed rows", () => {
  const ballot = { state: "staking", fields: { candidates: ["default"], window: WINDOW, choices: { default: { added: "2026-11-15" } } } };
  const houseOf = ({ author }) => (author === "amb" ? { refuse: "ambiguous: a hand decides" } : author === "ada" ? { household: "gh:1", handles: ["ada"] } : null);
  const entries = [
    { id: "b-late", author: "ada", date: "2026-12-07", line: "late" }, { id: "a-ok", author: "ada", date: "2026-12-01", line: "ok" },
    { id: "bad_name", author: "ada", date: "2026-12-01", line: "x" }, { id: "amb", author: "amb", date: "2026-11-30", line: "y" },
    { id: "broken", problem: "not an entry: no hearth.html" }, { id: "default", author: "postmark", date: "2026-11-14", line: "z" }];
  const p = planJoins({ ballot, entries, houseOf, today: "2026-12-02" });
  assert.deepEqual(p.joins.map((j) => j.name), ["a-ok"]);
  assert.deepEqual(p.skipped.map((s) => s.name).sort(), ["amb", "b-late", "broken"], "an already-candidate design is not even named");
  assert.deepEqual(p.refused.map((s) => s.name), ["bad_name"], "a name the ledger could not carry cannot join: a hand has to look");
  assert.equal(p.through, "2026-12-06");
});

// ── 6 · the hand is the tick's alone ────────────────────────────────────────

test("6 · the town door and the ingest refuse the office's hand, even to a key holding a resident named office", async () => {
  const dir = await town({ entries: [] });
  const OFFICE_KEY = { household: "office-house", handles: new Set(["office"]) };
  await assert.rejects(amendAtTown({ post: postOfDir(dir), choices: [{ name: "sneak", credit: "x" }], handle: "office" }, OFFICE_KEY), (e) => { assert.equal(e.code, 403); assert.match(e.defect, /only the town's hands/); return true; });
  await assert.rejects(ballotActInStore({ clone: dir, verb: "amend", args: { post: postOfDir(dir), choices: [{ name: "sneak" }] }, hand: "office", today: "2026-12-02" }), (e) => { assert.equal(e.code, 403); return true; },
    "the act itself takes the hand only from the tick that says it is the tick");
  await assert.rejects(ingestBallotFiles(dir, { hand: "office" }), (e) => e.code === 403, "the founder's-file ingest never takes it");
  assert.deepEqual([...BALLOT_HANDS], ["wright", "keemin", "rei"], "the town's hands are as they were");
  assert.deepEqual([...MACHINE_HANDS], ["office"]);
  assert.deepEqual(await amends(dir), []);
});

test("6 · the receipt may say owed:hearth_entry, and nothing else of the row", () => {
  assert.equal(REASON_RE.test("owed:hearth_entry"), true);
  assert.equal(REASON_RE.test("owed:sha256:abc"), false, "never a digest, a handle or a body in a receipt");
  assert.equal(REASON_RE.test("owed:"), false);
});
