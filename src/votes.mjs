// votes.mjs — the ballot doors (gold plan postmark-ballot, P1; POS-349).
//
// A BALLOT IS A POST AND A VOTE IS ITS RESPONSE (Darko, 2026-10-05). The reads
// answer from the office's record: the ballot's `posts` row (class "ballot",
// taken in from the founder's file by src/ballots-store.mjs § ingestBallotFiles)
// and its `vote` responses. The answers keep the shape the town engine's tally
// gave them, so the site's /votes/ page (GET /votes: topics[].{topic, status,
// window, cap_per_household_per_candidate, candidates[].{candidate, staked}})
// reads them unchanged.
//
// The town's engine (tools/ballot.mjs, imported live from the checkout) is
// still asked one thing on a read: which household a signed-in resident's
// stake would count in, today (the cap's household is the engine's mint key,
// src/ballots.mjs § the header). Writes go through a subprocess under the
// ferry's flock (src/stake-exec.mjs), which writes the vote and the ledger
// line together (src/ballots-store.mjs § stakeInStore).

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execUnderTownLock, lockTimedOut, LOCK_BUSY } from "./town-lock.mjs";
import { ballotsWithVotes, ballotWithVotes, tallyOf } from "./ballots-store.mjs";
import { headroomOf, appliedBy, STATE_STAKING, STATE_CLOSED } from "./ballots.mjs";
import { refuse } from "./events.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

let engineCache = null; // { clone, mod }
async function engine(clone) {
  if (engineCache?.clone === clone) return engineCache.mod;
  const mod = await import(pathToFileURL(join(clone, "tools", "ballot.mjs")));
  engineCache = { clone, mod };
  return mod;
}

export function votesAvailable(clone) {
  return existsSync(join(clone, "tools", "ballot.mjs"));
}

/** The household a resident's stake counts in today: the town engine's mint key. */
async function mintKeyOf(clone, handle, date) {
  const b = await engine(clone);
  return b.ballotState(clone).householdOf(handle, date);
}

// ── A BALLOT THE OFFICE HAS NOT TAKEN IN YET (Wright's review of #415) ──────
//
// The office tick takes the town's ballot files in, stakes and all
// (tools/ballots-backfill.mjs --apply, deploy/office-keep.sh at :07, :22, :37
// and :52). Between a deploy (or a founder's new file) and that tick, a file
// can stand with no post. The read never answers as if it were not there: a
// ballot whose stakes the ledger holds would read as gone, or as nothing
// staked, so the read REFUSES until the tick (503, naming the ballot); one
// with no stakes yet is named in `awaiting_intake` beside the list.
export const INTAKE_HINT = "the office's tick takes the town's ballots in at :07, :22, :37 and :52 past the hour, stakes and all; nothing is lost, so ask again after it";

async function intakeOwed(clone, posts) {
  const b = await engine(clone);
  const have = new Set(posts.map((p) => p.fields.topic));
  const missing = b.listBallots(clone).filter((t) => !have.has(t));
  if (!missing.length) return { missing, staked: [] };
  const staked = new Set(b.ballotState(clone).stakes.map((s) => s.topic));
  return { missing, staked: missing.filter((t) => staked.has(t)) };
}
const notTakenIn = (topic) => refuse(503, `the office has not taken ballot "${topic}" into its record yet`, INTAKE_HINT, { awaiting_intake: [topic] });

// GET /votes — every ballot with its tally
export async function voteList(clone, { env = process.env } = {}) {
  const ballots = await ballotsWithVotes({ env });
  const owed = await intakeOwed(clone, ballots.map((b) => b.post));
  if (owed.staked.length) throw notTakenIn(owed.staked[0]);
  return {
    topics: ballots.map(({ post, votes }) => {
      const full = tallyOf(post, votes);
      return {
        topic: full.topic, status: full.status,
        cap_per_household_per_candidate: full.cap_per_household_per_candidate,
        window: full.window,
        candidates: full.candidates.map((c) => ({ candidate: c.candidate, staked: c.staked })),
      };
    }),
    ...(owed.missing.length ? { awaiting_intake: owed.missing, awaiting_intake_note: INTAKE_HINT } : {}),
    note: "stakes are escrow, not payment — everything returns at close; each ballot is a post in the office's record and each stake its vote, and the ledger holds every stake as a signed line (verify: node tools/stamp-verify.mjs)",
  };
}

// GET /votes/{topic} — full tally; with a key, your household's headroom too
export async function voteView(clone, topic, key, { env = process.env } = {}) {
  const one = await ballotWithVotes(topic, { env });
  if (!one) {
    if (votesAvailable(clone) && (await engine(clone)).listBallots(clone).includes(topic)) throw notTakenIn(topic);
    return null;
  }
  const t = tallyOf(one.post, one.votes);
  if (key && key.handles?.size) {
    const handle = [...key.handles][0];
    const mk = await mintKeyOf(clone, handle, townDay());
    t.your_household = {
      handles: [...key.handles],
      headroom: Object.fromEntries((t.candidates ?? []).map((c) => [c.candidate, headroomOf(one.post, one.votes, c.candidate, mk)])),
    };
  }
  return t;
}

// the doorstep's votes section: open ballots + your household's applied/headroom
export async function doorstepVotes(clone, handle, { env = process.env } = {}) {
  if (!votesAvailable(clone)) return undefined;
  const ballots = await ballotsWithVotes({ env, open: true });
  if (!ballots.length) return undefined;
  const mk = await mintKeyOf(clone, handle, townDay());
  const out = [];
  for (const { post, votes } of ballots) {
    if (post.state === STATE_CLOSED) continue;
    const mine = {};
    for (const c of post.fields.candidates ?? []) {
      mine[c] = {
        household_applied: appliedBy(votes, c, mk),
        headroom: post.state === STATE_STAKING ? headroomOf(post, votes, c, mk) : null,
      };
    }
    out.push({ topic: post.fields.topic, status: post.state, cap: Number(post.fields.cap_per_household_per_candidate), candidates: mine });
  }
  return out.length ? out : undefined;
}

export function townDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(new Date());
}

// POST /votes/stake — the live door. Runs the stake in a subprocess under the
// ferry's flock (linux); direct on platforms without flock (dev/test).
// Returns the clip result or throws { code, defect, hint }.
export async function stakeViaOffice(clone, { from, topic, candidate, stamps }, key) {
  const bounce = (code, defect, hint) => { const e = new Error(defect); Object.assign(e, { code, defect, hint }); return e; };
  if (!from || !topic || !candidate || stamps === undefined)
    throw bounce(422, "incomplete stake", "required: from, topic, candidate, stamps");
  if (!key.handles.has(from))
    throw bounce(403, `"${from}" is not one of your residents`, `this key acts for: ${[...key.handles].join(", ")}`);

  const exec = join(HERE, "stake-exec.mjs");
  const payload = JSON.stringify({ handle: from, topic, candidate, n: stamps, via: "api", date: townDay() });
  const env = { ...process.env, TOWN_CLONE: clone };
  let out;
  try {
    out = await execUnderTownLock(exec, payload, env);
  } catch (e) {
    if (lockTimedOut(e)) throw bounce(LOCK_BUSY.code, LOCK_BUSY.defect, LOCK_BUSY.hint);
    const msg = String(e.stderr ?? e.message ?? e).slice(0, 300);
    throw bounce(500, "the stake pass tripped", msg);
  }
  const result = JSON.parse(out.trim().split("\n").at(-1));
  if (result.error) throw bounce(result.error.code ?? 500, result.error.defect, result.error.hint);
  return result;
}
