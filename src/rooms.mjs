// rooms.mjs — which conversation a say belongs to (POS-1185).
//
// THE RULE (Darko, 2026-11-22 11:44 EST: "a solution where we simply dont merge separate conversations just because there is a
// geometric linker later on … The goal/floor is for everything to be readable and findable (no orphans)"). A say's conversation
// (its room) is decided ONCE, when it is spoken, and never changes afterwards:
//   · a reply joins the room of the say it answers;
//   · a say that answers no one joins ONE open room it can hear: the room of the nearest voice within earshot, ties to the most
//     recent voice. Your own last say counts, so standing still keeps you in your room;
//   · a say that can hear no open room founds a room under its own id (`t<instant>-<handle>`).
// Two rooms are never joined because a later say is within earshot of both. A room is the says that name it, so every id a room
// was ever issued under opens that room, and every say is in exactly one.
//
// THE NAME IS RECORDED. The office decides it before the say's act is written (voices.mjs § speak) and the act keeps it as
// `payload.conversation` (world.mjs § voiceEntry); the voices log keeps the same id as `root`, as it has since CORE-97. In memory
// and in every read a voice carries it as `root`.
//
// A SAY WITH NO RECORDED NAME (every act written before this shipped: nothing updates an act, ever) is NAMED AS IT WAS WHEN IT WAS
// SPOKEN: the room it joined under the rule of its day, by which a say within earshot of two rooms fused them under the older
// one. So an old say sits in the room it joined, the says a fused room had before its bridge read again under that room's own
// id, and the bridge and every say after it stay in the room they joined. Nothing recorded is rewritten.
//
// ONE DERIVATION, two readers: the office's memory (voices.mjs) and the record (world2/tools/conversations.mjs) both call
// `roomsOf`, so they cannot disagree about which room a say is in. A room's continuation across a settlement is hearing-window's
// one policy (CORE-97 § roomOpen), unchanged.

import { roomOpen } from "./hearing-window.mjs";

const ROOM_ID = /^t(\d+)-(.+)$/;
/** Is this a room id (`t<ms>-<handle>`)? */
export const isRoomId = (id) => typeof id === "string" && ROOM_ID.test(id);
/** The id a say founds a room under: its own instant and speaker. */
export const roomIdOf = (v) => `t${v.at}-${v.handle}`;
/** The instant (ms) a room id names, or NaN. */
export const roomAtOf = (id) => Number(ROOM_ID.exec(String(id))?.[1]);
/**
 * A room id's key: its handle and the SECOND it names (POS-1183). The record reads a say's instant to the second while the office's
 * memory and a recorded name carry milliseconds, so `t1795343232206-wren-porter` and `t1795343232000-wren-porter` are one room.
 */
export const roomKeyOf = (id) => { const m = ROOM_ID.exec(String(id)); return m ? `${Math.floor(Number(m[1]) / 1000)}-${m[2]}` : null; };

const distM = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** Can two voices hear each other: within earshot, or both aboard the vessel (the deck is one place even though it moves). */
export const chains = (a, b, earshotM) => Boolean(a.aboard && b.aboard) || distM(a, b) <= earshotM;

const sortedEdges = (boundaries) => (Array.isArray(boundaries) ? boundaries.filter(Number.isFinite).sort((a, b) => a - b) : []);

/**
 * THE ROOMS over a list of voices: `[{ root, voices, latest }]`, each room's voices oldest first, the rooms by their newest say.
 * A voice carrying a recorded name (`root`) is in the room that name names, whatever stands near it. A voice with none is named
 * as it was when it was spoken (the fold below, over the unnamed voices alone). `boundaries` are the published settlements (ms);
 * none known is one settlement, and the caller says so.
 */
