#!/usr/bin/env node
// quest-pay-plan.mjs — the quests the town pays by hand-reviewed pass (POS-632).
//
//   node tools/quest-pay-plan.mjs --town <town-clone> --quest <id> --discussion <n> [--date YYYY-MM-DD] [--reject <ref,ref,…>]
//        the plan: writes nothing, needs no key; it ends with its digest and the
//        one command that applies it
//   node tools/quest-pay-plan.mjs --town <town-clone> --quest <id> --discussion <n> --date YYYY-MM-DD [--reject …] --apply --key <pem> --expect <digest>
//   node tools/quest-pay-plan.mjs --town <town-clone> --quest hearth-entry [--date …] [--reject <hearth:name,…>] [--apply --key <pem> --expect <digest>]
//        the Hearth quest (POS-985): no --discussion; its evidence is the town
//        clone's own main, and it reads no store and no GitHub
//
//   env: WORLD2_PG_URL (or PG*), the office's own store — the plan reads the
//        residents' GitHub bindings (identities) from it, and nothing else;
//        GH_TOKEN, a token that can read the blueprints repo's discussions;
//        TOWN_PUSH=1 pulls the clone first and pushes what lands; STAMP_LINES=store
//        records the landed lines in the store in the commit's transaction.
//
//   On the box, by hand, as the office user, with the office's env (as the award
//   pass is run, tools/post-award-plan.mjs's header).
//
// ── WHY IT EXISTS (Darko and Wright, 2026-10-14) ────────────────────────────
//
// Design § 7: "A resident who writes up feedback on v2 (what they like, what
// they don't) as a blueprints discussion gets 5 ✦." Darko 20:48: "quests are
// always paid by the town mint." Wright's Q2: one generic town line,
//   MINT → <handle> · <n> · for: quest:<id>/<household-key> · by: the-town,
// with its terms sealed in the town's QUEST_PAY table, written by a pass run by
// hand with a digest check. Q4: needs-review — a hand reads every piece of
// feedback the plan lists before the apply; --reject <ref,…> names the ones that
// are not feedback, and they pay nothing (the digest moves with them).
//
// It is a fork of post-award-plan.mjs's shape: the plan, the digest, the printed
// plan read back, the town's own verb once per owed row, the town's verifier,
// landStamped under the pen's transaction and the town lock, never on a tick.
//
// ── DARKO 2026-10-15 11:17, Q1 AND Q3 (RULED) ───────────────────────────────
//
//   Q1  "Paying per resident is never acceptable for quests. It's always by
//       household." Standing law: one line per quest and household, ever, across
//       every source below. A household that writes a letter AND comments is
//       paid once.
//   Q3  "feedback should go to the postmaster or like a designated GitHub
//       discussion in blueprints." Two sources, read side by side:
//       · COMMENTS on ONE designated discussion in postmark-blueprints. Its
//         number is --discussion, configuration Wright names when the quest is
//         posted; the pass never searches titles. A comment's author goes
//         through the residents' GitHub binding to a household.
//       · LETTERS TO THE POSTMASTER, delivered (the mail ledger's own line)
//         inside the quest's window, whose title is "v2 feedback": the slug of
//         the letter's id starts `v2-feedback` (the door's `title: "v2
//         feedback"`, or a git letter named letter-<date>-v2-feedback.md). The
//         sender is a resident, so the household is the town's own record: no
//         GitHub binding, which is the path for an agent without a human at hand.
//
// ── WHAT DECIDES A ROW (one per piece of qualifying feedback) ───────────────
//
//   already paid   the household already holds its quest:<id> line (the town's
//                  law: one line per quest and household, ever).
//   rejected       a hand read it and named it in --reject: not feedback.
//   no file        the ledger delivered a marked letter, but the inbox holds no
//                  file for a hand to read (Q4 cannot be met): "no letter on file".
//   unbound        a comment's GitHub account binds no resident here (by its
//                  id; the login only for a binding with no id), or a letter's
//                  sender has no room.
//   duplicate      the same household's earlier feedback in this plan, from
//                  either source, is the one paid. Only an owed row holds the
//                  house: a meep's or a refused row never does.
//   meep           the recipient is a meep (the town's meep law).
//   refused        the town's builder would refuse the line.
//   owed           everything else: the pass writes it.
//
// The recipient: a comment pays the resident of the author's house it names
// (@handle; only a handle holding the house's key), else the house's first; a
// letter pays its sender.
//
// ── THE HEARTH QUEST (POS-985; Darko 2026-11-01 16:51 and 20:08 EST) ────────
//
// "we should still reward stamps to anyone who tries their hand at their own
// household hearth"; "let's say 10 stamps for entering and 100 to the winner".
// The 10 is the town's QUEST_PAY row `hearth-entry`, once per household; the
// 100 is the founder gift, not this pass. The evidence, read from the town
// clone's HEAD (its main), the way the site registers an entry
// (postmark-site tools/sync-hearths.mjs): a folder PROJECTS/household-hearths/
// <name>/ holding hearth.html, not named in capitals (STARTER is
// infrastructure), whose hearth.html, hearth.css and hearth.md are plain files.
// Its day is the town day of the first-parent commit that brought its
// hearth.html to main, and its hearth.md `author:` is read at that same commit.
// The author line takes a resident's handle (that resident's household, the
// author paid) or a household's slug in the town's tools/households.json (its
// first resident who is not a meep paid); a string that is both, naming two
// different households, pays nothing and is left to the hand (housesFromRoll).
// An entry merged before the quest opened still pays once it is open (it
// is an entry all the same); one merged after `until`, when that is set, does
// not. A hand opens each owed entry before the apply (needs-review): the
// household named must be the one that made it, or --reject hearth:<name>.
// The rows add three reasons: "not an entry" (no hearth.html, or one of the
// three files not plain, which the site skips too), "ambiguous" and "unread"
// (the clone's history does not say when it merged).

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { townDate } from "./bug-stage-plan.mjs";
import { verifyArgv, lockedArgv, scheduled } from "./post-award-plan.mjs";

