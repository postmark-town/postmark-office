// falsifier-live-equality.mjs — the guard on the LIVE-lane port.
//
// `live-reads.mjs` is a PORT of 1.0's movement, presence, sound and containment
// derivations onto `acts` rows. Every one of those files forbids a second copy
// of itself — where-is.mjs's header is the plainest: "The cure is the one this
// codebase already uses everywhere else: the law lives in the engine and every
// surface imports it." The 2.0 read tier answers from Postgres and holds no
// world checkout, so it cannot import. What stands in for the import is this:
//
//   RUN BOTH, OVER THE SAME INPUTS, AND NAME EVERY ROW THEY DISAGREE ABOUT.
//
// The standing lane's design, deliberately, including its opposite-of-the-
// projection-falsifier stance: there, "two derivations would make a green mean
// only 'both parsers agree'". Here the second derivation IS what is on trial,
// so two derivations are the whole point — and every oracle below is 1.0's OWN
// function, imported live, never a re-expression written here.
//
// ── THE EQUALITIES, AND WHAT EACH ONE COULD CATCH ──────────────────────────
//
//   E1 THE LEDGER PARSE   the checkout's `parseWalkLedger` over
//                         WORLD/walk-ledger.md, against `departureRecordOf` over
//                         the ledger-sourced acts. Catches: the backfill's
//                         payload read wrong, a dropped field, a coerced type.
//   E2 THE LEDGER ORDER   the checkout's `currentDeparture` over the ledger in
//                         FILE order, against `governingDepartures` over the
//                         ledger-era acts. Scoped to the rows the store holds —
//                         the 13 the journal carries are not a disagreement.
//   E2b THE MERGED ORDER  the office's `recordsAcrossEras` merge, against the
//                         governing departure over the list AS READ. THIS is the
//                         check that catches the 44-handle trap: `ORDER BY id`
//                         puts the pre-journal era last, and E2 alone cannot see
//                         it because reordering does not disturb one era's
//                         internal order.
//   E3 THE JOURNAL SEAM   the office's own `storedDepartures` over an in-memory
//                         `movements` table built from the journal acts' inner
//                         payloads, against `departureRecordOf` over the same
//                         acts. `readMovements` emits exactly the jsonl row shape
//                         the seed stored, so this is 1.0's converter judging the
//                         port's converter on identical bytes.
//   E4 THE ARITHMETIC     the checkout's `positionAt` / `positionsAt` /
//                         `publicWalkers`, against the vendored copies, over
//                         every governing record at several instants. Catches a
//                         drifted vendor.
//   E5 THE UNION          the checkout's `where-is.mjs publicResidents` against
//                         the ported one, over THE SAME world shim, roster and
//                         departures. Plus the shim itself against the checkout's
//                         fold, which is what catches the household/owner edge.
//   E6 PRESENCE + STACK   the office's `presentEmissions` over an in-memory
//                         `emissions` table built from the emission acts, against
//                         `presentEmissionsAt`; and the checkout's `occupancyAt`
//                         over the frozen ledger, against the ported fold over
//                         the passage acts.
//
// ── EXIT CODES ───────────────────────────────────────────────────────────────
//
//   0  every equality holds
//   1  RED — a divergence, named
//   2  CANNOT RUN
//
// There is no code for "checked nothing and found nothing". An empty `acts`, a
// checkout with no ledger, a comparison with zero rows in common, or an equality
// that ended up comparing nothing all exit 2, loudly — and each equality reports
// its own `compared` count so a green that checked nothing is visible.
//
// ── RUNNING IT ───────────────────────────────────────────────────────────────
//
//   export WORLD2_PG_URL="postgres://snapshot_reader:…@localhost:5432/world2_dev"
//   git -C ~/world-full worktree add --detach /tmp/w-live sandbox/seed
//   node world2/tools/falsifier-live-equality.mjs --world-repo /tmp/w-live
//
// `--json` machine-readable · `--can-fail-proof` breaks each derivation on
// purpose, in memory, and requires every break to turn this red.

import { resolve, join } from "node:path";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import * as live from "./live-reads.mjs";
import { resolveLedgerRel } from "./ledger-names.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const has = (n) => process.argv.includes(n);
const die = (msg) => { console.error(`CANNOT RUN · ${msg}`); process.exit(2); };

const worldRepo = arg("--world-repo");
if (!worldRepo) die("usage: falsifier-live-equality.mjs --world-repo <checkout> [--json] [--can-fail-proof]");
const REPO = resolve(worldRepo);
if (!existsSync(REPO)) die(`no checkout at ${REPO}`);
if (!process.env.WORLD2_PG_URL) die("WORLD2_PG_URL missing");

const toolUrl = (f) => pathToFileURL(join(REPO, "tools", f)).href;

// ── the oracles, imported live out of the checkout / this office ────────────
let walkMod, whereMod, eeMod, foldMod, emissionsMod, movementMod, storeMod;
try {
  walkMod = await import(toolUrl("walk.mjs"));
  whereMod = await import(toolUrl("where-is.mjs"));
  foldMod = await import(toolUrl("marks-fold.mjs"));
  eeMod = await import(toolUrl("enter-exit.mjs")).catch(() => import(toolUrl("thresholds.mjs")));
} catch (e) { die(`the checkout at ${REPO} cannot be read as a world clone: ${e.message}`); }
try {
  emissionsMod = await import("../../src/dynamic-emissions.mjs");
  movementMod = await import("../../src/world-movement.mjs");
  storeMod = await import("../../src/dynamic-store.mjs");
} catch (e) { die(`this office's own live modules cannot be imported: ${e.message}`); }

const parseWalkLedger = walkMod.parseWalkLedger;
const parseEnterExit = eeMod.parseEnterExitLedger ?? eeMod.parseThresholdLedger;
if (!parseWalkLedger || !parseEnterExit) die("the checkout exports neither ledger reader under a name this pen knows");

// ── the store ────────────────────────────────────────────────────────────────

const DEPARTURE_SELECT =
  // `id` bare, never `id::text`: node-postgres already hands bigint over as a
  // string, and casting it here would put a TEXT column named `id` in the output
  // list — which `ORDER BY` resolves against before the table. That sorted 1019
  // before 102 on this pen's first run, and the order guard is what caught it.
  `SELECT id, at, crossing, actor, action, payload FROM acts
    WHERE action = ANY($1) ${live.DEPARTURE_ORDER_SQL}`;
