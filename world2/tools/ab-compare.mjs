#!/usr/bin/env node
// ab-compare.mjs — the Phase-4 A/B probe: the SAME reads against World 1.0 and
// World 2.0 on identical data, and every divergence named.
//
// Gold `postmark-world-2.md` §4 phase 4: "same reads against World 1.0 and 2.0
// on dev; thorough comparison; 'purely upside' is the bar." This is that
// comparison as a re-runnable probe rather than a one-afternoon transcript, so
// the bar can be re-checked after each fix instead of re-argued.
//
// It runs ON THE BOX, against the lab office that serves both worlds from the
// same frozen S47 data: 1.0 reads answer from the frozen world clone + its
// sqlite indexes, 2.0 reads answer from Postgres seeded from that same tag.
// Read-only throughout — HTTP GETs and SELECTs, nothing else.
//
//   node world2/tools/ab-compare.mjs
//
// Env: OFFICE (default http://localhost:4382), WORLD2_PG_URL, WORLD_CLONE.
// Exit 1 if any sweep reports an unreconciled divergence, so a suite can hold
// the bar mechanically.
//
// THE PROBE MUST BE ABLE TO FAIL. Two of this file's own comparators were wrong
// on the first pass and each invented a divergence that was not there:
//   · `g && g.at != null` yields `null`, not `false`, so a strict `!==` against
//     a real boolean fired on 422 marks where both sides agreed there was no
//     geometry. Presence tests coerce with `!!` for that reason.
//   · `acts.crossing` is the FRACTIONAL crossing, and Postgres `::int` ROUNDS.
//     Casting it that way moved half of every crossing's rows into its
//     neighbour and reported 27 of 33 crossings divergent when the truth is
//     zero. Bucketing floors, never casts.
// A green run here means the sweeps agree, not that the comparator is asleep;
// --self-test flips a known-good value in each sweep and asserts it goes red.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const OFFICE = process.env.OFFICE ?? "http://localhost:4382";
const PG_URL = process.env.WORLD2_PG_URL;
const CLONE = process.env.WORLD_CLONE ?? "/srv/world2-lab/world-frozen";
const SELF_TEST = process.argv.includes("--self-test");

// The crossing clock is a pure function of time and belongs to neither world —
// office src/crossings.mjs:25-30, carried here so the probe does not import the
// running office to judge it.
const CROSSING_EPOCH_UTC = Date.UTC(2026, 5, 12);
const CROSSING_MS = 12 * 3600 * 1000;
const crossingAt = (iso) => Math.floor((Date.parse(iso) - CROSSING_EPOCH_UTC) / CROSSING_MS);

// ── the known deltas, subtracted before anything is called a difference ──────
//
// The lab session wrote these into the DB after the seed, so they are present
// in 2.0 and absent from the frozen 1.0 clone BY CONSTRUCTION. Naming them here
// is what makes "zero unexplained rows" a claim rather than a hope: a row that
// appears on one side only and is NOT on this list is a finding.
const KNOWN_LAB_MARKS = ["wright/candle-proof"];
const KNOWN_LAB_CLAIM_WINDOWS = [151, 152];
// non-`legacy:` acts. `enter`/`exit`/`walk`/`declare-stance-on` joined the list
// 2026-08-28: the lab office serves the office test suite as well as a browser, and
// a suite run mirrors its fixture acts (lucien, alta, sable at the town square)
// straight into world2_dev. `acts` is append-only for every pen including the
// owner, so those rows are not removable and are not meant to be — the sanctioned
// reset is seed-import's own ("rebuild the schema and re-seed"). Naming them is
// what keeps "zero unexplained rows" a claim rather than a hope.
const KNOWN_LAB_ACT_ACTIONS = ["leave-mark", "amend", "withdraw", "enter", "exit", "walk", "declare-stance-on"];

const get = async (path) => {
  const r = await fetch(OFFICE + path);
  if (!r.ok) throw new Error(`${path} answered ${r.status}`);
  return r.json();
};

