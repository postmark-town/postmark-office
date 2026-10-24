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

import { buildMoment, loadFromArchive, parseArgs, fileNameFor, MOMENT_ACTIONS, PAYLOAD_FIELDS, screenAct, normaliseAct, EXPORTABLE_STATES } from "../tools/moment-export.mjs";
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

// the founders take a scoop up first: scooped → picked-up (the export reads a moment only for a scoop the journalist has taken up)
const move = (to, extra = {}) => act({ actor: "wright", action: "advance", class: "scoop", object: SCOOP_ID, at: at(T0 + 12 * MIN),
  payload: { post: SCOOP_ID, to, hand: "wright", ...extra } });
const takenUp = () => move("picked-up");

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
      payload: { slug: "a-flame", by: "ada", kind: "sited", at: { x: 25, y: 0 }, extent: { w: 2, h: 2 }, date: at(T0 + 4 * MIN), body: "A small flame.", image: "https://media.postmark.test/flame.png",
        stamps: 0, put_forward: true, _consent: { likeness: "yes" }, _placed_by: "ada-human" } }),
    // never public
    act({ actor: "ada", action: "declare-stance-on", class: "stance", at: at(T0 + 3 * MIN), object: "ada/a-flame", payload: { stance: "for" } }),
    act({ actor: "ada", action: "stake", class: "mark", at: at(T0 + 3 * MIN), object: "ada/a-flame", payload: { stamps: 3 } }),
    act({ actor: "ada", action: "letter", class: "mail", at: at(T0 + 3 * MIN), payload: { text: "dear errant, a private word" } }),
  ];
  return { scoopActs: [scoopPost(), takenUp()], acts };
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
  assert.ok(m.residents.every((r) => r.trajectory === r.in_view), "a resident in view has a trajectory");
  assert.equal(m.manifest.position_notes.length, 2);
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
  assert.equal(byId["ada/a-flame"].by, "ada", "the id is the act's object (by/slug); by comes from the payload");
  assert.equal(byId["a-flame"], undefined, "never the bare slug as an id");
  assert.equal(byId["ada/a-flame"].image, "https://media.postmark.test/flame.png");
  assert.match(byId["ada/a-flame"].source, /^act \d+$/);
  assert.ok(m.acts.some((a) => a.action === "take" && a.object === "ada/a-match"));
  assert.ok(m.acts.some((a) => a.action === "leave-mark"));
});

// ── 6 · the place ───────────────────────────────────────────────────────────

test("6 · a scoop with no place stands where its scooper stood at the window's end; with no position it refuses, naming --at; --at wins", () => {
  const noPlace = scoopPost();
  delete noPlace.payload.place;
  const m = build({ scoopActs: [noPlace, takenUp()] });
  assert.deepEqual(m.manifest.place, { x: -30, y: 5 });
  assert.match(m.manifest.place_from, /where errant stood/);
  const lost = scene();
  assert.throws(() => buildMoment({ scoopId: SCOOP_ID, scoopActs: [noPlace, takenUp()], acts: lost.acts.filter((a) => a.actor !== "errant"), marks: MARKS, walk }), /pass --at x,y/);
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
  assert.equal(got.scoopActs.length, 2);
  const m = buildMoment({ scoopId: SCOOP_ID, scoopActs: got.scoopActs, acts: got.acts, marks: MARKS, walk });
  const direct = build();
  const bare = (xs) => xs.map(({ act: _a, ...r }) => r);
  assert.deepEqual(bare(m.says), bare(direct.says));
  assert.deepEqual(Object.keys(m.positions), Object.keys(direct.positions));
  assert.ok(got.acts.every((a) => MOMENT_ACTIONS.includes(a.action)), "the loader keeps the public actions only");
    await assert.rejects(loadFromArchive(dir, "nobody/nothing"), /no scoop "nobody\/nothing" in this source.*once a day/s);
  assert.deepEqual(normaliseAct({ id: "7", at: new Date(T0), action: "say", payload: "{\"text\":\"x\"}" }).payload, { text: "x" });
});

// ── 9 · the field screen ────────────────────────────────────────────────────