const LEDGER_REL = join("WHITE_PAGES", "stamp-ledger.md");
const MAIL_LEDGER_REL = join("WHITE_PAGES", "mail-ledger.md");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REF_RE = /^(?:comment:\d+|letter:[^\s,]+|hearth:[^\s,]+)$/;

/**
 * Where each paid quest's evidence comes from. `feedback` (Darko 2026-10-15 Q3):
 * one designated discussion's comments, and the letters to `letters_to` whose
 * slug starts `letter_mark`. `hearth` (POS-985): the registered Hearth entries,
 * the folders under `dir` on the town's main (see THE HEARTH QUEST below).
 */
export const QUEST_SOURCES = Object.freeze({
  "read-v2-feedback": Object.freeze({ kind: "feedback", owner: "postmark-town", repo: "postmark-blueprints", letters_to: "postmaster", letter_mark: "v2-feedback" }),
  "hearth-entry": Object.freeze({ kind: "hearth", owner: "postmark-town", repo: "postmark", dir: "PROJECTS/household-hearths" }),
});

/** Is a letter id marked as this quest's feedback: the slug after its date (and after `to-<recipient>-`, the door's form) starts with the mark. PURE. */
export function isMarkedLetter(id, source) {
  const m = /^[a-z0-9][a-z0-9-]*?-\d{4}-\d{2}-\d{2}-(.+)$/.exec(String(id ?? ""));
  if (!m) return false;
  const slug = m[1].startsWith(`to-${source.letters_to}-`) ? m[1].slice(`to-${source.letters_to}-`.length) : m[1];
  return slug === source.letter_mark || slug.startsWith(`${source.letter_mark}-`);
}

/** Inside the quest's window, by the item's day. PURE. */
export const inWindow = (day, terms) => day >= terms.from && (!terms.until || day <= terms.until);

/** Is the quest open on a town day: a `from` is set and reached, and `until` not passed. The town's QUEST_PAY leaves `from` null while a quest is closed. PURE. */
export const questOpen = (terms, day) => typeof terms?.from === "string" && inWindow(day, terms);

/** A Hearth entry counts by when it merged only against `until`: one merged before the quest opened is still an entry (THE HEARTH QUEST, above). PURE. */
export const entryInTime = (day, terms) => !terms.until || day <= terms.until;

/**
 * The designated discussion's comments as feedback items. A comment that names
 * another discussion is not this quest's evidence and is dropped. PURE.
 */
export function commentItems(comments, { discussion }) {
  return (comments ?? []).filter((c) => Number(c?.discussion?.number) === Number(discussion)).map((c) => ({
    ref: `comment:${c.databaseId}`, source: "comment", link: c.url, date: String(c.createdAt ?? "").slice(0, 10), body: c.body,
    author: c.author?.login ?? "?", gh: { login: c.author?.login ?? "", databaseId: c.author?.databaseId ?? null },
  }));
}

/** The letters delivered to the quest's recipient and marked as its feedback, as feedback items. `letters` are { id, from, to, date (delivery), body }. PURE. */
export function letterItems(letters, { source }) {
  return (letters ?? []).filter((l) => l.to === source.letters_to && isMarkedLetter(l.id, source)).map((l) => ({
    ref: `letter:${l.id}`, source: "letter", link: l.id, date: l.date, body: l.body, author: l.from, sender: l.from, to: l.to,
  }));
}

/** The resident a comment pays: one its body names (@handle) from the author's house, else the house's first. PURE. */
export function recipientOf(d, house) {
  const named = [...String(d.body ?? "").matchAll(/@([a-z0-9][a-z0-9._-]*)/gi)].map((m) => m[1].toLowerCase());
  return house.handles.find((h) => named.includes(h)) ?? house.handles[0];
}

/** The registered Hearth entries as items. `entries` are hearthEntries' rows: { id, author, line, date, commit, subject, problem?, later? }. PURE. */
export function hearthItems(entries, { source }) {
  return (entries ?? []).map((e) => ({
    ref: `hearth:${e.id}`, source: "hearth", link: `https://github.com/${source.owner}/${source.repo}/tree/main/${source.dir}/${e.id}`,
    via: e.commit ? `${e.commit.slice(0, 9)} "${e.subject ?? ""}"` : "no commit read", date: e.date ?? null, body: e.line ?? "",
    author: e.author ?? null, ...(e.problem ? { problem: e.problem } : {}), ...(e.later ? { later: e.later } : {}),
  }));
}

