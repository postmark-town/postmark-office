// household-likeness-state.mjs — a household's likeness REQUEST and its READ-ONLY OFFICIAL POINTER, as pure shapes (POS-726 slice B).
//
// THE DESIGN is Rei's CON-5 (shaped with Iris, 2026-11-05; Darko ruled "Build as designed (rec)"). Wright cut this slice twice: 11:44Z (the
// state beside the answer) and, authoritatively, 12:43Z: "the household's likeness answer (yes/no/unanswered, unchanged as the one authority),
// the request record, and the current-official pointer as a read-only field with no writer in B ... No selection function, and no write path that can
// publish any media URL. depicts is never free text: it holds resident handles from the household's own roster, validated on write ...
// Nothing from a request is copied into a public key."
//
// THE FACTS, kept apart (migration 092 is the column and says the same):
//
//   answer    households.likeness (081): the ONE permission. Nothing here writes it or reads a request as consent.
//   request   { at, by, gh_id, depicts }: the household asked for a likeness of named residents. `depicts` is an ARRAY of this household's own
//             resident handles (validated on write), private. A request is only a request: it makes no selection and no pointer.
//   official  { version, proof, since, depicts }: the CURRENT official pointer, READ-ONLY in this slice. NO WRITER EXISTS HERE: no function in
//             this file, in likeness.mjs, in the store or on any page produces, changes or removes it (the later CON-5 service establishes the
//             offered proof and the household's actual selection before it publishes one). Its own `depicts` names the residents it is for.
//   history   [{ version, proof, since, until, ended }]: reserved for that later service; read-only, kept as it is found.
//
// WHAT THIS MODULE IS. Pure: states in, states out, with the clock and the answer handed in. The writer that reaches the store is
// src/likeness.mjs § requestLikenessState; this file imports no store, so the public projection (registry-public.mjs) can read it without a cycle.
//
// TWO PROJECTIONS THAT ARE NOT INTERCHANGEABLE:
//   ownerLikeness(rec)   the household's own signed-in view: the answer, the request, the pointer.
//   officialUse(rec)     the public official-use projection: the pointer, and only while the answer is yes, and only a pointer that is well
//                        formed (a media-door proof, named residents of this household). Nothing of the request, the history or who clicked.
//   officialUseFor(rec, handle)  the same, for ONE resident: only a resident the pointer names. Never "the whole household".

/** A proof is a media-door URL: the town's one mint (src/media.mjs, whose MEDIA_BASE this spells the same way). Only the READ side asks (a pointer is used only while well formed). */
const MEDIA_ORIGIN = (process.env.MEDIA_BASE ?? "https://media.postmark.town").replace(/\/+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const PROOF_URL = new RegExp(`^${MEDIA_ORIGIN}/[A-Za-z0-9][A-Za-z0-9._~%/-]{2,300}$`);
/** The keys of each fact, in the order they are printed. */
export const STATE_KEYS = Object.freeze(["request", "official", "history"]);
export const REQUEST_KEYS = Object.freeze(["at", "by", "gh_id", "depicts"]);
export const OFFICIAL_KEYS = Object.freeze(["version", "proof", "since", "depicts"]);
export const HISTORY_KEYS = Object.freeze(["version", "proof", "since", "until", "ended"]);
/** What the public projection may carry of a pointer: its own keys and nothing of who or how. */
export const PUBLIC_OFFICIAL_KEYS = OFFICIAL_KEYS;
/** A request names at most this many residents: a household is small, and a bound keeps a hostile form from storing a book. */
export const MAX_DEPICTS = 12;

const bounce = (code, defect, hint) => Object.assign(new Error(defect), { code, defect, hint });
const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isHandles = (v) => Array.isArray(v) && v.length > 0 && v.every((h) => typeof h === "string" && h !== "");

/** The household's answer, as the registry row holds it: "yes", "no", or null (never answered). */
export const answerOf = (rec) => (rec?.likeness?.answer === "yes" || rec?.likeness?.answer === "no" ? rec.likeness.answer : null);

/** A state as the store hands it back, held to its shape: an object of the named keys, or null. Anything else reads as nothing. */
export function stateOf(raw) {
  if (!isRecord(raw)) return null;
  const out = {};
  if (isRecord(raw.request)) out.request = pick(raw.request, REQUEST_KEYS);
  if (isRecord(raw.official) && Number.isInteger(raw.official.version) && typeof raw.official.proof === "string") out.official = pick(raw.official, OFFICIAL_KEYS);
  if (Array.isArray(raw.history)) out.history = raw.history.filter(isRecord).map((h) => pick(h, HISTORY_KEYS));
  return Object.keys(out).length ? out : null;
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => Object.hasOwn(o, k)).map((k) => [k, o[k]]));

