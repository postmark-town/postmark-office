// settlements-backfill.test.mjs — the writer's own derivation, pure (postmark#2897).
//
// `world2/tools/settlements-backfill.mjs` is the only writer of `settlements`,
// and the dry run, the apply and the verify all derive from these three
// functions. No git, no database: the tag lines are canned in the exact shape
// `git for-each-ref … --format` hands back, the windows are the store's real
// rows for the week of S71 (measured 2026-09-18 on prod, read-only).
//
// ── THE FLIPS, run 2026-09-17 against commit 3b5526c of this branch ─────────
//
// Two, because the tool holds two rules a reader could get wrong silently.
//
// 1 · the tag-object trap. In `settlementRowsFrom`, replace
//       const tag_sha = annotated ? l.peeled : l.sha;
//     with
//       const tag_sha = l.sha;
//     → 2 of 13 red:
//       not ok - an annotated tag yields the PEELED commit as tag_sha — never the tag object
//           actual: '9b5e294f52d25e6cc0dd61748c332215f3cd16c2'   (S71's tag OBJECT)
//           expected: '1984062faa76f0b835f316ca0f60a47676a98c5b' (the commit it blesses)
//       not ok - only settlement/S<n> counts, and the rows come back in number order …
//           (S9 and S10 no longer share a sha: two tag objects, one commit)
//
// 2 · the boundary. In `windowFor`, replace `c <= t` with `c < t`
//     → 1 of 13 red:
//       not ok - a publish at the exact close belongs to the window that just closed …
//           actual: 193, expected: 194
//     S47 is the real case: its sweep committed at 2026-08-26T05:45:16Z, the
//     second window 150 closed.
//
// Each restored with `git checkout -- world2/tools/settlements-backfill.mjs`;
// `git diff --exit-code` clean; 13/13 green again.
//
// Run: node --test test/settlements-backfill.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { settlementRowsFrom, windowFor, planFrom, windowTrailer, heldWindow } from "../world2/tools/settlements-backfill.mjs";

// `refs/tags/settlement/S71` on the shared clone, 2026-09-17: an ANNOTATED tag.
// The tag OBJECT is 9b5e294f…; the commit it blesses is 1984062f…. Both are
// 40 hex; only one is in any log.
const S71_LINE = {
  tag: "settlement/S71", type: "tag",
  sha: "9b5e294f52d25e6cc0dd61748c332215f3cd16c2",        // the tag object — the trap
  peeled: "1984062faa76f0b835f316ca0f60a47676a98c5b",     // the blessed commit
  cdate: null,                                            // a tag object has no committer date
  pcdate: "2026-09-17T05:46:08Z",                         // the crossing's push
  tdate: "2026-09-17T02:08:49-04:00",                     // the keeper's bless
};
// A LIGHTWEIGHT tag is the commit itself: nothing to peel, no date of its own.
const LIGHT_LINE = { tag: "settlement/S2", type: "commit", sha: "eeef9ae3a2a5a0be0fc23b33f01bf8a96dd43dc6", peeled: null, cdate: "2026-07-29T08:11:48-04:00", pcdate: null, tdate: null };

// The candle's rows around S71, as the store holds them. `status` and
// `cleared_at` are the columns the guard reads (POS-940): the clearing job sets
// both in one UPDATE (clearing-job.mjs), seconds after the close.
const WINDOWS = [
  { id: 190, closes_at: "2026-09-15T05:45:40Z", status: "closed", cleared_at: "2026-09-15T05:45:44Z" },
  { id: 191, closes_at: "2026-09-15T17:45:40Z", status: "closed", cleared_at: "2026-09-15T17:45:44Z" },
  { id: 192, closes_at: "2026-09-16T05:45:40Z", status: "closed", cleared_at: "2026-09-16T05:45:44Z" },
  { id: 193, closes_at: "2026-09-16T17:45:40Z", status: "closed", cleared_at: "2026-09-16T17:45:44Z" },
  { id: 194, closes_at: "2026-09-17T05:45:40Z", status: "closed", cleared_at: "2026-09-17T05:45:44Z" },   // S71's journal: "window 194 locked at 05:45:45Z"
  { id: 195, closes_at: "2026-09-17T17:45:40Z", status: "closed", cleared_at: "2026-09-17T17:45:44Z" },
  { id: 196, closes_at: "2026-09-18T05:45:40Z", status: "open", cleared_at: null },   // open at the time of writing; closes in the future
];

