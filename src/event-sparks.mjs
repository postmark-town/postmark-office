// event-sparks.mjs — WHAT AN EVENT LEAVES BEHIND (POS-1035; CORE-70 calls 4, 12, 13, 16, 17, 22, 25; WLD-173's office half).
//
// THE EVIDENCE OF AN EVENT, from the record and nothing else. For an event that has opened its doors, the office answers:
//   · its WINDOW — `fields.doors_open ?? starts` through `ends`, the canonical post's own instants (frozen frame, 16:44Z), never
//     the filing date, a room's started/latest or the current time;
//   · its ROOM — the conversation that formed at the event's place in that window: the say record clustered exactly as the
//     conversations page clusters it (world2/tools/conversations.mjs, one place per settlement, carried across one by CORE-97),
//     scoped to the window, the cluster with a voice within earshot of the place. Its thread is the conversations page's own;
//   · who was THERE — `present`: the households with a PUBLIC act at the place in the window (call 4). Never RSVPs, never who is
//     standing there now, never a guessed membership: the act's own `household`, as the record attributed it when it was taken.
// The site reads these; it never works out a room, a window or attendance itself (CORE-82).
//
// THE SPARK'S FRAME (POS-1035-room-spark-frame.md, frozen). A real room's absolute bounds become the record's centred frame —
// `at` the exact midpoint (halves kept), `extent` the exact differences (zero kept) — with no rounding, padding or minimum. With
// NO conversation the frame is the event's place and the ruled 60 m radius (120 × 120). A room that cannot be read is NOT "no
// conversation": it is unavailable, and nothing falls back to the radius on its account.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as talk from "../world2/tools/conversations.mjs";
import { PUBLIC_ACTS } from "./world-read-v2.mjs";
import { publicActSql } from "./hearth-public.mjs";

// ── THE HOSTING STAKE (call 22; Darko 11:00 EST and 17:37:45Z) ───────────────
//
// Posting an event stakes EVENT_STAKE of the POSTING RESIDENT'S OWN liquid stamps: firm — below it the act refuses in plain words
// and writes nothing; no clipping, no pooling, no housemate's stamps. The position is the town ledger's own post stake
// (`<host> → stake:post/<event> · 20 · side: for`), reserved until the event is cancelled (all of it comes home, whole, in the
// cancellation's act) or completes (the whole position comes home and the spark's own 1-stamp stake backs it: 19 home, 1 kept).
// Every event posted from here on stakes (no switch: Rivet's final money scope). Events already scheduled when this ships carry no
// stake in their stored row and stay free; a staked event's cancellation and completion always settle its stake.
export const EVENT_STAKE = 20;
export const EVENT_SPARK_BACKING = 1;

/**
 * WILL THIS EVENT'S WORDS SURVIVE AS ITS SPARK? (Rivet 18:39Z: representability is checked before a paid host or amend commits,
 * never discovered after 20 stamps are charged.) Its title becomes the spark's headline and its invitation the text its recounting
 * is drawn from (the mapping itself is Wright's Call), each a line of the spark's record: a text that line would not read back
 * whole is refused now, plainly, by field — never truncated, quoted or re-encoded. Null when both survive.
 */
export function sparkTextRefusal({ title, body }) {
  for (const [field, v] of [["title", title], ["invitation", body]]) {
    if (v == null || String(v).trim() === "") continue;
    const lost = recordLoss(String(v));
    if (lost) return { code: 422, defect: `this staked event's ${field} would not survive as its spark's record: ${lost}`,
      hint: `an event with a stake ends as a spark, and its ${field} is carried there whole; reword it (nothing was written, no stamp moved)` };
  }
  return null;
}

/** A resident's open post position on one post, folded from ledger entries (`stake`/`unstake`/`return` lines), and whether it was returned. */
export function postPositionOf(entries, post, handle) {
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const stakeRe = new RegExp(`^- \\S+ · ${esc(handle)} → stake:post/${esc(post)} · (\\d+) · side: `);
  const outRe = new RegExp(`^- \\S+ · stake:post/${esc(post)} → ${esc(handle)} · (\\d+) · for: (unstake|post-return)`);
  let n = 0, returned = false;
  for (const e of entries ?? []) {
    const line = e?.canonical ?? e;
    let m = stakeRe.exec(line);
    if (m) { n += Number(m[1]); continue; }
    m = outRe.exec(line);
    if (m) { n -= Number(m[1]); if (m[2] === "post-return") returned = true; }
  }
  return { n, returned };
}

/** The spark class's name (WLD-173: `the-town/spark`, extends mark; written `kind: spark`, no `class:` line). */
export const SPARK_CLASS = "spark";

// ── A CLASS'S PROPERTIES, CARRIED BY NAME (WLD-173's office half) ────────────
//
// The mark road picked a class's fields by hand (a bounty's ask, a chest's contents), so a class the World adds — the spark first —
// could not carry its own properties: its record would land without them. `properties: { … }` on leave-mark carries each one BY
// NAME, and only a name the class declares as its own `kind: property` node in the law (world-classes.mjs § classOwnProperties).
// Lists ride as lists, which the record writes in its existing strict-JSON form (mark-record.mjs § fmtVal, as `points` rides).
// A name the class does not declare is refused, never written; the core record's own fields cannot be smuggled in this way.
//
// THE SPARK'S `parent` (Darko 11-14 10:46: "let sparks declare their parent if they want to as a field"; WLD-173 Q3). The maker
// says `parent`; the record stores it as the non-placement property `parent_spark`. It NEVER becomes core `parent:` — the record
// grammar's containment edge, which would read the spark as anchored under its target.

