// hearth-joins.mjs — the keeping tick's step that puts a merged Hearth design on the Hearth ballot, and queues its entry pay (STAR-237).
//
//   node deploy/hearth-joins.mjs --town <clone> --owed <file> [--topic hearth-default]
//   node deploy/hearth-joins.mjs --town <clone> --dry [--topic hearth-default]       what it would amend and raise; writes nothing
//
// ── WHY IT EXISTS (Darko, 2026-11-22) ────────────────────────────────────────
//
// "for the ballot, why doesn't it automatically appear?" and, on automating it, "yes pleae". Two merged designs (#4786, #4802)
// were not on the ballot, and the hearth-entry pay had never run (paid by hand that day, POS-985). Wright's fit, same day: "queue,
// not run. POS-632's hand-reviewed pass stands for the Hearth quest too, and the owed row with the digest is right. One change to
// item 1: add the choice through the ballot's own amend door (town_amend, the office pen as one of the town's hands), not by
// writing the JSON directly, so every addition lands in the act log as today's did (act 59699)."
//
// ── 1 · THE JOINS ────────────────────────────────────────────────────────────
//
// The registered entries are the quest pass's own (tools/quest-pay-plan.mjs § hearthEntries, the rule the site's sync-hearths.mjs
// reads too): a folder of PROJECTS/household-hearths on the town clone's main holding a hearth.html, not named in capitals. Each
// whose name is not yet a candidate of the ballot, and whose hearth.md names an author bound to a resident (the
// quest pass's own binding, housesFromRoll), joins at the END of the ballot, all in one amend act:
//
//   ballotActInStore("amend", { post: "postmark-pen/ballot-hearth-default", choices: [{ name, credit, link, note }] })
//
// the same code the town door runs (src/ballot-acts.mjs), in this process, under the tick's town lock, acting as the office's own
// hand, MACHINE_HANDS[0], which only this call may name (src/ballots.mjs). The act writes the ballot file and the post together
// and lands the town commit, so the act log, the file and the post are one truth. Nothing here writes the JSON. A name already a
// candidate is untouched (its words are never replaced), and nothing is ever removed or moved. A design whose author is bound to
// no resident (the town's own, or a typo) is skipped and named; a ballot that is closed takes none. THE WINDOW (the ballot's own
// words, "New designs join through Sun 6 Dec; …", STAR-237: "only while new designs may join"): a design joins only if (a) its merge
// day (New York) is on or before the join-through day AND (b) the run day (New York) is on or before join-through + 1 day, the one
// day's grace so a merge late on the last day is still added by the first ticks after it. From the day after that nothing joins,
// whatever its merge day.
//
//   credit  the author line of hearth.md as written (a resident's handle, or the household's slug), the words today's by-hand
//           additions carried; the BINDING decides whether the design joins at all
//   link    https://github.com/postmark-town/postmark/tree/main/PROJECTS/household-hearths/<name>
//   note    the first paragraph of hearth.md's body (what the site shows), one line, cut to 200 characters
//   added   the town day, set by the act itself
//
// ── 2 · THE PAY, QUEUED, NEVER RUN ──────────────────────────────────────────
//
// The hearth-entry quest is paid by a hand-reviewed pass (POS-632): tools/quest-pay-plan.mjs refuses the tick on purpose, and this
// step never signs, mints or applies. It builds the SAME plan from the SAME functions (no key, nothing written to the town), and
// when lines are owed it raises ONE row for the operator: a file (--owed, beside the tick's receipt log) holding every owed entry,
// its household, the stamps, the plan's digest and the command that applies exactly that plan. The receipt says `ok owed:hearth_entry`
// (deploy/keep-history.mjs). With nothing owed the file is rewritten empty, so a stale row never reads as a live one.
//
// Exit: 0 nothing owed · 4 owed, the row raised (the tick's step is still ok) · 1 something was refused (named above it) · 2 usage.

import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  QUEST_SOURCES, townEngine, hearthEntries, townHouseholds, housesFromRoll, hearthItems, planQuestPays, planDigest, renderPlan,
  renderApplyHint, questOpen,
} from "../tools/quest-pay-plan.mjs";
import { townDate } from "../tools/bug-stage-plan.mjs";
import { ballotFileName, ballotFromFile, ballotPostId, judgeActChoices, MACHINE_HANDS, STATE_SUBMISSIONS, STATE_STAKING, TOPIC_RE } from "../src/ballots.mjs";

export const QUEST = "hearth-entry";
export const TOPIC = "hearth-default";
/** The hand this step acts as, in the act log: the office's own, automatic (MACHINE_HANDS in src/ballots.mjs). */
export const HAND = MACHINE_HANDS[0];
export const NOTE_MAX = 200;
const KEY_PATH = "/srv/postmark-office/stamp-key.pem";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const ymd = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

