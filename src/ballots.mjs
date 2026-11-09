// ballots.mjs — THE BALLOT CLASS OF THE POST MACHINE (POS-349), pure.
//
// Darko, 2026-10-05: "ballots are posts. A 028 post of class ballot, votes as
// its responses; stakes and returns stay ledger lines under the stamp sandbox.
// One machine for asks (09-26 posts ruling)."
//
// ── THE BALLOT FILE IS THE INPUT, THE POST IS THE RECORD ────────────────────
//
// The founder writes WHITE_PAGES/ballot-<topic>.json in the town, as before:
// git stays an entrance (R13, "Git can be written to. The store reads git.").
// The office takes it in as the town's post (src/ballots-store.mjs §
// ingestBallotFiles), with its terms in the post's fields, and every office
// reader reads the post. The file stays where it is because the town's own
// tools still read it: stamp-verify's LAWFUL check (candidates, cap) and
// `ballot.mjs --close`, which writes the returns. Both are left alone.
//
// ── THE LIFECYCLE ───────────────────────────────────────────────────────────
//
//   submissions → staking → closed      (the file's own `status` words)
//
// Finished: closed. A ballot moves forward only. The town posts and moves it
// (author postmark-pen, household hh:the-town); the act names the hand.
//
// ── A VOTE IS A RESPONSE; THE STAKE STAYS A LEDGER LINE ─────────────────────
//
// Each stake is one `vote` act, and a resident's one `vote` response per
// ballot carries every stake they cast (events.mjs § ACT_VOTE). The stake line
// and the first-stake mint stay the ledger's, written by the town's own line
// builders, and each vote act names the line it wrote by its signature.
//
// HOW A BALLOT IS DECIDED IS UNCHANGED: the clip, the cap, the meep law and
// the household the cap counts are the town engine's (tools/ballot.mjs). The
// cap's household is the engine's mint key for the resident on the stake's
// date, recorded on each stake as `mint_key`, because the town's verifier
// recounts the cap with that key. It is never the store's `hh:` house.
//
// ── A FULL POST: CHOICES WITH THEIR WORDS (POS-983) ─────────────────────────
//
// Darko, POS-684 call 4 (2026-11-09 15:38 EST): the ballot becomes a full post,
// put up, amended, advanced and closed by the town's hands through the post
// acts (src/ballot-acts.mjs). The file stays the entrance and the post the
// record: a hand's act writes the file and takes it in, in one landing.
//
//   · A CHOICE'S NAME IS ITS STAKE IDENTITY. `candidates` stays a list of
//     names, the word every stake line carries (stake:<topic>/<name>), so the
//     town's engine, its verifier and every stake already made read on as
//     before. What a voter needs beside the name is in `choices`, keyed by
//     name: who made it (`credit`), a `link` and a one-line `note`. A bare-name
//     ballot (illuminator-name) has no `choices`, and reads as it always has.
//   · A CHOICE JOINS WHILE THE BALLOT RUNS, and once staking opens nothing is
//     taken away: the names already on the ballot stay, in their order, and
//     the cap stays, because the verifier recounts every stake against the
//     file as it stands (a name gone turns its stakes red; a cap moved re-judges
//     every clip). judgeTermsMove is that rule, for the act and the file alike.
//   · THE COUNT IS RAW STAMPS (call 5b), as the engine and the verifier count
//     them, at most the cap per household per choice. Each choice shows how
//     many households back it, and more households breaks a tie in stamps.

import { PEN_HANDLE } from "./earpiece.mjs";
import { refuse } from "./events.mjs";

export const BALLOT_CLASS = "ballot";
export const STATE_SUBMISSIONS = "submissions";
export const STATE_STAKING = "staking";
export const STATE_CLOSED = "closed";
/** The class's lifecycle, in order. */
export const BALLOT_STATES = Object.freeze([STATE_SUBMISSIONS, STATE_STAKING, STATE_CLOSED]);

/** The town's own pen is every ballot's author, as it is every quest's. */
export const BALLOT_AUTHOR = PEN_HANDLE;
/** The hands that put a ballot up and move it (Wright, POS-349: "hand wright/keemin"). */
export const BALLOT_HANDS = Object.freeze(["wright", "keemin"]);

/** A ballot topic as the town spells one (tools/ballot.mjs § readBallot). */
export const TOPIC_RE = /^[a-z0-9-]+$/;
/** The town engine's default cap, when a file names none (tools/ballot.mjs § tally). */
export const DEFAULT_CAP = 20;

