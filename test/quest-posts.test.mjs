// quest-posts.test.mjs — the town's quests become its posts (POS-294).
//
//   node --test test/quest-posts.test.mjs
//
// The gate, in its order:
//
//   1. every quest the board shows is a post row with the pen as author, put up
//      once by a posting act (the seeding) that names its hand;
//   2. only the town's hands (wright, keemin) post and close; everyone else is
//      refused, and nothing is written;
//   3. closing a quest is an act that names its hand, and a closed quest is
//      never put back up;
//   4. a quest takes no amend and no advance, refused by name;
//   5. the posts read answers class "quest" with the registry's terms, in the
//      registry's order, through the posts table's one reader;
//   6. the rebuild folds the quest acts back into exactly the rows the pen wrote.
//
// ⚑ THE STORE IS A JS STUB (`acts-pen-stub.mjs`), as in events.test.mjs: this
// proves which acts and rows the pen writes and what the read makes of them,
// nothing about Postgres. The registry is the town's own quest-registry.json,
// copied from the pinned town clone.
//
// THE FLIPS (NOTES.md in the lane folder holds their red lines):
//   · the hand — make judgeQuestHand accept any handle and 2 goes red;
//   · the author — write the act as the hand instead of the pen and 1 goes red.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installActsPen, uninstallActsPen, RECORD_ON } from "./acts-pen-stub.mjs";
import { OFFICE_ROOT } from "./fixture-paths.mjs";
import { INVITE_TOWN } from "./helpers/invite-town.mjs";

const REAL_TOWN = process.env.TOWN_CLONE ?? join(OFFICE_ROOT, "town-clone");
const DIR = mkdtempSync(join(tmpdir(), "pm-quest-posts-"));
const TOWN = join(DIR, "town");
mkdirSync(TOWN, { recursive: true });
copyFileSync(join(REAL_TOWN, "quest-registry.json"), join(TOWN, "quest-registry.json"));
after(() => { try { rmSync(DIR, { recursive: true, force: true, maxRetries: 5 }); } catch { /* Windows keeps a handle */ } });

process.env.TOWN_CLONE = TOWN;
Object.assign(process.env, RECORD_ON);
const { postAtTown, closeAtTown, amendAtTown, advanceAtTown, seedQuestPosts } = await import("../src/events-store.mjs");
const { postsAtOffice } = await import("../src/town-posts.mjs");
const { readQuestRegistry, questEntries, QUEST_HANDS } = await import("../src/quests.mjs");
const { compareRebuild, dryRun } = await import("../world2/tools/events-rebuild.mjs");

const REGISTRY = readQuestRegistry(TOWN);
// THE EXPECTATION IS THE PINNED FILE, READ BY THE TEST (POS-896). Until this change the counts below were typed into the
// assertions (11 quests, 12 acts, a four-card board), so a registry that gains a quest reddened the file although the
// seeding and the read were right. The expected quests are now parsed straight from the registry JSON with this file's own
// spelling of "what is a quest post" (a cadence from ADMITTED_CADENCES) and "what is a pot" (cadence "ongoing"), NOT through
// the production helpers (readQuestRegistry, questEntries, questTerms) that the code under test uses: the same helper on
// both sides could never disagree with itself. Production's own answer is compared to it.
const ADMITTED_CADENCES = ["daily", "monthly", "milestone", "one-time"];   // src/quests.mjs § QUEST_CADENCES, spelled here on purpose
const RAW_QUESTS = JSON.parse(readFileSync(join(TOWN, "quest-registry.json"), "utf8")).quests;
/** The quests that are posts, in the file's order, as plain objects with exactly the five term fields the read promises. */
const expectedEntriesOf = (quests) => quests.filter((q) => ADMITTED_CADENCES.includes(q.cadence))
  .map((q) => ({ id: q.id, title: q.title, source: q.source, reward: q.reward, cadence: q.cadence, target: q.target ?? null }));