export function roomsOf(list, { earshotM, boundaries = [] } = {}) {
  const sorted = [...list].sort((a, b) => a.at - b.at);
  const marks = sortedEdges(boundaries);
  const rooms = [];
  const roomOfVoice = new Map();
  const bySay = new Map(); // say id -> voice, for the reply rule
  const join = (room, v) => { room.voices.push(v); if (v.at > room.latest) room.latest = v.at; roomOfVoice.set(v, room); };

  // ── the unnamed says, named as they were when spoken ──
  // The grouping of their day, kept exactly (earshot or a shared deck; a room over once CORE-97's hour ran out; a say within
  // earshot of two groups fused the groups, the older one leading). What is kept from it is only THE NAME EACH SAY TOOK WHEN IT
  // JOINED: the leading room's. A fused group goes on as one group for later says, and the says a room already held stay its own.
  const open = []; // { room, voices, latest }: a group, and the room that leads it
  for (const v of sorted) {
    if (v.id != null) bySay.set(v.id, v);
    if (isRoomId(v.root)) continue;
    for (let i = open.length - 1; i >= 0; i--) if (!roomOpen(open[i].latest, v.at, marks)) open.splice(i, 1);
    const hits = open.filter((g) => g.voices.some((o) => chains(o, v, earshotM)));
    let group = hits[0];
    if (!group) {
      const room = { root: roomIdOf(v), voices: [], latest: v.at };
      rooms.push(room);
      group = { room, voices: [], latest: v.at };
      open.push(group);
    }
    for (const other of hits.slice(1)) { group.voices.push(...other.voices); open.splice(open.indexOf(other), 1); }
    group.voices.push(v);
    group.latest = v.at;
    // a reply joins its parent's room, in every era: a circle is never split across two rooms
    const parent = v.reply_to != null ? bySay.get(v.reply_to) : null;
    join((parent && parent !== v && parent.at <= v.at && roomOfVoice.get(parent)) || group.room, v);
  }

  // ── the named says: the room their name names ──
  // An exact name first; failing that the same handle founding in the same second (the record's instant against memory's).
  const byId = new Map(), byKey = new Map();
  for (const r of rooms) {
    if (!byId.has(r.root)) byId.set(r.root, r);
    const k = roomKeyOf(r.root);
    if (!byKey.has(k)) byKey.set(k, r);
  }
  for (const v of sorted) {
    if (!isRoomId(v.root)) continue;
    let room = byId.get(v.root) ?? byKey.get(roomKeyOf(v.root));
    if (!room) {
      room = { root: v.root, voices: [], latest: v.at };
      rooms.push(room);
      byKey.set(roomKeyOf(v.root), room);
    } else if (!room.named) room.root = v.root; // the recorded name is the room's id from here on (both spellings still open it)
    room.named = true;
    byId.set(v.root, room);
    join(room, v);
  }
  return rooms.map(({ root, voices, latest }) => ({ root, voices: voices.sort((a, b) => a.at - b.at), latest })).sort((a, b) => a.latest - b.latest);
}

/** The open rooms a voice (or a listener) at `v` can hear at instant `at`: those with a voice within earshot of it. */
export function roomsHeardFrom(v, rooms, { earshotM, boundaries = [], at = v.at } = {}) {
  const marks = sortedEdges(boundaries);
  return rooms.filter((r) => roomOpen(r.latest, at, marks) && r.voices.some((o) => chains(o, v, earshotM)));
}

/**
 * THE ROOM A SAY THAT ANSWERS NO ONE JOINS, or null when it founds its own: among the open rooms it can hear, the room of the
 * NEAREST voice (two voices aboard the vessel are beside each other), and on a tie the room of the most recent of them. One
 * rule for the speaker and for the listener asking "which conversation am I in here".
 */
export function roomFor(v, rooms, { earshotM, boundaries = [], at = v.at } = {}) {
  const marks = sortedEdges(boundaries);
  let best = null;
  for (const r of rooms) {
    if (!roomOpen(r.latest, at, marks)) continue;
    for (const o of r.voices) {
      if (!chains(o, v, earshotM)) continue;
      const d = o.aboard && v.aboard ? 0 : distM(o, v);
      if (!best || d < best.d || (d === best.d && o.at >= best.o.at)) best = { d, o, r };
    }
  }
  return best?.r ?? null;
}
