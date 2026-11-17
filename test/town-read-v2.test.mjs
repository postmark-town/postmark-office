// town-read-v2.test.mjs — the town's glance, `town { read_shape: "v2" }` (POS-733; Darko, POS-844 call 3, 2026-11-16 22:50 EST).
//
//   node --import ./test/helpers/sparse-guard.mjs --test --test-concurrency=1 test/town-read-v2.test.mjs
//
// LAW (POS-844, call 3): "the 25 most recent posts and then increasing it to like 5 per type of post max or something. As long
// as that doesn't break the limit." LAW (call 2): "yes to the 10K ceiling" — about 10,000 characters, counted the way the
// world's and the doorstep's tests count (JSON.stringify(answer, null, 1)). LAW (call 1 and the 23:00 cutover): the older read
// stays callable, read_shape: "v1", whatever the default. Every fixture here is invented: a test that reads the live town says so.

import test, { after } from "node:test";
import assert from "node:assert/strict";

const saved = { WORLD_APEX: process.env.WORLD_APEX, TOWN_READ_SHAPE: process.env.TOWN_READ_SHAPE };
const setEnv = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
setEnv("WORLD_APEX", "1"); setEnv("TOWN_READ_SHAPE", undefined);
after(() => { for (const [k, v] of Object.entries(saved)) setEnv(k, v); });

const { townApex, TOWN_TOOL, TOWN_READABLE, TOWN_DISPATCHABLE } = await import("../src/town-apex.mjs");
const { TOOLS } = await import("../src/mcp.mjs");
const shape = await import("../src/door-read-shape.mjs");
const v2 = await import("../src/town-read-v2.mjs");
const { unexplained, explainAnswer, decodeCursor, keyPaths } = await import("../src/read-grammar.mjs");
const { CLASS_STATES, READ_CLASSES } = await import("../src/town-posts.mjs");
const { currentCrossing } = await import("../src/crossings.mjs");

const schemas = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.properties ?? {}]));
const schemaRequired = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.required ?? []]));
const served = (a) => JSON.stringify(a, null, 1).length; // the way the world's and the doorstep's tests measure (mcp.mjs's text block)

// ── the invented town ───────────────────────────────────────────────────────

const NOW = Date.parse("2026-11-17T03:40:00Z");
const minAgo = (m) => new Date(NOW - m * 60_000).toISOString();
const OPEN = (cls) => CLASS_STATES[cls].filter((s) => !READ_CLASSES[cls].finished.includes(s));

/** `n` open posts of a class, the i-th last acted `base + i` minutes ago. `long` fills every field to its limit. */
function posts(cls, n, { base = 1, long = false, state = null } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const slug = long ? `${cls}-${"x".repeat(60 - cls.length - 1 - String(i).length)}${i}` : `${cls}-post-${i}`;
    return {
      class: cls, id: `${long ? "a-resident-with-a-long-handle" : "resident"}/${slug}`, state: state ?? OPEN(cls)[i % OPEN(cls).length],
      title: long ? `A very long title that goes on and on about ${cls} number ${i} well past what a line should hold` : `A ${cls} post, number ${i}`,
      responses: i, latest: { act: long ? "advance" : "rsvp", at: minAgo(base + i) },
    };
  });
}
/** A class's read answer: its open posts, the whole class's counts_by_state, and the Think Tank pointer on ideas. */
function postsAnswer(cls, open, { finished = 4, marks = null } = {}) {
  const counts = Object.fromEntries(CLASS_STATES[cls].map((s) => [s, 0]));
  for (const p of open) counts[p.state] += 1;
  counts[READ_CLASSES[cls].finished[0]] += finished;
  return { class: cls, finished: [...READ_CLASSES[cls].finished], counts_by_state: counts, total: open.length, posts: open, ...(marks != null ? { think_tank: { ideas: marks } } : {}) };
}
const event = (id, startsInMin, runsMin, { mark = null, rsvps = 3, cancelled = false } = {}) => ({
  id, title: `Event ${id}`, starts: new Date(NOW + startsInMin * 60_000).toISOString(), ends: new Date(NOW + (startsInMin + runsMin) * 60_000).toISOString(),
  place: mark ? { mark, name: mark, x: 1, y: 2 } : { mark: null, name: null, x: 285, y: -165 }, rsvps: { total: rsvps, residents: [] }, cancelled,
});

