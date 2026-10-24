// moment-export.test.mjs — the founder-only moment export (POS-780).
//
//   node --test test/moment-export.test.mjs      (WORLD_CLONE names a postmark-world checkout)
//
// The gate:
//
//   1. the privacy filter is an allowlist of public actions: a letter, a stance,
//      a stake, a declaration never reach the file, even handed to the builder;
//   2. who is in view is the engine's own positionAt: a resident standing at the
//      place, and one walking through it, are in; one far away is out, and their
//      acts and says with them;
//   3. the window binds: an act a second outside it is not in the file;
//   4. says carry their text and the point each was said from (an anchor and an
//      offset, composed); a say from far away is left out;
//   5. marks in view carry their image URLs, a far mark is left out, and a mark
//      left inside the window arrives from its act;
//   6. a scoop with no place stands where its scooper stood at the window's end,
//      and refuses (naming --at) when the record cannot say;
//   7. the archive loader reads the notary's JSONL, in two passes, and says so
//      when the scoop is not in it;
//   8. the command's arguments are judged.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { buildMoment, loadFromArchive, parseArgs, fileNameFor, MOMENT_ACTIONS, normaliseAct } from "../tools/moment-export.mjs";
import { worldClone } from "./fixture-paths.mjs";

const walk = await import(pathToFileURL(join(worldClone(), "tools", "walk.mjs")).href);

const T0 = Date.parse("2026-10-24T18:00:00Z");
const MIN = 60_000;
const at = (ms) => new Date(ms).toISOString();
let seq = 1000;
const act = (o) => ({ id: seq++, crossing: "300", at_anchor: null, at_dx: null, at_dy: null, class: "move", household: null, object: null, payload: {}, ...o });

// a departure, in the frozen ledger's era (the simplest the normalizer reads): stands, or walks from → toward from `ms`
const depart = (actor, ms, from, toward = from) => act({ actor, action: "walk", at: at(ms),
  payload: { _ledger: "walk-ledger", handle: actor, from, toward, at: walk.fractionalCrossing(ms), pace: null } });

const SCOOP_ID = "errant/the-lantern-lighting";
const scoopPost = (extra = {}) => act({ actor: "errant", action: "post", class: "scoop", object: SCOOP_ID, at: at(T0 + 10 * MIN), household: "hh:the-harbor",
  payload: { post: SCOOP_ID, class: "scoop", title: "The lantern lighting", body: "Ada lit it.", state: "scooped",
    place: { mark: null, x: 0, y: 0 }, starts: at(T0), ends: at(T0 + 8 * MIN), fields: {}, ...extra } });

const MARKS = [
  { id: "ada/the-lantern", slug: "the-lantern", by: "ada", kind: "sited", at: { x: 40, y: 10 }, extent: { w: 6, h: 6 }, image: "https://media.postmark.test/lantern.png", body: "A lantern on a post." },
  { id: "far/the-mill", slug: "the-mill", by: "far", kind: "sited", at: { x: 5000, y: 5000 }, extent: { w: 20, h: 20 }, image: "https://media.postmark.test/mill.png", body: "A mill." },
];

function scene() {
  const acts = [
    depart("ada", T0 - 60 * MIN, { x: 20, y: 0 }),                       // stands in view, since before the window
    depart("errant", T0 - 30 * MIN, { x: -30, y: 5 }),                    // the scooper, in view
    depart("far-away", T0 - 60 * MIN, { x: 9000, y: 9000 }),              // far out
    depart("walker", T0 + 1 * MIN, { x: -290, y: 0 }, { x: 400, y: 0 }), // walks (21 m a minute) into the radius during the window
    act({ actor: "ada", action: "say", class: "voice", at: at(T0 + 2 * MIN), at_anchor: "the-town/let-there-be-light", at_dx: 20, at_dy: 0, payload: { text: "Here goes." } }),
    act({ actor: "far-away", action: "say", class: "voice", at: at(T0 + 2 * MIN), at_anchor: "the-town/let-there-be-light", at_dx: 9000, at_dy: 9000, payload: { text: "Nobody hears this." } }),
    act({ actor: "ada", action: "say", class: "voice", at: at(T0 + 9 * MIN), at_anchor: "the-town/let-there-be-light", at_dx: 20, at_dy: 0, payload: { text: "Too late." } }),
    act({ actor: "errant", action: "say", class: "voice", at: at(T0 - 1000), at_anchor: "the-town/let-there-be-light", at_dx: -30, at_dy: 5, payload: { text: "Too early." } }),
    act({ actor: "ada", action: "take", class: "holding", at: at(T0 + 3 * MIN), object: "ada/a-match", at_anchor: "the-town/let-there-be-light", at_dx: 20, at_dy: 0, payload: { thing: "ada/a-match" } }),
    act({ actor: "ada", action: "leave-mark", class: "mark", at: at(T0 + 4 * MIN), object: "ada/a-flame", at_anchor: "the-town/let-there-be-light", at_dx: 25, at_dy: 0,
      payload: { slug: "ada/a-flame", kind: "sited", at: { x: 25, y: 0 }, extent: { w: 2, h: 2 }, body: "A small flame.", image: "https://media.postmark.test/flame.png" } }),
    // never public
    act({ actor: "ada", action: "declare-stance-on", class: "stance", at: at(T0 + 3 * MIN), object: "ada/a-flame", payload: { stance: "for" } }),
    act({ actor: "ada", action: "stake", class: "mark", at: at(T0 + 3 * MIN), object: "ada/a-flame", payload: { stamps: 3 } }),
    act({ actor: "ada", action: "letter", class: "mail", at: at(T0 + 3 * MIN), payload: { text: "dear errant, a private word" } }),
  ];
  return { scoopActs: [scoopPost()], acts };
}

