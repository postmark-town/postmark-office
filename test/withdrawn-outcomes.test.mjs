// withdrawn-outcomes.test.mjs — A WITHDRAWN MARK LEAVING CANON IS A CROSSING OUTCOME (POS-731).
//
//   node --test test/withdrawn-outcomes.test.mjs
//
// THE QUESTION. "What the last crossing decided" omitted a published mark its author
// withdrew leaving canon. The store records that retirement as a fact about the MARK,
// not about a claim (`marks.status = 'retired'`, `retired_cause = 'settlement-withdraw'`,
// `retired_window`), and records no instant. So the event is read from `marks`, dated
// by the SETTLEMENT the retired window opened for (`alerts.mjs § settlementOfWindow`,
// the derivation the mark-taken alert already holds for the same retire step), and
// placed on the ferry's crossing of that instant. The window id, the settlement
// number, an old claim's decision time and the withdrawal request's time are not the
// cursor, and every one of them is flipped below.
//
// TWO HALVES.
//   · PURE: `claimEffectsFrom` handed `marks` rows, so a flip needs no store: the
//     positive case and the four direct flips (cause, pre-retirement, cursor, scope).
//   · A REAL POSTGRES (test/helpers/embedded-store.mjs, the whole schema), where the
//     retirement is produced by the REAL writer, `retire-unpublished.mjs`, run as a
//     child under the `clearing_job` pen with a sweep that names the marks, so the
//     row the reader meets is the row the store really writes. The reads go through
//     the office's own seam (`__setPoolForTest`, an `office_api` connection), through
//     `readClaimEffects`, and then through every surface that shows the answer:
//     `marks.last_crossing` (household-read-v2 § marksBlock), `since:`'s `to_you`
//     (world-happened.mjs § toYou), the doorstep's `outcomes` (`doorstepRulings`) and
//     the house's `outcomes` (house-bundle.mjs § isoEvents, its one transform).
//
// All invented: marks, owners, windows and times are made up for this file.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";
import { claimEffectsFrom, readClaimEffects, doorstepRulings, unplacedWithdrawals, WITHDRAW_RETIRE_CAUSE } from "../src/claim-effects.mjs";
import { currentCrossing } from "../src/crossings.mjs";
import { marksBlock } from "../src/household-read-v2.mjs";
import { toYou } from "../src/world-happened.mjs";
import { __setPoolForTest } from "../src/world2-claims.mjs";
import { WITHDRAW_CAUSE } from "../world2/tools/retire-unpublished.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RETIRE = join(ROOT, "world2", "tools", "retire-unpublished.mjs");

// ── the clock of the fixture ────────────────────────────────────────────────
// A window opens at 05:45:40 / 17:45:40Z, and the settlement it opened for runs at
// 06:00 / 18:00Z (alerts.mjs § settlementOfWindow). This one opens at 17:45:40Z.
const WIN = 300;
const OPENED = Date.UTC(2026, 10, 13, 17, 45, 40);
const SETTLED = "2026-11-13T18:00:00.000Z";
const CROSS = currentCrossing(Date.parse(SETTLED));
const NOW_MS = Date.UTC(2026, 10, 13, 20, 0, 0);

const WROW = (over = {}) => ({ slug: "rei/the-garage", owner: "rei", retired_window: WIN, retired_cause: WITHDRAW_RETIRE_CAUSE, opens_at: new Date(OPENED), ...over });
const asking = (over = {}) => claimEffectsFrom({ rows: [], withdrawn: [WROW()], mineOwners: new Set(["rei"]), sinceCrossing: CROSS, nowCrossing: CROSS, ...over });
const WITHDRAWN = {
  kind: "mark-withdrawn", mark: "rei/the-garage", at: SETTLED, crossing: CROSS, window: WIN, yours: true, on_your_ground: false,
  summary: "rei/the-garage was withdrawn and left the world, retired at candle 300",
};

// ═══ PURE: the derivation, and the four flips ═══════════════════════════════