/** The fixture's dispatcher: a flat verb in, an invented answer out. `over` swaps any verb's answer (or throws / refuses). */
function town({ bugs = 40, events = 12, quests = 11, ballots = 1, ideaPosts = 0, marks = 91, long = false, over = {} } = {}) {
  const byClass = {
    bug: posts("bug", bugs, { base: 20, long }), event: posts("event", events, { base: 2, long }), quest: posts("quest", quests, { base: 900, long }),
    ballot: posts("ballot", ballots, { base: 600, long }), idea: posts("idea", ideaPosts, { base: 300, long }),
  };
  const calls = [];
  const answers = {
    read_posts: (a) => postsAnswer(a.class, byClass[a.class], { marks: a.class === "idea" ? marks : null }),
    read_bounties: () => ({ notices: [{ status: "open" }, { status: "open" }, { status: "closed" }] }),
    read_calendar: () => ({ now: [], coming: [event("moose/long-letter-hour", 139, 10_080, { mark: "vermillion/lounge" }), event("nyx/porch-trial", 720, 60), event("leo/stone-soup", 1500, 120)], ended: [] }),
    read_votes: () => ({ topics: [{ topic: "hearth-default", status: "staking", window: "closes 13 Dec", title: "Postmark's default Hearth", candidates: [{ candidate: "default", staked: 2 }, { candidate: "b", staked: 0 }] }, { topic: "old", status: "closed", candidates: [] }] }),
    read_bulletin: () => ({ total: 20, shown: 1, entries: [{ slug: "release-notes", title: "Release notes: the Hearth, and a Hall of Fame (2026-w47)", posted: "2026-11-15" }] }),
    read_feed: () => ({ rows: Array.from({ length: 5 }, (_, i) => ({ kind: "letter", id: `l${i}`, at: minAgo(13 + i), title: `illuminator wrote to resident-${i}` })), cursor: "f1.abc" }),
    read_town: () => ({ counts: { residents: 390 } }),
    ...over,
  };
  const call = async (tool, fields) => {
    calls.push({ tool, fields });
    const a = answers[tool];
    if (!a) throw new Error(`the fixture holds no ${tool}`);
    const r = typeof a === "function" ? a(fields) : a;
    if (r instanceof Error) throw r;
    return r;
  };
  const ctx = (extra = {}) => ({
    schemas, schemaRequired, call, nowMs: NOW, readShape: "v2",
    canon: async () => ({ as_of_settlement: "S175", next_attempt_at: "2026-11-17T06:00:00Z" }),
    registry: async () => ({ registry: { households: Object.fromEntries(Array.from({ length: 142 }, (_, i) => [`h${i}`, {}])) } }),
    ...extra,
  });
  return { calls, ctx };
}

// ── the shape ───────────────────────────────────────────────────────────────

test("the glance: the ruled parts in order, a key on every part with rows, the glance line in `more`, nothing of the act menu", async () => {
  const t = town();
  const g = await townApex({}, null, t.ctx());
  assert.deepEqual(Object.keys(g), ["town", "posts", "events", "votes", "bulletin", "happened", "can", "law", "cursor", "more", "reading_law", "read_shape"]);
  assert.equal(g.read_shape, "v2");
  assert.ok(!("glance" in g), "the glance line moved into `more`");
  assert.ok(g.more.startsWith(v2.GLANCE_LINE) && g.more.includes('read_shape: "v1"'), g.more);
  for (const part of ["posts", "events", "votes", "bulletin", "happened", "can"]) assert.equal(typeof g[part].key, "string", `${part} has its key`);
  assert.ok(!("acts" in g) && !("reading" in g) && !JSON.stringify(g).includes("dispatches_to"), "no act menu and no card schemas in the bare read");
  assert.deepEqual(Object.keys(g.posts), ["open", "rows", "rows_shown", "key"], "counts first, then the rows");
  assert.equal(g.town.name, "Postmark");
  assert.equal(g.town.crossing, currentCrossing(NOW));
  assert.equal(g.town.count, "390 residents · 142 households", "the household count the mock found missing");
  assert.match(g.town.next_crossing_in, /^\d+h \d{2}m$|^\d+ min$/);
  assert.deepEqual(g.law, { canon: "S175", next_settlement: "06:00Z", pen: v2.PEN_LINE });
  assert.match(g.happened.key, /older: read "feed", args: \{ cursor: "f1\.abc" \}/);
  assert.deepEqual(g.bulletin.headline, "release-notes · 11-15 · Release notes: the Hearth, and a Hall of Fame (2026-w47)");
});

