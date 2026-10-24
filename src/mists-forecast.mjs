// mists-forecast.mjs — WHEN THE MISTS REACH A MARK (WLD-38, the doorstep and
// placement half; the gate half shipped in World#194).
//
// Wright, AUTHORITY 2026-10-13T05:16:12Z: the forecast is the EARLIEST ACTUAL
// integer crossing at which the advancing Mists reach a mark — by the World
// engine's own interpolation, crossing by crossing over the authored schedule,
// never the next keyframe — with the FRINGE (sight shortened) and the WALL
// (hidden) reported separately. An unreadable forecast is NONFATAL and named
// `mists-forecast-unavailable: <why>`, never a false "clear". A mark the wall
// already stands over gets a warning, not a veto.
//
// ── ONE COMPUTATION, NOTHING STORED ─────────────────────────────────────────
//
// The engine owns the season: `mistsAt(c, mists)` interpolates the front per
// side between keyframes (and holds it after the last), and `mistsHere(p, m)`
// says, for a point, whether it is behind the wall (`inWall`) and how far it
// stands from it (`wallM`). The fringe is `fringe_m` wide: a point not in the
// wall but nearer to it than `fringeM` is in the fringe. Clearings are the
// engine's own exceptions — `mistsHere` already counts them as clear ground.
// This module adds no season, no schedule and no law; it asks the engine.
//
// A mark is its FOOTPRINT, not its centre: its outline ring (or its extent
// box), the whole area inside it. Whether the WALL reaches it is whether that
// area leaves the clear ground; whether the FRINGE does is whether it leaves
// the ground standing at least `fringe_m` from the wall. At any crossing the
// engine's clear ground is exactly its clear box together with its clearing
// circles (`mistsAt`'s `clear` and `clearings`; `mistsHere` reads them so), and
// the ground `fringe_m` clear of the wall is the same box drawn in by fringe_m
// together with the same circles drawn in by fringe_m (mistsHere's `wallM` is
// the larger of the two distances). So both questions are one question —
// does a polygon lie inside a union of one box and some discs — and it is
// answered EXACTLY, not by sampling (Bevel's review: a wall slit narrower than
// any sample step, or a pocket of wall between clearings inside an outline,
// is a reach a sampler misses). See § coverage. Every reach found is then
// confirmed by the engine itself at a witness point inside the footprint; a
// disagreement is reported as unavailable, never as clear.
//
// Every answer is computed at the read from the record's schedule and the
// marks as they stand. No notice is kept, nothing is delivered, no mark moves.

import { crossingSailsAt, currentCrossing } from "./crossings.mjs";
import { join } from "node:path";
import { importEngineAt } from "./world-branches.mjs"; // the doors' engine, at the newest blessing
import { plainReason, ownWordsError } from "./fault-words.mjs"; // POS-657: a read's plain reason, the raw error to the log

export const MISTS_FORECAST_UNAVAILABLE = "mists-forecast-unavailable";
const unavailable = (why) => ({ unavailable: `${MISTS_FORECAST_UNAVAILABLE}: ${why}` });

/** Points along a closed ring, in order: every corner and every `stepM` metres (the ring itself is what coverage reads). */
export function samplesOf(ring, stepM = 5) {
  const out = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (![a?.x, a?.y, b?.x, b?.y].every(Number.isFinite)) continue;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / stepM));
    for (let k = 0; k < n; k += 1) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

// ── coverage: does a polygon lie inside a box ∪ discs? ─────────────────────
//
// THE VERTICAL DECOMPOSITION. Cut the plane at every x where the picture can
// change: the polygon's corners, the box's sides, each disc's leftmost and
// rightmost x, and every crossing of two of the curves (polygon side × disc,
// polygon side × box top/bottom, disc × disc, disc × box top/bottom). Between
// two neighbouring cuts no curve begins, ends or crosses another, so each
// piece of the polygon outside the union spans the whole strip — and one
// vertical line through the strip's middle meets it. On that line everything
// is intervals: the polygon's spans, the box's span, each disc's chord. The
// polygon is covered exactly when every span of it on every middle line lies
// inside the union of the clear spans. The wall is OPEN (the engine counts
// the box's edge and a disc's rim as clear), so a reach always has area, and
// area is never thinner than a strip's middle line. Floating point aside, this
// misses nothing; the witness is then put back to the engine to confirm.

