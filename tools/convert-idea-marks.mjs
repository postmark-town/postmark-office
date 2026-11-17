#!/usr/bin/env node
// convert-idea-marks.mjs — the Think Tank's idea marks become their authors' idea posts (POS-854). Runs once, by an operator.
//
//   node tools/convert-idea-marks.mjs --town <town-clone> --world <world-clone> [--ref <ref>] [--date YYYY-MM-DD]
//        [--posts-known <json>] [--out <file>]                         the DRY RUN: writes nothing, needs no key; ends with
//                                                                      the manifest's digest and the one command that applies it
//   node tools/convert-idea-marks.mjs --town <town-clone> --world <world-clone> --ref <ref> --date YYYY-MM-DD
//        --apply --key <pem> --expect <digest> --receipt <file>
//
//   env (the dry run reads the store only when asked): WORLD2_PG_URL (or PG*) = the office's own store; TOWN_PUSH=1 pulls the
//   clone first and pushes what lands; STAMP_LINES=store records the landed lines in the store.
//
// Darko, 2026-11-16 22:44 EST: "Oh, yeah, no consent chase. And the idea, stakes carry over, exactly, like you said."
//
// WHAT IT DOES, in the order it does it (src/idea-mark-conversion.mjs holds the plan and the steps):
//   1. reads the standing idea marks from the world clone at --ref, through git (no checkout, nothing written);
//   2. plans one post per mark: its title and id (the pen's own mint, never the mark's id), its provenance (the mark's
//      id, kind, date, author, the body's digest), and every stake standing on the mark, read from the stamp ledger;
//   3. PROVES THE CARRY CONSERVATIVE before one line is signed: for each staker one `world-unstake` out of the mark and
//      one `post-stake` into the post, the same n; every handle's liquid stamps and the whole of what is staked are
//      equal before and after, and both are printed. A plan that is not conservative is not printed as a plan;
//   4. drafts, for each author, the notice that tells them (and never sends it).
// The APPLY runs steps 2 to 3 again, refuses unless the digest equals the reviewed one, creates each post (one act and
// one row, put up by the town's hand with the author as the actor, idempotent by the mark id on the row), carries every
// stake in ONE signed append under the town lock, runs the town's stamp-verify, lands the commit, and writes the receipt.
//
// WHAT IT NEVER DOES: withdraw a mark or touch the world (the world half does that at a crossing, naming the post),
// send a notice, mint or burn a stamp, or run from the tick (it refuses while OFFICE_KEEP or INVOCATION_ID is set).
// A mark it cannot carry whole (a body over the post limit, a meep's, an author the roll does not hold) is a named row
// under PROBLEMS and stays standing for a person to resolve.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { importTownTool, townToolArgv } from "../src/town-tool.mjs";
import { readIdeaMarks, planConversion, manifestSha, SOURCE_NOTE } from "../src/idea-mark-conversion.mjs";
import { ledgerEntriesOf, carryApply, CONVERSION_VIA } from "../src/post-stake-engine.mjs";
import { IDEA_CLASS } from "../src/ideas.mjs";
import { townDate } from "./bug-stage-plan.mjs";

const LEDGER_REL = join("WHITE_PAGES", "stamp-ledger.md");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const arg = (name, argv) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
const git = (repo, ...a) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });

/** Is this run scheduled rather than by hand? The reason in words, or null. */
export function scheduled(env) {
  if (env.OFFICE_KEEP) return "OFFICE_KEEP is set, so this is the keeping tick";
  if (env.INVOCATION_ID) return "INVOCATION_ID is set, so systemd started this run as a unit";
  return null;
}

/** Every id a mark could hold that the pen's id mint refuses to reuse, read through git: `<first dir>/<own slug>` and, nested, `<first dir>/<second dir>`. Conservative; the apply asks the store. */
export function heldMarkIds(worldClone, ref) {
  const out = git(worldClone, "ls-tree", "-r", "--name-only", ref, "--", "WORLD/marks");
  const held = new Set();
  for (const p of String(out.stdout).split("\n")) {
    if (!p.endsWith("/mark.md")) continue;
    const dirs = p.split("/").slice(2, -1);
    if (dirs.length >= 2) { held.add(`${dirs[0]}/${dirs.at(-1)}`); held.add(`${dirs[0]}/${dirs[1]}`); }
  }
  return held;
}

