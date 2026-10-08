// town-stance.mjs — THE TOWN'S WORD, AND WHO A MARK AWAITS (POS-361, the office half).
//
// ── THE RULINGS THIS FILE IMPLEMENTS (Darko, 2026-10-06, deep slot 1) ───────
//
//   · Words: the town reuses the resident tri-state. A declared NEUTRAL clears
//     "awaiting the town" and confers nothing; OPPOSED is unchanged; the town's
//     WELCOMED is adoption, reserved, and refused for now. Silence leaves the
//     mark awaiting. Residents may also declare neutral (it clears "awaiting
//     your word"). One taxonomy.
//   · Verb: no new verb. The town speaks with `declare-stance-on`.
//   · Speaker: postmark-pen, household the-town, as town quest posts already
//     are (quests.mjs § the hand). The act names the hand that held the pen.
//   · Citations: law marks only, in the shape the world lints use (`law` = the
//     mark id, `law_text` = its words verbatim; world-lints.mjs § the law).
//   · Cutover (Q4): TOWN_STANCE_CUTOVER=S<n>, set by Wright at the deploy.
//   · Version (Q5): every stance records the mark version it was spoken on; a
//     stale version is absent, so an amendment reopens every word.
//   · Awaiting (Q6): the stance door's overlap rule, grouped by HOUSEHOLD, with
//     seniority (a holder speaks only on marks younger than their ground).
//
// The world half is postmark-world#146: `resolveConsent({ …, townWords })`
// takes the map `townWordsOf` builds here. Wiring it into the clearing is
// POS-362's; the settlement reads `townWordsAtOffice()` below.
//
// ── WHAT A "VERSION" IS ─────────────────────────────────────────────────────
//
// The CLAIM that carries the mark's content: for a standing mark, its current
// locked claim (the newest locked claim for the slug); for an unpublished
// sketch, its own newest claim. An amendment INSERTs a new claim (`supersedes`),
// so it changes the version, and only an amendment does: the clearing locks
// the SAME claim id it was handed (so a word spoken on a sketch survives its
// publish, the-late-welcome), and the standing recompute's data.tier and a
// parent's retirement touch no claim. (Wright ruled the claim id, 2026-10-06.)

import { PEN_HANDLE } from "./earpiece.mjs";
import { handsOf, holdsHand, notThisHand } from "./named-hand.mjs";
import { blessed, readAtRef } from "./world-branches.mjs";

/** The town, as a ground and as a seat on every mark. */
export const TOWN = "the-town";
/** Who writes the town's word: its own pen, as the town's quest posts are. */
export const TOWN_SPEAKER = PEN_HANDLE;
/** The one explicit field that makes a stance the town's. Never inferred from the key. */
export const AS_TOWN = "town";

// WHOSE HAND MAY HOLD THE TOWN'S PEN (Darko, 2026-10-06): darko, wright and the
// Worldkeeper; meeps that move into the-town can be added by a reviewed change.
// `darko` is inert until a key holds it (a human resident is its own discussion, out of scope).
export const TOWN_HANDS = Object.freeze(["darko", "wright", "worldkeeper"]);

/** A resident's three words, and the town's two (its welcomed is adoption, reserved). */
export const RESIDENT_WORDS = Object.freeze(["welcomed", "neutral", "opposed"]);
export const TOWN_WORDS = Object.freeze(["neutral", "opposed"]);

/** A law mark is a mark of the constitution tier at the law sha. */
export const LAW_TIER = "constitution";

/** The env key that names the cutover settlement (Q4). Unset means no cutover. */
export const CUTOVER_KEY = "TOWN_STANCE_CUTOVER";

const bounce = (code, defect, hint) => { const e = new Error(defect); Object.assign(e, { code, defect, hint }); return e; };

// ── the hand ────────────────────────────────────────────────────────────────

/**
 * The hand that holds the town's pen: the caller's resident, which must be one
 * of TOWN_HANDS. Shaped as `quests.mjs § judgeQuestHand`: a named handle must
 * be the key's own; an unnamed one is the key's only handle, or its one town
 * hand.
 */
