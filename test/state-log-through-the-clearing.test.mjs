// state-log-through-the-clearing.test.mjs — WLD-137: the retained journal covers
// every act whose claim the clearing folds, including acts filed between a
// window's close and its clearing.
//
//   node --import ./test/helpers/sparse-guard.mjs --test --test-concurrency=1 test/state-log-through-the-clearing.test.mjs
//
// LAW (Wright, 2026-10-31, the class fix under SHIPPING § 9; WLD-137): "the
// retained journal covers every act whose claim the clearing folds, including
// acts filed between a window's close and its clearing." And the reason it is
// ruled that way and not the other: "the keeper's source check and the
// published record agree by construction."
//
// THE MEASURED SHAPE, window 283 (S143's hold, 2026-10-31). The window's
// recorded close was 17:45:40Z and its clearing ran at 18:00:34Z: the timer
// fires at :00 while the candle's chain still closes at :45
// (deploy/postmark-world2-clearing.timer § MOVING THESE MARKS DOES NOT MOVE THE
// WINDOWS). A window stays open until its clearing runs, so the office went on
// filing claims into 283 in between; the clearing folded them and S143
// published them. The photograph stopped at the close (last_seq 37299,
// 17:45:33Z), so acts 37315 and 37360 were in no retained journal and the
// keeper's source check held the settlement. S142 held the same way the day
// before.
//
// A REAL Postgres (test/helpers/embedded-store.mjs), the whole schema, rows as
// the clearing leaves them, and the REAL writer: `writeStateLogForWindow`, the
// function `state-log-write.mjs --window N --write` runs at every crossing,
// reading as `office_api`, the role the office's env file gives the crossing
// (DEPLOY.md § the dry run). The other tests of this writer
// (state-log-check.test.mjs) answer from a fake that matches SQL by substring,
// so only a real register can say the horizon's query is right, and a
// photograph that cannot be written refuses the whole crossing
// (settlement-auto.sh § A WRITE THAT FAILED IS A REFUSAL). The journal is read
// back off disk, the way the keeper reads it: by seq, field for field.
//
// Synthetic handles only. The acts keep the issue's ids so the shape reads
// against the record.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startStore } from "./helpers/embedded-store.mjs";
import { currentCrossing } from "../src/crossings.mjs";
import { checkStateLog, windowCrossings, writeStateLogForWindow } from "../world2/tools/state-log-write.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "world2", "tools", "state-log-write.mjs");

const store = await startStore({ db: "wld137_through_test" });
after(() => store.stop());

