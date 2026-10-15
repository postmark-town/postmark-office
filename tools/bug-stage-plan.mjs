#!/usr/bin/env node
// bug-stage-plan.mjs — the bug stage stamps the town owes, and the reviewed pass that pays them.
//
//   node tools/bug-stage-plan.mjs --town <town-clone>                        the plan: writes nothing, needs no key
//   node tools/bug-stage-plan.mjs --town <town-clone> --apply --key <pem> [--date YYYY-MM-DD] [--quiet]
//
//   env: WORLD2_PG_URL (or PG*), the office's own store — the plan reads the
//        bug class's acts from it, and nothing else.
//
// ── WHY IT EXISTS: THE ADVANCE RECORDS, A REVIEWED PASS WRITES ──────────────
//
// The Posts project, phase 2 (Keemin, 2026-09-29): "the first slice is the bug
// class plus a mint Wright reviews before it writes." An advance (src/bugs.mjs)
// records the stage, whom it credits and, at briefed and fixed, the grade or
// size. It mints nothing. This tool reads those acts, prints every stage the
// ladder pays with its amount and the reason, and — only with --apply, only
// by hand — calls the town's own `stamp-mint.mjs --stage-mint` once per owed
// row. IT RUNS ON THE TICK since 2026-10-07 (Darko: "the payment should just
// happen whenever it would naturally happen given it rides on the acceptance/
// updating of the state"): deploy/office-keep.sh calls it with --apply --quiet
// beside the welcome pass, so a stage pays within one tick of its advance. The
// advance is the gate — the Bug Catcher's for confirmed and reproduced, the
// founders' after — and the town's verb still refuses a second line per stage.
//
// ── WHAT DECIDES A ROW ──────────────────────────────────────────────────────
//
//   the ladder     src/bugs.mjs § BUG_LADDER; the town holds it again at the
//                  verb and at verify (stamp-mint.mjs § STAGE_LADDER), so an
//                  amount the two disagree on is refused, never written.
//   the meep law   the town's own: its ledger's `rules:` lines through its own
//                  `meepChecker`, imported from the town clone, so this plan
//                  and the town's verb cannot disagree about who is a meep on a
//                  given day. A meep's stage is recorded and pays 0.
//   the cap        three paid `confirmed` stages per household per week, Monday
//                  to Sunday in the town's time. The household is the store's
//                  resolver (household-deriver.mjs § houseOfVia): the declared
//                  house, `hh:<slug>` — never a GitHub id or a card username.
//                  A fourth is recorded and pays 0. Later stages are uncapped.
//   unresolved     a resident the resolver places in no house pays NOTHING
//                  (Wright's review of #257): the row says so, and a person
//                  binds them before the plan pays. Unresolved residents never
//                  share a cap bucket, because they have no household to share.
//   already paid   a `post:<id>/<stage>` line already in the town's ledger,
//                  read with the town's own classifier.
//
// The order is the act log's (act id), so the cap's first three are the first
// three confirmed, and a later run decides the same rows the same way.
//
// ── THE CORRECTIONS (POS-649, Darko 2026-10-15) ─────────────────────────────
//
// A `recredit` act (src/bugs.mjs § THE RECREDIT) says a paid stage went to the
// wrong resident. This pass owes it two town lines, written together by the
// town's own `--stage-recredit` verb or not at all: the stage's amount to the
// new credit (`post:<id>/<stage>-recredit`), and the wrong mint burned, named
// by its full signature. A row is owed only when the ledger holds the stage's
// line, paid to the resident the act corrects; the new credit is no meep and
// has a household; and the wrong recipient's LIQUID stamps cover the burn,
// counting every other burn this pass plans. Otherwise it is held and says why,
// and nothing is written: a burn is never partial and never from escrow. A
// town whose stamp-mint carries no correction grammar holds every one.
//
// ── THE PARSE IS BOUND (deploy/welcome-pass.mjs § THE PARSE IS BOUND) ────────
//
// --apply prints the plan, parses its own printed plan back, and refuses when
// the rows it parsed do not match the plan's own count, so a change to the
// plan's wording stops the pass instead of emptying it. Each owed row is one
// call of the town's verb, which refuses a second line for the same post and
// stage on its own, so a second --apply writes nothing twice over: the plan
// sees the lines as already paid, and the verb would refuse them if it did not.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BUG_CLASS, BUG_LADDER, CONFIRMED_CAP, STATE_CONFIRMED, stageAmount } from "../src/bugs.mjs";
import { ACT_ADVANCE, ACT_RECREDIT } from "../src/events.mjs";