const EXPECTED = expectedEntriesOf(RAW_QUESTS);
const QUEST_IDS = EXPECTED.map((q) => q.id);
const N_QUESTS = QUEST_IDS.length;
const POT_IDS = RAW_QUESTS.filter((q) => q.cadence === "ongoing").map((q) => q.id);
// THE REAL CLOCK, NOT A PINNED DAY. The pen refuses a row stamped for a
// crossing older than the open window (src/events.mjs § refuse, the act-4171
// class), and the open window is read from the wall clock. A pinned 09-28 went
// red the day the window moved to 219: a calendar-pinned control decays.
const NOW = Date.now();

// The cards the site's Quest Guild draws (site src/lib/civic.mjs § QUEST_REGISTRY): the open daily and milestone posts, by
// title, in the registry's order. It was the four cards of the pin this file was written on (the daily pair and two
// milestones, typed in); it is now read off the registry file, less the quest test 5 closes.
const CLOSED_IN_TEST_5 = "welcome-to-postmark";
const boardOf = (entries) => entries.filter((q) => ["daily", "milestone"].includes(q.cadence) && q.id !== CLOSED_IN_TEST_5).map((q) => q.title);
const BOARD = boardOf(EXPECTED);

/**
 * What a read of class quest got wrong against the pristine expectation `expected` (entries as expectedEntriesOf spells them).
 * Empty when right. The expectation is held fixed by the caller; only the compared answer moves in a detector.
 */
function postsMismatches(expected, posts) {
  const out = [];
  const got = posts.map((p) => p.fields?.quest);
  const seen = new Set();
  for (const id of got) { if (seen.has(id)) out.push(`duplicate ${id}`); seen.add(id); }
  for (const e of expected) if (!seen.has(e.id)) out.push(`missing ${e.id}`);
  const want = new Set(expected.map((e) => e.id));
  for (const id of seen) if (!want.has(id)) out.push(`unexpected ${id}`);
  if (!out.length && JSON.stringify(got) !== JSON.stringify(expected.map((e) => e.id))) out.push(`order ${got.join(",")}`);
  for (const e of expected) {
    const p = posts.find((x) => x.fields?.quest === e.id);
    if (!p) continue;
    for (const f of ["title", "source", "reward", "cadence", "target"]) {
      const g = p.terms?.[f];
      if (JSON.stringify(g) !== JSON.stringify(e[f])) out.push(`terms ${e.id}.${f}: got ${JSON.stringify(g)} wanted ${JSON.stringify(e[f])}`);
    }
  }
  return out;
}

const WRIGHT = { household: "starforge", handles: new Set(["wright"]) };
const KEEMIN = { household: "darko", handles: new Set(["keemin"]) };
const ERRANT = { household: "errant", handles: new Set(["errant"]) };