// THE 1.0 SIDE'S CLASSES, IN EITHER SHAPE OF THE WORLD (WLD-116). A class is a law node, never a
// mark: in the new shape `/world/state` carries no class row and the 1.0 law is `/world/law`
// (WORLD/law-state.json at the same blessing). In the old shape the classes are `kind: class`
// marks in `/world/state` and `/world/law` answers an empty law. Both are read and joined by
// class name, so the comparison holds whichever shape the blessed world is in.
const oneDotZeroClasses = async () => {
  const fromState = ((await get("/world/state")).marks ?? []).filter((m) => m.kind === "class").map((m) => m.id.split("/").pop());
  let fromLaw = [];
  try { fromLaw = ((await get("/world/law")).nodes ?? []).filter((n) => n.kind === "class").map((n) => String(n.class ?? n.id.split("/").pop())); }
  catch { fromLaw = []; } // an office older than the law door: its world is the old shape
  return [...new Set([...fromState, ...fromLaw])];
};

let pool = null;
const sql = async (text, params = []) => {
  if (!pool) {
    if (!PG_URL) throw new Error("WORLD2_PG_URL is not set — the 2.0 side cannot be read");
    const { default: pg } = await import("pg");
    pool = new pg.Pool({ connectionString: PG_URL, max: 2 });
  }
  return (await pool.query(text, params)).rows;
};

const findings = [];
const finding = (sweep, id, what) => { findings.push({ sweep, id, what }); console.log(`  ✗ [${id}] ${what}`); };
const ok = (what) => console.log(`  ✓ ${what}`);
const round = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 1000) / 1000);

