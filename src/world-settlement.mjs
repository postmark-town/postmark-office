// world-settlement.mjs — THE WORLD EVERYONE READS: THE NEWEST SETTLEMENT,
// MINUS WHAT HAS BEEN OPPOSED (POS-359; Darko's rulings R1, R2, R3, R5, R9, R10
// and R16, docs/2026-10-04/design-notes/world-reads-the-store-rulings.md, as
// AMENDED 10-04: silence publishes everywhere; governance takes away).
//
// ── WHAT IS SERVED ───────────────────────────────────────────────────────────
//
// A settlement is every cleared mark minus every opposed one (R5). The clearing
// seals the cleared half as a snapshot (054/064, POS-357); the opposed half is
// read NOW, from the stance rows in the store, so an opposition takes effect at
// once (R16) and never waits for the next clearing.
//
//   1. WHICH SETTLEMENT. `S<n>` is a `settlements` row, and the row names its
//      snapshot (065 `snapshot_id`). The default is the newest row that names
//      one. The NUMBER is the settlements side's (054's header: "which snapshot
//      is S<n> is the settlements side's"): today the keeper's tag, read in by
//      the office tick; a row per clearing when POS-362 writes the settlement act.
//
//   2. ITS WORLD. `world_snapshot_folds` caches the snapshot's computed World by
//      the snapshot's digest (R1: "built outside it, by the office on first
//      read"). On a miss the office derives it from the snapshot's SOURCES, the
//      one derivation `--verify` runs (src/world-snapshot.mjs § snapshotFoldArgs,
//      Darko's POS-410 ruling): the world's engine at law_sha, the marks in their
//      filing order, the law and terrain at law_sha, the stakes replayed from
//      the town at the ledger position, the households from the register at the
//      seal through the town's own resolver. Then it keeps the result.
//
//   3. ITS WORDS (POS-362; Darko 2026-10-08, option A). The opposed half is a
//      source of the settlement like its marks: the seal records the newest
//      stance act (069 `stance_through`), and the settlement's World is its
//      sources folded WITH the words standing at the seal (§ wordsAtSeal: the
//      acts up to stance_through, on the versions that stood at the seal's
//      window). That World is what `world_snapshot_folds` keeps under the
//      digest (which covers stance_through), what `--verify` re-derives, and
//      what an asked `?settlement=S<n>` serves: its own seal's words only. A
//      snapshot with no stance_through (sealed before 069, back-filled) folds
//      with none, which is what it published.
//
//   4. MINUS THE OPPOSED SINCE. The newest World (no settlement asked) takes the
//      words standing NOW, at once (R16). The absolute vetoes only: the town's opposed
//      word, and a parcel holder's opposed word on a mark over their own ground,
//      each on the mark's CURRENT version (an amendment reopens every word,
//      R14). They are not subtracted here. The settlement's own arguments are
//      folded AGAIN with today's words beside them, so the world's own return path
//      carries them (R10: "so the existing return path carries it"): the
//      subtree, the escrow guard (an opposed mark with open stakes stands until
//      they unwind) and `returned[]`, every one the engine's. The town's words
//      go in as `townWords` (consent.mjs § THE TOWN'S WORD, world#146); a
//      holder's as their parcel's consent word, the field the parcel veto has
//      always read (consent.mjs § the parcel domain). With the same absolute
//      vetoes standing now as at the seal, the served World IS the kept one,
//      byte for byte.
//
// 5. FROM THE CUTOVER ON (Darko, 2026-10-09 10:25 EDT). Items 3 and 4 apply
//    to a settlement numbered at or after TOWN_STANCE_CUTOVER. One below it,
//    or any while it is unset, is served with no stance at all, as git is
//    written from it (town-stance.mjs § stancesCountAt). DECIDED ONCE, AT THE
//    SEAL (072): the snapshot header records the decision (`stances`), and
//    every reader here reads that record and never recomputes it (§ stancesOf).
//
// Market opposition is not a veto (R16) and is not read here: it is
// density-weighted and the settlement's fold applies it (POS-369). A holder's
// welcomed is not read either: what it confers is the settlement's (POS-362),
// not "opposition at once".

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { snapshotFoldArgs } from "./world-snapshot.mjs";

const bounce = (code, defect, hint) => { const e = new Error(defect); Object.assign(e, { code, defect, hint }); return e; };

// ── which settlement ────────────────────────────────────────────────────────

/** `S95`, `s95` or `95` → 95; absent or empty → null. Anything else refuses: a settlement is never guessed. */
export function settlementNumberOf(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const m = /^S?(\d+)$/i.exec(raw);
  if (!m) throw bounce(422, `"${raw}" names no settlement`, "pass settlement=S<n> (a settlement's number), or leave it out for the newest");
  return Number(m[1]);
}

// The settlement row beside the snapshot it names. `w.*` brings the header
// whole (054/064/065), so a store at any of them answers with what it has.
export const SETTLEMENT_SQL = `
  SELECT w.*, s.number AS settlement, s.tag_sha, s.published_at, s.blessed_at
    FROM settlements s JOIN world_snapshots w ON w.id = s.snapshot_id
   WHERE ($1::int IS NULL OR s.number = $1)
   ORDER BY s.number DESC
   LIMIT 1`;

/**
 * The settlement to serve: `{ header, newest }`, or null when the store holds
 * no settlement that names a snapshot (or `number` is not one). `newest` is the
 * newest settlement NUMBER the store holds at all, so a settlement that has no
 * snapshot yet is said rather than skipped silently.
 */
export async function settlementHeader(p, { number = null } = {}) {
  const { rows: [header] } = await p.query(SETTLEMENT_SQL, [number]);
  if (!header) return null;
  let newest = Number(header.settlement);
  try {
    const { rows: [n] } = await p.query("SELECT max(number) AS n FROM settlements");
    if (n?.n != null) newest = Number(n.n);
  } catch { /* the header above answered from the same table */ }
  return { header, newest };
}

// ── its World ───────────────────────────────────────────────────────────────

/** The cached World of a snapshot digest, as its text, or null. */
export async function cachedFoldText(p, digest) {
  const { rows: [r] } = await p.query("SELECT state FROM world_snapshot_folds WHERE digest = $1", [digest]);
  return r?.state ?? null;
}

/** Keep a World under its digest. A digest's World never changes, so a second writer's row is the same row. */
export async function keepFold(p, digest, text) {
  await p.query("INSERT INTO world_snapshot_folds (digest, state) VALUES ($1, $2) ON CONFLICT (digest) DO NOTHING", [digest, text]);
}

/** The cache's bytes: the fold as its file is written (marks-fold.mjs writes JSON.stringify(state, null, 2)). */
export const foldText = (state) => JSON.stringify(state, null, 2) + "\n";

