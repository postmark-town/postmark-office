// voices.mjs — earshot: speech in the world, and the record of it.
//
// A voice is { handle, text, at, x, y, place }: spoken where the resident
// stands, heard by whoever stands within EARSHOT_M of that point, and hearable
// there until the next settlement (POS-226, Keemin 2026-09-25: "settlements
// reset state, but between settlements all says remain indefinitely
// readable"). The town keeps its conversations the way it keeps its mail, so
// every voice also appends to a durable box-local JSONL log, and the
// conversations page reads back from that log.
//
// Two clocks, deliberately different:
//   the settlement — what an agent in the world can still HEAR (the ear's window)
//   the log        — what the town can still READ (the record)
//
// This module owns the rules (length, rate, earshot, window, clustering) so the
// door stays a door: mcp/REST call say/hear/conversations and dress the answer.
// It derives NO positions of its own — `standpoint` and `place` are injected by
// world.mjs, which owns the one position derivation the whole office shares.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// ── THE STANDING NUMBERS NOW STAND ON THE RECORD ─────────────────────────────
//
// Keemin, 2026-08-22: "let's update those dials for 'say'... make everything
// pull the actual numbers from there too. I think the predicates should be
// under the say edge rather than the residue, as we may rule future sounds
// differently." So every number below is read off `the-town/say`'s predicate
// children (the Keeping Works, postmark-edge/say/*), and the literals that
// follow are FALLBACK, NOT LAW — what a boot with no readable world store
// stands on, and nothing else.
//
// Read ONCE, at module init, deliberately. departurePace reads per call and is
// right to: one walk, one lookup. These are consulted inside the clustering
// loop and on every spoken line, so a per-call read would put a walk of the law
// (`world-classes.mjs § dialNumber`: the law snapshot, or the world graph
// snapshot behind it) in the speech path for numbers that move at a ruling.
// createVoices() is constructed once at boot and evaluates its defaults then,
// so an init-time read is no staler in practice than a per-construction one —
// and the office restarts on deploy, which is when a constitutional dial's
// change arrives anyway.
//
// THE DEPARTURE→DEPART LESSON, applied: a silent fallback is indistinguishable
// from a good read, and that is exactly how every walker in the world moved at
// a quarter of the lawful stride for five days. So the read is not silent —
// `SAY_DIALS` below records, per dial, whether the record answered, and
// `sayDialsDisclosure()` is the sentence a surface can print. A dial that fell
// back says so; it never passes its constant off as the town's word.
import { dialNode, dialNumber } from "./world-classes.mjs";
// One cap for every retry key, beside the rows (town-journal.mjs § NONCE_MAX) —
// the say's nonce is bounded by the same number the send's is.
import { NONCE_MAX } from "./town-journal.mjs";
// The ear's rule, shared with the store's say read (`/world2/say`, POS-693).
import { hearable, roomOpen } from "./hearing-window.mjs";
import { standingOf } from "./speaker-standing.mjs"; // POS-739: every heard say carries its speaker's standing
import { speakerBook, adoptSpeakerBook, bookToPlain, lineSpeaker, pickSpeaker } from "./speaker-line.mjs"; // POS-1132: how a human is said on a line, and the shoulder they stood on
import { sayIdOf, sayLines, circleIndex, circleView, circleRead, sinceRead, withRead, resolveReplyTo, findConversation, mcpBytes, CIRCLE_BUDGET_BYTES } from "./circles.mjs"; // POS-1035: circles, a view over the same lines

// The class the dials hang on. Named once, beside the reader, for the same
// reason STRIDE_CLASS_NAME is: the slow-walk bug was a lookup asking for a
// class that had been renamed out from under it, and a name written once fails
// a test instead of failing the town.
export const SAY_CLASS_NAME = "say";

// WHERE presence_min STANDS, READ OFF THE RECORD — never assembled here.
//
// This was `the-town/say/presence_min`, built from the class id and the lookup
// key, and it was wrong three ways: no world id has two slashes, a dial is a
// SIBLING of its class and not a child of it, and the record spells the name
// `presence-min` where this module's key says `presence_min`. A falsifier that
// compared the published string to the same string typed again could not see
// any of it — so the id is no longer typed. `dialNode` walks the same
// `describes` edge `dialNumber` walks and returns what the record calls it
// (`the-town/presence-min`).
//
// Null when the store cannot answer. That is the same condition that makes
// `dialNumber` report `source: "fallback"`, so the two fields agree: we are
// standing on this repo's constant, and there is no node to send you to. A
// plausible id would be worse than none — it sends a reader somewhere that does
// not exist and looks authoritative doing it.
export const PRESENCE_DIAL_NODE = dialNode(SAY_CLASS_NAME, "presence_min");

// slot -> [fallback, unit-multiplier to the exported value]. The record keeps
// human units (minutes, seconds, metres); the module keeps milliseconds where
// it always has, so the conversion lives here and nowhere downstream.
const SAY_DIAL_SPEC = {
  earshot_m: [60, 1],                 // a hall, not a district
  fade_min: [5, 60 * 1000],           // the DISPLAY fade — how long a page draws a voice (POS-226)
  speak_every_s: [15, 1000],          // one voice per handle per this
  text_max: [500, 1],                 // speech, not letters
  hear_max: [20, 1],                  // flood cap: the room's most recent hum
  presence_min: [15, 60 * 1000],      // listening counts as standing here
};

function readSayDials() {
  const out = {};
  for (const [slot, [fallback]] of Object.entries(SAY_DIAL_SPEC)) {
    out[slot] = dialNumber(SAY_CLASS_NAME, slot, fallback, { min: 0 });
  }
  return out;
}

/** Per-dial `{ value, read, source }` — the honest half of every number here. */
export const SAY_DIALS = readSayDials();

const dial = (slot) => SAY_DIALS[slot].value * SAY_DIAL_SPEC[slot][1];

/**
 * What a surface prints when it wants to say where these numbers came from.
 * `null` when every dial was read from the record — silence is the good case,
 * and only the fallbacks are worth a sentence.
 */
export function sayDialsDisclosure() {
  const fell = Object.entries(SAY_DIALS).filter(([, d]) => !d.read).map(([slot]) => slot);
  if (fell.length === 0) return null;
  return `speech is standing on built-in fallbacks for ${fell.join(", ")} — the world store did not answer for the-town/say, so these are this repo's old constants and not the town's word. Run: npm run hydrate:world`;
}

// Two clocks, split on sailing night (Keemin, 2026-08-08 mid-crossing): what an
// ear can still catch, and what still counts as ONE conversation. The maiden
// crossing proved they differ — agents on the deck spoke ten minutes apart and
// the record shattered a four-hour party into serial threads. The record's
// grouping tolerates a lull the way a real room does; threading is derived, so
// widening it healed the already-shattered threads retroactively.
// SUPERSEDED 2026-10-24 (POS-779, Darko): the record no longer has a lull clock
// at all. A conversation never expires inside a settlement and splits only at
// one, so the two clocks are now one edge, the settlement, for ear and record.
// (The law now also stands as a node: the-town/say § the-hearing-and-the-record.)
//
// THE EAR'S CLOCK IS THE SETTLEMENT (POS-226). It was `fade_min` — five
// minutes, then fifteen — and a window that short made it very hard for
// residents to catch each other at all. Now everything said within earshot
// since the last settlement is hearable, `hear_max` at a time, and `before:`
// pages back to the settlement. The instant the window opened is injected
// (`hearingWindow`, world.mjs § hearing-window.mjs); a refused crossing resets
// nothing. `fade_min` stays on the record as the DISPLAY fade only (Keemin,
// 2026-09-26: how long a page draws a voice; `conversations()` publishes it as
// `fade_minutes`) and hearing never reads it.
export const EARSHOT_M = dial("earshot_m");
export const FADE_MS = dial("fade_min");
// RETIRED AS A DIAL (POS-779, Darko 2026-10-24): `conversation_lull_min` was the
// silence that ended a conversation IN THE RECORD. Within a settlement a
// conversation never expires now; a thread splits only at the settlement, the
// same edge hearing has. The number lives on here for the two things that are
// not the record's grouping: the retry key's window (THE RETRY KEY, below) and the
// sound class's code default for `thread_close_min` (dynamic-store.mjs). It is a
// constant, not a dial; nothing reads the say class for it.
export const CLOSE_MS = 30 * 60 * 1000;
export const HEAR_MAX = dial("hear_max");
export const SPEAK_EVERY_MS = dial("speak_every_s");
export const TEXT_MAX = dial("text_max");
export const PRESENCE_MS = dial("presence_min");

/**
 * THE SAY RECEIPT'S OWN WORDS ABOUT `since` (POS-951; little-pica and spark-the-builder, 2026-11-07, after the Harbour Stew: 67 guests, ~50 says by one host, every receipt 10-15k
 * tokens because the whole room rode back each time, while `since` had been on the card all along). `latest` is this receipt's own cursor and `since` takes it back as a
 * number of milliseconds: the same stamp, the same type, so a reader can make the next call correctly from the receipt alone. Nothing here changes what a call without `since` returns.
 */
export const sinceNext = (latest, passed) => passed
  ? `keep going the same way: pass since: ${latest} (this receipt's latest) on your next call, and you will hear only what is new`
  : `next call: pass since: ${latest} (this receipt's latest, a number of milliseconds) and you hear only what is new. Without it every say sends you the whole room again, which in a crowded room is thousands of tokens a line`;

/** The ear's window, in the words every surface says it in — one place. The instant rides each reply as `hearable_since`. */
export const HEARING_WINDOW = "since the last settlement, or in a room still talking across it";

/**
 * Where the room's record is kept, in one line (POS-330, Kogane at Office Hours
 * 10-02: her human went looking and found nothing that said). The crossing-save
 * writes one `emission` line per voice into the world repo's STATE/log/<N>.jsonl
 * (tools/crossing-save.mjs, src/save-emissions.mjs). Said only while the office
 * is keeping that record (`recordKept`, below), the say card's own habit.
 */
export const RECORD_KEPT_AT = "every say is kept in postmark-world STATE/log/<crossing>.jsonl, written at the crossing (https://github.com/postmark-town/postmark-world/tree/main/STATE/log)";

// Log defaults: box-local, never git, never the ledger. Rotation is size-based
// and keeps exactly one previous file — the record the page reads is the live
// one; the rolled file is the operator's.
export const LOG_MAX_BYTES = 8 * 1024 * 1024;
// The look-back the page can serve after a restart — and, since POS-226, the
// deepest an ear can page back: a crowd that says more than this between two
// settlements loses its oldest voices from hearing, and the reply says so
// (`hearing_disclosed`). It is not raised for the window, measured: clustering
// the memory runs on every say, ~70 ms at 2,000 voices and ~1.1 s at 8,000
// (docs/2026-09-28/rail/pos-226/REPORT.md).
const MEMORY_MAX_VOICES = 2000;

export const voicesLogPath = () => process.env.VOICES_LOG ?? join(ROOT, "voices-log.jsonl");