/**
 * item → { household (the town's key at `date`), handles }, { refuse }, or null,
 * for a Hearth entry. Its `author` is read two ways (Truey's FIX on #995: the
 * README says "author (you)", and most residents' handles are not their
 * household's slug):
 *   · a resident's handle (on the roll, with a room): that resident's household, with
 *     the author first among its handles, so the author is the one paid;
 *   · a household's slug in the town's tools/households.json (`households`):
 *     its residents with a room that hold the first one's key.
 * Either alone is used. When both readings exist and name different
 * households (a handle that is also another household's slug), it is
 * { refuse }: ambiguous, left to the hand. When both name the same household
 * (a house of one named after its only resident), it pays as usual (Wright,
 * 2026-11-09). PURE.
 */
export function housesFromRoll(households, { keyOf, hasRoom, date }) {
  const roll = households && typeof households === "object" ? households : {};
  const residentsOf = (slug) => (Object.hasOwn(roll, slug) && Array.isArray(roll[slug]?.residents) ? roll[slug].residents : []);
  const slugOfHandle = new Map();
  for (const slug of Object.keys(roll)) for (const h of residentsOf(slug)) if (!slugOfHandle.has(h)) slugOfHandle.set(h, slug);
  // the house a set of residents makes, keyed by `lead`'s key (lead first among its handles)
  const houseOf = (residents, lead) => {
    const household = keyOf(lead, date);
    return { household, handles: [lead, ...residents.filter((h) => h !== lead && keyOf(h, date) === household)] };
  };
  return (item) => {
    const author = item?.author;
    if (!author) return null;
    const slugResidents = residentsOf(author).filter(hasRoom);
    const bySlug = slugResidents.length ? houseOf(slugResidents, slugResidents[0]) : null;
    // A handle counts only when it is on the roll: hasRoom alone also holds the
    // retired pins in github-ids.json, names the town no longer resolves to a
    // resident (Truey's FIX at f7e8a9b).
    const byHandle = slugOfHandle.has(author) && hasRoom(author) ? houseOf(residentsOf(slugOfHandle.get(author) ?? "").filter(hasRoom), author) : null;
    if (bySlug && byHandle && bySlug.household !== byHandle.household)
      return { refuse: `ambiguous: "${author}" is a household's slug and the handle of a resident of another household; a hand decides` };
    return byHandle ?? bySlug;
  };
}

/**
 * THE PLAN, PURE. `items` are both sources' feedback (commentItems, letterItems);
 * they are read in day order, comments before letters on the same day, each
 * source in its own order. `houseOf(item)` → { household (the town's key),
 * handles (first first) } or null; `isMeep(handle, date)`; `paid` a Map
 * household → { handle, date } already in the ledger for this quest;
 * `lineOf(row)` the town's builder; `rejected` a Set of refs a hand named.
 */
export function planQuestPays({ items, quest, terms, houseOf, isMeep, paid = new Map(), lineOf, date, rejected = new Set() }) {
  const rows = [];
  const held = new Map(); // household -> the ref that holds it in this plan, across both sources (Q1)
  // An item with no day (a Hearth entry whose merge was not read) sorts first, so the order stays total.
  const day = (x) => x.it.date ?? "";
  const ordered = items.map((it, i) => ({ it, i })).sort((a, b) =>
    day(a) < day(b) ? -1 : day(a) > day(b) ? 1 : (a.it.source === b.it.source ? a.i - b.i : a.it.source === "comment" ? -1 : 1)).map((x) => x.it);
  for (const d of ordered) {
    if (!d.problem && !(d.source === "hearth" ? entryInTime(d.date, terms) : inWindow(d.date, terms))) continue;
    const base = { ref: d.ref, source: d.source, link: d.link, via: d.via, author: d.author ?? "-", first: firstLineOf(d.body), date: d.date ?? "-" };
    const nothing = (why, extra = {}) => rows.push({ ...base, ...extra, n: 0, why, owed: false });
    if (d.problem) { nothing(d.problem); continue; }
    if (rejected.has(d.ref)) { nothing(d.source === "hearth" ? "rejected: a hand read it — not this household's own Hearth" : "rejected: a hand read it — not feedback"); continue; }
    if (d.source === "letter" && d.body == null) { nothing(`no letter on file: the ledger delivered it, and WHITE_PAGES/${d.to}/inbox holds no ${d.link} for a hand to read`); continue; }
    const house = houseOf(d);
    // The author is read at the merge, so a later fix to the line pays nothing by
    // itself; an unbound or ambiguous Hearth row names that later commit and what
    // the line says now, for the hand to decide (Truey's FIX at f7e8a9b).
    const later = d.later ? ` · a later commit, ${d.later.commit.slice(0, 9)} "${d.later.subject}", changed the author line to ${d.later.author ? `"${d.later.author}"` : "nothing"}; a hand decides` : "";
    if (!house) {
      nothing(d.source === "letter" ? `unbound: ${d.author} has no room here`
        : d.source === "hearth" ? (d.author ? `unbound: the author "${d.author}" is no resident on the roll and no household with a resident here${later}` : `unbound: its hearth.md names no author${later}`)
        : `unbound: ${d.author} binds no resident here`);
      continue;
    }
    if (house.refuse) { nothing(`${house.refuse}${later}`); continue; }
    // A Hearth entry pays its house's first resident who is not a meep: the
    // author, when the author line names a resident (housesFromRoll puts it first).
    const handle = d.source === "letter" ? d.sender : d.source === "hearth" ? (house.handles.find((h) => !isMeep(h, date)) ?? house.handles[0]) : recipientOf(d, house);
    const at = { household: house.household, handle };
    const was = paid.get(house.household);
    if (was) { rows.push({ ...base, ...at, n: terms.amount, owed: false, why: `already paid: ${was.handle} on ${was.date}` }); continue; }
    if (held.has(house.household)) { nothing(`duplicate: the household's ${held.get(house.household)} is the one paid`, at); continue; }
    // A row that pays nothing (a meep, a line the town refuses) never holds the
    // house: the household's next piece of feedback is still the one paid.
    if (isMeep(handle, date)) { nothing("meep: a meep never receives stamps", at); continue; }
    let line;
    try { line = lineOf({ date, handle, quest, household: house.household }); }
    catch (e) { nothing(`refused: ${String(e?.message ?? e).split(/\r?\n/)[0]}`, at); continue; }
    held.set(house.household, d.ref);
    rows.push({ ...base, ...at, n: terms.amount, why: "owed", owed: true, line });
  }
  return rows;
}

