// letter-notes.test.mjs — a household's private note on a letter it received (POS-730).
//   node --import ./test/helpers/sparse-guard.mjs --test test/letter-notes.test.mjs
//
// Darko, 2026-11-06 14:32 EDT, "Build that shape": household { do: "letter-note", args: { letter,
// state: no-reply|waiting|clear, on? } }; any resident can set it; a new private office table; to_answer
// skips marked letters while the awaiting view shows them with mark and age; age from when marked; a
// reply doesn't clear it.
//
// THE ROW-POLICY BOUNDARY IS A REAL ONE: a real Postgres (test/helpers/embedded-store.mjs), the real
// door (callTool), and a connection as `office_api` for the policy. Nothing here mocks RLS. Every
// household, resident, letter and condition is invented.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startStore } from "./helpers/embedded-store.mjs";
import { seedTownIndex } from "./helpers/index-to-store.mjs";
import { emptyTown, put, setMeta } from "./fixture.mjs";
import { unansweredOf, mailBlock } from "../src/household-read-v2.mjs";
import { annotateAwaiting, judgeNote, WAITING_ON_MAX, notesFor } from "../src/letter-notes.mjs";

const store = await startStore({ db: "letter_notes_test" });
after(() => store.stop?.());
const skip = store.skip ?? false;
const asOwner = async (sql, params = []) => {
  const c = await store.connect("world2_owner");
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
};
const asApi = async (setting, fn) => {
  const c = await store.connect("office_api");
  try {
    await c.query("BEGIN");
    if (setting != null) await c.query("SELECT set_config('app.household_keys', $1, true)", [setting]);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) { try { await c.query("ROLLBACK"); } catch { /* gone */ } throw e; } finally { await c.end(); }
};

const SECRET = "the-heron-feather-order";             // an invented condition: it must be found nowhere but its own row
const A = "hh:aa-house", B = "hh:bb-house";
const keyA = { household: "the-aa-house", handles: new Set(["a1", "a2"]) };   // the house's own key
const keyA2 = { household: "the-aa-house", handles: new Set(["a2"]) };        // a second resident's own key
const keyB = { household: "the-bb-house", handles: new Set(["b1"]) };
const nobody = { household: null, handles: new Set() };

// invented letters: s1 writes to a1, a2 and b1; a1 writes to s1; one letter of s1's has not crossed yet
const LA1 = "s1-2026-11-01-to-a1-the-first", LA2 = "s1-2026-11-01-to-a2-the-second", LB1 = "s1-2026-11-01-to-b1-the-third";
const LSENT = "a1-2026-11-02-to-s1-my-own", LPEND = "s1-2026-11-05-to-a1-not-yet-crossed", LREPLY = "a1-2026-11-06-to-s1-re-the-first";

function town({ withReply = false } = {}) {
  const t = emptyTown();
  setMeta(t, "as_of", "fixturesha000000000000000000000000000000");
  setMeta(t, "town_path", "fixture");
  for (const h of ["a1", "a2", "b1", "s1"]) put(t, "residents", { handle: h, json: JSON.stringify({ handle: h, is_office: false, address: { data: { joined: "2026-10-01" }, body: `# ${h}` } }) });
  const letter = (id, from, to, date, delivered) => {
    put(t, "letters", { id, from_h: from, to_h: to, date, thread: null, box: "inbox", owner: to, path: `WHITE_PAGES/${to}/inbox/${id}.md`,
      json: JSON.stringify({ id, from, to, date, body: "# hello" }), delivered_at: delivered ? `${date}T12:00:00.000Z` : null });
    if (delivered) put(t, "ledger", { kind: "delivery", date, id, from_h: from, to_h: to, json: "{}" });
  };
  letter(LA1, "s1", "a1", "2026-11-01", true);
  letter(LA2, "s1", "a2", "2026-11-01", true);
  letter(LB1, "s1", "b1", "2026-11-01", true);
  letter(LSENT, "a1", "s1", "2026-11-02", true);
  letter(LPEND, "s1", "a1", "2026-11-05", false);
  if (withReply) letter(LREPLY, "a1", "s1", "2026-11-06", true);
  const row = (id, from, state = "new_inbound") => ({ conversation: id, attention_state: state, reason: "the latest delivered word is theirs",
    latest_delivered_id: id, latest_delivered_from: from, queued_reply_id: null, latest_event: { ordinal: 1, date: "2026-11-01" }, next_actor: "you", others: [from], letters: 1 });
  const law = (h, rows) => put(t, "mail_state", { handle: h, json: JSON.stringify({ handle: h, language: "sequence, never debt", conversations: rows,
    summary: { they_spoke_last: 0, new_inbound: rows.length, they_spoke_again: 0, reply_queued: 0, last_word_yours: 0, bounced: 0 } }) });
  law("a1", [row(LA1, "s1")]); law("a2", [row(LA2, "s1")]); law("b1", [row(LB1, "s1")]);
  return t;
}