export const ballotFileName = (topic) => `ballot-${topic}.json`;
export const ballotFilePath = (topic) => `WHITE_PAGES/${ballotFileName(topic)}`;
/** A ballot post's id: the pen's, by the file's name. */
export const ballotPostId = (topic) => `${BALLOT_AUTHOR}/ballot-${topic}`;
/** The topic a ballot post's id names, or null. */
export const topicOfPost = (id) => {
  const s = String(id ?? "");
  const head = `${BALLOT_AUTHOR}/ballot-`;
  return s.startsWith(head) && TOPIC_RE.test(s.slice(head.length)) ? s.slice(head.length) : null;
};

// ── a choice's words (POS-983) ──────────────────────────────────────────────

/**
 * A new choice's name, as the ledger spells a candidate (the town's
 * stamp-mint.mjs § STAKE_RE: `stake:<topic>/<candidate>`, the candidate
 * [A-Za-z0-9-]+). A name the ledger could not carry could never be staked.
 */
export const CHOICE_NAME_RE = /^[A-Za-z0-9-]{1,64}$/;
/** The words a choice carries beside its name, and how long each may be. */
export const CHOICE_WORDS = Object.freeze({ credit: 80, link: 300, note: 200 });

/**
 * One choice's words, judged: `{ credit?, link?, note? }`, each a single line
 * of plain text, the link an https address. `where` names the field in a
 * refusal. Absent and empty words are left out.
 */
export function judgeChoiceWords(raw, where) {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw))
    throw refuse(422, `${where} is not a choice's words`, "{ credit, link, note }, each optional", { field: where });
  const out = {};
  for (const [k, max] of Object.entries(CHOICE_WORDS)) {
    if (raw[k] == null || raw[k] === "") continue;
    if (typeof raw[k] !== "string") throw refuse(422, `${where}.${k} is not text`, `${k}: one line of text`, { field: `${where}.${k}` });
    const v = raw[k].trim();
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(v)) throw refuse(422, `${where}.${k} is more than one line`, `${k}: one line of plain text`, { field: `${where}.${k}` });
    if (v.length > max) throw refuse(422, `${where}.${k} is ${v.length} characters`, `${k}: at most ${max}`, { field: `${where}.${k}` });
    if (k === "link") {
      let url = null;
      try { url = new URL(v); } catch { /* judged below */ }
      if (!url || url.protocol !== "https:")
        throw refuse(422, `${where}.link is not an https address`, "link: https://…", { field: `${where}.link` });
    }
    if (v) out[k] = v;
  }
  return out;
}

/**
 * The `choices` a ballot file carries, judged against its candidates: an
 * object keyed by candidate name, each value a choice's words (plus `added`,
 * the town day it joined, when the act that added it wrote one). Null when
 * the file has none (a bare-name ballot).
 */
export function choicesFromFile(json, candidates, where) {
  if (json.choices == null) return null;
  if (typeof json.choices !== "object" || Array.isArray(json.choices))
    throw refuse(422, `${where} has choices that are not keyed by name`, "choices: { \"<name>\": { credit, link, note } }");
  const out = {};
  for (const [name, raw] of Object.entries(json.choices)) {
    if (!candidates.includes(name))
      throw refuse(422, `${where} has words for "${name}", which is not a candidate`, "every key of choices is a name in candidates");
    const words = judgeChoiceWords(raw, `choices.${name}`);
    if (raw?.added != null) {
      if (typeof raw.added !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.added))
        throw refuse(422, `${where} has choices.${name}.added "${raw.added}"`, "added: the town day it joined, YYYY-MM-DD");
      words.added = raw.added;
    }
    out[name] = words;
  }
  return out;
}

/** One choice as every reader answers it: its name, and its words or null. */
export function choiceOf(fields, name) {
  const w = fields?.choices?.[name] ?? {};
  return { candidate: name, credit: w.credit ?? null, link: w.link ?? null, note: w.note ?? null, added: w.added ?? null };
}

/** Every choice on a ballot post, in the file's order. */
export const choicesOf = (fields) => (fields?.candidates ?? []).map((c) => choiceOf(fields, c));

/**
 * The post a ballot file says: `{ title, body, state, fields }`, or a refusal
 * naming what the file lacks. `fields` holds the terms the office's readers
 * answer from: the topic, the candidates in the file's order, the cap and the
 * window, and where the file is.
 */