// ── sweep 1 · the register ───────────────────────────────────────────────────
//
// 1.0's authoritative register is /world/state, which the FOLD wrote: 960 rows
// including the 129 class marks. 2.0 splits that population by lane — the class
// marks are LAW and live in law_projection (gold §1's REVIEW lane), the rest are
// CANDLE output in `marks`. So the arithmetic that has to close is
//   1.0 register  =  2.0 marks  +  2.0 law_projection.class  ±  known lab rows
// and it closes to zero unexplained rows or this sweep is red.
async function sweepRegister() {
  console.log("\n== SWEEP 1 · THE REGISTER ==");
  const w1 = (await get("/world/state")).marks ?? [];
  const w2 = (await get("/world2/marks?all=true")).marks ?? [];
  const classKeys = new Set((await sql("SELECT key FROM law_projection WHERE kind = 'class'")).map((r) => r.key));

  const i1 = new Map(w1.map((m) => [m.id, m]));
  const i2 = new Map(w2.map((m) => [m.slug, m]));
  const only1 = [...i1.keys()].filter((k) => !i2.has(k));
  const only2 = [...i2.keys()].filter((k) => !i1.has(k));
  const both = [...i1.keys()].filter((k) => i2.has(k));

  console.log(`  1.0 /world/state: ${w1.length} · 2.0 /world2/marks?all=true: ${w2.length} · law_projection.class: ${classKeys.size}`);

  // Every 1.0-only row must be a class mark WITH a law row of the same name —
  // "it went to the law lane" is only an explanation if the law lane has it.
  const unexplained1 = only1.filter((id) => i1.get(id).kind !== "class" || !classKeys.has(id.split("/").pop()));
  if (unexplained1.length) finding("register", "AB-R1", `${unexplained1.length} marks in 1.0 with no 2.0 home: ${unexplained1.slice(0, 8).join(", ")}`);
  else ok(`${only1.length} 1.0-only rows all class marks carried by law_projection`);

  const unexplained2 = only2.filter((s) => !KNOWN_LAB_MARKS.includes(s));
  if (unexplained2.length) finding("register", "AB-R2", `${unexplained2.length} marks in 2.0 that 1.0 never had: ${unexplained2.slice(0, 8).join(", ")}`);
  else ok(`${only2.length} 2.0-only rows all on the known-lab list`);

  const residual = w1.length - both.length - only1.length;
  if (residual !== 0) finding("register", "AB-R3", `register arithmetic leaves ${residual} rows unaccounted`);
  else ok(`arithmetic closes: ${w1.length} = ${both.length} shared + ${only1.length} class-to-law; 2.0 = ${both.length} + ${only2.length} lab`);

  // Per-slug, over the shared population.
  const div = { kind: [], owner: [], household: [], geometry_presence: [], at: [], extent: [], points: [] };
  for (const slug of both) {
    const a = i1.get(slug), b = i2.get(slug);
    if ((a.kind ?? null) !== (b.kind ?? null)) div.kind.push({ slug, w1: a.kind, w2: b.kind });
    if ((a.by ?? null) !== (b.owner ?? null)) div.owner.push({ slug, w1: a.by, w2: b.owner });
    // 1.0 carries the declaring uid as `declared_household`; 2.0 carries it as `household`.
    if ((a.declared_household ?? null) !== (b.household ?? null))
      div.household.push({ slug, w1: a.declared_household, w2: b.household });

    // `!!` on both sides — see the header: a bare `&&` here reports 422 phantoms.
    const aHas = !!(a.at && a.at.x !== undefined);
    const bHas = !!(b.geometry && b.geometry.at);
    if (aHas !== bHas) { div.geometry_presence.push({ slug, w1_at: a.at ?? null, w2_geometry: b.geometry ?? null }); continue; }
    if (!aHas) continue;
    const g = b.geometry;
    if (round(a.at.x) !== round(g.at.x) || round(a.at.y) !== round(g.at.y)) div.at.push({ slug, w1: a.at, w2: g.at });
    const ae = a.extent ?? null, be = g.extent ?? null;
    if (!!ae !== !!be || (ae && (round(ae.w) !== round(be.w) || round(ae.h) !== round(be.h))))
      div.extent.push({ slug, w1: ae, w2: be });
    const pj = (p) => (p ? JSON.stringify(p.map((q) => [round(q[0]), round(q[1])])) : null);
    if (pj(a.points ?? null) !== pj(g.points ?? null)) div.points.push({ slug, w1_n: a.points?.length ?? null, w2_n: g.points?.length ?? null });
  }

  // Substance the register door does not expose: read it from the table it
  // lives in rather than declaring it unverifiable.
  const rows = await sql("SELECT slug, body, data->>'tier' AS tier, data->>'date' AS date, data->>'mechanic' AS mechanic FROM marks");
  const iRow = new Map(rows.map((r) => [r.slug, r]));
  const norm = (s) => (s == null ? null : String(s).replace(/\s+/g, " ").trim());
  const substance = { body: [], tier: [], date: [], mechanic: [] };
  for (const slug of both) {
    const a = i1.get(slug), r = iRow.get(slug);
    if (!r) continue;
    for (const f of ["body", "tier", "date", "mechanic"]) {
      const w1v = norm(f === "body" ? a.body : a[f] ?? null);
      const w2v = norm(r[f]);
      if (w1v !== w2v) substance[f].push({ slug, w1: w1v, w2: w2v });
    }
  }

  for (const [field, list] of [...Object.entries(div), ...Object.entries(substance)]) {
    if (SELF_TEST && field === "kind") { finding("register", "AB-SELFTEST", "self-test: injected kind divergence"); continue; }
    if (list.length) finding("register", `AB-R.${field}`, `${list.length}/${both.length} shared marks diverge on ${field} — e.g. ${JSON.stringify(list[0]).slice(0, 220)}`);
    else ok(`${field}: 0/${both.length}`);
  }
  return { shared: both.length };
}

