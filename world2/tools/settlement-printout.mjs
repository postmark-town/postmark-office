#!/usr/bin/env node
// settlement-printout.mjs — THE SETTLEMENT PRINTS ITSELF (POS-1025, the office half of POS-365).
//
//   node world2/tools/settlement-printout.mjs print  --world <clone at main> --window <W> [--since-window <W0>] [--dry-run]
//   node world2/tools/settlement-printout.mjs tag    --world <clone> --window <W> --commit <sha> [--dry-run]
//   node world2/tools/settlement-printout.mjs record --window <W> --commit <sha>
//
//   env: WORLD2_CLEARING_URL = postgres://clearing_job:… (reads the seal; `record` calls record_printout)
//
// EXIT CODES: 0 done (or already done, the same) · 1 REFUSED, with the reason as a JSON body on stdout
//             · 2 a bad argument or a missing credential.
//
// ── THE RULINGS ─────────────────────────────────────────────────────────────
//
// Darko, 2026-11-13 09:08 EST, POS-365/a "Printout only": git becomes a printout of each settlement; the
// settlement cuts its own tag. 15:1x EST, POS-1025/a "Every settlement": every seal gets a number, a retry
// keeps it, a settlement never printed leaves a gap, the tag is cut only once the printout succeeds, and old
// tags are never rewritten. POS-1025/c "Report only": what publishes is decided inside the settlement and
// stays fixed; after the seal the checks only raise alarms.
//
// ── WHAT IT PRINTS: THE SEALED SNAPSHOT, AS A DELTA ON THE LAST PRINTOUT ────
//
// The clearing decided everything before its seal (clearing-job.mjs, step 7.5 the last of it). So this
// judges nothing. It reads two sealed snapshots, the one being printed (S) and the last one printed (P),
// and applies their difference to world main, which is P's printout:
//
//   a mark whose sealed version differs (or is new)  rendered from S's version row by the write-down's own
//                                                    planner (store-writedown.mjs § planStoreWriteDown:
//                                                    Gate A filing, the one framer, `markRecord`)
//   a mark in P and not in S                         its file removed, and every seat left holding no
//                                                    standing mark with it (the sweep's husk rule)
//   every other standing mark                        re-framed only when its frame changed, by the world's
//                                                    own verb (tools/reparent-keep-world.mjs §
//                                                    keepWorldAcross), so a structural edit moves nothing
//   WORLD/settlement-publications.json               the registry AS SEALED at S's window (095), written
//                                                    over the last printout's file: kept rows keep their
//                                                    bytes and place, removed rows go, printed rows are set
//   the derived files                                the world's own fold (tools/marks-fold.mjs --stakes),
//                                                    over the store's stakes at S's town sha
//
// A delta and not a whole-tree render, on purpose (Rivet's disposition 4): a mark no settlement touches
// keeps the bytes it has, authored town files and non-mark files (README, SCHEMA, CREDITS) included, and a
// whole render would rewrite hundreds of files by field order alone. The town's own (non-law) marks print
// like any other when their sealed version changes (the operator repair, POS-1025/b); a change that only
// moves the hands prints over the town's own bytes (store-writedown.mjs § handOffPrint). Class and law marks
// are not in `marks` at all: law-ingest stays their writer.
//
// WHAT IT REFUSES, rather than decide after the seal:
//   · a frame whose leaving cannot keep a nested mark's world position exactly (keepWorldAcross's
//     ReframeRefusal). The sweep used to keep or hold the frame back, which was a post-seal decision; the
//     printout names the mark and prints nothing, and the next settlement's delta carries it.
//   · a settlement older than one already printed: a stale replay never moves canon backwards.
//   · a seal before 095 (no number), or no last printout to measure from (the cutover names one).
//
// It commits on the clone (`settlement: S<n> printout …`, the subject return-past-takes and POS-614 read)
// and never pushes: the crossing pushes, then `tag`, then `record`.
//
// ── THE TAG AND THE RECORD ──────────────────────────────────────────────────
//
// `tag` cuts the annotated `settlement/S<n>` at the printout commit, naming the number, the window, the
// snapshot and its digest (and `Town <sha>`, the line snapshot-backfill reads). Idempotent: a tag already on
// that commit with that digest is done; one anywhere else is REFUSED, never moved (old tags are never
// rewritten). `record` hands the printout's sha to the store (095 § record_printout), which keeps it once
// and moves the `world-marks` head only for the highest printed settlement.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { planStoreWriteDown, normalizeMark, handOffPrint, sketchbookNameFor, wallRegistryAt, FoldInputRefusal } from "../../src/store-writedown.mjs";
import { isNestedFiling } from "../../src/world-journal.mjs";
import { fileFramer } from "../../src/world-drain.mjs";
import { renderedMark } from "./mark-render.mjs";
import { snapshotHeader, snapshotRows, firstClaimedBySlug } from "../../src/world-snapshot.mjs";
import { stakesFromStore } from "./fold-input.mjs";

