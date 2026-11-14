// event-sparks.test.mjs — POS-1035: what an event leaves behind, from the record (CORE-70 calls 4, 13, 22, 25; the frozen
// room → spark frame, POS-1035-room-spark-frame.md). The pure frame, room and attendance derivations first; then the calendar's
// one-event evidence and the lasting list, on a disposable store.

import test, { after } from "node:test";
import assert from "node:assert/strict";

const S = await import("../src/event-sparks.mjs");

const T = Date.parse("2026-11-14T20:00:00Z");
const min = (m) => T + m * 60_000;
const PLACE = { x: 100, y: 200 };
const voice = (handle, m, x, y, id = null) => ({ handle, text: `${handle} at ${m}`, at: min(m), x, y, place: null, aboard: false, ...(id ? { id } : {}) });

test("the window is the canonical post's: fields.doors_open ?? starts, through ends — never the filing date or a room's span", () => {
  assert.deepEqual(S.eventWindow({ fields: { doors_open: "2026-11-14T19:30:00Z" }, starts: "2026-11-14T20:00:00Z", ends: "2026-11-14T22:00:00Z" }),
    { from: Date.parse("2026-11-14T19:30:00Z"), to: Date.parse("2026-11-14T22:00:00Z") });
  assert.deepEqual(S.eventWindow({ starts: new Date(min(0)), ends: new Date(min(60)) }), { from: min(0), to: min(60) }, "no doors_open: starts");
  assert.equal(S.eventWindow({ starts: "nope", ends: null }), null);
});

test("the frozen frame: a real room's exact bbox midpoint and differences — halves kept, zero kept, no padding", () => {
  assert.deepEqual(S.roomFrame({ id: "t1-pica", extent: { x0: 10, y0: 20, x1: 41, y1: 20, span_m: 31 } }),
    { room: "t1-pica", at: { x: 25.5, y: 20 }, extent: { w: 31, h: 0 } }, "a line room: a half kept, a zero height kept");
  assert.deepEqual(S.roomFrame({ id: "t2-solo", extent: { x0: 7, y0: 9, x1: 7, y1: 9, span_m: 0 } }),
    { room: "t2-solo", at: { x: 7, y: 9 }, extent: { w: 0, h: 0 } }, "a single-point room is a real room, not 'no conversation'");
  assert.deepEqual(S.placeFrame({ x: "100", y: 200 }), { at: { x: 100, y: 200 }, extent: { w: 120, h: 120 } }, "no conversation: the place, a 60 m radius");
});

test("the event's room: the record's talk inside the window, clustered as the conversations page clusters it, at the place", () => {
  const voices = [
    voice("early", -30, 100, 200),            // before doors: not the event's talk
    voice("pica", 1, 100, 200), voice("seth", 2, 110, 205), voice("liv", 3, 150, 200),
    voice("far", 4, 900, 900), voice("far2", 5, 905, 900), voice("far3", 6, 910, 900), // a bigger room, elsewhere
    voice("late", 200, 100, 200),             // after ends
  ];
  const r = S.eventRoomFrom(voices, { window: { from: min(0), to: min(120) }, place: PLACE, edges: [min(-600)] });
  assert.equal(r.history, "complete");
  assert.equal(r.rooms.length, 1, "the bigger room elsewhere is not the event's");
  const [room] = r.rooms;
  assert.equal(room.id, `t${min(1)}-pica`);
  assert.equal(room.voice_count, 3, "the window scopes it: the early and late voices are not this event's talk");
  assert.deepEqual(room.participants, ["pica", "seth", "liv"]);
  assert.equal("voices" in room, false, "the room's header; its lines are the circle reads' to serve");
  assert.deepEqual(S.roomFrame(room), { room: room.id, at: { x: 125, y: 202.5 }, extent: { w: 50, h: 5 } });
});

test("no talk at the place is no room (the radius frame applies); talk the office cannot place in a settlement is UNAVAILABLE, never 'no conversation'", () => {
  const none = S.eventRoomFrom([voice("far", 1, 900, 900)], { window: { from: min(0), to: min(60) }, place: PLACE, edges: [min(-600)] });
  assert.deepEqual([none.rooms, none.history], [[], "complete"]);
  const old = S.eventRoomFrom([voice("pica", 1, 100, 200)], { window: { from: min(0), to: min(60) }, place: PLACE, edges: [min(30)] });
  assert.deepEqual([old.rooms, old.history], [[], "unavailable"]);
  assert.match(old.note, /not evidence that nobody spoke/);
});

test("several rooms at the place (a settlement split the talk, until CORE-97 carries it): ALL are the event's, in start order — none ranked or chosen (18:46:13Z, \"All of them, combined\")", () => {
  const voices = [voice("a", 1, 100, 200), voice("b", 2, 100, 201), voice("c", 40, 100, 200), voice("d", 41, 101, 200), voice("e", 42, 100, 199)];
  const r = S.eventRoomFrom(voices, { window: { from: min(0), to: min(60) }, place: PLACE, edges: [min(-600), min(30)] });
  assert.deepEqual(r.rooms.map((c) => [c.id, c.voice_count]), [[`t${min(1)}-a`, 2], [`t${min(40)}-c`, 3]], "both, in the order they started — the bigger is not preferred");
  assert.equal("room" in r, false, "no single room, no binding field");
  assert.equal("binding" in r, false);
});

