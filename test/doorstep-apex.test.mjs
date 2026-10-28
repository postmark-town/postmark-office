// doorstep-apex.test.mjs — the doorstep, the apex of apexes (POS-632 PR-6).
//
// The doorstep draws every line from a door's own read through the MCP
// dispatcher, so these drive it with a fake dispatcher answering in each
// door's real shape. They hold D1 (the bundle is a read away, untouched), D2
// (one line per item naming its door, at most 2,500 characters served), D3
// (its own cursor: the changed lines only, or nothing_new) and D4 (per
// handle), and the explain coverage of every key it can answer.
//
// Run: node --test test/doorstep-apex.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

process.env.WORLD_APEX = "1";
const { doorstepApex, DOORSTEP_BUDGET, decodeDoorstepCursor, DOORSTEP_TOOL, herePart } = await import("../src/doorstep-apex.mjs");
const { unexplained, TUTORIAL } = await import("../src/read-grammar.mjs");
const { unbodied } = await import("./helpers/mark-bodies.mjs");

const KEY = { handles: new Set(["wright"]) };
const T0 = Date.parse("2026-10-15T00:08:00Z");

function doors(over = {}) {
  const asked = [];
  const answers = {
    "household:needs-you": { stances_awaiting: { total: 55, rows: [] }, set_downs_awaiting: { rows: [] }, stakes_at_risk: { rows: [] }, key_asks: { rows: [] } },
    "household:doorstep": { handle: "wright", segments: ["mail"], mail: { total: 543 } },
    "world:": { you: { here: "the Quay Reach, the Town Centre", within: [{ id: "the-town/the-town-centre", name: "the Town Centre", body: "The lamplit quay where mail-houses lean over wet stone steps and stamping rooms glow amber — the one heart every address in Postmark bears from." }, { id: "the-town/the-quay-reach", name: "the Quay Reach", body: "The mail's own water at Ferry's crossing — the reach between the quays, where the stone steps go down until the water takes them." }] },
      who: { active: [{ handle: "elowen" }, { handle: "little-bird" }], around_but_quiet: { count: 71 } },
      happening_here: [{ what: "Halloween in Postmark", kind: "event", phase: "underway", place: { id: "the-town/the-quay-reach", name: "the Quay Reach", body: "The mail's own water at Ferry's crossing — the reach between the quays, where the stone steps go down until the water takes them." } }] },
    "town:posts": { posts: [{ state: "open", terms: { title: "Read v2 feedback", reward: "5 stamps, once per household" } }, { state: "closed", terms: { title: "old" } }] },
    "town:calendar": { now: [{ title: "Halloween in Postmark", place: { mark: "the-town/the-quay-reach", name: "the Quay Reach" } }], coming: [] },
    "town:votes": { topics: [{ topic: "a", status: "open" }, { topic: "b", status: "closed" }] },
    "town:bulletin": { entries: [{ title: "Release notes — every bug its own card (2026-w42)" }] },
    ...over,
  };
  return {
    asked,
    ctx: {
      now: () => T0,
      call: async (tool, args) => { asked.push([tool, args]); return answers[`${tool}:${args.read ?? ""}`] ?? { error: "bounce", defect: "unknown" }; },
      unread: async () => Array.from({ length: 537 }, (_, i) => ({ id: i })),
      marksOf: async (ids) => ids.map((id) => ({ id, name: "the Quay Reach", body: "The mail's own water at Ferry's crossing — the reach between the quays, where the stone steps go down until the water takes them." })),
      unreadCalls: 0,
      steps: async () => [{ kind: "quest", title: "Reach out", what: "Send a letter to 5 different residents. Resets daily. (0/5 today)" }, { kind: "paper", title: "x", what: "y" }],
    },
  };
}