test("the glance: empty parts are left out, and a read that failed is named, not shown as none", async () => {
  const t = town({ over: { read_calendar: { now: [], coming: [], ended: [] }, read_votes: { topics: [{ topic: "old", status: "closed", candidates: [] }] },
    read_feed: new Error("the index is down"), read_bulletin: { error: "bounce", code: 503, defect: "x", hint: "y" } } });
  const g = await townApex({}, null, t.ctx());
  for (const part of ["events", "votes", "bulletin", "happened"]) assert.ok(!(part in g), `${part} is left out`);
  assert.deepEqual(g.unavailable, ["bulletin", "feed"], "the reads that could not be answered are named");
  const ok = await townApex({}, null, town().ctx());
  assert.ok(!("unavailable" in ok), "and nothing is claimed unavailable when every read answered");
});

test("the counts: idea marks join idea posts, bounties count only the open notices, and a class with none is left out", async () => {
  const g = await townApex({}, null, town({ ideaPosts: 3, marks: 91, quests: 0, ballots: 0 }).ctx());
  assert.deepEqual(g.posts.open, { bug: 40, event: 12, idea: 94, bounty: 2 });
  assert.ok(g.posts.rows.every((r) => !r.startsWith("bounty ")), "a bounty is counted, never a row");
  assert.ok(g.posts.rows.some((r) => r.startsWith("idea ")), "an idea POST is a row wherever the post read answers it");
  const marksOnly = await townApex({}, null, town({ ideaPosts: 0, marks: 91 }).ctx());
  assert.equal(marksOnly.posts.open.idea, 91);
  assert.ok(!marksOnly.posts.rows.some((r) => r.startsWith("idea ")), "idea marks have no rows");
});

test("the reads the glance asks for are the open states of each class, and the counts come from the whole class's own tally", async () => {
  const t = town();
  await townApex({}, null, t.ctx());
  for (const cls of v2.ROW_CLASSES) {
    const c = t.calls.find((x) => x.tool === "read_posts" && x.fields.class === cls);
    assert.deepEqual(c.fields.state.split(","), OPEN(cls), `${cls}: only its open states`);
  }
  assert.equal(t.calls.find((x) => x.tool === "read_posts" && x.fields.class === "bug").fields.limit, 200, "the bug read pages by fifty unless asked");
});

// ── the 25 / 5 cut ──────────────────────────────────────────────────────────

test("posts: at most 5 per class, newest act first, and `rows_shown` says the cut", async () => {
  const g = await townApex({}, null, town({ ballots: 6, ideaPosts: 6 }).ctx());
  const rows = g.posts.rows;
  assert.equal(rows.length, 25, "five classes of five");
  const perClass = {};
  for (const r of rows) perClass[r.split(" ")[0]] = (perClass[r.split(" ")[0]] ?? 0) + 1;
  assert.deepEqual(perClass, { event: 5, bug: 5, ballot: 5, idea: 5, quest: 5 }, "five of each: 40 bugs and 12 events do not crowd out the others");
  assert.equal(g.posts.rows_shown, `25 of ${40 + 12 + 11 + 6 + 6}`, "X of Y over every open post of the classes that have rows");
  // newest first: the age in each row never goes down
  const ages = rows.map((r) => r.split(" · ")[3]).map((a) => Number(/(\d+)/.exec(a)[1]) * (/ h$/.test(a) ? 60 : / d$/.test(a) ? 1440 : 1));
  for (let i = 1; i < ages.length; i++) assert.ok(ages[i] >= ages[i - 1], `row ${i} is older than row ${i - 1}`);
  assert.deepEqual(g.posts.open, { bug: 40, event: 12, quest: 11, ballot: 6, idea: 97, bounty: 2 }, "counts by class lead (97 = 91 idea marks + 6 idea posts)");
});