export const REGISTRY_REL = "WORLD/settlement-publications.json";
export const MARKS_REL = "WORLD/marks";
/** What the world's fold writes beside the marks (the sweep's own list). */
export const DERIVED = Object.freeze(["WORLD/world-state.json", "WORLD/INDEX.md", "WORLD/region-outsiders.json", "WORLD/region-outsiders.md", "WORLD/containment.json"]);
export const TAG_PREFIX = "settlement/S";
const TOWN = "the-town";
const isTheTown = (household, by) => by === TOWN || String(household ?? "") === TOWN || String(household ?? "").endsWith(`:${TOWN}`);

const git = (repo, args, opts = {}) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["pipe", "pipe", "pipe"], ...opts });

export class PrintoutRefusal extends Error {
  constructor(reason, detail, fields = {}) { super(`${reason}: ${detail}`); this.reason = reason; this.detail = detail; Object.assign(this, fields); }
}

// ── the store half ──────────────────────────────────────────────────────────

/** S, the snapshot this window sealed, and P, the last one printed before it (or the cutover's named base). */
export async function printoutPair(q, { window, sinceWindow = null }) {
  const S = await snapshotHeader({ query: q }, { window });
  if (!S) throw new PrintoutRefusal("no-seal", `window ${window} has no sealed snapshot`);
  if (S.sealed_settlement == null)
    throw new PrintoutRefusal("sealed-before-095", `window ${window} was sealed with no settlement number (before 095): the settlement does not print it`);
  const { rows: [newer] } = await q(
    "SELECT sealed_settlement, window_id, printout_sha FROM world_snapshots WHERE printout_sha IS NOT NULL AND sealed_settlement > $1 ORDER BY sealed_settlement DESC LIMIT 1",
    [S.sealed_settlement]);
  if (newer)
    throw new PrintoutRefusal("stale-replay",
      `S${S.sealed_settlement} (window ${window}) is older than S${newer.sealed_settlement}, already printed at ${String(newer.printout_sha).slice(0, 12)}: a stale replay never moves canon backwards, so S${S.sealed_settlement} stays unprinted (the ruled gap)`);
  let P = null;
  if (sinceWindow != null) {
    P = await snapshotHeader({ query: q }, { window: sinceWindow });
    if (!P) throw new PrintoutRefusal("no-base", `--since-window ${sinceWindow} has no sealed snapshot`);
  } else {
    const { rows: [p] } = await q(
      "SELECT * FROM world_snapshots WHERE printout_sha IS NOT NULL AND sealed_settlement < $1 ORDER BY sealed_settlement DESC LIMIT 1", [S.sealed_settlement]);
    P = p ?? null;
    if (!P) throw new PrintoutRefusal("no-base",
      `nothing has been printed before S${S.sealed_settlement}: the first printout measures from the snapshot the last sweep crossed (the cutover names it, --since-window)`);
  }
  return { S, P };
}

