// town-discovery.mjs — discovery, slice one (POS-497): its derivation, its
// bounds, its cursor and its words. The SQL is the store's
// (town-index-store.mjs § discover), and the rows are written by the town-index
// ingest beside the rows they come from (088_town_discovery.sql).
//
// THE RULINGS. Darko, 2026-11-03 09:22 EDT (POS-497/a): "Literal search +
// common correspondents". Wright, 2026-11-03 (POS-497/b, settled): bounded
// pages. A page that cannot finish within its work bound returns what it found,
// says plainly that it is incomplete, and hands a continuation tied to the
// source generation; it never guesses a total, never treats an empty page as no
// match, and never falls back to an unbounded scan.
//
// WHAT IT READS. Committed letter bodies and home titles and descriptions, and
// who writes to whom. Never a resident card, a profile, a mailbox's state or a
// private disposition. World marks are not in this slice.

import { createHash } from "node:crypto";
import { isResidentHandle } from "./residency.mjs"; // the door's admission grammar: an author, sender or recipient is a handle it could admit

/** The derivation's rule, by version. A change to how pieces or edges are cut is a new epoch: the next ingest replaces both tables whole. */
export const DISCOVERY_EPOCH = "1";

/** The bounds, declared once: the derivation cuts by them, the reader walks by them, and every answer carries the ones it walked by. */
export const DISCOVERY_LIMITS = Object.freeze({
  base_bytes: 1024,          // a piece's own text, before the overlap
  query_bytes: 256,          // the longest literal a text read takes
  source_id_bytes: 1024,     // the longest letter id the index keeps (088's CHECK)
  pieces_per_page: 64,       // stored pieces one text page reads, at most
  candidates_per_page: 128,  // distinct recipients one common page checks, at most
  hits_per_page: 20,         // the most a page returns, and the default
  response_bytes: 65536,     // the most a page's answer weighs, as JSON
  excerpt_bytes: 240,        // one hit's excerpt
  cursor_bytes: 16384,       // the longest cursor the door reads
});
const L = DISCOVERY_LIMITS;
// Any literal of query_bytes that starts inside a base lies wholly in its piece
// when the piece carries query_bytes - 1 bytes past the base.
const OVERLAP = L.query_bytes - 1;

// ── the derivation ───────────────────────────────────────────────────────────

/** The index of the codepoint boundary at or before `i` in UTF-8 `buf`. */
const boundaryAtOrBefore = (buf, i) => { while (i < buf.length && (buf[i] & 0xc0) === 0x80) i--; return i; };
/** The index of the codepoint boundary at or after `i` in UTF-8 `buf`. */
const boundaryAtOrAfter = (buf, i) => { while (i < buf.length && (buf[i] & 0xc0) === 0x80) i++; return i; };

/**
 * One text, cut into the pieces the index stores: bases of at most base_bytes
 * on codepoint boundaries, each carrying up to OVERLAP bytes (whole codepoints)
 * of what follows. Every character is kept, and a NUL ends a run: no query holds
 * one, so no match can cross it (the store's text cannot hold it either).
 */
export function piecesOf(text) {
  const out = [];
  for (const run of String(text).toWellFormed().split("\0")) {
    const buf = Buffer.from(run, "utf8");
    for (let start = 0; start < buf.length;) {
      const end = boundaryAtOrBefore(buf, Math.min(start + L.base_bytes, buf.length));
      const reach = boundaryAtOrBefore(buf, Math.min(end + OVERLAP, buf.length));
      out.push(buf.toString("utf8", start, reach));
      start = end;
    }
  }
  return out;
}

// A letter's recipients by the town's own law, `recipientsOf` in its
// tools/mail-state.mjs: the toList when there is one, else `to`. The office
// states the same rule at queries.mjs § letterParties and § correspondentsOf.
const recipientsOf = (l) => (Array.isArray(l?.toList) && l.toList.length ? l.toList : [l?.to]);

/**
 * Discovery's rows from the rows they come from: town_letters' `{ id, from, json }`
 * and town_homes' `{ handle, json }`, in TOWN_TABLES' column order
 * (`discovery_chunks`, `letter_edges`). The same function runs over the
 * derivation's rows at a seed and over the store's own rows at a fill, so the
 * index is a function of the rows the doors serve.
 *
 * What is not indexed is counted by reason in `skipped`, never dropped quietly:
 * a letter whose sender is not a handle the door could admit (no such author can
 * be a hit, and its edges no person could ask for), a letter id over
 * source_id_bytes, a row whose json does not parse, a recipient that is not a
 * handle, a home under a name that is not one.
 */