// THE TOWN AT THE LEDGER POSITION. The register's households and the replayed
// stakes read the town's own code and files at the snapshot's town_sha
// (world-snapshot.mjs § householdsAt, § stakesAt), so the office needs a
// checkout AT that sha. It is a clone of its own, sharing the office's town
// clone's objects (`--shared`, nothing copied), sparse to the four kinds of
// file those reads open (snapshot-backfill.mjs § TOWN_PATHS, which the S93
// test proved complete), one directory per sha and never moved between shas.
// The office's own clone is read, never checked out or written.
const TOWN_PATHS = ["/tools/", "/ECONOMY-DIALS.json", "/WHITE_PAGES/stamp-ledger.md", "/WHITE_PAGES/*/ADDRESS.md"];
const TOWN_ROOT = join(tmpdir(), "postmark-settlement-town");
const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, "-c", "core.autocrlf=false", ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

export function townAtSha(townClone, sha, root = TOWN_ROOT) {
  if (!/^[0-9a-f]{40}$/.test(String(sha ?? ""))) throw new Error(`the snapshot names no town sha to read the ledger at (${sha ?? "none"})`);
  const dir = join(root, sha);
  if (existsSync(join(dir, ".git"))) return dir;
  mkdirSync(root, { recursive: true });
  const tmp = `${dir}.tmp-${process.pid}-${Date.now()}`;
  try {
    execFileSync("git", ["-c", "core.autocrlf=false", "-c", "core.longpaths=true", "clone", "-q", "--shared", "--no-checkout", townClone, tmp], { stdio: ["ignore", "pipe", "pipe"] });
    git(tmp, "sparse-checkout", "set", "--no-cone", ...TOWN_PATHS);
    git(tmp, "checkout", "-q", "--detach", sha);
    try { renameSync(tmp, dir); } catch (e) { if (!existsSync(join(dir, ".git"))) throw e; }   // another worker got there first
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  }
  return dir;
}

/**
 * Everything a settlement's fold reads, from its sources: the engine at
 * law_sha and `fold`'s arguments. Kept in memory per digest (a few), so a new
 * opposition re-folds without re-reading the sources.
 */
const ARGS = new Map();
export async function settlementFoldInputs(p, header, { worldRepo, townRepo }) {
  const hit = ARGS.get(header.digest);
  if (hit) return hit;
  if (!header.law_sha) throw new Error(`snapshot ${header.id} names no law sha, so there is no engine to fold it with`);
  const { materializeAtRef } = await import("./world-branches.mjs");
  const { filingAt } = await import("./world-filing-order.mjs");
  const tools = materializeAtRef(worldRepo, header.law_sha, "tools");
  const engine = await import(pathToFileURL(join(tools, "tools", "marks-fold.mjs")).href);
  let consent = null;
  try { consent = await import(pathToFileURL(join(tools, "tools", "consent.mjs")).href); } catch { consent = null; }
  // The town is read where the register needs it: the households at the seal
  // come from the register rows through the town's own resolver at the ledger
  // position, and the stakes are replayed from that same checkout. A snapshot
  // with no register (sealed before 064, or back-filled from a tag whose town had
  // none) folds from the store's escrow at town_sha and the printed roster at
  // law_sha, as `--verify` does without --town-repo. Which one a World came
  // from is read off its header (`register_digest`), never guessed.
  const town = townRepo && header.register_digest ? townAtSha(townRepo, header.town_sha) : null;
  const { args, stakesSource, householdsSource } = await snapshotFoldArgs(p, header, { townRepo: town, filing: filingAt(worldRepo, header.law_sha) });
  const inputs = {
    fold: engine.fold, args, stakesSource, householdsSource,
    // world#146: an engine that knows the town's words exports them. An older
    // one folds `townWords` as nothing, and the answer says so.
    townWordsRead: consent ? consent.TOWN_WORDS instanceof Set : false,
    // world#166: an engine that orders parcels by their FIRST claim exports the
    // field it reads. An older one orders by the restamped date, so a limit it
    // finds may be the wrong parcel, and the settlement does not apply it.
    claimOrderRead: typeof engine.CLAIMED_AT_FIELD === "string",
    // Ruling B (Darko, 2026-10-09; world consent.mjs § A STANCE RETURN TAKES THE
    // OPPOSED MARK ALONE): an engine that carries it says so. An older one
    // returns a stance-opposed mark with its whole subtree, and the answer says so.
    returnsAloneRead: consent ? consent.STANCE_RETURNS_ALONE === true : false,
  };
  ARGS.set(header.digest, inputs);
  if (ARGS.size > 3) ARGS.delete(ARGS.keys().next().value);
  return inputs;
}

/** One fold over a fresh copy of the arguments: the engine stamps its working fields onto the records it is handed. */
export const foldOver = (inputs, extra = {}) => inputs.fold({ ...structuredClone(inputs.args), ...extra });

// ── the opposed, now ────────────────────────────────────────────────────────

/**
 * THE PARCEL HOLDERS' OPPOSED WORDS, AS THEIR PARCELS' CONSENT WORDS. PURE.
 *
 * `opposed` is `[{ by, on }]`: a resident's standing opposed word on a mark's
 * current version. A word belongs to the speaker's HOUSEHOLD (POS-361, Q6: one
 * word per household), so it is written onto every parcel that household holds,
 * as `consent: { <on>: "opposed" }`, the field the engine's parcel veto reads.
 * Which of those parcels the mark actually stands on, and whether the mark is
 * the household's own, are the ENGINE's questions (consent.mjs: "a word with no
 * ground under it", "a household does not consent to itself"); nothing here
 * answers them a second time.
 *
 * `parcels` is the cached fold's `parcels` ({ id, household }); `householdOf`
 * maps a handle to its household key (the fold's own `households` map).
 * Returns the marks, with each changed parcel record copied, never edited.
 */
export function withHolderWords(marks, opposed, { parcels = [], householdOf = (h) => h } = {}) {
  if (!opposed?.length) return marks;
  const words = new Map();        // parcel id -> { target: "opposed" }
  for (const { by, on } of opposed) {
    const hh = householdOf(by);
    for (const p of parcels) {
      if (!p?.id || householdOf(p.household) !== hh) continue;
      if (!words.has(p.id)) words.set(p.id, {});
      words.get(p.id)[on] = "opposed";
    }
  }
  if (!words.size) return marks;
  return marks.map((m) => {
    const w = words.get(m?.id);
    if (!w) return m;
    const prior = m.consent && typeof m.consent === "object" && !Array.isArray(m.consent) ? m.consent : {};
    return { ...m, consent: { ...prior, ...w } };
  });
}

/**
 * The words standing NOW that take a mark down at once: `{ townWords, holderOpposed }`,
 * or `{ unread }` when the record or the versions could not be read. PURE over
 * its inputs: `rows` are the stance rows (world-stance.mjs § stanceRows),
 * `versions` the marks' versions (town-stance.mjs § readVersions).
 */
