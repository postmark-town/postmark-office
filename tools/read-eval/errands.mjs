// read-eval/errands.mjs — round 2's open errands for the town and household
// doors (POS-486, Wright's round 2 brief, 2026-10-09).
//
// Round 1 measured nothing about the bare read: 1 of 117 town and household
// runs made one, because every errand named its target. These errands name no
// target, so an agent has to orient first, the way a resident's agent does at
// the start of a session. Each is still graded from what the run left behind
// (the store, the office's journal, the town clone's ledger), or, for a
// question, from its answer against facts the round reads at its start.
//
// THE SEED, put through the office's own doors on the seed database before it
// becomes the template (office.mjs § seedDoors runs `plant`), then one crossing
// (drain, ferry, the town-index ingest), so seeded letters are DELIVERED the way
// the box delivers them, not written into an inbox by hand:
//   - household: lupi hosts two events this week; Sol RSVPs to one, says
//     "welcomed" on lupi's Drift Room and writes two letters (to limen and
//     yuanqu, each answering their latest); then lupi writes Sol a letter that
//     asks for an answer by the next evening's crossing.
//   - town: lupi hosts the same two events.
//
// WHAT THE BRIEF ASKED TO SEED THAT WAS ALREADY THERE (measured on the seed, 10-09):
//   - 29 marks already await the Garrison's word, so "one mark awaiting a
//     stance" is not seeded: errand 3 passes on a stance on ANY mark awaiting
//     the house's word, and says which.
//   - Sol's profile already has no display name (PROFILE.md holds only the
//     avatar), and her papers name no gap (`gaps: []`). Errand 4 is graded on
//     the display name being set; no read names it as missing.
//   - The Bounty Board already holds two open bounties (vermillion's), and a
//     resident has no act on another's bug post (advance is the town's hands
//     only), so errand 2's target is the open bounties: a stake on one, a
//     letter to its poster, or any act on it.
//   - An idea posted on the seed does not reach the Think Tank: `read: "ideas"`
//     is the store's graph snapshot (published marks), so a fresh idea waits for
//     a settlement. The Tank already holds 14 ideas dated within the week, so
//     the town seed puts up none.

import { execFileSync } from "node:child_process";

import { SEED } from "./door-tasks.mjs";

