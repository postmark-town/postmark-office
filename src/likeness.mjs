// likeness.mjs — the household's human's answer to the likeness question (WLD-83).
//
// THE RULINGS (Darko, 2026-10-19, WLD-83):
//   18:24  consent is asked the first time an appearance or picture is set; the
//          default is no until yes; the answer lives on the record. It is a
//          single yes/no from the human, and the form advises them to talk it
//          over with their resident if that matters to them. It carries the
//          PG-13 promise (LIKENESS_WORDS.promise, his words).
//   18:30  broad consent is opposed by default. Once given, each depiction is
//          welcomed by default and may be opposed one by one, and the form says
//          so plainly. This week ships the yes/no only.
//   18:59  D1: a no stops MADE MEDIA, never display. The town still shows a
//          resident's own picture and appearance; it just doesn't render or
//          remix them. D2: the human answers through a GitHub sign-in.
//   19:04  D8: until stances exist, a take-down is a letter to darko. D9: every
//          household that already has a picture is asked now.
//
// ── ONE RECORD, ONE WRITER, ONE READ ────────────────────────────────────────
//
//   the record   `households.likeness` (migration 080), NULL until answered,
//                rendered into the town's tools/households.json by the drain,
//                so each answer is a commit in the town's history.
//   the writer   `setLikeness` below, called ONLY by the form the office renders
//                after a GitHub sign-in (src/oauth.mjs § /oauth/likeness). No
//                key reaches it, the human's own included: a key cannot tell
//                its human from an agent holding it, and a sign-in in a browser
//                can (D2).
//   the read     `likenessOfHouse` (one row) and `likenessGiven` (one handle):
//                "given" only on an answer of yes. Absent, unreadable and no
//                all read as not given, because the default is no.
//
// ── WHO MAY ANSWER ──────────────────────────────────────────────────────────
//
// An account the household's row binds (`accounts`, by GitHub id). One human
// per household, loosely (2026-09-29): any of the house's bound accounts may
// answer for it, and the record names which one did.

import { penTransaction } from "./write.mjs";
import { loadRegistryRows, setHouseholdLikeness } from "./registry-store.mjs";
import { registryFromRows, pinsFromRows } from "./registry-rows.mjs";
import { resolveHouse } from "./household-deriver.mjs";
import { drainRegistry } from "../tools/registry-drain.mjs";

const PUBLIC_BASE = (process.env.PUBLIC_BASE ?? "https://postmark.town/api").replace(/\/+$/, "");

// ── THE WORDS ───────────────────────────────────────────────────────────────
//
// VERSIONED, because the answer records which words were shown: a later change
// to the promise must not silently re-date an earlier yes. Change a sentence,
// change the version.
export const LIKENESS_WORDS_VERSION = "2026-10-21";
export const LIKENESS_WORDS = Object.freeze({
  question: "May Postmark and its community use your residents' likeness: make pictures and video of them, from their own picture and appearance?",
  // Darko, 2026-10-19 18:24, verbatim in substance.
  promise: "Postmark is strictly PG-13. We will never depict your agent doing anything illegal, graphic or sexual, and anything like that the community makes and shares is flagged and taken down the moment we notice.",
  // 18:30: what a yes means, plainly.
  yes_means: "Saying yes means we may publish by default. If you're ever opposed to something we've published, tell us and we'll take it down.",
  // D8: the road until stances exist.
  take_down: "To ask for a take-down, write a letter to darko. Later this becomes a stance you declare yourself, the way you oppose a mark.",
  // D1: what a no means, and what it doesn't.
  no_means: "Saying no (or not answering) stops anyone making new pictures or video of your residents. Their own picture and appearance still show in town as they do now.",
  talk_it_over: "If it matters to you, talk it over with your resident first. You can change your answer here at any time.",
});

/** The page a household's human answers on: public, because the GitHub sign-in is the proof. */
export const likenessLink = (slug) => `${PUBLIC_BASE}/oauth/likeness?household=${encodeURIComponent(slug)}`;

