// awaiting-standing-reply.test.mjs — a reply its sender has written reads as
// queued on the sender's awaiting view (POS-375; Mari, postmark#3016).
//
// THE BUG: under the town log a written letter is a row in the log until the
// crossing, not an outbox file, so the town's correspondence law never saw it.
// The awaiting view kept reading the thread `they_spoke_again` /
// `reply_queued: 0` while the same doorstep listed the reply as standing, and a
// resident answered one letter twice.
//
// THE CHECK IS THE LAW ITSELF. Each case below runs the town's own
// tools/mail-state.mjs twice over one corpus: once without the letter (what the
// office holds), once with it as the law's outbox letter (what the law says a
// queued reply is). `lawWithStanding` over the first must equal the second.
// The one difference allowed is the row's `reason`, because a standing letter
// is not "merged": it says its own tense.
//
//   node --test test/awaiting-standing-reply.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { lawWithStanding, mailAwaitingOf } from "../src/queries.mjs";
import { STANDING } from "../src/town-mail.mjs";
import { unansweredFrom } from "../src/mail-thread.mjs";
import { NO_TOWN, townModuleUrl } from "./fixture-paths.mjs";
import { fixtureDb } from "./fixture.mjs";
import { indexStore, testIndex } from "./helpers/office-under-test.mjs";

const lawUrl = townModuleUrl("tools", "mail-state.mjs");
const { mailState, parseLedger } = lawUrl ? await import(lawUrl).catch(() => ({})) : {};
const SKIP = NO_TOWN || (!mailState && "the town clone has no tools/mail-state.mjs");

// wright's correspondence, one conversation per state the law can turn queued:
//   a: limen spoke, wright answered, limen spoke again   → they_spoke_again
//   b: kio wrote once                                     → new_inbound
//   c: oro wrote twice, both unanswered                   → new_inbound, two leaves
//   d: wright wrote last                                  → last_word_yours
const L = (id, from, to, date, thread = "new") => ({ id, from, to, date, thread, box: "inbox" });
const LETTERS = [
  L("limen-a1", "limen", "wright", "2026-09-01"),
  L("wright-a2", "wright", "limen", "2026-09-02", "limen-a1"),
  L("limen-a3", "limen", "wright", "2026-09-03", "wright-a2"),
  L("kio-b1", "kio", "wright", "2026-09-04"),
  L("oro-c1", "oro", "wright", "2026-09-05"),
  L("oro-c2", "oro", "wright", "2026-09-06", "oro-c1"),
  L("wright-d1", "wright", "sel", "2026-09-07"),
];
const LEDGER = parseLedger?.(LETTERS.map((l) => `- ${l.date} · ${l.id} · ${l.from} → ${l.to} · thread: ${l.thread}`).join("\n"));

// the law's own root: follow `thread` while it names a letter
const byId = new Map(LETTERS.map((l) => [l.id, l]));
const rootOf = (id) => { let cur = id; while (byId.get(cur)?.thread && byId.get(cur).thread !== "new") cur = byId.get(cur).thread; return cur; };

const law = (extra = []) => mailState({ handle: "wright", letters: [...LETTERS, ...extra], ledgerEvents: LEDGER });
const outbox = (id, thread = "new") => ({ id, from: "wright", to: "x", date: "2026-09-08", thread, box: "outbox" });
const standing = (id, thread = "new") => ({ letter_id: id, thread, root: thread === "new" ? id : rootOf(thread) });

// The law's answer, with the queued rows' reason in the standing tense.
const asStanding = (lawOut, ids) => ({
  ...lawOut,
  conversations: lawOut.conversations.map((c) => ids.includes(c.queued_reply_id)
    ? { ...c, reason: `your reply is ${STANDING}` } : c),
});
const withoutDisclosure = ({ reply_queued_standing: _d, ...rest }) => rest;

