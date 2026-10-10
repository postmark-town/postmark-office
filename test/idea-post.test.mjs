// idea-post.test.mjs — the idea class on the post machine (POS-290), behind IDEA_POSTS.
//
//   node --test test/idea-post.test.mjs
//
// The gate (Wright's go on lane A, 2026-10-09; PLAN.md § 2, lane A):
//
//   1. OFF, an idea goes where it went before (town_post answers null and the
//      mark lane runs), and every idea-post act is refused by name, writing nothing;
//   2. ON, an idea posts as a post (title and body, or the old card's slug and
//      body), never as a mark; the mark road's fields are refused by name; an
//      id a Think Tank mark holds is refused;
//   3. the hands move it to any named stage in any order, with credit, link and
//      note, and the read's history has a row for each;
//   4. a non-hand cannot move it, a finished idea moves no further, and only
//      wright and keemin award;
//   5. sign-ups: standing, replaced, withdrawn, answered by a hand only;
//   6. the award records an act and moves no stamps: no ledger line, no stamp
//      row; a meep, a bug-stage label, a repeated label and too many stamps are
//      refused; the read's stamps_paid comes from the chain's award line;
//   7. the Think Tank's read: nothing added while the store holds no idea post,
//      the posts beside the marks once it does;
//   8. the rebuild folds the idea acts into exactly the rows the pen wrote;
//   9. the history's one reader reads the stamp chain as a delta: only the
//      rows past what it read, and from the top again on another chain;
//  10. an event's and a quest's history: the post and its close.
//
// ⚑ THE STORE IS A JS STUB (`acts-pen-stub.mjs`), as in bug-post.test.mjs: this
// proves which acts and rows the pen writes and what the reads make of them,
// nothing about Postgres.
//
// THE FLIPS are in G:/Starstory/docs/2026-10-09/rail/plumb-idea-plan/NOTES.md.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { installActsPen, uninstallActsPen, RECORD_ON } from "./acts-pen-stub.mjs";

Object.assign(process.env, RECORD_ON);
const { postAtTown, amendAtTown, advanceAtTown, closeAtTown } = await import("../src/events-store.mjs");
const { postsAtOffice } = await import("../src/town-posts.mjs");
const { townPostEvent, callTownPostTool } = await import("../src/town-post.mjs");
const { signUpAtTown, answerSignUpAtTown, awardAtTown, ideaPostsForTank } = await import("../src/idea-store.mjs");
const { compareRebuild, dryRun } = await import("../world2/tools/events-rebuild.mjs");
const { awardPaidOf, IDEA_FINISHED } = await import("../src/ideas.mjs");
const { postPaymentsVia, resetChainMemo, plainHistoryOf, postLineOf } = await import("../src/post-history.mjs");
const { firstClauseOf } = await import("../src/world.mjs");

const NOW = Date.now();
const ON = { ...process.env, IDEA_POSTS: "1" };
const OFF = { ...process.env, IDEA_POSTS: undefined };

const WRIGHT = { household: "starforge", handles: new Set(["wright"]) };
const KEEMIN = { household: "darko", handles: new Set(["keemin"]) };
const ARCHITECT = { household: "the-town", handles: new Set(["architect"]) };
const ERRANT = { household: "errant", handles: new Set(["errant"]) };
const FINN = { household: "finn", handles: new Set(["finn"]) };
const ADA = { household: "the-harbor", handles: new Set(["ada"]) };

const HOUSES = [{ slug: "the-harbor", ord: 1, residents: ["errant", "ada"] }];
const ROLL = new Set(["wright", "keemin", "architect", "errant", "ada", "finn", "ferry"]);
const MEEPS = new Set(["architect", "ferry"]);
const isMeep = (h) => MEEPS.has(h);
const LINK = "https://github.com/postmark-town/postmark-blueprints/discussions/12";