export async function vetoesFrom(rows, versions) {
  const { townWordsOf, TOWN_SPEAKER, AS_TOWN } = await import("./town-stance.mjs");
  const { standingStances } = await import("./world-stance.mjs");
  const townWords = townWordsOf(rows, { versions });
  const words = standingStances(rows, { versions });
  const holderOpposed = words
    .filter((w) => w.stance === "opposed" && !(w.by === TOWN_SPEAKER && w.as === AS_TOWN))
    .map((w) => ({ by: w.by, on: w.on }))
    .sort((a, b) => (a.on === b.on ? (a.by < b.by ? -1 : 1) : a.on < b.on ? -1 : 1));
  return { townWords, holderOpposed, words };
}

// ── the settlement's own words: those standing at its seal (POS-362) ────────

/** The stance acts up to a seal's `stance_through`, in the shape `STANCE_ACTS_SQL` reads. */
export const STANCE_ACTS_THROUGH_SQL =
  "SELECT id, at, crossing, actor, action, object, at_anchor, at_dx, at_dy, witnesses, class, payload, effect, household"
  + " FROM acts WHERE class = 'stance' AND id <= $1 ORDER BY id";

const atMs = (t) => (t instanceof Date ? t.getTime() : Date.parse(String(t ?? "")));

/**
 * THE WORDS A SETTLEMENT WAS SEALED WITH: `{ townWords, holderOpposed, words,
 * through, versions }`, the shape `vetoesFrom` gives for the words standing now,
 * so the one fold (§ foldWithWords) takes either. The acts are the store's
 * stance acts up to the header's `stance_through` (and the drained 1.0
 * photographs written by the seal's instant); each word counts only on the
 * version that stood at the seal's instant (town-stance.mjs §
 * readVersionsAtSeal), so an amendment cleared after the seal cannot reach back
 * into it. No stance_through: no word was read at this seal, and the settlement
 * has none. Throws when the record cannot be read: a settlement is never built
 * without its words.
 */
export async function wordsAtSeal(p, header, { worldRepo } = {}) {
  if (header?.stance_through == null) return { townWords: new Map(), holderOpposed: [], words: [], through: null, versions: null };
  const { stanceRows } = await import("./world-stance.mjs");
  const { readVersionsAtSeal } = await import("./town-stance.mjs");
  const { rows: acts } = await p.query(STANCE_ACTS_THROUGH_SQL, [header.stance_through]);
  const sealedAt = atMs(header.taken_at);
  const rows = (await stanceRows({ acts, worldClone: worldRepo }))
    .filter((r) => r.register || !(atMs(r.written_at) > sealedAt));
  const read = await readVersionsAtSeal(rows.map((r) => r.object), {
    query: async (sql, args) => ({ rows: (await p.query(sql, args)).rows }), at: header.taken_at,
  });
  if (read.unreachable) throw new Error(`the versions at snapshot ${header.id}'s seal could not be read: ${read.unreachable}`);
  return { ...(await vetoesFrom(rows, read.versions)), through: String(header.stance_through), versions: read.versions };
}

const opposedTownOf = (words) => [...(words?.townWords ?? new Map())].filter(([, w]) => w === "opposed").map(([id]) => id);

/** The sentence for a World whose engine predates ruling B (§ stanceReturnsWhole). */
export const wholeSentence = (header, marks) =>
  `the engine at law ${String(header.law_sha).slice(0, 12)} predates ruling B (a stance return takes the opposed mark alone), so ${marks.join(", ")} left with the marks standing in them`;

/** The absolute vetoes among a set of words, as `meta.opposed` names them; null when there are none. */
export function vetoesOf(words) {
  const town = opposedTownOf(words);
  const holders = words?.holderOpposed ?? [];
  return town.length || holders.length ? { town, holders } : null;
}

// ── the limits, applied by the settlement (POS-364; R11 as amended 10-04) ────
//
// "The office accepts every physically legal act. It does not refuse on
// governance grounds (limits, caps, 'you already have one'). The settlement
// applies limits in chronological order of the acts. The first N welcomed
// stand; the rest are opposed, citing the limit." The doors and the clearing no
// longer refuse a parcel over a limit (AUDIT G1–G5); the world's fold already
// decides who is over one, in claim order (marks-fold § admissibility,
// `parcelsInClaimOrder`), and says so in `errors`. Each such error becomes the
// town's opposition on that mark, citing the law mark the fold's own sentence
// names, so the mark leaves through the engine's return path with its subtree,
// and a staked one stands until its stakes unwind (R10), exactly as any
// opposition does. It is a tested rule in R12's sense: the fold is the test.

/** The limits the settlement applies, each by the law mark it cites and the fold's sentence for it. */
export const LIMITS = Object.freeze([
  Object.freeze({ law: "the-town/one-per-resident", sentence: (e) => e.includes("the-town/one-per-resident") }),
  Object.freeze({ law: "the-town/claim-cap", sentence: (e) => e.startsWith("parcel claim capped") }),
]);

/**
 * The marks a fold finds over a limit: `[{ mark, law, error }]`, in the fold's
 * own order (claim order), from its `errors`. PURE. Any other error is not a
 * limit and is not read here.
 */
export function limitOppositions(state) {
  const out = [];
  for (const e of state?.errors ?? []) {
    const text = String(e?.error ?? "");
    const limit = LIMITS.find((l) => l.sentence(text));
    if (limit && e?.mark) out.push({ mark: String(e.mark), law: limit.law, error: text });
  }
  return out;
}

/**
 * A settlement's sources folded WITH a set of words and the limits:
 * `{ state, vetoes }`, the one fold both the seal's words and today's go
 * through. With no absolute veto among the words and nothing over a limit it is
 * the cleared fold itself. Otherwise the arguments are folded again with the
 * town's words (and each limit, as the town's opposition citing its law) as
 * `townWords` (world#146), and each holder's opposed word on their parcels'
 * `consent:` maps, so the subtree, the escrow guard and `returned[]` are the
 * engine's (R10). Who is over a limit, and the parcels and households a
 * holder's word is written through, are read from the CLEARED fold, never from
 * a fold some other word already took a parcel out of. `cleared` is that fold
 * when the caller already holds it. `vetoes.town_unread` names the town's
 * opposed marks (limits included) an engine older than world#146 could not carry.
 *
 * A STANCE RETURN TAKES THE OPPOSED MARK ALONE; A LAW RETURN TAKES ITS SUBTREE
 * (Darko's ruling B, 2026-10-09). The two are told apart for the engine: each
 * limit goes in as the town's word AND in `townLaws` (mark → the law it cites),
 * and an engine with ruling B returns those with their subtree, as before, and
 * every other opposition alone, its positioned children reparented. An engine
 * older than ruling B ignores `townLaws` and returns every opposition with its
 * subtree; `vetoes.stance_returns_whole` names the stance returns it did that to.
 */
