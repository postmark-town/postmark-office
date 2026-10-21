// creature-tells.test.mjs — a sealed secret, and the creature that tells it
// (POS-712, lupi's shape B, postmark-town/postmark#3531; WLD-25 Q3 3a–3c;
// src/sealed.mjs, src/creatures.mjs § a creature that tells, src/creature-tick.mjs § the unseal).
//
// Rules public, instances sealed, revealed afterwards so anyone can check: each
// resident is told one fragment per visit (a settlement window) in their own
// reply, the record holds only its commitment, a `call` holding every fragment in
// order finishes the creature, and its ending is followed by the unseal.
//
// The world's kind grammar has no `fragments` yet (its PR follows), so the
// telling kind is the pinned law's own parsed kind with `fragments` and
// `fragment_words` added: the stub. No real word list is used.
//
// THE CAN-FAIL FLIPS (each reds a case below): put the word in the tell row;
// tell a new fragment on a second act in the same window; accept the fragments
// out of order; drop writeTellOnce's look; let a creature tell with no key;
// write the unseal before the creature has ended.

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";

import { commitmentOf, scopeSecret, sealedItem, verifySealed } from "../src/sealed.mjs";
import {
  FINISH_ACTION, LivingSet, PRIOR_TELL_SQL, TELL_ACTION, TRIGGER_SQL, UNSEAL_ACTION,
  holdsInOrder, loadCreatureLaw, reactTo, tellingFor, wordsIn, writeReaction, reactionRows,
} from "../src/creatures.mjs";
import { creatureTick, UNSEAL_DUE_SQL } from "../src/creature-tick.mjs";
import { settlementAtOrBefore } from "../src/world-forecast.mjs";
import { NO_WORLD, worldModuleUrl } from "./fixture-paths.mjs";

const test = (name, fn) => nodeTest(name, { skip: NO_WORLD || false }, fn);

const MASTER = "a test master key, never the box's";
const LIST = ["amber", "brass", "cinder", "dusk", "ember", "frost", "gloam", "hollow"];

// ── the primitive ───────────────────────────────────────────────────────────

nodeTest("a sealed item: its commitment says nothing of its value, the reveal opens it, and only the right secret does", () => {
  const secret = scopeSecret(MASTER, "creature:raven-x");
  const a = sealedItem(secret, { scope: "creature:raven-x", subject: "kai", number: 1, list: LIST });
  assert.ok(LIST.includes(a.value));
  assert.equal(a.commitment, commitmentOf({ scope: "creature:raven-x", subject: "kai", number: 1, value: a.value, nonce: a.nonce }));
  // trying every word of the public list against the commitment, without the nonce, finds nothing
  for (const w of LIST) assert.notEqual(commitmentOf({ scope: "creature:raven-x", subject: "kai", number: 1, value: w, nonce: "" }), a.commitment);
  const pub = [{ subject: "kai", number: 1, commitment: a.commitment }];
  assert.equal(verifySealed(secret, { scope: "creature:raven-x", list: LIST }, pub).ok, true);
  assert.equal(verifySealed(scopeSecret(MASTER, "creature:raven-y"), { scope: "creature:raven-x", list: LIST }, pub).ok, false, "another scope's secret opens nothing here");
  assert.notEqual(scopeSecret(MASTER, "creature:raven-x"), scopeSecret(MASTER, "creature:raven-y"));
  assert.throws(() => scopeSecret("", "s"), /no master key/);
});

nodeTest("the answer reads words in order, ignoring case and punctuation, with other words between", () => {
  assert.deepEqual(wordsIn("Amber, then BRASS... and cinder!"), ["amber", "then", "brass", "and", "cinder"]);
  assert.equal(holdsInOrder(wordsIn("amber, then brass and cinder"), ["amber", "brass", "cinder"]), true);
  assert.equal(holdsInOrder(wordsIn("brass amber cinder"), ["amber", "brass", "cinder"]), false, "out of order");
  assert.equal(holdsInOrder(wordsIn("amber brass"), ["amber", "brass", "cinder"]), false, "one missing");
  assert.equal(holdsInOrder([], []), false);
});