/** Core record fields a class property may never carry (mark-record.mjs § RECORD_FIELDS and DERIVED, and the containment edge). */
export const CORE_FIELDS = Object.freeze(["kind", "by", "tier", "date", "at", "extent", "points", "slot", "value", "class", "ask", "reward",
  "status", "image", "version", "slug", "body", "household", "amend", "stamps", "put_forward", "parent", "parent_id", "id"]);

/**
 * `properties` (the caller's object) → the fields to write, or `{ refused: { code, defect, hint } }`. `own` is the class's own
 * property names (a Set or array). Absent `properties` carries nothing.
 */
export function carriedProperties(klass, properties, own, { spark = klass === SPARK_CLASS } = {}) {
  if (properties === undefined || properties === null) return { fields: {} };
  const no = (defect, hint) => ({ refused: { code: 422, defect, hint } });
  if (typeof properties !== "object" || Array.isArray(properties)) return no("properties is an object of the class's own properties, by name", "properties: { <name>: <value>, … }");
  const names = new Set(own ?? []);
  const given = { ...properties };
  // `spark` is the World's answer for this class (world.mjs § sparkByWorld), handed in; the name alone is the default for a caller with none
  if (spark && given.parent !== undefined) {
    if (given.parent_spark !== undefined) return no("parent and parent_spark name the same link", "send parent: \"<by>/<slug>\" — the record stores it as parent_spark");
    given.parent_spark = given.parent;
    delete given.parent;
  }
  const fields = {};
  for (const [k, v] of Object.entries(given)) {
    if (CORE_FIELDS.includes(k))
      return no(`${k} is the record's own field, not a property of ${klass}`, k === "parent" ? "a mark's parent is its containment; a spark's own link is properties.parent" : "send it as itself, outside properties");
    if (!names.has(k))
      return no(`class ${klass} has no property "${k}"`, names.size ? `its own properties: ${[...names].sort().join(", ")}` : `class ${klass} declares no properties of its own in the law`);
    if (v === undefined || v === null || v === "") continue; // nothing to write: the record writes no empty line (mark-record § markRecord)
    const lost = recordLoss(v);
    if (lost) return no(`properties.${k} would not read back whole from the town's record: ${lost}`,
      "the record is one line per field (the World's marks-fold.mjs § parseRecord); send the value in a form that line keeps, or leave it out");
    fields[k] = v;
  }
  return { fields };
}

/**
 * WHAT ONE RECORD LINE CANNOT CARRY (the WLD-173 Q2 round trip, measured against the World's own reader, marks-fold.mjs §
 * parseRecord, which this office's writer feeds through mark-record.mjs § fmtVal). A string is written bare, so the reader would:
 * cut it at a `#` (its comment), end the field at a newline, read a number-shaped string as a number, and try a `{`/`[`-led string
 * as JSON. A list or object is written as strict JSON and reads back whole — unless a `#` inside it is cut the same way. Returns
 * the reason, or null when the value round-trips. Refused at the door, never written to be lost silently (WLD-41's rule).
 */
export function recordLoss(v) {
  // a number survives only in the spelling the reader turns back into one (no exponent, no NaN/Infinity); the reader never
  // makes a boolean, so true/false would come back as text
  if (typeof v === "number") return /^-?\d+(\.\d+)?$/.test(String(v)) ? null : `${String(v)} is not read back as the same number`;
  if (typeof v === "boolean") return "a true/false is read back as text";
  if (typeof v === "string") {
    if (/[\r\n]/.test(v)) return "a line break ends the field";
    if (v.includes("#")) return "a # is read as the start of a comment, and everything after it is lost";
    if (v !== v.trim()) return "leading or trailing spaces are trimmed";
    if (/^-?\d+(\.\d+)?$/.test(v)) return "a number-shaped text is read back as a number";
    if (v.startsWith("{")) return "a text that starts with { is read back as a structure";
    // a `[`-led text is kept as text unless it parses as a list, or ends with `]` (then the World's lint calls the line lossy)
    if (v.startsWith("[") && (v.endsWith("]") || (() => { try { JSON.parse(v); return true; } catch { return false; } })()))
      return "a text in [ … ] is read back as a list, or refused by the World's lint";
    return null;
  }
  const json = JSON.stringify(v);
  if (json === undefined) return "it is not a value the record can write";
  if (json.includes("#")) return "a # inside it is read as the start of a comment, and the rest of the line is lost";
  return null;
}

/** The ruled no-conversation extent (WLD-173 Q1, Darko 09:37 EST: "an extent locked at 60 radius (base earshot)"). */
export const SPARK_RADIUS_M = 60;
/** How near the event's place a public act must be to count as there, and a room's voice to be the event's room: earshot. */
export const EVENT_PLACE_M = 60;
/** The in-world public acts that show a household was there (world-read-v2.mjs § PUBLIC_ACTS). An RSVP is not among them. */
export const PRESENCE_ACTS = Object.freeze(Object.keys(PUBLIC_ACTS));

const iso = (ms) => new Date(ms).toISOString();
const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));

/** The event's canonical window, `[doors_open ?? starts, ends]`, from a posts row (events-store.mjs § rowOf) or an event view. */
export function eventWindow(event) {
  const from = ms(event?.fields?.doors_open ?? event?.doors_open ?? event?.starts);
  const to = ms(event?.ends);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return { from, to };
}

/** The frozen frame of a real room (`thread.extent` is absolute, rounded-metre bounds): exact midpoint and differences. */
export function roomFrame(thread) {
  const { x0, y0, x1, y1 } = thread.extent;
  return { room: thread.id, at: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, extent: { w: x1 - x0, h: y1 - y0 } };
}

/** The frame with no conversation: the maker's resolved place (an event's canonical place) and the 60 m radius. */
export function placeFrame(place) {
  return { at: { x: Number(place.x), y: Number(place.y) }, extent: { w: 2 * SPARK_RADIUS_M, h: 2 * SPARK_RADIUS_M } };
}