test("the constant is the writer's own: the cause the retire step writes is the cause this read asks for", () => {
  assert.equal(WITHDRAW_RETIRE_CAUSE, WITHDRAW_CAUSE);
  assert.equal(WITHDRAW_RETIRE_CAUSE, "settlement-withdraw");
});

test("POSITIVE: a withdrawn retirement of the house's own mark is one additive event, dated by its settlement", () => {
  assert.deepEqual(asking(), [WITHDRAWN]);
  assert.equal(new Date(WITHDRAWN.at).getUTCHours(), 18, "the settlement's instant (06:00 / 18:00Z), not the window's 17:45:40 opening");
  assert.equal(Object.keys(asking()[0]).sort().join(), "at,crossing,kind,mark,on_your_ground,summary,window,yours");
});

test("EXISTING EVENTS ARE UNCHANGED: kinds and shapes for the claim rows, with or without a withdrawn input", () => {
  const rows = [
    { slug: "rei/a", claimant: "rei", status: "locked", window_id: 299, submitted_at: "2026-11-13T05:00:00Z", decided_at: "2026-11-13T05:45:30Z", refusal_check: null },
    { slug: "rei/b", claimant: "rei", status: "pending", window_id: 300, submitted_at: "2026-11-13T09:00:00Z", decided_at: null, refusal_check: null },
  ];
  const base = { rows, sinceCrossing: CROSS - 2, nowCrossing: CROSS + 1, mine: (id, r) => r.claimant === "rei" };
  const without = claimEffectsFrom(base);
  assert.deepEqual(claimEffectsFrom({ ...base, withdrawn: [], mineOwners: new Set(["rei"]) }), without, "an empty withdrawn input changes nothing");
  assert.deepEqual(without.map((e) => e.kind).sort(), ["claim-locked", "claim-pending", "claim-pending"]);
  assert.deepEqual(Object.keys(without.find((e) => e.kind === "claim-locked")).sort(), ["at", "crossing", "kind", "mark", "on_your_ground", "summary", "window", "yours"]);
});

test("FLIP · CAUSE: any other retirement cause, or none, writes nothing", () => {
  for (const cause of ["settlement-unpublish", "marks-ingest", "settlement-withdrawn", "", null, undefined])
    assert.deepEqual(asking({ withdrawn: [WROW({ retired_cause: cause })] }), [], `retired_cause ${JSON.stringify(cause)}`);
  assert.deepEqual(asking({ withdrawn: [WROW({ retired_cause: WITHDRAW_CAUSE })] }), [WITHDRAWN], "control: the writer's own constant does");
});

test("FLIP · PRE-RETIREMENT: a mark that has not left canon, a draft withdrawal and a request are not this event", () => {
  // the reader asks for retired rows only; handed a standing one the pure function still writes nothing without a retirement window or cause
  assert.deepEqual(asking({ withdrawn: [WROW({ retired_cause: null, retired_window: null, opens_at: null })] }), [], "a standing mark carries no retirement");
  // a draft or retracted claim is the author's own compose space or request: it writes no withdrawn event
  const draft = { slug: "rei/the-sketch", claimant: "rei", status: "draft", window_id: WIN, submitted_at: "2026-11-13T09:00:00Z", decided_at: null };
  const retracted = { slug: "rei/the-sketch", claimant: "rei", status: "retracted", window_id: WIN, submitted_at: "2026-11-13T09:00:00Z", decided_at: "2026-11-13T09:30:00Z" };
  const ev = claimEffectsFrom({ rows: [draft, retracted], withdrawn: [], mineOwners: new Set(["rei"]), mine: () => true, sinceCrossing: CROSS - 2, nowCrossing: CROSS + 1 });
  assert.equal(ev.filter((e) => e.kind === "mark-withdrawn").length, 0);
  assert.deepEqual(ev.map((e) => e.kind), ["claim-pending"], "(the retracted row's own submission is the only event, as before)");
});