test("posts: a class that is the newest still shows five, and the rest fill in behind it (the cap is per class, the 25 is overall)", () => {
  // seven classes (a future class is possible), each newer than the last: five apiece would be 35, and the overall 25 stops it
  const byClass = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`c${i + 1}`, posts("bug", 30, { base: 1 + i * 100 })]));
  const { rows, total } = v2.cutPosts(byClass, { nowMs: NOW });
  assert.equal(total, 210);
  assert.equal(rows.length, 25, "seven classes could show 35; the overall cut is 25");
  const per = {};
  for (const r of rows) per[r.split(" ")[0]] = (per[r.split(" ")[0]] ?? 0) + 1;
  assert.deepEqual(per, { c1: 5, c2: 5, c3: 5, c4: 5, c5: 5 }, "the five most recent classes, five of each");
  const one = v2.cutPosts({ bug: posts("bug", 30, { base: 1 }), event: posts("event", 3, { base: 100 }) }, { nowMs: NOW });
  assert.equal(one.rows.filter((r) => r.startsWith("bug ")).length, 5, "thirty fresh bugs still show five");
  assert.equal(one.rows.length, 8, "and the three older events show behind them: 5 + 3");
});

test("posts: a row says class, id, state, responses, the last act and its age, and a title cut at 60", () => {
  const r = v2.postRow({ id: "kogane/add-resident", state: "briefed", responses: 2, latest: { act: "advance", at: minAgo(31) }, title: `T${"x".repeat(100)}` }, "bug", NOW);
  const [head, state, resp, last, title] = r.split(" · ");
  assert.deepEqual([head, state, resp, last], ["bug kogane/add-resident", "briefed", "2", "advance 31 min"]);
  assert.equal(title.length, 60);
  assert.ok(title.endsWith("…"));
  assert.match(v2.postRow({ id: "a/b", state: "reported", title: "t" }, "bug", NOW), /· 0 · no act yet · t$/);
});

// ── the ceiling ─────────────────────────────────────────────────────────────

test("the size: the glance is within 10,000 characters as served, on a realistic town and on the longest the fields allow", async (t) => {
  const real = await townApex({}, null, town().ctx());
  const ideaPostsWas = process.env.IDEA_POSTS;
  setEnv("IDEA_POSTS", "1"); // the longest `can` is the one with the idea class a post: it names three more acts
  const worst = await townApex({}, null, town({ long: true, ideaPosts: 30, ballots: 8, over: {
    read_calendar: () => ({ now: [event("a-host/an-event-now", -30, 120, { mark: "a-household-with-a-long-name/its-welcome-lounge" })],
      coming: ["one", "two", "three", "four", "five", "six", "seven"].map((s, i) => event(`a-host-with-a-long-handle/${s}-${"y".repeat(50)}`, 60 + i * 30, 10_080, { mark: "a-household-with-a-long-name/its-welcome-lounge", rsvps: 120 })), ended: [] }),
    read_votes: () => ({ topics: Array.from({ length: 6 }, (_, i) => ({ topic: `topic-${i}-${"z".repeat(40)}`, status: "staking", window: "w".repeat(200), title: "t".repeat(200), candidates: [{ candidate: "c".repeat(120), staked: 99999 }] })) }),
    read_bulletin: () => ({ entries: [{ slug: "s".repeat(60), title: "t".repeat(300), posted: "2026-11-15" }] }),
    read_feed: () => ({ rows: Array.from({ length: 5 }, (_, i) => ({ kind: "mark", id: `m${i}`, at: minAgo(5 + i), title: "w".repeat(300) })), cursor: `f1.${"Q".repeat(110)}` }),
  } }).ctx()).finally(() => setEnv("IDEA_POSTS", ideaPostsWas));
  assert.ok(worst.can.carry.includes("sign-up"), "the longest case has the idea posts' acts in `can`");
  t.diagnostic(`as served: realistic ${served(real)}, the longest ${served(worst)} (ceiling ${v2.CEILING})`);
  assert.ok(served(real) <= v2.CEILING, `the realistic glance is ${served(real)} characters`);
  assert.ok(served(worst) <= v2.CEILING, `the longest glance is ${served(worst)} characters`);
  assert.equal(worst.posts.rows.length, 25, "the longest case really did fill every row");
  assert.ok(served(worst) > served(real), "and it is bigger than the realistic one, so the bound is not vacuous");
});