const near = (p, place, m = EVENT_PLACE_M) => Math.hypot(p.x - place.x, p.y - place.y) <= m;

/**
 * THE ROOMS, from voices already read off the record. `voices` are `voiceRecords` voices (each with `at` ms, `x`, `y`): the record as
 * the conversations page reads it, up to the instant asked; `edges` the published settlements (ms). Pure, so the read and the tick
 * resolve the same rooms from the same rows. Returns `{ rooms: [thread…], history, note? }` — `history: "unavailable"` when the window
 * opens before the oldest settlement this office knows, since then a voice's settlement (and so its room) cannot be told; that is
 * never read as no conversation.
 *
 * THE PAGE'S OWN ROOMS (POS-1035 × CORE-97 parity): the rooms are clustered exactly as the conversations page clusters the record —
 * every voice from the oldest published settlement on, one continuation rule (talk.clusterVoices → hearing-window § roomOpen: a room
 * carries across a settlement while anyone speaks in the hour after it) — and then the event's are picked out. So a room that began
 * before the doors, or that carried across a settlement into the window, is the event's under the SAME id the page, `?room=`, its
 * circles and their sparks' `rooms` name it by — never a second id made from the window's slice of it.
 */
export function eventRoomFrom(voices, { window, place, edges = [], earshotM = talk.SAY_DIAL_SPEC.earshot_m[0] }) {
  const marks = [...edges].filter(Number.isFinite).sort((a, b) => a - b);
  if (marks.length && window.from < marks[0])
    return { rooms: [], history: "unavailable",
      note: `the event's window opens before the oldest settlement this office has read (${iso(marks[0])}), so the rooms its talk formed cannot be told — this is not evidence that nobody spoke` };
  // the page's grouping: a voice older than the oldest published settlement has no known epoch, and is not grouped (as the page says)
  const grouped = voices.filter((v) => v.at <= window.to && (!marks.length || v.at >= marks[0]));
  const clusters = talk.clusterVoices(grouped, { earshotM, boundaries: marks });
  // PLACE MEMBERSHIP is the office's existing rule for "the conversation at a point" (voices.mjs § openConversationAt): a room
  // with a voice within earshot of the point — here, a voice spoken inside the event's window. EVERY such room is the event's
  // (Darko via Wright 18:46:13Z, "All of them, combined"): none is ranked or chosen, and they are listed in the order they started.
  const inWindow = (v) => v.at >= window.from && v.at <= window.to;
  const here = clusters.filter((c) => c.voices.some((v) => inWindow(v) && near(v, place, earshotM))).sort((a, b) => a.voices[0].at - b.voices[0].at);
  // the conversations page's own thread header (its id, bounds, participants, counts); its lines are the circle reads' to serve
  const header = (c) => { const { voices: _lines, ...thread } = talk.threadOf(c, { live: false, voiceCap: 1 }); return thread; };
  return { rooms: here.map(header), history: "complete",
    ...(marks.length ? {} : { settlement_note: "no settlement could be read, so the window's talk is grouped as one settlement" }) };
}

/** Who was there: the distinct households of `rows` (public acts, each placed `{x, y}` and attributed) at the place in the window. */
export function presentFrom(rows, { window, place }) {
  const out = new Set();
  for (const r of rows) {
    const t = ms(r.at);
    if (!r.household || !Number.isFinite(t) || t < window.from || t > window.to) continue;
    if (!r.point || !near(r.point, place)) continue;
    out.add(String(r.household));
  }
  return [...out].sort();
}

/**
 * THE EVIDENCE, read from the record in one read-only transaction (`client`). `event` is a posts row; `edges` the published
 * settlements. Answers `{ window, room, present, evidence }`; while the event is still on, `as_of` is now and `complete` false.
 */
export async function eventEvidence(client, event, { now = Date.now(), edges = [] } = {}) {
  const window = eventWindow(event);
  if (!window) return null;
  const place = { x: Number(event.place_x), y: Number(event.place_y) };
  const until = Math.min(window.to, now);
  if (until < window.from) return null; // doors not open yet: nothing to tell
  const scoped = { from: window.from, to: until };
  // one client, one query at a time (pg queues concurrent queries on a client, and is retiring that). The says are the record as the
  // conversations page groups it (from the oldest published settlement), up to the instant asked: the rooms are the page's own.
  const oldest = [...edges].filter(Number.isFinite).sort((a, b) => a - b)[0];
  const { rows: sayRows } = await client.query(`SELECT id, at, actor, action, at_anchor, at_dx, at_dy, payload FROM acts
                   WHERE action = ANY($1) AND at <= $2 ${Number.isFinite(oldest) ? "AND at >= $3" : ""} ${talk.VOICE_ORDER_SQL}`,
    [talk.VOICE_ACTIONS, iso(scoped.to), ...(Number.isFinite(oldest) ? [iso(oldest)] : [])]);
  const { rows: markRows } = await client.query(talk.ANCHOR_MARKS_SQL);
  const { rows: actRows } = await client.query(`SELECT id, at, action, household, at_anchor, at_dx, at_dy FROM acts
                   WHERE action = ANY($1) AND household IS NOT NULL AND at >= $2 AND at <= $3 AND ${publicActSql()}
                   ORDER BY at, id`, [PRESENCE_ACTS, iso(scoped.from), iso(scoped.to)]);
  const centres = talk.anchorCentres(markRows);
  const centreOf = (id) => centres.get(id) ?? null;
  // WLD-74: a say spoken inside a dungeon room is not on a public read, and so not in an event's public room either
  const spoken = sayRows.filter((r) => !(r.payload?.room ?? r.payload?.payload?.room));
  const { voices, unplaced } = talk.voiceRecords(spoken, { centreOf, strict: false });
  const found = eventRoomFrom(voices, { window: scoped, place, edges });
  // the says this read could not place, counted for the event's own window (the read reaches further back, for the rooms' sake)
  const windowActs = new Set(spoken.filter((r) => ms(r.at) >= scoped.from && ms(r.at) <= scoped.to).map((r) => String(r.id)));
  const unplacedInWindow = unplaced.filter((u) => windowActs.has(String(u.act_id))).length;
  const placed = actRows.map((r) => ({ ...r, point: talk.composeAnchor({ anchor: r.at_anchor, dx: r.at_dx, dy: r.at_dy }, centreOf) }));
  const present = presentFrom(placed, { window: scoped, place });
  const complete = until === window.to;
  return {
    window: { from: iso(window.from), to: iso(window.to), ...(complete ? {} : { as_of: iso(until) }) },
    complete,
    // every room of the event, in the order it started, each with its own frozen frame (the place they combine into is the
    // World's one rule, tools/spark.mjs § roomsPlace, asked when the spark is made — never a second copy here)
    rooms: found.rooms.map((c) => ({ ...c, frame: roomFrame(c) })),
    room_history: found.history,
    ...(found.note ? { room_note: found.note } : {}),
    present,
    present_basis: `households with a public act (${PRESENCE_ACTS.join(", ")}) within ${EVENT_PLACE_M} m of the event's place inside its window — never RSVPs, never who is there now`,
    ...(unplacedInWindow ? { unplaced_says: unplacedInWindow } : {}),
  };
}

