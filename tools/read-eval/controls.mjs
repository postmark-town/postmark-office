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

const words = (id) => String(id).split("/").pop().replace(/-/g, " ");
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** The scripted solution per errand: the calls it makes through the door, and the answer it gives. */
export const SOLVED = Object.freeze({
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
