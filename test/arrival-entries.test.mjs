// arrival-entries.test.mjs — a walk's enter_on_arrival is queued at the walk and
// made at arrival by the office's tick (WLD-5, POS-618; src/arrival-entries.mjs).
//
// RULED (Darko, 2026-10-14 10:20 EDT): "delaying the row on the ledger until
// they actually arrive at the thing, while still affording residents the
// convenience of being able to say: I want to enter at the time I arrive." And
// at 11:27: a pre-check that would not enter queues nothing (G2); the walker
// reads a pending entry and a refusal on their own standpoint (G3); any later
// departure overtakes the intent (G4).
//
// The tick is driven here with its store, its clock and its enter injected;
// test/arrival-entries-store.test.mjs drives the same SQL against a real store,
// and the pen's never-twice guard through the real crossing-exec.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ARRIVAL_DEFER_MS, ARRIVAL_OUTCOMES, arrivalLine, arrivalOutcome, arrivalTick, enterAtArrival, entryAtTheWalk,
  precheckVerdict, startArrivalTick, stopArrivalTick,
} from "../src/arrival-entries.mjs";
import { enterViaOffice } from "../src/world-crossings.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

// ── a store the tick can be driven against ──────────────────────────────────

function queue(rows, { priors = {} } = {}) {
  const settled = [];
  const query = async (text, params) => {
    if (/FROM arrival_entries\s+WHERE settled_at IS NULL AND due_at <= \$1/.test(text)) {
      const now = Date.parse(params[0]);
      const skip = new Set((params[2] ?? []).map(String));
      return rows.filter((r) => !r.settled && Date.parse(r.due_at) <= now && !skip.has(String(r.walk))).slice(0, params[1]);
    }
    // the re-run's read: an enter already carrying this walk's arrival_of
    if (/payload->>'arrival_of' = \$2/.test(text)) return priors[params[1]] ? [{ id: priors[params[1]] }] : [];
    if (/^\s*UPDATE arrival_entries/.test(text)) {
      const r = rows.find((x) => String(x.walk) === params[0] && !x.settled);
      if (!r) return [];
      r.settled = { outcome: params[1], enter_act_id: params[2], words: params[3] };
      settled.push({ walk: params[0], ...r.settled });
      return [{ walk: params[0] }];
    }
    throw new Error(`unexpected query: ${text.slice(0, 80)}`);
  };
  return { query, settled };
}
const row = (walk, extra = {}) => ({ walk: String(walk), handle: "ann", household: "ann-house", mark: "a/room",
  accept: false, into_mark: null, due_at: "2026-10-14T12:00:00.000Z", ...extra });
const NOW = Date.parse("2026-10-14T12:00:05.000Z");
const bounce = (code, defect, hint, extra = {}) => Object.assign(new Error(defect), { code, defect, hint, ...extra });

// ── AT ARRIVAL: the tick ─────────────────────────────────────────────────────

test("OVERTAKEN — a later departure replaces the intent: settled overtaken, nothing entered (Darko, G4)", async () => {
  const q = queue([row(10)]);
  let entered = 0;
  const r = await arrivalTick({ deferredIds: new Map(), now: NOW, query: q.query, current: async () => "11", arrival: async () => ({ arrived: true }),
    enter: async () => { entered += 1; return { answer: { entered: ["a/room"] }, seq: "1" }; } });
  assert.deepEqual(q.settled, [{ walk: "10", outcome: "overtaken", enter_act_id: null, words: null }]);
  assert.equal(entered, 0, "an overtaken intent never reaches the enter");
  assert.deepEqual(r.overtaken, ["10"]);
});

test("STILL WALKING — due by the clock but not arrived by the walk record: left for the next tick, nothing entered", async () => {
  const q = queue([row(10)]);
  let entered = 0;
  const r = await arrivalTick({ deferredIds: new Map(), now: NOW, query: q.query, current: async () => "10", arrival: async () => ({ arrived: false }),
    enter: async () => { entered += 1; } });
  assert.deepEqual(q.settled, []);
  assert.equal(entered, 0);
  assert.deepEqual(r.walking, ["10"]);
});

test("ENTERED — the walk stands and has arrived: the ordinary enter runs, and the row is settled with its act", async () => {
  const q = queue([row(10)]);
  const seen = [];
  await arrivalTick({ deferredIds: new Map(), now: NOW, query: q.query, current: async () => "10", arrival: async (r) => ({ arrived: true, target: { x: 1, y: 2 }, r }),
    enter: async (r, a) => { seen.push({ walk: r.walk, target: a.target }); return { answer: { entered: ["a/room"] }, seq: "77" }; } });
  assert.deepEqual(seen, [{ walk: "10", target: { x: 1, y: 2 } }]);
  assert.deepEqual(q.settled, [{ walk: "10", outcome: "entered", enter_act_id: "77", words: null }]);
});