export function judgeTownHand(args, key, hands = TOWN_HANDS) {
  const held = [...(key?.handles ?? [])];
  const named = String(args?.handle ?? "").trim();
  if (named && !held.includes(named))
    throw bounce(403, `"${named}" is not one of your residents`, `this key acts for: ${held.join(", ") || "(none)"}`);
  const hand = named || (held.length === 1 ? held[0] : [...handsOf(key)].find((h) => hands.includes(h)) ?? "");
  if (!hand || !hands.includes(hand))
    throw bounce(403, "only the town's hands speak as the town",
      `the town's word is written by its own pen (${TOWN_SPEAKER}, household ${TOWN}); the hands that may hold it are ${hands.join(", ")}. To speak as yourself, drop as: "${AS_TOWN}".`);
  // POS-389: the hand is this credential's own, not a housemate it lists.
  if (!holdsHand(key, hand)) { const r = notThisHand(hand, key); throw bounce(403, r.defect, r.hint); }
  return hand;
}

/** The town's word, or a refusal that says why the word is not one the town speaks. */
export function judgeTownWord(stance) {
  const word = String(stance ?? "").trim();
  if (word === "welcomed")
    throw bounce(422, "the town's welcomed is adoption, and it is reserved",
      "the town adopts a mark only by adoption, which is not open yet (Darko, 2026-10-06). To clear \"awaiting the town\" without conferring anything, declare neutral; to return it, declare opposed and cite the law.");
  if (!TOWN_WORDS.includes(word))
    throw bounce(422, `the town's stance must be ${TOWN_WORDS.join(" or ")}`,
      `got ${JSON.stringify(stance ?? null)} — neutral clears "awaiting the town" and confers nothing; opposed returns the mark and cites the law it applies. Silence leaves it awaiting.`);
  return word;
}

// ── the law a word cites ────────────────────────────────────────────────────

