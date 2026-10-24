#!/usr/bin/env node
// moment-export.mjs — THE FOUNDER-ONLY MOMENT EXPORT (POS-780).
//
// Given a scoop (class `scoop`, scoops.mjs), write ONE FILE holding everything
// the record says about that moment: every public act in its window, every said
// line, every position, the marks in view and their image URLs. It is what the
// journalist's script worker reads to turn a scoop into a shot list.
//
//   node tools/moment-export.mjs --scoop errant/the-lantern-lighting --acts <notary archives/acts dir or one .jsonl> \
//        --world <a postmark-world checkout> [--out <dir>] [--radius 250] [--step 1] [--at x,y]
//   MOMENT_PG_URL=postgres://… node tools/moment-export.mjs --scoop … --world <checkout>   # a sandbox or dev store (or --pg-url)
//
// ── A FOUNDER'S TOOL, NOT A RESIDENT'S DOOR ─────────────────────────────────
//
// It is run by hand on a founder's or operator's machine. It makes no MCP call
// and no box call and adds no door: it reads the acts (the notary archive, which
// is the record's private frozen copy, or a store you name), and the world
// checkout you point it at. Nothing it reads is changed, and nothing leaves the
// file it writes.
//
// ── THE PRIVACY FILTER ──────────────────────────────────────────────────────
//
// The export keeps only the PUBLIC ACT CLASSES, by an allowlist of actions
// (MOMENT_ACTIONS): walk, say, enter, exit, ride, take, give, drop, leave-mark,
// and their pre-pen spellings. Letters, drafts, notes to self, stances,
// declarations, stakes and every other action are never read into the file, and
// a test holds the list. It screens FIELDS as well as actions: each action keeps
// a named list of payload fields (PAYLOAD_FIELDS) and nothing else is copied, so
// `stamps`, `put_forward`, `_consent` and `_placed_by` never reach the file; and a
// leave-mark is kept only when its payload says `put_forward === true` (a draft's
// deed is not public). That draft screen is this tool's own: it does not depend on
// the office's candle switch having kept drafts out of `acts`. This is the first of two passes: the
// consent pass (design § 3.3) is the NEXT stage's, run on the file against each
// resident's likeness card, and this file says so in its manifest.
//
// ── THE MOMENT'S SHAPE ──────────────────────────────────────────────────────
//
//   window   the scoop's own starts to ends
//   place    the scoop's place; or, if it named none, where the scooper stood at
//            the window's end (--at x,y overrides both)
//   in view  a resident is in view if, at any sampled second of the window, the
//            engine's own `positionAt` puts them within --radius metres of the
//            place; their whole trajectory is then written, one sample a second
//   acts     every public act in the window by someone in view at that second,
//            anchored within the radius, or naming a mark in view
//   says     the acts that are words, with the point each was said from
//   marks    the standing marks whose footprint reaches the radius, with their
//            image URLs (the bytes are NOT fetched: the URL is the reference),
//            and the marks left in the window itself
//
// NOT INCLUDED, said in the manifest: the telling and the air line (a pure
// function of the world's sha and a standpoint; the next stage re-derives them),
// image bytes, and any consent check.