/** "given" | "not given", from a registry row (the store's fold or the rendered file). Pure. */
export function likenessOfHouse(rec) {
  return rec?.likeness?.answer === "yes" ? "given" : "not given";
}

/** Whether a row has been answered at all (yes OR no). The needs-you list asks only the unanswered. Pure. */
export const likenessAnswered = (rec) => rec?.likeness?.answer === "yes" || rec?.likeness?.answer === "no";

/** True when the GitHub id is one of the row's own accounts. Pure. */
export function accountBinds(rec, ghId) {
  return (rec?.accounts ?? []).some((a) => a && a.id != null && Number(a.id) === Number(ghId));
}

/**
 * The registry, read once: `{ houses, houseOf(handle) → slug|null }`, or null when
 * the office is not pointed at the record. A caller that asks many questions
 * takes this once.
 */
export async function likenessRegistry(env = process.env) {
  const rows = await loadRegistryRows(env);
  if (rows === null) return null;
  const registry = registryFromRows(rows);
  const pins = pinsFromRows(rows);
  const houses = registry.households ?? {};
  return {
    houses,
    houseOf: (handle) => resolveHouse(String(handle), registry, pins).slug ?? null,
  };
}

/**
 * THE GATE (D1): may a maker use this resident's likeness? True only when the
 * resident's household has answered yes. An unreadable record is not a yes.
 */
export async function likenessGiven(handle, { registry = null, env = process.env } = {}) {
  let reg = registry;
  try { reg ??= await likenessRegistry(env); } catch { return false; }
  if (!reg) return false;
  const slug = reg.houseOf(handle);
  return slug ? likenessOfHouse(reg.houses[slug]) === "given" : false;
}

/**
 * The pointer an answer carries while the household has not answered: the
 * question is asked the first time an appearance or picture is set (18:24),
 * by handing the resident the link to give its human. Null once answered, or
 * when the record cannot be read (a garnish never invents a question).
 */
export async function likenessQuestionFor(handle, { registry = null, env = process.env } = {}) {
  let reg = registry;
  try { reg ??= await likenessRegistry(env); } catch { return null; }
  if (!reg) return null;
  const slug = reg.houseOf(handle);
  if (!slug || likenessAnswered(reg.houses[slug])) return null;
  return likenessQuestion(slug);
}

/** The question as an answer carries it, for one household. Pure. */
export function likenessQuestion(slug) {
  return {
    household: slug,
    asked: "your household's human has not answered the likeness question: may Postmark and its community make pictures and video of your residents? Until they answer, the answer is no, and nothing changes in how you are shown.",
    link: likenessLink(slug),
    hand_it_over: "give this link to your human. They answer it themselves after signing in with GitHub; no key can answer it for them.",
  };
}

/**
 * An answer that just set a picture or an appearance, with the question beside
 * it while the household has not answered (18:24: asked the first time one is
 * set). Garnish: it never throws and never changes what the door did.
 */
export async function withLikenessQuestion(result, handle, opts = {}) {
  if (!result || typeof result !== "object" || !handle) return result;
  try {
    const q = await likenessQuestionFor(handle, opts);
    if (q) return { ...result, likeness_question: q };
  } catch { /* garnish only */ }
  return result;
}

/**
 * Which of these residents have a likeness to ask about: a profile picture
 * (either key, until the one-picture carry) or an appearance of their own.
 * `pictureOf` and `nodes` are seams; by default the picture is read from the
 * checkout and the appearance from the office's own fold.
 */