const build = (over = {}) => buildMoment({ scoopId: SCOOP_ID, ...scene(), marks: MARKS, walk, now: T0 + 20 * MIN, ...over });

// ── 1 · the privacy filter ──────────────────────────────────────────────────

test("1 · only the public act classes reach the file; a letter, a stance, a stake and a declaration never do, even handed to the builder", () => {
  const m = build();
  const actions = new Set(m.acts.map((a) => a.action));
  for (const bad of ["letter", "declare-stance-on", "stake", "post", "amend", "advance"]) assert.ok(!actions.has(bad), `${bad} is not a public act`);
  assert.ok(!JSON.stringify(m).includes("a private word"), "a letter's words are nowhere in the file");
  for (const bad of ["letter", "declare-stance-on", "stake", "vote", "rsvp", "host", "announce", "withdraw"]) assert.ok(!MOMENT_ACTIONS.includes(bad), `${bad} is off the allowlist`);
  assert.deepEqual(m.manifest.public_actions, [...MOMENT_ACTIONS]);
  assert.ok(m.manifest.not_included.some((s) => /consent pass/.test(s)), "the manifest says the consent pass is the next stage's");
});

// ── 2 · who is in view ──────────────────────────────────────────────────────

test("2 · in view is the engine's positionAt: the resident standing there and the one walking through are in; the one far away is out, with their acts", () => {
  const m = build();
  assert.deepEqual(Object.keys(m.positions).sort(), ["ada", "errant", "walker"]);
  assert.deepEqual(m.residents.map((r) => r.handle).sort(), ["ada", "errant", "walker"]);
  const w = m.positions.walker;
  assert.equal(w.step_s, 1);
  assert.equal(w.points.length, 8 * 60 + 1, "one sample a second across the window, both ends");
    assert.ok(w.points[0] === null, "before the departure there is no record of the walker");
  assert.ok(w.points[70][0] < -285 && w.points[70][0] > -290, "just after the departure they are where it began");
  assert.ok(w.points.some((p) => p && Math.hypot(p[0], p[1]) <= 250), "the walk enters the radius");
  assert.deepEqual(m.positions.ada.points[0], [20, 0]);
  assert.deepEqual(m.positions.ada.points.at(-1), [20, 0]);
  assert.equal(JSON.stringify(m).includes("far-away"), false, "nothing of the one far away is in the file");
  assert.equal(m.manifest.place_from, "the scoop's place");
});

// ── 3 · the window binds ────────────────────────────────────────────────────

test("3 · the window binds: an act a moment outside it is not in the file", () => {
  const m = build();
  const texts = m.says.map((s) => s.text);
  assert.ok(!texts.includes("Too early.") && !texts.includes("Too late."));
  const ids = m.acts.map((a) => a.at);
  assert.ok(ids.every((t) => t >= at(T0) && t <= at(T0 + 8 * MIN)));
  assert.deepEqual([m.manifest.window.starts, m.manifest.window.ends], [at(T0), at(T0 + 8 * MIN)]);
});

// ── 4 · says ────────────────────────────────────────────────────────────────

test("4 · a said line carries its text and the point it was said from; one said far away is left out", () => {
  const m = build();
  assert.deepEqual(m.says.map(({ act, ...s }) => s), [{ at: at(T0 + 2 * MIN), speaker: "ada", text: "Here goes.", x: 20, y: 0, place: null }]);
  assert.equal(m.manifest.counts.says, 1);
});

// ── 5 · marks ───────────────────────────────────────────────────────────────