const firstLineOf = (body) => String(body ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean)?.slice(0, 140) ?? "";

// ── the plan, printed ───────────────────────────────────────────────────────

const HEADER_RE = /^quest pay plan for ([a-z0-9][a-z0-9-]*) — (\d+) (?:piece\(s\) of feedback|Hearth entr\(ies\)) qualify, (\d+) already paid, (\d+) pay nothing, (\d+) owed \((\d+) stamps\), dated (\d{4}-\d{2}-\d{2})$/;
const ROW = (r) => `  ${r.ref} · ${r.handle ?? "-"} · ${r.household ?? "-"} · ${r.n} · ${r.why} · by ${r.author} on ${r.date}\n      ${r.source === "letter" ? `a letter to the postmaster: ${r.link}` : r.source === "hearth" ? `a Hearth entry: ${r.link}, merged in ${r.via}` : r.link}\n      "${r.first}"`;
const OWED_RE = /^ {2}((?:comment|letter|hearth):\S+) · (\S+) · (\S+) · (\d+) · owed · by (\S+) on (\d{4}-\d{2}-\d{2})$/;
const alreadyPaid = (r) => !r.owed && r.why.startsWith("already paid");

/** The plan as a person reads it: OWED (each with its link — the comment's URL, the letter's id, or the Hearth entry's folder and the commit that merged it — and first line, to read before the apply), ALREADY PAID, PAYS NOTHING. */
export function renderPlan(rows, { date, quest }) {
  const owed = rows.filter((r) => r.owed);
  const already = rows.filter(alreadyPaid);
  const nothing = rows.filter((r) => !r.owed && !alreadyPaid(r));
  const hearth = QUEST_SOURCES[quest]?.kind === "hearth";
  const out = [`quest pay plan for ${quest} — ${rows.length} ${hearth ? "Hearth entr(ies)" : "piece(s) of feedback"} qualify, ${already.length} already paid, ${nothing.length} pay nothing, ${owed.length} owed (${owed.reduce((s, r) => s + r.n, 0)} stamps), dated ${date}`,
    hearth
      ? "needs-review: open every OWED entry (its folder on main, and the commit that merged it) before the apply, and check the household named made it; --reject <ref,…> names any that is not, and the plan moves with it."
      : "needs-review (Q4): read every OWED comment and letter before the apply; --reject <ref,…> names any that is not feedback, and the plan moves with it."];
  for (const [title, list] of [["OWED", owed], ["ALREADY PAID", already], ["PAYS NOTHING", nothing]]) {
    if (!list.length) continue;
    out.push("", title, ...list.map(ROW));
  }
  return `${out.join("\n")}\n`;
}

/** sha256 over the owed rows' refs and exact lines, in order: the digest pins which feedback was read as well as what it pays. PURE. */
export function planDigest(rows) {
  const lines = rows.filter((r) => r.owed).map((r) => `${r.ref}\n${r.line}`);
  return `sha256:${createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16)}`;
}

export const renderApplyHint = (digest, { town, quest, discussion, date, keyPath, rejected }) =>
  `digest: ${digest}\napply exactly this plan with:\n  node tools/quest-pay-plan.mjs --town ${town} --quest ${quest}${discussion ? ` --discussion ${discussion}` : ""} --date ${date}${rejected.size ? ` --reject ${[...rejected].join(",")}` : ""} --apply --key ${keyPath} --expect ${digest}\n`;

/** The plan, read back. PURE. Throws on a plan it cannot account for. */
export function parseQuestPlan(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const header = lines.map((l) => HEADER_RE.exec(l.trim())).find(Boolean);
  if (!header) throw new Error("quest-pay-plan: the plan printed no header this pass can read — the wording changed, and the parser must be trued to it before the pass runs again");
  const claimed = Number(header[5]);
  const stamps = Number(header[6]);
  const start = lines.indexOf("OWED");
  const owed = [];
  if (start !== -1) {
    for (const line of lines.slice(start + 1)) {
      if (line.trim() === "") break;
      if (/^ {6}/.test(line)) continue; // a row's link and first line
      const m = OWED_RE.exec(line);
      if (!m) throw new Error(`quest-pay-plan: unreadable owed row: ${JSON.stringify(line)}`);
      owed.push({ ref: m[1], handle: m[2], household: m[3], n: Number(m[4]), author: m[5], date: m[6] });
    }
  }
  if (owed.length !== claimed) throw new Error(`quest-pay-plan: the plan says ${claimed} owed and this pass parsed ${owed.length} — refusing to mint a set it cannot fully account for`);
  const sum = owed.reduce((s, r) => s + r.n, 0);
  if (sum !== stamps) throw new Error(`quest-pay-plan: the plan says ${stamps} stamps owed and its rows add to ${sum} — refusing`);
  return { owed, quest: header[1], date: header[7] };
}

