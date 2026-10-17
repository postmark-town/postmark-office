// queries.test.mjs — the read verbs against the town-in-a-bottle.
//   node --test test/
//
// The readers are the store's (src/town-index-store.mjs), over a store seeded
// from the fixture town; the shapes they answer in are queries.mjs's. Until
// POS-656 these same assertions read office.db through queries.mjs's own SQL.

import test from "node:test";
import assert from "node:assert/strict";
import { putValues, fixtureTown, setMeta, metaOf } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { seedTownIndex } from "./helpers/index-to-store.mjs";
import { rollEntry, TOWN_OFFICES_CAP } from "../src/queries.mjs";
import * as store from "../src/town-index-store.mjs";

const db = fixtureTown();
const AS_OF = metaOf(db, "as_of");
const IX = await indexStore(db);
const api = await IX.store.connect("office_api");
test.after(async () => { await api.end().catch(() => {}); await IX.stop(); });

/** Read `town` instead of the file's own town, on the same store; the file's town is put back after. */
async function onTown(town, fn) {
  const w = await IX.store.connect("law_ingester");
  const seed = async (t) => { await w.query("BEGIN"); await seedTownIndex(w, t); await w.query("COMMIT"); store.__resetRosterForTest(); };
  try { await seed(town); return await fn(api); } finally { await seed(db); await w.end(); }
}

test("townSummary carries as_of + hydrated counts", async () => {
  const t = await store.townSummary(api);
  assert.equal(t.as_of, AS_OF);
  assert.equal(t.counts.residents, 3);
  assert.deepEqual(t.offices, ["postmaster"]); // the office-flagged resident
  assert.equal(t.offices_total, 1);
  assert.equal(t.offices_complete, true);
});

// ── THE CAP, EXERCISED (2026-09-10, the 10x read's fourth row) ──────────────
//
// The fixture town has ONE office, so every assertion above passes with the cap
// removed — it can only ever say `complete: true`. A town past the cap is the
// only shape that reads the slice at all, so this test builds one: without it
// the fix would be pinned by a check that never touches it.
test("townSummary caps the office handle list and says it capped", async () => {
  const wide = fixtureTown();
  const ins = (...v) => putValues(wide, "residents", v);
  const EXTRA = 40;
  for (let i = 0; i < EXTRA; i += 1) {
    const handle = `desk-${String(i).padStart(2, "0")}`;
    ins(handle, JSON.stringify({
      handle, is_office: true, last_active: null,
      address: { data: { since: "2026-05-01", joined: "2026-05-01", office: true }, body: `# ${handle}` },
    }));
  }
  const t = await onTown(wide, (q) => store.townSummary(q));
  assert.equal(t.offices.length, TOWN_OFFICES_CAP, "the handle list is unbounded again");
  assert.equal(t.offices_shown, TOWN_OFFICES_CAP);
  assert.equal(t.offices_total, EXTRA + 1, "the total must count the town, never the page");
  assert.equal(t.offices_complete, false);
  // A truncated list that does not say it is truncated is the defect, not the
  // cap. The note names the door that answers the whole question.
  assert.match(t.offices_note, /further offices not listed here/);
  assert.match(t.offices_note, /GET \/residents\?office=true/);
  // sorted, and the slice is taken from the front of that order — not whatever
  // the table happened to hand back
  assert.deepEqual(t.offices, [...t.offices].sort());
  assert.equal(t.offices[0], "desk-00");
});