export function foldWithWords(inputs, words, cleared = null) {
  const base = cleared ?? foldOver(inputs);
  // THE LIMITS NEED BOTH: the town's word to carry them (world#146) and the
  // first-claim order to find the right parcel (world#166). Without the second,
  // an amended parcel sorts last and the limit would oppose it in place of the
  // one claimed after it (Wright's review of #441), so nothing is applied, and
  // the answer names what was found and not applied.
  const found = limitOppositions(base);
  const limitsApply = !!(inputs.townWordsRead && inputs.claimOrderRead);
  const rules = limitsApply ? found : [];
  const v = vetoesOf(words);
  const notApplied = !limitsApply && found.length
    ? { limits_unread: found.map(({ mark, law }) => ({ mark, law })) } : {};
  if (!v && !rules.length) return { state: base, vetoes: found.length && !limitsApply ? { town: [], holders: [], ...notApplied } : null };
  const holders = v?.holders ?? [];
  const townWords = new Map(words?.townWords ?? []);
  for (const r of rules) townWords.set(r.mark, "opposed");
  const hh = base.households ?? {};
  const state = foldOver(inputs, {
    marks: withHolderWords(structuredClone(inputs.args.marks), holders, { parcels: base.parcels ?? [], householdOf: (h) => hh[h] ?? h }),
    ...(inputs.townWordsRead ? { townWords } : {}),
    ...(inputs.townWordsRead && rules.length ? { townLaws: new Map(rules.map((r) => [r.mark, r.law])) } : {}),
  });
  if (rules.length && inputs.townWordsRead) {
    // The limit is the answer for these marks now: each return cites its law,
    // and the fold's admissibility error for it is answered by that return.
    const byMark = new Map(rules.map((r) => [r.mark, r]));
    state.returned = (state.returned ?? []).map((x) => (byMark.has(x.mark) ? { ...x, law: byMark.get(x.mark).law, limit: byMark.get(x.mark).error } : x));
    state.errors = (state.errors ?? []).filter((e) => !byMark.has(String(e?.mark)));
  }
  const town = v?.town ?? [];
  const carriedNot = [...town, ...rules.map((r) => r.mark)];
  return {
    state,
    vetoes: {
      town, holders,
      ...(rules.length ? { limits: rules.map(({ mark, law }) => ({ mark, law })) } : {}),
      ...(inputs.townWordsRead || !carriedNot.length ? {} : { town_unread: carriedNot }),
      ...stanceReturnsWhole(inputs, state),
      ...notApplied,
    },
  };
}

/**
 * `{ stance_returns_whole: [mark] }` when the engine predates ruling B and
 * returned a stance-opposed mark (not a limit's, which cites `law`) with a
 * positioned mark under it, which ruling B would have left standing; `{}`
 * otherwise. PURE over the fold's arguments and its World.
 */
export function stanceReturnsWhole(inputs, state) {
  if (inputs?.returnsAloneRead) return {};
  const positioned = new Set((inputs?.args?.marks ?? []).filter((m) => (m?.kind === "sited" || m?.kind === "parcel") && m.at).map((m) => String(m.id)));
  const whole = (state?.returned ?? [])
    .filter((r) => r?.state === "returned" && !r.law && (r.subtree ?? []).some((s) => positioned.has(String(s))))
    .map((r) => r.mark);
  return whole.length ? { stance_returns_whole: whole } : {};
}

/**
 * WHAT A SETTLEMENT TAKES AWAY, as the git write-down needs it (POS-364): the
 * marks its World returns (`state: "returned"`, each with the subtree the engine
 * named), folded from the snapshot's sources with the words standing at its seal
 * and the limits. A word's return whose stakes have not unwound
 * (`pending-escrow`) still stands, so it is not taken away here.
 *
 * A PARCEL OVER A LIMIT IS ALWAYS TAKEN AWAY FROM GIT, staked or not, applied or
 * not (Wright's review of #441). The world's sweep folds the tree with the same
 * admissibility, and a parcel it finds over a limit quarantines its household's
 * whole sketchbook: one refusal holding every mark of that household. So a
 * limit's return (it cites `law`) leaves with its subtree whatever its escrow
 * state, and a limit the engine found and could not apply (an engine older than
 * the first-claim order) leaves too. `{ slugs, vetoes }`. Throws when the
 * settlement cannot be folded; the caller withholds the clearing's forecast instead.
 */
export async function settlementTakesAway(p, header, { worldRepo, townRepo = null }) {
  const inputs = await settlementFoldInputs(p, header, { worldRepo, townRepo });
  // R14: BEFORE THE CUTOVER, EVERYTHING COUNTS AS RATIFIED, AND THE CUTOVER IS
  // A SETTLEMENT NUMBER (Darko, 2026-10-09 10:25 EDT, the conservative
  // cutover). A settlement numbered below TOWN_STANCE_CUTOVER takes no mark out
  // of git for a stance; from it on, every opposition standing at its seal
  // counts. The seal decided which, and the header records it (072, § stancesOf):
  // this reads the record, so re-running a sealed settlement's write-down gives
  // the same git forever, whatever the variable or the settlements table says
  // now. With no stance counted, the words are not read at all: the fold is the
  // cleared one plus the LIMITS, which are the clearing's and the settlement's
  // whatever the cutover (R11).
  const gate = stancesOf(header);
  const stancesCount = gate.counts;
  const words = stancesCount ? await wordsAtSeal(p, header, { worldRepo }) : NO_WORDS;
  const cleared = foldOver(inputs);
  const { state, vetoes } = foldWithWords(inputs, words, cleared);
  const slugs = new Set();
  const limitParcels = [];
  // WHAT LEAVES WITH A RETURN IS THE ENGINE'S `subtree` (Darko's ruling B,
  // 2026-10-09). A stance return takes the opposed mark alone: its `subtree` is
  // only the mark continued (its names and predicates, which have no place of
  // their own, and in git without it would name a parent that is not there),
  // and every positioned child stays in git where it stands, named in `stays`.
  // A law return takes its subtree as before. An engine older than ruling B
  // names every child in `subtree`; git then agrees with the World it served
  // (`stance_returns_whole` says so), never with a fold this office did not run.
  for (const r of state.returned ?? []) {
    if (r?.state !== "returned" && !r?.law) continue;
    slugs.add(String(r.mark));
    for (const s of r.subtree ?? []) slugs.add(String(s));
    if (r.law) limitParcels.push(String(r.mark));
  }
  for (const l of vetoes?.limits_unread ?? []) { slugs.add(String(l.mark)); limitParcels.push(String(l.mark)); }
  // A limit parcel's OWN household's marks on its ground go with it. The engine
  // never admitted the plot as ground, so they are not its subtree there, and in
  // git without their parcel the sweep's admitDelta would quarantine the house.
  // Another household's marks on it are Darko's open question (B), left alone.
  const hh = cleared.households ?? {};
  const rows = (cleared.marks ?? []).map((m) => ({ slug: m.id, household: hh[m.by] ?? m.by, at: m.at, extent: m.extent, parent: m.parent ?? null }));
  for (const sl of ownGroundOf(limitParcels, rows)) slugs.add(sl);
  return {
    slugs, vetoes,
    stances: gate.recorded,
    ...(stancesCount ? {} : { stances_not_counted: `${gate.why}, so no stance takes one out of git` }),
    ...(vetoes?.stance_returns_whole ? { stance_returns_whole: wholeSentence(header, vetoes.stance_returns_whole) } : {}),
  };
}

