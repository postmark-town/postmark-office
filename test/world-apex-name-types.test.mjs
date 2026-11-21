// world-apex-name-types.test.mjs — POS-1093: the world door answers a name that is not text with its normal 4xx.
//
// The POS-1003 review found `world { do: {"toString":1} }` leaving the call with no answer: the door reads `do` (and `read`, `mark`,
// `find`, `investigate`, `as`, `handle`, `lens`, `explain`, `read_shape`) as text, and coercing such a value throws out of the dispatcher.
// What is under test is the REAL shared call path (src/mcp.mjs `callTool`, which the MCP door and the REST apex both reach) with the
// hostile JSON, under a bounded timeout so the old defect cannot hang the run: a throw or a timeout FAILS the test, it is never read as
// a refusal. The valid calls and the omitted selectors keep their answers.
//
//   node --test test/world-apex-name-types.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

process.env.WORLD_APEX = "1";
const { callTool } = await import("../src/mcp.mjs");
const { nameTypeRefusal } = await import("../src/world-apex.mjs");

const HOSTILE = () => JSON.parse('{"toString":1}');   // an own `toString` that is not a function: String(x) throws
const NAMES = ["do", "read", "mark", "find", "investigate", "as", "handle", "lens", "explain", "read_shape"];
const SHAPES = [HOSTILE, () => ({}), () => [], () => ["do"], () => 7, () => true, () => ({ valueOf: 1, toString: 1 })];

/** The door call, bounded: a hang rejects after `ms`, a throw rejects with it. */
const call = (args, ms = 5000) => Promise.race([
  callTool("world", args, { key: null, door: "mcp" }),
  new Promise((_, rej) => setTimeout(() => rej(new Error(`world ${JSON.stringify(args)} gave no answer in ${ms} ms`)), ms).unref()),
]);

test("a non-text name is refused with the normal 4xx, promptly, for every name the door reads — and the value is never stringified to say so", async () => {
  for (const name of NAMES) {
    for (const make of SHAPES) {
      const r = await call({ [name]: make() });
      assert.equal(r.error, "bounce", `${name}: a structured refusal`);
      assert.equal(r.code, 422, `${name}: the door's own 4xx`);
      assert.match(r.defect, new RegExp(`^${name}: is a name — text, not (an object|a list|a number|a boolean)$`), `${name}: said by its type`);
      assert.match(r.hint, /Nothing was done$/);
      assert.doesNotMatch(JSON.stringify(r), /toString|valueOf|\[object/, `${name}: the hostile value is not echoed`);
    }
  }
});

test("the hostile `do` beside a valid name is refused whole: nothing else on the call is acted on", async () => {
  for (const args of [{ do: HOSTILE(), as: "human" }, { do: HOSTILE(), mark: "quill/yard" }, { read: HOSTILE(), handle: "pica" }, { do: "walk", as: HOSTILE() }]) {
    const r = await call(args);
    assert.equal(r.code, 422);
    assert.match(r.hint, /Nothing was done$/);
    assert.equal(r.done, undefined);
  }
});

test("the pure judge answers the same refusal, and says nothing for text, omitted selectors or empty text", () => {
  assert.equal(nameTypeRefusal({ do: HOSTILE() }).code, 422);
  for (const ok of [{}, { do: "walk" }, { do: "" }, { read: null }, { mark: "quill/yard", find: "snug" }, { as: "human", handle: "pica", lens: "outsider", explain: "do", read_shape: "v2" }, { x: 5, depth: 2, since_crossing: 4 }])
    assert.equal(nameTypeRefusal(ok), null, JSON.stringify(ok));
  assert.equal(nameTypeRefusal(null), null, "no args at all is not this judge's business");
});

test("valid calls and omitted selectors keep their answers: a bare read, a text find, a text unknown action are not refused as types", async () => {
  const bare = await call({});
  assert.equal(bare.error, undefined, "the bare read answers");
  const find = await call({ find: "snug" });
  assert.notEqual(find?.defect?.startsWith("find: is a name"), true, "a text find is not a type refusal");
  const unknown = await call({ do: "no-such-action-xyz" });
  assert.equal(unknown.error, "bounce");
  assert.doesNotMatch(unknown.defect ?? "", /is a name — text/, "an unknown text action keeps its own refusal");
});