test("REFUSED AT ARRIVAL — the mark's word changed on the way: settled refused in its own words, and nothing else is written", async () => {
  const q = queue([row(10)]);
  await arrivalTick({ deferredIds: new Map(), now: NOW, query: q.query, current: async () => "10", arrival: async () => ({ arrived: true }),
    enter: async () => { throw bounce(422, "a/room is opposed to you", "it answers everyone the same"); } });
  assert.deepEqual(q.settled, [{ walk: "10", outcome: "refused", enter_act_id: null, words: "a/room is opposed to you — it answers everyone the same" }]);
});

test("HELD — the pen busy or the store away: the row waits, and the next tick enters", async () => {
  const q = queue([row(10)]);
  let busy = true;
  const deferredIds = new Map();
  const deps = { deferredIds, now: NOW, query: q.query, current: async () => "10", arrival: async () => ({ arrived: true }),
    enter: async () => { if (busy) throw bounce(503, "the office pen is busy — other writes hold the town lock"); return { answer: { entered: ["a/room"] }, seq: "78" }; } };
  const first = await arrivalTick(deps);
  assert.deepEqual(q.settled, [], "a 503 is not a refusal");
  assert.equal(first.held.length, 1);
  busy = false;
  const soon = await arrivalTick({ ...deps, now: NOW + 10_000 });
  assert.equal(soon.due, 0, "a held row stands aside for a minute: the due probe skips it");
  await arrivalTick({ ...deps, now: NOW + ARRIVAL_DEFER_MS });
  assert.deepEqual(q.settled, [{ walk: "10", outcome: "entered", enter_act_id: "78", words: null }]);
});

test("A WORLD FREEZE HOLDS — the enter's freeze answer (a value, not a throw) waits for the next try, and never settles", async () => {
  const q = queue([row(10)]);
  const r = await arrivalTick({ deferredIds: new Map(), now: NOW, query: q.query, current: async () => "10", arrival: async () => ({ arrived: true }),
    enter: async () => ({ answer: { error: "bounce", code: 503, defect: "the world is frozen for the crossing", hint: "try again in a minute" }, seq: null }) });
  assert.deepEqual(q.settled, [], "a freeze is not a refusal");
  assert.equal(r.held.length, 1);
});

test("A RE-RUN AFTER A CRASH settles as the enter already written, for a mark and a portal alike, and never judges again", async () => {
  const q = queue([row(10), row(11, { handle: "bea", mark: "spire/doors-outside" })], { priors: { 10: "55", 11: "56" } });
  let entered = 0;
  await arrivalTick({ deferredIds: new Map(), now: NOW, query: q.query, current: async (h) => (h === "ann" ? "10" : "11"), arrival: async () => ({ arrived: true }),
    enter: async () => { entered += 1; throw bounce(409, "you are not at that portal ~22 m"); } });
  assert.equal(entered, 0, "the enter is never run again");
  assert.deepEqual(q.settled.map((s) => [s.walk, s.outcome, s.enter_act_id]), [["10", "entered", "55"], ["11", "entered", "56"]]);
});

test("HEAD-OF-LINE — rows that cannot be read stand aside and never starve the rows behind them, and expire a day after they fell due", async () => {
  // twenty-one rows: the oldest twenty have unreadable walk acts, the newest is an ordinary arrival
  const stuck = Array.from({ length: 20 }, (_, i) => row(100 + i, { handle: `h${i}`, due_at: "2026-10-14T10:00:00.000Z" }));
  const q = queue([...stuck, row(200, { handle: "zed", due_at: "2026-10-14T11:00:00.000Z" })]);
  const deferredIds = new Map();
  const deps = { deferredIds, query: q.query, current: async (h) => (h === "zed" ? "200" : String(100 + Number(h.slice(1)))),
    arrival: async (r) => (r.walk === "200" ? { arrived: true } : { arrived: false, why: "the walk act could not be read back" }),
    enter: async (r) => ({ answer: { entered: [r.mark] }, seq: "77" }) };
  await arrivalTick({ ...deps, now: NOW });
  assert.deepEqual(q.settled, [], "the first tick takes the twenty oldest, all unreadable");
  await arrivalTick({ ...deps, now: NOW + 10_000 });
  assert.deepEqual(q.settled.map((s) => s.walk), ["200"], "the next tick skips them and reaches the row behind");
  // a day after they fell due, each is settled expired, with the office's words
  await arrivalTick({ ...deps, deferredIds: new Map(), now: Date.parse("2026-10-15T10:00:01.000Z") });
  assert.equal(q.settled.filter((s) => s.outcome === "expired").length, 20);
  assert.match(q.settled.find((s) => s.outcome === "expired").words, /could not read this walk back/);
});