const CASES = [
  ["a reply to the latest word, they_spoke_again", [["wright-r1", "limen-a3"]]],
  ["a reply to a mid-thread letter, rooted at the conversation", [["wright-r1", "limen-a1"]]],
  ["a first reply, new_inbound", [["wright-r1", "kio-b1"]]],
  ["a reply to one of two unanswered leaves", [["wright-r1", "oro-c1"]]],
  ["a second letter after your own last word, last_word_yours", [["wright-r1", "wright-d1"]]],
  ["a new letter, its own conversation", [["wright-n1", "new"]]],
  ["two replies in one conversation: the first is the queued one", [["wright-r1", "limen-a3"], ["wright-r2", "limen-a1"]]],
  ["replies across conversations at once", [["wright-r1", "limen-a3"], ["wright-r2", "kio-b1"], ["wright-n1", "new"]]],
];

for (const [name, sent] of CASES) {
  test(`the law's queued reply, read from the standing block: ${name}`, { skip: SKIP }, () => {
    const expected = asStanding(law(sent.map(([id, t]) => outbox(id, t))),
      sent.map(([id]) => id));
    const got = lawWithStanding(law(), sent.map(([id, t]) => standing(id, t)));
    assert.deepEqual(withoutDisclosure(got), expected);
    assert.deepEqual(got.reply_queued_standing.letters.sort(), sent.map(([id]) => id).sort(),
      "the view names which of its queued letters are standing ones");
  });
}

test("no standing letters, or a stranger's read: the law exactly as stored", { skip: SKIP }, () => {
  const stored = law();
  assert.equal(lawWithStanding(stored, null), stored);
  assert.equal(lawWithStanding(stored, []), stored);
  assert.deepEqual(mailAwaitingOf(stored, "2026-09-08", "wright", {}), mailAwaitingOf(stored, "2026-09-08", "wright", { standing: [] }));
});

test("a reply into a conversation the law gave you no row for is left as the record has it", { skip: SKIP }, () => {
  // sel's own thread with someone else: wright was never a party, so the law
  // would give it a row with events this read does not hold
  const stored = law();
  assert.equal(lawWithStanding(stored, [{ letter_id: "wright-r1", thread: "elsewhere-1", root: "elsewhere-1" }]), stored);
});

test("the view: threads drop the queued conversation, outgoing names the standing tense", { skip: SKIP }, () => {
  const v = mailAwaitingOf(law(), "2026-09-08", "wright", { standing: [standing("wright-r1", "limen-a3")] });
  assert.equal(v.threads.some((t) => t.thread_of === "limen-a1"), false);
  assert.deepEqual(v.outgoing, [{ id: "wright-r1", conversation: "limen-a1", state: "standing_waiting_crossing", next_actor: "ferry" }]);
  assert.equal(v.summary.reply_queued, 1);
  assert.match(v.reply_queued_standing.note, /your_pending_letters/);
  // a merged outbox letter keeps the merged word
  const merged = mailAwaitingOf(law([outbox("wright-m1", "limen-a3")]), "2026-09-08", "wright", {});
  assert.equal(merged.outgoing[0].state, "merged_waiting_crossing");
});

// ── the store's root walk (town-index-store.mjs § threadRoot) ───────────────
//
// The cases above hand the root in. This one asks the store for it, over the
// fixture town plus three chains: a reply four letters deep, a thread naming a
// letter the town does not have, and two letters that name each other.

const NO_STORE = testIndex() === "office" && "the office.db road reads no standing letters (POS-268)";
const GAP = "limen-2026-07-01-to-wright-the-gap"; // the fixture's they_spoke_again conversation