const EPS = 1e-9;
const ringOf = (poly) => {
  const pts = poly.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
  if (pts.length > 1 && pts[0].x === pts.at(-1).x && pts[0].y === pts.at(-1).y) pts.pop();
  return pts;
};

/** x where segment a→b meets the horizontal line y = Y (within the segment). */
const segAtY = (a, b, Y) => {
  if ((a.y - Y) * (b.y - Y) > 0 || a.y === b.y) return [];
  return [a.x + ((Y - a.y) * (b.x - a.x)) / (b.y - a.y)];
};
/** x where segment a→b meets the circle (c, r). */
const segAtCircle = (a, b, c) => {
  const dx = b.x - a.x, dy = b.y - a.y, fx = a.x - c.x, fy = a.y - c.y;
  const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - c.r * c.r;
  const disc = B * B - 4 * A * C;
  if (A === 0 || disc < 0) return [];
  const sq = Math.sqrt(disc);
  return [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].filter((t) => t >= -EPS && t <= 1 + EPS).map((t) => a.x + t * dx);
};
/** x where two circles meet. */
const circleAtCircle = (p, q) => {
  const d = Math.hypot(q.x - p.x, q.y - p.y);
  if (d === 0 || d > p.r + q.r || d < Math.abs(p.r - q.r)) return [];
  const a = (p.r * p.r - q.r * q.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, p.r * p.r - a * a));
  const mx = p.x + (a * (q.x - p.x)) / d;
  return [mx + (h * (q.y - p.y)) / d, mx - (h * (q.y - p.y)) / d];
};
/** x where a circle meets the horizontal line y = Y. */
const circleAtY = (c, Y) => { const h2 = c.r * c.r - (Y - c.y) ** 2; return h2 < 0 ? [] : [c.x - Math.sqrt(h2), c.x + Math.sqrt(h2)]; };

/** The polygon's spans on the vertical line x (even-odd). */
function polySpans(ring, x) {
  const ys = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if ((a.x <= x && x < b.x) || (b.x <= x && x < a.x)) ys.push(a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x));
  }
  ys.sort((p, q) => p - q);
  const spans = [];
  for (let i = 0; i + 1 < ys.length; i += 2) spans.push([ys[i], ys[i + 1]]);
  return spans;
}

/**
 * Is the polygon inside `box` ∪ `discs`? `box` is `{minX,maxX,minY,maxY}` or
 * null (empty); `discs` are `{x,y,r}`. Answers `{ covered: true }` or
 * `{ covered: false, witness: {x,y} }`, a point of the polygon outside both.
 */
export function coverage(poly, box, discs = []) {
  const ring = ringOf(poly);
  const ds = discs.filter((d) => d.r > 0);
  const b = box && box.minX <= box.maxX && box.minY <= box.maxY ? box : null;
  if (ring.length < 3) return { covered: true };
  const xs = new Set(ring.map((p) => p.x));
  if (b) { xs.add(b.minX); xs.add(b.maxX); }
  for (const d of ds) { xs.add(d.x - d.r); xs.add(d.x + d.r); }
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i], c = ring[(i + 1) % ring.length];
    if (b) for (const Y of [b.minY, b.maxY]) for (const x of segAtY(a, c, Y)) xs.add(x);
    for (const d of ds) for (const x of segAtCircle(a, c, d)) xs.add(x);
  }
  for (let i = 0; i < ds.length; i += 1) {
    if (b) for (const Y of [b.minY, b.maxY]) for (const x of circleAtY(ds[i], Y)) xs.add(x);
    for (let j = i + 1; j < ds.length; j += 1) for (const x of circleAtCircle(ds[i], ds[j])) xs.add(x);
  }
  const lo = Math.min(...ring.map((p) => p.x)), hi = Math.max(...ring.map((p) => p.x));
  const cuts = [...xs].filter((x) => x >= lo && x <= hi).sort((p, q) => p - q);
  for (let k = 0; k + 1 < cuts.length; k += 1) {
    if (cuts[k + 1] - cuts[k] <= EPS) continue;
    const x = (cuts[k] + cuts[k + 1]) / 2;
    const clear = [];
    if (b && x >= b.minX && x <= b.maxX) clear.push([b.minY, b.maxY]);
    for (const d of ds) { const h2 = d.r * d.r - (x - d.x) ** 2; if (h2 > 0) clear.push([d.y - Math.sqrt(h2), d.y + Math.sqrt(h2)]); }
    clear.sort((p, q) => p[0] - q[0]);
    for (const [y0, y1] of polySpans(ring, x)) {
      let at = y0;                                       // how far up this span is known clear
      for (const [c0, c1] of clear) { if (c0 > at + EPS) break; if (c1 > at) at = c1; }
      if (at < y1 - EPS) {
        // the first gap above `at`: its middle is outside the union
        const next = clear.find(([c0]) => c0 > at + EPS);
        const top = Math.min(y1, next ? next[0] : y1);
        return { covered: false, witness: { x, y: (at + top) / 2 } };
      }
    }
  }
  return { covered: true };
}

