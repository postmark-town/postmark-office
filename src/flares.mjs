// flares.mjs — THE FLARE, THE RECORD (POS-1163; POS-509's record half, CON-25/e), pure.
//
// Darko, 2026-11-16, the CON-18 growth sitting: "maybe this can continue the
// analogy of light, and call it a flare. So a spark turns into a flare, and
// everything is in the Illuminator's domain." The law is World #397,
// LOGOS/classes.md:369–404 (WLD-185, shipped at S183): a flare is a post about
// a PUBLIC spark, made off-town by a household or by the town; it carries the
// external URL of every place it was posted, the platform, whether it is text
// or video, ideally a screenshot, and its maker; its spark lists it back
// (Darko, 11-18: "there definitely needs to be a link from that Spark to the
// flare wherever it's posted"). It starts reported, and is accepted as text,
// accepted as video, or declined. Iris, wright and keemin advance it.
//
// ── WHAT IS LAW, AND WHAT IS THIS FILE'S SPELLING ───────────────────────────
//
// The law names the relationship `about:` and nothing else by machine key.
// Every other spelling here is the office's IMPLEMENTATION, chosen to the post
// machine's own conventions, never quoted as shipped law:
//   fields.about          the spark's id (the law's `about:`)
//   fields.destinations   [{ url, platform, form, screenshot? }], one per place
//                         it was posted (form: "text" | "video")
//   fields.maker          the household that made it, as the store keys one
//                         (hh:<slug> or solo:<handle>), or hh:the-town for the
//                         town's own
//   states                reported · accepted-text · accepted-video · declined
//
// ── WHAT THIS RECORD DOES NOT DO ────────────────────────────────────────────
//
// It pays nothing: "What a flare pays is the posting quest's word, not this
// class's" (classes.md:399), and the stamp pay, the cadence, the doorstep line
// and the quest stay on POS-509. It takes no stake. It is never amended or
// closed: the law rules neither, so no bug or idea privilege is carried over.
//
// ── WHO ADVANCES IT ─────────────────────────────────────────────────────────
//
// The law: "Iris, wright and keemin". wright and keemin are the founders' own
// handles. IRIS IS NOT BOUND HERE: the town's public handle `iris` is cass's
// resident (WHITE_PAGES), and nothing on the record shows it is the
// Illuminator's own credential, so naming it would grant a stranger the hand.
// Iris joins FLARE_HANDS when her actual operator handle is settled (asked on
// POS-1163). The hand is the credential's own, as a bug's is (named-hand.mjs).

import { refuse, TITLE_MAX } from "./events.mjs";
import { handsOf, holdsHand, notThisHand } from "./named-hand.mjs";

export const FLARE_CLASS = "flare";

export const STATE_REPORTED = "reported";
export const STATE_ACCEPTED_TEXT = "accepted-text";
export const STATE_ACCEPTED_VIDEO = "accepted-video";
export const STATE_DECLINED = "declined";
/** Every state a flare stands in, reported first. */
export const FLARE_STATES = Object.freeze([STATE_REPORTED, STATE_ACCEPTED_TEXT, STATE_ACCEPTED_VIDEO, STATE_DECLINED]);
/** The states a flare is finished in: its acceptance (as text or as video), or its decline. */
export const FLARE_FINISHED = Object.freeze([STATE_ACCEPTED_TEXT, STATE_ACCEPTED_VIDEO, STATE_DECLINED]);

/** Who advances a flare: the law's Iris, wright and keemin, less Iris until her operator handle is settled (above). */
export const FLARE_HANDS = Object.freeze(["wright", "keemin"]);
/** What is unsettled about the hands, in the words every refusal and card says it with. */
export const FLARE_HANDS_PENDING = "Iris, the Illuminator, joins them when her own operator handle is settled (POS-1163): the public handle iris is another household's resident";

export const FLARE_FORMS = Object.freeze(["text", "video"]);
/** The town's own household, the maker of a flare the town posted on its own channels. */
export const TOWN_MAKER = "hh:the-town";

export const DESTINATIONS_MAX = 20;
export const URL_MAX = 300;
export const PLATFORM_MAX = 40;
/** A spark's id, as the marks table keys one: `<by>/<slug>` (event-sparks.mjs § sparkIdFree). */
const SPARK_ID_RE = /^[a-z0-9][a-z0-9._-]{0,39}\/[a-z0-9][a-z0-9._-]{0,119}$/;