test("the store roots a reply by walking its thread chain, and leaves a broken or circular one alone", { skip: NO_STORE }, async () => {
  const db = fixtureDb();
  const ins = db.prepare("INSERT INTO letters VALUES (?,?,?,?,?,?,?,?,?,?)");
  const L = (id, from, to, thread) => ins.run(id, from, to, "2026-07-06", thread, "inbox", to, `WHITE_PAGES/${to}/inbox/${id}.md`,
    JSON.stringify({ id, from, to, date: "2026-07-06", thread, box: "inbox" }), "2026-07-06T08:00:00.000Z");
  L("limen-x1", "limen", "wright", "limen-2026-07-03-to-wright-the-return");
  L("wright-x2", "wright", "limen", "limen-x1");
  L("limen-x3", "limen", "wright", "wright-x2");
  L("limen-y1", "limen", "wright", "limen-y2");
  L("limen-y2", "limen", "wright", "limen-y1");
  const ix = await indexStore(db);
  const restore = await ix.useInProcess();
  try {
    const tis = await import("../src/town-index-store.mjs");
    const read = async (standing) => {
      const r = await tis.storeAnswer((c) => tis.mailAwaiting(c, "wright", { standing }));
      assert.equal(r.refused, undefined);
      return r.out;
    };
    const bare = await read(null);
    const rowOf = (v) => v.conversations.find((c) => c.conversation === GAP);
    assert.equal(rowOf(bare).attention_state, "they_spoke_again");

    const deep = await read([{ letter_id: "wright-r1", thread: "limen-x3", to: "limen" }]);
    assert.equal(rowOf(deep).attention_state, "reply_queued", "four letters up, the chain ends at the conversation");
    assert.equal(rowOf(deep).queued_reply_id, "wright-r1");

    for (const thread of ["ghost-1", "limen-y1"]) {
      const left = await read([{ letter_id: "wright-r1", thread, to: "limen" }]);
      assert.deepEqual(left.summary, bare.summary, `${thread}: no conversation of wright's, so nothing turns`);
      assert.equal(left.reply_queued_standing, undefined, thread);
    }

    const fresh = await read([{ letter_id: "wright-n1", thread: "new", to: "limen" }]);
    assert.equal(fresh.conversations.find((c) => c.conversation === "wright-n1")?.attention_state, "reply_queued",
      "a new letter is its own conversation, as the law gives an outbox letter");
  } finally { await restore(); await ix.stop(); db.close(); }
});

// ── the threadless hint reads the same rule (mail-thread.mjs § unansweredFrom) ──
test("the hint's unanswered letters: a standing reply answers its conversation, and a probe without one reads the law alone", { skip: SKIP }, () => {
  const probe = (standing) => ({ hasResident: () => true, mailStateJson: () => JSON.stringify(law()),
    ...(standing ? { mailStanding: () => standing } : {}) });
  const open = (standing) => unansweredFrom(probe(standing), { handle: "wright", sender: "limen" }).map((r) => r.id);
  assert.deepEqual(open(null), ["limen-a3"], "office.db's probe, or no standing letters: as before");
  assert.deepEqual(open([]), ["limen-a3"]);
  assert.deepEqual(open([standing("wright-r1", "limen-a3")]), [], "a reply written to limen's thread answers it");
  assert.deepEqual(open([standing("wright-r1", "kio-b1")]), ["limen-a3"], "a reply in another conversation answers nothing here");
});

// ── the law's own guard: a delivered letter is not queued (review of #446, finding 2) ──
test("a standing row whose letter the record already delivered turns nothing", { skip: SKIP }, () => {
  // wright-d1 is delivered (its conversation reads last_word_yours); its log row
  // can outlive the delivery (a held cursor, a replayed row)
  const stored = law();
  assert.equal(lawWithStanding(stored, [{ letter_id: "wright-d1", thread: null, root: "wright-d1" }]), stored);
  const v = mailAwaitingOf(stored, "2026-09-08", "wright", { standing: [{ letter_id: "wright-d1", thread: null, root: "wright-d1" }] });
  assert.deepEqual(v.outgoing, [], "a delivered letter is never listed as standing_waiting_crossing");
});
