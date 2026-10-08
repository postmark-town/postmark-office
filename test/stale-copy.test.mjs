// stale-copy.test.mjs — POS-332: the doorstep names the crossing its copy has
// caught up to, and a copy that has not caught up never refuses a real reply.
//
// The case (office hours 2026-10-02, Q7 and Q15; postmark#3392): the doorstep's
// `as_of` is a commit, and nothing told a reader whether the office's copy of
// the town record held the last crossing. Nyx logged ten reads that trailed one,
// and on 2026-09-29 three 422s on one reply's `thread:` that sailed untouched
// once the copy caught up.
//
// The copy each case reads is a real index: office.db (the fixture) and the
// store's twin seeded from it (POS-268), so the switched door is the one asked.
//
//   node --test test/stale-copy.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

import { copyBlock, crossingSailsAt, currentCrossing, nextCrossingForDoorstep, CROSSING_SEAL_SUBJECT } from "../src/crossings.mjs";
import { indexCopy } from "../src/queries.mjs";
import { doorstepBundle } from "../src/doorstep-bundle.mjs";
import { validateLetter, enqueueLetter } from "../src/write.mjs";
import { sendLetterAsRow } from "../src/town-mail.mjs";
import { fixtureDb, tempClone, fixtureKey } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";

delete process.env.TOWN_PUSH;
const AS_OF = "fixturesha000000000000000000000000000000";

// THE COPY'S HISTORY: the fixture's three commits (newest 2026-07-12T09:00Z)
// plus two crossings' seals, the newer one the 12:00Z boat of 07-11, sealed
// four minutes after it sailed, as the Postmark Pen seals one.
const SEAL_OLD = "2026-07-11T00:04:10.000Z";
const SEAL = "2026-07-11T12:04:23.000Z";
const NEWEST = "2026-07-12T09:00:00.000Z";
const CROSSING = currentCrossing(Date.parse(SEAL));        // 59: the boat that sailed 07-11 12:00Z
const BEFORE_NEXT = Date.parse("2026-07-11T20:00:00Z");    // the copy holds the last boat by the timetable
const AFTER_NEXT = Date.parse("2026-07-12T09:30:00Z");     // 07-12 00:00Z has sailed by the timetable; the copy lacks it

function copyDb(path = ":memory:", { seals = true } = {}) {
  const db = fixtureDb(path);
  if (seals) {
    const log = db.prepare("INSERT INTO repo_log VALUES (?,?,?,?,?,?)");
    log.run("s0sha", SEAL_OLD, "Postmark Pen", CROSSING_SEAL_SUBJECT, "M", "WHITE_PAGES/seal.json");
    log.run("s1sha", SEAL, "Postmark Pen", CROSSING_SEAL_SUBJECT, "M", "WHITE_PAGES/seal.json");
    log.run("s1sha", SEAL, "Postmark Pen", CROSSING_SEAL_SUBJECT, "M", "WHITE_PAGES/seal.html");
  }
  return db;
}

const IX = await indexStore(copyDb());
const IX_RESTORE = await IX.useInProcess();
test.after(async () => { await IX_RESTORE(); await IX.stop(); });
const tis = await import("../src/town-index-store.mjs");
const storeIx = () => tis.storeIndexPooled(null);

// ── 1. the doorstep names the crossing its copy has caught up to ─────────────

test("the copy's history is read alike from office.db and from the store", async () => {
  const office = indexCopy(copyDb());
  assert.deepEqual(office, { newest: NEWEST, seal: { sha: "s1sha", at: SEAL } });
  assert.deepEqual(await storeIx().copy(), office, "one SQL, written twice, one answer");
});

test("THE STALE COPY IS NAMED: a copy without the last boat says so, in words and in fields, on every skin", async () => {
  const db = copyDb();
  const ctx = { db, key: null, meta: { as_of: AS_OF }, asOf: AS_OF, canWrite: false, clone: null, pen: null, odb: null, dbPath: null };
  for (const slim of [false, true]) {
    const behind = (await doorstepBundle("wright", { ...ctx, slim, nowMs: AFTER_NEXT })).copy;
    assert.equal(behind.caught_up, false);
    assert.deepEqual(behind.crossing, { crossing: CROSSING, sailed_at: "2026-07-11T12:00:00.000Z", sealed_at: SEAL });
    assert.equal(behind.last_crossing_by_timetable, CROSSING + 1);
    assert.equal(behind.newest_change_at, NEWEST);
    assert.match(behind.sentence, new RegExp(`commit ${AS_OF.slice(0, 12)}; its newest change was recorded at ${NEWEST}\\.`));
    assert.match(behind.sentence, new RegExp(`caught up to crossing ${CROSSING} \\(sailed 2026-07-11T12:00:00\\.000Z, sealed ${SEAL}\\)`));
    assert.match(behind.sentence, new RegExp(`crossing ${CROSSING + 1} was due at 2026-07-12T00:00:00\\.000Z by the timetable and is not in this copy yet`));

    const caught = (await doorstepBundle("wright", { ...ctx, slim, nowMs: BEFORE_NEXT })).copy;
    assert.equal(caught.caught_up, true);
    assert.match(caught.sentence, new RegExp(`crossing ${CROSSING} .*, the last crossing by the timetable\\.$`));
  }
});

