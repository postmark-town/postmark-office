// bug-post.test.mjs — the bug class on the post machine (Posts phase 2, first slice).
//
//   node --test test/bug-post.test.mjs
//
// The gate, in its order (the brief, 2026-09-29):
//
//   1. a resident posts a bug as themselves; a non-hand's advance is refused by
//      name and writes nothing; a hand's advance to confirmed records the stage
//      with the reporter credited;
//   2. a stake on a bug is refused by name — at post, and at the stake door;
//   3. the town's hands post on a resident's behalf (`for`): the reporter is
//      credited and the act names the hand; nobody else may;
//   4. the reporter amends until confirmed, the hands after; only what changed
//      is recorded;
//   5. the advance's law: forward only, a skip pays nothing, credit from
//      reproduced on, a size at fixed, a grade at briefed, a duplicate names a
//      standing bug, side exits only early, a finished bug moves no further,
//      and a bug is never closed;
//   6. the posts read answers class "bug" with its finished states, and the
//      rebuild folds the bug acts back into exactly the rows the pen wrote;
//   7. (Wright's review of #257) `for` and `credit` must name a resident in
//      the office's residents index, refused by name and writing nothing; an
//      office that cannot read its index refuses rather than guessing;
//   8. (POS-298, the critter) an advance to fixed carries the critter its fixer
//      named, refused by name without it and on any other stage; the post
//      keeps it with named_by = the fix's credit, as plain text, and the
//      rebuild folds it;
//  10. (Darko, 2026-10-07) any advance may carry link, the work that earned
//      the stage on the town's own repos; the post keeps one per stage in
//      fields.links, refused by name off the town's repos, and the rebuild
//      folds it.
//  11. (POS-547, Darko 2026-10-09) the bug read carries `history`: one row per
//      stage act, { stage, at, hand, credit, link, stamps_paid }, with
//      stamps_paid joined from the store's stamp_lines, null where no line
//      stands; a store with no chain says so rather than calling every stage
//      unpaid.
//  12. (POS-558, Darko 2026-10-10) the bug read pages in the office's grammar
//      (limit, offset; total, shown, complete, next_offset), and every page
//      carries `catchers`, the Hall of Fame's totals over the whole record.
//      The bug read's order is the jar's (Wright's review of #481): open by
//      the furthest stage, the named, the legacy shelf, the set aside.
//
// ⚑ THE STORE IS A JS STUB (`acts-pen-stub.mjs`), as in quest-posts.test.mjs:
// this proves which acts and rows the pen writes and what the reads make of
// them, nothing about Postgres.
//
// THE FLIPS (NOTES.md in the lane folder holds the red lines): make
// judgeBugHand accept any handle and 1 goes red; drop the residents-index
// check from judgeHandleField and 7 goes red; the critter's four flips are in
// the bug-critter lane's NOTES.md.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { installActsPen, uninstallActsPen, RECORD_ON } from "./acts-pen-stub.mjs";

Object.assign(process.env, RECORD_ON);
const { postAtTown, amendAtTown, advanceAtTown, closeAtTown } = await import("../src/events-store.mjs");
const { postsAtOffice } = await import("../src/town-posts.mjs");
const { townPostEvent } = await import("../src/town-post.mjs");
const { townStake } = await import("../src/town-stake.mjs");
const { compareRebuild, dryRun } = await import("../world2/tools/events-rebuild.mjs");
const { BUG_FINISHED } = await import("../src/bugs.mjs");
const { foldPostActs } = await import("../src/events.mjs");

// The real clock: the pen refuses a row stamped for a window older than the open one.
const NOW = Date.now();

const WRIGHT = { household: "starforge", handles: new Set(["wright"]) };
const ERRANT = { household: "errant", handles: new Set(["errant"]) };
const FINN = { household: "finn", handles: new Set(["finn"]) };

const HOUSES = [{ slug: "the-harbor", ord: 1, residents: ["errant", "ada"] }];
// The office's residents index (the door reads it from office.db; see mcp.mjs § rollOf).
const ROLL = new Set(["wright", "keemin", "errant", "ada", "finn"]);

// ── the posts table, in memory, answering exactly the queries asked ─────────
function bugTables() {
  const posts = new Map();
  // the store's stamp_lines (066): canonical lines in ledger order, or null for
  // a store that has no such table yet
  const ledger = { lines: [], deltas: [] };
  const sealOf = (n) => createHash("sha256").update(ledger.lines.slice(0, n).join("\n")).digest("hex");
  const like = (pat) => new RegExp(`^${pat.split("%").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "s");
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
    [/^SELECT id, state, ends FROM posts WHERE id LIKE \$1$/i, (q, p) => {
      const pre = p[0].replace(/%$/, "");
      const rows = [...posts.values()].filter((r) => r.id.startsWith(pre)).map((r) => ({ id: r.id, state: r.state, ends: r.ends }));
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT id, class, title, author, household, starts, ends, fields, state, last_act FROM posts WHERE class = \$1 ORDER BY id$/i, (q, p) => {
      const rows = byClass(p[0]);
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT post, handle, state FROM responses WHERE post = ANY\(\$1\) ORDER BY post, handle$/i, () => ({ rows: [], rowCount: 0 })],
    [/^SELECT \* FROM posts WHERE class = \$1 ORDER BY id$/i, (q, p) => { const rows = byClass(p[0]); return { rows, rowCount: rows.length }; }],
    [/^SELECT \* FROM responses WHERE kind = \$1 ORDER BY post, handle$/i, () => ({ rows: [], rowCount: 0 })],
    [/^SELECT to_regclass\('stamp_lines'\) IS NOT NULL AS ok$/i, () => ({ rows: [{ ok: ledger.lines !== null }], rowCount: 1 })],
    // The chain is read as a delta since POS-290 (post-history.mjs): its head,
    // the seal at the seq a process reached, and the post lines past it. Each
    // row's seq is its place in the list and its seal a digest of what it holds,
    // so a test that swaps the chain out is, as on a restored store, another chain.
    [/^SELECT seq, seal FROM stamp_lines ORDER BY seq DESC LIMIT 1$/i, () => {
      if (ledger.lines === null) throw new Error('relation "stamp_lines" does not exist');
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
  return { posts, also, ledger };
}

function setup() {
  const t = bugTables();
  const pen = installActsPen({ households: HOUSES, also: t.also });
  return { ...t, pen };
}
test.afterEach(() => uninstallActsPen());

async function refusedWith(p, code, re) {
  await assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code} ${e.defect}`); if (re) assert.match(`${e.defect} ${e.hint}`, re); return true; });
}

const BUG = { class: "bug", title: "The door sticks", body: "The front door of the post office does not open on the second try." };
const ID = "errant/the-door-sticks";

// ── 1 ───────────────────────────────────────────────────────────────────────