const scratch = mkdtempSync(join(tmpdir(), "postmark-wld137-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } });

const LAW = "LAW: \"the retained journal covers every act whose claim the clearing folds, including acts filed between a window's close and its clearing\"";

// ── WINDOW 283, AS THE CLEARING LEFT IT ──────────────────────────────────────

const OPENS = "2026-10-31T05:45:40.000Z";
const CLOSES = "2026-10-31T17:45:40.000Z";          // the recorded close: the chain's :45
const CLEARED = "2026-10-31T18:00:34.427113Z";      // the clearing, as now() stamps it: to the microsecond
const NEXT_CLOSES = "2026-11-01T05:45:40.000Z";

const WINDOWS = [
  { id: 283, opens_at: OPENS, closes_at: CLOSES, status: "closed", cleared_at: CLEARED },
  { id: 284, opens_at: CLOSES, closes_at: NEXT_CLOSES, status: "open", cleared_at: null },
];

const act = (id, at, actor, action, cls, extra = {}) => ({
  id, at, actor, action, class: cls, object: null, payload: null, household: `solo:${actor}`, ...extra,
});

// Ferry crossings, from the town clock itself: 05:45:40Z-12:00Z is crossing
// 282 and 12:00Z-24:00Z is 283, so window 283 writes two files and the gap
// lands in 283's.
const ACTS = [
  act(37180, "2026-10-31T09:12:05.000Z", "sbx-ana", "say", "voice", { payload: { text: "a morning word at the pier" } }),
  act(37299, "2026-10-31T17:45:33.000Z", "sbx-bo", "say", "voice", { payload: { text: "seven seconds before the close" } }),
  // IN THE GAP, and a claim the clearing folded names each: the two records S143 published.
  act(37315, "2026-10-31T17:52:10.000Z", "sbx-cy", "leave-mark", "mark", {
    object: "sbx-cy/the-anti-keyring", payload: { slug: "the-anti-keyring", kind: "sited", body: "A ring that keeps no keys." } }),
  act(37330, "2026-10-31T17:55:00.000Z", "sbx-ana", "say", "voice", { payload: { text: "a word in the gap" } }),
  act(37360, "2026-10-31T17:58:41.000Z", "sbx-dee", "leave-mark", "mark", {
    object: "sbx-dee/porch-bowl", payload: { slug: "porch-bowl", kind: "sited", body: "A bowl left on the porch." } }),
  // A draft put forward by a stake whose door held the candle while the
  // clearing waited for it: promoteDraftOnStake takes the lock first and dates
  // the released act at its insert, after the clearing's transaction began.
  act(37396, "2026-10-31T18:00:34.478Z", "sbx-eve", "leave-mark", "mark", {
    object: "sbx-eve/late-lamp", payload: { slug: "late-lamp", kind: "sited", body: "A lamp put forward at the bell." } }),
  // The clearing's own act (hold-through.mjs § OPPOSED BRINGS IT BACK writes it
  // at now()): exactly the clearing's instant, to the microsecond.
  act(37398, CLEARED, "the-town", "give", "holding", {
    object: "sbx-ana/tin-cup", household: null, payload: { thing: "sbx-ana/tin-cup", holder: "sbx-ana", policy: "cascade" } }),
  // After the clearing: window 284's act, in the same ferry crossing's file.
  act(37401, "2026-10-31T18:10:00.000Z", "sbx-bo", "say", "voice", { payload: { text: "after the bell" } }),
  // An old act a hold printout's claim keeps as its author's last leave-mark.
  act(12001, "2026-10-03T10:00:00.000Z", "sbx-cy", "leave-mark", "mark", {
    object: "sbx-cy/old-lantern", payload: { slug: "old-lantern", kind: "sited", body: "An old lantern." } }),
];

const CLAIMS = [
  { slug: "sbx-cy/the-anti-keyring", claimant: "sbx-cy", status: "locked", data: { _act_id: "37315" } },
  { slug: "sbx-dee/porch-bowl", claimant: "sbx-dee", status: "locked", data: { _act_id: "37360" } },
  { slug: "sbx-eve/late-lamp", claimant: "sbx-eve", status: "locked", data: { _act_id: "37396" } },
  // A hold printout the clearing filed keeps the row's own `_act_id`, an old one.
  { slug: "sbx-cy/old-lantern", claimant: "sbx-cy", status: "locked", data: { _act_id: "12001", _held_through: 37398 } },
  // Ids the store cannot cast. A cast that threw would refuse the whole crossing.
  { slug: "sbx-bo/odd-one", claimant: "sbx-bo", status: "refused", data: { _act_id: "act:37315" } },
  { slug: "sbx-bo/huge-one", claimant: "sbx-bo", status: "refused", data: { _act_id: "99999999999999999999999" } },
  { slug: "sbx-bo/odd-hold", claimant: "sbx-bo", status: "locked", data: { _held_through: "act:37398" } },
  { slug: "sbx-bo/huge-hold", claimant: "sbx-bo", status: "locked", data: { _held_through: "99999999999999999999999" } },
];

async function owner(fn) { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } }
async function asOffice(fn) { const c = await store.connect("office_api"); try { return await fn(c); } finally { await c.end(); } }

async function seed({ windows = WINDOWS, acts = ACTS, claims = CLAIMS } = {}) {
  await owner(async (c) => {
    await c.query("TRUNCATE acts, claims, marks, windows CASCADE");
    for (const w of windows) {
      await c.query("INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES ($1, $2, $3, $4, $5)",
        [w.id, w.opens_at, w.closes_at, w.status, w.cleared_at]);
    }
    for (const a of acts) {
      await c.query(
        `INSERT INTO acts (id, at, crossing, actor, action, object, class, payload, household) OVERRIDING SYSTEM VALUE
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [a.id, a.at, currentCrossing(Date.parse(a.at)), a.actor, a.action, a.object, a.class,
          a.payload == null ? null : JSON.stringify(a.payload), a.household]);
    }
    for (const k of claims) {
      await c.query(
        `INSERT INTO claims (window_id, class, claimant, household, status, decided_at, slug, data)
         VALUES ($1, 'sited', $2, $3, $4, $5, $6, $7)`,
        [k.window ?? 283, k.claimant, `solo:${k.claimant}`, k.status, CLEARED, k.slug, JSON.stringify(k.data)]);
    }
  });
}

/** A world checkout with a STATE dir, the shape the sweep clone is in. */
function world(name) {
  const repo = join(scratch, name);
  mkdirSync(join(repo, "WORLD"), { recursive: true });
  mkdirSync(join(repo, "STATE", "log"), { recursive: true });
  writeFileSync(join(repo, "WORLD", "households.json"), JSON.stringify({ logins: {} }));
  return repo;
}

const files = (repo) => readdirSync(join(repo, "STATE", "log")).filter((n) => n.endsWith(".journal.jsonl")).sort();
const lines = (repo, name) => readFileSync(join(repo, "STATE", "log", name), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const metaOf = (repo, crossing) => JSON.parse(readFileSync(join(repo, "STATE", "log", `${crossing}.journal.meta.json`), "utf8"));
// W11's drop: committed 1.5 s into window 283's clearing, below the printout's cutoff.
const HOLD_RACE_DROP = act(37397, "2026-10-31T18:00:35.927Z", "sbx-ana", "drop", "holding", {
  object: "sbx-ana/tin-whistle", payload: { thing: "sbx-ana/tin-whistle", holder: null, policy: "detach" } });
const actOf = (id) => [...ACTS, ...LATE_ACTS, HOLD_RACE_DROP].find((a) => a.id === id);

/**
 * THE KEEPER'S QUESTION, asked of the files: is there a line for this act, in
 * any retained journal file, and is it the act? Its ledger pairs a published
 * mark with its act by seq and then by actor, words and place
 * (holds-ledger 2026-10-07: "seq13388 actor … body/date/position matches").
 */
function sourceOf(repo, id) {
  for (const name of files(repo)) {
    const hit = lines(repo, name).find((l) => l.seq === id);
    if (hit) return { ...hit, file: name };
  }
  return null;
}

function assertIsTheAct(line, id, why) {
  const a = actOf(id);
  assert.ok(line, `act ${id} (${a.actor} ${a.action}, at ${a.at}) is in the retained journal: ${why} — ${LAW}`);
  assert.equal(line.file, `${currentCrossing(Date.parse(a.at))}.journal.jsonl`, "in its own ferry crossing's file");
  assert.equal(line.actor, a.actor, "the same actor");
  assert.equal(line.type, a.action, "the same act");
  assert.equal(line.object, a.object, "the same object");
  assert.equal(line.class, a.class, "the same class");
  assert.deepEqual(line.payload, a.payload, "the same words and fields");
  // Date.parse keeps milliseconds, as the line does (journalInstant), so the
  // clearing's microsecond instant compares at the grain the journal holds.
  assert.equal(Date.parse(line.at), Date.parse(a.at), "dated as the act was");
}

const writeWindow = (repo, window) => asOffice((c) => writeStateLogForWindow(c, { world: repo, window, commit: false }));

// ── THE FALSIFIER ────────────────────────────────────────────────────────────

test("W1 · window 283's shape: the acts behind the two records the clearing folded after the close are in the journal it keeps, field for field", async () => {
  await seed();
  const repo = world("w1");
  const out = await writeWindow(repo, 283);
  assert.equal(out.refused, undefined, JSON.stringify(out));

  for (const id of [37315, 37360]) {
    assertIsTheAct(sourceOf(repo, id), id,
      `filed after the window's close (${CLOSES}) and before its clearing (${CLEARED}), and its claim was folded there`);
  }
  // The issue's own instrument: the meta stopped at last_seq 37299 (17:45:33Z).
  assert.notEqual(metaOf(repo, 283).last_seq, 37299, "the journal no longer stops at the close");
});

test("W2 · an act filed in the gap that no claim names is in it too: the photograph ends at the clearing, not at the close", async () => {
  // Isolates the clearing term. NO CLAIMS in this window, so no act a claim
  // names can carry the horizon past this say: only the window's own clearing
  // can put it in this window's photograph.
  await seed({ claims: [] });
  const repo = world("w2");
  const out = await writeWindow(repo, 283);
  assertIsTheAct(sourceOf(repo, 37330), 37330, "said after the close and before the clearing; no claim names it");
  assert.equal(out.through, "2026-10-31T18:00:34.427113Z", "the horizon is the clearing, to the microsecond");
  assert.equal(out.through_from, "clearing");
  assert.equal(sourceOf(repo, 37396), null, "and an act after the clearing that no folded claim names stays out");
});

test("W3 · the clearing's own act, stamped at its instant to the microsecond, is inside the horizon", async () => {
  // The precision arm, with no claims so nothing else lifts the horizon.
  // `cleared_at` and the hold write-through's return act are both `now()` in
  // the clearing's transaction, so the act sits exactly ON the horizon. A
  // horizon carried through a JS Date loses the microseconds
  // (18:00:34.427113 -> .427) and `at <= horizon` then leaves this act out.
  await seed({ claims: [] });
  const repo = world("w3");
  const out = await writeWindow(repo, 283);
  assertIsTheAct(sourceOf(repo, 37398), 37398, "written by the clearing itself at its own instant");
  assert.ok(out.windows.some((w) => w.crossing === 283), "crossing 283's file was written");
});

test("W4 · a folded claim whose act is dated after the clearing began is in it: the horizon reaches every act a folded claim names", async () => {
  // Isolates the claim term. Act 37396 is 51 ms after `cleared_at`: the stake's
  // door held the candle, the clearing waited for it, and the clearing then
  // folded the claim. No instant on the window's row covers it; the claim's
  // `_act_id` does, by construction.
  await seed();
  const repo = world("w4");
  const out = await writeWindow(repo, 283);
  assertIsTheAct(sourceOf(repo, 37396), 37396, "its claim was folded by this clearing though its act is dated 51 ms after the clearing began");
  assert.equal(out.through, "2026-10-31T18:00:34.478000Z", "the horizon is that act's own instant");
  assert.equal(out.through_from, "claim", "and the receipt says which term set it");
});

test("W5 · CONTROLS: the next window's act stays out, an old act a printout keeps drags no old file in, and an id the store cannot cast refuses nothing", async () => {
  await seed();
  const repo = world("w5");
  const out = await writeWindow(repo, 283);
  assert.equal(out.refused, undefined, `the malformed and oversized _act_id and _held_through values refused nothing: ${JSON.stringify(out)}`);

  // The boundary did not become "everything": 18:10Z is window 284's.
  assert.equal(sourceOf(repo, 37401), null, "act 37401, filed after the clearing, is not in window 283's photograph");
  // The crossing set is the window's own time range. An old act that a hold
  // printout keeps as `_act_id` raises nothing and re-renders no old file.
  const old = `${currentCrossing(Date.parse(actOf(12001).at))}.journal.jsonl`;
  assert.equal(existsSync(join(repo, "STATE", "log", old)), false, `no ${old} was written for an old act a claim keeps`);
  assert.deepEqual(out.windows.map((w) => w.crossing), [282, 283], "window 283 writes exactly its two ferry crossings");
  // And the two before the close are where they always were.
  assertIsTheAct(sourceOf(repo, 37180), 37180, "inside the window, crossing 282");
  assertIsTheAct(sourceOf(repo, 37299), 37299, "inside the window, before its close");
});

test("W6 · a window not yet cleared keeps its recorded close as the horizon, and so does one cleared before its close", async () => {
  // Today's boundary is the floor: an open window has folded nothing, so the
  // close is all there is; a clearing that ran early has nothing after its
  // close to reach for.
  await seed({
    windows: [...WINDOWS,
      { id: 290, opens_at: "2026-11-03T17:45:40.000Z", closes_at: "2026-11-04T05:45:40.000Z", status: "closed", cleared_at: "2026-11-04T05:30:00.000Z" }],
  });
  const open = await asOffice((c) => windowCrossings(c, 284));
  assert.equal(open.refused, undefined);
  assert.equal(Date.parse(open.through), Date.parse(NEXT_CLOSES), "an open window's horizon is its recorded close");
  assert.equal(open.through_from, "close");
  const early = await asOffice((c) => windowCrossings(c, 290));
  assert.equal(Date.parse(early.through), Date.parse("2026-11-04T05:45:40.000Z"), "a window cleared before its close keeps its close");
  assert.equal(early.through_from, "close");
  const cleared = await asOffice((c) => windowCrossings(c, 283));
  assert.equal(cleared.cleared_at instanceof Date ? cleared.cleared_at.toISOString() : cleared.cleared_at, "2026-10-31T18:00:34.427Z",
    "and the window's row is read with its clearing");
});

test("W7 · --check reads the same horizon: after the next window writes into the same file, window 283's check compares the gap's acts and names the later row beyond it", async () => {
  await seed();
  const repo = world("w7");
  await writeWindow(repo, 283);
  await writeWindow(repo, 284);   // the next crossing, through the same door: 37401 lands in crossing 283's file
  assert.ok(sourceOf(repo, 37401), "window 284's write put its row in crossing 283's file");

  const chk = await asOffice((c) => checkStateLog(c, { world: repo, window: 283 }));
  assert.equal(chk.refused, undefined, JSON.stringify(chk));
  // The behaviour first, so a red names it: at the close, five of these six
  // rows read as "beyond the horizon" and the check compares one.
  const c283 = chk.crossings.find((x) => x.crossing === 283);
  assert.equal(c283.beyond_horizon, 1, "only the row filed after the clearing is beyond window 283's horizon");
  assert.equal(c283.file_lines, 6, "37299, 37315, 37330, 37360, 37396 and 37398 are compared");
  assert.equal(c283.equal, 6, "and every one pairs");
  assert.equal(c283.classes.unexplained, undefined, `no false finding: ${c283.first_difference}`);
  assert.equal(chk.through, "2026-10-31T18:00:34.478000Z", "and the check names the horizon it read");
});

// A CLEARING RUN BY HAND, LATE, past a ferry's sailing (SHIPPING § 9 and
// settlement-auto.sh name the by-hand door; window 184 was cleared by hand
// hours after its close on 2026-09-12). Window 285 closes 17:45:40Z on 11-01
// and is cleared at 00:20Z on 11-02, after ferry 286 sailed at 00:00Z. The one
// claim filed in between names an act in crossing 286, a crossing the window's
// own (opens, close] never touched, and the window holds no other act.
const LATE_WINDOWS = [
  { id: 285, opens_at: "2026-11-01T05:45:40.000Z", closes_at: "2026-11-01T17:45:40.000Z", status: "closed", cleared_at: "2026-11-02T00:20:00.000000Z" },
  { id: 286, opens_at: "2026-11-01T17:45:40.000Z", closes_at: "2026-11-02T05:45:40.000Z", status: "open", cleared_at: null },
];
const LATE_ACTS = [
  act(37900, "2026-11-02T00:05:00.000Z", "sbx-fen", "leave-mark", "mark", {
    object: "sbx-fen/night-gate", payload: { slug: "night-gate", kind: "sited", body: "A gate left open for the night ferry." } }),
  act(37950, "2026-11-02T00:40:00.000Z", "sbx-fen", "say", "voice", { payload: { text: "after the late clearing" } }),
];

test("W9 · a clearing run by hand after a ferry sailed: the act filed past the ferry, in a crossing the window's own range never touched, is written into its own file", async () => {
  // The crossing SET is read over (opens_at, through], not (opens_at, close].
  // Read over the close, this window has no crossing at all, the writer
  // answers "nothing to photograph", and the claim the clearing folded has no
  // source act anywhere.
  await seed({ windows: LATE_WINDOWS, acts: LATE_ACTS,
    claims: [{ window: 285, slug: "sbx-fen/night-gate", claimant: "sbx-fen", status: "locked", data: { _act_id: "37900" } }] });
  const repo = world("w9");
  const out = await writeWindow(repo, 285);
  assert.equal(out.refused, undefined, JSON.stringify(out));
  assertIsTheAct(sourceOf(repo, 37900), 37900, "filed after ferry 286 sailed and before the by-hand clearing folded its claim");
  assert.deepEqual(out.windows.map((w) => w.crossing), [286], "the crossing past the ferry is this window's to write");
  assert.equal(out.through_from, "clearing");
  assert.equal(sourceOf(repo, 37950), null, "and the act after the clearing stays out");
});

test("W11 · a hold printout's source drop, committed DURING the clearing's own transaction, is in it: the horizon reaches every hold act up to the cutoff a printout's claim names", async () => {
  // The hold doors take no candle lock, and the clearing's step 6.2 reads the
  // hold record under READ COMMITTED, so a drop committed 1.5 s into the
  // clearing is printed there. The printout's claim names the cutoff
  // (`_held_through: 37398`), and that cutoff is the clearing's OWN return act,
  // stamped at its `now()`: a later id with an EARLIER instant than the drop.
  // The cutoff's instant would leave the drop out; the latest hold act at or
  // below the cutoff does not. Only the printout claim is seeded, so nothing
  // else lifts the horizon.
  await seed({
    acts: [...ACTS, HOLD_RACE_DROP],
    claims: [{ slug: "sbx-ana/tin-whistle", claimant: "sbx-ana", status: "locked", data: { _held_through: 37398 } }],
  });
  const repo = world("w11");
  const out = await writeWindow(repo, 283);
  assert.equal(out.refused, undefined, JSON.stringify(out));
  assertIsTheAct(sourceOf(repo, 37397), 37397, "a drop committed during the clearing and printed by it, below the printout's cutoff");
  assert.equal(out.through, "2026-10-31T18:00:35.927000Z", "the horizon is the latest hold act at or below the cutoff");
  assert.equal(out.through_from, "claim");
  assert.equal(sourceOf(repo, 37401), null, "and the act filed after the clearing still stays out");
});

test("W10 · a register that answers the window's row without its horizon REFUSES; it never falls back to the close", async () => {
  // Unreachable on the real store (`closes_at` is NOT NULL, so the horizon
  // always has a value); reachable from any register that does not speak
  // WINDOW_ROW_SQL. Falling back to the close would put the WLD-137 gap back
  // without a word, so the window door refuses instead, by name.
  const mute = {
    async query(sql, params) {
      if (sql.includes("FROM windows")) return { rows: [{ id: params[0], opens_at: OPENS, closes_at: CLOSES, cleared_at: CLEARED }] };
      throw new Error(`a window with no horizon must not reach a second query: ${sql.slice(0, 60)}`);
    },
  };
  const w = await windowCrossings(mute, 283);
  assert.equal(w.refused, "no-horizon", JSON.stringify(w));
  assert.match(w.detail, /window 283/);
  const out = await writeStateLogForWindow(mute, { world: world("w10"), window: 283, commit: false });
  assert.equal(out.refused, "no-horizon", "and the write door passes the refusal through, writing nothing");
});

test("W8 · the box's own command line, over the real register: `state-log-write.mjs --window 283 --check` answers with the horizon and refuses nothing", async () => {
  // The CLI the crossing runs, connected the way the box connects it
  // (WORLD2_PG_URL as office_api), so the horizon's SQL is proved through the
  // door that will run it, not only through the exported function.
  await seed();
  const repo = world("w8");
  await writeWindow(repo, 283);
  const r = spawnSync(process.execPath, [CLI, "--world", repo, "--window", "283", "--check"], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_PG_URL: store.url("office_api") },
  });
  assert.notEqual(r.status, 2, `not an argument error: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.refused, undefined, `the check ran: ${r.stdout.slice(0, 400)} ${r.stderr.slice(0, 400)}`);
  assert.deepEqual(out.crossings.map((c) => c.crossing), [282, 283]);
  const c283 = out.crossings.find((c) => c.crossing === 283);
  assert.equal(c283.file_lines, 6, "the CLI compares the gap's rows too, not only the function");
  assert.equal(out.through, "2026-10-31T18:00:34.478000Z");
  assert.equal(out.through_from, "claim");
});