// ── the shape switch, and v1 ─────────────────────────────────────────────────

test("TOWN_READ_SHAPE=v2 is a shape; t0, t1 and t2 are still shapes; anything else is the control", () => {
  assert.equal(shape.doorShape("town", { TOWN_READ_SHAPE: "v2" }), "v2");
  for (const s of ["t0", "t1", "t2"]) assert.equal(shape.doorShape("town", { TOWN_READ_SHAPE: s }), s);
  assert.equal(shape.doorShape("town", { TOWN_READ_SHAPE: "v3" }), "t0");
  assert.equal(shape.townLeanShape("v2"), "t0", "v2's own v1 is today's read");
  assert.equal(shape.townLeanShape("t2"), "t2");
});

test("the MCP default (ctx.readShape v2) serves the glance; REST with no shape serves today's read; a call can ask for either", async () => {
  const t = town();
  const mcp = await townApex({}, null, t.ctx());
  assert.equal(mcp.read_shape, "v2");
  const rest = await townApex({}, null, t.ctx({ readShape: undefined }));
  assert.ok(Array.isArray(rest.acts) && rest.reading && !("read_shape" in rest), "no shape: today's read, byte for byte");
  const optIn = await townApex({ read_shape: "v2" }, null, t.ctx({ readShape: undefined }));
  assert.equal(optIn.read_shape, "v2", "read_shape: v2 on the call opts in");
});

test('read_shape: "v1" (and "t0") still answer today\'s read, whatever the default; any other value is ignored as on base', async () => {
  const t = town();
  const today = await townApex({}, null, t.ctx({ readShape: undefined }));
  for (const asked of ["v1", "t0"]) {
    const r = await townApex({ read_shape: asked }, null, t.ctx());
    assert.equal(JSON.stringify(r), JSON.stringify(today), `${asked} answers today's read under a v2 default`);
  }
  const lean = await townApex({ read_shape: "v1" }, null, t.ctx({ readShape: "t2" }));
  assert.equal(JSON.stringify(lean), JSON.stringify(today), "v1 is the fuller read even where the default is a lean t-shape");
  // POS-687 (Darko, 10-18: keep the old ways working): base ignored any read_shape on the bare read, so any other value is still ignored
  for (const odd of ["t1", "v9", 7]) {
    const r = await townApex({ read_shape: odd }, null, t.ctx({ readShape: undefined }));
    assert.equal(JSON.stringify(r), JSON.stringify(today), `read_shape: ${JSON.stringify(odd)} is ignored, as on base`);
    assert.equal((await townApex({ read_shape: odd }, null, t.ctx())).read_shape, "v2", `and the default (v2) answers`);
  }
  assert.equal((await townApex({ cards: "full" }, null, t.ctx({ readShape: "t1" }))).acts.length, today.acts.length, "t1's own cards still work");
});

test("the tool's schema: read_shape and since are declared; v2 carries no cards field; t1 still does", () => {
  setEnv("TOWN_READ_SHAPE", "v2");
  try {
    const p = TOWN_TOOL.inputSchema.properties;
    assert.deepEqual(p.read_shape.enum, ["v1", "v2"]);
    assert.ok(p.since && !("cards" in p));
    assert.ok(!p.read.enum.includes("acts"), 'no read: "acts": each card is read: "<act>"');
    setEnv("TOWN_READ_SHAPE", "t1");
    assert.ok("cards" in TOWN_TOOL.inputSchema.properties);
  } finally { setEnv("TOWN_READ_SHAPE", undefined); }
});

