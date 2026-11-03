// convo-memo.mjs — A BOUNDED, IN-PROCESS MEMO OF ONE SETTLEMENT'S INTERPRETED VIEW (POS-779).
//
// STATUS: UNWIRED (see convo-read.mjs).
//
// WHAT IT HOLDS. For a handful of settlements, the last view built from a source (voices, components, thread
// digests) and the fingerprint it was built from. Not a store, a service or a copy of anything durable: it is
// RAM in this thread, and a restart or another worker thread starts empty (each thread has its own copy; the
// cost of a miss is one read and one build, never a wrong answer).
//
// WHAT MAKES IT SAFE. A view is served only when the fingerprint read in THE SAME SNAPSHOT as the request equals
// the stored one: `lookup(epochId, key)` returns the value for an equal key and nothing else. There is no
// "latest" accessor and no age-based serve. The key is built in convo-read.mjs from the epoch, the edges
// version, every dial, the eligibility/decoder version, the database name, the count, stored bytes, max id and
// id/instant digests of both row sets and the composed centre of every referenced anchor. A stale pool, a
// reseeded or restored source, a moved anchor or a changed dial all change it. A request whose validation
// fails (a timeout, an unreadable store) never reaches `lookup`, so old data is never served as current.
//
// WHAT BOUNDS IT. `maxEntries` settlements and `maxBytes` of the caller's own estimate of each entry's size
// (convo-pager.mjs § viewBytes: stored payload bytes of the source plus a per-voice overhead). Least recently
// used goes first. An entry larger than the whole byte bound is not kept (counted in `stats().refused`) rather
// than evicting everything for it. Nothing grows without a bound: the participants lists are rebuilt per
// request from the view, not retained apart from it.

export const MEMO_DEFAULTS = Object.freeze({ maxEntries: 4, maxBytes: 64 * 1024 * 1024 });

export function createEpochMemo({ maxEntries = MEMO_DEFAULTS.maxEntries, maxBytes = MEMO_DEFAULTS.maxBytes } = {}) {
  if (!(Number.isInteger(maxEntries) && maxEntries >= 1)) throw new RangeError("maxEntries must be a positive integer");
  if (!(Number.isFinite(maxBytes) && maxBytes >= 1)) throw new RangeError("maxBytes must be a positive number");
  const entries = new Map(); // epochId -> { key, bytes, anchors, value }, least recently used first
  let total = 0;
  const stats = { hits: 0, misses: 0, sets: 0, evicted: 0, refused: 0 };

  const drop = (id) => { const e = entries.get(id); if (e) { total -= e.bytes; entries.delete(id); } };
  const touch = (id, e) => { entries.delete(id); entries.set(id, e); };

  return {
    /** The anchors the stored view referenced (so a request can read their geometry in its own snapshot), or null. Does not serve the view. */
    peek(epochId) {
      const e = entries.get(epochId);
      return e ? { anchors: e.anchors.slice() } : null;
    },
    /** The stored value if and only if `key` is exactly the key it was built under. */
    lookup(epochId, key) {
      const e = entries.get(epochId);
      if (!e || e.key !== key) { stats.misses += 1; return null; }
      touch(epochId, e);
      stats.hits += 1;
      return e.value;
    },
    /** Keep `value` for `epochId` under `key`; replaces what the epoch held. Returns whether it was kept. */
    set(epochId, { key, bytes, anchors = [], value }) {
      if (typeof key !== "string" || !key) throw new TypeError("a memo entry needs the fingerprint it was built under");
      const size = Math.max(1, Math.ceil(Number(bytes) || 1));
      drop(epochId);
      if (size > maxBytes) { stats.refused += 1; return false; }
      entries.set(epochId, { key, bytes: size, anchors: anchors.slice(), value });
      total += size;
      stats.sets += 1;
      while (entries.size > maxEntries || total > maxBytes) {
        const oldest = entries.keys().next().value;
        drop(oldest);
        stats.evicted += 1;
      }
      return true;
    },
    clear() { entries.clear(); total = 0; },
    stats() { return { ...stats, entries: entries.size, bytes: total, maxEntries, maxBytes }; },
  };
}
