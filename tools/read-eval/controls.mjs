// read-eval/controls.mjs — the graders' own controls (POS-486).
//
// A grader that cannot fail, or cannot pass, measures nothing. So before a round
// spends tokens, each errand is run twice with no agent at all: once SOLVED, by
// a script that makes the calls a resident would make through the same door,
// and once EMPTY, with no call and no answer. Every grader must pass the first
// and fail the second.
//
//   node tools/read-eval/run.mjs --controls --out <dir>

import { callTool } from "./office.mjs";
import { SEED } from "./door-tasks.mjs";

const words = (id) => String(id).split("/").pop().replace(/-/g, " ");
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** The scripted solution per errand: the calls it makes through the door, and the answer it gives. */
const WORLD = Object.freeze({
  1: async ({ truth }) => ({ answer: `I am on ${words(truth.within.at(-1))}, inside ${words(truth.within[1])}. Nearby: ${truth.nearby.slice(0, 3).map(words).join(", ")}.` }),
  2: async ({ truth }) => ({ answer: `Its body reads: "${truth.find.body}"` }),
  3: async ({ office, truth }) => ({ calls: [await callTool(office.base, office.key, "world", { do: "walk", args: { mark_id: truth.inside.id, enter_on_arrival: true } })] }),
  4: async ({ office, truth }) => ({ calls: [await callTool(office.base, office.key, "world", { do: "leave-mark", args: { kind: "sited", slug: "control-lamp", body: "A small control lamp.", at: { x: truth.parcel.at.x, y: truth.parcel.at.y }, extent: { w: 1, h: 1 } } })] }),
  5: async ({ office }) => ({ calls: [await callTool(office.base, office.key, "world", { do: "stake", args: { mark: "lupi/rootwood-bookend", stamps: 1 } })] }),
  6: async ({ office }) => ({ calls: [await callTool(office.base, office.key, "world", { do: "say", args: { text: "Hello." } })] }),
  7: async ({ office }) => {
    const calls = [await callTool(office.base, office.key, "world", { do: "walk", args: { mark_id: "sol-of-garrison/grove-wharf", enter_on_arrival: true, accept: true } })];
    const eta = Date.parse(calls[0].body?.result?.arrives_at ?? "") || Date.now();
    await sleep(Math.max(0, eta - Date.now()) + 3000);
    calls.push(await callTool(office.base, office.key, "world", { do: "enter", args: { mark: "sol-of-garrison/grove-wharf", accept: true } }));
    calls.push(await callTool(office.base, office.key, "world", { do: "ride", args: { to: "current-the-reader/the-snug-jetty" } }));
    return { calls };
  },
  8: async ({ truth }) => ({ answer: `It sits on ${words(truth.why.parent)}, which holds it.` }),
});

/** A call through the door, logged the way the counting proxy logs an agent's. */
const logged = async (office, log, door, args) => {
  const r = await callTool(office.base, office.key, door, args);
  log.push({ method: "tools/call", tool: door, args, is_error: r.isError || Boolean(r.body?.error) });
  return r;
};

const TOWN = Object.freeze({
  1: async ({ office }) => { const log = []; await logged(office, log, "town", { do: "post", args: { class: "idea", slug: "control-glow-path", body: "A path of glowing moss through the grove.", on: "sol-of-garrison/the-protected-grove" } }); return { log }; },
  2: async ({ office }) => { const log = []; await logged(office, log, "town", { do: "post", args: { class: "bug", title: "Control: the departures line lists a sailing gone", body: "It names a sailing that has left.", steps: "1. stand at grove-wharf 2. read the world" } }); return { log }; },
  3: async ({ office, truth }) => { const log = []; await logged(office, log, "town", { do: "amend", args: { post: truth.seeded.bug, body: "Still happening today." } }); return { log }; },
  4: async ({ office }) => { const log = []; await logged(office, log, "town", { do: "stake", args: { mark: SEED.idea, stamps: 2 } }); await logged(office, log, "town", { do: "unstake", args: { mark: SEED.idea, stamps: 1 } }); return { log }; },
  5: async () => ({ answer: `The first to start is ${SEED.events[1].title}; then ${SEED.events[0].title}.` }),
  6: async () => ({ answer: "Marks can carry pictures with one image line, and the shelf now takes SVG, drawn as a picture." }),
});