// ── telling ─────────────────────────────────────────────────────────────────

const levels = (m) => `none | a little ${m} | plain ${m} | overwhelming ${m}`;
const KIND_TEXT = `kind: raven
name: a raven
ring_m: 60
what: >
  A raven.
moods:
  fear: 0..3 = 1 | ${levels("fear")}
reaction stare "it stares": when true says The raven stares at {actor}.
`;
const BASE = NO_WORLD ? null : await loadCreatureLaw({ ref: "the pinned clone", importTool: (f) => import(worldModuleUrl("tools", f)),
  readText: (path) => { if (path !== "WORLD/kinds/raven.kind") throw new Error(`no fixture kind at ${path}`); return KIND_TEXT; } });
const STUB = NO_WORLD ? null : { ...BASE.kindOf("raven"), fragments: "3", fragment_words: LIST };
const LAW = NO_WORLD ? null : { ...BASE, kindOf: (n) => (n === "raven" ? STUB : null) };

const ID = "creature:raven-x";
const T0 = Date.parse("2026-10-26T07:00:00Z"); // inside the 06:00Z window
const H = 3600_000;
const iso = (ms) => new Date(ms).toISOString();
let n = 100;
const spawn = () => ({ id: "1", at: iso(T0 - H), actor: "the-town", action: "spawn", object: ID, // always the first row
  payload: { kind: "raven", at: iso(T0 - H), stays: true, x: 0, y: 0 } });
const tellAt = (to, number, at) => ({ id: String(++n), at: iso(at), actor: ID, action: TELL_ACTION, object: ID,
  payload: { to, number, window: settlementAtOrBefore(new Date(at)) } });
const creatureWith = (...rows) => new LivingSet({ law: LAW }).fold([spawn(), ...rows]).byId.get(ID);
const word = (subject, number) => sealedItem(scopeSecret(MASTER, ID), { scope: ID, subject, number, list: LIST }).value;

test("one fragment per visit: told in the reply, its commitment for the record; the same window tells it again; the next window tells the next", () => {
  const act = (atMs, over = {}) => ({ actor: "kai", verb: "walk", actId: "9001", atIso: iso(atMs), ...over });
  const first = tellingFor({ kind: STUB, creature: creatureWith(), act: act(T0), master: MASTER });
  assert.deepEqual(first.told, { word: word("kai", 1), number: 1, of: 3 });
  assert.equal(first.tell.number, 1);
  assert.equal(first.tell.window, "2026-10-26T06:00:00.000Z");
  assert.equal(first.tell.commitment, sealedItem(scopeSecret(MASTER, ID), { scope: ID, subject: "kai", number: 1, list: LIST }).commitment);
  assert.equal(JSON.stringify(first.tell).includes(word("kai", 1)), false, "the word is never in the row");
  const again = tellingFor({ kind: STUB, creature: creatureWith(tellAt("kai", 1, T0)), act: act(T0 + H), master: MASTER });
  assert.deepEqual(again.told, first.told, "inside its window the same fragment again");
  assert.equal(again.tell, null, "and no new row");
  const next = tellingFor({ kind: STUB, creature: creatureWith(tellAt("kai", 1, T0)), act: act(T0 + 12 * H), master: MASTER });
  assert.equal(next.told.number, 2);
  assert.notEqual(word("mo", 1), undefined);
  const others = tellingFor({ kind: STUB, creature: creatureWith(tellAt("kai", 1, T0)), act: act(T0, { actor: "mo" }), master: MASTER });
  assert.equal(others.told.number, 1, "every resident has their own");
});