// ── the posts, responses, marks and stamp chain, in memory ──────────────────
function ideaTables() {
  const posts = new Map();
  const responses = new Map();   // "post handle kind" → row
  const marks = new Set(["errant/a-tank-mark"]);   // a legacy Think Tank idea mark's id
  const ledger = { lines: [], deltas: [] };
  const sealOf = (n) => createHash("sha256").update(ledger.lines.slice(0, n).join("\n")).digest("hex");
  const like = (pat) => new RegExp(`^${pat.split("%").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "s");
  const PC = ["id", "class", "title", "body", "author", "household", "place_mark", "place_x", "place_y",
    "starts", "ends", "state", "fields", "revised", "posted_act", "last_act"];
  const asJson = (v) => (typeof v === "string" ? JSON.parse(v) : v);
  const copy = (r) => ({ ...r, fields: { ...r.fields } });
  const byClass = (cls) => [...posts.values()].filter((r) => r.class === cls).sort((a, b) => a.id.localeCompare(b.id)).map(copy);
  const rcopy = (r) => ({ ...r, fields: { ...r.fields } });
  const rsorted = () => [...responses.values()].sort((a, b) => a.post.localeCompare(b.post) || a.handle.localeCompare(b.handle));
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
    [/^SELECT slug FROM marks WHERE slug LIKE \$1$/i, (q, p) => {
      const pre = p[0].replace(/%$/, "");
      const rows = [...marks].filter((s) => s.startsWith(pre)).map((slug) => ({ slug }));
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT 1 FROM posts WHERE id = \$1 AND class = \$2 UNION ALL SELECT 1 FROM marks WHERE slug = \$1$/i, (q, p) => {
      const hit = (posts.get(p[0])?.class === p[1]) || marks.has(p[0]);
      return { rows: hit ? [{ "?column?": 1 }] : [], rowCount: hit ? 1 : 0 };
    }],
    [/^SELECT id, class, title, author, household, starts, ends, fields, state, last_act FROM posts WHERE class = \$1 ORDER BY id$/i, (q, p) => {
      const rows = byClass(p[0]);
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT id, body FROM posts WHERE id = ANY\(\$1\) AND class = \$2$/i, (q, p) => {
      const rows = [...posts.values()].filter((r) => p[0].includes(r.id) && r.class === p[1]).map((r) => ({ id: r.id, body: r.body }));
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT \* FROM posts WHERE class = \$1 ORDER BY id$/i, (q, p) => { const rows = byClass(p[0]); return { rows, rowCount: rows.length }; }],
    // responses
    [/^INSERT INTO responses/i, (q, p) => {
      const r = { post: p[0], handle: p[1], household: p[2], kind: p[3], state: p[4], fields: asJson(p[5]), act: p[6] };
      responses.set(`${r.post} ${r.handle} ${r.kind}`, r);
      return { rows: [], rowCount: 1 };
    }],
    [/^SELECT post, handle, household, kind, state, fields, act FROM responses WHERE post = \$1 AND handle = \$2 AND kind = \$3$/i, (q, p) => {
      const r = responses.get(`${p[0]} ${p[1]} ${p[2]}`);
      return { rows: r ? [rcopy(r)] : [], rowCount: r ? 1 : 0 };
    }],
    [/^SELECT post, handle, state FROM responses WHERE post = ANY\(\$1\) ORDER BY post, handle$/i, (q, p) => {
      const rows = rsorted().filter((r) => p[0].includes(r.post)).map(({ post, handle, state }) => ({ post, handle, state }));
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT post, handle, kind, state, fields FROM responses WHERE post = ANY\(\$1\) AND kind = ANY\(\$2\) ORDER BY post, handle$/i, (q, p) => {
      const rows = rsorted().filter((r) => p[0].includes(r.post) && p[1].includes(r.kind)).map(({ post, handle, kind, state, fields }) => ({ post, handle, kind, state, fields: { ...fields } }));
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT \* FROM responses WHERE kind = \$1 ORDER BY post, handle$/i, (q, p) => {
      const rows = rsorted().filter((r) => r.kind === p[0]).map(rcopy);
      return { rows, rowCount: rows.length };
    }],
    // the stamp chain (066), read as a delta
    [/^SELECT to_regclass\('stamp_lines'\) IS NOT NULL AS ok$/i, () => ({ rows: [{ ok: ledger.lines !== null }], rowCount: 1 })],
    [/^SELECT seq, seal FROM stamp_lines ORDER BY seq DESC LIMIT 1$/i, () => {
      const n = ledger.lines.length;
      return n ? { rows: [{ seq: n, seal: sealOf(n) }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }],
    [/^SELECT seal FROM stamp_lines WHERE seq = \$1$/i, (q, p) => {
      const n = Number(p[0]);
      return n >= 1 && n <= ledger.lines.length ? { rows: [{ seal: sealOf(n) }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }],
    [/^SELECT seq, canonical FROM stamp_lines WHERE seq > \$1 AND seq <= \$2 AND canonical LIKE \$3 ORDER BY seq$/i, (q, p) => {
      ledger.deltas.push([Number(p[0]), Number(p[1])]);
      const rows = ledger.lines.map((canonical, i) => ({ seq: i + 1, canonical }))
        .filter((r) => r.seq > Number(p[0]) && r.seq <= Number(p[1]) && like(p[2]).test(r.canonical));
      return { rows, rowCount: rows.length };
    }],
  ];
  return { posts, responses, marks, ledger, also };
}

function setup() {
  resetChainMemo();
  const t = ideaTables();
  const pen = installActsPen({ households: HOUSES, marks: [{ id: 1, slug: "errant/a-tank-mark" }], also: t.also });
  return { ...t, pen };
}
test.afterEach(() => uninstallActsPen());

async function refusedWith(p, code, re) {
  await assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code} ${e.defect}`); if (re) assert.match(`${e.defect} ${e.hint}`, re); return true; });
}

