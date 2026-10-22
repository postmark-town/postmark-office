// letter-amend.test.mjs — POS-666: a sender amends or withdraws a letter that
// has not sailed, and the town log keeps every version.
//
//   node --test test/letter-amend.test.mjs
//
// Ruled by Darko 2026-10-22 (POS-666): "We just need parity" with git-era
// letters, where a sender could edit a letter with a commit or retract it with
// a commit before the crossing. Only your own letter, only while it is pending;
// the receiver sees only the last version and the letter's own record keeps
// every earlier one; a withdrawn letter never sails and the record keeps the
// withdrawal. The crossing half (the drain sails the last body, never a
// withdrawn letter) is test/town-bridge.test.mjs § POS-666.
//
// THE FLIPS: each `flip:` line below names the source line that, removed, turns
// its test red.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EventEmitter } from "node:events";

import { fixtureKey, fixtureTown } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";
import { hotLetters, hotMailBlock, sendLetterAsRow } from "../src/town-mail.mjs";
import { readTownJournal } from "../src/town-journal.mjs";
import {
  amendLetterAtOffice, withdrawLetterAtOffice, pendingLetterRead, CROSSING_UNDER_WAY,
} from "../src/letter-amend.mjs";
import { foldLetters, standingLetters, AMEND_ACT, WITHDRAW_ACT, SEND_ACT } from "../src/letter-fold.mjs";
import { heldLockArgv, withTownLockHeld, LOCK_BUSY } from "../src/town-lock.mjs";

delete process.env.TOWN_PUSH;

const db = fixtureTown();
const IX = await indexStore(db);
const RESTORE = await IX.useInProcess();
test.after(async () => { await RESTORE(); await IX.stop(); });

const odb = () => {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  return d;
};
const flagOn = async (fn) => {
  process.env.TOWN_SINGLE_LOG = "1";
  try { return await fn(); } finally { delete process.env.TOWN_SINGLE_LOG; }
};
/** The lock, injected: records that the section ran inside it. */
const lockLog = [];
const lock = async (fn, opts) => { lockLog.push(opts?.busy?.defect ?? null); return fn(); };

const letter = { from: "wright", to: "limen", title: "a fine hat", thread: "new", body: "Limen —\n\nThe first draft." };
const limenKey = { household: "limen-house", handles: new Set(["limen"]) };
const rowsOf = async (o) => readTownJournal(o, { sinceSeq: 0 });

// ── the fold, pure ──────────────────────────────────────────────────────────

test("the fold: the last amendment's body stands, every version is kept in order, and a withdrawal removes the letter from what sails", () => {
  const send = { seq: 1, cls: "letter", act: SEND_ACT, handle: "wright", writtenAt: "t1", payload: { id: "L", args: { to: "limen", body: "one" } } };
  const a = (seq, body, extra = {}) => ({ seq, cls: "letter", act: AMEND_ACT, handle: "wright", writtenAt: `t${seq}`, payload: { letter_seq: 1, body }, ...extra });
  const rows = [send, a(2, "two"), a(3, "three")];
  const f = foldLetters(rows);
  assert.equal(f.letters[0].args.body, "three", "the last amendment's body is the one that sails");
  assert.deepEqual(f.letters[0].versions.map((v) => v.body), ["one", "two", "three"], "every version, the first included, in order");
  assert.deepEqual(f.words.map((w) => w.letter), [1, 1]);
  assert.deepEqual(standingLetters(rows)[0].amended, [{ seq: 2, written_at: "t2" }, { seq: 3, written_at: "t3" }]);

  const withdrawn = [...rows, { seq: 4, cls: "letter", act: WITHDRAW_ACT, handle: "wright", writtenAt: "t4", payload: { letter_seq: 1 } }];
  assert.deepEqual(standingLetters(withdrawn), [], "a withdrawn letter does not stand");
  assert.equal(foldLetters(withdrawn).letters[0].withdrawn.seq, 4, "and the fold keeps the withdrawal");
});

test("the fold refuses a later word that is not the sender's, follows a withdrawal, or names no pending letter", () => {
  const send = { seq: 1, cls: "letter", act: SEND_ACT, handle: "wright", payload: { id: "L", args: { body: "one" } } };
  const rows = [
    send,
    { seq: 2, cls: "letter", act: AMEND_ACT, handle: "limen", payload: { letter_seq: 1, body: "not yours" } },
    { seq: 3, cls: "letter", act: WITHDRAW_ACT, handle: "wright", payload: { letter_seq: 1 } },
    { seq: 4, cls: "letter", act: AMEND_ACT, handle: "wright", payload: { letter_seq: 1, body: "too late" } },
    { seq: 5, cls: "letter", act: AMEND_ACT, handle: "wright", payload: { letter_seq: 99, body: "sailed already" } },
  ];
  const f = foldLetters(rows);
  // flip: `target.row.handle !== r.handle` in letter-fold.mjs § foldLetters
  assert.equal(f.letters[0].versions.length, 1, "no other hand's body, and none after the withdrawal");
  assert.deepEqual(f.words.map((w) => [w.row.seq, w.letter]), [[2, null], [3, 1], [4, null], [5, null]]);
});

