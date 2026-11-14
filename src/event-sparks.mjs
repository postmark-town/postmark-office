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

import * as talk from "../world2/tools/conversations.mjs";
import { PUBLIC_ACTS } from "./world-read-v2.mjs";
import { publicActSql } from "./hearth-public.mjs";

// ── THE HOSTING STAKE (call 22; Darko 11:00 EST and 17:37:45Z) ───────────────
//
// Posting an event stakes EVENT_STAKE of the POSTING RESIDENT'S OWN liquid stamps: firm — below it the act refuses in plain words
// and writes nothing; no clipping, no pooling, no housemate's stamps. The position is the town ledger's own post stake
// (`<host> → stake:post/<event> · 20 · side: for`), reserved until the event is cancelled (all of it comes home, whole, in the
// cancellation's act) or completes (the whole position comes home and the spark's own 1-stamp stake backs it: 19 home, 1 kept).
// Events already scheduled when this ships carry no stake and stay free. EVENT_STAKE=on is the switch: the law line (POS-1045)
// is read before it ships. A staked event's cancellation always returns its stake, whatever the switch says.
export const EVENT_STAKE = 20;
export const EVENT_SPARK_BACKING = 1;
export const eventStakeOn = (env = process.env) => String(env?.EVENT_STAKE ?? "").trim().toLowerCase() === "on";

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
 * THE ROOM, from voices already read off the record. `voices` are `voiceRecords` voices (each with `at` ms, `x`, `y`); `edges` the
 * published settlements (ms). Pure, so the read and the tick resolve the same room from the same rows. Returns
 * `{ room: thread | null, rooms: n, history, note? }` — `history: "unavailable"` when the window opens before the oldest settlement
 * this office knows, since then a voice's settlement (and so its room) cannot be told; that is never read as no conversation.
 */
export function eventRoomFrom(voices, { window, place, edges = [], earshotM = talk.SAY_DIAL_SPEC.earshot_m[0] }) {
  const marks = [...edges].filter(Number.isFinite).sort((a, b) => a - b);
  if (marks.length && window.from < marks[0])
    return { room: null, candidates: [], history: "unavailable",
      note: `the event's window opens before the oldest settlement this office has read (${iso(marks[0])}), so the room its talk formed cannot be told — this is not evidence that nobody spoke` };
  const inWindow = voices.filter((v) => v.at >= window.from && v.at <= window.to);
  const clusters = talk.clusterVoices(inWindow, { earshotM, boundaries: marks });
  // PLACE MEMBERSHIP is the office's existing rule for "the conversation at a point" (voices.mjs § openConversationAt): a room
  // with a voice within earshot of the point. Nothing here ranks rooms: no ruled source picks one of several (Rivet 17:28Z), so
  // every candidate is listed in the order it started, and `room` is bound only when there is exactly one.
  const here = clusters.filter((c) => c.voices.some((v) => near(v, place, earshotM))).sort((a, b) => a.voices[0].at - b.voices[0].at);
  // the conversations page's own thread header (its id, bounds, participants, counts); its lines are the circle reads' to serve
  const header = (c) => { const { voices: _lines, ...thread } = talk.threadOf(c, { live: false, voiceCap: 1 }); return thread; };
  const candidates = here.map(header);
  return { room: candidates.length === 1 ? candidates[0] : null, candidates, history: "complete",
    ...(candidates.length > 1 ? { binding: "unresolved", note: `${candidates.length} conversations formed at the place in the window (a settlement split one, or two groups talked apart); which is the event's room is not ruled, so none is chosen` } : {}),
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
  const [{ rows: sayRows }, { rows: markRows }, { rows: actRows }] = await Promise.all([
    client.query(`SELECT id, at, actor, action, at_anchor, at_dx, at_dy, payload FROM acts
                   WHERE action = ANY($1) AND at >= $2 AND at <= $3 ${talk.VOICE_ORDER_SQL}`, [talk.VOICE_ACTIONS, iso(scoped.from), iso(scoped.to)]),
    client.query(talk.ANCHOR_MARKS_SQL),
    client.query(`SELECT id, at, action, household, at_anchor, at_dx, at_dy FROM acts
                   WHERE action = ANY($1) AND household IS NOT NULL AND at >= $2 AND at <= $3 AND ${publicActSql()}
                   ORDER BY at, id`, [PRESENCE_ACTS, iso(scoped.from), iso(scoped.to)]),
  ]);
  const centres = talk.anchorCentres(markRows);
  const centreOf = (id) => centres.get(id) ?? null;
  // WLD-74: a say spoken inside a dungeon room is not on a public read, and so not in an event's public room either
  const spoken = sayRows.filter((r) => !(r.payload?.room ?? r.payload?.payload?.room));
  const { voices, unplaced } = talk.voiceRecords(spoken, { centreOf, strict: false });
  const room = eventRoomFrom(voices, { window: scoped, place, edges });
  const placed = actRows.map((r) => ({ ...r, point: talk.composeAnchor({ anchor: r.at_anchor, dx: r.at_dx, dy: r.at_dy }, centreOf) }));
  const present = presentFrom(placed, { window: scoped, place });
  const complete = until === window.to;
  return {
    window: { from: iso(window.from), to: iso(window.to), ...(complete ? {} : { as_of: iso(until) }) },
    complete,
    room: room.room ? { ...room.room, frame: roomFrame(room.room) } : null,
    room_history: room.history,
    ...(room.candidates?.length > 1 ? { room_binding: room.binding, rooms_at_place: room.candidates.map((c) => ({ ...c, frame: roomFrame(c) })) } : {}),
    ...(room.note ? { room_note: room.note } : {}),
    present,
    present_basis: `households with a public act (${PRESENCE_ACTS.join(", ")}) within ${EVENT_PLACE_M} m of the event's place inside its window — never RSVPs, never who is there now`,
    ...(unplaced.length ? { unplaced_says: unplaced.length } : {}),
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
    ...pick("room"), ...pick("event"), ...pick("circle"), ...pick("circle_path"), ...pick("acts"), ...pick("present"),
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
  const [by, ...leaf] = String(id).split("/");
  const { rows: [c] } = await q.query(
    "SELECT status FROM claims WHERE claimant = $1 AND slug = $2 AND status <> 'draft' ORDER BY submitted_at DESC LIMIT 1", [by, leaf.join("/")]);
  return { id: String(id), accepted: false, status: c?.status ?? "unknown" };
}

// ── THE EXECUTOR (POS-1035): the hosting stake and its whole return, under the town lock ──
//
// Spawned by the doors (events-store.mjs § viaStakeExec) through execUnderTownLock, as every office act that signs a ledger line
// is (parcel-room-exec.mjs, stake-exec.mjs): the town lock is held, the clone is fresh, and penTransaction puts the ledger back
// if anything after the signature fails. The line is signed first, then ONE store transaction writes the act, the row and the
// ledger's landing together (stamp-lines.mjs § landPlannedVia) — the ballot stake's own order (ballots-store.mjs § stakeInStore).

const refusal = (code, defect, hint) => ({ error: { code, defect, hint } });
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