/** The registry AS SEALED at window W (095): every row holding at W, by slug. */
export async function registryAt(q, window) {
  const { rows } = await q(
    `SELECT slug, class, stale, ord FROM settlement_publications
      WHERE from_window <= $1 AND (to_window IS NULL OR to_window > $1) ORDER BY ord`, [window]);
  return new Map(rows.map((r) => [r.slug, { class: r.class, stale: r.stale, ord: Number(r.ord) }]));
}

/** The delta between two sealed lists: `changed` (new or a different version) and `removed`, by slug, sorted. PURE. */
export function deltaOf(pRows, sRows) {
  const before = new Map(pRows.map((r) => [r.slug, r.digest]));
  const after = new Map(sRows.map((r) => [r.slug, r.digest]));
  const changed = [...after].filter(([slug, d]) => before.get(slug) !== d).map(([slug]) => slug).sort();
  const removed = [...before.keys()].filter((slug) => !after.has(slug)).sort();
  return { changed, removed };
}

/** The write-down's mark entries for the changed slugs, rendered from S's VERSION rows (never the live table). */
async function entriesOf(q, sRows, changed) {
  if (!changed.length) return [];
  const want = new Set(changed);
  const versions = sRows.filter((r) => want.has(r.slug)).map((r) => ({ slug: r.slug, row: JSON.parse(r.row) }));
  const { rows: live } = await q("SELECT slug, household, locked_window FROM marks WHERE slug = ANY($1::text[])", [changed]);
  const liveOf = new Map(live.map((r) => [r.slug, r]));
  const first = await firstClaimedBySlug({ query: q }, versions.filter((v) => v.row.kind === "parcel").map((v) => v.slug));
  return versions.map(({ slug, row }) => {
    const l = liveOf.get(slug) ?? {};
    return {
      slug, kind: row.kind, by: row.owner, household: l.household ?? null,
      locked_window: l.locked_window == null ? null : Number(l.locked_window),
      founder_commit: row.data?.founder_commit ?? null,
      ...renderedMark({ ...row, first_claimed: first.get(slug) ?? null, first_claim_submitted_at: null }),
    };
  });
}

// ── the git half ────────────────────────────────────────────────────────────

/**
 * The commit on the clone's HEAD that is settlement `n`'s printout, by its subject, or null. A settlement
 * prints once (POS-1025/a), so its subject names one commit; the search is bounded to the last 500 commits,
 * far past the two settlements a day and every write between them.
 */
export function printoutOnMain(world, n) {
  const want = `settlement: S${n} printout `;
  for (const line of git(world, ["log", "-n", "500", "--format=%H %s", "HEAD"]).split("\n")) {
    if (line.slice(41).startsWith(want)) return line.slice(0, 40);
  }
  return null;
}

/** Does any mark.md stand anywhere beneath `dir`? (the sweep's seat-keeping test) */
function holdsAStandingMark(dir) {
  if (!existsSync(dir)) return false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === "mark.md") return true;
    if (entry.isDirectory() && holdsAStandingMark(join(dir, entry.name))) return true;
  }
  return false;
}

/** Where main files each `<by>/<name>`: a reader over one `ls-tree`, the write-down's own rule (by-line match). */
function publishedPathReader(world, head) {
  let paths = null;
  return (id) => {
    paths ??= git(world, ["ls-tree", "-r", "--name-only", head, "--", MARKS_REL]).split("\n").map((l) => l.trim()).filter((l) => l.endsWith("/mark.md"));
    const by = String(id).split("/")[0], name = String(id).split("/").slice(1).join("/");
    for (const p of paths) {
      if (!p.endsWith(`/${name}/mark.md`)) continue;
      try { if (git(world, ["show", `${head}:${p}`]).match(/^by:\s*(.+)$/m)?.[1]?.trim() === by) return p; } catch { /* not a match */ }
    }
    return null;
  };
}