// ── THE SPARK, AS THE SITE READS IT (POS-1035 → CORE-82: identity, accepted children, picture and credit) ──
//
// ACCEPTANCE IS THE STORE'S, not a classifier's: a spark is accepted when it stands in `marks` (its claim locked through ordinary
// acceptance; status 'standing'). A pending, refused or retracted claim is not, and a draft is the household's own. So the gallery
// and a circle's children are read from standing marks only. CREDIT is the maker — the mark's own `by` (owner) and household; the
// PICTURE is the spark's own `picture` property, as the maker gave it. Nothing is inferred: a property absent is absent.
// THE SPINE (WLD-173, Darko 10:46): a spark stands under every circle on its `circle_path`; `on` is the circle it ties to (the
// path's end), `below` every deeper one. Its own `parent_spark` link is shown as itself and never moves it in the tree.

export const STANDING_SPARKS_SQL = "SELECT slug, owner, household, body, locked_window, data FROM marks WHERE kind = 'spark' AND status = 'standing'";

/** One accepted spark as the site reads it: its id, the maker's credit, its words, its place, its time and its own properties. */
export function sparkView(m) {
  const d = m?.data && typeof m.data === "object" ? m.data : {};
  const pick = (k) => (d[k] === undefined || d[k] === null || d[k] === "" ? {} : { [k]: d[k] });
  return {
    id: m.slug,
    credit: { by: m.owner ?? d.by ?? null, household: m.household ?? d.household ?? null },
    body: m.body ?? null,
    accepted: true,
    ...(m.locked_window != null ? { accepted_window: Number(m.locked_window) } : {}),
    ...pick("picture"), ...pick("image_prompt"), ...pick("recounting"),
    ...pick("experienced_at"), ...pick("experienced_until"),
    ...pick("rooms"), ...pick("event"), ...pick("circle"), ...pick("circle_path"), ...pick("acts"), ...pick("present"),
    ...(d.parent_spark ? { own_link: d.parent_spark } : {}),
  };
}

/** The accepted sparks under one circle, by the spine: `on` it (its path ends there) and `below` it (deeper on its path). */
export function sparksOfCircle(standing, circleId) {
  const on = [], below = [];
  for (const m of standing ?? []) {
    const path = Array.isArray(m?.data?.circle_path) ? m.data.circle_path.map(Number) : null;
    if (!path || !path.includes(Number(circleId))) continue;
    (path.at(-1) === Number(circleId) ? on : below).push(sparkView(m));
  }
  return { on, below };
}

/** The accepted sparks under a circle, read from the store (`q` is a client or pool): standing marks whose path names it. */
export async function acceptedSparksOfCircle(q, circleId) {
  const { rows } = await q.query(`${STANDING_SPARKS_SQL} AND data->'circle_path' @> $1::jsonb`, [JSON.stringify([Number(circleId)])]);
  return sparksOfCircle(rows, circleId);
}

/**
 * An event's own spark, by the identity its completion recorded (`fields.completed.spark`): accepted (standing) with its view,
 * or `{ id, accepted: false, status }` while its claim waits on acceptance (or was refused). Null before the event completes.
 */
export async function eventSparkOf(q, row) {
  const id = row?.fields?.completed?.spark;
  if (!id) return null;
  const { rows: [m] } = await q.query(`${STANDING_SPARKS_SQL} AND slug = $1`, [String(id)]);
  if (m) return sparkView(m);
  const { rows: [c] } = await q.query(
    "SELECT status FROM claims WHERE slug = $1 AND status <> 'draft' ORDER BY submitted_at DESC LIMIT 1", [String(id)]);
  return { id: String(id), accepted: false, status: c?.status ?? "unknown" };
}

/**
 * THE EVENT'S GALLERY (POS-1035 → CORE-82, Facet via Rivet 20:03Z): every ACCEPTED spark across every room the event bound,
 * beside its root (`evidence.spark`, never repeated here). Membership is the World's spine for an event's spark — every circle
 * spark in any of its rooms (tools/spark.mjs § sparkChildren, by roomsOf) — and acceptance is the store's: a standing mark. So:
 * the standing sparks whose `rooms` share a room with the event's, in the order they were accepted. Coverage is literal:
 *   · `{ rooms: [the room ids covered], sparks: [spark…] }` — an empty `sparks` is KNOWN none in those rooms (no rooms: none);
 *   · `gallery: null` with `gallery_note` — the rooms cannot be told (unknown history), so neither can the gallery.
 * While the event is still on, the rooms covered are those so far (`window.as_of`).
 */
