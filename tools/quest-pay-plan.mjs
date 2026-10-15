#!/usr/bin/env node
// quest-pay-plan.mjs — the quests the town pays by hand-reviewed pass (POS-632).
//
//   node tools/quest-pay-plan.mjs --town <town-clone> --quest <id> --discussion <n> [--date YYYY-MM-DD] [--reject <ref,ref,…>]
//        the plan: writes nothing, needs no key; it ends with its digest and the
//        one command that applies it
//   node tools/quest-pay-plan.mjs --town <town-clone> --quest <id> --discussion <n> --date YYYY-MM-DD [--reject …] --apply --key <pem> --expect <digest>
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
//   unbound        a comment's GitHub account binds no resident here, or a
//                  letter's sender has no room.
//   duplicate      the same household's earlier feedback in this plan, from
//                  either source, is the one paid.
//   meep           the recipient is a meep (the town's meep law).
//   refused        the town's builder would refuse the line.
//   owed           everything else: the pass writes it.
//
// The recipient: a comment pays the resident of the author's house it names
// (@handle), else the house's first; a letter pays its sender.

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
const REF_RE = /^(?:comment:\d+|letter:[^\s,]+)$/;

/** Where each paid quest's feedback comes from (Darko 2026-10-15 Q3): one designated discussion's comments, and the letters to `letters_to` whose slug starts `letter_mark`. */
export const QUEST_SOURCES = Object.freeze({
  "read-v2-feedback": Object.freeze({ owner: "postmark-town", repo: "postmark-blueprints", letters_to: "postmaster", letter_mark: "v2-feedback" }),
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
    ref: `letter:${l.id}`, source: "letter", link: l.id, date: l.date, body: l.body, author: l.from, sender: l.from,
  }));
}

/** The resident a comment pays: one its body names (@handle) from the author's house, else the house's first. PURE. */
export function recipientOf(d, house) {
  const named = [...String(d.body ?? "").matchAll(/@([a-z0-9][a-z0-9._-]*)/gi)].map((m) => m[1].toLowerCase());
  return house.handles.find((h) => named.includes(h)) ?? house.handles[0];
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
  const ordered = items.map((it, i) => ({ it, i })).sort((a, b) =>
    a.it.date < b.it.date ? -1 : a.it.date > b.it.date ? 1 : (a.it.source === b.it.source ? a.i - b.i : a.it.source === "comment" ? -1 : 1)).map((x) => x.it);
  for (const d of ordered) {
    if (!inWindow(d.date, terms)) continue;
    const base = { ref: d.ref, source: d.source, link: d.link, author: d.author, first: firstLineOf(d.body), date: d.date };
    const nothing = (why, extra = {}) => rows.push({ ...base, ...extra, n: 0, why, owed: false });
    if (rejected.has(d.ref)) { nothing("rejected: a hand read it — not feedback"); continue; }
    const house = houseOf(d);
    if (!house) { nothing(d.source === "letter" ? `unbound: ${d.author} has no room here` : `unbound: ${d.author} binds no resident here`); continue; }
    const handle = d.source === "letter" ? d.sender : recipientOf(d, house);
    const at = { household: house.household, handle };
    const was = paid.get(house.household);
    if (was) { rows.push({ ...base, ...at, n: terms.amount, owed: false, why: `already paid: ${was.handle} on ${was.date}` }); continue; }
    if (held.has(house.household)) { nothing(`duplicate: the household's ${held.get(house.household)} is the one paid`, at); continue; }
    held.set(house.household, d.ref);
    if (isMeep(handle, date)) { nothing("meep: a meep never receives stamps", at); continue; }
    let line;
    try { line = lineOf({ date, handle, quest, household: house.household }); }
    catch (e) { nothing(`refused: ${String(e?.message ?? e).split(/\r?\n/)[0]}`, at); continue; }
    rows.push({ ...base, ...at, n: terms.amount, why: "owed", owed: true, line });
  }
  return rows;
}

const firstLineOf = (body) => String(body ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean)?.slice(0, 140) ?? "";

// ── the plan, printed ───────────────────────────────────────────────────────

const HEADER_RE = /^quest pay plan for ([a-z0-9][a-z0-9-]*) — (\d+) piece\(s\) of feedback qualify, (\d+) already paid, (\d+) pay nothing, (\d+) owed \((\d+) stamps\), dated (\d{4}-\d{2}-\d{2})$/;
const ROW = (r) => `  ${r.ref} · ${r.handle ?? "-"} · ${r.household ?? "-"} · ${r.n} · ${r.why} · by ${r.author} on ${r.date}\n      ${r.source === "letter" ? `a letter to the postmaster: ${r.link}` : r.link}\n      "${r.first}"`;
const OWED_RE = /^ {2}((?:comment|letter):\S+) · (\S+) · (\S+) · (\d+) · owed · by (\S+) on (\d{4}-\d{2}-\d{2})$/;
const alreadyPaid = (r) => !r.owed && r.why.startsWith("already paid");

