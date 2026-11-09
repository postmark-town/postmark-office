// household-likeness-state.mjs — a household's likeness REQUEST, SELECTED PROOF and OFFICIAL POINTER, as pure shapes (POS-726 slice B).
//
// THE DESIGN is Rei's CON-5 (shaped with Iris, 2026-11-05; Darko ruled "Build as designed (rec)"; Wright carried it onto POS-726 and
// cut this slice on 2026-11-09 11:44Z). Its law, in the words that matter here:
//
//   § 3  The existing household likeness answer (yes/no/unanswered) stays authoritative. The request and selected-proof state sit BESIDE it,
//        not a second consent ledger. Permission, commission and selection of a particular proof are different facts. Household
//        no/unanswered blocks. Silence on a proof leaves THAT proof unselected; it does not revoke an older valid official choice.
//   § 4  Only the selected proof is official, with minimal source provenance and ONE versioned current-official pointer beside the household
//        record. The household can replace or withdraw; future use checks the latest answer and pointer. No promise of erasure from what
//        was already released.
//   § 6  No hidden rejected-draft gallery; no source-image copies.
//
// THE FACTS, kept apart (migration 092 is the column and says the same):
//
//   answer    households.likeness (081): the ONE permission. Nothing here writes it, reads it as selection, or has a second copy.
//   request   { at, by, gh_id, depicts }: the household asked for a likeness and said whom it depicts (one of its own residents).
//   selected  { proof, at, by, gh_id }: the proof the household chose. A proof is a reference (a media-door URL), never bytes.
//   official  { version, proof, since, depicts }: the CURRENT official pointer. It exists only as the product of a selection.
//   history   [{ version, proof, since, until, ended }]: every pointer no longer current, "replaced" or "withdrawn", kept.
//
// WHAT THIS MODULE IS. Pure: states in, states out, with the clock and the answer handed in. The writers that reach the store are in
// src/likeness.mjs and the store's one statement is registry-store.mjs § setLikenessState; this file imports neither, so the public
// projection (registry-public.mjs) can read it without a cycle.
//
// TWO PROJECTIONS THAT ARE NOT INTERCHANGEABLE:
//   ownerLikeness(rec)   the household's own signed-in view: all of it.
//   officialUse(rec)     the public official-use projection: the pointer, and only while the answer is yes. Nothing of the request, the
//                        selection, the history, or who clicked.

/** A proof is a media-door URL: the town's one mint (src/media.mjs, whose MEDIA_BASE this spells the same way). A reference, not a copy. */
const MEDIA_ORIGIN = (process.env.MEDIA_BASE ?? "https://media.postmark.town").replace(/\/+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const PROOF_URL = new RegExp(`^${MEDIA_ORIGIN}/[A-Za-z0-9][A-Za-z0-9._~%/-]{2,300}$`);
/** The keys of each fact, in the order they are printed. */
export const STATE_KEYS = Object.freeze(["request", "selected", "official", "history"]);
export const REQUEST_KEYS = Object.freeze(["at", "by", "gh_id", "depicts"]);
export const SELECTED_KEYS = Object.freeze(["proof", "at", "by", "gh_id"]);
export const OFFICIAL_KEYS = Object.freeze(["version", "proof", "since", "depicts"]);
export const HISTORY_KEYS = Object.freeze(["version", "proof", "since", "until", "ended"]);
/** What the public projection may carry of a pointer: its own keys and nothing of who or how. */
export const PUBLIC_OFFICIAL_KEYS = OFFICIAL_KEYS;

const bounce = (code, defect, hint) => Object.assign(new Error(defect), { code, defect, hint });
const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** The household's answer, as the registry row holds it: "yes", "no", or null (never answered). */
export const answerOf = (rec) => (rec?.likeness?.answer === "yes" || rec?.likeness?.answer === "no" ? rec.likeness.answer : null);

/** A state as the store hands it back, held to its shape: an object of the four keys, or null. Anything else reads as nothing. */
export function stateOf(raw) {
  if (!isRecord(raw)) return null;
  const out = {};
  if (isRecord(raw.request)) out.request = pick(raw.request, REQUEST_KEYS);
  if (isRecord(raw.selected)) out.selected = pick(raw.selected, SELECTED_KEYS);
  if (isRecord(raw.official) && Number.isInteger(raw.official.version) && typeof raw.official.proof === "string") out.official = pick(raw.official, OFFICIAL_KEYS);
  if (Array.isArray(raw.history)) out.history = raw.history.filter(isRecord).map((h) => pick(h, HISTORY_KEYS));
  return Object.keys(out).length ? out : null;
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => Object.hasOwn(o, k)).map((k) => [k, o[k]]));

/** The next version number: one past every version this household has ever pointed at. Versions are never reused. */
export function nextVersion(state) {
  return 1 + Math.max(0, state?.official?.version ?? 0, ...(state?.history ?? []).map((h) => h.version ?? 0));
}