test("the spark's place: every room, placed by the World's roomsPlace from absolute bounds in start order; a proved empty set is the locked circle; unknown history or a null for real rooms is HELD", () => {
  const row = { id: "pica/sorbet-night", title: "Sorbet night", body: "sorbet on the counter", place_x: 100, place_y: 200 };
  const window = { from: "2026-11-14T20:00:00.000Z", to: "2026-11-14T22:00:00.000Z" };
  const a = { id: "t1-a", voice_count: 2, extent: { x0: 10, y0: 20, x1: 30, y1: 20, span_m: 20 } };   // a line room
  const b = { id: "t2-b", voice_count: 3, extent: { x0: 55, y0: 18, x1: 61, y1: 26, span_m: 10 } };   // apart from it
  const asked = [];
  const roomsPlace = (bounds) => { asked.push(bounds); return { at: { x: 35.5, y: 22 }, extent: { w: 51, h: 8 } }; }; // World's answer, as given
  const two = S.sparkDeclaration(row, { rooms: [a, b], room_history: "complete", window, present: ["pica-house"] }, { roomsPlace });
  assert.deepEqual(asked, [[{ x0: 10, y0: 20, x1: 30, y1: 20 }, { x0: 55, y0: 18, x1: 61, y1: 26 }]], "the World is handed each room's absolute bounds, nothing else");
  assert.deepEqual([two.at, two.extent], [{ x: 35.5, y: 22 }, { w: 51, h: 8 }], "its place is the World's, verbatim");
  assert.deepEqual(two.properties.rooms, ["t1-a", "t2-b"], "every room, by id, in start order — the World's `rooms`");
  assert.equal("room" in two.properties, false, "no singular alias");
  const none = S.sparkDeclaration(row, { rooms: [], room_history: "complete", window, present: [] }, { roomsPlace: () => assert.fail("no room asks no place") });
  assert.deepEqual([none.at, none.extent], [{ x: 100, y: 200 }, { w: 120, h: 120 }], "a PROVED empty set: the place and the locked circle");
  assert.equal("rooms" in none.properties, false, "no rooms written for none");
  assert.match(S.sparkDeclaration(row, { rooms: [], room_history: "unavailable", window, present: [] }, { roomsPlace }).held, /cannot be told/,
    "unknown history is not a proved empty set");
  const nulled = S.sparkDeclaration(row, { rooms: [a], room_history: "complete", window, present: [] }, { roomsPlace: () => null });
  assert.match(nulled.held, /placed none .* a null is not "no room"/, "a null for real rooms holds; it never falls back to the locked circle");
  assert.deepEqual(nulled.rooms, ["t1-a"]);
  assert.match(S.sparkDeclaration(row, { rooms: [a], room_history: "complete", window, present: [] }, { roomsPlace: null }).held, /has no roomsPlace/,
    "an engine without the World's rule holds: no place of the office's own");
});

test("present: the households with a public act at the place in the window — once each, sorted; nothing without a household or a place", () => {
  const rows = [
    { at: new Date(min(5)), household: "rabbit", point: { x: 100, y: 200 } },
    { at: new Date(min(6)), household: "rabbit", point: { x: 101, y: 200 } },
    { at: new Date(min(7)), household: "otter", point: { x: 150, y: 220 } },
    { at: new Date(min(8)), household: "heron", point: { x: 400, y: 200 } },       // beyond 60 m
    { at: new Date(min(-5)), household: "badger", point: { x: 100, y: 200 } },     // before doors
    { at: new Date(min(9)), household: null, point: { x: 100, y: 200 } },          // a berth: no household
    { at: new Date(min(9)), household: "mole", point: null },                      // unplaced
  ];
  assert.deepEqual(S.presentFrom(rows, { window: { from: min(0), to: min(60) }, place: PLACE }), ["otter", "rabbit"]);
  assert.ok(!S.PRESENCE_ACTS.includes("rsvp"), "an RSVP is never presence (call 4)");
});

// ── on a disposable store: the calendar's one-event evidence and the lasting list ──

const { startStore } = await import("./helpers/embedded-store.mjs");
const store = await startStore({ db: "pos1035_event_sparks_test" });
after(() => store.stop());
const ENV = { ...process.env, WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), WORLD2_PG_IDLE_TX_MS: "2000" };
const { calendarAtOffice, PAST_PAGE } = await import("../src/events-store.mjs");
const owner = await store.connect("world2_owner");
after(() => owner.end());
const NOW = min(24 * 60 * 30); // a month after the evening