/**
 * THE SEAL'S DECISION (072; Wright, 2026-10-09: decide once, at the seal). The
 * clearing job asks this just before it seals and hands the answer to the seal,
 * which records it on the header: `{ counted, cutover, settlement_inferred, how }`.
 * The snapshot being sealed has no settlements row yet, so its number is the
 * settlement this crossing makes (§ settlementNumberAt: the store's newest plus
 * one, `how: "inferred"`). The only caller is the seal; every reader reads the
 * record (§ stancesOf). A malformed cutover throws: the seal never guesses it.
 */
export async function stancesAtSeal(p, { env = process.env, header = { id: null } } = {}) {
  const { stancesCountAt } = await import("./town-stance.mjs");
  const at = await settlementNumberAt(p, header);
  const gate = stancesCountAt(at.number, env);
  return { counted: gate.counts, cutover: gate.cutover == null ? null : `S${gate.cutover}`, settlement_inferred: at.number, how: at.inferred ? "inferred" : "row" };
}

/**
 * DOES THE LAW AT A SHA CARRY RULING B? (world#171: `STANCE_RETURNS_ALONE` in
 * tools/consent.mjs.) `true`, `false`, or null when the world checkout cannot
 * answer. The clearing's journal says it beside the seal's decision, so a
 * cutover sealed on a law older than B is seen the crossing it happens
 * (DEPLOY.md § 072, step 0).
 */
export function lawCarriesRulingB(worldRepo, lawSha) {
  if (!worldRepo || !lawSha) return null;
  try {
    const src = execFileSync("git", ["-C", worldRepo, "show", `${lawSha}:tools/consent.mjs`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return /export const STANCE_RETURNS_ALONE = true\b/.test(src);
  } catch { return null; }
}

/**
 * WHAT THE SEAL RECORDED: `{ counts, why, recorded }`. PURE over the header. No
 * record (sealed before 072, back-filled) reads as NOT COUNTED: everything
 * before the deploy is the old blessing (R14). Never recomputed from the
 * cutover or the settlements table as they are now.
 */
export function stancesOf(header) {
  const raw = header?.stances ?? null;
  const s = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!s) return { counts: false, recorded: null, why: `snapshot ${header?.id ?? "?"} recorded no stance decision at its seal (sealed before 072, or back-filled), so it counts as before the cutover: every mark ratified (R14)` };
  if (s.counted === true) return { counts: true, recorded: s, why: null };
  const n = s.settlement_inferred == null ? "this settlement" : `S${s.settlement_inferred}`;
  return { counts: false, recorded: s, why: s.cutover == null
    ? `TOWN_STANCE_CUTOVER was not set when ${n} was sealed: before the cutover every mark counts as ratified (R14)`
    : `${n} was below the cutover ${s.cutover} when it was sealed: a settlement before the cutover counts every mark as ratified (R14)` };
}

/** No words: what a settlement folds with when no stance counts at it (§ stancesOf). */
export const NO_WORDS = Object.freeze({ townWords: new Map(), holderOpposed: [], words: [], through: null, versions: null });

/**
 * WHICH SETTLEMENT A SNAPSHOT IS, by number: `{ number, inferred }`. A header
 * read through `settlements` carries it. A snapshot the clearing has just
 * sealed has no settlements row yet (the row is written when the keeper's tag
 * is ingested, settlements-backfill.mjs), so at the crossing its number is the
 * settlement this crossing makes: the store's newest plus one, and `inferred`
 * says so. A store with no settlement at all answers null. It runs inside the
 * clearing's transaction, so it catches nothing: a failed query there aborts
 * the transaction, and the window rolls back whole (review of #451, F5). At the
 * seal there is no snapshot id yet, so the row is not looked for.
 */
export async function settlementNumberAt(p, header) {
  if (header?.settlement != null) return { number: Number(header.settlement), inferred: null };
  if (header?.id != null) {
    const { rows: [r] } = await p.query("SELECT number FROM settlements WHERE snapshot_id = $1 ORDER BY number LIMIT 1", [header.id]);
    if (r?.number != null) return { number: Number(r.number), inferred: null };
  }
  const { rows: [m] } = await p.query("SELECT max(number) AS n FROM settlements");
  if (m?.n == null) return { number: null, inferred: `snapshot ${header?.id} names no settlement, and the store holds none` };
  const next = Number(m.n) + 1;
  return { number: next, inferred: `snapshot ${header?.id} (window ${header?.window_id ?? "?"}) names no settlement yet, so it is read as the settlement this crossing makes: S${next}, the store's newest plus one` };
}

/**
 * The marks a set of withheld parcels carries out of git with them (POS-364
 * review): every mark whose declared parent chain reaches one of them, and
 * every mark of the PARCEL'S OWN HOUSEHOLD whose centre stands on its ground.
 * PURE over `rows` (`{ slug, household, at, extent, parent }`, parent by slug).
 * The parcels themselves are not in the answer.
 */
export function ownGroundOf(parcels, rows) {
  const bySlug = new Map(rows.map((r) => [String(r.slug), r]));
  const wanted = new Set(parcels.map(String));
  const out = new Set();
  const inside = (m, p) => m?.at && p?.at && p?.extent
    && Math.abs(Number(m.at.x) - Number(p.at.x)) <= Number(p.extent.w) / 2
    && Math.abs(Number(m.at.y) - Number(p.at.y)) <= Number(p.extent.h) / 2;
  for (const r of rows) {
    const slug = String(r.slug);
    if (wanted.has(slug)) continue;
    let up = r.parent ? bySlug.get(String(r.parent)) : null, guard = 0;
    while (up && guard++ < 64) { if (wanted.has(String(up.slug))) { out.add(slug); break; } up = up.parent ? bySlug.get(String(up.parent)) : null; }
    if (out.has(slug)) continue;
    for (const ps of wanted) {
      const p = bySlug.get(ps);
      if (p && p.household === r.household && inside(r, p)) { out.add(slug); break; }
    }
  }
  // A withheld mark's own declared children go too.
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of rows) if (!out.has(String(r.slug)) && !wanted.has(String(r.slug)) && r.parent && out.has(String(r.parent))) { out.add(String(r.slug)); grew = true; }
  }
  return out;
}