/** The town's grammar (the office's pinned copy), the ledger's entries, the meep law and the residents' roll. */
export async function townFacts(town) {
  if (!existsSync(join(town, "tools", "stamp-mint.mjs"))) throw new Error(`convert-idea-marks: no tools/stamp-mint.mjs in ${town} — --town names the town clone`);
  const M = await importTownTool(town, "stamp-mint.mjs");
  for (const f of ["postStakeLine", "worldUnstakeLine", "foldWorldMarkPositions", "classifyEntry"])
    if (typeof M[f] !== "function") throw new Error(`convert-idea-marks: this town's stamp-mint.mjs has no ${f}, so the carry cannot be planned`);
  const entries = ledgerEntriesOf(M, town);
  const { laws } = M.parseLaws(entries);
  const meep = M.meepChecker(laws);
  const rooms = M.householdKeys(town);
  return { M, entries, isMeep: (h, d) => meep(h, d), roll: new Set(rooms.keys()) };
}

/** The idea posts the store already holds: `{ posts: Map(origin.mark → id), held: Set(every idea post id) }`, or null when no store is configured (said in the printout). */
export async function storePosts({ env = process.env } = {}) {
  if (!env.WORLD2_PG_URL && !env.PGHOST && !env.PGDATABASE) return null;
  const { officeRead } = await import("../src/world2-pen.mjs");
  return officeRead(async (client) => {
    const { rows } = await client.query("SELECT id, fields->'origin'->>'mark' AS origin FROM posts WHERE class = $1 ORDER BY id", [IDEA_CLASS]);
    const { rows: all } = await client.query("SELECT id FROM posts");
    return { posts: new Map(rows.filter((r) => r.origin).map((r) => [r.origin, r.id])), held: new Set(all.map((r) => r.id)) };
  }, { env });
}