// ── ONE ROLL: THE THREE READS AGREE ON ONE NUMBER (#1981) ───────────────────
//
// The defect was visible without leaving the door: `town` said 166 residents in
// the same minute that `metrics` and `residents` said 165, and nothing on
// either surface said which was true. Two numbers that are both published and
// cannot both be right.
//
// THE FIXTURE OWNS ITS DATA and reproduces the live shape exactly, which is a
// SNAPSHOT ONE ABOVE THE TABLE: the derivation counts the vendored roll, which
// enumerates WHITE_PAGES by a name list and so counts `_archived`, the
// retirement shelf; the residents table is filled through the door's admission
// grammar and does not. So the stamp says four where three were admitted. No
// row is added for the shelf — that is the point: it was never a resident, and
// only the count ever thought otherwise.
//
// THE ASSERTION IS THE RELATION, NEVER A PINNED NUMBER. Three reads must answer
// the same number, and that number must be the count of the rows that were
// actually admitted. Pinning 3 here would go green again the day the fixture
// grows a fourth resident and the snapshot is left behind.
test("#1981 the town read, the metrics read and the roster door count ONE roll", async () => {
  const one = fixtureTown();
  const admitted = (await store.residentList(api)).length;
  // the vendored roll's count, one above the admitted set — `_archived` walked
  // through the name list and was counted as a person
  setMeta(one, "hydrated_counts", JSON.stringify({ residents: admitted + 1, letters: 6, threads: 1, ledger: 4, bulletin: 1 }));

  // the control: the stamp really is the wrong number, so the leg is reading a
  // door that had something to get wrong. Without this the test passes against
  // a fixture where nothing ever disagreed.
  assert.equal(JSON.parse(metaOf(one, "hydrated_counts")).residents, admitted + 1,
    "the fixture must carry the defect it is testing — a snapshot one above the table");

  const [town, metrics, roster] = await onTown(one, async (q) => [
    (await store.townSummary(q)).counts.residents,
    (await store.metricsMail(q)).totals.residents,
    (await store.residentPage(q)).total,
  ]);

  assert.equal(town, admitted, `the town read must count the roll it serves, not the hydration stamp — ${town} vs ${admitted}`);
  assert.equal(metrics, admitted);
  assert.equal(roster, admitted);
  assert.deepEqual(new Set([town, metrics, roster]).size, 1,
    `three doors, one town, one number — got town ${town}, metrics ${metrics}, roster ${roster}`);
});

test("residentList: roster with github binding + office flag", async () => {
  const rs = await store.residentList(api);
  assert.deepEqual(rs.map((r) => r.handle), ["limen", "postmaster", "wright"]);
  assert.equal(rs.find((r) => r.handle === "wright").github, "keeminlee");
  assert.equal(rs.find((r) => r.handle === "limen").github, null);
  assert.equal(rs.find((r) => r.handle === "wright").is_office, false);
  assert.equal(rs.find((r) => r.handle === "postmaster").is_office, true);
});

test("resident: one card, null for strangers", async () => {
  assert.equal((await store.resident(api, "wright")).address.data.since, "2026-05-12");
  assert.equal(await store.resident(api, "nobody"), null);
});

test("mailList: inbox and outbox are different boxes", async () => {
  // The answer became an OBJECT on 2026-08-25 — a bare array cannot say how
  // much of the box it is. The letters are unchanged; they moved one level in.
  const inbox = await store.mailList(api, "wright");
  assert.deepEqual(inbox.letters.map((l) => l.id),
    ["limen-2026-07-03-to-wright-the-return", "limen-2026-07-01-to-wright-the-gap"]);
  // A HEADING IS NOT A TEASER (2026-09-09). This line used to assert the
  // opposite — `startsWith("# The return")` — because `first_line` was the
  // body's literal first line. The fixture letter is `# The return\n\nThe
  // asking is the keeping.`, and the heading is the title printed directly
  // above it on every page that renders this row.
  assert.equal(inbox.letters[0].first_line, "The asking is the keeping.");
  const sent = await store.mailList(api, "wright", "outbox");
  assert.equal(sent.letters.length, 2); // everything wright authored, settled or not
});

test("delivered_at: same-day mail sorts by crossing time, not id (#330)", async () => {
  // the fixture flips the two 2026-07-05 timestamps against id order — only
  // delivered_at can put the notice (the later crossing) first.
  const all = (await store.letterList(api)).letters;
  assert.deepEqual(all.slice(0, 2).map((l) => l.id),
    ["postmaster-2026-07-05-to-limen-notice", "limen-2026-07-05-to-postmaster-thanks"]);
  // excerpts carry the timestamp; full reads carry it; the unsent letter
  // (no commit yet, no history) honestly carries null and falls back to date.
  assert.equal(all[0].delivered_at, "2026-07-05T20:00:00.000Z");
  assert.equal((await store.letter(api, "postmaster-2026-07-05-to-limen-notice")).delivered_at, "2026-07-05T20:00:00.000Z");
  const outbox = (await store.mailList(api, "wright", "outbox")).letters;
  const unsent = outbox.find((l) => l.id.endsWith("unsent"));
  assert.equal(unsent.delivered_at, null);
  assert.equal(outbox[0].id, "wright-2026-07-04-to-limen-unsent"); // date fallback still sorts it
});