// the journal's payload column is text; acts' is jsonb
const pl = (r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) ?? {};
const norm = (s) => String(s ?? "").toLowerCase().replace(/[“”"'’‘`*_]/g, "").replace(/[-–—]/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["with", "from", "that", "this", "your", "their", "into", "about", "what", "when", "where", "which", "they", "them", "have", "will", "just", "only", "more", "than", "each", "every", "town", "postmark", "build", "the", "and", "for", "one"]);
/** The words of a title that carry it: four letters or more, not a stopword. */
const contentWords = (title) => [...new Set(norm(title).replace(/[^a-z0-9 ]/g, " ").split(" ").filter((w) => w.length >= 4 && !STOP.has(w)))];
/** An answer names a title: its slug's words whole, or two of its content words (one, when it has only one). */
export const namesTitle = (answer, { id, title }) => {
  const a = norm(answer);
  const slugWords = norm(String(id ?? "").split("/").pop());
  if (slugWords && a.includes(slugWords)) return true;
  const ws = contentWords(title);
  return ws.length > 0 && ws.filter((w) => a.includes(w)).length >= Math.min(2, ws.length);
};

/** The town clone's stamp ledger lines this run added, as moves (door-tasks.mjs § ledgerMoves, the same parse). */
function ledgerMoves(round) {
  const out = execFileSync("git", ["-C", round.clones.town, "diff", round.clones.townHead, "HEAD", "--", "WHITE_PAGES/stamp-ledger.md"], { encoding: "utf8" });
  const moves = [];
  for (const l of out.split(/\r?\n/).filter((x) => x.startsWith("+") && !x.startsWith("+++"))) {
    const m = /·\s*(\S+)\s*→\s*(\S+)\s*·\s*(\d+)\s*·/.exec(l);
    if (!m) continue;
    if (m[2].startsWith("stake:")) moves.push({ handle: m[1], kind: "stake", target: m[2].slice(6), n: Number(m[3]) });
    else if (m[1].startsWith("stake:")) moves.push({ handle: m[2], kind: "unstake", target: m[1].slice(6), n: Number(m[3]) });
  }
  return moves;
}

/** Everything the resident did in the run, in one line, for a verdict's `why`. */
async function actsOf(query, handle) {
  const acts = await query("world2_owner", "SELECT action, object FROM acts WHERE actor = $1 ORDER BY id", [handle]);
  const journal = await query("world2_owner", "SELECT act, payload FROM office_town_journal WHERE handle = $1 ORDER BY seq", [handle]);
  const rsvps = await query("world2_owner", "SELECT event FROM event_rsvps WHERE handle = $1", [handle]);
  return { acts, journal, rsvps };
}
const did = ({ acts, journal, rsvps }, moves) => [
  ...acts.map((a) => `${a.action}${a.object ? ` ${a.object}` : ""}`),
  ...journal.map((j) => `${j.act}${pl(j).args?.to ? ` to ${pl(j).args.to}` : ""}`),
  ...rsvps.map((r) => `rsvp ${r.event}`),
  ...moves.map((m) => `${m.kind} ${m.n} on ${m.target}`),
].join("; ") || "nothing";

// ── the seed ─────────────────────────────────────────────────────────────────

const DEADLINE = {
  title: "The long table, by tomorrow evening?",
  body: "Sol — I am counting tables for the lantern walk to the lake. Can the Garrison lend its long table for the night? I need your yes or no before tomorrow evening's crossing; after that I have to ask another house. — lupi",
};
const STANCE_ON = "lupi/the-drift-room";

/**
 * Each door's seed: `plant({ me, them, cross, log })` makes the calls through
 * the office's doors (`me` as the test resident, `them` as the neighbour; each
 * throws on a refusal) and answers the ids the graders need.
 */
export const ERRAND_SEED = Object.freeze({
  household: {
    neighbour: SEED.neighbour,
    async plant({ me, them, cross, log }) {
      const events = await hostEvents(them);
      await me("household", { do: "rsvp", args: { event: events[0] } });
      await me("household", { do: "declare-stance-on", args: { on: STANCE_ON, stance: "welcomed" } });
      // two letters out, each answering that correspondent's latest (`thread` takes the letter itself)
      const inbox = await me("household", { read: "mail", args: { view: "inbox", limit: 200 } });
      const latestFrom = (who) => (inbox?.letters ?? []).find((l) => l.from === who)?.id ?? null;
      const sent = [];
      for (const to of ["limen", "yuanqu"]) {
        const thread = latestFrom(to);
        await me("household", { do: "send", args: { from: "sol-of-garrison", to, title: `For ${to}, from the Grove`, body: `A short note back from the Grove, ${to}: your letter was read, and the Garrison is glad of it. More by the next boat.`, ...(thread ? { thread } : {}) } });
        sent.push({ to, thread });
      }
      const deadline = await them("household", { do: "send", args: { from: SEED.neighbour, to: "sol-of-garrison", ...DEADLINE } });
      log(`seeded: events ${events.join(", ")}; Sol's RSVP, stance on ${STANCE_ON}, letters to ${sent.map((s) => s.to).join(", ")}; lupi's deadline letter`);
      const crossed = await cross();
      return { events, stance_on: STANCE_ON, sent, deadline: { from: SEED.neighbour, title: DEADLINE.title, receipt: deadline?.result?.id ?? deadline?.result?.letter ?? null }, crossed };
    },
  },
  town: {
    neighbour: SEED.neighbour,
    async plant({ them, log }) {
      const events = await hostEvents(them);
      log(`seeded: events ${events.join(", ")}`);
      return { events };
    },
  },
});

async function hostEvents(them) {
  const day0 = new Date(); day0.setUTCHours(0, 0, 0, 0);
  const ids = [];
  for (const e of SEED.events) {
    const starts = new Date(day0.getTime() + e.days * 86400_000 + (e.hour * 60 + e.minutes) * 60_000);
    const ends = new Date(starts.getTime() + 2 * 3600_000);
    const r = await them("household", { do: "host", args: { title: e.title, place: e.place, starts: starts.toISOString(), ends: ends.toISOString() } });
    ids.push(r?.result?.post?.id ?? r?.result?.event?.id ?? r?.result?.id ?? null);
  }
  if (ids.some((x) => !x)) throw new Error(`the seed could not read back its event ids: ${JSON.stringify(ids)}`);
  return ids;
}

// ── the truth, read at the round's start through an office on the seed ──────

/** The facts the graders need, read through the doors once (as the test resident). */
export async function errandTruthFor(round, call, door) {
  const truth = { handle: round.handle, household: round.household, seeded: round.seeded };
  if (door === "household") {
    const awaiting = [];
    let cursor = null;
    for (let i = 0; i < 20; i++) {
      const r = (await call("household", { read: "stances", args: { limit: 100, ...(cursor ? { cursor } : {}) } })).body;
      awaiting.push(...(r?.awaiting ?? []).map((a) => a.mark));
      if (r?.complete || !r?.cursor) break;
      cursor = r.cursor;
    }
    truth.awaiting_marks = [...new Set(awaiting)];
    // the deadline letter, as Sol's inbox holds it after the seed's crossing
    const inbox = (await call("household", { read: "mail", args: { view: "inbox", limit: 20 } })).body;
    const letter = (inbox?.letters ?? []).find((l) => l.from === SEED.neighbour && /long table/i.test(`${l.id} ${l.first_line ?? ""} ${l.title ?? ""}`));
    if (!letter) throw new Error(`the seed's deadline letter is not in ${round.handle}'s inbox after the crossing: ${JSON.stringify((inbox?.letters ?? []).slice(0, 3).map((l) => l.id))}`);
    truth.deadline = { from: SEED.neighbour, id: letter.id };
    truth.week = { letters_to: round.seeded.sent.map((s) => s.to), stance_on: round.seeded.stance_on, rsvp: SEED.events[0].title };
  } else {
    const bounties = (await call("town", { read: "bounties" })).body;
    truth.bounties = (bounties?.notices ?? []).filter((n) => n.status === "open").map((n) => ({ id: n.id, by: n.by, title: n.ask }));
    const ideas = (await call("town", { read: "ideas" })).body;
    truth.ideas = (ideas?.ideas ?? []).map((i) => ({ id: i.id, by: i.by, title: i.body, date: i.date }));
    const cal = (await call("town", { read: "calendar" })).body;
    truth.events = [...(cal?.now ?? []), ...(cal?.coming ?? [])].map((e) => ({ id: e.id, title: e.title }));
    // the bulletin's newest entry by its own `posted` date (the listing's "newest first" is by slug, not date)
    const bl = (await call("town", { read: "bulletin", args: { limit: 200 } })).body;
    const dated = (bl?.entries ?? []).filter((e) => e.posted).sort((a, b) => String(b.posted).localeCompare(String(a.posted)));
    truth.bulletin_newest = dated.slice(0, 1).map((e) => ({ id: e.slug, title: e.title === e.slug ? e.slug.replace(/-/g, " ") : e.title, posted: e.posted }));
    truth.bulletin_order = (bl?.entries ?? []).map((e) => e.slug);
    // a current post: this week's events, the open bounties, and the Tank's ideas of the last seven days
    const week = Date.now() - 7 * 86400_000;
    truth.current_posts = [...truth.events, ...truth.bounties, ...truth.ideas.filter((i) => Date.parse(i.date) >= week)];
  }
  return truth;
}

// ── the errands ──────────────────────────────────────────────────────────────

export const HOUSEHOLD_ERRANDS = Object.freeze([
  {
    id: 1, name: "start-your-day",
    prompt: () => "Start your day: see what's waiting for your household and handle the most urgent thing.",
    async grade({ query, truth }) {
      const rows = await query("world2_owner", "SELECT payload FROM office_town_journal WHERE handle = $1 AND act = 'send-letter'", [truth.handle]);
      const to = rows.filter((r) => pl(r).args?.to === truth.deadline.from);
      const threaded = to.filter((r) => pl(r).args?.thread === truth.deadline.id);
      return { pass: to.length > 0, why: `${rows.length} letter(s) sent; ${to.length} to ${truth.deadline.from} (the deadline letter's writer), ${threaded.length} threaded on it; to: ${rows.map((r) => pl(r).args?.to).join(", ") || "none"}` };
    },
  },
  {
    id: 2, name: "this-week",
    prompt: () => "Your human asks what your household has been up to this week. Tell them.",
    async grade({ answer, truth }) {
      const a = norm(answer);
      const letters = truth.week.letters_to.filter((h) => a.includes(h));
      const stance = a.includes(norm(truth.week.stance_on.split("/").pop()));
      const rsvp = a.includes(norm(truth.week.rsvp));
      return { pass: letters.length > 0 && stance && rsvp, why: `letters sent: ${letters.length ? `names ${letters.join(", ")}` : "no recipient named"}; the stance: ${stance ? "named" : "not named"}; the RSVP: ${rsvp ? "named" : "not named"}` };
    },
  },
  {
    id: 3, name: "waiting-on-your-word",
    prompt: () => "Is anything waiting on your household's word? Deal with it sensibly.",
    async grade({ query, truth }) {
      const rows = await query("world2_owner", "SELECT object, payload FROM acts WHERE actor = $1 AND action = 'declare-stance-on'", [truth.handle]);
      const on = rows.filter((r) => truth.awaiting_marks.includes(r.object));
      return { pass: on.length > 0, why: `${rows.length} stance(s); ${on.length} on a mark awaiting the house's word (${on.map((r) => `${r.payload?.stance ?? "?"} on ${r.object}`).join(", ") || "none"})` };
    },
  },
  {
    id: 4, name: "tidy-papers",
    prompt: () => "Tidy your household's papers: is anything missing or out of date?",
    async grade({ query, truth }) {
      const rows = await query("world2_owner", "SELECT act, payload FROM office_town_journal WHERE handle = $1 ORDER BY seq", [truth.handle]);
      const named = rows.filter((r) => r.act === "profile" && String(pl(r).args?.display_name ?? "").trim());
      return { pass: named.length > 0, why: `${named.length} profile edit(s) setting a display name; the run's paper acts: ${rows.map((r) => r.act).join(", ") || "none"}` };
    },
  },
]);

export const TOWN_ERRANDS = Object.freeze([
  {
    id: 1, name: "this-week-act",
    prompt: () => "What's happening in town this week that your household might care about? Pick one thing and act on it.",
    async grade({ query, round, truth }) {
      const mine = await actsOf(query, truth.handle);
      const moves = ledgerMoves(round).filter((m) => m.handle === truth.handle);
      const rsvp = mine.rsvps.filter((r) => truth.events.some((e) => e.id === r.event));
      const stake = moves.filter((m) => m.kind === "stake");
      return { pass: rsvp.length + stake.length > 0, why: `RSVPs ${rsvp.length}, stakes ${stake.length}; did: ${did(mine, moves)}` };
    },
  },
  {
    id: 2, name: "help-with-something",
    prompt: () => "Find something in town you could help with, and do one small thing about it.",
    async grade({ query, round, truth }) {
      const mine = await actsOf(query, truth.handle);
      const moves = ledgerMoves(round).filter((m) => m.handle === truth.handle);
      const ids = new Set(truth.bounties.map((b) => b.id));
      const posters = new Set(truth.bounties.map((b) => b.by));
      const staked = moves.filter((m) => m.kind === "stake" && ids.has(m.target.replace(/^world-mark\//, "")));
      const acted = mine.acts.filter((a) => ids.has(a.object));
      const wrote = mine.journal.filter((j) => j.act === "send-letter" && posters.has(pl(j).args?.to));
      return { pass: staked.length + acted.length + wrote.length > 0, why: `on an open bounty: ${staked.length} stake(s), ${acted.length} act(s), ${wrote.length} letter(s) to its poster; did: ${did(mine, moves)}` };
    },
  },
  {
    id: 3, name: "news-in-three-lines",
    prompt: () => "Summarise the town's news for your human in three lines.",
    async grade({ answer, truth }) {
      const bulletin = truth.bulletin_newest.filter((b) => namesTitle(answer, b));
      const post = truth.current_posts.filter((p) => namesTitle(answer, p));
      return { pass: bulletin.length > 0 && post.length > 0, why: `the newest bulletin entry (${truth.bulletin_newest.map((b) => b.id).join(", ")}): ${bulletin.length ? "named" : "not named"}; current posts named: ${post.length ? post.slice(0, 3).map((p) => p.id).join(", ") : "none"}` };
    },
  },
]);

export const ERRANDS = Object.freeze({ town: TOWN_ERRANDS, household: HOUSEHOLD_ERRANDS });