async function event(id, startMin, endMin, { doors = null, household = "pica-house", state = "announced" } = {}) {
  await owner.query(`INSERT INTO posts (id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act)
    VALUES ($1, 'event', $2, '', 'pica', $3, NULL, $4, $5, $6, $7, $8, $9, 0, 1, 1)`,
    [id, `the ${id}`, household, PLACE.x, PLACE.y, new Date(min(startMin)), new Date(min(endMin)), state,
      JSON.stringify({ doors_open: new Date(min(doors ?? startMin)).toISOString() })]);
}
async function act(action, actor, m, x, y, household, payload = {}) {
  await owner.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy, household)
    VALUES ($1, 0, $2, $3, $4, $5, 'world', $6, $7, $8)`, [new Date(min(m)), actor, action, action === "say" ? "voice" : action, JSON.stringify(payload), x, y, household]);
}

test("one event's evidence: its window, the rooms its talk formed at its place (each with its frozen frame), and the households with a public act there", async () => {
  await event("pica/sorbet-opening", 0, 120, { doors: -30 });
  await act("say", "pica", -20, 100, 200, "pica-house", { text: "Welcome, everyone!", place: "the cave" });
  await act("say", "seth", 10, 131, 200, "seth-house", { text: "Is the lemon one sour?", place: "the cave", reply_to: 1 });
  await act("say", "far", 30, 5000, 5000, "far-house", { text: "elsewhere", place: "the quay" });
  await act("walk", "otter1", 50, 120, 210, "otter-house");
  await act("walk", "heron1", 50, 900, 900, "heron-house");                 // public, but far from the place
  await act("rsvp", "badger1", 5, 100, 200, "badger-house");                // an RSVP: never presence
  await act("walk", "late1", 200, 100, 200, "late-house");                  // after ends
  const { event: e } = await calendarAtOffice({ event: "pica/sorbet-opening" }, { now: NOW, env: ENV, settlements: () => [min(-600)] });
  const ev = e.evidence;
  assert.deepEqual(ev.window, { from: new Date(min(-30)).toISOString(), to: new Date(min(120)).toISOString() }, "doors_open → ends");
  assert.equal(ev.complete, true);
  assert.equal(ev.room_history, "complete");
  assert.equal(ev.rooms.length, 1);
  assert.equal(ev.rooms[0].voice_count, 2);
  assert.deepEqual(ev.rooms[0].frame, { room: ev.rooms[0].id, at: { x: 115.5, y: 200 }, extent: { w: 31, h: 0 } }, "exact midpoint, a half and a zero kept");
  assert.equal("frame" in ev, false, "the rooms' combined place is the World's (roomsPlace), asked when the spark is made — not a second copy in the read");
  assert.deepEqual(ev.gallery, { rooms: [ev.rooms[0].id], sparks: [] }, "the gallery's coverage is the event's rooms; no accepted spark there yet: known none");
  assert.equal(ev.spark, null, "and no root before completion");
  assert.equal("room" in ev, false, "the room set replaces the single room");
  assert.deepEqual(ev.present, ["otter-house", "pica-house", "seth-house"], "public acts at the place in the window; never the RSVP");
  assert.match(ev.present_basis, /never RSVPs/);
});

test("an event still on answers its evidence so far; one not yet open, or cancelled, carries none", async () => {
  await event("pica/still-on", 0, 600);
  const { event: on } = await calendarAtOffice({ event: "pica/still-on" }, { now: min(60), env: ENV, settlements: () => [min(-600)] });
  assert.equal(on.evidence.complete, false);
  assert.equal(on.evidence.window.as_of, new Date(min(60)).toISOString());
  const { event: soon } = await calendarAtOffice({ event: "pica/still-on" }, { now: min(-60), env: ENV, settlements: () => [] });
  assert.equal("evidence" in soon, false);
  await event("pica/called-off", 0, 60, { state: "cancelled" });
  const { event: off } = await calendarAtOffice({ event: "pica/called-off" }, { now: NOW, env: ENV, settlements: () => [] });
  assert.equal("evidence" in off, false);
});

test("the lasting list: every ended event past the calendar's week, newest end first, paged with ties kept — the recent calendar stays short", async () => {
  for (let i = 0; i < PAST_PAGE + 3; i++) await event(`pica/old-${String(i).padStart(2, "0")}`, -24 * 60 * (20 + i), -24 * 60 * (20 + i) + 60);
  await event("pica/tie-a", -24 * 60 * 61, -24 * 60 * 61 + 60);
  await event("pica/tie-b", -24 * 60 * 61, -24 * 60 * 61 + 60);
  const recent = await calendarAtOffice({}, { now: NOW, env: ENV });
  assert.ok(!recent.ended.some((v) => v.id.startsWith("pica/old-")), "the calendar's ended list is still the week");
  const seen = [];
  let page = await calendarAtOffice({ past: true }, { now: NOW, env: ENV });
  for (;;) {
    for (let i = 1; i < page.past.length; i++) assert.ok(Date.parse(page.past[i - 1].ends) >= Date.parse(page.past[i].ends), "newest end first");
    seen.push(...page.past.map((v) => v.id));
    if (!page.next) break;
    page = await calendarAtOffice(page.next, { now: NOW, env: ENV });
  }
  for (let i = 0; i < PAST_PAGE + 3; i++) assert.ok(seen.includes(`pica/old-${String(i).padStart(2, "0")}`));
  assert.ok(seen.includes("pica/tie-a") && seen.includes("pica/tie-b"));
  assert.equal(new Set(seen).size, seen.length, "no event twice across pages");
  await assert.rejects(calendarAtOffice({ past: true, before: "soon" }, { now: NOW, env: ENV }), /not a cursor/);
  await assert.rejects(calendarAtOffice({ past: true, event: "pica/tie-a" }, { now: NOW, env: ENV }), /past lists events/);
});

// ── THE HOSTING STAKE, on disposable fixtures: a town in a bottle (its own engine, ledger and key) and this store ──
//
// Money proof (the brief): an insufficient balance writes nothing; a cancellation returns the whole stake once and a second cannot
// pay again; an interrupted act rolls back its coupled changes (no row, no line, no commit); a legacy (switch-off) event stays free.

const { generateKeyPairSync } = await import("node:crypto");
const { mkdirSync, writeFileSync, readFileSync, rmSync, appendFileSync } = await import("node:fs");
const { join, resolve, dirname } = await import("node:path");
const { execFileSync, spawnSync } = await import("node:child_process");
const { fileURLToPath } = await import("node:url");
const { copyTownTools } = await import("./helpers/town-tools.mjs");
const { tempDir } = await import("./helpers/temp-dir.mjs");
const { postAtTown, closeAtTown } = await import("../src/events-store.mjs");

const TOWN_SRC = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "town-clone");
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const bottle = tempDir("pos1035-stake-");
after(() => rmSync(bottle, { recursive: true, force: true, maxRetries: 5 }));
const KEY_FILE = join(bottle, "stamp-key.pem");
writeFileSync(KEY_FILE, privateKey.export({ type: "pkcs8", format: "pem" }));
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
const ledgerText = (dir) => readFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
const verifies = (dir) => spawnSync(process.execPath, [join(dir, "tools", "stamp-verify.mjs"), "--repo", dir], { encoding: "utf8" });
let townN = 0;
function townInABottle() {
  const dir = join(bottle, `town-${++townN}`);
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  copyTownTools(TOWN_SRC, dir);
  writeFileSync(join(dir, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  writeFileSync(join(dir, "tools", "github-ids.json"), JSON.stringify({ wright: { login: "w", id: 7 }, ada: { login: "a", id: 9 } }));
  // wright earns 25 stamps (five days of five letters), ada 10
  const lines = [];
  const days = { wright: ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"], ada: ["2026-06-07", "2026-06-08"] };
  for (const [who, dates] of Object.entries(days))
    for (const date of dates) for (let i = 1; i <= 5; i++) lines.push(`- ${date} · ${who}-${date}-${i} · ${who} → pen-pal-${i} · thread: new`);
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), `# ledger\n\n${lines.join("\n")}\n`);
  execFileSync(process.execPath, [join(dir, "tools", "stamp-mint.mjs"), "--append", "--key", KEY_FILE, "--repo", dir], { cwd: dir });
  execFileSync(process.execPath, [join(dir, "tools", "stamp-mint.mjs"), "--declare-rules", "stamps-v2", "--meeps", "postmaster", "--date", "2026-06-20", "--key", KEY_FILE, "--repo", dir], { cwd: dir });
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}
const liquidOf = async (dir, handle) => {
  const mint = await import(`${new URL(`file://${join(dir, "tools", "stamp-mint.mjs")}`).href}?t=${Date.now()}`);
  return mint.foldBalances(mint.parseStampLedger(ledgerText(dir))).get(handle) ?? 0;
};
const stakeEnv = (dir) => ({ ...ENV, TOWN_CLONE: dir, STAMP_KEY: KEY_FILE, TOWN_LOCK: join(bottle, `town-${townN}.lock`), TOWN_PUSH: "" });
const keyOf = (handle) => ({ handles: new Set([handle]), household: `${handle}-house` });
const T_POST = Date.now();
const eventArgs = (title) => ({ class: "event", title, body: "sorbet on the counter", place: { at: { x: 10, y: 20 } },
  starts: new Date(T_POST + 3_600_000).toISOString(), ends: new Date(T_POST + 7_200_000).toISOString() });
const postRow = async (id) => (await owner.query("SELECT state, fields FROM posts WHERE id = $1", [id])).rows[0] ?? null;

test("an insufficient balance writes NOTHING: no row, no ledger line, no commit — and the refusal says why in plain words", async () => {
  const dir = townInABottle();
  const head = git(dir, "rev-parse", "HEAD").trim();
  const before = ledgerText(dir);
  await assert.rejects(postAtTown(eventArgs("Ada's tea"), keyOf("ada"), { env: stakeEnv(dir) }),
    (e) => e.code === 422 && /hosting an event stakes 20 of your own stamps, and ada holds 10/.test(e.defect) && /no housemate's/.test(e.hint));
  assert.equal(ledgerText(dir), before);
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), head);
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM posts WHERE author = 'ada'")).rows[0].n, 0);
});

