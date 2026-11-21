// flare-advance.test.mjs — WHO TAKES A FLARE (POS-1163; the law: "Iris, wright and keemin", LOGOS/classes.md:400).
//
//   node --test test/flare-advance.test.mjs
//
// A flare starts reported and is taken ONCE, by a flare hand: accepted as text,
// accepted as video, or declined. The hand is this credential's own, as a bug's
// is (named-hand.mjs): naming a hand a key merely lists is not holding it.
// Iris, the Illuminator, is the resident `illuminator` (Wright, POS-1163,
// 21:57Z), matched by the caller's OWN resident key: a founder's, a household's
// or any shared key that lists or names illuminator holds her hand off, and so
// does the public handle `iris` (another household's resident). Nobody else
// advances a flare. Its advance carries no bug privilege: no credit, link, skip
// or force.
//
// ⚑ THE STORE IS A JS STUB (`acts-pen-stub.mjs`), as in flare-post.test.mjs.
//
// THE FALSIFIERS (run, then restored; the hand-in names them): add a resident
// to FLARE_HANDS and the ordinary reporter advances; drop the credential's own
// hand check and a housemate's key names wright and advances.

import test from "node:test";
import assert from "node:assert/strict";
import { installActsPen, uninstallActsPen, RECORD_ON } from "./acts-pen-stub.mjs";

Object.assign(process.env, RECORD_ON);
const { postAtTown, advanceAtTown } = await import("../src/events-store.mjs");
const { postsAtOffice } = await import("../src/town-posts.mjs");
const { FLARE_HANDS } = await import("../src/flares.mjs");

const NOW = Date.now();
const WRIGHT = { household: "starforge", handles: new Set(["wright"]) };
const KEEMIN = { household: "starforge", handles: new Set(["keemin"]) };
const FINN = { household: "finn", handles: new Set(["finn"]) };
const IRIS = { household: "cass", handles: new Set(["iris"]) };
// POS-389: a housemate's OWN key that lists wright is not wright's hand
const MARI_OWN_KEY = { household: "starforge", handles: new Set(["wright", "mari"]), keyKind: "claim", heldBy: "resident", claimedHandle: "mari" };
// the Illuminator's own resident key: it stands for illuminator alone, whatever else her house lists
const ILLUMINATOR_OWN = { household: "starforge", handles: new Set(["wright", "mari", "illuminator"]), keyKind: "claim", heldBy: "resident", claimedHandle: "illuminator" };
// keys that LIST illuminator without being hers: a founder's shared key, and her household's human key
const FOUNDER_SHARED = { household: "starforge", handles: new Set(["illuminator", "wright", "mari"]) };
const HER_HOUSE_KEY = { household: "lantern-house", handles: new Set(["illuminator"]) };
const HOUSES = [
  { slug: "starforge", ord: 3, residents: ["wright", "mari", "keemin", "illuminator"], accounts: [] },
  { slug: "cass", ord: 4, residents: ["iris"], accounts: [] },
];
const SPARK = "kinofire/a-lantern-walk";
const FLARE = { class: "flare", title: "The lantern walk, filmed", about: SPARK,
  destinations: [{ url: "https://www.youtube.com/watch?v=lanternwalk", platform: "YouTube", form: "video" }] };
const opts = { now: NOW };

function setup() {
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
  const pen = installActsPen({ households: HOUSES, also, marks: [{ slug: SPARK }] });
  return { pen, posts };
}
test.afterEach(() => uninstallActsPen());