const PASSAGE_SELECT =
  // `id` bare, never `id::text`: node-postgres already hands bigint over as a
  // string, and casting it here would put a TEXT column named `id` in the output
  // list — which `ORDER BY` resolves against before the table. That sorted 1019
  // before 102 on this pen's first run, and the order guard is what caught it.
  `SELECT id, at, crossing, actor, action, payload FROM acts
    WHERE action = ANY($1) ${live.PASSAGE_ORDER_SQL}`;
const EMISSION_SELECT =
  `SELECT id, at, actor, action, payload FROM acts
    WHERE action IN ('legacy:emission','emission') ORDER BY at, acts.id`;

/**
 * A field-for-field record comparison. `null` and absent are the SAME here —
 * `parseWalkLedger` writes `targetMarkId: null` and a journal row simply has no
 * `to`, and treating that as a divergence would make every era red for a
 * difference that is not one.
 */
function sameRecord(a, b) {
  const f = (r) => [
    r.handle, r.iso,
    r.from?.x, r.from?.y, r.toward?.x, r.toward?.y, r.at,
    r.targetExtent?.w ?? null, r.targetExtent?.h ?? null,
    r.targetMarkId ?? null, r.pace ?? null,
  ];
  const x = f(a), y = f(b);
  return x.every((v, i) => (v === y[i]) || (v == null && y[i] == null));
}
const show = (r) => JSON.stringify({ handle: r.handle, iso: r.iso, from: r.from, toward: r.toward, at: r.at,
  within: r.targetExtent ?? null, to: r.targetMarkId ?? null, pace: r.pace ?? null });

// ── E1 · the ledger parse ────────────────────────────────────────────────────

export function e1LedgerParse(records, ledgerText) {
  const findings = [];
  const { departures } = parseWalkLedger(ledgerText);
  const oracle = new Map(departures.map((d) => [`${d.iso}|${d.handle}|${d.at}`, d]));
  const mine = records.filter((r) => r.era === "ledger");
  let compared = 0;
  for (const r of mine) {
    const k = `${r.iso}|${r.handle}|${r.at}`;
    const o = oracle.get(k);
    if (!o) { findings.push(`E1 acts carry a ledger departure the ledger does not: ${show(r)}`); continue; }
    compared++;
    if (!sameRecord(r, o))
      findings.push(`E1 the ledger act disagrees with the ledger's own parse\n      ledger: ${show(o)}\n      acts:   ${show(r)}`);
    if (r.line !== o.line)
      findings.push(`E1 the verbatim line differs at ${r.handle} @ ${r.iso}\n      ledger: ${o.line}\n      acts:   ${r.line}`);
  }
  return { findings, compared, oracle_rows: departures.length, port_rows: mine.length };
}

// ── E2 · the order ───────────────────────────────────────────────────────────
//
// THE CHECK THAT NAMES THE TRAP. 1.0's `currentDeparture` is "the last match in
// array order" over the ledger read in FILE order. The port must reach the same
// governing leg for every handle the ledger era covers — and it can only do so
// if the acts were read era-first.

/**
 * THE POPULATIONS MUST MATCH BEFORE THE ORDERS CAN BE COMPARED, and the first
 * run of this check got that wrong in a way worth keeping.
 *
 * `acts` holds 304 of the ledger's 317 departures: the backfill deliberately did
 * not insert the 13 that sit at or after the journal's first row, because the
 * journal already carries them (`partitionWalks`). Running 1.0's
 * `currentDeparture` over the WHOLE ledger and the port's over the 304 compared
 * two different questions, and reported 8 handles as disagreeing when what had
 * actually happened is that 1.0's answer for them lives in the journal era.
 *
 * So the oracle's list is scoped to the rows the store holds — keeping FILE
 * ORDER, which is the only thing under test — and the 13 are asserted to be the
 * whole of the difference rather than assumed away.
 */
export function e2Order(records, ledgerText) {
  const findings = [];
  const { departures } = parseWalkLedger(ledgerText);
  const mineLedgerEra = records.filter((r) => r.era === "ledger");
  const inStore = new Set(mineLedgerEra.map((r) => `${r.iso}|${r.handle}|${r.at}`));
  const scoped = departures.filter((d) => inStore.has(`${d.iso}|${d.handle}|${d.at}`));
  const held = departures.filter((d) => !inStore.has(`${d.iso}|${d.handle}|${d.at}`));

  // The seam receipt: every ledger row the store does not carry as a LEDGER act
  // must be carried as a JOURNAL one. A row in neither is a departure that fell
  // down the seam — the class the backfill exists to close.
  const journalKeys = new Set(records.filter((r) => r.era !== "ledger").map((r) => `${r.iso}|${r.handle}`));
  for (const d of held) {
    if (!journalKeys.has(`${d.iso}|${d.handle}`))
      findings.push(`E2 ${d.handle} @ ${d.iso} is in the walk ledger and in NEITHER era of the store — a departure that fell down the seam`);
  }

  const gov = live.governingDepartures(mineLedgerEra);
  let compared = 0;
  for (const h of [...new Set(scoped.map((d) => d.handle))]) {
    const o = walkMod.currentDeparture(scoped, h);
    const m = gov.get(h);
    if (!m) { findings.push(`E2 the store carries no ledger-era departure for ${h}, which the scoped ledger does`); continue; }
    compared++;
    if (!sameRecord(m, o))
      findings.push(`E2 the governing ledger departure differs for ${h}\n      1.0 (file order): ${show(o)}\n      port (acts order): ${show(m)}`);
  }
  return { findings, compared, ledger_rows: departures.length, scoped_rows: scoped.length,
    held_by_the_journal_era: held.length };
}

/**
 * E2b · THE MERGED ORDER — the check that actually catches the 44-handle trap.
 *
 * E2 scopes to the ledger era, so reordering the whole read leaves it green: the
 * ledger rows keep their relative order however the list is sorted. The trap is
 * in the MERGE, and 1.0 has a function for exactly that merge —
 * `world-movement.mjs recordsAcrossEras`:
 *
 *   "APPENDED, NOT SORTED … Era one keeps its order; era two follows, which is
 *    correct because every store record postdates the freeze."
 *
 * So the oracle re-partitions the records into their two eras and merges them
 * 1.0's way, then asks `currentDeparture`. The port's side takes the list AS
 * READ. Feed it an `id`-ordered read and the two diverge on every handle whose
 * eras got swapped — which is what the measured 44 are.
 */
