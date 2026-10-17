// paper-read-through.test.mjs — a paper act's OWN readback at the household door shows what the pen wrote (POS-603).
//
//   node --test --test-concurrency=1 test/paper-read-through.test.mjs
//
// Found by neth (POS-603): a paper act (address, home, profile, window) answers
// done once the pen has committed the record, while the household door's own
// reads still answered from the office's older read index. The freshness ladder
// (src/paper-fresh.mjs) already composes the written record over the index; three
// household-door reads were never handed its context:
//
//   G1  household { read: "address" } on office.db (the store's branch had it)
//   G2  household { read: "home" }, both indexes
//   G3  the papers check (paperGapRows): "tend your HOME page" after the page
//       was tended — on the bare household read and read: "standing"
//
// WHAT RUNS. The real household apex (householdApex), the real paper doors
// (edit.mjs through paperDoor/penTransaction), the real freshFor and the real
// composed readers and hydration parsers, over:
//   · the suite's synthetic office.db (test/fixture.mjs, fixed literals), whose
//     index is never rebuilt here, so every pen write leaves it STALE;
//   · a fresh synthetic town checkout per test (fixed literals, a temp dir, a
//     local bare origin for the push case), never a real clone;
//   · the store variant through the suite's embedded store
//     (test/helpers/office-under-test.mjs § indexStore), seeded from that same
//     office.db, never an env-named database.
// Injected, and only at the outside boundary: the world block (a fixed `null`)
// for the household reads; WORLD_CLONE pointed at an absent temp path, so the
// doorstep's own world read (which takes no injector) reports "unreadable" and
// never opens a world; the record's acts pool (world2-acts.mjs §
// __setPoolForTest) for the suspended and unreadable-standing cases; the store
// index's pool (town-index-store.mjs § __setTownIndexPoolForTest) for the
// unreachable-store case. Nothing here pushes beyond the temp origin, reads a
// real record, or calls an office endpoint.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fixtureTown } from "./fixture.mjs";

delete process.env.TOWN_INDEX_READS;
delete process.env.TOWN_PUSH; // set only inside the push-refusal test, against its temp origin
delete process.env.TOWN_SINGLE_LOG;
delete process.env.WORLD2_PG;
delete process.env.WORLD2_PG_URL;

const { tempDir } = await import("./helpers/temp-dir.mjs");
const scratch = tempDir("postmark-pos603-");
// read at world.mjs's load, so set before anything imports it: no world is opened
process.env.WORLD_CLONE = join(scratch, "no-world-clone");
const { fixtureDb } = await import("./fixture.mjs");
const { indexStore, testIndex } = await import("./helpers/office-under-test.mjs");
const { householdApex } = await import("../src/household-apex.mjs");
const { openOauthDb } = await import("../src/oauth.mjs");
const { ensureTownJournal } = await import("../src/town-journal.mjs");
const { TENSE, freshFor } = await import("../src/paper-fresh.mjs");
const { home: homeQ } = await import("../src/queries.mjs");
const { ownerGate } = await import("../src/doorstep-bundle.mjs");
const tis = await import("../src/town-index-store.mjs");
const acts = await import("../src/world2-acts.mjs");

const town = fixtureTown();
// Two index states, set on the fixture's own rows (no row is invented):
//   · NO INDEXED HOME: limen's home row is REMOVED, so limen has a card and no page;
//   · A BLANK INDEXED PAGE: wright's row keeps its title and loses its description,
//     which is what the papers check reads as "owed".
{
  const w = new DatabaseSync(town);
  w.prepare("DELETE FROM homes WHERE handle = ?").run("limen");
  const row = JSON.parse(w.prepare("SELECT json FROM homes WHERE handle = ?").get("wright").json);
  w.prepare("UPDATE homes SET json = ? WHERE handle = ?").run(JSON.stringify({ ...row, description: "" }), "wright");
  w.close();
}
const db = new DatabaseSync(town, { readOnly: true });
const IX = await indexStore(town);
const STORE = testIndex() === "store";
after(async () => { db.close(); await IX.stop(); });