test("posting stakes the host's own 20 in the post's own act; cancelling brings all 20 home in the cancellation's act — once", async () => {
  const dir = townInABottle();
  assert.equal(await liquidOf(dir, "wright"), 25);
  const posted = await postAtTown(eventArgs("Sorbet night"), keyOf("wright"), { env: stakeEnv(dir) });
  const id = posted.post.id;
  assert.deepEqual(posted.stake && [posted.stake.n, posted.stake.by], [20, "wright"]);
  assert.deepEqual((await postRow(id)).fields.stake, { n: 20, by: "wright" }, "the row carries the stake, through the fold");
  assert.match(ledgerText(dir), new RegExp(`· wright → stake:post/${id} · 20 · side: for · via: api`));
  assert.equal(await liquidOf(dir, "wright"), 5, "the 20 left the host's liquid stamps");
  assert.equal(verifies(dir).status, 0, `the town's own verifier passes: ${verifies(dir).stdout}${verifies(dir).stderr}`);

  const cancelled = await closeAtTown({ post: id }, keyOf("wright"), { env: stakeEnv(dir) });
  assert.equal(cancelled.state, "cancelled");
  assert.deepEqual([cancelled.stake.returned, cancelled.stake.to], [20, "wright"]);
  assert.match(cancelled.stake.note, /no spark is made/);
  const row = await postRow(id);
  assert.equal(row.state, "cancelled");
  assert.equal(row.fields.stake.returned.n, 20);
  assert.match(ledgerText(dir), new RegExp(`· stake:post/${id} → wright · 20 · for: post-return`));
  assert.equal(await liquidOf(dir, "wright"), 25, "all 20 came home");
  assert.equal(verifies(dir).status, 0);

  // never twice: the door refuses, and the executor asked directly refuses too, before any line is signed
  const lines = ledgerText(dir);
  await assert.rejects(closeAtTown({ post: id }, keyOf("wright"), { env: stakeEnv(dir) }), /already cancelled/);
  const { stakedCancel } = await import("../src/event-sparks.mjs");
  const again = await stakedCancel({ handle: "wright", id, door: "town", date: "2026-11-14" }, { clone: dir, keyPem: readFileSync(KEY_FILE, "utf8"), env: stakeEnv(dir) });
  assert.match(again.error.defect, /already come home/);
  assert.equal(ledgerText(dir), lines, "no second return line");
});

