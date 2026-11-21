// flare-post.test.mjs — THE FLARE, ITS RECORD (POS-1163; the law is World #397, LOGOS/classes.md:369–404).
//
//   node --test test/flare-post.test.mjs
//
// A flare is reported at the town door, folded into its row by the one act
// fold, read back by the public posts read, and listed on its spark by every
// public spark producer (event-sparks.mjs: a circle's sparks, an event's own,
// its gallery), and nothing is lost on the way: not the spark it names, not
// one place it was posted, not a platform, a form or a screenshot. A private
// or pending spark can be no flare's, and gains no flare on any read. No pay,
// no stake, no amend, no close.
//
// ⚑ THE STORE IS A JS STUB (`acts-pen-stub.mjs`), as in bug-post.test.mjs. Its
// marks answer "is this slug standing" and ignore `kind`, so the door's
// `kind = 'spark'` is SQL this suite does not prove.
//
// THE FALSIFIERS (run, then restored; the hand-in names them): drop the public
// spark check at the door and the pending spark's flare is recorded; drop a
// destination's fields in flareOnSpark and the spark's views lose them; list
// flares on pending placeholders and the private placeholder gains one.

import test from "node:test";
import assert from "node:assert/strict";
import { installActsPen, uninstallActsPen, RECORD_ON } from "./acts-pen-stub.mjs";

Object.assign(process.env, RECORD_ON);
const { postAtTown, amendAtTown, closeAtTown } = await import("../src/events-store.mjs");
const { postsAtOffice } = await import("../src/town-posts.mjs");
const { townPostEvent } = await import("../src/town-post.mjs");
const { acceptedSparksOfCircle, eventSparksOf, eventGalleryOf, SPARK_FLARES_SQL } = await import("../src/event-sparks.mjs");
const { compareRebuild } = await import("../world2/tools/events-rebuild.mjs");
const { FLARE_CLASS, judgeFlarePost } = await import("../src/flares.mjs");

const NOW = Date.now();
const WRIGHT = { household: "starforge", handles: new Set(["wright"]) };
const FINN = { household: "finn", handles: new Set(["finn"]) };
const ERRANT = { household: "the-harbor", handles: new Set(["errant"]) };
const HOUSES = [
  { slug: "the-harbor", ord: 1, residents: ["errant", "ada"], accounts: [] },
  { slug: "house-of-many-doors", ord: 2, residents: ["kinofire"], accounts: [] },
  { slug: "starforge", ord: 3, residents: ["wright", "mari"], accounts: [] },
];
const opts = { now: NOW };

// The spark the flares are about: accepted (standing), under circle 7, in room r1. And one still waiting on acceptance.
const SPARK = "kinofire/a-lantern-walk";
const PENDING = "kinofire/a-draft-walk";
const SPARK_MARKS = [
  { slug: SPARK, owner: "kinofire", household: "hh:house-of-many-doors", body: "A lantern walk", locked_window: 412,
    data: { circle_path: [7], rooms: ["r1"] } },
];