export function ballotFromFile(json, topic) {
  const where = ballotFilePath(topic);
  if (!TOPIC_RE.test(topic ?? "")) throw refuse(422, `"${topic}" is not a ballot topic`, "a topic is lowercase letters, digits and hyphens");
  if (!json || typeof json !== "object") throw refuse(422, `${where} is not a JSON object`, "the founder's ballot file is the input; nothing was taken in");
  if (!BALLOT_STATES.includes(json.status))
    throw refuse(422, `${where} has status "${json.status}"`, `a ballot's status is one of ${BALLOT_STATES.join(", ")}`);
  const candidates = json.candidates ?? [];
  if (!Array.isArray(candidates) || candidates.some((c) => typeof c !== "string" || !c))
    throw refuse(422, `${where} lists candidates that are not names`, "candidates: [\"<name>\", …]");
  if (new Set(candidates).size !== candidates.length)
    throw refuse(422, `${where} lists a candidate twice`, "each name once: it is the stake's identity");
  const cap = Number(json.cap_per_household_per_candidate ?? DEFAULT_CAP);
  if (!Number.isInteger(cap) || cap < 1) throw refuse(422, `${where} has cap ${json.cap_per_household_per_candidate}`, "the cap is a whole number of stamps, at least 1");
  // POS-983: a choice's words ride beside the names; a bare-name file has none, and its fields are as they were
  const choices = choicesFromFile(json, candidates, where);
  return {
    title: String(json.title ?? topic),
    body: Array.isArray(json.notes) ? json.notes.map(String).join("\n") : "",
    state: json.status,
    fields: { topic, candidates: [...candidates], cap_per_household_per_candidate: cap,
      window: json.window ?? null, file: where, ...(choices ? { choices } : {}) },
  };
}

/** The terms the post's fields carry, compared key by key; the keys that differ. */
export const TERM_KEYS = Object.freeze(["candidates", "cap_per_household_per_candidate", "window", "choices"]);
/** A term as text with its object keys in one order: the store's jsonb keeps its own key order, the file its writer's. */
const canonical = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
export function changedTerms(post, want) {
  const out = [];
  if (post.title !== want.title) out.push("title");
  if ((post.body ?? "") !== want.body) out.push("body");
  for (const k of TERM_KEYS) if (canonical(post.fields?.[k] ?? null) !== canonical(want.fields[k] ?? null)) out.push(k);
  return out;
}

/**
 * Once a ballot is past submissions, its terms only grow (POS-983, § A FULL
 * POST): every name already on it stays, in its place, and the cap stays.
 * Choices join at the end, and a choice's words may change. Before staking
 * no stake stands, and the hand may reshape the ballot freely. Throws 409.
 */
export function judgeTermsMove(post, want, topic) {
  if (!post || post.state === STATE_SUBMISSIONS) return;
  const had = post.fields?.candidates ?? [];
  const now = want.fields.candidates ?? [];
  const kept = had.every((c, i) => now[i] === c);
  if (!kept)
    throw refuse(409, `ballot "${topic}" stands ${post.state}, and its choices would lose or move ${had.filter((c, i) => now[i] !== c).map((c) => `"${c}"`).join(", ")}`,
      "once staking opens a choice is never taken away or renamed: its name is every stake's identity; a new choice joins at the end; nothing was changed");
  if (Number(post.fields?.cap_per_household_per_candidate) !== Number(want.fields.cap_per_household_per_candidate))
    throw refuse(409, `ballot "${topic}" stands ${post.state}, and its cap would move from ${post.fields?.cap_per_household_per_candidate} to ${want.fields.cap_per_household_per_candidate}`,
      "the cap is fixed once staking opens: every stake was clipped to it; nothing was changed");
}

/**
 * Every stake on a ballot, from its vote responses, each with its handle, in
 * act order: the order the ledger holds their lines in, which is the order the
 * town engine meets them in.
 */
export function stakesOf(voteRows) {
  const out = [];
  for (const r of voteRows) for (const s of r.fields?.stakes ?? []) out.push({ ...s, handle: r.handle, n: Number(s.n) });
  return out.sort((a, b) => Number(a.act) - Number(b.act));
}

/** What a household (by its mint key) has staked on one candidate. */
export function appliedBy(voteRows, candidate, mintKey) {
  let n = 0;
  for (const s of stakesOf(voteRows)) if (s.candidate === candidate && s.mint_key === mintKey) n += s.n;
  return n;
}