/**
 * THE PRINTOUT. Renders S over main (P's printout) in the clone's working tree and commits it there.
 * Answers the receipt; throws PrintoutRefusal with the tree left for the caller to discard.
 */
export async function printSettlement(q, { world, window, sinceWindow = null, dryRun = false, stakes = null }) {
  world = resolve(world);
  const head = git(world, ["rev-parse", "HEAD"]).trim();
  if (git(world, ["status", "--porcelain", "--", "WORLD"]).trim())
    throw new PrintoutRefusal("dirty-world", "the clone's WORLD/ is not clean at HEAD: a printout writes over main and nothing else");
  // A RETRY OF A RECORDED PRINTOUT is the same printout (POS-1025/a: a retry keeps its number): answered before anything is measured.
  const sealed = await snapshotHeader({ query: q }, { window });
  if (sealed?.printout_sha)
    return { status: "already-printed", settlement: sealed.sealed_settlement, window, commit: sealed.printout_sha, snapshot: { id: sealed.id, digest: sealed.digest } };
  // AND A RETRY OF A PRINTOUT THAT LANDED BUT WAS NOT RECORDED (its tag or record refused after the push):
  // its commit already stands on main, so it is THE printout, and printing again would make a second,
  // empty one for the same number that its own tag then disagrees with. Answered with that commit.
  const onMain = sealed?.sealed_settlement != null ? printoutOnMain(world, sealed.sealed_settlement) : null;
  if (onMain)
    return { status: "already-on-main", settlement: sealed.sealed_settlement, window, commit: onMain, snapshot: { id: sealed.id, digest: sealed.digest } };
  const { S, P } = await printoutPair(q, { window, sinceWindow });

  const [sRows, pRows] = await Promise.all([snapshotRows({ query: q }, S.marks_digest), snapshotRows({ query: q }, P.marks_digest)]);
  const { changed, removed } = deltaOf(pRows, sRows);
  const entries = await entriesOf(q, sRows, changed);

  // the write-down's readers of main, and the world's framer over the same clone
  const publishedPathOf = publishedPathReader(world, head);
  const canonCache = new Map();
  const canonBytesAt = (path) => {
    if (canonCache.has(path)) return canonCache.get(path);
    let b = null;
    try { b = git(world, ["show", `${head}:${path}`]); } catch { b = null; }
    canonCache.set(path, b);
    return b;
  };
  // A town mark whose only change is the hands prints over the town's own bytes (store-writedown § handOffPrint).
  const marks = entries.map((m) => {
    if (!isTheTown(m.household, m.by)) return m;
    for (const p of [publishedPathOf(m.slug), `${MARKS_REL}/${m.slug}/mark.md`]) {
      const canon = p ? canonBytesAt(p) : null;
      if (canon === null) continue;
      const print = handOffPrint(canon, m.bytes, { nested: isNestedFiling(p) });
      if (print) return { ...m, bytes: print.bytes, fileRec: null, body: null, at_frame: "file", path: p };
      break;
    }
    return m;
  });

  let plan;
  try {
    // the write-down's own normalization (the id, the name, the household, the bytes re-derived from the record), then its planner
    plan = planStoreWriteDown(marks.map(normalizeMark), { publishedPathOf, canonBytesAt, toFileFrame: await fileFramer(world) });
  } catch (e) {
    if (e instanceof FoldInputRefusal) throw new PrintoutRefusal(e.reason ?? "render-refused", e.detail ?? e.message);
    throw e;
  }
  const upserts = plan.households.flatMap((h) => h.upserts);
  const printedPath = new Map([...upserts.map((u) => [u.id, u.path]), ...plan.unchanged.map((u) => [u.id, u.path])]);

  // the world's own verbs, from this clone (Bevel's seam: they stay in the World)
  const keep = await import(pathToFileURL(join(world, "tools", "reparent-keep-world.mjs")).href);
  const marksDir = join(world, MARKS_REL);
  const worldBefore = keep.snapshotWorld(marksDir);

  for (const u of upserts) {
    const full = join(world, u.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, u.bytes);
  }
  const gone = [];
  const seats = [];
  for (const slug of removed) {
    const p = publishedPathOf(slug);
    if (!p) { gone.push({ slug, path: null, note: "not on main: nothing to remove" }); continue; }
    rmSync(join(world, p), { force: true });
    seats.push(join(world, dirname(p)));
    gone.push({ slug, path: p });
  }
  for (let seat of seats) {
    while (seat !== marksDir && seat.startsWith(marksDir) && existsSync(seat) && !holdsAStandingMark(seat)) {
      rmSync(seat, { recursive: true, force: true });
      seat = dirname(seat);
    }
  }
  let reframed;
  try {
    reframed = keep.keepWorldAcross(marksDir, worldBefore, { skip: new Set(upserts.map((u) => join(world, u.path))) });
  } catch (e) {
    if (e instanceof keep.ReframeRefusal || e?.name === "ReframeRefusal")
      throw new PrintoutRefusal("reframe-refused",
        `a mark nested in a frame this settlement changed cannot keep its world position exactly (${(e.refused ?? []).map((r) => `${r.id}: ${r.reason}`).join("; ") || e.message}). The sweep would have kept or held the frame back, which is a decision after the seal; the printout prints nothing and names it, and the next settlement's printout carries it`,
        { refused: e.refused ?? [] });
    throw e;
  }

  // the registry, as sealed at S's window, over the last printout's file
  const sealedRegistry = await registryAt(q, window);
  const prevText = canonBytesAt(REGISTRY_REL);
  const prev = prevText ? JSON.parse(prevText) : { version: 1, published: {} };
  const wall = wallRegistryAt(world, head);
  const householdOf = new Map(entries.map((m) => [m.slug, m.household]));
  const registryChange = { added: [], removed: [], set: [], reclassed: [] };
  const published = {};
  for (const [slug, row] of Object.entries(prev.published ?? {})) {
    const sealed = sealedRegistry.get(slug);
    if (!sealed) { registryChange.removed.push(slug); continue; }
    if (printedPath.has(slug) && changed.includes(slug)) {
      const next = { household: sketchbookNameFor(householdOf.get(slug), wall), path: printedPath.get(slug), class: sealed.class };
      if (JSON.stringify(next) !== JSON.stringify(row)) registryChange.set.push(slug);
      published[slug] = next;
    } else if (row.class !== sealed.class) {
      published[slug] = { ...row, class: sealed.class };
      registryChange.reclassed.push(slug);
    } else published[slug] = row;
  }
  const missing = [...sealedRegistry].filter(([slug]) => !Object.hasOwn(prev.published ?? {}, slug)).sort((a, b) => a[1].ord - b[1].ord);
  for (const [slug, sealed] of missing) {
    const path = printedPath.get(slug) ?? publishedPathOf(slug);
    const household = householdOf.has(slug) ? sketchbookNameFor(householdOf.get(slug), wall) : null;
    if (!path || !household)
      throw new PrintoutRefusal("registry-unprintable", `the sealed registry holds ${slug} and neither this printout nor main files it: a row the file cannot say where it stands`);
    published[slug] = { household, path, class: sealed.class };
    registryChange.added.push(slug);
  }
  const registryText = `${JSON.stringify({ ...prev, published }, null, 2)}\n`;
  if (registryText !== prevText) writeFileSync(join(world, REGISTRY_REL), registryText);

  // the derived files: the world's own fold, over the store's stakes at S's town sha
  const stakeRows = stakes ?? await stakesFromStore({ query: q }, { townSha: S.town_sha });
  const scratch = join(world, ".git", "printout-stakes.json");
  writeFileSync(scratch, `${JSON.stringify(stakeRows, null, 1)}\n`);
  const fold = spawnSync(process.execPath, [join(world, "tools", "marks-fold.mjs"), "--stakes", scratch], { cwd: world, encoding: "utf8", maxBuffer: 1 << 28 });
  if (fold.status !== 0)
    throw new PrintoutRefusal("fold-refused", `the world's fold could not write the derived files: ${String(fold.stderr || fold.stdout).trim().slice(0, 400)}`);

  const summary = { written: upserts.length, unchanged: plan.unchanged.length, removed: gone.filter((g) => g.path).length, reframed: reframed.length };
  const receipt = {
    settlement: S.sealed_settlement, window, snapshot: { id: S.id, digest: S.digest, town_sha: S.town_sha },
    base: { settlement: P.sealed_settlement ?? null, window: P.window_id, printout_sha: P.printout_sha ?? null, world: head },
    changed: changed.length, written: upserts.map((u) => ({ id: u.id, path: u.path })), unchanged: plan.unchanged.map((u) => u.id),
    removed: gone, reframed: reframed.map((r) => ({ id: r.id ?? null, file: r.file ? relative(world, r.file).replace(/\\/g, "/") : null })),
    framed: plan.framed, registry: registryChange,
  };
  // DRY writes the files and commits nothing; `quiet` says whether the printout would change anything on main
  if (dryRun) return { status: "dry", quiet: !git(world, ["status", "--porcelain", "--", MARKS_REL, REGISTRY_REL, ...DERIVED.filter((p) => existsSync(join(world, p)))]).trim(), ...receipt, summary };

  git(world, ["add", "-A", "--", MARKS_REL, REGISTRY_REL, ...DERIVED.filter((p) => existsSync(join(world, p)))]);
  const staged = git(world, ["diff", "--cached", "--name-only"]).trim();
  // EVERY SETTLEMENT IS PRINTED (POS-1025/a), a quiet one too: a settlement that changed nothing on main
  // is an EMPTY printout commit, so each settlement has its own commit, dated when it printed, for its tag
  // to stand on. A tag on an older commit would date the settlement by that commit (settlements-backfill
  // reads the window and published_at off the tagged commit's date) and stand two numbers on one commit.
  const message = `settlement: S${S.sealed_settlement} printout — ${summary.written} written, ${summary.removed} removed, ${summary.reframed} re-framed`
    + `\n\nThe settlement's printout of its sealed snapshot (POS-1025): window ${window}, snapshot ${S.id} ${S.digest}, town ${S.town_sha ?? "-"}.`
    + `\nMeasured from S${P.sealed_settlement ?? "?"} (window ${P.window_id}). Nothing here was decided after the seal.`
    + (staged ? "" : "\nThe settlement changed nothing on main: an empty printout, so it is printed and tagged like every other.");
  git(world, ["commit", "--quiet", ...(staged ? [] : ["--allow-empty"]), "-F", "-"], { input: message });
  return { status: staged ? "printed" : "quiet", ...receipt, summary, commit: git(world, ["rev-parse", "HEAD"]).trim() };
}

