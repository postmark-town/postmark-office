// spark-post.test.mjs — POS-780 step 1: a resident marks a moment, world { do: "spark" }.
//
//   node --test test/spark-post.test.mjs
//
// LAW (Wright's content packet, POS-780, AUTHORITY 2026-11-05T03:51Z, § 3 step 1): "A resident marks a moment:
// `world { do: "spark", args: { from, to, title, note? } }`. It's a public post of class `spark` (the post machinery
// the quests use), holding a time window, the place where the resident stood, and who sparked it. It can point back
// at most 3 days." LAW (Wright, AUTHORITY 2026-11-05T07:19:33Z): "where the sparker stood when the moment ended, read
// from the record. Not the call-time standpoint, and never a place the caller supplies"; "step 1 keeps post, amend and
// withdraw only, and the unasked five-cap, later lifecycle and export-state gate come out"; "any class grant goes
// through a frontier build, not around the permission spine." LAW (Darko, POS-780/a, 2026-10-24 13:44): "no hard cap,
// more of a 'one arc we can tell'. could even happen over the course of a full settlement or multiple."
//
// Everything is driven through the real doors: the world apex (grant, envelope, dispatch), the flat world_spark name,
// the town door's post, amend, close and advance, and the posts read. Positions come from INVENTED walk acts in a
// real Postgres, read back by the office's own departure record and the world's own whereIs and positionAt (the
// engine tools are the pinned clone's, copied into an invented world). The law is an invented class layer in which
// the resident class grants spark, or does not.
//
// Everything is invented: sbx-lio and sbx-ren, their walks, and the moments they mark.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { markRecord } from "../src/mark-record.mjs";

const WORLD = worldClone();
const store = await startStore({ db: "spark_post" });
const skip = store.skip ?? ((!WORLD && NO_WORLD) || false);
const repo = mkdtempSync(join(tmpdir(), "pos780-"));
const NO_TOWN = mkdtempSync(join(tmpdir(), "pos780-no-town-"));
const put = (p, content) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content); };
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "WORLD_CLONE", "WORLD_MOVEMENT_V2", "WORLD_POSITIONS", "POSITIONS_SNAPSHOT", "TOWN_CLONE", "WORLD_APEX",
  "WORLD_SINGLE_LOG", "WORLD_POOL", "W2_PEN", "W2_GUARDS"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
let pool;

const FRAME = "the-town/let-there-be-light";
const LIO = { household: "sbx-lio", handles: new Set(["sbx-lio"]) };
const REN = { household: "sbx-ren", handles: new Set(["sbx-ren"]) };
const HOUR = 3_600_000, DAY = 24 * HOUR;
const O = { x: 0, y: 0 }, B = { x: 300, y: 40 }, A = { x: -200, y: -90 };
const MO = { household: "sbx-mo", handles: new Set(["sbx-mo"]) }, MO_HOME = "sbx-mo/home", HOME_AT = { x: 700, y: 700 };
const UNA = { household: "sbx-una", handles: new Set(["sbx-una"]) }, KAI = { household: "sbx-kai", handles: new Set(["sbx-kai"]) };
const BOAT = "sbx-wharf/the-boat", W = { x: 900, y: -900 }, LANDED = { x: -450, y: 320 };
/** The stride the walk door stamps on every departure (world-classes.mjs § departurePace; decision 008b). */
const PACE = 60;