export function discoveryRowsOf({ letters = [], homes = [] } = {}) {
  const chunks = [], edges = [];
  const skipped = { sender: 0, id: 0, json: 0, recipient: 0, home: 0 };
  for (const { id, from, json } of letters) {
    if (!isResidentHandle(from)) { skipped.sender++; continue; }
    const sid = id == null ? "" : String(id);
    if (sid === "" || sid.includes("\0") || !sid.isWellFormed() || Buffer.byteLength(sid) > L.source_id_bytes) { skipped.id++; continue; }
    let l;
    try { l = JSON.parse(json); } catch { skipped.json++; continue; }
    const sender = String(from);
    if (typeof l?.body === "string") pushPieces(chunks, sender, "letter", sid, [l.body]);
    const seen = new Set();
    for (const r of recipientsOf(l)) {
      if (!isResidentHandle(r)) { if (r != null && r !== "") skipped.recipient++; continue; }
      const recipient = String(r);
      if (seen.has(recipient)) continue;
      seen.add(recipient);
      // the id splits one way: a handle holds no ':', and the letter id is the rest
      edges.push([`${sender}:${recipient}:${sid}`, sid, sender, recipient]);
    }
  }
  for (const { handle, json } of homes) {
    if (!isResidentHandle(handle)) { skipped.home++; continue; }
    let h;
    try { h = JSON.parse(json); } catch { skipped.json++; continue; }
    const own = String(handle);
    pushPieces(chunks, own, "home", own, [h?.title, h?.description].filter((t) => typeof t === "string"));
  }
  return { chunks, edges, skipped };
}

// A source's pieces, numbered across its texts (a home's title, then its description).
function pushPieces(out, author, kind, sourceId, texts) {
  let ordinal = 0;
  for (const text of texts)
    for (const piece of piecesOf(text)) {
      // the id splits one way: the kind and the ordinal hold no ':', and the source id is the rest
      out.push([`${kind}:${ordinal}:${sourceId}`, author, kind, sourceId, ordinal, piece]);
      ordinal++;
    }
}

// ── the generation ───────────────────────────────────────────────────────────
//
// `discovery_revision` is the XOR of the digest of every row in both tables and
// of one row per resident key, so it is the same whether a seed computes it
// whole or a delta moves it by what it replaced, and it moves whenever a piece,
// an edge or the resident set does. Unchanged rows cancel, which is what lets a
// delta fold only what it touched.

export const ZERO_REVISION = "0".repeat(32);

/** The row whose digest stands for one resident key in the revision. */
export const residentKeyRow = (handle) => ["town_residents", String(handle)];

/** `acc` XOR every digest (32 hex characters each). */
export function foldDigests(acc, digests) {
  const out = Buffer.from(acc, "hex");
  for (const d of digests) {
    const b = Buffer.from(d, "hex");
    for (let i = 0; i < out.length; i++) out[i] ^= b[i];
  }
  return out.toString("hex");
}

/** A page's generation, as a cursor carries it and an answer names it. */
export const generationOf = (epoch, revision) => (epoch && revision ? `${epoch}:${revision}` : null);
const GENERATION = /^[0-9]+:[0-9a-f]{32}$/;

/** Does this store hold 088's two tables? */
export async function discoveryTablesIn(client) {
  const r = (await client.query(
    "SELECT to_regclass('town_discovery_chunks') IS NOT NULL AND to_regclass('town_letter_edges') IS NOT NULL AS present")).rows[0];
  return r?.present === true;
}

// ── the ask ──────────────────────────────────────────────────────────────────

const bounce = (code, defect, hint) => ({ bounce: { error: "bounce", code, defect, hint } });
const MODES = ["text", "common_correspondents"];
const SOURCES = Object.freeze({ letters: "letter", homes: "home" });
const ARGS = ["mode", "q", "sources", "people", "cursor", "limit"];
const given = (v) => v !== undefined && v !== null;

/**
 * The request, validated whole: `{ ask }` or `{ bounce }`. Nothing is broadened
 * quietly. An unknown argument, an argument that belongs to the other mode, a
 * source not in this slice and a limit past the bound are each refused by name.
 */