async function refusedNothing(pen, p, code, re) {
  const before = pen.rows().length;
  await assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code} ${e.defect}`); assert.match(`${e.defect} ${e.hint}`, re); return true; });
  assert.equal(pen.rows().length, before, "a refused act wrote nothing");
}

test("a flare hand takes a reported flare once: the state, the act, the history; then it is finished", async () => {
  const { pen, posts } = setup();
  const { post: { id } } = await postAtTown(FLARE, FINN, opts);
  const a = await advanceAtTown({ post: id, to: "accepted-video" }, WRIGHT, opts);
  assert.deepEqual([a.state, a.stage, a.hand, a.post.state], ["accepted-video", "accepted-video", "wright", "accepted-video"]);
  assert.match(a.receipt, /^advanced: finn\/the-lantern-walk-filmed reported → accepted-video by wright's hand\. It is finished/);
  const act = pen.rows().at(-1);
  assert.deepEqual([act.class, act.action, act.actor], ["flare", "advance", "wright"]);
  assert.deepEqual(JSON.parse(act.payload), { post: id, from: "reported", to: "accepted-video", hand: "wright" });
  assert.deepEqual(posts.get(id).fields.destinations, FLARE.destinations, "the advance moves the state and keeps every place");
  const read = await postsAtOffice({ class: "flare", post: id }, { now: NOW });
  assert.deepEqual(read.post.history.map((h) => [h.stage, h.hand]), [["reported", "finn"], ["accepted-video", "wright"]]);
  await refusedNothing(pen, advanceAtTown({ post: id, to: "declined" }, KEEMIN, opts), 409, /is already accepted-video.*a flare is taken once/);
  // keemin takes another, as text; a third is declined
  const t = await postAtTown({ ...FLARE, title: "The lantern walk, written" }, FINN, opts);
  assert.equal((await advanceAtTown({ post: t.post.id, to: "accepted-text" }, KEEMIN, opts)).state, "accepted-text");
  const d = await postAtTown({ ...FLARE, title: "The lantern walk, again" }, FINN, opts);
  assert.equal((await advanceAtTown({ post: d.post.id, to: "declined", class: "flare" }, WRIGHT, opts)).state, "declined");
});

test("NOBODY ELSE ADVANCES A FLARE: its reporter, another resident, the public handle iris, or a housemate's key that only lists a hand", async () => {
  const { pen } = setup();
  const { post: { id } } = await postAtTown(FLARE, FINN, opts);
  assert.deepEqual([...FLARE_HANDS], ["wright", "keemin", "illuminator"], "Iris is the resident illuminator, never the public name iris");
  await refusedNothing(pen, advanceAtTown({ post: id, to: "accepted-video" }, FINN, opts), 403, /^only wright, keemin or illuminator advance a flare.*Iris, the Illuminator, is the resident illuminator/);
  await refusedNothing(pen, advanceAtTown({ post: id, to: "accepted-video" }, IRIS, opts), 403, /^only wright, keemin or illuminator advance a flare/);
  await refusedNothing(pen, advanceAtTown({ post: id, to: "accepted-video", handle: "wright" }, MARI_OWN_KEY, opts), 403, /"wright" is not this key's own hand/);
  await refusedNothing(pen, advanceAtTown({ post: id, to: "accepted-video", handle: "keemin" }, WRIGHT, opts), 403, /"keemin" is not one of your residents/);
});

test("THE ILLUMINATOR advances with her own resident key; a founder's shared key, her household's key or a name asked for holds her hand off", async () => {
  const { pen } = setup();
  const { post: { id } } = await postAtTown(FLARE, FINN, opts);
  await refusedNothing(pen, advanceAtTown({ post: id, to: "accepted-text", handle: "illuminator" }, FOUNDER_SHARED, opts), 403, /^the Illuminator's hand is held off for this key/);
  await refusedNothing(pen, advanceAtTown({ post: id, to: "accepted-text" }, HER_HOUSE_KEY, opts), 403, /^the Illuminator's hand is held off for this key.*acts only with her own resident key/);
  const a = await advanceAtTown({ post: id, to: "accepted-text" }, ILLUMINATOR_OWN, opts);
  assert.deepEqual([a.hand, a.state], ["illuminator", "accepted-text"], "her own key stands as illuminator, never as the wright it also lists");
  assert.equal(JSON.parse(pen.rows().at(-1).payload).hand, "illuminator");
  // a founder's shared key that lists her, unnamed, stands as its founder, never as the Illuminator
  const b = await postAtTown({ ...FLARE, title: "The lantern walk, again" }, FINN, opts);
  assert.equal((await advanceAtTown({ post: b.post.id, to: "declined" }, FOUNDER_SHARED, opts)).hand, "wright");
  // and she reports the town's own
  const t = await postAtTown({ ...FLARE, title: "The town's lantern reel", maker: "town" }, ILLUMINATOR_OWN, opts);
  assert.deepEqual([t.post.author, t.post.fields.maker], ["illuminator", "hh:the-town"]);
});

test("A FLARE'S ADVANCE CARRIES NO BUG PRIVILEGE, AND NAMES A FINISHED STATE: no credit, link, skip, force or stake; reported is no target", async () => {
  const { pen } = setup();
  const { post: { id } } = await postAtTown(FLARE, FINN, opts);
  for (const [extra, re] of [[{ credit: "finn" }, /takes no credit/], [{ link: "https://x.example" }, /takes no link/], [{ force: "why" }, /takes no force/], [{ note: "n" }, /takes no note/]])
    await refusedNothing(pen, advanceAtTown({ post: id, to: "accepted-video", ...extra }, WRIGHT, opts), 422, re);
  await refusedNothing(pen, advanceAtTown({ post: id, skip: "accepted-video", reason: "r" }, WRIGHT, opts), 422, /skip is a bug's/);
  await refusedNothing(pen, advanceAtTown({ post: id, to: "accepted-video", stamps: 2 }, WRIGHT, opts), 422, /a flare takes no stake/);
  await refusedNothing(pen, advanceAtTown({ post: id, to: "reported" }, WRIGHT, opts), 422, /"reported" is not a state a flare advances to/);
  await refusedNothing(pen, advanceAtTown({ post: id, to: "accepted" }, WRIGHT, opts), 422, /to: accepted-text, accepted-video, declined/);
  await refusedNothing(pen, advanceAtTown({ post: id }, WRIGHT, opts), 422, /advance to which state\?/);
});
