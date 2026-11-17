// pos854-idea-post-reads.test.mjs — idea posts carry a stake, are listed by it, and are made from marks (POS-854).
//
//   node --test test/pos854-idea-post-reads.test.mjs
//
// THE RULING (Darko, 2026-11-16 22:44 EST): "Oh, yeah, no consent chase. And the idea, stakes carry over, exactly,
// like you said." And on the sort (22:51): "by recency or by like most stamps staked … keep it simple".
//
// ⚑ THE STORE IS A JS STUB (`acts-pen-stub.mjs`), as in idea-post.test.mjs: it proves which acts and rows the pen
// writes and what the reads make of them, nothing about Postgres. THE LEDGER'S FOLD is not a stub here: a post's
// stake in every row below is read through `backing`, the seam postsAtOffice and householdPosts take, and the
// real fold over a real signed ledger is pinned in pos854-idea-marks-to-posts.test.mjs.
//
// Synthetic handles, marks and posts throughout.

import test from "node:test";
import assert from "node:assert/strict";
import { installActsPen, uninstallActsPen, RECORD_ON } from "./acts-pen-stub.mjs";

Object.assign(process.env, RECORD_ON);
const { postsAtOffice, POSTS_PARAMS, unknownPostsParam } = await import("../src/town-posts.mjs");
const { convertMarkToIdeaPost, ideaPostDatesBy, standingIdeaPosts } = await import("../src/idea-store.mjs");
const { householdPosts } = await import("../src/household-posts.mjs");
const { firstIdeaStanding } = await import("../src/queries.mjs");
const { firstIdeaCandidates, FIRST_IDEA_WINDOW_END } = await import("../src/first-idea-sweep.mjs");
const { resetChainMemo } = await import("../src/post-history.mjs");

const NOW = Date.parse("2026-11-17T12:00:00Z");
const ON = { ...process.env, IDEA_POSTS: "1" };
const OFF = { ...process.env, IDEA_POSTS: undefined };
const HOUSES = [{ slug: "the-harbor", ord: 1, residents: ["ana", "bo"] }];
const ROLL = new Set(["ana", "bo", "cy", "wright"]);
const isoAt = (d) => new Date(d).toISOString();