export async function eventGalleryOf(q, evidence, { root = null } = {}) {
  if (evidence?.room_history !== "complete")
    return { gallery: null, gallery_note: "the event's rooms cannot be told (its window opens before the settlements this office has read), so neither can its gallery — unknown, not none" };
  const rooms = evidence.rooms.map((r) => String(r.id));
  if (!rooms.length) return { gallery: { rooms: [], sparks: [] } };
  const { rows } = await q.query(
    `${STANDING_SPARKS_SQL} AND jsonb_typeof(data->'rooms') = 'array' AND data->'rooms' ?| $1::text[] AND slug <> $2 ORDER BY locked_window, slug`,
    [rooms, root == null ? "" : String(root)]);
  return { gallery: { rooms, sparks: rows.map(sparkView) } };
}

// ── THE EXECUTOR (POS-1035): the hosting stake and its whole return, under the town lock ──
//
// Spawned by the doors (events-store.mjs § viaStakeExec) through execUnderTownLock, as every office act that signs a ledger line
// is (parcel-room-exec.mjs, stake-exec.mjs): the town lock is held, the clone is fresh, and penTransaction puts the ledger back
// if anything after the signature fails. The line is signed first, then ONE store transaction writes the act, the row and the
// ledger's landing together (stamp-lines.mjs § landPlannedVia) — the ballot stake's own order (ballots-store.mjs § stakeInStore).

const refusal = (code, defect, hint) => ({ error: { code, defect, hint } });

/**
 * THE MINT'S OWN ARRIVAL PREDICATE, asked as the mint asks it (deploy/office-keep.sh § the mint pass: tools/stamp-verify-owed.mjs
 * over the town clone, with the tick's registry when it has one): the town's verifier, where "mints owed" and "settlement owed"
 * are not red. Not a second verifier — the same call. Answers true when the ledger is red. As in the mint, the verifier names the
 * line itself, to the journal (its output goes to this process's stderr), and no answer carries its words.
 * The town's appendSigned does not check this itself (it parses, seals and signs), so the boundary asks before it signs.
 */
export function ledgerArrivalRed(clone, { registry = null } = {}) {
  const tool = fileURLToPath(new URL("../tools/stamp-verify-owed.mjs", import.meta.url));
  return spawnSync(process.execPath, [tool, "--repo", clone, ...(registry ? ["--registry", registry] : [])], { stdio: ["ignore", 2, 2] }).status !== 0;
}
const asAnswer = (e) => { if (e?.code && e?.defect) return refusal(e.code, e.defect, e.hint); throw e; };

/** The town's engine and the ledger as it stands, for one act under the lock. */
async function ledgerOf(clone) {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const mint = await import(pathToFileURL(join(clone, "tools", "stamp-mint.mjs")).href);
  const ballot = await import(pathToFileURL(join(clone, "tools", "ballot.mjs")).href).catch(() => null);
  const path = join(clone, "WHITE_PAGES", "stamp-ledger.md");
  const entries = mint.parseStampLedger(readFileSync(path, "utf8"));
  return { mint, ballot, path, entries };
}

/** Post an event with its hosting stake: the posting resident's own liquid EVENT_STAKE, firm, or nothing at all. */
export async function stakedPost({ handle, input, door, now = Date.now(), date, via = "api" }, { clone, keyPem, env = process.env }) {
  try {
    const store = await import("./events-store.mjs");
    const { planStampedCommit, landPlannedVia } = await import("./stamp-lines.mjs");
    const { mint, ballot, path, entries } = await ledgerOf(clone);
    if (ballot?.ballotState?.(clone)?.lawAt?.(date)?.meeps?.has?.(handle))
      return refusal(403, `${handle} cannot host a staked event: a meep account does not stake`, "the stamps law: meeps neither mint nor stake");
    const liquid = mint.foldBalances(entries).get(handle) ?? 0;
    if (liquid < EVENT_STAKE)
      return refusal(422, `hosting an event stakes ${EVENT_STAKE} of your own stamps, and ${handle} holds ${liquid}`,
        `a household without ${EVENT_STAKE} stamps can't host yet — the stake is ${handle}'s own (no housemate's, never part of it); nothing was written. At the event's end ${EVENT_STAKE - EVENT_SPARK_BACKING} come home and ${EVENT_SPARK_BACKING} backs its spark; cancelled, all ${EVENT_STAKE} come home`);
    const id = await store.nextEventId(handle, input?.title, { now, env });
    mint.appendSigned(clone, [mint.postStakeLine({ date, handle, post: id, n: EVENT_STAKE, side: "for", via })], keyPem);
    const plan = await planStampedCommit(clone, { env });
    return await store.postStakedEvent(handle, input, { now, env, door, stake: { id, n: EVENT_STAKE, by: handle,
      land: (client) => landPlannedVia(client, clone, plan, [path], `event stake: ${handle} -> ${id} · ${EVENT_STAKE} (via ${via})`, { env }) } });
  } catch (e) { return asAnswer(e); }
}