test("an interrupted staked post rolls back its coupled changes: the line it signed is put back, nothing committed, no row", async () => {
  const dir = townInABottle();
  const head = git(dir, "rev-parse", "HEAD").trim();
  const before = ledgerText(dir);
  // a place mark that does not stand passes the door's cheap shape check and is refused INSIDE the post's transaction, after the
  // executor has signed the stake line — the interruption the coupling must survive
  await assert.rejects(postAtTown({ ...eventArgs("Nowhere night"), place: { mark: "nobody/no-such-mark" } }, keyOf("wright"), { env: stakeEnv(dir) }));
  assert.equal(ledgerText(dir), before, "the signed line was put back");
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), head, "nothing was committed");
  assert.equal(git(dir, "status", "--porcelain").trim(), "", "the clone is clean");
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM posts WHERE title = 'Nowhere night'")).rows[0].n, 0);
  assert.equal(await liquidOf(dir, "wright"), 25);
});

test("a staked event's words are checked BEFORE money moves (Rivet 18:39Z): an invitation or title its spark's record could not carry is refused, plainly, and nothing is written", async () => {
  const dir = townInABottle();
  const before = ledgerText(dir);
  await assert.rejects(postAtTown({ ...eventArgs("Sorbet #2"), body: "on the counter" }, keyOf("wright"), { env: stakeEnv(dir) }),
    (e) => e.code === 422 && /title would not survive as its spark's record: a # is read/.test(e.defect));
  await assert.rejects(postAtTown({ ...eventArgs("Sorbet night"), body: "line one\nline two" }, keyOf("wright"), { env: stakeEnv(dir) }),
    (e) => e.code === 422 && /invitation would not survive/.test(e.defect));
  assert.equal(ledgerText(dir), before, "no stamp moved");
  const posted = await postAtTown(eventArgs("Sorbet evening"), keyOf("wright"), { env: stakeEnv(dir) });
  const { amendAtTown } = await import("../src/events-store.mjs");
  await assert.rejects(amendAtTown({ post: posted.post.id, title: "Sorbet #3" }, keyOf("wright"), { env: stakeEnv(dir) }),
    (e) => e.code === 422 && /title would not survive/.test(e.defect), "an amendment is held to the same line");
});

test("legacy: an event scheduled before this shipped (stored with no stake) stays free — it cancels with no stamp moving, and nothing is charged retroactively", async () => {
  const dir = townInABottle();
  const before = ledgerText(dir);
  // a row as the store already holds it: no stake
  await owner.query(`INSERT INTO posts (id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act)
    VALUES ('wright/old-free-tea', 'event', 'Old free tea', '', 'wright', 'wright-house', NULL, 10, 20, $1, $2, 'announced', $3, 0, 1, 1)`,
    [new Date(Date.now() + 3_600_000), new Date(Date.now() + 7_200_000), JSON.stringify({ doors_open: new Date(Date.now() + 3_600_000).toISOString() })]);
  const closed = await closeAtTown({ post: "wright/old-free-tea" }, keyOf("wright"), { env: stakeEnv(dir) });
  assert.equal(closed.state, "cancelled");
  assert.equal("stake" in closed, false);
  assert.equal(ledgerText(dir), before, "no line: it never staked, and is not charged now");
});

// ── THE COMPLETION, on the same fixtures: one spark, 19 home and 1 backing, in one batch and one transaction — or nothing ──
//
// The mark road's planner is handed in (completeEvent's `planLeave`): the World pin CI reads does not know the spark class until
// World #391 is blessed, and the planner's own guards are World's to prove. Everything after it is the office's real road — the
// spark's act and claim on the candle, its mark lock, the event's receipt FOR UPDATE, and the ledger's landing in the bottle.

const { completeEvent, landedCompletionOf } = await import("../src/event-sparks.mjs");
const { eventRowAtOffice } = await import("../src/events-store.mjs");
const { penTransaction } = await import("../src/write.mjs");
const { townDay } = await import("../src/votes.mjs");
const { verifyStampLinesVia } = await import("../src/stamp-lines.mjs");

const plannerCalls = [];
const planLeave = async ({ by, household, slug, body, at, extent, properties, stamps }) => {
  plannerCalls.push({ by, slug, body, at, extent, properties, stamps });
  const id = `${by}/${slug}`;
  return { planned: true, id, put_forward: true, ground_min: 0, entry: {
    actor: by, household, action: "leave-mark", object: id, cls: "mark",
    payload: { slug, kind: "spark", by, household, body, at, extent, ...properties, stamps, put_forward: true } } };
};
let candleLit = false;
async function lightTheCandle() {
  if (candleLit) return;
  // the claim pen reads the process's own switches (world2-claims § candleEnabled), as the office's does
  Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), WORLD2_CANDLE: "1" });
  await owner.query("INSERT INTO windows (id, opens_at, closes_at, status) VALUES (1035, now() - interval '1 day', now() + interval '1 day', 'open')");
  candleLit = true;
}
const keyPem = () => readFileSync(KEY_FILE, "utf8");
const completionEnv = (dir) => ({ ...stakeEnv(dir), WORLD2_CANDLE: "1", STAMP_LINES: "store" });
/** A staked event posted in the bottle, read back as the store holds it, and the instant after it ended. */
async function endedEvent(dir, title, { at = null } = {}) {
  await lightTheCandle();
  // each bottle is its own town with its own ledger: the store's copy of the lines starts empty for it, as at a town's genesis
  await owner.query("TRUNCATE stamp_lines");
  const posted = await postAtTown({ ...eventArgs(title), ...(at ? { place: { at } } : {}) }, keyOf("wright"), { env: completionEnv(dir) });
  const row = await eventRowAtOffice(posted.post.id, { env: ENV });
  return { row, after: Date.parse(row.ends) + 60_000 };
}
const complete = (dir, row, now, opts = {}) => penTransaction(dir, () =>
  completeEvent(row, { clone: dir, keyPem: keyPem(), env: completionEnv(dir), now, date: townDay(), planLeave, ...opts }));