const FIELDS = ["ref", "handle", "household", "n", "author"];
/** The printed plan against the plan: null when they agree, else the first difference. PURE. */
export function planDiffers(parsed, rows, date) {
  if (parsed.date !== date) return `the lines' date: printed ${parsed.date}, planned ${date}`;
  const owed = rows.filter((r) => r.owed);
  if (parsed.owed.length !== owed.length) return `owed rows: printed ${parsed.owed.length}, planned ${owed.length}`;
  for (let i = 0; i < owed.length; i++)
    for (const f of FIELDS)
      if (parsed.owed[i][f] !== owed[i][f]) return `owed row ${i + 1} (${owed[i].ref}), ${f}: printed ${JSON.stringify(parsed.owed[i][f])}, planned ${JSON.stringify(owed[i][f])}`;
  return null;
}

// ── the town's engine, and the facts ────────────────────────────────────────

/** The town's QUEST_PAY, classifier, meep law, household keys and line builder, and its mail-ledger reader, from its own clone. */
export async function townEngine(town, quest) {
  const tool = join(town, "tools", "stamp-mint.mjs");
  if (!existsSync(tool)) throw new Error(`quest-pay-plan: no tools/stamp-mint.mjs in ${town} — --town names the town clone`);
  const engine = await import(pathToFileURL(tool).href);
  if (typeof engine.questPayLine !== "function" || !engine.QUEST_PAY)
    throw new Error("quest-pay-plan: this town's stamp-mint.mjs has no quest grammar (for: quest:<id>/<household-key>) — the town must carry --quest-mint first (POS-632 PR-Q1)");
  const terms = engine.QUEST_PAY[quest];
  if (!terms) throw new Error(`quest-pay-plan: "${quest}" is not a paid quest in the town's QUEST_PAY (${Object.keys(engine.QUEST_PAY).join(", ")})`);
  const mailTool = join(town, "tools", "mail-state.mjs");
  const mail = existsSync(mailTool) ? await import(pathToFileURL(mailTool).href) : null;
  if (typeof mail?.parseLedger !== "function") throw new Error(`quest-pay-plan: no parseLedger in ${town}'s tools/mail-state.mjs — the letters are read by the town's own mail-ledger law`);
  const ledgerFile = join(town, LEDGER_REL);
  const entries = existsSync(ledgerFile) ? engine.parseStampLedger(readFileSync(ledgerFile, "utf8")) : [];
  const { laws, revisions } = engine.parseLaws(entries);
  const meep = engine.meepChecker(laws);
  const rooms = engine.householdKeys(town);
  // the household key the town's verb will check: its own keyOf (stamp-mint.mjs § --quest-mint)
  const keyOf = (h, d) => {
    let k = null;
    for (const r of revisions) if (r.handle === h && r.date <= d) k = r.key;
    if (k) return k;
    const base = rooms.get(h);
    return base ? base.key : `solo:${h}`;
  };
  const paid = new Map();
  for (const e of entries) {
    const c = engine.classifyEntry(e.canonical);
    if (c.kind === "quest-pay" && c.quest === quest) paid.set(c.household, { handle: c.handle, date: c.date });
  }
  return { terms, isMeep: (h, d) => meep(h, d), paid, hasRoom: (h) => rooms.has(h), keyOf, lineOf: engine.questPayLine, parseMailLedger: mail.parseLedger };
}

/**
 * The letters delivered to `to`, from the town clone: the mail ledger's delivery
 * lines (the ferry's own record; the date is the crossing's), each with its body
 * from the recipient's inbox (`<id>.md`, or a folder letter's `<id>/letter.md`).
 * A delivered letter whose file is gone has body null, and the plan lists it
 * as paying nothing (no letter on file): a hand cannot read it.
 */
export function deliveredLetters(town, to, parseMailLedger) {
  const file = join(town, MAIL_LEDGER_REL);
  if (!existsSync(file)) return [];
  const inbox = join(town, "WHITE_PAGES", to, "inbox");
  const bodyOf = (id) => {
    for (const p of [join(inbox, `${id}.md`), join(inbox, id, "letter.md")])
      if (existsSync(p)) return readFileSync(p, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    return null; // delivered, but no file: the plan pays it nothing (no letter on file)
  };
  return parseMailLedger(readFileSync(file, "utf8"))
    .filter((e) => e.kind === "delivery" && e.to === to)
    .map((e) => ({ id: e.id, from: e.from, to: e.to, date: e.date, body: bodyOf(e.id) }));
}

/** A Hearth entry's hearth.md → { author, line }: its front matter's `author:` and the first paragraph of its body, as the site reads it (postmark-site tools/sync-hearths.mjs § readMeta). PURE. */
export function readHearthMeta(raw) {
  const text = String(raw ?? "").replace(/\r\n/g, "\n");
  const [, front = "", body = text] = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text) ?? [];
  return { author: /^author:\s*(.+)$/m.exec(front)?.[1]?.trim() || null, line: body.trim().split(/\n\s*\n/)[0]?.replace(/\s+/g, " ").trim() ?? "" };
}