/** The posts table, in memory, answering exactly the queries the door and the posts read ask. */
function tables() {
  const posts = new Map();
  const PC = ["id", "class", "title", "body", "author", "household", "place_mark", "place_x", "place_y",
    "starts", "ends", "state", "fields", "revised", "posted_act", "last_act"];
  const asJson = (v) => (typeof v === "string" ? JSON.parse(v) : v);
  const copy = (r) => ({ ...r, fields: { ...r.fields } });
  const also = [
    [/^INSERT INTO posts/i, (q, p) => { const r = Object.fromEntries(PC.map((k, i) => [k, p[i]])); r.fields = asJson(r.fields); posts.set(p[0], r); return { rows: [], rowCount: 1 }; }],
    [/^UPDATE posts SET/i, (q, p) => {
      Object.assign(posts.get(p[0]), { title: p[1], body: p[2], place_mark: p[3], place_x: p[4], place_y: p[5],
        starts: p[6], ends: p[7], state: p[8], fields: asJson(p[9]), revised: p[10], last_act: p[11] });
      return { rows: [], rowCount: 1 };
    }],
    [/FROM posts WHERE id = \$1 AND class = \$2$/i, (q, p) => { const r = posts.get(p[0]); return r && r.class === p[1] ? { rows: [copy(r)], rowCount: 1 } : { rows: [], rowCount: 0 }; }],
    [/^SELECT id, state, ends FROM posts WHERE id LIKE \$1$/i, (q, p) => {
      const rows = [...posts.values()].filter((r) => r.id.startsWith(p[0].replace(/%$/, ""))).map((r) => ({ id: r.id, state: r.state, ends: r.ends }));
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT id, class, title, author, household, starts, ends, fields, state, last_act(?:, body)? FROM posts WHERE class = \$1 ORDER BY id$/i, (q, p) => {
      const rows = [...posts.values()].filter((r) => r.class === p[0]).sort((a, b) => a.id.localeCompare(b.id)).map(copy);
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT post, handle, state FROM responses WHERE post = ANY\(\$1\) ORDER BY post, handle$/i, () => ({ rows: [], rowCount: 0 })],
  ];
  return { posts, also };
}

function setup({ marks = [{ slug: SPARK }, { slug: PENDING, status: "pending" }] } = {}) {
  const t = tables();
  const pen = installActsPen({ households: HOUSES, also: t.also, marks });
  return { ...t, pen };
}
test.afterEach(() => uninstallActsPen());

async function refusedNothing(pen, p, code, re) {
  const before = pen.rows().length;
  await assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code} ${e.defect}`); assert.match(`${e.defect} ${e.hint}`, re); return true; });
  assert.equal(pen.rows().length, before, "a refused act wrote nothing");
}

const YT = { url: "https://www.youtube.com/watch?v=lanternwalk", platform: "YouTube", form: "video", screenshot: "https://postmark.town/media/shot-lantern.png" };
const BSKY = { url: "https://bsky.app/profile/finn.example/post/3lantern", platform: "Bluesky", form: "text" };
const TT = { url: "https://www.tiktok.com/@finn/video/777", platform: "TikTok", form: "video" };
const FLARE = { class: "flare", title: "The lantern walk, filmed", about: SPARK, destinations: [YT, BSKY] };

/**
 * A spark reader over the same posts table the door wrote: the standing spark marks the producers ask for, and the
 * flares query (SPARK_FLARES_SQL) answered from the posts rows, so a flare's view is what the door actually recorded.
 */
function sparkReader(posts) {
  const asked = [];
  const q = { query: async (sql, params) => {
    asked.push(sql);
    if (sql === SPARK_FLARES_SQL) {
      const want = new Set(params[0]);
      const rows = [...posts.values()].filter((r) => r.class === FLARE_CLASS && want.has(String(r.fields?.about)))
        .sort((a, b) => a.id.localeCompare(b.id)).map((r) => ({ id: r.id, title: r.title, author: r.author, household: r.household, state: r.state, fields: r.fields }));
      return { rows };
    }
    if (/circle_path' @> \$1::jsonb/.test(sql)) return { rows: SPARK_MARKS.filter((m) => m.data.circle_path.includes(JSON.parse(params[0])[0])) };
    if (/AND slug = ANY\(\$1::text\[\]\)$/.test(sql)) return { rows: SPARK_MARKS.filter((m) => params[0].includes(m.slug)) };
    if (/FROM claims WHERE slug = ANY/.test(sql)) return { rows: params[0].includes(PENDING) ? [{ slug: PENDING, status: "pending" }] : [] };
    if (/data->'rooms' \?\| \$1::text\[\]/.test(sql)) return { rows: SPARK_MARKS.filter((m) => m.data.rooms.some((r) => params[0].includes(r)) && !params[1].includes(m.slug)) };
    throw new Error(`the spark reader does not answer: ${sql.slice(0, 120)}`);
  } };
  return { q, asked };
}

test("RECORD → FOLD → PUBLIC READ: a reported flare keeps its spark and every place it was posted, its platform, form and screenshot; its maker is the reporter's household", async () => {
  const { pen, posts } = setup();
  const r = await postAtTown(FLARE, FINN, opts);
  const id = r.post.id;
  assert.equal(id, "finn/the-lantern-walk-filmed");
  assert.deepEqual([r.post.class, r.post.author, r.post.state], ["flare", "finn", "reported"]);
  assert.deepEqual(r.post.fields, { about: SPARK, destinations: [YT, BSKY], maker: "solo:finn" });
  assert.match(r.receipt, /reported: finn\/the-lantern-walk-filmed \(a flare\) about the spark kinofire\/a-lantern-walk, posted at 2 places \(YouTube, Bluesky\)/);
  const act = pen.rows().at(-1);
  assert.deepEqual([act.class, act.action, act.actor, act.object], ["flare", "post", "finn", id]);
  assert.deepEqual(JSON.parse(act.payload).fields, { about: SPARK, destinations: [YT, BSKY], maker: "solo:finn" }, "the act carries every destination whole");

  const list = await postsAtOffice({ class: "flare" }, { now: NOW });
  assert.deepEqual(list.finished, ["accepted-text", "accepted-video", "declined"]);
  assert.deepEqual(list.counts_by_state, { reported: 1, "accepted-text": 0, "accepted-video": 0, declined: 0 });
  const [row] = list.posts;
  assert.deepEqual([row.id, row.state, row.author], [id, "reported", "finn"]);
  assert.deepEqual(row.fields, { about: SPARK, destinations: [YT, BSKY], maker: "solo:finn" }, "the public read loses nothing");
  assert.deepEqual(row.history.map((h) => [h.stage, h.hand]), [["reported", "finn"]]);
  assert.equal((await postsAtOffice({ class: "flare", post: id }, { now: NOW })).post.fields.destinations.length, 2, "the one post, read alone");
  assert.equal((await postsAtOffice({ class: "flare", state: "reported" }, { now: NOW })).posts.length, 1);

  // the act log rebuilds exactly the row the pen wrote
  const rebuilt = compareRebuild({ posts: [...posts.values()], responses: [] }, pen.rows().filter((a) => a.class === "flare").map((a) => ({ ...a, payload: JSON.parse(a.payload) })));
  assert.equal(rebuilt.equal, true, rebuilt.drift.join("; "));

  // a resident of a household is made by that household
  const h = await postAtTown({ ...FLARE, title: "The lantern walk, written up", destinations: [BSKY] }, ERRANT, opts);
  assert.equal(h.post.fields.maker, "hh:the-harbor");
});

test("THE SPARK LISTS ITS FLARES on every public spark producer, each with every place it was posted; one query for them all, and no pending placeholder gains one", async () => {
  const { posts } = setup();
  const a = await postAtTown(FLARE, FINN, opts);
  const b = await postAtTown({ ...FLARE, title: "The lantern walk, cut short", destinations: [TT] }, ERRANT, opts);
  const { q, asked } = sparkReader(posts);
  const want = [
    { id: b.post.id, title: "The lantern walk, cut short", state: "reported", maker: "hh:the-harbor", destinations: [TT] },
    { id: a.post.id, title: "The lantern walk, filmed", state: "reported", maker: "solo:finn", destinations: [YT, BSKY] },
  ];

  const circle = await acceptedSparksOfCircle(q, 7);
  assert.deepEqual(circle.on.map((s) => [s.id, s.flares]), [[SPARK, want]], "a circle's spark lists both flares, every destination whole");
  assert.equal(asked.filter((s) => s === SPARK_FLARES_SQL).length, 1, "one flares query, not one per spark");

  const own = await eventSparksOf(q, { fields: { completed: { sparks: [SPARK, PENDING] } } });
  assert.deepEqual(own[0].flares, want);
  assert.deepEqual(own[1], { id: PENDING, accepted: false, status: "pending" }, "the pending spark is the bare placeholder: no flares key, nothing about it");

  const gallery = await eventGalleryOf(q, { room_history: "complete", rooms: [{ id: "r1" }] });
  assert.deepEqual(gallery.gallery.sparks[0].flares, want);

  // a store that cannot read the flares says so: unknown, never none
  const broken = { query: async (sql, params) => (sql === SPARK_FLARES_SQL ? Promise.reject(new Error("down")) : q.query(sql, params)) };
  const unknown = await acceptedSparksOfCircle(broken, 7);
  assert.equal(unknown.on[0].flares, null);
  assert.match(unknown.on[0].flares_note, /unknown, not none/);
});

test("A PRIVATE OR PENDING SPARK is no flare's: refused alike, nothing written, and a spark with no flare lists none", async () => {
  const { pen, posts } = setup();
  await refusedNothing(pen, postAtTown({ ...FLARE, about: PENDING }, FINN, opts), 422, /^no public spark "kinofire\/a-draft-walk".*a private spark names no flare/);
  await refusedNothing(pen, postAtTown({ ...FLARE, about: "kinofire/never-was" }, FINN, opts), 422, /^no public spark "kinofire\/never-was"/);
  const { q } = sparkReader(posts);
  assert.deepEqual((await acceptedSparksOfCircle(q, 7)).on[0].flares, [], "known none");
});

test("a flare hand reports the town's own with maker \"town\"; nobody else says it", async () => {
  const { pen } = setup();
  const t = await postAtTown({ ...FLARE, title: "The town's lantern reel", maker: "town" }, WRIGHT, opts);
  assert.deepEqual([t.post.author, t.post.fields.maker], ["wright", "hh:the-town"]);
  assert.match(t.receipt, /made by the town, reported by wright/);
  await refusedNothing(pen, postAtTown({ ...FLARE, title: "Mine, the town's", maker: "town" }, FINN, opts), 403, /^only wright, keemin or illuminator report a flare as the town's own/);
});

test("THE DOOR'S SHAPE: every place needs its url, platform and form; no place twice; a flare takes no other class's field, no stake, no amend and no close", async () => {
  const { pen } = setup();
  const bad = async (over, re) => refusedNothing(pen, postAtTown({ ...FLARE, ...over }, FINN, opts), 422, re);
  await bad({ destinations: [] }, /a flare carries every place it was posted/);
  await bad({ destinations: [{ platform: "YouTube", form: "video" }] }, /destinations\[0\]\.url is empty/);
  await bad({ destinations: [{ ...YT, url: "not a url" }] }, /destinations\[0\]\.url is not a web address/);
  await bad({ destinations: [{ ...YT, form: "audio" }] }, /destinations\[0\]\.form is text or video/);
  await bad({ destinations: [{ ...YT, platform: "" }] }, /destinations\[0\]\.platform names where it was posted/);
  await bad({ destinations: [YT, { ...YT, platform: "Again" }] }, /is named twice/);
  await bad({ destinations: [{ ...YT, likes: 9 }] }, /destinations\[0\] takes no likes/);
  await bad({ about: undefined }, /a flare names its spark/);
  await bad({ about: "no-slash" }, /is not a spark's id/);
  await bad({ title: "" }, /a flare needs a title/);
  await bad({ maker: "me" }, /maker is "town", or left off/);
  await bad({ body: "words" }, /a flare takes no body/);
  // the town door refuses by name before the pen, and an event refuses a flare's fields
  const stake = await townPostEvent({ ...FLARE, stamps: 2 }, FINN);
  assert.deepEqual([stake.code, stake.defect], [422, "a flare takes no stake"]);
  const stray = await townPostEvent({ ...FLARE, steps: "x" }, FINN);
  assert.match(stray.defect, /^a flare does not take: steps/);
  const onEvent = await townPostEvent({ class: "event", title: "x", about: SPARK }, FINN);
  assert.match(onEvent.defect, /^an event does not take: about/);
  // recorded; this door does not support amending or closing it, and the refusal writes nothing
  const r = await postAtTown(FLARE, FINN, opts);
  await refusedNothing(pen, amendAtTown({ post: r.post.id, title: "renamed" }, FINN, opts), 422, /is a flare, and this door does not support amending a flare.*moves only by advance/);
  await refusedNothing(pen, closeAtTown({ post: r.post.id }, FINN, opts), 422, /is a flare, and this door does not support closing a flare.*finishes by advance/);
  assert.equal(judgeFlarePost(FLARE).town, false);
});