/** The stance rows in the store, through the office's own pool. */
export const STANCE_ACTS_SQL =
  "SELECT id, at, crossing, actor, action, object, at_anchor, at_dx, at_dy, witnesses, class, payload, effect, household"
  + " FROM acts WHERE class = 'stance' ORDER BY id";

/** Read the words standing now, through `p`. Never throws: `{ unread }` names what could not be read. */
export async function vetoesNow(p, { worldRepo } = {}) {
  try {
    const { stanceRows } = await import("./world-stance.mjs");
    const { readVersions } = await import("./town-stance.mjs");
    const { rows: acts } = await p.query(STANCE_ACTS_SQL);
    const rows = await stanceRows({ acts, worldClone: worldRepo });
    const read = await readVersions(rows.map((r) => r.object), { query: async (sql, args) => ({ rows: (await p.query(sql, args)).rows }) });
    if (read.unreachable) return { unread: read.unreachable };
    return vetoesFrom(rows, read.versions);
  } catch (e) {
    return { unread: String(e?.message ?? e).slice(0, 200) };
  }
}

// ── each mark's labels: the town's stance, and who it awaits (R9, R14) ──────
//
// ONE TAXONOMY (POS-361, Darko 2026-10-06; Wright 2026-10-07): the town speaks
// declare-stance-on's own words. It declares neutral or opposed; its welcomed
// is adoption and reserved. There is no "ratified" word (R7/R15 superseded).

/**
 * Every served mark with its labels. PURE. Returns a new array; the marks it is
 * handed are not edited.
 *
 *   (none)               the mark's current version stood at or before the
 *                        cutover: the old blessing carries over (R14), so it
 *                        carries no label (town-stance.mjs § clearedAtCutover)
 *   town_stance          "neutral" when the town declared neutral on its current
 *                        version (it clears "awaiting the town" and confers nothing)
 *   awaiting             who has standing and has not spoken (R9), only when not
 *                        empty: town-stance.mjs § awaitingOf, the one function the
 *                        stance inbox reads too (POS-361, Q6)
 *
 * An opposed mark is not served, so it is never labelled. Law marks (kind
 * `class`) are the law, not cleared marks, and carry nothing.
 */
export async function labelMarks(marks, { townWords, cutover = null, versions = null, words = [], householdOf = (h) => h, overlaps }) {
  const { awaitingOf, clearedAtCutover, townSeatOf } = await import("./town-stance.mjs");
  const townSeat = townSeatOf({ cutover, versions });
  const ground = marks.filter((m) => m?.kind !== "class");
  return marks.map((m) => {
    if (!m?.id || m.kind === "class") return m;
    if (clearedAtCutover(m, { cutover, versions })) return m;
    const neutral = townWords?.get?.(m.id) === "neutral";
    const who = awaitingOf(m, { marks: ground, overlaps, words, householdOf, townSeat }).map((a) => a.who);
    if (!neutral && !who.length) return m;
    return { ...m, ...(neutral ? { town_stance: "neutral" } : {}), ...(who.length ? { awaiting: who } : {}) };
  });
}

// ── serving ─────────────────────────────────────────────────────────────────

/** The served World's cache key beyond its digest: the words that moved it. */
export function vetoKey(townWords, holderOpposed) {
  const town = [...(townWords ?? new Map())].filter(([, w]) => w === "opposed").map(([id]) => id).sort();
  return createHash("sha256").update(JSON.stringify([town, holderOpposed ?? []])).digest("hex").slice(0, 16);
}

const SERVED = new Map();       // `${digest}|${vetoKey | "seal"}` -> state
const SEALS = new Map();        // digest -> the words its seal was struck with
const LABELLED = new Map();     // `${digest}|${vetoKey}|${labelKey}` -> marks
const NOW = { at: 0, key: null, value: null };
/** How long a read of "which settlement, which words" is reused: R16's "within its refresh". */
export const REFRESH_MS = 60_000;

/** Test seam: forget every cached read. */
export function resetSettlementCaches() { SERVED.clear(); LABELLED.clear(); ARGS.clear(); SEALS.clear(); NOW.at = 0; NOW.key = null; NOW.value = null; }

/** A seal's words, read once per digest: a sealed settlement's words never change. */
async function sealWordsOf(p, header, { worldRepo }) {
  const hit = SEALS.get(header.digest);
  if (hit) return hit;
  const w = await wordsAtSeal(p, header, { worldRepo });
  SEALS.set(header.digest, w);
  if (SEALS.size > 8) SEALS.delete(SEALS.keys().next().value);
  return w;
}

async function refreshed(key, read, now = Date.now()) {
  if (NOW.key === key && now - NOW.at < REFRESH_MS) return NOW.value;
  const value = await read();
  Object.assign(NOW, { at: now, key, value });
  return value;
}

/**
 * `/world/state`'s whole decision. With the store engaged: the settlement (the
 * newest, or the one asked for). Without a settlement to serve, the office's
 * file answer, as before, and `meta` says why it was not the settlement. A
 * settlement ASKED FOR never falls through: the file is not that settlement, so
 * the answer is a refusal that names why.
 *
 * @param {object} o
 * @param {string|null} o.asked      the `settlement` query value
 * @param {Function} o.fileAnswer    () => Promise<object>, the answer before POS-359
 * @param {boolean} o.engaged        is the store engaged at this office
 * @param {Function} o.pool          () => Promise<pg pool>
 */
export async function settlementOrFile({ asked = null, fileAnswer, engaged, pool, worldRepo, townRepo = null }) {
  const number = settlementNumberOf(asked);          // a malformed name refuses before anything is read
  if (!engaged) {
    if (number != null) throw bounce(404, `S${number} cannot be read at this office`, "the store is not engaged here (WORLD2_PG/WORLD2_PG_URL), and a settlement is read from the store");
    return fileAnswer();
  }
  let served = null, reason = null;
  try {
    served = await servedSettlement(await pool(), { settlement: asked, worldRepo, townRepo });
    if (!served) reason = number == null ? "the store holds no settlement that names a snapshot yet" : null;
  } catch (e) {
    if (number != null) throw e?.code ? e : bounce(503, `S${number} could not be read`, String(e?.message ?? e).slice(0, 200));
    reason = `the newest settlement could not be read: ${String(e?.message ?? e).slice(0, 200)}`;
    console.error(`[world-settlement] ${reason} — serving the published file`);
  }
  if (served) return served;
  if (number != null) throw bounce(404, `S${number} is not a settlement this store holds a snapshot for`, "GET /world/state with no settlement serves the newest one; GET /world/settlements lists them");
  const file = await fileAnswer();
  return { ...file, meta: { ...(file?.meta ?? {}), source: file?.meta?.source ?? "file", not_settlement: reason } };
}