// ═════════════════════════════════════════════════════════════════════════════
// 1 · settlementRowsFrom — the tag, read right
// ═════════════════════════════════════════════════════════════════════════════

test("an annotated tag yields the PEELED commit as tag_sha — never the tag object", () => {
  const [row] = settlementRowsFrom([S71_LINE]);
  assert.equal(row.number, 71);
  assert.equal(row.tag_sha, "1984062faa76f0b835f316ca0f60a47676a98c5b", "the tag object's sha is in no log; a reader who looks it up finds nothing");
  assert.equal(row.published_at.toISOString(), "2026-09-17T05:46:08.000Z", "published_at is the blessed commit's committer date");
  assert.equal(row.blessed_at.toISOString(), "2026-09-17T06:08:49.000Z", "blessed_at is the tag object's own date, in the instant it names");
  assert.equal(row.lightweight, false);
});

test("a lightweight tag yields the commit it IS, and no bless date", () => {
  const [row] = settlementRowsFrom([LIGHT_LINE]);
  assert.equal(row.number, 2);
  assert.equal(row.tag_sha, "eeef9ae3a2a5a0be0fc23b33f01bf8a96dd43dc6");
  assert.equal(row.published_at.getTime(), Date.parse("2026-07-29T08:11:48-04:00"));
  assert.equal(row.blessed_at, null, "a lightweight tag carries no date — say null, never borrow the commit's");
  assert.equal(row.lightweight, true);
});