const TZ = () => process.env.TOWN_TZ ?? "America/New_York";

/** The town's date for an instant, YYYY-MM-DD. */
export function townDate(at, tz = TZ()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(at));
}

/** The Monday that opens the town's week an instant falls in, YYYY-MM-DD. */
export function weekOf(at, tz = TZ()) {
  const day = townDate(at, tz);
  const d = new Date(`${day}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;   // Monday 0 … Sunday 6
  return new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}

const payloadOf = (a) => (typeof a.payload === "string" ? JSON.parse(a.payload) : (a.payload ?? {}));

/**
 * THE PLAN, PURE. `acts` are the bug class's acts, oldest first; `houseOf(handle)`
 * answers the household key, or null for a resident no house holds; `isMeep(handle, date)` the town's meep law;
 * `paid` the set of `<post>/<stage>` already in the town's ledger.
 *
 * Every paid stage an advance recorded is one row:
 *   { post, stage, handle, household, n, why, owed, act, date }
 * `n` is what the line would mint (0 for a meep or a capped report); `why` is
 * "owed", "already paid", "meep", "unresolved …" or "capped …"; `owed` is true only for a row
 * the pass should write.
 */
export function planStages({ acts, houseOf, isMeep, paid = new Set(), tz = TZ() }) {
  const rows = [];
  const confirmedPaid = new Map();   // `${household}|${week}` -> paid confirmed stages that week
  for (const a of acts) {
    if (a.action !== ACT_ADVANCE) continue;
    const p = payloadOf(a);
    const stage = p.to;
    if (!BUG_LADDER[stage]) continue;   // shipped and the side exits pay nothing and credit no one
    const handle = p.credit;
    const post = String(p.post ?? a.object);
    const date = townDate(a.at, tz);
    const household = houseOf(handle);
    const base = { post, stage, handle, household, act: Number(a.id), date };
    const n = stageAmount(stage, { size: p.fields?.size, grade: p.fields?.grade });
    if (isMeep(handle, date)) { rows.push({ ...base, n: 0, why: "meep: a meep never receives stamps", owed: false }); continue; }
    if (!household) {
      rows.push({ ...base, household: "(none)", n: 0, why: `unresolved: ${handle} has no household on record; a person binds them, then the plan pays`, owed: false });
      continue;
    }
    if (stage === STATE_CONFIRMED) {
      const k = `${household}|${weekOf(a.at, tz)}`;
      const used = confirmedPaid.get(k) ?? 0;
      if (used >= CONFIRMED_CAP) {
        rows.push({ ...base, n: 0, why: `capped: ${household} already has ${CONFIRMED_CAP} paid confirmed reports the week of ${weekOf(a.at, tz)}`, owed: false });
        continue;
      }
      confirmedPaid.set(k, used + 1);
    }
    if (paid.has(`${post}/${stage}`)) { rows.push({ ...base, n, why: "already paid", owed: false }); continue; }
    rows.push({ ...base, n, why: "owed", owed: true });
  }
  return rows;
}

/**
 * THE CORRECTIONS' PLAN, PURE (POS-649). `acts` as planStages has them;
 * `stageLines` Map("<post>/<stage>" → { handle, n, sig }) the ledger's stage
 * lines; `corrected` the "<post>/<stage>" already re-credited on the ledger;
 * `liquid` each handle's liquid balance (the town's foldBalances);
 * `canRecredit` whether the town carries --stage-recredit. One row per recredit
 * act: { post, stage, from, to, household, n, sig, hand, why, owed, act, date }.
 */
export function planRecredits({ acts, houseOf, isMeep, stageLines, corrected, liquid, canRecredit = true, tz = TZ() }) {
  const rows = [];
  const burning = new Map();   // handle -> stamps this pass already plans to burn from them
  for (const a of acts) {
    if (a.action !== ACT_RECREDIT) continue;
    const p = payloadOf(a);
    const post = String(p.post ?? a.object);
    const stage = p.to;
    const to = p.credit;
    const key = `${post}/${stage}`;
    const line = stageLines.get(key) ?? null;
    const base = { post, stage, from: line?.handle ?? p.was ?? "(none)", to, household: houseOf(to) ?? "(none)",
      n: line?.n ?? (Number(p.paid) || 0), sig: line?.sig ?? "(none)", hand: p.hand ?? a.actor, act: Number(a.id), date: townDate(a.at, tz) };
    const held = (why) => rows.push({ ...base, why, owed: false });
    if (corrected.has(key)) { rows.push({ ...base, why: "already corrected", owed: false }); continue; }
    if (!canRecredit) { held("held: this town's stamp-mint carries no correction grammar (--stage-recredit); nothing is burned or paid until it does"); continue; }
    if (!line) { held(`held: the ledger holds no stage line for post:${key}, so there is no mint to correct`); continue; }
    if (p.was && line.handle !== p.was) { held(`held: the act corrects ${p.was}, and the ledger paid ${line.handle}; a person reads both before anything burns`); continue; }
    if (line.handle === to) { held(`held: the ledger already paid ${to}`); continue; }
    if (isMeep(to, base.date)) { held("meep: a meep never receives stamps, so nothing is paid and nothing is burned"); continue; }
    if (!houseOf(to)) { held(`unresolved: ${to} has no household on record; a person binds them, then the pass corrects`); continue; }
    const left = (liquid.get(line.handle) ?? 0) - (burning.get(line.handle) ?? 0);
    if (left < line.n) { held(`held: ${line.handle} holds ${left} liquid stamp(s) and the burn is ${line.n}; a correction burns liquid stamps only, never escrow`); continue; }
    burning.set(line.handle, (burning.get(line.handle) ?? 0) + line.n);
    rows.push({ ...base, why: "owed", owed: true });
  }
  return rows;
}

// ── the plan, printed ───────────────────────────────────────────────────────

const HEADER_RE = /^bug stage plan — (\d+) paid stage\(s\) recorded, (\d+) already paid, (\d+) pay nothing, (\d+) owed \((\d+) stamps\)$/;
const ROW = (r) => `  ${r.post}/${r.stage} · ${r.handle} · ${r.household} · ${r.n} · ${r.why} · act ${r.act} on ${r.date}`;
const OWED_RE = /^ {2}(\S+)\/(confirmed|reproduced|diagnosed|briefed|fixed) · (\S+) · (\S+) · (\d+) · owed · act (\d+) on (\d{4}-\d{2}-\d{2})$/;

/** The plan as a person reads it: the header's counts, then OWED, ALREADY PAID and PAYS NOTHING. */
export function renderPlan(rows) {
  const owed = rows.filter((r) => r.owed);
  const already = rows.filter((r) => !r.owed && r.why === "already paid");
  const nothing = rows.filter((r) => !r.owed && r.why !== "already paid");
  const out = [`bug stage plan — ${rows.length} paid stage(s) recorded, ${already.length} already paid, ${nothing.length} pay nothing, ${owed.length} owed (${owed.reduce((s, r) => s + r.n, 0)} stamps)`];
  for (const [title, list] of [["OWED", owed], ["ALREADY PAID", already], ["PAYS NOTHING", nothing]]) {
    if (!list.length) continue;
    out.push("", title, ...list.map(ROW));
  }
  return `${out.join("\n")}\n`;
}

/**
 * The plan, read back. PURE. Throws on a plan it cannot account for — the
 * alternative is an empty owed list, which reads as "nothing owed" everywhere
 * downstream and would have the pass report success forever.
 */
export function parseStagePlan(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const header = lines.map((l) => HEADER_RE.exec(l.trim())).find(Boolean);
  if (!header) throw new Error("bug-stage-plan: the plan printed no header this pass can read — the wording changed, and the parser must be trued to it before the pass runs again");
  const claimed = Number(header[4]);
  const start = lines.indexOf("OWED");
  const owed = [];
  if (start !== -1) {
    for (const line of lines.slice(start + 1)) {
      if (line.trim() === "") break;
      const m = OWED_RE.exec(line);
      if (!m) throw new Error(`bug-stage-plan: unreadable owed row: ${JSON.stringify(line)}`);
      owed.push({ post: m[1], stage: m[2], handle: m[3], household: m[4], n: Number(m[5]), act: Number(m[6]), date: m[7] });
    }
  }
  // ⚑ THE BIND. The plan's own number against the rows parsed.
  if (owed.length !== claimed)
    throw new Error(`bug-stage-plan: the plan says ${claimed} owed and this pass parsed ${owed.length} — refusing to mint a set it cannot fully account for`);
  return { owed, claimed };
}

const RC_HEADER_RE = /^bug recredit plan — (\d+) recredit\(s\) recorded, (\d+) already corrected, (\d+) held, (\d+) owed \((\d+) stamps\)$/;
const RC_ROW = (r) => `  ${r.post}/${r.stage} · ${r.from} → ${r.to} · ${r.household} · ${r.n} · ${r.why} · by ${r.hand} · burns ${r.sig} · act ${r.act} on ${r.date}`;
const RC_OWED_RE = /^ {2}(\S+)\/(diagnosed|briefed|fixed) · (\S+) → (\S+) · (\S+) · (\d+) · owed · by (\S+) · burns ([A-Za-z0-9_-]{86}) · act (\d+) on (\d{4}-\d{2}-\d{2})$/;

/** The corrections' plan as a person reads it; empty when no recredit was recorded. */
export function renderRecredits(rows) {
  if (!rows.length) return "";
  const owed = rows.filter((r) => r.owed);
  const done = rows.filter((r) => !r.owed && r.why === "already corrected");
  const held = rows.filter((r) => !r.owed && r.why !== "already corrected");
  const out = [`bug recredit plan — ${rows.length} recredit(s) recorded, ${done.length} already corrected, ${held.length} held, ${owed.length} owed (${owed.reduce((s, r) => s + r.n, 0)} stamps)`];
  // ALREADY CORRECTED last: the quiet tick prints what is above it, never the corrected past
  for (const [title, list] of [["RECREDIT OWED", owed], ["RECREDIT HELD", held], ["ALREADY CORRECTED", done]]) {
    if (!list.length) continue;
    out.push("", title, ...list.map(RC_ROW));
  }
  return `${out.join("\n")}\n`;
}

/**
 * The corrections' plan, read back, PURE, under the same bind as the stages':
 * a plan that recorded recredits and printed no header this can read, or whose
 * owed count is not the rows parsed, refuses rather than burning a set it
 * cannot account for.
 */
export function parseRecreditPlan(text, { recorded }) {
  const lines = String(text ?? "").split(/\r?\n/);
  const header = lines.map((l) => RC_HEADER_RE.exec(l.trim())).find(Boolean);
  if (!header) {
    if (recorded) throw new Error("bug-stage-plan: the plan recorded recredits and printed no recredit header this pass can read — the wording changed, and the parser must be trued to it before the pass runs again");
    return { owed: [], claimed: 0 };
  }
  const claimed = Number(header[4]);
  const start = lines.indexOf("RECREDIT OWED");
  const owed = [];
  if (start !== -1) {
    for (const line of lines.slice(start + 1)) {
      if (line.trim() === "") break;
      const m = RC_OWED_RE.exec(line);
      if (!m) throw new Error(`bug-stage-plan: unreadable recredit row: ${JSON.stringify(line)}`);
      owed.push({ post: m[1], stage: m[2], from: m[3], to: m[4], household: m[5], n: Number(m[6]), hand: m[7], sig: m[8], act: Number(m[9]), date: m[10] });
    }
  }
  if (owed.length !== claimed)
    throw new Error(`bug-stage-plan: the recredit plan says ${claimed} owed and this pass parsed ${owed.length} — refusing to burn a set it cannot fully account for`);
  return { owed, claimed };
}

// ── the town's engine, read from its own clone ──────────────────────────────

/** The town's classifier and meep law, imported from the clone — or a refusal naming what is missing. */
export async function townEngine(town) {
  const tool = join(town, "tools", "stamp-mint.mjs");
  if (!existsSync(tool)) throw new Error(`bug-stage-plan: no tools/stamp-mint.mjs in ${town} — --town names the town clone`);
  const engine = await import(pathToFileURL(tool).href);
  if (typeof engine.stageMintLine !== "function" || !engine.STAGE_LADDER)
    throw new Error("bug-stage-plan: this town's stamp-mint.mjs has no stage grammar (post:<id>/<stage>), so the plan cannot see what is already paid — the town must carry --stage-mint first");
  const ledgerFile = join(town, "WHITE_PAGES", "stamp-ledger.md");
  const entries = existsSync(ledgerFile) ? engine.parseStampLedger(readFileSync(ledgerFile, "utf8")) : [];
  const { laws } = engine.parseLaws(entries);
  const meep = engine.meepChecker(laws);
  const paid = new Set();
  const stageLines = new Map();   // "<post>/<stage>" -> { handle, n, sig }: the line a correction would burn (POS-649)
  const corrected = new Set();    // "<post>/<stage>" already re-credited on the ledger
  for (const e of entries) {
    const c = engine.classifyEntry(e.canonical);
    if (c.kind === "post-stage") { paid.add(`${c.post}/${c.stage}`); stageLines.set(`${c.post}/${c.stage}`, { handle: c.handle, n: c.n, sig: e.sig }); }
    if (c.kind === "post-recredit") corrected.add(`${c.post}/${c.stage}`);
  }
  // The ladder is held twice (the class law here, the money law there); say so if they part.
  for (const [stage, rung] of Object.entries(BUG_LADDER)) {
    const ours = rung.by ? Object.values(rung.n) : [rung.n];
    const theirs = engine.STAGE_LADDER[stage] ?? [];
    if (ours.length !== theirs.length || ours.some((n) => !theirs.includes(n)))
      throw new Error(`bug-stage-plan: the office's ladder pays ${stage} ${ours.join("/")} and the town's ${theirs.join("/") || "nothing"} — refusing until they agree`);
  }
  return { isMeep: (h, d) => meep(h, d), paid, stageLines, corrected, liquid: engine.foldBalances(entries),
    canRecredit: typeof engine.stageRecreditLines === "function" };
}

/**
 * The bug class's acts and each credited resident's household, from the office's
 * store. The household is the resolver's own answer (`houseOfVia`), not
 * `householdKeyFor`'s, because that one answers `solo:<handle>` for a resident
 * no house holds, and an unresolved resident must stay unresolved here (null).
 */
export async function storeFacts({ env = process.env } = {}) {
  const { officeRead } = await import("../src/world2-pen.mjs");
  const { houseOfVia } = await import("../src/household-deriver.mjs");
  return officeRead(async (client) => {
    const { rows } = await client.query(
      "SELECT id, actor, action, object, payload, at FROM acts WHERE class = $1 ORDER BY id", [BUG_CLASS]);
    const houses = new Map();
    for (const a of rows) {
      if (a.action !== ACT_ADVANCE && a.action !== ACT_RECREDIT) continue;
      const h = payloadOf(a).credit;
      if (h && !houses.has(h)) { const { slug } = await houseOfVia(client, h); houses.set(h, slug ? `hh:${slug}` : null); }
    }
    return { acts: rows, houses };
  }, { env });
}

/** The town's own verb, by absolute path, handed --repo explicitly (welcome-pass.mjs § mintArgv, for the same reasons). */
export const stageMintArgv = (town, r, { date, keyPath }) => [join(town, "tools", "stamp-mint.mjs"),
  "--stage-mint", r.handle, "--post", r.post, "--stage", r.stage, "--amount", String(r.n), "--date", date, "--key", keyPath, "--repo", town];

/** The town's correction verb (POS-649): both lines or neither, with the plan's amount and wrong recipient as binds. */
export const stageRecreditArgv = (town, r, { date, keyPath }) => [join(town, "tools", "stamp-mint.mjs"),
  "--stage-recredit", r.to, "--post", r.post, "--stage", r.stage, "--by", r.hand, "--amount", String(r.n), "--from", r.from,
  "--date", date, "--key", keyPath, "--repo", town];

const run = (town, argv) => spawnSync(process.execPath, argv, { cwd: town, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const arg = (name, argv) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };

/**
 * The whole pass. `facts` and `spawn` are injectable so a suite drives the same
 * path in-process against a stub store and a synthetic town.
 */
export async function main(argv = process.argv.slice(2), { facts = null, spawn = run, log = console.log, err = console.error, env = process.env } = {}) {
  const town = arg("--town", argv);
  const apply = argv.includes("--apply");
  const keyPath = arg("--key", argv);
  if (!town || !existsSync(town)) { err("bug-stage-plan: --town <town-clone> is required and must exist"); return 1; }
  if (apply && (!keyPath || !existsSync(keyPath))) { err("bug-stage-plan: --apply needs --key <ed25519-private-pem>"); return 1; }

  let engine;
  let store;
  try {
    engine = await townEngine(town);
    store = facts ?? await storeFacts({ env });
  } catch (e) { err(String(e?.message ?? e)); return 1; }
  const houseOf = (h) => store.houses.get(h) ?? null;
  const rows = planStages({ acts: store.acts, houseOf, isMeep: engine.isMeep, paid: engine.paid });
  const text = renderPlan(rows);
  const rcRows = planRecredits({ acts: store.acts, houseOf, isMeep: engine.isMeep, stageLines: engine.stageLines ?? new Map(),
    corrected: engine.corrected ?? new Set(), liquid: engine.liquid ?? new Map(), canRecredit: engine.canRecredit !== false });
  const rcText = renderRecredits(rcRows);
  // --quiet (the tick's): the header and what this run pays, never the paid
  // past, which grows with every stage and would fill the journal each tick.
  // The parse below always reads the whole plan.
  if (argv.includes("--quiet")) {
    const owedOnly = text.split("\n\nALREADY PAID")[0].split("\n\nPAYS NOTHING")[0];
    if (rows.some((r) => r.owed)) log(owedOnly.trimEnd());
    if (rcRows.some((r) => r.owed || r.why !== "already corrected")) log(rcText.split("\n\nALREADY CORRECTED")[0].trimEnd());
  } else { log(text.trimEnd()); if (rcText) log(rcText.trimEnd()); }
  if (!apply) { log("[bug-stage-plan] the plan only — nothing written, nothing signed. Review it, then --apply."); return 0; }

  // The two binds stand apart: a recredit plan this pass can't read holds the
  // corrections, never the stage pay beside them.
  let parsed, rcParsed;
  try { parsed = parseStagePlan(text); } catch (e) { err(e.message); return 1; }
  let rcBroken = false;
  try { rcParsed = parseRecreditPlan(rcText, { recorded: rcRows.length > 0 }); }
  catch (e) { err(e.message); rcParsed = { owed: [], claimed: 0 }; rcBroken = true; }
  if (!parsed.owed.length && !rcParsed.owed.length) { if (!argv.includes("--quiet") && !rcBroken) log("[bug-stage-plan] nothing owed"); return rcBroken ? 1 : 0; }
  const date = arg("--date", argv) ?? townDate(Date.now());
  const refused = [];
  for (const r of parsed.owed) {
    // ONLY the rows the plan named, one line each, through the town's own verb.
    const out = spawn(town, stageMintArgv(town, r, { date, keyPath }));
    if (out.status === 0) log(`[bug-stage-plan] minted ${r.n} → ${r.handle} · post:${r.post}/${r.stage}`);
    else {
      const why = (out.stderr ?? "").trim().split(/\r?\n/)[0] || `exit ${out.status}`;
      err(`[bug-stage-plan] REFUSED post:${r.post}/${r.stage} → ${r.handle} — ${why}`);
      refused.push(r);
    }
  }
  // THE CORRECTIONS (POS-649): one call each, both lines or neither, the plan's
  // amount and wrong recipient handed over as binds the town checks again.
  const rcRefused = [];
  for (const r of rcParsed.owed) {
    const out = spawn(town, stageRecreditArgv(town, r, { date, keyPath }));
    if (out.status === 0) log(`[bug-stage-plan] re-credited ${r.n} → ${r.to} · post:${r.post}/${r.stage}-recredit, and burned ${r.from}'s ${r.n} (correction:${r.sig.slice(0, 16)}…)`);
    else {
      const why = (out.stderr ?? "").trim().split(/\r?\n/)[0] || `exit ${out.status}`;
      err(`[bug-stage-plan] REFUSED the correction of post:${r.post}/${r.stage} (${r.from} → ${r.to}) — ${why}`);
      rcRefused.push(r);
    }
  }
  if (refused.length || rcRefused.length || rcBroken) {
    err(`[bug-stage-plan] ${parsed.owed.length - refused.length} of ${parsed.owed.length} stage line(s) and ${rcParsed.owed.length - rcRefused.length} of ${rcParsed.owed.length} correction(s) written; the town refused the rest — each stays owed, and the next reviewed pass names it again`);
    return 1;
  }
  log(`[bug-stage-plan] ${parsed.owed.length} stage line(s)${rcParsed.owed.length ? ` and ${rcParsed.owed.length} correction(s) (two lines each)` : ""} written — run the town's stamp-verify, then commit the ledger`);
  return 0;
}

// Script only when run as one (the realpath compare: deploy/welcome-pass.mjs § entry guard).
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exit(await main());