const POST_HOW = `town { do: "post", args: { class: "flare", title, about: "<the public spark's id>", destinations: [{ url, platform, form: "text" | "video", screenshot? }] } } — one destination for every place it was posted`;
const ADVANCE_HOW = `town { do: "advance", args: { post, to: "${STATE_ACCEPTED_TEXT}" | "${STATE_ACCEPTED_VIDEO}" | "${STATE_DECLINED}" } } — by ${FLARE_HANDS.join(" or ")}`;

/** An external URL: http(s), one line, at most URL_MAX characters. Returns it trimmed, or throws naming `field`. */
function judgeUrl(v, field) {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) throw refuse(422, `${field} is empty`, `${field}: the external URL, "https://…"`, { field });
  if (s.length > URL_MAX) throw refuse(422, `${field} is at most ${URL_MAX} characters`, `this one is ${s.length}`, { field });
  let u;
  try { u = new URL(s); } catch { u = null; }
  if (!u || (u.protocol !== "https:" && u.protocol !== "http:") || /\s/.test(s))
    throw refuse(422, `${field} is not a web address`, `${field}: the external URL where it was posted, "https://…"`, { field });
  return s;
}

/** One place the flare was posted: `{ url, platform, form, screenshot? }`. */
function judgeDestination(d, i) {
  const at = `destinations[${i}]`;
  if (!d || typeof d !== "object" || Array.isArray(d))
    throw refuse(422, `${at} is not a destination`, `each destination: { url, platform, form: "text" | "video", screenshot? }`, { field: "destinations" });
  for (const k of Object.keys(d))
    if (!["url", "platform", "form", "screenshot"].includes(k))
      throw refuse(422, `${at} takes no ${k}`, "a destination is its url, its platform, its form and, ideally, a screenshot", { field: "destinations" });
  const url = judgeUrl(d.url, `${at}.url`);
  const platform = typeof d.platform === "string" ? d.platform.trim() : "";
  if (!platform || /[\r\n]/.test(platform) || platform.length > PLATFORM_MAX)
    throw refuse(422, `${at}.platform names where it was posted`, `platform: one line, at most ${PLATFORM_MAX} characters — "YouTube", "TikTok", "Bluesky", …`, { field: "destinations" });
  if (!FLARE_FORMS.includes(d.form))
    throw refuse(422, `${at}.form is text or video`, `form: "text" or "video" — whether the flare is text or video there`, { field: "destinations" });
  return { url, platform, form: d.form, ...(d.screenshot !== undefined ? { screenshot: judgeUrl(d.screenshot, `${at}.screenshot`) } : {}) };
}

/**
 * A flare's own fields at the post: `{ title, about, destinations, town }`.
 * `town` is true when the town is its maker (`maker: "town"`), which only a
 * flare hand may say (judged at the door, where the hand is known).
 */
export function judgeFlarePost(fields) {
  for (const k of ["body", "invitation", "stamps", "for", "place", "starts", "ends", "issue", "steps", "record", "link", "credit"])
    if (fields?.[k] !== undefined)
      throw refuse(422, `a flare takes no ${k}`, `a flare is its title, its spark and every place it was posted — ${POST_HOW}`, { field: k });
  const title = typeof fields?.title === "string" ? fields.title.trim() : "";
  if (!title) throw refuse(422, "a flare needs a title", `title: what the flare is called where it was posted — ${POST_HOW}`, { field: "title" });
  if (title.length > TITLE_MAX) throw refuse(422, `a title is at most ${TITLE_MAX} characters`, `this one is ${title.length}`, { field: "title" });
  const about = typeof fields?.about === "string" ? fields.about.trim() : "";
  if (!about) throw refuse(422, "a flare names its spark", `about: the public spark it was posted from — ${POST_HOW}`, { field: "about" });
  if (!SPARK_ID_RE.test(about)) throw refuse(422, `"${about}" is not a spark's id`, "about: the spark's id, <by>/<slug>, as the gallery and the spark read name it", { field: "about" });
  const list = fields?.destinations;
  if (!Array.isArray(list) || !list.length)
    throw refuse(422, "a flare carries every place it was posted", `destinations: one { url, platform, form } for each — a flare with no posting place is not a complete flare — ${POST_HOW}`, { field: "destinations" });
  if (list.length > DESTINATIONS_MAX) throw refuse(422, `a flare carries at most ${DESTINATIONS_MAX} destinations`, `this one has ${list.length}`, { field: "destinations" });
  const destinations = list.map(judgeDestination);
  const seen = new Set();
  for (const d of destinations) {
    if (seen.has(d.url)) throw refuse(422, `${d.url} is named twice`, "each place it was posted is one destination", { field: "destinations" });
    seen.add(d.url);
  }
  if (fields?.maker !== undefined && fields.maker !== "town")
    throw refuse(422, 'maker is "town", or left off', "left off, the flare's maker is your own household; \"town\" says the town posted it on its own channels, which only a flare hand says", { field: "maker" });
  return { title, about, destinations, town: fields?.maker === "town" };
}

