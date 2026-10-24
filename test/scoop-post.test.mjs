// scoop-post.test.mjs — the scoop class on the post machine (POS-780).
//
//   node --test test/scoop-post.test.mjs
//
// The gate (Darko 2026-10-22 19:48, POS-638/a, and 2026-10-24 12:28):
//
//   1. a resident marks a moment in public: class `scoop`, a window (starts,
//      ends) that has happened and points back at most 3 days, a title, a note
//      and a place; the act is class scoop (anchored when it has a place), the
//      row is scooped, and the fields of another lane are refused by name;
//   2. the window's refusals: not an instant, ends not after starts, in the
//      future, older than 3 days, longer than the cap;
//   3. a scooper has at most SCOOP_OPEN_MAX scoops standing;
//   4. the read answers the moment (body, window, place), the history and the
//      class's finished states, and `published` carries fields.video_url;
//   5. the hands move it to any named stage, in any order; a non-hand cannot;
//      `published` needs the video's YouTube link and no other stage takes one;
//      a finished scoop moves no further;
//   6. its scooper amends the title and the note, never the window or the
//      place; a stranger and a hand cannot;
//   7. its scooper withdraws it (`close`); nobody else can; it stays on the record;
//   8. the rebuild folds the scoop acts into exactly the rows the pen wrote;
//   9. the explain text teaches the whole law, and the town door's class enums
//      carry the class.
//
// ⚑ THE STORE IS A JS STUB (`acts-pen-stub.mjs`), as in idea-post.test.mjs: this
// proves which acts and rows the pen writes and what the reads make of them,
// nothing about Postgres.

import test from "node:test";
import assert from "node:assert/strict";
import { installActsPen, uninstallActsPen, RECORD_ON } from "./acts-pen-stub.mjs";

Object.assign(process.env, RECORD_ON);
const { postAtTown, amendAtTown, advanceAtTown, closeAtTown } = await import("../src/events-store.mjs");
const { postsAtOffice, POST_CLASSES, CLASS_STATES } = await import("../src/town-posts.mjs");
const { townPostEvent, TOWN_POST_TOOLS } = await import("../src/town-post.mjs");
const { dryRun } = await import("../world2/tools/events-rebuild.mjs");
const { resetChainMemo } = await import("../src/post-history.mjs");
const S = await import("../src/scoops.mjs");

const NOW = Date.now();   // townPostEvent reads the real clock, so the suite lives on it
const MIN = 60_000;
const DAY = 86_400_000;
const at = (ms) => new Date(ms).toISOString();

const WRIGHT = { household: "starforge", handles: new Set(["wright"]) };
const KEEMIN = { household: "darko", handles: new Set(["keemin"]) };
const ERRANT = { household: "errant", handles: new Set(["errant"]) };
const FINN = { household: "finn", handles: new Set(["finn"]) };
const HOUSES = [{ slug: "the-harbor", ord: 1, residents: ["errant", "ada"] }];
const VIDEO = "https://www.youtube.com/watch?v=abcDEF12345";