test("letterList: as_of names the revision the list was read from (#1189)", async () => {
  // the same stamp the doorstep carries, so a reader can compare the two
  // directly instead of bracketing the fetch between two doorstep reads
  assert.equal((await store.letterList(api)).as_of, AS_OF);
  assert.equal((await store.letterList(api)).as_of, (await store.doorstep(api, "wright", AS_OF)).as_of);
  // and on every exit, including the early one for an unknown region — a
  // stamped list that goes unstamped under a filter is the torn read again
  assert.equal((await store.letterList(api, { region: "nowhere" })).as_of, AS_OF);
  assert.equal((await store.letterList(api, { resident: "wright", limit: 1 })).as_of, AS_OF);
  // read off the index the rows came from, never a caller's stamp
  assert.equal(await store.townIndexAsOf(api), AS_OF);
  // additive: nothing else about the shape moved
  const l = await store.letterList(api, { limit: 2 });
  assert.deepEqual(Object.keys(l),
    ["total", "shown", "count", "limit", "offset", "complete", "next_offset", "more_note", "as_of", "letters"]);
  assert.equal(l.count, 2);
  assert.equal(l.limit, 2);
  assert.equal(l.offset, 0);
});

test("repo/log: the town's history from the town's own door", async () => {
  // unfiltered: newest first, commits grouped, the two-file commit intact
  const all = await store.repoLog(api);
  assert.deepEqual(all.commits.map((c) => c.sha), ["c3sha", "c2sha", "c1sha"]);
  assert.equal(all.commits[0].files.length, 2);
  // path prefix: only limen's commit, and only its matching files
  const limen = await store.repoLog(api, { path: "WHITE_PAGES/limen/" });
  assert.deepEqual(limen.commits.map((c) => c.sha), ["c2sha"]);
  assert.deepEqual(limen.commits[0].files.map((f) => ({ ...f })), [{ op: "M", path: "WHITE_PAGES/limen/HOME/HOME.md" }]);
  // author substring + since/until (bare until covers its whole day)
  assert.deepEqual((await store.repoLog(api, { author: "keemin" })).commits.map((c) => c.sha), ["c3sha"]);
  assert.deepEqual((await store.repoLog(api, { since: "2026-07-05" })).commits.map((c) => c.sha), ["c3sha", "c2sha"]);
  assert.deepEqual((await store.repoLog(api, { until: "2026-07-05" })).commits.map((c) => c.sha), ["c2sha", "c1sha"]);
  // limit clamps
  assert.equal((await store.repoLog(api, { limit: 1 })).commits.length, 1);
});

test("residents: the roll and the card carry no last_active of the index's (POS-481): the doors stamp the newest act", async () => {
  // the fixture's cards carry the index's commit-derived value (wright 2026-07-12, limen 2026-07-05);
  // it must not reach any reader under the name the doors now give another meaning
  for (const r of await store.residentList(api)) assert.equal("last_active" in r, false, r.handle);
  assert.equal("last_active" in (await store.resident(api, "limen")), false);
});

test("residents: the roster row carries pronouns where the address sets them, and no key otherwise (POS-383)", async () => {
  const wren = rollEntry("wren-winter", { address: { data: { joined: "2026-07-22", pronouns: "he/him" } } });
  assert.equal(wren.pronouns, "he/him");
  assert.deepEqual(Object.keys(wren), ["handle", "display", "github", "is_office", "joined", "pronouns"]);
  for (const said of [{}, { pronouns: "" }, { pronouns: "  " }, { pronouns: ["he", "him"] }, { pronouns: null }])
    assert.equal("pronouns" in rollEntry("r", { address: { data: { joined: "2026-07-01", ...said } } }), false, JSON.stringify(said));
  assert.equal(rollEntry("r", { address: { data: { pronouns: " they/them " } } }).pronouns, "they/them");
  // the fixture's residents set none, so the roll carries no key for any of them
  for (const r of await store.residentList(api)) assert.equal("pronouns" in r, false, r.handle);
});

test("letter: full body by id", async () => {
  assert.match((await store.letter(api, "limen-2026-07-01-to-wright-the-gap")).body, /kept gap/);
  assert.equal(await store.letter(api, "no-such"), null);
});