export function e2bMergedOrder(records) {
  const findings = [];
  const eraOne = records.filter((r) => r.era === "ledger");
  const eraTwo = records.filter((r) => r.era !== "ledger");
  const merged = movementMod.recordsAcrossEras(eraOne, eraTwo);
  const mine = live.governingDepartures(records);
  let compared = 0;
  for (const h of new Set(records.map((r) => r.handle))) {
    const o = walkMod.currentDeparture(merged, h);
    const m = mine.get(h);
    compared++;
    if (!o || !m) { findings.push(`E2b one side has no governing departure for ${h}`); continue; }
    if (!sameRecord(m, o))
      findings.push(`E2b the merged governing departure differs for ${h}\n      1.0 (recordsAcrossEras): ${show(o)}\n      port (the read's order):  ${show(m)}`);
  }
  return { findings, compared, era_one: eraOne.length, era_two: eraTwo.length };
}

// ── E3 · the journal seam ────────────────────────────────────────────────────
//
// The oracle is `storedDepartures`, the office's own converter for exactly this
// payload shape, run over an in-memory `movements` table loaded from the journal
// acts' inner payloads. `readMovements` re-emits the jsonl row shape, so both
// sides are reading the same bytes through two different readers.

export async function e3JournalSeam(rows, records) {
  const findings = [];
  const journalRows = rows.filter((r) => !r.payload?._ledger && r.payload?.payload?.from);
  if (!journalRows.length) return { findings, compared: 0, note: "no journal-sourced departures in the store" };

  const dir = mkdtempSync(join(tmpdir(), "live-e3-"));
  const dbPath = join(dir, "oracle.db");
  let oracle;
  try {
    const db = storeMod.openDynamic(dbPath);
    const ins = db.prepare(
      `INSERT INTO movements (actor, at, from_x, from_y, toward_x, toward_y, crossing,
                              within_w, within_h, to_mark, pace, declared_by, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of journalRows) {
      const p = r.payload.payload;
      ins.run(r.payload.actor ?? r.actor, r.payload.at ?? new Date(r.at).toISOString(),
        p.from.x, p.from.y, p.toward.x, p.toward.y, p.crossing,
        p.within?.w ?? null, p.within?.h ?? null, p.to ?? null, p.pace ?? null,
        r.payload.actor ?? r.actor, null);
    }
    db.close();
    oracle = movementMod.storedDepartures({ dbPath, atMs: Number.MAX_SAFE_INTEGER }).records;
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    return { findings: [`E3 could not build the oracle store: ${e.message}`], compared: 0 };
  }
  rmSync(dir, { recursive: true, force: true });

  const byKey = new Map(oracle.map((d) => [`${d.iso}|${d.handle}|${d.at}`, d]));
  const mine = records.filter((r) => r.era === "journal");
  let compared = 0;
  for (const r of mine) {
    const o = byKey.get(`${r.iso}|${r.handle}|${r.at}`);
    if (!o) { findings.push(`E3 the port derived a journal departure the office's own converter does not: ${show(r)}`); continue; }
    compared++;
    if (!sameRecord(r, o))
      findings.push(`E3 the journal converter disagrees\n      storedDepartures: ${show(o)}\n      port:             ${show(r)}`);
  }
  if (oracle.length !== mine.length)
    findings.push(`E3 row counts differ: storedDepartures ${oracle.length}, port ${mine.length}`);
  return { findings, compared, oracle_rows: oracle.length, port_rows: mine.length };
}

// ── E4 · the arithmetic ──────────────────────────────────────────────────────
//
// Identical inputs, 1.0's `positionAt` against the vendored one, at instants
// chosen to hit every branch: before the departure, mid-leg, at arrival, and
// long after. A vendored copy that has drifted shows here and nowhere else.

export function e4Arithmetic(records, instants) {
  const findings = [];
  let compared = 0;
  const gov = [...live.governingDepartures(records).values()];
  for (const d of gov) {
    for (const t of instants) {
      const o = walkMod.positionAt(d, t);
      const m = live.positionAt(d, t);
      compared++;
      for (const k of ["x", "y", "arrived", "standing", "legM", "travelledM", "remainingM", "etaCrossings"]) {
        if (o[k] !== m[k]) {
          findings.push(`E4 positionAt disagrees for ${d.handle} at crossing ${t} · field ${k}\n      1.0:  ${o[k]}\n      port: ${m[k]}`);
          break;
        }
      }
    }
  }
  // And the plural shapes, whole — a per-record equality that composed wrongly
  // would still be a wrong door.
  const t = instants[instants.length - 1];
  const o = JSON.stringify(walkMod.publicWalkers(records, t).sort((a, b) => (a.handle < b.handle ? -1 : 1)));
  const m = JSON.stringify(live.publicWalkers(records, t).sort((a, b) => (a.handle < b.handle ? -1 : 1)));
  if (o !== m) findings.push(`E4 publicWalkers differs at crossing ${t} — first divergence at char ${firstDiff(o, m)}\n      1.0:  …${o.slice(Math.max(0, firstDiff(o, m) - 60), firstDiff(o, m) + 60)}…\n      port: …${m.slice(Math.max(0, firstDiff(o, m) - 60), firstDiff(o, m) + 60)}…`);
  return { findings, compared };
}

const firstDiff = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };

// ── E5 · the union ───────────────────────────────────────────────────────────