test("NEVER TWICE — a re-run whose enter the pen already holds is settled as that enter, not written again", async () => {
  const q = queue([row(10)]);
  await arrivalTick({ deferredIds: new Map(), now: NOW, query: q.query, current: async () => "10", arrival: async () => ({ arrived: true }),
    enter: async () => { throw bounce(409, "walk 10 was already entered on arrival, by act 55", "nothing was written a second time", { arrival_settled: "55" }); } });
  assert.deepEqual(q.settled, [{ walk: "10", outcome: "entered", enter_act_id: "55", words: null }]);
});

test("RESTART CATCH-UP — rows that fell due while the office was down are entered at the tick's first run, at boot", async () => {
  const q = queue([row(10, { due_at: "2026-10-14T09:00:00.000Z" }), row(11, { handle: "bea", due_at: "2026-10-14T10:30:00.000Z" })]);
  const calls = [];
  const tick = async () => { calls.push("tick"); return arrivalTick({ deferredIds: new Map(), now: NOW, query: q.query, current: async (h) => (h === "ann" ? "10" : "11"),
    arrival: async () => ({ arrived: true }), enter: async (r) => ({ answer: { entered: [r.mark] }, seq: `9${r.walk}` }) }); };
  try {
    assert.equal(startArrivalTick({ port: 4380, env: { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://x/y" }, log: {}, tick }), true);
    for (let i = 0; i < 50 && q.settled.length < 2; i++) await new Promise((ok) => setTimeout(ok, 10));
    assert.equal(calls.length, 1, "one run at boot, before the first interval");
    assert.deepEqual(q.settled.map((s) => [s.walk, s.outcome, s.enter_act_id]), [["10", "entered", "910"], ["11", "entered", "911"]]);
  } finally { stopArrivalTick(); }
});

test("THE TICK RUNS IN THE WRITER ONLY — never on port 0 (a suite's office), never off a store, never when the operator says off", () => {
  const store = { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://x/y" };
  const tick = async () => ({ due: 0 });
  try {
    assert.equal(startArrivalTick({ port: 0, env: store, log: {}, tick }), false, "port 0");
    assert.equal(startArrivalTick({ port: 4380, env: {}, log: {}, tick }), false, "no store");
    assert.equal(startArrivalTick({ port: 4380, env: { ...store, ARRIVAL_TICK: "off" }, log: {}, tick }), false, "the operator's off");
  } finally { stopArrivalTick(); }
});

test("[pin] the server starts the tick outside the read workers and the read role", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");
  assert.match(src, /if \(!IN_READ_WORKER && !READ_ONLY_ROLE\) import\("\.\/arrival-entries\.mjs"\)\.then\(\(m\) => m\.startArrivalTick\(\{ port: PORT \}\)\);/);
});

test("arrivalOutcome — every answer of the ordinary enter has one settle", () => {
  assert.deepEqual(arrivalOutcome({ answer: { entered: ["a"] }, seq: "5" }), { outcome: "entered", enterActId: "5" });
  assert.deepEqual(arrivalOutcome({ answer: { entered: [], already: true } }), { outcome: "already" });
  assert.equal(arrivalOutcome({ answer: { entered: [], awaiting: { terms: {} } } }).outcome, "refused", "a mark that now asks for terms is a refusal of the queued entry");
  assert.equal(arrivalOutcome({ answer: { entered: [], choose: [{ id: "x" }] } }).outcome, "refused");
  assert.deepEqual(arrivalOutcome({ answer: { entered: ["a"], refused: { mark: "a/b" }, stranded_at: "a/b" }, seq: "6" }),
    { outcome: "refused", enterActId: "6", words: "refused at a/b" }, "a chain refused part-way keeps the act it wrote");
  assert.equal(arrivalOutcome({ answer: { entered: [], crossed_nothing: "nothing" } }).outcome, "refused");
  assert.deepEqual(arrivalOutcome({ error: { name: "PenUnreachableError", message: "gone" } }), { held: "the office's record could not be reached" });
  const tripped = arrivalOutcome({ error: new Error("pg: relation does not exist") });
  assert.equal(tripped.outcome, "refused");
  assert.equal(tripped.words.includes("relation"), false, "a codeless error's own text never reaches the walker (POS-578)");
  for (const o of [{ answer: { entered: ["a"] } }, { answer: { already: true, entered: [] } }])
    assert.ok(ARRIVAL_OUTCOMES.includes(arrivalOutcome(o).outcome));
});

// ── AT THE WALK: the pre-check and the queue (G2) ────────────────────────────

const WALK = { who: "ann", key: { handles: new Set(["ann"]), household: "ann-house" }, mark: "a/room", target: { x: 5, y: 6 },
  arrivalCrossing: 250.5, dueAt: "2026-10-14T18:00:00.000Z", walkActId: "42", household: "ann-house" };

/** crossingDeps() as the office hands it, whose pen and walk hooks must never run in a pre-check. */
const officeDeps = () => ({
  marker: "office", now: (ms) => ms, nowMs: () => 0,
  standpointOf: async () => { throw new Error("the pre-check measured from the live standpoint"); },
  record: async () => { throw new Error("the pre-check WROTE"); },
  walking: async () => { throw new Error("the pre-check asked about the walk"); },
  stop: async () => { throw new Error("the pre-check stopped the walk"); },
  land: async () => { throw new Error("the pre-check set somebody down"); },
});

test("ON THE WAY, AND IT WOULD ENTER — the pre-check writes nothing and the intent is queued against the walk", async () => {
  const queued = [];
  let seen = null;
  const r = await entryAtTheWalk({ ...WALK, arrived: false }, {
    crossingDeps: officeDeps,
    enter: async (payload, key, deps) => {
      seen = { payload, standpoint: await deps.standpointOf("ann"), now: deps.now(), walking: deps.walking, stop: deps.stop, land: deps.land };
      await deps.record({ lines: ["x"] });   // the dry pen: answers, writes nothing
      return { entered: ["a/room"], within: [] };
    },
    queue: async (q) => { queued.push(q); return { queued: true }; },
  });
  assert.equal(r.queued, true);
  assert.deepEqual(seen.payload, { mark: "a/room", handle: "ann", accept: false });
  assert.deepEqual(seen.standpoint, { x: 5, y: 6, name: "ann" }, "judged from the walk's target");
  assert.equal(seen.now, 250.5, "at the arrival instant");
  assert.equal(seen.walking, null);
  assert.equal(seen.stop, null);
  assert.equal(seen.land, null, "and no landing pen: a pre-check sets nobody down");
  assert.deepEqual(queued, [{ walkActId: "42", handle: "ann", household: "ann-house", mark: "a/room", accept: false, into: null, dueAt: WALK.dueAt }]);
});

test("ON THE WAY, AND IT WOULD NOT — refused, asking for terms, asking which way: nothing queued, and the why names what to pass (Darko, G2)", async () => {
  const cases = [
    [async () => { throw bounce(422, "a/room is opposed to you"); }, /refuses you/],
    [async () => ({ entered: [], awaiting: { terms: { edge: "aboard" } }, terms: { edge: "aboard" } }), /accept: true/],
    [async () => ({ entered: [], choose: [{ id: "a/east" }, { id: "a/west" }] }), /into:/],
    [async () => ({ entered: [], already: true }), /already within/],
  ];
  for (const [enter, why] of cases) {
    let queued = 0;
    const r = await entryAtTheWalk({ ...WALK, arrived: false }, { crossingDeps: officeDeps, enter, queue: async () => { queued += 1; return { queued: true }; } });
    assert.equal(r.queued, false);
    assert.match(r.why, why);
    assert.equal(queued, 0, "nothing reaches the queue");
  }
});

test("ALREADY THERE — a zero-length leg enters now, by the ordinary enter with the office's own deps, and queues nothing", async () => {
  let deps = null, queued = 0;
  const r = await entryAtTheWalk({ ...WALK, arrived: true }, { crossingDeps: officeDeps,
    enter: async (p, k, d) => { deps = d; return { entered: ["a/room"], within: ["a/room"] }; },
    queue: async () => { queued += 1; return { queued: true }; } });
  assert.equal(deps.marker, "office", "the office's real deps, untouched");
  assert.equal(r.queued, null);
  assert.deepEqual(r.entry.entered, ["a/room"]);
  assert.equal(queued, 0);
});

test("a walk with no record to queue on says so, and the walk still stands", async () => {
  const { queueArrival } = await import("../src/arrival-entries.mjs");
  assert.deepEqual(await queueArrival({ walkActId: null, handle: "ann", mark: "a/room", dueAt: WALK.dueAt }),
    { queued: false, why: "this office kept no record of the walk to queue the entry on" });
});

test("precheckVerdict — only an answer that enters is queued", () => {
  assert.deepEqual(precheckVerdict({ entered: ["a"] }), { would: true });
  assert.equal(precheckVerdict({ entered: ["a"], refused: { mark: "b" }, stranded_at: "b" }).would, false, "a chain that stops part-way is not an entry");
  assert.equal(precheckVerdict({ entered: [], crossed_nothing: "x" }).would, false);
});

// ── ON THE WALKER'S OWN STANDPOINT (G3) ──────────────────────────────────────

test("the standpoint's line: pending names the mark and the arrival; a refusal names the words; anything else says nothing", () => {
  assert.deepEqual(arrivalLine({ mark: "a/room", due_at: new Date("2026-10-14T18:00:00Z"), settled_at: null }).enters_on_arrival.arrives_at, "2026-10-14T18:00:00.000Z");
  const refused = arrivalLine({ mark: "a/room", settled_at: new Date("2026-10-14T18:00:10Z"), outcome: "refused", words: "a/room is opposed to you" });
  assert.equal(refused.arrival.outcome, "refused");
  assert.equal(refused.arrival.words, "a/room is opposed to you");
  assert.deepEqual(arrivalLine({ mark: "a/room", settled_at: new Date(), outcome: "entered" }), {});
  assert.deepEqual(arrivalLine(undefined), {});
});

// ── THE TRANSCRIPT, ON THE CLONE'S OWN VERBS (#529's, made at arrival) ───────
//
// FOUND walking the Spire's shell (lane plumb-spire-ktable, 2026-10-13): a
// stranger walked to the vestibule's portal with `enter_on_arrival: true` and
// was entered but never set down at the landing, because the old composition
// passed `stop: null`. At arrival the tick runs the ordinary enter, so the
// portal's own landing is written in the same passage. The fixture is
// test/wld5-portals.test.mjs's ruled instance in miniature.

const CLONE = worldClone();
const HAVE = !!CLONE && existsSync(join(CLONE, "tools", "portals.mjs"));
const SKIP = !HAVE && (CLONE ? `the world clone at ${CLONE} predates WLD-5 (no tools/portals.mjs)` : NO_WORLD);
const grammarOf = async () => import(pathToFileURL(join(CLONE, "tools", "enter-exit.mjs")).href);

const SPIRE = "spire/the-spire";
const marks = () => [
  { id: "spire/grounds", kind: "sited", by: "spire", at: { x: 1000, y: 1000 }, extent: { w: 500, h: 400 }, body: "The open Grounds." },
  { id: "spire/forecourt", kind: "sited", by: "spire", at: { x: 800, y: 1000 }, extent: { w: 80, h: 120 }, body: "The Forecourt." },
  { id: SPIRE, kind: "sited", by: "spire", class: "dungeon", at: { x: 1000, y: 1000 }, extent: { w: 300, h: 300 }, body: "The Spire." },
  { id: "spire/vestibule", kind: "sited", by: "spire", at: { x: 880, y: 1000 }, extent: { w: 50, h: 50 }, body: "The vestibule." },
  { id: "spire/doors-outside", kind: "sited", by: "spire", at: { x: 838, y: 1000 }, extent: { w: 2, h: 2 }, body: "The Gilded Doors.",
    entry: { word: "welcomed", into: "spire/vestibule", lands_at: "spire/doors-inside" } },
  { id: "spire/doors-inside", kind: "sited", by: "spire", at: { x: 860, y: 1000 }, extent: { w: 2, h: 2 }, body: "From inside.",
    entry: { word: "neutral", into: "spire/forecourt", lands_at: "spire/doors-outside" } },
];
const OUTSIDE_FACE = { x: 838, y: 1000 };
const INSIDE_FACE = { x: 860, y: 1000 };
const T = Date.parse("2026-10-14T18:00:00.000Z");
const ferryOf = (ms) => (ms - Date.UTC(2026, 5, 12)) / (12 * 3600 * 1000);

/** crossingDeps() in miniature: the walker's live standpoint where the walk record
 *  published it (`published`), an arrived walk, an in-memory ledger, an observable pen and stop. */
async function officeAt({ published = OUTSIDE_FACE, ledger = "" } = {}) {
  const thresholds = await grammarOf();
  const worldState = { marks: marks() };
  let text = ledger;
  const stops = [], lands = [], records = [];
  return {
    stops, lands, records, text: () => text,
    base: {
      world: async () => worldState,
      ledger: async () => text,
      standpointOf: async (who) => ({ ...published, name: who }),
      acts: async () => [],
      nowMs: () => T,
      now: (ms = Date.now()) => ferryOf(ms),
      walking: async () => ({ live: false, x: published.x, y: published.y }),   // the walk has arrived
      record: async (payload) => {
        records.push(payload);
        text += payload.lines.join("\n") + "\n";
        const folded = thresholds.parseEnterExitLedger(text).acts;
        return { lines: payload.lines, within: thresholds.occupancyAt(folded, payload.at).get(payload.handle) ?? [], seq: 900 + records.length };
      },
      stop: async (who, to, k, opts = {}) => { stops.push({ who, to, from: opts.from ?? null }); },
      land: async (who, to, k, opts = {}) => { lands.push({ who, to, via: opts.via ?? null, why: opts.why ?? null }); },
    },
  };
}
const ROW = { walk: "4242", handle: "ann", household: "ann-house", mark: "spire/doors-outside", accept: false, into_mark: null };

test("THE TRANSCRIPT · at arrival on the Gilded Doors' outside face, the walker is entered and set down at the inside face, in one passage", { skip: SKIP }, async () => {
  const o = await officeAt();
  const { answer, seq } = await enterAtArrival(ROW, { arrived: true, target: OUTSIDE_FACE }, { base: o.base, enter: enterViaOffice, worldClone: CLONE });

  assert.deepEqual(answer.entered, [SPIRE, "spire/vestibule"], "the passage enters the dungeon and the room");
  assert.equal(o.records.length, 1, "one passage, written once");
  assert.equal(o.records[0].via, "spire/doors-outside");
  assert.equal(o.records[0].arrival_of, "4242", "the pen is told which walk this entry arrived with");
  assert.equal(seq, "901");
  // WLD-63 row 68: a LANDING (never a walk), a step in from the inside face: its 2×2 reaches x 861, so 862
  const STEPPED_IN = { x: 862, y: 1000 };
  assert.deepEqual(o.lands, [{ who: "ann", to: STEPPED_IN, via: "spire/doors-outside", why: "passage" }], "THE LANDING: set down a step in from the inside face, now");
  assert.deepEqual(o.stops, [], "and no walk is written");
  assert.deepEqual(answer.landed, { ...STEPPED_IN, mark: "spire/doors-inside", clamped: false, recorded: true, via: "spire/doors-outside" });
  assert.equal("walk_ended" in answer, false, "#2859 holds: the arrived walk is not stopped again");
});

test("ORDERING · the arrival's row is stamped at its own write: ferry and iso are one reading, never ahead of the rows before it", { skip: SKIP }, async () => {
  const { formatEnterExit, stampAt, parseEnterExitLedger } = await grammarOf();
  // a row written a minute earlier, by someone else
  const earlier = formatEnterExit({ handle: "bea", act: "enters", mark: "spire/forecourt", at: stampAt(ferryOf(T - 60_000)), word: "neutral", iso: new Date(T - 60_000).toISOString() });
  const o = await officeAt({ ledger: `${earlier}\n` });
  await enterAtArrival(ROW, { arrived: true, target: OUTSIDE_FACE }, { base: o.base, enter: enterViaOffice, worldClone: CLONE });
  const acts = parseEnterExitLedger(o.text()).acts;
  const mine = acts.filter((a) => a.handle === "ann");
  assert.ok(mine.length > 0);
  for (const a of mine) {
    assert.equal(a.at, stampAt(ferryOf(T)), "the ferry is the write's own instant, not the walk's");
    assert.ok(a.at >= acts[0].at, "never behind the row written before it");
  }
});

test("THE REACH AT ARRIVAL is the ordinary one, from where the walker really stands: an arrival at a mark smaller than the grid enters", { skip: SKIP }, async () => {
  // Before postmark-world#206 the engine published a rim arrival rounded to a
  // tenth of a metre, up to 0.05 m outside the mark (1,107 of 15,560 simulated
  // rim walks on world 17b64ef1, every walk to a mark smaller than the grid).
  // The tick measures the reach from the real position, so this holds only
  // because the engine's arrival now stands on its target's ground.
  const walk = await import(pathToFileURL(join(CLONE, "tools", "walk.mjs")).href);
  const BELL = { id: "spire/bell-register", kind: "sited", by: "spire", at: { x: 838.02, y: 1000.68 }, extent: { w: 0.02, h: 0.02 }, body: "A register entry." };
  const from = { x: 780, y: 1000 };
  const p = walk.positionAt({ from, toward: BELL.at, at: 300, targetExtent: { w: 0.02, h: 0.02 }, targetMarkId: BELL.id, pace: 60 }, 301);
  assert.equal(p.arrived, true);
  const o = await officeAt({ published: { x: p.x, y: p.y } });
  const w = await o.base.world();
  w.marks.push(BELL);
  const { answer } = await enterAtArrival({ ...ROW, mark: BELL.id }, { arrived: true }, { base: o.base, enter: enterViaOffice, worldClone: CLONE });
  assert.ok(answer.entered.includes(BELL.id), `entered at ${JSON.stringify({ x: p.x, y: p.y })}: ${JSON.stringify(answer.entered)}`);
});

test("[pin] the line rides the walker's own standpoint (every read) and their doorstep's world block, and nothing else (G3)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/world.mjs", import.meta.url), "utf8");
  assert.match(src, /const arrival = choice\.handle \? await \(await import\("\.\/arrival-entries\.mjs"\)\)\.arrivalLineFor\(choice\.handle\)\.catch\(\(\) => \(\{\}\)\) : \{\};\n  const out = \{ standpoint: \{ \.\.\.at, stance: choice\.stance, \.\.\.arrival \},/,
    "worldOrient: a spectator's glance (coords, no handle) carries nobody's line");
  const block = src.slice(src.indexOf("export async function worldBlockForHandle("), src.indexOf("async function doorstepTransportFor("));
  assert.match(block, /const arrival = await \(await import\("\.\/arrival-entries\.mjs"\)\)\.arrivalLineFor\(handle\)/);
  assert.equal(block.split("...(transport ? { transport } : {}), ...arrival };").length - 1, 2, "both of the doorstep block's answers carry it");
  assert.equal((src.match(/arrivalLineFor\(/g) ?? []).length, 2, "and no other reader of world.mjs");
});

// ── THE G4 RACE (review of #541, finding 1; its review-race.mjs, on the clone's verbs) ──
//
// The tick checks `current()`, then waits for the town lock. A V2 walk takes no
// lock, so walk B can reach the record inside that wait. Two fixes, each pinned:
// the tick passes `walking: null` (an arrived walk is never live, so it stops
// nobody), and the pen's guard refuses an entry whose walk is no longer the
// current departure (`arrival_overtaken`, settled overtaken, nothing written).

/** crossingDeps() in miniature, with walk B LIVE at the enter and a pen that asks the guard's question. */
async function officeWithWalkB({ stand, currentIs }) {
  const o = await officeAt({ published: stand });
  const base = { ...o.base, walking: async () => ({ live: true, x: stand.x, y: stand.y }) };
  const pen = o.base.record;
  base.record = async (p) => {
    if (p.arrival_of && currentIs() !== p.arrival_of)
      throw Object.assign(new Error("overtaken"), { code: 409, defect: `walk ${p.arrival_of} was overtaken by a later departure (act 11) before its entry was written`, arrival_overtaken: true });
    return pen(p);
  };
  return { o, base };
}

test("THE G4 RACE · walk B declared during the lock wait: the pen refuses, the row settles overtaken, and walk B is neither stopped nor landed over, for a mark and a portal", { skip: SKIP }, async () => {
  for (const [mark, stand] of [["spire/forecourt", { x: 790, y: 1000 }], ["spire/doors-outside", OUTSIDE_FACE]]) {
    const { o, base } = await officeWithWalkB({ stand, currentIs: () => "11" });   // walk B (act 11) is now current
    const q = queue([row(10, { mark })]);
    await arrivalTick({ deferredIds: new Map(), now: NOW, query: q.query,
      current: async () => "10",                      // the tick's own check ran before walk B existed
      arrival: async () => ({ arrived: true }),
      enter: (r, a) => enterAtArrival(r, a, { base, enter: enterViaOffice, worldClone: CLONE }) });
    assert.deepEqual(q.settled, [{ walk: "10", outcome: "overtaken", enter_act_id: null, words: null }], mark);
    assert.equal(o.records.length, 0, `${mark}: nothing written`);
    assert.deepEqual(o.stops, [], `${mark}: walk B is neither stopped nor landed over`);
    assert.deepEqual(o.lands, [], `${mark}: and no landing is written over it`);
  }
});

test("THE TICK NEVER STOPS A WALK · with walk B live and the pen allowing the entry, an ordinary arrival writes no stop (walking: null by construction)", { skip: SKIP }, async () => {
  const { o, base } = await officeWithWalkB({ stand: { x: 790, y: 1000 }, currentIs: () => ROW.walk });
  const { answer } = await enterAtArrival({ ...ROW, mark: "spire/forecourt" }, { arrived: true }, { base, enter: enterViaOffice, worldClone: CLONE });
  assert.ok(answer.entered.includes("spire/forecourt"));
  assert.deepEqual(o.stops, [], "no walk-ending stop from the tick");
  assert.equal("walk_ended" in answer, false);
});

test("THE PRE-CHECK NAMES ITS REFUSAL · reach ('the walk will not end within the mark's own ground') is never blamed on the mark's law", async () => {
  const reach = await entryAtTheWalk({ ...WALK, arrived: false }, { crossingDeps: officeDeps,
    enter: async () => { throw bounce(409, "you are not at that door — x stands ~4 m from where you stand", "walk to it", { walk: { to: { x: 1, y: 2 }, mark: "a/room" } }); },
    queue: async () => ({ queued: true }) });
  assert.match(reach.why, /will not end within the mark's own ground/);
  assert.doesNotMatch(reach.why, /law/);
  const law = await entryAtTheWalk({ ...WALK, arrived: false }, { crossingDeps: officeDeps,
    enter: async () => { throw bounce(422, "a/room is opposed to you"); }, queue: async () => ({ queued: true }) });
  assert.match(law.why, /refuses you as its law stands now/);
});

test("THE QUEUED RECEIPT says nothing in the present tense: aboard, exited, landed and a portal's next portals are withheld from the pre-check's answer", async () => {
  const { walkEntryReceipt } = await import("../src/world.mjs");
  const dry = { entered: ["the-town/the-post-office"], within: [], aboard: true, exited: ["a/b"], landed: { x: 1, y: 2 }, portals: [{ id: "spire/hall-door" }],
    ground: { mark: "x" }, walk_ended: {}, ledger: null, log: { seq: 1 }, terms: [{ edge: "aboard" }], chain: ["the-town/the-post-office"], into: "spire/vestibule" };
  for (const queued of [true, false]) {
    const { entry } = walkEntryReceipt(dry, { arrived: false, stop: "x", eta: 250, queued, why: "w" });
    for (const k of ["entered", "within", "aboard", "exited", "landed", "portals", "walk_ended", "ledger", "log"])
      assert.equal(k in entry, false, `${k} withheld (queued ${queued})`);
    assert.deepEqual(entry.terms, [{ edge: "aboard" }], "the terms are a fact at departure, and stay");
    assert.equal(entry.into, "spire/vestibule");
  }
});

test("THE POST OFFICE'S RULES STAY ON A QUEUED WALK — a terms answer's ground block (ruling 10) rides the receipt, queued or not (review of #541, R1)", async () => {
  const { walkEntryReceipt } = await import("../src/world.mjs");
  const terms = { edge: "aboard", body: "Mind the gap.", consequence: "you ride where she sails" };
  const ground = { mark: "the-town/the-post-office", class: "vehicle", rules: ["ride is yours to declare aboard"], lends: ["ride"] };
  const answer = { handle: "ann", entered: [], within: [], awaiting: { terms }, terms, ground, note: "nothing was recorded" };
  for (const queued of [true, false]) {
    const { entry } = walkEntryReceipt(answer, { arrived: false, stop: "the-town/the-post-office", eta: 250, queued, why: "this mark asks for your word" });
    assert.deepEqual(entry.ground, ground, `her rules are shown with her terms (queued ${queued})`);
    assert.deepEqual(entry.awaiting, { terms });
  }
});

test("A LATE ARRIVAL STANDS ASIDE — a row due five minutes ago and still not arrived by its own record is skipped, so it cannot starve the queue (review of #541, R2)", async () => {
  const late = Array.from({ length: 20 }, (_, i) => row(300 + i, { handle: `l${i}`, due_at: "2026-10-14T11:50:00.000Z" }));
  const q = queue([...late, row(400, { handle: "zed", due_at: "2026-10-14T11:59:00.000Z" })]);
  const deferredIds = new Map();
  const deps = { deferredIds, query: q.query, current: async (h) => (h === "zed" ? "400" : String(300 + Number(h.slice(1)))),
    arrival: async (r) => ({ arrived: r.walk === "400" }), enter: async (r) => ({ answer: { entered: [r.mark] }, seq: "88" }) };
  await arrivalTick({ ...deps, now: NOW });
  assert.equal(deferredIds.size, 20, "the twenty late rows stand aside");
  await arrivalTick({ ...deps, now: NOW + 10_000 });
  assert.deepEqual(q.settled.map((s) => s.walk), ["400"]);
  const early = queue([row(500, { due_at: "2026-10-14T12:00:04.000Z" })]);
  const ids = new Map();
  await arrivalTick({ deferredIds: ids, now: NOW, query: early.query, current: async () => "500", arrival: async () => ({ arrived: false }), enter: async () => { throw new Error("no"); } });
  assert.equal(ids.size, 0, "a row a second early is simply asked again next tick");
});

test("AN EXPIRY READS ON THE STANDPOINT like a refusal, until the walker's next act", () => {
  const e = arrivalLine({ mark: "a/room", settled_at: new Date("2026-10-15T10:00:01Z"), outcome: "expired", words: "the office could not read this walk back, so the entry was never made" });
  assert.equal(e.arrival.outcome, "expired");
  assert.match(e.arrival.note, /never made/);
});