/**
 * THE GRAPH ON THE SETTLEMENT (POS-359, Wright's option A, 2026-10-07).
 * `/world/graph` draws world.db, which the tick hydrates from the tag's tree;
 * its mark nodes are narrowed to the marks the served settlement holds (minus
 * the opposed), so an opposed mark leaves the graph at once and `as_of` names
 * S<n>. A mark cleared after the hydration is not in world.db and stays absent
 * until the graph is hydrated from the settlement itself (option B, a follow-up).
 * `{ ids, settlement, digest }`, null when there is no settlement to narrow to,
 * or `{ unread }`.
 */
export async function settledMarkIds({ engaged, pool, worldRepo, townRepo = null }) {
  if (!engaged) return null;
  try {
    const served = await servedSettlement(await pool(), { worldRepo, townRepo });
    if (!served) return null;
    return { ids: new Set((served.marks ?? []).map((m) => m.id)), settlement: served.meta.as_of.settlement, digest: served.meta.as_of.digest };
  } catch (e) {
    if (e?.code === "42P01") return null;              // a store without 054/065: nothing to narrow to
    return { unread: String(e?.message ?? e).slice(0, 200) };
  }
}

/** A graph view stamped with the settlement it was narrowed to (or why it was not). PURE. */
export function graphOnSettlement(view, settled) {
  if (!settled || view?.error) return view;
  if (settled.unread) return { ...view, as_of: { ...view.as_of, settlement_unread: `the graph is not narrowed to a settlement: ${settled.unread}` } };
  return {
    ...view,
    as_of: {
      ...view.as_of, settlement: settled.settlement, digest: settled.digest,
      settlement_note: "mark nodes are the served settlement's (opposed marks absent); a mark cleared after this graph's hydration is not drawn until it is hydrated from the settlement",
    },
  };
}

/**
 * THE ANSWER `/world/state` SERVES: the settlement's World, minus every opposed
 * mark and its subtree, with `meta` saying which settlement it is. Null when the
 * store holds no settlement that names a snapshot (or not the one asked for).
 *
 * @param {object} p the office's store pool (office_api)
 * @param {object} o
 * @param {string|null} o.settlement `S<n>` from the query, or null for the newest
 * @param {string} o.worldRepo the office's world clone (the engine and filings at law_sha)
 * @param {string|null} o.townRepo the office's town clone (the ledger at town_sha)
 */
export async function servedSettlement(p, { settlement = null, worldRepo, townRepo = null, now = Date.now() } = {}) {
  const number = settlementNumberOf(settlement);
  const { found, words } = await refreshed(`${number ?? "newest"}`, async () => ({
    found: await settlementHeader(p, { number }),
    words: await vetoesNow(p, { worldRepo }),
  }), now);
  if (!found) return null;
  const { header, newest } = found;

  // ASKED BY NAME, a settlement is its own seal's words only; the newest World
  // is today's words (Darko, 2026-10-08). The seal's words are read once per digest.
  //
  // THE SERVED WORLD WAITS FOR THE CUTOVER TOO (Darko, 2026-10-09 10:25 EDT,
  // the conservative cutover, point 2): a settlement numbered below
  // TOWN_STANCE_CUTOVER, or any while it is unset, is served with no stance
  // applied, exactly as git is written from it (§ settlementTakesAway), so the
  // page and the record never disagree. The limits are applied whatever the
  // cutover (R11). The kept World stays its digest's (the sources and the
  // seal's words); whether those words count is this read's, by the number.
  const asked = number != null;
  const gate = stancesOf(header);
  // The settlement's own words: its seal's when stances count at it, none when
  // they do not. That is what its World is, what is kept under its digest (the
  // digest covers the recorded decision) and what --verify re-derives.
  const seal = gate.counts ? await sealWordsOf(p, header, { worldRepo }) : NO_WORDS;
  const applied = !gate.counts ? NO_WORDS : asked ? seal : words;
  const sealKey = vetoKey(seal.townWords, seal.holderOpposed);
  const vk = applied.unread ? "unread" : vetoKey(applied.townWords, applied.holderOpposed);
  const servedKey = `${header.digest}|${!gate.counts ? "uncounted" : asked ? "seal" : vk}`;
  let state = SERVED.get(servedKey) ?? null;
  let built = false;
  if (!state) {
    // A WORLD KEPT BY OLDER CODE IS NOT READ FOR A 069-ERA HEADER (review of
    // #451, F2). A snapshot sealed with stance_through set and no recorded
    // decision (stances NULL: before 072) may have had its World kept by #432's
    // code with its seal's words applied; read as "not counted" now, that text
    // would serve those words while git keeps the marks. So such a header is
    // folded fresh, never read from the cache (DEPLOY.md § 072 clears those rows
    // on dev and rehearsal stores).
    const keptMayHoldWords = header.stance_through != null && header.stances == null;
    let text = keptMayHoldWords ? null : await cachedFoldText(p, header.digest);
    let inputs = null, cleared = null, kept = null;
    if (text == null) {
      // The settlement's World: its sources and its seal's words, kept under its digest.
      inputs = await settlementFoldInputs(p, header, { worldRepo, townRepo });
      cleared = foldOver(inputs);
      kept = foldWithWords(inputs, seal, cleared);
      text = foldText(kept.state);
      await keepFold(p, header.digest, text);
      built = true;
    }
    let vetoes;
    if (applied.unread || vk === sealKey) {
      // The kept World IS this view: the seal's words, or today's when their vetoes are the seal's.
      state = JSON.parse(text);
      vetoes = kept ? kept.vetoes : vetoesOf(seal);
      if (vetoes && !kept && opposedTownOf(seal).length) {
        inputs ??= await settlementFoldInputs(p, header, { worldRepo, townRepo });
        if (!inputs.townWordsRead) vetoes = { ...vetoes, town_unread: vetoes.town };
      }
      if (vetoes && !kept) {
        inputs ??= await settlementFoldInputs(p, header, { worldRepo, townRepo });
        vetoes = { ...vetoes, ...stanceReturnsWhole(inputs, state) };
      }
    } else {
      inputs ??= await settlementFoldInputs(p, header, { worldRepo, townRepo });
      const now = foldWithWords(inputs, applied, cleared);
      state = now.state;
      vetoes = now.vetoes;
    }
    // The limits the settlement applied are read off the World itself (each return citing its law), so a
    // kept World answers them as well as a fresh fold does (POS-364).
    const limits = (state.returned ?? []).filter((x) => x?.law).map((x) => ({ mark: x.mark, law: x.law }));
    if (vetoes || limits.length) state.__vetoes = {
      town: vetoes?.town ?? [], holders: vetoes?.holders ?? [], limits,
      ...(vetoes?.town_unread ? { town_unread: `the engine at law ${String(header.law_sha).slice(0, 12)} predates the town's word (world#146), so the town's opposition on ${vetoes.town_unread.join(", ")} could not be carried` } : {}),
      ...(vetoes?.stance_returns_whole ? { stance_returns_whole: wholeSentence(header, vetoes.stance_returns_whole) } : {}),
    };
    SERVED.set(servedKey, state);
    if (SERVED.size > 6) SERVED.delete(SERVED.keys().next().value);
  }

  const { __vetoes, ...world } = state;
  const labels = await labelsFor(p, header, world, applied, { worldRepo, servedKey, seal: asked ? seal : null });
  if (labels.marks) world.marks = labels.marks;
  const n = Number(header.settlement);
  return {
    ...world,
    meta: {
      source: "settlement",
      as_of: {
        settlement: `S${n}`,
        digest: header.digest,
        // The settlements row's own record of it: the commit its tag names and
        // when that crossing published (018). A reader comparing against
        // GET /world/settlements meets the same two values there.
        tag_sha: header.tag_sha ?? null,
        published_at: header.published_at ? new Date(header.published_at).toISOString() : null,
        window: header.window_id ?? null,
        marks: header.marks,
        law_sha: header.law_sha ?? null,
        town_sha: header.town_sha ?? null,
        world_sha: header.world_sha ?? null,
        register_digest: header.register_digest ?? null,
        sealed_at: header.taken_at ? new Date(header.taken_at).toISOString() : null,
        snapshot: header.source ?? "clearing",
      },
      // A newer settlement number with no snapshot behind it yet is said, never skipped silently.
      ...(number == null && newest > n ? { newer_unsealed: `S${newest}` } : {}),
      opposed: __vetoes ? { town: __vetoes.town, holders: __vetoes.holders, limits: __vetoes.limits ?? [] } : { town: [], holders: [], limits: [] },
      // Whose words those are (POS-362): an asked settlement's own seal's, or today's.
      words: {
        ...(asked ? { as_of: "the seal", stance_through: seal.through } : { as_of: "now", seal_stance_through: seal.through }),
        counted: gate.counts,
        ...(gate.counts ? {} : { not_counted: `${gate.why}, so no stance is applied to this World` }),
      },
      ...(__vetoes?.town_unread ? { opposed_unread: __vetoes.town_unread } : {}),
      ...(__vetoes?.stance_returns_whole ? { stance_returns_whole: __vetoes.stance_returns_whole } : {}),
      ...(applied.unread ? { opposed_unread: `the standing words could not be read, so nothing opposed since the seal is taken away here: ${words.unread}` } : {}),
      ...(built ? { built: "derived from the snapshot's sources on this read, and kept" } : {}),
      ...(labels.unread ? { labels_unread: labels.unread } : {}),
      ...(labels.omitted ? { labels_omitted: labels.omitted } : {}),
      // A limit the World still shows as an admissibility error was found and
      // NOT applied (an engine older than the first-claim order, world#166).
      ...(() => {
        const left = limitOppositions(world);
        return left.length ? { limits_unread: `${left.length} parcel(s) over a limit (${[...new Set(left.map((l) => l.law))].join(", ")}) are not opposed here: the engine at law ${String(header.law_sha).slice(0, 12)} orders parcels by their latest date, not their first claim` } : {};
      })(),
    },
  };
}