test("all told: it asks; a call holding every fragment in order answers, out of order does not", () => {
  const c = creatureWith(tellAt("kai", 1, T0), tellAt("kai", 2, T0 + 12 * H), tellAt("kai", 3, T0 + 24 * H));
  const at = T0 + 36 * H;
  const said = [1, 2, 3].map((k) => word("kai", k));
  const ask = tellingFor({ kind: STUB, creature: c, act: { actor: "kai", verb: "walk", actId: "1", atIso: iso(at) }, master: MASTER });
  assert.deepEqual(ask.told, { asks: 3 });
  assert.equal(ask.answered, false);
  assert.equal(tellingFor({ kind: STUB, creature: c, act: { actor: "kai", verb: "call", actId: "1", atIso: iso(at), words: `I remember: ${said.join(", then ")}.` }, master: MASTER }).answered, true);
  assert.equal(new Set(said).size, 3, "this fixture's three fragments differ, so order can be tested");
  assert.equal(tellingFor({ kind: STUB, creature: c, act: { actor: "kai", verb: "call", actId: "1", atIso: iso(at), words: [...said].reverse().join(" ") }, master: MASTER }).answered,
    false, "out of order is no answer");
  const two = creatureWith(tellAt("kai", 1, T0), tellAt("kai", 2, T0 + 12 * H));
  assert.equal(tellingFor({ kind: STUB, creature: two, act: { actor: "kai", verb: "call", actId: "1", atIso: iso(at), words: said.join(" ") }, master: MASTER }).answered, false,
    "not before every fragment is told");
});

test("fail closed: no key, a creature that does not stay, or a kind that does not tell, tells nothing", () => {
  const act = { actor: "kai", verb: "walk", actId: "1", atIso: iso(T0) };
  assert.equal(tellingFor({ kind: STUB, creature: creatureWith(), act, master: "" }), null);
  assert.equal(tellingFor({ kind: STUB, creature: { ...creatureWith(), stays: undefined }, act, master: MASTER }), null);
  assert.equal(tellingFor({ kind: BASE.kindOf("raven"), creature: creatureWith(), act, master: MASTER }), null);
});

function recordingWrite() {
  const calls = [];
  let next = 500;
  return { calls, write: async (rows) => { calls.push(rows); return { prior: false, rows: rows.map((r) => ({ id: String(next++), at: r.written_at, actor: r.actor, action: r.action, object: r.object, payload: r.payload })) }; } };
}
const payloadOf = (r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload);

test("in the turn: the fragment rides the actor's reply alone, the tell row carries only its commitment, and a right answer finishes it", async () => {
  const living = new LivingSet({ law: LAW }).fold([spawn()]);
  const { calls, write } = recordingWrite();
  const env = { CREATURE_SEED_KEY: MASTER, CREATURE_JUDGE: "code" };
  const [reply] = await reactTo({ actor: "kai", verb: "walk", actId: "9001", atIso: iso(T0), point: { x: 5, y: 0 } }, { living, law: LAW, write, env, now: T0 });
  assert.deepEqual(reply.fragment, { word: word("kai", 1), number: 1, of: 3 });
  const [react, tell] = calls[0];
  assert.equal(tell.action, TELL_ACTION);
  assert.deepEqual(Object.keys(payloadOf(tell)).sort(), ["commitment", "list", "number", "to", "window"]);
  for (const row of calls[0]) assert.equal(JSON.stringify(row).includes(word("kai", 1)), false, `no ${row.action} row carries the word`);
  // two more visits, then the answer, by call
  living.fold([tellAt("kai", 2, T0 + 12 * H), tellAt("kai", 3, T0 + 24 * H)], { advance: false });
  const said = [1, 2, 3].map((k) => word("kai", k)).join(" ");
  const [answered] = await reactTo({ actor: "kai", verb: "call", actId: "9100", atIso: iso(T0 + 36 * H), point: { x: 5, y: 0 }, words: said },
    { living, law: LAW, write, env, now: T0 + 36 * H, aimed: living.byId.get(ID) });
  assert.equal(answered.answered, true);
  const fin = calls.at(-1).find((r) => r.action === FINISH_ACTION);
  assert.deepEqual(payloadOf(fin), { by: "kai", act: "9100", reaction: "stare" });
});