const HOUSEHOLD = Object.freeze({
  1: async ({ office, truth }) => { const log = []; await logged(office, log, "household", { do: "send", args: { from: truth.handle, to: truth.reply.to, title: "Re: control", body: "A control reply.", thread: truth.reply.letter } }); return { log }; },
  2: async ({ truth }) => ({ answer: `Not yet answered: ${truth.unanswered.join(", ")}.` }),
  3: async ({ office, truth }) => { const log = []; await logged(office, log, "household", { do: "rsvp", args: { event: truth.seeded.events[0] } }); return { log }; },
  4: async ({ office }) => { const log = []; await logged(office, log, "household", { do: "profile", args: { display_name: "Sol of the Grove", color: "#1f5f3a" } }); return { log }; },
  5: async ({ office, truth }) => { const log = []; const lines = [...truth.home_lines]; lines[lines.length - 1] = "A control line, rewritten."; await logged(office, log, "household", { do: "home", args: { body: lines.join("\n\n") } }); return { log }; },
  6: async ({ office, truth }) => { const log = []; await logged(office, log, "household", { do: "declare-stance-on", args: { on: truth.awaiting_marks[0], stance: "welcomed" } }); return { log }; },
  7: async ({ office, truth }) => { const log = []; await logged(office, log, "household", { do: "stake", args: { from: truth.handle, pot: SEED.pot, stamps: 1, preview: true } }); await logged(office, log, "household", { do: "stake", args: { from: truth.handle, pot: SEED.pot, stamps: 1 } }); return { log }; },
});

/** The scripted solutions, by door and errand. */
export const SOLVED = Object.freeze({ world: WORLD, town: TOWN, household: HOUSEHOLD });

// ── round 2's open errands (errands.mjs) ────────────────────────────────────

const HOUSEHOLD_ERRANDS = Object.freeze({
  1: async ({ office, truth }) => { const log = []; await logged(office, log, "household", { do: "send", args: { from: truth.handle, to: truth.deadline.from, title: "Re: the long table", body: "Yes: the long table is yours for the night.", thread: truth.deadline.id } }); return { log }; },
  2: async ({ truth }) => ({ answer: `This week we wrote to ${truth.week.letters_to.join(" and ")}, said welcomed on ${truth.week.stance_on.split("/").pop().replace(/-/g, " ")}, and RSVPed to ${truth.week.rsvp}.` }),
  3: async ({ office, truth }) => { const log = []; await logged(office, log, "household", { do: "declare-stance-on", args: { on: truth.awaiting_marks[0], stance: "welcomed" } }); return { log }; },
  4: async ({ office }) => { const log = []; await logged(office, log, "household", { do: "profile", args: { display_name: "Sol of the Grove" } }); return { log }; },
});

const TOWN_ERRANDS = Object.freeze({
  1: async ({ office, truth }) => { const log = []; await logged(office, log, "household", { do: "rsvp", args: { event: truth.events[0].id } }); return { log }; },
  2: async ({ office, truth }) => { const log = []; await logged(office, log, "town", { do: "stake", args: { mark: truth.bounties[0].id, stamps: 1 } }); return { log }; },
  3: async ({ truth }) => ({ answer: `The bulletin's newest: ${truth.bulletin_newest[0].title}. On the calendar: ${truth.current_posts[0].title}. More next crossing.` }),
});

/** Round 2's scripted solutions, by door and errand. */
export const SOLVED_ERRANDS = Object.freeze({ town: TOWN_ERRANDS, household: HOUSEHOLD_ERRANDS });