// ── the door: amend ─────────────────────────────────────────────────────────

test("amend: only the last version stands for the sender, the receipt says only it sails, and the log keeps all three bodies", async () => {
  const o = odb();
  await flagOn(async () => {
    const sent = await sendLetterAsRow(letter, fixtureKey, db, null, o);
    lockLog.length = 0;
    const r1 = await amendLetterAtOffice({ id: sent.letter_id, body: "Limen —\n\nThe second draft." }, fixtureKey, { db, odb: o, lock });
    const r2 = await amendLetterAtOffice({ id: sent.letter_id, body: "Limen —\n\nThe last word." }, fixtureKey, { db, odb: o, lock });
    assert.equal(r1.amended, true);
    assert.equal(r2.version, 3);
    assert.match(r2.note, /^only this version sails/);
    // flip: the `held(async () => …)` wrapper in letter-amend.mjs § amendLetterAtOffice
    assert.deepEqual(lockLog, [CROSSING_UNDER_WAY.defect, CROSSING_UNDER_WAY.defect], "each amendment is judged and written under the town lock");

    const standing = await hotLetters(o, fixtureKey);
    assert.equal(standing.length, 1, "one letter, not three");
    assert.equal(standing[0].payload.args.body, "Limen —\n\nThe last word.");
    const block = await hotMailBlock(o, fixtureKey);
    assert.equal(block.standing[0].amended.length, 2, "the pending view says it was amended twice");
    assert.doesNotMatch(block.note, /deliver/, "the pending note promises no delivery (the office never lies)");

    const all = await rowsOf(o);
    assert.deepEqual(all.map((r) => r.act), [SEND_ACT, AMEND_ACT, AMEND_ACT], "nothing rewritten, nothing deleted: three rows");
    assert.equal(all[0].payload.args.body, "Limen —\n\nThe first draft.", "the send row keeps the first body");

    const read = await pendingLetterRead(o, fixtureKey, sent.letter_id);
    assert.deepEqual(read.versions.map((v) => v.body), ["Limen —\n\nThe first draft.", "Limen —\n\nThe second draft.", "Limen —\n\nThe last word."]);
    assert.equal(read.body, "Limen —\n\nThe last word.");
    assert.equal(await pendingLetterRead(o, limenKey, sent.letter_id), null, "nobody else's key reads a pending letter");
  });
});

test("amend: the same body writes nothing; an empty body and a body over the send's courtesy are refused, and nothing is written", async () => {
  const o = odb();
  await flagOn(async () => {
    const sent = await sendLetterAsRow({ ...letter, title: "the same" }, fixtureKey, db, null, o);
    const same = await amendLetterAtOffice({ id: sent.letter_id, body: letter.body }, fixtureKey, { db, odb: o, lock });
    assert.equal(same.amended, false);
    await assert.rejects(() => amendLetterAtOffice({ id: sent.letter_id, body: "  " }, fixtureKey, { db, odb: o, lock }), { code: 422 });
    // flip: the validateLetter(...) line in letter-amend.mjs § amendLetterAtOffice
    await assert.rejects(() => amendLetterAtOffice({ id: sent.letter_id, body: "x".repeat(100_001) }, fixtureKey, { db, odb: o, lock }), { code: 413 });
    assert.equal((await rowsOf(o)).length, 1, "only the send row");
  });
});

test("amend and withdraw reach only your own pending letter: another household's key is told it has no such letter, and nothing is written", async () => {
  const o = odb();
  await flagOn(async () => {
    const sent = await sendLetterAsRow({ ...letter, title: "mine" }, fixtureKey, db, null, o);
    await assert.rejects(() => amendLetterAtOffice({ id: sent.letter_id, body: "hijacked" }, limenKey, { db, odb: o, lock }),
      (e) => e.code === 404 && /no letter of yours/.test(e.defect));
    await assert.rejects(() => withdrawLetterAtOffice({ id: sent.letter_id }, limenKey, { odb: o, lock }), { code: 404 });
    assert.equal((await rowsOf(o)).length, 1);
  });
});

// ── the door: withdraw ──────────────────────────────────────────────────────