test("a top-level read_shape never reaches a read's or an act's own field check", async () => {
  const calls = [];
  const call = async (tool, fields) => { calls.push({ tool, fields }); return { ok: tool }; };
  const r = await townApex({ read: "bulletin", read_shape: "v1" }, null, { schemas, schemaRequired, call });
  assert.deepEqual(r, { ok: "read_bulletin" }, JSON.stringify(r).slice(0, 200));
  assert.deepEqual(calls.at(-1).fields, {}, "and it is not passed on to the flat verb");
  const a = await townApex({ do: "close", read_shape: "v2", args: { post: "x/y" } }, { household: "h", handles: new Set(["r"]), ghId: "1" }, { schemas, schemaRequired, call });
  assert.ok(!a.error || a.code !== 422 || !/read_shape/.test(a.defect), `an act is not refused for read_shape: ${a.defect}`);
});

test('each act the glance names has its card behind read: "<act>"', async () => {
  for (const act of TOWN_DISPATCHABLE) {
    const r = await townApex({ read: act, read_shape: "v2" }, null, { schemas, schemaRequired, call: async () => ({}) });
    assert.equal(r.card?.act, act, `read: "${act}" is its card`);
    assert.ok(r.card.blurb && r.card.fields && r.card.dispatches_to);
  }
});

// ── can ─────────────────────────────────────────────────────────────────────

/** `post { class: idea, slug, body, stamps?, at? | on? }` → { act: "post", fields: ["class", "slug", …] } */
function parseCan(group) {
  return group.split(" · ").map((item) => {
    const m = /^([a-z-]+)(?: \{ (.*) \})?$/.exec(item);
    assert.ok(m, `"${item}" is an act and its fields`);
    const fields = (m[2] ?? "").split(",").flatMap((f) => f.split("|")).map((f) => f.trim().replace(/^class:.*/, "class").replace(/\?$/, "")).filter((f) => f && !f.startsWith("…"));
    return { act: m[1], fields };
  });
}

test("can: every act of the door is in exactly one group, and every field named is a field of that act's real schema", async () => {
  const g = await townApex({}, null, town().ctx());
  const groups = Object.entries(g.can).filter(([k]) => k !== "key");
  assert.deepEqual(groups.map(([k]) => k), ["put_up", "carry", "back", "hands"]);
  const named = groups.flatMap(([, line]) => parseCan(line));
  assert.deepEqual([...new Set(named.map((n) => n.act))].sort(), [...TOWN_DISPATCHABLE].sort(), "the census: every act, once the idea class is a mark road");
  const cards = (await townApex({ read_shape: "v1" }, null, { schemas, schemaRequired })).acts;
  for (const { act, fields } of named) {
    const card = cards.find((c) => c.act === act);
    for (const f of fields) assert.ok(f in card.fields, `can names ${act}'s field "${f}", which its schema (${Object.keys(card.fields).join(", ")}) does not take`);
  }
  for (const card of cards) {
    const all = new Set(named.filter((n) => n.act === card.act).flatMap((n) => n.fields));
    for (const [f, spec] of Object.entries(card.fields)) if (spec?.required && f !== "handle") assert.ok(all.has(f), `can leaves out ${card.act}'s required field "${f}"`);
  }
});

// the three flat verbs are listed only with IDEA_POSTS=1 at load; run this file with it set to run this one too
test("can, with the idea class a post: the sign-up acts join, and their fields are their flat verbs' own", { skip: !schemas.town_sign_up && "needs IDEA_POSTS=1 at load: town_sign_up is not a listed tool without it" }, () => {
  const on = v2.canBlock({ ideaPosts: true });
  const named = Object.entries(on).filter(([k]) => k !== "key").flatMap(([, line]) => parseCan(line));
  const flat = { "sign-up": "town_sign_up", "answer-sign-up": "town_answer_sign_up", award: "town_award" };
  for (const [act, tool] of Object.entries(flat)) {
    const n = named.find((x) => x.act === act);
    assert.ok(n, `${act} is named while idea posts are on`);
    for (const f of n.fields) assert.ok(f in schemas[tool], `${act} names "${f}", which ${tool} does not take (${Object.keys(schemas[tool]).join(", ")})`);
  }
  assert.ok(named.find((x) => x.act === "post" && x.fields.includes("title") && !x.fields.includes("slug")), "the idea post's fields are title and body");
  assert.equal(Object.keys(v2.canBlock({ ideaPosts: false })).length, Object.keys(on).length);
  assert.ok(!JSON.stringify(v2.canBlock()).includes("sign-up"));
});