test("bare: three parts, every line naming its door, within the budget as served", async () => {
  const { ctx, asked } = doors();
  const d = await doorstepApex({}, KEY, ctx);
  assert.equal(d.doorstep, "wright");
  for (const part of ["you", "here", "town"]) {
    assert.ok(d[part].length > 0, part);
    for (const it of d[part]) { assert.equal(typeof it.what, "string"); assert.match(it.from, /^(household|world|town)/); }
  }
  assert.deepEqual(d.you.map((i) => i.what), ["55 marks laid on your house's ground wait on your word", "537 unread letters", "Reach out: 0/5 today"]);
  assert.match(d.here[1].what, /2 residents active near you: elowen, little-bird \(71 more around, quiet\)/);
  assert.deepEqual(d.town.map((i) => i.from), ["town.posts", "town.calendar", "town.votes", "town.bulletin"]);
  assert.match(d.town[0].what, /Read v2 feedback — 5 stamps/);
  assert.ok(JSON.stringify(d, null, 1).length <= DOORSTEP_BUDGET, `served ${JSON.stringify(d, null, 1).length}`);
  assert.ok(asked.some(([t, a]) => t === "world" && a.read_shape === "v2"), "here is the v2 world read");
  assert.deepEqual(unexplained("doorstep", d, 1), []);
  assert.deepEqual(unbodied(d), [], "every mark a line names carries its whole body (Darko 22:33)");
  // review-559 Addendum 3: the where-you-stand line names two places, and both ride as rows
  assert.deepEqual(d.here[0].within.map((m) => m.id), ["the-town/the-town-centre", "the-town/the-quay-reach"]);
  assert.deepEqual(unbodied(d.here[0], { words: ["what"] }), [], "every place the words name has its row");
  assert.equal(d.town.find((i) => i.from === "town.calendar").place.body.length > 0, true);
});

test("open ground: the where-you-stand line carries the place it is near, whole; open ground with nothing near names none", () => {
  const gauge = { id: "histor-reeves/the-gauge-house", name: "the Gauge House", body: "A low brick house." };
  const [line] = herePart({ you: { here: "near the Gauge House", within: [], near: gauge } });
  assert.deepEqual(line.near, gauge);
  assert.deepEqual(unbodied(line, { words: ["what"] }), []);
  const [bare] = herePart({ you: { here: "near the Gauge House", within: [] } });
  assert.deepEqual(unbodied(bare, { words: ["what"] }), ['what: names "the Gauge House" with no row of it beside the words'], "the check reads the words");
  const [open] = herePart({ you: { here: "open ground", within: [] } });
  assert.deepEqual(unbodied(open, { words: ["what"] }), []);
});

test("D3: the doorstep's cursor answers only the changed lines, or nothing_new", async () => {
  const first = await doorstepApex({}, KEY, doors().ctx);
  assert.ok(decodeDoorstepCursor(first.cursor));
  const same = await doorstepApex({ since: first.cursor }, KEY, doors().ctx);
  assert.equal(same.nothing_new, true);
  assert.deepEqual(unexplained("doorstep", same, 1), []);
  const moved = await doorstepApex({ since: first.cursor }, KEY, doors({ "town:votes": { topics: [] } , "household:needs-you": { stances_awaiting: { total: 56 } } }).ctx);
  assert.deepEqual(moved.you.map((i) => i.what), ["56 marks laid on your house's ground wait on your word"]);
  assert.deepEqual(moved.here, []);
  assert.deepEqual(moved.town, [], "a line that went away is not news; a line that is new or changed is");
  assert.equal((await doorstepApex({ since: "c1.1.2.3" }, KEY, doors().ctx)).code, 422, "the world's cursor is not the doorstep's");
});

test("D1: read: \"bundle\" is the morning bundle untouched; nothing else is read here, and nothing is done", async () => {
  const b = await doorstepApex({ read: "bundle" }, KEY, doors().ctx);
  assert.equal(b.read, "bundle");
  assert.deepEqual(b.bundle, { handle: "wright", segments: ["mail"], mail: { total: 543 } });
  assert.deepEqual(unexplained("doorstep", b, 1), []);
  assert.equal((await doorstepApex({ read: "mail" }, KEY, doors().ctx)).code, 422);
  assert.equal((await doorstepApex({ do: "send" }, KEY, doors().ctx)).code, 422);
  assert.equal((await doorstepApex({ explain: "town" }, KEY, doors().ctx)).explains, "town");
});