const need = (cond, code, defect, hint) => { if (!cond) throw bounce(code, defect, hint); };
const stamp = (now) => (now instanceof Date ? now : new Date(now)).toISOString();

/**
 * THE REQUEST. The household asks for a likeness and names whom it depicts. It needs a YES: no and unanswered block. It changes nothing
 * else: an older official pointer and its selection stand untouched (§ 3: an unselected new proof leaves an older valid choice alone).
 * `ctx`: { answer, residents, now, ghId, ghLogin }.
 */
export function requestLikeness(state, { depicts } = {}, ctx = {}) {
  need(ctx.answer === "yes", 409, "the household has not said yes", "a likeness is asked for only after your household's human answers the likeness question yes; no or no answer blocks it");
  const who = typeof depicts === "string" ? depicts.trim() : "";
  need(who !== "", 422, "whom does it depict?", "name one of your household's residents");
  need((ctx.residents ?? []).includes(who), 422, `"${who}" is not one of this household's residents`, "a likeness depicts one of the household's own residents");
  need(ctx.ghId != null, 401, "no signed-in account", "a likeness is asked for after a GitHub sign-in, never with a key");
  const request = { at: stamp(ctx.now), by: ctx.ghLogin ?? null, gh_id: Number(ctx.ghId), depicts: who };
  return stateOf({ ...(state ?? {}), request });
}

/**
 * THE SELECTION. The household chooses a proof. It needs a YES and a request (request first), and the proof must be a media-door URL. It
 * makes THAT proof official, as the next version: the pointer it replaces moves to history ("replaced"), and nothing is deleted.
 * Choosing the proof that is already official is refused, so a version is never spent on nothing.
 */
export function selectProof(state, { proof } = {}, ctx = {}) {
  need(ctx.answer === "yes", 409, "the household has not said yes", "a proof is selected only while your household's likeness answer is yes");
  need(ctx.ghId != null, 401, "no signed-in account", "a proof is selected after a GitHub sign-in, never with a key");
  need(state?.request, 409, "no likeness has been requested", "ask for a likeness first, naming whom it depicts");
  const p = typeof proof === "string" ? proof.trim() : "";
  need(PROOF_URL.test(p), 422, "that is not a proof the town holds", "a proof is a media-door address: https://media.postmark.town/…");
  need(state?.official?.proof !== p, 409, "that proof is already the official one", "choose a different proof to replace it");
  const at = stamp(ctx.now);
  const history = [...(state.history ?? [])];
  if (state.official) history.push({ version: state.official.version, proof: state.official.proof, since: state.official.since, until: at, ended: "replaced" });
  return stateOf({
    ...state,
    selected: { proof: p, at, by: ctx.ghLogin ?? null, gh_id: Number(ctx.ghId) },
    official: { version: nextVersion(state), proof: p, since: at, depicts: state.request.depicts },
    history,
  });
}

/**
 * THE WITHDRAWAL. The household takes its official likeness out of future use. It is always allowed (a no is not needed to leave). The
 * pointer moves to history ("withdrawn") and the selection clears, so a new official needs a new selection. No erasure is promised from
 * anything already released (§ 4); this removes FUTURE use.
 */
export function withdrawLikeness(state, _args = {}, ctx = {}) {
  need(state?.official, 409, "there is no official likeness to withdraw", "nothing is official for this household");
  need(ctx.ghId != null, 401, "no signed-in account", "a likeness is withdrawn after a GitHub sign-in, never with a key");
  const at = stamp(ctx.now);
  const { selected: _s, official, ...rest } = state;
  return stateOf({ ...rest, history: [...(state.history ?? []), { version: official.version, proof: official.proof, since: official.since, until: at, ended: "withdrawn" }] });
}

/** The three transitions by name, for the writer and the form. */
export const TRANSITIONS = Object.freeze({ request: requestLikeness, select: selectProof, withdraw: withdrawLikeness });

// ── THE PROJECTIONS ─────────────────────────────────────────────────────────

/** The household's OWN view (the signed-in screen): the answer beside all four facts. Never public. */
export function ownerLikeness(rec) {
  const state = stateOf(rec?.likeness_state);
  return {
    answer: answerOf(rec),
    request: state?.request ?? null,
    selected: state?.selected ?? null,
    official: state?.official ?? null,
    history: state?.history ?? [],
  };
}

/**
 * THE PUBLIC OFFICIAL-USE PROJECTION: the current official pointer, and ONLY while the household's answer is yes. A no, or no answer,
 * withdraws future official use without touching the stored pointer (the household may say yes again). It carries no request, no
 * selection record, no history and no account. Null when nothing is official for use.
 */
export function officialUse(rec) {
  if (answerOf(rec) !== "yes") return null;
  const state = stateOf(rec?.likeness_state);
  return state?.official ? pick(state.official, PUBLIC_OFFICIAL_KEYS) : null;
}