const IDEA = { class: "idea", title: "A lantern on the quay", body: "The quay is dark after the evening ferry. A lantern would let late residents find the boat." };
const ID = "errant/a-lantern-on-the-quay";
const post = (fields = IDEA, key = ERRANT) => postAtTown(fields, key, { now: NOW, env: ON, roll: ROLL, titleOf: firstClauseOf });
const advance = (fields, key = WRIGHT) => advanceAtTown(fields, key, { now: NOW, env: ON, roll: ROLL });
const read = async (id = ID) => (await postsAtOffice({ class: "idea", post: id }, { now: NOW, env: ON })).post;

// ── 1 · off ─────────────────────────────────────────────────────────────────

test("1 · OFF: town_post sends an idea where it went before, and every idea-post act is refused by name, writing nothing", async () => {
  const { pen, posts } = setup();
  assert.equal(await townPostEvent({ class: "idea", slug: "lantern", body: "A lantern on the quay." }, ERRANT, { roll: ROLL, env: OFF }), null,
    "off, the town door answers null and the idea lane (a Think Tank mark) runs exactly as before");
  await refusedWith(postAtTown(IDEA, ERRANT, { now: NOW, env: OFF, roll: ROLL }), 422, /answers class "event", "quest" or "bug", not "idea"/);
  // a post that exists from a time the switch was on is refused, not hidden
  await post();
  const n = pen.rows().length;
  await refusedWith(advanceAtTown({ post: ID, to: "building" }, WRIGHT, { now: NOW, env: OFF, roll: ROLL }), 409, /ideas are not posts on this office yet/);
  await refusedWith(amendAtTown({ post: ID, title: "x" }, ERRANT, { now: NOW, env: OFF }), 409, /not posts on this office yet/);
  await refusedWith(signUpAtTown({ post: ID, piece: "the lantern" }, FINN, { now: NOW, env: OFF }), 409, /not posts/);
  await refusedWith(answerSignUpAtTown({ post: ID, resident: "finn", answer: "accepted" }, WRIGHT, { now: NOW, env: OFF, roll: ROLL }), 409, /not posts/);
  await refusedWith(awardAtTown({ post: ID, to: "finn", stamps: 5, label: "design" }, WRIGHT, { now: NOW, env: OFF, roll: ROLL, isMeep }), 409, /not posts/);
  assert.equal(pen.rows().length, n, "a refused act wrote nothing");
  assert.equal(posts.get(ID).state, "posted");
  // the read is not switched: it reports what the store holds
  assert.equal((await postsAtOffice({ class: "idea" }, { now: NOW, env: OFF })).total, 1);
});

