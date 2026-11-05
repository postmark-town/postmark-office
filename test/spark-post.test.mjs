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
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "WORLD_CLONE", "WORLD_MOVEMENT_V2", "WORLD_POSITIONS", "POSITIONS_SNAPSHOT", "TOWN_CLONE", "WORLD_APEX"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
let pool;

const FRAME = "the-town/let-there-be-light";
const LIO = { household: "sbx-lio", handles: new Set(["sbx-lio"]) };
const REN = { household: "sbx-ren", handles: new Set(["sbx-ren"]) };
const HOUR = 3_600_000, DAY = 24 * HOUR;
const O = { x: 0, y: 0 }, B = { x: 300, y: 40 }, A = { x: -200, y: -90 };

let worldApex, callWorldTool, townPostEvent, callTownPostTool, postAtTown, advanceAtTown, postsAtOffice, residentStandpoint, walkMod, walkEntry, normalizeRow;
if (!skip) {
  mkdirSync(join(repo, "tools"), { recursive: true });
  for (const f of readdirSync(join(WORLD, "tools")).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")))
    copyFileSync(join(WORLD, "tools", f), join(repo, "tools", f));
  const root = { id: FRAME, by: "the-town", slug: "let-there-be-light", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 100000, h: 100000 } };
  put("WORLD/marks/let-there-be-light/mark.md", markRecord(root, "Synthetic world frame."));
  put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, households: {}, marks: [{ ...root, body: "Synthetic world frame." }] }));
  put("WORLD/walk-ledger.md", "# Walk ledger\n");
  copyFileSync(join(WORLD, "WORLD", "skeleton.json"), join(repo, "WORLD", "skeleton.json"));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "add", "-A", "WORLD", "tools"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-qm", "synthetic canon"]);
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: store.url("office_api") });
  Object.assign(process.env, { WORLD_CLONE: repo, WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), WORLD_MOVEMENT_V2: "1", TOWN_CLONE: NO_TOWN });
  delete process.env.WORLD_POSITIONS; delete process.env.POSITIONS_SNAPSHOT;
  (await import("../src/world2-pen.mjs")).__setPoolForTest(pool);
  ({ worldApex } = await import("../src/world-apex.mjs"));
  ({ callWorldTool, walkEntry, residentStandpoint } = await import("../src/world.mjs"));
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
async function walkAt(who, t, from, toward) {
  const row = normalizeRow(walkEntry({ crossing: walkMod.fractionalCrossing(t), who, targetMarkId: null, stampAt: null, witnesses: null,
    from, toward, pace: null, targetExtent: null, household: null, writtenAt: iso(t), declaredBy: who }));
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
  const expect = walkMod.positionAt({ from: O, toward: B, at: walkMod.fractionalCrossing(now - 2 * HOUR), pace: null, targetExtent: null, targetMarkId: null }, walkMod.fractionalCrossing(to));
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