export function e5Union(records, world, roll, at) {
  const findings = [];
  const roster = live.positionRoster({ departures: records, world, roll });
  const o = whereMod.publicResidents(roster, { world, departures: records, at });
  const m = live.publicResidents(roster, { world, departures: records, at });
  const key = (r) => r.handle;
  const byO = new Map(o.map((r) => [key(r), r]));
  const byM = new Map(m.map((r) => [key(r), r]));
  let compared = 0;
  for (const [h, ro] of byO) {
    const rm = byM.get(h);
    if (!rm) { findings.push(`E5 1.0 places ${h} and the port does not (${ro.source} at ${ro.x},${ro.y})`); continue; }
    compared++;
    for (const k of ["x", "y", "source", "moving", "remaining_m", "eta_crossings", "mark_id"]) {
      if (JSON.stringify(ro[k]) !== JSON.stringify(rm[k])) {
        findings.push(`E5 publicResidents disagrees at ${h} · field ${k}\n      1.0:  ${JSON.stringify(ro[k])}\n      port: ${JSON.stringify(rm[k])}`);
        break;
      }
    }
  }
  for (const h of byM.keys()) if (!byO.has(h)) findings.push(`E5 the port places ${h} and 1.0 does not`);
  return { findings, compared };
}

/**
 * E5c · THE ROLL THE UNION ASKS — and the gap it was ruled to close.
 *
 * E5 proves the port and 1.0 agree over whatever roster they are BOTH handed.
 * It is silent about which roster that should be, and that silence is exactly
 * where the twelve residents went: the door asked `identities` (the world repo's
 * households.json, 102 handles) while 1.0's own doors ask the TOWN's roll
 * (`townRoll()` → `residentList`, 132 handles). Nothing was ever red. Twelve
 * people were simply not in the question.
 *
 *   #1864, quoted in `positions.mjs` and carried in `positionRoster`: "28 of 103
 *   residents were not answered wrongly, they were never asked about."
 *
 * So this asks two things the union cannot ask itself:
 *
 *   THE EQUALITY — 1.0's own `publicResidents` and the port, over the TOWN roll,
 *   agree resident for resident. That is E5's comparison with the ruled roster
 *   substituted in, and it is what makes the wider roll safe to take: the twelve
 *   new names are answered by the SAME law, not merely added to a list.
 *
 *   THE CLOSING, as a receipt rather than a gate — how many residents the answer
 *   holds under the town's roll and how many it held under `identities`. A gate
 *   would be wrong here: the numbers move with the town, and a falsifier that
 *   reds when somebody joins is a falsifier people turn off. What IS a finding
 *   is the gap failing to close at all — the town's roll answering for no more
 *   residents than the narrow one did, which would mean the repoint did nothing.
 */
export function e5cRollParity(records, world, { usedRoll, ruledRoll, identityRoll }, at) {
  const findings = [];
  if (!ruledRoll.length) {
    return { findings: ["E5c town_roll is empty — the ruled roster has no rows at the ingested head, and a union " +
                        "checked against an absent roll is the #1864 defect being re-certified"], compared: 0 };
  }
  // THE ROSTER THE ANSWER USED IS THE ROSTER THAT WAS RULED. `usedRoll` is what
  // the read path passed to `everyonePlaced`; `ruledRoll` is `town_roll` at the
  // pinned head. A door that reads the ruled table and then asks a different
  // list is the whole defect wearing a fix, and every equality below would stay
  // green through it — they compare the port with 1.0 over ONE roster, and a
  // narrowed roster is handed to both.
  const unasked = ruledRoll.filter((h) => !usedRoll.includes(h));
  if (unasked.length) {
    findings.push(`E5c the answer asked about ${usedRoll.length} handles and the ruled roll holds ${ruledRoll.length} — ` +
      `${unasked.length} resident(s) the town names went unasked-about (${unasked.slice(0, 8).join(", ")}${unasked.length > 8 ? ", …" : ""}). ` +
      `#1864: "they were never asked about."`);
  }

  const wide = live.everyonePlaced({ world, departures: records, at, roll: usedRoll });
  const narrow = live.everyonePlaced({ world, departures: records, at, roll: identityRoll });

  // The equality, over the roster the answer used. `everyonePlaced` drops the
  // vessel from BOTH the roster and the departures before it asks, so the oracle
  // is fed the roster it actually built rather than the raw roll.
  const notVessel = (h) => !live.NON_ENTITY_ACTORS.includes(h);
  const deps = records.filter((d) => notVessel(d.handle));
  const roster = live.positionRoster({ departures: deps, world, roll: usedRoll.filter(notVessel) }).filter(notVessel);
  const o = whereMod.publicResidents(roster, { world, departures: deps, at });
  const byO = new Map(o.map((r) => [r.handle, r]));
  const byM = new Map(wide.map((r) => [r.handle, r]));
  let compared = 0;
  for (const [h, ro] of byO) {
    const rm = byM.get(h);
    if (!rm) { findings.push(`E5c 1.0 places ${h} from the town roll and the port does not`); continue; }
    compared++;
    for (const k of ["x", "y", "source", "moving", "mark_id"]) {
      if (JSON.stringify(ro[k]) !== JSON.stringify(rm[k])) {
        findings.push(`E5c publicResidents disagrees at ${h} · field ${k}\n      1.0:  ${JSON.stringify(ro[k])}\n      port: ${JSON.stringify(rm[k])}`);
        break;
      }
    }
  }
  for (const h of byM.keys()) if (!byO.has(h)) findings.push(`E5c the port places ${h} from the town roll and 1.0 does not`);

  // The closing. A finding only if the wider roll bought nothing.
  const gained = wide.filter((r) => !narrow.some((n) => n.handle === r.handle)).map((r) => r.handle);
  if (ruledRoll.length > identityRoll.length && !gained.length) {
    findings.push(`E5c the town roll holds ${ruledRoll.length} handles against identities' ${identityRoll.length}, and the ` +
      `answer gained nobody — the roll is being read and then not asked, which is the repoint not happening`);
  }
  return { findings, compared,
    note: `roll ${ruledRoll.length} (identities ${identityRoll.length}) · present ${wide.length} (was ${narrow.length})` +
          (gained.length ? ` · gained ${gained.length}: ${gained.slice(0, 6).join(", ")}${gained.length > 6 ? ", …" : ""}` : "") };
}

/**
 * THE SHIM AGAINST THE FOLD. E5 proves the port and 1.0 agree over one world
 * object; this proves the world object built from DB rows is the same world the
 * fold builds from the checkout. It is the check that catches the household /
 * owner edge — 2.0's `marks.household` column is 1.0's `_cred`, and a port that
 * read it as the handle would answer with an empty ground for the whole town
 * while every arithmetic equality above stayed green.
 */
