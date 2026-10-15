#!/usr/bin/env node
// quest-pay-plan.mjs — the quests the town pays by hand-reviewed pass (POS-632).
//
//   node tools/quest-pay-plan.mjs --town <town-clone> --quest <id> [--date YYYY-MM-DD] [--reject <n,n,…>]
//        the plan: writes nothing, needs no key; it ends with its digest and the
//        one command that applies it
//   node tools/quest-pay-plan.mjs --town <town-clone> --quest <id> --date YYYY-MM-DD [--reject …] --apply --key <pem> --expect <digest>
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
// hand with a digest check. Q4: needs-review — a hand reads every discussion the
// plan lists before the apply; --reject <n,…> names the ones that are not
// feedback, and they pay nothing (the digest moves with them).
//
// It is a fork of post-award-plan.mjs's shape: the plan, the digest, the printed
// plan read back, the town's own verb once per owed row, the town's verifier,
// landStamped under the pen's transaction and the town lock, never on a tick.
//
// ── WHAT DECIDES A ROW (one per qualifying discussion) ──────────────────────
//
//   already paid   the household already holds its quest:<id> line (the town's
//                  law: one line per quest and household, ever).
//   rejected       a hand read it and named it in --reject: not feedback.
//   unbound        the author's GitHub account binds no resident here.
//   duplicate      another discussion by the same household earlier in this plan.
//   meep           the recipient is a meep (the town's meep law).
//   refused        the town's builder would refuse the line.
//   owed           everything else: the pass writes it.
//
// ── PENDING DARKO (POS-632) ─────────────────────────────────────────────────
//
//   Q1  once per household or per resident. This pass pays once per HOUSEHOLD,
//       because the author binding names a household (one GitHub account binds a
//       house), to the resident the discussion names, else the house's first.
//   Q3  who may post, and whether a letter to the postmaster also counts. This
//       pass reads blueprints discussions only, whose title starts with
//       QUEST_SOURCES[quest].title_prefix, in the quest's window.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { townDate } from "./bug-stage-plan.mjs";
import { verifyArgv, lockedArgv, scheduled } from "./post-award-plan.mjs";

const LEDGER_REL = join("WHITE_PAGES", "stamp-ledger.md");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Where each paid quest's evidence lives (Q3 pending: discussions only, today). */
export const QUEST_SOURCES = Object.freeze({
  "read-v2-feedback": Object.freeze({ owner: "postmark-town", repo: "postmark-blueprints", title_prefix: "read v2 feedback" }),
});

/** Does a discussion qualify for the quest: its title's prefix, and created inside the window. PURE. */
export function qualifies(d, { source, terms }) {
  const title = String(d.title ?? "").trim().toLowerCase();
  if (!title.startsWith(source.title_prefix)) return false;
  const day = String(d.createdAt ?? "").slice(0, 10);
  return day >= terms.from && (!terms.until || day <= terms.until);
}

/** The resident a discussion pays: one its body names (@handle) from the author's house, else the house's first. PURE. */
export function recipientOf(d, house) {
  const named = [...String(d.body ?? "").matchAll(/@([a-z0-9][a-z0-9._-]*)/gi)].map((m) => m[1].toLowerCase());
  return house.handles.find((h) => named.includes(h)) ?? house.handles[0];
}

/**
 * THE PLAN, PURE. `discussions` are the source's, oldest first, each
 * { number, title, url, createdAt, body, author: { login, databaseId } };
 * `houseOf(author)` → { household (the town's key), handles (first first) } or
 * null; `isMeep(handle, date)`; `paid` a Map household → { handle, date }
 * already in the ledger for this quest; `lineOf(row)` the town's builder;
 * `rejected` a Set of discussion numbers a hand named.
 */
