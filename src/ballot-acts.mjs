// ballot-acts.mjs — THE BALLOT AT THE TOWN DOOR: post · amend · advance · close (POS-983).
//
// Darko, POS-684 call 4 (2026-11-09 15:38 EST): the ballot is a full post, put
// up, amended, advanced and closed by the town's hands through the post acts;
// call 5c: "Only the town's hands (Wright, Darko) open a ballot, for now."
//
//   town { do: "post",    args: { class: "ballot", topic, title, body?, window?, choices? } }
//   town { do: "amend",   args: { post, title?, body?, window?, choices? } }
//   town { do: "advance", args: { post, to: "staking" } }
//   town { do: "close",   args: { post } }
//
// `choices` is `[{ name, credit?, link?, note? }]`: a new name joins at the
// end (while the ballot is in submissions or staking), a name already on it
// has the words it is sent with replaced. Nothing is ever taken off once
// staking opens (src/ballots.mjs § A FULL POST).
//
// THE HAND is the caller's credential's own (named-hand.mjs § holdsHand), one
// of BALLOT_HANDS, as a quest's is: any other resident is refused before the
// act runs, and a housemate's or an agent's own key cannot stand as a hand.
//
// THE ACT writes the town clone (the ballot file is the entrance the town's
// engine and verifier read), so it runs in a child under the town lock
// (ballot-act-exec.mjs), as a stake does, and the child lands the file and
// the post together (src/ballots-store.mjs § ballotActInStore).
//
// THE CLOSE ends the staking. The stakes return as they always have: the
// founder's close ceremony (the town's `tools/ballot.mjs --close`) writes the
// signed return lines from the file's closed status. This act signs nothing.

import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runLockedExec } from "./town-lock.mjs";
import { refuse } from "./events.mjs";
import { handsOf, holdsHand, notThisHand } from "./named-hand.mjs";
import { apiUrl } from "./public-base.mjs";
import { BALLOT_CLASS, BALLOT_HANDS, BALLOT_AUTHOR, STATE_CLOSED, choicesOf } from "./ballots.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOWN_CLONE = () => process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");

/** The town day a choice joins on (votes.mjs § townDay's clock). */
const townDay = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(new Date(now));

/**
 * The hand: the caller's resident, who must be one of BALLOT_HANDS, and this
 * credential's own (POS-389). The act names it; the post's author stays the pen.
 */
export function judgeBallotHand(fields, key) {
  const held = [...(key?.handles ?? [])];
  const named = String(fields?.handle ?? "").trim();
  const hand = named || (held.length === 1 ? held[0] : [...handsOf(key)].find((h) => BALLOT_HANDS.includes(h)) ?? "");
  if (named && !held.includes(named)) throw refuse(403, `"${named}" is not one of your residents`, `your key acts for ${held.join(", ") || "no resident"}`);
  if (!hand || !BALLOT_HANDS.includes(hand))
    throw refuse(403, "only the town's hands put up and carry its ballots",
      `a ballot is the town's post, authored by ${BALLOT_AUTHOR}; the hands that may put one up, amend, advance or close it are ${BALLOT_HANDS.join(" and ")}`);
  if (!holdsHand(key, hand)) { const r = notThisHand(hand, key); throw refuse(403, r.defect, r.hint); }
  return hand;
}

const readHint = (id) => `town { read: "posts", args: { class: "ballot", post: "${id}" } } — or GET ${apiUrl(`/posts/${id}`)}; the tally: town { read: "votes" }`;

const RECEIPT = {
  post: (a, hand) => `posted: ${a.post.id} (a ballot), the town's post by ${hand}'s hand; it stands in submissions with ${a.post.fields.candidates.length} choice(s), and advance to "staking" opens it`,
  amend: (a, hand) => `amended: ${a.post.id} by ${hand}'s hand; it stands ${a.post.state} with ${a.post.fields.candidates.length} choice(s)`,
  advance: (a, hand) => `advanced: ${a.post.id} to ${a.post.state} by ${hand}'s hand; residents can stake on its choices now`,
  close: (a, hand) => `closed: ${a.post.id} by ${hand}'s hand; no stake lands on it now. Every stake returns whole at the close ceremony (the town's tools/ballot.mjs --close ${a.topic}), which writes the signed return lines`,
};

/** One hand's act on a ballot: `verb` is post | amend | advance | close. */
export async function ballotAtTown(verb, fields, key, { now = Date.now(), clone = TOWN_CLONE(), exec = join(HERE, "ballot-act-exec.mjs") } = {}) {
  const hand = judgeBallotHand(fields, key);
  const { handle: _hand, ...args } = fields ?? {};
  const a = await runLockedExec(exec, { verb, args, hand, today: townDay(now) },
    { clone, tripped: "the ballot act tripped", keepField: true });
  const row = a.post;
  return {
    post: { id: row.id, class: BALLOT_CLASS, author: row.author, household: row.household ?? null, state: row.state,
      title: row.title, body: row.body ?? "", fields: row.fields, choices: choicesOf(row.fields) },
    did: a.did, act_ids: a.act_ids, hand, file: a.file, commit: a.commit ?? null,
    receipt: RECEIPT[verb](a, hand), read: readHint(row.id),
    ...(row.state === STATE_CLOSED ? { returns: `node tools/ballot.mjs --close ${a.topic} --date <the town day> --key <the pen's key> (the founder's close ceremony; it refuses a ballot not closed)` } : {}),
  };
}