/** The annotated tag's message: the pair the notary certifies, and the town line snapshot-backfill reads. PURE. */
export function tagMessage({ settlement, window, snapshotId, digest, townSha }) {
  return `S${settlement} · window ${window} · snapshot ${snapshotId}\n\n`
    + `The settlement's own printout of its sealed snapshot (POS-1025; Darko 2026-11-13, "Every settlement").\n`
    + `settlement: ${settlement}\nwindow: ${window}\nsnapshot: ${snapshotId}\ndigest: ${digest}\nTown ${townSha ?? "-"}\n`;
}

/** The digest a settlement tag's message names, or null. PURE. */
export const digestOfTagMessage = (text) => /^digest: ([0-9a-f]{64})$/m.exec(String(text ?? ""))?.[1] ?? null;

/**
 * THE TAG, idempotent and never moved: `settlement/S<n>` at `commit`. An existing tag on the same commit
 * naming the same digest is done; any other existing tag is REFUSED (old tags are never rewritten).
 */
export async function tagSettlement(q, { world, window, commit, dryRun = false }) {
  const S = await snapshotHeader({ query: q }, { window });
  if (!S || S.sealed_settlement == null) throw new PrintoutRefusal("no-seal", `window ${window} has no numbered seal`);
  const tag = `${TAG_PREFIX}${S.sealed_settlement}`;
  const full = git(world, ["rev-parse", `${commit}^{commit}`]).trim();
  let existing = null;
  try { existing = git(world, ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`]).trim(); } catch { existing = null; }
  if (existing) {
    const msg = (() => { try { return git(world, ["for-each-ref", `refs/tags/${tag}`, "--format=%(contents)"]); } catch { return ""; } })();
    if (existing === full && digestOfTagMessage(msg) === S.digest) return { status: "already-tagged", tag, commit: full, digest: S.digest };
    throw new PrintoutRefusal("tag-conflict",
      `${tag} already stands at ${existing.slice(0, 12)}${digestOfTagMessage(msg) ? ` naming digest ${digestOfTagMessage(msg).slice(0, 12)}` : " with no digest"}; this printout is ${full.slice(0, 12)} for digest ${S.digest.slice(0, 12)}. A settlement tag is never moved or rewritten`,
      { tag, existing, commit: full });
  }
  const message = tagMessage({ settlement: S.sealed_settlement, window, snapshotId: S.id, digest: S.digest, townSha: S.town_sha });
  if (dryRun) return { status: "would-tag", tag, commit: full, message };
  git(world, ["tag", "-a", tag, full, "-F", "-"], { input: message });
  return { status: "tagged", tag, commit: full, digest: S.digest };
}

/** THE RECORD (095 § record_printout): the store keeps the printout's sha once; the world-marks head moves for the highest. */
export async function recordPrintout(q, { window, commit }) {
  const { rows: [r] } = await q("SELECT * FROM record_printout($1, $2)", [window, commit]);
  return { status: "recorded", settlement: r.settlement, commit: r.printout_sha, head_advanced: r.advanced };
}

// ── the CLI ─────────────────────────────────────────────────────────────────

const argOf = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };

async function main() {
  const mode = process.argv[2];
  const window = Number(argOf("--window"));
  const world = argOf("--world");
  const commit = argOf("--commit");
  const dryRun = process.argv.includes("--dry-run");
  const usage = "usage: settlement-printout.mjs print --world <clone> --window <W> [--since-window <W0>] [--dry-run] | tag --world <clone> --window <W> --commit <sha> [--dry-run] | record --window <W> --commit <sha>";
  if (!["print", "tag", "record"].includes(mode) || !Number.isInteger(window)
    || (mode !== "record" && (!world || !existsSync(world))) || (mode !== "print" && !/^[0-9a-f]{40}$/.test(commit ?? ""))) {
    console.error(usage); process.exit(2);
  }
  if (!process.env.WORLD2_CLEARING_URL) { console.error("WORLD2_CLEARING_URL missing (role clearing_job)"); process.exit(2); }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.WORLD2_CLEARING_URL });
  await client.connect();
  const q = (text, args) => client.query(text, args);
  let out;
  try {
    if (mode === "print") {
      const since = argOf("--since-window");
      out = await printSettlement(q, { world, window, sinceWindow: since == null ? null : Number(since), dryRun });
    } else if (mode === "tag") out = await tagSettlement(q, { world, window, commit, dryRun });
    else out = await recordPrintout(q, { window, commit });
  } catch (e) {
    out = e instanceof PrintoutRefusal
      ? { status: "refused", refused: e.reason, detail: e.detail, ...(e.refused ? { reframe: e.refused } : {}) }
      : { status: "refused", refused: "printout-tripped", detail: String(e?.message ?? e).slice(0, 600) };
  } finally {
    await client.end().catch(() => {});
  }
  console.log(JSON.stringify(out, null, 1));
  process.exit(out.status === "refused" ? 1 : 0);
}

const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (invokedDirectly) await main();