let callTool = null;
if (!skip) {
  await asOwner("TRUNCATE households, household_pins CASCADE");
  await asOwner(`INSERT INTO households (slug, ord, name, residents, since, declared_by)
    VALUES ('aa-house', 0, 'The AA House', ARRAY['a1','a2'], '2026-10-01', 'a1'),
           ('bb-house', 1, 'The BB House', ARRAY['b1'], '2026-10-01', 'b1')`);
  const w = await store.connect("law_ingester");
  await seedTownIndex(w, town());
  await w.end();
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = store.url("office_api");
  ({ callTool } = await import("../src/mcp.mjs"));
}

const note = (args, key = keyA) => callTool("household", { do: "letter-note", args }, { key });
const awaiting = (handle, key) => callTool("household", { read: "mail", view: "awaiting", handle }, { key });
const bounceOf = (r) => (r?.error ? r : r?.result?.error ? r.result : null);
const rows = () => asOwner("SELECT household, letter, state, waiting_on, marked_by, marked_at FROM letter_notes ORDER BY household, letter");
const fresh = () => asOwner("TRUNCATE letter_notes");
const rowOf = (view, letter) => (view?.conversations ?? []).find((c) => c.latest_delivered_id === letter);

// ── the act: validation ──────────────────────────────────────────────────────

test("judgeNote: `waiting` needs `on`, at most 140 characters; `on` belongs to waiting alone; the state is one of three", () => {
  assert.deepEqual(judgeNote({ letter: "x", state: "no-reply" }), { letter: "x", state: "no-reply", on: null });
  assert.deepEqual(judgeNote({ letter: " x ", state: "waiting", on: "  the food  " }), { letter: "x", state: "waiting", on: "the food" });
  assert.equal(judgeNote({ letter: "x", state: "waiting", on: "é".repeat(WAITING_ON_MAX) }).on.length, WAITING_ON_MAX, "140 characters is allowed");
  for (const [args, field] of [
    [{ state: "no-reply" }, "letter"], [{ letter: "a b", state: "no-reply" }, "letter"], [{ letter: "x" }, "state"], [{ letter: "x", state: "later" }, "state"],
    [{ letter: "x", state: "waiting" }, "on"], [{ letter: "x", state: "waiting", on: "   " }, "on"], [{ letter: "x", state: "waiting", on: "z".repeat(WAITING_ON_MAX + 1) }, "on"],
    [{ letter: "x", state: "no-reply", on: "why" }, "on"], [{ letter: "x", state: "clear", on: "why" }, "on"],
  ]) assert.throws(() => judgeNote(args), (e) => e.code === 422 && e.field === field, JSON.stringify(args));
});

test("the door refuses a bad note before it reads or writes anything, and says which field", { skip }, async () => {
  await fresh();
  for (const [args, field] of [[{ letter: LA1, state: "waiting" }, "on"], [{ letter: LA1, state: "waiting", on: "z".repeat(141) }, "on"], [{ letter: LA1, state: "bogus" }, "state"]]) {
    const r = bounceOf(await note(args));
    assert.equal(r?.code, 422, JSON.stringify(r));
    assert.equal(r.field, field);
  }
  assert.deepEqual(await rows(), []);
});