import { createReadStream, readdirSync, statSync, writeFileSync, mkdirSync, existsSync, realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { foldPostActs } from "../src/events.mjs";
import { SCOOP_CLASS } from "../src/scoops.mjs";
import { composeAnchor, WORLD_ANCHOR } from "../src/world-journal.mjs";
import { departureRecordOf, DEPARTURE_ACTIONS, DEPARTURE_ORDER_KEYS } from "../world2/tools/live-reads.mjs";
import { voiceOf, VOICE_ACTIONS } from "../world2/tools/conversations.mjs";

/** The public act classes, by action. Everything else is never read into the file. */
export const MOMENT_ACTIONS = Object.freeze([
  "walk", "land", "say", "enter", "exit", "ride", "take", "give", "drop", "leave-mark",
  "legacy:departure", "legacy:emission", "emission", "legacy:enter", "legacy:exit", "legacy:leave-mark",
]);
const DEPARTURES = new Set(DEPARTURE_ACTIONS);
const MOMENT_SET = new Set(MOMENT_ACTIONS);

// THE FIELD SCREEN. Each public action keeps these payload fields and no others.
// Anything not named here (stamps, put_forward, _consent, _placed_by, _deferred_act,
// declared households, a future field nobody has judged) is dropped when the act is
// read, before anything can use it.
const DEPARTURE_FIELDS = Object.freeze(["from", "toward", "to", "within", "pace", "declared_by", "lines", "at", "iso", "handle", "_ledger", "line", "targetExtent", "targetMarkId"]);
const HOLDING_FIELDS = Object.freeze(["thing", "holder", "previous_holder", "policy", "made_by", "to", "from"]);
const FRAME_FIELDS = Object.freeze(["lines", "mark", "to", "from"]);
export const PAYLOAD_FIELDS = Object.freeze({
  walk: DEPARTURE_FIELDS, land: DEPARTURE_FIELDS, "legacy:departure": DEPARTURE_FIELDS,
  say: Object.freeze(["text", "place", "aboard"]),
  enter: FRAME_FIELDS, exit: FRAME_FIELDS, "legacy:enter": FRAME_FIELDS, "legacy:exit": FRAME_FIELDS,
  ride: Object.freeze(["origin", "to", "distance_m", "arrives_at", "pace_km_per_crossing"]),
  take: HOLDING_FIELDS, give: HOLDING_FIELDS, drop: HOLDING_FIELDS,
  "leave-mark": Object.freeze(["at", "by", "body", "date", "kind", "slug", "image", "extent", "parent", "points"]),
  "legacy:leave-mark": Object.freeze(["at", "by", "body", "date", "kind", "slug", "image", "extent", "parent", "points"]),
  "legacy:emission": Object.freeze(["at", "payload"]),
  emission: Object.freeze(["at", "payload"]),
});
const EMISSION_FIELDS = Object.freeze(["class", "text", "x", "y", "place", "spoken_by", "aboard"]);
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && Object.hasOwn(o, k) && o[k] !== undefined).map((k) => [k, o[k]]));

/**
 * One `acts` row, screened: `null` for an action off the allowlist, or for a leave-mark
 * whose payload does not say `put_forward === true`; otherwise the normalised act with
 * only its action's named payload fields.
 */
export function screenAct(row) {
  if (!MOMENT_SET.has(row?.action)) return null;
  if (row.action === "leave-mark" && payloadOf(row).put_forward !== true) return null;   // before anything else is read
  const a = normaliseAct(row);
  const kept = pick(a.payload, PAYLOAD_FIELDS[a.action] ?? []);
  if (kept.payload && typeof kept.payload === "object") kept.payload = a.action.endsWith("emission") ? pick(kept.payload, EMISSION_FIELDS) : pick(kept.payload, ["lines"]);
  return { ...a, payload: kept };
}
/** A scoop is exported only once the founders have taken it up: not while `scooped`, and not once `passed` or `withdrawn`. */
export const EXPORTABLE_STATES = Object.freeze(["picked-up", "scripted", "keyframed", "filmed", "published"]);
/** What the file says it leaves out. */
export const NOT_INCLUDED = Object.freeze([
  "the consent pass: every resident in the file still has to be checked against their likeness card before anyone is drawn",
  "the telling and the air line: re-derive them from the world sha in the manifest and a standpoint",
  "image bytes: marks carry their image URLs, which the media door serves",
]);
/** What the positions do and do not say. */
export const POSITION_NOTES = Object.freeze([
  "a position is null before a resident's first departure in the record: it places them nowhere, and the town reads that as the Origin, which this file does not guess",
  "a resident with no walk on record has no trajectory (trajectory: false) even when their acts were within the radius; their acts and says are still here, with the point each was made from",
]);