/**
 * Is the SEGMENT a→b inside `box` ∪ `discs`, every point of it? Exact: the
 * box clips it to one parameter interval (Liang–Barsky), each disc to another
 * (the chord's two roots); the segment is covered when their union covers
 * [0, 1]. Answers like `coverage`, the witness the middle of the first gap.
 * (Bevel's second review, C: the door admits a mark with only a width or only
 * a height — a footprint with no area — and its whole length is asked.)
 */
export function segmentCoverage(a, b, box, discs = []) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const spans = [];
  if (box && box.minX <= box.maxX && box.minY <= box.maxY) {
    let t0 = 0, t1 = 1, ok = true;
    for (const [pp, q] of [[-dx, a.x - box.minX], [dx, box.maxX - a.x], [-dy, a.y - box.minY], [dy, box.maxY - a.y]]) {
      if (pp === 0) { if (q < 0) { ok = false; break; } continue; }
      const t = q / pp;
      if (pp < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; }
      else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; }
    }
    if (ok && t0 <= t1) spans.push([t0, t1]);
  }
  const A = dx * dx + dy * dy;
  for (const d of discs) {
    if (!(d.r > 0)) continue;
    const fx = a.x - d.x, fy = a.y - d.y;
    if (A === 0) { if (fx * fx + fy * fy <= d.r * d.r) spans.push([0, 1]); continue; }
    const B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - d.r * d.r, disc = B * B - 4 * A * C;
    if (disc < 0) continue;
    const sq = Math.sqrt(disc), t0 = Math.max(0, (-B - sq) / (2 * A)), t1 = Math.min(1, (-B + sq) / (2 * A));
    if (t0 <= t1) spans.push([t0, t1]);
  }
  spans.sort((p, q) => p[0] - q[0]);
  let at = 0;
  for (const [t0, t1] of spans) {
    if (t0 > at + EPS) break;
    if (t1 > at) at = t1;
  }
  if (at >= 1 - EPS) return { covered: true };
  const next = spans.find(([t0]) => t0 > at + EPS);
  const t = (at + Math.min(1, next ? next[0] : 1)) / 2;
  return { covered: false, witness: { x: a.x + t * dx, y: a.y + t * dy } };
}

/**
 * The ring's area (shoelace), taken about its OWN first corner: a footprint far
 * from the world's origin would otherwise lose its area to cancellation
 * between large equal terms (Bevel's third review).
 */
const areaOf = (ring) => {
  const o = ring[0];
  return Math.abs(ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + (p.x - o.x) * (q.y - o.y) - (q.x - o.x) * (p.y - o.y); }, 0)) / 2;
};

/** The engine's clear ground at state `m`, drawn in by `inset` metres: the box and the clearing discs. */
const clearGround = (m, inset = 0) => {
  const c = m?.clear;
  if (!c || ![c.minX, c.maxX, c.minY, c.maxY].every(Number.isFinite)) throw new Error("the engine's Mists state carries no clear box");
  const box = { minX: c.minX + inset, maxX: c.maxX - inset, minY: c.minY + inset, maxY: c.maxY - inset };
  const discs = (Array.isArray(m.clearings) ? m.clearings : []).map((k) => ({ x: Number(k.x), y: Number(k.y), r: Number(k.r) - inset }))
    .filter((k) => [k.x, k.y, k.r].every(Number.isFinite));
  return { box, discs };
};