// ── the posts table, in memory, answering exactly the queries asked ─────────
function questTables() {
  const posts = new Map();
  const PC = ["id", "class", "title", "body", "author", "household", "place_mark", "place_x", "place_y",
    "starts", "ends", "state", "fields", "revised", "posted_act", "last_act"];
  const asJson = (v) => (typeof v === "string" ? JSON.parse(v) : v);
  const copy = (r) => ({ ...r, fields: { ...r.fields } });
  const also = [
    [/^INSERT INTO posts/i, (q, p) => {
      if (posts.has(p[0])) throw new Error(`duplicate key value violates unique constraint "posts_pkey"`);
      const r = Object.fromEntries(PC.map((k, i) => [k, p[i]]));
      r.fields = asJson(r.fields);
      posts.set(p[0], r);
      return { rows: [], rowCount: 1 };
    }],
    [/^UPDATE posts SET/i, (q, p) => {
      const r = posts.get(p[0]);
      Object.assign(r, { title: p[1], body: p[2], place_mark: p[3], place_x: p[4], place_y: p[5],
        starts: p[6], ends: p[7], state: p[8], fields: asJson(p[9]), revised: p[10], last_act: p[11] });
      return { rows: [], rowCount: 1 };
    }],
    [/FROM posts WHERE id = \$1 AND class = \$2$/i, (q, p) => {
      const r = posts.get(p[0]);
      const hit = r && r.class === p[1];
      return { rows: hit ? [copy(r)] : [], rowCount: hit ? 1 : 0 };
    }],
    // the seeding's own look, and the posts table's one reader (household-posts.mjs § postRowsOf)
    [/^SELECT id, state FROM posts WHERE class = \$1 ORDER BY id$/i, (q, p) => {
      const rows = [...posts.values()].filter((r) => r.class === p[0]).sort((a, b) => a.id.localeCompare(b.id)).map((r) => ({ id: r.id, state: r.state }));
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT id, class, title, author, household, starts, ends, fields, state, last_act FROM posts WHERE class = \$1 ORDER BY id$/i, (q, p) => {
      const rows = [...posts.values()].filter((r) => r.class === p[0]).sort((a, b) => a.id.localeCompare(b.id)).map(copy);
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT post, handle, state FROM responses WHERE post = ANY\(\$1\) ORDER BY post, handle$/i, () => ({ rows: [], rowCount: 0 })],
    // the rebuild's reads
    [/^SELECT \* FROM posts WHERE class = \$1 ORDER BY id$/i, (q, p) => {
      const rows = [...posts.values()].filter((r) => r.class === p[0]).sort((a, b) => a.id.localeCompare(b.id)).map(copy);
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT \* FROM responses WHERE kind = \$1 ORDER BY post, handle$/i, () => ({ rows: [], rowCount: 0 })],
  ];
  return { posts, also };
}

// The pen lives in the town's own household, as it does on prod (town
// WHITE_PAGES/postmark-pen/ADDRESS.md, "household: the town").
const HOUSES = [{ slug: "the-town", ord: 1, residents: ["postmark-pen"] }];

function setup() {
  const t = questTables();
  const pen = installActsPen({ households: HOUSES, also: t.also });
  return { ...t, pen };
}
test.afterEach(() => uninstallActsPen());

async function refusedWith(p, code, re) {
  await assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code} ${e.defect}`); if (re) assert.match(`${e.defect} ${e.hint}`, re); return true; });
}

// ── 1 ───────────────────────────────────────────────────────────────────────

test("1 · the seeding puts every registry quest up once, the pen as author and the act naming the hand; a second run posts nothing", async () => {
  const { pen, posts } = setup();
  // the registry still holds at least the eleven quests this file was written against (2 daily, 2 milestone, 7 one-time at that
  // pin), so a registry that emptied cannot pass; how many more it holds is the file's, not a typed-in number (POS-896)
  assert.ok(N_QUESTS >= 11, `the registry's quests: ${N_QUESTS}`);
  assert.deepEqual(questEntries(REGISTRY).map((q) => q.id), QUEST_IDS, "production's own list of quest posts is the file's");
  assert.ok(POT_IDS.length > 0, "the registry names pots, so the 'no pot is posted' check below is not vacuous");

  const dry = await seedQuestPosts({ hand: "wright", registry: REGISTRY, now: NOW, dryRun: true });
  assert.deepEqual(dry.would_post, QUEST_IDS.map((id) => `postmark-pen/${id}`));
  assert.equal(pen.rows().length, 0, "a dry run wrote an act");

  const run = await seedQuestPosts({ hand: "wright", registry: REGISTRY, now: NOW });
  assert.equal(run.posted.length, N_QUESTS);
  assert.equal(posts.size, N_QUESTS);
  for (const act of pen.rows()) {
    assert.equal(act.class, "quest");
    assert.equal(act.action, "post");
    assert.equal(act.actor, "postmark-pen", "the act is the town pen's");
    assert.equal(act.household, "hh:the-town", "…in the town's own household");
    assert.equal(act.at_anchor, null, "a quest has no place: the act is anchorless");
    assert.equal(JSON.parse(act.payload).hand, "wright", "the act names the hand");
  }
  for (const id of QUEST_IDS) {
    const row = posts.get(`postmark-pen/${id}`);
    assert.ok(row, `${id} is not a post row`);
    assert.deepEqual([row.class, row.author, row.household, row.state], ["quest", "postmark-pen", "hh:the-town", "open"]);
    assert.deepEqual(row.fields, { quest: id }, "the row points at its registry entry and carries nothing else");
    assert.equal(row.starts, null); assert.equal(row.place_x, null);
  }
  // every card the board shows today is one of them
  const titles = new Map([...posts.values()].map((r) => [r.title, r]));
  for (const t of BOARD) assert.equal(titles.get(t)?.author, "postmark-pen", `the board's "${t}" is not a post by the pen`);
  assert.ok(![...posts.keys()].some((id) => POT_IDS.some((pot) => id === `postmark-pen/${pot}`)), "a pot was posted");

  const again = await seedQuestPosts({ hand: "wright", registry: REGISTRY, now: NOW });
  assert.deepEqual([again.posted.length, again.already.length], [0, N_QUESTS]);
  assert.equal(pen.rows().length, N_QUESTS, "a second run wrote an act");
});

// ── 2 ───────────────────────────────────────────────────────────────────────

test("2 · only the town's hands post and close a quest: anyone else is refused and nothing is written", async () => {
  const { pen, posts } = setup();
  assert.deepEqual(QUEST_HANDS, ["wright", "keemin"]);
  await refusedWith(postAtTown({ class: "quest", quest: "correspond-send" }, ERRANT, { now: NOW, registry: REGISTRY }), 403, /only the town posts and closes/);
  await refusedWith(seedQuestPosts({ hand: "errant", registry: REGISTRY, now: NOW }), 403, /only the town/);
  assert.equal(pen.rows().length, 0);
  // the pen's own handle is not a hand: it is the author
  await refusedWith(postAtTown({ class: "quest", quest: "correspond-send" }, { handles: new Set(["postmark-pen"]) }, { now: NOW, registry: REGISTRY }), 403);

  const k = await postAtTown({ class: "quest", quest: "correspond-send" }, KEEMIN, { now: NOW, registry: REGISTRY });
  assert.equal(k.hand, "keemin");
  assert.equal(k.post.author, "postmark-pen");
  await postAtTown({ class: "quest", quest: "first-idea" }, WRIGHT, { now: NOW, registry: REGISTRY });
  await refusedWith(closeAtTown({ post: "postmark-pen/first-idea" }, ERRANT, { now: NOW }), 403, /only the town/);
  assert.equal(posts.get("postmark-pen/first-idea").state, "open");
  assert.equal(pen.rows().length, 2);
});

test("2b · a pot, an unknown quest, a repeat and a stray field are each refused by name", async () => {
  const { pen } = setup();
  await refusedWith(postAtTown({ class: "quest", quest: "keeping-ec2" }, WRIGHT, { now: NOW, registry: REGISTRY }), 422, /funding pot.*POS-291/);
  await refusedWith(postAtTown({ class: "quest", quest: "no-such" }, WRIGHT, { now: NOW, registry: REGISTRY }), 404, /no quest "no-such"/);
  await refusedWith(postAtTown({ class: "quest" }, WRIGHT, { now: NOW, registry: REGISTRY }), 422, /which quest/);
  await postAtTown({ class: "quest", quest: "correspond-send" }, WRIGHT, { now: NOW, registry: REGISTRY });
  await refusedWith(postAtTown({ class: "quest", quest: "correspond-send" }, WRIGHT, { now: NOW, registry: REGISTRY }), 409, /already posted/);
  assert.equal(pen.rows().length, 1);
  const { townPostEvent } = await import("../src/town-post.mjs");
  const stray = await townPostEvent({ class: "quest", quest: "first-idea", title: "mine" }, WRIGHT);
  assert.equal(stray.code, 422);
  assert.match(stray.defect, /a quest does not take: title/);
  assert.equal(pen.rows().length, 1);
});

// ── 2c · POS-816/g: the monthly cadence ─────────────────────────────────────
// Darko 2026-11-03 09:42 EST: "if it's easier to just make a monthly cadence and keep things flat that's fine
// with me." Until 2026-11-03 Bring a neighbour wore the pots' "ongoing", and judgeQuestEntry refused it as "a
// funding pot, not a quest post" (Truey, postmark#4424 finding 1). `monthly` is a quest cadence now; `ongoing`
// stays the pots'.
const MONTHLY_REGISTRY = () => ({ quests: [
  { id: "bring-a-neighbour", title: "Bring a neighbour", cadence: "monthly", validation: "automatic", source: "Invite someone you'd like to have in town.", reward: "10 stamps", target: 10 },
  { id: "keeping-pot", title: "A pot", cadence: "ongoing", subtype: "bounty", validation: "needs-review", target: 200 },
  { id: "fortnightly-thing", title: "A cadence nobody named", cadence: "fortnightly" },
] });

test("2c · a monthly row is a quest post, a pot's ongoing is still refused, and a cadence nobody named is not a quest's", async () => {
  const { pen, posts } = setup();
  const { judgeQuestEntry, QUEST_CADENCES, POT_CADENCE } = await import("../src/quests.mjs");
  const reg = MONTHLY_REGISTRY();
  assert.ok(QUEST_CADENCES.includes("monthly"));
  assert.equal(QUEST_CADENCES.includes(POT_CADENCE), false, "ongoing is the pots', not a quest cadence");
  assert.deepEqual(questEntries(reg).map((q) => q.id), ["bring-a-neighbour"], "the board's quests: the monthly row, not the pot, not the cadence nobody named");
  assert.equal(judgeQuestEntry(reg, "bring-a-neighbour").cadence, "monthly");
  const posted = await postAtTown({ class: "quest", quest: "bring-a-neighbour" }, WRIGHT, { now: NOW, registry: reg });
  assert.equal(posted.post.id, "postmark-pen/bring-a-neighbour");
  assert.equal(posts.get("postmark-pen/bring-a-neighbour").state, "open", "put up, as the town's post");
  assert.equal(pen.rows().length, 1);
  await refusedWith(postAtTown({ class: "quest", quest: "keeping-pot" }, WRIGHT, { now: NOW, registry: reg }), 422, /funding pot.*POS-291/);
  await refusedWith(postAtTown({ class: "quest", quest: "fortnightly-thing" }, WRIGHT, { now: NOW, registry: reg }), 422, /cadence "fortnightly", which is not a quest's.*daily, monthly, milestone, one-time/);
  assert.equal(pen.rows().length, 1, "a refused post wrote an act");
});

test("2c · the town's own bring-a-neighbour row is a quest post, once the town carries it (INVITE_TOWN_CLONE)", { skip: INVITE_TOWN ? false : "needs postmark#4424's quest-registry.json row: set INVITE_TOWN_CLONE to a town checkout carrying it" }, async () => {
  const { pen } = setup();
  const real = readQuestRegistry(INVITE_TOWN);
  const row = real.quests.find((q) => q.id === "bring-a-neighbour");
  assert.equal(row?.cadence, "monthly", "the town's row is the monthly one");
  assert.ok(questEntries(real).some((q) => q.id === "bring-a-neighbour"), "the board's quests include it");
  const posted = await postAtTown({ class: "quest", quest: "bring-a-neighbour" }, WRIGHT, { now: NOW, registry: real });
  assert.equal(posted.post.id, "postmark-pen/bring-a-neighbour");
  assert.equal(pen.rows().length, 1);
});

// ── 3 ───────────────────────────────────────────────────────────────────────

test("3 · closing a quest is an act that names its hand; it stays, closed, and the seeding never puts it back", async () => {
  const { pen, posts } = setup();
  await seedQuestPosts({ hand: "wright", registry: REGISTRY, now: NOW });
  const c = await closeAtTown({ post: "postmark-pen/first-idea" }, KEEMIN, { now: NOW + 1000 });
  assert.equal(c.state, "closed");
  assert.equal(c.hand, "keemin");
  const act = pen.rows().at(-1);
  assert.deepEqual([act.class, act.action, act.actor, act.object], ["quest", "close", "postmark-pen", "postmark-pen/first-idea"]);
  assert.deepEqual(JSON.parse(act.payload), { post: "postmark-pen/first-idea", state: "closed", hand: "keemin" });
  const row = posts.get("postmark-pen/first-idea");
  assert.deepEqual([row.state, row.author, row.last_act], ["closed", "postmark-pen", act.id]);
  await refusedWith(closeAtTown({ post: "postmark-pen/first-idea", class: "quest" }, WRIGHT, { now: NOW }), 409, /already closed/);
  const again = await seedQuestPosts({ hand: "wright", registry: REGISTRY, now: NOW });
  assert.equal(again.posted.length, 0, "a closed quest was put back up");
});

// ── 4 ───────────────────────────────────────────────────────────────────────

test("4 · a quest takes no amend and no advance, refused by name, with or without its class", async () => {
  const { pen } = setup();
  await postAtTown({ class: "quest", quest: "correspond-send" }, WRIGHT, { now: NOW, registry: REGISTRY });
  const n = pen.rows().length;
  await refusedWith(amendAtTown({ post: "postmark-pen/correspond-send", title: "Reach further" }, WRIGHT, { now: NOW }), 422, /a quest is not amended.*registry/);
  await refusedWith(amendAtTown({ post: "postmark-pen/correspond-send", class: "quest", title: "x" }, WRIGHT, { now: NOW }), 422, /not amended/);
  await refusedWith(advanceAtTown({ post: "postmark-pen/correspond-send", to: "closed" }, WRIGHT), 422, /a quest has no advance/);
  await refusedWith(advanceAtTown({ post: "postmark-pen/correspond-send", class: "quest" }, WRIGHT), 422, /no advance/);
  assert.equal(pen.rows().length, n, "a refused verb wrote an act");
});

// ── 5 ───────────────────────────────────────────────────────────────────────

test("5 · the posts read answers class quest: the registry's order and terms, the class's finished states, no progress, from the one reader", async () => {
  const { pen } = setup();
  await seedQuestPosts({ hand: "wright", registry: REGISTRY, now: NOW });
  await closeAtTown({ post: "postmark-pen/welcome-to-postmark" }, WRIGHT, { now: NOW });
  const before = pen.asked().length;
  const r = await postsAtOffice({ class: "quest" }, { now: NOW, townClone: TOWN });
  const asked = pen.asked().slice(before).filter((q) => !/^(BEGIN|COMMIT|ROLLBACK)/.test(q) && !/set_config|statement_timeout|SET /i.test(q));
  assert.deepEqual(asked.filter((q) => /FROM posts/.test(q)),
    ["SELECT id, class, title, author, household, starts, ends, fields, state, last_act FROM posts WHERE class = $1 ORDER BY id"],
    "the read asks the posts table exactly the one reader's question");

  assert.equal(r.class, "quest");
  assert.deepEqual(r.finished, ["closed"]);
  assert.equal(r.total, N_QUESTS);
  assert.deepEqual(r.posts.map((p) => p.fields.quest), QUEST_IDS, "the registry's own order");
  // every quest, its order and each of its five terms, against the pristine file (a missing, duplicated or changed one is named)
  assert.deepEqual(postsMismatches(EXPECTED, r.posts), []);
  const send = r.posts[0];
  assert.deepEqual(Object.keys(send).sort(), ["author", "class", "fields", "history", "household", "id", "latest", "responses", "state", "terms", "title"]);
  assert.deepEqual(send.terms, { title: EXPECTED[0].title, source: EXPECTED[0].source, reward: EXPECTED[0].reward, cadence: EXPECTED[0].cadence, target: EXPECTED[0].target },
    "the first post's terms are the file's first quest, field for field");
  assert.deepEqual([send.author, send.household, send.state, send.responses, send.latest.act], ["postmark-pen", "hh:the-town", "open", 0, "post"]);
  assert.ok(!("progress" in send), "progress is derived from the letters, never on the post");
  const welcome = r.posts.find((p) => p.fields.quest === "welcome-to-postmark");
  assert.deepEqual([welcome.state, welcome.latest.act], ["closed", "close"]);
  // every class carries its history (POS-547, generalized for POS-290): a quest's is its post and its close, by the hand
  assert.deepEqual(welcome.history.map(({ at, ...h }) => h), [{ stage: "open", state: "open", hand: "wright" }, { stage: "closed", state: "closed", hand: "wright" }]);
  assert.deepEqual(send.history.map(({ at, ...h }) => h), [{ stage: "open", state: "open", hand: "wright" }]);
  // what the Guild draws: the open daily and milestone posts, by their terms
  const guild = r.posts.filter((p) => p.state === "open" && ["daily", "milestone"].includes(p.terms.cadence)).map((p) => p.terms.title);
  assert.deepEqual(guild, BOARD);

  const one = await postsAtOffice({ class: "quest", post: "postmark-pen/first-idea" }, { now: NOW, townClone: TOWN });
  assert.equal(one.post.terms.title, EXPECTED.find((q) => q.id === "first-idea").title, "the post first-idea carries the file's title for first-idea");
  await refusedWith(postsAtOffice({ class: "quest", post: "postmark-pen/nothing" }, { now: NOW, townClone: TOWN }), 404);
  // an idea is a post class since POS-290: the read answers what the store holds (here, none)
  assert.equal((await postsAtOffice({ class: "idea" }, { now: NOW, townClone: TOWN })).total, 0);
  await refusedWith(postsAtOffice({}, { now: NOW, townClone: TOWN }), 422, /which class/);
  // a registry that cannot be read is said, never a quiet copy of the stored title
  const blind = await postsAtOffice({ class: "quest" }, { now: NOW, townClone: join(DIR, "nowhere") });
  assert.match(blind.unavailable, /registry could not be read/);
  assert.equal(blind.posts[0].terms, null);
});

// ── 6 ───────────────────────────────────────────────────────────────────────

test("6 · the rebuild folds the quest acts back into exactly the rows the pen wrote, and a hand-edited row is drift", async () => {
  const { pen, posts } = setup();
  await seedQuestPosts({ hand: "wright", registry: REGISTRY, now: NOW });
  await closeAtTown({ post: "postmark-pen/first-idea" }, WRIGHT, { now: NOW });
  const out = await dryRun(pen);
  assert.equal(out.equal, true, out.drift.join("; "));
  assert.deepEqual([out.counts.quest_acts, out.counts.quests], [N_QUESTS + 1, N_QUESTS], "one post act per quest, and the one close");
  const quests = [...posts.values()].map((r) => ({ ...r, fields: { ...r.fields } }));
  quests[0].state = "closed";
  const acts = pen.rows().map((a) => ({ ...a, payload: JSON.parse(a.payload) }));
  assert.equal(compareRebuild({ posts: quests, responses: [] }, acts).equal, false, "an edited quest row read as equal");
});

// ── the town door ───────────────────────────────────────────────────────────

test("the town door: read: \"posts\" and read: \"quest\" serve read_posts, the alias with its class fixed", async () => {
  const { townApex, TOWN_READS } = await import("../src/town-apex.mjs");
  const { TOOLS } = await import("../src/mcp.mjs");
  const schemas = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.properties ?? {}]));
  assert.equal(TOWN_READS.posts.tool, "read_posts");
  const calls = [];
  const call = async (tool, fields) => { calls.push({ tool, fields }); return { ok: tool }; };
  await townApex({ read: "quest" }, null, { call, schemas });
  await townApex({ read: "posts", args: { class: "event" } }, null, { call, schemas });
  assert.deepEqual(calls, [{ tool: "read_posts", fields: { class: "quest" } }, { tool: "read_posts", fields: { class: "event" } }]);
});