test("only settlement/S<n> counts, and the rows come back in number order whatever git's order was", () => {
  const rows = settlementRowsFrom([
    { ...S71_LINE },
    { tag: "settlement/S9", type: "tag", sha: "x".repeat(40), peeled: "b".repeat(40), cdate: null, pcdate: "2026-08-01T14:09:37-04:00", tdate: "2026-08-01T14:20:00-04:00" },
    { tag: "settlement/S10", type: "tag", sha: "y".repeat(40), peeled: "b".repeat(40), cdate: null, pcdate: "2026-08-01T14:09:37-04:00", tdate: "2026-08-01T14:21:00-04:00" },
    { tag: "settlement/S45-rc", type: "tag", sha: "z".repeat(40), peeled: "c".repeat(40), cdate: null, pcdate: "2026-08-20T00:00:00Z", tdate: null },
    { tag: "release/2026-w39", type: "commit", sha: "d".repeat(40), peeled: null, cdate: "2026-09-16T00:00:00Z", pcdate: null, tdate: null },
  ]);
  assert.deepEqual(rows.map((r) => r.number), [9, 10, 71], "git lists S10 before S9 lexically; the store must not");
  // S9 and S10 bless the SAME commit (S10 was a same-sha no-op blessing) — two
  // rows, two numbers, one sha; the number is the key and the sha is not unique.
  assert.equal(rows[0].tag_sha, rows[1].tag_sha);
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · windowFor — the window a crossing closed
// ═════════════════════════════════════════════════════════════════════════════

test("S71's sweep (05:46:08Z) closed window 194 — the crossing's own journal line agrees", () => {
  // `[settlement-auto] docket: window 194 locked at 2026-09-17T05:45:45.550Z`
  assert.equal(windowFor("2026-09-17T05:46:08Z", WINDOWS), 194);
});

test("a publish at the exact close belongs to the window that just closed, and one second before it to the previous", () => {
  assert.equal(windowFor("2026-09-17T05:45:40Z", WINDOWS), 194);
  assert.equal(windowFor("2026-09-17T05:45:39Z", WINDOWS), 193);
});

test("a window whose close is still in the future is never chosen, even though it is the newest row", () => {
  assert.equal(windowFor("2026-09-17T17:48:03Z", WINDOWS), 195, "the 09-17 evening publish closed 195; 196 is open");
});

test("before the first window there is no window: null, never 150 and never a guess", () => {
  assert.equal(windowFor("2026-07-28T20:08:58Z", WINDOWS), null);
  assert.equal(windowFor("2026-07-28T20:08:58Z", []), null);
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · planFrom — what the table holds against what the tags say
// ═════════════════════════════════════════════════════════════════════════════

const derived = () => settlementRowsFrom([S71_LINE, LIGHT_LINE]);
const asStored = (r, over = {}) => ({ number: r.number, tag_sha: r.tag_sha, published_at: r.published_at, window_id: windowFor(r.published_at, WINDOWS), blessed_at: r.blessed_at, ...over });

test("an empty table: every tag is `new`, nothing is extra", () => {
  const { plan, extra } = planFrom(derived(), [], WINDOWS);
  assert.deepEqual(plan.map((r) => r.state), ["new", "new"]);
  assert.equal(plan.find((r) => r.number === 71).window_id, 194);
  assert.equal(plan.find((r) => r.number === 2).window_id, null);
  assert.deepEqual(extra, []);
});

test("a table equal to the tags: every row `present`, and the verify would say EQUAL", () => {
  const d = derived();
  const { plan, extra } = planFrom(d, d.map((r) => asStored(r)), WINDOWS);
  assert.deepEqual(plan.map((r) => r.state), ["present", "present"]);
  assert.deepEqual(extra, []);
});

test("a present row with a DIFFERENT sha is a CONFLICT — a moved tag, never a rewrite", () => {
  const d = derived();
  const stored = d.map((r) => asStored(r, r.number === 71 ? { tag_sha: "0".repeat(40) } : {}));
  const { plan } = planFrom(d, stored, WINDOWS);
  const s71 = plan.find((r) => r.number === 71);
  assert.equal(s71.state, "CONFLICT");
  assert.equal(s71.have.tag_sha, "0".repeat(40), "the refusal names what the table holds");
});

test("a present row with the same sha and a different date or window is DRIFT, naming the column", () => {
  const d = derived();
  const stored = d.map((r) => asStored(r, r.number === 71 ? { window_id: 193, blessed_at: null } : {}));
  const { plan } = planFrom(d, stored, WINDOWS);
  const s71 = plan.find((r) => r.number === 71);
  assert.equal(s71.state, "DRIFT");
  assert.deepEqual(s71.drift, ["blessed_at", "window_id"]);
});

test("a stored instant equal to the tag's in a different rendering is NOT drift", () => {
  const d = derived();
  // node-pg hands back a Date; a string in another offset names the same instant
  const stored = d.map((r) => asStored(r, r.number === 71 ? { published_at: "2026-09-17T01:46:08-04:00", blessed_at: new Date("2026-09-17T06:08:49Z") } : {}));
  const { plan } = planFrom(d, stored, WINDOWS);
  assert.equal(plan.find((r) => r.number === 71).state, "present");
});

test("a row in the table with no tag behind it is `extra` — the verify reds on it", () => {
  const d = derived();
  const stored = [...d.map((r) => asStored(r)), { number: 9001, tag_sha: "9".repeat(40), published_at: new Date("2099-01-01T00:00:00Z"), window_id: null, blessed_at: null }];
  const { extra } = planFrom(d, stored, WINDOWS);
  assert.deepEqual(extra, [9001]);
});

// ═════════════════════════════════════════════════════════════════════════════
// 3b · A CLEARING 12 H LATE (POS-940; POS-354 fix c) — the trailer and the guard
// ═════════════════════════════════════════════════════════════════════════════
//
// Window 197 closes 09-18 17:45:40Z and is cleared thirteen hours late; 198
// closed by the clock at 09-19 05:45:40Z and is still open. The crossing that
// folded 197 publishes at 06:52Z. The store-backed run of the same case, through
// settlement-auto.sh's own name_window and the real tick, is
// test/settlement-late-clear.test.mjs.

const LATE = [...WINDOWS.filter((w) => w.id < 196),
  { id: 196, closes_at: "2026-09-18T05:45:40Z", status: "closed", cleared_at: "2026-09-18T05:45:44Z" },
  { id: 197, closes_at: "2026-09-18T17:45:40Z", status: "closed", cleared_at: "2026-09-19T06:50:00Z" },
  { id: 198, closes_at: "2026-09-19T05:45:40Z", status: "open", cleared_at: null }];
const LATE_LINE = { ...S71_LINE, tag: "settlement/S72", sha: "7".repeat(40), peeled: "8".repeat(40), pcdate: "2026-09-19T06:52:00Z", tdate: "2026-09-19T07:10:00Z" };
const lateRow = (stated_window = null) => settlementRowsFrom([LATE_LINE]).map((r) => ({ ...r, stated_window }));

test("THE DEFECT: by time alone, a crossing 13 h late names the successor window", () => {
  assert.equal(windowFor("2026-09-19T06:52:00Z", LATE), 198, "198's close passed before the push; 197 is what the crossing folded");
});

test("THE GUARD: with no trailer, that row is HELD before insertion — the successor is open — and stays held once it closes later", () => {
  const { plan } = planFrom(lateRow(), [], LATE);
  assert.equal(plan[0].state, "HELD");
  assert.equal(plan[0].window_id, 198);
  assert.equal(plan[0].held, "window 198 is open, not closed");
  const closedLater = LATE.map((w) => (w.id === 198 ? { ...w, status: "closed", cleared_at: "2026-09-19T18:00:00Z" } : w));
  assert.match(planFrom(lateRow(), [], closedLater).plan[0].held, /^window 198 was not closed when this crossing published \(cleared 2026-09-19T18:00:00\.000Z, published 2026-09-19T06:52:00\.000Z\)$/,
    "closing 198 afterwards does not make it the window this crossing closed");
});

test("THE PREFERENCE: the blessed commit's Window: trailer names 197, and the row is new at 197", () => {
  const { plan } = planFrom(lateRow(197), [], LATE);
  assert.deepEqual([plan[0].state, plan[0].window_id, plan[0].window_from], ["new", 197, "trailer"]);
});

test("the guard also holds a trailer naming a window the store lacks or has not closed; a row before the first window is never held", () => {
  assert.equal(planFrom(lateRow(999), [], LATE).plan[0].held, "window 999 is not in the store");
  assert.equal(planFrom(lateRow(198), [], LATE).plan[0].held, "window 198 is open, not closed");
  assert.equal(heldWindow({ window_id: null, published_at: "2026-07-28T20:08:58Z" }, LATE), null);
  const [s2] = planFrom(settlementRowsFrom([LIGHT_LINE]), [], LATE).plan;
  assert.deepEqual([s2.state, s2.window_id], ["new", null]);
});

test("the guard never touches a row already present: an old row on a window the time rule names is still `present`", () => {
  const d = lateRow();
  const { plan } = planFrom(d, [{ number: 72, tag_sha: d[0].tag_sha, published_at: d[0].published_at, window_id: 198, blessed_at: d[0].blessed_at }], LATE);
  assert.equal(plan[0].state, "present");
});

test("windowTrailer reads `Window: <id>` from the trailer block only — never the subject, and never two that disagree", () => {
  assert.equal(windowTrailer("settlement: sweep 4 published\n\nWindow: 312\n"), 312);
  assert.equal(windowTrailer("settlement: sweep 4 published\r\n\r\nWindow: 312\r\n"), 312, "CRLF");
  assert.equal(windowTrailer("settlement: sweep\n\nbody line\n\nCo-Authored-By: x <y>\nWindow: 7"), 7, "among other trailers");
  assert.equal(windowTrailer("Window: 312"), null, "a subject is never a trailer");
  assert.equal(windowTrailer("settlement: sweep\n\nWindow: 312\n\nmore prose"), null, "not in the last paragraph");
  assert.equal(windowTrailer("settlement: sweep\n\nWindow: 1\nWindow: 2"), null, "two that disagree name nothing");
  assert.equal(windowTrailer("settlement: sweep\n\nWindow: 5\nWindow: 5"), 5);
  assert.equal(windowTrailer("settlement: sweep\n\nWindow: soon"), null);
  assert.equal(windowTrailer(""), null);
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 · THE CALLER — the tick, pinned in text (Wright-ruled 2026-09-17, postmark#2897)
// ═════════════════════════════════════════════════════════════════════════════
//
// ⚑ A TEXT PIN, and the only instrument that can hold this — welcome-pass.test.mjs's
// own precedent: nothing in a unit test can observe a shell script's order. The
// ORDER is what the measurement fixed: the world fetch under the lock is what
// carries the keeper's tag in (a plain `git fetch --prune origin` re-follows an
// annotated tag on an already-present commit — S71 deleted locally, back as a
// `tag` object on the next plain fetch), so the backfill must sit AFTER that
// fetch. And OUTSIDE the lock, because the lock's hold is what the write path
// waits on and the tool reads refs and a Postgres, never the working tree.

import { readFileSync } from "node:fs";

const tick = () => readFileSync(new URL("../deploy/office-keep.sh", import.meta.url), "utf8");

test("the tick runs the backfill AFTER the world fetch and OUTSIDE the lock", () => {
  const sh = tick();
  const fetch = sh.indexOf('git -C "$WORLD_CLONE" fetch --prune -q origin');
  const unlock = sh.indexOf(') 9>>"$LOCK"');
  const run = sh.indexOf("world2/tools/settlements-backfill.mjs --apply");
  assert.ok(fetch !== -1 && unlock !== -1 && run !== -1, "the tick must carry all three: the world fetch, the lock's close, the backfill");
  assert.ok(fetch < run, "a backfill before the fetch reads yesterday's tags — the tag rides this fetch");
  assert.ok(unlock < run, "inside the lock the backfill's Postgres round-trip lengthens every write-path wait");
  // and office.db is built nowhere (POS-268 5b retired the rehydrate unit); the
  // world hydration that moved here runs after this receipt, so a slow one can
  // never hide or delay it
  assert.equal(sh.indexOf("node src/hydrate.mjs"), -1, "the keeping tick must not build office.db, which nothing reads any more");
  assert.ok(run < sh.indexOf("sh deploy/office-world-hydrate.sh"), "the world hydration runs after the settlements receipt");
});

test("the tick's backfill is the prod apply, quiet, on the clone the fetch moved", () => {
  const sh = tick();
  const line = sh.split(/\r?\n/).find((l) => l.includes("settlements-backfill.mjs --apply"));
  assert.ok(line, "no backfill line in the tick");
  assert.match(line, /--apply --prod --quiet/, "the tick types --prod on purpose (world2_dev is prod; the tool refuses the name otherwise) and --quiet for one receipt line");
  assert.match(line, /--world-repo "\$WORLD_CLONE"/, "the checkout is the tick's own WORLD_CLONE — the one the fetch above just moved");
  assert.match(line, /2>&1/, "a refusal's own words are captured into the receipt, not lost to a separate stream");
});

test("a refused or unreachable store cannot stop the tick's real work", () => {
  const sh = tick().split(/\r?\n/);
  const at = sh.findIndex((l) => l.includes("settlements-backfill.mjs --apply"));
  const around = sh.slice(at, at + 5).join("\n");
  assert.match(around, /^if settled=/m, "the run must be the condition of an `if`, never a bare command under `set -e`");
  assert.match(around, /NOT written \(non-fatal\)/, "the failure branch says so out loud and continues");
  assert.match(around, /\[office-keep\] settlements: \$settled/, "the success branch prints the tool's receipt line into the journal");
});
