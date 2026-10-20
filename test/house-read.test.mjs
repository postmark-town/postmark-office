// house-read.test.mjs — POS-276: the house in one answer, and what waits on it.
//
// The household page read one doorstep per resident. These are the two reads
// that replace that, and the claims this file holds are the ones a reader
// moving over depends on:
//
//   1. A resident's blocks under residents[<h>] ARE the doorstep's, under the
//      doorstep's names — deep-equal, not lookalikes.
//   2. The town-wide blocks ride once, at the top, and on no resident.
//   3. The owner-only blocks ride a key that holds THAT resident and no other
//      (the doorstep's own gate, doorstep-bundle.mjs § ownerGate).
//   4. The world's three (stances, outcomes, stakes) and the walkers roll are
//      asked ONCE for the house.
//   5. An outcome's `at` is ISO, and the events are in instant order.
//   6. needs-you is the house's own, and every row names its cause.
//
//   node --test test/house-read.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { storeIndexPooled } from "../src/town-index-store.mjs";
import { doorstepBundle } from "../src/doorstep-bundle.mjs";
import { appendTownJournal } from "../src/town-journal.mjs";
import { houseBundle, housePage, memberRow, pageBounds, HOUSE_PAGE, HOUSE_PAGE_MAX, needsYou, isoAt, isoEvents, HOUSE_ONCE } from "../src/house-bundle.mjs";
import { householdApex, HOUSEHOLD_READS, HOUSEHOLD_READ_FIELDS } from "../src/household-apex.mjs";
import { poolFromClone, RECORD_ON } from "./registry-pool-stub.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { putValues, emptyTown } from "./fixture.mjs";

const AS_OF = "housefixture0000000000000000000000000000";
const HOUSE = "fixture-house";
const MEMBERS = ["r000", "r001", "r002", "r-harbor"];

function houseDb() {
  const db = emptyTown();
  const put = (...v) => putValues(db, "meta", v);
  put("as_of", AS_OF);
  put("town_path", "fixture");
  put("hydrated_counts", JSON.stringify({}));
  const insR = (...v) => putValues(db, "residents", v);
  for (const [i, h] of ["r000", "r001", "r002", "r-stranger"].entries()) {
    insR(h, JSON.stringify({ handle: h, is_office: false, last_active: `2026-09-2${i}T10:00:00.000Z`,
      address: { data: { since: "2026-01-01", joined: `2026-06-1${i}` } },
      window_state: { hand_set: "2026-08-24", sections: [{ title: "what I need", body: `pane of ${h}` }] } }));
  }
  const insL = (...v) => putValues(db, "letters", v);
  for (let i = 0; i < 4; i++) {
    const id = `r001-2026-07-0${i + 1}-to-r000-n${i}`;
    insL(id, "r001", "r000", `2026-07-0${i + 1}`, null, "inbox", "r000",
      `WHITE_PAGES/r000/inbox/${i}.md`, JSON.stringify({ id, from: "r001", to: "r000", body: `# letter ${i}` }), `2026-07-0${i + 1}T08:00:00.000Z`);
  }
  const insB = (...v) => putValues(db, "bulletin", v);
  for (let i = 0; i < 4; i++) insB(`2026-07-0${i + 1}-n${i}`, JSON.stringify({ slug: `2026-07-0${i + 1}-n${i}`, data: { title: `notice ${i}` }, body: "# notice" }));
  // the store keeps every ledger line's json (town_ledger.json is NOT NULL)
  putValues(db, "ledger", ["delivery", "2026-07-04", "l0", "r001", "r000", "{}"], ["kind", "date", "id", "from_h", "to_h", "json"]);
  putValues(db, "stamps", ["r000", 12, 30, 3]);
  putValues(db, "mail_state", ["r000", JSON.stringify({
    handle: "r000", language: "sequence, never debt", conversations: [],
    unplaced_bounces: [{ date: "2026-06-16", path: "WHITE_PAGES/r000/outbox/x.md", reason: "no resident \"nobody\"" }],
    summary: { they_spoke_last: 0, new_inbound: 0, they_spoke_again: 0, reply_queued: 0, last_word_yours: 0, bounced: 1 },
  })]);
  return db;
}