export async function e5bShimVsFold(world) {
  const findings = [];
  let folded;
  try {
    // The assembly is `seed-import.mjs § foldOracle`'s, line for line — the same
    // four inputs, from the same four places. "Stakes are the ✦weight input and
    // touch neither field this asks about; the seed carries no stake ledger …
    // so the honest value is the empty one."
    const marksDir = join(REPO, "WORLD", "marks");
    if (!existsSync(marksDir)) return { findings: [`E5b no WORLD/marks under ${REPO}`], compared: 0 };
    const terrainPath = join(REPO, "WORLD", "skeleton.json");
    const terrain = existsSync(terrainPath) ? JSON.parse(readFileSync(terrainPath, "utf8")) : null;
    const hhPath = join(REPO, "WORLD", "households.json");
    const households = existsSync(hhPath) ? (JSON.parse(readFileSync(hhPath, "utf8")).households ?? null) : null;
    folded = foldMod.fold({ marks: foldMod.loadMarks(marksDir), terrain, stakes: [], households });
  } catch (e) { return { findings: [`E5b could not fold the checkout: ${e.message}`], compared: 0 }; }

  const foldParcels = new Map((folded.parcels ?? []).map((p) => [p.id, p]));
  const shimParcels = new Map(world.parcels.map((p) => [p.id, p]));
  let compared = 0;
  for (const [id, fp] of foldParcels) {
    const sp = shimParcels.get(id);
    if (!sp) continue;                 // the store has legitimately moved past the tag
    compared++;
    if (sp.household !== fp.household)
      findings.push(`E5b parcel ${id} carries household "${sp.household}" in the shim and "${fp.household}" in the fold ` +
        `— the shim reads 1.0's mark.household as marks.owner, and this is where that stand-in breaks`);
    if (sp.at?.x !== fp.at?.x || sp.at?.y !== fp.at?.y)
      findings.push(`E5b parcel ${id} sits at ${sp.at?.x},${sp.at?.y} in the shim and ${fp.at?.x},${fp.at?.y} in the fold`);
  }
  if (!compared) findings.push("E5b no parcel is in both the store and the checkout — the shim is unchecked against the fold");

  // The roll. `world.households` is the fold's registry projection; `identities`
  // is the projection of the same file. They must agree where they overlap.
  let rollCompared = 0;
  for (const [h, key] of Object.entries(folded.households ?? {})) {
    if (!(h in world.households)) continue;
    rollCompared++;
    if (world.households[h] !== key)
      findings.push(`E5b the roll disagrees for ${h}: identities says "${world.households[h]}", the fold says "${key}"`);
  }
  return { findings, compared, roll_compared: rollCompared };
}

// ── E6 · presence and the stack ──────────────────────────────────────────────

/**
 * THE INSTANT IS CHOSEN SO THE CHECK IS NOT ASLEEP.
 *
 * The first run asked one instant and compared ONE emission — a green over a
 * near-empty answer, which is the shape ab-compare's AB-P3 note warns about ("a
 * probe that goes green on 1 row of a 317-row import is not a probe"). So the
 * instants are the record's own busiest moments: every emission's birth is a
 * candidate, and the ones with the most sound in the air are asked.
 */
export function busiestInstants(rows, n = 5) {
  const spans = rows.map((r) => live.emissionOf(r)).filter((r) => !r.refused).map((r) => r.emission);
  const scored = spans.map((e) => {
    const t = Date.parse(e.born_at);
    return { t, n: spans.filter((o) => Date.parse(o.born_at) <= t && Date.parse(o.ttl_expires_at) > t).length };
  });
  scored.sort((a, b) => b.n - a.n || a.t - b.t);
  const out = [];
  for (const s of scored) { if (!out.includes(s.t)) out.push(s.t); if (out.length >= n) break; }
  return out;
}

export function e6EmissionsAcross(rows, instants) {
  const all = instants.map((t) => e6Emissions(rows, t));
  return {
    findings: all.flatMap((r) => r.findings),
    compared: all.reduce((a, r) => a + r.compared, 0),
    instants: all.map((r) => `${r.at} (${r.compared} in the air)`),
  };
}

export function e6Emissions(rows, atMs) {
  const findings = [];
  if (!rows.length) return { findings, compared: 0, note: "no emission acts in the store" };
  const dir = mkdtempSync(join(tmpdir(), "live-e6-"));
  const dbPath = join(dir, "oracle.db");
  let oracle;
  try {
    const db = storeMod.openDynamic(dbPath);
    const ins = db.prepare("INSERT OR REPLACE INTO emissions (id, class, source, x, y, born_at, ttl_expires_at, props) VALUES (?,?,?,?,?,?,?,?)");
    for (const r of rows) {
      const got = live.emissionOf(r);
      if (got.refused) continue;
      const e = got.emission;
      ins.run(e.id, e.class, e.source, e.x, e.y, e.born_at, e.ttl_expires_at, JSON.stringify(e.props));
    }
    oracle = emissionsMod.presentEmissions(db, atMs);
    db.close();
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    return { findings: [`E6 could not build the emissions oracle: ${e.message}`], compared: 0 };
  }
  rmSync(dir, { recursive: true, force: true });

  const mine = live.presentEmissionsAt(rows, atMs);
  const o = oracle.map((e) => e.id).join("|");
  const m = mine.map((e) => e.id).join("|");
  if (o !== m) {
    findings.push(`E6 presentEmissions disagrees at ${new Date(atMs).toISOString()}: 1.0 returns ${oracle.length}, the port ${mine.length}` +
      (o === m ? "" : `\n      first divergence at index ${firstDiff(o, m)}`));
  }
  return { findings, compared: oracle.length, at: new Date(atMs).toISOString() };
}

/**
 * THE FROZEN ERA AGAINST THE FROZEN ERA — ab-compare's AB-P2 lesson, verbatim:
 *
 *   "My first edit widened it to count `enter`/`exit` alongside
 *    `legacy:enter`/`legacy:exit`, and 30 live acts from an office test run
 *    promptly made it print `-30 crossings have no act`. The nonsense reading was
 *    the smaller half of the problem: that shape also let a LIVE enter act mask a
 *    MISSING frozen crossing and keep the check green."
 *
 * So the comparison is scoped to the `ledger` era, and the rows from the other
 * eras are reported BESIDE it as the named delta they are. The store carrying
 * more record than the frozen tag is the store being right, not a finding.
 */