/** Cancel a staked event: the whole position comes home to the one who paid it, in the cancellation's own act — once. */
export async function stakedCancel({ handle, id, door, now = Date.now(), date }, { clone, keyPem, env = process.env }) {
  try {
    const store = await import("./events-store.mjs");
    const { planStampedCommit, landPlannedVia } = await import("./stamp-lines.mjs");
    const row = await store.eventRowAtOffice(id, { env });
    if (!row) return refusal(404, `no event "${id}"`, "ids are <host>/<slug>, as the calendar names them");
    const staked = row.fields?.stake;
    if (!staked) return refusal(409, `"${id}" carries no stake`, "cancel it at its door; nothing was written");
    if (staked.returned) return refusal(409, `"${id}"'s stake has already come home`, "nothing to do — it cannot be paid twice");
    const { mint, path, entries } = await ledgerOf(clone);
    const held = postPositionOf(entries, id, staked.by);
    if (held.returned || held.n !== Number(staked.n))
      return refusal(503, `the ledger holds ${held.n} on "${id}" for ${staked.by}${held.returned ? " (already returned)" : ""}, and the event's record says ${staked.n}`,
        "the office's record and the town's ledger disagree; nothing was written — the operator reconciles it");
    mint.appendSigned(clone, [mint.postReturnLine({ date, post: id, handle: staked.by, n: Number(staked.n) })], keyPem);
    const plan = await planStampedCommit(clone, { env });
    return await store.closeStakedEvent(handle, id, { now, env, door, stakeReturn: { n: Number(staked.n), to: staked.by,
      land: (client) => landPlannedVia(client, clone, plan, [path], `event stake home: ${id} -> ${staked.by} · ${staked.n} (cancelled)`, { env }) } });
  } catch (e) { return asAnswer(e); }
}

// ── THE COMPLETION (call 22; Darko 11:00 EST "a spark anyway, 1 kept"; Rivet's seam responses) ──────────────────────────────
//
// At its end a staked event becomes ONE put-forward spark through the mark road, its 20 come home whole and the spark's own stake
// of 1 backs it (19 home, 1 kept) — in ONE locked, signed batch and ONE store transaction, or not at all:
//   1 · read (no transaction): the event's evidence. Every room at the place is the event's, placed together by the World's
//       roomsPlace (the rectangular envelope); rooms that cannot be read, or that the World will not place, are HELD, nothing
//       moves — never turned into the no-conversation radius.
//   2 · the spark, judged by the mark road's own leave (world.mjs § journalLeaveMark { plan }): every guard a real leave runs, the
//       World's spark pre-check, and the verdict — it must go forward with its 1 stamp, or the completion is HELD and says why.
//   3 · its id: <host>/<event-slug>, else the first unused numeric suffix, checked against published marks, every claim (the
//       household's drafts included, under its own keys) and every act — never an overwrite, an amend or an adoption.
//   4 · signed (the town lock is held by the keep tick's mint step): the whole post-return of 20, then the spark's own 1-stamp
//       world stake (the engine's worldStakeApply, which sees the 20 already home).
//   5 · ONE officeWrite under the spark household's keys: the spark's act and claim (world-journal § writePreparedVia, the pen's
//       own two writes), its mark lock (mark-stake-lock § stakeGuard), the event's receipt (events-store § recordCompletionVia,
//       FOR UPDATE: never twice), and LAST the ledger's landing (stamp-lines § landPlannedVia). A ledger that moved, an id taken
//       meanwhile or an event that moved answers `moved`, and penTransaction puts the signed lines back.

/** The spark's recounting, from the event's own words. ⚑ The mapping is Wright's Call (POS-1035-completion-seam-response § 1): the
 *  recommended reading is the invitation verbatim, sourced as the event's original words, with the title when there is none —
 *  never words written for the host. It stands in this one function so the ruling replaces it here and nowhere else. */
export function recountingOf(row) {
  const body = String(row?.body ?? "").trim();
  return body || String(row?.title ?? "").trim();
}

/**
 * The spark's place and time, and its properties, from the event and its evidence. `roomsPlace` is the World's one rule for a room
 * set's place (tools/spark.mjs § roomsPlace, World #391: the rectangular envelope over every member room's absolute bounds, gaps
 * included). Answers `{ at, extent, properties }`, or `{ held }` naming why no place can be told — never a guessed one:
 *   · unknown history is not a proved empty set: held, never the no-conversation frame;
 *   · a PROVED empty set is the standalone spark: the event's place and the locked circle, and no `rooms` written;
 *   · rooms are placed by the World's roomsPlace alone; its null for rooms that exist (bounds it will not place), or an engine
 *     without it, is held — a null is never read as "no room".
 * The record names every room as the World's class spells it: `rooms`, the ids in start order (no singular alias).
 */
export function sparkDeclaration(row, evidence, { roomsPlace = null } = {}) {
  if (evidence.room_history !== "complete")
    return { held: `its rooms cannot be told (history ${evidence.room_history ?? "unknown"}) — no place is chosen` };
  const ids = evidence.rooms.map((r) => r.id);
  let frame;
  if (!ids.length) frame = placeFrame({ x: Number(row.place_x), y: Number(row.place_y) });
  else {
    if (typeof roomsPlace !== "function") return { held: "this office's World engine has no roomsPlace (the room-set class is not at its pin), so its rooms' place cannot be told" };
    frame = roomsPlace(evidence.rooms.map(({ extent: { x0, y0, x1, y1 } }) => ({ x0, y0, x1, y1 })));
    if (!frame) return { held: `the World's roomsPlace placed none of its ${ids.length} room(s)' bounds — a null is not "no room"`, rooms: ids };
  }
  return {
    at: frame.at, extent: frame.extent,
    properties: {
      recounting: recountingOf(row),
      experienced_at: evidence.window.from, experienced_until: evidence.window.to,
      event: row.id,
      ...(ids.length ? { rooms: ids } : {}),
      ...(evidence.present.length ? { present: evidence.present } : {}),
    },
  };
}