// ── the act: whose letter ────────────────────────────────────────────────────

test("a letter the household did not receive is refused: another house's inbound, a merely sent letter, one not yet crossed, and one that does not exist", { skip }, async () => {
  await fresh();
  const words = new Set();
  for (const letter of [LB1, LSENT, LPEND, "no-such-letter"]) {
    const r = bounceOf(await note({ letter, state: "no-reply" }, keyA));
    assert.equal(r?.code, 403, `${letter}: ${JSON.stringify(r)}`);
    words.add(r.defect);
  }
  assert.equal(words.size, 1, "every refusal says the same thing, so it teaches nothing about whose letters exist");
  assert.deepEqual(await rows(), []);
  // and the other way round: B cannot note A's letters
  assert.equal(bounceOf(await note({ letter: LA1, state: "no-reply" }, keyB))?.code, 403);
  assert.deepEqual(await rows(), []);
});

test("a key declaring no household grants nothing: no resident, no note", { skip }, async () => {
  await fresh();
  assert.equal(bounceOf(await note({ letter: LA1, state: "no-reply" }, nobody))?.code, 403);
  assert.deepEqual(await rows(), []);
});

// ── set, change, clear; any resident ─────────────────────────────────────────

test("no-reply and waiting are set, privately and once per letter; a second resident of the house changes and clears the common note; clear removes the row", { skip }, async () => {
  await fresh();
  const set = await note({ letter: LA1, state: "waiting", on: SECRET }, keyA);
  assert.equal(bounceOf(set), null, JSON.stringify(set));
  assert.equal(set.result.state, "waiting");
  assert.equal(set.result.on, SECRET);
  assert.equal(set.result.age_days, 0);
  assert.match(set.result.note, /private to your household/);
  let [r] = await rows();
  assert.deepEqual([r.household, r.letter, r.state, r.waiting_on, r.marked_by], [A, LA1, "waiting", SECRET, "a1"], "keyed by the HOUSEHOLD, marked by the acting resident");
  // a second resident of the house (its own key holds only a2) sets and then clears the same note
  assert.equal(bounceOf(await note({ letter: LA2, state: "no-reply" }, keyA2)), null);
  assert.deepEqual((await rows()).map((x) => [x.letter, x.state, x.marked_by]), [[LA1, "waiting", "a1"], [LA2, "no-reply", "a2"]]);
  const changed = await note({ letter: LA1, state: "no-reply" }, keyA2);
  assert.equal(changed.result.state, "no-reply");
  assert.equal(changed.result.on, undefined, "no condition kept on a no-reply");
  assert.equal((await rows()).find((x) => x.letter === LA1).waiting_on, null);
  const cleared = await note({ letter: LA1, state: "clear" }, keyA2);
  assert.equal(cleared.result.cleared, true);
  assert.deepEqual((await rows()).map((x) => x.letter), [LA2], "clear removes the row; nothing of the condition is kept");
  assert.equal((await note({ letter: LA1, state: "clear" }, keyA)).result.cleared, false, "clearing what is not there says so");
});

test("the age runs from the mark: the same mark again keeps it, a changed mark starts a new one", { skip }, async () => {
  await fresh();
  await note({ letter: LA1, state: "waiting", on: "the first thing" });
  await asOwner("UPDATE letter_notes SET marked_at = now() - interval '9 days'");
  await note({ letter: LA1, state: "waiting", on: "the first thing" });
  const [same] = await rows();
  assert.ok(Date.now() - Date.parse(same.marked_at) > 8.5 * 86_400_000, "the same mark again did not restart the age");
  await note({ letter: LA1, state: "waiting", on: "a different thing" });
  const [moved] = await rows();
  assert.ok(Date.now() - Date.parse(moved.marked_at) < 60_000, "a changed condition is a new mark");
});

// ── the row-policy boundary, as office_api ───────────────────────────────────