/**
 * Where a footprint (a polygon, its corners in order) stands at one Mists
 * state: "wall", "fringe" or "clear" — by exact coverage, each reach
 * confirmed by the engine's own `mistsHere` at its witness point. Throws when
 * the engine disagrees with the geometry, so the caller says unavailable.
 */
export function footprintState(eng, m, poly) {
  const pts = ringOf(poly);
  if (!pts.length) return "clear";
  // WHAT SHAPE THE GROUND IS (Bevel's second review, C). One point: the engine
  // answers it. No area — a line, or a ring folded flat (a box with no width or
  // no height, which the door admits) — every side is asked along its whole
  // length. Otherwise the area is asked whole (§ coverage).
  const distinct = pts.filter((p, i) => pts.findIndex((q) => q.x === p.x && q.y === p.y) === i);
  if (distinct.length === 1) {
    const h = eng.mistsHere(distinct[0], m);
    return h.inWall ? "wall" : Number(m.fringeM) > 0 && h.wallM < m.fringeM ? "fringe" : "clear";
  }
  // FLAT is judged against the footprint's OWN size — its bounding box —
  // never its distance from the world's origin: a shape moved across the map
  // is the same shape (Bevel's third review). A ring with no area at its own
  // scale is a line; a centimetre square is an area wherever it stands.
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const flat = pts.length < 3 || areaOf(pts) <= EPS * size * size;
  const sides = flat ? pts.map((p, i) => [p, pts[(i + 1) % pts.length]]).filter(([a, b]) => a.x !== b.x || a.y !== b.y) : null;
  const leaves = (ground) => {
    if (!flat) return coverage(pts, ground.box, ground.discs);
    for (const [a, b] of sides) { const c = segmentCoverage(a, b, ground.box, ground.discs); if (!c.covered) return c; }
    return { covered: true };
  };
  const w = leaves(clearGround(m, 0));
  if (!w.covered) {
    if (!eng.mistsHere(w.witness, m).inWall) throw new Error(`the engine does not put (${w.witness.x}, ${w.witness.y}) in the wall`);
    return "wall";
  }
  const F = Number(m.fringeM);
  if (!(F > 0)) return "clear";
  const f = leaves(clearGround(m, F));
  if (!f.covered) {
    const h = eng.mistsHere(f.witness, m);
    if (h.inWall || !(h.wallM < F)) throw new Error(`the engine does not put (${f.witness.x}, ${f.witness.y}) in the fringe`);
    return "fringe";
  }
  return "clear";
}

const scheduleOf = (mists) => (Array.isArray(mists?.schedule) ? mists.schedule : [])
  .map((k) => Number(k?.crossing)).filter(Number.isInteger).sort((a, b) => a - b);

/**
 * The first crossing, from `now` on, at which the fringe and the wall reach
 * this footprint — `null` for each that never does within the authored
 * schedule (after its last keyframe the front holds, so nothing changes). A
 * reach at or before `now` is the present, not a future arrival. The engine
 * must answer every crossing in the schedule: a null state there is a record
 * it cannot read (a missing border, say), and throws — never a clear.
 */
export function reachOf(eng, mists, poly, now) {
  const keys = scheduleOf(mists);
  if (!keys.length) throw new Error("the Mists record carries no schedule the engine can read");
  const last = keys[keys.length - 1];
  let fringe = null, wall = null;
  for (let c = Math.max(now, keys[0]); c <= Math.max(last, now); c += 1) {
    const m = eng.mistsAt(c, mists);
    if (!m) throw ownWordsError(`the engine gives no Mists state for crossing ${c}`);
    const st = footprintState(eng, m, poly);
    if (st !== "clear" && fringe == null) fringe = c;
    if (st === "wall") { wall = c; break; }
  }
  return { fringe, wall };
}

const day = (c) => crossingSailsAt(c).slice(0, 10);
const when = (c, now) => ({ crossing: c, date: day(c), now: c <= now });