/**
 * THE BATCH A COMPLETION SIGNS, FOUND IN THE LEDGER (the landed-but-uncommitted retry): this event's whole post-return to `by`,
 * immediately followed by `by`'s own 1-stamp world stake on a mark — the spark it names. Null when the ledger holds no such pair:
 * then a return that is there was not this completion's, and nothing is guessed.
 */
export function landedCompletionOf(entries, post, by, n) {
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const lines = (entries ?? []).map((e) => e?.canonical ?? e);
  const ret = new RegExp(`^- \\S+ · stake:post/${esc(post)} → ${esc(by)} · ${Number(n)} · for: post-return$`);
  const backing = new RegExp(`^- \\S+ · ${esc(by)} → stake:world-mark/([a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*) · ${EVENT_SPARK_BACKING} · via: \\S+$`);
  const i = lines.findIndex((l) => ret.test(l));
  if (i < 0 || i + 1 >= lines.length) return null;
  const m = backing.exec(lines[i + 1]);
  return m ? { spark: m[1] } : null;
}

/** Is a mark id free in every place an identity lives? (`q` holds the host household's keys, so its drafts are seen.) */
async function sparkIdFree(q, by, slug) {
  const id = `${by}/${slug}`;
  // one query at a time on the one client; a claim's slug is the whole <by>/<slug> id (world2-claims § claimTxFromJournal)
  for (const sql of ["SELECT 1 FROM marks WHERE slug = $1 LIMIT 1", "SELECT 1 FROM claims WHERE slug = $1 LIMIT 1",
    "SELECT 1 FROM acts WHERE object = $1 AND class = 'mark' LIMIT 1"])
    if ((await q.query(sql, [id])).rows.length) return false;
  return true;
}
async function freeSparkSlug(q, by, base) {
  if (await sparkIdFree(q, by, base)) return base;
  for (let i = 2; i < 1000; i++) if (await sparkIdFree(q, by, `${base}-${i}`)) return `${base}-${i}`;
  return null;
}

/**
 * `planLeave` is the mark road's planner (world.mjs § planSparkLeave) and `roomsPlace` the World's room-set place (world.mjs §
 * sparkRoomsPlace, tools/spark.mjs § roomsPlace); a test hands its own of each where the World pin lacks the class.
 */