/**
 * The last day a design may join, from the ballot's own window words ("New designs join through Sun 6 Dec; staking closes Sun 13 Dec"):
 * YYYY-MM-DD; `null` when the window carries no such phrase or one that does not read (a weekday that is not that date's, a day
 * that does not exist). The year is the one the ballot began in (`floor`, its earliest choice's day), moving to the next when the
 * date would otherwise fall before it, so the answer never drifts with the clock. PURE.
 */
export function joinThrough(window, floor) {
  const m = /\bjoins?\s+through\s+(?:(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s+)?(\d{1,2})\s+([a-z]{3})[a-z]*\.?(?:,?\s+(\d{4}))?/i.exec(String(window ?? ""));
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(String(floor ?? ""))) return null;
  const mon = MONTHS.indexOf(m[3].toLowerCase());
  const day = Number(m[2]);
  if (mon < 0 || day < 1) return null;
  const at = (y) => new Date(Date.UTC(y, mon, day));
  let year = m[4] ? Number(m[4]) : Number(floor.slice(0, 4));
  let t = at(year);
  if (t.getUTCMonth() !== mon) return null;
  if (!m[4] && ymd(t) < floor) { year += 1; t = at(year); if (t.getUTCMonth() !== mon) return null; }
  if (m[1] && DOW[t.getUTCDay()] !== m[1].toLowerCase()) return null;
  return ymd(t);
}

/** The day after a YYYY-MM-DD day. PURE. */
export const dayAfter = (day) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return ymd(d); };

/** A design's one line for the ballot: control characters out, whitespace collapsed, cut to NOTE_MAX (at a word, with an ellipsis, when it is longer). PURE. */
export function noteOf(line) {
  // eslint-disable-next-line no-control-regex
  const s = String(line ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(s);
  if (chars.length <= NOTE_MAX) return s;
  const head = chars.slice(0, NOTE_MAX - 1).join("");
  const sp = head.lastIndexOf(" ");
  return `${(sp > NOTE_MAX / 2 ? head.slice(0, sp) : head).replace(/[\s,;:.\-–—]+$/, "")}…`;
}

/**
 * Who joins. `ballot` is ballotFromFile's answer ({ state, fields: { candidates, window, choices } }); `entries` are hearthEntries'
 * rows; `houseOf` is the quest pass's housesFromRoll for the day; `today` the town day. Answers
 * `{ open, through, joins: [{ name, credit, link, note, merged }], skipped: [{ name, why }], refused: [{ name, why }] }`:
 * `skipped` are by design (already on it, no resident, not an entry, outside the window), `refused` are designs that should join and
 * cannot (a name the ledger cannot carry), which a hand has to look at. Oldest merge first, then by name. PURE.
 */
export function planJoins({ ballot, entries, houseOf, today }) {
  const out = { open: false, through: null, joins: [], skipped: [], refused: [] };
  if (!ballot) { out.why = "no ballot"; return out; }
  if (![STATE_SUBMISSIONS, STATE_STAKING].includes(ballot.state)) { out.why = `the ballot stands ${ballot.state}: nothing joins it now`; return out; }
  const have = new Set(ballot.fields.candidates ?? []);
  const window = ballot.fields.window;
  const floor = Object.values(ballot.fields.choices ?? {}).map((c) => c?.added).filter(Boolean).sort()[0] ?? today;
  if (window != null && String(window).trim() !== "") {
    out.through = joinThrough(window, floor);
    if (!out.through) { out.why = `the ballot's window ("${window}") names no day new designs join through that this step can read`; out.unreadable = true; return out; }
  }
  out.open = true;
  const ordered = [...entries].sort((a, b) => `${a.date ?? ""}\t${a.id}`.localeCompare(`${b.date ?? ""}\t${b.id}`));
  for (const e of ordered) {
    const name = e.id;
    if (have.has(name)) continue; // already a candidate: untouched, and not worth a line every tick
    if (e.problem) { out.skipped.push({ name, why: e.problem }); continue; }
    if (out.through && e.date > out.through) { out.skipped.push({ name, why: `merged ${e.date}, after the join window closed on ${out.through}` }); continue; }
    if (out.through && today > dayAfter(out.through)) { out.skipped.push({ name, why: `the run day ${today} is past the join window (through ${out.through}, with one day's grace for a late merge)` }); continue; }
    const house = houseOf({ author: e.author });
    if (!house) { out.skipped.push({ name, why: e.author ? `its author "${e.author}" is bound to no resident here` : "its hearth.md names no author" }); continue; }
    if (house.refuse) { out.skipped.push({ name, why: house.refuse }); continue; }
    const choice = { name, credit: String(e.author).trim(), link: `https://github.com/${QUEST_SOURCES[QUEST].owner}/${QUEST_SOURCES[QUEST].repo}/tree/main/${QUEST_SOURCES[QUEST].dir}/${name}`,
      ...(noteOf(e.line) ? { note: noteOf(e.line) } : {}) };
    try { judgeActChoices([choice]); } catch (x) { out.refused.push({ name, why: `${x.defect ?? x.message}${x.hint ? ` (${x.hint})` : ""}` }); continue; }
    out.joins.push({ ...choice, merged: e.date });
  }
  return out;
}

/**
 * The ONE row for the operator, from the pass's own plan: every owed entry with its household, the stamps, the digest, and the command that
 * applies exactly that plan. `null` when nothing is owed. PURE.
 */
export function owedRowOf({ rows, digest, date, town, quest = QUEST, raised }) {
  const owed = rows.filter((r) => r.owed);
  if (!owed.length) return null;
  return {
    v: 1, kind: "owed-quest-pay", quest, date, digest, stamps: owed.reduce((s, r) => s + r.n, 0),
    entries: owed.map((r) => ({ ref: r.ref, handle: r.handle, household: r.household, n: r.n, author: r.author, merged: r.date, link: r.link })),
    plan: renderPlan(rows, { date, quest }).trimEnd(),
    apply: renderApplyHint(digest, { town, quest, discussion: null, date, keyPath: KEY_PATH, rejected: new Set() }).trimEnd().split("\n").at(-1).trim(),
    note: "owed, not paid: a hand opens each entry and runs the apply by hand (POS-632); the tick never does",
    raised,
  };
}

const sameRow = (a, b) => JSON.stringify([a?.quest, a?.date, a?.digest, a?.entries]) === JSON.stringify([b?.quest, b?.date, b?.digest, b?.entries]);

/** Write the owed file whole, atomically (a rename over the old one). The previous row's content decides whether anything is written. */
function writeOwed(file, row, { quest, date, now }) {
  let before = null;
  try { before = JSON.parse(readFileSync(file, "utf8")); } catch { /* no file, or one that does not read: it is rewritten */ }
  const next = row ?? { v: 1, kind: "owed-quest-pay", quest, date, digest: null, stamps: 0, entries: [], cleared: new Date(now).toISOString() };
  if (!row && (!before || !(before.entries?.length > 0))) return "none"; // nothing owed and nothing stale to clear: no file is made for it
  if (row && before && sameRow(before, row)) return "same";
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, file);
  return row ? "raised" : "cleared";
}

