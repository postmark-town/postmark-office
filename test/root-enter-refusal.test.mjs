// root-enter-refusal.test.mjs — POS-1147 (postmark#4773): the town root is not
// a room. Entering `the-town/let-there-be-light` used to succeed and lose the
// town's background; the shared enter executor now refuses it, plainly, with
// no entry act. What is under test is the REAL enterViaOffice against the REAL
// clone verbs, for both input forms (`mark`, `mark_id`) through the one guard.
// The fixture gives the root a real extent that contains the resident, so with
// the guard removed the root would genuinely enter (the case reds on its own
// words, not behind another refusal). Ordinary rooms enter as before. All names
// are synthetic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { enterViaOffice } from "../src/world-crossings.mjs";
import { actCaught } from "../src/world-apex.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const CLONE = worldClone();
const HAVE = !!CLONE && existsSync(join(CLONE, "tools", "portals.mjs"));
const SKIP = !HAVE && (CLONE ? `the world clone at ${CLONE} predates WLD-5 (no tools/portals.mjs)` : NO_WORLD);
const grammarOf = async () => import(pathToFileURL(join(CLONE, "tools", "enter-exit.mjs")).href);

const ROOT = "the-town/let-there-be-light";
const DEFECT = "you are already in the town";
const HINT = "the town root is not a place to enter; nothing was recorded";

const marks = () => [
  { id: ROOT, kind: "sited", by: "the-town", at: { x: 0, y: 0 }, extent: { w: 100000, h: 100000 }, body: "The town." },
  { id: "quill/yard", kind: "sited", by: "quill", at: { x: 1000, y: 1000 }, extent: { w: 500, h: 400 }, body: "The open yard." },
];
const key = (...h) => ({ handles: new Set(h) });

async function officeWith({ standing }) {
  const thresholds = await grammarOf();
  const worldState = { marks: marks() };
  let text = "";
  const records = [], stops = [], lands = [];
  return {
    records, stops, lands,
    deps: {
      world: async () => worldState,
      ledger: async () => text,
      standpointOf: async (who) => ({ ...standing, name: who }),
      acts: async () => [],
      now: () => 300,
      record: async (payload) => {
        records.push(payload);
        text += payload.lines.join("\n") + "\n";
        const folded = thresholds.parseEnterExitLedger(text).acts;
        return { lines: payload.lines, within: thresholds.occupancyAt(folded, 300).get(payload.handle) ?? [], commit: "deadbeef", pushed: false };
      },
      stop: async (who, to) => { stops.push({ who, to }); },
      land: async (who, to) => { lands.push({ who, to }); },
    },
  };
}
const refusal = async (o, payload) => {
  try { await enterViaOffice(CLONE, payload, key("ann"), o.deps); }
  catch (e) { return e; }
  assert.fail(`enter ${JSON.stringify(payload)} was not refused`);
};
const nothingHappened = (o, what) => {
  assert.deepEqual(o.records, [], `${what}: no act recorded`);
  assert.deepEqual(o.stops, [], `${what}: nobody walked`);
  assert.deepEqual(o.lands, [], `${what}: nobody landed`);
};

for (const form of ["mark", "mark_id"]) {
  test(`entering the town root by ${form}: 409, the plain reason, no entry act`, { skip: SKIP }, async () => {
    const o = await officeWith({ standing: { x: 1100, y: 1100 } });
    const e = await refusal(o, { [form]: ROOT });
    assert.equal(e.code, 409);
    assert.equal(e.defect, DEFECT);
    assert.equal(e.hint, HINT);
    const body = actCaught(e, { did: "enter" });
    assert.equal(body.defect, DEFECT);
    assert.equal(body.hint, HINT);
    nothingHappened(o, `root by ${form}`);
  });
}

test("the root is refused whatever the surrounding spaces, and by id only", { skip: SKIP }, async () => {
  const o = await officeWith({ standing: { x: 1100, y: 1100 } });
  const e = await refusal(o, { mark: `  ${ROOT}  ` });
  assert.equal(e.code, 409);
  assert.equal(e.defect, DEFECT);
  nothingHappened(o, "padded root");
  // a mark that merely shares words with the root is not the root: it is judged as any other mark
  const other = await refusal(o, { mark: "quill/let-there-be-light" });
  assert.notEqual(other.defect, DEFECT);
  nothingHappened(o, "look-alike");
});

test("an ordinary room still enters, and its passage is written once", { skip: SKIP }, async () => {
  const o = await officeWith({ standing: { x: 1100, y: 1100 } });
  const a = await enterViaOffice(CLONE, { mark: "quill/yard" }, key("ann"), o.deps);
  assert.ok(a.entered.includes("quill/yard"));
  assert.equal(o.records.length, 1);
  const b = await officeWith({ standing: { x: 1100, y: 1100 } });
  const c = await enterViaOffice(CLONE, { mark_id: "quill/yard" }, key("ann"), b.deps);
  assert.ok(c.entered.includes("quill/yard"));
  assert.equal(b.records.length, 1);
});