test("a right answer finishes it even when its kind has no reaction for the act", async () => {
  const silent = { ...STUB, reactions: [] };
  const law = { ...LAW, kindOf: () => silent };
  const living = new LivingSet({ law }).fold([spawn(), tellAt("kai", 1, T0), tellAt("kai", 2, T0 + 12 * H), tellAt("kai", 3, T0 + 24 * H)]);
  const finished = [];
  const said = [1, 2, 3].map((k) => word("kai", k)).join(" ");
  const out = await reactTo({ actor: "kai", verb: "call", actId: "9200", atIso: iso(T0 + 36 * H), point: { x: 5, y: 0 }, words: said },
    { living, law, env: { CREATURE_SEED_KEY: MASTER }, now: T0 + 36 * H, aimed: living.byId.get(ID), finish: async (c, a) => { finished.push([c.id, a.actor, a.actId]); return { written: true }; } });
  assert.deepEqual(out, []);
  assert.deepEqual(finished, [[ID, "kai", "9200"]]);
});

test("a fragment is told once: a second tell row for the same resident and number is not written", async () => {
  const acts = [];
  let id = 0;
  const client = { query: async (sql, params) => {
    if (sql === PRIOR_TELL_SQL) return { rows: acts.filter((a) => a.action === TELL_ACTION && a.actor === params[0] && payloadOf(a).to === params[1] && String(payloadOf(a).number) === params[2]).map((a) => ({ id: a.id })) };
    if (sql === TRIGGER_SQL) return { rows: [{ here: 1 }] };
    return { rows: [] };
  } };
  const io = { officeWrite: async (fn) => fn(client), insertAct: async (_c, row) => { acts.push({ ...row, id: String(++id) }); return String(id); } };
  const c = creatureWith();
  const tell = { to: "kai", number: 1, window: "w", commitment: "c", list: "l" };
  await writeReaction(reactionRows(c, { actor: "kai", verb: "walk", actId: "1" }, { reaction: "stare" }, { now: T0, tell }), io);
  const again = await writeReaction(reactionRows(c, { actor: "kai", verb: "walk", actId: "2" }, { reaction: "stare" }, { now: T0, tell }), io);
  assert.deepEqual(again.rows.map((r) => r.action), ["react"]);
  assert.equal(acts.filter((a) => a.action === TELL_ACTION).length, 1);
});

// ── the unseal ──────────────────────────────────────────────────────────────

test("once it has ended, the clock publishes its secret, and every tell's commitment checks against it", async () => {
  const commitments = [1, 2].map((k) => ({ subject: "kai", number: k,
    commitment: sealedItem(scopeSecret(MASTER, ID), { scope: ID, subject: "kai", number: k, list: LIST }).commitment }));
  const written = [];
  const query = async (sql) => (sql === UNSEAL_DUE_SQL ? [{ id: ID }] : []);
  const write = async (row) => { written.push(row); return { prior: false, row: { ...row, payload: JSON.parse(row.payload) } }; };
  const inputsAt = async () => ({ creaturesMod: { dueFades: () => [] }, law: null });
  const r = await creatureTick({ now: T0, key: MASTER, query, write, inputsAt, blessed: () => "sha" });
  assert.equal(r.wrote.unseal, 1);
  const p = JSON.parse(written.find((w) => w.action === UNSEAL_ACTION).payload);
  assert.equal(p.scope, ID);
  assert.equal(verifySealed(p.secret, { scope: ID, list: LIST }, commitments).ok, true, "anyone can check every fragment now");
  const keyless = await creatureTick({ now: T0, key: null, query, write: async () => assert.fail("no key, no write"), inputsAt, blessed: () => "sha" });
  assert.match(keyless.held.join(" "), /its sealed secret waits for the key/);
  // only an ended creature that told is due
  assert.match(UNSEAL_DUE_SQL, /w\.payload->>'reason' = 'ended'/);
  assert.match(UNSEAL_DUE_SQL, /NOT EXISTS \(SELECT 1 FROM acts u WHERE u\.class = 'creature' AND u\.action = 'unseal'/);
});