test("withdraw: the letter leaves the sender's pending view, the log keeps the withdrawal, and a second withdrawal or a later amendment is refused", async () => {
  const o = odb();
  await flagOn(async () => {
    const sent = await sendLetterAsRow({ ...letter, title: "take it back" }, fixtureKey, db, null, o);
    const r = await withdrawLetterAtOffice({ id: sent.letter_id }, fixtureKey, { odb: o, lock });
    assert.equal(r.withdrawn, true);
    assert.match(r.note, /nothing was deleted/);
    assert.deepEqual(await hotLetters(o, fixtureKey), [], "it no longer stands");
    const all = await rowsOf(o);
    assert.deepEqual(all.map((x) => x.act), [SEND_ACT, WITHDRAW_ACT], "the send row is still there, beside its withdrawal");
    await assert.rejects(() => withdrawLetterAtOffice({ id: sent.letter_id }, fixtureKey, { odb: o, lock }), (e) => e.code === 409 && /already withdrawn/.test(e.defect));
    await assert.rejects(() => amendLetterAtOffice({ id: sent.letter_id, body: "after all" }, fixtureKey, { db, odb: o, lock }), { code: 409 });
    const read = await pendingLetterRead(o, fixtureKey, sent.letter_id);
    assert.equal(read.withdrawn.seq, all[1].seq, "its own read says it was withdrawn");
  });
});

test("a letter whose file already stands in the town's record has sailed and is refused, never amended", async () => {
  const o = odb();
  const clone = tempDir("pm-amend-sailed-");
  await flagOn(async () => {
    const sent = await sendLetterAsRow({ ...letter, title: "on the boat" }, fixtureKey, db, null, o);
    const file = (await rowsOf(o))[0].payload.file;
    mkdirSync(dirname(join(clone, file)), { recursive: true });
    writeFileSync(join(clone, file), "the record's copy");
    // flip: the existsSync(join(clone, …)) line in letter-amend.mjs § judgeTarget
    await assert.rejects(() => amendLetterAtOffice({ id: sent.letter_id, body: "too late" }, fixtureKey, { db, clone, odb: o, lock }),
      (e) => e.code === 409 && /already sailed/.test(e.defect));
    assert.equal((await rowsOf(o)).length, 1);
  });
});

test("a crossing holding the lock past the wait refuses the act in its own words, and nothing is written", async () => {
  const o = odb();
  await flagOn(async () => {
    const sent = await sendLetterAsRow({ ...letter, title: "the boat is loading" }, fixtureKey, db, null, o);
    const busy = async (_fn, opts) => { throw Object.assign(new Error(opts.busy.defect), opts.busy); };
    await assert.rejects(() => amendLetterAtOffice({ id: sent.letter_id, body: "now" }, fixtureKey, { db, odb: o, lock: busy }),
      (e) => e.code === 503 && e.defect === "a crossing is under way, and nothing was changed" && /sailed as written/.test(e.hint));
    await assert.rejects(() => withdrawLetterAtOffice({ id: sent.letter_id }, fixtureKey, { odb: o, lock: busy }), { code: 503 });
    assert.equal((await rowsOf(o)).length, 1);
  });
});

test("an office with no town log has no pending letter to change, and says so", async () => {
  const o = odb();
  await assert.rejects(() => amendLetterAtOffice({ id: "x", body: "y" }, fixtureKey, { db, odb: o, lock }), (e) => e.code === 503 && /standing-mail tense/.test(e.defect));
  await assert.rejects(() => withdrawLetterAtOffice({ id: "x" }, fixtureKey, { odb: o, lock }), { code: 503 });
});

// ── the lock: held around an in-process section ─────────────────────────────

test("withTownLockHeld: shared flock on town.lock, the section runs only after the holder says it holds, and stdin's close frees it", async () => {
  const [file, args] = heldLockArgv();
  assert.equal(file, "/usr/bin/flock");
  assert.deepEqual(args.slice(0, 3), ["-s", "-w", "30"], "shared, so the crossing (exclusive) is excluded and other shared writers are not");
  assert.match(args[3], /town\.lock$/);

  const fake = (speaks) => () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdin = { ended: false, end() { this.ended = true; } };
    setImmediate(() => (speaks ? child.stdout.emit("data", "held\n") : child.emit("exit", 1)));
    fake.last = child;
    return child;
  };
  let ran = false;
  const out = await withTownLockHeld(async () => { ran = true; return 7; }, { flock: true, spawnImpl: fake(true) });
  assert.equal(out, 7);
  assert.equal(ran, true);
  assert.equal(fake.last.stdin.ended, true, "the lock is let go when the section ends");

  ran = false;
  await assert.rejects(() => withTownLockHeld(async () => { ran = true; }, { flock: true, spawnImpl: fake(false), busy: CROSSING_UNDER_WAY }),
    (e) => e.code === 503 && e.defect === CROSSING_UNDER_WAY.defect);
  assert.equal(ran, false, "a lock not taken runs nothing");
  await assert.rejects(() => withTownLockHeld(async () => {}, { flock: true, spawnImpl: fake(false) }), (e) => e.defect === LOCK_BUSY.defect);
});