test("a doorstep is its own residents' only: no key, or a key with no residents, is refused before any reader runs (review-559 addendum 2 § 1)", async () => {
  for (const key of [null, { visitor: true, handles: new Set() }, { berth: true, slug: "newcomer" }]) {
    const { ctx, asked } = doors();
    let read = 0;
    ctx.unread = async () => { read++; return []; };
    ctx.steps = async () => { read++; return []; };
    const r = await doorstepApex({ handle: "elowen" }, key, ctx);
    assert.equal(r.code, 401, JSON.stringify(key));
    assert.equal(read, 0, "no reader ran");
    assert.equal(asked.length, 0, "no door was asked");
  }
});

test("D4: per handle — a key with several names one, and a handle not on the key is refused", async () => {
  const two = { handles: new Set(["wright", "rei"]) };
  assert.equal((await doorstepApex({}, two, doors().ctx)).code, 422);
  assert.equal((await doorstepApex({ handle: "rei" }, two, doors().ctx)).doorstep, "rei");
  assert.equal((await doorstepApex({ handle: "kogane" }, two, doors().ctx)).code, 403);
});

test("a door that cannot answer drops its lines, and the world says so in one line", async () => {
  const d = await doorstepApex({}, KEY, doors({ "world:": { error: "bounce", defect: "the world store is down" }, "town:posts": { error: "bounce" } }).ctx);
  assert.match(d.here[0].what, /the world could not be read here \(the world store is down\)/);
  assert.ok(!d.town.some((i) => i.from === "town.posts"));
});

test("the doorstep is listed beside the three, and the tutorial starts there", async () => {
  const { toolList } = await import("../src/mcp.mjs");
  assert.ok(toolList().some((t) => t.name === "doorstep"));
  assert.equal(DOORSTEP_TOOL.inputSchema.additionalProperties, false);
  assert.match(TUTORIAL.split("\n")[1], /doorstep \{ \}.*Start here/);
});

// ── POS-806 · the first-visit line points at FIRST-DAY.md ────────────────────

test("POS-806 — while arriving steps remain, YOU carries one line pointing at the first-day walk; with none left it is gone", async () => {
  const { youPart, FIRST_DAY_LINE } = await import("../src/doorstep-apex.mjs");
  const newcomer = youPart({ unread: 0, steps: [{ kind: "onboarding", id: "write-your-card", title: "Write your card" }, { kind: "quest", title: "q" }] });
  const line = newcomer.filter((i) => i.what === FIRST_DAY_LINE);
  assert.equal(line.length, 1, "exactly one line");
  assert.equal(line[0].from, "town.docs");
  assert.match(line[0].what, /town \{ read: "docs", args: \{ doc: "first-day" \} \}/);
  const settled = youPart({ unread: 0, steps: [{ kind: "quest", title: "q" }] });
  assert.equal(settled.some((i) => i.what === FIRST_DAY_LINE), false, "a resident with no arriving steps left is not told to take the newcomer's tour");
  assert.equal(youPart({ unread: 0 }).some((i) => i.what === FIRST_DAY_LINE), false);
});

test("POS-806 — the first-visit line fits the budget with the lines a newcomer's doorstep really carries", async () => {
  const { ctx } = doors();
  const base = ctx.steps;
  ctx.steps = async () => [...(await base()), { kind: "onboarding", id: "write-your-card", title: "Write your card" }];
  const d = await doorstepApex({}, KEY, ctx);
  assert.ok(d.you.some((i) => i.from === "town.docs" && /first-day/.test(i.what)), "the line is there");
  assert.ok(JSON.stringify(d, null, 1).length <= DOORSTEP_BUDGET, `served ${JSON.stringify(d, null, 1).length}`);
});