export function planQuestPays({ discussions, quest, terms, source, houseOf, isMeep, paid = new Map(), lineOf, date, rejected = new Set() }) {
  const rows = [];
  const held = new Map(); // household -> discussion number that holds it in this plan
  for (const d of discussions) {
    if (!qualifies(d, { source, terms })) continue;
    const base = { number: Number(d.number), url: d.url, author: d.author?.login ?? "?", first: firstLineOf(d.body), date: String(d.createdAt).slice(0, 10) };
    const nothing = (why, extra = {}) => rows.push({ ...base, ...extra, n: 0, why, owed: false });
    if (rejected.has(base.number)) { nothing("rejected: a hand read it — not feedback"); continue; }
    const house = houseOf(d.author);
    if (!house) { nothing(`unbound: ${base.author} binds no resident here`); continue; }
    const handle = recipientOf(d, house);
    const at = { household: house.household, handle };
    const was = paid.get(house.household);
    if (was) { rows.push({ ...base, ...at, n: terms.amount, owed: false, why: `already paid: ${was.handle} on ${was.date}` }); continue; }
    if (held.has(house.household)) { nothing(`duplicate: the household's discussion #${held.get(house.household)} is the one paid`, at); continue; }
    held.set(house.household, base.number);
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

const HEADER_RE = /^quest pay plan for ([a-z0-9][a-z0-9-]*) — (\d+) discussion\(s\) qualify, (\d+) already paid, (\d+) pay nothing, (\d+) owed \((\d+) stamps\), dated (\d{4}-\d{2}-\d{2})$/;
const ROW = (r) => `  #${r.number} · ${r.handle ?? "-"} · ${r.household ?? "-"} · ${r.n} · ${r.why} · by ${r.author} on ${r.date}\n      ${r.url}\n      "${r.first}"`;
const OWED_RE = /^ {2}#(\d+) · (\S+) · (\S+) · (\d+) · owed · by (\S+) on (\d{4}-\d{2}-\d{2})$/;
const alreadyPaid = (r) => !r.owed && r.why.startsWith("already paid");

/** The plan as a person reads it: OWED (each with its discussion's link and first line, to read before the apply), ALREADY PAID, PAYS NOTHING. */
export function renderPlan(rows, { date, quest }) {
  const owed = rows.filter((r) => r.owed);
  const already = rows.filter(alreadyPaid);
  const nothing = rows.filter((r) => !r.owed && !alreadyPaid(r));
  const out = [`quest pay plan for ${quest} — ${rows.length} discussion(s) qualify, ${already.length} already paid, ${nothing.length} pay nothing, ${owed.length} owed (${owed.reduce((s, r) => s + r.n, 0)} stamps), dated ${date}`,
    "needs-review (Q4): read every OWED discussion before the apply; --reject <n,…> names any that is not feedback, and the plan moves with it."];
  for (const [title, list] of [["OWED", owed], ["ALREADY PAID", already], ["PAYS NOTHING", nothing]]) {
    if (!list.length) continue;
    out.push("", title, ...list.map(ROW));
  }
  return `${out.join("\n")}\n`;
}

/** sha256 over the owed rows' exact lines, in order. PURE. */
export function planDigest(rows) {
  const lines = rows.filter((r) => r.owed).map((r) => r.line);
  return `sha256:${createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16)}`;
}

export const renderApplyHint = (digest, { town, quest, date, keyPath, rejected }) =>
  `digest: ${digest}\napply exactly this plan with:\n  node tools/quest-pay-plan.mjs --town ${town} --quest ${quest} --date ${date}${rejected.size ? ` --reject ${[...rejected].join(",")}` : ""} --apply --key ${keyPath} --expect ${digest}\n`;

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
      owed.push({ number: Number(m[1]), handle: m[2], household: m[3], n: Number(m[4]), author: m[5], date: m[6] });
    }
  }
  if (owed.length !== claimed) throw new Error(`quest-pay-plan: the plan says ${claimed} owed and this pass parsed ${owed.length} — refusing to mint a set it cannot fully account for`);
  const sum = owed.reduce((s, r) => s + r.n, 0);
  if (sum !== stamps) throw new Error(`quest-pay-plan: the plan says ${stamps} stamps owed and its rows add to ${sum} — refusing`);
  return { owed, quest: header[1], date: header[7] };
}