export function discoveryAsk(args = {}) {
  const a = args ?? {};
  if (typeof a !== "object" || Array.isArray(a)) return bounce(422, "discover's arguments must be an object", `discover takes: ${ARGS.join(", ")}`);
  for (const k of Object.keys(a))
    if (!ARGS.includes(k)) return bounce(422, `unknown argument "${k}" for discover`, `discover takes: ${ARGS.join(", ")}`);
  const mode = a.mode;
  if (!MODES.includes(mode))
    return bounce(422, `mode must be one of: ${MODES.join(", ")}`,
      'mode "text" finds who wrote a literal phrase in their letters or home; mode "common_correspondents" finds the residents two named residents both write to');
  let limit = L.hits_per_page;
  if (given(a.limit)) {
    const n = typeof a.limit === "string" && a.limit.trim() !== "" ? Number(a.limit) : a.limit;
    if (!Number.isInteger(n) || n < 1 || n > L.hits_per_page)
      return bounce(422, `limit must be a whole number from 1 to ${L.hits_per_page}`, `a page returns at most ${L.hits_per_page} hits; pass cursor to read further`);
    limit = n;
  }
  if (given(a.cursor) && typeof a.cursor !== "string") return bounce(422, "cursor must be the string a previous discover page returned", "pass it back exactly as it came");
  const cursor = given(a.cursor) ? a.cursor : null;

  if (mode === "text") {
    if (given(a.people)) return bounce(422, 'people belongs to mode "common_correspondents"', 'mode "text" takes q, and sources if you want fewer than letters and homes');
    if (typeof a.q !== "string") return bounce(422, 'mode "text" needs q: the literal text to find', `q is ${L.query_bytes} bytes at most`);
    const q = a.q;
    if (q.trim() === "") return bounce(422, "q is empty or only whitespace", "give the words you are looking for");
    if (q.includes("\0") || !q.isWellFormed()) return bounce(422, "q holds a character no letter or home can hold (a NUL or a lone surrogate)", "send plain text");
    if (Buffer.byteLength(q) > L.query_bytes) return bounce(422, `q is ${Buffer.byteLength(q)} bytes; the bound is ${L.query_bytes}`, "a shorter, more particular phrase finds the same people");
    let sources = Object.keys(SOURCES);
    if (given(a.sources)) {
      if (!Array.isArray(a.sources) || a.sources.length === 0)
        return bounce(422, "sources must be a list naming letters, homes or both", "leave it off for both");
      for (const s of a.sources)
        if (!Object.hasOwn(SOURCES, s))
          return bounce(422, `"${s}" is not a source in this slice`, 'sources are "letters" and "homes"; world marks are not searched in this slice');
      sources = Object.keys(SOURCES).filter((s) => a.sources.includes(s));
    }
    return { ask: { mode, q, sources, kinds: sources.map((s) => SOURCES[s]), limit, cursor } };
  }

  if (given(a.q) || given(a.sources))
    return bounce(422, `${given(a.q) ? "q" : "sources"} belongs to mode "text"`, 'mode "common_correspondents" takes people: two resident handles');
  const people = a.people;
  if (!Array.isArray(people) || people.length !== 2 || !people.every((p) => typeof p === "string"))
    return bounce(422, 'mode "common_correspondents" needs people: exactly two resident handles', 'people: ["<handle>", "<handle>"]');
  for (const p of people) if (!isResidentHandle(p)) return bounce(422, `"${p}" is not a resident handle`, "handles are lowercase letters, digits and hyphens");
  if (people[0] === people[1]) return bounce(422, "people names the same resident twice", "name two different residents");
  return { ask: { mode, people: [...people], limit, cursor } };
}

// ── the cursor ───────────────────────────────────────────────────────────────
//
// Opaque to its reader and validated whole by this door: it carries where the
// walk stopped, the generation it stopped in, and a binding to the request. It
// grants nothing and is no count; every value in it reaches SQL as a parameter.

/** Past every key the index can hold: U+10FFFF sorts last bytewise, and 257 of them (1028 bytes) outrun 088's 1024-byte bound on a source id. */
export const PAST_EVERY_KEY = "\u{10FFFF}".repeat(257);
const LAST_ORDINAL = 2147483647;

const bindOf = (ask) => createHash("sha256")
  .update(JSON.stringify(ask.mode === "text" ? [ask.mode, ask.q, ask.sources, "C"] : [ask.mode, ask.people, "C"]))
  .digest("hex").slice(0, 32);

/** A page's cursor: `at` is where the walk stopped (text: author, kind, source id, ordinal and what it is past; common: the last recipient checked). */
export const cursorFor = (ask, generation, at) =>
  Buffer.from(JSON.stringify({ v: 1, b: bindOf(ask), g: generation, at }), "utf8").toString("base64url");