/** One run. `act(choices)` and the facts are injectable; the defaults are the real thing. Returns the exit code. */
export async function run({ town, owedFile = null, dry = false, topic = TOPIC, now = Date.now(), today = townDate(now), env = process.env, log = console.log, err = console.error, facts = null, act = null } = {}) {
  const tag = "[hearth-joins]";
  const source = QUEST_SOURCES[QUEST];
  let rc = 0;
  let engine, entries, households;
  try {
    engine = await townEngine(town, QUEST);
    entries = facts?.entries ?? hearthEntries(town, source);
    households = facts?.households ?? townHouseholds(town);
  } catch (e) { err(`${tag} cannot read the town's Hearth entries: ${String(e?.message ?? e).split("\n")[0]}`); return 1; }
  const houseOf = housesFromRoll(households, { keyOf: engine.keyOf, hasRoom: engine.hasRoom, date: today });

  // ── 1 · the joins
  const file = join(town, "WHITE_PAGES", ballotFileName(topic));
  let ballot = null;
  try { ballot = existsSync(file) ? ballotFromFile(JSON.parse(readFileSync(file, "utf8")), topic) : null; }
  catch (e) { err(`${tag} the ballot file does not read: ${e.defect ?? e.message}`); rc = 1; }
  if (ballot || rc === 0) {
    const plan = planJoins({ ballot, entries, houseOf, today });
    if (plan.why) (plan.unreadable ? err : log)(`${tag} ${plan.why}`);
    if (plan.unreadable) rc = 1;
    for (const s of plan.skipped) log(`${tag} not joining ${s.name}: ${s.why}`);
    for (const r of plan.refused) { err(`${tag} CANNOT join ${r.name}: ${r.why}`); rc = 1; }
    if (plan.open && !plan.joins.length && !plan.refused.length) log(`${tag} the ballot "${topic}" has every merged design (window ${plan.through ? `open through ${plan.through}` : "carries no date"})`);
    if (plan.joins.length) {
      const names = plan.joins.map((j) => j.name).join(", ");
      const choices = plan.joins.map(({ name, credit, link, note }) => ({ name, credit, link, ...(note ? { note } : {}) }));
      if (dry) {
        log(`${tag} DRY: would amend ${ballotPostId(topic)} as ${HAND}'s hand, adding ${plan.joins.length} choice(s) at the end: ${names}`);
        for (const c of choices) log(`${tag}   ${c.name} · credit ${c.credit} · ${c.link}\n${tag}     "${c.note ?? ""}"`);
      } else {
        try {
          const answer = await (act ?? defaultAct)({ town, topic, choices, today, now, env });
          log(`${tag} ${answer.receipt ?? `amended ${ballotPostId(topic)}`}: ${names}${answer.act_ids ? ` (act ${answer.act_ids.join(", ")})` : ""}${answer.commit ? ` · town commit ${String(answer.commit.sha ?? answer.commit).slice(0, 9)}` : ""}`);
        } catch (e) {
          err(`${tag} the amend was refused: ${e.defect ?? e.message}${e.hint ? ` — ${e.hint}` : ""}; nothing was written, the next tick asks again`);
          rc = 1;
        }
      }
    }
  }

  // ── 2 · the pay, planned and queued, never run
  let owed = null;
  try {
    if (!questOpen(engine.terms, today)) log(`${tag} ${QUEST} is not open on ${today} (the town's QUEST_PAY): no pay is planned`);
    else {
      const items = hearthItems(entries, { source });
      const rows = planQuestPays({ items, quest: QUEST, terms: engine.terms, houseOf,
        isMeep: engine.isMeep, paid: engine.paid, lineOf: engine.lineOf, date: today, rejected: new Set() });
      const digest = planDigest(rows);
      owed = owedRowOf({ rows, digest, date: today, town, raised: new Date(now).toISOString() });
      log(`${tag} the ${QUEST} plan for ${today}: ${rows.filter((r) => r.owed).length} owed, digest ${digest}`);
      if (owed) {
        for (const e of owed.entries) log(`${tag}   OWED ${e.ref} · ${e.handle} · ${e.household} · ${e.n} · by ${e.author}, merged ${e.merged}`);
        log(`${tag}   to pay, by hand after reading each entry: ${owed.apply}`);
      }
    }
    if (!dry && owedFile) {
      const did = writeOwed(owedFile, owed, { quest: QUEST, date: today, now });
      if (did !== "none" && did !== "same") log(`${tag} the owed row is ${did} in ${owedFile}`);
    } else if (dry && owed) log(`${tag} DRY: would raise one owed row${owedFile ? ` in ${owedFile}` : ""}`);
  } catch (e) { err(`${tag} the ${QUEST} plan could not be read or its row written: ${String(e?.message ?? e).split("\n")[0]}`); rc = 1; }
  if (rc) return rc;
  return owed ? 4 : 0;
}