test("THE POLICY: another household cannot read, change or clear a note, and a connection that declared none sees and writes nothing", { skip }, async () => {
  await fresh();
  await note({ letter: LA1, state: "waiting", on: SECRET });
  const reads = async (keys) => asApi(keys, async (c) => Number((await c.query("SELECT count(*)::int AS n FROM letter_notes")).rows[0].n));
  assert.equal(await reads(A), 1, "the house's own spelling sees it");
  assert.equal(await reads(B), 0, "B's does not");
  assert.equal(await reads(null), 0, "a transaction that declared nothing sees nothing");
  assert.equal(await reads(`${B},solo:b1`), 0, "a set of B's spellings is still B's");
  assert.equal(await reads(`${B},${A}`), 1, "a key that holds A's spelling is A's: the policy compares the set");
  const touch = (keys, sql, params = []) => asApi(keys, async (c) => (await c.query(sql, params)).rowCount);
  assert.equal(await touch(B, "UPDATE letter_notes SET state = 'no-reply', waiting_on = NULL"), 0, "B updated nothing of A's");
  assert.equal(await touch(B, "DELETE FROM letter_notes"), 0, "B deleted nothing of A's");
  assert.equal(await touch(null, "DELETE FROM letter_notes"), 0);
  await assert.rejects(touch(B, "INSERT INTO letter_notes (household, letter, state, marked_at, marked_by) VALUES ($1, 'x', 'no-reply', now(), 'b1')", [A]), /row-level security/, "B cannot write a row into A's name");
  await assert.rejects(touch(null, "INSERT INTO letter_notes (household, letter, state, marked_at, marked_by) VALUES ($1, 'x', 'no-reply', now(), 'b1')", [A]), /row-level security/);
  assert.equal((await rows()).length, 1, "and A's note stands, whole");
  assert.equal((await rows())[0].waiting_on, SECRET);
  // the export roles read nothing of it
  const [g] = await asOwner("SELECT has_table_privilege('snapshot_reader', 'letter_notes', 'SELECT') AS snap, has_table_privilege('office_api', 'letter_notes', 'DELETE') AS api");
  assert.deepEqual(g, { snap: false, api: true });
});

test("the table itself refuses a waiting note with no condition, a no-reply with one, and an over-long condition (below the door's own check)", { skip }, async () => {
  const put = (state, on) => asOwner("INSERT INTO letter_notes (household, letter, state, waiting_on, marked_at, marked_by) VALUES ($1, $2, $3, $4, now(), 'x')", [A, `chk-${Math.random()}`, state, on]);
  await assert.rejects(put("waiting", null), /letter_notes_waiting_names_its_condition/);
  await assert.rejects(put("waiting", "   "), /letter_notes_waiting_names_its_condition/);
  await assert.rejects(put("no-reply", "a condition"), /letter_notes_waiting_names_its_condition/);
  await assert.rejects(put("waiting", "z".repeat(141)), /waiting_on_check|check/);
  await assert.rejects(put("someday", null), /state_check|check/);
});

// ── private: nothing public carries it ───────────────────────────────────────

test("PRIVATE: no act is written, no other table holds a byte of the note, and the other house's reads carry nothing of it", { skip }, async () => {
  await fresh();
  const before = Number((await asOwner("SELECT count(*)::int AS n FROM acts"))[0].n);
  await note({ letter: LA1, state: "waiting", on: SECRET });
  assert.equal(Number((await asOwner("SELECT count(*)::int AS n FROM acts"))[0].n), before, "a note is not an act: acts are published");
  const tables = (await asOwner("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'letter_notes'")).map((r) => r.table_name);
  const holding = [];
  for (const t of tables) {
    const [{ n }] = await asOwner(`SELECT count(*)::int AS n FROM "${t}" x WHERE x::text LIKE $1`, [`%${SECRET}%`]);
    if (n) holding.push(t);
  }
  assert.deepEqual(holding, [], "the condition is in no table but its own");
  const theirs = JSON.stringify(await awaiting("b1", keyB));
  assert.ok(!theirs.includes(SECRET) && !theirs.includes("\"note\""), "B's awaiting read carries no note of A's");
  const aKeyOnB = JSON.stringify(await awaiting("b1", keyA));
  assert.ok(!aKeyOnB.includes(SECRET), "and A's key reading B's resident is not a way to A's notes either");
  const doorstep = JSON.stringify(await callTool("household", { read: "doorstep", handle: "b1" }, { key: keyB }));
  assert.ok(!doorstep.includes(SECRET), "nor B's doorstep");
});