let worldApex, callWorldTool, townPostEvent, callTownPostTool, postAtTown, advanceAtTown, postsAtOffice, residentStandpoint, walkMod, walkEntry, normalizeRow;
let landEntry, enterViaOffice, crossingDeps, postSpark;
let STATE0 = null;   // the published world-state this file starts from (a test that changes today's world restores it)
if (!skip) {
  mkdirSync(join(repo, "tools"), { recursive: true });
  for (const f of readdirSync(join(WORLD, "tools")).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")))
    copyFileSync(join(WORLD, "tools", f), join(repo, "tools", f));
  const root = { id: FRAME, by: "the-town", slug: "let-there-be-light", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 100000, h: 100000 } };
  put("WORLD/marks/let-there-be-light/mark.md", markRecord(root, "Synthetic world frame."));
  // mo's home parcel stands in TODAY's world (the trap: a current home is no record of where mo stood then), and a
  // boat (class vehicle) is berthed at W, where lio walks before boarding her
  const home = { id: MO_HOME, by: "sbx-mo", household: "sbx-mo", slug: "home", kind: "parcel", at: HOME_AT, extent: { w: 25, h: 25 } };
  const boat = { id: BOAT, by: "sbx-wharf", slug: "the-boat", kind: "sited", class: "vehicle", at: W, extent: { w: 20, h: 10 } };
  put(`WORLD/marks/${MO_HOME}/mark.md`, markRecord(home, "mo's home ground."));
  put(`WORLD/marks/${BOAT}/mark.md`, markRecord(boat, "A little boat at the wharf."));
  STATE0 = { tick: 0, dials: {}, households: { "sbx-mo": "sbx-mo" },
    parcels: [{ id: MO_HOME, household: "sbx-mo", at: HOME_AT, extent: { w: 25, h: 25 } }],
    marks: [{ ...root, body: "Synthetic world frame." }, { ...home, body: "mo's home ground." }, { ...boat, body: "A little boat at the wharf." }] };
  put("WORLD/world-state.json", JSON.stringify(STATE0));
  put("WORLD/walk-ledger.md", "# Walk ledger\n");
  copyFileSync(join(WORLD, "WORLD", "skeleton.json"), join(repo, "WORLD", "skeleton.json"));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "add", "-A", "WORLD", "tools"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qm", "synthetic canon"]);
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: store.url("office_api") });
  // prod's lanes for the passages: the single log, and the frame pen flipped, so an enter is an act in `acts`
  Object.assign(process.env, { WORLD_CLONE: repo, WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), WORLD_MOVEMENT_V2: "1", TOWN_CLONE: NO_TOWN,
    WORLD_SINGLE_LOG: "1", WORLD_POOL: "0", W2_PEN: "hold,frame", W2_GUARDS: "1" });
  delete process.env.WORLD_POSITIONS; delete process.env.POSITIONS_SNAPSHOT;
  (await import("../src/world2-pen.mjs")).__setPoolForTest(pool);
  ({ worldApex, crossingDeps } = await import("../src/world-apex.mjs"));
  ({ callWorldTool, walkEntry, residentStandpoint, landEntry } = await import("../src/world.mjs"));
  ({ enterViaOffice } = await import("../src/world-crossings.mjs"));
  ({ postSpark } = await import("../src/spark-store.mjs"));
  ({ townPostEvent, callTownPostTool } = await import("../src/town-post.mjs"));
  ({ postAtTown, advanceAtTown } = await import("../src/events-store.mjs"));
  ({ postsAtOffice } = await import("../src/town-posts.mjs"));
  ({ normalizeRow } = await import("../src/world-journal.mjs"));
  walkMod = await import(pathToFileURL(join(repo, "tools", "walk.mjs")).href);
}
after(async () => {
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  if (!skip) (await import("../src/world2-pen.mjs")).__setPoolForTest(null);
  if (pool) await pool.end(); await store.stop();
  rmSync(NO_TOWN, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

const owner = async (fn) => { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } };
const iso = (t) => new Date(t).toISOString();

/** A walk act, built the way the walk door builds it (world.mjs § walkEntry), at an invented instant. */
async function walkAt(who, t, from, toward, { pace = PACE } = {}) {
  const row = normalizeRow(walkEntry({ crossing: walkMod.fractionalCrossing(t), who, targetMarkId: null, stampAt: null, witnesses: null,
    from, toward, pace, targetExtent: null, household: null, writtenAt: iso(t), declaredBy: who }));
  await owner((c) => c.query("INSERT INTO acts (at, crossing, actor, action, class, payload) VALUES ($1,$2,$3,$4,$5,$6)",
    [row.written_at, String(row.crossing), row.actor, row.action, row.class, row.payload]));
}

/** A fresh record: lio walked O → B two hours ago, then B → A half an hour ago; ren walked once, to B. */
async function seed(now) {
  await owner(async (c) => {
    await c.query("TRUNCATE acts, posts, responses, claims, marks, windows, households CASCADE");
    await c.query("INSERT INTO windows (id,opens_at,closes_at,status) VALUES (300,now()-interval '1 day',now()+interval '1 day','open')");
  });
  await walkAt("sbx-lio", now - 2 * HOUR, O, B);
  await walkAt("sbx-lio", now - 30 * 60_000, B, A);
  await walkAt("sbx-ren", now - 3 * HOUR, O, B);
}

// THE CLASS LAYER the apex gathers from: the resident class's ambient verbs, with spark granted (residue the-town/post,
// the post class's own mark) or not. Nothing else in this world grants anything.
async function withLaw({ spark }, fn) {
  const { publishWorldGraphForTest, resetWorldGraph } = await import("../src/world-graph-snapshot.mjs");
  const n = (id, props) => ({ id, kind: "mark", subkind: "sited", tier: "constitution", by: id.split("/")[0],
    at_x: null, at_y: null, extent_w: null, extent_h: null, props: JSON.stringify(props) });
  const actions = [{ action: "say", residue: "the-town/say" }, ...(spark ? [{ action: "spark", residue: "the-town/post" }] : [])];
  publishWorldGraphForTest({ meta: [{ key: "hydration_status", value: "OK" }, { key: "as_of_world", value: "pos780fixture" }],
    nodes: [
      { ...n(FRAME, { slug: "let-there-be-light", body: "Let there be light.", path: "WORLD/marks/let-there-be-light/mark.md" }), at_x: 0, at_y: 0, extent_w: 100000, extent_h: 100000 },
      n("the-town/resident", { slug: "resident", class: "resident", class_version: 11, ambient: true, actions, body: "A household's living voice.",
        path: "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/entity/resident/mark.md" }),
      n("the-town/post", { slug: "post", class: "post", class_version: 1, body: "A post is an ask the town reads, not a claim on the world.",
        path: "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-node/post/mark.md" }),
    ],
    edges: [], events: [], geometryVersions: [], lintFindings: [] }, { label: "pos780-law" });
  process.env.WORLD_APEX = "1";
  try { return await fn(); } finally { delete process.env.WORLD_APEX; resetWorldGraph?.(); }
}

const sparkRows = async () => owner(async (c) => (await c.query("SELECT id, author, state, title, body, place_x, place_y, starts, ends FROM posts WHERE class = 'spark' ORDER BY id")).rows);
const sparkActs = async () => owner(async (c) => (await c.query("SELECT actor, action, object, class, payload FROM acts WHERE class = 'spark' ORDER BY id")).rows);
const spark = (key, args, extra = {}) => worldApex({ do: "spark", args, ...extra }, key);

test("THE GRANT IS THE DOOR: with the resident class granting spark, world { do: \"spark\" } and the flat world_spark name both post one, as the key's own resident; without the grant both are refused and nothing is written", { skip }, async () => {
  const now = Date.now();
  await seed(now);
  const args = { from: iso(now - 90 * 60_000), to: iso(now - HOUR), title: "Lio at the corner", note: "a small moment" };

  await withLaw({ spark: false }, async () => {
    const r = await spark(LIO, args);
    assert.equal(r.error, "bounce", JSON.stringify(r).slice(0, 300));
    assert.match(String(r.defect), /"spark" is afforded nowhere|not afforded/, r.defect);
    const flat = await callWorldTool("world_spark", { ...args }, LIO);
    assert.equal(flat.error, "bounce", `the flat name meets the same door: ${JSON.stringify(flat).slice(0, 300)}`);
    assert.match(String(flat.defect), /"spark" is afforded nowhere|not afforded/, flat.defect);
    // the bare read lists no spark where nothing grants it
    const bare = await worldApex({}, LIO);
    assert.ok(!(bare.actions ?? []).some((e) => e.action === "spark"), "no card without the grant");
  });
  assert.deepEqual(await sparkRows(), [], "nothing was written without the grant");

  await withLaw({ spark: true }, async () => {
    const bare = await worldApex({}, LIO);
    const card = (bare.actions ?? []).find((e) => e.action === "spark");
    assert.ok(card, `the bare read lists spark where the resident class grants it: ${(bare.actions ?? []).map((e) => e.action)}`);
    assert.equal(card.dispatches_to, "world_spark");
    assert.deepEqual(Object.keys(card.fields ?? {}).sort(), ["from", "note", "title", "to"], "the card names the act's own fields, and no place");

    const r = await spark(LIO, args);
    assert.ok(!r.error, JSON.stringify(r).slice(0, 400));
    assert.equal(r.did, "spark");
    assert.equal(r.dispatched_to, "world_spark");
    const flat = await callWorldTool("world_spark", { ...args, title: "Lio again, by the flat name" }, LIO);
    assert.ok(!flat.error, JSON.stringify(flat).slice(0, 400));
    assert.equal(flat.did, "spark", "the flat name was answered by the world door's dispatch, not beside it");
  });
  const rows = await sparkRows();
  assert.deepEqual(rows.map((r) => [r.id, r.author, r.state]), [["sbx-lio/lio-again-by-the-flat-name", "sbx-lio", "sparked"], ["sbx-lio/lio-at-the-corner", "sbx-lio", "sparked"]]);
  const acts = await sparkActs();
  assert.deepEqual(acts.map((a) => [a.actor, a.action, a.class]), [["sbx-lio", "post", "spark"], ["sbx-lio", "post", "spark"]], "one public post act each, by the sparker");
});

test("WHO SPARKED IT is the authenticated resident: a handle the key does not hold is refused, and the town's flat post door does not make a spark", { skip }, async () => {
  const now = Date.now();
  await seed(now);
  const args = { from: iso(now - 90 * 60_000), to: iso(now - HOUR), title: "Not mine to mark" };
  await withLaw({ spark: true }, async () => {
    const r = await spark(LIO, args, { handle: "sbx-ren" });
    assert.ok(r.error, `lio's key cannot spark as ren: ${JSON.stringify(r).slice(0, 300)}`);
  });
  const flatTown = await townPostEvent({ class: "spark", title: "From the town door", starts: args.from, ends: args.to }, LIO);
  // null would hand the call on to the flat door's other lane: an answer is owed here, and it is a refusal
  assert.ok(flatTown != null, "the town's post door answers class spark itself, and never hands it on");
  assert.equal(flatTown.error, "bounce");
  assert.equal(flatTown.code, 422);
  assert.equal(flatTown.field, "class");
  assert.match(flatTown.defect, /made at the world door/);
  await assert.rejects(() => postAtTown({ class: "spark", title: "From the post machine", from: args.from, to: args.to }, LIO),
    (e) => e.code === 422 && /made at the world door/.test(e.defect), "the post machine's own post refuses class spark too");
  assert.deepEqual(await sparkRows(), [], "no spark by either road");
});

test("THE PLACE IS THE RECORD'S: lio stands at A now, stood at B when the moment ended, and the spark records B; a place the caller sends is refused by name", { skip }, async () => {
  const now = Date.now();
  await seed(now);
  const here = await residentStandpoint("sbx-lio");
  assert.deepEqual([here.x, here.y], [A.x, A.y], "the control: where lio stands NOW is A, by the same record");
  // the oracle, independent of the office: the engine's positionAt over lio's walk that governed at `to`
  const to = now - HOUR;
  const expect = walkMod.positionAt({ from: O, toward: B, at: walkMod.fractionalCrossing(now - 2 * HOUR), pace: PACE, targetExtent: null, targetMarkId: null }, walkMod.fractionalCrossing(to));
  assert.deepEqual([expect.x, expect.y], [B.x, B.y], "the oracle: the first walk had arrived at B by `to`");

  await withLaw({ spark: true }, async () => {
    const r = await spark(LIO, { from: iso(now - 100 * 60_000), to: iso(to), title: "At B, an hour ago" });
    assert.ok(!r.error, JSON.stringify(r).slice(0, 400));
    for (const forged of [{ place: { at: { x: A.x, y: A.y } } }, { at: { x: 1, y: 2 } }, { x: 5, y: 5 }]) {
      const f = await spark(LIO, { from: iso(now - 100 * 60_000), to: iso(to), title: "A forged place", ...forged });
      assert.equal(f.error, "bounce", `refused: ${JSON.stringify(forged)} → ${JSON.stringify(f).slice(0, 200)}`);
      assert.match(String(f.defect), new RegExp(`does not take: ${Object.keys(forged)[0]}`), f.defect);
    }
  });
  const [row] = await sparkRows();
  assert.deepEqual([row.id, Number(row.place_x), Number(row.place_y)], ["sbx-lio/at-b-an-hour-ago", B.x, B.y], "B, where lio stood at `to`, and NOT A, where lio stands now");
  const [act] = await sparkActs();
  const p = typeof act.payload === "string" ? JSON.parse(act.payload) : act.payload;
  assert.deepEqual(p.place, { mark: null, x: B.x, y: B.y }, "the post act carries the derived place");
  assert.equal((await sparkRows()).length, 1, "no forged spark was written");
});

test("THE WINDOW: at most three days back, over, and no cap on its length (a window across several settlements stands)", { skip }, async () => {
  const now = Date.now();
  await seed(now);
  await withLaw({ spark: true }, async () => {
    // the world door rebuilds a handler's refusal from its code, defect and hint (fault-words.mjs § BOUNCE_EXTRAS
    // carries no `field`), so each bound is read off its defect and hint
    const old = await spark(LIO, { from: iso(now - 3 * DAY - HOUR), to: iso(now - HOUR), title: "Too far back" });
    assert.equal(old.error, "bounce"); assert.equal(old.code, 422); assert.match(old.defect, /at most 3 days/); assert.match(old.hint, /^from /);
    const ahead = await spark(LIO, { from: iso(now - HOUR), to: iso(now + 10 * 60_000), title: "Not over yet" });
    assert.equal(ahead.error, "bounce"); assert.equal(ahead.code, 422); assert.match(ahead.defect, /has happened/);
    const backwards = await spark(LIO, { from: iso(now - HOUR), to: iso(now - 2 * HOUR), title: "Backwards" });
    assert.equal(backwards.error, "bounce"); assert.match(backwards.defect, /ends after it starts/);
    // 69 hours: from 70 hours back to an hour ago, across five or six twelve-hour settlements
    const arc = await spark(LIO, { from: iso(now - 70 * HOUR), to: iso(now - HOUR), title: "One arc we can tell" });
    assert.ok(!arc.error, JSON.stringify(arc).slice(0, 300));
  });
  const rows = await sparkRows();
  assert.deepEqual(rows.map((r) => r.id), ["sbx-lio/one-arc-we-can-tell"]);
  assert.equal(Date.parse(rows[0].ends) - Date.parse(rows[0].starts), 69 * HOUR, "the long window stands whole");
});

test("AMEND AND WITHDRAW ARE THE SPARKER'S: another resident is refused both; a changed `to` is placed again from the record, a changed title is not; a withdrawn spark is finished", { skip }, async () => {
  const now = Date.now();
  await seed(now);
  let id;
  await withLaw({ spark: true }, async () => {
    const r = await spark(LIO, { from: iso(now - 100 * 60_000), to: iso(now - HOUR), title: "Moment to amend" });
    assert.ok(!r.error, JSON.stringify(r).slice(0, 300));
    id = "sbx-lio/moment-to-amend";
  });
  const placeOf = async () => { const r = (await sparkRows()).find((x) => x.id === id); return [Number(r.place_x), Number(r.place_y)]; };
  assert.deepEqual(await placeOf(), [B.x, B.y]);

  const theirs = await callTownPostTool("town_amend", { post: id, title: "Ren's words" }, REN);
  assert.equal(theirs.error, "bounce"); assert.equal(theirs.code, 403, JSON.stringify(theirs));
  const theirClose = await callTownPostTool("town_close", { post: id }, REN);
  assert.equal(theirClose.error, "bounce"); assert.equal(theirClose.code, 403, JSON.stringify(theirClose));

  const retitled = await callTownPostTool("town_amend", { post: id, title: "Moment, renamed" }, LIO);
  assert.ok(!retitled.error, JSON.stringify(retitled));
  assert.deepEqual(await placeOf(), [B.x, B.y], "a title changes nothing about where the moment was");

  const forged = await callTownPostTool("town_amend", { post: id, place: { at: { x: 9, y: 9 } } }, LIO);
  assert.equal(forged.error, "bounce"); assert.equal(forged.field, "place", JSON.stringify(forged));

  const later = await callTownPostTool("town_amend", { post: id, to: iso(now - 5 * 60_000) }, LIO);
  assert.ok(!later.error, JSON.stringify(later));
  assert.deepEqual(await placeOf(), [A.x, A.y], "the new `to` is placed again: by then lio had walked on to A");
  assert.deepEqual(later.amended, ["to"]);

  const shut = await callTownPostTool("town_close", { post: id }, LIO);
  assert.ok(!shut.error, JSON.stringify(shut));
  assert.equal(shut.post.state, "withdrawn");
  const after_ = await callTownPostTool("town_amend", { post: id, title: "Too late" }, LIO);
  assert.equal(after_.error, "bounce"); assert.equal(after_.code, 409);

  // the amend schema's spark words are refused by name on any other class
  const ev = await callTownPostTool("town_amend", { post: "sbx-lio/no-such-event", class: "event", note: "x" }, LIO);
  assert.equal(ev.error, "bounce"); assert.equal(ev.field, "note", JSON.stringify(ev));
});

test("NO CAP, NO LATER LIFE: a sparker's sixth spark stands, a spark is not advanced, and the read shows its moment and only its two states", { skip }, async () => {
  const now = Date.now();
  await seed(now);
  await withLaw({ spark: true }, async () => {
    for (let i = 1; i <= 6; i++) {
      const r = await spark(LIO, { from: iso(now - 100 * 60_000), to: iso(now - HOUR), title: `Moment number ${i}`, ...(i === 1 ? { note: "the first" } : {}) });
      assert.ok(!r.error, `spark ${i}: ${JSON.stringify(r).slice(0, 300)}`);
    }
  });
  assert.equal((await sparkRows()).length, 6, "six standing sparks by one sparker: no cap");
  await assert.rejects(() => advanceAtTown({ post: "sbx-lio/moment-number-1", to: "picked-up" }, LIO),
    (e) => e.code === 422 && /not advanced/.test(e.defect));

  const read = await postsAtOffice({ class: "spark" });
  assert.ok(!read.error, JSON.stringify(read).slice(0, 300));
  const first = read.posts.find((p) => p.id === "sbx-lio/moment-number-1");
  assert.equal(first.note, "the first");
  assert.deepEqual(first.place, { x: B.x, y: B.y });
  assert.deepEqual(first.window, { from: iso(Date.parse(iso(now - 100 * 60_000))), to: iso(Date.parse(iso(now - HOUR))) });
  assert.deepEqual(first.history.map((h) => h.state), ["sparked"]);
  assert.deepEqual(Object.keys(read.counts_by_state ?? {}).sort(), ["sparked", "withdrawn"], JSON.stringify(read.counts_by_state));
});

test("THE ID MINT, RACED: two sparks with one title by one sparker at once leave no act without its post and no post without its act; a loser is an honest bounce, never a thrown fault", { skip }, async () => {
  const now = Date.now();
  await seed(now);
  const args = { from: iso(now - 100 * 60_000), to: iso(now - HOUR), title: "The same moment twice" };
  const outcomes = await withLaw({ spark: true }, () => Promise.all([spark(LIO, args), spark(LIO, args)]));
  const rows = await sparkRows();
  const acts = await sparkActs();
  const landed = outcomes.filter((o) => !o.error);
  const refused = outcomes.filter((o) => o.error);
  for (const o of refused) assert.ok(o.error === "bounce" && [409, 503].includes(o.code), `a loser is a bounce: ${JSON.stringify(o).slice(0, 300)}`);
  assert.ok(landed.length >= 1, "at least one of them stands");
  assert.equal(rows.length, landed.length, `every landed spark has its row, and no other row stands: ${JSON.stringify(outcomes.map((o) => o.error ? o.defect : o.did))}`);
  assert.deepEqual(acts.map((a) => a.object).sort(), rows.map((r) => r.id).sort(), "the act log and the posts agree id for id");
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  console.log(`# measured: ${landed.length} landed (${rows.map((r) => r.id).join(", ")}), ${refused.length} refused${refused.length ? ` (${refused.map((o) => `${o.code} ${o.defect}`).join("; ")})` : ""}`);
});

// ── FIX 1: what the record does not establish is unknown, never today's world ─
//
// LAW (Wright, AUTHORITY 2026-11-05T09:33:28Z): "when the record doesn't establish the place, the spark says so. It
// never substitutes, and never refuses the resident ... a stamped walk establishes the sparker's place at `to` ...
// No stamped walk row establishes the place at `to`: no `homeOf` in the current world, and no porch. An unstamped
// old departure: today's default pace doesn't count. Unknown. A rider at `to`: their place is the vehicle, at its own
// recorded position at `to`. If that isn't recorded, unknown. Never the wharf ... `place: null`, with a plain reason
// ... Plus the call-time standpoint, labelled `sparked_from` ... The spark is still accepted."

const rowOf = async (id) => owner(async (c) => (await c.query("SELECT place_x, place_y, fields FROM posts WHERE id = $1", [id])).rows[0]);
const fieldsOf = (r) => (typeof r.fields === "string" ? JSON.parse(r.fields) : r.fields ?? {});

test("UNKNOWN IS ACCEPTED, NEVER SUBSTITUTED: mo has a home in today's world and no walk, una walked with no stamped stride, and each spark stands with place: null, its reason and where it was pressed from; kai's landing places kai; and the grant still decides first", { skip }, async () => {
  const now = Date.now();
  await seed(now);
  await walkAt("sbx-una", now - 2 * HOUR, O, B, { pace: null });
  const land = normalizeRow(landEntry({ crossing: walkMod.fractionalCrossing(now - 2 * HOUR), who: "sbx-kai", at: LANDED, why: "passage", writtenAt: iso(now - 2 * HOUR) }));
  await owner((c) => c.query("INSERT INTO acts (at, crossing, actor, action, class, payload) VALUES ($1,$2,$3,$4,$5,$6)",
    [land.written_at, String(land.crossing), land.actor, land.action, land.class, land.payload]));
  // the controls: today's world DOES place mo at home, and today's default stride WOULD put una at B
  const moNow = await residentStandpoint("sbx-mo");
  assert.deepEqual([moNow.x, moNow.y, moNow.source], [HOME_AT.x, HOME_AT.y, "parcel"], "the trap is live: mo's current home answers where mo stands now");
  const trap = walkMod.positionAt({ from: O, toward: B, at: walkMod.fractionalCrossing(now - 2 * HOUR), pace: null, targetExtent: null, targetMarkId: null }, walkMod.fractionalCrossing(now - HOUR));
  assert.deepEqual([trap.x, trap.y], [B.x, B.y], "the trap is live: today's default stride would put una at B");
  const args = (title) => ({ from: iso(now - 100 * 60_000), to: iso(now - HOUR), title });

  await withLaw({ spark: false }, async () => {
    const r = await spark(MO, args("No grant, no spark"));
    assert.equal(r.error, "bounce", "an unknown place is no way past the grant");
  });
  await withLaw({ spark: true }, async () => {
    for (const [key, title] of [[MO, "Mo at home, or so today says"], [UNA, "Una on an unstamped road"], [KAI, "Kai set down"]]) {
      const r = await spark(key, args(title));
      assert.ok(!r.error, `${title}: accepted, ${JSON.stringify(r).slice(0, 300)}`);
    }
  });
  const mo = await rowOf("sbx-mo/mo-at-home-or-so-today-says");
  assert.deepEqual([mo.place_x, mo.place_y], [null, null], "no place: a current home is not where mo stood then");
  assert.match(fieldsOf(mo).place_unknown, /no stamped walk/);
  assert.deepEqual(fieldsOf(mo).sparked_from, { x: HOME_AT.x, y: HOME_AT.y, source: "parcel" }, "where it was pressed from, labelled as such");
  const una = await rowOf("sbx-una/una-on-an-unstamped-road");
  assert.deepEqual([una.place_x, una.place_y], [null, null], "no place: today's default stride is not una's stride then");
  assert.match(fieldsOf(una).place_unknown, /no stamped pace/);
  const kai = await rowOf("sbx-kai/kai-set-down");
  assert.deepEqual([Number(kai.place_x), Number(kai.place_y)], [LANDED.x, LANDED.y], "a landing names no stride, and needs none: kai stood where kai was set down");
  assert.equal(fieldsOf(kai).place_unknown, undefined);

  const read = await postsAtOffice({ class: "spark" });
  const rmo = read.posts.find((p) => p.id === "sbx-mo/mo-at-home-or-so-today-says");
  assert.deepEqual([rmo.place, rmo.sparked_from], [null, { x: HOME_AT.x, y: HOME_AT.y, source: "parcel" }]);
  assert.match(rmo.place_unknown, /no stamped walk/, "the read says why");
  const [act] = (await sparkActs()).filter((a) => a.object === "sbx-mo/mo-at-home-or-so-today-says");
  const p = typeof act.payload === "string" ? JSON.parse(act.payload) : act.payload;
  assert.equal(p.place, null, "the post act carries no place");
});

test("A RIDER IS NOT AT THE WHARF: tam walked to W and boarded the boat; a moment that ended before boarding is placed at W, one that ended aboard is unknown; amending `to` across the boarding clears and restores the place, and never moves where it was pressed from", { skip }, async () => {
  const now = Date.now();
  await seed(now);
  const TAM = { household: "sbx-tam", handles: new Set(["sbx-tam"]) };
  await walkAt("sbx-tam", now - HOUR, O, W);
  const before = now - 30 * 60_000;      // tam had reached W by then (1,273 m at the stamped stride is about 15 minutes)
  const e = await enterViaOffice(repo, { mark: BOAT }, TAM, crossingDeps());
  assert.ok(!e?.error && (e.entered ?? []).includes(BOAT), `tam boards the boat: ${JSON.stringify(e).slice(0, 300)}`);
  let id;
  await withLaw({ spark: true }, async () => {
    const ashore = await spark(TAM, { from: iso(now - 50 * 60_000), to: iso(before), title: "Tam on the wharf" });
    assert.ok(!ashore.error, JSON.stringify(ashore).slice(0, 300));
    const aboard = await spark(TAM, { from: iso(now - 50 * 60_000), to: iso(Date.now()), title: "Tam aboard" });
    assert.ok(!aboard.error, `aboard is still accepted: ${JSON.stringify(aboard).slice(0, 300)}`);
    id = "sbx-tam/tam-on-the-wharf";
  });
  const ashore = await rowOf(id);
  assert.deepEqual([Number(ashore.place_x), Number(ashore.place_y)], [W.x, W.y], "before boarding the walk is the record: W");
  const aboard = await rowOf("sbx-tam/tam-aboard");
  assert.deepEqual([aboard.place_x, aboard.place_y], [null, null], "aboard at `to`: NOT the wharf, though the last walk ends there");
  assert.match(fieldsOf(aboard).place_unknown, /^inside sbx-wharf\/the-boat at the moment's end \(a vehicle today\)/);
  const pressed = fieldsOf(ashore).sparked_from;
  assert.ok(pressed, "where it was pressed from is recorded");

  const out = await callTownPostTool("town_amend", { post: id, to: iso(Date.now()) }, TAM);
  assert.ok(!out.error, JSON.stringify(out));
  let r = await rowOf(id);
  assert.deepEqual([r.place_x, r.place_y], [null, null], "known → unknown: the old place is cleared");
  assert.match(fieldsOf(r).place_unknown, /^inside sbx-wharf\/the-boat/);
  assert.deepEqual(fieldsOf(r).sparked_from, pressed, "where it was pressed from does not move");
  const back = await callTownPostTool("town_amend", { post: id, to: iso(before) }, TAM);
  assert.ok(!back.error, JSON.stringify(back));
  r = await rowOf(id);
  assert.deepEqual([Number(r.place_x), Number(r.place_y)], [W.x, W.y], "unknown → known: placed again");
  assert.equal(fieldsOf(r).place_unknown, null, "and the stale reason is cleared");
  assert.deepEqual(fieldsOf(r).sparked_from, pressed);
});

// TODAY'S WORLD CHANGES UNDER AN OLD MOMENT (Root's S2): the boat is retired, or reclassified while another vehicle
// sails, by a later settlement (a new commit of the published state). Tam's boarding stays in the record of who entered
// what, and an old aboard moment must stay unknown, never become a walk to the wharf.
function worldNow(marks) {
  put("WORLD/world-state.json", JSON.stringify({ ...STATE0, marks }));
  execFileSync("git", ["-C", repo, "add", "WORLD/world-state.json"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qm", "a later settlement"]);
}
async function tamBoards(now) {
  const TAM = { household: "sbx-tam", handles: new Set(["sbx-tam"]) };
  await walkAt("sbx-tam", now - HOUR, O, W);
  const e = await enterViaOffice(repo, { mark: BOAT }, TAM, crossingDeps());
  assert.ok(!e?.error && (e.entered ?? []).includes(BOAT), `tam boards the boat while she is a vehicle: ${JSON.stringify(e).slice(0, 300)}`);
  return TAM;
}
const FERRY = { id: "sbx-wharf/the-ferry", by: "sbx-wharf", slug: "the-ferry", kind: "sited", class: "vehicle", at: { x: -900, y: 900 }, extent: { w: 30, h: 12 }, body: "A ferry on another run." };

for (const [name, today, word] of [
  ["RETIRED", () => STATE0.marks.filter((m) => m.id !== BOAT), /the world no longer holds it/],
  ["RECLASSIFIED, ANOTHER VEHICLE SAILING", () => [...STATE0.marks.map((m) => (m.id === BOAT ? { ...m, class: "thing" } : m)), FERRY], /not a vehicle today/],
]) {
  test(`A RIDER STAYS A RIDER WHEN THE BOAT IS ${name}: an old aboard moment is unknown, named, never the wharf; a moment before boarding is still W`, { skip }, async () => {
    const now = Date.now();
    await seed(now);
    const before = now - 30 * 60_000;
    const TAM = await tamBoards(now);
    worldNow(today());
    try {
      const raw = await (await import("../src/world.mjs")).worldStateRaw();
      const { worldHasVehicle } = await import("../src/world-movement.mjs");
      assert.equal(raw.marks.some((m) => m.id === BOAT && m.class === "vehicle"), false, "the control: today's world holds no vehicle boat");
      assert.equal(worldHasVehicle(raw), name !== "RETIRED", name === "RETIRED" ? "and no vehicle at all" : "while another vehicle sails today");
      await withLaw({ spark: true }, async () => {
        for (const [to, title] of [[iso(Date.now()), "Tam aboard, then"], [iso(before), "Tam on the wharf, then"]]) {
          const r = await spark(TAM, { from: iso(now - 50 * 60_000), to, title });
          assert.ok(!r.error, `${title}: accepted, ${JSON.stringify(r).slice(0, 300)}`);
        }
      });
      const aboard = await rowOf("sbx-tam/tam-aboard-then");
      assert.deepEqual([aboard.place_x, aboard.place_y], [null, null], "aboard at `to`: unknown, NOT the wharf the walk ends at");
      assert.match(fieldsOf(aboard).place_unknown, /^inside sbx-wharf\/the-boat at the moment's end/);
      assert.match(fieldsOf(aboard).place_unknown, word);
      const ashore = await rowOf("sbx-tam/tam-on-the-wharf-then");
      assert.deepEqual([Number(ashore.place_x), Number(ashore.place_y)], [W.x, W.y], "the matched ashore control: inside nothing, the stamped walk places W");
      assert.equal(fieldsOf(ashore).place_unknown, undefined);
    } finally { worldNow(STATE0.marks); }
  });
}

// ONE RESIDENT IS JUDGED AND WRITTEN (Root's S1): a key that holds two residents gates the world door as the one it
// names at the top; an envelope naming the other would be a spark that resident never had judged.
test("ONE ACTOR: a two-resident key sparks as the resident it names, at the top or matched in args or by the flat name; a contradictory args handle reaches the writer and is refused there, writing nothing", { skip }, async () => {
  const now = Date.now();
  await seed(now);
  const DUO = { household: "sbx-duo", handles: new Set(["sbx-ash", "sbx-bea"]) };
  const args = (title, extra = {}) => ({ from: iso(now - 90 * 60_000), to: iso(now - HOUR), title, ...extra });
  await withLaw({ spark: true }, async () => {
    const top = await spark(DUO, args("Ash at the top"), { handle: "sbx-ash" });
    assert.ok(!top.error, JSON.stringify(top).slice(0, 300));
    const matched = await spark(DUO, args("Ash matched", { handle: "sbx-ash" }), { handle: "sbx-ash" });
    assert.ok(!matched.error, JSON.stringify(matched).slice(0, 300));
    const flat = await callWorldTool("world_spark", { ...args("Bea by the flat name"), handle: "sbx-bea" }, DUO);
    assert.ok(!flat.error, JSON.stringify(flat).slice(0, 300));
    const before = (await sparkActs()).length;
    const contra = await spark(DUO, args("Bea in ash's coat", { handle: "sbx-bea" }), { handle: "sbx-ash" });
    assert.equal(contra.error, "bounce", `refused: ${JSON.stringify(contra).slice(0, 300)}`);
    assert.match(String(contra.defect), /this spark was judged for sbx-ash and names sbx-bea/, "refused by the writer, after the gate judged ash");
    const unnamed = await spark(DUO, args("Bea, judged for no one", { handle: "sbx-bea" }));
    assert.equal(unnamed.error, "bounce", `an args handle with nobody named at the top is not judged for bea: ${JSON.stringify(unnamed).slice(0, 300)}`);
    assert.equal((await sparkActs()).length, before, "neither refusal wrote an act");
  });
  const rows = await sparkRows();
  assert.deepEqual(rows.map((r) => [r.id, r.author]), [["sbx-ash/ash-at-the-top", "sbx-ash"], ["sbx-ash/ash-matched", "sbx-ash"], ["sbx-bea/bea-by-the-flat-name", "sbx-bea"]]);
  const acts = await sparkActs();
  assert.deepEqual(acts.map((a) => a.actor), ["sbx-ash", "sbx-ash", "sbx-bea"], "each act's actor is the resident it was judged for");
});

test("A LATE TITLE OR NOTE AMEND MOVES NOTHING: lio's spark keeps its place and where it was pressed from after lio's record moves on", { skip }, async () => {
  const now = Date.now();
  await seed(now);
  const id = "sbx-lio/where-it-was";
  await withLaw({ spark: true }, async () => {
    const r = await spark(LIO, { from: iso(now - 100 * 60_000), to: iso(now - HOUR), title: "Where it was" });
    assert.ok(!r.error, JSON.stringify(r).slice(0, 300));
  });
  const first = await rowOf(id);
  assert.deepEqual(fieldsOf(first).sparked_from, { x: A.x, y: A.y, source: "walk" }, "pressed from A, where lio stood when sparking");
  // lio's record moves on: a later walk, so where lio stands now is no longer A (the control)
  await walkAt("sbx-lio", now - 10 * 60_000, A, LANDED);
  const moved = await residentStandpoint("sbx-lio");
  assert.notDeepEqual([moved.x, moved.y], [A.x, A.y], "the control: lio's standpoint has moved");
  const out = await callTownPostTool("town_amend", { post: id, title: "Where it was, renamed", note: "later words" }, LIO);
  assert.ok(!out.error, JSON.stringify(out));
  assert.deepEqual(out.amended.sort(), ["note", "title"]);
  const after_ = await rowOf(id);
  assert.deepEqual([Number(after_.place_x), Number(after_.place_y)], [B.x, B.y], "the place stays B");
  assert.deepEqual(fieldsOf(after_).sparked_from, { x: A.x, y: A.y, source: "walk" }, "and where it was pressed from stays A, not lio's later standpoint");
});

test("STRICT PAST: on a fixed clock, `to` one millisecond ahead is refused and writes nothing; `to` exactly now stands", { skip }, async () => {
  const now = Date.now();
  await seed(now);
  const N = now - 5 * 60_000;
  const args = (to, title) => ({ from: iso(N - HOUR), to: iso(to), title });
  await assert.rejects(() => postSpark(args(N + 1, "One millisecond ahead"), LIO, { now: N }),
    (e) => e.code === 422 && /has happened/.test(e.defect));
  assert.deepEqual(await sparkRows(), [], "nothing written");
  const ok = await postSpark(args(N, "Exactly now"), LIO, { now: N });
  assert.equal(ok.post.to, iso(N));
  assert.deepEqual((await sparkRows()).map((r) => r.id), ["sbx-lio/exactly-now"]);
});