const claimOf = async (id) => (await owner.query("SELECT class, status, stake, claimant FROM claims WHERE slug = $1", [id])).rows;
const storeVerifies = async (dir) => verifyStampLinesVia(owner, dir);

test("completion: an ended staked event becomes ONE put-forward spark — all 20 come home and the spark's own 1 backs it (19 home), the town's verifier green", async () => {
  const dir = townInABottle();
  const { row, after: now } = await endedEvent(dir, "Sorbet finale");
  assert.equal(await liquidOf(dir, "wright"), 5);
  const head = git(dir, "rev-parse", "HEAD").trim();
  const out = await complete(dir, row, now);
  const slug = row.id.split("/").slice(1).join("/");
  assert.equal(out.completed, true, JSON.stringify(out));
  assert.equal(out.spark, `wright/${slug}`, "identity: <host>/<event-slug>");
  assert.deepEqual(out.stake, { returned: 20, to: "wright", backing: 1, home: 19 });
  const call = plannerCalls.at(-1);
  assert.equal(call.body, "Sorbet finale", "the headline is the title");
  assert.equal(call.stamps, 1);
  assert.deepEqual(call.extent, { w: 120, h: 120 }, "no conversation at the place: the 60 m radius frame");
  assert.equal(call.properties.event, row.id);

  const text = ledgerText(dir);
  assert.match(text, new RegExp(`· stake:post/${row.id} → wright · 20 · for: post-return`));
  assert.match(text, new RegExp(`· wright → stake:world-mark/wright/${slug} · 1 · via: api`));
  assert.ok(landedCompletionOf((await import(`${new URL(`file://${join(dir, "tools", "stamp-mint.mjs")}`).href}?t=${Date.now()}`)).parseStampLedger(text), row.id, "wright", 20),
    "the batch is the pair a retry would recognise");
  assert.equal(await liquidOf(dir, "wright"), 24, "5 left after the stake, 19 home");
  assert.notEqual(git(dir, "rev-parse", "HEAD").trim(), head, "the batch was committed");
  assert.equal(git(dir, "status", "--porcelain").trim(), "");
  const v = verifies(dir);
  assert.equal(v.status, 0, `the town's own verifier passes: ${v.stdout}${v.stderr}`);
  assert.deepEqual((await storeVerifies(dir)).problems, [], "the store's copy of the lines matches the ledger");

  const stored = await postRow(row.id);
  assert.equal(stored.fields.completed.spark, `wright/${slug}`);
  assert.deepEqual(stored.fields.stake.returned, { act: stored.fields.completed.act, n: 20, to: "wright" });
  assert.deepEqual(stored.fields.stake.backing, { spark: `wright/${slug}`, n: 1 });
  const claims = await claimOf(`wright/${slug}`);
  assert.equal(claims.length, 1, "exactly one spark claim");
  assert.equal(claims[0].class, "spark");
  assert.notEqual(claims[0].status, "draft", "put forward, never a draft");
});

test("completion: a second tick does nothing — no second spark, no second return — and the pass no longer finds it due", async () => {
  const dir = townInABottle();
  const { row, after: now } = await endedEvent(dir, "Sorbet twice");
  assert.equal((await complete(dir, row, now)).completed, true);
  const lines = ledgerText(dir), head = git(dir, "rev-parse", "HEAD").trim();
  const slug = row.id.split("/").slice(1).join("/");

  const again = await complete(dir, await eventRowAtOffice(row.id, { env: ENV }), now + 60_000);
  assert.match(again.held, /not a staked, open event/, "the row it reads is complete");
  const stale = await complete(dir, row, now + 60_000); // the row as the first tick read it: the ledger and the receipt refuse
  assert.ok(stale.error || stale.held, JSON.stringify(stale));
  assert.equal(ledgerText(dir), lines, "no line signed");
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), head, "no commit");
  assert.equal((await claimOf(`wright/${slug}`)).length, 1);
  assert.equal((await claimOf(`wright/${slug}-2`)).length, 0, "no second spark under a suffix");
  const { DUE_EVENTS_SQL } = await import("../deploy/event-sparks-pass.mjs");
  const due = (await owner.query(DUE_EVENTS_SQL, [new Date(now + 60_000).toISOString()])).rows.map((r) => r.id);
  assert.ok(!due.includes(row.id));
});

test("completion is HELD, nothing moved: before its end, when its rooms cannot be told or the World will not place them, or when its spark would not go forward — and several rooms complete as one spark", async () => {
  const dir = townInABottle();
  // its own place: the record is append-only, and the talk this test adds must not be any other event's
  const { row, after: now } = await endedEvent(dir, "Sorbet held", { at: { x: 900, y: 900 } });
  const lines = ledgerText(dir);
  assert.match((await complete(dir, row, Date.parse(row.ends) - 60_000)).held, /not ended/);
  // a settlement the office knows that is newer than the window's start: the room cannot be told — never "no conversation"
  assert.match((await complete(dir, row, now, { edges: [Date.parse(row.ends)] })).held, /room cannot be told/);
  // two groups talking apart at the place, split by a settlement inside the window: both rooms are the event's (all of them,
  // combined), placed together by the World's roomsPlace — its null for real rooms, or an engine without it, is HELD, never the
  // locked circle
  const doors = Date.parse(row.fields.doors_open ?? row.starts);
  const say = async (who, at, x) => owner.query(`INSERT INTO acts (at, crossing, actor, action, class, payload, at_anchor, at_dx, at_dy, household)
    VALUES ($1, 0, $2, 'say', 'voice', $3, 'world', $4, 900, $5)`, [new Date(at), who, JSON.stringify({ text: `${who} here`, place: "the counter" }), x, `${who}-house`]);
  await say("held-a", doors + 60_000, 900);
  await say("held-b", doors + 30 * 60_000, 920);
  const split = { edges: [doors - 3_600_000, doors + 10 * 60_000] };
  const nulled = await complete(dir, row, now, { ...split, roomsPlace: () => null });
  assert.match(nulled.held, /placed none of its 2 room\(s\)' bounds — a null is not "no room"/);
  assert.equal(nulled.rooms.length, 2);
  assert.match((await complete(dir, row, now, { ...split, roomsPlace: null })).held, /has no roomsPlace/);
  const asked = [];
  const worldPlace = (bounds) => { asked.push(bounds); return { at: { x: 910, y: 900 }, extent: { w: 20, h: 0 } }; }; // the World's answer, as given
  // the mark road keeps it a draft, or refuses it: held, and says why
  assert.match((await complete(dir, row, now, { ...split, roomsPlace: worldPlace, planLeave: async () => ({ refused: { defect: "outside the world", hint: "World's guard" } }) })).held,
    /would not go forward: outside the world/);
  assert.match((await complete(dir, row, now, { ...split, roomsPlace: worldPlace, planLeave: async (a) => ({ ...(await planLeave(a)), put_forward: false }) })).held, /kept it a draft/);
  assert.equal(ledgerText(dir), lines, "no line signed by any held completion");
  assert.equal((await postRow(row.id)).fields.completed, undefined);

  // and with the World's place, the two rooms complete as ONE spark that names both, placed where the World put them
  const done = await complete(dir, row, now, { ...split, roomsPlace: worldPlace });
  assert.equal(done.completed, true, JSON.stringify(done));
  assert.equal(done.rooms.length, 2);
  assert.deepEqual(asked.at(-1), [{ x0: 900, y0: 900, x1: 900, y1: 900 }, { x0: 920, y0: 900, x1: 920, y1: 900 }], "each room's absolute bounds, in start order");
  const call = plannerCalls.at(-1);
  assert.deepEqual(call.properties.rooms, done.rooms, "the record's rooms: every room id");
  assert.equal("room" in call.properties, false);
  assert.deepEqual([call.at, call.extent], [{ x: 910, y: 900 }, { w: 20, h: 0 }], "the World's place, its zero side kept");
});

test("completion interrupted after its lines landed and before the store committed: the retry finishes it from the ledger's own batch — no new line, no re-sign", async () => {
  const dir = townInABottle();
  const { row, after: now } = await endedEvent(dir, "Sorbet interrupted");
  const slug = row.id.split("/").slice(1).join("/");
  // the state such an interruption leaves: the batch signed and committed in the town, nothing in the store
  const mint = await import(`${new URL(`file://${join(dir, "tools", "stamp-mint.mjs")}`).href}?t=${Date.now()}`);
  const ws = await import(`${new URL(`file://${join(dir, "tools", "world-stake.mjs")}`).href}?t=${Date.now()}`);
  mint.appendSigned(dir, [mint.postReturnLine({ date: townDay(), post: row.id, handle: "wright", n: 20 })], keyPem());
  assert.equal(ws.worldStakeApply(dir, { handle: "wright", mark: `wright/${slug}`, n: 1, via: "api", date: townDay() }, keyPem()).applied, 1);
  git(dir, "add", "WHITE_PAGES/stamp-ledger.md");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "landed batch, store rolled back");
  const lines = ledgerText(dir), head = git(dir, "rev-parse", "HEAD").trim();
  assert.equal(await liquidOf(dir, "wright"), 24);

  const out = await complete(dir, row, now);
  assert.equal(out.completed, true, JSON.stringify(out));
  assert.equal(out.spark, `wright/${slug}`, "the ledger's spark, followed");
  assert.match(out.recovered, /already in the ledger/);
  assert.equal(ledgerText(dir), lines, "not re-signed: the ledger is byte for byte the same");
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), head, "no new commit");
  assert.equal(await liquidOf(dir, "wright"), 24, "19 home once, 1 backing once");
  assert.deepEqual((await storeVerifies(dir)).problems, [], "the store now holds the lines the town already had");
  assert.equal((await claimOf(`wright/${slug}`)).length, 1);
  assert.equal((await postRow(row.id)).fields.completed.spark, `wright/${slug}`);
});

test("completion never signs onto a RED ledger: the mint's own arrival predicate, at the completion's own boundary, refuses before the first signature — no line, no commit, no claim, no receipt", async () => {
  const dir = townInABottle();
  const { row, after: now } = await endedEvent(dir, "Sorbet on red");
  appendFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), "- 2026-11-14 · a line no key signed · wright → ada · 3\n");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qam", "a red line, committed");
  assert.notEqual(verifies(dir).status, 0, "red to the town's own verifier");
  assert.equal(S.ledgerArrivalRed(dir), true, "and to the mint's arrival predicate");
  const lines = ledgerText(dir), head = git(dir, "rev-parse", "HEAD").trim();
  const calls = plannerCalls.length;
  const out = await complete(dir, row, now); // a direct call: no pass in front of it
  assert.equal(out.error?.reason, "ledger-red", JSON.stringify(out));
  assert.match(out.error.defect, /the stamp ledger is red .* no completion signs onto it/);
  assert.equal(ledgerText(dir), lines, "no line signed");
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), head, "nothing committed");
  assert.equal(plannerCalls.length, calls, "not even planned");
  assert.equal((await claimOf(`wright/${row.id.split("/").slice(1).join("/")}`)).length, 0, "no spark claim");
  assert.equal((await postRow(row.id)).fields.completed, undefined, "no receipt");
  assert.equal(S.ledgerArrivalRed(townInABottle()), false, "a green ledger passes the same predicate");
});