/** The town door's own amend act, in this process, as the office's hand (the tick holds the town lock; the clone is freshly pulled). */
async function defaultAct({ town, topic, choices, today, now, env }) {
  const { penTransaction } = await import("../src/write.mjs");
  const { ballotActInStore } = await import("../src/ballots-store.mjs");
  const commit = { message: (a) => `ballot: ${a.topic} · ${a.did.join(" + ")} (by ${HAND}'s hand, via postmark-office: a merged Hearth design joins, STAR-237)` };
  const out = await penTransaction(town, () => ballotActInStore({ clone: town, verb: "amend", args: { post: ballotPostId(topic), choices }, hand: HAND, today, commit, machineHand: true, now, env }));
  return { ...out, receipt: `amended ${out.post?.id ?? ballotPostId(topic)} by ${HAND}'s hand`, commit: out.commit ?? null };
}

function arg(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; }

export async function main(argv = process.argv.slice(2), env = process.env) {
  const town = arg(argv, "--town");
  const topic = arg(argv, "--topic") ?? TOPIC;
  const dry = argv.includes("--dry");
  const owedFile = arg(argv, "--owed");
  if (!town || !TOPIC_RE.test(topic) || (!dry && !owedFile)) {
    console.error("usage: node deploy/hearth-joins.mjs --town <clone> --owed <file> [--topic hearth-default] | --town <clone> --dry [--topic hearth-default]");
    return 2;
  }
  if (!existsSync(join(town, "tools", "stamp-mint.mjs"))) { console.error(`[hearth-joins] no tools/stamp-mint.mjs in ${town}: --town names the town clone`); return 2; }
  return run({ town: resolve(town), owedFile: owedFile ? resolve(owedFile) : null, dry, topic, env });
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) main().then((code) => process.exit(code), (e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
