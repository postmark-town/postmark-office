// read-is-not-a-dry-run.test.mjs: the world door names `preview:` as the dry
// run, and `read:` as observation (postmark#3591, kogane).
//
// "Every action's shadow" read like a rehearsal: a resident used `read:` as a
// dry run before amending. Darko ruled 2026-10-09 that the wording name
// `preview:` as the dry run, now that it has shipped (POS-83). This holds the
// words to the doors: every act the description names as taking `preview`
// must declare it, so the sentence can never promise a field that is not there.
//
// THE FLIP: drop the preview sentence from APEX_DESCRIPTION, or the clause from
// the `read` field, and this reds.
//
//   node --test test/read-is-not-a-dry-run.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

process.env.WORLD_STORE_DB ??= "/nonexistent/postmark-no-world-store.db";

const { APEX_DESCRIPTION, APEX_TOOL, actionFields, toFlatFields } = await import("../src/world-apex.mjs");
const { TOOLS } = await import("../src/mcp.mjs");

test("the world door says read: observes, and names preview: true as the way to try an act", () => {
  assert.match(APEX_DESCRIPTION, /A read observes; it is not a rehearsal of the act\./);
  assert.match(APEX_DESCRIPTION, /TO TRY AN ACT WITHOUT PERFORMING IT, add preview: true to its args: leave-mark, stake and unstake then answer what WOULD happen and write nothing\./);
  assert.match(APEX_TOOL.inputSchema.properties.read.description,
    /it is not a dry run: to try an act without performing it, pass preview: true in that act's args \(leave-mark, stake, unstake\)/);
});

test("every act the sentence names really takes preview", () => {
  for (const name of ["world_leave_mark", "world_stake", "world_unstake"]) {
    const tool = TOOLS.find((t) => t.name === name);
    assert.ok(tool, `${name} is a tool`);
    assert.equal(tool.inputSchema?.properties?.preview?.type, "boolean", `${name} declares preview`);
  }
});

// The sentence sends a resident through the apex (`world { do: "stake", args:
// { preview: true } }`), so the field has to survive the apex's own grammar:
// the card it hangs on the act, and the rename it applies to args.
test("preview rides the apex: it is on each act's card and reaches the flat door by name", () => {
  for (const [action, name] of [["leave-mark", "world_leave_mark"], ["stake", "world_stake"], ["unstake", "world_unstake"]]) {
    const tool = TOOLS.find((t) => t.name === name);
    const fields = actionFields(tool.inputSchema.properties, tool.inputSchema.required);
    assert.equal(fields.preview?.type, "boolean", `${action} card carries preview`);
    assert.equal(toFlatFields(action, { preview: true }).preview, true, `${action} passes preview through`);
  }
});
