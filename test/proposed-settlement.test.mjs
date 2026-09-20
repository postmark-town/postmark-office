// proposed-settlement.test.mjs — the door predicts; the save still judges.
//                                    node --test test/proposed-settlement.test.mjs
//
// THE LAW (world repo, cite by id — the-town/<slug>, never the path):
//   the-town/the-forecast    a forecast is a reading of the next save, run through
//                            the judgment that will make it — derived at the asking,
//                            never stored, never canon.
//   the-town/the-save        the settlement is the canonical save; the past reads
//                            from the newest save and is never re-judged.
//   the-town/the-tenses      settled past, declared present, undeclared future.
//   the-town/the-disclosure  an answer given without its inputs must never wear the
//                            grammar of an answer that had them.
//
// THE ONE-DERIVATION RULE, and why this file exists. A crossing computes a mark's
// ✦weight in two steps the town and the world already own:
//     (town)   node tools/world-stake.mjs --escrow --json  > stakes.json
//     (world)  node tools/marks-fold.mjs  --stakes stakes.json
// The forecast is those same two steps run at read time against the CURRENT
// ledger instead of the one the last save froze. Nothing is re-implemented: the
// office hands the town's own derive rows to the world's own fold. The decisive
// falsifier below therefore does not check a number I chose — it runs the
// fixture's marks-fold CLI itself, the way the crossing does, and demands the
// door's `proposed` equal it. A re-implementation cannot pass it, because the
// fixture's judgment fans a child's weight up into its container: anything that
// answers with raw escrow answers 13 where the save will land 118.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";

const repo = mkdtempSync(join(tmpdir(), "postmark-proposed-world-"));
const town = mkdtempSync(join(tmpdir(), "postmark-proposed-town-"));
after(() => { for (const d of [repo, town]) { try { rmSync(d, { recursive: true, force: true, maxRetries: 5 }); } catch { /* litter */ } } });