// ── fixtures: fixed literals only ──────────────────────────────────────────
const GIT = { GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@postmark.invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@postmark.invalid" };
const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", env: { ...process.env, ...GIT } });
let seq = 0;
/** A town checkout whose paper AGREES with the fixture index (wright's and limen's ADDRESS cards); no HOME, PROFILE or window file. */
function townClone({ origin = false } = {}) {
  const root = join(scratch, `town-${++seq}`);
  const dir = join(root, "clone");
  mkdirSync(join(dir, "WHITE_PAGES", "wright"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES", "limen"), { recursive: true });
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, "WHITE_PAGES", "wright", "ADDRESS.md"), "---\nsince: 2026-05-12\njoined: 2026-07-01\ngithub: keeminlee\n---\n\n# wright\n");
  writeFileSync(join(dir, "WHITE_PAGES", "limen", "ADDRESS.md"), "---\nsince: 2026-06-20\njoined: 2026-06-25\n---\n\n# limen\n");
  writeFileSync(join(dir, "tools", "households.json"), JSON.stringify({ schema_version: 1, households: {} }, null, 2) + "\n");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "fixture town");
  if (origin) {
    const bare = join(root, "origin.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
    git(dir, "remote", "add", "origin", bare);
    git(dir, "push", "-q", "origin", "main");
    git(dir, "branch", "-q", "--set-upstream-to=origin/main");
    // the origin refuses every push: the pen's write cannot land
    writeFileSync(join(bare, "hooks", "pre-receive"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  }
  return dir;
}
function townLog() {
  const o = openOauthDb(join(scratch, `oauth-${++seq}.db`));
  ensureTownJournal(o);
  return o;
}
const keyFor = (...handles) => ({ household: `house-${handles[0]}`, handles: new Set(handles), ghId: "42", ghLogin: "keeminlee" });
const ctxFor = (clone, odb = null) => ({ db, clone, odb, town, schemas: {}, schemaRequired: {}, canWrite: true, worldBlock: async () => null });
const act = (verb, handle, args, clone, odb = null, key = keyFor(handle)) => householdApex({ do: verb, handle, args: { handle, ...args } }, key, ctxFor(clone, odb));
const read = (what, handle, clone, odb = null, key = keyFor(handle), extra = {}) => householdApex({ read: what, ...(handle ? { handle } : {}), ...extra }, key, ctxFor(clone, odb));
const okAct = (r, what) => { assert.equal(r.error, undefined, `${what}: ${JSON.stringify(r).slice(0, 300)}`); assert.ok(r.result, what); return r.result; };
const gapsOf = (ans, h) => ans?.papers?.[h]?.gaps ?? [];
const owesHome = (gaps) => gaps.some((g) => /tend your HOME page/.test(g));

const HOME = { title: "the Lantern Workshop", body: "Benches, sawdust and a lamp that never goes out." };
const WINDOW_HTML = '<!doctype html><html><body><script type="application/json" id="window-state">{"lamp":"lit"}</script></body></html>';

/** Every scenario on both indexes: office.db, then (where the suite has one) the store. */
function both(name, fn) {
  test(`${name} [office.db]`, () => fn());
  test(`${name} [store]`, { skip: STORE ? false : "OFFICE_TEST_INDEX=office: no store variant in this run" }, async () => {
    const restore = await IX.useInProcess();
    try { await fn(); } finally { await restore(); }
  });
}

// ═══ G1 · the card: address and profile ═════════════════════════════════════

both("G1 · do: address → read: address shows the written body, stamped written", async () => {
  const clone = townClone();
  const before = await read("address", "wright", clone);
  assert.equal(before.address.address.body, "# wright", "the index and the record agree to start with");
  assert.equal(before.address.freshness.fields["address.body"].tense, TENSE.settled);
  okAct(await act("address", "wright", { body: "a bench by the north window" }, clone), "address");
  const after = await read("address", "wright", clone);
  assert.equal(after.address.address.body, "a bench by the north window", "the owner's own read shows the record the pen wrote");
  assert.equal(after.address.freshness.fields["address.body"].tense, TENSE.written);
  assert.equal(after.address.freshness.fields["address.body"].file, "WHITE_PAGES/wright/ADDRESS.md");
  assert.equal(after.address.freshness.fields.profile.tense, TENSE.settled, "a field nobody touched stays settled");
});

both("G1 · do: profile → its own read (the card's profile) shows the written profile, stamped written", async () => {
  const clone = townClone();
  okAct(await act("profile", "wright", { bio: "keeps the lamp trimmed" }, clone), "profile");
  const after = await read("address", "wright", clone);
  assert.match(JSON.stringify(after.address.profile), /keeps the lamp trimmed/);
  assert.equal(after.address.freshness.fields.profile.tense, TENSE.written);
});

// ═══ G2 · the home page ═════════════════════════════════════════════════════

both("G2 · do: home → read: home shows the written title and body, stamped written", async () => {
  const clone = townClone();
  const before = await read("home", "wright", clone);
  assert.equal(before.home.title, "the Trueing-House", "the index's page to start with");
  assert.equal(before.home.description, "", "…with the blank description this file's index holds");
  assert.equal(before.home.freshness.fields.home.tense, TENSE.settled);
  okAct(await act("home", "wright", HOME, clone), "home");
  const after = await read("home", "wright", clone);
  assert.equal(after.home.title, HOME.title);
  assert.equal(after.home.description, HOME.body);
  assert.equal(after.home.freshness.fields.home.tense, TENSE.written);
  assert.equal(after.home.freshness.fields.home.act, "home");
  assert.equal(after.home.region, "the-terrace", "placement is never composed");
});

both("G2 · flag-on: the act's own row makes the same read PENDING, with its seq", async () => {
  process.env.TOWN_SINGLE_LOG = "1";
  try {
    const clone = townClone();
    const odb = townLog();
    const done = okAct(await act("home", "wright", HOME, clone, odb), "home");
    assert.ok(done.logged?.seq, "the act wrote its row");
    const after = await read("home", "wright", clone, odb);
    assert.equal(after.home.description, HOME.body);
    assert.equal(after.home.freshness.fields.home.tense, TENSE.pending);
    assert.equal(after.home.freshness.fields.home.seq, done.logged.seq);
  } finally { delete process.env.TOWN_SINGLE_LOG; }
});

// ═══ THE FIRST HOME: no index row yet (POS-603 continuation) ═══════════════
// limen has a card in the index and NO homes row. The act founds the page on
// the record; the owner's own reads now compose it from the record, unplaced.

both("FIRST HOME · do: home founds the page → read: home shows it, written, unplaced; the papers stop asking", async () => {
  const clone = townClone();
  assert.equal((await read("home", "limen", clone)).code, 404, "no page anywhere yet");
  assert.equal(owesHome(gapsOf(await read("standing", null, clone, null, keyFor("limen")), "limen")), true, "owed to start with");
  okAct(await act("home", "limen", HOME, clone), "home founds limen's page");
  const r = await read("home", "limen", clone);
  assert.equal(r.code, undefined, JSON.stringify(r).slice(0, 200));
  assert.equal(r.home.title, HOME.title);
  assert.equal(r.home.description, HOME.body);
  assert.deepEqual(r.home.images, []);
  assert.equal(r.home.region, null, "unplaced: placement is never read from the page");
  assert.equal(r.home.freshness.fields.home.tense, TENSE.written);
  assert.equal(r.home.freshness.fields.home.file, "WHITE_PAGES/limen/HOME/HOME.md");
  assert.equal(owesHome(gapsOf(await read("standing", null, clone, null, keyFor("limen")), "limen")), false, "read: standing");
  assert.equal(owesHome(gapsOf(await householdApex({}, keyFor("limen"), ctxFor(clone)), "limen")), false, "the bare household read");
});

both("FIRST HOME · flag-on: the founding act's row makes it PENDING, with its seq", async () => {
  process.env.TOWN_SINGLE_LOG = "1";
  try {
    const clone = townClone();
    const odb = townLog();
    const done = okAct(await act("home", "limen", HOME, clone, odb), "home");
    const r = await read("home", "limen", clone, odb);
    assert.equal(r.home.description, HOME.body);
    assert.equal(r.home.freshness.fields.home.tense, TENSE.pending);
    assert.equal(r.home.freshness.fields.home.seq, done.logged.seq);
  } finally { delete process.env.TOWN_SINGLE_LOG; }
});

// ── the fallback's gates ────────────────────────────────────────────────────
/** A page on the RECORD only, written by hand into the clone (not through the door). */
function pageOnRecord(clone, handle, frontmatter = `title: ${HOME.title}`) {
  mkdirSync(join(clone, "WHITE_PAGES", handle, "HOME"), { recursive: true });
  writeFileSync(join(clone, "WHITE_PAGES", handle, "HOME", "HOME.md"), `---\n${frontmatter}\n---\n\n${HOME.body}\n`);
}

both("GATE · a known resident with no page on the record still has no home", async () => {
  assert.equal((await read("home", "limen", townClone())).code, 404);
});

both("GATE · a handle the index does not hold gets nothing, even with a page on the record — and no path is built from it", async () => {
  const clone = townClone();
  pageOnRecord(clone, "ghost");
  pageOnRecord(clone, "limen");
  assert.equal((await read("home", "ghost", clone, null, keyFor("ghost"))).code, 404, "not a resident of the index");
  assert.equal((await read("home", "ghost/../limen", clone, null, keyFor("limen"))).code, 404,
    "a handle that would RESOLVE to limen's page is refused by the index's identity read before any path is joined");
});

both("GATE · no checkout in the context → no fallback (the reader is handed nothing to read)", async () => {
  const clone = townClone();
  pageOnRecord(clone, "limen");
  const r = await householdApex({ read: "home", handle: "limen" }, keyFor("limen"), { ...ctxFor(clone), clone: null });
  assert.equal(r.code, 404);
});

both("GATE · placement is never composed: a page carrying region frontmatter still reads unplaced; an indexed region is unchanged", async () => {
  const clone = townClone();
  pageOnRecord(clone, "limen", `title: ${HOME.title}\nregion: the-terrace`);
  const r = await read("home", "limen", clone);
  assert.equal(r.home.region, null);
  okAct(await act("home", "wright", HOME, clone), "wright's indexed page");
  assert.equal((await read("home", "wright", clone)).home.region, "the-terrace");
});

// The record's standing, through its own pool seam (office.db's road; the
// store's road reads standing from the index store and is unchanged here).
async function withActsPool(pool, fn) {
  const keep = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://unused@127.0.0.1:9/never" }); // the pool below answers; this is never dialled
  acts.__setPoolForTest(pool);
  try { return await fn(); } finally {
    acts.__setPoolForTest(null);
    if (keep.pg === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = keep.pg;
    if (keep.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = keep.url;
  }
}
const QUARANTINE = { id: 1, date: "2026-10-01", act: "quarantine", handle: "limen", by_who: "registrar", founder_word: null,
  reason: "fixture", line: "- 2026-10-01 · quarantine · limen · by: registrar · reason: fixture", source: "door", actor: null };

test("GATE · a SUSPENDED handle's page is not composed ahead of the index (freshFor's standing gate) [office.db]", async () => {
  const clone = townClone();
  pageOnRecord(clone, "limen");
  await withActsPool({ query: async () => ({ rows: [QUARANTINE] }) }, async () => {
    const fresh = await freshFor("limen", { clone });
    assert.equal(fresh.suspended, true, "the stub's row reads as a quarantine");
    assert.equal(homeQ(db, "limen", fresh), null);
  });
});

test("GATE · an UNREADABLE standing keeps the overlay off too — never read as good standing [office.db]", async () => {
  const clone = townClone();
  pageOnRecord(clone, "limen");
  await withActsPool({ query: async () => { throw new Error("standing store down"); } }, async () => {
    const fresh = await freshFor("limen", { clone });
    assert.equal(fresh.suspended, true, "fail closed");
    assert.equal(homeQ(db, "limen", fresh), null);
  });
});

test("GATE · an unreachable store index is a 503, never a fallback page [store]", { skip: STORE ? false : "no store variant in this run" }, async () => {
  const clone = townClone();
  pageOnRecord(clone, "limen");
  const restore = await IX.useInProcess();
  try {
    const down = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    tis.__setTownIndexPoolForTest({ connect: async () => { throw down; }, query: async () => { throw down; }, end: async () => {}, on() {} });
    const r = await read("home", "limen", clone);
    assert.equal(r.code, 503, JSON.stringify(r).slice(0, 200));
    assert.equal(r.home, undefined);
  } finally { await restore(); }
});

// ── the doorstep's settling-in block (ownerGate), its own read of the papers ─
both("DOORSTEP · ownerGate's settling_in stops asking for the page once it is tended (wright: indexed blank page; limen: first home)", async () => {
  for (const h of ["wright", "limen"]) {
    const clone = townClone();
    const ix = tis.townIndexReads() ? tis.storeIndexPooled(clone) : null;
    const gate = async () => (await ownerGate({ pending_outbox: 0 }, h, { db, clone, key: keyFor(h), odb: null, meta: {}, asOf: null, ix })).settling_in?.next ?? [];
    assert.equal(owesHome(await gate()), true, `${h}: owed to start with`);
    okAct(await act("home", h, HOME, clone), `${h}: home`);
    assert.equal(owesHome(await gate()), false, `${h}: settling_in no longer asks`);
  }
});

// ═══ G3 · the papers check ══════════════════════════════════════════════════

both("G3 · after do: home the papers stop asking for the page — read: standing and the bare household read", async () => {
  const clone = townClone();
  const owed = await read("standing", null, clone, null, keyFor("wright"));
  assert.equal(owesHome(gapsOf(owed, "wright")), true, "the index's blank page is owed to start with (the check is live, not vacuous)");
  okAct(await act("home", "wright", HOME, clone), "home, tended");
  const standing = await read("standing", null, clone, null, keyFor("wright"));
  assert.equal(owesHome(gapsOf(standing, "wright")), false, "read: standing");
  const bare = await householdApex({}, keyFor("wright"), ctxFor(clone));
  assert.equal(owesHome(gapsOf(bare, "wright")), false, "the bare household read");
});

// ═══ window: already read-through — a regression control, not a new fix ════

both("window (control) · do: window → read: window shows the hand-set state, stamped written", async () => {
  const clone = townClone();
  okAct(await act("window", "wright", { html: WINDOW_HTML }, clone), "window");
  const w = await read("window", "wright", clone);
  assert.deepEqual(w.window, { lamp: "lit" });
  assert.equal(w.freshness.fields.window.tense, TENSE.written);
});

// ═══ no false done, and no false freshness ══════════════════════════════════

both("a bounced act writes nothing and the read stays settled", async () => {
  const clone = townClone();
  const r = await act("home", "wright", { ...HOME, colour: "teal" }, clone);
  assert.equal(r.error, "bounce", "an unknown field is refused by name");
  const after = await read("home", "wright", clone);
  assert.equal(after.home.title, "the Trueing-House");
  assert.equal(after.home.freshness.fields.home.tense, TENSE.settled);
  assert.equal(git(clone, "status", "--porcelain").trim(), "");
});

both("a push the origin refuses is not done: the clone is put back and the read stays settled", async () => {
  process.env.TOWN_PUSH = "1";
  try {
    const clone = townClone({ origin: true });
    const headBefore = git(clone, "rev-parse", "HEAD").trim();
    const r = await act("home", "wright", HOME, clone);
    assert.ok(r.error, `refused, not done: ${JSON.stringify(r).slice(0, 200)}`);
    assert.equal(git(clone, "rev-parse", "HEAD").trim(), headBefore, "no local commit left behind");
    const after = await read("home", "wright", clone);
    assert.equal(after.home.title, "the Trueing-House");
    assert.equal(after.home.freshness.fields.home.tense, TENSE.settled);
  } finally { delete process.env.TOWN_PUSH; }
});

both("NO-OP, TWO STATES: repeating a written edit is unchanged AND still written; matching the index is unchanged AND settled", async () => {
  const clone = townClone();
  okAct(await act("address", "wright", { body: "a bench by the north window" }, clone), "first");
  const again = okAct(await act("address", "wright", { body: "a bench by the north window" }, clone), "again");
  assert.equal(again.unchanged, true, "the second call changed nothing");
  const r = await read("address", "wright", clone);
  assert.equal(r.address.address.body, "a bench by the north window");
  assert.equal(r.address.freshness.fields["address.body"].tense, TENSE.written, "unchanged is not settled: the index is still behind the record");

  const fresh = townClone();
  const same = okAct(await act("address", "wright", { body: "# wright" }, fresh), "same as the index");
  assert.equal(same.unchanged, true);
  const s = await read("address", "wright", fresh);
  assert.equal(s.address.freshness.fields["address.body"].tense, TENSE.settled);
});

both("a nonce retry is one edit and one receipt; the read shows it once", async () => {
  process.env.TOWN_SINGLE_LOG = "1";
  try {
    const clone = townClone();
    const odb = townLog();
    const first = okAct(await act("home", "wright", { ...HOME, nonce: "n-603" }, clone, odb), "first");
    const second = okAct(await act("home", "wright", { ...HOME, nonce: "n-603" }, clone, odb), "retry");
    assert.equal(second.duplicate, true);
    assert.equal(second.commit, first.commit);
    assert.equal(Number(git(clone, "rev-list", "--count", "HEAD").trim()), 2, "the fixture commit and ONE edit");
    const r = await read("home", "wright", clone, odb);
    assert.equal(r.home.description, HOME.body);
  } finally { delete process.env.TOWN_SINGLE_LOG; }
});

// ═══ the gates stay as they were ════════════════════════════════════════════

both("ASK, DON'T GUESS: a key holding two residents is asked whose home, not answered", async () => {
  const clone = townClone();
  const r = await read("home", null, clone, null, keyFor("wright", "limen"));
  assert.equal(r.code, 422);
  assert.match(r.defect, /whose home\?/);
});

both("another household's read of the card is the composed public card, as REST's /residents/{h} already is", async () => {
  const clone = townClone();
  okAct(await act("address", "wright", { body: "a bench by the north window" }, clone), "address");
  const r = await read("address", "wright", clone, null, keyFor("limen"));
  assert.equal(r.address.address.body, "a bench by the north window");
  assert.equal(r.address.freshness.fields["address.body"].tense, TENSE.written);
});

// ── next steps: the OFFICE'S WIRING only (Rivet, 2026-10-13 09:58Z) ──────────
// queries.mjs § questTools imports the town's tools/quest-progress.mjs from the
// clone (cached per process, only on a successful import). This literal module
// is NOT the town's composer: it exports the interfaces nextStepsFor calls and
// captures the paperRows the office hands composeNextSteps. So it proves that
// the papers the office passes are read through the record — not that the whole
// next_steps block is fresh (the onboarding facts stay index-paced, and the real
// composer may merge or dedupe). Kept LAST: its module is the process's cached
// copy from here on, and no test before it can have cached another.
const QUEST_STUB = `// test-only literal: the interface nextStepsFor calls, nothing of the town's
export const COUNTABLE_FIELD = {};
export const townDay = () => "2026-10-13";
export const onboardingFactsFor = () => ({});
export const onboardingBoard = () => ({ rows: [] });
export const boardForHandle = () => ({ quests: [] });
export function composeNextSteps({ paperRows }) {
  globalThis.__pos603PaperRows = paperRows;
  return { steps: (paperRows ?? []).map((r) => ({ id: r.id, text: r.text })) };
}
`;
test("NEXT STEPS (office wiring only) · the paper rows handed to the composer stop asking once the first home is founded [office.db]", async () => {
  const { nextStepsFor } = await import("../src/queries.mjs");
  const clone = townClone();
  writeFileSync(join(clone, "tools", "quest-progress.mjs"), QUEST_STUB);
  const run = async () => {
    delete globalThis.__pos603PaperRows;
    const ns = await nextStepsFor(db, {}, "limen", clone, { own: true, key: keyFor("limen"), worldBlock: async () => null });
    const rows = globalThis.__pos603PaperRows;
    assert.ok(Array.isArray(rows), `the composer was reached with paperRows (next steps: ${JSON.stringify(ns)?.slice(0, 160)})`);
    return rows.map((r) => r.id);
  };
  assert.ok((await run()).includes("tend-your-home"), "owed to start with");
  okAct(await act("home", "limen", HOME, clone), "home");
  assert.equal((await run()).includes("tend-your-home"), false, "the office's paper rows no longer ask");
});