const PAST = ["row", "kind", "author"];
const sourceIdOk = (s) => typeof s === "string" && s !== "" && !s.includes("\0") && s.isWellFormed() && Buffer.byteLength(s) <= L.source_id_bytes;

/** The cursor read back: `{ at, generation }` (both null with no cursor), or `{ bounce }`. */
export function readCursor(ask) {
  if (ask.cursor == null) return { at: null, generation: null };
  const no = (why) => bounce(422, `this cursor cannot be read: ${why}`, "pass back the cursor a previous discover page returned, with the same mode and the same words, or leave it off to start again");
  // the bound is bytes, as the contract says: a string's .length counts UTF-16 units, so 8,193 two-byte characters would pass a unit bound of 16,384 while weighing 16,386 bytes
  if (Buffer.byteLength(ask.cursor, "utf8") > L.cursor_bytes) return no(`it is longer than ${L.cursor_bytes} bytes`);
  let c;
  try { c = JSON.parse(Buffer.from(ask.cursor, "base64url").toString("utf8")); } catch { return no("it is not one this door wrote"); }
  if (c === null || typeof c !== "object" || c.v !== 1) return no("it is not one this door wrote");
  if (c.b !== bindOf(ask)) return no("it belongs to a different request (another mode, other words, other sources or other people)");
  if (typeof c.g !== "string" || !GENERATION.test(c.g)) return no("its generation is not one this door writes");
  const at = c.at;
  if (ask.mode === "text") {
    const ok = Array.isArray(at) && at.length === 5 && isResidentHandle(at[0]) && (at[1] === "home" || at[1] === "letter")
      && sourceIdOk(at[2]) && Number.isInteger(at[3]) && at[3] >= 0 && at[3] < LAST_ORDINAL && PAST.includes(at[4]);
    if (!ok) return no("its place in the walk is not one this door writes");
  } else if (!(Array.isArray(at) && at.length === 1 && isResidentHandle(at[0]))) return no("its place in the walk is not one this door writes");
  return { at, generation: c.g };
}

/** Where a text walk resumes: strictly after this (author, kind, source id, ordinal). `at` null is the start. */
export function textBoundOf(at) {
  if (at == null) return ["", "", "", -1];
  const [author, kind, sourceId, ordinal, past] = at;
  if (past === "author") return [author, PAST_EVERY_KEY, PAST_EVERY_KEY, LAST_ORDINAL];
  if (past === "kind") return [author, kind, PAST_EVERY_KEY, LAST_ORDINAL];
  return [author, kind, sourceId, ordinal];
}

// ── the excerpt ──────────────────────────────────────────────────────────────

// The door's one case fold (town-index-store.mjs § likeAscii): ASCII A-Z only, and nothing else.
const foldAscii = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const EXCERPT_LEAD = 60;

/** At most excerpt_bytes of the piece, on codepoint boundaries, opening a little before the first match. */
export function excerptOf(piece, q) {
  const buf = Buffer.from(piece, "utf8");
  const at = foldAscii(piece).indexOf(foldAscii(q));
  const matchByte = at < 0 ? 0 : Buffer.byteLength(piece.slice(0, at));
  const start = boundaryAtOrAfter(buf, Math.max(0, matchByte - EXCERPT_LEAD));
  const end = boundaryAtOrBefore(buf, Math.min(buf.length, start + L.excerpt_bytes));
  return buf.toString("utf8", start, end);
}

// ── the page ─────────────────────────────────────────────────────────────────

const WORLD_MARKS = "not in this slice";

/**
 * The words a page closes on: what was read, and how to read on. A page claims
 * what it knows and no more (POS-497/b: "never treats an empty page as proof of
 * no matches"). `continued` is true when a validated cursor began this page, so
 * the walk's earlier pages are not this page's to speak for or against: its
 * empty answer is "no further matches on this page", not "no match". A page
 * that began the walk (no cursor, or a cursor a reset discarded) speaks for the
 * walk, within the scope it names; the scope is the index and the roll, never
 * "every letter" or "everyone".
 */