test("FLIP · CURSOR: the crossing of the settlement the window opened for, inside since..now, and nothing else is the cursor", () => {
  assert.deepEqual(asking({ sinceCrossing: CROSS, nowCrossing: CROSS }), [WITHDRAWN], "at the boundary, both ends");
  assert.deepEqual(asking({ sinceCrossing: CROSS + 1, nowCrossing: CROSS + 2 }), [], "since after the crossing");
  assert.deepEqual(asking({ sinceCrossing: CROSS - 3, nowCrossing: CROSS - 1 }), [], "now before the crossing");
  // the window id is not the cursor: a window whose NUMBER equals the crossing, opened long before, is outside
  assert.deepEqual(asking({ withdrawn: [WROW({ retired_window: CROSS, opens_at: new Date(OPENED - 10 * 86400e3) })] }), [], "window id == crossing number, opened ten days earlier");
  // and a window with a huge number, opened inside the range, is inside
  assert.equal(asking({ withdrawn: [WROW({ retired_window: 999999 })] })[0].crossing, CROSS, "the cursor comes from the opening, not the id");
  assert.equal(asking({ withdrawn: [WROW({ retired_window: 999999 })] })[0].window, 999999, "(and the window field is the retired_window, whatever its size)");
  // the settlement's crossing, not the opening's: a window that opens at 11:50Z names the 18:00Z settlement, whose crossing is the 12:00Z one
  const early = Date.UTC(2026, 10, 13, 11, 50, 0);
  assert.notEqual(currentCrossing(early), CROSS, "control: the opening is in the crossing before");
  assert.equal(asking({ withdrawn: [WROW({ opens_at: new Date(early) })] })[0].crossing, CROSS);
  assert.deepEqual(asking({ withdrawn: [WROW({ opens_at: new Date(early) })], sinceCrossing: currentCrossing(early), nowCrossing: currentCrossing(early) }), [], "so the opening's own crossing does not hold it");
});

test("FLIP · SCOPE: the mark's OWNER is the scope; a stranger's, a slug prefix alone and the ground do not make it the house's", () => {
  assert.deepEqual(asking({ mineOwners: new Set(["sable"]) }), [], "an unrelated house");
  assert.equal(asking({ mineOwners: new Set(["rei", "ash"]), withdrawn: [WROW({ slug: "ash/the-hook", owner: "ash" })] }).length, 1, "a housemate's, when the house names them");
  assert.deepEqual(asking({ withdrawn: [WROW({ slug: "rei/the-borrowed", owner: "sable" })] }), [], "a slug prefix of mine on a mark another owner holds");
  assert.deepEqual(asking({ withdrawn: [WROW({ slug: "rei/the-borrowed", owner: "sable" })], mine: () => true }), [], "even where the claim predicate would say mine");
  assert.equal(asking({ withdrawn: [WROW({ slug: "sable/their-mark", owner: "rei" })] }).length, 1, "the owner is the fact: a mark I own under another's prefix is mine");
  // the ground axis is not extended to it: a retired mark's ground is history this read does not rebuild
  assert.deepEqual(asking({ mineOwners: new Set(["sable"]), onMyGround: new Set(["rei/the-garage"]) }), [], "laid over ground the caller holds");
});

test("UNDATABLE: a retirement whose window the store cannot date writes no event and is named, never dropped silently", () => {
  assert.deepEqual(asking({ withdrawn: [WROW({ opens_at: null })] }), []);
  assert.deepEqual(unplacedWithdrawals([WROW({ opens_at: null }), WROW({ slug: "rei/ok" }), WROW({ slug: "rei/x", opens_at: null, retired_cause: "settlement-unpublish" })]), ["rei/the-garage"]);
});

// ═══ A REAL POSTGRES: the writer's own rows, and the whole shared path ═══════