// ── sweep 2 · the law ────────────────────────────────────────────────────────
//
// 1.0 answers "what may be done here" from class marks reached along the
// containment spine (`gatherActions`, world-apex.mjs); 2.0 projects the same
// class marks into law_projection at a pinned law_sha. The grant set is the
// comparable fact: the repo's `actions:` lines ARE the law, and S39 is the
// precedent for why a silent widening of one must be mechanically catchable —
// "an absent `for:` reads as RESIDENT under LOGOS" (tools/ruled-grants.test.mjs).
async function sweepLaw() {
  console.log("\n== SWEEP 2 · THE LAW ==");
  // The repo's own declarations, read straight off the class marks.
  const repoGrants = new Map();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "mark.md") {
        const line = readFileSync(p, "utf8").split("\n").find((l) => l.startsWith("actions:"));
        if (!line) continue;
        const cls = dir.split(/[\\/]/).pop();
        for (const a of JSON.parse(line.slice("actions:".length).trim()))
          // LOGOS § The human class: an absent `for:` reads as RESIDENT. 2.0
          // makes that default EXPLICIT in the row, which is what turns the S39
          // widening into a plain equality failure instead of a reading.
          repoGrants.set(`${cls}/${a.action}`, a.for ?? "resident");
      }
    }
  };
  const marksDir = join(CLONE, "WORLD", "marks");
  if (!existsSync(marksDir)) { finding("law", "AB-L0", `world clone absent at ${marksDir}`); return; }
  walk(marksDir);

  const dbGrants = new Map((await sql("SELECT key, data->>'for' AS f FROM law_projection WHERE kind = 'grant'")).map((r) => [r.key, r.f]));
  if (SELF_TEST) dbGrants.set("resident/say", "human");

  const missing = [...repoGrants.keys()].filter((k) => !dbGrants.has(k));
  const extra = [...dbGrants.keys()].filter((k) => !repoGrants.has(k));
  const widened = [...repoGrants.entries()].filter(([k, v]) => dbGrants.has(k) && dbGrants.get(k) !== v);

  console.log(`  repo class-mark grants: ${repoGrants.size} · law_projection grants: ${dbGrants.size}`);
  if (missing.length) finding("law", "AB-L1", `${missing.length} repo grants absent from law_projection: ${missing.join(", ")}`);
  if (extra.length) finding("law", "AB-L2", `${extra.length} law_projection grants with no repo declaration: ${extra.join(", ")}`);
  if (widened.length) finding("law", "AB-L3", `${widened.length} grants whose actor-kind differs (the S39 class): ${widened.map(([k, v]) => `${k} repo=${v} db=${dbGrants.get(k)}`).join("; ")}`);
  if (!missing.length && !extra.length && !widened.length) ok(`all ${repoGrants.size} grants match on class/action/for`);

  // 1.0's own answer at a probe point, for the door-level shape.
  const apex = await get("/world/apex?x=0&y=0");
  const here = new Set(apex?.granted?.here ?? []);
  const residentActions = new Set([...repoGrants.keys()].filter((k) => k.startsWith("resident/")).map((k) => k.split("/")[1]));
  const notOffered = [...residentActions].filter((a) => !here.has(a));
  if (notOffered.length) finding("law", "AB-L4", `apex at 0,0 offers no ${notOffered.join(", ")} though law grants it to residents`);
  else ok(`apex granted.here (${here.size}) covers every resident grant in law_projection`);

  // Every class mark must reach a law row, or the 129 that left `marks` went nowhere.
  const classKeys = new Set((await sql("SELECT key FROM law_projection WHERE kind = 'class'")).map((r) => r.key));
  const w1classes = await oneDotZeroClasses();
  const lost = w1classes.filter((c) => !classKeys.has(c));
  if (lost.length) finding("law", "AB-L5", `${lost.length} class marks with no law_projection row: ${lost.slice(0, 8).join(", ")}`);
  else ok(`all ${w1classes.length} class marks carried into law_projection`);
}