/** The household's remaining headroom on one candidate (tools/ballot.mjs § headroom, from the responses). */
export const headroomOf = (post, voteRows, candidate, mintKey) =>
  Math.max(0, Number(post.fields.cap_per_household_per_candidate) - appliedBy(voteRows, candidate, mintKey));

/**
 * The tally, in the town engine's own shape (tools/ballot.mjs § tally): per
 * candidate the stamps staked, and per household what it applied and which of
 * its residents applied it; households by what they applied.
 *
 * POS-983 (call 5b): each candidate also says how many households back it
 * (`backing_households`, the engine households whose stakes on it stand above
 * zero), and the order is the count's: most raw stamps first, then more
 * backing households, then the file's order.
 */
export const byCount = (x, y) => (y.staked - x.staked) || (y.backing_households - x.backing_households);
export function tallyOf(post, voteRows) {
  const perCandidate = new Map();
  const perHousehold = new Map();
  for (const s of stakesOf(voteRows)) {
    perCandidate.set(s.candidate, (perCandidate.get(s.candidate) ?? 0) + s.n);
    const k = `${s.candidate}|${s.mint_key}`;
    const row = perHousehold.get(k) ?? { household: s.mint_key, candidate: s.candidate, applied: 0, handles: {} };
    row.applied += s.n;
    row.handles[s.handle] = (row.handles[s.handle] ?? 0) + s.n;
    perHousehold.set(k, row);
  }
  const candidates = (post.fields.candidates ?? []).map((c) => {
    const households = [...perHousehold.values()].filter((r) => r.candidate === c).sort((x, y) => y.applied - x.applied);
    return { candidate: c, staked: perCandidate.get(c) ?? 0, households,
      backing_households: households.filter((r) => r.applied > 0).length };
  }).sort(byCount);
  return { topic: post.fields.topic, status: post.state,
    cap_per_household_per_candidate: Number(post.fields.cap_per_household_per_candidate),
    window: post.fields.window ?? null, candidates };
}

// ── a hand's act, as the file it writes (POS-983) ───────────────────────────
//
// The town door's post acts (src/ballot-acts.mjs) never write the post on
// their own: each composes the ballot FILE the act means, from the file as it
// stands, and the store's ingest takes that file in, in the same landing
// (src/ballots-store.mjs § ballotActInStore). So the file the town's engine
// and verifier read and the post every office reader reads are one truth, and
// a founder's hand-written file still enters the same way.

/** The acts a ballot takes at the town door, by the door's verb. */
export const BALLOT_VERBS = Object.freeze(["post", "amend", "advance", "close"]);

const textOf = (v, field, max) => {
  if (typeof v !== "string") throw refuse(422, `${field} is not text`, `${field}: text`, { field });
  const s = v.replace(/\r\n?/g, "\n").trim();
  if (s.length > max) throw refuse(422, `${field} is ${s.length} characters`, `${field}: at most ${max}`, { field });
  return s;
};

/** The choices an act names: `[{ name, credit?, link?, note? }]`, each name once. */
export function judgeActChoices(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw refuse(422, "choices is not a list", 'choices: [{ name, credit, link, note }, …]', { field: "choices" });
  const seen = new Set();
  return list.map((c, i) => {
    const where = `choices[${i}]`;
    const name = typeof c === "string" ? c : c?.name;
    if (typeof name !== "string" || !CHOICE_NAME_RE.test(name))
      throw refuse(422, `${where} has the name ${JSON.stringify(name ?? null)}`,
        "a choice's name is letters, digits and hyphens (at most 64): it is the stake's identity on the ledger, stake:<topic>/<name>", { field: `${where}.name` });
    if (seen.has(name)) throw refuse(422, `${where} names "${name}" twice`, "each choice once", { field: `${where}.name` });
    seen.add(name);
    const { name: _n, ...words } = typeof c === "string" ? {} : c;
    for (const k of Object.keys(words)) if (!(k in CHOICE_WORDS))
      throw refuse(422, `${where} has ${k}`, `a choice carries name, ${Object.keys(CHOICE_WORDS).join(", ")}`, { field: `${where}.${k}` });
    return { name, words: judgeChoiceWords(words, where), named: Object.keys(words) };
  });
}

/**
 * The file a hand's act means: `{ topic, json }`. `file` is the ballot file
 * as it stands (null for a new one), `post` its post; `today` the town day.
 *
 *   post     { topic, title, body?, window?, choices? }   a new ballot, in submissions
 *   amend    { post, title?, body?, window?, choices? }   only what it names changes:
 *            a choice named again has those words replaced, a new name joins at the end
 *   advance  { post, to: "staking" }
 *   close    { post }
 *
 * The file's other keys (opens, closes, board, result, …) are kept as they
 * are. The body is the file's `notes`, a line each. Throws a refusal.
 */