const db = houseDb();
// THE TOWN INDEX IS THE STORE'S (POS-656): one store for the file, holding the
// fixture house (a test that needs other rows re-states it, and puts it back),
// read through its own pool beside the registry's stubbed one below.
const IX = await indexStore(db, { db: "house_read" });
const IX_RESTORE = await IX.useInProcess();
after(async () => { await IX_RESTORE(); await IX.stop(); });
const scratch = mkdtempSync(join(tmpdir(), "postmark-house-"));
after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
mkdirSync(join(scratch, "tools"), { recursive: true });
writeFileSync(join(scratch, "tools", "households.json"), JSON.stringify({ households: {
  [HOUSE]: { name: "Fixture", human: "FIX", accounts: [{ login: "fixture", id: 1 }], residents: MEMBERS },
  other: { name: "Other", human: "OTH", accounts: [{ login: "other", id: 2 }], residents: ["r-stranger"] },
} }));
// THE HOUSE IS THE STORE'S (POS-345): the house read takes its members from the
// registry store and never from the clone's printed households.json, so the
// suite's two houses are seeded into a stub store from the same document.
__setPoolForTest(poolFromClone(scratch));
const keepRecord = { on: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
after(() => {
  __setPoolForTest(null);
  if (keepRecord.on === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = keepRecord.on;
  if (keepRecord.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = keepRecord.url;
});
const NOW = Date.parse("2026-09-27T06:00:00Z");

/** Every world reader, counted, so "asked once" is a number and not a hope. */
function worldReaders() {
  const calls = { stances: [], stakesFor: [], walkers: 0, claimEffects: [], lastActive: [] };
  return {
    calls,
    readers: {
      stances: async (handles, opts) => { calls.stances.push([...handles]);
        return { stances_awaiting: 1, awaiting: [{ mark: "r-stranger/fence", by: "r-stranger", on_your_ground: ["r000/garden"] }],
          standing: [], cursor: null, complete: true, set_downs_awaiting: [], teach: { same: "for everyone" }, limit: opts.limit }; },
      stakesFor: async (handles) => { calls.stakesFor.push([...handles]);
        return { next_settlement: { at: "2026-09-28T00:00:00.000Z" }, count: 2, at_risk: 1,
          rows: [{ mark: "r001/shed", class: "commons", escrow: 0, at_risk: true, act: 'world { do: "stake" }' },
                 { mark: "r000/garden", class: "commons", escrow: 3, at_risk: false }] }; },
      // the store's acts and town_letters, newest per handle (last-active.mjs § lastActiveFor's Map)
      lastActiveFor: async (handles) => { calls.lastActive.push([...handles]);
        return new Map([["r000", { at: "2026-09-26T08:00:00.000Z", crossing: 213 }]]); },
      walkers: async () => { calls.walkers += 1;
        return { at: 190.5, walkers: [{ handle: "r000", x: 10, y: -4, mark_id: "the-town/quay", moving: false, toward: null }] }; },
      // The store's own shape on prod: `decided_at` comes back a Date, and
      // claim-effects String()ed it until 2026-09-27; the Date is kept here so isoAt still proves it takes one.
      claimEffects: async (args) => { calls.claimEffects.push(args);
        return { readable: true, store: "docket", events: [
          { kind: "claim-locked", mark: "r000/garden", at: String(new Date("2026-09-26T12:05:00Z")), crossing: 190 },
          { kind: "claim-refused", mark: "r001/shed", at: String(new Date("2026-09-25T23:00:00Z")), crossing: 189, cause: "unbacked" },
        ] }; },
    },
  };
}

// The house's index: the store's pooled index, with last_active (the store's acts
// and town_letters) answered by the suite's counted reader where a test hands one.
const ixFor = (readers) => ({ ...storeIndexPooled(scratch), ...(readers?.lastActiveFor ? { lastActiveFor: (h) => readers.lastActiveFor(h) } : {}) });
const ctx = (over = {}) => ({ key: null, asOf: AS_OF, clone: scratch, odb: null, nowMs: NOW, ix: ixFor(over.readers), ...over });
/** The doorstep's own core, from the same index (town-index-store.mjs § doorstep). */
const doorstep = (handle, opts) => storeIndexPooled(scratch).doorstep(handle, AS_OF, opts);

test("THE HOUSE: residents ashore, one answer, the harbor named rather than dropped", async () => {
  const { readers } = worldReaders();
  const h = await houseBundle({ household: HOUSE }, ctx({ readers }));
  assert.equal(h.read, "house");
  assert.equal(h.household, HOUSE);
  assert.deepEqual(h.ashore, ["r000", "r001", "r002"]);
  assert.deepEqual(h.not_ashore, ["r-harbor"]);
  assert.deepEqual(Object.keys(h.residents), ["r000", "r001", "r002"]);
  assert.equal(h.members_from, "the registry store");
});

test("THE DOORSTEP'S NAMES: each resident's segments deep-equal the doorstep's, key for key", async () => {
  const { readers } = worldReaders();
  const h = await houseBundle({ household: HOUSE }, ctx({ readers }));
  for (const who of h.ashore) {
    const d = (await doorstep(who, { fresh: { odb: null, clone: scratch, asOf: AS_OF }, nowMs: NOW }));
    for (const k of ["mail", "awaiting", "stamps", "window", "pending_outbox", "counts"])
      assert.deepEqual(h.residents[who][k], d[k], `${who}.${k} is the doorstep's own ${k}`);
    assert.equal(h.residents[who].window.handle ?? who, who);
  }
});

test("ONCE: the town-wide blocks ride at the top and on no resident", async () => {
  const { readers } = worldReaders();
  const h = await houseBundle({ household: HOUSE }, ctx({ readers }));
  const d = (await doorstep("r000", { fresh: { odb: null, clone: scratch, asOf: AS_OF }, nowMs: NOW }));
  for (const k of HOUSE_ONCE) {
    assert.deepEqual(h[k], d[k], `${k} at the top is the doorstep's`);
    for (const who of h.ashore) assert.ok(!(k in h.residents[who]), `${k} is not repeated on ${who}`);
  }
  for (const who of h.ashore) for (const k of ["the_bundle", "segments", "moved", "doorstep_version", "as_of"])
    assert.ok(!(k in h.residents[who]), `${who} carries no page manifest (${k})`);
});

test("ASKED ONCE: stances, stakes and the walkers roll are one call each for the whole house", async () => {
  const { readers, calls } = worldReaders();
  const h = await houseBundle({ household: HOUSE }, ctx({ readers }));
  assert.deepEqual(calls.stances, [["r000", "r001", "r002"]]);
  assert.deepEqual(calls.stakesFor, [["r000", "r001", "r002"]]);
  assert.equal(calls.walkers, 1);
  assert.equal(calls.claimEffects.length, 1);
  // The outcomes' ground is the stances answer this read already held.
  assert.deepEqual([...calls.claimEffects[0].onMyGround], ["r-stranger/fence"]);
  assert.deepEqual(h.residents.r000.stands, { x: 10, y: -4, mark_id: "the-town/quay", moving: false, toward: null });
  assert.equal(h.residents.r001.stands, null);
  // last_active is the newest act of their own, asked once for the house, never
  // the index's commit-derived value (r000's card says 2026-09-20; POS-481).
  assert.deepEqual(calls.lastActive, [["r000", "r001", "r002"]]);
  assert.deepEqual([h.residents.r000.last_active, h.residents.r000.last_active_crossing], ["2026-09-26T08:00:00.000Z", 213]);
  assert.deepEqual([h.residents.r001.last_active, h.residents.r001.last_active_crossing], [null, null]);
  assert.equal(h.last_active_unavailable, undefined);
});

test("ISO: an outcome's `at` is ISO whatever the store handed back, and the events run in instant order", async () => {
  assert.equal(isoAt(new Date("2026-09-26T12:05:00Z")), "2026-09-26T12:05:00.000Z");
  assert.equal(isoAt(String(new Date("2026-09-26T12:05:00Z"))), "2026-09-26T12:05:00.000Z");
  assert.equal(isoAt("2026-09-26T12:05:00.000Z"), "2026-09-26T12:05:00.000Z");
  assert.equal(isoAt(null), null);
  const { readers } = worldReaders();
  const h = await houseBundle({ household: HOUSE }, ctx({ readers }));
  assert.deepEqual(h.outcomes.events.map((e) => [e.mark, e.at]),
    [["r001/shed", "2026-09-25T23:00:00.000Z"], ["r000/garden", "2026-09-26T12:05:00.000Z"]]);
  // The fixture's pair sorts right by weekday name too ("Fri" < "Sat"), so the
  // trap is pinned on its own: a Monday after a Saturday.
  const trap = isoEvents([{ mark: "b", at: String(new Date("2026-09-28T00:00:00Z")) }, { mark: "a", at: String(new Date("2026-09-26T00:00:00Z")) }]);
  assert.deepEqual(trap.map((e) => e.mark), ["a", "b"], "Mon the 28th sorts after Sat the 26th");
});

// ── the ownership gate ──────────────────────────────────────────────────────

async function mailOdb() {
  const o = new DatabaseSync(":memory:");
  o.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  await appendTownJournal(o, { cls: "letter", act: "send-letter", household: "fixture", handle: "r000",
    payload: { args: { from: "r000", to: "r001", title: "standing", body: "not sailed" },
      id: "r000-2026-09-26-to-r001-standing", file: "WHITE_PAGES/r000/outbox/standing.md" } });
  return o;
}

test("THE GATE: a key holding r000 adds r000's owner-only blocks — the doorstep's own — and r001's page stays public", async () => {
  const odb = await mailOdb();
  process.env.TOWN_SINGLE_LOG = "1";
  try {
    const key = { household: "fixture", handles: new Set(["r000"]) };
    const { readers } = worldReaders();
    const h = await houseBundle({ household: HOUSE }, ctx({ readers, key, odb }));
    const d = await doorstepBundle("r000", { key, asOf: AS_OF, clone: scratch, odb, nowMs: NOW });
    assert.ok(h.residents.r000.your_pending_letters, "the sender's own unsailed letter rides their own resident");
    assert.deepEqual(h.residents.r000.your_pending_letters, d.your_pending_letters);
    assert.equal(h.residents.r000.pending_outbox, d.pending_outbox);
    assert.deepEqual(h.residents.r000.pending_outbox_freshness, d.pending_outbox_freshness);
    // and the awaiting segment reads the same standing block on both (POS-375)
    assert.deepEqual(h.residents.r000.awaiting, d.awaiting);
    assert.ok(!("your_pending_letters" in h.residents.r001), "a housemate the key does not hold reads public");
    const anon = await houseBundle({ household: HOUSE }, ctx({ readers, odb }));
    assert.ok(!("your_pending_letters" in anon.residents.r000), "no key, no owner-only block");
  } finally { delete process.env.TOWN_SINGLE_LOG; odb.close(); }
});

// ── the gate on the store's road, with a threaded standing letter (POS-375; #446 review, finding 4) ──
//
// Here r000 holds a delivered letter from r001, and r000's reply to it stands
// in the log: the awaiting segment turns
// reply_queued on the key that holds r000, the house's segment is the
// doorstep's, and no other read (no key, another household's key, the
// awaiting view under a key that does not hold r000) names the reply.
test("THE GATE, ON THE STORE: a threaded standing reply turns r000's thread queued on r000's key, and on no other read", async () => {
  const sdb = houseDb();
  const answering = "r001-2026-07-04-to-r000-n3";
  sdb.mail_state.find((r) => r.handle === "r000").json = JSON.stringify({
    handle: "r000", language: "sequence, never debt",
    conversations: [{ conversation: answering, attention_state: "new_inbound", reason: "a letter with no word of yours in the conversation yet",
      latest_delivered_id: answering, latest_delivered_from: "r001", queued_reply_id: null,
      latest_event: { ordinal: 0, date: "2026-07-04" }, next_actor: "you", others: ["r001"], letters: 1 }],
    summary: { they_spoke_last: 1, new_inbound: 1, they_spoke_again: 0, reply_queued: 0, last_word_yours: 0, bounced: 0 },
  });
  const reply = "r000-2026-09-26-to-r001-answered";
  const odb = new DatabaseSync(":memory:");
  odb.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  await appendTownJournal(odb, { cls: "letter", act: "send-letter", household: "fixture", handle: "r000",
    payload: { args: { from: "r000", to: "r001", title: "answered", body: "standing", thread: answering },
      id: reply, file: "WHITE_PAGES/r000/outbox/answered.md" } });
  // the file's store re-stated with this test's house, and put back after
  const kept = { ...db };
  Object.assign(db, sdb);
  await IX.reseed();
  process.env.TOWN_SINGLE_LOG = "1";
  try {
    const ix = storeIndexPooled(scratch);
    const key = { household: "fixture", handles: new Set(["r000"]) };
    const { readers } = worldReaders();
    const sctx = (over) => ctx({ readers, odb, ix, ...over });
    const h = await houseBundle({ household: HOUSE }, sctx({ key }));
    const d = await doorstepBundle("r000", { key, asOf: AS_OF, clone: scratch, odb, nowMs: NOW, ix });
    const row = h.residents.r000.awaiting.conversations.find((c) => c.conversation === answering);
    assert.equal(row.attention_state, "reply_queued", "the house read's store road turns the thread queued");
    assert.equal(row.queued_reply_id, reply);
    assert.deepEqual(h.residents.r000.awaiting, d.awaiting, "the house's segment is the doorstep's");
    // POS-720 review item 4: the page's row reads the same standing letters, so it is r000's own doorstep's
    const page = await housePage({ household: HOUSE }, sctx({ key }));
    const pr = page.members.find((m) => m.handle === "r000");
    assert.deepEqual([pr.they_spoke_last, pr.new_inbound], [d.awaiting.summary.they_spoke_last, d.awaiting.summary.new_inbound],
      "the page row is r000's own doorstep, the queued reply and all");
    assert.equal(pr.new_inbound, 0, "the queued reply took the thread off new_inbound");
    // and the house's glance (POS-633 part 1) reads the same standing letters
    const glance = await householdApex({ read_shape: "v2" }, key, { clone: scratch, asOf: AS_OF, odb });
    assert.equal(glance.mail.new_inbound, d.awaiting.summary.new_inbound, "the glance's mail is r000's own doorstep, the queued reply and all");

    const anon = await houseBundle({ household: HOUSE }, sctx({}));
    assert.equal(JSON.stringify(anon).includes(reply), false, "no key: no trace of the standing reply");
    const strangerKey = { household: "other", handles: new Set(["r-stranger"]) };
    const stranger = await houseBundle({ household: HOUSE }, sctx({ key: strangerKey }));
    assert.equal(JSON.stringify(stranger).includes(reply), false, "another household's key: no trace");
    const view = await householdApex({ read: "mail", handle: "r000", view: "awaiting" }, strangerKey,
      { clone: scratch, odb, asOf: AS_OF });
    assert.equal(JSON.stringify(view).includes(reply), false, "the awaiting view under a key that does not hold r000: no trace");
    assert.equal(view.conversations?.find((c) => c.conversation === answering)?.attention_state, "new_inbound");
  } finally { delete process.env.TOWN_SINGLE_LOG; Object.assign(db, kept); await IX.reseed(); odb.close(); }
});

// ── needs-you ───────────────────────────────────────────────────────────────

test("NEEDS-YOU: the house's own — no key is 401, a stranger's key is 403", async () => {
  const { readers } = worldReaders();
  assert.equal((await needsYou({ household: HOUSE }, ctx({ readers }))).refused[0], 401);
  const stranger = { household: "other", handles: new Set(["r-stranger"]) };
  assert.equal((await needsYou({ household: HOUSE }, ctx({ readers, key: stranger }))).refused[0], 403);
});

test("NEEDS-YOU: every row names its cause, and a key ask never carries its co-sign link", async () => {
  const { readers } = worldReaders();
  readers.claimState = (_odb, h) => (h === "r001" ? { handle: h, cosigned: false, asks_standing: 1 } : null);
  const key = { household: "fixture", handles: new Set(["r000", "r001"]) };
  const n = await needsYou({}, ctx({ readers, key }));
  assert.equal(n.household, HOUSE, "the house the key holds, with no slug named");
  assert.deepEqual(n.residents, ["r000", "r001"]);
  assert.equal(n.stances_awaiting.rows.length, 1);
  assert.equal(n.unplaced_bounces.rows.length, 1);
  assert.equal(n.unplaced_bounces.rows[0].handle, "r000");
  assert.equal(n.key_asks.rows.length, 1);
  assert.equal(n.key_asks.rows[0].cosign_link, null);
  assert.equal(n.stakes_at_risk.rows.length, 1);
  assert.equal(n.stakes_at_risk.rows[0].mark, "r001/shed");
  assert.equal(n.count, 4);
  for (const group of ["stances_awaiting", "unplaced_bounces", "key_asks", "stakes_at_risk"])
    for (const row of n[group].rows) assert.ok(typeof row.cause === "string" && row.cause.length > 10, `${group} row names its cause`);
});

test("NEEDS-YOU (WLD-51 part 3): an at-risk row carries the stakes row whole, its mark's body included", async () => {
  const { readers } = worldReaders();
  readers.stakesFor = async () => ({ next_settlement: { at: "2026-09-28T00:00:00.000Z" }, count: 1, at_risk: 1,
    rows: [{ mark: "r001/shed", kind: "sited", body: "A shed of salvaged boards, door on a leather hinge.", class: "commons", escrow: 0, at_risk: true, act: 'world { do: "stake" }' }] });
  const key = { household: "fixture", handles: new Set(["r000", "r001"]) };
  const n = await needsYou({}, ctx({ readers, key }));
  assert.equal(n.stakes_at_risk.rows[0].body, "A shed of salvaged boards, door on a leather hinge.");
});

test("NEEDS-YOU, ALERTS (WLD-51, Darko 2026-10-15 19:29): the house's alerts in the doorstep's one shape, counted; an unread kind is named, and the quiet note never claims nothing waits", async () => {
  const { readers } = worldReaders();
  const taken = { kind: "mark-taken", severity: "act", about: { mark: "r000/kite", body: "A kite of waxed paper." },
    message: "r000/kite had no stamps behind it, so it left the world at the Oct 15, 2:00 pm EDT settlement. It's back in your household's drafts, and its author, r000, can stake it, or leave it again with a stamp, to bring it back.",
    act: { verb: "world.stake", args: { mark: "r000/kite", stamps: 1, handle: "r000" } }, since: "2026-10-15T18:00:00.000Z", until: "2026-10-22T18:00:00.000Z" };
  const asked = [];
  readers.alertsFor = async (handles) => { asked.push([...handles]); return { alerts: [taken], unread: [] }; };
  const key = { household: "fixture", handles: new Set(["r000", "r001"]) };
  const n = await needsYou({}, ctx({ readers, key }));
  assert.deepEqual(asked, [["r000", "r001"]], "every resident of the house here");
  assert.deepEqual(n.alerts, [taken]);
  assert.equal("left_the_world" in n, false, "the loose rows are gone: the alert replaces them");
  assert.equal(n.count, 3 + 1, "the alert counts beside the stances, the bounces and the at-risk mark");
  readers.alertsFor = async () => ({ alerts: [], unread: [{ kind: "mark-taken", reason: "down" }] });
  const blind = await needsYou({}, ctx({ readers, key }));
  assert.deepEqual([blind.alerts, blind.alerts_unread], [[], [{ kind: "mark-taken", reason: "down" }]]);
});

// POS-717: Starforge's needs-you said count 20 while 61 marks waited. The
// stances list is a page of NEEDS_YOU_STANCES; the count is the whole of it.
test("NEEDS-YOU (POS-717): count is everything waiting, shown is the rows on this answer", async () => {
  const { readers } = worldReaders();
  const page = Array.from({ length: 20 }, (_, i) => ({ mark: `r-stranger/fence-${i}`, by: "r-stranger", on_your_ground: ["r000/garden"] }));
  readers.stances = async () => ({ stances_awaiting: 61, awaiting: page, standing: [], cursor: "c20", complete: false, set_downs_awaiting: [] });
  const key = { household: "fixture", handles: new Set(["r000", "r001"]) };
  const n = await needsYou({}, ctx({ readers, key }));
  assert.equal(n.stances_awaiting.total, 61);
  assert.equal(n.stances_awaiting.shown, 20);
  // 61 stances, r000's bounce and r001's at-risk shed; 20 of the stances are on this answer
  assert.equal(n.count, 61 + 1 + 1, "count is the true total");
  assert.equal(n.shown, 20 + 1 + 1, "shown is what this answer lists");
  assert.match(n.stances_awaiting.more, /cursor: "c20"/);
});

// ── the door ────────────────────────────────────────────────────────────────

test("THE DOOR: both reads are on the household door's list, declare their field, and refuse an unknown one", async () => {
  assert.ok(HOUSEHOLD_READS.house && HOUSEHOLD_READS["needs-you"]);
  assert.deepEqual(Object.keys(HOUSEHOLD_READ_FIELDS.house), ["household", "limit", "offset", "full"]);
  const bad = await householdApex({ read: "house", args: { household: HOUSE, bogus: 1 } }, null,
    { clone: scratch, asOf: AS_OF, strictFields: true });
  assert.equal(bad.code, 422);
  const none = await householdApex({ read: "house", household: "no-such-house" }, null, { clone: scratch, asOf: AS_OF });
  assert.equal(none.code, 404);
  const anon = await householdApex({ read: "needs-you" }, null, { clone: scratch, asOf: AS_OF });
  assert.equal(anon.code, 401);
});

test("NO DOCKET IS SAID: an office with no docket store does not pass off its zero as the docket's", async () => {
  const { readers } = worldReaders();
  readers.claimEffects = async () => ({ readable: true, events: [], store: "none" });
  const h = await houseBundle({ household: HOUSE }, ctx({ readers }));
  assert.equal(h.outcomes.count, 0);
  assert.equal(h.outcomes.store, "none");
  assert.match(h.outcomes.note, /no docket store/);
});

// POS-345: the printout is not a fallback. The scratch clone still carries a
// households.json naming this house; with the store unaskable the house read
// refuses rather than answer from it.
test("A STORE THE OFFICE CANNOT ASK is a refusal, never the clone's printed households.json", async () => {
  const keep = process.env.WORLD2_PG;
  delete process.env.WORLD2_PG;
  try {
    const { readers } = worldReaders();
    const h = await houseBundle({ household: HOUSE }, ctx({ readers }));
    assert.equal(h.refused?.[0], 503, "the house is the store's, and the store did not answer");
    assert.match(h.refused[2], /registry store did not answer/);
  } finally { process.env.WORLD2_PG = keep; }
});

// ── the page (POS-720, Darko 2026-10-19 22:17) ──────────────────────────────
//
// The whole house measured 421K as served for Starforge. The door's default is
// now the members as typed rows, paged, each naming its resident's whole read,
// with the world's house-wide blocks as counts; args: { full: true } is the
// whole house above, unchanged.

const served = (x) => JSON.stringify(x, null, 1).length; // the MCP's own serialization (mcp.mjs)

test("THE PAGE (POS-720): one typed row per member, each the doorstep's own numbers and naming its whole read", async () => {
  const { readers } = worldReaders();
  const p = await housePage({ household: HOUSE }, ctx({ readers }));
  assert.equal(p.read, "house");
  assert.equal(p.household, HOUSE);
  assert.equal(p.name, "Fixture");
  assert.deepEqual(p.ashore, ["r000", "r001", "r002"]);
  assert.deepEqual(p.not_ashore, ["r-harbor"]);
  assert.deepEqual(p.members.map((m) => m.handle), ["r000", "r001", "r002"]);
  assert.ok(!("residents" in p), "no resident's segments ride the page");
  for (const k of HOUSE_ONCE) assert.ok(!(k in p), `${k} rides the doorstep and the full answer, not the page`);
  for (const m of p.members) {
    const d = await doorstep(m.handle, { fresh: { odb: null, clone: scratch, asOf: AS_OF }, nowMs: NOW });
    const s = d.awaiting?.summary ?? null;
    const t = d.stamps?.tenses ?? null;
    assert.deepEqual([m.they_spoke_last, m.new_inbound, m.bounced], s ? [s.they_spoke_last, s.new_inbound, s.bounced || undefined] : [null, null, undefined], `${m.handle}'s mail is the doorstep's summary`);
    assert.deepEqual([m.stamps, m.staked], t ? [t.liquid, t.staked] : [null, null], `${m.handle}'s stamps are the doorstep's tenses`);
    assert.equal(m.read, `household { read: "doorstep", handle: "${m.handle}" }`);
    assert.ok(!("unread" in m), "no key, no owner-only count");
  }
  assert.deepEqual([p.members[0].they_spoke_last, p.members[0].new_inbound, p.members[0].bounced], [0, 0, 1]);
  assert.equal(p.members[0].at, "the-town/quay");
  assert.ok(!("moving" in p.members[0]));
  assert.deepEqual([p.members[0].last_active, p.members[0].last_active_crossing], ["2026-09-26T08:00:00.000Z", 213]);
  assert.equal(p.members[1].at, null);
  assert.deepEqual(Object.keys(p.members[0]), ["handle", "at", "last_active", "last_active_crossing", "they_spoke_last", "new_inbound", "bounced", "stamps", "staked", "read"]);
  assert.equal(memberRow("x", { stands: { x: -606.5, y: 161.7, mark_id: null, moving: true } }).at, "-606, 162", "open ground reads as metres");
});

test("THE PAGE (POS-720): stances and stakes are counts with their reads named; outcomes are the full answer's own", async () => {
  const { readers, calls } = worldReaders();
  const p = await housePage({ household: HOUSE }, ctx({ readers }));
  assert.equal(p.stances.awaiting, 1);
  assert.equal(p.stances.set_downs_awaiting, 0);
  assert.match(p.stances.read, /household \{ read: "stances" \}/);
  assert.ok(!("awaiting" in p.stances && Array.isArray(p.stances.awaiting)), "a count, never the rows");
  assert.deepEqual([p.stakes.published, p.stakes.at_risk], [2, 1]);
  assert.match(p.stakes.read, /household \{ read: "stakes" \}/);
  assert.ok(!("rows" in p.stakes));
  assert.deepEqual(calls.stances, [["r000", "r001", "r002"]], "asked once, for the whole house");
  assert.deepEqual(calls.stakesFor, [["r000", "r001", "r002"]]);
  assert.equal(calls.walkers, 1);
  assert.deepEqual(calls.lastActive, [["r000", "r001", "r002"]]);
  const whole = await houseBundle({ household: HOUSE }, ctx({ readers: worldReaders().readers }));
  // outcomes are a count with their read named, the full answer's own numbers (review #664 item 2)
  assert.deepEqual([p.outcomes.count, p.outcomes.since_crossing, p.outcomes.through_crossing], [whole.outcomes.count, whole.outcomes.since_crossing, whole.outcomes.through_crossing]);
  assert.ok(!("events" in p.outcomes));
  assert.match(p.outcomes.read, /household { read: "outcomes" }/);
  // at_risk is the stakes read's own, so an unmeasured escrow stays null (review #664 item 3)
  const blindReaders = worldReaders().readers;
  blindReaders.stakesFor = async () => ({ next_settlement: null, count: 2, at_risk: null, unavailable: "the escrow projection did not answer", rows: [{ mark: "r001/shed", at_risk: true }] });
  const blind = await housePage({ household: HOUSE }, ctx({ readers: blindReaders }));
  assert.equal(blind.stakes.at_risk, null, "unknown, never a recount of the rows");
  assert.match(blind.stakes.unavailable, /escrow/);
  assert.match(p.shape, /full: true/);
});

test("THE PAGE (POS-720): limit and offset walk the members, and the last page says it is complete", async () => {
  const { readers } = worldReaders();
  const a = await housePage({ household: HOUSE, limit: 2 }, ctx({ readers }));
  assert.deepEqual(a.members.map((m) => m.handle), ["r000", "r001"]);
  assert.deepEqual([a.total, a.shown, a.limit, a.offset, a.complete, a.next_offset], [3, 2, 2, 0, false, 2]);
  assert.match(a.more_note, /1 further member — call again with offset: 2/);
  const b = await housePage({ household: HOUSE, limit: 2, offset: 2 }, ctx({ readers: worldReaders().readers }));
  assert.deepEqual(b.members.map((m) => m.handle), ["r002"]);
  assert.equal(b.complete, true);
  assert.ok(!("next_offset" in b) && !("more_note" in b));
  assert.deepEqual(pageBounds(undefined, undefined), { limit: HOUSE_PAGE, offset: 0 });
  assert.deepEqual([pageBounds(0, -3).limit, pageBounds(0, -3).offset], [HOUSE_PAGE, 0]);
  assert.match(pageBounds(0, -3).limit_note, /limit 0 is not a whole number/);
  assert.deepEqual(pageBounds(999, "4"), { limit: HOUSE_PAGE_MAX, offset: 4, limit_note: `limit 999 is more than a page carries: ${HOUSE_PAGE_MAX} is the most` });
  assert.match(pageBounds("x", 0).limit_note, /not a whole number/, "a limit that was asked and coerced says so");
  assert.ok(!("limit_note" in pageBounds(3, 0)));
  const past = await housePage({ household: HOUSE, offset: 9 }, ctx({ readers: worldReaders().readers }));
  assert.deepEqual(past.members, []);
  assert.match(past.offset_note, /offset 9 is past the last member \(3 in all\)/);
});

test("THE PAGE (POS-720): a member row is about 300 characters as served", async () => {
  // Starforge's busiest resident on 10-19 (house.out, 21:36 EDT): every field present.
  const busy = memberRow("jetto-of-starforge", {
    stands: { x: -606.5, y: 161.7, mark_id: null, moving: true },
    awaiting: { summary: { they_spoke_last: 193, new_inbound: 52, bounced: 3 } },
    stamps: { tenses: { liquid: 906, staked: 24, minted: 943 } },
    unread: 576,
  });
  Object.assign(busy, { last_active: "2026-10-20T01:06:25.633Z", last_active_crossing: 260 });
  assert.ok(served(busy) <= 340, `a busy row is ${served(busy)} characters as served`);
  const { readers } = worldReaders();
  const p = await housePage({ household: HOUSE }, ctx({ readers }));
  for (const m of p.members) assert.ok(served(m) <= 320, `${m.handle}'s row is ${served(m)} characters`);
});

test("THE PAGE (POS-720): the owner-only unread count rides a member the key holds, and no other", async () => {
  const key = { household: "fixture", handles: new Set(["r000"]) };
  const { readers } = worldReaders();
  const p = await housePage({ household: HOUSE }, ctx({ readers, key }));
  assert.ok("unread" in p.members[0], "the key holds r000");
  assert.ok(p.members[0].unread === null || Number.isInteger(p.members[0].unread));
  assert.ok(!("unread" in p.members[1]) && !("unread" in p.members[2]), "a housemate the key does not hold reads public");
});

test("THE DOOR (POS-720): read: \"house\" answers the page; full: true answers the whole house, from MCP args and from a GET's query string", async () => {
  const page = await householdApex({ read: "house", household: HOUSE }, null, { clone: scratch, asOf: AS_OF });
  assert.ok(Array.isArray(page.members), JSON.stringify(page).slice(0, 300));
  assert.ok(!("residents" in page));
  const viaArgs = await householdApex({ read: "house", args: { household: HOUSE, full: true } }, null, { clone: scratch, asOf: AS_OF, strictFields: true });
  assert.deepEqual(Object.keys(viaArgs.residents ?? {}), ["r000", "r001", "r002"], JSON.stringify(viaArgs).slice(0, 300));
  const viaGet = await householdApex({ read: "house", household: HOUSE, full: "true" }, null, { clone: scratch, asOf: AS_OF });
  assert.deepEqual(Object.keys(viaGet.residents ?? {}), ["r000", "r001", "r002"]);
  const paged = await householdApex({ read: "house", args: { household: HOUSE, limit: 1 } }, null, { clone: scratch, asOf: AS_OF, strictFields: true });
  assert.deepEqual(paged.members.map((m) => m.handle), ["r000"]);
});

// POS-720 review item 1, the issue's own done line: the default page stays bounded at
// Starforge's scale. Ten busy members, 61 stances waiting, 40 outcomes, every block
// at its widest, through housePage itself with the store's readers stubbed.
test("THE PAGE (POS-720): ten busy members at Starforge's scale serve under 8K", async (t) => {
  const members = Array.from({ length: 10 }, (_, i) => `a-busy-resident-handle-${String(i).padStart(2, "0")}`);
  const body = "A gold drawing left on the terrace steps: a plumb line from a scaffold, its bob pointing at a mark on the floor. The line goes up.";
  const readers = {
    registry: { registry: { households: { starforge: { name: "Starforge", residents: members } } }, pins: {}, from: "the registry store" },
    stances: async () => ({ stances_awaiting: 61, awaiting: Array.from({ length: 20 }, (_, i) => ({ mark: `spark-the-builder/the-datum-mark-${i}`, by: "spark-the-builder", body, on_your_ground: ["wright/the-trueing-terrace"] })),
      standing: [], cursor: "20", complete: false, set_downs_awaiting: [{ thing: "x/y" }] }),
    stakesFor: async () => ({ next_settlement: { at: "2026-10-20T18:00:00.000Z" }, count: 120, at_risk: 4,
      rows: Array.from({ length: 120 }, (_, i) => ({ mark: `rei/mark-${i}`, kind: "sited", body, escrow: i % 5, at_risk: i < 4 })) }),
    walkers: async () => ({ at: 260.4, walkers: members.map((h, i) => ({ handle: h, x: -12345.6 + i, y: 23456.7, mark_id: i % 2 ? `${h}/the-long-named-home-of-${h}` : null, moving: i % 3 === 0 })) }),
    claimEffects: async () => ({ readable: true, store: "docket", events: Array.from({ length: 40 }, (_, i) => ({ kind: "claim-locked", mark: `rei/mark-${i}`, at: "2026-10-19T18:00:00.000Z", crossing: 259, cause: body })) }),
  };
  const ix = {
    asOf: async () => "fixture-as-of",
    hasResident: async () => true,
    mailAwaiting: async () => ({ summary: { they_spoke_last: 1193, new_inbound: 552, they_spoke_again: 641, reply_queued: 0, last_word_yours: 226, bounced: 12 } }),
    stampsDetail: async () => ({ tenses: { liquid: 123906, staked: 12424, minted: 129943 } }),
    lastActiveFor: async (hs) => new Map(hs.map((h) => [h, { at: "2026-10-20T01:06:25.633Z", crossing: 260 }])),
  };
  const p = await housePage({ household: "starforge" }, { key: null, clone: scratch, odb: null, nowMs: NOW, ix, readers });
  assert.equal(p.members.length, 10);
  assert.equal(p.outcomes.count, 40);
  const n = served(p);
  t.diagnostic(`served: ${n} characters`);
  assert.ok(n <= 8192, `the default page at Starforge's scale is ${n} characters as served`);
});

// ── the house's glance through the door (POS-633 PR-1) ──────────────────────
test("THE GLANCE (POS-633): household { read_shape: \"v2\" } answers the house's glance through the store, every key explained", async () => {
  const { unexplained } = await import("../src/read-grammar.mjs");
  const key = { household: "fixture", handles: new Set(["r000", "r001"]) };
  const g = await householdApex({ read_shape: "v2", handle: "r000" }, key, { clone: scratch, asOf: AS_OF, odb: null });
  assert.equal(g.read_shape, "v2", JSON.stringify(g).slice(0, 300));
  assert.deepEqual([g.house.slug, g.house.name, g.house.human, g.house.you], [HOUSE, "Fixture", "Fixture's human", "r000"]);
  assert.deepEqual(g.house.members.map((m) => m.split(" · ")[0]), ["r000", "r001"], "the members this key holds, ashore, in the house's order");
  assert.ok(Number.isInteger(g.needs.count));
  assert.equal(g.needs.bounced, 1, "r000's bounce, from needs-you");
  assert.ok(g.stamps.pool.sum >= 0 && g.stamps.pool.pending === "POS-326");
  assert.deepEqual(unexplained("household", g, 2), []);
  assert.ok(JSON.stringify(g, null, 1).length <= 4096);
  assert.doesNotMatch(JSON.stringify(g), /https?:\/\//);
  const s = await householdApex({ read_shape: "v2", since: g.cursor }, key, { clone: scratch, asOf: AS_OF, odb: null });
  assert.equal(s.read_shape, "v2");
  assert.ok("complete" in s && typeof s.cursor === "string");
  assert.deepEqual(unexplained("household", s, 2), []);
});

test("THE DEEP READS (POS-633 part 2): closer, happened and stamps' went answer typed rows for a key that holds the house", async () => {
  const key = { household: "fixture", handles: new Set(["r000", "r001"]) };
  const ctxD = { clone: scratch, asOf: AS_OF, odb: null, strictFields: true };
  const c = await householdApex({ read: "closer" }, key, ctxD);
  assert.equal(c.read, "closer", JSON.stringify(c).slice(0, 300));
  assert.ok(Array.isArray(c.rows));
  assert.deepEqual(c.rows.map((r) => r.with), [], "the fixture's letters are between housemates: none are closer");
  assert.match(c.says, /no addressee/);
  const h = await householdApex({ read: "happened" }, key, ctxD);
  assert.equal(h.read, "happened", JSON.stringify(h).slice(0, 300));
  assert.ok(Array.isArray(h.rows) && typeof h.cursor === "string");
  const h2 = await householdApex({ read: "happened", since: h.cursor }, key, ctxD);
  assert.ok(Array.isArray(h2.rows) && h2.since, JSON.stringify(h2).slice(0, 300));
  const w = await householdApex({ read: "stamps", args: { view: "went" } }, key, ctxD);
  assert.deepEqual([w.read, w.view], ["stamps", "went"], JSON.stringify(w).slice(0, 300));
  // an unknown view answers the books as before: old spellings stay working (review of #679, item 8)
  const books = await householdApex({ read: "stamps", args: { view: "gone" } }, key, ctxD);
  assert.equal(books.read, "stamps", JSON.stringify(books).slice(0, 300));
  assert.ok(!("view" in books) && "estate" in books, "the books, not the went rows");
  assert.equal((await householdApex({ read: "happened", since: "yesterday" }, key, ctxD)).code, 422);
  assert.equal((await householdApex({ read: "closer" }, null, ctxD)).code, 401);
  assert.equal((await householdApex({ read: "closer", since: "c1.1.1." }, key, ctxD)).code, 422, "closer takes no cursor");
});

// The deep reads on the store, every window held (review of #679): a cursor's id
// bounds happened (an act before it is absent, one after is present); happened is
// the key's residents and the house's own human, never a housemate the key does
// not hold; closer counts delivered letters only, multi-recipient ones included,
// never a housemate; went is bounded by the ledger's own seq and leaves out a
// gift between housemates.
test("THE DEEP READS ON THE STORE (POS-633 part 2): every window held", async () => {
  const key = { household: "fixture", handles: new Set(["r000", "r001"]) };
  const ctxD = { clone: scratch, asOf: AS_OF, odb: null, strictFields: true };
  const owner = await IX.store.connect("world2_owner");
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  const act = async (actor, at) => (await owner.query(
    "INSERT INTO acts (at, actor, action, class, household, object) VALUES ($1, $2, 'say', 'voice', 'hh:fixture-house', null) RETURNING id::text AS id", [at, actor])).rows[0].id;
  const hex = (n) => n.toString(16).padStart(64, "0");
  try {
    // happened: a cursor's id bounds it
    const before = await act("r000", ago(3_600_000));
    const h = await householdApex({ read: "happened" }, key, ctxD);
    assert.ok(h.rows.some((r) => r.hand === "r000"), JSON.stringify(h).slice(0, 300));
    const after = await act("r001", ago(1000));
    const housemate = await act("r002", ago(900));
    const human = await act("human-of-fixture-house", ago(800));
    const h2 = await householdApex({ read: "happened", since: h.cursor }, key, ctxD);
    const hands = h2.rows.map((r) => r.by);
    assert.deepEqual(hands, ["Fixture's human", "r001"], `only after the cursor, the key's own and the house's human: ${JSON.stringify(h2.rows)}`);
    assert.equal(h2.complete, true);
    assert.ok(Number(after) > Number(before) && Number(housemate) > 0 && Number(human) > 0);

    // closer: delivered letters only, a multi-recipient one counted, never a housemate
    const letter = (id, from, to, json, delivered) => owner.query(
      "INSERT INTO town_letters (id, from_h, to_h, date, json, delivered_at, digest) VALUES ($1, $2, $3, $4, $5, $6, 'd')",
      [id, from, to, new Date().toISOString().slice(0, 10), json, delivered]);
    await letter("ls-1", "r-stranger", "r000", JSON.stringify({ id: "ls-1" }), new Date().toISOString());
    await letter("ls-2", "r-stranger", "r-other", JSON.stringify({ id: "ls-2", toList: ["r-other", "r001"] }), new Date().toISOString());
    await letter("ls-3", "nobody", "r000", JSON.stringify({ id: "ls-3" }), null); // never arrived
    await letter("ls-4", "r000", "r002", JSON.stringify({ id: "ls-4" }), new Date().toISOString()); // a housemate the key does not hold
    const c = await householdApex({ read: "closer" }, key, ctxD);
    assert.deepEqual(c.rows.map((r) => [r.with, r.letters]), [["r-stranger", 2], ["r-other", 1]], JSON.stringify(c.rows));

    // went: the ledger's lines inside the window, a gift between housemates left out
    const line = (seq, canonical, at) => owner.query("INSERT INTO stamp_lines (seq, canonical, sig, seal, written_at) VALUES ($1, $2, 'sig', $3, $4)", [seq, canonical, hex(seq), at]);
    await line(1, "- 2026-10-18 · r000 → stake:world-mark/x/y · 1 · via: api", ago(2 * 86_400_000));
    await line(2, "- 2026-10-20 · r001 → BURN · 2 · for: correction:z", ago(3_600_000));
    await line(3, "- 2026-10-20 · r000 → r002 · 3 · for: gift", ago(1_800_000));
    const w = await householdApex({ read: "stamps", args: { view: "went" } }, key, ctxD);
    assert.deepEqual(w.rows.map((r) => [r.from, r.to, r.stamps]), [["r001", "BURN", 2]], JSON.stringify(w.rows));
  } finally {
    await owner.query("DELETE FROM town_letters WHERE id LIKE 'ls-%'").catch(() => {});
    await owner.end();
  }
});