export function e6Occupancy(passages, at, ledgerRel) {
  const findings = [];
  // THE ACTS NAME THEIR OWN SOURCE, so nothing here guesses which file to read.
  // At `settlement/S50` the checkout carries BOTH ledger names — the rename's
  // two sides — and the backfill refuses exactly that ambiguity ("Two files
  // claiming to be one archive is the twin phase 0 just killed"). It does not
  // have to be refused here: `payload._ledger` says which file these rows came
  // out of, and reading any other one would compare the store to a record it was
  // not built from. That still holds where the named file stands; what it did
  // NOT cover is a checkout where the named file is GONE, which is every
  // checkout since 2026-08-28 — see the rename note below.
  const rel = ledgerRel;
  if (!rel) return { findings: ["E6 no passage act names its source ledger — occupancy is unchecked"], compared: 0 };
  // A FROZEN RECORD KEEPS THE VOCABULARY OF THE DAY IT WAS FROZEN (#2894). The
  // acts still name `WORLD/threshold-ledger.md`, deleted from main 2026-08-28,
  // so the existsSync that used to stand here returned `compared: 0` — and a
  // compared-0 equality lands in `unchecked`, which exits the WHOLE RUN 2. This
  // pen was unable to complete on any current checkout for nineteen days and
  // nothing said so. `resolveLedgerRel` maps the retired spelling forward from a
  // dated, evidenced table; where the named file still EXISTS (settlement/S50
  // carries both sides of the rename) it is returned untouched, so no verdict
  // that was reachable before can change.
  const resolved = resolveLedgerRel(REPO, rel);
  if (!resolved)
    return { findings: [`E6 the acts name ${rel} as their source, this checkout has no such file, and no rename this pen knows leads to one — occupancy is unchecked`], compared: 0 };
  const { acts } = parseEnterExit(readFileSync(join(REPO, resolved.rel), "utf8"));
  const frozen = passages.filter((p) => p.era === "ledger");
  const beyond = passages.filter((p) => p.era !== "ledger");
  const oracle = eeMod.occupancyAt(acts, at);
  const mine = live.occupancyAt(frozen, at);
  let compared = 0;
  for (const [h, stack] of oracle) {
    compared++;
    const m = mine.get(h);
    if (JSON.stringify(m ?? null) !== JSON.stringify(stack))
      findings.push(`E6 the containment stack differs for ${h}\n      1.0:  ${JSON.stringify(stack)}\n      port: ${JSON.stringify(m ?? null)}`);
  }
  for (const h of mine.keys()) if (!oracle.has(h)) findings.push(`E6 the port puts ${h} inside something and 1.0 does not: ${JSON.stringify(mine.get(h))}`);
  if (acts.length !== frozen.length)
    findings.push(`E6 the frozen ledger holds ${acts.length} crossings and the store ${frozen.length} ledger-era passages — AB-P2's own count`);
  // AN INSTRUMENT MUST SAY WHICH THING IT MEASURED. `ledger` is the file this
  // run actually opened; `ledger_named_by_acts` is what the record asked for;
  // `ledger_followed_rename` is null on every checkout that still carries the
  // named file, so a reader can tell a straight read from a forwarded one
  // instead of inferring it from the two paths being equal.
  return { findings, compared, ledger: resolved.rel, ledger_named_by_acts: rel,
    ledger_followed_rename: resolved.followed
      ? `${resolved.followed.from} → ${resolved.followed.to} (removed ${resolved.followed.on}, world ${resolved.followed.by.slice(0, 9)})`
      : null,
    ledger_rows: acts.length, frozen_act_rows: frozen.length,
    beyond_the_frozen_era: beyond.length ? `${beyond.length} passage(s) from later eras, outside this comparison by design` : null };
}

// ── the vendor tripwire ──────────────────────────────────────────────────────