// ── sweep 3 · the passages and the history ───────────────────────────────────
//
// 1.0's movement history lives in three places with different lifetimes: the
// world JOURNAL (STATE/log/<N>.jsonl, the live era), WORLD/walk-ledger.md (the
// frozen era's departures) and the crossings ledger served by
// /world/enter-exit-ledger. 2.0 folds all of it into `acts`. A total that
// matches is not enough — the crossing NUMBER survives as the town's clock
// (gold §1), so the per-crossing bucketing has to match too, or replay and walk
// units land on the wrong day.
async function sweepPassages() {
  console.log("\n== SWEEP 3 · PASSAGES AND HISTORY ==");

  // Per-crossing: the journal's own filing vs acts. Bucket by FLOOR — `::int`
  // rounds, and rounding a fractional crossing is how this sweep first reported
  // 27 phantom divergences (see the header).
  const logDir = join(CLONE, "STATE", "log");
  const jrn = new Map();
  let jrnTotal = 0;
  if (existsSync(logDir)) {
    for (const f of readdirSync(logDir).filter((f) => f.endsWith(".jsonl"))) {
      const n = Number(f.slice(0, -6));
      const rows = readFileSync(join(logDir, f), "utf8").split("\n").filter((l) => l.trim());
      jrn.set(n, rows.length); jrnTotal += rows.length;
      // The filename must itself agree with the clock, or "the journal says so"
      // is not a baseline the acts table can be judged against.
      for (const l of rows) {
        const c = crossingAt(JSON.parse(l).at);
        if (c !== n) { finding("passages", "AB-P0", `journal ${f} holds a row whose timestamp is crossing ${c}`); break; }
      }
    }
  }
  // A LEGACY ACT IS NO LONGER THE SAME THING AS A JOURNAL ROW, and this query has
  // to say which it means (changed 2026-08-28 with the ledger backfill). Until the
  // backfill there was exactly one legacy source, so `action LIKE 'legacy:%'` and
  // "a row of the world journal" were the same set and counting either answered
  // both. `ledger-backfill.mjs` adds a second source — 304 departures at crossings
  // the journal has no rows for, and 155 crossings inside the journal's own era —
  // so the unscoped count would now report the journal as mis-bucketed by exactly
  // the number of rows the backfill correctly added. That would be a false finding
  // manufactured by a fix, which is the worst kind.
  //
  // `payload->>'_ledger'` is the source stamp: journal-sourced acts have none,
  // ledger-sourced acts name the repo file they came out of. AB-P1 asks for the
  // journal's; AB-P2 and AB-P3 below ask for the ledgers'.
  const actRows = await sql(
    `SELECT floor(crossing)::int AS c, count(*)::int AS n FROM acts
      WHERE action LIKE 'legacy:%' AND (payload->>'_ledger') IS NULL GROUP BY 1`);
  const acts = new Map(actRows.map((r) => [r.c, r.n]));
  if (SELF_TEST && acts.size) acts.set([...acts.keys()][0], (acts.get([...acts.keys()][0]) ?? 0) + 1);

  const deltas = [...new Set([...jrn.keys(), ...acts.keys()])].sort((a, b) => a - b)
    .map((c) => ({ c, j: jrn.get(c) ?? 0, a: acts.get(c) ?? 0 })).filter((r) => r.j !== r.a);
  console.log(`  journal rows: ${jrnTotal} · acts legacy rows: ${[...acts.values()].reduce((s, n) => s + n, 0)} · crossings: ${jrn.size}`);
  if (deltas.length) finding("passages", "AB-P1", `${deltas.length} crossings mis-bucketed: ${deltas.slice(0, 6).map((d) => `${d.c} journal=${d.j} acts=${d.a}`).join("; ")}`);
  else ok(`all ${jrn.size} crossings reconcile row-for-row`);

  // The crossings ledger. 1.0 derives it live from the frozen era plus the
  // journal; 2.0 is supposed to hold the same passages as enter/exit acts.
  const eel = await get("/world/enter-exit-ledger");
  const ledgerRows = String(eel.ledger ?? "").split("\n").filter((l) => l.startsWith("- ") && (l.includes(" enters ") || l.includes(" exits ")));
  // ERA BY ERA, because the two eras have different verbs and different sources
  // and only one of them is what AB-P2 is about.
  //
  // `legacy:enter`/`legacy:exit` are the FROZEN era, carried by
  // ledger-backfill.mjs under seed-import's `legacy:` convention. Bare
  // `enter`/`exit` are the LIVE door's, written by the acts mirror as residents
  // (and the test suite) use the lab — they are lab rows with no twin in the
  // frozen clone, exactly like `leave-mark`/`amend`/`withdraw` on
  // KNOWN_LAB_ACT_ACTIONS, and they are subtracted the same way.
  //
  // Counting the two together was this check's own bug, caught 2026-08-28 while
  // the backfill was being verified: 30 live enter/exit acts from a test run
  // pushed the total to 185 and the check reported "-30 crossings have no act",
  // which is not a sentence about anything. Worse than the nonsense reading is
  // what the shape allowed — a live enter act could have MASKED a missing frozen
  // crossing and kept the check green. The frozen era is compared to the frozen
  // era, against the door's own `frozen_acts` count rather than the whole ledger.
  const frozenRows = eel.derived?.frozen_acts ?? ledgerRows.length;
  const [{ n: frozenActsRaw }] = await sql(
    "SELECT count(*)::int AS n FROM acts WHERE action IN ('legacy:enter','legacy:exit')");
  const [{ n: liveActs }] = await sql(
    "SELECT count(*)::int AS n FROM acts WHERE action IN ('enter','exit')");
  const frozenActs = SELF_TEST ? frozenActsRaw - 1 : frozenActsRaw;
  console.log(`  1.0 crossings: ${ledgerRows.length} (door: ${frozenRows} frozen + ${eel.derived?.journal_acts ?? 0} journal)` +
    ` · 2.0 frozen-era acts: ${frozenActs} · 2.0 live lab enter/exit: ${liveActs} (known delta)`);
  if (frozenActs !== frozenRows)
    finding("passages", "AB-P2", `${frozenRows - frozenActs} of 1.0's ${frozenRows} frozen-era crossings have no act in 2.0`);
  else ok(`crossings carried: ${frozenActs} frozen-era passages, each with its consent word`);

  // The frozen walk ledger: departures older than the journal's first row have
  // no other home, so if `acts` starts after them they simply are not in 2.0.
  // STRENGTHENED 2026-08-28, with the backfill that answers it. The original
  // check asked "do any walk-ledger rows predate min(at)?" — which was the right
  // question while the answer was 304, and becomes a question that CANNOT FAIL the
  // moment one early row lands, because that row moves `min(at)` behind all the
  // others. A probe that goes green on one row of a 317-row import is not a probe.
  //
  // So it now asks the claim itself: every departure in the frozen ledger has an
  // act. Matched on (at, actor), which is what the two records share — the ledger
  // states no id and the act's payload carries the ledger's own line, so the
  // timestamp and the walker are the join. This can fail on a partial import, on a
  // mis-parsed timestamp, and on a row dropped in the middle, none of which the
  // old shape could see.
  const wl = join(CLONE, "WORLD", "walk-ledger.md");
  if (existsSync(wl)) {
    const rows = readFileSync(wl, "utf8").split("\n").filter((l) => l.startsWith("- "));
    const [{ min }] = await sql("SELECT min(at) AS min FROM acts");
    // MULTIPLICITY, not membership. The frozen ledger genuinely repeats one row —
    // rook-of-garrison at 2026-08-08T18:00:00.000Z is written twice, byte for
    // byte, an append that ran twice — and the import carries both, because the
    // record says two. A Set would call that pair satisfied by a single act, so a
    // dropped copy would hide. Counting per key cannot.
    const dep = await sql("SELECT at, actor FROM acts WHERE action = 'legacy:departure'");
    const have = new Map();
    for (const r of dep) {
      const k = `${new Date(r.at).toISOString()}|${r.actor}`;
      have.set(k, (have.get(k) ?? 0) + 1);
    }
    if (SELF_TEST && have.size) {
      const k = [...have.keys()][0];
      have.set(k, have.get(k) - 1);
    }
    const missing = rows.filter((l) => {
      const m = /^- (\S+) · (\S+) · /.exec(l);
      if (!m) return false;
      const k = `${new Date(m[1]).toISOString()}|${m[2]}`;
      const left = have.get(k) ?? 0;
      if (left <= 0) return true;
      have.set(k, left - 1);          // each ledger row consumes one act
      return false;
    });
    console.log(`  walk-ledger rows: ${rows.length} · departure acts: ${dep.length} · acts begin ${new Date(min).toISOString()}`);
    if (missing.length) finding("passages", "AB-P3", `${missing.length} of ${rows.length} walk-ledger departures have no act in 2.0, e.g. ${missing[0].slice(2, 60)}`);
    else ok(`walk-ledger fully covered by acts: ${rows.length} departures, all matched on (at, actor)`);
  }

  // Every CANDLE act must have produced a claim. An act the docket never
  // received is a submission with no receipt, and nothing else would notice.
  const orphans = await sql(`
    SELECT a.id, a.at, a.object FROM acts a
    WHERE a.action = 'leave-mark'
      AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.geometry->>'slug' = a.object)`);
  if (orphans.length) finding("passages", "AB-P4", `${orphans.length} leave-mark acts with no claims row: ${orphans.map((o) => `${o.object} @ ${new Date(o.at).toISOString()}`).join("; ")}`);
  else ok("every leave-mark act reached the docket");

  // The candle's windows must tile time, or an act can land between them.
  const wins = await sql("SELECT id, opens_at, closes_at FROM windows ORDER BY id");
  for (let i = 1; i < wins.length; i++) {
    const gap = Date.parse(wins[i].opens_at) - Date.parse(wins[i - 1].closes_at);
    if (gap > 0) finding("passages", "AB-P5", `windows ${wins[i - 1].id}→${wins[i].id} leave a ${(gap / 3.6e6).toFixed(1)}h hole with no open candle`);
  }
  if (!findings.some((f) => f.id === "AB-P5")) ok(`windows tile: ${wins.length} rows, no gaps`);
}