const FIELDS = ["number", "handle", "household", "n", "author"];
/** The printed plan against the plan: null when they agree, else the first difference. PURE. */
export function planDiffers(parsed, rows, date) {
  if (parsed.date !== date) return `the lines' date: printed ${parsed.date}, planned ${date}`;
  const owed = rows.filter((r) => r.owed);
  if (parsed.owed.length !== owed.length) return `owed rows: printed ${parsed.owed.length}, planned ${owed.length}`;
  for (let i = 0; i < owed.length; i++)
    for (const f of FIELDS)
      if (parsed.owed[i][f] !== owed[i][f]) return `owed row ${i + 1} (#${owed[i].number}), ${f}: printed ${JSON.stringify(parsed.owed[i][f])}, planned ${JSON.stringify(owed[i][f])}`;
  return null;
}

// ── the town's engine, and the facts ────────────────────────────────────────

/** The town's QUEST_PAY, classifier, meep law, household keys and line builder, from its own clone. */
export async function townEngine(town, quest) {
  const tool = join(town, "tools", "stamp-mint.mjs");
  if (!existsSync(tool)) throw new Error(`quest-pay-plan: no tools/stamp-mint.mjs in ${town} — --town names the town clone`);
  const engine = await import(pathToFileURL(tool).href);
  if (typeof engine.questPayLine !== "function" || !engine.QUEST_PAY)
    throw new Error("quest-pay-plan: this town's stamp-mint.mjs has no quest grammar (for: quest:<id>/<household-key>) — the town must carry --quest-mint first (POS-632 PR-Q1)");
  const terms = engine.QUEST_PAY[quest];
  if (!terms) throw new Error(`quest-pay-plan: "${quest}" is not a paid quest in the town's QUEST_PAY (${Object.keys(engine.QUEST_PAY).join(", ")})`);
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
  return { terms, isMeep: (h, d) => meep(h, d), paid, hasRoom: (h) => rooms.has(h), keyOf, lineOf: engine.questPayLine };
}

/** The residents' GitHub bindings, from the store: gh_id / gh_login → handles, oldest resident first. */
export async function storeBindings({ env = process.env } = {}) {
  const { officeRead } = await import("../src/world2-pen.mjs");
  return officeRead(async (client) => (await client.query(
    "SELECT handle, household, gh_login, gh_id::text AS gh_id, since FROM identities WHERE status <> 'retired' ORDER BY since NULLS LAST, handle")).rows, { env });
}