const put = (root, path, text) => {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const mark = (by) => `---\nkind: sited\nby: ${by}\ntier: market\ndate: 2026-08-18\nat: { x: 0, y: 0 }\nextent: { w: 4, h: 4 }\n---\n\n${by}'s mark\n`;

// ── the fixture world: a container with a child that fans up into it ─────────
put(repo, "WORLD/marks/let-there-be-light/mark.md", mark("the-town"));
put(repo, "WORLD/marks/let-there-be-light/pando-peak/mark.md", mark("the-town"));
put(repo, "WORLD/marks/let-there-be-light/pando-peak/the-pando-peak/mark.md", mark("vermillion"));
put(repo, "WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));

// The last save. the-town/pando-peak carried ✦108: 8 of its own + 10 breadth +
// 90 fanning up from the child.
put(repo, "WORLD/world-state.json", JSON.stringify({
  tick: 7, dials: {}, parcels: [], determined: {}, vague: [], rivalries: [],
  portfolios: {}, terrain_weight: {}, errors: [],
  marks: [
    { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", tier: "constitution", stamps: 0, weight: 108 },
    { id: "the-town/pando-peak", by: "the-town", kind: "sited", tier: "market", stamps: 8, weight: 108 },
    { id: "vermillion/the-pando-peak", by: "vermillion", kind: "sited", tier: "market", stamps: 90, weight: 90 },
  ],
}, null, 2));

// A judgment with a fan-up term. Small, but NOT a sum of escrow — which is the
// whole point: a door that re-implements "add up the stakes" gets a different
// number and this fixture says so by name.
put(repo, "tools/marks-fold.mjs", `
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
function loadMarks(dir) {
  const out = [];
  (function walk(at, parent) {
    if (!existsSync(at)) return;
    const entries = readdirSync(at);
    let here = parent;
    if (entries.includes("mark.md")) {
      const text = readFileSync(join(at, "mark.md"), "utf8");
      const by = text.match(/^by:\\s*(.+)$/m)?.[1]?.trim();
      const rec = { by, id: by + "/" + basename(at), kind: "sited", tier: "market", parent, body: "" };
      out.push(rec); here = rec.id;
    }
    for (const e of entries) {
      const next = join(at, e);
      if (e !== "mark.md" && statSync(next).isDirectory()) walk(next, here);
    }
  })(dir, null);
  return out;
}
const marks = loadMarks(opt("--marks-dir", "WORLD/marks"));
const stakes = existsSync(opt("--stakes", "")) ? JSON.parse(readFileSync(opt("--stakes"), "utf8")) : [];
const own = new Map();
for (const s of stakes) own.set(s.mark, (own.get(s.mark) ?? 0) + (s.weight ?? s.n));
const kids = new Map();
for (const m of marks) if (m.parent) kids.set(m.parent, [...(kids.get(m.parent) ?? []), m.id]);
const weightOf = (id) => (own.get(id) ?? 0) + (kids.get(id) ?? []).reduce((n, c) => n + weightOf(c), 0);
console.log(JSON.stringify({
  tick: Number(opt("--tick", "0")), dials: {}, parcels: [], determined: {}, vague: [],
  rivalries: [], portfolios: {}, terrain_weight: {}, errors: [],
  marks: marks.map((m) => ({
    id: m.id, by: m.by, household: m.by, kind: m.kind, tier: m.tier, body: m.body,
    stamps: own.get(m.id) ?? 0, weight: weightOf(m.id),
  })),
}));
`);

const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "fixture world");

// ── the fixture town: the ledger, and the derive the crossing feeds the fold ──
//
// THE BOOK IS A FILE, NOT THE MODULE. First draft baked each book into the stub's
// source and rewrote the .mjs between reads — and ESM caches by URL, so the second
// `import()` would have handed back the FIRST book and the "changed book" falsifier
// would have gone red against correct code. It also mismodels the town: the real
// world-stake.mjs is stable on disk and re-reads its ledger on every call, which is
// exactly why a live read sees a stake laid a second ago. So the stub does that too.
const writeBook = (rows) => writeFileSync(join(town, "ledger.json"), JSON.stringify(rows));
put(town, "tools/world-stake.mjs", `
import { readFileSync } from "node:fs";
import { join } from "node:path";
const book = (repo) => JSON.parse(readFileSync(join(repo, "ledger.json"), "utf8"));
export function worldStakeState(repo) {
  return {
    positions: new Map(book(repo).map((r) => [r.mark + "|" + r.holder, r.n])),
    currentHouseholdOf: (h) => "house:" + h,
  };
}
export function markEscrow(repo, mark) {
  return book(repo).filter((r) => r.mark === mark).reduce((n, r) => n + r.n, 0);
}
export function deriveWorldMarkWeights(repo) {
  const rows = book(repo);
  const marks = [...new Set(rows.map((r) => r.mark))].map((mark) => ({
    mark,
    escrow: rows.filter((r) => r.mark === mark).reduce((n, r) => n + r.n, 0),
    households: new Set(rows.filter((r) => r.mark === mark).map((r) => r.holder)).size,
    weight: rows.filter((r) => r.mark === mark).reduce((n, r) => n + r.weight, 0),
  }));
  return { k: 5, source: "fixture", rows, marks };
}
export function retirementBlocked() { return { blocked: false, escrow: 0 }; }
`);

const PEAK = "the-town/pando-peak";
const CHILD = "vermillion/the-pando-peak";
// The settled book: exactly what the last save froze (8 own + 5 breadth on the
// peak; 90 on the child). Reading with this book must predict no change.
const SETTLED_BOOK = [
  { tick: 0, holder: "gael-renton", mark: PEAK, n: 8, weight: 13 },
  { tick: 0, holder: "vermillion", mark: CHILD, n: 90, weight: 95 },
];
// dot lays 5 more stamps on the peak this morning.
const PENDING_BOOK = [...SETTLED_BOOK, { tick: 0, holder: "dot", mark: PEAK, n: 5, weight: 10 }];

writeBook(PENDING_BOOK);
process.env.WORLD_CLONE = repo;
process.env.TOWN_CLONE = town;
const { worldStakeRead } = await import("../src/world-stake.mjs");
const { foldedStateAtRef } = await import("../src/world-branches.mjs");

// What the SETTLEMENT ITSELF answers for a book — its own two-step, run here the
// way the crossing runs it. Never a number this file chose.
function settlementAnswer(rows) {
  const stakesPath = join(tmpdir(), `proposed-stakes-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(stakesPath, JSON.stringify(rows));
  try {
    const out = execFileSync(process.execPath, [
      join(repo, "tools/marks-fold.mjs"),
      "--marks-dir", join(repo, "WORLD/marks"),
      "--terrain", join(repo, "WORLD/skeleton.json"),
      "--stakes", stakesPath, "--no-write", "--json",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(out).marks.find((m) => m.id === PEAK)?.weight ?? null;
  } finally { rmSync(stakesPath, { force: true }); }
}

const listing = (root) => {
  const out = [];
  (function walk(at) {
    for (const e of readdirSync(at)) {
      if (e === ".git") continue;
      const p = join(at, e);
      const s = statSync(p);
      if (s.isDirectory()) walk(p); else out.push(`${relative(root, p).replace(/\\/g, "/")}:${s.size}`);
    }
  })(root);
  return out.sort();
};

// ── 1. forecast correctness ─────────────────────────────────────────────────
test("FALSIFIER 1 — `proposed` equals what the settlement's own code produces on that book", async () => {
  writeBook(PENDING_BOOK);
  const answer = await worldStakeRead({ mark: PEAK });
  const settlement = settlementAnswer(PENDING_BOOK);
  assert.equal(settlement, 118, "fixture sanity: 13 + 10 of its own, 95 fanning up beneath it");
  assert.equal(answer.proposed?.weight, settlement,
    "the door must answer with the judgment's number, not one of its own");
  assert.notEqual(answer.proposed?.weight, answer.escrow,
    "raw escrow is a different quantity and must never be served as the forecast");
});

test("FALSIFIER 1b — the forecast moves with the book, still through the same judgment", async () => {
  writeBook([...PENDING_BOOK, { tick: 0, holder: "keith", mark: CHILD, n: 4, weight: 9 }]);
  const answer = await worldStakeRead({ mark: PEAK });
  assert.equal(answer.proposed?.weight, settlementAnswer([...PENDING_BOOK, { tick: 0, holder: "keith", mark: CHILD, n: 4, weight: 9 }]),
    "a stake on the CHILD moves the container's forecast — fan-up is the judgment's, not the door's");
});

// ── 2. the door only predicts ───────────────────────────────────────────────
test("FALSIFIER 2 — the settled reading is byte-identical with the forecast present and absent", async () => {
  // ONE book, read twice: once where the forecast can run, once where it cannot
  // reach a world clone at all. Everything the ledger answers must be the same
  // bytes both times — the door predicts beside the settled reading, never into
  // it (the-town/the-save: the past is never re-judged).
  //
  // The first draft of this compared two DIFFERENT books and called the honest
  // difference in `breadth.households` a regression. Holding the book fixed and
  // moving only the forecast's reachability is what isolates the variable.
  writeBook(PENDING_BOOK);
  const withForecast = await worldStakeRead({ mark: PEAK });

  const saved = process.env.WORLD_CLONE;
  process.env.WORLD_CLONE = join(tmpdir(), "postmark-proposed-no-world");
  rmSync(process.env.WORLD_CLONE, { recursive: true, force: true });
  let without;
  try {
    const { worldStakeRead: read } = await import(`../src/world-stake.mjs?noworld=${Date.now()}`);
    without = await read({ mark: PEAK });
  } finally { process.env.WORLD_CLONE = saved; }

  const settledFields = ({ proposed, ...rest }) => JSON.stringify(rest);
  assert.equal(settledFields(without), settledFields(withForecast),
    "the forecast adds a key and changes nothing else about the answer");
  assert.equal(typeof withForecast.proposed?.weight, "number", "the pending book produced a forecast");
  assert.equal(withForecast.proposed.weight, 118, "and it is the judgment's figure");
});

test("FALSIFIER 2b — taking a forecast never disturbs the settled fold or its cache", () => {
  const before = JSON.stringify(foldedStateAtRef(repo, "refs/heads/main"));
  const forecast = JSON.stringify(foldedStateAtRef(repo, "refs/heads/main", { stakes: PENDING_BOOK }));
  const after = JSON.stringify(foldedStateAtRef(repo, "refs/heads/main"));
  // Asserted FIRST, because without it this test passes on a build where the
  // stakes argument is silently ignored — the two folds would be identical and
  // "unchanged" would be true for free. A probe that cannot fail is not a proof.
  assert.notEqual(forecast, before, "the stakes argument must actually reach the fold");
  assert.equal(after, before, "the-town/the-save: the settled reading is never re-judged by a forecast");
});

// ── 3. derived, never stored ────────────────────────────────────────────────
test("FALSIFIER 3 — two reads across a changed book answer differently, with zero residue on disk", async () => {
  writeBook(PENDING_BOOK);
  const worldBefore = listing(repo);
  const first = await worldStakeRead({ mark: PEAK });
  const worldAfterFirst = listing(repo);

  writeBook([...PENDING_BOOK, { tick: 0, holder: "keith", mark: PEAK, n: 20, weight: 25 }]);
  const second = await worldStakeRead({ mark: PEAK });
  const worldAfterSecond = listing(repo);

  assert.notEqual(first.proposed?.weight, second.proposed?.weight,
    "a changed pending book must change the answer — a stored forecast would repeat itself");
  assert.deepEqual(worldAfterFirst, worldBefore, "the world clone gains no file from a forecast");
  assert.deepEqual(worldAfterSecond, worldBefore, "and none from the second either");
});

// ── 4. disclosure ───────────────────────────────────────────────────────────
test("FALSIFIER 4 — a no-delta read carries no `proposed` at all", async () => {
  writeBook(SETTLED_BOOK);
  const answer = await worldStakeRead({ mark: PEAK });
  assert.equal("proposed" in answer, false,
    "predicting no change is not news — the UI rule, held at the door so the viewer never has to guess");
});

test("FALSIFIER 4c — an EMPTY book against a weighted save discloses; it never predicts zero", async () => {
  // FOUND BY RUNNING IT, not by reading it. Pointed at the real world clone and a
  // town clone whose ledger the derive could not see, the door answered
  // `proposed: { weight: 0 }` against a settled ✦74 — i.e. "this mark loses
  // everything at the next crossing", stated with the full confidence of a
  // judgment. An empty derive is an ABSENT INPUT, not an answer
  // (the-town/the-disclosure), and the two are indistinguishable from here.
  //
  // Refusing on empty costs nothing real: a town that genuinely holds no stakes
  // has a save with no weight either, so there would be no delta to report.
  writeBook([]);
  const answer = await worldStakeRead({ mark: PEAK });
  assert.equal(typeof answer.proposed?.unavailable, "string",
    "an empty pending book is a book that could not be read");
  assert.equal(answer.proposed.weight, undefined, "and it must never be served as a forecast of nothing");
});

test("FALSIFIER 4b — an unreadable engine discloses, and fabricates nothing", async () => {
  writeBook(PENDING_BOOK);
  const gone = join(tmpdir(), "postmark-proposed-absent-world");
  rmSync(gone, { recursive: true, force: true });
  const saved = process.env.WORLD_CLONE;
  process.env.WORLD_CLONE = gone;
  try {
    const { worldStakeRead: read } = await import(`../src/world-stake.mjs?absent=${Date.now()}`);
    const answer = await read({ mark: PEAK });
    assert.equal(typeof answer.proposed?.unavailable, "string",
      "the-town/the-disclosure: refuse or disclose absent inputs, never quietly substitute");
    assert.equal(answer.proposed.weight, undefined, "no number is invented for an answer that had no inputs");
    assert.ok(answer.holders, "the settled half of the answer still stands");
  } finally { process.env.WORLD_CLONE = saved; }
});

// ── the chip's time ─────────────────────────────────────────────────────────
test("the forecast names the next Settlement — 06:00/18:00Z, the timer's own marks, never the mail ferry's crossing", async () => {
  const { nextSettlement } = await import("../src/world-forecast.mjs");
  // deploy/postmark-settlement.timer: OnCalendar 06:00 and 18:00 UTC. The office
  // already had a `nextCrossing` (write.mjs) and it is the MAIL ferry at 00:00Z
  // and 12:00Z — a different clock. Putting the ferry's time on a weight that
  // lands at the sweep would be a lie with a plausible shape.
  // 06:00/18:00Z since 2026-09-18 — the timer in this tree moved to the law's
  // marks on 2026-09-17 (POS-80) and this constant had not followed; see
  // world-forecast.mjs § SETTLEMENTS_UTC. The pins move with it, and the
  // timer file is read below so the two cannot part again unnoticed.
  assert.equal(nextSettlement(new Date("2026-08-18T04:00:00Z")), "2026-08-18T06:00:00.000Z");
  assert.equal(nextSettlement(new Date("2026-08-18T06:00:00Z")), "2026-08-18T18:00:00.000Z", "on the boundary the next one is the next one");
  assert.equal(nextSettlement(new Date("2026-08-18T23:59:00Z")), "2026-08-19T06:00:00.000Z", "and it rolls the day");
  const { readFileSync } = await import("node:fs");
  const timer = readFileSync(new URL("../deploy/postmark-settlement.timer", import.meta.url), "utf8");
  const marks = [...timer.matchAll(/^OnCalendar=\*-\*-\* (\d\d):(\d\d):00 UTC$/gm)].map((m) => [Number(m[1]), Number(m[2])]);
  const { SETTLEMENTS_UTC } = await import("../src/world-forecast.mjs");
  assert.deepEqual(marks, [...SETTLEMENTS_UTC], "the forecast's clock IS the timer's OnCalendar lines — a move in one without the other reds here");
});