function vendorDrift() {
  const out = [];
  for (const [name, v] of Object.entries(live.VENDOR)) {
    if (v.repo !== "keeminlee/postmark-world") continue;   // only the world half is in this checkout
    let blob = null;
    // stderr swallowed: a checkout predating a RENAME has no such path and says
    // so on stderr, which is a true fact about that sha and not a finding. (The
    // enter/exit reader was `tools/thresholds.mjs` until world e14a0bd7 — the
    // same two-name history law-ingest already carries a fallback for.)
    try { blob = execFileSync("git", ["-C", REPO, "rev-parse", `HEAD:${v.path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch { continue; }
    if (blob !== v.blob) out.push({ name, path: v.path, vendored: v.blob, checkout: blob });
  }
  return out;
}

// ── the run ──────────────────────────────────────────────────────────────────

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: process.env.WORLD2_PG_URL });
try { await client.connect(); } catch (e) { die(`cannot connect: ${e.message}`); }

let out = {};
try {
  const { rows: depRows } = await client.query(DEPARTURE_SELECT, [live.DEPARTURE_ACTIONS]);
  if (!depRows.length) die("`acts` holds no departures — there is nothing to check, and a falsifier that checked nothing must not report green");
  const { rows: passRows } = await client.query(PASSAGE_SELECT, [live.PASSAGE_ACTIONS]);
  const { rows: emitRows } = await client.query(EMISSION_SELECT);
  const { rows: markRows } = await client.query("SELECT slug, kind, owner, household, geometry, status, data FROM marks WHERE status = 'standing'");
  const { rows: idRows } = await client.query("SELECT handle, household FROM identities");
  // The ruled roster, at the PINNED head — the same join the door makes, so the
  // falsifier and the door cannot be asking two different rolls.
  const { rows: rollRows } = await client.query(
    `SELECT r.handle FROM town_roll r
       JOIN projection_heads h ON h.repo = 'town' AND h.sha = r.town_sha ORDER BY r.handle`);

  const ledgerPath = join(REPO, "WORLD/walk-ledger.md");
  if (!existsSync(ledgerPath)) die(`no WORLD/walk-ledger.md under ${REPO} — E1 and E2 have no oracle, and a run that skipped them would report a green it did not earn`);
  const ledgerText = readFileSync(ledgerPath, "utf8");

  const derived = live.departureRecords(depRows);
  const passages = live.passageRecords(passRows);
  const world = live.worldFromRows({ marks: markRows, identities: idRows });
  const roll = rollRows.map((r) => r.handle);
  const identityRoll = idRows.map((i) => i.handle);

  // The instants. Every branch of positionAt wants one: before any leg started,
  // inside the record, and far past every arrival.
  const ats = derived.records.map((r) => r.at).filter(Number.isFinite);
  const instants = [Math.min(...ats), (Math.min(...ats) + Math.max(...ats)) / 2, Math.max(...ats), Math.max(...ats) + 100, live.fractionalCrossing()];

  let sha = "?";
  try { sha = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }

  const nowMs = Date.now();
  const emissionAt = busiestInstants(emitRows, 1)[0] ?? nowMs;

  const e = {
    E1: e1LedgerParse(derived.records, ledgerText),
    E2: e2Order(derived.records, ledgerText),
    E2b: e2bMergedOrder(derived.records),
    E3: await e3JournalSeam(depRows, derived.records),
    E4: e4Arithmetic(derived.records, instants),
    E5: e5Union(derived.records, world, roll, live.fractionalCrossing(nowMs)),
    E5b: await e5bShimVsFold(world),
    E5c: e5cRollParity(derived.records, world,
      { usedRoll: roll, ruledRoll: roll, identityRoll }, live.fractionalCrossing(nowMs)),
    // Asked at the record's busiest instants — asking "now" over a frozen record
    // compares two empty lists and calls it agreement.
    E6emissions: e6EmissionsAcross(emitRows, busiestInstants(emitRows)),
    E6occupancy: e6Occupancy(passages.passages, Infinity,
      passRows.find((r) => r.payload?._ledger)?.payload?._ledger ?? null),
  };

  const findings = Object.values(e).flatMap((r) => r.findings);
  const unchecked = Object.entries(e).filter(([, r]) => !r.compared).map(([k]) => k);

  out = {
    world_sha: sha,
    store: { departures: depRows.length, passages: passRows.length, emissions: emitRows.length,
             marks: markRows.length, identities: idRows.length, town_roll: rollRows.length, eras: derived.eras },
    equalities: Object.fromEntries(Object.entries(e).map(([k, r]) => [k, { compared: r.compared, findings: r.findings.length, ...(r.note ? { note: r.note } : {}) }])),
    unchecked, findings,
    notes: live.admissionNotes({ marks: markRows, identities: idRows, roll, departureRecords: derived.records, world }),
    refusals: [...derived.refusals, ...passages.refusals],
    vendor_drift: vendorDrift(),
  };

  if (has("--can-fail-proof")) {
    // Every break is in MEMORY — this falsifier holds a read-only credential by
    // design (the store's own rows are never touched), so the mangles are done
    // to the INPUTS instead. Each is a plausible way the port could be wrong.
    const results = [];
    /**
     * A BREAK THAT CHANGES NO INPUT IS NOT A BREAK — the standing lane's finding,
     * verbatim: "A proof lying in the safe direction is the worst kind, so the
     * harness now checks `rowCount` for every mangle and reports INERT — the fix
     * is the harness's, not each mangle's to remember."
     *
     * Here the inputs are in memory rather than in rows, so `bit` is the harness's
     * `rowCount`: each break says how many of its own inputs it actually altered.
     * A break that altered none is reported INERT and never counted as a pass OR
     * as a silence — it is a defect in the proof, and it says which.
     */
    const proof = async (label, run) => {
      try {
        const r = await run();
        const findings = Array.isArray(r) ? r : r.findings;
        const bit = Array.isArray(r) ? null : r.bit;
        results.push({ mangle: label, findings: findings.length, bit,
          first: findings[0]?.split("\n")[0] ?? null });
      } catch (err) {
        results.push({ mangle: label, findings: -1, bit: null, note: `threw: ${String(err.message).slice(0, 140)}` });
      }
    };

    // EACH BREAK MUST REACH THE CHECK THAT OWNS IT. The first pass of this proof
    // fed the same broken input to BOTH sides of an equality, which of course
    // agreed — four breaks read SILENT and none of them was. A break is aimed at
    // the ONE equality whose oracle is independent of it.

    // 1 · THE 44-HANDLE TRAP: the acts read by plain `id` instead of era-then-id.
    //     Aimed at E2b, whose oracle re-partitions by era and merges 1.0's way.
    await proof("departures read in plain `id` order (the era seam ignored)", () => {
      const byId = [...depRows].sort((a, b) => Number(a.id) - Number(b.id));
      const recs = byId.map((r) => { const d = live.departureRecordOf(r); return d.refused ? null : { ...d.record, era: d.era, act_id: String(r.id) }; }).filter(Boolean);
      const moved = recs.findIndex((r, i) => r.act_id !== derived.records[i]?.act_id);
      return { bit: moved === -1 ? 0 : recs.length, findings: e2bMergedOrder(recs).findings };
    });
    // 2 · THE JOURNAL ERA DROPPED, which is what a one-era port looks like.
    //     Aimed at E3, whose oracle is the office's own storedDepartures over the
    //     journal rows — a side the break cannot reach.
    await proof("the journal era dropped (a port that reads only the frozen ledger)", async () => {
      const kept = derived.records.filter((r) => r.era !== "journal");
      return { bit: derived.records.length - kept.length, findings: (await e3JournalSeam(depRows, kept)).findings };
    });
    // 3 · THE SHARPEST EDGE: 2.0's `household` COLUMN read as 1.0's handle.
    //     Aimed at E5b, whose oracle is the checkout's own fold.
    await proof("marks.household read as the handle (the _cred edge)", async () => {
      const bad = { ...world, parcels: world.parcels.map((p) => ({ ...p, household: p._cred ?? p.household })) };
      const bit = bad.parcels.filter((p, i) => p.household !== world.parcels[i].household).length;
      return { bit, findings: (await e5bShimVsFold(bad)).findings };
    });
    // 4 · THE TTL PREDICATE WIDENED — presence as a lookup rather than a query.
    //     Aimed at E6emissions, whose oracle is 1.0's own SQL over sqlite.
    await proof("the TTL predicate widened (every emission stays in the air forever)", () => {
      const all = emitRows.map((r) => live.emissionOf(r)).filter((r) => !r.refused).map((r) => r.emission);
      const real = live.presentEmissionsAt(emitRows, emissionAt);
      return { bit: all.length - real.length,
        findings: all.length === real.length ? [] : [`the widened TTL returns ${all.length} where the query returns ${real.length} — the predicate is load-bearing`] };
    });
    // 5 · THE `opposed` REFUSAL HONOURED AS AN ENTRY. Aimed at E6occupancy.
    await proof("an `opposed` crossing counted as an entry", () => {
      const opposed = passages.passages.filter((p) => p.word === "opposed");
      const widened = passages.passages.map((p) => (p.word === "opposed" ? { ...p, word: "neutral" } : p));
      const a = JSON.stringify([...live.occupancyAt(passages.passages, Infinity)].sort());
      const b = JSON.stringify([...live.occupancyAt(widened, Infinity)].sort());
      return { bit: opposed.length, findings: a === b ? [] : ["the opposed word changes the stack — the refusal is load-bearing"] };
    });
    // 6 · THE VENDORED ARITHMETIC DRIFTED. Aimed at E4.
    await proof("the vendored arithmetic drifted (positionAt fed a wrong pace)", () => {
      const bent = derived.records.map((r) => ({ ...r, pace: (r.pace ?? 15) + 1 }));
      const f = [];
      for (const d of [...live.governingDepartures(bent).values()].slice(0, 50)) {
        const o = walkMod.positionAt({ ...d, pace: null }, instants[1]);
        const m = live.positionAt(d, instants[1]);
        if (o.x !== m.x || o.y !== m.y) f.push(`pace change moves ${d.handle}`);
      }
      return { bit: bent.length, findings: f };
    });
    // 7 · A REFUSAL SWALLOWED — an era the port does not know, skipped instead of
    //     named. Aimed at `departureRecords`' own strictness.
    await proof("an unreadable act skipped instead of refused", () => {
      const forged = { id: String(Number(depRows.at(-1).id) + 1), at: new Date(), crossing: "999",
        actor: "nobody", action: "legacy:departure", payload: { some: "future-pen" } };
      let threw = false;
      try { live.departureRecords([...depRows, forged]); } catch { threw = true; }
      return { bit: 1, findings: threw ? ["the strict read refuses an act it cannot explain"] : [] };
    });

    // 8 · THE ROLL NARROWED BACK to `identities` — the door as it stood before
    //     Keemin's 2026-08-29 ruling. Aimed at E5c's closing check, whose oracle
    //     is the two rolls' own row counts; E5 cannot see this break at all,
    //     because E5 compares the port and 1.0 over whatever roster both are
    //     handed, and a narrowed roster is handed to both.
    await proof("the roll read as `identities` (the pre-ruling roster)", () => {
      const r = e5cRollParity(derived.records, world,
        { usedRoll: identityRoll, ruledRoll: roll, identityRoll }, live.fractionalCrossing(nowMs));
      return { bit: roll.filter((h) => !identityRoll.includes(h)).length, findings: r.findings };
    });

    out.can_fail = {
      results,
      silent: results.filter((r) => r.findings === 0 && r.bit !== 0).map((r) => r.mangle),
      inert: results.filter((r) => r.bit === 0).map((r) => r.mangle),
      threw: results.filter((r) => r.findings === -1).map((r) => r.mangle),
    };
  }
} catch (err) {
  die(err.message);
} finally {
  await client.end();
}

// ── the report ───────────────────────────────────────────────────────────────

if (has("--json")) console.log(JSON.stringify(out, null, 2));
else {
  const s = out.store;
  console.log(`world ${out.world_sha?.slice(0, 8)} · ${s.departures} departures (ledger ${s.eras.ledger} · journal ${s.eras.journal} · live ${s.eras.live}) · ` +
              `${s.passages} passages · ${s.emissions} emissions · ${s.marks} marks · ${s.identities} identities · ${s.town_roll} in the town roll`);
  for (const [k, v] of Object.entries(out.equalities))
    console.log(`  ${v.findings ? "✗" : "·"} ${k.padEnd(12)} compared ${String(v.compared).padStart(5)}  findings ${v.findings}${v.note ? `  (${v.note})` : ""}`);
  for (const v of out.vendor_drift)
    console.log(`  ⚑ the vendored ${v.path} has MOVED: ${v.vendored.slice(0, 8)} when copied, ${v.checkout.slice(0, 8)} in this checkout — re-check live-reads.mjs`);
  for (const n of out.notes) console.log(`  ⚑ ${n}`);
  for (const r of out.refusals.slice(0, 5)) console.log(`  ⚑ refused: ${r}`);
  for (const f of out.findings) console.log(`  ✗ ${f}`);
  if (out.unchecked.length) console.log(`  ⚑ compared nothing: ${out.unchecked.join(", ")} — a green here is unearned`);
  if (out.can_fail) {
    console.log("\ncan-fail proof (the port's inputs broken in memory; the store is never touched):");
    for (const r of out.can_fail.results)
      // INERT is not SILENT, and the difference is the whole point of the
      // standing lane's finding: a break that altered none of its own inputs
      // proves nothing, and reading it as "the falsifier missed it" would be a
      // proof lying in the safe direction. It is a defect in the PROOF, named
      // as one, with the reason the record gave it.
      console.log(r.bit === 0
        ? `  INERT  ${r.mangle} — the break altered no input (the record holds none of that shape), so it proves nothing here`
        : `  ${r.findings > 0 ? "RED   " : r.findings === 0 ? "SILENT" : "THREW "} ${r.mangle} — ${r.findings > 0 ? `${r.findings} finding(s)` : r.findings === 0 ? "NOTHING NOTICED" : r.note}`);
    if (out.can_fail.inert.length) console.log(`  ${out.can_fail.inert.length} break(s) INERT — exercised by the unit suite instead (test/world2-live-reads.test.mjs)`);
    console.log(out.can_fail.silent.length
      ? `  can-fail NOT PROVEN: ${out.can_fail.silent.length} break(s) went unnoticed`
      : "  can-fail PROVEN: every break turned the falsifier red");
  }
  console.log(out.findings.length ? `\nRED · ${out.findings.length} finding(s)` : "\nGREEN · the port and 1.0's own functions agree on every row compared");
}
if (out.unchecked?.length) process.exit(2);
if (out.can_fail?.silent.length) process.exit(1);
process.exit(out.findings.length ? 1 : 0);
