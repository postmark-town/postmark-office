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
  assert.equal(r.room.id, `t${min(1)}-pica`);
  assert.equal(r.room.voice_count, 3, "the window scopes it: the early and late voices are not this event's talk");
  assert.deepEqual(r.room.participants, ["pica", "seth", "liv"]);
  assert.equal("voices" in r.room, false, "the room's header; its lines are the circle reads' to serve");
  assert.deepEqual(S.roomFrame(r.room), { room: r.room.id, at: { x: 125, y: 202.5 }, extent: { w: 50, h: 5 } });
});

test("no talk at the place is no room (the radius frame applies); talk the office cannot place in a settlement is UNAVAILABLE, never 'no conversation'", () => {
  const none = S.eventRoomFrom([voice("far", 1, 900, 900)], { window: { from: min(0), to: min(60) }, place: PLACE, edges: [min(-600)] });
  assert.deepEqual([none.room, none.history], [null, "complete"]);
  const old = S.eventRoomFrom([voice("pica", 1, 100, 200)], { window: { from: min(0), to: min(60) }, place: PLACE, edges: [min(30)] });
  assert.deepEqual([old.room, old.history], [null, "unavailable"]);
  assert.match(old.note, /not evidence that nobody spoke/);
});

test("a settlement inside the window splits the talk (until CORE-97 carries it): every candidate room is listed, and NONE is chosen — no ranking is ruled", () => {
  const voices = [voice("a", 1, 100, 200), voice("b", 2, 100, 201), voice("c", 40, 100, 200), voice("d", 41, 101, 200), voice("e", 42, 100, 199)];
  const r = S.eventRoomFrom(voices, { window: { from: min(0), to: min(60) }, place: PLACE, edges: [min(-600), min(30)] });
  assert.equal(r.room, null, "two candidates: the binding is unresolved, not guessed by size");
  assert.equal(r.binding, "unresolved");
  assert.deepEqual(r.candidates.map((c) => [c.id, c.voice_count]), [[`t${min(1)}-a`, 2], [`t${min(40)}-c`, 3]], "in the order they started");
  assert.match(r.note, /2 conversations formed at the place.*none is chosen/);
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

test("one event's evidence: its window, the room its talk formed at its place (with the frozen frame), and the households with a public act there", async () => {
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
  assert.equal(ev.room.voice_count, 2);
  assert.deepEqual(ev.room.frame, { room: ev.room.id, at: { x: 115.5, y: 200 }, extent: { w: 31, h: 0 } }, "exact midpoint, a half and a zero kept");
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
const { mkdirSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
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
const stakeEnv = (dir, on = true) => ({ ...ENV, ...(on ? { EVENT_STAKE: "on" } : {}), TOWN_CLONE: dir, STAMP_KEY: KEY_FILE, TOWN_LOCK: join(bottle, `town-${townN}.lock`), TOWN_PUSH: "" });
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

test("legacy: with the switch off an event posts free and cancels free — no stake, no line (events scheduled before this ships stay free)", async () => {
  const dir = townInABottle();
  const before = ledgerText(dir);
  const posted = await postAtTown(eventArgs("Free tea"), keyOf("wright"), { env: stakeEnv(dir, false) });
  assert.equal("stake" in posted, false);
  assert.equal((await postRow(posted.post.id)).fields.stake, undefined);
  const closed = await closeAtTown({ post: posted.post.id }, keyOf("wright"), { env: stakeEnv(dir, true) });
  assert.equal(closed.state, "cancelled", "a free event's cancellation is free even with the switch on");
  assert.equal("stake" in closed, false);
  assert.equal(ledgerText(dir), before);
});