/** The printout, plain. PURE. */
export function renderPlan(plan, { date, ref, source, storeNote, ledgerHead }) {
  const t = plan.totals;
  const L = [];
  L.push(`convert-idea-marks — the plan for ${date}: ${t.planned} idea mark(s) become their authors' idea posts (${t.to_create} to create, ${t.already_posted} already posted), ${t.unplanned} left standing`);
  L.push(`source: ${source} at ${ref}. ${SOURCE_NOTE}.`);
  L.push(`posts store: ${storeNote}`);
  L.push(`ledger head: ${ledgerHead ?? "none"}`);
  L.push("");
  L.push(`COUNT   ${t.marks_read} standing idea marks read (${t.read_sited} sited, ${t.read_predicated} predicated); ${t.planned} planned, by ${t.authors} author(s)`);
  L.push(`STAKES  ${t.marks_with_stakes} mark(s) carry stamps: ${t.stake_positions} position(s), ✦${t.stamps_carried} to carry`);
  if (plan.proof) {
    const p = plan.proof;
    L.push(`PROOF   staked before: marks ${p.staked_before.marks}, posts ${p.staked_before.posts}; after: marks ${p.staked_after.marks}, posts ${p.staked_after.posts}; ` +
      `${p.liquid.length} staker(s)' liquid stamps unchanged: ${p.liquid.every((l) => l.before === l.after) ? "yes" : "NO"}; minted 0, burned 0`);
    for (const l of p.liquid) L.push(`          ${l.handle}: liquid ${l.before} → ${l.after}`);
  } else L.push("PROOF   no stake stands on any of these marks, so there is nothing to carry");
  L.push("");
  L.push("POSTS");
  for (const i of plan.items) {
    const st = i.stakes.length ? ` · stakes ${i.stakes.map((s) => `${s.handle} ✦${s.n}`).join(", ")}` : "";
    L.push(`  ${i.state === "posted" ? "have" : "make"}  ${i.mark}  →  ${i.post}  · ${i.kind}${i.of ? ` of ${i.of}` : ""} · ${i.date ?? "no date"} · "${i.title}"${st}`);
  }
  L.push("");
  L.push("TITLES (mark → the title its post takes: the body's first clause, or the body cut at a word; read these before the apply. The body stays whole beside it)");
  for (const i of plan.items) L.push(`  ${i.mark}  →  "${i.title}"${i.id_base ? `  [id from the mark's own slug: ${i.id_base}]` : ""}${i.place ? `  [place kept: ${i.place.mark ?? `${i.place.x}, ${i.place.y}`}]` : ""}`);
  L.push("");
  L.push("PROBLEMS (stay standing, unwithdrawn, for a person)");
  if (!plan.problems.length) L.push("  none");
  for (const p of plan.problems) L.push(`  ${p.mark ?? "(the carry)"}${p.by ? ` (${p.by})` : ""}: ${p.reason}`);
  L.push("");
  L.push(`NOTICES  ${plan.notices.length} drafted, none sent (one per author)`);
  return L.join("\n");
}

/** The apply's one command, printed under the digest. */
export const applyHint = (digest, { town, world, ref, date, keyPath, receipt }) =>
  `to apply exactly this plan (as the office user, on the box):\n  node tools/convert-idea-marks.mjs --town ${town} --world ${world} --ref ${ref} --date ${date} --apply --key ${keyPath} --expect ${digest} --receipt ${receipt}`;

/**
 * The whole run. `facts`, `marks`, `store`, `convert` and `ledger` are injectable so a suite drives the same path in
 * process, against a scratch town and store, and never the live ones.
 */
export async function main(argv = process.argv.slice(2), { facts = null, marks = null, store = undefined, convert = null, carry = carryApply, log = console.log, err = console.error, env = process.env } = {}) {
  const unit = scheduled(env);
  if (unit) { err(`convert-idea-marks: refused — ${unit}, and the conversion never runs from the tick or any timer: an operator runs it once, by hand (POS-854). Nothing read, nothing written.`); return 2; }
  const town = arg("--town", argv);
  const world = arg("--world", argv);
  const apply = argv.includes("--apply");
  const keyPath = arg("--key", argv);
  const expect = arg("--expect", argv);
  const receipt = arg("--receipt", argv);
  const ref = arg("--ref", argv) ?? "HEAD";
  if (!town || !existsSync(town)) { err("convert-idea-marks: --town <town-clone> is required and must exist"); return 1; }
  if (!marks && (!world || !existsSync(world))) { err("convert-idea-marks: --world <world-clone> is required and must exist"); return 1; }
  const date = arg("--date", argv) ?? townDate(Date.now());
  if (!DATE_RE.test(date)) { err(`convert-idea-marks: --date is YYYY-MM-DD, got ${JSON.stringify(date)}`); return 1; }
  if (apply && (!keyPath || !existsSync(keyPath))) { err("convert-idea-marks: --apply needs --key <ed25519-private-pem>"); return 1; }
  if (apply && !expect) { err("convert-idea-marks: --apply needs --expect <digest>, the digest the dry run printed: run it, read it, then apply exactly that one. Nothing written."); return 1; }
  if (apply && !receipt) { err("convert-idea-marks: --apply needs --receipt <file>, a new file outside the tree, where the receipt is written"); return 1; }
  if (apply && receipt && existsSync(receipt)) { err(`convert-idea-marks: ${receipt} already exists: a receipt is never overwritten. Nothing written.`); return 1; }
  if (apply && git(town, "status", "--porcelain", "--", LEDGER_REL).stdout.trim()) {
    err(`convert-idea-marks: the clone's ${LEDGER_REL} has changes nobody committed, and a pass that writes onto them could not put them back. Nothing written.`);
    return 1;
  }

  const { penTransaction } = await import("../src/write.mjs");
  const { landStamped } = await import("../src/stamp-lines.mjs");
  const pass = async () => {
    if (apply && env.TOWN_PUSH === "1") { const r = git(town, "pull", "--ff-only", "-q"); if (r.status !== 0) return { error: "convert-idea-marks: the town clone could not be brought current; nothing written" }; }
    let f, read, known;
    try {
      f = facts ?? await townFacts(town);
      read = marks ?? readIdeaMarks({ worldClone: world, ref });
      known = store === undefined ? await storePosts({ env }) : store;
    } catch (e) { return { error: String(e?.message ?? e) }; }
    const heldIds = new Set([...(marks ? [] : heldMarkIds(world, ref)), ...(known?.held ?? [])]);
    const posts = known?.posts ?? new Map();
    const plan = planConversion({ marks: read, posts, heldIds, M: f.M, entries: f.entries, date, isMeep: f.isMeep });
    const ledgerHead = f.entries.at(-1)?.sig ?? null;
    const digest = manifestSha(plan, { ledgerHead, ref });
    const storeNote = known ? `read (${known.posts.size} idea post(s) already carry a mark's provenance)` : "NOT read (no store configured here), so every mark is planned as new and no id is checked against posts; the apply asks the store and refuses a different id";
    log(renderPlan(plan, { date, ref, source: marks ? "a supplied list" : world, storeNote, ledgerHead }).trimEnd());
    log("");
    log(`digest: ${digest}`);
    if (!apply) {
      log(""); log(applyHint(digest, { town, world: world ?? "<world-clone>", ref, date, keyPath: keyPath ?? env.STAMP_KEY ?? "/srv/postmark-office/stamp-key.pem", receipt: "<a new file outside the tree>" }));
      return { planOnly: true, plan, digest };
    }
    if (expect !== digest)
      return { error: `convert-idea-marks: this is not the plan that was reviewed: --expect ${expect}, and the plan this run would write is ${digest}. Something changed since the dry run (a mark, a stake, a post, the ledger). Nothing written: run the dry run again and read it.` };
    // an apply plans ids offline for every mark when the store was not read, so it could stake onto ids no post holds: refused
    if (!known) return { error: "convert-idea-marks: --apply needs the posts store read (WORLD2_PG_URL or PG* set): with it unread every mark is planned as new at an offline id. Nothing written." };
    if (plan.problems.some((p) => p.mark == null)) return { error: "convert-idea-marks: the carry itself is refused, so nothing is written" };

    // 1. THE POSTS: one act and one row each, idempotent by the mark id on the row; the pen's own id mint must agree with the plan
    const conv = convert ?? (await import("../src/idea-store.mjs")).convertMarkToIdeaPost;
    const made = [];
    for (const i of plan.items) {
      try {
        const r = await conv({ mark: i.mark, by: i.by, title: i.title, body: i.body, origin: i.origin, place: i.place, id_base: i.id_base }, { hand: "wright", planned: i.post, roll: f.roll, env });
        // THE STAKES GO ONTO THE POST THAT EXISTS: a post under any other id than the plan's would have stamps escrowed on an id with no row
        // (out of reach of unstake). Stop before the carry; posts made so far stand and are found again by their provenance.
        if (r.post !== i.post)
          return { error: `convert-idea-marks: ${i.mark} already has the post ${r.post}, and the plan named ${i.post}: no stamp is carried onto an id that is not the post. Nothing more written; run the dry run again with the store read.`, made };
        made.push({ mark: i.mark, post: r.post, existed: r.existed === true, act_id: r.act_id ?? null });
      } catch (e) {
        return { error: `convert-idea-marks: ${i.mark} → ${i.post} was refused: ${e.defect ?? e.message} (${e.hint ?? ""}). Posts made before it stand and are found again by their provenance on a rerun; no stamp has moved. Nothing more written.`, made };
      }
    }
    // 2. THE STAKES: every pair in ONE signed append, planned against the reviewed positions and refused if they moved
    const expectMap = new Map(plan.items.flatMap((i) => i.stakes.map((s) => [`${i.mark}|${s.handle}`, s.n])));
    const carryItems = plan.items.filter((i) => i.stakes.length).map((i) => ({ mark: i.mark, post: i.post }));
    let carried = null;
    if (carryItems.length) {
      try { carried = carry(f.M, town, carryItems, { date, via: CONVERSION_VIA, expect: expectMap }, readFileSync(keyPath, "utf8")); }
      catch (e) { return { error: `convert-idea-marks: the stakes were refused: ${e.defect ?? e.message} (${e.hint ?? ""}). Posts stand; no stamp has moved; the ledger is as it was.`, made }; }
      const verified = spawnSync(process.execPath, townToolArgv(town, "stamp-verify.mjs", ["--repo", town]), { cwd: town, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      if (verified.status !== 0) return { error: `convert-idea-marks: the town's stamp-verify is red after the carry — ${(verified.stderr || verified.stdout).split(/\r?\n/)[0]}. The carry is put back, nothing written to the ledger.`, made };
      const message = `convert: ${carried.moves.length} stake position(s) carried from idea marks to idea posts · ✦${carried.proof.carried} (POS-854)\n\n${carried.moves.map((m) => `world-mark/${m.mark} → post/${m.post} · ${m.handle} · ${m.n}`).join("\n")}`;
      const landed = await landStamped(town, [join(town, LEDGER_REL)], message, { env });
      if (landed?.error) return { error: `convert-idea-marks: the carry could not land (${landed.error.defect ?? landed.error.code}) — ${landed.error.hint ?? ""}. Put back; posts stand.`, made };
      carried = { ...carried, commit: landed };
    }
    return { made, carried, plan, digest };
  };

  const out = apply ? await penTransaction(town, pass) : await pass();
  if (out?.error) { err(out.error); return 1; }
  if (out.planOnly) {
    log("[convert-idea-marks] the dry run only: nothing written, nothing signed, nothing sent, no town act made.");
    const outFile = arg("--out", argv);
    if (outFile && !existsSync(outFile)) writeFileSync(outFile, JSON.stringify({ digest: out.digest, totals: out.plan.totals, problems: out.plan.problems, items: out.plan.items.map(({ body, ...rest }) => rest), proof: out.plan.proof, notices: out.plan.notices }, null, 1));
    return 0;
  }
  writeFileSync(receipt, JSON.stringify({
    digest: out.digest, date, ref, applied_at: new Date().toISOString(),
    posts: out.made, stakes: out.carried ? { moves: out.carried.moves, proof: out.carried.proof, commit: out.carried.commit ?? null } : null,
    notices_drafted: out.plan.notices, notices_sent: 0,
    note: "the marks stand until the world half withdraws each, naming its post; the notices are drafted and unsent",
  }, null, 1), { flag: "wx" });
  log(`[convert-idea-marks] ${out.made.filter((m) => !m.existed).length} post(s) made, ${out.made.filter((m) => m.existed).length} already there; ✦${out.carried?.proof.carried ?? 0} carried in ${out.carried?.moves.length ?? 0} position(s); receipt at ${receipt}. Notices drafted, none sent.`);
  return 0;
}

/**
 * THE COMMAND. An --apply holds the town lock for its whole run: on linux it re-runs itself under `/usr/bin/flock -w 300` on the tick's
 * own lock file (src/town-lock.mjs § townLockPath), marked CONVERT_IDEA_MARKS_LOCKED=1. The dry run reads and takes no lock.
 */
export async function cli(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes("--apply") && !scheduled(env) && env.CONVERT_IDEA_MARKS_LOCKED !== "1") {
    const { useFlock, townLockPath } = await import("../src/town-lock.mjs");
    if (useFlock()) {
      const out = spawnSync("/usr/bin/flock", ["-w", "300", townLockPath(), process.execPath, fileURLToPath(import.meta.url), ...argv],
        { stdio: "inherit", env: { ...env, CONVERT_IDEA_MARKS_LOCKED: "1" } });
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