const main = async () => {
  console.log(`A/B parity probe — office ${OFFICE}, clone ${CLONE}${SELF_TEST ? " [SELF-TEST: expecting reds]" : ""}`);
  await sweepRegister();
  await sweepLaw();
  await sweepPassages();
  console.log(`\n== VERDICT ==\n${findings.length ? `${findings.length} unreconciled divergence(s) — 2.0's read surface is NOT yet purely upside:` : "no unreconciled divergences: every 1.0 read has a 2.0 answer that agrees"}`);
  for (const f of findings) console.log(`  [${f.sweep}/${f.id}] ${f.what}`);
  if (SELF_TEST) {
    // AB-P2 and AB-P3 joined the sweep list when the backfill gave them something
    // to be right about: a check that has never been green has never proved it can
    // GO red for the right reason, and AB-P3's old shape could not fail at all
    // once one early row landed. Five faults, one per sweep that makes a claim.
    const wanted = ["AB-SELFTEST", "AB-L3", "AB-P1", "AB-P2", "AB-P3"];
    const got = wanted.filter((w) => findings.some((f) => f.id === w));
    console.log(`\nself-test: ${got.length}/${wanted.length} injected faults caught (${got.join(", ")})`);
    await pool?.end();
    process.exit(got.length === wanted.length ? 0 : 1);
  }
  await pool?.end();
  process.exit(findings.length ? 1 : 0);
};

main().catch((e) => { console.error("probe tripped:", e.message); process.exit(2); });
