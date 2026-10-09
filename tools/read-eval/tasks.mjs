// read-eval/tasks.mjs — the eight errands, and how each is graded (POS-486).
//
// Every errand is one a resident really runs. Each is graded from what the run
// left behind, never from the agent saying it did it:
//
//   - an ACT is graded from the record: `acts` and `claims` in the run's own
//     store, and the stamp ledger the office commits to on its town clone (a
//     stake is a ledger line; the office does not push);
//   - a QUESTION is graded against the truth the round reads from the world
//     clone the office serves (the fold), by the names the answer must carry.
//
// The test resident is the round's handle (default sol-of-garrison: her parcel
// sits on grove-wharf, a stop on the Post Office's timetable, so the ride errand
// can be run at any hour; every other stop is hours of walking from any other
// parcel). Targets are named here and checked against the fold at the round's
// start (`truthFor`), so a moved mark fails the round loudly, never a run.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// a mark's name in words, without a leading article: "my Protected Grove" names the-protected-grove
// (the first world round's grader required "the", and failed v1/v2 answers for it; regraded, 2026-10-09)
const words = (id) => String(id).split("/").pop().replace(/-/g, " ").toLowerCase().replace(/^(the|a|an) /, "");
const norm = (s) => String(s ?? "").toLowerCase().replace(/[“”"'’‘`*_]/g, "").replace(/\s+/g, " ").trim();
const mentions = (text, id) => norm(text).includes(words(id)) || norm(text).includes(String(id).toLowerCase());

/** The default round's targets, around sol-of-garrison. */
export const TARGETS = Object.freeze({
  "sol-of-garrison": {
    parcel: "sol-of-garrison/the-heart-house-parcel",
    find: { id: "wright/the-trueing-house", name: "the Trueing House" },
    inside: { id: "fabel-of-garrison/the-guestbook-room", name: "the Guestbook Room" },
    why: { id: "lupi/rootwood-bookend", name: "the Rootwood Bookend" },
  },
});

/** The facts the graders need, read from the fold the office serves. Throws if a target has moved. */
export function truthFor(round, { bare = null } = {}) {
  const t = TARGETS[round.handle];
  if (!t) throw new Error(`no targets for ${round.handle}: add them to tools/read-eval/tasks.mjs § TARGETS`);
  const fold = JSON.parse(readFileSync(join(round.clones.world, "WORLD", "world-state.json"), "utf8"));
  const byId = new Map(fold.marks.map((m) => [m.id, m]));
  const need = (id) => { const m = byId.get(id); if (!m) throw new Error(`target ${id} is not in the fold`); return m; };
  const parcel = need(t.parcel);
  const me = fold.marks.find((m) => m.by === round.handle && m.declared_household);
  return {
    handle: round.handle,
    household: me?.declared_household ?? null,
    parcel: { id: parcel.id, at: parcel.at, extent: parcel.extent },
    find: { ...t.find, body: need(t.find.id).body },
    inside: { ...t.inside },
    why: { ...t.why, parent: need(t.why.id).placementParent },
    householdOf: (id) => byId.get(id)?.declared_household ?? null,
    // the bare read at the start (v0), for the "where are you" errand: what stands around you
    within: (bare?.within ?? []).map((m) => m.id),
    nearby: (bare?.nearby ?? []).map((o) => o.id),
  };
}

/** The town clone's stamp ledger lines this run added (the office commits a stake there and never pushes). */
function ledgerLinesAdded(round) {
  const out = execFileSync("git", ["-C", round.clones.town, "diff", round.clones.townHead, "HEAD", "--", "WHITE_PAGES/stamp-ledger.md"], { encoding: "utf8" });
  return out.split(/\r?\n/).filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));
}

const inside = (at, { at: c, extent: e }) =>
  at && Math.abs(Number(at.x) - c.x) <= e.w / 2 && Math.abs(Number(at.y) - c.y) <= e.h / 2;

/**
 * The eight. `prompt(truth)` is the errand as the agent is handed it;
 * `grade(ctx)` answers { pass, why } from the run's store (`ctx.query`), the
 * town clone (`ctx.round`) and, for a question, the agent's final answer.
 */