// ── the awaiting view: marked letters stay, with mark, condition and age ─────

test("the awaiting view still lists a marked letter, with its mark, condition and age, on the household's key only; the unmarked rows are untouched", { skip }, async () => {
  await fresh();
  const plain = await awaiting("a1", keyA);
  assert.ok(rowOf(plain, LA1), "the letter awaits");
  assert.equal(rowOf(plain, LA1).note, undefined);
  await note({ letter: LA1, state: "waiting", on: SECRET });
  await asOwner("UPDATE letter_notes SET marked_at = now() - interval '30 days'");
  const marked = await awaiting("a1", keyA);
  const r = rowOf(marked, LA1);
  assert.ok(r, "the marked letter is still listed");
  assert.equal(r.note.state, "waiting");
  assert.equal(r.note.on, SECRET);
  assert.equal(r.note.age_days, 30, "the age is from the mark, and waiting never expired");
  assert.equal(marked.conversations.length, plain.conversations.length, "the view's rows are the town's own, none dropped");
  assert.deepEqual(Object.keys(r).filter((k) => k !== "note").sort(), Object.keys(rowOf(plain, LA1)).sort(), "the row is otherwise unchanged");
  // a housemate reads the common note on their own resident's letter? the note is on the letter, so only the recipient's view lists it
  assert.equal(rowOf(await awaiting("a2", keyA2), LA2).note, undefined, "another letter, no note");
  // a key that does not hold the resident reads the view as it always read: no notes
  assert.equal(rowOf(await awaiting("a1", keyB), LA1)?.note, undefined);
});

test("a reply does not clear a mark: the reply is delivered, the letter keeps its note, and the row stands", { skip }, async () => {
  await fresh();
  await note({ letter: LA1, state: "no-reply" });
  const w = await store.connect("law_ingester");
  await seedTownIndex(w, town({ withReply: true }));
  await w.end();
  assert.equal(Number((await asOwner("SELECT count(*)::int AS n FROM town_ledger WHERE id = $1", [LREPLY]))[0].n), 1, "the reply is in the ledger now");
  assert.equal(rowOf(await awaiting("a1", keyA), LA1).note.state, "no-reply", "the mark survived the reply");
  assert.equal((await rows()).length, 1);
  const w2 = await store.connect("law_ingester");
  await seedTownIndex(w2, town());
  await w2.end();
});

test("annotateAwaiting is pure: a view with no marked letter comes back as the same object, and a thread row is marked by its last_id", () => {
  const view = { conversations: [{ latest_delivered_id: "x" }], threads: [{ last_id: "y" }] };
  assert.equal(annotateAwaiting(view, new Map()), view);
  assert.equal(annotateAwaiting(view, new Map([["z", { state: "no-reply", marked_at: "2026-11-01T00:00:00.000Z", marked_by: "a1" }]])), view);
  const out = annotateAwaiting(view, new Map([["y", { state: "waiting", waiting_on: "rain", marked_at: "2026-11-01T00:00:00.000Z", marked_by: "a1" }]]), { nowMs: Date.parse("2026-11-04T01:00:00.000Z") });
  assert.deepEqual(out.threads[0].note, { state: "waiting", on: "rain", marked_at: "2026-11-01T00:00:00.000Z", age_days: 3, marked_by: "a1" });
  assert.equal(out.conversations[0].note, undefined);
  assert.equal(view.threads[0].note, undefined, "the input is not mutated");
});

// ── the count: to_answer skips a marked letter ───────────────────────────────

