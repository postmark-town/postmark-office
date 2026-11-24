// bug-own-post-credit.test.mjs — THE REPORT ITSELF CAN EARN DIAGNOSED (POS-1105).
//
//   node --test test/bug-own-post-credit.test.mjs
//
// CORE-105 (Emily and Kogane, 2026-11-17: "A cause in the report itself
// counts"), Wright's § 3b: diagnosed takes the bug's own post,
// `post:<author>/<slug>`, only the post being advanced, credited to its reporter
// or a resident of their household (a letter's rule), when its words are the
// reporter's own, dated by the act that wrote them. Each case drives the real
// door, advanceAtTown, through judgeAdvance and the write's transaction
// (bug-credit.mjs § judgeEarnedCreditVia), against the acts the door itself
// wrote, and every refusal is shown to write nothing.
//
// GitHub is pointed at a closed port: the own post is judged from the store
// alone, so a GitHub read would refuse, and none is made.
//
// ⚑ THE STORE IS A JS STUB (`acts-pen-stub.mjs`), as in bug-post.test.mjs.
//
// EACH FIELD IS DATED BY THE ACT THAT WROTE IT (the review of #1167 at
// d1f298c2): the body and the steps keep their own last writing act, so a cause
// in an untouched field keeps its date, a hand's edit to one field leaves the
// other the reporter's, and a field the reporter writes again is theirs again.
// The cases run the real post, amend and advance doors at distinct times.
//
// THE FALSIFIERS (run, then restored; the hand-in names them): take "post" out
// of diagnosed's kinds and the valid own-post case is refused again; drop the
// target guard (bugs.mjs § judgeOnBugIssue) and another bug's post credits; drop
// the household rule for the post and an unrelated household's credit passes;
// drop the hand check and a hand's transcription credits; date every field by
// the last text act (one timeline) and the untouched body takes the steps' date.

import test from "node:test";
import assert from "node:assert/strict";
import { installActsPen, uninstallActsPen, RECORD_ON } from "./acts-pen-stub.mjs";

Object.assign(process.env, RECORD_ON);
process.env.GITHUB_API_URL = "http://127.0.0.1:9";   // closed: an own-post advance makes no GitHub read
const { postAtTown, amendAtTown, advanceAtTown } = await import("../src/events-store.mjs");
const { ownPostEvidenceOf } = await import("../src/bug-credit.mjs");
const { judgeEarnedLink, earnedRef } = await import("../src/bugs.mjs");
const { currentCrossing, nextCrossingAt } = await import("../src/crossings.mjs");

// THE FIXTURE'S CLOCK (POS-1171). Every write below stamps its act with currentCrossing(its own `now`), while the pen's closed-window guard
// (POS-940, world2-pen.mjs § lateCrossingGuard) compares that crossing with the town's open window at the WALL clock. The cases advance
// `now` by as much as SPAN past NOW, so a run in the last SPAN before a 00:00Z/12:00Z crossing stamped the not-yet-open next window and the
// guard refused it, correctly (the old `NOW = Date.now()` was red from 23:00Z to 00:00Z and from 11:00Z to 12:00Z: the longest case, the
// steps-only edit, writes at +48, +50, +55, +60 and +70 min, so it was the first to cross, at 70 min out). The base is therefore the wall clock
// held back, when it must be, to leave SPAN (and a minute) before the open window closes: the acts stay in the open window, at distinct times.
const MIN = 60_000;
const SPAN = 70 * MIN;                                   // the longest advance below (the steps-only case's +70)
const wall = Date.now();
const NOW = Math.min(wall, Date.parse(nextCrossingAt(wall)) - SPAN - MIN);
assert.equal(currentCrossing(NOW + SPAN), currentCrossing(wall), "the fixture's writes stay in the window that is open now");
const WRIGHT = { household: "starforge", handles: new Set(["wright"]) };
const ERRANT = { household: "the-harbor", handles: new Set(["errant"]) };
const FINN = { household: "finn", handles: new Set(["finn"]) };
const HOUSES = [
  { slug: "the-harbor", ord: 1, residents: ["errant", "ada"], accounts: [{ id: 1001, login: "harbor-human" }] },
  { slug: "starforge", ord: 3, residents: ["wright", "mari"], accounts: [{ id: 67605380, login: "keeminlee" }] },
];
const PINS = [{ handle: "finn", login: "finn-gh", gh_id: 1002 }];
const ROLL = new Set(["wright", "keemin", "errant", "ada", "finn", "mari"]);