export async function completeEvent(row, { clone, keyPem, env = process.env, now = Date.now(), date, edges = [], via = "api", planLeave = null, roomsPlace = undefined, registry = null }) {
  const held = (why, extra = {}) => ({ event: row.id, held: why, ...extra });
  try {
    if (!row?.fields?.stake || row.fields.stake.returned || row.fields.completed) return held("not a staked, open event");
    if (Date.parse(row.ends) > now) return held("not ended");
    // 0 · NEVER ONTO A RED LEDGER (Rivet 20:11Z): before anything is read for it or signed, the ledger as it stands under the lock
    //     is judged by the mint's own arrival predicate. Here, at the one boundary every caller passes, so no entry bypasses it.
    if (ledgerArrivalRed(clone, { registry }))
      return { error: { code: 409, reason: "ledger-red", defect: "the stamp ledger is red (the town's verifier names the line in the journal), so no completion signs onto it",
        hint: "nothing was written; the mint refuses it too — the next tick asks again once the ledger is green" } };
    const pen = await import("./world2-pen.mjs");
    const store = await import("./events-store.mjs");
    const journal = await import("./world-journal.mjs");
    const { stakeGuard } = await import("./mark-stake-lock.mjs");
    const { planStampedCommit, landPlannedVia } = await import("./stamp-lines.mjs");
    const { join } = await import("node:path");
    const { pathToFileURL } = await import("node:url");

    // 1 · the evidence, read whole (no transaction)
    const evidence = await pen.officeRead((q) => eventEvidence(q, row, { now, edges }), { env });
    if (!evidence?.complete) return held("its window is not over yet");
    if (evidence.room_history !== "complete") return held("its room cannot be told (the window opens before the settlements this office has read)", { note: evidence.room_note });
    // its place: every room it formed, combined by the World's roomsPlace; a proved empty set is the locked circle at its place
    const place = roomsPlace !== undefined ? roomsPlace
      : evidence.rooms.length ? await (await import("./world.mjs")).sparkRoomsPlace() : null;
    const decl = sparkDeclaration(row, evidence, { roomsPlace: place });
    if (decl.held) return held(decl.held, decl.rooms ? { rooms: decl.rooms } : {});

    // 3 · the ledger first: a fresh completion, or the retry of one whose lines landed and whose store transaction did not
    const by = String(row.fields.stake.by);
    const n = Number(row.fields.stake.n);
    const mint = await import(pathToFileURL(join(clone, "tools", "stamp-mint.mjs")).href);
    const ws = await import(pathToFileURL(join(clone, "tools", "world-stake.mjs")).href);
    const path = join(clone, "WHITE_PAGES", "stamp-ledger.md");
    const { readFileSync } = await import("node:fs");
    const entries = mint.parseStampLedger(readFileSync(path, "utf8"));
    const position = postPositionOf(entries, row.id, by);
    let recovering = null;
    if (position.returned) {
      // the retry FOLLOWS THE RECEIPT the ledger already holds: this completion's exact batch, or nothing — never re-signed
      recovering = landedCompletionOf(entries, row.id, by, n);
      if (!recovering)
        return refusal(503, `the ledger has returned "${row.id}"'s stake to ${by}, but not as this completion's batch (no spark backing follows it)`,
          "the office's record and the town's ledger disagree; nothing was written — the operator reconciles it");
    } else if (position.n !== n)
      return refusal(503, `the ledger holds ${position.n} on "${row.id}" for ${by}, and the event's record says ${n}`,
        "the office's record and the town's ledger disagree; nothing was written — the operator reconciles it");

    // 3b · the id, under the host household's own keys (its drafts count as used): the ledger's, on a retry
    const base = String(row.id).split("/").slice(1).join("/");
    const slug = recovering
      ? (await pen.officeWrite((q) => sparkIdFree(q, by, recovering.spark.split("/").slice(1).join("/")), { household: row.household, env })
        ? recovering.spark.split("/").slice(1).join("/") : null)
      : await pen.officeWrite((q) => freeSparkSlug(q, by, base), { household: row.household, env });
    if (recovering && (!slug || recovering.spark.split("/")[0] !== by))
      return refusal(503, `the ledger's batch for "${row.id}" names ${recovering.spark}, which this office already holds as another mark or claim`,
        "an existing mark is never adopted as an event's spark; nothing was written — the operator reconciles it");
    if (!slug) return held("no free spark id under its slug");
    const sparkId = `${by}/${slug}`;

    // 2 · the spark, judged by the mark road's own leave, written by nobody yet
    const planner = planLeave ?? (await import("./world.mjs")).planSparkLeave;
    const leave = await planner({ by, household: row.household, slug, body: String(row.title), ...decl, stamps: EVENT_SPARK_BACKING });
    if (leave?.refused) return held(`its spark would not go forward: ${leave.refused.defect}`, { hint: leave.refused.hint });
    if (!leave?.planned || leave.put_forward !== true) return held("its spark would not go forward with its 1 stamp (the mark road kept it a draft)");
    const prepared = await journal.prepareActFlipped(leave.entry);

    // 4 · signed (a fresh completion only): the whole return, then the spark's own stake
    if (!recovering) {
      mint.appendSigned(clone, [mint.postReturnLine({ date, post: row.id, handle: by, n })], keyPem);
      const staked = ws.worldStakeApply(clone, { handle: by, mark: sparkId, n: EVENT_SPARK_BACKING, via, date }, keyPem);
      if (staked.applied !== EVENT_SPARK_BACKING) return refusal(503, `the spark's backing did not apply (${staked.reason ?? "applied " + staked.applied})`, "nothing was written; the lines are put back");
    }
    const plan = await planStampedCommit(clone, { env });
    const { syncStampLinesVia } = await import("./stamp-lines.mjs");

    // 5 · ONE transaction: the spark, its lock, the receipt, and last the ledger
    return await pen.officeWrite(async (client) => {
      if (!(await sparkIdFree(client, by, slug))) throw Object.assign(new Error("moved"), { code: 409, defect: `${sparkId} was taken meanwhile`, hint: "nothing was written; the next tick tries again" });
      const { actId: sparkAct } = await journal.writePreparedVia(client, prepared);
      await stakeGuard(sparkId)(client);
      const receipt = await store.recordCompletionVia(client, row.id, { spark: sparkId, n, to: by, backing: EVENT_SPARK_BACKING, now });
      // a fresh completion lands its lines last; a retry's lines are already in git, so only the store's copy of them is recorded
      const landed = recovering
        ? (plan ? (await syncStampLinesVia(client, clone, { engine: plan.engine }), { recovered: true }) : { recovered: true })
        : await landPlannedVia(client, clone, plan, [path], `event complete: ${row.id} -> spark ${sparkId} · ${n} home, ${EVENT_SPARK_BACKING} backing`, { env });
      if (landed?.moved) throw Object.assign(new Error("moved"), { code: 409, defect: "the stamp ledger moved while the completion was landing", hint: "nothing was written; the next tick tries again" });
      if (landed?.error) throw Object.assign(new Error("not landed"), landed.error);
      return { event: row.id, completed: true, spark: sparkId, spark_act: sparkAct, act_id: receipt.act_id,
        stake: { returned: Number(row.fields.stake.n), to: by, backing: EVENT_SPARK_BACKING, home: Number(row.fields.stake.n) - EVENT_SPARK_BACKING },
        ...(landed?.commit ? { commit: landed.commit } : {}), ...(recovering ? { recovered: "its lines were already in the ledger; only the store's half was written" } : {}),
        rooms: evidence.rooms.map((r) => r.id), present: evidence.present };
    }, { household: prepared.household ?? row.household, env });
  } catch (e) { return asAnswer(e); }
}

async function execMain() {
  const { readFileSync, existsSync } = await import("node:fs");
  const { resolve, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const clone = process.env.TOWN_CLONE ?? resolve(here, "..", "town-clone");
  const keyPath = process.env.STAMP_KEY ?? "/srv/postmark-office/stamp-key.pem";
  const payload = JSON.parse(process.argv[2] ?? "{}");
  let result;
  if (!existsSync(keyPath)) result = refusal(409, "not-yet-open", "the office has no pen key configured for the stamp-ledger");
  else if (payload.mode !== "post" && payload.mode !== "cancel") result = refusal(422, `unknown mode ${JSON.stringify(payload.mode)}`, "mode: post | cancel");
  else {
    const keyPem = readFileSync(keyPath, "utf8");
    const { penTransaction } = await import("./write.mjs");
    const { freshenExec } = await import("./clone-fresh.mjs");
    const { townDay } = await import("./votes.mjs");
    const date = payload.date ?? townDay();
    result = await penTransaction(clone, async () => {
      freshenExec(clone); // POS-382: a dirty copy is answered by name (503) and exits, before anything is written
      return payload.mode === "post"
        ? stakedPost({ ...payload, date }, { clone, keyPem })
        : stakedCancel({ ...payload, date }, { clone, keyPem });
    });
  }
  // the store pool would hold the process open: the answer is written, then the exit
  process.stdout.write(JSON.stringify(result) + "\n", () => process.exit(0));
}

const isMain = await (async () => {
  if (!process.argv[1]) return false;
  const { realpathSync } = await import("node:fs");
  const { pathToFileURL, fileURLToPath } = await import("node:url");
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) execMain().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