test("9 · the screen is by FIELD: a leave-mark keeps only its named fields and only when put forward; stamps, put_forward, _consent and _placed_by never reach the file", async () => {
  const secret = "a private draft sentence";
  const extra = scene();
  extra.acts.push(
    // a draft: a leave-mark that was not put forward (and one with no verdict at all)
    act({ actor: "ada", action: "leave-mark", class: "mark", at: at(T0 + 5 * MIN), object: "ada/a-draft", at_anchor: "the-town/let-there-be-light", at_dx: 30, at_dy: 0,
      payload: { slug: "a-draft", by: "ada", kind: "sited", at: { x: 30, y: 0 }, extent: { w: 2, h: 2 }, body: secret, stamps: 0, put_forward: false, _placed_by: "ada-human" } }),
    act({ actor: "ada", action: "leave-mark", class: "mark", at: at(T0 + 5 * MIN), object: "ada/a-draft-2", at_anchor: "the-town/let-there-be-light", at_dx: 31, at_dy: 0,
      payload: { slug: "a-draft-2", by: "ada", kind: "sited", at: { x: 31, y: 0 }, body: secret } }),
    // fields no one judged, on acts that are public
    act({ actor: "ada", action: "say", class: "voice", at: at(T0 + 6 * MIN), at_anchor: "the-town/let-there-be-light", at_dx: 20, at_dy: 0,
      payload: { text: "A public line.", place: "the Quay", _internal_note: "household-private", stamps: 9 } }),
    act({ actor: "ada", action: "take", class: "holding", at: at(T0 + 6 * MIN), object: "ada/a-key", payload: { thing: "ada/a-key", holder: "ada", _consent: "x", declared_household: "hh:private" } }));
  const m = buildMoment({ scoopId: SCOOP_ID, ...extra, marks: MARKS, walk });
  const text = JSON.stringify(m);
  for (const gone of [secret, "_consent", "_placed_by", "put_forward", "\"stamps\"", "_internal_note", "household-private", "declared_household", "ada-human", "a-draft"])
    assert.equal(text.includes(gone), false, `${gone} is not in the file`);
  const flame = m.acts.find((a) => a.object === "ada/a-flame");
  assert.deepEqual(Object.keys(flame.payload).sort(), ["at", "body", "by", "date", "extent", "image", "kind", "slug"], "only the named fields of a put-forward leave-mark");
  assert.ok(m.says.some((x) => x.text === "A public line."), "the say itself is kept");
  assert.deepEqual(Object.keys(m.acts.find((a) => a.action === "take" && a.object === "ada/a-key").payload).sort(), ["holder", "thing"]);
  // the same through the loader's screen, one row at a time
  assert.equal(screenAct({ ...act({ action: "leave-mark", payload: { slug: "x", put_forward: false } }) }), null);
  assert.equal(screenAct({ ...act({ action: "leave-mark", payload: { slug: "x" } }) }), null);
  assert.equal(screenAct({ ...act({ action: "letter", payload: {} }) }), null);
  assert.ok(screenAct({ ...act({ action: "leave-mark", at: at(T0), payload: { slug: "x", put_forward: true, stamps: 1 } }) }));
  // a walk keeps what a departure needs and nothing else; an emission keeps its sound fields
  const w = screenAct(depart("ada", T0, { x: 1, y: 1 }, { x: 2, y: 2 }));
  assert.deepEqual(Object.keys(w.payload).sort(), ["_ledger", "at", "from", "handle", "pace", "toward"]);
  const em = screenAct(act({ action: "legacy:emission", at: at(T0), payload: { at: at(T0), payload: { class: "sound", text: "hi", x: 1, y: 2, secret: "no" }, extra: "no" } }));
  assert.deepEqual(em.payload, { at: at(T0), payload: { class: "sound", text: "hi", x: 1, y: 2 } });
  // every allowlisted action has a field list, and none lists a private field
  for (const a of MOMENT_ACTIONS) assert.ok(Array.isArray(PAYLOAD_FIELDS[a]), `${a} has a field list`);
  for (const list of Object.values(PAYLOAD_FIELDS)) for (const bad of ["stamps", "put_forward", "_consent", "_placed_by"]) assert.ok(!list.includes(bad), `${bad} is on no list`);
  // and through the archive loader
  const dir = mkdtempSync(join(tmpdir(), "moment-export-priv-"));
  writeFileSync(join(dir, "20.jsonl"), [...extra.acts, ...extra.scoopActs].map((a) => JSON.stringify(a)).join("\n") + "\n");
  const got = await loadFromArchive(dir, SCOOP_ID);
  const loaded = JSON.stringify(got.acts);
  for (const gone of [secret, "_consent", "_placed_by", "put_forward", "ada-human"]) assert.equal(loaded.includes(gone), false, `${gone} never leaves the loader`);
});

// ── 10 · the scoop's state ──────────────────────────────────────────────────

test("10 · the export reads a moment only for a scoop the journalist has taken up: scooped, passed and withdrawn are refused; picked-up through published are read", () => {
  const base = scene();
  const go = (acts) => buildMoment({ scoopId: SCOOP_ID, scoopActs: acts, acts: base.acts, marks: MARKS, walk });
  assert.throws(() => go([scoopPost()]), /is scooped.*advance it to picked-up first/s);
  assert.throws(() => go([scoopPost(), move("passed")]), /is passed.*not taken up/s);
  assert.throws(() => go([scoopPost(), act({ actor: "errant", action: "close", class: "scoop", object: SCOOP_ID, at: at(T0 + 12 * MIN), payload: { post: SCOOP_ID, state: "withdrawn" } })]), /is withdrawn.*not taken up/s);
  for (const to of EXPORTABLE_STATES) assert.equal(go([scoopPost(), move(to)]).scoop.state, to);
  assert.deepEqual([...EXPORTABLE_STATES], ["picked-up", "scripted", "keyframed", "filmed", "published"]);
});

// ── 8 · the command ─────────────────────────────────────────────────────────