export const DEFAULT_RADIUS_M = 250;
export const DEFAULT_STEP_S = 1;
const SLACK_M = 25;            // the coarse pass's margin: a walker covers ~14 m in 10 s
const COARSE_S = 10;

const payloadOf = (row) => (typeof row?.payload === "string" ? JSON.parse(row.payload) : (row?.payload ?? {}));
const msOf = (v) => (v instanceof Date ? v.getTime() : Date.parse(String(v)));
const iso = (ms) => new Date(ms).toISOString();
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const round1 = (n) => Math.round(n * 10) / 10;

/** An `acts` row in the one shape this file reads: `at` an ISO string, `payload` an object. */
export function normaliseAct(row) {
  return {
    id: Number(row.id), at: iso(msOf(row.at)), crossing: row.crossing == null ? null : String(row.crossing),
    actor: row.actor ?? null, action: row.action, object: row.object ?? null,
    at_anchor: row.at_anchor ?? null, at_dx: row.at_dx == null ? null : Number(row.at_dx), at_dy: row.at_dy == null ? null : Number(row.at_dy),
    class: row.class ?? null, payload: payloadOf(row), household: row.household ?? null,
  };
}

// ── the loaders ─────────────────────────────────────────────────────────────

/** The archive's files, oldest window first: one .jsonl, or a directory of `<window>.jsonl`. */
export function archiveFiles(path) {
  const p = resolve(path);
  if (!existsSync(p)) throw new Error(`no such archive: ${p}`);
  if (statSync(p).isFile()) return [p];
  return readdirSync(p).filter((f) => f.endsWith(".jsonl"))
    .sort((a, b) => (parseInt(a, 10) - parseInt(b, 10)) || a.localeCompare(b)).map((f) => join(p, f));
}

async function eachLine(file, fn, needle = null) {
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line || (needle && !line.includes(needle))) continue;
    fn(JSON.parse(line));
  }
}

/**
 * Read what a moment needs from the notary's JSONL archive: the scoop's own
 * acts, then (once its window is known) the public acts inside the window and
 * each actor's governing departure at the window's start. Two passes, the first
 * cheap (a line is parsed only if it names the scoop).
 */
export async function loadFromArchive(path, scoopId) {
  const files = archiveFiles(path);
  const scoopActs = [];
  for (const f of files) await eachLine(f, (r) => { if (r.class === SCOOP_CLASS && r.object === scoopId) scoopActs.push(normaliseAct(r)); }, scoopId);
  const window = windowOf(scoopActs, scoopId);
  const keep = momentCollector(window);
  for (const f of files) await eachLine(f, (r) => { if (MOMENT_SET.has(r.action)) keep.add(r); });   // add() screens
  return { scoopActs, acts: keep.rows(), source: { kind: "notary-archive", path: resolve(path), files: files.length } };
}

/** Read the same from a store you name (a sandbox or dev Postgres), as a read-only transaction. */
export async function loadFromStore(pgUrl, scoopId) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: pgUrl });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const { rows: s } = await client.query("SELECT * FROM acts WHERE class = $1 AND object = $2 ORDER BY id", [SCOOP_CLASS, scoopId]);
    const scoopActs = s.map(normaliseAct);
    const window = windowOf(scoopActs, scoopId);
    const inWindow = await client.query(
      "SELECT * FROM acts WHERE action = ANY($1) AND at >= $2 AND at <= $3 ORDER BY at, id", [[...MOMENT_ACTIONS], iso(window.fromMs), iso(window.toMs)]);
    const governing = await client.query(
      "SELECT DISTINCT ON (actor) * FROM acts WHERE action = ANY($1) AND at < $2 ORDER BY actor, at DESC, id DESC", [[...DEPARTURES], iso(window.fromMs)]);
    await client.query("COMMIT");
    const keep = momentCollector(window);
    for (const r of [...governing.rows, ...inWindow.rows]) keep.add(r);
    return { scoopActs, acts: keep.rows(), source: { kind: "store", note: "read-only transaction on the named store" } };
  } finally { await client.end(); }
}