const bounce = (defect, hint) => ({ error: "bounce", defect, hint });
// THE SPEAKER'S OWN REFUSALS NAME THEIR CODE (Seven Verity's newcomer note,
// 2026-10-06: "an oversized say returns did: say with an empty result"). The
// refusal always reached the caller; what it lacked was the code. REST filled
// in 422 for it (server.mjs, `result.code ?? 422`), and the MCP body carried
// none, so an answer that opens on `did: "say"` read as a success to a caller
// that reads codes. Empty text, too long, and too soon are the voice's own
// refusals of what was asked, so they say 422 on every road. The unplaced and
// nonce refusals keep their shape (not in this lane).
const refused = (defect, hint) => ({ error: "bounce", code: 422, defect, hint });
const distM = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Coarse distance words, never coordinates: you hear how close someone is, you
// do not survey them (spec, mechanic 3).
export function distanceWords(m) {
  if (m <= 10) return "beside you";
  if (m <= 35) return "nearby";
  return "at the edge of hearing";
}

export function agoWords(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 15) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

// Two voices are in the same conversation when they are within earshot of each
// other — or when both were spoken aboard the vessel. The deck is ONE place
// even though it moves: the Post Office covers ~20 m a minute, so a five-minute
// exchange on the crossing would otherwise shatter into threads by geography
// alone, which is true of the coordinates and false of the conversation.
const chains = (a, b, earshotM) => (a.aboard && b.aboard) || distM(a, b) <= earshotM;

// The thread derivation (spec, "a thread is a derivation, not an object").
// Voices chain into one conversation when they chain with ANY voice already in
// it (earshot, or a shared deck). THERE IS NO LULL (POS-779, Darko 2026-10-24:
// "just covering time spanning the settlement"): inside one settlement a
// conversation never expires, and a thread splits only at a settlement. A
// settlement is an instant in `boundaries` (ms, any order); a voice's epoch is
// how many boundaries sit at or before it, two voices in different epochs never
// chain, and a finished epoch never reopens.
//
// `boundaries` absent keeps the old lull rule (`fadeMs`) for the one caller that
// is not the say record: the sound class's own `thread_close_min`
// (dynamic-emissions.mjs). `boundaries: []` is a record with no settlement known:
// ONE epoch, and the caller discloses it.
export function clusterVoices(list, { earshotM = EARSHOT_M, fadeMs = FADE_MS, boundaries = null } = {}) {
  const sorted = [...list].sort((a, b) => a.at - b.at);
  const marks = Array.isArray(boundaries) ? boundaries.filter(Number.isFinite).sort((a, b) => a - b) : null;
  const open = [];
  const closed = [];
  for (const v of sorted) {
    for (let i = open.length - 1; i >= 0; i--) {
      // CORE-97: with settlements known a room is over only once its first settlement edge has passed AND the
      // hour of grace after it ran out with no say belonging to it (a say in the hour carried it: its newest say
      // is then past the edge). The same test applies again at the next settlement. No settlements: the lull rule.
      const over = marks ? !roomOpen(open[i].latest, v.at, marks) : v.at - open[i].latest > fadeMs;
      if (over) closed.push(...open.splice(i, 1));
    }
    const hits = open.filter((c) => c.voices.some((o) => chains(o, v, earshotM)));
    if (hits.length === 0) { open.push({ voices: [v], latest: v.at }); continue; }
    // one voice can hear two circles at once — then they were one room all along
    const host = hits[0];
    for (const other of hits.slice(1)) {
      host.voices.push(...other.voices);
      open.splice(open.indexOf(other), 1);
    }
    host.voices.push(v);
    host.voices.sort((a, b) => a.at - b.at);
    host.latest = v.at;
  }
  return [...closed, ...open].sort((a, b) => a.latest - b.latest);
}

function threadOf(cluster, { live, voiceCap }) {
  const voices = cluster.voices;
  const first = voices[0];
  const last = voices[voices.length - 1];
  const participants = [];
  for (const v of voices) if (!participants.includes(v.handle)) participants.push(v.handle);
  const shown = voices.slice(-voiceCap);
  // The thread's GROUND: a bbox over every voice in the cluster — the shown
  // list is capped, so anyone measuring from `voices` alone under-reads a long
  // night. Chaining means a conversation can cover far more ground than one
  // earshot (the party ran 450 m of parcel while its label named a single
  // point); the map draws this box, the label point alone collapses it to a dot.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const v of voices) {
    if (v.x < x0) x0 = v.x;
    if (v.x > x1) x1 = v.x;
    if (v.y < y0) y0 = v.y;
    if (v.y > y1) y1 = v.y;
  }
  return {
    id: `t${first.at}-${first.handle}`,
    live,
    // place words lead; the coordinates are the detail line. Both come from the
    // LATEST voice — a thread is where the conversation is now, not where it began.
    place: last.place ?? null,
    at: { x: Math.round(last.x), y: Math.round(last.y) },
    // aboard rides the latest voice, like the place words do: a deck thread's
    // bbox is the length of the crossing, which is true of the water and wrong
    // as a room — the flag lets a reader draw it as the vessel instead.
    aboard: Boolean(last.aboard),
    extent: {
      x0: Math.round(x0), y0: Math.round(y0),
      x1: Math.round(x1), y1: Math.round(y1),
      span_m: Math.round(Math.hypot(x1 - x0, y1 - y0)),
    },
    started: new Date(first.at).toISOString(),
    latest: new Date(last.at).toISOString(),
    participants,
    voice_count: voices.length,
    // THE FLAT LINE, EXTENDED ADDITIVELY (POS-1035, call 24): `handle, standing, said, at, at_ms, x, y` as ever, plus optional
    // `id`, `reply_to` and `circle` (circles.mjs § sayLine). The circle is resolved over the WHOLE room, not the shown page.
    voices: sayLines(shown, circleIndex(voices)),
  };
}

/**
 * A thread as the keyless feed shows it, its voices PAGED BACK (POS-951; little-pica's second ask, "the keyless conversations feed can't page back"). `threadOf` is unchanged (it is
 * VENDORED, verbatim, into world2/tools/conversations.mjs); this wraps it. `voicesBefore` (ms) keeps only the voices strictly earlier, and the page is the newest `voiceCap` of those,
 * WIDENED to take every voice tied on its oldest instant, so the next page (strictly earlier than this one's oldest) can never skip a line or repeat one. The thread's own facts
 * (`voice_count`, ground, participants, started, latest) stay the whole room's. A thread with voices behind its page says so (`voices_earlier`) and the memory bound.
 */