// ── a store: posts, responses and the acts the pen files ────────────────────
function tables() {
  const posts = new Map();
  const PC = ["id", "class", "title", "body", "author", "household", "place_mark", "place_x", "place_y",
    "starts", "ends", "state", "fields", "revised", "posted_act", "last_act"];
  const asJson = (v) => (typeof v === "string" ? JSON.parse(v) : v);
  const copy = (r) => ({ ...r, fields: { ...r.fields } });
  const byClass = (cls) => [...posts.values()].filter((r) => r.class === cls).sort((a, b) => a.id.localeCompare(b.id)).map(copy);
  const marks = new Set(["ana/a-mark-of-ana"]);   // a Think Tank mark's id: an id the pen never reuses
  const also = [
    [/^INSERT INTO posts/i, (q, p) => { const r = Object.fromEntries(PC.map((k, i) => [k, p[i]])); r.fields = asJson(r.fields); posts.set(p[0], r); return { rows: [], rowCount: 1 }; }],
    [/^SELECT id FROM posts WHERE id LIKE \$1$/i, (q, p) => { const pre = p[0].replace(/%$/, ""); const rows = [...posts.keys()].filter((id) => id.startsWith(pre)).map((id) => ({ id })); return { rows, rowCount: rows.length }; }],
    [/^SELECT slug FROM marks WHERE slug LIKE \$1$/i, (q, p) => { const pre = p[0].replace(/%$/, ""); const rows = [...marks].filter((s) => s.startsWith(pre)).map((slug) => ({ slug })); return { rows, rowCount: rows.length }; }],
    [/^SELECT id FROM posts WHERE class = \$1 AND fields->'origin'->>'mark' = \$2$/i, (q, p) => {
      const rows = [...posts.values()].filter((r) => r.class === p[0] && r.fields?.origin?.mark === p[1]).map((r) => ({ id: r.id }));
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT id, class, title, author, household, starts, ends, fields, state, last_act(?:, body)? FROM posts WHERE class = \$1 ORDER BY id$/i, (q, p) => { const rows = byClass(p[0]); return { rows, rowCount: rows.length }; }],
    [/^SELECT id, author, fields FROM posts WHERE class = \$1 AND author = ANY\(\$2\) ORDER BY id$/i, (q, p) => {
      const rows = byClass(p[0]).filter((r) => p[1].includes(r.author)).map(({ id, author, fields }) => ({ id, author, fields }));
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT id, body FROM posts WHERE id = ANY\(\$1\) AND class = \$2$/i, (q, p) => { const rows = [...posts.values()].filter((r) => p[0].includes(r.id) && r.class === p[1]).map((r) => ({ id: r.id, body: r.body })); return { rows, rowCount: rows.length }; }],
    [/^SELECT id, author FROM posts WHERE class = \$1 ORDER BY id$/i, (q, p) => { const rows = byClass(p[0]).map((r) => ({ id: r.id, author: r.author })); return { rows, rowCount: rows.length }; }],
    [/^SELECT post, handle, state FROM responses WHERE post = ANY\(\$1\) ORDER BY post, handle$/i, () => ({ rows: [], rowCount: 0 })],
    [/^SELECT post, handle, kind, state, fields FROM responses WHERE post = ANY\(\$1\) AND kind = ANY\(\$2\) ORDER BY post, handle$/i, () => ({ rows: [], rowCount: 0 })],
    // the stamp chain (066): present and empty, so a history row's stamps_paid is null and nothing else is unavailable
    [/^SELECT to_regclass\('stamp_lines'\) IS NOT NULL AS ok$/i, () => ({ rows: [{ ok: true }], rowCount: 1 })],
    [/^SELECT seq, seal FROM stamp_lines ORDER BY seq DESC LIMIT 1$/i, () => ({ rows: [], rowCount: 0 })],
  ];
  return { posts, marks, also };
}
let t, pen;
function setup() { resetChainMemo(); t = tables(); pen = installActsPen({ households: HOUSES, marks: [{ id: 1, slug: "ana/a-mark-of-ana" }], also: t.also }); return t; }
test.afterEach(() => uninstallActsPen());

/** A post straight into the table, as the pen's one fold would leave it. */
function seedIdea(id, author, household, { title = id.split("/")[1], fields = {}, state = "posted" } = {}) {
  t.posts.set(id, { id, class: "idea", title, body: `${title}.`, author, household, place_mark: null, place_x: null, place_y: null,
    starts: null, ends: null, state, fields, revised: 0, posted_act: 1, last_act: 1 });
}
/** The ledger's fold as `postBackingOf` answers it, for a suite: `{ escrow, holders }`. */
const backingOf = (stakes) => async () => {
  const escrow = new Map(), holders = new Map();
  for (const [post, handle, n, side = "for"] of stakes) {
    escrow.set(post, (escrow.get(post) ?? 0) + n);
    holders.set(post, [...(holders.get(post) ?? []), { handle, n, side }]);
  }
  return { escrow, holders };
};
const STAKES = [["ana/lantern", "bo", 5], ["ana/lantern", "cy", 2], ["bo/bell", "ana", 1], ["cy/quiet", "ana", 9]];
const list = (fields, extra = {}) => postsAtOffice({ class: "idea", ...fields }, { now: NOW, env: ON, backing: backingOf(STAKES), ...extra });

// ── the sort ────────────────────────────────────────────────────────────────

test("sort: staked lists the ideas by the stamps standing behind them, most first, and says what it sorted by", async () => {
  setup();
  seedIdea("ana/lantern", "ana", "hh:the-harbor"); seedIdea("bo/bell", "bo", "hh:the-harbor"); seedIdea("cy/quiet", "cy", "solo:cy");
  const r = await list({ sort: "staked" });
  assert.deepEqual(r.posts.map((p) => [p.id, p.stake]), [["cy/quiet", 9], ["ana/lantern", 7], ["bo/bell", 1]],
    'LAW (Wright on Darko 22:51, POS-844): "[sort] gains one sort, sort: recent | staked, because POS-854 puts stake totals on post rows anyway"');
  assert.equal(r.sort, "staked"); assert.equal(r.sort_note, undefined);
  assert.equal(r.posts[1].backing.for, 7); assert.equal(r.posts[1].backing.stakers, 2); assert.equal(r.posts[1].backing.net, 7);
  assert.equal((await list({})).sort, undefined, "no sort asked: the class's own order, and no sort key");
});

test("sort: recent is newest activity first, and a stake ties break by recency", async () => {
  setup();
  seedIdea("ana/lantern", "ana", "hh:the-harbor"); seedIdea("bo/bell", "bo", "hh:the-harbor"); seedIdea("cy/quiet", "cy", "solo:cy");
  const acts = { "ana/lantern": "2026-11-01T00:00:00Z", "bo/bell": "2026-11-16T00:00:00Z", "cy/quiet": "2026-11-10T00:00:00Z" };
  for (const [object, at] of Object.entries(acts)) await pen.query("INSERT INTO acts (at, actor, action, object, class, payload) VALUES ($1, $2, $3, $4, $5, $6)", [at, "x", "post", object, "idea", "{}"]);
  const recent = await list({ sort: "recent" });
  assert.deepEqual(recent.posts.map((p) => p.id), ["bo/bell", "cy/quiet", "ana/lantern"], "newest act first");
  const tied = await list({ sort: "staked" }, { backing: backingOf([["ana/lantern", "bo", 3], ["bo/bell", "ana", 3], ["cy/quiet", "ana", 3]]) });
  assert.deepEqual(tied.posts.map((p) => p.id), ["bo/bell", "cy/quiet", "ana/lantern"], "equal stakes read newest first");
});

test("sort: staked on a class that takes no stake answers newest first and says so, never a refusal", async () => {
  setup();
  const r = await postsAtOffice({ class: "bug", sort: "staked" }, { now: NOW, env: ON });
  assert.equal(r.sort, "recent");
  assert.match(r.sort_note, /a bug takes no stake, so there is nothing to sort by: this list is newest first \(sort: "staked" applies to idea\)/);
});

test("sort: anything else is a 422 naming both sorts, and `sort` is a known parameter on the plain read", async () => {
  setup();
  await assert.rejects(list({ sort: "loudest" }), (e) => e.code === 422 && /sort is one of recent or staked/.test(e.defect) && e.field === "sort");
  assert.ok(POSTS_PARAMS.includes("sort"));
  assert.equal(unknownPostsParam(["class", "sort"]), null, "the REST read takes ?sort= without a 400");
  assert.equal(unknownPostsParam(["srot"]).code, 400, "a typo still names the nearest known one");
});

// ── the row ─────────────────────────────────────────────────────────────────

test("an idea post's row carries its stake and who stands behind it (the one post), and a ledger that cannot be read says so instead of a quiet zero", async () => {
  setup();
  seedIdea("ana/lantern", "ana", "hh:the-harbor");
  const one = (await list({ post: "ana/lantern" })).post;
  assert.equal(one.stake, 7);
  assert.deepEqual(one.stakes, [{ handle: "bo", stamps: 5 }, { handle: "cy", stamps: 2 }], "each staker's position, public as escrow is");
  const lst = await list({});
  assert.equal("stakes" in lst.posts[0], false, "the list carries totals; the positions ride the one post");
  const broken = await list({}, { backing: async () => { throw new Error("no ledger"); } });
  assert.equal(broken.posts[0].stake, null, "an unread ledger is null, not 0");
  assert.match(broken.unavailable, /stakes behind the ideas could not be read/);
  uninstallActsPen(); setup();   // an empty store
  const none = await postsAtOffice({ class: "idea" }, { now: NOW, env: ON, backing: async () => { throw new Error("must not be asked"); } });
  assert.equal(none.total, 0); assert.equal(none.unavailable, undefined, "no idea post, no ledger read, nothing unavailable");
});

test("a post made from a mark is read as active on the day its author put the mark up, until something newer happens", async () => {
  setup();
  seedIdea("ana/old-thought", "ana", "hh:the-harbor", { fields: { origin: { mark: "ana/m", date: "2026-09-05T00:00:00.000Z" } } });
  seedIdea("bo/new-thought", "bo", "hh:the-harbor");
  await pen.query("INSERT INTO acts (at, actor, action, object, class, payload) VALUES ($1, $2, $3, $4, $5, $6)", [isoAt(NOW), "ana", "post", "ana/old-thought", "idea", "{}"]);
  await pen.query("INSERT INTO acts (at, actor, action, object, class, payload) VALUES ($1, $2, $3, $4, $5, $6)", [isoAt(NOW - 1000), "bo", "post", "bo/new-thought", "idea", "{}"]);
  const r = await list({ sort: "recent" });
  assert.deepEqual(r.posts.map((p) => [p.id, p.latest.at]), [["bo/new-thought", isoAt(NOW - 1000)], ["ana/old-thought", "2026-09-05T00:00:00.000Z"]],
    "the converted post does not read as written the minute the tool ran");
  await pen.query("INSERT INTO acts (at, actor, action, object, class, payload) VALUES ($1, $2, $3, $4, $5, $6)", [isoAt(NOW + 5000), "ana", "amend-post", "ana/old-thought", "idea", "{}"]);
  const later = await list({ sort: "recent" });
  assert.equal(later.posts[0].id, "ana/old-thought", "its first later act is newer, and wins");
});

// ── the household's rows ────────────────────────────────────────────────────

const REGISTRY = { registry: { registry: { households: { "the-harbor": { residents: ["ana", "bo"] } } }, pins: {} } };
const house = (handle, extra = {}) => householdPosts(handle, { now: NOW, env: ON, townClone: "/no/such/town", readers: REGISTRY, backingOf: backingOf(STAKES), ...extra });

test("a household's idea row carries what stands behind the post and the house's part of it; a house that staked another's idea takes part", async () => {
  setup();
  seedIdea("ana/lantern", "ana", "hh:the-harbor"); seedIdea("cy/quiet", "cy", "solo:cy"); seedIdea("cy/unstaked-by-us", "cy", "solo:cy");
  const a = await house("ana");
  const mine = a.put_up.rows.find((r) => r.id === "ana/lantern");
  assert.deepEqual([mine.role, mine.stake, mine.ours], ["author", 7, 5], "the post's stake is the ledger's 7, and the house's part (bo) is 5");
  const theirs = a.taking_part.rows.find((r) => r.id === "cy/quiet");
  assert.deepEqual([theirs.role, theirs.stake, theirs.ours], ["participant", 9, 9], "ana staked cy's idea: the house takes part, with its own ✦9");
  assert.equal(a.taking_part.rows.find((r) => r.id === "cy/unstaked-by-us"), undefined, "an idea the house neither wrote nor staked is not the house's");
  const closed = await house("ana", { env: OFF, backingOf: async () => { throw new Error("must not be asked"); } });
  assert.ok(!(closed.unavailable ?? []).some((u) => /idea|stakes/.test(u)), "while the class is closed there is no idea post to back: the ledger is not read, and nothing about it is said");
});

/** A world store whose Think Tank holds these idea marks `[id, by, date]`, published as the office reads it; `done()` puts the env back. */
async function publishTank(marks, { declare = true } = {}) {
  const world = await import("./helpers/world-rows.mjs");
  const { DatabaseSync } = await import("node:sqlite");
  const { tempDir } = await import("./helpers/temp-dir.mjs");
  const { join } = await import("node:path");
  const path = join(tempDir("pos854-tank-"), "world.db"); const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, subkind TEXT, tier TEXT, by TEXT, at_x REAL, at_y REAL, extent_w REAL, extent_h REAL, props TEXT);
           CREATE TABLE edges (seq INTEGER PRIMARY KEY AUTOINCREMENT, src TEXT, dst TEXT, type TEXT, props TEXT, born_at TEXT)`);
  db.prepare("INSERT INTO meta (key, value) VALUES ('hydration_status','OK')").run();
  if (declare) db.prepare(`INSERT INTO nodes (id, kind, subkind, tier, by, props) VALUES ('the-town/idea', 'mark', 'class', 'constitution', 'the-town', ?)`).run(JSON.stringify({ class: "idea", in_works: 1, body: "THE DECLARATION'S LAW SENTENCE" }));
  for (const [id, by, date] of marks) {
    db.prepare("INSERT INTO nodes (id, kind, subkind, tier, by, props) VALUES (?, 'mark', 'sited', 'market', ?, ?)").run(id, by, JSON.stringify({ class: "idea", body: `${id}.`, date }));
    db.prepare("INSERT INTO edges (src, dst, type) VALUES (?, 'the-town/idea', 'instance-of')").run(id);
  }
  db.close();
  const saved = process.env.WORLD_STORE_DB;
  world.publishWorld(path); process.env.WORLD_STORE_DB = world.NO_WORLD_DB;
  return () => { if (saved === undefined) delete process.env.WORLD_STORE_DB; else process.env.WORLD_STORE_DB = saved; };
}

test("a mark that has become its author's post is read once, as the post, while the mark still stands", async () => {
  setup();
  seedIdea("ana/lantern-2", "ana", "hh:the-harbor", { fields: { origin: { mark: "ana/lantern", date: "2026-09-05T00:00:00.000Z" } } });
  const { officeRead } = await import("../src/world2-pen.mjs");
  const { postRowsOf, unconvertedMarks } = await import("../src/household-posts.mjs");
  const postRows = await officeRead((c) => postRowsOf(c, "idea", NOW), { env: ON });
  const marks = [{ class: "idea", id: "ana/lantern" }, { class: "idea", id: "ana/kept-mark" }];
  assert.deepEqual(unconvertedMarks(marks, postRows).map((m) => m.id), ["ana/kept-mark"],
    "the mark the post came from is read as the post; a mark nobody has carried across is still read, as the mark");
  assert.equal(unconvertedMarks(marks, []).length, 2, "with no post made from a mark, both marks stand as they were");
  const a = await house("ana");
  assert.ok(a.put_up.rows.some((r) => r.id === "ana/lantern-2"), "the post is the house's, and its origin never reaches the answer");
  assert.equal(JSON.stringify(a).includes('"origin"'), false);
});

// ── the first-idea fact stays true after the marks are posts ────────────────

test("the first-idea fact counts idea posts, a converted post keeps the mark's own day, and an unread post store is null, never 'none'", async () => {
  const done = await publishTank([["ana/lantern", "ana", "2026-09-05"]]);
  try {
    assert.deepEqual(firstIdeaStanding("cy", { house: ["cy"], posts: [] }), { complete: false, since: null, by: null }, "no mark, no post: not met");
    // once the mark is withdrawn the post stands in for it, with the mark's own day: the quest is met on the day it was met
    assert.deepEqual(firstIdeaStanding("cy", { house: ["cy"], posts: [{ by: "cy", date: "2026-08-31T00:00:00.000Z" }] }), { complete: true, since: "2026-08-31T00:00:00.000Z", by: "cy" },
      "an idea post is a published idea: converting a mark must not take the first-idea row away from its author");
    assert.deepEqual(firstIdeaStanding("bo", { house: ["bo", "ana"], posts: [{ by: "bo", date: "2026-10-30T00:00:00.000Z" }] }), { complete: true, since: "2026-09-05", by: "ana" },
      "the household's EARLIEST idea, mark or post, is the day it was met");
    assert.equal(firstIdeaStanding("cy", { house: ["cy"], posts: false }), null, "a post store that could not be read is null, never a quiet 'you have not published an idea'");
    assert.deepEqual(firstIdeaStanding("cy", { house: ["cy"] }), { complete: false, since: null, by: null }, "a caller that does not ask for posts reads the marks, as before");
  } finally { done(); }
});

test("ideaPostDatesBy answers the posts' days (a converted post keeps the mark's date), [] while the class is closed", async () => {
  setup();
  seedIdea("ana/old", "ana", "hh:the-harbor", { fields: { origin: { mark: "ana/m", date: "2026-09-05T00:00:00.000Z" } } });
  seedIdea("bo/fresh", "bo", "hh:the-harbor");
  await pen.query("INSERT INTO acts (at, actor, action, object, class, payload) VALUES ($1, $2, $3, $4, $5, $6)", [isoAt(NOW), "bo", "post", "bo/fresh", "idea", "{}"]);
  assert.deepEqual(await ideaPostDatesBy(["ana", "bo"], { env: ON }), [{ by: "ana", date: "2026-09-05T00:00:00.000Z" }, { by: "bo", date: isoAt(NOW) }]);
  assert.deepEqual(await ideaPostDatesBy(["ana"], { env: OFF }), []);
  assert.deepEqual(await standingIdeaPosts({ env: ON }), [{ by: "ana", id: "ana/old" }, { by: "bo", id: "bo/fresh" }]);
});

test("the first-idea sweep's candidates are the idea posts beside any mark still standing, and nothing after the window closes", async () => {
  const posts = async () => [{ by: "ana", id: "ana/p" }];
  const marks = () => [{ by: "bo", id: "bo/m" }];
  assert.deepEqual(await firstIdeaCandidates("2026-09-01", { posts, marks }), [{ by: "bo", id: "bo/m" }, { by: "ana", id: "ana/p" }]);
  assert.deepEqual(await firstIdeaCandidates("2026-10-01", { posts: async () => { throw new Error("must not read"); }, marks }), [], `after ${FIRST_IDEA_WINDOW_END} nothing is read`);
  await assert.rejects(firstIdeaCandidates("2026-09-01", { posts: async () => { throw new Error("store down"); }, marks }), /store down/, "an unreadable post store is the sweep's own refusal, never 'no ideas'");
});

// ── the conversion's one step ───────────────────────────────────────────────

const MARK = { mark: "ana/lantern", by: "ana", title: "A lantern on the quay", body: "The quay is dark after the late ferry.",
  origin: { mark: "ana/lantern", kind: "sited", date: "2026-09-05T00:00:00.000Z", author: "ana", body_sha256: "ab".repeat(32) } };
const conv = (m = MARK, o = {}) => convertMarkToIdeaPost(m, { now: Date.now(), env: ON, roll: ROLL, ...o });   // the pen takes only the town's true crossing, so the real clock

test("converting a mark files ONE post act, put up by the town's hand with the author as the actor, and the mark's provenance on the row", async () => {
  setup();
  const r = await conv({ ...MARK }, { planned: "ana/a-lantern-on-the-quay" });
  assert.deepEqual([r.existed, r.post, r.hand, r.author], [false, "ana/a-lantern-on-the-quay", "wright", "ana"]);
  const row = t.posts.get("ana/a-lantern-on-the-quay");
  assert.deepEqual([row.class, row.author, row.household, row.state, row.title, row.body],
    ["idea", "ana", "hh:the-harbor", "posted", MARK.title, MARK.body], "the author's own post, the author's own words");
  assert.deepEqual(row.fields.origin, MARK.origin, "its provenance: the mark's id, kind, date, author and the body's digest");
  const acts = pen.rows();
  assert.equal(acts.length, 1);
  assert.deepEqual([acts[0].class, acts[0].action, acts[0].actor, acts[0].object], ["idea", "post", "ana", "ana/a-lantern-on-the-quay"]);
  assert.equal(JSON.parse(acts[0].payload).hand, "wright", "an act a hand makes carries the hand");
  assert.equal(pen.claims?.length ?? 0, 0, "an idea post never crosses the settlement");
});

test("a rerun finds the post by the mark it came from and writes nothing; a different id than the plan named is refused", async () => {
  setup();
  await conv({ ...MARK }, { planned: "ana/a-lantern-on-the-quay" });
  const n = pen.rows().length;
  const again = await conv({ ...MARK }, { planned: "ana/a-lantern-on-the-quay" });
  assert.deepEqual([again.existed, again.post], [true, "ana/a-lantern-on-the-quay"]);
  assert.equal(pen.rows().length, n, "a rerun wrote nothing, and minted no new suffix");
  assert.equal(t.posts.size, 1);
  const other = { ...MARK, mark: "ana/other", origin: { ...MARK.origin, mark: "ana/other" } };
  await assert.rejects(conv(other, { planned: "ana/something-else" }), (e) => e.code === 409 && /the pen mints "ana\/a-lantern-on-the-quay-2".*"ana\/something-else"/.test(e.defect));
  assert.equal(t.posts.size, 1, "a refused conversion wrote nothing");
});

test("a conversion is refused by name for an author the roll does not hold, a body past the limit, a non-hand and a mark with no provenance", async () => {
  setup();
  await assert.rejects(conv({ ...MARK, by: "ghost" }), (e) => e.code === 422 && /not a resident here/.test(e.defect));
  await assert.rejects(conv({ ...MARK, body: "x".repeat(601) }), (e) => e.code === 422 && /body is at most 600/.test(e.defect), "a body is never cut to fit");
  await assert.rejects(conv(MARK, { hand: "ana" }), (e) => e.code === 403 && /not one of the town's hands/.test(e.defect));
  await assert.rejects(conv({ ...MARK, origin: null }), (e) => e.code === 422 && /names the mark it was/.test(e.defect));
  await assert.rejects(conv(MARK, { env: OFF }), (e) => e.code === 409 && /not posts on this office yet/.test(e.defect));
  assert.equal(t.posts.size, 0); assert.equal(pen.rows().length, 0);
});

// ── the Think Tank's read stands on the post law (Rivet, POS-854: WLD-188 withdraws the `mark/idea` declaration) ──

test("read_ideas quotes the idea POST law, teaches posts with stakes, and no longer depends on the retiring declaration", async () => {
  const { IDEA_POST_LAW, IDEA_STAGES, IDEA_FINISHED, IDEA_HANDS } = await import("../src/ideas.mjs");
  const law = IDEA_POST_LAW();
  for (const w of [...IDEA_STAGES, ...IDEA_FINISHED, ...IDEA_HANDS]) assert.ok(law.includes(w), `the law names ${w}, from the constants that are the law`);
  assert.match(law, /put stamps behind it/);
  const { TOOLS } = await import("../src/mcp.mjs");
  const d = TOOLS.find((t) => t.name === "read_ideas").description;
  assert.doesNotMatch(d, /WHEREVER IT STANDS|placement computed|raising its ✦weight|escrow/, "the old mark teaching is gone");
  assert.match(d, /POST/); assert.match(d, /sort: \?"staked\?"|sort: "staked"/); assert.match(d, /fields\.origin/);
  const { ideasTank } = await import("../src/world-classes.mjs");
  const done = await publishTank([]);   // a declaration and no idea mark
  try { assert.deepEqual(ideasTank().ideas, []); } finally { done(); }
});

// THE SEAM, through the door (Truey on 25cd34b0: two flips stayed green): read_ideas is CALLED over a world with no idea declaration, and over one with a converted mark.
const readIdeas = async (env = {}) => {
  const { callTool } = await import("../src/mcp.mjs");
  const saved = process.env.IDEA_POSTS; process.env.IDEA_POSTS = "1";
  try { return await callTool("read_ideas", {}, {}); } finally { if (saved === undefined) delete process.env.IDEA_POSTS; else process.env.IDEA_POSTS = saved; void env; }
};

test("read_ideas over a world with NO idea declaration answers the post law, no mark law, no throw", async () => {
  setup();
  seedIdea("ana/lantern-2", "ana", "hh:the-harbor");
  const done = await publishTank([], { declare: false });
  try {
    const r = await readIdeas();
    const { IDEA_POST_LAW } = await import("../src/ideas.mjs");
    assert.equal(r.law, IDEA_POST_LAW(), "LAW (Rivet, POS-854): the reader stands on the post law, not on the declaration being retired");
    assert.equal("mark_law" in r, false, "no declaration, no mark law");
    assert.deepEqual(r.ideas, []); assert.equal(r.source, "store");
    assert.deepEqual(r.posts.map((p) => p.id), ["ana/lantern-2"], "the post read still answers");
  } finally { done(); }
  const done2 = await publishTank([]);   // the declaration standing: it is quoted beside, never in place of, the post law
  try {
    const r = await readIdeas();
    const { IDEA_POST_LAW } = await import("../src/ideas.mjs");
    assert.equal(r.law, IDEA_POST_LAW()); assert.equal(r.mark_law, "THE DECLARATION'S LAW SENTENCE");
  } finally { done2(); }
});

test("read_ideas lists a mark once: a mark that has become its author's post is the post, and a mark not yet carried across stays a mark", async () => {
  setup();
  seedIdea("ana/lantern-2", "ana", "hh:the-harbor", { fields: { origin: { mark: "ana/lantern", date: "2026-09-05T00:00:00.000Z" } } });
  const done = await publishTank([["ana/lantern", "ana", "2026-09-05"], ["ana/kept-mark", "ana", "2026-09-06"]]);
  try {
    const r = await readIdeas();
    assert.deepEqual(r.ideas.map((i) => i.id), ["ana/kept-mark"], "the carried mark is not read beside its post; the other mark stands");
    assert.deepEqual(r.posts.map((p) => p.id), ["ana/lantern-2"]);
  } finally { done(); }
});

test("a converted post carries its place (`at` or `on`) and takes an id from the mark's own slug when its title mints none", async () => {
  setup();
  const cjk = { mark: "ana/a-mark-of-ana", by: "ana", title: "镇上该有一份路程册", body: "镇上该有一份路程册：每一户门朝哪边。", id_base: "a-mark-of-ana", place: { x: 293, y: -183 },
    origin: { mark: "ana/a-mark-of-ana", kind: "sited", date: "2026-10-05T00:00:00.000Z", author: "ana", at: { x: 293, y: -183 }, body_sha256: "cd".repeat(32) } };
  const r = await conv(cjk, { planned: "ana/a-mark-of-ana-2" });
  assert.equal(r.post, "ana/a-mark-of-ana-2", "the stub's mark table holds the bare id, so the base takes -2");
  const row = t.posts.get("ana/a-mark-of-ana-2");
  assert.deepEqual([row.place_x, row.place_y, row.title, row.body], [293, -183, cjk.title, cjk.body], "the place and the author's own words ride the post");
  const on = { ...cjk, mark: "ana/pred", id_base: undefined, title: "A predicated idea", body: "A predicated idea. About a mark.", place: { mark: "the-town/the-parent" }, origin: { ...cjk.origin, mark: "ana/pred" } };
  await conv(on, { planned: "ana/a-predicated-idea" });
  assert.equal(t.posts.get("ana/a-predicated-idea").place_mark, "the-town/the-parent");
});