const WINDOW = [
  { id: "in1", from_h: "s1", to_h: "a1", thread: null, date: "2026-11-01", delivered_at: "2026-11-01T12:00:00Z" },
  { id: "in2", from_h: "s2", to_h: "a1", thread: null, date: "2026-11-02", delivered_at: "2026-11-02T12:00:00Z" },
  { id: "in3", from_h: "s3", to_h: "a2", thread: null, date: "2026-11-03", delivered_at: "2026-11-03T12:00:00Z" },
];
const SCOPE = { mine: new Set(["a1", "a2"]), house: ["a1", "a2"] };

test("unansweredOf skips marked letters and counts the rest; unmarked it is what it always was", () => {
  assert.equal(unansweredOf(WINDOW, SCOPE), 3);
  assert.equal(unansweredOf(WINDOW, { ...SCOPE, noted: new Set(["in1"]) }), 2);
  assert.equal(unansweredOf(WINDOW, { ...SCOPE, noted: new Map([["in1", {}], ["in3", {}]]) }), 1, "a Map of notes works as a Set of ids");
  assert.equal(unansweredOf(WINDOW, { ...SCOPE, noted: new Set(["in1", "in2", "in3"]) }), 0);
  assert.equal(unansweredOf(WINDOW, { ...SCOPE, noted: new Set(["not-a-letter"]) }), 3, "a note on no letter of the window changes nothing");
  assert.equal(unansweredOf(WINDOW, { ...SCOPE, noted: null }), 3);
});

test("the count changes while the marked letter stays in the awaiting view: real notes from the store feed the count", { skip }, async () => {
  await fresh();
  const none = await notesFor(["a1", "a2"]);
  assert.equal(none.notes.size, 0);
  assert.equal(unansweredOf(WINDOW, { ...SCOPE, noted: none.notes }), 3);
  await note({ letter: "in1", state: "no-reply" }).catch(() => {}); // not delivered in the fixture town: refused, so no note
  assert.equal((await notesFor(["a1", "a2"])).notes.size, 0, "a letter the town index does not hold is not noted");
  await note({ letter: LA1, state: "no-reply" });
  const got = await notesFor(["a1", "a2"]);
  assert.deepEqual([...got.notes.keys()], [LA1]);
  const win = [{ id: LA1, from_h: "s1", to_h: "a1", thread: null, date: "2026-11-01", delivered_at: "2026-11-01T12:00:00Z" },
    { id: LA2, from_h: "s1", to_h: "a2", thread: null, date: "2026-11-01", delivered_at: "2026-11-01T12:00:00Z" }];
  assert.equal(unansweredOf(win, { ...SCOPE, noted: new Map() }), 2);
  assert.equal(unansweredOf(win, { ...SCOPE, noted: got.notes }), 1, "the marked letter left the count");
  assert.ok(rowOf(await awaiting("a1", keyA), LA1), "and it is still in the awaiting view");
  // another house's reader of its own letters is never handed A's notes
  assert.equal((await notesFor(["b1"])).notes.size, 0);
  assert.deepEqual(mailBlock({ unanswered: 1, notesUnavailable: "x" }).notes_unavailable, "x");
  assert.equal("notes_unavailable" in mailBlock({ unanswered: 1 }), false, "no new key unless the notes could not be read");
});

// ── a store without the table ────────────────────────────────────────────────

test("a store with no letter_notes table refuses the write (503, nothing written) and reads as no notes; it never falls back to a file", { skip }, async () => {
  await asOwner("ALTER TABLE letter_notes RENAME TO letter_notes_away");
  try {
    const r = bounceOf(await note({ letter: LA1, state: "no-reply" }));
    assert.equal(r?.code, 503, JSON.stringify(r));
    assert.match(r.defect, /note table is not there/);
    assert.match(r.hint, /nothing was written/);
    const got = await notesFor(["a1"]);
    assert.equal(got.notes.size, 0);
    assert.equal(got.unavailable, undefined, "a missing table is no notes, truly: nothing could have been written");
    assert.ok(rowOf(await awaiting("a1", keyA), LA1), "and the awaiting view still answers");
  } finally { await asOwner("ALTER TABLE letter_notes_away RENAME TO letter_notes"); }
});