// ── since ───────────────────────────────────────────────────────────────────

test("since: only the posts acted on after the cursor, the newest public acts, a fresh cursor; and nothing_new is a true answer", async () => {
  const t = town();
  const first = await townApex({}, null, t.ctx());
  const c = decodeCursor(first.cursor);
  assert.equal(c.crossing, currentCrossing(NOW));
  assert.equal(c.ms, NOW);
  // a minute later: nothing was acted on after the first read's instant, so the quiet town says so
  const quiet = await townApex({ since: first.cursor }, null, town({ over: { read_feed: { rows: [] } } }).ctx({ nowMs: NOW + 60_000 }));
  assert.equal(quiet.nothing_new, true);
  assert.ok(!("posts" in quiet) && !("happened" in quiet));
  assert.ok(decodeCursor(quiet.cursor).ms > c.ms);
  // a cursor from 10 minutes before: the posts last acted on in those ten minutes (the fixture's newest are 2..6 minutes old)
  const old = (await townApex({}, null, t.ctx({ nowMs: NOW - 10 * 60_000 }))).cursor;
  const fresh = await townApex({ since: old }, null, t.ctx());
  assert.ok(fresh.posts.rows.length > 0 && fresh.posts.rows.length <= 25);
  assert.ok(fresh.posts.rows.every((r) => /^(event|bug) /.test(r)), "only what was acted on since");
  assert.ok(!("nothing_new" in fresh) && !("town" in fresh) && !("can" in fresh));
  assert.equal(fresh.since, new Date(NOW - 10 * 60_000).toISOString());
  const bad = await townApex({ since: "yesterday" }, null, t.ctx());
  assert.equal(bad.code, 422);
  assert.match(bad.defect, /takes the cursor/);
  const blind = await townApex({ since: old }, null, town({ over: { read_feed: new Error("down") } }).ctx());
  assert.deepEqual(blind.unavailable, ["feed"], "a read that failed is named even in a since answer");
  assert.ok(!("nothing_new" in blind));
});

// ── explain ─────────────────────────────────────────────────────────────────

test("explain: every key of the glance, to depth 2, has a row at the town door (the glance, its since form and an unavailable one)", async () => {
  const full = await townApex({}, null, town({ over: { read_feed: new Error("down") } }).ctx());
  assert.ok("unavailable" in full && "posts" in full && "events" in full, "the fixture reaches every part but happened");
  const withFeed = await townApex({}, null, town().ctx());
  assert.deepEqual(unexplained("town", full, 2), [], "the glance");
  assert.deepEqual(unexplained("town", withFeed, 2), [], "the glance with its feed");
  const old = (await townApex({}, null, town().ctx({ nowMs: NOW - 10 * 60_000 }))).cursor;
  const since = await townApex({ since: old }, null, town({ over: { read_feed: { rows: [{ kind: "letter", id: "z", at: minAgo(1), title: "a wrote to b" }] } } }).ctx());
  assert.ok("posts" in since && "happened" in since, "the since form with something in it");
  assert.deepEqual(unexplained("town", since, 2), [], "the since form");
  const quiet = await townApex({ since: withFeed.cursor }, null, town({ over: { read_feed: { rows: [] } } }).ctx({ nowMs: NOW + 60_000 }));
  assert.deepEqual(unexplained("town", quiet, 1), [], "nothing_new");
  assert.ok(keyPaths(withFeed, 2).includes("posts.rows_shown") && keyPaths(withFeed, 2).includes("can.put_up"), "the paths are the ones the read prints");
});

test("explain: the glance's parts answer through the door, and the old posts row still names state and its alias", async () => {
  const q = await townApex({ explain: "posts.rows" }, null, {});
  assert.equal(q.explains, "posts.rows");
  assert.match(q.what, /at most 5 of any one class/);
  for (const p of ["town.crossing", "can.hands", "law.pen", "cursor", "bulletin.headline", "happened.key"]) assert.equal((await townApex({ explain: p }, null, {})).explains, p, p);
  const posts = explainAnswer("town", "posts");
  assert.match(posts.what, /read_shape: "v2"/);
  assert.match(posts.detail, /THE WORD IS STATE/, "the posts read's own words are kept");
});