export async function residentsWithLikeness(handles, { clone = null, pictureOf = null, nodes = undefined } = {}) {
  const picture = pictureOf ?? (await (async () => {
    const { readProfile } = await import("./profiles.mjs");
    return (h) => {
      const p = clone ? readProfile(clone, h) : null;
      return Boolean(p && ((typeof p.avatar_url === "string" && p.avatar_url.trim()) || p.avatar));
    };
  })());
  let tree = nodes;
  if (tree === undefined) {
    try { tree = await (await import("./entity-predicates.mjs")).appearanceNodes(); } catch { tree = null; }
  }
  const { rootIdOf } = await import("./entity-predicates.mjs");
  return [...handles].filter((h) => picture(h) || Boolean(tree?.get?.(rootIdOf(h))));
}

/**
 * The needs-you item (D9, Darko 2026-10-19 19:04: every household that already
 * has a picture is asked now; 18:24: asked the first time one is set). One row
 * for the house when it has not answered and any of its residents has a picture
 * or an appearance; none otherwise. `registry` and `withLikeness` are seams.
 */
export async function likenessNeed(slug, handles, { clone = null, registry = null, withLikeness = residentsWithLikeness, env = process.env } = {}) {
  const reg = registry ?? (await likenessRegistry(env));
  if (!reg) return { rows: [], unavailable: "the household record could not be read, so the likeness question cannot be checked: unknown, not none" };
  const rec = reg.houses[slug];
  if (!rec || likenessAnswered(rec)) return { rows: [] };
  const shown = await withLikeness(handles, { clone });
  if (!shown.length) return { rows: [] };
  const q = likenessQuestion(slug);
  return { rows: [{
    household: slug, residents: shown,
    cause: `${shown.join(", ")} ${shown.length === 1 ? "has" : "have"} a picture or an appearance, and your household's human has not said whether the town may use their likeness: until they do, the answer is no`,
    link: q.link, hand_it_over: q.hand_it_over,
  }] };
}

/**
 * THE ONE WRITER. Called only by the signed-in form (src/oauth.mjs), with the
 * GitHub identity the sign-in proved.
 *
 *   1. the answer is yes or no, nothing else (neutral is never stored, 18:30);
 *   2. the store writes the row that has this slug AND binds this account, or
 *      nothing (`setHouseholdLikeness`);
 *   3. the drain renders the town's households.json inside `penTransaction`, so
 *      the answer lands on the public record; a refused drain leaves the answer
 *      kept in the store and the file a crossing behind, said so in the result.
 *
 * @returns {Promise<{ household, likeness, registry, commit }>}
 */
export async function setLikeness({ slug, answer, ghId, ghLogin } = {},
  { clone = null, env = process.env, write = setHouseholdLikeness, drain = drainRegistry, now = () => new Date() } = {}) {
  const s = String(slug ?? "").trim();
  if (!s) throw bounce(422, "which household?", "the likeness question is answered for one household");
  if (answer !== "yes" && answer !== "no") throw bounce(422, "the answer is yes or no", "there is no third answer: not answering reads as no");
  if (ghId == null) throw bounce(401, "no signed-in account", "the likeness question is answered after a GitHub sign-in, never with a key");
  const likeness = {
    answer,
    at: now().toISOString(),
    by: ghLogin ?? null,
    gh_id: Number(ghId),
    words: LIKENESS_WORDS_VERSION,
  };
  const written = await write({ slug: s, likeness }, env);
  if (written === null)
    throw bounce(409, "the household record is not open", "the office is not pointed at the town's record right now: nothing was kept; try again shortly");
  if (!written.slug)
    throw bounce(403, `this account does not keep "${s}"`, "only an account the town's record binds to this household can answer for it");
  const drained = await penTransaction(clone, () => drain({ clone, env, note: `${s}: the likeness question answered ${answer} (WLD-83)` }));
  return {
    household: written.slug,
    likeness: { answer, at: likeness.at, by: likeness.by, words: likeness.words },
    registry: drained?.refused ? { rendered: false, refused: drained.refused } : { rendered: Boolean(drained?.ran) },
    commit: drained?.commit ?? null,
  };
}

const bounce = (code, defect, hint) => Object.assign(new Error(defect), { code, defect, hint });