// ── 2 · on: posting ─────────────────────────────────────────────────────────

test("2 · ON: an idea posts as a post, never a mark; the old card's slug and body still post; the mark road's fields are refused by name; a mark's id is refused", async () => {
  const { pen, posts } = setup();
  const r = await townPostEvent(IDEA, ERRANT, { roll: ROLL, env: ON });
  assert.equal(r.post.id, ID);
  assert.deepEqual([r.post.class, r.post.author, r.post.household, r.post.state], ["idea", "errant", "hh:the-harbor", "posted"]);
  assert.match(r.receipt, /posted: errant\/a-lantern-on-the-quay \(an idea\), by errant\. .* It is a post, not a mark/);
  const [act] = pen.rows();
  assert.deepEqual([act.class, act.action, act.actor, act.object], ["idea", "post", "errant", ID]);
  assert.equal(pen.claims?.length ?? 0, 0, "no world claim: an idea post never crosses the settlement");

  // the legacy card: slug and body, the title the claim's first clause
  const legacy = await townPostEvent({ class: "idea", slug: "ferry-bell", body: "Ring a bell: the ferry should announce itself" }, FINN, { roll: ROLL, env: ON });
  assert.deepEqual([legacy.post.id, legacy.post.title], ["finn/ferry-bell", "Ring a bell"]);

  for (const [f, v] of [["at", { x: 1, y: 2 }], ["on", "errant/a-tank-mark"], ["image", "x"], ["by", "finn"]]) {
    const b = await townPostEvent({ ...IDEA, [f]: v }, FINN, { roll: ROLL, env: ON });
    assert.equal(b.code, 422); assert.match(b.defect, new RegExp(`an idea post does not take: ${f}`));
  }
  const staked = await townPostEvent({ ...IDEA, stamps: 1 }, FINN, { roll: ROLL, env: ON });
  assert.deepEqual([staked.code, staked.field], [422, "stamps"]);
  const n = pen.rows().length;
  await refusedWith(post({ class: "idea", slug: "a-tank-mark", body: "Mine." }), 409, /taken/);
  await refusedWith(post({ class: "idea", body: ": nothing before the colon names it" }, ERRANT), 422, /an idea needs a title/);
  assert.equal(pen.rows().length, n);
  assert.equal(posts.size, 2);
});

// ── 3 · the hands move it, any order ────────────────────────────────────────

test("3 · the hands move an idea to any named stage, in any order, with credit, link and note; the read's history has a row for each", async () => {
  setup();
  await post();
  await advance({ post: ID, to: "building", credit: "finn", note: "Finn has the lamp." });
  await advance({ post: ID, to: "in-conversation", link: LINK }, KEEMIN);
  await advance({ post: ID, to: "ruled-in" }, ARCHITECT);
  const one = await read();
  assert.equal(one.state, "ruled-in");
  assert.deepEqual(one.history.map(({ at, ...h }) => h), [
    { stage: "posted", hand: null, credit: "errant", link: null, note: null },
    { stage: "building", hand: "wright", credit: "finn", link: null, note: "Finn has the lamp." },
    { stage: "in-conversation", hand: "keemin", credit: null, link: LINK, note: null },
    { stage: "ruled-in", hand: "architect", credit: null, link: null, note: null },
  ]);
  assert.deepEqual(one.fields.links, { "in-conversation": LINK });
  assert.equal(one.body, IDEA.body);
  assert.deepEqual(one.backing, { for: 0, against: 0, net: 0, stakers: 0 });
  // duplicate names what it repeats: an idea post or a Think Tank mark
  await post({ class: "idea", title: "Lights by the boat", body: "Same thing." }, FINN);
  await refusedWith(advance({ post: "finn/lights-by-the-boat", to: "duplicate", of: "nobody/nothing" }), 404, /no idea "nobody\/nothing"/);
  await advance({ post: "finn/lights-by-the-boat", to: "duplicate", of: "errant/a-tank-mark" });
  assert.equal((await read("finn/lights-by-the-boat")).fields.of, "errant/a-tank-mark");
});