test("1 · a resident posts a bug as themselves; a non-hand's advance is refused by name and writes nothing; a hand's advance to confirmed credits the reporter", async () => {
  const { pen, posts } = setup();
  const r = await postAtTown({ ...BUG, steps: "Open it, close it, open it again.", record: "act 4171" }, ERRANT, { now: NOW, roll: ROLL });
  assert.equal(r.post.id, ID);
  assert.deepEqual([r.post.class, r.post.author, r.post.household, r.post.state], ["bug", "errant", "hh:the-harbor", "reported"]);
  assert.deepEqual(r.post.fields, { steps: "Open it, close it, open it again.", record: "act 4171" });
  assert.match(r.receipt, /posted: errant\/the-door-sticks \(a bug\), reported by errant\./);
  assert.match(r.receipt, /A bug takes no stake/);
  const [posted] = pen.rows();
  assert.deepEqual([posted.class, posted.action, posted.actor, posted.object], ["bug", "post", "errant", ID]);

  const before = pen.rows().length;
  await refusedWith(advanceAtTown({ post: ID, to: "confirmed" }, FINN, { now: NOW, roll: ROLL }), 403, /only the town's hands advance a bug/);
  await refusedWith(advanceAtTown({ post: ID, to: "confirmed" }, ERRANT, { now: NOW, roll: ROLL }), 403, /only the town's hands advance a bug/);
  assert.equal(pen.rows().length, before, "a refused advance wrote an act");
  assert.equal(posts.get(ID).state, "reported");

  const a = await advanceAtTown({ post: ID, to: "confirmed" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.deepEqual([a.stage, a.credit, a.hand, a.stamps], ["confirmed", "errant", "wright", 2]);
  assert.match(a.receipt, /advanced: errant\/the-door-sticks reported → confirmed by wright's hand; the ladder owes errant 2 stamps for confirmed, paid by the reviewed stage pass \(not by this act\)/);
  const adv = pen.rows().at(-1);
  assert.deepEqual([adv.class, adv.action, adv.actor, adv.object], ["bug", "advance", "wright", ID]);
  assert.deepEqual(JSON.parse(adv.payload), { post: ID, from: "reported", to: "confirmed", credit: "errant", hand: "wright" });
  assert.equal(posts.get(ID).state, "confirmed");
  assert.equal(posts.get(ID).author, "errant", "the advance moved the stage, not the authorship");
});

// ── 2 ───────────────────────────────────────────────────────────────────────

test("2 · a stake on a bug is refused by name — at post, at the stake door, and on the other acts", async () => {
  const { pen } = setup();
  const atPost = await townPostEvent({ ...BUG, stamps: 3 }, ERRANT);
  assert.equal(atPost.error, "bounce");
  assert.equal(atPost.code, 422);
  assert.match(atPost.defect, /a bug takes no stake/);
  assert.match(atPost.hint, /it feels odd to wait for stakers for a clearly broken thing/);
  assert.equal(pen.rows().length, 0, "a refused post wrote an act");

  await postAtTown(BUG, ERRANT, { now: NOW, roll: ROLL });
  // The stake door: a bug is not a mark, and the refusal says it is a bug, by name.
  const staked = await townStake({ mark: ID, stamps: 2 }, FINN);
  assert.equal(staked.error, "bounce");
  assert.equal(staked.code, 422);
  assert.match(staked.defect, /"errant\/the-door-sticks" is a bug, and a bug takes no stake/);
  assert.equal(staked.class, "bug");
  // …and a mark the town does not hold that is NOT a bug still gets the lane guard's own answer
  const stray = await townStake({ mark: "errant/no-such-thing", stamps: 2 }, FINN);
  assert.notEqual(stray.class, "bug");
  await refusedWith(amendAtTown({ post: ID, stamps: 1 }, ERRANT, { now: NOW, roll: ROLL }), 422, /takes no stake/);
  await refusedWith(advanceAtTown({ post: ID, to: "confirmed", stamps: 1 }, WRIGHT, { now: NOW, roll: ROLL }), 422, /takes no stake/);
  assert.equal(pen.rows().length, 1);
});

// ── 3 ───────────────────────────────────────────────────────────────────────

test("3 · a hand posts on a resident's behalf: the reporter is the author and is credited, the act names the hand; a non-hand's `for` is refused", async () => {
  const { pen } = setup();
  const r = await postAtTown({ ...BUG, for: "ada" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(r.post.id, "ada/the-door-sticks");
  assert.deepEqual([r.post.author, r.post.household, r.hand], ["ada", "hh:the-harbor", "wright"]);
  assert.match(r.receipt, /reported by ada, put up by wright's hand/);
  const act = pen.rows().at(-1);
  assert.equal(act.actor, "ada");
  assert.equal(JSON.parse(act.payload).hand, "wright");
  const a = await advanceAtTown({ post: "ada/the-door-sticks", to: "confirmed" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(a.credit, "ada", "confirmed credits the reporter, not the hand that put it up");

  await refusedWith(postAtTown({ ...BUG, for: "ada" }, ERRANT, { now: NOW, roll: ROLL }), 403, /only the town's hands post a bug on a resident's behalf/);
  await refusedWith(postAtTown({ ...BUG, for: "Not A Handle" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /for names a resident by handle/);
  // a second bug with the same title takes the next id; ids are never reused
  const again = await postAtTown({ ...BUG, for: "ada" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(again.post.id, "ada/the-door-sticks-2");
});

// ── 4 ───────────────────────────────────────────────────────────────────────

test("4 · the reporter amends until confirmed and the hands after; only the changed fields are recorded", async () => {
  const { pen, posts } = setup();
  await postAtTown(BUG, ERRANT, { now: NOW, roll: ROLL });
  const am = await amendAtTown({ post: ID, steps: "Open, close, open.", title: BUG.title }, ERRANT, { now: NOW, roll: ROLL });
  assert.deepEqual(am.amended, ["steps"], "the unchanged title is not recorded");
  assert.deepEqual(JSON.parse(pen.rows().at(-1).payload), { post: ID, changed: ["steps"], fields: { steps: "Open, close, open." } });
  await refusedWith(amendAtTown({ post: ID, title: "mine now" }, FINN, { now: NOW, roll: ROLL }), 403, /not yours to amend/);
  // issue is amendable (Wright's ruling on #257): the reporter links a discussion opened after the post
  const linked = await amendAtTown({ post: ID, issue: "https://github.com/postmark-town/postmark/issues/1" }, ERRANT, { now: NOW, roll: ROLL });
  assert.deepEqual(linked.amended, ["issue"]);
  assert.deepEqual(JSON.parse(pen.rows().at(-1).payload).fields, { issue: "https://github.com/postmark-town/postmark/issues/1" });
  await refusedWith(amendAtTown({ post: ID, issue: "https://example.com/x" }, ERRANT, { now: NOW, roll: ROLL }), 422, /GitHub issue on the town's own repos/);
  await refusedWith(amendAtTown({ post: ID, body: "x".repeat(601) }, ERRANT, { now: NOW, roll: ROLL }), 422, /at most 600 characters/);
  await refusedWith(amendAtTown({ post: ID, steps: "Open, close, open." }, ERRANT, { now: NOW, roll: ROLL }), 422, /nothing to amend/);

  await advanceAtTown({ post: ID, to: "confirmed" }, WRIGHT, { now: NOW, roll: ROLL });
  await refusedWith(amendAtTown({ post: ID, title: "The door sticks, twice" }, ERRANT, { now: NOW, roll: ROLL }), 409, /only the town's hands amend it now/);
  const byHand = await amendAtTown({ post: ID, record: "https://postmark.town/api/release" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.deepEqual(byHand.amended, ["record"]);
  assert.equal(JSON.parse(pen.rows().at(-1).payload).hand, "wright");
  assert.equal(posts.get(ID).fields.record, "https://postmark.town/api/release");
  assert.equal(posts.get(ID).fields.steps, "Open, close, open.", "an amend of one field left the other standing");
  // POS-389: a housemate's OWN key naming the hand is not the hand
  const ownKey = { household: "starforge", handles: new Set(["wright", "mari"]), keyKind: "claim", heldBy: "resident", claimedHandle: "mari" };
  await refusedWith(amendAtTown({ post: ID, handle: "wright", record: "https://postmark.town/api/other" }, ownKey, { now: NOW, roll: ROLL }), 403, /not yours to amend/);
  await refusedWith(advanceAtTown({ post: ID, handle: "wright", to: "not-a-bug" }, ownKey, { now: NOW, roll: ROLL }), 403, /not this key's own hand/);
});

// ── 5 ───────────────────────────────────────────────────────────────────────

test("5 · the advance's law: forward only, a skip pays nothing, credit from reproduced on, size at fixed, grade at briefed", async () => {
  const { pen, posts } = setup();
  await postAtTown(BUG, ERRANT, { now: NOW, roll: ROLL });
  await refusedWith(advanceAtTown({ post: ID, to: "reproduced" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /reproduced names whom it credits/);
  await refusedWith(advanceAtTown({ post: ID, to: "fixed", credit: "finn" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /fixed needs a size/);
  await refusedWith(advanceAtTown({ post: ID, to: "briefed", credit: "finn", size: "M" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /size is fixed's/);
  await refusedWith(advanceAtTown({ post: ID, to: "briefed", credit: "finn" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /briefed needs a grade/);
  await refusedWith(advanceAtTown({ post: ID, to: "shipped", credit: "finn" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /shipped pays nothing and credits no one/);
  await refusedWith(advanceAtTown({ post: ID, to: "reported" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /not a stage a bug advances to/);
  await refusedWith(advanceAtTown({ post: ID, to: "wontfix" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /not a stage a bug advances to/);

  // a jump: reported → diagnosed pays diagnosed only, and says what it skipped
  const jump = await advanceAtTown({ post: ID, to: "diagnosed", credit: "finn" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(jump.stamps, 5);
  assert.match(jump.receipt, /skipped confirmed, reproduced, and a skipped stage pays nothing/);
  await refusedWith(advanceAtTown({ post: ID, to: "reproduced", credit: "finn" }, WRIGHT, { now: NOW, roll: ROLL }), 409, /already stands diagnosed/);
  await refusedWith(advanceAtTown({ post: ID, to: "not-a-bug" }, WRIGHT, { now: NOW, roll: ROLL }), 409, /leaves as not-a-bug only from reported or confirmed/);

  const brief = await advanceAtTown({ post: ID, to: "briefed", credit: "finn", grade: "heavy" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(brief.stamps, 5, "a heavy revision pays 5");
  const fix = await advanceAtTown({ post: ID, to: "fixed", credit: "finn", size: "M", critter: "Hinge Nibbler" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(fix.stamps, 25);
  assert.deepEqual(posts.get(ID).fields, { grade: "heavy", size: "M", critter: "Hinge Nibbler", named_by: "finn" });
  const ship = await advanceAtTown({ post: ID, to: "shipped" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(ship.stamps, 0);
  assert.match(ship.receipt, /shipped pays nothing/);
  await refusedWith(advanceAtTown({ post: ID, to: "shipped" }, WRIGHT, { now: NOW, roll: ROLL }), 409, /is finished \(shipped\)/);
  await refusedWith(amendAtTown({ post: ID, title: "x" }, WRIGHT, { now: NOW, roll: ROLL }), 409, /is finished/);
  // …but a hand may still link its issue, at any stage
  const late = await amendAtTown({ post: ID, issue: "https://github.com/postmark-town/postmark-office/issues/256" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.deepEqual(late.amended, ["issue"]);
  assert.equal(posts.get(ID).fields.issue, "https://github.com/postmark-town/postmark-office/issues/256");
  await refusedWith(closeAtTown({ post: ID }, WRIGHT, { now: NOW, roll: ROLL }), 422, /a bug is not closed/);
  assert.equal(pen.rows().filter((r) => r.action === "advance").length, 4);
  // the reporter may not link it after confirmed
  await refusedWith(amendAtTown({ post: ID, issue: "https://github.com/postmark-town/postmark/issues/2" }, ERRANT, { now: NOW, roll: ROLL }), 409, /is finished/);
});

test("5 · a duplicate names a standing bug that is not itself; not-a-bug leaves from confirmed", async () => {
  const { posts } = setup();
  await postAtTown(BUG, ERRANT, { now: NOW, roll: ROLL });
  await postAtTown({ ...BUG, title: "The door sticks again" }, FINN, { now: NOW, roll: ROLL });
  const dup = "finn/the-door-sticks-again";
  await refusedWith(advanceAtTown({ post: dup, to: "duplicate" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /names the bug it duplicates/);
  await refusedWith(advanceAtTown({ post: dup, to: "duplicate", of: dup }, WRIGHT, { now: NOW, roll: ROLL }), 422, /not a duplicate of itself/);
  await refusedWith(advanceAtTown({ post: dup, to: "duplicate", of: "finn/nothing" }, WRIGHT, { now: NOW, roll: ROLL }), 404, /no bug "finn\/nothing"/);
  await refusedWith(advanceAtTown({ post: dup, to: "confirmed", of: ID }, WRIGHT, { now: NOW, roll: ROLL }), 422, /of is duplicate's/);
  const d = await advanceAtTown({ post: dup, to: "duplicate", of: ID }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(d.stamps, 0);
  assert.deepEqual([posts.get(dup).state, posts.get(dup).fields.of], ["duplicate", ID]);
  await advanceAtTown({ post: ID, to: "confirmed" }, WRIGHT, { now: NOW, roll: ROLL });
  await advanceAtTown({ post: ID, to: "not-a-bug" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(posts.get(ID).state, "not-a-bug");
});

test("5 · a bug's text is judged: title and body required, body ≤ 600, issue on the town's own repos", async () => {
  setup();
  await refusedWith(postAtTown({ class: "bug", body: "x" }, ERRANT, { now: NOW, roll: ROLL }), 422, /a bug needs a title/);
  await refusedWith(postAtTown({ class: "bug", title: "x" }, ERRANT, { now: NOW, roll: ROLL }), 422, /a bug needs a body/);
  await refusedWith(postAtTown({ ...BUG, body: "y".repeat(601) }, ERRANT, { now: NOW, roll: ROLL }), 422, /a bug's body is at most 600 characters/);
  await refusedWith(postAtTown({ ...BUG, issue: "https://github.com/someone-else/postmark/issues/1" }, ERRANT, { now: NOW, roll: ROLL }), 422, /GitHub issue on the town's own repos/);
  const ok = await postAtTown({ ...BUG, issue: "https://github.com/postmark-town/postmark-office/issues/256" }, ERRANT, { now: NOW, roll: ROLL });
  assert.equal(ok.post.fields.issue, "https://github.com/postmark-town/postmark-office/issues/256");
  // a stray field of another lane is refused by name at the door
  const stray = await townPostEvent({ ...BUG, starts: "2026-10-01T00:00:00Z" }, ERRANT);
  assert.match(stray.defect, /a bug does not take: starts/);
});

// ── 6 ───────────────────────────────────────────────────────────────────────

test("6 · the posts read answers class bug with its finished states; the rebuild folds the bug acts into exactly the rows the pen wrote", async () => {
  const { pen } = setup();
  await postAtTown(BUG, ERRANT, { now: NOW, roll: ROLL });
  await postAtTown({ ...BUG, for: "ada" }, WRIGHT, { now: NOW, roll: ROLL });
  await advanceAtTown({ post: ID, to: "confirmed" }, WRIGHT, { now: NOW, roll: ROLL });
  await amendAtTown({ post: ID, steps: "Twice." }, WRIGHT, { now: NOW, roll: ROLL });
  await advanceAtTown({ post: ID, to: "fixed", credit: "finn", size: "S", critter: "Stickle" }, WRIGHT, { now: NOW, roll: ROLL });

  const r = await postsAtOffice({ class: "bug" }, { now: NOW, roll: ROLL });
  assert.deepEqual(r.finished, [...BUG_FINISHED]);
  assert.deepEqual(r.finished, ["shipped", "duplicate", "not-a-bug"]);
  assert.equal(r.total, 2);
  const one = r.posts.find((p) => p.id === ID);
  assert.deepEqual([one.class, one.state, one.author, one.latest.act], ["bug", "fixed", "errant", "advance"]);
  assert.deepEqual(one.fields, { steps: "Twice.", size: "S", critter: "Stickle", named_by: "finn" });
  const single = await postsAtOffice({ class: "bug", post: "ada/the-door-sticks" }, { now: NOW, roll: ROLL });
  assert.equal(single.post.state, "reported");

  const out = await dryRun(pen);
  assert.equal(out.equal, true, out.drift.join("\n"));
  assert.deepEqual([out.counts.bug_acts, out.counts.bugs], [5, 2]);
  // and the equality can fail: a row the acts do not derive is drift
  const acts = pen.rows().filter((a) => a.class === "bug").map((a) => ({ ...a, payload: JSON.parse(a.payload) }));
  const drifted = compareRebuild({ posts: [{ id: "errant/ghost", class: "bug", title: "", body: "", author: "errant", state: "reported", fields: {}, revised: 0, posted_act: 1, last_act: 1 }], responses: [] }, acts);
  assert.equal(drifted.equal, false);
});

// ── 7 ───────────────────────────────────────────────────────────────────────

test("7 · for and credit name a resident in the office's residents index, or are refused by name and write nothing; no index, no guess", async () => {
  const { pen, posts } = setup();
  await postAtTown(BUG, ERRANT, { now: NOW, roll: ROLL });
  const before = pen.rows().length;
  await refusedWith(postAtTown({ ...BUG, for: "tpyo" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /"tpyo" is not a resident here/);
  await advanceAtTown({ post: ID, to: "confirmed" }, WRIGHT, { now: NOW, roll: ROLL });
  await refusedWith(advanceAtTown({ post: ID, to: "reproduced", credit: "tpyo" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /"tpyo" is not a resident here/);
  assert.equal(pen.rows().length, before + 1, "a refused for or credit wrote an act");
  assert.equal(posts.get(ID).state, "confirmed");
  // an office that cannot read its residents index refuses; it never records an unchecked handle
  await refusedWith(advanceAtTown({ post: ID, to: "reproduced", credit: "finn" }, WRIGHT, { now: NOW, roll: null }), 503, /cannot read its residents index/);
  await refusedWith(postAtTown({ ...BUG, for: "ada" }, WRIGHT, { now: NOW }), 503, /cannot read its residents index/);
  // confirmed's default credit is the reporter, who posted it, so it needs no index
  const ok = await advanceAtTown({ post: ID, to: "reproduced", credit: "finn" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(ok.credit, "finn");
});

// ── 8 ───────────────────────────────────────────────────────────────────────

/** Walk the door-sticks bug up to briefed, crediting finn; returns nothing. */
async function toBriefed() {
  await postAtTown(BUG, ERRANT, { now: NOW, roll: ROLL });
  await advanceAtTown({ post: ID, to: "diagnosed", credit: "finn" }, WRIGHT, { now: NOW, roll: ROLL });
  await advanceAtTown({ post: ID, to: "briefed", credit: "finn", grade: "light" }, WRIGHT, { now: NOW, roll: ROLL });
}

test("8 · an advance to fixed without a critter is refused by name, says who names it and how, and writes nothing", async () => {
  const { pen, posts } = setup();
  await toBriefed();
  const before = pen.rows().length;
  await refusedWith(advanceAtTown({ post: ID, to: "fixed", credit: "finn", size: "M" }, WRIGHT, { now: NOW, roll: ROLL }), 422,
    /fixed needs a critter: the resident who fixes a bug names it .*critter: "<name>", 1–40 characters on one line — the fixer chooses it and tells the town's hands \(wright, keemin, bugcatcher\) in the PR or the issue/);
  for (const bad of ["", "   ", 7, "Hinge\nNibbler", "x".repeat(41)])
    await refusedWith(advanceAtTown({ post: ID, to: "fixed", credit: "finn", size: "M", critter: bad }, WRIGHT, { now: NOW, roll: ROLL }), 422, /critter is/);
  assert.equal(pen.rows().length, before, "a refused fixed wrote an act");
  assert.equal(posts.get(ID).state, "briefed");
  // 40 characters is a name; the count is characters, not UTF-16 units
  const ok = await advanceAtTown({ post: ID, to: "fixed", credit: "finn", size: "M", critter: "🐛".repeat(40) }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(ok.critter, "🐛".repeat(40));
});

test("8 · critter on any stage but fixed is refused by name", async () => {
  const { pen, posts } = setup();
  await postAtTown(BUG, ERRANT, { now: NOW, roll: ROLL });
  await postAtTown({ ...BUG, title: "The door sticks again" }, FINN, { now: NOW, roll: ROLL });
  const before = pen.rows().length;
  const WHY = /critter is fixed's: the resident who fixes a bug names it .*only an advance to fixed takes critter/;
  await refusedWith(advanceAtTown({ post: ID, to: "confirmed", critter: "Nib" }, WRIGHT, { now: NOW, roll: ROLL }), 422, WHY);
  for (const [to, more] of [["reproduced", {}], ["diagnosed", {}], ["briefed", { grade: "light" }]])
    await refusedWith(advanceAtTown({ post: ID, to, credit: "finn", critter: "Nib", ...more }, WRIGHT, { now: NOW, roll: ROLL }), 422, WHY);
  await refusedWith(advanceAtTown({ post: ID, to: "not-a-bug", critter: "Nib" }, WRIGHT, { now: NOW, roll: ROLL }), 422, WHY);
  await refusedWith(advanceAtTown({ post: "finn/the-door-sticks-again", to: "duplicate", of: ID, critter: "Nib" }, WRIGHT, { now: NOW, roll: ROLL }), 422, WHY);
  assert.equal(pen.rows().length, before);
  await advanceAtTown({ post: ID, to: "diagnosed", credit: "finn" }, WRIGHT, { now: NOW, roll: ROLL });
  await advanceAtTown({ post: ID, to: "fixed", credit: "finn", size: "S", critter: "Nib" }, WRIGHT, { now: NOW, roll: ROLL });
  await refusedWith(advanceAtTown({ post: ID, to: "shipped", critter: "Nib" }, WRIGHT, { now: NOW, roll: ROLL }), 422, WHY);
  assert.equal(posts.get(ID).state, "fixed");
});

test("8 · a fixed bug's posts read carries critter and named_by (the fixer's credit), and the rebuild folds them", async () => {
  const { pen, posts } = setup();
  await toBriefed();
  const fix = await advanceAtTown({ post: ID, to: "fixed", credit: "ada", size: "L", critter: "  Hinge Nibbler  " }, WRIGHT, { now: NOW, roll: ROLL });
  assert.deepEqual([fix.critter, fix.credit, fix.stamps], ["Hinge Nibbler", "ada", 50]);
  assert.match(fix.receipt, /; its critter is "Hinge Nibbler", named by ada$/);
  assert.deepEqual(JSON.parse(pen.rows().at(-1).payload),
    { post: ID, from: "briefed", to: "fixed", credit: "ada", fields: { size: "L", critter: "Hinge Nibbler", named_by: "ada" }, hand: "wright" });
  assert.deepEqual([posts.get(ID).fields.critter, posts.get(ID).fields.named_by], ["Hinge Nibbler", "ada"]);

  const one = (await postsAtOffice({ class: "bug", post: ID }, { now: NOW, roll: ROLL })).post;
  assert.deepEqual([one.state, one.fields.critter, one.fields.named_by], ["fixed", "Hinge Nibbler", "ada"]);
  const all = (await postsAtOffice({ class: "bug" }, { now: NOW, roll: ROLL })).posts.find((p) => p.id === ID);
  assert.deepEqual([all.fields.critter, all.fields.named_by], ["Hinge Nibbler", "ada"]);
  // shipping it keeps the name
  await advanceAtTown({ post: ID, to: "shipped" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.deepEqual([posts.get(ID).fields.critter, posts.get(ID).fields.named_by], ["Hinge Nibbler", "ada"]);

  // the rebuild: the acts alone derive the name and its namer, and the table agrees
  const acts = pen.rows().filter((a) => a.class === "bug").map((a) => ({ ...a, payload: JSON.parse(a.payload) }));
  const rebuilt = foldPostActs(acts).posts.get(ID);
  assert.deepEqual([rebuilt.fields.critter, rebuilt.fields.named_by], ["Hinge Nibbler", "ada"]);
  const out = await dryRun(pen);
  assert.equal(out.equal, true, out.drift.join("\n"));
  // …and a stored row that lost the name is drift
  const lost = { ...posts.get(ID), fields: { ...posts.get(ID).fields } };
  delete lost.fields.critter;
  const drifted = compareRebuild({ posts: [lost], responses: [] }, acts);
  assert.equal(drifted.equal, false);
  assert.match(drifted.drift.join("\n"), /fields: stored .* the acts derive .*"critter":"Hinge Nibbler"/);
});

test("8 · a name with markup is stored and returned as plain text, exactly as sent", async () => {
  const { pen, posts } = setup();
  await toBriefed();
  const NAME = `<b>Bitey</b> & <img src=x onerror="1">`;
  assert.ok([...NAME].length <= 40);
  const fix = await advanceAtTown({ post: ID, to: "fixed", credit: "finn", size: "M", critter: NAME }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(fix.critter, NAME);
  assert.equal(JSON.parse(pen.rows().at(-1).payload).fields.critter, NAME, "the act keeps the characters, not an escaped or stripped copy");
  assert.equal(posts.get(ID).fields.critter, NAME);
  const one = (await postsAtOffice({ class: "bug", post: ID }, { now: NOW, roll: ROLL })).post;
  assert.equal(one.fields.critter, NAME);
  assert.equal(typeof one.fields.critter, "string");
});

// ── 9 · the reveal at ship (POS-236) ───────────────────────────────────────

const { revealAtTown } = await import("../src/events-store.mjs");
const PAINTED = ["https://media.postmark.town/media/iris/hinge-nibbler-1.png",
  "https://media.postmark.town/media/iris/hinge-nibbler-2.png",
  "https://media.postmark.town/media/iris/hinge-nibbler-3.png"];
const ADA = { household: "the-harbor", handles: new Set(["ada"]) };

async function toShipped() {
  await toBriefed();
  await advanceAtTown({ post: ID, to: "fixed", credit: "ada", size: "M", critter: "Hinge Nibbler" }, WRIGHT, { now: NOW, roll: ROLL });
  await advanceAtTown({ post: ID, to: "shipped" }, WRIGHT, { now: NOW, roll: ROLL });
}

test("9 · the reveal: a hand sets Iris's three candidates, the fixer picks one, the jar reads the picked image, and the rebuild folds it", async () => {
  const { pen, posts } = setup();
  await toShipped();

  const set = await revealAtTown({ post: ID, candidates: PAINTED }, WRIGHT, { now: NOW });
  assert.deepEqual(set.reveal, { candidates: PAINTED, pick: null, image: null, picked_by: null });
  assert.match(set.receipt, /candidates set on errant\/the-door-sticks by wright's hand: 3 images for "Hinge Nibbler"; ada picks one/);
  const setAct = pen.rows().at(-1);
  assert.deepEqual([setAct.class, setAct.action, setAct.actor, setAct.object], ["bug", "reveal", "wright", ID]);
  assert.equal(posts.get(ID).state, "shipped", "a reveal moves no stage");

  const before = (await postsAtOffice({ class: "bug", post: ID }, { now: NOW, roll: ROLL })).post;
  assert.equal(before.fields.reveal.image, null, "until the pick, the jar has no image to show");

  const pick = await revealAtTown({ post: ID, pick: 2 }, ADA, { now: NOW });
  assert.deepEqual(pick.reveal, { candidates: PAINTED, pick: 2, image: PAINTED[1], picked_by: "ada" });
  assert.match(pick.receipt, /revealed: errant\/the-door-sticks's critter "Hinge Nibbler" is candidate 2, chosen by ada/);
  assert.deepEqual(JSON.parse(pen.rows().at(-1).payload), { post: ID, reveal: pick.reveal, hand: "ada" });

  // the jar: the posts read carries the picked image beside the name and its namer
  const one = (await postsAtOffice({ class: "bug", post: ID }, { now: NOW, roll: ROLL })).post;
  assert.deepEqual([one.fields.critter, one.fields.named_by, one.fields.reveal.image], ["Hinge Nibbler", "ada", PAINTED[1]]);
  const all = (await postsAtOffice({ class: "bug" }, { now: NOW, roll: ROLL })).posts.find((p) => p.id === ID);
  assert.equal(all.fields.reveal.image, PAINTED[1]);

  // the rebuild: the acts alone derive the reveal, and the table agrees
  const acts = pen.rows().filter((a) => a.class === "bug").map((a) => ({ ...a, payload: JSON.parse(a.payload) }));
  assert.deepEqual(foldPostActs(acts).posts.get(ID).fields.reveal, pick.reveal);
  const out = await dryRun(pen);
  assert.equal(out.equal, true, out.drift.join("\n"));
});

test("9 · the reveal's refusals each write nothing: not shipped, not a hand, not three media URLs, no candidates, not the fixer, a pick out of range, both at once, and after the pick", async () => {
  const { pen, posts } = setup();
  await toBriefed();
  await advanceAtTown({ post: ID, to: "fixed", credit: "ada", size: "M", critter: "Hinge Nibbler" }, WRIGHT, { now: NOW, roll: ROLL });
  const refusedNothingWritten = async (p, code, re) => {
    const n = pen.rows().length;
    const had = JSON.stringify(posts.get(ID));
    await refusedWith(p, code, re);
    assert.equal(pen.rows().length, n, "a refused reveal wrote an act");
    assert.equal(JSON.stringify(posts.get(ID)), had, "a refused reveal changed the post");
  };
  await refusedNothingWritten(revealAtTown({ post: ID, candidates: PAINTED }, WRIGHT, { now: NOW }), 409, /stands fixed, and a critter is revealed when its fix ships/);
  await advanceAtTown({ post: ID, to: "shipped" }, WRIGHT, { now: NOW, roll: ROLL });

  await refusedNothingWritten(revealAtTown({ post: ID, candidates: PAINTED }, FINN, { now: NOW }), 403, /only the town's hands set a critter's candidates/);
  await refusedNothingWritten(revealAtTown({ post: ID, candidates: PAINTED.slice(0, 2) }, WRIGHT, { now: NOW }), 422, /a reveal holds 3 candidates/);
  await refusedNothingWritten(revealAtTown({ post: ID, candidates: [...PAINTED.slice(0, 2), "https://example.com/x.png"] }, WRIGHT, { now: NOW }), 422, /a candidate is a media URL/);
  await refusedNothingWritten(revealAtTown({ post: ID, candidates: [PAINTED[0], PAINTED[0], PAINTED[1]] }, WRIGHT, { now: NOW }), 422, /three different images/);
  await refusedNothingWritten(revealAtTown({ post: ID, pick: 1 }, ADA, { now: NOW }), 409, /has no candidates yet/);
  await refusedNothingWritten(revealAtTown({ post: ID, candidates: PAINTED, pick: 1 }, WRIGHT, { now: NOW }), 422, /one at a time/);
  await refusedNothingWritten(revealAtTown({ post: ID }, WRIGHT, { now: NOW }), 422, /one at a time/);

  await revealAtTown({ post: ID, candidates: PAINTED }, WRIGHT, { now: NOW });
  await refusedNothingWritten(revealAtTown({ post: ID, pick: 1 }, FINN, { now: NOW }), 403, /only ada, who fixed it and named the critter, picks its image/);
  await refusedNothingWritten(revealAtTown({ post: ID, pick: 1 }, WRIGHT, { now: NOW }), 403, /only ada/);
  await refusedNothingWritten(revealAtTown({ post: ID, pick: 4 }, ADA, { now: NOW }), 422, /pick is 1–3/);

  await revealAtTown({ post: ID, pick: 3 }, ADA, { now: NOW });
  await refusedNothingWritten(revealAtTown({ post: ID, pick: 1 }, ADA, { now: NOW }), 409, /critter is revealed/);
  await refusedNothingWritten(revealAtTown({ post: ID, candidates: PAINTED }, WRIGHT, { now: NOW }), 409, /critter is revealed/);
  await refusedWith(revealAtTown({ post: "errant/no-such-bug", pick: 1 }, ADA, { now: NOW }), 404, /no bug/);
});

// ── 10 · the link: the post points at the work that earned each stage (Darko, 2026-10-07) ──

test("10 · an advance may carry link, kept per stage in fields.links; the posts read and the rebuild carry them", async () => {
  const { pen, posts } = setup();
  await postAtTown({ ...BUG, issue: "https://github.com/postmark-town/postmark/issues/3500" }, ERRANT, { now: NOW, roll: ROLL });
  const CAUSE = "https://github.com/postmark-town/postmark/issues/3500#issuecomment-111";
  const BRIEF = "https://github.com/postmark-town/postmark/issues/3500#issuecomment-222";
  const PR = "https://github.com/postmark-town/postmark-office/pull/410";
  const TAG = "https://github.com/postmark-town/postmark-office/releases/tag/release/2026-w42";
  const d = await advanceAtTown({ post: ID, to: "diagnosed", credit: "finn", link: `  ${CAUSE}  ` }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(d.link, CAUSE);
  assert.match(d.receipt, new RegExp(`; diagnosed points at ${CAUSE.replace(/[.#/]/g, "\$&")}$`));
  await advanceAtTown({ post: ID, to: "briefed", credit: "finn", grade: "light", link: BRIEF }, WRIGHT, { now: NOW, roll: ROLL });
  await advanceAtTown({ post: ID, to: "fixed", credit: "ada", size: "S", critter: "Stickle", link: PR }, WRIGHT, { now: NOW, roll: ROLL });
  const ship = await advanceAtTown({ post: ID, to: "shipped", link: TAG }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(ship.stamps, 0, "a link pays nothing");
  const LINKS = { diagnosed: CAUSE, briefed: BRIEF, fixed: PR, shipped: TAG };
  assert.deepEqual(posts.get(ID).fields.links, LINKS);
  assert.equal(posts.get(ID).fields.issue, "https://github.com/postmark-town/postmark/issues/3500", "the issue stays beside the links");
  const one = (await postsAtOffice({ class: "bug", post: ID }, { now: NOW, roll: ROLL })).post;
  assert.deepEqual(one.fields.links, LINKS);
  const acts = pen.rows().filter((a) => a.class === "bug").map((a) => ({ ...a, payload: JSON.parse(a.payload) }));
  assert.deepEqual(foldPostActs(acts).posts.get(ID).fields.links, LINKS, "the acts alone derive the links");
  const out = await dryRun(pen);
  assert.equal(out.equal, true, out.drift.join("\n"));
});

test("10 · a link off the town's repos, empty, too long, or not text is refused by name and writes nothing; no link is fine", async () => {
  const { pen, posts } = setup();
  await postAtTown(BUG, ERRANT, { now: NOW, roll: ROLL });
  const n = pen.rows().length;
  const had = JSON.stringify(posts.get(ID));
  const HOW = /link: one URL — the work that earned the stage, on github\.com\/postmark-town\//;
  await refusedWith(advanceAtTown({ post: ID, to: "confirmed", link: "https://github.com/someone/else/issues/1" }, WRIGHT, { now: NOW, roll: ROLL }), 422, HOW);
  await refusedWith(advanceAtTown({ post: ID, to: "confirmed", link: "https://evil.example/postmark-town/x" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /link points at the town's own repos/);
  await refusedWith(advanceAtTown({ post: ID, to: "confirmed", link: "   " }, WRIGHT, { now: NOW, roll: ROLL }), 422, /link is empty/);
  await refusedWith(advanceAtTown({ post: ID, to: "confirmed", link: 7 }, WRIGHT, { now: NOW, roll: ROLL }), 422, /link is text/);
  await refusedWith(advanceAtTown({ post: ID, to: "confirmed", link: `https://github.com/postmark-town/postmark/issues/1#${"x".repeat(300)}` }, WRIGHT, { now: NOW, roll: ROLL }), 422, /link is at most 300 characters/);
  assert.equal(pen.rows().length, n, "a refused link wrote an act");
  assert.equal(JSON.stringify(posts.get(ID)), had);
  await advanceAtTown({ post: ID, to: "confirmed" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(posts.get(ID).fields.links, undefined, "an advance without a link sets no links");
});

// ── 11 · the history: who did each stage, and what it paid (POS-547, Darko 2026-10-09) ──

const { stagePaidOf } = await import("../src/bugs.mjs");
const { NO_CHAIN } = await import("../src/town-posts.mjs");
const stageLine = (handle, n, post, stage) => `- 2026-10-09 · MINT → ${handle} · ${n} · for: post:${post}/${stage} · by: the-town`;
const FIX_PR = "https://github.com/postmark-town/postmark-office/pull/462";

/** A bug put up for ada by wright's hand, then confirmed, reproduced by finn, and fixed by errant with a critter. */
async function throughFixed() {
  await postAtTown({ ...BUG, for: "ada" }, WRIGHT, { now: NOW, roll: ROLL });
  const id = "ada/the-door-sticks";
  await amendAtTown({ post: id, steps: "Twice." }, WRIGHT, { now: NOW, roll: ROLL });
  await advanceAtTown({ post: id, to: "confirmed" }, WRIGHT, { now: NOW, roll: ROLL });
  await advanceAtTown({ post: id, to: "reproduced", credit: "finn" }, WRIGHT, { now: NOW, roll: ROLL });
  await advanceAtTown({ post: id, to: "fixed", credit: "errant", size: "M", critter: "Hinge Nibbler", link: FIX_PR }, WRIGHT, { now: NOW, roll: ROLL });
  return id;
}

test("11 · the bug read carries history: the post and each advance, in order, with their credits, hands and links; stamps_paid from the ledger's line, null without one", async () => {
  const { ledger } = setup();
  const id = await throughFixed();
  await postAtTown(BUG, ERRANT, { now: NOW, roll: ROLL });   // a second bug, with only its post
  ledger.lines = [
    "- 2026-10-01 · MINT → wright · 5 · for: welcome:the-harbor · by: the-town",         // not a stage line
    stageLine("ada", 2, id, "confirmed"),
    stageLine("errant", 25, id, "fixed"),
    stageLine("finn", 3, "errant/the-door-sticks", "reproduced"),                          // another post's stage
  ];

  const one = (await postsAtOffice({ class: "bug", post: id }, { now: NOW, roll: ROLL })).post;
  assert.deepEqual(one.history.map(({ at, ...r }) => r), [
    { stage: "reported", hand: "wright", credit: "ada", link: null, stamps_paid: null },
    { stage: "confirmed", hand: "wright", credit: "ada", link: null, stamps_paid: 2 },
    { stage: "reproduced", hand: "wright", credit: "finn", link: null, stamps_paid: null },
    { stage: "fixed", hand: "wright", credit: "errant", link: FIX_PR, stamps_paid: 25 },
  ], "four stage rows (the amend moves no stage), the reproduced line not yet written");
  for (const r of one.history) assert.equal(new Date(r.at).toISOString(), r.at, "at is an ISO instant");

  // the list carries the same history on every row
  const r = await postsAtOffice({ class: "bug" }, { now: NOW, roll: ROLL });
  assert.equal(r.unavailable, undefined, "a store with a chain says nothing is missing");
  assert.deepEqual(r.posts.find((p) => p.id === id).history, one.history);
  assert.deepEqual(r.posts.find((p) => p.id === ID).history.map(({ at, ...x }) => x),
    [{ stage: "reported", hand: null, credit: "errant", link: null, stamps_paid: null }],
    "a bug posted by its reporter has no hand, and another post's line is not its");
});

test("11 · a store with no stamp chain, or no stamp_lines at all, still answers history, with stamps_paid null and unavailable saying why", async () => {
  const { ledger } = setup();
  const id = await throughFixed();
  for (const lines of [[], null]) {
    ledger.lines = lines;
    const r = await postsAtOffice({ class: "bug" }, { now: NOW, roll: ROLL });
    assert.equal(r.unavailable, NO_CHAIN);
    const h = r.posts.find((p) => p.id === id).history;
    assert.deepEqual(h.map((x) => [x.stage, x.credit, x.stamps_paid]),
      [["reported", "ada", null], ["confirmed", "ada", null], ["reproduced", "finn", null], ["fixed", "errant", null]]);
  }
});

test("11 · the stage line is read in the town's own grammar: its stageMintLine parses, and nothing else does", async (t) => {
  const { existsSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const tool = resolve(process.env.TOWN_CLONE ?? "town-clone", "tools", "stamp-mint.mjs");
  assert.deepEqual(stagePaidOf(stageLine("finn", 10, "errant/the-door-sticks", "briefed")),
    { handle: "finn", n: 10, post: "errant/the-door-sticks", stage: "briefed" });
  for (const not of [stageLine("finn", 10, "errant/the-door-sticks", "shipped"), "- 2026-10-09 · MINT → finn · 5 · for: welcome:x · by: the-town",
    `${stageLine("finn", 10, "errant/the-door-sticks", "briefed")} · sig: abc`, ""])
    assert.equal(stagePaidOf(not), null, not);
  if (!existsSync(tool)) return t.skip(`no town clone at ${tool} (TOWN_CLONE names one)`);
  const { stageMintLine } = await import(pathToFileURL(tool).href);
  if (typeof stageMintLine !== "function") return t.skip("this town's stamp-mint.mjs has no stageMintLine");
  const line = stageMintLine({ date: "2026-10-09", handle: "wildcat", n: 25, post: "wildcat/leave-mark-preview", stage: "fixed" });
  assert.deepEqual(stagePaidOf(line), { handle: "wildcat", n: 25, post: "wildcat/leave-mark-preview", stage: "fixed" });
});

// ── 12 · the bug read pages, and every page carries the catchers (POS-558, Darko 2026-10-10) ──

const { BUG_PAGE } = await import("../src/town-posts.mjs");

/** throughFixed's bug, errant's own bug, and finn's report ruled not a bug. */
async function threeBugs() {
  const id = await throughFixed();
  await postAtTown(BUG, ERRANT, { now: NOW, roll: ROLL });
  await postAtTown({ class: "bug", title: "The bell rings twice", body: "The ferry bell rings twice at every crossing." }, FINN, { now: NOW, roll: ROLL });
  await advanceAtTown({ post: "finn/the-bell-rings-twice", to: "not-a-bug" }, WRIGHT, { now: NOW, roll: ROLL });
  return id;
}

test("12 · the bug read pages in the office's grammar: total, shown, limit, offset, complete, next_offset and more_note; the pages walk the one order", async () => {
  setup();
  await threeBugs();
  const all = await postsAtOffice({ class: "bug", limit: 200 }, { now: NOW, roll: ROLL });
  assert.deepEqual([all.total, all.shown, all.limit, all.offset, all.complete, all.next_offset], [3, 3, 200, 0, true, undefined]);
  const p1 = await postsAtOffice({ class: "bug", limit: 2 }, { now: NOW, roll: ROLL });
  assert.deepEqual([p1.total, p1.shown, p1.limit, p1.offset, p1.complete, p1.next_offset], [3, 2, 2, 0, false, 2]);
  assert.equal(p1.posts.length, 2);
  assert.match(p1.more_note, /^1 further bug — call again with offset: 2$/);
  const p2 = await postsAtOffice({ class: "bug", limit: "2", offset: "2" }, { now: NOW, roll: ROLL });   // the GET door hands strings
  assert.deepEqual([p2.shown, p2.offset, p2.complete, "next_offset" in p2, "more_note" in p2], [1, 2, true, false, false]);
  assert.deepEqual([...p1.posts, ...p2.posts].map((p) => p.id), all.posts.map((p) => p.id), "the pages are not the one order, cut");
  for (const p of p1.posts) assert.ok(Array.isArray(p.history), "a paged row lost its history");
  const bare = await postsAtOffice({ class: "bug" }, { now: NOW, roll: ROLL });
  assert.equal(bare.limit, BUG_PAGE);
  assert.equal(BUG_PAGE, 50);
  assert.equal((await postsAtOffice({ class: "bug", limit: 999 }, { now: NOW, roll: ROLL })).limit, 200);
  assert.equal((await postsAtOffice({ class: "bug", limit: "x", offset: -4 }, { now: NOW, roll: ROLL })).offset, 0);
  // one post is still one post, unpaged
  assert.equal((await postsAtOffice({ class: "bug", post: ID, limit: 1 }, { now: NOW, roll: ROLL })).post.id, ID);
});

test("12 · every page carries the catchers over the whole record: stamps paid and bugs credited per handle; a bug ruled not a bug credits only a stage that paid", async () => {
  const { ledger } = setup();
  const id = await threeBugs();
  ledger.lines = [stageLine("ada", 2, id, "confirmed"), stageLine("errant", 25, id, "fixed")];
  const want = [
    { handle: "errant", stamps: 25, bugs: 2 },   // the fix on ada's bug, and the report of their own
    { handle: "ada", stamps: 2, bugs: 1 },       // reported for them by wright's hand, and confirmed
    { handle: "finn", stamps: 0, bugs: 1 },      // reproduced ada's, unpaid; their own report was not a bug
  ];
  for (const [limit, offset] of [[200, 0], [1, 0], [1, 2]]) {
    const r = await postsAtOffice({ class: "bug", limit, offset }, { now: NOW, roll: ROLL });
    assert.deepEqual(r.catchers, want, `the page at ${offset} of ${limit} summed something else`);
  }
  // a chain that cannot be read says null, never 0
  ledger.lines = [];
  const r = await postsAtOffice({ class: "bug", limit: 1 }, { now: NOW, roll: ROLL });
  assert.equal(r.unavailable, NO_CHAIN);
  assert.deepEqual(r.catchers.map((c) => [c.handle, c.stamps, c.bugs]), [["errant", null, 2], ["ada", null, 1], ["finn", null, 1]]);
});

test("12 · the bug read walks the jar's order across a page cut: open by the furthest stage, the named, the legacy shelf, the set aside; newest first within each", async () => {
  setup();
  const at = { now: NOW, roll: ROLL };
  const post = async (title, house) => { await postAtTown({ class: "bug", title, body: `${title}, as it happened.` }, house, at); };
  const idOf = async (title) => (await postsAtOffice({ class: "bug", limit: 200 }, at)).posts.find((p) => p.title === title).id;
  const go = async (title, to, extra = {}) => advanceAtTown({ post: await idOf(title), to, ...extra }, WRIGHT, at);
  // oldest act first, so each later act is newer
  await post("Reported, older", ERRANT);
  await post("Confirmed", FINN); await go("Confirmed", "confirmed");
  await post("Fixed, named", ERRANT); await go("Fixed, named", "fixed", { credit: "finn", size: "S", critter: "Stickle" });
  await post("Shipped, named", FINN); await go("Shipped, named", "fixed", { credit: "errant", size: "S", critter: "Quill" }); await go("Shipped, named", "shipped");
  await post("The legacy fix, older", ERRANT); await go("The legacy fix, older", "shipped");
  await post("Not one", FINN); await go("Not one", "not-a-bug");
  await postAtTown({ class: "bug", title: "Reported, newer", body: "Reported, newer, as it happened.", for: "ada" }, WRIGHT, at);
  await post("A legacy fix, newer", ERRANT); await go("A legacy fix, newer", "shipped");
  const want = ["Fixed, named", "Confirmed", "Reported, newer", "Reported, older", "Shipped, named", "A legacy fix, newer", "The legacy fix, older", "Not one"];
  const all = await postsAtOffice({ class: "bug", limit: 200 }, at);
  assert.deepEqual(all.posts.map((p) => p.title), want);
  const pages = [];
  for (let offset = 0; offset < all.total; offset += 3) pages.push((await postsAtOffice({ class: "bug", limit: 3, offset }, at)).posts.map((p) => p.title));
  assert.deepEqual(pages, [want.slice(0, 3), want.slice(3, 6), want.slice(6)], "the pages cut the jar's order somewhere else");
});