/**
 * The hand: the caller's resident, which must be one of FLARE_HANDS and this
 * credential's own (the bug's rule, bugs.mjs § judgeBugHand).
 */
export function judgeFlareHand(fields, key, { act }) {
  const held = [...(key?.handles ?? [])];
  const named = typeof fields?.handle === "string" ? fields.handle.trim() : "";
  if (named && !held.includes(named)) throw refuse(403, `"${named}" is not one of your residents`, `your key acts for ${held.join(", ") || "no resident"}`);
  const hand = named || (held.length === 1 ? held[0] : [...handsOf(key)].find((h) => FLARE_HANDS.includes(h)) ?? "");
  if (!hand || !FLARE_HANDS.includes(hand))
    throw refuse(403, `only ${FLARE_HANDS.join(" and ")} ${act}`, `the law: Iris, wright and keemin advance a flare. ${FLARE_HANDS_PENDING}. Anyone may report a flare with ${POST_HOW}`);
  if (!holdsHand(key, hand)) { const r = notThisHand(hand, key); throw refuse(403, r.defect, r.hint); }
  return hand;
}

/** An advance against the flare's state: `{ to }`. Only from reported, to one of the finished states, and nothing else carried. */
export function judgeFlareAdvance(fields, prev) {
  for (const k of Object.keys(fields ?? {}))
    if (!["post", "class", "to", "handle"].includes(k))
      throw refuse(422, `a flare's advance takes no ${k}`, `it says only which way the flare was taken — ${ADVANCE_HOW}`, { field: k });
  const to = typeof fields?.to === "string" ? fields.to.trim() : "";
  if (!FLARE_FINISHED.includes(to))
    throw refuse(422, to ? `"${to}" is not a state a flare advances to` : "advance to which state?", `to: ${FLARE_FINISHED.join(", ")} — ${ADVANCE_HOW}`, { field: "to" });
  if (prev.state !== STATE_REPORTED)
    throw refuse(409, `"${prev.id}" is already ${prev.state}`, "a flare is taken once: from reported to accepted as text, accepted as video, or declined");
  return { to };
}

/** A flare as a spark lists it: its id, state, maker and every place it was posted. PURE. */
export function flareOnSpark(row) {
  const f = typeof row.fields === "string" ? JSON.parse(row.fields) : (row.fields ?? {});
  return { id: row.id, title: row.title, state: row.state, maker: f.maker ?? row.household ?? null,
    destinations: Array.isArray(f.destinations) ? f.destinations.map((d) => ({ ...d })) : [] };
}

/** The refusals for the acts the law does not give a flare. */
export const FLARE_NO_AMEND = (id) => refuse(422, `"${id}" is a flare, and a flare is not amended`,
  "its record is what was reported; the law gives it no amendment. A place posted later is its own flare");
export const FLARE_NO_CLOSE = (id) => refuse(422, `"${id}" is a flare, and a flare is not closed`,
  `it finishes by advance, by ${FLARE_HANDS.join(" or ")}: ${ADVANCE_HOW}`);
export const FLARE_NO_STAKE = (id) => refuse(422, `${id ? `"${id}" is a flare, and ` : ""}a flare takes no stake`,
  "what a flare pays is the posting quest's word, not this class's (LOGOS/classes.md, the flare)", { field: "stamps" });