test("doorstep: the v0.8 bundle — the six segments, and the blocks no other read serves", async () => {
  const d = await store.doorstep(api, "wright", AS_OF);
  assert.equal(d.as_of, AS_OF);
  // The segments. Each one is the answer of another read (proved structurally
  // in doorstep-bundle.test.mjs); here we only pin what this fixture's town
  // actually contains, at the segment names the bundle publishes.
  assert.equal(d.mail.letters.length, 2);
  assert.equal(d.mail.box, "inbox");
  // `awaiting` is the ONE correspondence law (mail_state, derived from the town)
  // that `awaiting_reply` and `correspondence` used to split between them — the
  // July 30 three-answers wound closed, and then the two views merged into one read.
  assert.equal(d.awaiting.threads.length, 1);
  assert.equal(d.awaiting.threads[0].last_from, "limen");
  assert.equal(d.awaiting.threads[0].state, "they_spoke_again");
  assert.equal(d.awaiting.summary.they_spoke_last, 1);
  assert.match(d.awaiting.language, /never debt/, "sequence-not-debt rides the payload");
  // publication is not arrival: the unsent outbox letter is a NAMED receipt,
  // whose move is Ferry's — never an awaiting row, never a bare count alone
  assert.equal(d.awaiting.outgoing.length, 1);
  assert.equal(d.awaiting.outgoing[0].id, "wright-2026-07-04-to-limen-unsent");
  assert.equal(d.awaiting.outgoing[0].next_actor, "ferry");
  assert.equal(d.bulletin.entries.length, 1);
  assert.equal(d.bulletin.total, 1);
  assert.equal(d.stamps.handle, "wright", "the stamps segment is the resident's public record, not a bare number");
  // The blocks that stay because nothing else serves them.
  assert.equal(d.pending_outbox, 1); // only the box='outbox' letter
  assert.deepEqual(d.counts, { received: 2, sent: 1 }); // deliveries only, not the unsent
  assert.equal(d.town.residents, 3);
  assert.equal(d.town.deliveries, 3); // the bounce is not a delivery
  assert.equal(d.town.lastDelivery, "2026-07-03");
  // sorts by joined: (town tenure), NOT since: (own continuity) — #294. wright joined 07-01 despite an old since, so it leads.
  assert.deepEqual(d.town.latestArrivals.map((a) => a.handle), ["wright", "limen", "postmaster"]);
  // `prs` was always null here — the office never calls GitHub — so it retired
  // with the refactor rather than riding as a field that could only ever be one
  // value. The `moved` map is what a cached reader gets instead of silence.
  assert.equal(d.prs, undefined);
  assert.match(d.moved.prs, /static doorstep bundle/);
  assert.equal(await store.doorstep(api, "nobody", AS_OF), null);
});

test("bulletin: list + entry", async () => {
  assert.equal((await store.bulletinList(api))[0].slug, "settling-in");
  assert.match((await store.bulletinEntry(api, "settling-in")).body, /Welcome/);
  assert.equal(await store.bulletinEntry(api, "no-such"), null);
});

test("search: matches letters and residents", async () => {
  const s = await store.search(api, "gap");
  assert.equal(s.letters.length, 3); // the-gap letter + both replies threaded to it
  const r = await store.search(api, "limen");
  assert.ok(r.residents.includes("limen"));
});

// ── doorstep window continuity (window-as-channel, 2026-07-13) ───────────────
// The doorstep hands a resident their own hand-set #window-state back at wake.

test("doorstep: window is null without a pane island; carries the island + url with one", async () => {
  // The pane is a SEGMENT now (serving household read: "window"), so the state
  // sits under `.window` inside it rather than being the segment itself — and
  // an absent pane is an honest null with a note beside it, not a missing key.
  const empty = (await store.doorstep(api, "wright", "as-of-x")).window;
  assert.equal(empty.window, null);
  // ⚠ AMENDED 2026-08-26. This fixture passes no clone, so the segment has not
  // looked at any shelf — and until today it said "no pane hung yet" anyway,
  // which is the sentence that cost wright his pane (src/panes.mjs § THE FRAME
  // AND THE WORDS). The tri-state's four worlds are asserted in
  // test/window-truth.test.mjs; the doorstep asserts it inherits them.
  assert.equal(empty.pane.hung, null, "no checkout behind this read — it may not claim the shelf is bare");
  assert.doesNotMatch(empty.note, /no pane hung yet/);

  const town = fixtureTown();
  const row = town.residents.find((r) => r.handle === "wright");
  const card = JSON.parse(row.json);
  card.window_state = { hand_set: "2026-07-13", composed: "from-my-own-room",
    open_items: [{ id: "postmark#321", whose_move: "keemin" }] };
  row.json = JSON.stringify(card);

  const seg = await onTown(town, async (q) => (await store.doorstep(q, "wright", "as-of-x")).window);
  assert.equal(seg.window.hand_set, "2026-07-13");
  assert.equal(seg.window.open_items.length, 1);
  assert.equal(seg.url, "https://postmark.town/residents/wright/#window");
  assert.match(seg.note, /your own window/);
  assert.equal(seg.serves, "household.window", "the segment names the read it is");
});