/**
 * The registered Hearth entries on the town clone's HEAD (its main), read
 * through git, so only what is committed counts and a sparse clone reads them
 * too. One row per folder under `source.dir` not named in capitals:
 * { id, author, line, date, commit, subject }, where the date is the town day
 * of the first-parent commit that brought its hearth.html to main, and the
 * author and line are its hearth.md AT THAT COMMIT: the merge the row shows,
 * so a later change to the author line cannot move the 10 while the hand
 * opens the original PR (Truey's FIX on #995). When a later first-parent
 * commit changed the author line, the row also carries
 * `later: { commit, subject, author }` (the line as it reads now), which pays
 * nothing by itself. Or { id, problem } for a folder
 * with no hearth.html, or whose hearth.html, hearth.css or hearth.md is not a
 * plain file on main (not an entry: the site refuses such a file and skips the
 * whole entry, postmark-site tools/sync-hearths.mjs), or with no commit that
 * says when it merged. Only a tree is a folder.
 */
const ENTRY_FILES = Object.freeze(["hearth.html", "hearth.css", "hearth.md"]);
export function hearthEntries(town, source, { run = (...a) => git(town, ...a) } = {}) {
  const list = (rev, path) => new Map(run("ls-tree", "-z", rev, "--", `${path}/`).split("\0").filter(Boolean).map((l) => {
    const m = /^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]*)$/.exec(l);
    return m && [m[4].slice(m[4].lastIndexOf("/") + 1), { mode: m[1], type: m[2], sha: m[3] }];
  }).filter(Boolean));
  const plain = (f) => f?.type === "blob" && (f.mode === "100644" || f.mode === "100755");
  const out = [];
  for (const [id, folder] of list("HEAD", source.dir)) {
    if (folder.type !== "tree") continue;
    if (id === id.toUpperCase()) continue; // STARTER: infrastructure, not an entry (the site's own rule)
    const files = list("HEAD", `${source.dir}/${id}`);
    if (!files.has("hearth.html")) { out.push({ id, problem: "not an entry: no hearth.html (the site skips it too)" }); continue; }
    const odd = ENTRY_FILES.find((n) => files.has(n) && !plain(files.get(n)));
    if (odd) { out.push({ id, problem: `not an entry: its ${odd} is not a plain file (the site refuses it and skips the whole entry)` }); continue; }
    const merged = run("log", "--first-parent", "--diff-merges=first-parent", "--no-patch", "--diff-filter=A", "--format=%H%x09%cI%x09%s", "HEAD", "--", `${source.dir}/${id}/hearth.html`)
      .split(/\r?\n/).filter(Boolean).at(-1)?.split("\t");
    if (!merged) { out.push({ id, problem: "unread: the clone's history does not say when its hearth.html reached main" }); continue; }
    const md = list(merged[0], `${source.dir}/${id}`).get("hearth.md");
    const meta = plain(md) ? readHearthMeta(run("cat-file", "blob", md.sha)) : { author: null, line: "" };
    // The newest first-parent commit to touch hearth.md: when it is not the merge
    // and the author line now differs, the row can name it (`later`).
    const last = run("log", "-1", "--first-parent", "--diff-merges=first-parent", "--no-patch", "--format=%H%x09%s", "HEAD", "--", `${source.dir}/${id}/hearth.md`).split("\t");
    const now = files.get("hearth.md");
    const nowAuthor = plain(now) ? readHearthMeta(run("cat-file", "blob", now.sha)).author : null;
    const later = last[0] && last[0] !== merged[0] && nowAuthor !== meta.author ? { commit: last[0], subject: last.slice(1).join("\t"), author: nowAuthor } : null;
    out.push({ id, ...meta, date: townDate(Date.parse(merged[1])), commit: merged[0], subject: merged.slice(2).join("\t"), ...(later ? { later } : {}) });
  }
  return out;
}

/** The town's household roll, `households` of its tools/households.json (slug → { residents, … }). A read that fails throws: the pass stops. */
export function townHouseholds(town) {
  const roll = JSON.parse(readFileSync(join(town, "tools", "households.json"), "utf8"));
  if (!roll?.households || typeof roll.households !== "object") throw new Error(`quest-pay-plan: ${town}'s tools/households.json has no households`);
  return roll.households;
}

/** The residents' GitHub bindings, from the store: gh_id / gh_login → handles, oldest resident first. */
export async function storeBindings({ env = process.env } = {}) {
  const { officeRead } = await import("../src/world2-pen.mjs");
  return officeRead(async (client) => (await client.query(
    "SELECT handle, household, gh_login, gh_id::text AS gh_id, since FROM identities WHERE status <> 'retired' ORDER BY since NULLS LAST, handle")).rows, { env });
}