/** The scoop's window, from its acts alone. */
function windowOf(scoopActs, scoopId) {
  if (!scoopActs.some((a) => a.action === "post"))
    throw new Error(`no scoop "${scoopId}" in this source: its post act is not here (the notary archives once a day, so a scoop from today may not be in the archive yet)`);
  const row = foldPostActs(scoopActs).posts.get(scoopId);
  return { fromMs: msOf(row.starts), toMs: msOf(row.ends) };
}

/** Collects the public acts inside the window and the latest departure of each actor before it. */
function momentCollector({ fromMs, toMs }) {
  const inside = [];
  const before = new Map();   // actor → the latest departure at or before the window's start
  return {
    add(r) {
      const a = screenAct(r);
      if (!a) return;
      const t = msOf(a.at);
      if (t >= fromMs && t <= toMs) inside.push(a);
      if (t < fromMs && DEPARTURES.has(a.action) && a.actor) {
        const was = before.get(a.actor);
        if (!was || t > msOf(was.at) || (t === msOf(was.at) && a.id > was.id)) before.set(a.actor, a);
      }
    },
    rows: () => [...before.values(), ...inside].sort((x, y) => msOf(x.at) - msOf(y.at) || x.id - y.id),
  };
}

// ── the world ───────────────────────────────────────────────────────────────

/** The engine modules and the world's marks, from a postmark-world checkout. */
export async function loadWorld(worldDir) {
  const root = resolve(worldDir);
  const walk = await import(pathToFileURL(join(root, "tools", "walk.mjs")).href);
  const fold = await import(pathToFileURL(join(root, "tools", "marks-fold.mjs")).href);
  const marks = fold.loadMarks(join(root, "WORLD", "marks"));
  let sha = null;
  try { sha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }
  return { walk, marks, sha, root };
}

// ── the moment (pure) ───────────────────────────────────────────────────────

/** Departures per actor, in the record's own order (DEPARTURE_ORDER_KEYS), as `{ rec, ms, id }`. */
function departuresOf(acts, walk) {
  const by = new Map();
  const refused = [];
  for (const a of acts) {
    if (!DEPARTURES.has(a.action) || !a.actor) continue;
    const got = departureRecordOf({ ...a, at: new Date(a.at) });
    if (got.refused) { refused.push(got.reason); continue; }
    const ms = Math.round(walk.CROSSING_EPOCH_UTC + Number(got.record.at) * walk.CROSSING_MS);
    if (!by.has(a.actor)) by.set(a.actor, []);
    by.get(a.actor).push({ rec: got.record, ms, row: { ...a, at: new Date(a.at) } });
  }
  for (const list of by.values()) list.sort((x, y) => {
    for (const k of DEPARTURE_ORDER_KEYS) {
      const a = k.of(x.row), b = k.of(y.row);
      if (a !== b) return (a ?? -Infinity) < (b ?? -Infinity) ? -1 : 1;
    }
    return 0;
  });
  return { by, refused };
}

/** Where a resident stood at `ms`: the engine's `positionAt` on the departure governing that instant, or null. */
function positionOf(list, ms, walk) {
  if (!list) return null;
  let gov = null;
  for (const d of list) if (d.ms <= ms) gov = d; else break;
  if (!gov) return null;
  const p = walk.positionAt(gov.rec, walk.fractionalCrossing(ms));
  return p ? { x: p.x, y: p.y } : null;
}

// An act's own point: its anchor and offset, composed. conversations.mjs vendors a
// composeAnchor whose world anchor is "world"; the office's is WORLD_ANCHOR. Both
// spellings are the world's own origin, so both compose.
const spotOf = (a, centreOf) => {
  if (!a.at_anchor) return null;
  if (a.at_anchor === "world") return composeAnchor({ anchor: WORLD_ANCHOR, dx: a.at_dx, dy: a.at_dy }, centreOf);
  return composeAnchor({ anchor: a.at_anchor, dx: a.at_dx, dy: a.at_dy }, centreOf);
};

const imageOf = (m) => (typeof m?.image === "string" && m.image ? m.image : null);