export function composeBallotAct(verb, args = {}, { file = null, post = null, topic, today }) {
  const known = { post: ["class", "topic", "title", "body", "window", "choices", "handle"],
    amend: ["class", "post", "title", "body", "window", "choices", "handle"],
    advance: ["class", "post", "to", "handle"], close: ["class", "post", "handle"] }[verb];
  if (!known) throw refuse(422, `a ballot takes ${BALLOT_VERBS.join(", ")}, not "${verb}"`, "the post machine's verbs");
  for (const k of Object.keys(args)) if (!known.includes(k))
    throw refuse(422, `a ballot's ${verb} takes no ${k}`, `it takes: ${known.filter((x) => x !== "class" && x !== "handle").join(", ")}`, { field: k });
  const json = file ? structuredClone(file) : null;
  const setBody = (j) => { if (args.body !== undefined) j.notes = textOf(args.body, "body", 4000).split("\n"); };
  const setWindow = (j) => { if (args.window !== undefined) j.window = args.window === null ? null : textOf(args.window, "window", 200); };

  if (verb === "post") {
    if (file || post) throw refuse(409, `ballot "${topic}" is already up (it stands ${post?.state ?? file?.status})`,
      "a topic is put up once; carry it with amend, advance and close");
    const title = args.title == null ? "" : textOf(args.title, "title", 200);
    if (!title) throw refuse(422, "a ballot needs a title", "title: what is being decided, in a line", { field: "title" });
    const choices = judgeActChoices(args.choices);
    const out = { topic, title, status: STATE_SUBMISSIONS, cap_per_household_per_candidate: DEFAULT_CAP, window: null,
      candidates: choices.map((c) => c.name), notes: [] };
    setBody(out); setWindow(out);
    out.choices = Object.fromEntries(choices.map((c) => [c.name, { ...c.words, added: today }]));
    return { topic, json: out };
  }

  if (!file) throw refuse(404, `no ballot "${topic}"`, 'town { read: "posts", args: { class: "ballot" } } lists them');
  if (verb === "amend") {
    if (file.status === STATE_CLOSED) throw refuse(409, `ballot "${topic}" is closed`, "a closed ballot is the record of its vote; nothing was changed");
    if (args.title !== undefined) {
      const title = textOf(args.title, "title", 200);
      if (!title) throw refuse(422, "a ballot needs a title", "title: what is being decided, in a line", { field: "title" });
      json.title = title;
    }
    setBody(json); setWindow(json);
    const choices = judgeActChoices(args.choices);
    if (choices.length) {
      json.candidates = [...(json.candidates ?? [])];
      const had = json.choices && typeof json.choices === "object" ? { ...json.choices } : {};
      for (const c of choices) {
        if (json.candidates.includes(c.name)) {
          // words named again are replaced; words not named stay; "" clears one
          const w = { ...(had[c.name] ?? {}) };
          for (const k of c.named) { if (c.words[k] === undefined) delete w[k]; else w[k] = c.words[k]; }
          had[c.name] = w;
        } else {
          json.candidates.push(c.name);
          had[c.name] = { ...c.words, added: today };
        }
      }
      json.choices = had;
    }
    if (args.title === undefined && args.body === undefined && args.window === undefined && !choices.length)
      throw refuse(422, "an amend that names nothing changes nothing", "amend: title, body, window or choices", { field: "post" });
    return { topic, json };
  }
  if (verb === "advance") {
    if (args.to === STATE_CLOSED) throw refuse(422, "a ballot is closed by close", 'town { do: "close", args: { post } }', { field: "to" });
    if (args.to !== STATE_STAKING) throw refuse(422, `a ballot advances to "${STATE_STAKING}", not ${JSON.stringify(args.to ?? null)}`, "submissions → staking; close ends it", { field: "to" });
    if (file.status !== STATE_SUBMISSIONS) throw refuse(409, `ballot "${topic}" stands ${file.status}`, "only a ballot in submissions advances to staking");
    json.status = STATE_STAKING;
    return { topic, json };
  }
  // close
  if (file.status === STATE_CLOSED) throw refuse(409, `ballot "${topic}" is already closed`, "nothing to do");
  json.status = STATE_CLOSED;
  return { topic, json };
}