test("5 · marks in view carry their image URLs; a far mark is left out; a mark left inside the window arrives from its act", () => {
  const m = build();
  const byId = Object.fromEntries(m.marks.map((x) => [x.id, x]));
  assert.equal(byId["ada/the-lantern"].image, "https://media.postmark.test/lantern.png");
  assert.equal(byId["ada/the-lantern"].source, "world");
  assert.equal(byId["far/the-mill"], undefined);
  assert.equal(byId["ada/a-flame"].image, "https://media.postmark.test/flame.png");
  assert.match(byId["ada/a-flame"].source, /^act \d+$/);
  assert.ok(m.acts.some((a) => a.action === "take" && a.object === "ada/a-match"));
  assert.ok(m.acts.some((a) => a.action === "leave-mark"));
});

// ── 6 · the place ───────────────────────────────────────────────────────────

test("6 · a scoop with no place stands where its scooper stood at the window's end; with no position it refuses, naming --at; --at wins", () => {
  const noPlace = scoopPost();
  delete noPlace.payload.place;
  const m = build({ scoopActs: [noPlace] });
  assert.deepEqual(m.manifest.place, { x: -30, y: 5 });
  assert.match(m.manifest.place_from, /where errant stood/);
  const lost = scene();
  assert.throws(() => buildMoment({ scoopId: SCOOP_ID, scoopActs: [noPlace], acts: lost.acts.filter((a) => a.actor !== "errant"), marks: MARKS, walk }), /pass --at x,y/);
  assert.deepEqual(build({ at: { x: 5000, y: 5000 } }).manifest.place, { x: 5000, y: 5000 });
  assert.equal(Object.keys(build({ at: { x: 5000, y: 5000 } }).positions).length, 0, "nobody is near the far place");
  assert.deepEqual(Object.keys(build({ radius: 5 }).positions), [], "a 5 m radius around the origin holds nobody");
});

// ── 7 · the archive ─────────────────────────────────────────────────────────

test("7 · the archive loader reads the notary's JSONL in two passes, and says plainly when the scoop is not in it", async () => {
  const { scoopActs, acts } = scene();
  const dir = mkdtempSync(join(tmpdir(), "moment-export-"));
  const line = (a) => JSON.stringify({ ...a, effect: null, journal_seq: null, inserted_at: a.at, witnesses: null });
  // the departures and the window's acts in an early file, the scoop's own post in a later one (as the notary archives it)
  writeFileSync(join(dir, "10.jsonl"), acts.map(line).join("\n") + "\n");
  writeFileSync(join(dir, "11.jsonl"), scoopActs.map(line).join("\n") + "\n");
  const got = await loadFromArchive(dir, SCOOP_ID);
  assert.equal(got.source.files, 2);
  assert.equal(got.scoopActs.length, 1);
  const m = buildMoment({ scoopId: SCOOP_ID, scoopActs: got.scoopActs, acts: got.acts, marks: MARKS, walk });
  const direct = build();
  const bare = (xs) => xs.map(({ act: _a, ...r }) => r);
  assert.deepEqual(bare(m.says), bare(direct.says));
  assert.deepEqual(Object.keys(m.positions), Object.keys(direct.positions));
  assert.ok(got.acts.every((a) => MOMENT_ACTIONS.includes(a.action)), "the loader keeps the public actions only");
    await assert.rejects(loadFromArchive(dir, "nobody/nothing"), /no scoop "nobody\/nothing" in this source.*once a day/s);
  assert.deepEqual(normaliseAct({ id: "7", at: new Date(T0), action: "say", payload: "{\"text\":\"x\"}" }).payload, { text: "x" });
});

// ── 8 · the command ─────────────────────────────────────────────────────────

test("8 · the command's arguments are judged, and the file is named for the scoop", () => {
  const o = parseArgs(["--scoop", SCOOP_ID, "--world", "w", "--acts", "a", "--radius", "100", "--at", "1,2"]);
  assert.deepEqual([o.scoop, o.radius, o.at, o.step], [SCOOP_ID, 100, { x: 1, y: 2 }, 1]);
  assert.throws(() => parseArgs(["--scoop", SCOOP_ID, "--world", "w"]), /usage/);
  assert.throws(() => parseArgs(["--scoop", SCOOP_ID, "--world", "w", "--acts", "a", "--pg-url", "p"]), /name one source/);
  assert.throws(() => parseArgs(["--scoop", SCOOP_ID, "--world", "w", "--acts", "a", "--radius", "0"]), /radius is metres above 0/);
  assert.throws(() => parseArgs(["--bogus"]), /unknown argument --bogus/);
  assert.equal(fileNameFor(SCOOP_ID), "moment-errant-the-lantern-lighting.json");
});