/**
 * Build the moment. Pure over its inputs: `scoopActs` and `acts` (normalised),
 * `marks` (the world's records, in world coordinates), `walk` (the engine's
 * walk.mjs). Returns the file's whole content.
 */
export function buildMoment({ scoopId, scoopActs, acts, marks, walk, worldSha = null, source = null, radius = DEFAULT_RADIUS_M, stepS = DEFAULT_STEP_S, at = null, now = Date.now() }) {
  const scoop = foldPostActs(scoopActs).posts.get(scoopId);
  if (!scoop) throw new Error(`no scoop "${scoopId}" in the acts given`);
  if (!EXPORTABLE_STATES.includes(scoop.state))
    throw new Error(`"${scoopId}" is ${scoop.state}, and the export reads a moment only for a moment the journalist takes up: ${scoop.state === "scooped" ? "advance it to picked-up first (town { do: \"advance\", args: { post, to: \"picked-up\" } })" : "a " + scoop.state + " scoop is not taken up"}`);
  const fromMs = msOf(scoop.starts), toMs = msOf(scoop.ends);
  const standing = marks.filter((m) => m.at && Number.isFinite(m.at.x) && Number.isFinite(m.at.y));
  const centres = new Map(standing.map((m) => [m.id, m.at]));
  const centreOf = (id) => centres.get(id) ?? null;

  const moment = acts.map(screenAct).filter(Boolean);   // the privacy screen, again, on whatever the loader handed over
  const { by: deps, refused } = departuresOf(moment, walk);

  // the place
  let place; let placeFrom;
  if (at) { place = at; placeFrom = "the --at given"; }
  else if (scoop.place_x != null) { place = { x: Number(scoop.place_x), y: Number(scoop.place_y) }; placeFrom = scoop.place_mark ? `the scoop's place (${scoop.place_mark})` : "the scoop's place"; }
  else {
    const here = positionOf(deps.get(scoop.author), toMs, walk);
    if (!here) throw new Error(`the scoop names no place and ${scoop.author}'s position at its end is not in the record: pass --at x,y`);
    place = { x: round1(here.x), y: round1(here.y) }; placeFrom = `where ${scoop.author} stood at the window's end`;
  }

  // who is in view: a coarse pass finds the candidates, a fine pass samples them
  const candidates = new Set();
  for (let t = fromMs; t <= toMs + 1; t += COARSE_S * 1000)
    for (const [h, list] of deps) { const p = positionOf(list, Math.min(t, toMs), walk); if (p && dist(p, place) <= radius + SLACK_M) candidates.add(h); }
  const positions = {};
  const inView = new Set();
  for (const h of [...candidates].sort()) {
    const list = deps.get(h);
    const points = [];
    for (let t = fromMs; t <= toMs; t += stepS * 1000) {
      const p = positionOf(list, t, walk);
      points.push(p ? [round1(p.x), round1(p.y)] : null);
      if (p && dist(p, place) <= radius) inView.add(h);
    }
    positions[h] = { from: iso(fromMs), step_s: stepS, points };
  }
  for (const h of Object.keys(positions)) if (!inView.has(h)) delete positions[h];

  // marks in view
  const reach = (m) => (m.extent ? Math.hypot(m.extent.w ?? 0, m.extent.h ?? 0) / 2 : 0);
  const near = standing.filter((m) => dist(m.at, place) <= radius + reach(m));
  const nearIds = new Set(near.map((m) => m.id));
  const markRow = (m, source) => ({ id: m.id, kind: m.kind ?? null, by: m.by ?? null, at: m.at, extent: m.extent ?? null, image: imageOf(m),
    body: String(m.body ?? "").slice(0, 600), source });
  const markRows = near.map((m) => markRow(m, "world")).sort((a, b) => a.id.localeCompare(b.id));
  const seenIds = new Set(markRows.map((m) => m.id));

  // the acts of the moment
  const inWindow = moment.filter((a) => { const t = msOf(a.at); return t >= fromMs && t <= toMs; });
  const here = (h, t) => { const p = positionOf(deps.get(h), t, walk); return p && dist(p, place) <= radius; };
  const kept = [];
  const unplaced = [];
  for (const a of inWindow) {
    const t = msOf(a.at);
    const spot = spotOf(a, centreOf);
    const p = payloadOf(a);
    const objectInView = typeof a.object === "string" && nearIds.has(a.object);
    if ((spot && dist(spot, place) <= radius) || here(a.actor, t) || objectInView || (a.action === "leave-mark" && p?.at && dist(p.at, place) <= radius)) {
      kept.push(a);
      if (a.action === "leave-mark" && a.object && !seenIds.has(a.object)) {
        seenIds.add(a.object);   // the act's own object is the mark's id, by/slug; the payload carries the bare slug and `by`
        markRows.push({ id: a.object, kind: p.kind ?? null, by: p.by ?? a.actor, at: p.at ?? null, extent: p.extent ?? null, image: typeof p.image === "string" ? p.image : null,
          body: String(p.body ?? "").slice(0, 600), source: `act ${a.id}` });
      }
    } else if (!spot && a.at_anchor) unplaced.push(a.id);
  }

  // says: the acts that are words, with the point each was said from
  const says = [];
  for (const a of kept) {
    if (!VOICE_ACTIONS.includes(a.action)) continue;
    if (a.action === "say") {
      const p = payloadOf(a);
      const spot = spotOf(a, centreOf);
      says.push({ act: a.id, at: a.at, speaker: a.actor, text: String(p.text ?? ""), x: spot?.x ?? null, y: spot?.y ?? null, place: p.place ?? null,
        ...(spot ? {} : { note: "this say's anchor does not compose to a point (its mark is gone from the world)" }) });
      continue;
    }
    const v = voiceOf({ ...a, at: new Date(a.at) }, centreOf);   // the pre-pen eras: a crossing log's emission carries its own x,y
    if (v.voice) says.push({ act: a.id, at: iso(v.voice.at), speaker: v.voice.handle, text: v.voice.text, x: v.voice.x, y: v.voice.y, place: v.voice.place });
    else if (v.refused) says.push({ act: a.id, at: a.at, speaker: a.actor, text: "", x: null, y: null, place: null, note: v.reason });
  }

  const residents = new Map();
  const note = (h, via) => { if (!h) return; const r = residents.get(h) ?? { handle: h, household: null, in_view: false, trajectory: false, acts: 0 }; if (via === "act") r.acts += 1; residents.set(h, r); };
  for (const h of Object.keys(positions)) { note(h); residents.get(h).in_view = true; residents.get(h).trajectory = true; }
  for (const a of kept) { note(a.actor, "act"); const r = residents.get(a.actor); if (r && a.household && !r.household) r.household = a.household; }

  return {
    manifest: {
      tool: "tools/moment-export.mjs", exported_at: iso(now), format: 1,
      scoop: scoopId, source, world_sha: worldSha,
      window: { starts: iso(fromMs), ends: iso(toMs) }, place, place_from: placeFrom, radius_m: radius, step_s: stepS,
      counts: { acts: kept.length, says: says.length, residents: residents.size, in_view: Object.keys(positions).length, marks: markRows.length },
      public_actions: [...MOMENT_ACTIONS],
      refused_departures: refused, unplaced_acts: unplaced, position_notes: [...POSITION_NOTES],
      not_included: [...NOT_INCLUDED],
    },
    scoop: { id: scoopId, title: scoop.title, note: scoop.body, scooper: scoop.author, household: scoop.household, state: scoop.state, fields: scoop.fields,
      window: { starts: iso(fromMs), ends: iso(toMs) }, place: scoop.place_x == null ? null : { mark: scoop.place_mark ?? null, x: Number(scoop.place_x), y: Number(scoop.place_y) } },
    residents: [...residents.values()].sort((a, b) => a.handle.localeCompare(b.handle)),
    says,
    acts: kept.map((a) => ({ id: a.id, at: a.at, actor: a.actor, action: a.action, object: a.object, at_anchor: a.at_anchor, at_dx: a.at_dx, at_dy: a.at_dy, payload: a.payload })),
    positions,
    marks: markRows,
  };
}

