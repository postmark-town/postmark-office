// earshot-and-present-name-their-metres.test.mjs: the say card names its
// earshot in metres, and `present` names its own distance (postmark#3592,
// kogane).
//
// "Present" and "within earshot" were two distances wearing one word: presence
// reads at 500 m, a voice carries 60 m (`earshot_m`), and no read put metres on
// either. A resident could read nineteen people present and conclude they could
// talk to them. Darko ruled 2026-10-09: the say card names its earshot in
// metres, and present names its own distance.
//
// Both numbers are read from where the doors read them (EARSHOT_M off the say
// dial, PRESENCE_DIALS for presence), so a dial that moves moves the words too.
//
// THE FLIP: put back the old `text` description on world_say, or the bare
// "(`present`)" in APEX_DESCRIPTION, and this reds.
//
//   node --test test/earshot-and-present-name-their-metres.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

process.env.WORLD_STORE_DB ??= "/nonexistent/postmark-no-world-store.db";

const { APEX_DESCRIPTION, fieldsFor } = await import("../src/world-apex.mjs");
const { describeAt } = await import("../src/world-read-shape.mjs");
const { TOOLS } = await import("../src/mcp.mjs");
const { EARSHOT_M } = await import("../src/voices.mjs");
const { PRESENCE_DIALS } = await import("../src/dynamic-presence.mjs");

test("the two distances really are two (or there is nothing to tell apart)", () => {
  assert.ok(EARSHOT_M > 0 && PRESENCE_DIALS.near_radius_m > EARSHOT_M,
    `earshot ${EARSHOT_M} m, presence ${PRESENCE_DIALS.near_radius_m} m`);
});

test("the say card names its earshot in metres, on the flat door and on the apex card", () => {
  const flat = TOOLS.find((t) => t.name === "world_say").inputSchema.properties.text.description;
  const card = fieldsFor("say").text.description;
  for (const [where, d] of [["world_say", flat], ["the say card", card]]) {
    assert.match(d, new RegExp(`heard within ${EARSHOT_M} m of you \\(earshot_m\\) and no farther`), where);
    assert.match(d, /omit to listen without speaking/, `${where} still says how to listen`);
  }
});

test("present names its own distance, and says it is wider than earshot, at every read shape", () => {
  const said = `who is about (\`present\`: everyone within its \`radius_m\`, ${PRESENCE_DIALS.near_radius_m} m, wider than the ${EARSHOT_M} m a voice carries)`;
  for (const shape of ["v0", "v1", "v2"]) {
    assert.ok(describeAt(APEX_DESCRIPTION, shape).includes(said), `the ${shape} description names present's distance`);
  }
});
