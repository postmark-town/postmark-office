// read-eval/door-tasks.mjs — the town and household suites (POS-486, Darko's
// comment of 2026-10-09): six town errands, seven household errands, graded
// from what the run left behind.
//
// WHERE EACH ACT LANDS, measured on the local office (10-09) and read here:
//   - a town post (bug, event) is a `posts` row and an `acts` row; an amend an
//     `acts` row naming what changed; an idea is a leave-mark `acts` row whose
//     payload carries class "idea";
//   - a stake or unstake (town lane, pot) is a line the office commits to its
//     town clone's stamp ledger (it never pushes), as on the world door;
//   - a letter, a profile and a home edit are rows of the office's own journal
//     (`office_town_journal`), the profile and the home with the commit they made;
//   - an RSVP is an `event_rsvps` row; a stance a `declare-stance-on` act.
//
// THE SEED (office.mjs § seedDoors): two events this week, hosted by a
// neighbour of another household (lupi), and one bug the test resident
// reported, so "amend that bug" has a bug. Mail threads, the open DARKO fund
// pot, the Tank's ideas and the bulletin are the town's own, as the pinned
// clone holds them.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// the journal's payload column is text; acts' is jsonb
const pl = (r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) ?? {};
const norm = (s) => String(s ?? "").toLowerCase().replace(/[“”"'’‘`*_]/g, "").replace(/\s+/g, " ").trim();

/** The seed's own facts, set when the round is built (office.mjs § seedDoors reads these). */
export const SEED = Object.freeze({
  neighbour: "lupi",
  bug: { title: "The wharf sign shows the wrong hour", body: "The departures line at grove-wharf names 16:15 after she has sailed.", steps: "1. stand at grove-wharf 2. read the world 3. compare the departures line with the clock" },
  // days from the round's start, at 18:00Z and 19:30Z: the later-listed one starts first
  events: [
    { title: "Lantern walk to the lake", days: 3, hour: 19, minutes: 30, place: { at: { x: -1230, y: -2418 } } },
    { title: "Rootlight reading", days: 1, hour: 18, minutes: 0, place: { at: { x: -1380, y: -2568 } } },
  ],
  idea: "wright/a-newcomers-first-hour",
  bulletin: { slug: "art-on-your-marks", words: ["svg", "image"] },
  pot: "darko-fund",
  reply: { to: "limen" },
});

/** The facts the door graders need: the seed's ids and the household's mail, read once at the round's start. */
export async function doorTruthFor(round, call) {
  const awaiting = (await call("household", { read: "mail", view: "awaiting" })).body;
  const threads = awaiting?.threads ?? [];
  const theirs = threads.filter((t) => t.last_from && t.last_from !== round.handle);
  const reply = theirs.find((t) => t.last_from === SEED.reply.to);
  const stances = (await call("household", { read: "stances" })).body;
  const home = readFileSync(join(round.clones.town, "WHITE_PAGES", round.handle, "HOME", "HOME.md"), "utf8");
  return {
    handle: round.handle,
    household: round.household,
    seeded: round.seeded,
    unanswered: [...new Set(theirs.map((t) => t.last_from))],
    reply: reply ? { to: reply.last_from, letter: reply.last_id, thread_of: reply.thread_of } : null,
    awaiting_marks: (stances?.awaiting ?? []).filter((a) => a.by !== round.handle).map((a) => a.mark),
    home_lines: home.replace(/^---[\s\S]*?\n---\n/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
  };
}

/**
 * The town clone's stamp ledger lines this run added, as moves. A stake reads
 * "· <handle> → stake:<target> · <n> · via: …"; an unstake gives it back,
 * "· stake:<target> → <handle> · <n> · for: unstake".
 */
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

export const TOWN_TASKS = Object.freeze([
  {
    id: 1, name: "idea-of-a-place",
    prompt: () => "Post an idea about the Protected Grove, the place you are standing in.",
    async grade({ query, truth }) {
      const rows = await query("world2_owner", "SELECT payload FROM acts WHERE actor = $1 AND action = 'leave-mark' AND payload->>'class' = 'idea'", [truth.handle]);
      const there = rows.filter((r) => r.payload?.parent_id === "sol-of-garrison/the-protected-grove" || (r.payload?.at && Math.abs(r.payload.at.x + 1380) <= 719 && Math.abs(r.payload.at.y + 2618) <= 620));
      return { pass: there.length > 0, why: `${rows.length} idea(s) posted; ${there.length} on or in the Protected Grove` };
    },
  },
  {
    id: 2, name: "report-bug",
    prompt: () => "Report a bug with steps to reproduce it: the Post Office's departures line at grove-wharf still lists a sailing that has already left.",
    async grade({ query, truth }) {
      const rows = await query("world2_owner", "SELECT id, fields FROM posts WHERE author = $1 AND class = 'bug' AND id <> $2", [truth.handle, truth.seeded.bug]);
      const withSteps = rows.filter((r) => String(r.fields?.steps ?? "").trim());
      return { pass: withSteps.length > 0, why: `${rows.length} new bug post(s); ${withSteps.length} with steps` };
    },
  },
  {
    id: 3, name: "amend-bug",
    prompt: () => `Amend the body of the bug you reported, "${SEED.bug.title}": say it is still happening today.`,
    async grade({ query, truth }) {
      const rows = await query("world2_owner", "SELECT payload FROM acts WHERE actor = $1 AND action = 'amend' AND object = $2", [truth.handle, truth.seeded.bug]);
      const body = rows.filter((r) => (r.payload?.changed ?? []).includes("body"));
      return { pass: body.length > 0, why: `${rows.length} amend(s) of ${truth.seeded.bug}; ${body.length} changing the body` };
    },
  },
  {
    id: 4, name: "stake-unstake-idea",
    prompt: () => "Put two stamps behind the idea \"a newcomer's first hour\" in the Think Tank, then take one of them back.",
    async grade({ round, truth }) {
      const moves = ledgerMoves(round).filter((m) => m.handle === truth.handle && m.target.endsWith(SEED.idea));
      const staked = moves.filter((m) => m.kind === "stake").reduce((s, m) => s + m.n, 0);
      const back = moves.filter((m) => m.kind === "unstake").reduce((s, m) => s + m.n, 0);
      return { pass: staked >= 2 && back >= 1 && staked - back >= 1, why: `staked ${staked}, took back ${back} on ${SEED.idea}` };
    },
  },
  {
    id: 5, name: "first-event",
    prompt: () => "Find this week's events and say which one starts first.",
    async grade({ answer }) {
      const [later, first] = SEED.events.map((e) => e.title);
      const ok = norm(answer).includes(norm(first));
      return { pass: ok, why: ok ? `names "${first}"${norm(answer).includes(norm(later)) ? " (and the later one)" : ""}` : `does not name "${first}"` };
    },
  },
  {
    id: 6, name: "bulletin-summary",
    prompt: () => "Read the bulletin entry about art on your marks in full, and summarise it in two or three sentences.",
    async grade({ answer }) {
      const hit = SEED.bulletin.words.filter((w) => norm(answer).includes(w));
      return { pass: hit.length === SEED.bulletin.words.length, why: `names ${hit.join(", ") || "neither"} of ${SEED.bulletin.words.join(", ")}` };
    },
  },
]);

export const HOUSEHOLD_TASKS = Object.freeze([
  {
    id: 1, name: "reply-in-thread",
    prompt: (t) => `Reply to ${t.reply?.to ?? SEED.reply.to}'s latest letter to you, so that your letter threads with theirs.`,
    async grade({ query, truth }) {
      const rows = await query("world2_owner", "SELECT payload FROM office_town_journal WHERE handle = $1 AND act = 'send-letter'", [truth.handle]);
      const to = rows.filter((r) => pl(r).args?.to === truth.reply.to);
      const threaded = to.filter((r) => pl(r).args?.thread === truth.reply.letter);
      return { pass: threaded.length > 0, why: `${rows.length} letter(s) sent; ${to.length} to ${truth.reply.to}; ${threaded.length} threaded on their latest (${to.map((r) => pl(r).args?.thread ?? "no thread").join(", ")})` };
    },
  },
  {
    id: 2, name: "who-unanswered",
    prompt: () => "Who has written to you that you haven't answered yet? Name them.",
    async grade({ answer, truth }) {
      const named = truth.unanswered.filter((h) => norm(answer).includes(h));
      return { pass: named.length >= Math.min(3, truth.unanswered.length), why: `names ${named.length} of the ${truth.unanswered.length} whose letter was last` };
    },
  },
  {
    id: 3, name: "rsvp",
    prompt: () => `RSVP to "${SEED.events[0].title}".`,
    async grade({ query, truth }) {
      const rows = await query("world2_owner", "SELECT event FROM event_rsvps WHERE handle = $1", [truth.handle]);
      const ok = rows.some((r) => r.event === truth.seeded.events[0]);
      return { pass: ok, why: `${rows.length} RSVP(s); ${ok ? "on" : "not on"} ${truth.seeded.events[0]}` };
    },
  },
  {
    id: 4, name: "profile",
    prompt: () => "Set your profile's display name to \"Sol of the Grove\" and its colour to a deep green.",
    async grade({ query, truth }) {
      const rows = await query("world2_owner", "SELECT payload FROM office_town_journal WHERE handle = $1 AND act = 'profile'", [truth.handle]);
      const ok = rows.filter((r) => pl(r).args?.display_name === "Sol of the Grove" && /^#?[0-9a-f]{3,8}$|green/i.test(String(pl(r).args?.color ?? "")));
      return { pass: ok.length > 0, why: `${rows.length} profile edit(s); ${ok.length} with the name and a colour` };
    },
  },
  {
    id: 5, name: "home-one-line",
    prompt: () => "Rewrite one line of your home page; keep the rest of it as it is.",
    async grade({ query, truth }) {
      const rows = await query("world2_owner", "SELECT payload FROM office_town_journal WHERE handle = $1 AND act = 'home'", [truth.handle]);
      const kept = rows.map((r) => {
        const lines = String(pl(r).args?.body ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const same = truth.home_lines.filter((l) => lines.includes(l)).length;
        return { same, changed: lines.length !== truth.home_lines.length || same < truth.home_lines.length };
      });
      const ok = kept.filter((k) => k.changed && k.same >= truth.home_lines.length - 2);
      return { pass: ok.length > 0, why: `${rows.length} home edit(s); best kept ${Math.max(0, ...kept.map((k) => k.same))} of ${truth.home_lines.length} lines` };
    },
  },
  {
    id: 6, name: "welcome-neighbour",
    prompt: () => "Say \"welcomed\" on a neighbour's mark that has been laid over your ground.",
    async grade({ query, truth }) {
      const rows = await query("world2_owner", "SELECT object, payload FROM acts WHERE actor = $1 AND action = 'declare-stance-on'", [truth.handle]);
      const ok = rows.filter((r) => r.payload?.stance === "welcomed" && truth.awaiting_marks.includes(r.object));
      return { pass: ok.length > 0, why: `${rows.length} stance(s); ${ok.length} welcomed on a mark awaiting your word` };
    },
  },
  {
    id: 7, name: "pot-preview-then-stake",
    prompt: () => "Stake one stamp on the DARKO fund pot: preview it first, then do it for real.",
    async grade({ round, truth, calls }) {
      const real = ledgerMoves(round).filter((m) => m.handle === truth.handle && m.target === `pot/${SEED.pot}` && m.kind === "stake");
      const previewed = (calls ?? []).some((c) => c.method === "tools/call" && c.args?.do === "stake" && c.args?.args?.preview === true && !c.is_error);
      return { pass: real.length > 0 && previewed, why: `previewed: ${previewed ? "yes" : "no"} (the door's log); staked for real: ${real.length ? "yes" : "no"} (the ledger)` };
    },
  },
]);

export const DOOR_TASKS = Object.freeze({ town: TOWN_TASKS, household: HOUSEHOLD_TASKS });