// ── the posts table, in memory ──────────────────────────────────────────────
function tables() {
  const posts = new Map();
  const PC = ["id", "class", "title", "body", "author", "household", "place_mark", "place_x", "place_y",
    "starts", "ends", "state", "fields", "revised", "posted_act", "last_act"];
  const asJson = (v) => (typeof v === "string" ? JSON.parse(v) : v);
  const copy = (r) => ({ ...r, fields: { ...r.fields } });
  const byClass = (cls) => [...posts.values()].filter((r) => r.class === cls).sort((a, b) => a.id.localeCompare(b.id)).map(copy);
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
    [/^SELECT id FROM posts WHERE id LIKE \$1$/i, (q, p) => {
      const pre = p[0].replace(/%$/, "");
      const rows = [...posts.keys()].filter((id) => id.startsWith(pre)).map((id) => ({ id }));
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT count\(\*\)::int AS n FROM posts WHERE class = \$1 AND author = \$2 AND NOT \(state = ANY\(\$3\)\)$/i, (q, p) => {
      const n = [...posts.values()].filter((r) => r.class === p[0] && r.author === p[1] && !p[2].includes(r.state)).length;
      return { rows: [{ n }], rowCount: 1 };
    }],
    [/^SELECT id, class, title, author, household, starts, ends, fields, state, last_act FROM posts WHERE class = \$1 ORDER BY id$/i, (q, p) => {
      const rows = byClass(p[0]);
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT id, body, starts, ends, place_mark, place_x, place_y FROM posts WHERE id = ANY\(\$1\) AND class = \$2$/i, (q, p) => {
      const rows = [...posts.values()].filter((r) => p[0].includes(r.id) && r.class === p[1]);
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT \* FROM posts WHERE class = \$1 ORDER BY id$/i, (q, p) => { const rows = byClass(p[0]); return { rows, rowCount: rows.length }; }],
    [/^SELECT post, handle, state FROM responses WHERE post = ANY\(\$1\) ORDER BY post, handle$/i, () => ({ rows: [], rowCount: 0 })],
    [/^SELECT \* FROM responses WHERE kind = \$1 ORDER BY post, handle$/i, () => ({ rows: [], rowCount: 0 })],
  ];
  return { posts, also };
}

function setup() {
  resetChainMemo();
  const t = tables();
  const pen = installActsPen({ households: HOUSES, marks: [{ id: 1, slug: "errant/the-quay", kind: "sited", geometry: { at: { x: 120, y: -40 }, extent: { w: 30, h: 20 } } }], also: t.also });
  return { ...t, pen };
}
test.afterEach(() => uninstallActsPen());

async function refusedWith(p, code, re) {
  await assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code} ${e.defect}`); if (re) assert.match(`${e.defect} ${e.hint}`, re); return true; });
}

const MOMENT = { class: "scoop", title: "The lantern lighting on the quay", body: "Ada lit the lantern and the whole quay cheered.",
  starts: at(NOW - 3 * 60 * MIN), ends: at(NOW - 3 * 60 * MIN + 4 * MIN), place: { at: { x: 100, y: -50 } } };
const ID = "errant/the-lantern-lighting-on-the-quay";
const post = (fields = MOMENT, key = ERRANT, now = NOW) => postAtTown(fields, key, { now, env: process.env });
const advance = (fields, key = WRIGHT) => advanceAtTown(fields, key, { now: NOW, env: process.env });
const read = async (id = ID) => (await postsAtOffice({ class: "scoop", post: id }, { now: NOW, env: process.env })).post;

// ── 1 · posting ─────────────────────────────────────────────────────────────

test("1 · a resident scoops a moment in public: a scooped row, an anchored act, a receipt; another lane's fields are refused by name", async () => {
  const { pen, posts } = setup();
  const r = await townPostEvent(MOMENT, ERRANT, { env: process.env });
  assert.equal(r.error, undefined, JSON.stringify(r));
  assert.equal(r.post.id, ID);
  assert.deepEqual([r.post.class, r.post.author, r.post.household, r.post.state], ["scoop", "errant", "hh:the-harbor", "scooped"]);
  assert.deepEqual(r.post.place, { mark: null, x: 100, y: -50 });
  assert.equal(r.post.starts, MOMENT.starts);
  assert.match(r.receipt, /scooped: errant\/the-lantern-lighting-on-the-quay, .* by errant\. .*A scoop pays nothing/);
  const [act] = pen.rows();
  assert.deepEqual([act.class, act.action, act.actor, act.object], ["scoop", "post", "errant", ID]);
  assert.equal(act.at_dx, 100, "a scoop with a place is anchored, as an event is");
  assert.equal(posts.get(ID).state, "scooped");

  // no place: anchorless, and still a scoop
  const bare = await townPostEvent({ ...MOMENT, title: "A quiet moment", place: undefined }, FINN, { env: process.env });
  assert.equal(bare.post.place, null);
  assert.equal(pen.rows()[1].at_anchor, null);

  // a standing mark is a place
  const marked = await townPostEvent({ ...MOMENT, title: "At the quay", place: { mark: "errant/the-quay" } }, FINN, { env: process.env });
  assert.deepEqual(marked.post.place, { mark: "errant/the-quay", x: 120, y: -40 });

  // another lane's fields: refused by name; a stake first
  for (const [f, v] of [["slug", "x"], ["issue", "x"], ["invitation", "x"], ["doors_open", "x"], ["quest", "x"], ["for", "x"]]) {
    const b = await townPostEvent({ ...MOMENT, [f]: v }, FINN, { env: process.env });
    assert.equal(b.code, 422); assert.match(b.defect, new RegExp(`a scoop does not take: ${f}`));
  }
  const staked = await townPostEvent({ ...MOMENT, stamps: 1 }, FINN, { env: process.env });
  assert.deepEqual([staked.code, staked.field, staked.defect], [422, "stamps", "a scoop takes no stake"]);
  await refusedWith(post({ ...MOMENT, title: "   " }), 422, /needs a title/);
  assert.equal(pen.rows().length, 3, "a refused post wrote nothing");
  // the same title again is a new id, never a reuse
  assert.equal((await post()).post.id, `${ID}-2`);
});

// ── 2 · the window ──────────────────────────────────────────────────────────

test("2 · the window: an instant with its zone, a moment that has happened, at most 3 days back, and no cap on its length", async () => {
  const { pen } = setup();
  const w = (starts, ends) => post({ ...MOMENT, starts, ends });
  await refusedWith(w("yesterday", at(NOW)), 422, /starts is not an instant/);
  await refusedWith(w(undefined, at(NOW)), 422, /needs starts/);
  await refusedWith(w(at(NOW - 5 * MIN), at(NOW - 5 * MIN)), 422, /ends after it starts/);
  await refusedWith(w(at(NOW - 5 * MIN), at(NOW + 10 * MIN)), 422, /marks a moment that has happened/);
  await refusedWith(w(at(NOW - 3 * DAY - MIN), at(NOW - 3 * DAY + 5 * MIN)), 422, /points back at most 3 days/);
  assert.equal(pen.rows().length, 0, "every refusal wrote nothing");
  // the edges stand: exactly 3 days back, exactly the cap, a minute of clock skew ahead
  await w(at(NOW - 3 * DAY), at(NOW - 3 * DAY + 30 * MIN));
  // no cap on the length: one arc we can tell, a full settlement (12 h) and more
  await post({ ...MOMENT, title: "The whole afternoon", starts: at(NOW - 2 * DAY), ends: at(NOW - 2 * DAY + 12 * 60 * MIN) });
  await post({ ...MOMENT, title: "Two settlements and a bit", starts: at(NOW - 2.5 * DAY), ends: at(NOW - 2 * DAY + 60 * MIN) });
  await post({ ...MOMENT, title: "Just now", starts: at(NOW - 2 * MIN), ends: at(NOW + 30_000) });
  assert.equal(pen.rows().length, 4);
});

// ── 3 · the cap ─────────────────────────────────────────────────────────────

test("3 · a scooper has at most SCOOP_OPEN_MAX scoops standing; a finished or withdrawn one does not count", async () => {
  setup();
  const ids = [];
  for (let i = 0; i < S.SCOOP_OPEN_MAX; i++) ids.push((await post({ ...MOMENT, title: `Moment number ${i}` })).post.id);
  await refusedWith(post({ ...MOMENT, title: "One too many" }), 409, new RegExp(`at most ${S.SCOOP_OPEN_MAX} at once`));
  await closeAtTown({ post: ids[0] }, ERRANT, { now: NOW, env: process.env });
  await advance({ post: ids[1], to: "passed" });
  await post({ ...MOMENT, title: "Room again" });
  await post({ ...MOMENT, title: "And again" });
  await refusedWith(post({ ...MOMENT, title: "Now full" }), 409, /standing/);
});

// ── 4 · the read ────────────────────────────────────────────────────────────

test("4 · the read answers the moment (note, window, place), the history and the finished states, and published carries fields.video_url", async () => {
  setup();
  await post();
  await advance({ post: ID, to: "picked-up", note: "The journalist has it." });
  await advance({ post: ID, to: "published", link: VIDEO }, KEEMIN);
  const list = await postsAtOffice({ class: "scoop" }, { now: NOW, env: process.env });
  assert.deepEqual(list.finished, ["published", "passed", "withdrawn"]);
  assert.equal(list.total, 1);
  assert.deepEqual(Object.keys(list.counts_by_state), [...S.SCOOP_STATES]);
  assert.equal(list.counts_by_state.published, 1);
  const one = await read();
  assert.equal(one.body, MOMENT.body);
  assert.deepEqual(one.window, { starts: MOMENT.starts, ends: MOMENT.ends });
  assert.deepEqual(one.place, { mark: null, x: 100, y: -50 });
  assert.equal(one.fields.video_url, VIDEO);
  assert.deepEqual(one.history.map(({ at: _at, ...h }) => h), [
    { stage: "scooped", state: "scooped", hand: "errant", link: null, note: null },
    { stage: "picked-up", state: "picked-up", hand: "wright", link: null, note: "The journalist has it." },
    { stage: "published", state: "published", hand: "keemin", link: VIDEO, note: null },
  ]);
  const filtered = await postsAtOffice({ class: "scoop", state: "scooped,picked-up" }, { now: NOW, env: process.env });
  assert.equal(filtered.total, 0);
  assert.deepEqual(POST_CLASSES.scoop.finished, S.SCOOP_FINISHED);
  assert.deepEqual(CLASS_STATES.scoop, [...S.SCOOP_STATES]);
});

// ── 5 · the hands ───────────────────────────────────────────────────────────

test("5 · the hands move a scoop to any stage in any order; published needs the video's link and no other stage takes one; a finished scoop moves no further", async () => {
  const { pen } = setup();
  await post();
  await advance({ post: ID, to: "filmed" });
  await advance({ post: ID, to: "scripted" }, KEEMIN);
  await refusedWith(advance({ post: ID, to: "keyframed", link: VIDEO }), 422, /link is published's/);
  await refusedWith(advance({ post: ID, to: "published" }), 422, /needs the video's link/);
  for (const bad of ["https://example.com/v", "http://youtu.be/abcDEF12345", "https://youtube.com.evil.test/watch?v=abcDEF12345", "not a link"])
    await refusedWith(advance({ post: ID, to: "published", link: bad }), 422, /YouTube address/);
  await refusedWith(advance({ post: ID, to: "withdrawn" }), 422, /scooper's own/);
  await refusedWith(advance({ post: ID, to: "nonsense" }), 422, /not a stage a scoop stands in/);
  await refusedWith(advance({ post: ID, to: "scripted" }), 409, /already stands scripted/);
  await refusedWith(advance({ post: ID, to: "filmed", credit: "finn" }), 422, /credit is not a scoop's/);
  await refusedWith(advance({ post: ID, to: "filmed" }, FINN), 403, /only the town's hands move a scoop/);
  await refusedWith(advance({ post: ID, to: "filmed" }, ERRANT), 403, /only the town's hands/);
  const n = pen.rows().length;
  const done = await advance({ post: ID, to: "published", link: "https://youtu.be/abcDEF12345?t=3" });
  assert.deepEqual([done.state, done.stage, done.hand], ["published", "published", "wright"]);
  assert.match(done.receipt, /finished, and moves no further/);
  assert.equal(pen.rows().length, n + 1);
  await refusedWith(advance({ post: ID, to: "passed" }), 409, /finished \(published\)/);
});

// ── 6 · amend ───────────────────────────────────────────────────────────────

test("6 · the scooper alone amends the title and the note, never the window or the place; a stranger and a hand cannot; a finished scoop is not amended", async () => {
  const { posts } = setup();
  await post();
  const a = await amendAtTown({ post: ID, body: "Ada lit it; the quay cheered." }, ERRANT, { now: NOW, env: process.env });
  assert.deepEqual(a.amended, ["body"]);
  assert.equal(posts.get(ID).body, "Ada lit it; the quay cheered.");
  assert.equal(posts.get(ID).revised, 1);
  for (const f of ["starts", "ends", "place"])
    await refusedWith(amendAtTown({ post: ID, [f]: f === "place" ? { at: { x: 1, y: 1 } } : at(NOW) }, ERRANT, { now: NOW, env: process.env }), 422, /is not amended/);
  await refusedWith(amendAtTown({ post: ID, title: "Mine now" }, FINN, { now: NOW, env: process.env }), 403, /not yours to amend/);
  await refusedWith(amendAtTown({ post: ID, body: "Ada lit it; the quay cheered." }, ERRANT, { now: NOW, env: process.env }), 422, /nothing to amend/);
  await refusedWith(amendAtTown({ post: ID, title: "The quay lantern" }, WRIGHT, { now: NOW, env: process.env }), 403, /only they change its title or note.*passed/s);
  assert.equal(posts.get(ID).title, MOMENT.title, "a hand does not amend another resident's scoop");
  assert.equal(posts.get(ID).id, ID, "the id is never re-minted");
  await advance({ post: ID, to: "passed" });
  await refusedWith(amendAtTown({ post: ID, title: "Late" }, ERRANT, { now: NOW, env: process.env }), 409, /finished \(passed\)/);
});

// ── 7 · withdraw ────────────────────────────────────────────────────────────

test("7 · the scooper withdraws their own scoop (close); nobody else can; it stays on the record, withdrawn, and moves no further", async () => {
  const { posts } = setup();
  await post();
  await refusedWith(closeAtTown({ post: ID }, FINN, { now: NOW, env: process.env }), 403, /not yours to withdraw/);
  await refusedWith(closeAtTown({ post: ID }, WRIGHT, { now: NOW, env: process.env }), 403, /advance/);
  const r = await closeAtTown({ post: ID }, ERRANT, { now: NOW, env: process.env });
  assert.deepEqual([r.state, r.post.state], ["withdrawn", "withdrawn"]);
  assert.equal(posts.get(ID).state, "withdrawn");
  await refusedWith(closeAtTown({ post: ID }, ERRANT, { now: NOW, env: process.env }), 409, /finished/);
  await refusedWith(advance({ post: ID, to: "passed" }), 409, /finished \(withdrawn\)/);
  const one = await read();
  assert.deepEqual(one.history.map((h) => h.stage), ["scooped", "withdrawn"]);
});

// ── 8 · the rebuild ─────────────────────────────────────────────────────────

test("8 · the rebuild folds the scoop acts (post, amend, advance, close) into exactly the rows the pen wrote", async () => {
  const { pen } = setup();
  await post();
  await amendAtTown({ post: ID, body: "Changed." }, ERRANT, { now: NOW, env: process.env });
  await advance({ post: ID, to: "filmed", note: "Three shots." });
  await advance({ post: ID, to: "published", link: VIDEO });
  const other = (await post({ ...MOMENT, title: "Another moment", place: { mark: "errant/the-quay" } }, FINN)).post.id;
  await closeAtTown({ post: other }, FINN, { now: NOW, env: process.env });
  const out = await dryRun({ query: (sql, params) => pen.query(sql, params) });
  assert.equal(out.equal, true, out.drift.join("\n"));
  assert.deepEqual([out.counts.scoop_acts, out.counts.scoops], [6, 2]);
});

// ── 9 · the door says what it does ──────────────────────────────────────────

test("9 · explain teaches the whole law, and the town door's class enums carry the class", async () => {
  const E = S.SCOOP_EXPLAIN;
  assert.equal(E.explains, "scoop");
  assert.match(E.post, /class: "scoop", title, starts, ends/);
  assert.match(E.window, /3 days/);
  assert.match(E.life, /published/);
  assert.match(E.public, /public post/);
  assert.match(E.no_stake, /no stake/);
  assert.deepEqual(Object.keys(E.fields), ["title", "starts", "ends", "body", "place", "handle"]);
  // no word "clip" in the class's own text (Darko 10-22: a scoop, never a clip)
  assert.equal(/\bclip/i.test(JSON.stringify(E)), false);
  for (const t of TOWN_POST_TOOLS.filter((x) => ["town_amend", "town_close", "town_advance"].includes(x.name)))
    assert.ok(t.inputSchema.properties.class.enum.includes("scoop"), `${t.name} names the class`);
  assert.match(TOWN_POST_TOOLS.find((t) => t.name === "town_advance").description, /A SCOOP moves by the town's hands/);
});