test("8 · the command's arguments are judged, and the file is named for the scoop", () => {
  const o = parseArgs(["--scoop", SCOOP_ID, "--world", "w", "--acts", "a", "--radius", "100", "--at", "1,2"]);
  assert.deepEqual([o.scoop, o.radius, o.at, o.step], [SCOOP_ID, 100, { x: 1, y: 2 }, 1]);
  assert.throws(() => parseArgs(["--scoop", SCOOP_ID, "--world", "w"], {}), /usage/);
  assert.throws(() => parseArgs(["--scoop", SCOOP_ID, "--world", "w", "--acts", "a", "--pg-url", "p"]), /name one source/);
  assert.throws(() => parseArgs(["--scoop", SCOOP_ID, "--world", "w", "--acts", "a", "--radius", "0"]), /radius is metres above 0/);
  assert.throws(() => parseArgs(["--bogus"]), /unknown argument --bogus/);
  // the store's address may come from MOMENT_PG_URL; a flag beats it, and --acts beats it
  const viaEnv = parseArgs(["--scoop", SCOOP_ID, "--world", "w"], { MOMENT_PG_URL: "postgres://env/db" });
  assert.equal(viaEnv.pgUrl, "postgres://env/db");
  assert.equal(parseArgs(["--scoop", SCOOP_ID, "--world", "w", "--pg-url", "postgres://flag/db"], { MOMENT_PG_URL: "postgres://env/db" }).pgUrl, "postgres://flag/db");
  assert.equal(parseArgs(["--scoop", SCOOP_ID, "--world", "w", "--acts", "a"], { MOMENT_PG_URL: "postgres://env/db" }).pgUrl, undefined);
  assert.throws(() => parseArgs(["--scoop", SCOOP_ID, "--world", "w"], {}), /usage/);
  assert.equal(fileNameFor(SCOOP_ID), "moment-errant-the-lantern-lighting.json");
});

// ── 11 · by window ──────────────────────────────────────────────────────────

test("11 · by window: the same file with scoop null and the manifest's line, the same screens, no state check; the arguments are judged", async () => {
  const { acts } = scene();
  const window = { fromMs: T0, toMs: T0 + 8 * MIN };
  const m = buildMoment({ window, at: { x: 0, y: 0 }, atLabel: "the mark ada/the-lantern", worldRef: "settlement/S111", acts, marks: MARKS, walk });
  assert.equal(m.scoop, null);
  assert.equal(m.manifest.scoop, null);
  assert.equal(m.manifest.mode, "window");
  assert.equal(m.manifest.note, "exported by window, no scoop (a pre-POS-780 moment)");
  assert.equal(m.manifest.world_ref, "settlement/S111");
  assert.equal(m.manifest.place_from, "the mark ada/the-lantern");
  const same = build();
  const bare = (xs) => xs.map(({ act: _a, id: _i, ...r }) => r);
  assert.deepEqual(bare(m.says), bare(same.says));
  assert.deepEqual(Object.keys(m.positions), Object.keys(same.positions));
  assert.ok(!JSON.stringify(m).includes("a private word"), "the same screens");
  assert.throws(() => buildMoment({ window, acts, marks: MARKS, walk }), /needs its window and its place/);
  // the archive loader takes the window and reads no scoop
  const dir = mkdtempSync(join(tmpdir(), "moment-export-win-"));
  writeFileSync(join(dir, "30.jsonl"), acts.map((a) => JSON.stringify(a)).join("\n") + "\n");
  const got = await loadFromArchive(dir, null, window);
  assert.deepEqual(got.scoopActs, []);
  assert.ok(got.acts.length > 0 && got.acts.every((a) => MOMENT_ACTIONS.includes(a.action)));
  // the arguments
  const o = parseArgs(["--window", "2026-10-16T03:14:00Z/2026-10-16T04:10:00Z", "--at", "berthillon/le-petit-berthillon", "--world", "w", "--acts", "a", "--world-ref", "S111"], {});
  assert.deepEqual([o.window.fromMs, o.window.toMs, o.atMark, o.worldRef], [Date.parse("2026-10-16T03:14:00Z"), Date.parse("2026-10-16T04:10:00Z"), "berthillon/le-petit-berthillon", "S111"]);
  assert.throws(() => parseArgs(["--window", "2026-10-16T03:14:00Z/2026-10-16T04:10:00Z", "--world", "w", "--acts", "a"], {}), /needs --at/);
  assert.throws(() => parseArgs(["--window", "2026-10-16T04:10:00Z/2026-10-16T03:14:00Z", "--at", "1,2", "--world", "w", "--acts", "a"], {}), /the end after the start/);
  assert.throws(() => parseArgs(["--window", "x/y", "--at", "1,2", "--world", "w", "--acts", "a"], {}), /two ISO instants/);
  assert.throws(() => parseArgs(["--scoop", SCOOP_ID, "--window", "2026-10-16T03:14:00Z/2026-10-16T04:10:00Z", "--at", "1,2", "--world", "w", "--acts", "a"], {}), /not both/);
});