// ── the command ─────────────────────────────────────────────────────────────

const USAGE = `usage: node tools/moment-export.mjs --scoop <author/slug> --world <postmark-world checkout> (--acts <archives/acts dir or .jsonl> | --pg-url <postgres url, or MOMENT_PG_URL>)
       [--out <dir>] [--radius ${DEFAULT_RADIUS_M}] [--step ${DEFAULT_STEP_S}] [--at x,y]`;

export const PG_URL_ENV = "MOMENT_PG_URL";

export function parseArgs(argv, env = process.env) {
  const o = { radius: DEFAULT_RADIUS_M, step: DEFAULT_STEP_S, out: "." };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => { if (i + 1 >= argv.length) throw new Error(`${k} needs a value\n${USAGE}`); return argv[++i]; };
    if (k === "--scoop") o.scoop = v();
    else if (k === "--acts") o.acts = v();
    else if (k === "--pg-url") o.pgUrl = v();
    else if (k === "--world") o.world = v();
    else if (k === "--out") o.out = v();
    else if (k === "--radius") o.radius = Number(v());
    else if (k === "--step") o.step = Number(v());
    else if (k === "--at") { const [x, y] = v().split(",").map(Number); o.at = { x, y }; }
    else throw new Error(`unknown argument ${k}\n${USAGE}`);
  }
  // the store's address may come from the environment (a URL on the command line is in the process list); a flag beats it
  if (!o.acts && !o.pgUrl && env[PG_URL_ENV]) o.pgUrl = env[PG_URL_ENV];
  if (!o.scoop || !o.world || (!o.acts && !o.pgUrl)) throw new Error(USAGE);
  if (o.acts && o.pgUrl) throw new Error(`name one source, --acts or --pg-url\n${USAGE}`);
  if (!(o.radius > 0) || !(o.step >= 1)) throw new Error(`--radius is metres above 0 and --step whole seconds from 1\n${USAGE}`);
  if (o.at && !(Number.isFinite(o.at.x) && Number.isFinite(o.at.y))) throw new Error(`--at is x,y in metres\n${USAGE}`);
  return o;
}