/** `law` as given: one id or several, trimmed, de-duplicated, in the order given. */
export function lawIdsOf(law) {
  const list = Array.isArray(law) ? law : law == null || law === "" ? [] : [law];
  const out = [];
  for (const v of list) {
    const id = String(v ?? "").trim();
    if (!id) throw bounce(422, "a law citation is a mark id", `got ${JSON.stringify(v)} — cite a law mark as "<by>/<slug>"`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * The citations, resolved. PURE: `lawMarks` is the World at the law sha.
 *
 * Each cited id must be a mark of the constitution tier there, and the answer
 * carries its words VERBATIM beside its id, `{ law, law_text }`, the shape the
 * world lints cite their law in. An opposition with no citation refuses: the
 * town's word is law, not opinion, and every opposition cites the written rule
 * it applies (LOGOS the-response-function § the town's declared word).
 */
export function citeLaw(law, { word, lawMarks, sha }) {
  const ids = lawIdsOf(law);
  if (word === "opposed" && !ids.length)
    throw bounce(422, "the town's opposition cites the law it applies",
      `pass law: "<by>/<slug>" (or several) — a law mark that stands at the law sha (${String(sha ?? "?").slice(0, 12)}); the office records its words beside its id`);
  const byId = lawMarks instanceof Map ? lawMarks : new Map((lawMarks ?? []).map((m) => [m?.id, m]));
  return ids.map((id) => {
    const m = byId.get(id);
    if (!m) throw bounce(422, `"${id}" is not a mark at the law sha`,
      `the law is read at ${String(sha ?? "?").slice(0, 12)}; cite a law mark that stands there — nothing was written`);
    if (m.tier !== LAW_TIER) throw bounce(422, `"${id}" is not law`,
      `it stands at tier ${m.tier ?? "(none)"}; the town cites law marks only (tier ${LAW_TIER}) — nothing was written`);
    return { law: id, law_text: String(m.body ?? "").trim() };
  });
}

/**
 * The law sha: the newest snapshot's law_sha (POS-357), else the newest
 * settlement tag. `query` is the office's store read; null or a failure falls
 * to the tag, and the answer says which it stood on.
 */
export async function lawShaFor(repo, { query = null } = {}) {
  if (query) {
    try {
      const rows = await query("SELECT law_sha FROM world_snapshots WHERE law_sha IS NOT NULL ORDER BY window_id DESC NULLS LAST, id DESC LIMIT 1", []);
      const sha = Array.isArray(rows) ? rows[0]?.law_sha : null;
      if (sha) return { sha: String(sha), from: "snapshot" };
    } catch { /* no snapshot table here yet: the tag answers */ }
  }
  const b = blessed(repo);
  return { sha: b.sha, from: b.source === "settlement" ? `settlement ${b.tag}` : "main (no settlement tag in this clone)" };
}

const LAW_CACHE = new Map();
/** The World's marks at `sha`, by id. Throws when the clone cannot read it. */
export function lawMarksAt(repo, sha) {
  const k = `${repo}\0${sha}`;
  if (LAW_CACHE.has(k)) return LAW_CACHE.get(k);
  const state = JSON.parse(readAtRef(repo, sha, "WORLD/world-state.json"));
  const map = new Map((state?.marks ?? []).filter((m) => m?.id).map((m) => [m.id, m]));
  LAW_CACHE.set(k, map);
  if (LAW_CACHE.size > 8) LAW_CACHE.delete(LAW_CACHE.keys().next().value);
  return map;
}

// ── versions ────────────────────────────────────────────────────────────────

/** The claims a version is read from. Bodies are never selected. */
export const VERSION_SQL = `
  SELECT slug, id, status, window_id, submitted_at, decided_at
    FROM claims
   WHERE slug = ANY($1) AND status = ANY($2)`;
export const VERSION_STATUSES = Object.freeze(["draft", "pending", "locked"]);

const ms = (t) => (t == null ? NaN : t instanceof Date ? t.getTime() : Date.parse(String(t)));

/**
 * Claim rows → `Map(slug → { current, claims })`. PURE.
 *
 * WHY THE CLAIM AND NOT POS-357'S mark_versions DIGEST (Wright, 2026-10-06).
 * "An amendment reopens every word", and the claim is the one thing that moves
 * exactly on amendment. The digest (sha256 of slug, kind, owner, body,
 * geometry, parent slug, data) also moves when nothing was amended:
 *   · the standing recompute rewrites data.tier when ground moves
 *     (world2/tools/materialize.mjs § the tier step), and
 *   · a parent's retirement nulls the parent slug in the row.
 * Both must reopen nothing. And a sketch's claim row never equals its published
 * row, so the digest would reopen every word spoken before the publish, which
 * is the-late-welcome undone; the clearing locks the same claim id instead.
 *
 * `current` is the newest LOCKED claim when the slug has one (what stands; a
 * pending amendment has not published and does not reopen anything yet), else
 * the newest unpublished claim. `claims` is every row, oldest first, for the
 * legacy read (`versionAt`).
 *
 * AS OF A SEAL (POS-362): with `window`, a claim counts as locked only when it
 * locked at or before that window (a seed claim with no window stood before any),
 * so `current` is the version that stood when that window was sealed. The rows
 * handed in are the claims submitted by then (§ readVersionsAtSeal).
 */
export function versionsFromRows(rows, { window = null } = {}) {
  const by = new Map();
  for (const r of rows ?? []) {
    if (!r?.slug || r.id == null) continue;
    if (!by.has(r.slug)) by.set(r.slug, []);
    by.get(r.slug).push({ id: String(r.id), status: r.status, window_id: r.window_id == null ? null : Number(r.window_id),
      submitted_at: r.submitted_at ?? null, decided_at: r.decided_at ?? null });
  }
  const out = new Map();
  for (const [slug, claims] of by) {
    claims.sort((a, b) => (ms(a.submitted_at) || 0) - (ms(b.submitted_at) || 0) || a.id.localeCompare(b.id));
    const locked = claims.filter((c) => c.status === "locked" && (window == null || c.window_id == null || c.window_id <= window))
      .sort((a, b) => (ms(b.decided_at) || ms(b.submitted_at) || 0) - (ms(a.decided_at) || ms(a.submitted_at) || 0));
    const current = locked[0] ?? claims[claims.length - 1] ?? null;
    out.set(slug, { current, claims });
  }
  return out;
}

/**
 * A word written before versions were recorded is read as spoken on the claim
 * that carried the mark at its instant: the newest claim submitted at or before
 * it, else the oldest. Null when the slug has no claims at all.
 */
export function versionAt(entry, at) {
  const claims = entry?.claims ?? [];
  if (!claims.length) return null;
  const t = ms(at);
  let hit = null;
  for (const c of claims) if (Number.isFinite(t) && (ms(c.submitted_at) || 0) <= t) hit = c;
  return (hit ?? claims[0]).id;
}

/** The version a stance row was spoken on: its own record, else the legacy read. */
export function rowVersion(row, versions) {
  const v = row?.payload?.version;
  if (v !== undefined) return v == null ? null : String(v);
  return versionAt(versions?.get?.(row?.object), row?.written_at);
}

/**
 * Is this word on the mark's CURRENT version? A word on an older version is
 * absent (Q5). Unknown on either side (a mark the store holds no claim for,
 * or a word that can name none) cannot be proved stale, so it stands.
 */
export function onCurrentVersion(row, versions) {
  if (!versions) return true;
  const current = versions.get(row?.object)?.current?.id ?? null;
  if (current == null) return true;
  const spoken = rowVersion(row, versions);
  return spoken == null || spoken === current;
}

/**
 * The versions of `slugs`, read through the stance read's credential (which
 * already holds SELECT on claims; no column here is a body). `{ versions }` or
 * `{ unreachable }`, never a throw.
 */
export async function readVersions(slugs, { query } = {}) {
  const list = [...new Set([...(slugs ?? [])].filter(Boolean).map(String))];
  if (!list.length) return { versions: new Map() };
  let ask = query;
  if (!ask) ({ stanceQuery: ask } = await import("./world2-acts.mjs"));
  const answer = await ask(VERSION_SQL, [list, [...VERSION_STATUSES]]);
  if (answer?.unreachable) return { unreachable: answer.unreachable };
  return { versions: versionsFromRows(answer?.rows ?? []) };
}

/**
 * The versions of `slugs` AS THEY STOOD AT A SEAL (POS-362): the claims submitted
 * by the seal's instant, with `current` the newest claim locked at or before its
 * window (§ versionsFromRows). `{ versions }` or `{ unreachable }`, never a throw.
 */
export const VERSION_AT_SEAL_SQL = `${VERSION_SQL.trimEnd()}
     AND submitted_at <= $3`;
export async function readVersionsAtSeal(slugs, { query, window, at }) {
  const list = [...new Set([...(slugs ?? [])].filter(Boolean).map(String))];
  if (!list.length) return { versions: new Map() };
  const answer = await query(VERSION_AT_SEAL_SQL, [list, [...VERSION_STATUSES], at]);
  if (answer?.unreachable) return { unreachable: answer.unreachable };
  return { versions: versionsFromRows(answer?.rows ?? [], { window: window == null ? null : Number(window) }) };
}

// ── the town's seat: cutover ────────────────────────────────────────────────

/** `TOWN_STANCE_CUTOVER=S<n>` → n, or null when unset. A malformed value throws: a cutover is not guessed. */
export function cutoverNumber(env = process.env) {
  const raw = String(env?.[CUTOVER_KEY] ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/^S?(\d+)$/i);
  if (!m) throw bounce(500, `${CUTOVER_KEY} is "${raw}", which names no settlement`, `set it to S<n>, the first settlement after the ship, or unset it for no cutover`);
  return Number(m[1]);
}

/**
 * The cutover settlement's window, read from the store's `settlements` table.
 * `{ number, window_id, published_at }`, or null when unset.
 */
export async function readCutover({ env = process.env, query = null } = {}) {
  const n = cutoverNumber(env);
  if (n == null) return null;
  let ask = query;
  if (!ask) ({ actsQuery: ask } = await import("./world2-acts.mjs"));
  const rows = await ask("SELECT number, window_id, published_at FROM settlements WHERE number = $1", [n]);
  const r = Array.isArray(rows) ? rows[0] : null;
  if (!r) throw bounce(503, `the cutover settlement S${n} is not in the store's settlements`, `${CUTOVER_KEY} names S${n}; until that row exists the town's seat cannot be read`);
  return { number: n, window_id: r.window_id == null ? null : Number(r.window_id), published_at: r.published_at ?? null };
}

/**
 * Did this mark's current version stand at or before the cutover? Then it
 * counts as cleared and never awaits the town (R14). A mark whose version the
 * store cannot name was standing before versions were read, so it is cleared.
 */
export function clearedAtCutover(mark, { cutover, versions }) {
  if (!cutover) return false;
  const cur = versions?.get?.(mark?.id)?.current;
  if (!cur) return true;
  if (cur.status !== "locked") return false;
  if (cutover.window_id != null && cur.window_id != null) return cur.window_id <= cutover.window_id;
  const d = ms(cur.decided_at), p = ms(cutover.published_at);
  return Number.isFinite(d) && Number.isFinite(p) ? d <= p : true;
}

/** The town's seat on a mark: it is published, and it did not stand at the cutover. */
export const townSeatOf = ({ cutover = null, versions = null } = {}) =>
  (mark) => mark?.published !== false && !clearedAtCutover(mark, { cutover, versions });

// ── the words standing now ──────────────────────────────────────────────────

const isTownRow = (r) => r?.actor === TOWN_SPEAKER && r?.payload?.as === AS_TOWN;

/**
 * THE FOLD'S INPUT (item 7): `Map(mark id → "neutral" | "opposed")`, the town's
 * newest word on each mark's CURRENT version. PURE. A town word on an older
 * version is absent, so an amendment puts the mark back to awaiting the town.
 *
 * World #146's `resolveConsent({ …, townWords })` reads exactly this. The
 * settlement reads it through `townWordsAtOffice` (POS-362 wires it).
 */
export function townWordsOf(rows, { versions = null } = {}) {
  const latest = new Map();
  for (const r of rows ?? []) {
    if (r?.class !== "stance" || !r.object || !isTownRow(r)) continue;
    if (!TOWN_WORDS.includes(r.payload?.stance)) continue;
    if (!onCurrentVersion(r, versions)) continue;
    const prev = latest.get(r.object);
    const later = !prev || String(r.written_at) > String(prev.written_at)
      || (String(r.written_at) === String(prev.written_at) && Number(r.seq ?? 0) >= Number(prev.seq ?? 0));
    if (later) latest.set(r.object, r);
  }
  return new Map([...latest].map(([id, r]) => [id, r.payload.stance]));
}

/**
 * The town's words as the settlement will read them: the stance rows from the
 * record, their versions from the store. `{ townWords }` or `{ unreachable }`.
 */
export async function townWordsAtOffice({ rows = null, versionsQuery = undefined } = {}) {
  const all = rows ?? await (await import("./world-stance.mjs")).stanceRows();
  const town = all.filter(isTownRow);
  const read = await readVersions(town.map((r) => r.object), { query: versionsQuery });
  if (read.unreachable) return { unreachable: read.unreachable };
  return { townWords: townWordsOf(town, { versions: read.versions }) };
}

// ── who a mark awaits ───────────────────────────────────────────────────────

const dateMs = (m) => Date.parse(m?.date ?? "") || 0;
/** Precedence: the ground stood first. The id breaks a tie (world-stance.mjs § standsBefore). */
const before = (g, m) => (dateMs(g) !== dateMs(m) ? dateMs(g) < dateMs(m) : String(g?.id ?? "") < String(m?.id ?? ""));

/** A handle's household, with the town's own ground and pen folded into the town. */
export const houseOf = (householdOf, h) => (h === TOWN || h === TOWN_SPEAKER ? TOWN : householdOf(h) ?? h);

/**
 * WHO THIS MARK AWAITS. The one function the label and the inbox both read.
 *
 * PURE. `marks` is the ground to weigh (every mark, or a caller's own house's
 * marks when it asks only about itself); `overlaps` is the engine's; `words`
 * are the standing words on current versions (`standingStances` with
 * versions); `householdOf` maps a handle to its household; `townSeat(mark)`
 * says whether the town's seat is open on it (published, after the cutover).
 *
 * The rule (Q6): a household awaits when it holds a mark that overlaps this one
 * and stood BEFORE it (seniority: a holder speaks only on what came after their
 * ground), the mark is not its own household's, and no resident of it has a
 * word on the current version. One word per household, not per resident. The
 * town awaits when its seat is open and it has no word on the current version;
 * the town's own ground folds into that one seat.
 *
 * → `[{ who, ground }]`, the town first, then households by key. Empty means
 * nothing awaits.
 */
export function awaitingOf(mark, { marks = [], overlaps, words = [], householdOf = (h) => h, townSeat = null } = {}) {
  if (!mark?.id) return [];
  const own = houseOf(householdOf, mark.by);
  const spoke = new Set();
  let townSpoke = false;
  for (const w of words) {
    if (w?.on !== mark.id) continue;
    if (w.by === TOWN_SPEAKER) { if (w.as === AS_TOWN) townSpoke = true; continue; }
    spoke.add(houseOf(householdOf, w.by));
  }
  const grounds = new Map();
  if (mark.at && mark.extent) {
    for (const g of marks) {
      if (!g?.id || g.id === mark.id || !g.at || !g.extent) continue;
      const hh = houseOf(householdOf, g.by);
      if (hh === own || !before(g, mark) || !overlaps(g, mark)) continue;
      if (!grounds.has(hh)) grounds.set(hh, []);
      grounds.get(hh).push(g.id);
    }
  }
  const out = [];
  if (townSeat && townSeat(mark) && !townSpoke)
    out.push({ who: TOWN, ground: (grounds.get(TOWN) ?? []).sort() });
  for (const hh of [...grounds.keys()].sort()) {
    if (hh === TOWN || spoke.has(hh)) continue;
    out.push({ who: hh, ground: grounds.get(hh).sort() });
  }
  return out;
}

/** The label for every mark: `Map(id → awaiting)`, only where not empty (R9: "only when not empty"). */
export function awaitingLabels(marks, ctx = {}) {
  const out = new Map();
  for (const m of marks ?? []) {
    const a = awaitingOf(m, { ...ctx, marks: ctx.marks ?? marks });
    if (a.length) out.set(m.id, a.map((x) => x.who));
  }
  return out;
}