/** The household's sentences for one mark — fringe and wall said apart; the mark stays theirs. */
export function sentencesFor(id, { fringe, wall }) {
  const says = [];
  if (fringe && (!wall || fringe.crossing < wall.crossing))
    says.push(fringe.now
      ? `${id} stands in the fringe of the Mists now: sight is shorter there, nothing is hidden, and it stays yours`
      : `the fringe of the Mists reaches ${id} from crossing ${fringe.crossing} (${fringe.date}): sight will be shorter there, nothing hidden, and it stays yours`);
  if (wall)
    says.push(wall.now
      ? `the wall of the Mists stands over ${id} now; it stays yours and comes back when they lift`
      : `the wall of the Mists reaches ${id} from crossing ${wall.crossing} (${wall.date}); it stays yours and comes back when they lift`);
  return says;
}

/** Import the World engine from a clone, at its newest blessing; null when it cannot be read. */
export async function mistsEngine(worldClone) {
  try {
    const eng = await importEngineAt(worldClone, "world-engine.mjs");
    return typeof eng.mistsAt === "function" && typeof eng.mistsHere === "function" ? eng : null;
  } catch { return null; }
}

/**
 * THE FORECAST for a list of `{ id, ring }` footprints. `skeleton` is the
 * world's skeleton (`undefined`/throwing reader = unreadable; one without
 * `mists` = no season at all). `nowMs` is the one clock for the read.
 *
 * Answers one of:
 *   · `{ season: false }` — the record carries no Mists: nothing to forecast;
 *   · `{ unavailable: "mists-forecast-unavailable: <why>" }` — it could not be
 *     read; never an empty, safe-looking answer;
 *   · `{ as_of: { crossing, date }, season_ends: N, reaches: [...] }` — every
 *     footprint the fringe or the wall reaches within the schedule, earliest
 *     crossings first. An empty `reaches` is a forecast that read and found
 *     nothing, which is different from no forecast.
 */
export async function forecastMists({ engine, skeleton, footprints = [], nowMs = Date.now() }) {
  // ONLY a readable skeleton that carries no `mists` is "no season". Nothing
  // read (undefined), a null read, or not an object at all is unknown.
  if (skeleton == null || typeof skeleton !== "object") return unavailable("the world's skeleton could not be read");
  if (!("mists" in skeleton) || skeleton.mists == null) return { season: false };
  const eng = engine ?? null;
  if (!eng) return unavailable("the World engine's Mists reading could not be loaded");
  const keys = scheduleOf(skeleton.mists);
  if (!keys.length) return unavailable("the Mists record carries no schedule the engine can read");
  const now = currentCrossing(nowMs);
  const reaches = [];
  try {
    // the engine must give a state for the season's own first crossing, footprints or none
    if (!eng.mistsAt(keys[0], skeleton.mists)) throw ownWordsError(`the engine gives no Mists state for crossing ${keys[0]}`);
    for (const f of footprints) {
      const r = reachOf(eng, skeleton.mists, f.ring ?? [], now);
      if (r.fringe == null && r.wall == null) continue;
      const out = { mark: f.id, fringe: r.fringe == null ? null : when(r.fringe, now), wall: r.wall == null ? null : when(r.wall, now) };
      reaches.push({ ...out, says: sentencesFor(f.id, out) });
    }
  } catch (e) {
    return unavailable(`the engine could not answer (${plainReason(e, "files", "the Mists forecast's engine")})`);
  }
  reaches.sort((a, b) => (a.fringe?.crossing ?? a.wall?.crossing) - (b.fringe?.crossing ?? b.wall?.crossing) || String(a.mark).localeCompare(String(b.mark)));
  return { as_of: { crossing: now, date: day(now) }, season_ends: keys[keys.length - 1], reaches };
}

// ── THE HOUSEHOLD'S DOORSTEP ────────────────────────────────────────────────

/**
 * The forecast for every PUBLISHED mark a household's residents made — the
 * marks on the town's map, which anyone may already see, so this block shows
 * nothing a stranger could not read off the map; no draft is read. Residents
 * come from the household registry (every spelling the house answers to
 * resolves to the same block), not from one handle.
 *
 * Answers the doorstep block, or `null` when there is nothing to say: no world
 * this office is pointed at, no Mists on the record, or none of the house's
 * marks reached within the schedule. A world that IS there and cannot be read
 * answers `unavailable` — unknown is never empty.
 */
let depsForTest = null;
/** A test's world (the doorstep doors build their own context, so their tests reach it here). */
export function __setMistsDepsForTest(d) { depsForTest = d; }