/** The source's discussions, through GitHub's GraphQL (GH_TOKEN), oldest first. */
export async function fetchDiscussions(source, { env = process.env, fetchImpl = fetch } = {}) {
  if (!env.GH_TOKEN) throw new Error("quest-pay-plan: GH_TOKEN is needed to read the discussions");
  const out = [];
  let after = null;
  for (let page = 0; page < 20; page++) {
    const query = `query($o:String!,$r:String!,$a:String){ repository(owner:$o,name:$r){ discussions(first:100, after:$a, orderBy:{field:CREATED_AT,direction:ASC}){
      pageInfo{ hasNextPage endCursor } nodes{ number title url createdAt body author{ login ... on User { databaseId } } } } } }`;
    const res = await fetchImpl("https://api.github.com/graphql", { method: "POST", headers: { Authorization: `bearer ${env.GH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { o: source.owner, r: source.repo, a: after } }) });
    const j = await res.json();
    if (j.errors) throw new Error(`quest-pay-plan: GitHub refused the discussions read (${JSON.stringify(j.errors).slice(0, 160)})`);
    const d = j.data.repository.discussions;
    out.push(...d.nodes);
    if (!d.pageInfo.hasNextPage) break;
    after = d.pageInfo.endCursor;
  }
  return out;
}

/** author → { household (the town's key at `date`), handles } from the bindings and the town's keyOf. PURE. */
export function housesFrom(bindings, { keyOf, hasRoom, date }) {
  return (author) => {
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

/** The whole pass. `facts` ({ discussions, bindings }), `spawn` and `printed` are injectable, as the award pass's are. */
export async function main(argv = process.argv.slice(2), { facts = null, spawn = run, printed = (t) => t, log = console.log, err = console.error, env = process.env } = {}) {
  const unit = scheduled(env);
  if (unit) { err(`quest-pay-plan: refused — ${unit}, and the quest pass never runs from the tick or any timer: Wright runs it by hand (POS-632). Nothing read, nothing written.`); return 2; }
  const town = arg("--town", argv);
  const quest = arg("--quest", argv);
  const apply = argv.includes("--apply");
  const keyPath = arg("--key", argv);
  const expect = arg("--expect", argv);
  const rejected = new Set(String(arg("--reject", argv) ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0));
  if (!town || !existsSync(town)) { err("quest-pay-plan: --town <town-clone> is required and must exist"); return 1; }
  if (!quest || !QUEST_SOURCES[quest]) { err(`quest-pay-plan: --quest is one of ${Object.keys(QUEST_SOURCES).join(", ")}`); return 1; }
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
  const pass = async () => {
    if (apply && env.TOWN_PUSH === "1") git(town, "pull", "--ff-only", "-q");
    let engine, got;
    try {
      engine = await townEngine(town, quest);
      got = facts ?? { discussions: await fetchDiscussions(QUEST_SOURCES[quest], { env }), bindings: await storeBindings({ env }) };
    } catch (e) { return { error: String(e?.message ?? e) }; }
    const houseOf = housesFrom(got.bindings, { keyOf: engine.keyOf, hasRoom: engine.hasRoom, date });
    const rows = planQuestPays({ discussions: got.discussions, quest, terms: engine.terms, source: QUEST_SOURCES[quest], houseOf, isMeep: engine.isMeep, paid: engine.paid, lineOf: engine.lineOf, date, rejected });
    const digest = planDigest(rows);
    const text = printed(renderPlan(rows, { date, quest }));
    log(text.trimEnd());
    if (!apply) {
      log("");
      log(renderApplyHint(digest, { town, quest, date, keyPath: keyPath ?? env.STAMP_KEY ?? "/srv/postmark-office/stamp-key.pem", rejected }).trimEnd());
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
      if (out.status !== 0) return { error: `quest-pay-plan: REFUSED #${r.number} → ${r.handle} (${r.household}) — ${firstLine(out)}. The whole apply is put back, nothing written.` };
    }
    const verified = spawn(town, verifyArgv(town));
    if (verified.status !== 0) return { error: `quest-pay-plan: the town's stamp-verify is red after the quest lines — ${firstLine(verified)}. The whole apply is put back, nothing written.` };
    const message = `mint: the reviewed quest pass (POS-632), ${owed.length} line(s) for quest:${quest}\n\n${owed.map((r) => `quest:${quest}/${r.household} → ${r.handle} · ${r.n} (discussion #${r.number}, ${r.author})`).join("\n")}`;
    const landed = await landStamped(town, [join(town, LEDGER_REL)], message, { env });
    if (landed?.error) return { error: `quest-pay-plan: the quest lines could not land (${landed.error.defect ?? landed.error.code}). Put back, nothing written.` };
    return { written: owed, commit: landed };
  };

  const out = apply ? await penTransaction(town, pass) : await pass();
  if (out?.error) { err(out.error); return 1; }
  if (out.planOnly) { log("[quest-pay-plan] the plan only — nothing written, nothing signed. Read every owed discussion, then --apply."); return 0; }
  if (!out.written.length) { log("[quest-pay-plan] nothing owed"); return 0; }
  for (const r of out.written) log(`[quest-pay-plan] minted ${r.n} → ${r.handle} · quest:${quest}/${r.household} (#${r.number})`);
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