export const fileNameFor = (scoopId) => `moment-${scoopId.replace(/[^a-z0-9]+/gi, "-")}.json`;

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const world = await loadWorld(o.world);
  const loaded = o.acts ? await loadFromArchive(o.acts, o.scoop) : await loadFromStore(o.pgUrl, o.scoop);
  const moment = buildMoment({ scoopId: o.scoop, scoopActs: loaded.scoopActs, acts: loaded.acts, marks: world.marks, walk: world.walk,
    worldSha: world.sha, source: loaded.source, radius: o.radius, stepS: o.step, at: o.at });
  mkdirSync(resolve(o.out), { recursive: true });
  const file = join(resolve(o.out), fileNameFor(o.scoop));
  writeFileSync(file, JSON.stringify(moment, null, 1) + "\n");
  const c = moment.manifest.counts;
  console.log(`wrote ${file}\n  ${moment.scoop.title} · ${moment.manifest.window.starts} to ${moment.manifest.window.ends} · place ${moment.manifest.place.x},${moment.manifest.place.y} (${moment.manifest.place_from}), radius ${o.radius} m`);
  console.log(`  ${c.acts} acts, ${c.says} says, ${c.in_view} residents in view (${c.residents} in all), ${c.marks} marks; world ${moment.manifest.world_sha?.slice(0, 9) ?? "unknown"}`);
  console.log("  not included: the consent pass, the telling and the air line, image bytes (see manifest.not_included)");
}

// the entry guard compares REAL paths (cli-guard.test.mjs: a junction or symlink path must still run the tool)
function isEntry() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
}
if (isEntry()) {
  main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