export async function householdMistsForecast(handle, { nowMs = Date.now(), deps = null } = {}) {
  const d = deps ?? depsForTest ?? await liveDeps();
  if (!d.pointed()) return null;
  const block = (body) => ({ serves: "world.mists", args: { handle }, ...body });
  const fail = (why) => block(unavailable(why));
  // WHO IS THE HOUSE. The registry's answer, or — when this office reads no
  // registry at all — the handle alone, SAID on the block. A registry that
  // should answer and cannot (null, or a throw) is unknown: the house is not
  // quietly shrunk to one resident (Bevel's review, A3).
  let house;
  try { house = await d.household(handle); } catch (e) { return fail(`the household registry could not be read (${plainReason(e, "record", "the Mists forecast's household registry")})`); }
  if (!house || !Array.isArray(house.residents)) return fail("the household registry could not be read, so the house's residents are unknown");
  const residents = new Set([String(handle), ...house.residents.map(String)]);
  let marks, skeleton;
  try { marks = (d.publishedMarks() ?? []).filter((m) => m?.id && residents.has(String(m.by ?? String(m.id).split("/")[0]))); }
  catch (e) { return fail(`the house's published marks could not be read (${plainReason(e, "files", "the Mists forecast's published marks")})`); }
  try { skeleton = d.skeleton(); } catch { skeleton = undefined; }
  if (!marks.length && skeleton != null && typeof skeleton === "object") return null;   // nothing of theirs stands: nothing to say
  const engine = skeleton?.mists ? await d.engine() : null;
  // EVERY MARK'S GROUND, or why not (A4): a footprint that cannot be read is
  // named, never skipped. A mark with no place on the map has no ground to reach.
  const footprints = [];
  for (const m of marks) {
    let ring;
    try { ring = await d.ringOf(m); } catch (e) { return fail(`the ground of ${m.id} could not be read (${plainReason(e, "files", "the Mists forecast's ground")})`); }
    if (ring?.length) footprints.push({ id: String(m.id), ring });
  }
  const f = await forecastMists({ engine, skeleton, footprints, nowMs });
  if (f.unavailable) return block({ unavailable: f.unavailable });
  if (f.season === false || !f.reaches.length) return null;
  return block({ ...f, ...(house.unasked ? { household: `this office reads no household registry, so this covers ${handle}'s own marks only` } : {}) });
}

/** The live collaborators: the published world, the registry, the engine. Every one is injectable. */
async function liveDeps() {
  const [{ existsSync }, { WORLD_CLONE, groundRingOf, parcelDial }, branches] = await Promise.all([
    import("node:fs"), import("./world.mjs"), import("./world-branches.mjs")]);
  return {
    pointed: () => existsSync(join(String(WORLD_CLONE), ".git")) || existsSync(join(String(WORLD_CLONE), "WORLD")),
    // the registry's rows: null = this office reads none (not asked); a throw = it could not
    household: async (h) => {
      const [{ loadRegistryRows }, { registryFromRows, pinsFromRows }, { householdLookupOf }] = await Promise.all([
        import("./registry-store.mjs"), import("./registry-rows.mjs"), import("./households.mjs")]);
      const rows = await loadRegistryRows();
      if (rows === null) return { residents: [String(h)], unasked: true };
      return householdLookupOf(registryFromRows(rows), pinsFromRows(rows))(h);
    },
    publishedMarks: () => branches.publishedState(WORLD_CLONE).state?.marks ?? [],
    skeleton: () => branches.publishedSkeleton(WORLD_CLONE).skeleton ?? null,
    engine: () => mistsEngine(WORLD_CLONE),
    // a mark's ground: its ring, its box, a parcel's dial-sized box, or its one point;
    // null only for a mark with no place on the map. A dial that cannot be read throws.
    ringOf: async (m) => {
      if (m?.points || m?.extent) return groundRingOf(m);
      if (m?.kind === "parcel" && m?.at) { const box = await parcelDial(); return groundRingOf({ ...m, extent: box }); }
      if (Number.isFinite(m?.at?.x) && Number.isFinite(m?.at?.y)) return [{ x: m.at.x, y: m.at.y }];
      return null;
    },
  };
}