test("completion never adopts or guesses: a return that is not its batch is refused, a ledger's spark id already held is refused, and a fresh id taken is suffixed", async () => {
  // a foreign return: the stake came home without its backing — not this completion's batch
  const dir = townInABottle();
  const { row, after: now } = await endedEvent(dir, "Sorbet foreign");
  const mint = await import(`${new URL(`file://${join(dir, "tools", "stamp-mint.mjs")}`).href}?t=${Date.now()}`);
  mint.appendSigned(dir, [mint.postReturnLine({ date: townDay(), post: row.id, handle: "wright", n: 20 })], keyPem());
  git(dir, "add", "WHITE_PAGES/stamp-ledger.md");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "a return alone");
  let lines = ledgerText(dir);
  const foreign = await complete(dir, row, now);
  assert.equal(foreign.error?.code, 503, JSON.stringify(foreign));
  assert.match(foreign.error.defect, /not as this completion's batch/);
  assert.equal(ledgerText(dir), lines);
  assert.equal((await postRow(row.id)).fields.completed, undefined);

  // the ledger's batch names a spark id this office already holds as another claim: refused, never adopted
  const dir2 = townInABottle();
  const two = await endedEvent(dir2, "Sorbet taken");
  const slug2 = two.row.id.split("/").slice(1).join("/");
  const ws = await import(`${new URL(`file://${join(dir2, "tools", "world-stake.mjs")}`).href}?t=${Date.now()}`);
  const mint2 = await import(`${new URL(`file://${join(dir2, "tools", "stamp-mint.mjs")}`).href}?t=${Date.now()}`);
  mint2.appendSigned(dir2, [mint2.postReturnLine({ date: townDay(), post: two.row.id, handle: "wright", n: 20 })], keyPem());
  ws.worldStakeApply(dir2, { handle: "wright", mark: `wright/${slug2}`, n: 1, via: "api", date: townDay() }, keyPem());
  git(dir2, "add", "WHITE_PAGES/stamp-ledger.md");
  git(dir2, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "landed batch");
  await owner.query(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, slug)
    VALUES (1035, 'sited', 'wright', 'solo:wright', 'pending', 'A bench.', '{}', box(point(1,1), point(2,2)), 0, $1)`, [`wright/${slug2}`]);
  lines = ledgerText(dir2);
  const taken = await complete(dir2, two.row, two.after);
  assert.equal(taken.error?.code, 503, JSON.stringify(taken));
  assert.match(taken.error.defect, /already holds as another mark or claim/);
  assert.equal(ledgerText(dir2), lines);
  assert.equal((await claimOf(`wright/${slug2}`)).length, 1, "the other claim is untouched and no spark joined it");

  // a fresh completion whose id is already someone's claim takes the first unused suffix
  const dir3 = townInABottle();
  const three = await endedEvent(dir3, "Sorbet suffix");
  const slug3 = three.row.id.split("/").slice(1).join("/");
  await owner.query(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, slug)
    VALUES (1035, 'sited', 'wright', 'solo:wright', 'pending', 'A lamp.', '{}', box(point(1,1), point(2,2)), 0, $1)`, [`wright/${slug3}`]);
  const suffixed = await complete(dir3, three.row, three.after);
  assert.equal(suffixed.spark, `wright/${slug3}-2`, JSON.stringify(suffixed));
  assert.equal((await claimOf(`wright/${slug3}-2`))[0]?.class, "spark");
});

test("the pass: a stamp ledger with lines nobody committed is not touched (exit 3); no arguments is usage (exit 2)", async () => {
  const { main } = await import("../deploy/event-sparks-pass.mjs");
  const dir = townInABottle();
  writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), `${ledgerText(dir)}- uncommitted\n`);
  const quiet = console.error; console.error = () => {};
  try {
    assert.equal(await main(["--town", dir, "--key", KEY_FILE], ENV), 3);
    assert.equal(await main([], ENV), 2);
  } finally { console.error = quiet; }
});