test("beside the commit, on the switched door too, and the same block", async () => {
  const db = copyDb();
  const ctx = { db, key: null, meta: { as_of: AS_OF }, asOf: AS_OF, canWrite: false, clone: null, pen: null, odb: null, dbPath: null, nowMs: AFTER_NEXT };
  const office = await doorstepBundle("wright", ctx);
  const store = await doorstepBundle("wright", { ...ctx, ix: storeIx() });
  for (const d of [office, store]) assert.deepEqual(Object.keys(d).slice(0, 4), ["handle", "as_of", "copy", "next_crossing"], "the header, in reading order");
  assert.deepEqual(store.copy, office.copy);
});

test("the crossing the copy names is the boat next_crossing named before it sailed", () => {
  const boat = nextCrossingForDoorstep(Date.parse("2026-07-11T11:30:00Z"));
  assert.equal(boat.crossing, CROSSING);
  assert.equal(boat.at, crossingSailsAt(CROSSING));
  assert.equal(copyBlock({ newest: NEWEST, seal: { sha: "s1sha", at: SEAL } }, AS_OF, BEFORE_NEXT).crossing.crossing, boat.crossing);
});

test("a copy holding no seal says it cannot name one, never a clock guess", async () => {
  const db = copyDb(":memory:", { seals: false });
  const d = await doorstepBundle("wright", { db, key: null, meta: { as_of: AS_OF }, asOf: AS_OF, canWrite: false, clone: null, odb: null, nowMs: AFTER_NEXT });
  assert.equal(d.copy.crossing, null);
  assert.equal(d.copy.caught_up, null);
  assert.match(d.copy.sentence, /holds no crossing's seal, so it cannot name a crossing it has caught up to\.$/);
});

test("a history that cannot be read is said, and the page still arrives", async () => {
  const db = copyDb();
  const ix = { ...storeIx(), copy: async () => { throw new Error("the store blinked"); } };
  const d = await doorstepBundle("wright", { db, key: null, meta: { as_of: AS_OF }, asOf: AS_OF, canWrite: false, clone: null, odb: null, ix, nowMs: AFTER_NEXT });
  assert.equal(d.copy.caught_up, null);
  assert.match(d.copy.sentence, /could not say what it has caught up to/);
  assert.equal(d.handle, "wright");
});

// ── 2. a copy that has not caught up never refuses a real reply ──────────────

// A letter that sailed after the copy: real on town main, absent from every index here.
const SAILED_AFTER = "limen-2026-07-12-to-wright-after-the-copy";

/** A town clone the envelope pre-flight can scan. */
function mailClone() {
  const d = mkdtempSync(join(tmpdir(), "pm-stale-copy-town-"));
  for (const h of ["wright", "limen"]) {
    mkdirSync(join(d, "WHITE_PAGES", h, "outbox"), { recursive: true });
    mkdirSync(join(d, "WHITE_PAGES", h, "inbox"), { recursive: true });
    writeFileSync(join(d, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\n---\n\n# ${h}\n`);
  }
  writeFileSync(join(d, "WHITE_PAGES", "mail-ledger.md"), "# the mail ledger\n\n");
  const git = (...a) => execFileSync("git", ["-C", d, ...a], { encoding: "utf8" });
  git("init", "-q"); git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return d;
}
const logDb = () => { const d = new DatabaseSync(":memory:"); d.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)"); return d; };
const reply = { from: "wright", to: "limen", title: "after the boat", thread: SAILED_AFTER, body: "Limen —\n\nyour letter came on the boat." };

test("THE OLD REFUSAL, GONE: a thread the copy does not hold is accepted, on office.db and on the store", () => {
  const db = copyDb();
  const keep = process.env.TOWN_INDEX_READS;
  try {
    delete process.env.TOWN_INDEX_READS;                       // office.db's probe
    const office = validateLetter(reply, fixtureKey, db);
    assert.equal(office.thread, SAILED_AFTER, "the thread rides as written");
    assert.equal(office.threadUnseen, true);
  } finally { if (keep === undefined) delete process.env.TOWN_INDEX_READS; else process.env.TOWN_INDEX_READS = keep; }
  const store = validateLetter(reply, fixtureKey, db);        // switched: the store's held probe
  assert.equal(store.threadUnseen, true);
  // and a thread the copy does hold is the plain plan, byte for byte as before
  const known = validateLetter({ ...reply, thread: "limen-2026-07-01-to-wright-the-gap" }, fixtureKey, db);
  assert.equal("threadUnseen" in known, false);
});

test("flag-off · the receipt says the thread was not in the copy, and the letter is written", () => {
  const clone = tempClone();
  try {
    const r = enqueueLetter(reply, fixtureKey, copyDb(), clone);
    assert.match(r.commit, /^[0-9a-f]{40}$/);
    assert.match(r.thread_note, new RegExp(`^thread "${SAILED_AFTER}" names no letter in the office's copy of the town record yet\\. Your letter is accepted`));
    const plain = enqueueLetter({ ...reply, title: "the gap again", thread: "limen-2026-07-01-to-wright-the-gap" }, fixtureKey, copyDb(), clone);
    assert.equal(plain.thread_note, undefined, "a held thread draws no note");
  } finally { rmSync(clone, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test("flag-on · the town-log receipt says so too, and the row is logged", async () => {
  process.env.TOWN_SINGLE_LOG = "1";
  const odb = logDb();
  const clone = mailClone();
  try {
    const r = await sendLetterAsRow(reply, { ...fixtureKey, ghId: "42", ghLogin: "keeminlee" }, copyDb(), clone, odb);
    assert.equal(typeof r.logged.seq, "number");
    assert.match(r.thread_note, /names no letter in the office's copy of the town record yet/);
  } finally {
    delete process.env.TOWN_SINGLE_LOG;
    odb.close();
    rmSync(clone, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
