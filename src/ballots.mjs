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

import { PEN_HANDLE } from "./earpiece.mjs";
import { refuse } from "./events.mjs";

export const BALLOT_CLASS = "ballot";
export const STATE_SUBMISSIONS = "submissions";
export const STATE_STAKING = "staking";
export const STATE_CLOSED = "closed";
/** The class's lifecycle, in order, and the states it is finished in. */
export const BALLOT_STATES = Object.freeze([STATE_SUBMISSIONS, STATE_STAKING, STATE_CLOSED]);
export const BALLOT_FINISHED = Object.freeze([STATE_CLOSED]);

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
export const topicOfPostId = (id) => /^[^/]+\/ballot-([a-z0-9-]+)$/.exec(String(id ?? ""))?.[1] ?? null;

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
  const cap = Number(json.cap_per_household_per_candidate ?? DEFAULT_CAP);
  if (!Number.isInteger(cap) || cap < 1) throw refuse(422, `${where} has cap ${json.cap_per_household_per_candidate}`, "the cap is a whole number of stamps, at least 1");
  return {
    title: String(json.title ?? topic),
    body: Array.isArray(json.notes) ? json.notes.map(String).join("\n") : "",
    state: json.status,
    fields: { topic, candidates: [...candidates], cap_per_household_per_candidate: cap,
      window: json.window ?? null, file: where },
  };
}

/** The terms the post's fields carry, compared key by key; the keys that differ. */
export const TERM_KEYS = Object.freeze(["candidates", "cap_per_household_per_candidate", "window"]);
export function changedTerms(post, want) {
  const out = [];
  if (post.title !== want.title) out.push("title");
  if ((post.body ?? "") !== want.body) out.push("body");
  for (const k of TERM_KEYS) if (JSON.stringify(post.fields?.[k] ?? null) !== JSON.stringify(want.fields[k] ?? null)) out.push(k);
  return out;
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
 * its residents applied it; candidates by stamps, ties in the file's order,
 * households by what they applied.
 */
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
  const candidates = (post.fields.candidates ?? []).map((c) => ({
    candidate: c,
    staked: perCandidate.get(c) ?? 0,
    households: [...perHousehold.values()].filter((r) => r.candidate === c).sort((x, y) => y.applied - x.applied),
  })).sort((x, y) => y.staked - x.staked);
  return { topic: post.fields.topic, status: post.state,
    cap_per_household_per_candidate: Number(post.fields.cap_per_household_per_candidate),
    window: post.fields.window ?? null, candidates };
}