const store = await startStore({ db: "withdrawn_outcomes_test" });
after(() => store.stop());
const skip = store.skip ?? false;
const scratch = mkdtempSync(join(tmpdir(), "withdrawn-outcomes-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
after(() => { __setPoolForTest(null); for (const k of ["WORLD2_PG", "WORLD2_PG_URL"]) delete process.env[k]; });

const IDS = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BOX = "((4000,4000),(4004,4004))";
async function owner(fn) {
  const c = await store.connect("world2_owner");
  try { return await fn(c); } finally { await c.end(); }
}
const read = (sql, args = []) => owner(async (c) => (await c.query(sql, args)).rows);

const MARKS = [
  [1, "rei/the-garage", "rei"],       // withdrawn: retired by the writer's withdraw door
  [2, "rei/the-lamp", "rei"],         // retired by the sweep's UNPUBLISH door
  [3, "rei/the-bench", "rei"],        // still standing, with a request pending on the docket
  [4, "ash/the-hook", "ash"],         // a housemate's, withdrawn
  [5, "sable/the-kite", "sable"],     // another house's, withdrawn
  [6, "rei/the-borrowed", "sable"],   // a slug prefix of rei's on a mark sable owns, withdrawn
];
async function seed() {
  await owner(async (c) => {
    await c.query("TRUNCATE escrow_projection, claims, marks, windows, projection_heads, households, household_pins CASCADE");
    for (const id of [WIN - 1, WIN]) {
      const opens = new Date(OPENED + (id - WIN) * 12 * 3600e3).toISOString();
      await c.query(`INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4)`,
        [id, opens, id === WIN ? "open" : "closed", id === WIN ? null : opens]);
    }
    // the town's roll, which the retire step's draft-return reads for the unpublished lamp (as test/taken-to-drafts.test.mjs seeds it)
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now())", ["l".repeat(40), "t".repeat(40)]);
    await c.query(`INSERT INTO households (slug, ord, name, residents, since, declared_by, accounts)
                   VALUES ('starforge', 0, 'Starforge', ARRAY['rei','ash'], '2026-08-01', 'rei', '[{"id": 201, "login": "rei"}]'),
                          ('rabbit', 1, 'Rabbit', ARRAY['sable'], '2026-08-01', 'sable', '[]')`);
    await c.query(`INSERT INTO household_pins (handle, login, gh_id, pinned)
                   VALUES ('rei', 'rei', 201, '2026-08-01'), ('ash', 'ash', 202, '2026-08-01'), ('sable', 'sable', 204, '2026-08-01')`);
    for (const [n, slug, who] of MARKS) {
      await c.query(`INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
                     VALUES ($1, $2, 'sited', $3, $4, $5, $6, $7::box, 'standing', $8, '{}')`,
        [IDS(n), slug, who, who === "sable" ? "hh:rabbit" : "hh:starforge", `${slug}, as it stood.`, JSON.stringify({ at: { x: 4002 + n * 10, y: 4002 }, extent: { w: 4, h: 4 } }), BOX.replace("4000", String(4000 + n * 10)).replace("4004", String(4004 + n * 10)), WIN - 1]);
    }
    // the request, not the retirement: a pending claim on the standing bench; and a locked claim decided in the same crossing
    await c.query(`INSERT INTO claims (id, window_id, class, claimant, household, status, submitted_at, decided_at, body, geometry, bbox, stake, data, slug)
                   VALUES ($1, $2, 'sited', 'rei', 'hh:rei', 'pending', $3, NULL, 'the bench, again', $4, $5::box, 0, '{}', 'rei/the-bench'),
                          ($6, $7, 'sited', 'rei', 'hh:rei', 'locked', $8, $9, 'a new mark', $4, $5::box, 1, '{}', 'rei/a-new-mark')`,
      [IDS(11), WIN, "2026-11-13T17:50:00Z", JSON.stringify({ at: { x: 4100, y: 4100 }, extent: { w: 2, h: 2 } }), "((4099,4099),(4101,4101))",
        IDS(12), WIN - 1, "2026-11-13T05:00:00Z", "2026-11-13T17:45:30Z"]);
  });
}
function retire({ withdrawn = [], unpublished = [] }) {
  const sweep = join(scratch, `sweep-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(sweep, JSON.stringify({ unpublished: unpublished.map((id) => ({ id })), withdrawn: withdrawn.map((id) => ({ id })) }));
  const r = spawnSync(process.execPath, [RETIRE, "--sweep", sweep], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

// the office reading its own store, as the doors do: the `office_api` pen, no household key
async function officeReads(fn, { breakMarks = false, marksRows = null, spy = null } = {}) {
  const c = await store.connect("office_api");
  process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL = store.url("office_api");
  __setPoolForTest({ query: async (text, args) => {
    spy?.(text);
    if (breakMarks && /FROM marks m/.test(text)) throw new Error("connection to the marks table was lost");
    const out = await c.query(text, args);
    // the retirement read's rows, handed to a function that damages them (an undated window); the docket's are never touched
    return marksRows && /FROM marks m/.test(text) ? { ...out, rows: marksRows(out.rows) } : out;
  } });
  try { return await fn(); } finally { __setPoolForTest(null); await c.end(); }
}
const effectsFor = (handles, over = {}) => readClaimEffects({ handles, sinceCrossing: CROSS - 1, nowCrossing: CROSS + 1, ...over });
const slugsOf = (r, kind = "mark-withdrawn") => r.events.filter((e) => e.kind === kind).map((e) => e.mark).sort();

test("THE WRITER'S ROWS: only the withdraw door's retirement, of the house's own marks, reads as the event, with the cause the store recorded", { skip }, async () => {
  await seed();
  const run = retire({ withdrawn: ["rei/the-garage", "ash/the-hook", "sable/the-kite", "rei/the-borrowed"], unpublished: ["rei/the-lamp"] });
  assert.deepEqual(run.withdrawn.retired.map((r) => r.slug).sort(), ["ash/the-hook", "rei/the-borrowed", "rei/the-garage", "sable/the-kite"]);
  assert.deepEqual(await read("SELECT slug, status, retired_window, retired_cause FROM marks WHERE status = 'retired' ORDER BY slug"), [
    { slug: "ash/the-hook", status: "retired", retired_window: WIN, retired_cause: "settlement-withdraw" },
    { slug: "rei/the-borrowed", status: "retired", retired_window: WIN, retired_cause: "settlement-withdraw" },
    { slug: "rei/the-garage", status: "retired", retired_window: WIN, retired_cause: "settlement-withdraw" },
    { slug: "rei/the-lamp", status: "retired", retired_window: WIN, retired_cause: "settlement-unpublish" },
    { slug: "sable/the-kite", status: "retired", retired_window: WIN, retired_cause: "settlement-withdraw" },
  ], "the fixture is what the real writer recorded (the lamp left by the other door; the bench still stands)");
  await officeReads(async () => {
    const rei = await effectsFor(["rei"]);
    assert.equal(rei.readable, true);
    assert.deepEqual(slugsOf(rei), ["rei/the-garage"], "the house's own withdrawn mark: not the unpublished lamp, not the standing bench with its request, not the stranger's, not the other owner's prefix");
    assert.deepEqual(rei.events.find((e) => e.kind === "mark-withdrawn"), WITHDRAWN, "the exact additive event the store's row yields");
    assert.deepEqual(slugsOf(await effectsFor(["rei", "ash"])), ["ash/the-hook", "rei/the-garage"], "a housemate's, when the house names them");
    assert.deepEqual(slugsOf(await effectsFor(["sable"])), ["rei/the-borrowed", "sable/the-kite"], "the owner's, whatever the slug's prefix");
    assert.deepEqual(slugsOf(await effectsFor(["nobody"])), [], "an unrelated house");
  });
});

test("THE CURSOR, through the store: the settlement's crossing holds it; an older retirement is outside a newer window", { skip }, async () => {
  await seed();
  retire({ withdrawn: ["rei/the-garage"] });
  // an older retirement (the retire-only completion after an earlier crossing), written by the owner as the writer would at WIN - 1
  await owner((c) => c.query("UPDATE marks SET status = 'retired', retired_window = $1, retired_cause = 'settlement-withdraw' WHERE slug = 'rei/the-bench'", [WIN - 1]));
  await officeReads(async () => {
    const both = await effectsFor(["rei"], { sinceCrossing: CROSS - 2, nowCrossing: CROSS + 1 });
    assert.deepEqual(slugsOf(both), ["rei/the-bench", "rei/the-garage"]);
    const older = both.events.find((e) => e.mark === "rei/the-bench");
    assert.equal(older.window, WIN - 1);
    assert.equal(older.crossing, CROSS - 1, "the earlier window names the earlier settlement, and its crossing");
    assert.deepEqual(slugsOf(await effectsFor(["rei"], { sinceCrossing: CROSS, nowCrossing: CROSS })), ["rei/the-garage"], "a window that only reaches back to this crossing");
    assert.deepEqual(slugsOf(await effectsFor(["rei"], { sinceCrossing: CROSS + 1, nowCrossing: CROSS + 3 })), [], "a window after it");
  });
});

test("UNREADABLE: a store that answered the docket and not the marks cannot say 'nothing was withdrawn'", { skip }, async () => {
  await seed();
  retire({ withdrawn: ["rei/the-garage"] });
  await officeReads(async () => {
    const r = await effectsFor(["rei"]);
    assert.equal(r.readable, false, "not a confident empty complete answer");
    assert.match(r.reason, /retirements of your withdrawn marks could not be read/);
    assert.equal(r.missing, "your withdrawn marks' retirements");
    assert.ok(r.events.some((e) => e.kind === "claim-locked"), "the claim events it did read stay");
    assert.equal(r.events.filter((e) => e.kind === "mark-withdrawn").length, 0);
    const t = toYou({ claimEffects: r, sinceCrossing: CROSS - 1, nowCrossing: CROSS + 1 });
    assert.equal(t.complete, false, "to_you's completeness follows");
    assert.deepEqual(t.missing, ["your withdrawn marks' retirements"]);
    assert.match(t.note, /INCOMPLETE/);
    const door = await doorstepRulings("rei", { nowMs: NOW_MS });
    assert.match(door.unavailable, /retirements of your withdrawn marks could not be read/, "the doorstep says so, never an empty page");
  }, { breakMarks: true });
});

test("UNDATED: a retirement whose window the store cannot date is named, with the rest of the answer kept", { skip }, async () => {
  await seed();
  retire({ withdrawn: ["rei/the-garage"] });
  // the foreign key makes a missing window a defect, not a state, so the damage is made on the rows the office is handed
  await officeReads(async () => {
    const r = await effectsFor(["rei"]);
    assert.equal(r.readable, false);
    assert.match(r.reason, /1 withdrawn mark of yours \(rei\/the-garage\) left the world at a window the store does not date, so it cannot be placed on a crossing/);
    assert.equal(r.events.filter((e) => e.kind === "mark-withdrawn").length, 0, "no event is invented for it");
    assert.ok(r.events.some((e) => e.kind === "claim-locked"), "and the claim events stay");
  }, { marksRows: (rows) => rows.map((x) => ({ ...x, opens_at: null })) });
});

test("NO SILENT CUT: the retirement read has no row cap, and 510 withdrawn marks of one owner all come back", { skip }, async () => {
  await seed();
  await owner((c) => c.query(
    `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, retired_window, retired_cause, data)
     SELECT ('e0000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'rei/many-' || g, 'sited', 'rei', 'hh:starforge', 'one of many', '{"at":{"x":1,"y":1},"extent":{"w":1,"h":1}}'::jsonb,
            box(point(g * 10, 0), point(g * 10 + 1, 1)), 'retired', $1, $2, 'settlement-withdraw', '{}'
       FROM generate_series(1, 510) g`, [WIN - 1, WIN]));
  const sqls = [];
  await officeReads(async () => {
    const r = await effectsFor(["rei"]);
    assert.equal(r.readable, true);
    assert.equal(slugsOf(r).length, 510, "none cut past 500: the newest are not the ones dropped");
  }, { spy: (text) => sqls.push(text) });
  const marksSql = sqls.filter((t) => /FROM marks m LEFT JOIN windows w/.test(t));
  assert.equal(marksSql.length, 1, "the retirement query was asked once");
  assert.doesNotMatch(marksSql[0], /\bLIMIT\b/i, "and it carries no row cap, as claimRowsSince beside it carries none");
});

test("THE WORDS: the outcomes description and to_you's note both say latest-state, a scheduled date and the late-run limit, and the bound claim sentence is whole", { skip }, async () => {
  const { HOUSEHOLD_READS } = await import("../src/household-apex.mjs");
  const said = (s) => {
    assert.match(s, /latest state, not a history \(a withdrawal later undone is not kept\)/, "latest state, not durable history");
    assert.match(s, /dated by its window's scheduled settlement, not a retirement instant/, "a scheduled date, not a recorded instant");
    assert.match(s, /a settlement run that finishes after the next crossing is dated a crossing early/, "the late-run cursor limit");
  };
  said(HOUSEHOLD_READS.outcomes);
  assert.match(HOUSEHOLD_READS.outcomes, /A refusal names its cause in the bulletin's own words\./, "the description's earlier sentences stand");
  const whole = toYou({ claimEffects: { readable: true, events: [] }, sinceCrossing: CROSS - 1, nowCrossing: CROSS + 1 });
  said(whole.note);
  assert.match(whole.note, /every claim effect on your marks and on your ground rides here too/, "the bound claim-effect sentence, contiguous (test/since-claim-effects.test.mjs binds it)");
  assert.ok(whole.note.indexOf("every claim effect on your marks and on your ground rides here too") < whole.note.indexOf("latest state"), "the qualification is appended after it, not spliced into it");
  const unread = toYou({ claimEffects: { readable: false, events: [], reason: "x", missing: "y" }, sinceCrossing: CROSS - 1, nowCrossing: CROSS + 1 });
  assert.match(unread.note, /^INCOMPLETE — x\./, "an incomplete answer keeps its own sentence");
});

test("THE WHOLE SHARED PATH: the house line, to_you, the doorstep and the house's outcomes agree on the event and its cursor", { skip }, async () => {
  await seed();
  retire({ withdrawn: ["rei/the-garage"] });
  await officeReads(async () => {
    const effects = await effectsFor(["rei"]);
    const event = effects.events.find((e) => e.kind === "mark-withdrawn");
    assert.deepEqual(event, WITHDRAWN);

    // marks.last_crossing: the withdrawn mark rides the crossing's line, counted apart from "published"
    const block = marksBlock({ counts: { standing: 1 }, effects: effects.events });
    assert.equal(block.last_crossing, `crossing ${CROSS}: 1 published · 1 withdrawn (rei/the-garage)`);
    assert.equal(marksBlock({ counts: { standing: 1 }, effects: effects.events.filter((e) => e.kind !== "mark-withdrawn") }).last_crossing, `crossing ${CROSS}: 1 published`, "flip: without the event the line is the old one");
    assert.equal(marksBlock({ counts: { standing: 1 }, effects: null }).unread?.includes("last_crossing"), true, "unreadable is still said");

    // since: to_you
    const t = toYou({ claimEffects: effects, sinceCrossing: CROSS - 1, nowCrossing: CROSS + 1 });
    assert.equal(t.complete, true);
    assert.deepEqual(t.events.filter((e) => e.kind === "mark-withdrawn"), [WITHDRAWN]);

    // the doorstep's outcomes segment
    const door = await doorstepRulings("rei", { nowMs: NOW_MS });
    assert.equal(door.through_crossing, CROSS);
    assert.ok(door.since_crossing <= CROSS);
    assert.deepEqual(door.events.filter((e) => e.kind === "mark-withdrawn"), [WITHDRAWN], "the same event, the same cursor");
    assert.equal(door.note, undefined, "the quiet-morning sentence does not ride a morning with something to say");
    assert.ok(door.read_the_rest);

    // the house's outcomes: its one transform is isoEvents, which keeps every field
    const { isoEvents } = await import("../src/house-bundle.mjs");
    assert.deepEqual(isoEvents(effects.events).find((e) => e.kind === "mark-withdrawn"), WITHDRAWN);
  });
});