const need = (cond, code, defect, hint) => { if (!cond) throw bounce(code, defect, hint); };
const stamp = (now) => (now instanceof Date ? now : new Date(now)).toISOString();

/**
 * THE REQUEST, the only transition. The household asks for a likeness of named residents. It needs a YES (no and unanswered block). `depicts`
 * is one handle or a list of handles, each EXACTLY a resident of THIS household's roster (`ctx.residents`): free text, an off-roster handle,
 * another house's resident, a duplicate-only or empty list are refused, and nothing is trimmed into a match. It changes nothing else: the
 * pointer and its history come through as they were found (a new request never retargets an existing pointer).
 * `ctx`: { answer, residents, now, ghId, ghLogin }.
 */
export function requestLikeness(state, { depicts } = {}, ctx = {}) {
  need(ctx.answer === "yes", 409, "the household has not said yes", "a likeness is asked for only after your household's human answers the likeness question yes; no or no answer blocks it");
  need(ctx.ghId != null, 401, "no signed-in account", "a likeness is asked for after a GitHub sign-in, never with a key");
  const asked = typeof depicts === "string" ? [depicts] : depicts;
  need(Array.isArray(asked) && asked.length > 0, 422, "whom does it depict?", "name one or more of your household's residents");
  need(asked.length <= MAX_DEPICTS && asked.every((h) => typeof h === "string"), 422, "that is not a list of residents", "name your household's residents by their handles");
  const roster = new Set(ctx.residents ?? []);
  const off = asked.find((h) => !roster.has(h));
  need(off === undefined, 422, "a likeness depicts a resident of this household", "name your household's own residents, exactly as the town's record spells their handles");
  const named = [...new Set(asked)];
  const request = { at: stamp(ctx.now), by: ctx.ghLogin ?? null, gh_id: Number(ctx.ghId), depicts: named };
  return { ...(isRecord(state) ? state : {}), request };   // everything else, the pointer and its history above all, exactly as found
}

// ── THE PROJECTIONS ─────────────────────────────────────────────────────────

/** The household's OWN view (the signed-in screen): the answer beside the request and the pointer. Never public. */
export function ownerLikeness(rec) {
  const state = stateOf(rec?.likeness_state);
  return { answer: answerOf(rec), request: state?.request ?? null, official: usable(state?.official, rec) ? state.official : null };
}

/** A pointer is used only when well formed: a media-door proof and named residents, every one on THIS household's roster. */
function usable(official, rec) {
  return Boolean(official) && PROOF_URL.test(official.proof) && isHandles(official.depicts) && official.depicts.every((h) => (rec?.residents ?? []).includes(h));
}

/**
 * THE PUBLIC OFFICIAL-USE PROJECTION: the current official pointer, and ONLY while the household's answer is yes and the pointer is well
 * formed. A no, or no answer, withdraws future official use without touching the stored pointer. It carries no request, no history and no
 * account, and nothing from a request is copied into it. Null when nothing is official for use.
 */
export function officialUse(rec) {
  if (answerOf(rec) !== "yes") return null;
  const official = stateOf(rec?.likeness_state)?.official;
  return usable(official, rec) ? pick(official, PUBLIC_OFFICIAL_KEYS) : null;
}

/** The pointer for ONE resident: only when the pointer names that handle. A household's other residents get nothing. */
export function officialUseFor(rec, handle) {
  const official = officialUse(rec);
  return official && official.depicts.includes(handle) ? official : null;
}