// The engine's geometry at a law sha: the overlap the stance door and the label
// both weigh ground with (world-stance.mjs § stanceGeometry), read at the
// settlement's own law rather than main's.
const GEOMETRY = new Map();
async function overlapsAt(worldRepo, sha) {
  if (!GEOMETRY.has(sha)) {
    const { materializeAtRef } = await import("./world-branches.mjs");
    const g = await import(pathToFileURL(join(materializeAtRef(worldRepo, sha, "tools"), "tools", "geometry.mjs")).href);
    GEOMETRY.set(sha, (a, b) => g.overlapArea(g.rect(a), g.rect(b)) > 0);
  }
  return GEOMETRY.get(sha);
}

/**
 * The served marks, labelled (§ labelMarks): `{ marks }`, or `{ unread }` when
 * the cutover, the versions or the words could not be read — a label nobody
 * could read is never written as "awaiting" (it would tell a resident the town
 * owes a word it may have spoken). Kept per served World and per the words
 * standing, so a refresh with nothing new costs nothing.
 */
async function labelsFor(p, header, world, words, { worldRepo, servedKey, seal = null }) {
  if (words.unread) return { unread: `the standing words could not be read: ${words.unread}` };
  // NO CUTOVER, NO LABELS (Wright, 2026-10-07). R14 carries the old blessing
  // over; until TOWN_STANCE_CUTOVER names the settlement it carries over from,
  // every mark would read "awaiting the town", which the answer cannot stand
  // behind. So the two fields are omitted, and meta says why. This is the
  // served read's side of a seam with POS-361's town seat (town-stance.mjs §
  // townSeatOf, open on every mark while the cutover is unset): the stance
  // inbox keeps that rule; what residents see on the World is this one.
  // A SETTLEMENT BELOW THE CUTOVER (Darko, 2026-10-09: the cutover is a
  // settlement number) is the old blessing too, and carries no label either.
  // The cutover the labels read is the one the seal recorded (072), never the
  // variable as it is now.
  const { readCutover, readVersions, readVersionsAtSeal, CUTOVER_KEY } = await import("./town-stance.mjs");
  const gate = stancesOf(header);
  if (!gate.counts) return { omitted: `town_stance and awaiting are omitted: ${gate.why}, so no mark is labelled` };
  const env = { [CUTOVER_KEY]: gate.recorded.cutover };
  try {
    const key = `${servedKey}|${createHash("sha256").update(JSON.stringify([words.words, env[CUTOVER_KEY] ?? null])).digest("hex").slice(0, 16)}`;
    const hit = LABELLED.get(key);
    if (hit) return { marks: hit };
    const query = async (sql, args) => (await p.query(sql, args)).rows;
    const cutover = await readCutover({ query, env });
    const ids = (world.marks ?? []).filter((m) => m?.id && m.kind !== "class").map((m) => m.id);
    // An asked settlement is labelled as it stood at its seal: its seal's words, on its seal's versions.
    const ask = async (sql, args) => ({ rows: await query(sql, args) });
    const read = seal
      ? await readVersionsAtSeal(ids, { query: ask, at: header.taken_at })
      : await readVersions(ids, { query: ask });
    if (read.unreachable) return { unread: read.unreachable };
    const hh = world.households ?? {};
    const marks = await labelMarks(world.marks ?? [], {
      townWords: words.townWords, cutover, versions: read.versions, words: words.words,
      householdOf: (h) => hh[h] ?? h, overlaps: await overlapsAt(worldRepo, header.law_sha),
    });
    LABELLED.set(key, marks);
    if (LABELLED.size > 6) LABELLED.delete(LABELLED.keys().next().value);
    return { marks };
  } catch (e) {
    return { unread: `the labels could not be read: ${String(e?.defect ?? e?.message ?? e).slice(0, 200)}` };
  }
}