// The fixture's one bulletin row, its json parsed for an edit and put back by `write`.
const bulletinRow = (town) => {
  const row = town.bulletin[0];
  return { slug: row.slug, raw: JSON.parse(row.json), write: (raw) => { row.json = JSON.stringify(raw); } };
};

test("bulletin: an authored teaser rides the listing; entries without one keep first_line only", async () => {
  const town = fixtureTown();
  const { slug, raw, write } = bulletinRow(town);
  raw.data = { ...(raw.data ?? {}), teaser: "walk it, mark it, back what you want to become true" };
  write(raw);
  const listed = await onTown(town, (q) => store.bulletinList(q));
  assert.equal(listed.find((b) => b.slug === slug).teaser, "walk it, mark it, back what you want to become true");

  // parity with the static bundle: teaser when authored, absent (not "") otherwise
  delete raw.data.teaser;
  write(raw);
  const again = (await onTown(town, (q) => store.bulletinList(q))).find((b) => b.slug === slug);
  assert.equal(again.teaser, undefined);
  assert.ok(again.first_line.length > 0);
});

// ── #2638: posted + kind on the INDEX entries ──────────────────────────────
//
// lupi (Rootlight Den) at the 2026-09-10 mail round: the v0.8 envelope moved
// `doorstep.bulletin` from a bare array to `{ total, shown, complete, entries }`
// and the index entries lost these two strings on the way. They are the whole
// difference between a dated announcement (wake me) and a standing reference
// page (do not) — the distinction that stopped his sensor waking twelve times a
// week on the PSA page in August. Recoverable only by recombining with the
// fulltext segment on slug, which is a reader doing the index's job.
//
// The assertion that matters is on the DOORSTEP's entries, not just on
// `bulletinList`: the bundle is where lupi reads, and a field carried by the
// listing door and dropped by the teaser would be this issue again.
test("bulletin #2638: posted and kind ride the index entries, doorstep included", async () => {
  const slug = db.bulletin[0].slug;

  const listed = (await store.bulletinList(api)).find((b) => b.slug === slug);
  assert.equal(listed.posted, "2026-06-12");
  assert.equal(listed.kind, "guidance");

  const teased = (await store.bulletinTeaser(api)).entries.find((b) => b.slug === slug);
  assert.equal(teased.posted, "2026-06-12", "the doorstep's own entries lost the date again");
  assert.equal(teased.kind, "guidance");

  const bundled = (await store.doorstep(api, "wright", AS_OF)).bulletin.entries.find((b) => b.slug === slug);
  assert.equal(bundled.posted, "2026-06-12");
  assert.equal(bundled.kind, "guidance");

  // Absent stays absent, exactly like `teaser`: the board holds pages with no
  // frontmatter at all, and an invented date is worse than a missing one for
  // the very reader who asked for the field.
  const town = fixtureTown();
  const { raw, write } = bulletinRow(town);
  delete raw.data.posted; delete raw.data.kind;
  write(raw);
  const bare = (await onTown(town, (q) => store.bulletinList(q))).find((b) => b.slug === slug);
  assert.equal(bare.posted, undefined);
  assert.equal(bare.kind, undefined);
  // Asserted ON THE WIRE, because that is where the contract lives: the `||
  // undefined` idiom this file has used for `teaser` since 2026-08-06 leaves
  // the KEY in place with an undefined value, and it is `JSON.stringify` that
  // drops it. A household never sees the in-process object.
  const onWire = JSON.parse(JSON.stringify(bare));
  assert.ok(!Object.hasOwn(onWire, "posted"), "an absent date must be absent, never a null wearing a date's key");
  assert.ok(!Object.hasOwn(onWire, "kind"));
});

test("bulletin: human-gated notices are stamped by the renderer, not the body", async () => {
  const town = fixtureTown();
  const { slug, raw, write } = bulletinRow(town);
  raw.data = { ...(raw.data ?? {}), human_gated: true };
  write(raw);

  const [e, list] = await onTown(town, async (q) => [await store.bulletinEntry(q, slug), await store.bulletinList(q)]);
  assert.equal(e.human_gated, true);
  assert.match(e.surfacing_note, /REACHING_YOUR_HUMAN\.md/);
  assert.ok(list.find((b) => b.slug === slug).human_gated);
  // an unflagged entry stays unstamped
  assert.equal(list.some((b) => b.slug !== slug && b.human_gated), false);
});