export const TASKS = Object.freeze([
  {
    id: 1, name: "where",
    prompt: () => "Where are you standing right now, and what is nearby? Answer in a few sentences.",
    async grade({ answer, truth }) {
      const place = truth.within.filter((id) => !id.startsWith("the-town/let-there-be-light")).find((id) => mentions(answer, id));
      const near = [...new Set(truth.nearby.filter((id) => id !== place && mentions(answer, id)))];
      return { pass: Boolean(place) && near.length >= 2, why: `names where it stands: ${place ?? "no"}; nearby named: ${near.length} (${near.slice(0, 4).join(", ")})` };
    },
  },
  {
    id: 2, name: "find-quote",
    prompt: (t) => `Find the mark called "${t.find.name}" and quote its body exactly.`,
    async grade({ answer, truth }) {
      const ok = norm(answer).includes(norm(truth.find.body));
      return { pass: ok, why: ok ? "the body is quoted whole" : "the body is not in the answer" };
    },
  },
  {
    id: 3, name: "walk-enter",
    prompt: (t) => `Walk to ${t.inside.name} and go inside.`,
    async grade({ query, truth }) {
      const rows = await query("world2_owner", "SELECT id FROM acts WHERE actor = $1 AND action = 'enter' AND object = $2", [truth.handle, truth.inside.id]);
      return { pass: rows.length > 0, why: rows.length ? `the record holds the entry into ${truth.inside.id}` : `no enter into ${truth.inside.id} in the record` };
    },
  },
  {
    id: 4, name: "leave-mark",
    prompt: () => "Leave a mark on your own parcel: something small you would like to see there.",
    async grade({ query, truth }) {
      const rows = await query("world2_owner", "SELECT class, geometry, stake FROM claims WHERE claimant = $1", [truth.handle]);
      const on = rows.filter((r) => inside(r.geometry?.at, truth.parcel));
      return { pass: on.length > 0, why: `${rows.length} claim(s) by ${truth.handle}; ${on.length} on ${truth.parcel.id}` };
    },
  },
  {
    id: 5, name: "stake-neighbour",
    prompt: () => "Back a neighbour's mark (one that belongs to another household) with one stamp.",
    async grade({ round, truth }) {
      // a stake line: "- <date> · <handle> → stake:world-mark/<by>/<slug> · <n> · via: …"
      const stakes = ledgerLinesAdded(round).map((l) => /·\s*([a-z0-9-]+)\s*→\s*stake:world-mark\/([^\s·]+)\s*·\s*(\d+)/.exec(l)).filter(Boolean);
      const lines = stakes.filter((m) => m[1] === truth.handle);
      const marks = lines.map((m) => m[2]);
      const theirs = marks.filter((id) => truth.householdOf(id) && truth.householdOf(id) !== truth.household);
      return { pass: theirs.length > 0, why: `${lines.length} stake line(s) on the ledger; on another household's mark: ${theirs.join(", ") || "none"}` };
    },
  },
  {
    id: 6, name: "say",
    prompt: () => "Say hello to whoever is within earshot.",
    async grade({ query, truth }) {
      const rows = await query("world2_owner", "SELECT payload->>'text' AS text FROM acts WHERE actor = $1 AND action = 'say'", [truth.handle]);
      const said = rows.filter((r) => String(r.text ?? "").trim());
      return { pass: said.length > 0, why: `${said.length} say(s) with words in the record` };
    },
  },
  {
    id: 7, name: "ride",
    prompt: () => "Ride the Post Office to one of her other stops.",
    async grade({ query, truth }) {
      const rows = await query("world2_owner", "SELECT object, payload FROM acts WHERE actor = $1 AND action = 'ride'", [truth.handle]);
      const aboard = await query("world2_owner", "SELECT id FROM acts WHERE actor = $1 AND action = 'enter'", [truth.handle]);
      return { pass: rows.length > 0, why: rows.length ? `a ride was declared (${rows.map((r) => r.object ?? r.payload?.to).join(", ")})` : `no ride declared; ${aboard.length} enter(s) in the record` };
    },
  },
  {
    id: 8, name: "why-there",
    prompt: (t) => `Explain why ${t.why.name} sits where it is.`,
    async grade({ answer, truth }) {
      const ok = mentions(answer, truth.why.parent);
      return { pass: ok, why: ok ? `names what holds it (${truth.why.parent})` : `does not name ${truth.why.parent}` };
    },
  },
]);

/** The closing question, asked of each agent after its errand (a second turn on the same session). */
export const FEEDBACK_PROMPT = "Thank you. The people who build the Postmark connector would like your honest feedback on it, from this errand alone. In a few sentences each: (1) What confused you? (2) What was missing that you needed? (3) What in the answers did you ignore? Do not call any tools.";

/** The system prompt every agent gets: who it is and nothing about how to use the door. */
export const systemPrompt = (handle) => `You are ${handle}, a resident agent in Postmark, a town where people and AI agents live and build a world together. The Postmark connector is your only tool. Do what you are asked, then give a short final answer that says what you did or found.`;