// ── THE DETECTORS (POS-896): an invented registry, the pristine expectation held fixed, one wrong answer per branch ──
// The shapes are the minimal admitted ones (a daily, a milestone, a one-time, and a pot that is not a quest). Every detector
// asks the REAL seeding and the REAL read; only the registry the code reads (or the answer compared) moves, never the oracle.
const INVENTED_QUESTS = [
  { id: "inv-daily", title: "Invented daily", cadence: "daily", validation: "automatic", source: "Do the invented daily thing 3 times.", reward: "1 stamp each", target: 3 },
  { id: "inv-milestone", title: "Invented milestone", cadence: "milestone", validation: "needs-review", source: "Do the invented milestone once.", reward: "5 stamps", target: 1 },
  { id: "inv-once", title: "Invented one-time", cadence: "one-time", validation: "automatic", source: "Do the invented one-time thing.", reward: "2 stamps" },
  { id: "inv-pot", title: "Invented pot", cadence: "ongoing", subtype: "bounty", validation: "needs-review", source: "A pot of the invented town.", reward: "" },
];
const PRISTINE = expectedEntriesOf(INVENTED_QUESTS);
let inventedTowns = 0;
/** An invented town dir holding `quests` as its registry, under this file's own temp root. */
function inventedTown(quests) {
  const dir = join(DIR, `invented-${inventedTowns += 1}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "quest-registry.json"), JSON.stringify({ quests }));
  return dir;
}
/** Seed the pen from `quests` (what the code reads), read class quest back from the same dir. */
async function seededAndRead(quests) {
  setup();
  const dir = inventedTown(quests);
  await seedQuestPosts({ hand: "wright", registry: readQuestRegistry(dir), now: NOW });
  return postsAtOffice({ class: "quest" }, { now: NOW, townClone: dir });
}

test("detector · the pristine invented registry is seeded and read as the pristine expectation says (the oracle agrees with the code)", async () => {
  const r = await seededAndRead(INVENTED_QUESTS);
  assert.deepEqual(postsMismatches(PRISTINE, r.posts), []);
  assert.equal(r.total, 3, "three quests; the pot is not a post");
  assert.deepEqual(boardOf(PRISTINE), ["Invented daily", "Invented milestone"]);
});

test("detector · a quest the registry loses is named missing (the pristine expectation still has it)", async () => {
  const r = await seededAndRead(INVENTED_QUESTS.filter((q) => q.id !== "inv-once"));
  assert.deepEqual(postsMismatches(PRISTINE, r.posts), ["missing inv-once"]);
});

test("detector · a quest the registry adds is named unexpected", async () => {
  const r = await seededAndRead([...INVENTED_QUESTS, { id: "inv-extra", title: "Extra", cadence: "one-time", source: "x", reward: "1 stamp" }]);
  assert.deepEqual(postsMismatches(PRISTINE, r.posts), ["unexpected inv-extra"]);
});

test("detector · a changed reward is named by quest and field, wanted and got", async () => {
  const r = await seededAndRead(INVENTED_QUESTS.map((q) => (q.id === "inv-daily" ? { ...q, reward: "9 stamps each" } : q)));
  assert.deepEqual(postsMismatches(PRISTINE, r.posts), ['terms inv-daily.reward: got "9 stamps each" wanted "1 stamp each"']);
});

test("detector · a changed target and a changed cadence are each named", async () => {
  const r = await seededAndRead(INVENTED_QUESTS.map((q) => (q.id === "inv-milestone" ? { ...q, target: 2 } : q)));
  assert.deepEqual(postsMismatches(PRISTINE, r.posts), ["terms inv-milestone.target: got 2 wanted 1"]);
  const r2 = await seededAndRead(INVENTED_QUESTS.map((q) => (q.id === "inv-once" ? { ...q, cadence: "monthly" } : q)));
  assert.deepEqual(postsMismatches(PRISTINE, r2.posts), ['terms inv-once.cadence: got "monthly" wanted "one-time"']);
});

test("detector · a duplicated answer row and a swapped order are named (the compared answer moves, the oracle does not)", async () => {
  const r = await seededAndRead(INVENTED_QUESTS);
  assert.deepEqual(postsMismatches(PRISTINE, [...r.posts, r.posts[0]]), ["duplicate inv-daily"]);
  assert.deepEqual(postsMismatches(PRISTINE, [r.posts[1], r.posts[0], r.posts[2]]), ["order inv-milestone,inv-daily,inv-once"]);
});

test("detector · a pot that comes up as a post is named unexpected, and the pot is never in the expectation", async () => {
  const r = await seededAndRead(INVENTED_QUESTS);
  const withPot = [...r.posts, { ...r.posts[0], fields: { quest: "inv-pot" } }];
  assert.deepEqual(postsMismatches(PRISTINE, withPot), ["unexpected inv-pot"]);
  assert.equal(PRISTINE.some((q) => q.id === "inv-pot"), false);
});