test("the pass never signs onto a RED ledger: an event due meets its completion's own arrival check and the pass stops (exit 4); a quiet tick runs no verify", async () => {
  const { main } = await import("../deploy/event-sparks-pass.mjs");
  const dir = townInABottle();
  appendFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), "- 2026-11-14 · a line no key signed · wright → ada · 3\n");
  git(dir, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qam", "a red line, committed");
  assert.notEqual(verifies(dir).status, 0, "the fixture ledger is red to the town's own verifier");
  const lines = ledgerText(dir), head = git(dir, "rev-parse", "HEAD").trim();
  const quiet = [console.error, process.stderr.write]; console.error = () => {}; process.stderr.write = () => true;
  try {
    assert.equal(await main(["--town", dir, "--key", KEY_FILE], ENV), 0, "nothing due: the ledger is not judged at all");
    await owner.query(`INSERT INTO posts (id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act)
      VALUES ('wright/red-ledger-night', 'event', 'Red ledger night', '', 'wright', 'wright-house', NULL, 10, 20, $1, $2, 'announced', $3, 0, 1, 1)`,
      [new Date(Date.now() - 7_200_000), new Date(Date.now() - 3_600_000), JSON.stringify({ doors_open: new Date(Date.now() - 7_200_000).toISOString(), stake: { n: 20, by: "wright" } })]);
    assert.equal(await main(["--town", dir, "--key", KEY_FILE], ENV), 4, "an event due on a red ledger: refused");
  } finally { [console.error, process.stderr.write] = quiet; }
  assert.equal(ledgerText(dir), lines, "nothing signed");
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), head, "nothing committed");
  assert.equal((await postRow("wright/red-ledger-night")).fields.completed, undefined, "the event waits for a green ledger");
});