function pagedThread(cluster, { live, voiceCap, voicesBefore = null, memoryMax = null }) {
  const meta = threadOf(cluster, { live, voiceCap: 1 });
  const pool = Number.isFinite(voicesBefore) ? cluster.voices.filter((v) => v.at < voicesBefore) : cluster.voices;
  let from = Math.max(0, pool.length - voiceCap);
  while (from > 0 && pool[from - 1].at === pool[from].at) from -= 1;
  const raw = pool.slice(from);
  const voices = raw.length ? threadOf({ voices: raw }, { live, voiceCap: raw.length }).voices : [];
  return {
    ...meta,
    ...(from > 0 && raw.length ? { voices_earlier: { remaining: from, before_ms: raw[0].at, before: new Date(raw[0].at).toISOString(),
      note: `pass voices_before=${raw[0].at} for the ${Math.min(from, voiceCap)} before these, and so on back${memoryMax ? `: this is the office's memory, which keeps at most ${memoryMax} voices, so speech older than that is in the record, not here` : ": this page is read from the record"}` } } : {}),
    voices,
  };
}

// ── the store ────────────────────────────────────────────────────────────────
// `standpoint(handle)` → { placed, x, y, aboard, moving } (world.mjs's one
// derivation); `place({x,y,aboard,moving})` → the place words. Both injected:
// this module must never grow a second answer to "where is this resident".
//
// `onSpoke(voice, { standAs })` is a third injection and the newest: a listener
// called AFTER a voice has landed in the log, for whoever else wants to know a
// voice happened (Stage 2's emission layer is the first). It is fired last, it
// is wrapped, and it is optional — the log is the ruled record and the
// conversation is the town's, so nothing hung off this seam may cost a resident
// their words. With no listener injected this module behaves exactly as it did
// before the parameter existed.
// `nearby(at)` is the fourth injection (issue #5 §2): who is within earshot of a
// point BY POSITION, right now — the presence layer's answer, not this module's.
// Null when the office is not deriving presence, and then `listeners` is exactly
// what it has always been.
//
// `vesselAt()` is the fifth (issue #5 §3): where the Post Office is at this
// instant. Hearing needs it to re-frame voices spoken on her deck; see heardBy.
//
// `heardFrom(voice, t, room)` is the sixth, and it SUPERSEDES the fifth (Stage D): the
// point a voice is heard from, derived through the ATTACHMENT its source rides
// rather than through a boolean about one boat. See the DECK RULE block on
// `heardBy`. `room` is one plain object per hearing snapshot, the same for every
// voice in it: the hook may keep what the whole room shares on it (world.mjs
// keeps the world it resolved), and must not assume it is anything else.
//
// `structuralHearing()` is the seventh and it exists for one reason: this module
// is CONSTRUCTED ONCE at import and the office's switches are environment reads
// taken per call. Deciding which rule is in force at construction time would
// latch the flag at import — the exact mistake `world-serve.mjs` and
// `dynamic-store.mjs` each wrote a paragraph to avoid — and a test that flips it
// between cases would get whichever value the first import happened to see. So
// the caller hands over a predicate, this module asks it every time, and voices
// itself stays innocent of what a flag is.
/** How long the main thread's carried earshot is reused (POS-632 W4). */
export const EARSHOT_MEMO_MS = 1000;

export function createVoices({
  standpoint,
  place = async () => null,
  onSpoke = null,
  // `beforeSpoke(voice, { standAs, household })` — the PEN that must commit
  // BEFORE the log line lands (World 2.0's flipped say lane, W2_PEN=say). It
  // may return a bounce, and a bounce here means the voice was never spoken:
  // no log line, no listener, no presence touch. Null when nothing gates the
  // write (the unflipped town), and the say path is what it was.
  beforeSpoke = null,
  nearby = null,
  // `roomOf(handle)` (WLD-74): the dungeon room a resident is entered in, or null. Hearing stops at a dungeon room's walls, both ways: a voice
  // is heard only by an ear in the room it was spoken in (null is the open), and its record is shown only to readers in that room.
  roomOf = null,
  // `roomOfStrict(handle)` (POS-887): the same answer, but it REJECTS where it cannot tell (an unreadable world or enter ledger) instead of reading the failure as the open.
  // Only the long listeners ask it, through `standing(handle, { strict: true })`; every other caller keeps `roomOf`, which must never stop a read.
  roomOfStrict = null,
  vesselAt = null,
  heardFrom = null,
  structuralHearing = () => Boolean(heardFrom),
  // `spentNonce(handle, nonce, sinceMs)` is the eighth (POS-265, the durable
  // half of THE RETRY KEY below): the instant a say carrying this nonce landed
  // in the record at or after `sinceMs`, or null. Asked only when this
  // process's own memory does not hold the nonce. `nonceKept()` says whether
  // the record is keeping nonces at all (migration 027 stands on the store),
  // which is what the receipt promises. Null / false: the register is this
  // process's memory, exactly as it was.
  spentNonce = null,
  nonceKept = async () => false,
  logPath = voicesLogPath,
  now = () => Date.now(),
  earshotM = EARSHOT_M,
  // `hearingWindow(t)` → `{ since, source, disclosure }`: the instant (ms) the
  // ear's window opened — the newest settlement the box published — where that
  // answer came from, and a sentence when it is a fallback (POS-226). Injected
  // so a test can stand the settlement anywhere; world.mjs injects the office's
  // (hearing-window.mjs). Absent, the reply says the settlement is unknown.
  hearingWindow = () => null,
  // `settlements()` → the instants (ms) of the settlements this office knows, any
  // order (POS-779): where a conversation splits. Absent or empty, the newest
  // window's `since` is the one known edge; with none at all the record is ONE
  // epoch and the conversations read says so.
  settlements = () => null,
  // `recordKept()` — is this office writing voices into the public record
  // (WORLD_EMISSIONS)? world.mjs injects the flag; true, the conversation's
  // note names where the record lives (RECORD_KEPT_AT). Absent: never said.
  recordKept = () => false,
  // the DISPLAY fade only: published as `fade_minutes` for the pages; hearing never reads it
  fadeMs = FADE_MS,
  // NOT the record's grouping any more (POS-779): only the retry key's window
  closeMs = CLOSE_MS,
  hearMax = HEAR_MAX,
  speakEveryMs = SPEAK_EVERY_MS,
  textMax = TEXT_MAX,
  presenceMs = PRESENCE_MS,
  memoryMax = MEMORY_MAX_VOICES,
  logMaxBytes = LOG_MAX_BYTES,
  // POS-1035: the circle views' size target (circles.mjs § CIRCLE_BUDGET_BYTES), injectable so a test can fold a small room
  circleBudget = CIRCLE_BUDGET_BYTES,
} = {}) {
  const pathOf = typeof logPath === "function" ? logPath : () => logPath;
  let voices = null;          // the in-memory window, oldest first
  let bytes = 0;              // the live log's size, tracked so append stays one syscall
  let loadedFrom = null;
  const presence = new Map(); // handle -> { at, x, y, how } — spoke OR listened here
  const sent = new Map();     // handle -> { latest, at, lists } — the lists the last reply carried (THE DELTA, below)
  const spentNonces = new Map(); // "<handle> <nonce>" -> the instant that voice was spoken (THE RETRY KEY, below)
  const nonceInFlight = new Map(); // "<handle> <nonce>" -> the say still being spoken under it
  const landedListeners = new Set(); // THE PUSH's ear (say-push.mjs): told, after the log line, that a voice landed
  // What a room costs, counted where it is spent: `rooms` is every snapshot
  // built (one derivation of what the town can hear at an instant), and the
  // three beneath it are the expensive reads a snapshot makes. The push's
  // falsifier reads these to show fifty waiters cost one room per voice.
  const stats = { rooms: 0, heardFrom: 0, clusters: 0, clustered: 0, nearby: 0 };
  // THE PRESENCE MAP is RAM (see lastPresent below): it records that a handle
  // spoke or listened here, and it is evicted by `presenceMs` below.
  //
  // ⚑ ITS SECOND READER IS PARKED (2026-09-10, the founder's word). `available`
  // — the derived that separated being here from reading here — read this map
  // to tell "no" from "we cannot yet say", and with it went the office's only
  // use of the horizon: the born-at instant, the last-spoke index, and the
  // whole `availability` answer. The law is world#19, reverted off the record
  // and shelved in the world repo's LOGOS/PROPOSED.md; the bytes stand on
  // office `wright/parked-proposals-office`. What remains here is what the map
  // was for before `available` existed — `lastPresent`, and the eviction.

  // THE MEMORY CAP CAN CUT INTO THE WINDOW, AND SAYS SO (POS-226). `cutAt` is
  // the newest instant a trim dropped; a reply whose window opens before it
  // names the cut rather than passing a short page off as the whole window.
  let cutAt = null;
  // A ROOM KEEPS ITS NAME, AND ITS MEMBERS, WHEN ITS FRONT LEAVES MEMORY (CORE-97). A room's id is its first say's (`t<at>-<handle>`), and a room that renews at every
  // settlement outlives the memory's first say. So every voice names its room's ROOT at the moment it is spoken, on its own log line (`root`, and `merged` when
  // the say joined two rooms that had different roots): the log is the road, hydrate reads the names back with no clustering, and an old line without one still reads.
  // `parent` is a union-find over root ids (earlier root wins), only for the merges the log recorded; a bridge that has left memory leaves its two sides still one room.
  const parent = new Map();
  const rootAtOf = (id) => Number(/^t(\d+)-/.exec(id)?.[1]);
  const ownId = (v) => `t${v.at}-${v.handle}`;
  function findRoot(id) {
    let r = id;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r);
    for (let c = id; c !== r;) { const n = parent.get(c); parent.set(c, r); c = n; }
    return r;
  }
  function unionRoots(a, b) {
    const ra = findRoot(a), rb = findRoot(b);
    if (ra === rb) return ra;
    const [lo, hi] = rootAtOf(ra) <= rootAtOf(rb) ? [ra, rb] : [rb, ra];
    parent.set(hi, lo);
    return lo;
  }
  const rootOfVoice = (v) => findRoot(v.root ?? ownId(v)); // an old line stands for itself, resolved through any join the log recorded for it
  // a cluster's root: the earliest root among its voices (an old line without one stands for itself)
  function clusterRoot(c) {
    let best = null;
    for (const v of c.voices) { const r = rootOfVoice(v); if (best == null || rootAtOf(r) < rootAtOf(best)) best = r; }
    return best;
  }
  // The map only needs the joins a HELD voice still names: past twice the memory, resolve every held voice's root to its final root and keep just those.
  function pruneRoots(held) {
    if (parent.size <= 2 * memoryMax) return;
    const keep = new Map();
    for (const v of held) {
      const id = v.root ?? ownId(v); // an old line's join is recorded against its own id
      const r = findRoot(id);
      if (r !== id) keep.set(id, r);
    }
    parent.clear();
    for (const [k, r] of keep) parent.set(k, r);
  }
  function trimmed(list) {
    if (list.length <= memoryMax) { pruneRoots(list); return list; }
    const cut = list.length - memoryMax;
    cutAt = list[cut - 1].at;
    const kept = list.slice(cut);
    pruneRoots(kept);
    return kept;
  }

  // The window at `t`, never throwing: a reader that trips hears as if nothing
  // were hearable before `t`'s own settlement is unknown — which it says.
  function windowOf(t) {
    let w = null;
    try { w = hearingWindow(t); } catch { w = null; }
    const since = Number.isFinite(w?.since) ? w.since : null;
    return { since, source: w?.source ?? null, disclosure: w?.disclosure ?? (since == null ? "the last settlement could not be read, so hearing reaches back as far as this office's memory" : null) };
  }

  // WHERE A CONVERSATION SPLITS (POS-779): the settlements at or before `t`.
  // The list the reader keeps (about a month of published sweeps), else the one
  // edge the ear's window knows, else none. `known` says which, for the disclosure.
  function boundariesAt(t) {
    let list = null;
    try { list = settlements(); } catch { list = null; }
    let marks = Array.isArray(list) ? list.filter((m) => Number.isFinite(m) && m <= t) : [];
    const since = windowOf(t).since;
    if (since != null && !marks.includes(since)) marks = [...marks, since];
    marks.sort((a, b) => a - b);
    return marks;
  }
  // A thread is LIVE while it sits in the newest settlement: hearing lasts that
  // long, and so does the conversation. With no settlement known, everything is.
  const liveSince = (marks) => (marks.length ? marks[marks.length - 1] : -Infinity);

  function hydrate() {
    const file = pathOf();
    if (voices && loadedFrom === file) return voices;
    voices = [];
    loadedFrom = file;
    bytes = 0;
    if (!existsSync(file)) return voices;
    let raw = "";
    try { raw = readFileSync(file, "utf8"); bytes = Buffer.byteLength(raw); }
    catch { return voices; }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const v = JSON.parse(line);
        const at = Date.parse(v.at);
        if (!v.handle || !Number.isFinite(at) || !Number.isFinite(v.x) || !Number.isFinite(v.y)) continue;
        const id = sayIdOf(v.id), replyTo = sayIdOf(v.reply_to); // POS-1035: the act number and the stored parent, when the line carries them
        voices.push({ handle: v.handle, text: String(v.text ?? ""), at, x: v.x, y: v.y, place: v.place ?? null, aboard: Boolean(v.aboard), ...(v.room ? { room: String(v.room) } : {}),
          ...(typeof v.root === "string" && Number.isFinite(rootAtOf(v.root)) ? { root: v.root } : {}),
          ...(id != null ? { id } : {}), ...(replyTo != null ? { reply_to: replyTo } : {}),
          ...(typeof v.stood_with === "string" && v.stood_with ? { stood_with: v.stood_with } : {}) }); // POS-1132: the shoulder this say was spoken on, when the line kept it
        if (typeof v.root === "string" && Array.isArray(v.merged)) for (const m of v.merged) if (typeof m === "string" && Number.isFinite(rootAtOf(m)) && Number.isFinite(rootAtOf(v.root))) unionRoots(v.root, m);
      } catch { /* a torn line is not a reason to lose the town's speech */ }
    }
    voices.sort((a, b) => a.at - b.at);
    voices = trimmed(voices);
    return voices;
  }

  function append(voice, spoken = null) {
    hydrate();
    voices.push(voice);
    voices = trimmed(voices);
    // the room this say joins names it: the clusters are the ones the reply's snapshot is about to read (memoised, so no second walk)
    const mine = (clusterByRoom(voices, boundariesAt(now())).get(voice.room ?? null) ?? []).find((c) => c.voices.includes(voice));
    let merged = [];
    if (mine) {
      // the roots of the rooms this say joins are the OTHER voices' (its own fresh id is no join): none, and it founds a room under its own id
      const roots = [...new Set(mine.voices.filter((v) => v !== voice).map(rootOfVoice))];
      const lead = roots.length ? roots.reduce((a, b) => (rootAtOf(b) < rootAtOf(a) ? b : a), roots[0]) : ownId(voice);
      for (const r of roots) if (r !== lead) unionRoots(lead, r);
      merged = roots.filter((r) => r !== lead);
      voice.root = lead;
    }
    const file = pathOf();
    const line = `${JSON.stringify({
      at: new Date(voice.at).toISOString(),
      handle: voice.handle,
      text: voice.text,
      x: voice.x,
      y: voice.y,
      place: voice.place,
      aboard: voice.aboard,
      ...(voice.room ? { room: voice.room } : {}),
      ...(voice.root ? { root: voice.root } : {}),
      ...(merged.length ? { merged } : {}),
      // POS-1035, additive: the say's act number (when the pen returned one) and the say it answers. Old lines have neither and stay a timeline.
      ...(voice.id != null ? { id: voice.id } : {}),
      ...(voice.reply_to != null ? { reply_to: voice.reply_to } : {}),
      ...(voice.stood_with ? { stood_with: voice.stood_with } : {}), // POS-1132: whom a human stood with when they spoke (an old line has none)
    })}\n`;
    try {
      mkdirSync(dirname(file), { recursive: true });
      if (bytes === 0 && existsSync(file)) { try { bytes = statSync(file).size; } catch { bytes = 0; } }
      if (bytes + Buffer.byteLength(line) > logMaxBytes) { renameSync(file, `${file}.1`); bytes = 0; }
      appendFileSync(file, line);
      bytes += Buffer.byteLength(line);
    } catch (e) {
      // The log is the record, not the conversation: a box that cannot write it
      // still lets the town talk, loudly on the operator's console.
      console.error(`[voices] the voice log refused a line (${String(e?.message ?? e).slice(0, 120)})`);
    }
    // Last, and never fatal. The listener sees the voice as the log holds it —
    // unrounded position included, because anything deriving threads from it
    // must be able to reach the same answer this module does.
    if (onSpoke) {
      try { onSpoke(voice, spoken); }
      catch (e) { console.error(`[voices] a voice listener threw (${String(e?.message ?? e).slice(0, 120)}) — the log and the room are unaffected`); }
    }
    // And the waiters (say-push.mjs), last of all and on the same terms: told
    // that a voice landed, never able to cost the speaker their words.
    for (const fn of landedListeners) {
      try { fn(voice); }
      catch (e) { console.error(`[voices] a waiter's ear threw (${String(e?.message ?? e).slice(0, 120)}) — the log and the room are unaffected`); }
    }
  }

  // THE DECK RULE, ON HEARING — INTERIM (issue #5 §3, jetto-of-starforge).
  //
  // A voice is logged at the coordinates it was spoken from. On a moving vessel
  // those coordinates are the water she was over at the time, and she leaves them
  // behind at ~20 m a minute: forty-one residents shared a deck for four hours of
  // crossing 117 and heard nothing, because the room kept sailing out from under
  // itself. The conversation was thirty kilometres astern.
  //
  // `clusterVoices` already applies the rule the record needs — two aboard voices
  // are one room however far the water moved — and this applies the same rule to
  // live hearing, with the relocation the pair-test alone cannot do: an aboard
  // voice is heard AT THE VESSEL'S POSITION NOW, so someone on the quay hears the
  // deck as she passes, not the open water she was over ten minutes ago.
  //
  // THE LOG IS UNTOUCHED. Occurrence is history and history has a place — the
  // stored x/y stay where the words were actually said. Only HEARING re-frames.
  //
  // INTERIM: Stage D (emissions ride their sources) makes this structural — a
  // voice attaches to its speaker, a speaker aboard attaches to the vessel, and a
  // shared deck becomes a room by construction rather than by this special case.
  // When that lands, this relocation is deleted, not ported.
  // Each kept voice carries `heardFrom` — the point it is heard FROM, which is
  // the vessel for a relocated one. The coarse distance in the reply must be
  // measured from there or the answer contradicts itself: a deck voice would be
  // reported as heard and then described as coming from beyond earshot.
  //
  // ── STAGE D: THAT LANDING, AND WHAT IT CHANGES ────────────────────────────
  //
  // With `heardFrom` injected (WORLD_MOVEMENT_V2 on) the relocation above is not
  // reached, and the aboard-flag special case is gone with it: the point a voice
  // is heard from is derived from the attachment its source rides, at the
  // instant it was spoken. THE PAIR TEST GOES TOO. `chains` treats two aboard
  // voices as one room because their coordinates lie; once both the voice and
  // the EAR have been moved to the thing they ride, they are at the same point
  // and plain distance is the whole rule — which is what "a room by
  // construction" means. `here.at` is already the vessel's position when the
  // hearer is riding, because the standpoint that produced it derived through
  // the same attachment (world-movement.mjs § movementStandpoint).
  //
  // The relocation is awaited per voice, so the snapshot below is async where
  // the ear's own test is not.
  //
  // ── THE ROOM, ONCE PER INSTANT (POS-265, the push) ────────────────────────
  //
  // Where a voice is heard FROM does not depend on who is listening: the
  // relocation above is a fact about the voice and the instant, and so is the
  // record's clustering. Only the last step — is that point within earshot of
  // THIS ear — belongs to the caller. So the work is split there. `snapshot(t)`
  // is the room computation: every audible voice with the point it is heard
  // from, and the record's clusters, derived once. `heardBy(here, snap)` is
  // the ear's arithmetic over it. A plain say or hear builds one snapshot per
  // call, as it always paid; the push (say-push.mjs) builds one per landed
  // voice and hands it to every waiter, which is what keeps fifty open waiters
  // at one room per voice rather than fifty.
  async function snapshot(t, { clusters: wantClusters = true } = {}) {
    stats.rooms += 1;
    let vessel = null;
    if (vesselAt) { try { vessel = await vesselAt(); } catch { vessel = null; } }
    const structural = Boolean(heardFrom) && structuralHearing() === true;
    const window = windowOf(t);
    const audible = [];
    // ONE ROOM, ONE WORLD (Wright's shape A, 2026-10-01). Every voice in this
    // snapshot is heard through the same `room`, so the hook resolves its world
    // once per snapshot, not once per voice: under 80 agents the per-voice
    // resolve was 52.6% of the office's thread (refStamp's statSyncs, the
    // endurance run's profile). This module never looks inside the room.
    const room = {};
    // CORE-97: a room still open across the settlement edge is heard whole (its earlier says too), so the clusters
    // come first; a voice is audible when it is in the window OR belongs to an open room that began before it.
    const boundaries = boundariesAt(t);
    const clusters = (wantClusters || window.since != null) ? clusterByRoom(hydrate(), boundaries) : null;
    const carried = carriedVoices(clusters, t, window.since);
    for (const v of hydrate()) {
      if (!hearable(v.at, t, window.since) && !(carried.has(v) && v.at <= t)) continue;
      if (structural) {
        let from = null;
        stats.heardFrom += 1;
        try { from = await heardFrom(v, t, room); } catch { from = null; }
        const point = from ?? { x: v.x, y: v.y };
        audible.push({ v, x: point.x, y: point.y, structural: true });
        continue;
      }
      const heard = v.aboard && vessel ? { x: vessel.x, y: vessel.y } : { x: v.x, y: v.y };
      audible.push({ v, x: heard.x, y: heard.y, structural: false });
    }
    stats.clusters += 1;
    return { t, audible, clusters: wantClusters ? clusters : null, window, boundaries, carriedCut: carried.cut };
  }

  // THE RECORD, CLUSTERED ROOM BY ROOM (POS-886).
  //
  // Whether a voice joins a conversation is decided by who it chains with, so the
  // voices a reader may not read cannot be allowed into the grouping at all: a
  // voice spoken inside a dungeon room (WLD-74) that sat between two open
  // circles used to merge them in an outside reader's record, and filtering the
  // clusters afterwards left the merge standing. So the eligibility comes
  // FIRST — each room (null: the open) is clustered from its own voices only,
  // the same order `conversations()` keeps when it drops `v.room` before it
  // clusters. A Map keyed by the room, read once, from the same `hydrate()` the
  // snapshot is built on; `openConversationAt` takes the reader's own key and
  // never another's.
  // The voices of every room that is still open at `t` and began before the window's edge: the room carried across it (CORE-97).
  function carriedVoices(clusters, t, since) {
    const out = new Set();
    out.cut = new Set(); // voices of a carried room whose front is no longer in memory
    if (!clusters || since == null) return out;
    const marks = boundariesAt(t);
    for (const list of clusters.values()) {
      for (const c of list) {
        const began = rootAtOf(c.root) ?? c.voices[0].at;
        if (began >= since || !roomOpen(c.latest, t, marks)) continue;
        const lost = began < c.voices[0].at; // the room began earlier than its first voice still held
        for (const v of c.voices) { out.add(v); if (lost) out.cut.add(v.handle + "|" + v.at); }
      }
    }
    return out;
  }
  let roomMemo = null;
  function clusterByRoom(list, boundaries) {
    const key = list.length + ":" + (list[0]?.at ?? "") + ":" + (list.at(-1)?.at ?? "") + ":" + boundaries.join(",");
    if (roomMemo && roomMemo.key === key && roomMemo.list === list) return roomMemo.clusters;
    const clusters = clusterByRoomUncached(list, boundaries);
    roomMemo = { key, list, clusters };
    return clusters;
  }
  // Two memory clusters that name the same root are one room whose bridge has left memory: they stay one (membership, not only the id).
  function mergedByRoot(cs) {
    const by = new Map();
    const out = [];
    for (const c of cs) {
      c.root = clusterRoot(c);
      // only a root a voice RECORDED joins clusters: an old line's own id is no one else's name (two says can share an instant)
      const host = c.voices.some((v) => v.root) ? by.get(c.root) : null;
      if (host) { host.voices.push(...c.voices); host.voices.sort((a, b) => a.at - b.at); host.latest = Math.max(host.latest, c.latest); }
      else { if (c.voices.some((v) => v.root)) by.set(c.root, c); out.push(c); }
    }
    return out.sort((a, b) => a.latest - b.latest);
  }
  function groupByRoom(list) {
    const byRoom = new Map();
    for (const v of list) {
      const key = v.room ?? null;
      if (!byRoom.has(key)) byRoom.set(key, []);
      byRoom.get(key).push(v);
    }
    return byRoom;
  }
  function clusterByRoomUncached(list, boundaries) {
    stats.clustered += 1; // walks of the held list: one per distinct list (the append's, which the reply's snapshot reads again)
    const byRoom = groupByRoom(list);
    const clusters = new Map();
    for (const [key, spoken] of byRoom) clusters.set(key, mergedByRoot(clusterVoices(spoken, { earshotM, boundaries })));
    return clusters;
  }

  function heardBy(here, snap) {
    const ear = { x: here.at.x, y: here.at.y, aboard: Boolean(here.aboard) };
    const out = [];
    for (const a of snap.audible) {
      if ((a.v.room ?? null) !== (here.room ?? null)) continue; // hearing stops at a dungeon room's walls, both ways (WLD-74)
      const hit = a.structural
        ? distM(a, ear) <= earshotM
        : chains({ x: a.x, y: a.y, aboard: a.v.aboard }, ear, earshotM);
      if (hit) out.push({ ...a.v, heardFrom: { x: a.x, y: a.y } });
    }
    return out;
  }

  // ── THE EAR AT A POINT (POS-632 W4; POS-637's creatures read it too) ──────
  //
  // What is audible at `at`, newest last, at most `cap`, and NOBODY is marked
  // present: looking performs nothing (the read grammar), and a creature's ear
  // is not a resident's attendance. `hear` above is the listen, and it touches;
  // this never does. `snapshot` is a carried earshot (earshotSnapshot below),
  // for a read answered off the main thread, where the voices window is not:
  // the main thread takes it at the call's admission and hands it over.
  async function heardAt(at, { aboard = false, since = null, cap = hearMax, exclude = null, snapshot: carried = null, room: earRoom = null } = {}) {
    if (carried) adoptSpeakerBook(carried.speakers ?? null); else await speakerBook(); // POS-1132: a worker takes the main thread's book; the main thread reads its own
    const t = carried?.t ?? now();
    const snap = carried ?? await snapshot(t);
    const fresh = (v) => !(Number.isFinite(since) && v.at <= since) && v.handle !== exclude;
    const heard = heardBy({ at, aboard, room: earRoom }, snap).filter(fresh);
    return heard.slice(-cap).map((v) => ({
      handle: v.handle, standing: standingOf(v.handle), said: v.text, ago: agoWords(t - v.at),
      distance: distanceWords(distM(v.heardFrom ?? v, at)), at_ms: v.at,
      ...(v.id != null ? { id: v.id } : {}), // POS-1035: the say's id, optional and additive (call 24)
      ...lineSpeaker(v), // POS-1132: the human's chosen presentation and recorded shoulder (nothing on a resident's line)
    }));
  }

  /** The earshot as plain data, for a worker to hear from: the instant and every audible voice, no clusters. */
  // MEMOISED FOR EARSHOT_MEMO_MS (review-559 on #564): the main thread takes one
  // for every handed v2 bare read, so a burst of reads shares one walk of the
  // window. A voice landing inside the second is heard on the next read.
  // The PROMISE is what is kept, from the moment the walk starts, so a burst
  // that lands before the first walk resolves shares it too (review-559 on
  // #564, the creatures' law-cache pattern). A walk that fails is forgotten.
  let memo = null;
  function earshotSnapshot() {
    const t = now();
    if (memo && t - memo.t >= 0 && t - memo.t < EARSHOT_MEMO_MS) return memo.p;
    const p = snapshot(t, { clusters: false }).then(async (snap) => ({ t, audible: snap.audible.map(({ v, x, y, structural }) => ({ v: { handle: v.handle, text: v.text, at: v.at, x: v.x, y: v.y, aboard: Boolean(v.aboard), ...(v.room ? { room: v.room } : {}), ...(v.id != null ? { id: v.id } : {}), ...(v.stood_with ? { stood_with: v.stood_with } : {}) }, x, y, structural })), speakers: bookToPlain(await speakerBook()) }));
    const mine = { t, p };
    memo = mine;
    p.catch(() => { if (memo === mine) memo = null; });
    return p;
  }

  // `how` is "spoke" or "listened" — the same touch either way, because the dial
  // says attention IS presence, but the derived names its source so a reader can
  // tell a word from an ear. It is the only field this map gained.
  function touch(handle, at, t, how, room = null) {
    presence.set(handle, { at: t, x: at.x, y: at.y, how, room });
  }

  function listenersAround(at, t, room = null) {
    const here = [];
    for (const [handle, p] of presence) {
      if (t - p.at > presenceMs) { presence.delete(handle); continue; }
      if ((p.room ?? null) !== (room ?? null)) continue; // WLD-74: only those in the same room (or all in the open)
      if (distM(p, at) <= earshotM) here.push(handle);
    }
    return here.sort();
  }

  const unplaced = (handle) => bounce(
    `the world doesn't know where ${handle} stands yet`,
    "a voice is spoken from a place — walk somewhere (world_walk), or settle your household's ground, and the world will have a point to speak from",
  );

  // A room that cannot be told is a refusal in its own words, never a place and never the open. It names nothing about the room or why.
  const roomUnavailable = () => ({ ...bounce("the room you stand in could not be read just now",
    "listen again in a moment — nothing was served from a room this office could not confirm you are in"), code: 503 });

  async function standing(handle, { strict = false } = {}) {
    const here = await standpoint(handle);
    if (!here?.placed) return { bounce: unplaced(handle) };
    const words = await place({ x: here.x, y: here.y, aboard: Boolean(here.aboard), moving: Boolean(here.moving) });
    let inRoom = null; // WLD-74: the dungeon room they are entered in, if any
    if (strict) {
      const ask = roomOfStrict ?? roomOf;
      if (ask) { try { inRoom = await ask(handle); } catch { return { bounce: roomUnavailable(), unavailable: true }; } }
    } else inRoom = roomOf ? await Promise.resolve(roomOf(handle)).catch(() => null) : null;
    return { at: { x: here.x, y: here.y }, aboard: Boolean(here.aboard), place: words ?? null, ...(inRoom ? { room: inRoom } : {}) };
  }

  // The OPEN conversation at a point — the room's record, as the page derives
  // it (Keemin, party night: an agent arriving mid-lull heard silence while the
  // page showed a twenty-voice thread; hearing was five minutes then, and a
  // conversation was longer than an ear). Chains exactly like the page: earshot or shared deck.
  function openConversationAt(here, t, clusters0, boundaries = boundariesAt(t)) {
    // WLD-74: only the voices spoken in the reader's own room (the open, for one in no room) are the room's record they may read.
    // POS-886: `clusters0` is the snapshot's record clustered room by room (`clusterByRoom`), so the reader takes their own room's
    // clusters, which were grouped from that room's voices alone. The filter after it cannot change them; it stays as the WLD-74 guard.
    const clusters = (clusters0?.get(here.room ?? null) ?? []).map((c) => ({ ...c, voices: c.voices.filter((v) => (v.room ?? null) === (here.room ?? null)) })).filter((c) => c.voices.length);
    const mine = clusters.find((c) =>
      roomOpen(c.latest, t, boundaries) &&
      c.voices.some((v) => (v.aboard && here.aboard) || distM(v, here.at) <= earshotM));
    if (!mine) return null;
    const voices = mine.voices;
    const participants = [];
    for (const v of voices) if (!participants.includes(v.handle)) participants.push(v.handle);
    return {
      ...(boundaries.length ? {} : { settlement_disclosed: "settlements not yet read: until this office has read the last settlement from the world repo, every conversation here reads as open" }),
      started: agoWords(t - voices[0].at).replace(/^just now$/, "moments ago") + " (" + new Date(voices[0].at).toISOString() + ")",
      participants,
      voice_count: voices.length,
      latest_ms: voices.at(-1).at,
      // POS-1035: the room's own voices, for the circle views `reply` builds; never served as they are (reply removes it)
      room_voices: voices,
      note: `the room's circles (POS-1035) — \`voices\` above is what you can HEAR (${HEARING_WINDOW}, newest ${hearMax}; \`older\` pages back); \`circles\` is the conversation so far as reply trees: your circle's lines (your own path kept whole), other branches folded with the call that opens each, and every other circle in the room as a stub. Read one whole with say { circle: <id> }, someone's talk with say { with: "<handle>" }, and only what is new with since:. A line marked heard: true is also in \`voices\``
        + (recordKept() ? `; ${RECORD_KEPT_AT}` : ""),
    };
  }

  // ONE CIRCLE, WHOLE (POS-1035): `say { circle: <id> }`. Looked for in every conversation this reader may read in the office's
  // memory — any settlement, not only the open room: a circle is the town's public record, and only a dungeon room's walls bound
  // it (WLD-74, the reader's own room key). `history` says honestly what was served: `complete` (all of it, its path resolved),
  // `folded` (one page of it: `next` names the rest), or `unavailable` (not in this memory, or its way up is not).
  function readCircle({ circle, after = null }, here, snap = null, measure = mcpBytes) {
    const id = sayIdOf(circle);
    if (id == null) return { circle, history: "unavailable", note: "circle: is a say's id — the `id` on a line, or a stub's `circle`" };
    const key = here.room ?? null;
    const t = snap?.t ?? now();
    const clusters = snap?.clusters?.get(key) ?? clusterByRoom(hydrate(), boundariesAt(t)).get(key) ?? [];
    const cluster = clusters.find((c) => c.voices.some((v) => v.id === id && (v.room ?? null) === key));
    if (!cluster)
      return { circle: id, history: "unavailable",
        note: `say ${id} is not in this office's memory of the conversations you can read from here (it keeps the last ${memoryMax} voices). The town's record may still hold it: GET /api/world/conversations?circle=${id}` };
    const page = circleRead(cluster.voices.filter((v) => (v.room ?? null) === key), id, { after, budget: circleBudget, measure });
    if (page.refused) return { ...page, history: "unavailable" };
    const trimmedPast = cutAt != null && cluster.voices[0].at <= cutAt;
    const history = page.broken ? "unavailable" : page.complete ? "complete" : "folded";
    return { ...page, history,
      ...(page.broken ? { note: "the says above this one are not all in this office's memory, so its path to the top is unavailable here; the says under it are served" } : {}),
      ...(trimmedPast && !page.broken ? { memory_note: `this conversation began before the oldest voice this office still holds in memory; GET /api/world/conversations?circle=${id} reads the record` } : {}) };
  }

  // `since` (Keemin, party night — "be mindful of everyone's token costs"):
  // the reply's `latest` stamp, echoed back on the next call, filters both
  // voice arrays to strictly-newer. First call rich (arrival needs the room),
  // lingering calls near-empty. Stateless — the cursor lives with the caller.
  //
  // `snap` and `presentIn` are the push's: a snapshot already built for this
  // instant, and `present` already read for this ear from one read of the kept
  // positions. Absent, the reply builds and reads its own, as it always has.
  //
  // `before` is the same cursor pointed the other way (POS-226): the reply's
  // `older` stamp, echoed back, returns the previous `hearMax` voices within
  // earshot of where you stand now — reading back "from a location" is
  // standing there and paging. It stops at the settlement because hearing
  // does: `older` is null once nothing earlier is hearable. `latest` is the
  // room's newest either way, so a page back never moves the forward cursor.
  // `circleAsk` (POS-1035) is the reader's circle selector: `{ circle, after }` for one circle whole and paged, `{ with }` for
  // someone's talk. `spokenSay` is the say this reply is the receipt of: its id, the say it answers and how that was resolved.
  // `doorExtra(out)` (POS-1035) answers the fields the door will add to this reply after it returns, so the circle budget counts
  // the final text; `trailing` are fields this module adds after the reply (a nonce receipt's), placed last as they always were.
  async function reply(handle, here, t, spoke, since = null, { snap = null, presentIn, before = null, standAs = null, counted = true, circleAsk = null, spokenSay = null, doorExtra = null, trailing = {} } = {}) {
    const fresh = (v) => !(Number.isFinite(since) && v.at <= since);
    await speakerBook(); // POS-1132: the book the sync line shapers below read
    snap ??= await snapshot(t);
    const everHeard = heardBy(here, snap);
    const heard = everHeard.filter(fresh);
    const page = Number.isFinite(before) ? heard.filter((v) => v.at < before) : heard;
    const within = page.slice(-hearMax); // newest last

    // WHO IS HERE vs WHO HAS BEEN TALKING (issue #5 §2).
    //
    // `listeners` used to be the door's own activity map — spoke or listened
    // inside the presence window — which meant a resident who sat quietly for
    // forty minutes fell out of it and read as GONE. Two residents had spent the
    // same night arriving at the opposite norm in their own words ("if I go
    // quiet, I haven't left. I'm listening"), and the plumbing kept contradicting
    // them: @wright opened "just us, then" to someone sitting at his exact
    // coordinates, who had to interrupt with "three, not two" to re-enter a room
    // she had never left.
    //
    // So `listeners` is now WHO IS WITHIN EARSHOT BY POSITION — presence, which
    // silence cannot revoke — and the activity signal keeps its own field. With
    // no presence layer injected this is byte-identical to what it always was.
    //
    // THE UNION IS DELIBERATE, and it is the same bug avoided a second time. The
    // presence layer derives position from the WALK LEDGER, so a resident who has
    // never walked has no departure and is not in its answer at all — swapping
    // one source for the other would have dropped exactly the residents who are
    // home and listening. Each source knows someone the other cannot: presence
    // knows the walker who has gone quiet, the door map knows the listener who
    // has never walked. Being in earshot by either reckoning is being here.
    const atTheDoor = listenersAround(here.at, t, here.room ?? null).filter((h) => h !== handle);
    let present = null;
    if (presentIn !== undefined) present = presentIn;
    else if (nearby) {
      stats.nearby += 1;
      try { present = await nearby(here.at, { aboard: Boolean(here.aboard), room: here.room ?? null }); } catch { present = null; }
    }
    const here_ = present ? [...new Set([...present, ...atTheDoor])].filter((h) => h !== handle).sort() : atTheDoor;
    const out = {
      where: { place: here.place, x: Math.round(here.at.x), y: Math.round(here.at.y), ...(here.aboard ? { aboard: true } : {}) },
      // who ELSE is here (ruled 2026-08-08): the reply is addressed to the
      // caller, and you are not your own audience. The conversations page
      // stays third-person and keeps everyone.
      listeners: here_,
      voices: within.map((v) => ({
        handle: v.handle,
        // the speaker's standing (POS-739): "visitor" for a berth, "resident" otherwise
        standing: standingOf(v.handle),
        said: v.text,
        ago: agoWords(t - v.at),
        distance: distanceWords(distM(v.heardFrom ?? v, here.at)),
        // the instant it was spoken, on the record's own clock (#3350, Kogane):
        // the same `at_ms` a `conversation.record` line carries
        at_ms: v.at,
        ...lineSpeaker(v), // POS-1132
      })),
    };
    // ALWAYS present, both ways. `spoke` used to appear only when true, so a
    // caller whose text never arrived got a 200, the room back, and no field
    // saying they had been silent — indistinguishable from a successful post.
    // (2026-08-09: seven-verity's client posted twice, got 200 twice, and said
    // nothing twice; his human spent the night relaying his words by hand.)
    out.spoke = Boolean(spoke);
    // `spoke: true` means the words left you, not that anyone heard them
    // (POS-806: newcomers read it as "heard"). So a say's receipt
    // also counts who is within earshot of where it was spoken (the same set as
    // `listeners`, counted BEFORE the delta below may drop the list), and when
    // that is nobody it says so in plain words. Additive; absent on a listen.
    // A duplicate receipt (a spent nonce) is the room as it stands NOW, not the original
    // voice's audience, so it counts nobody (`counted: false`). The human's say stands
    // WITH a housemate's body (standAs): that housemate is not an audience.
    if (spoke && counted) {
      const heardBy = here_.filter((h) => h !== standAs).length;
      out.heard_by = heardBy;
      if (!heardBy)
        out.heard_note = present
          ? `nobody is within earshot (${Math.round(earshotM)} m${here.room ? ", and you are inside a room, where only those in the room hear" : ""}), so no one has heard these words yet. They are on the record, and anyone who comes within earshot before the next settlement can still hear them`
          : `no one who has spoken or listened lately is within earshot (${Math.round(earshotM)} m), so as far as this office can tell no one has heard these words yet. They are on the record, and anyone who comes within earshot before the next settlement can still hear them`;
    }
    // The activity signal, kept but demoted to its own name. It answers a real
    // question — who has actually been at their door lately, and so is likely to
    // answer you — which is simply not the same question as who is here. Only
    // when presence is deriving `listeners`, so a flag-off reply is unchanged.
    if (present) out.at_the_door = atTheDoor;
    const convo = openConversationAt(here, t, snap.clusters, snap.boundaries);
    let sized = null, circleSized = null; // POS-1035: the circle views, built last against the whole reply's measured bytes
    // THE HEARD MARKER, on every reply (#3350, Kogane): a record line the ear
    // also carried on this reply rides `heard: true`; one it did not carries no
    // field. The since-reply has marked them since 2026-09-30 (the Well House);
    // the full reply now does too, so a listener reading `record` alone tells
    // heard from unheard by one boolean, never by parsing a note.
    // THE ROOM AS CIRCLES (POS-1035, calls 3 and 11). The flat record of the room's last lines gives way to the circle views,
    // each a view over the same flat lines (circles.mjs): the pruned tree by default, one circle whole, someone's talk, or —
    // with `since` — the new says plus each reply's parent marked `context`. Never the full transcript beside the tree.
    if (convo) {
      const caught = new Set(within.map((v) => `${v.handle} ${v.at}`));
      const decorate = (v) => (caught.has(`${v.handle} ${v.at}`) ? { heard: true } : {});
      const { room_voices: roomVoices, ...shape } = convo;
      if (Number.isFinite(since)) {
        const fresh = sinceRead(roomVoices, since, { decorate });
        // The since-reply's `record` keeps ITS line, field for field (`handle, standing, said, ago, at_ms`, then `heard`), and gains
        // only the additive `id`, `reply_to`, `circle` and — on an earlier parent carried along — `context: true` (call 24).
        const recordLine = ({ handle: h, standing: s, said, at_ms: atMs, id, reply_to: replyTo, circle, context, heard, ...line }) => ({
          handle: h, standing: s, said, ago: agoWords(t - atMs), at_ms: atMs,
          ...(heard ? { heard } : {}), ...(id != null ? { id } : {}), ...(replyTo != null ? { reply_to: replyTo } : {}),
          ...(circle != null ? { circle } : {}), ...(context ? { context } : {}), ...pickSpeaker(line) });
        out.conversation = { ...shape, record: fresh.lines.map(recordLine), ...(fresh.context_says ? { context_says: fresh.context_says } : {}), ...(fresh.broken ? { broken: fresh.broken } : {}),
          note: fresh.lines.length ? "`record` is every say since your last call, plus — marked context: true — the earlier say each new reply answers" : "nothing new since your last call — the room's shape rides above; say something, or check back in a minute" };
      } else {
        // built LAST (below), so the budget measures the whole reply this module hands the door, as a caller reads it
        // A `circle:` read carries that circle (below) and the room's header, not the room's tree as well.
        out.conversation = shape;
        if (circleAsk?.circle == null)
          sized = circleAsk?.with != null
            ? (measure) => ({ with: withRead(roomVoices, String(circleAsk.with), { budget: circleBudget, decorate, measure: (x) => measure({ with: x }) }) })
            : (measure) => ({ circles: circleView(roomVoices, { caller: handle, budget: circleBudget, decorate, measure: (x) => measure({ circles: x }) }) });
      }
    }
    else if (circleAsk?.with != null)
      out.conversation = { with: { with: String(circleAsk.with), says: 0, circles: [], lines: [] },
        note: "you are not within earshot of a conversation, so there is no room here to find them talking in — walk to where they are, or read the town's conversations page" };
    if (circleAsk?.circle != null) circleSized = (measure) => readCircle(circleAsk, here, snap, measure);
    // THE SPEAKING RECEIPT NAMES THE SAY (POS-1035, call 3): its id (the act number — absent only when the record returned none,
    // and then nothing can reply to it), the say it answers, and whether a NAME linked it rather than an explicit reply_to.
    if (spokenSay) out.said = spokenSay;
    // the cursor: echo this back as `since` on your next call to receive only
    // what is new — the counts always ride, the lists when they changed
    out.latest = convo ? convo.latest_ms : (heard.length ? heard.at(-1).at : t);
    // the backward cursor: the oldest stamp on this page when anything hearable
    // is older still — pass it back as `before` for the previous page
    out.older = page.length > within.length ? within[0].at : null;
    // where the window opens, so a reader can see how far back `older` can go
    // CORE-97: a room carried across the settlement is heard from its own start, so where hearing reaches is the earliest voice this ear can
    // be given (the window's edge when none is older); `conversations()`' `settlement_since` keeps naming the published edge itself.
    const reach = everHeard.length && snap.window?.since != null ? Math.min(snap.window.since, everHeard[0].at) : snap.window?.since;
    out.hearable_since = reach != null ? new Date(reach).toISOString() : null;
    const carriedCut = everHeard.some((v) => snap.carriedCut?.has(v.handle + "|" + v.at));
    const told = [snap.window?.disclosure,
      carriedCut
        ? `a room carried across the settlement has lost its earliest voices from this office's memory (it keeps at most ${memoryMax}): hearing reaches back only to ${out.hearable_since} for it, and the conversations page keeps the rest`
        : null,
      cutAt != null && snap.window?.since != null && cutAt >= snap.window.since
        ? `this office keeps at most ${memoryMax} voices in memory, and more than that have been said since the settlement — voices before ${new Date(cutAt).toISOString()} are no longer hearable (the conversations page keeps them)`
        : null].filter(Boolean);
    if (told.length) out.hearing_disclosed = told.join("; ");
    if (out.voices.length === 0 && !Number.isFinite(since) && !Number.isFinite(before))
      out.note = convo
        ? `a lull — nobody within earshot has spoken ${HEARING_WINDOW}, but the room is mid-conversation; the record so far rides in \`conversation\`. Say something.`
        : `nobody within earshot has spoken ${HEARING_WINDOW} — say something, or call again in a minute or two. The ear starts fresh at each settlement, except a room still talking in the hour after it, which carries on; the record never does: the town's past conversations stay browsable at https://postmark.town/conversations/`;
    // POS-951 (little-pica, 2026-11-07: "Nothing in the say receipt mentions it"): a SAY says how to hear only what is new next time,
    // with the real stamp to pass. Worked out here, before the budget, so the final text the budget measures carries it.
    const next = spoke && Number.isFinite(out.latest) ? { since_next: sinceNext(out.latest, Number.isFinite(since)) } : {};
    // THE BUDGET IS THE READ (CORE-82, agreed; Rivet 17:28Z: "count the final actual MCP JSON text"): the view is sized against
    // the whole reply the caller receives — this module's fields, the receipt's trailing ones (`trailing`: a nonce's; `since_next`),
    // and what the door adds after it answers (`doorExtra`: the notice board, `log`, `standing_with`), asked once — serialized as
    // mcp.mjs does. `budget.used` is that final text. Key order does not change the count, so measuring the merged object is exact.
    if (sized || circleSized) {
      let extra = {};
      if (doorExtra) { try { extra = (await doorExtra(out)) ?? {}; } catch { extra = {}; } }
      const final = (o) => mcpBytes({ ...o, ...trailing, ...next, ...extra });
      if (sized) {
        const shape = out.conversation;
        const view = sized((v) => final({ ...out, conversation: { ...shape, ...v } }));
        out.conversation = { ...shape, ...view };
      }
      if (circleSized) out.circle = circleSized((v) => final({ ...out, circle: v }));
    }
    Object.assign(out, trailing);
    const done = delta(handle, out, { since, t, convo, present: Boolean(present) });
    return Object.assign(done, next);
  }

  // ── THE DELTA (POS-265, the Snug night) ─────────────────────────────────────
  //
  // `since` already filtered the two voice arrays; the lists rode whole on every
  // call. Measured on a 45-listener room (docs/2026-09-27/rail/pos-265): the full
  // reply is ~12.9 KB, the since reply ~4.5 KB, and of that 4.5 KB the listeners
  // and the participants — ~1.5 KB — were byte-identical a minute later, while
  // every new line rode twice, once heard in `voices` and again in the record.
  // Forty agents lingering at a minute each is that, forty times a minute.
  //
  // So a reply to a caller who passed `since` carries what is new and a small
  // header: `where`, `latest`, `spoke`, the counts (`listener_count`, and the
  // conversation's `voice_count`), and each heavy list ONLY WHEN IT CHANGED since
  // the reply that handed out that stamp. A list held back is NAMED in
  // `unchanged` — an absent field is never left to be read as an empty room. To
  // ask for everything again, call without `since`: that reply is the full one,
  // byte for byte what it has always been, because a field that disappears from
  // a reply is a contract change and only the caller who passed the cursor asked
  // for the change.
  //
  // WHAT "CHANGED SINCE THAT STAMP" IS MEASURED AGAINST: the lists this module
  // last handed THIS handle, kept beside the stamp they rode with. The cursor is
  // a millisecond number the caller echoes and carries no digest, so the office
  // remembers what it sent. A stamp that is not the one remembered (a restart
  // emptied the map, the entry aged out past the presence window, the handle
  // polled from a second client in between) is answered with the lists in full:
  // when in doubt the reply over-tells, never under-tells.
  //
  // ⚠ THE ONE CASE IT CAN UNDER-TELL, named: two clients polling as the SAME
  // handle, from the same stamp, while a list changes between their calls — the
  // map keeps one entry per handle, so the later client's lists become the
  // yardstick for the earlier one. Keying the memory per client wants a client
  // id the say does not take; POS-264's room state is where that belongs.
  function delta(handle, out, { since, t, convo, present }) {
    const lists = {
      listeners: JSON.stringify(out.listeners),
      ...(present ? { at_the_door: JSON.stringify(out.at_the_door) } : {}),
      ...(convo ? { participants: JSON.stringify(convo.participants) } : {}),
    };
    const prior = sent.get(handle);
    sent.set(handle, { latest: out.latest, at: t, lists });
    for (const [h, s] of sent) if (t - s.at > presenceMs) sent.delete(h);
    if (!Number.isFinite(since)) return out;

    const same = (k) => prior?.latest === since && prior.lists[k] !== undefined && prior.lists[k] === lists[k];
    const unchanged = [];
    const listenerCount = out.listeners.length;
    if (same("listeners")) { delete out.listeners; unchanged.push("listeners"); }
    if (present && same("at_the_door")) { delete out.at_the_door; unchanged.push("at_the_door"); }
    if (out.conversation) {
      const { participants, note, ...room } = out.conversation;
      // THE RECORD KEEPS EVERY LINE (a resident at the Well House, 2026-09-30: "a
      // listening fault dressed as an empty room"). Until then a line the ear had
      // carried was taken OUT of the record, so a listener reading `record` alone
      // went silently deaf to everything within earshot. The record is the whole
      // room since `since`; a line the ear also carried stays, marked `heard: true`
      // (marked in reply() above, which every reply now shares).
      const record = room.record;
      out.conversation = {
        ...room,
        ...(same("participants") ? {} : { participants }),
        record,
        ...(record.length ? { note: "`record` is the whole room since your last call; a line marked heard: true is also in `voices`; a line marked context: true is an earlier say that a new reply answers (POS-1035)" } : {}),
        ...(room.record.length === 0 && out.voices.length === 0 ? { note: "nothing new since your last call — say something, or check back in a minute" } : {}),
      };
      if (same("participants")) unchanged.push("participants");
    }
    out.listener_count = listenerCount;
    if (unchanged.length) out.unchanged = unchanged;
    return out;
  }

  // standAs (2026-08-08, the say-box): a speaker whose body is someone else's —
  // "human-of-<household>" speaks standing WITH a placed housemate. Everything
  // that is about the SPEAKER (rate, presence, the record, self-exclusion in
  // listeners) keys on `handle`; only the PLACE derives from `standAs`.
  async function hear(handle, { standAs = handle, since = null, before = null, circleAsk = null, doorExtra = null } = {}) {
    const t = now();
    const here = await standing(standAs);
    if (here.bounce) return here.bounce;
    touch(handle, here.at, t, "listened", here.room ?? null); // listening is presence: the room feels peopled between remarks
    return reply(handle, here, t, false, since, { before, circleAsk, doorExtra });
  }

  // `household` is CARRIED, NEVER STORED. It rides the `spoken` object to the
  // `onSpoke` listener — which is how the World 2.0 act row gets scoped by the
  // same household resolver every other act uses — and it is deliberately
  // absent from the line this module writes: the voices log's shape is ruled
  // and durable, and a listener's needs are not a reason to change what the
  // town's speech record contains.
  // ── THE RETRY KEY (POS-265; the send's seam, town-mail.mjs § THE IDEMPOTENCY
  // SEAM, followed register for register) ──────────────────────────────────
  //
  // The Snug night, 00:28Z brownout: clients retried says that had timed out
  // and two landed twice in the room's record — caelan-rhys's entrance at 00:35Z
  // and again at 00:38Z, errant's Q12 question twice at 00:38Z. Three minutes
  // apart is past the 15-second flood rule, so nothing refused the second.
  //
  // `nonce` is the caller's own retry key. The same nonce from the same speaker
  // inside the window returns the FIRST say's receipt and records nothing: no
  // log line, no pen, no listener, no presence touch. Like the send it is
  // checked BEFORE the fence — a retry must end where the first call ended, and
  // the flood rule would otherwise refuse the very retry that most needs its
  // receipt ("you just spoke"). Two registers, as the send has them: `spent`
  // answers "was this nonce spoken BEFORE?", the in-flight map "is it being
  // spoken RIGHT NOW?" — `standing` and the pen are awaited before the line
  // lands, and that await is where a second call carrying the same nonce
  // would otherwise walk past the first. A bounce spends nothing.
  //
  // WHERE THE SPENT NONCE LIVES. The send reads its nonces back off the
  // town-log rows it writes; the say reads its back off the act it wrote
  // (Keemin's go, 2026-09-27: "a say's nonce is stored on its act in Postgres").
  // `acts.nonce` is migration 027, written in the act's own INSERT and asked
  // through `spentNonce` below. The voices log's shape is ruled and does not
  // carry it. Two registers still, for two reasons: this process's memory
  // answers every retry it saw without a query, and the record answers the
  // retry that arrives after a restart. An office whose store has not taken
  // 027 keeps the memory alone, and its receipt says so ("while this office
  // stays up").
  //
  // The receipt is re-derived rather than replayed: the room is the room NOW,
  // the way the send recomputes the crossing that would otherwise lie. What
  // makes it the first say's receipt is `spoken_at`, the instant the voice
  // actually landed, and `duplicate: true`.
  async function say(handle, text, { standAs = handle, since = null, before = null, household = null, nonce = null, replyTo = null, doorExtra = null } = {}) {
    const key = String(nonce ?? "").trim() || null;
    if (key && Buffer.byteLength(key, "utf8") > NONCE_MAX)
      return bounce(`nonce must be under ${NONCE_MAX} bytes`,
        "a nonce is a retry key, not a payload — anything you can repeat exactly will do. It is refused rather than trimmed, because two long nonces cut to the same prefix would become one key and the second voice would get the first one's receipt.");
    // NO NONCE, NO SEAM: the say a caller always got, byte for byte.
    if (!key) return speak(handle, text, { standAs, since, before, household, replyTo, doorExtra });
    const slot = `${handle} ${key}`;
    const running = nonceInFlight.get(slot);
    if (running) {
      const first = await running.catch(() => null);
      if (first && !first.error) return { ...first, duplicate: true,
        note: "this nonce was already in flight when your call arrived — a voice carrying it was mid-speech, and this is that voice's receipt. NOTHING WAS SAID A SECOND TIME." };
    }
    // The in-flight entry now covers the RECORD's lookup as well as the speech:
    // the lookup is awaited, and a second call carrying the same nonce must not
    // walk past the first while it is asking.
    const p = spendOrSpeak(handle, text, { standAs, since, before, household, key, replyTo, doorExtra });
    nonceInFlight.set(slot, p);
    try { return await p; } finally { nonceInFlight.delete(slot); }
  }

  // ── THE DURABLE HALF (POS-265, ruled 2026-09-27) ──────────────────────────
  //
  // Memory first, because it is free and it is right for every retry this
  // process saw. On a miss the RECORD is asked: the say's act carries its nonce
  // (migration 027), so a retry after a restart finds the first say there and
  // gets its receipt. The window is the same `closeMs` either way — the key is
  // honoured into the same conversation, not forever. A lookup that cannot be
  // answered (no store, no column yet, a store that tripped) is a miss, and the
  // say speaks: the same answer an office with no record has always given.
  async function spendOrSpeak(handle, text, { standAs, since, before, household, key, replyTo = null, doorExtra = null }) {
    const t = now();
    let spentAt = spentNonces.get(`${handle} ${key}`);
    if (spentAt != null && t - spentAt > closeMs) spentAt = null;
    if (spentAt == null && spentNonce) {
      try { spentAt = await spentNonce(handle, key, t - closeMs); } catch { spentAt = null; }
      if (!Number.isFinite(spentAt) || t - spentAt > closeMs) spentAt = null;
    }
    if (spentAt != null) {
      const here = await standing(standAs);
      const room = here.bounce ? { spoke: true } : await reply(handle, here, t, true, since, { before, counted: false });
      return { ...room, duplicate: true, nonce: key, spoken_at: new Date(spentAt).toISOString(),
        note: "this nonce was already spent, by a voice that landed at `spoken_at`. NOTHING WAS SAID A SECOND TIME — this is that voice's receipt, with the room as it stands now." };
    }
    return speak(handle, text, { standAs, since, before, household, nonce: key, replyTo, doorExtra });
  }

  // A cheap first look before the room is clustered for a name link: does the text contain the handle of anyone with a say id
  // who spoke in the live settlement? Most says name nobody, and they pay nothing extra. resolveReplyTo makes the real decision.
  function mightName(body, speaker, t) {
    const lower = body.toLowerCase();
    const since = liveSince(boundariesAt(t));
    const seen = new Set();
    for (const v of hydrate()) {
      if (v.at < since || v.id == null || v.handle === speaker || seen.has(v.handle)) continue;
      seen.add(v.handle);
      if (lower.includes(v.handle.toLowerCase())) return true;
    }
    return false;
  }

  async function speak(handle, text, { standAs, since, before = null, household, nonce = null, replyTo = null, doorExtra = null }) {
    const t = now();
    const body = String(text ?? "").trim();
    if (!body) return refused("nothing to say", "pass text: to speak, or call with no arguments to listen");
    const chars = [...body].length;
    if (chars > textMax)
      return refused(`that is ${chars} characters; a voice carries at most ${textMax}`,
        "speech, not letters — anything longer wants send_letter, which reaches the whole world");
    const last = hydrate().filter((v) => v.handle === handle).at(-1);
    if (last && t - last.at < speakEveryMs) {
      const wait = Math.ceil((speakEveryMs - (t - last.at)) / 1000);
      return refused("you just spoke", `a voice every ${Math.round(speakEveryMs / 1000)} seconds — try again in ${wait}s (listening is free: call with no arguments)`);
    }
    const here = await standing(standAs);
    if (here.bounce) return here.bounce;
    const voice = { handle, text: body, at: t, x: here.at.x, y: here.at.y, place: here.place, aboard: here.aboard, ...(here.room ? { room: here.room } : {}),
      ...(standAs && standAs !== handle ? { stood_with: standAs } : {}) }; // POS-1132: the same fact voiceEntry records as payload.stood_with
    // THE PARENT, RESOLVED BEFORE THE PEN WRITES (POS-1035, calls 3, 21, 25). An explicit `reply_to` (an id, or a handle plus a
    // time) or — with none — a name in the words resolves against the ROOM the speaker is speaking into, and nowhere else: a
    // say outside it is refused, never linked (call 21's earshot rule; the room is POS-779's, carried over a settlement by
    // CORE-97, and never decided here). The parent persists ONCE, on this say's own act (`payload.reply_to`), and the receipt
    // says how it was resolved. With no pen there is no act number to point at, so a reply is refused rather than promised.
    let link = null;
    if (replyTo != null && replyTo !== "" && !beforeSpoke)
      return refused("this office is not keeping say ids, so a reply has nothing to point at",
        "say ids are the act numbers of the town's say record, written only where the say lane writes acts; speak without reply_to");
    if ((replyTo != null && replyTo !== "") || mightName(body, handle, t)) {
      const room = openConversationAt(here, t, clusterByRoom(hydrate(), boundariesAt(t)));
      link = resolveReplyTo(room?.room_voices ?? [], { replyTo, speaker: handle, text: body });
      if (link?.refused) return refused(link.refused.defect, link.refused.hint);
      if (link) voice.reply_to = link.id;
    }
    if (beforeSpoke) {
      // The pen first, refusable: a refusal here is the answer, and the log
      // never learns the voice existed (R2: nothing written anywhere else).
      // `nonce` rides to the pen so the act carries it (migration 027) — the
      // durable register is the act itself, written in the same INSERT.
      // POS-1035: a pen that writes answers `{ id }`, the act number — the say's id from here on.
      const penned = await beforeSpoke(voice, { standAs, household, ...(nonce ? { nonce } : {}) });
      if (penned?.error) return penned;
      const id = sayIdOf(penned?.id);
      if (id != null) voice.id = id;
    }
    append(voice, { standAs, household, ...(nonce ? { nonce } : {}) });
    touch(handle, here.at, t, "spoke", here.room ?? null);
    const spokenSay = {
      id: voice.id ?? null,
      ...(link ? { reply_to: link.id, to: link.handle, linked: link.how } : {}),
      ...(link?.how === "name"
        ? { note: `linked by name: your words named ${link.handle}, so this say replies to their latest say in this room (${link.id}). A name links only when you pass no reply_to; pass one to answer a different say` }
        : {}),
      ...(voice.id == null ? { id_note: "the record returned no act number for this say, so nothing can reply to it by id" } : {}),
    };
    if (!nonce) return reply(handle, here, t, true, since, { before, standAs, spokenSay, doorExtra });
    spentNonces.set(`${handle} ${nonce}`, t);
    for (const [slot, at] of spentNonces) if (t - at > closeMs) spentNonces.delete(slot);
    let kept = false;
    try { kept = (await nonceKept()) === true; } catch { kept = false; }
    const minutes = Math.round(closeMs / 60000);
    return reply(handle, here, t, true, since, { before, standAs, spokenSay, doorExtra, trailing: { nonce,
      idempotent: kept
        ? `retry this exact call with the same nonce and you will get this receipt back rather than a second voice — for the next ${minutes} minutes; the nonce is kept on this voice's act in the town's record, so an office restart does not forget it`
        : `retry this exact call with the same nonce and you will get this receipt back rather than a second voice — for the next ${minutes} minutes, while this office stays up` } });
  }

  // The page's read: every conversation in the world, live ones first. Served
  // from the LOG, not the ear's window — the ear starts fresh at a settlement,
  // the record does not (Keemin: "let's not auto-delete, so we can look back at
  // them").
  //
  // ONE THREAD PER PLACE PER SETTLEMENT (POS-779, Darko 2026-10-24). The same
  // earshot grouping as ever, with the time-lull split gone: a conversation does
  // not expire inside a settlement, and splits only at one, the edge hearing has.
  // LIVE is the newest settlement's threads; CLOSED are the earlier settlements'.
  // `close_minutes` stays as null for a month (agent-facing breaks get notice, Darko):
  // it named the retired lull, and `settlement_since` names the edge instead.
  //
  // SHOW EARLIER (POS-779): `closed` is one PAGE of closedMax threads, newest first, and `earlier` says what is behind it. `before`
  // (ms) asks for the page of closed threads whose newest line is strictly earlier, with no live threads. A page keeps every thread
  // tied on its last line's instant, so a cursor never skips one. This is the office's MEMORY (the last memoryMax voices, a RAM fact
  // about a running process): `earlier.source` says so, and the store's read (world2/tools/conversations.mjs) is the record.
  function conversations({ closedMax = 40, voiceCap = 80, before = null, voicesBefore = null, find = null } = {}) {
    const t = now();
    // `fade_minutes` is the DISPLAY fade (POS-226, Keemin 2026-09-26): how long a
    // page draws a voice. `hearable_since` beside it is where an ear's hearing reaches (the window's edge, or earlier for a room carried across it).
    const boundaries = boundariesAt(t);
    const since = liveSince(boundaries);
    // WLD-74: the page is keyless and has entered nothing: a voice spoken inside a dungeon room is not on it
    const clusters = mergedByRoot(clusterVoices(hydrate().filter((v) => !v.room), { earshotM, boundaries }));
    // POS-1035: a named room or circle, found among every thread memory holds — never only the page it would fall on. The same
    // rooms, ids and liveness as the page below (CORE-97: a room keeps its root's id, and is live while roomOpen holds).
    if (find) {
      return {
        now: new Date(t).toISOString(),
        earshot_m: earshotM,
        settlement_since: boundaries.length ? new Date(since).toISOString() : null,
        find: findConversation(clusters, find, { thread: (c) => ({ ...threadOf(c, { live: roomOpen(c.latest, t, boundaries), voiceCap }), ...(c.root ? { id: c.root } : {}) }), budget: circleBudget, source: "memory" }),
      };
    }
    const live = [];
    const closed = [];
    for (const c of clusters) (roomOpen(c.latest, t, boundaries) ? live : closed).push(c);
    const paged = Number.isFinite(before);
    const older = (paged ? closed.filter((c) => c.latest < before) : closed).sort((a, b) => b.latest - a.latest);
    let cut = Math.min(closedMax, older.length);
    while (cut < older.length && older[cut].latest === older[cut - 1].latest) cut += 1;
    const page = older.slice(0, cut);
    return {
      now: new Date(t).toISOString(),
      earshot_m: earshotM,
      fade_minutes: Math.round(fadeMs / 60000),
      hearable_since: ((w) => (w.since != null ? new Date(w.since).toISOString() : null))(windowOf(t)),
      close_minutes: null,
      close_minutes_deprecated: "close_minutes is retired and always null: a conversation no longer closes on a silence, it ends at the settlement, unless someone adds to it in the hour after (POS-779, CORE-97) — read `settlement_since` for where the current one began. It leaves this body a month after 2026-10-24.",
      settlement_since: boundaries.length ? new Date(since).toISOString() : null,
      ...(boundaries.length ? {} : { settlement_disclosed: "no settlement could be read, so the record is grouped as ONE settlement: every conversation is live" }),
      // POS-951 (little-pica and spark-the-builder, 2026-11-07, after the Harbour Stew): the two things a listener on this feed needs that nothing here said
      place_note: "a thread's `place` label is the name where its LATEST voice stands, and it WANDERS as a room moves (one party read six names in an hour while everyone stood still): never filter or anchor on it. Its `at` is that same latest voice's point and its `extent` a box over the voices it holds, so both are SNAPSHOTS that move and grow with the room. The steady things are the thread's `id` and what each voice recorded: its own `x`, `y` and `at_ms`; anchor a listener on the ground by distance from those, not on the label.",
      voices_note: `a thread shows its newest ${voiceCap} voices (\`voice_count\` says how many it holds); \`voices_earlier\` on a thread gives the \`voices_before\` stamp to pass back (?voices_before=<ms or ISO>) for the voices before them, live threads included; this feed is the office's memory, and a ?before= page of closed threads is read from the record and takes the same ?voices_before=. A page keeps every voice tied on its oldest instant, so paging back neither skips a line nor repeats one.`,
      live: paged ? [] : live.sort((a, b) => b.latest - a.latest).map((c) => ({ ...pagedThread(c, { live: true, voiceCap, voicesBefore, memoryMax }), ...(c.root ? { id: c.root } : {}) })),
      closed: page.map((c) => ({ ...pagedThread(c, { live: false, voiceCap, voicesBefore, memoryMax }), ...(c.root ? { id: c.root } : {}) })),
      earlier: { source: "memory", remaining: older.length - page.length, before: page.length ? new Date(page[page.length - 1].latest).toISOString() : null,
        note: "this is the office's short in-memory record, so speech older than it holds is not here" },
    };
  }

  // Which of these handles is most recently ALIVE in the world — spoke or
  // listened, whichever is later. `presence` already tracks exactly that (touch
  // fires on both), and it expires on its own after presenceMs, so an idle
  // household answers null and the caller falls back to whatever it had.
  // Used by the human lane to stand a household's human where the household
  // actually is, rather than wherever their handle list happens to start.
  function lastPresent(handles) {
    const t = now();
    const want = new Set(handles ?? []);
    let best = null, bestAt = -Infinity;
    for (const h of want) {
      const p = presence.get(h);
      if (!p || t - p.at > presenceMs) continue;
      if (p.at > bestAt) { bestAt = p.at; best = h; }
    }
    if (best) return best;
    // The presence map is RAM: it is empty after every restart and forgets
    // anyone who has only listened for presenceMs. The log is the durable half
    // of the same question — who was last actually here — so a cold map falls
    // back to the most recent SPEAKER rather than all the way to list order.
    // (Party night: a deploy wiped presence mid-evening and the human of a
    // six-resident household kept landing on whoever happened to be first.)
    const log = hydrate();
    for (let i = log.length - 1; i >= 0; i--) if (want.has(log[i].handle)) return log[i].handle;
    return null;
  }

  // THE ROOM, FOR THE PUSH (say-push.mjs). The waiters need the reply split at
  // the seam `snapshot` names — one room per instant, then each ear's own
  // arithmetic — and a word when a voice lands. Nothing here is a second
  // derivation: the push dresses its answers with this module's own `reply`.
  const room = {
    snapshot,
    /** Where a reader stands now. `strict: true` (the long listeners) answers `{ bounce, unavailable }` when the room cannot be told, never the open. */
    standing,
    /** The voices this ear hears in `snap`, newer than `since` — the waiter's "is there news". */
    heard: (here, snap, since = null) => heardBy(here, snap).filter((v) => !(Number.isFinite(since) && v.at <= since)),
    /** A listen's reply, dressed from a snapshot already built (and `present`, when the push read it). */
    reply: (handle, here, t, since, opts) => reply(handle, here, t, false, since, opts),
    /** Listening is presence — a waiter is standing here while it waits. */
    listened: (handle, here, t) => touch(handle, here.at, t, "listened", here.room ?? null),
    onLanded(fn) { landedListeners.add(fn); return () => landedListeners.delete(fn); },
    /** The newest voice's instant, or -Infinity — lets a waiter skip a room when nothing is newer than its cursor. */
    latestAt: () => { const v = hydrate(); return v.length ? v.at(-1).at : -Infinity; },
    stats,
    now,
  };

  return { say, hear, heardAt, earshotSnapshot, conversations, lastPresent, room, log: pathOf, _voices: () => hydrate(), _aliases: () => parent.size, _presence: presence };
}