/** The posts table and the stamp chain's absence, in memory, answering exactly the queries the door asks. */
function tables() {
  const posts = new Map();
  const PC = ["id", "class", "title", "body", "author", "household", "place_mark", "place_x", "place_y",
    "starts", "ends", "state", "fields", "revised", "posted_act", "last_act"];
  const asJson = (v) => (typeof v === "string" ? JSON.parse(v) : v);
  const copy = (r) => ({ ...r, fields: { ...r.fields } });
  const also = [
    [/^INSERT INTO posts/i, (q, p) => {
      const r = Object.fromEntries(PC.map((k, i) => [k, p[i]]));
      r.fields = asJson(r.fields);
      posts.set(p[0], r);
      return { rows: [], rowCount: 1 };
    }],
    [/^UPDATE posts SET/i, (q, p) => {
      Object.assign(posts.get(p[0]), { title: p[1], body: p[2], place_mark: p[3], place_x: p[4], place_y: p[5],
        starts: p[6], ends: p[7], state: p[8], fields: asJson(p[9]), revised: p[10], last_act: p[11] });
      return { rows: [], rowCount: 1 };
    }],
    [/FROM posts WHERE id = \$1 AND class = \$2$/i, (q, p) => {
      const r = posts.get(p[0]);
      return r && r.class === p[1] ? { rows: [copy(r)], rowCount: 1 } : { rows: [], rowCount: 0 };
    }],
    [/^SELECT id, state, ends FROM posts WHERE id LIKE \$1$/i, (q, p) => {
      const rows = [...posts.values()].filter((r) => r.id.startsWith(p[0].replace(/%$/, ""))).map((r) => ({ id: r.id, state: r.state, ends: r.ends }));
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT id FROM posts WHERE id = \$1 AND class = \$2 FOR UPDATE$/i, (q, p) => {
      const r = posts.get(p[0]);
      return r && r.class === p[1] ? { rows: [{ id: r.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }],
    [/^SELECT to_regclass\('stamp_lines'\) IS NOT NULL AS ok$/i, () => ({ rows: [{ ok: false }], rowCount: 1 })],
  ];
  return { posts, also };
}

let failActsRead = false;
const EVIDENCE_READ = /^SELECT id, object, action, actor, at, payload FROM acts WHERE class = \$1 AND object = ANY\(\$2\) AND action = ANY\(\$3\) ORDER BY id$/i;
function setup() {
  const t = tables();
  failActsRead = false;
  const pen = installActsPen({ households: HOUSES, pins: PINS, also: t.also, failOn: (q) => failActsRead && EVIDENCE_READ.test(q) });
  return { ...t, pen };
}
test.afterEach(() => uninstallActsPen());

const opts = { now: NOW, roll: ROLL };
async function refusedNothing(pen, p, code, re) {
  const before = pen.rows().length;
  await assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code} ${e.defect}`); assert.match(`${e.defect} ${e.hint}`, re); return true; });
  assert.equal(pen.rows().length, before, "a refused advance wrote an act");
}

// Umber's 4441, in miniature: the report names its own suspected cause.
const BUG = { class: "bug", title: "Leave mark ignores the handle", body: "Leaving a plain mark drops the top-level handle.",
  steps: "Suspicion only: src/world.mjs (~4802) reads payload.by alone." };
const ID = "errant/leave-mark-ignores-the-handle";
const LINK = `post:${ID}`;

/** A bug standing at reproduced, posted by `key` (and `for`, when a hand put it up). */
async function reproduced(key = ERRANT, extra = {}) {
  const r = await postAtTown({ ...BUG, ...extra }, key, opts);
  await advanceAtTown({ post: r.post.id, to: "confirmed" }, WRIGHT, opts);
  await advanceAtTown({ post: r.post.id, to: "reproduced", credit: "wright" }, WRIGHT, opts);
  return r.post.id;
}

const iso = (a) => new Date(a.at).toISOString();

test("the own post earns diagnosed: the reporter credited, the link kept on the stage record, each field dated by the act that wrote it; no GitHub read", async () => {
  const { pen, posts } = setup();
  const id = await reproduced();
  const posted = pen.rows().find((a) => a.action === "post" && a.object === id);
  const a = await advanceAtTown({ post: id, to: "diagnosed", credit: "errant", link: LINK }, WRIGHT, opts);
  assert.deepEqual([a.stage, a.credit, a.stamps, a.link], ["diagnosed", "errant", 5, LINK]);
  assert.match(a.receipt, new RegExp(`diagnosed points at ${LINK}, the report's own words by errant: its body written by act ${posted.id} \\(${iso(posted)}\\), and its steps written by act ${posted.id} \\(${iso(posted)}\\)$`));
  assert.equal(posts.get(id).state, "diagnosed");
  assert.equal(posts.get(id).fields.links.diagnosed, LINK, "the evidence link is the stage's, in fields.links");
  const adv = JSON.parse(pen.rows().at(-1).payload);
  assert.deepEqual(adv, { post: id, from: "reproduced", to: "diagnosed", credit: "errant", fields: { links: { diagnosed: LINK } }, hand: "wright" },
    "the act is the ordinary advance: no new field");
});

test("a resident of the reporter's household is credited by the same rule a letter follows", async () => {
  const { pen } = setup();
  const id = await reproduced();
  const a = await advanceAtTown({ post: id, to: "diagnosed", credit: "ada", link: LINK }, WRIGHT, opts);
  assert.equal(a.credit, "ada");
  assert.equal(JSON.parse(pen.rows().at(-1).payload).credit, "ada");
});

test("THE CAUSE IN THE BODY, A LATER STEPS-ONLY EDIT: the body keeps its own act and date, the steps take theirs, and metadata edits date nothing", async () => {
  const { pen } = setup();
  const r = await postAtTown({ ...BUG, body: "The cause: src/world.mjs (~4802) reads payload.by alone." }, ERRANT, { ...opts, now: NOW });
  const posted = pen.rows().at(-1);
  await amendAtTown({ post: r.post.id, steps: `${BUG.steps} Seen again on the second try.` }, ERRANT, { ...opts, now: NOW + 48 * MIN });
  const stepsAmend = pen.rows().at(-1);
  await advanceAtTown({ post: r.post.id, to: "confirmed" }, WRIGHT, { ...opts, now: NOW + 50 * MIN });
  await amendAtTown({ post: r.post.id, title: "Leave mark drops the handle", issue: "https://github.com/postmark-town/postmark/issues/4441" }, WRIGHT, { ...opts, now: NOW + 55 * MIN });
  await advanceAtTown({ post: r.post.id, to: "reproduced", credit: "wright" }, WRIGHT, { ...opts, now: NOW + 60 * MIN });
  const a = await advanceAtTown({ post: r.post.id, to: "diagnosed", credit: "errant", link: LINK }, WRIGHT, { ...opts, now: NOW + 70 * MIN });
  assert.notEqual(iso(posted), iso(stepsAmend), "two distinct writing times");
  assert.match(a.receipt, new RegExp(`by errant: its body written by act ${posted.id} \\(${iso(posted)}\\), and its steps written by act ${stepsAmend.id} \\(${iso(stepsAmend)}\\)$`),
    "the body holding the cause is dated by the post act, never by the steps' amendment, and a hand's title and issue edit dates neither");
});

test("A HAND EDITS ONLY THE OTHER FIELD: the reporter's untouched body keeps its act and date, and the hand's steps are named as the hand's, never the reporter's", async () => {
  const { pen } = setup();
  const r = await postAtTown(BUG, ERRANT, { ...opts, now: NOW });
  const posted = pen.rows().at(-1);
  await advanceAtTown({ post: r.post.id, to: "confirmed" }, WRIGHT, { ...opts, now: NOW + 5 * MIN });
  await amendAtTown({ post: r.post.id, steps: "Tidied by the hand: leave a plain mark; the handle is dropped." }, WRIGHT, { ...opts, now: NOW + 10 * MIN });
  const handSteps = pen.rows().at(-1);
  await advanceAtTown({ post: r.post.id, to: "reproduced", credit: "wright" }, WRIGHT, { ...opts, now: NOW + 15 * MIN });
  const a = await advanceAtTown({ post: r.post.id, to: "diagnosed", credit: "errant", link: LINK }, WRIGHT, { ...opts, now: NOW + 20 * MIN });
  assert.match(a.receipt, new RegExp(`by errant: its body written by act ${posted.id} \\(${iso(posted)}\\); its steps were last written by wright's hand \\(act ${handSteps.id}, ${iso(handSteps)}\\), so they are not errant's and earn nothing$`));
});

test("A HAND EDITS THE TEXT, THEN THE REPORTER WRITES IT AGAIN: the field is the reporter's from their new act, with no lasting mark from the hand", async () => {
  const { pen } = setup();
  const r = await postAtTown(BUG, ERRANT, { ...opts, now: NOW });
  await amendAtTown({ post: r.post.id, body: "Tidied by the hand: the mark drops its handle." }, WRIGHT, { ...opts, now: NOW + 5 * MIN });
  await amendAtTown({ post: r.post.id, body: "In my words again: src/world.mjs (~4802) reads payload.by alone, so the handle is dropped." }, ERRANT, { ...opts, now: NOW + 9 * MIN });
  const rewritten = pen.rows().at(-1);
  await advanceAtTown({ post: r.post.id, to: "confirmed" }, WRIGHT, { ...opts, now: NOW + 10 * MIN });
  await advanceAtTown({ post: r.post.id, to: "reproduced", credit: "wright" }, WRIGHT, { ...opts, now: NOW + 15 * MIN });
  const a = await advanceAtTown({ post: r.post.id, to: "diagnosed", credit: "errant", link: LINK }, WRIGHT, { ...opts, now: NOW + 20 * MIN });
  assert.match(a.receipt, new RegExp(`by errant: its body written by act ${rewritten.id} \\(${iso(rewritten)}\\), and its steps written by act \\d+`));
  assert.doesNotMatch(a.receipt, /last written by wright's hand/, "the hand's earlier edit leaves no mark once the reporter wrote the field again");
});

test("CONTROLS, each refused with nothing written: another bug's post, an unrelated household, a founder's credit", async () => {
  const { pen } = setup();
  const id = await reproduced();
  await postAtTown({ ...BUG, title: "Another thing entirely" }, ERRANT, opts);
  await refusedNothing(pen, advanceAtTown({ post: id, to: "diagnosed", credit: "errant", link: "post:errant/another-thing-entirely" }, WRIGHT, opts), 422,
    new RegExp(`post:errant/another-thing-entirely is the post "errant/another-thing-entirely", and the bug here is "${ID}".*a post link is the bug's own: post:${ID}`));
  await refusedNothing(pen, advanceAtTown({ post: id, to: "diagnosed", credit: "finn", link: LINK }, WRIGHT, opts), 422,
    new RegExp(`^post "${ID}" was written by errant, of hh:the-harbor, and finn stands in solo:finn .*credit its reporter or a resident of their household`));
  await refusedNothing(pen, advanceAtTown({ post: id, to: "diagnosed", credit: "wright", link: LINK }, WRIGHT, opts), 422,
    new RegExp(`^only a founder's own post earns wright a stage, and post "${ID}" was written by errant`));
});

test("CONTROLS: a report a hand put up on the reporter's behalf is the hand's transcription, and a report whose every field a hand last wrote holds none of the reporter's words", async () => {
  const { pen } = setup();
  const forAda = await reproduced(WRIGHT, { for: "ada" });
  const forAct = pen.rows().find((a) => a.action === "post" && a.object === forAda);
  await refusedNothing(pen, advanceAtTown({ post: forAda, to: "diagnosed", credit: "ada", link: `post:${forAda}` }, WRIGHT, opts), 422,
    new RegExp(`^no word of "${forAda}"'s report stands as ada's own: its body was last written by wright's hand \\(act ${forAct.id}\\), and its steps were last written by wright's hand \\(act ${forAct.id}\\)`));
  const id = await reproduced();
  await amendAtTown({ post: id, body: "Rewritten by the hand: the mark drops its handle.", steps: "Rewritten by the hand too." }, WRIGHT, opts);
  const rewrite = pen.rows().at(-1);
  await refusedNothing(pen, advanceAtTown({ post: id, to: "diagnosed", credit: "errant", link: LINK }, WRIGHT, opts), 422,
    new RegExp(`^no word of "${ID}"'s report stands as errant's own: its body was last written by wright's hand \\(act ${rewrite.id}\\), and its steps were last written by wright's hand \\(act ${rewrite.id}\\)`));
});

test("MISSING OR UNREADABLE EVIDENCE refuses and writes nothing: a post with no post act, and acts the store cannot read", async () => {
  const { pen, posts } = setup();
  // a bug standing at reproduced whose post act the store does not hold
  posts.set("errant/a-legacy-bug", { id: "errant/a-legacy-bug", class: "bug", title: "A legacy bug", body: "x", author: "errant", household: "hh:the-harbor",
    place_mark: null, place_x: null, place_y: null, starts: null, ends: null, state: "reproduced", fields: {}, revised: 0, posted_act: null, last_act: null });
  await refusedNothing(pen, advanceAtTown({ post: "errant/a-legacy-bug", to: "diagnosed", credit: "errant", link: "post:errant/a-legacy-bug" }, WRIGHT, opts), 422,
    /the office holds no post act for "errant\/a-legacy-bug", so it cannot show who wrote its words/);
  const id = await reproduced();
  failActsRead = true;
  await refusedNothing(pen, advanceAtTown({ post: id, to: "diagnosed", credit: "errant", link: LINK }, WRIGHT, opts), 503,
    new RegExp(`the office could not read the acts of "${ID}"`));
  failActsRead = false;
  assert.equal((await advanceAtTown({ post: id, to: "diagnosed", credit: "errant", link: LINK }, WRIGHT, opts)).credit, "errant", "and it records once the acts read");
});

test("briefed and fixed do not take the own post, and a malformed post link is no link the office reads", async () => {
  const { pen } = setup();
  const id = await reproduced();
  await advanceAtTown({ post: id, to: "diagnosed", credit: "errant", link: LINK }, WRIGHT, opts);
  await refusedNothing(pen, advanceAtTown({ post: id, to: "briefed", grade: "light", credit: "errant", link: LINK }, WRIGHT, opts), 422,
    /^briefed is not earned by the bug's own post: only diagnosed is, when the reporter's own report names the cause/);
  assert.throws(() => judgeEarnedLink("fixed", LINK), (e) => /^fixed is not earned by the bug's own post/.test(e.defect));
  assert.throws(() => judgeEarnedLink("diagnosed", "post:errant"), (e) => /^diagnosed's link is not one the office can read/.test(e.defect));
  assert.deepEqual(earnedRef(LINK), { kind: "post", id: ID });
  assert.equal(earnedRef("kinofire-2026-10-12-to-wright-the-sweep-plan").kind, "letter", "a letter's id still reads as a letter");
});

test("a hand's own report credits a founder only by a founder's own post, as a founder's letter does", async () => {
  const { pen } = setup();
  const r = await postAtTown({ ...BUG, title: "The hand saw it too" }, WRIGHT, opts);
  await advanceAtTown({ post: r.post.id, to: "confirmed" }, WRIGHT, opts);
  await advanceAtTown({ post: r.post.id, to: "reproduced", credit: "wright" }, WRIGHT, opts);
  await refusedNothing(pen, advanceAtTown({ post: r.post.id, to: "diagnosed", credit: "errant", link: `post:${r.post.id}` }, WRIGHT, opts), 422,
    /a founder, and a founder's work credits only wright or keemin/);
  assert.equal((await advanceAtTown({ post: r.post.id, to: "diagnosed", credit: "wright", link: `post:${r.post.id}` }, WRIGHT, opts)).credit, "wright");
});

test("a diagnosed skipped by mistake is re-credited with the own post through the same checks", async () => {
  const { pen } = setup();
  const id = await reproduced();
  await advanceAtTown({ post: id, skip: "diagnosed", reason: "the cause was only in the report" }, WRIGHT, opts);
  await refusedNothing(pen, advanceAtTown({ post: id, to: "diagnosed", recredit: true, credit: "finn", link: LINK, note: "the report named it" }, WRIGHT, opts), 422,
    /and finn stands in solo:finn/);
  const r = await advanceAtTown({ post: id, to: "diagnosed", recredit: true, credit: "errant", link: LINK, note: "the report named it" }, WRIGHT, opts);
  assert.deepEqual([r.recredit, r.skipped, r.credit, r.stamps], [true, true, "errant", 5]);
  assert.match(r.receipt, /the report's own words by errant: its body written by act \d+ \(/);
});

test("ownPostEvidenceOf, pure: each field's last writing act, the reporter's or a hand's; no field of the reporter's, missing or unreadable acts refuse", () => {
  const t0 = "2026-10-26T09:00:00.000Z", t1 = "2026-10-26T09:48:00.000Z", t2 = "2026-10-26T10:00:00.000Z";
  const post = { id: 7, object: "errant/x", action: "post", actor: "errant", at: t0, payload: { post: "errant/x", body: "b", fields: { steps: "s" } } };
  const own = (act, at) => ({ act, at, by: "errant", own: true });
  assert.deepEqual(ownPostEvidenceOf("errant/x", [post]), { from: "errant", fields: { body: own(7, t0), steps: own(7, t0) } });
  assert.deepEqual(ownPostEvidenceOf("errant/x", [{ ...post, payload: { post: "errant/x", body: "b" } }]).fields, { body: own(7, t0) }, "a post with no steps has only its body");
  const stepsByReporter = { id: 8, object: "errant/x", action: "amend", actor: "errant", at: t1, payload: { changed: ["steps"], fields: { steps: "s2" } } };
  const titleByHand = { id: 9, object: "errant/x", action: "amend", actor: "wright", at: t2, payload: { changed: ["title", "issue"], title: "y", hand: "wright" } };
  assert.deepEqual(ownPostEvidenceOf("errant/x", [post, stepsByReporter, titleByHand]).fields, { body: own(7, t0), steps: own(8, t1) },
    "the body keeps the post act's date; a hand's title and issue edit dates nothing");
  const bodyByHand = { id: 10, object: "errant/x", action: "amend", actor: "wright", at: t2, payload: { changed: ["body"], body: "h", hand: "wright" } };
  assert.deepEqual(ownPostEvidenceOf("errant/x", [post, bodyByHand]).fields.body, { act: 10, at: t2, by: "wright", own: false });
  assert.throws(() => ownPostEvidenceOf("errant/x", [{ ...post, payload: { ...post.payload, hand: "wright" } }]), (e) => e.code === 422 && /^no word of/.test(e.defect));
  assert.throws(() => ownPostEvidenceOf("errant/x", []), (e) => e.code === 422);
  assert.throws(() => ownPostEvidenceOf("errant/x", [{ ...post, payload: "{ torn" }]), (e) => e.code === 503);
  assert.throws(() => ownPostEvidenceOf("errant/x", [{ ...post, at: "not a time" }]), (e) => e.code === 503);
});
