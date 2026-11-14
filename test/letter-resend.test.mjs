// letter-resend.test.mjs — `send { resend: "<id of your bounced letter>" }` (POS-1027).
//
//   node --test test/letter-resend.test.mjs
//
//   1. WHO AND WHAT: only the sender's own bounced letter can be resent. Another house's letter reads exactly like an unknown id (404, nothing confirmed), a delivered
//      letter and one merely waiting for its crossing are 409, a malformed id is 422, and a store with no town log refuses by name: nothing is written for any of them.
//   2. THE LINK IS THE REPLACEMENT'S OWN ROW: the town log's send row keeps `args.resend`; the original letter's row, outbox file name and ledger line are untouched
//      (deep-equal before and after); the receipt says so, and the bounce report shows `resent_as` through the join over those rows.
//   3. A RETRY IS NOT A SECOND LETTER: the same nonce answers the first receipt with `duplicate: true` and writes no second row; a different nonce is a second
//      replacement and is refused while the first stands, and the same title on the same day meets the ordinary duplicate-id guard (no bypass).

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fixtureKey, fixtureTown, put } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { sendLetterAsRow } from "../src/town-mail.mjs";
import { readTownJournal } from "../src/town-journal.mjs";
import { resendsBy, judgeResend } from "../src/letter-resend.mjs";
import { storeIndexPooled } from "../src/town-index-store.mjs";

delete process.env.TOWN_PUSH;

const LOST = "wright-2026-07-10-to-limen-the-lost-one";
const WAITING = "wright-2026-07-11-to-limen-still-waiting";
const THEIRS = "limen-2026-07-10-to-wright-theirs-lost";
const DELIVERED = "wright-2026-07-02-to-limen-the-reading";

const db = fixtureTown();
const outbox = (id, from, to, base, date) => put(db, "letters", { id, from_h: from, to_h: to, date, thread: "new", box: "outbox", owner: from,
  path: `WHITE_PAGES/${from}/outbox/${base}.md`, json: JSON.stringify({ id, from, to, date, body: `# ${id}` }), delivered_at: null });
outbox(LOST, "wright", "limen", "lost", "2026-07-10");
outbox(WAITING, "wright", "limen", "waiting", "2026-07-11");
outbox(THEIRS, "limen", "wright", "theirs", "2026-07-10");
for (const [from, base] of [["wright", "lost"], ["limen", "theirs"]])
  put(db, "ledger", { kind: "bounce", date: "2026-07-12", id: null, from_h: from, to_h: null, json: JSON.stringify({ from, path: `WHITE_PAGES/${from}/outbox/${base}.md`, defect: "no recipient" }) });
const IX = await indexStore(db);
const RESTORE = await IX.useInProcess();
test.after(async () => { await RESTORE(); await IX.stop(); });

const odb = () => { const d = new DatabaseSync(":memory:"); d.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)"); return d; };
const flagOn = async (fn) => { process.env.TOWN_SINGLE_LOG = "1"; try { return await fn(); } finally { delete process.env.TOWN_SINGLE_LOG; } };
const rows = (o) => readTownJournal(o, { sinceSeq: 0 });
const send = (args, o) => sendLetterAsRow({ from: "wright", to: "limen", title: "the replacement", thread: "new", body: "Limen —\n\nAgain, to the right address.", ...args }, fixtureKey, db, null, o);
const refusal = async (p) => { try { await p; } catch (e) { return e; } return null; };

test("1 · only your own bounced letter: another's is 404 like an unknown id, a delivered one and a waiting one are 409, a bad id is 422, and nothing is written", async () => {
  const o = odb();
  await flagOn(async () => {
    for (const [resend, code] of [["no-such-letter", 404], [THEIRS, 404], [DELIVERED, 409], [WAITING, 409], ["../etc/passwd", 422]]) {
      const e = await refusal(send({ resend }, o));
      assert.equal(e?.code, code, `${resend} → ${code} (${e?.defect})`);
    }
    assert.equal((await rows(o)).length, 0, "no refusal writes a row");
  });
  const off = await refusal(judgeResend({ resend: LOST }, { from: "wright", ix: storeIndexPooled(null), odb: null, logOn: false }));
  assert.equal(off?.code, 422, "no town log: refused by name");
  assert.match(off.defect, /town log/);
  assert.equal(await judgeResend({}, { from: "wright", ix: null, odb: o, logOn: true }), null, "no resend asked: nothing judged");
});

test("2 · a resend links the replacement and reports the bounce as resent; the original is untouched; a retry writes nothing", async () => {
  const o = odb();
  const ix = storeIndexPooled(null);
  await flagOn(async () => {
    const before = { state: await ix.letterBounceState(LOST), letters: await ix.lettersBetween("wright", "limen") };
    const first = await send({ resend: LOST, nonce: "n-1" }, o);
    assert.equal(first.resend, LOST);
    assert.match(first.resend_note, /LOST|the-lost-one/);
    const log = await rows(o);
    assert.equal(log.length, 1);
    assert.equal(log[0].payload.args.resend, LOST, "the link is the replacement's own send row");
    assert.notEqual(first.letter_id, LOST, "a fresh letter, not the old identity");
    // the original: same state, same letters, no row about it rewritten
    assert.deepEqual(await ix.letterBounceState(LOST), before.state);
    assert.deepEqual(await ix.lettersBetween("wright", "limen"), before.letters);
    // the join
    const joined = await resendsBy(o, "wright");
    assert.equal(joined.get(LOST).letter_id, first.letter_id);
    assert.equal((await resendsBy(o, "limen")).size, 0, "another sender's replacements are not read");
    const report = await ix.mailAwaiting("wright", { resends: joined });
    assert.deepEqual(report.resent.map((r) => [r.bounced, r.letter_id]), [[LOST, first.letter_id]], "the bounce report says it was resent, and as what");
    const bare = await ix.mailAwaiting("wright", {});
    assert.equal(bare.resent, undefined, "with no replacement known the report is the old one");
    // THE RETRY: the same nonce is the first receipt again, and nothing is written
    const again = await send({ resend: LOST, nonce: "n-1" }, o);
    assert.equal(again.duplicate, true);
    assert.equal(again.letter_id, first.letter_id);
    assert.equal((await rows(o)).length, 1, "no second row, so no second delivery or credit");
    // a second replacement, another nonce: one per bounce while it stands
    const second = await refusal(send({ resend: LOST, nonce: "n-2", title: "yet another" }, o));
    assert.equal(second?.code, 409);
    assert.match(second.defect, /already resent/);
    assert.equal((await rows(o)).length, 1);
  });
});

test("3 · a resend is no duplicate-id bypass: the same title on the same day meets the ordinary guard", async () => {
  const o = odb();
  await flagOn(async () => {
    const a = await send({ title: "same day same title" }, o);
    assert.ok(a.letter_id);
    const e = await refusal(send({ title: "same day same title", resend: LOST, nonce: "n-9" }, o));
    assert.equal(e?.code, 409, e?.defect);
    assert.equal((await rows(o)).length, 1);
  });
});