/** The plan as a person reads it: OWED (each with its link — the comment's URL or the letter's id — and first line, to read before the apply), ALREADY PAID, PAYS NOTHING. */
export function renderPlan(rows, { date, quest }) {
  const owed = rows.filter((r) => r.owed);
  const already = rows.filter(alreadyPaid);
  const nothing = rows.filter((r) => !r.owed && !alreadyPaid(r));
  const out = [`quest pay plan for ${quest} — ${rows.length} piece(s) of feedback qualify, ${already.length} already paid, ${nothing.length} pay nothing, ${owed.length} owed (${owed.reduce((s, r) => s + r.n, 0)} stamps), dated ${date}`,
    "needs-review (Q4): read every OWED comment and letter before the apply; --reject <ref,…> names any that is not feedback, and the plan moves with it."];
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
  `digest: ${digest}\napply exactly this plan with:\n  node tools/quest-pay-plan.mjs --town ${town} --quest ${quest} --discussion ${discussion} --date ${date}${rejected.size ? ` --reject ${[...rejected].join(",")}` : ""} --apply --key ${keyPath} --expect ${digest}\n`;

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
 * A delivered letter whose file is gone still lists, with an empty body: the
 * hand reads it before the apply.
 */
export function deliveredLetters(town, to, parseMailLedger) {
  const file = join(town, MAIL_LEDGER_REL);
  if (!existsSync(file)) return [];
  const inbox = join(town, "WHITE_PAGES", to, "inbox");
  const bodyOf = (id) => {
    for (const p of [join(inbox, `${id}.md`), join(inbox, id, "letter.md")])
      if (existsSync(p)) return readFileSync(p, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    return "";
  };
  return parseMailLedger(readFileSync(file, "utf8"))
    .filter((e) => e.kind === "delivery" && e.to === to)
    .map((e) => ({ id: e.id, from: e.from, to: e.to, date: e.date, body: bodyOf(e.id) }));
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
    const mine = bindings.filter((b) => (id && b.gh_id === id) || (login && String(b.gh_login ?? "").toLowerCase() === login)).map((b) => b.handle).filter(hasRoom);
    if (!mine.length) return null;
    return { household: keyOf(mine[0], date), handles: mine };
  };
}

export const questMintArgv = (town, r, { quest, date, keyPath }) => [join(town, "tools", "stamp-mint.mjs"),
  "--quest-mint", r.handle, "--quest", quest, "--household", r.household, "--date", date, "--key", keyPath, "--repo", town];

const run = (town, argv) => spawnSync(process.execPath, argv, { cwd: town, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();
const arg = (name, argv) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
const firstLine = (out) => (String(out.stderr ?? "").trim() || String(out.stdout ?? "").trim()).split(/\r?\n/)[0] || `exit ${out.status}`;

/** The whole pass. `facts` ({ comments, bindings, letters? }), `spawn` and `printed` are injectable, as the award pass's are; letters default to the town clone's. */
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
  if (!/^[1-9]\d*$/.test(String(discussion ?? ""))) { err(`quest-pay-plan: --discussion <n> is required: the number of the designated discussion in ${QUEST_SOURCES[quest].owner}/${QUEST_SOURCES[quest].repo} whose comments are the feedback`); return 1; }
  const badRef = rejects.find((r) => !REF_RE.test(r));
  if (badRef) { err(`quest-pay-plan: --reject takes the plan's refs (comment:<id> or letter:<letter-id>), got ${JSON.stringify(badRef)}`); return 1; }
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
      got = facts ?? { comments: await fetchComments(source, discussion, { env }), bindings: await storeBindings({ env }) };
      got = { ...got, letters: got.letters ?? deliveredLetters(town, source.letters_to, engine.parseMailLedger) };
    } catch (e) { return { error: String(e?.message ?? e) }; }
    const houseOf = housesFrom(got.bindings, { keyOf: engine.keyOf, hasRoom: engine.hasRoom, date });
    const items = [...commentItems(got.comments, { discussion }), ...letterItems(got.letters, { source })];
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
  if (out.planOnly) { log("[quest-pay-plan] the plan only — nothing written, nothing signed. Read every owed comment and letter, then --apply."); return 0; }
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