// ── 4 · who ─────────────────────────────────────────────────────────────────

test("4 · a non-hand cannot move an idea, a finished idea moves no further, an idea is never closed, and only wright and keemin award", async () => {
  const { pen } = setup();
  await post();
  const n = pen.rows().length;
  await refusedWith(advance({ post: ID, to: "building" }, ERRANT), 403, /only the town's hands move an idea/);
  await refusedWith(advance({ post: ID, to: "built" }, FINN), 403, /only the town's hands/);
  await refusedWith(advance({ post: ID, to: "posted" }), 409, /already stands posted/);
  await refusedWith(advance({ post: ID, to: "approved" }), 422, /not a stage an idea stands in/);
  assert.equal(pen.rows().length, n);
  await advance({ post: ID, to: "shipped" });
  for (const to of ["building", "declined", "posted"])
    await refusedWith(advance({ post: ID, to }), 409, /is finished \(shipped\)/);
  await refusedWith(closeAtTown({ post: ID }, WRIGHT, { now: NOW, env: ON }), 422, /an idea is not closed/);
  await refusedWith(awardAtTown({ post: ID, to: "finn", stamps: 5, label: "design" }, ARCHITECT, { now: NOW, env: ON, roll: ROLL, isMeep }), 403, /only the town's hands award stamps/);
  assert.deepEqual([...IDEA_FINISHED], ["shipped", "declined", "duplicate"]);
});

// ── 5 · sign-ups ────────────────────────────────────────────────────────────

test("5 · a sign-up stands, a second replaces it, its resident withdraws it, and only a hand answers it", async () => {
  const { pen } = setup();
  await post();
  const s1 = await signUpAtTown({ post: ID, piece: "the lantern's post" }, FINN, { now: NOW, env: ON });
  assert.deepEqual(s1.sign_up, { piece: "the lantern's post", note: null, state: "standing" });
  const s2 = await signUpAtTown({ post: ID, piece: "the post and the glass", note: "I have glass." }, FINN, { now: NOW, env: ON });
  assert.match(s2.receipt, /this replaces your earlier sign-up/);
  await signUpAtTown({ post: ID, piece: "the wick" }, ADA, { now: NOW, env: ON });
  assert.deepEqual((await read()).sign_ups, [
    { handle: "ada", piece: "the wick", note: null, state: "standing" },
    { handle: "finn", piece: "the post and the glass", note: "I have glass.", state: "standing" },
  ]);
  await signUpAtTown({ post: ID, withdraw: true }, ADA, { now: NOW, env: ON });
  await refusedWith(signUpAtTown({ post: ID, withdraw: true }, ADA, { now: NOW, env: ON }), 409, /nothing to withdraw/);
  const n = pen.rows().length;
  await refusedWith(answerSignUpAtTown({ post: ID, resident: "finn", answer: "accepted" }, ERRANT, { now: NOW, env: ON, roll: ROLL }), 403, /only the town's hands answer a sign-up/);
  await refusedWith(answerSignUpAtTown({ post: ID, resident: "ada", answer: "accepted" }, WRIGHT, { now: NOW, env: ON, roll: ROLL }), 404, /no sign-up standing/);
  assert.equal(pen.rows().length, n);
  const a = await answerSignUpAtTown({ post: ID, resident: "finn", answer: "accepted", note: "Go." }, ARCHITECT, { now: NOW, env: ON, roll: ROLL });
  assert.equal(a.sign_up.state, "accepted");
  assert.deepEqual((await read()).sign_ups.map((s) => [s.handle, s.state]), [["ada", "withdrawn"], ["finn", "accepted"]]);
  await advance({ post: ID, to: "declined" });
  await refusedWith(signUpAtTown({ post: ID, piece: "late" }, ERRANT, { now: NOW, env: ON }), 409, /takes no sign-ups/);
});

// ── 6 · the award records; it moves nothing ─────────────────────────────────

test("6 · an award records an act and moves no stamps; its refusals; the read's stamps_paid comes from the chain's award line, null without one", async () => {
  const { pen, ledger } = setup();
  await post();
  const before = pen.rows().length;
  const r = await awardAtTown({ post: ID, to: "finn", stamps: 25, label: "the-lantern", note: "Built it." }, WRIGHT, { now: NOW, env: ON, roll: ROLL, isMeep });
  assert.deepEqual(r.award, { to: "finn", stamps: 25, label: "the-lantern", note: "Built it." });
  assert.match(r.receipt, /Owed, not yet paid: .*MINT → finn · 25 · for: post:errant\/a-lantern-on-the-quay\/the-lantern · by: wright\), and this act moves no stamps/);
  const written = pen.rows().slice(before);
  assert.deepEqual(written.map((a) => [a.class, a.action, a.actor]), [["idea", "award", "wright"]], "one act, and nothing else");
  assert.equal(ledger.lines.length, 0, "no line on the chain");
  assert.ok(!pen.asked().some((q) => /INSERT INTO stamp_lines/i.test(q)), "no stamp row");

  const n = pen.rows().length;
  await refusedWith(awardAtTown({ post: ID, to: "ferry", stamps: 5, label: "design" }, WRIGHT, { now: NOW, env: ON, roll: ROLL, isMeep }), 422, /a meep never receives stamps/);
  await refusedWith(awardAtTown({ post: ID, to: "finn", stamps: 5, label: "fixed" }, WRIGHT, { now: NOW, env: ON, roll: ROLL, isMeep }), 422, /is a bug's stage/);
  await refusedWith(awardAtTown({ post: ID, to: "finn", stamps: 5, label: "the-lantern" }, KEEMIN, { now: NOW, env: ON, roll: ROLL, isMeep }), 409, /already awarded/);
  await refusedWith(awardAtTown({ post: ID, to: "finn", stamps: 201, label: "more" }, WRIGHT, { now: NOW, env: ON, roll: ROLL, isMeep }), 422, /from 1 to 200/);
  await refusedWith(awardAtTown({ post: ID, to: "nobody", stamps: 5, label: "more" }, WRIGHT, { now: NOW, env: ON, roll: ROLL, isMeep }), 422, /not a resident here/);
  await refusedWith(awardAtTown({ post: ID, to: "finn", stamps: 5, label: "Not A Label" }, WRIGHT, { now: NOW, env: ON, roll: ROLL, isMeep }), 422, /label names what the award is for/);
  assert.equal(pen.rows().length, n, "a refused award wrote nothing");
  await awardAtTown({ post: ID, to: "errant", stamps: 5, label: "the-idea" }, KEEMIN, { now: NOW, env: ON, roll: ROLL, isMeep });

  // unpaid: stamps_paid null
  assert.deepEqual((await read()).awards.map(({ at, ...a }) => a), [
    { label: "the-lantern", to: "finn", stamps: 25, hand: "wright", note: "Built it.", stamps_paid: null },
    { label: "the-idea", to: "errant", stamps: 5, hand: "keemin", note: null, stamps_paid: null },
  ]);
  // the pass wrote one line; the read finds it, and only its own
  ledger.lines.push("- 2026-10-10 · MINT → finn · 25 · for: post:errant/a-lantern-on-the-quay/the-lantern · by: wright");
  ledger.lines.push("- 2026-10-10 · MINT → finn · 25 · for: post:errant/another/the-lantern · by: wright");
  const paid = (await read()).awards.map((a) => [a.label, a.stamps_paid]);
  assert.deepEqual(paid, [["the-lantern", 25], ["the-idea", null]]);
});

test("6 · the award line is read in the town's grammar: a stage line, another hand's line, and a stage-named label are not awards", () => {
  assert.deepEqual(awardPaidOf("- 2026-10-10 · MINT → finn · 25 · for: post:errant/lantern/the-lantern · by: wright"),
    { handle: "finn", n: 25, post: "errant/lantern", label: "the-lantern", by: "wright" });
  for (const not of [
    "- 2026-10-10 · MINT → finn · 10 · for: post:errant/lantern/fixed · by: wright",          // a bug's stage name
    "- 2026-10-10 · MINT → finn · 10 · for: post:errant/lantern/design · by: the-town",       // not a hand that awards
    "- 2026-10-10 · MINT → finn · 10 · for: post:errant/lantern/design · by: architect",      // a meep never awards
    "- 2026-10-10 · MINT → finn · 0 · for: post:errant/lantern/design · by: wright",
    "",
  ]) assert.equal(awardPaidOf(not), null, not);
  // postLineOf reads both kinds
  assert.deepEqual(postLineOf("- 2026-10-10 · MINT → finn · 10 · for: post:errant/bug/fixed · by: the-town"), { post: "errant/bug", part: "fixed", handle: "finn", n: 10 });
  assert.deepEqual(postLineOf("- 2026-10-10 · MINT → finn · 7 · for: post:errant/lantern/design · by: keemin"), { post: "errant/lantern", part: "design", handle: "finn", n: 7 });
});

// ── 7 · the Think Tank ──────────────────────────────────────────────────────

test("7 · the Think Tank's read adds nothing while the store holds no idea post, and the posts beside the marks once it does", async () => {
  setup();
  assert.deepEqual(await ideaPostsForTank({ env: ON }), {}, "no idea post: the tank answers exactly as before");
  await post();
  const t = await ideaPostsForTank({ env: ON });
  assert.deepEqual(t.posts.map((p) => [p.id, p.state, p.title]), [[ID, "posted", IDEA.title]]);
});

// ── 8 · the rebuild ─────────────────────────────────────────────────────────

test("8 · the rebuild folds the idea acts (post, amend, advance, sign-ups, answers, awards) into exactly the rows the pen wrote", async () => {
  const { pen } = setup();
  await post();
  await amendAtTown({ post: ID, body: "A lantern, and a hook to hang it on." }, ERRANT, { now: NOW, env: ON });
  await advance({ post: ID, to: "building", credit: "finn", link: LINK });
  await signUpAtTown({ post: ID, piece: "the hook" }, FINN, { now: NOW, env: ON });
  await signUpAtTown({ post: ID, piece: "the wick" }, ADA, { now: NOW, env: ON });
  await signUpAtTown({ post: ID, withdraw: true }, ADA, { now: NOW, env: ON });
  await answerSignUpAtTown({ post: ID, resident: "finn", answer: "accepted", note: "Yes." }, WRIGHT, { now: NOW, env: ON, roll: ROLL });
  await awardAtTown({ post: ID, to: "finn", stamps: 10, label: "the-hook" }, WRIGHT, { now: NOW, env: ON, roll: ROLL, isMeep });
  const out = await dryRun({ query: (sql, params) => pen.query(sql, params) });
  assert.equal(out.equal, true, out.drift.join("\n"));
  assert.deepEqual([out.counts.idea_acts, out.counts.ideas, out.counts.idea_responses], [8, 1, 2]);
});

// ── 9 · the chain, read as a delta ──────────────────────────────────────────

test("9 · the history's reader reads only the chain's rows past what it read, and from the top again on another chain", async () => {
  const { ledger } = setup();
  ledger.lines = [
    "- 2026-10-01 · MINT → wright · 5 · for: welcome:the-harbor · by: the-town",
    "- 2026-10-09 · MINT → ada · 2 · for: post:ada/the-door-sticks/confirmed · by: the-town",
  ];
  const client = { query: (sql, params) => ledger.handler(sql, params) };
  const t = ideaTables();   // a second set of handlers over the same ledger object, without the pen
  t.ledger.lines = ledger.lines; t.ledger.deltas = ledger.deltas;
  ledger.handler = (sql, params) => {
    const q = sql.replace(/\s+/g, " ").trim();
    for (const [re, fn] of t.also) if (re.test(q)) return fn(q, params);
    throw new Error(`unanswered: ${q}`);
  };
  const a = await postPaymentsVia(client);
  assert.deepEqual([...a.paid], [["ada/the-door-sticks/confirmed", 2]]);
  assert.deepEqual(ledger.deltas.at(-1), [0, 2], "the first read in a process is the one full pass");

  ledger.lines.push("- 2026-10-10 · MINT → finn · 25 · for: post:errant/lantern/the-lantern · by: wright");
  const b = await postPaymentsVia(client);
  assert.deepEqual(ledger.deltas.at(-1), [2, 3], "the second read asks only for the row past the last");
  assert.equal(b.paid.get("errant/lantern/the-lantern"), 25);
  assert.equal(b.paid.get("ada/the-door-sticks/confirmed"), 2, "what was read stays read");

  const calls = ledger.deltas.length;
  await postPaymentsVia(client);
  assert.equal(ledger.deltas.length, calls, "nothing new on the chain: no delta query at all");

  // another chain (a restored store, a test store): the row at the remembered seq carries another seal
  ledger.lines.splice(0, ledger.lines.length,
    "- 2026-10-02 · MINT → errant · 3 · for: post:errant/x/reproduced · by: the-town",
    "- 2026-10-02 · MINT → errant · 5 · for: post:errant/x/diagnosed · by: the-town",
    "- 2026-10-02 · MINT → errant · 10 · for: post:errant/x/fixed · by: the-town");
  const c = await postPaymentsVia(client);
  assert.deepEqual(ledger.deltas.at(-1), [0, 3], "another chain is read from the top");
  assert.deepEqual([...c.paid.keys()].sort(), ["errant/x/diagnosed", "errant/x/fixed", "errant/x/reproduced"], "nothing of the other chain is kept");

  // a shorter chain than the memo reached is another chain too
  ledger.lines.splice(1);
  const d = await postPaymentsVia(client);
  assert.deepEqual(ledger.deltas.at(-1), [0, 1]);
  assert.deepEqual([...d.paid.keys()], ["errant/x/reproduced"]);

  ledger.lines.length = 0;
  assert.equal((await postPaymentsVia(client)).paid, null, "no chain: paid is null and unavailable says why");
});

// ── 10 · every class carries history ───────────────────────────────────────

test("10 · an event's and a quest's history: the post and its close, with the hand", () => {
  const at = new Date(NOW).toISOString();
  const ev = plainHistoryOf("event", [
    { object: "wright/office-hours", action: "post", actor: "wright", at, payload: { state: "announced" } },
    { object: "wright/office-hours", action: "amend", actor: "wright", at, payload: { title: "x" } },
    { object: "wright/office-hours", action: "close", actor: "errant", at, payload: { state: "cancelled" } },
    { object: "keemin/old", action: "host", actor: "keemin", at, payload: {} },
  ]);
  assert.deepEqual(ev.get("wright/office-hours").map(({ at: _, ...h }) => h), [{ stage: "announced", hand: "wright" }, { stage: "cancelled", hand: "errant" }]);
  assert.deepEqual(ev.get("keemin/old").map(({ at: _, ...h }) => h), [{ stage: "announced", hand: "keemin" }], "the 026 host act is a post");
  const qu = plainHistoryOf("quest", [
    { object: "postmark-pen/clip", action: "post", actor: "postmark-pen", at, payload: { state: "open", hand: "keemin" } },
    { object: "postmark-pen/clip", action: "close", actor: "postmark-pen", at, payload: { state: "closed", hand: "wright" } },
  ]);
  assert.deepEqual(qu.get("postmark-pen/clip").map(({ at: _, ...h }) => h), [{ stage: "open", hand: "keemin" }, { stage: "closed", hand: "wright" }]);
});

// ── the flat tools answer the same acts ─────────────────────────────────────

test("the flat tools: town_sign_up, town_answer_sign_up and town_award answer through the same pen, refusals as bounces", async () => {
  setup();
  const prev = process.env.IDEA_POSTS;
  process.env.IDEA_POSTS = "1";
  try {
    await post();
    const s = await callTownPostTool("town_sign_up", { post: ID, piece: "the lantern" }, FINN, { roll: ROLL });
    assert.equal(s.sign_up.state, "standing");
    const b = await callTownPostTool("town_answer_sign_up", { post: ID, resident: "finn", answer: "accepted" }, ERRANT, { roll: ROLL });
    assert.deepEqual([b.error, b.code], ["bounce", 403]);
  } finally { if (prev === undefined) delete process.env.IDEA_POSTS; else process.env.IDEA_POSTS = prev; }
});