function moreNote(ask, { complete, shown, stoppedBy, examined, continued = false }) {
  const text = ask.mode === "text";
  if (complete) {
    const noun = text ? "matches" : "common correspondents";
    if (continued)
      return shown ? `This page ends the walk: no further ${noun} follow its hits. Hits on earlier pages stand.`
        : `No further ${noun} on this page, and this is the end of this walk. Hits on earlier pages stand.`;
    const scope = text ? "this walk's scope (the index's letters and homes, for residents on the roll)" : "this walk's scope (the index's letters, for residents on the roll)";
    const [a, b] = ask.people ?? [];
    if (text)
      return shown ? `This page holds every match in ${scope}: this is the end of the walk. World marks are not searched in this slice.`
        : `No match was found in ${scope}: this is the end of the walk. World marks, and letters or homes the index does not hold, are not searched.`;
    return shown ? `This page holds every resident ${a} and ${b} both write to, in ${scope}: this is the end of the walk.`
      : `No resident in common was found for ${a} and ${b} in ${scope}: this is the end of the walk. Letters the index does not hold are not searched.`;
  }
  const unit = text ? "pieces of text" : "of the residents they write to";
  const why = stoppedBy === "bytes" ? `the page reached its size bound (${L.response_bytes} bytes) before its next hit`
    : stoppedBy === "hits" ? `the page holds ${ask.limit} ${ask.limit === 1 ? "hit" : "hits"}, its limit`
    : `the page read ${examined} ${unit}, its work bound`;
  return `This page is not the whole answer: ${why}. Pass cursor to read on. A page with few or no hits says nothing about what is left to read.`;
}

/**
 * The answer, from the walk's rows in step order, with as many hits as fit in
 * response_bytes. A hit the page cannot carry is left for the next page: the
 * cursor then stands on the last row read before it, so it is read again.
 */
export function discoveryPage(ask, { generation, rows, more, reset = null, start = null }) {
  const continued = start != null; // the validated place a cursor resumed from; the store passes null after a reset, which makes this page the walk's first
  const hitsAt = rows.map((r, i) => (r.emitted ? i : -1)).filter((i) => i >= 0);
  const build = (k) => {
    const cut = k < hitsAt.length;
    const read = cut ? hitsAt[k] : rows.length;
    const last = read > 0 ? rows[read - 1] : null;
    const complete = !cut && !more;
    const stoppedBy = cut ? "bytes" : hitsAt.length >= ask.limit ? "hits" : "work";
    const at = last
      ? (ask.mode === "text" ? [last.author, last.source_kind, last.source_id, last.ordinal, last.past] : [last.recipient])
      : start;
    const hits = hitsAt.slice(0, k).map((i) => {
      const r = rows[i];
      if (ask.mode !== "text") return { handle: r.recipient };
      return { handle: r.author, source: r.source_kind === "home" ? { kind: "home", handle: r.source_id } : { kind: "letter", id: r.source_id }, excerpt: excerptOf(r.piece, ask.q) };
    });
    return {
      scope: ask.mode === "text" ? { mode: ask.mode, sources: ask.sources, world_marks: WORLD_MARKS } : { mode: ask.mode, world_marks: WORLD_MARKS },
      ...(ask.mode === "text" ? { q: ask.q } : { people: ask.people }),
      source_generation: generation,
      hits,
      shown: hits.length,
      complete,
      cursor: complete ? null : cursorFor(ask, generation, at),
      more_note: moreNote(ask, { complete, shown: hits.length, stoppedBy, examined: read, continued }),
      examined: ask.mode === "text" ? { pieces: read } : { candidates: read },
      limits: ask.mode === "text"
        ? { pieces_per_page: L.pieces_per_page, hits_per_page: ask.limit, response_bytes: L.response_bytes, excerpt_bytes: L.excerpt_bytes, query_bytes: L.query_bytes }
        : { candidates_per_page: L.candidates_per_page, hits_per_page: ask.limit, response_bytes: L.response_bytes },
      ...(reset ? { reset } : {}),
    };
  };
  for (let k = hitsAt.length; k > 0; k--) {
    const page = build(k);
    if (Buffer.byteLength(JSON.stringify(page)) <= L.response_bytes) return page;
  }
  return build(0);
}

// ── the refusals ─────────────────────────────────────────────────────────────

export const NOT_INSTALLED = Object.freeze({ error: "bounce", code: 503, defect: "discovery is not installed in this store yet",
  hint: "its tables arrive with a store migration (088); until then town { read: \"search\" } matches letters and residents by substring" });
export const NOT_BUILT = Object.freeze({ error: "bounce", code: 503, defect: "discovery's index has not been built yet",
  hint: "the town-index ingest builds it on its next run, within about fifteen minutes; town { read: \"search\" } answers meanwhile" });
export const noResident = (handle) => ({ error: "bounce", code: 404, defect: `no resident "${handle}"`, hint: "people names two residents of the town; town { read: \"residents\" } is the roll" });
export const resetNote = (from, to) => ({ from, to,
  note: "the record moved since this cursor was given (a letter, a home or the roll of residents changed), so the walk starts again from the beginning on this page" });