// ── review fixes (POS-733, FIX at 7cc29605) ──────────────────────────────────

test("a floor read is not none: the Bounty Board on its floor, and a Think Tank with no marks count, are named unavailable and never counted as 0", async () => {
  const floor = await townApex({}, null, town({ over: { read_bounties: { notices: [], source: "floor", disclosed: "the world store would not open" } } }).ctx());
  assert.ok(floor.unavailable.includes("bounties"), JSON.stringify(floor.unavailable));
  assert.ok(!("bounty" in floor.posts.open), "a bounty count that could not be read is left out, not 0");
  assert.equal(floor.posts.open.idea, 91, "the other class is still counted");
  const tank = await townApex({}, null, town({ over: { read_posts: (a) => postsAnswer(a.class, [], { marks: null }) } }).ctx());
  assert.ok(tank.unavailable.includes("idea marks"), JSON.stringify(tank.unavailable));
  const fine = await townApex({}, null, town().ctx());
  assert.ok(!("unavailable" in fine) && fine.posts.open.bounty === 2, "and a store that answered is not called unavailable");
});

test("since: a bulletin posting from earlier today is not new to a call a minute later; one posted after the cursor's instant is", async () => {
  const dated = (posted) => ({ over: { read_feed: { rows: [] }, read_bulletin: { entries: [{ slug: "release-notes", title: "Notes", posted }] } } });
  const c = (await townApex({}, null, town().ctx())).cursor;
  const sameDay = await townApex({ since: c }, null, town(dated("2026-11-17")).ctx({ nowMs: NOW + 60_000 }));
  assert.equal(sameDay.nothing_new, true, "2026-11-17 00:00Z is before the cursor's 03:40Z");
  const later = await townApex({ since: c }, null, town(dated("2026-11-17T03:50:00Z")).ctx({ nowMs: NOW + 20 * 60_000 }));
  assert.match(later.bulletin.headline, /^release-notes · 11-17 · Notes$/);
  assert.ok(!("nothing_new" in later));
});

test('"X of Y": Y is the true open count past the fetched page, and a since answer says "at least" when a class was cut', async () => {
  const many = Array.from({ length: 200 }, (_, i) => posts("bug", 200, { base: 20 })[i]);
  const g = await townApex({}, null, town({ over: { read_posts: (a) => (a.class === "bug"
    ? { ...postsAnswer("bug", many), counts_by_state: { ...postsAnswer("bug", many).counts_by_state, reported: 250 - 200 + postsAnswer("bug", many).counts_by_state.reported } }
    : postsAnswer(a.class, posts(a.class, 2, { base: 5 }), { marks: a.class === "idea" ? 1 : null })) } }).ctx());
  assert.equal(g.posts.open.bug, 250);
  assert.equal(g.posts.rows_shown, `${g.posts.rows.length} of ${250 + 2 + 2 + 2 + 2}`, "the open bugs are 250, not the 200 fetched");
  const old = (await townApex({}, null, town().ctx({ nowMs: NOW - 10 * 60_000 }))).cursor;
  const since = await townApex({ since: old }, null, town({ over: { read_posts: (a) => (a.class === "bug"
    ? { ...postsAnswer("bug", many), counts_by_state: { reported: 250 } } : postsAnswer(a.class, posts(a.class, 2, { base: 1 })) ) } }).ctx());
  assert.match(since.posts.rows_shown, /^\d+ of at least \d+$/);
});

test("the town tool's description and read_shape text say what the bare read is now, and where the older read is", () => {
  const d = TOWN_TOOL.description;
  assert.match(d, /Bare, it answers the town's glance/);
  assert.match(d, /read_shape: "v1" is the older, fuller read, with every act's card/);
  assert.match(TOWN_TOOL.inputSchema.properties.read_shape.description, /"v1" is the older, fuller read, with every act's card/);
  assert.match(v2.POSTS_KEY, /since: open posts only/);
});