/** The designated discussion's comments, through GitHub's GraphQL (GH_TOKEN), oldest first. Each carries its discussion's number, which commentItems holds to the designated one. */
export async function fetchComments(source, discussion, { env = process.env, fetchImpl = fetch } = {}) {
  if (!env.GH_TOKEN) throw new Error("quest-pay-plan: GH_TOKEN is needed to read the discussion's comments");
  const out = [];
  let after = null;
  for (let page = 0; page < 20; page++) {
    const query = `query($o:String!,$r:String!,$n:Int!,$a:String){ repository(owner:$o,name:$r){ discussion(number:$n){ number comments(first:100, after:$a){
      pageInfo{ hasNextPage endCursor } nodes{ databaseId url createdAt body discussion{ number } author{ login ... on User { databaseId } } } } } } }`;
    const res = await fetchImpl("https://api.github.com/graphql", { method: "POST", headers: { Authorization: `bearer ${env.GH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { o: source.owner, r: source.repo, n: Number(discussion), a: after } }) });
    const j = await res.json();
    if (j.errors) throw new Error(`quest-pay-plan: GitHub refused the comments read (${JSON.stringify(j.errors).slice(0, 160)})`);
    const d = j.data?.repository?.discussion;
    if (!d) throw new Error(`quest-pay-plan: no discussion #${discussion} in ${source.owner}/${source.repo}`);
    out.push(...d.comments.nodes);
    if (!d.comments.pageInfo.hasNextPage) break;
    after = d.comments.pageInfo.endCursor;
  }
  return out;
}

/**
 * item → { household (the town's key at `date`), handles } or null. A comment
 * goes through the GitHub bindings; a letter's sender is the town's own record
 * (a room), with no binding. PURE.
 */
export function housesFrom(bindings, { keyOf, hasRoom, date }) {
  return (item) => {
    if (item?.source === "letter") return hasRoom(item.sender) ? { household: keyOf(item.sender, date), handles: [item.sender] } : null;
    const author = item?.gh ?? item?.author;
    const id = author?.databaseId == null ? null : String(author.databaseId);
    const login = String(author?.login ?? "").toLowerCase();
    // By GitHub id: a binding that carries an id matches that id only (a renamed
    // account's old login, taken by someone else, binds nothing); the login is
    // the match only for a binding with no id.
    const mine = bindings.filter((b) => (b.gh_id ? id !== null && String(b.gh_id) === id : login && String(b.gh_login ?? "").toLowerCase() === login))
      .map((b) => b.handle).filter(hasRoom);
    if (!mine.length) return null;
    // The house is the first handle's key, and only the handles holding that key
    // are its residents here: a named handle pinned to the same account under
    // another key could never be paid on this line (the minter refuses it).
    const household = keyOf(mine[0], date);
    return { household, handles: mine.filter((h) => keyOf(h, date) === household) };
  };
}

export const questMintArgv = (town, r, { quest, date, keyPath }) => [join(town, "tools", "stamp-mint.mjs"),
  "--quest-mint", r.handle, "--quest", quest, "--household", r.household, "--date", date, "--key", keyPath, "--repo", town];

const run = (town, argv) => spawnSync(process.execPath, argv, { cwd: town, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();
const arg = (name, argv) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
const firstLine = (out) => (String(out.stderr ?? "").trim() || String(out.stdout ?? "").trim()).split(/\r?\n/)[0] || `exit ${out.status}`;

/** The whole pass. `facts` ({ comments, bindings, letters? }, or for the Hearth quest { entries, households }), `spawn` and `printed` are injectable, as the award pass's are; letters, entries and the roll default to the town clone's. */
export async function main(argv = process.argv.slice(2), { facts = null, spawn = run, printed = (t) => t, log = console.log, err = console.error, env = process.env } = {}) {
  const unit = scheduled(env);
  if (unit) { err(`quest-pay-plan: refused — ${unit}, and the quest pass never runs from the tick or any timer: Wright runs it by hand (POS-632). Nothing read, nothing written.`); return 2; }
  const town = arg("--town", argv);
  const quest = arg("--quest", argv);
  const discussion = arg("--discussion", argv);
  const apply = argv.includes("--apply");
  const keyPath = arg("--key", argv);
  const expect = arg("--expect", argv);
  const rejects = String(arg("--reject", argv) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!town || !existsSync(town)) { err("quest-pay-plan: --town <town-clone> is required and must exist"); return 1; }
  if (!quest || !QUEST_SOURCES[quest]) { err(`quest-pay-plan: --quest is one of ${Object.keys(QUEST_SOURCES).join(", ")}`); return 1; }
  const hearth = QUEST_SOURCES[quest].kind === "hearth";
  if (hearth && discussion != null) { err(`quest-pay-plan: ${quest} reads no discussion: its evidence is the Hearth entries on the town's main. Drop --discussion.`); return 1; }
  if (!hearth && !/^[1-9]\d*$/.test(String(discussion ?? ""))) { err(`quest-pay-plan: --discussion <n> is required: the number of the designated discussion in ${QUEST_SOURCES[quest].owner}/${QUEST_SOURCES[quest].repo} whose comments are the feedback`); return 1; }
  const badRef = rejects.find((r) => !REF_RE.test(r));
  if (badRef) { err(`quest-pay-plan: --reject takes the plan's refs (comment:<id>, letter:<letter-id> or hearth:<folder>), got ${JSON.stringify(badRef)}`); return 1; }
  const rejected = new Set(rejects);
  if (apply && (!keyPath || !existsSync(keyPath))) { err("quest-pay-plan: --apply needs --key <ed25519-private-pem>"); return 1; }
  if (apply && !expect) { err("quest-pay-plan: --apply needs --expect <digest>, the digest the plan printed. Nothing written."); return 1; }
  const date = arg("--date", argv) ?? townDate(Date.now());
  if (!DATE_RE.test(date)) { err(`quest-pay-plan: --date is YYYY-MM-DD, got ${JSON.stringify(date)}`); return 1; }
  if (apply && git(town, "status", "--porcelain", "--", LEDGER_REL)) {
    err(`quest-pay-plan: the clone's ${LEDGER_REL} has changes nobody committed. Nothing written; the tick (or a person) settles them first.`);
    return 1;
  }

  const { penTransaction } = await import("../src/write.mjs");
  const { landStamped } = await import("../src/stamp-lines.mjs");
  const source = QUEST_SOURCES[quest];
  const pass = async () => {
    if (apply && env.TOWN_PUSH === "1") git(town, "pull", "--ff-only", "-q");
    let engine, got;
    try {
      engine = await townEngine(town, quest);
      // A closed quest plans nothing: the town's QUEST_PAY leaves `from` null until it opens (POS-985).
      if (!questOpen(engine.terms, date))
        return { error: `quest-pay-plan: ${quest} is not open on ${date}: the town's QUEST_PAY (tools/stamp-mint.mjs) ${typeof engine.terms.from === "string" ? `pays from ${engine.terms.from}${engine.terms.until ? ` until ${engine.terms.until}` : ""}` : "names no opening day for it yet"}. Nothing written.` };
      if (hearth) got = facts ?? { entries: hearthEntries(town, source), households: townHouseholds(town) };
      else {
        got = facts ?? { comments: await fetchComments(source, discussion, { env }), bindings: await storeBindings({ env }) };
        got = { ...got, letters: got.letters ?? deliveredLetters(town, source.letters_to, engine.parseMailLedger) };
      }
    } catch (e) { return { error: String(e?.message ?? e) }; }
    const houseOf = hearth
      ? housesFromRoll(got.households, { keyOf: engine.keyOf, hasRoom: engine.hasRoom, date })
      : housesFrom(got.bindings, { keyOf: engine.keyOf, hasRoom: engine.hasRoom, date });
    const items = hearth ? hearthItems(got.entries, { source }) : [...commentItems(got.comments, { discussion }), ...letterItems(got.letters, { source })];
    const rows = planQuestPays({ items, quest, terms: engine.terms, houseOf, isMeep: engine.isMeep, paid: engine.paid, lineOf: engine.lineOf, date, rejected });
    const digest = planDigest(rows);
    const text = printed(renderPlan(rows, { date, quest }));
    log(text.trimEnd());
    if (!apply) {
      log("");
      log(renderApplyHint(digest, { town, quest, discussion, date, keyPath: keyPath ?? env.STAMP_KEY ?? "/srv/postmark-office/stamp-key.pem", rejected }).trimEnd());
      return { planOnly: true };
    }
    log(`digest: ${digest}`);
    if (expect !== digest)
      return { error: `quest-pay-plan: this plan is not the one reviewed — --expect ${expect}, and the plan this run would write is ${digest}. Nothing written: run the plan again and read it.` };
    let parsed;
    try { parsed = parseQuestPlan(text); } catch (e) { return { error: e.message }; }
    const differs = planDiffers(parsed, rows, date);
    if (differs) return { error: `quest-pay-plan: the printed plan is not the plan (${differs}) — refusing the whole apply, nothing written` };
    const owed = rows.filter((r) => r.owed);
    if (!owed.length) return { written: [] };
    for (const r of owed) {
      const out = spawn(town, questMintArgv(town, r, { quest, date, keyPath }));
      if (out.status !== 0) return { error: `quest-pay-plan: REFUSED ${r.ref} → ${r.handle} (${r.household}) — ${firstLine(out)}. The whole apply is put back, nothing written.` };
    }
    const verified = spawn(town, verifyArgv(town));
    if (verified.status !== 0) return { error: `quest-pay-plan: the town's stamp-verify is red after the quest lines — ${firstLine(verified)}. The whole apply is put back, nothing written.` };
    const message = `mint: the reviewed quest pass (POS-632), ${owed.length} line(s) for quest:${quest}\n\n${owed.map((r) => `quest:${quest}/${r.household} → ${r.handle} · ${r.n} (${r.ref}, ${r.author})`).join("\n")}`;
    const landed = await landStamped(town, [join(town, LEDGER_REL)], message, { env });
    if (landed?.error) return { error: `quest-pay-plan: the quest lines could not land (${landed.error.defect ?? landed.error.code}). Put back, nothing written.` };
    return { written: owed, commit: landed };
  };

  const out = apply ? await penTransaction(town, pass) : await pass();
  if (out?.error) { err(out.error); return 1; }
  if (out.planOnly) { log(`[quest-pay-plan] the plan only — nothing written, nothing signed. Read every owed ${hearth ? "entry" : "comment and letter"}, then --apply.`); return 0; }
  if (!out.written.length) { log("[quest-pay-plan] nothing owed"); return 0; }
  for (const r of out.written) log(`[quest-pay-plan] minted ${r.n} → ${r.handle} · quest:${quest}/${r.household} (${r.ref})`);
  return 0;
}

/** The command: an --apply holds the town lock on linux, as the award pass does. */
export async function cli(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes("--apply") && !scheduled(env) && env.QUEST_PAY_LOCKED !== "1") {
    const { useFlock, townLockPath } = await import("../src/town-lock.mjs");
    if (useFlock()) {
      const [file, args] = lockedArgv(fileURLToPath(import.meta.url), argv, townLockPath());
      const out = spawnSync(file, args, { stdio: "inherit", env: { ...env, QUEST_PAY_LOCKED: "1" } });
      return out.status ?? 1;
    }
  }
  return main(argv, { env });
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exit(await cli());
