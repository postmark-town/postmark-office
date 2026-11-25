// circles.mjs — CIRCLES: spoken talk as reply trees inside the room (POS-1035; CORE-70 calls 3, 11, 13, 21, 24, 25).
//
// THE RULES (call 3, ruled). A say may name `reply_to`: another say's act number, or a handle plus a time. A CIRCLE is any say
// plus everything that replies to it, all the way down. A say with no `reply_to` starts a TOP CIRCLE, spoken to the room. ONLY
// `reply_to` IS STORED (on the say's own act, `payload.reply_to`); the root, the path, the depth, the stubs and the folds are all
// derived here, at read time, from the stored edges. Nothing is inferred from distance or from names after the fact: old talk with
// no `reply_to` (every say before this shipped) stays a plain timeline (call 13).
//
// ONE SPEECH, SEVERAL VIEWS (call 24, Darko 10:00: "extend the existing flat lines shape"). `sayLine` is the flat line the town
// already reads — `handle, standing, said, at, at_ms, x, y`, in that order, each with its old meaning — gaining only optional
// `id` (the act number), `reply_to` and `circle` (the top circle's id). Every tree read below is a view over those same lines:
// a tree line is a flat line plus its `depth`; a fold is a stub naming the line it hangs under. There is no second model of speech.
//
// THE ROOM IS THE CALLER'S. Every function here takes one room's voices — the cluster the office already derives (voices.mjs §
// clusterVoices, one place per settlement; CORE-97 carries it across one) — and never decides what a room is. Eligibility comes
// first (a dungeon room's walls, the reader's own room); this module only sees what the caller may read.
//
// THE BUDGET (call 11). The default read is sized by a byte budget measured FROM YOUR OWN PATH: your says, their ancestors and the
// replies to them are kept whole; other branches fold first, every fold is counted and names the call that opens it, and nothing
// is cut silently. If your own path alone is over the budget, it is still served whole and the read says so. The number is the
// proposal on CORE-82 (8,192 bytes of serialized JSON, Facet's confirmation pending); it is a target, never a truncation ceiling.

import { standingOf } from "./speaker-standing.mjs"; // POS-739: every heard say carries its speaker's standing
import { lineSpeaker } from "./speaker-line.mjs"; // POS-1132: how a human is said on a line, and the shoulder they stood on

/** The default read's size target, in UTF-8 bytes of serialized JSON (POS-1035 → CORE-82 proposal; not a silent ceiling). */
export const CIRCLE_BUDGET_BYTES = 8192;
/** How much of a circle's opening say its stub quotes. A stub is a pointer, not a transcript: `read` opens the whole circle. */
export const STUB_OPENER_CHARS = 80;

/**
 * WHAT THE BUDGET MEASURES (CORE-82, agreed 16:22:47Z): the serialized JSON text a caller actually receives in MCP content, with
 * its real formatting (mcp.mjs serializes a result with one-space indentation) — not a compact surrogate, not the escaped JSON-RPC
 * envelope. On its own this measures a view; the say door passes a `measure` that serializes the WHOLE reply around the view, so
 * the target holds for what is read. The connector's 10,000-byte hard cap is separate and unchanged: a read over it is reported.
 */
export const mcpBytes = (o) => Buffer.byteLength(JSON.stringify(o, null, 1), "utf8");
const isId = (n) => Number.isSafeInteger(n) && n > 0;

/** `budget: { bytes, used, over?, note? }` — `used` is measured with this block in place, so the number is the bytes served. */
function budgetBlock(view, bytes, measure, overNote) {
  const block = { bytes, used: 0 };
  view.budget = block;
  // `used` is part of what it measures, so settle it: a digit more or less changes the count it reports (a few rounds at most)
  for (let i = 0; i < 8; i++) {
    const used = measure(view);
    if (used > bytes && !block.over) { block.over = true; block.note = overNote; continue; }
    if (block.used === used) break;
    block.used = used;
  }
  return block;
}
const iso = (ms) => new Date(ms).toISOString();

/** An act number from a stored or carried value (a bigint id arrives from Postgres as a string), or null. */
export function sayIdOf(raw) {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : /^\d{1,15}$/.test(String(raw).trim()) ? Number(String(raw).trim()) : NaN;
  return isId(n) ? n : null;
}

/**
 * A canonical mark id (`<by>/<slug>`, as ids appear in the telling) from a stored or carried value, or null (POS-1152). The recorded
 * start-place of a conversation is this and nothing else: never an image URL, a name, a coordinate or a room identity.
 */
export function markIdOf(raw) {
  return typeof raw === "string" && /^[^\s/]+(\/[^\s/]+)+$/.test(raw) ? raw : null;
}

/**
 * THE FLAT SAY LINE, extended additively (call 24). The first seven fields are the line `threadOf` has always served, by name,
 * meaning and order. `id` rides when the say's act number is known, `reply_to` when it answers one, `circle` when its top circle
 * resolves from the edges this read holds (a reply whose parent is not held carries no `circle`, and the tree reads say why).
 */
export function sayLine(v, circle = null) {
  const id = sayIdOf(v.id);
  const replyTo = sayIdOf(v.reply_to);
  return {
    handle: v.handle,
    standing: standingOf(v.handle),
    said: v.text,
    at: iso(v.at),
    at_ms: v.at,
    x: Math.round(v.x),
    y: Math.round(v.y),
    ...(id != null ? { id } : {}),
    ...(replyTo != null ? { reply_to: replyTo } : {}),
    ...(id != null && isId(circle) ? { circle } : {}),
    // POS-1152: only a circle's ROOT say carries the mark the conversation started at (a reply never does, so no later say can lend one)
    ...(replyTo == null && markIdOf(v.place_mark) ? { place_mark: v.place_mark } : {}),
    ...lineSpeaker(v), // POS-1132: the human's chosen presentation and the shoulder they spoke on; nothing on a resident's line or an old one
  };
}

/**
 * THE INDEX over one room's voices: who replies to whom, as stored. A parent counts only when this read holds it AND it was spoken
 * before its reply (an edge pointing forward in time is a broken record, not a circle). A reply whose parent is not held is
 * BROKEN here: it is never quietly promoted to a top circle; it is listed in `broken` and each tree read names it.
 */
export function circleIndex(voices) {
  const ordered = [...voices].sort((a, b) => a.at - b.at || (sayIdOf(a.id) ?? 0) - (sayIdOf(b.id) ?? 0));
  const byId = new Map();
  for (const v of ordered) { const id = sayIdOf(v.id); if (id != null) byId.set(id, v); }
  const children = new Map();
  const tops = [];
  const broken = [];
  const timeline = [];
  for (const v of ordered) {
    const id = sayIdOf(v.id);
    if (id == null) { timeline.push(v); continue; }
    const parentId = sayIdOf(v.reply_to);
    if (parentId == null) { tops.push(v); continue; }
    const parent = byId.get(parentId);
    if (!parent || parent.at > v.at || parentId === id) { broken.push(v); continue; }
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(v);
  }
  const rootCache = new Map();
  // The top circle a say sits in, or null when its chain reaches a parent this read does not hold.
  function rootOf(v) {
    const start = sayIdOf(v?.id);
    if (start == null) return null;
    if (rootCache.has(start)) return rootCache.get(start);
    const seen = new Set();
    let cur = v;
    let root = null;
    for (;;) {
      const id = sayIdOf(cur.id);
      if (seen.has(id)) break; // a loop is a broken record; there is no root to name
      seen.add(id);
      const p = sayIdOf(cur.reply_to);
      if (p == null) { root = id; break; }
      const parent = byId.get(p);
      if (!parent || parent.at > cur.at) break;
      cur = parent;
    }
    rootCache.set(start, root);
    return root;
  }
  /** `[top, …, id]`, inclusive (WLD-173's `circle_path`), or null when the chain is broken in this read. */
  function pathOf(id) {
    const out = [];
    let cur = byId.get(id);
    const seen = new Set();
    while (cur) {
      const cid = sayIdOf(cur.id);
      if (seen.has(cid)) return null;
      seen.add(cid);
      out.unshift(cid);
      const p = sayIdOf(cur.reply_to);
      if (p == null) return out;
      const parent = byId.get(p);
      if (!parent || parent.at > cur.at) return null;
      cur = parent;
    }
    return null;
  }
  /** Every say under `id` (itself first), depth-first, siblings in the order spoken. */
  function subtree(id) {
    const out = [];
    const walk = (v, depth) => {
      out.push({ v, depth });
      for (const c of children.get(sayIdOf(v.id)) ?? []) walk(c, depth + 1);
    };
    const v = byId.get(id);
    if (v) walk(v, 0);
    return out;
  }
  return { byId, children, tops, broken, timeline, rootOf, pathOf, subtree };
}

/**
 * A SAY AS A REFERENCE, for a read that serves the fact of a say and never its words (the close block's POS-1024 row: the feed and
 * the day): `{ id, reply_to? }` from an act row (`id`, and the `reply_to` scalar its read selected), or null for any other act or a
 * row with no act number. Old talk carries no reply_to, and none is made up.
 */
export function sayReferenceOf(row) {
  if (row?.action !== "say") return null;
  const id = sayIdOf(row.id);
  if (id == null) return null;
  const replyTo = sayIdOf(row.reply_to);
  return { id, ...(replyTo != null ? { reply_to: replyTo } : {}) };
}

/** The flat lines for every voice of a room, in the order given, each carrying its circle when it resolves (threadOf's lines). */
export function sayLines(voices, index = circleIndex(voices)) {
  return voices.map((v) => sayLine(v, index.rootOf(v)));
}

const peopleOf = (list) => new Set(list.map((v) => v.handle)).size;
const brokenNote = (v) => ({
  id: sayIdOf(v.id), reply_to: sayIdOf(v.reply_to), handle: v.handle, at: iso(v.at),
  note: "this say replies to one this read does not hold (older than the office's record here, or a record that is incomplete) — it is not shown as a circle of its own; read it with say { circle: <its id> }",
});

/** A pointer to a circle: who opened it, its first words, how big it is, and the call that opens it. */
export function circleStub(index, id) {
  const all = index.subtree(id).map((s) => s.v);
  const top = index.byId.get(id);
  const words = [...String(top.text ?? "")];
  return {
    circle: id,
    handle: top.handle,
    opener: words.length > STUB_OPENER_CHARS ? `${words.slice(0, STUB_OPENER_CHARS).join("")}…` : words.join(""),
    says: all.length,
    people: peopleOf(all),
    started: iso(top.at),
    latest: iso(Math.max(...all.map((v) => v.at))),
    // POS-1152: the mark this circle started at, only when its top is a root say that recorded one (a folded reply's stub has none)
    ...(sayIdOf(top.reply_to) == null && markIdOf(top.place_mark) ? { place_mark: top.place_mark } : {}),
    read: { circle: id },
    ...lineSpeaker(top), // POS-1132: the opener's presentation, so a circle names who opened it as the lines do
  };
}

/**
 * THE DEFAULT READ: `say { }` — the pruned tree, its budget measured from the caller's own path (calls 3, 11).
 *
 * `caller` is the handle reading. A caller who has spoken in this room (with a say id) gets THEIR circle — the top circle of their
 * latest say — as lines, and every other top circle as a stub. A spectator or a newcomer gets top-circle stubs in the order they
 * started, not an invented personal circle (CORE-82 boundary). Old unthreaded talk rides as `timeline`, a plain list.
 *
 * Inside your circle: your own path is kept whole — each of your says, the says above it to the top, and the replies to it. Every
 * other branch is added whole while the budget allows, the most recently active first; a branch that does not fit is FOLDED to a
 * stub under the line it hangs from, counted, with the call that opens it. Stubs that do not fit are listed by id in
 * `more_circles` (each id is its own call). If the kept path alone is over the budget, it is served whole and `budget.over` says so.
 */
export function circleView(voices, { caller = null, budget = CIRCLE_BUDGET_BYTES, decorate = null, measure = mcpBytes } = {}) {
  const index = circleIndex(voices);
  const threaded = voices.filter((v) => sayIdOf(v.id) != null);
  const lineOf = (v, extra = {}) => ({ ...sayLine(v, index.rootOf(v)), ...extra, ...(decorate ? decorate(v) : {}) });
  const mine = caller ? threaded.filter((v) => v.handle === caller && index.rootOf(v) != null) : [];
  const yours = mine.length ? index.rootOf(mine.at(-1)) : null;

  const view = {
    room: { says: voices.length, people: peopleOf(voices), top_circles: index.tops.length },
    yours,
    lines: [],
    folded: [],
    elsewhere: [],
  };

  // ── your circle: the kept path, then whole branches newest-active first, folding what does not fit ──
  if (yours != null) {
    const tree = index.subtree(yours);
    const keep = new Set();
    for (const v of mine.filter((m) => index.rootOf(m) === yours)) {
      for (const id of index.pathOf(sayIdOf(v.id)) ?? []) keep.add(id);
      for (const c of index.children.get(sayIdOf(v.id)) ?? []) keep.add(sayIdOf(c.id));
    }
    // A branch is a maximal subtree hanging off a kept say whose own top is not kept.
    const branches = [];
    for (const { v } of tree) {
      const id = sayIdOf(v.id);
      if (!keep.has(id)) continue;
      for (const c of index.children.get(id) ?? []) {
        const cid = sayIdOf(c.id);
        if (keep.has(cid)) continue;
        const says = index.subtree(cid).map((s) => s.v);
        branches.push({ under: id, top: cid, says, latest: Math.max(...says.map((s) => s.at)) });
      }
    }
    const shown = new Set(keep);
    const assemble = () => tree.filter(({ v }) => shown.has(sayIdOf(v.id)))
      .map(({ v, depth }) => lineOf(v, { depth, ...(v.handle === caller ? { you: true } : {}) }));
    view.lines = assemble();
    // fold everything not on the path, then unfold whole branches newest-active first while the view stays inside the budget
    const folds = new Map(branches.map((b) => [b.top, b]));
    const foldStub = (b) => ({ ...circleStub(index, b.top), under: b.under });
    const stubsElsewhere = index.tops.filter((t) => sayIdOf(t.id) !== yours).map((t) => circleStub(index, sayIdOf(t.id)));
    const draft = () => ({ ...view, lines: assemble(), folded: [...folds.values()].map(foldStub), elsewhere: stubsElsewhere });
    for (const b of [...branches].sort((a, c) => c.latest - a.latest)) {
      folds.delete(b.top);
      for (const s of b.says) shown.add(sayIdOf(s.id));
      if (measure(draft()) > budget) {
        folds.set(b.top, b);
        for (const s of b.says) shown.delete(sayIdOf(s.id));
      }
    }
    view.lines = assemble();
    view.folded = [...folds.values()].sort((a, c) => a.says[0].at - c.says[0].at).map(foldStub);
  }

  // ── elsewhere in the room: every other top circle as a stub, in the order they started ──
  const others = index.tops.filter((t) => sayIdOf(t.id) !== yours);
  const more = [];
  for (const t of others) {
    const stub = circleStub(index, sayIdOf(t.id));
    view.elsewhere.push(stub);
    if (measure(view) > budget && view.elsewhere.length > 1) { view.elsewhere.pop(); more.push(sayIdOf(t.id)); }
  }
  if (more.length) view.more_circles = more;

  if (index.broken.length) view.broken = index.broken.map(brokenNote);
  if (index.timeline.length) {
    // OLD TALK, a plain timeline (call 13): newest kept while the budget allows, the rest counted.
    const kept = [];
    for (let i = index.timeline.length - 1; i >= 0; i--) {
      kept.unshift(lineOf(index.timeline[i]));
      if (measure({ ...view, timeline: kept }) > budget && kept.length > 1) { kept.shift(); break; }
    }
    view.timeline = kept;
    if (kept.length < index.timeline.length) view.timeline_folded = index.timeline.length - kept.length;
  }

  const foldedSays = view.folded.reduce((n, f) => n + f.says, 0);
  view.counts = {
    lines: view.lines.length,
    folded_branches: view.folded.length,
    folded_says: foldedSays,
    elsewhere: view.elsewhere.length + more.length,
    ...(view.timeline ? { timeline: index.timeline.length } : {}),
  };
  // YOUR OWN PATH, PAGED WHEN IT CANNOT FIT (Wright 17:38:11Z, settled): other branches have already folded; if the view is still
  // over the target, the path's lines are served in their own order up to the target (always at least one), and `own_path` says
  // it is paged — how many says it holds, how many are here, and the call that continues it. Nothing is cut silently; the counts
  // stay whole. The continuation reads the same circle on, depth-first (circleRead), from the last line served here.
  if (yours != null && measure(view) > budget && view.lines.length > 1) {
    const all = view.lines;
    const page = (n) => ({ ...view, lines: all.slice(0, n), own_path: { paged: true, says: all.length, shown: n, next: { circle: yours, after: all[n - 1].id } } });
    let n = all.length - 1;
    while (n > 1 && measure(page(n)) > budget) n -= 1;
    Object.assign(view, page(n));
    view.counts.lines = n;
  }
  view.budget = budgetBlock(view, budget, measure, view.own_path?.paged
    ? "your own path is larger than the budget, so it is paged: `own_path.next` continues it in order"
    : "the folds and stubs alone are larger than the budget; each still names the call that opens it");
  return view;
}

/**
 * ONE CIRCLE, WHOLE AND PAGED: `say { circle: <id> }` (call 3). `id` is any say's act number; the circle is that say and everything
 * under it. The path above it (to its top circle) rides first as `context` lines, so a nested circle keeps its way back. The says
 * are depth-first; a page fills the budget (always at least one say) and `next` names the call for the rest. Null when this read
 * does not hold the say at all (the caller says unavailable, never "empty").
 */
export function circleRead(voices, id, { after = null, budget = CIRCLE_BUDGET_BYTES, decorate = null, measure = mcpBytes } = {}) {
  const index = circleIndex(voices);
  const want = sayIdOf(id);
  const target = want == null ? null : index.byId.get(want);
  if (!target) return null;
  const lineOf = (v, extra = {}) => ({ ...sayLine(v, index.rootOf(v)), ...extra, ...(decorate ? decorate(v) : {}) });
  const tree = index.subtree(want);
  const path = index.pathOf(want);
  const context = (path ?? [want]).slice(0, -1).map((pid) => lineOf(index.byId.get(pid), { context: true }));
  const startAfter = sayIdOf(after);
  let from = 0;
  if (startAfter != null) {
    const at = tree.findIndex(({ v }) => sayIdOf(v.id) === startAfter);
    if (at < 0) return { circle: want, refused: `say ${startAfter} is not in circle ${want}: pass the \`after\` this circle's own \`next\` gave you` };
    from = at + 1;
  }
  const page = { circle: want, path, says: tree.length, people: peopleOf(tree.map((s) => s.v)),
    ...(from === 0 ? { context } : {}), lines: [] };
  if (path == null) page.broken = brokenNote(index.byId.get(want));
  // POS-1152: the circle's start-place, from the root its ancestry reaches; a broken chain has no root and borrows nothing
  else { const rootSay = index.byId.get(path[0]); if (sayIdOf(rootSay?.reply_to) == null && markIdOf(rootSay?.place_mark)) page.place_mark = rootSay.place_mark; }
  let i = from;
  for (; i < tree.length; i++) {
    page.lines.push(lineOf(tree[i].v, { depth: tree[i].depth }));
    if (page.lines.length > 1 && measure(page) > budget) { page.lines.pop(); break; }
  }
  page.next = i < tree.length ? { circle: want, after: sayIdOf(page.lines.at(-1).id) } : null;
  page.complete = page.next == null && from === 0;
  page.budget = budgetBlock(page, budget, measure, "a page always carries at least one say; this one (with its path) is larger than the budget and is served whole");
  return page;
}

/**
 * NEW SINCE A CURSOR: `say { since: <ms> }` (call 11). The says newer than `since` — and, for each that replies to a say NOT in that
 * new set, that parent, marked `context: true`, so a reply never arrives without what it answers. A parent this read does not hold
 * is named in `broken`. The cursor is the say record's millisecond stamp (`latest`), never a general world cursor.
 */
export function sinceRead(voices, since, { decorate = null } = {}) {
  const index = circleIndex(voices);
  const lineOf = (v, extra = {}) => ({ ...sayLine(v, index.rootOf(v)), ...extra, ...(decorate ? decorate(v) : {}) });
  const fresh = voices.filter((v) => v.at > since).sort((a, b) => a.at - b.at);
  const freshIds = new Set(fresh.map((v) => sayIdOf(v.id)).filter((n) => n != null));
  const parents = new Map();
  const broken = [];
  for (const v of fresh) {
    const p = sayIdOf(v.reply_to);
    if (p == null || freshIds.has(p) || parents.has(p)) continue;
    const parent = index.byId.get(p);
    if (parent && parent.at <= v.at) parents.set(p, parent); else broken.push(brokenNote(v));
  }
  const lines = [...[...parents.values()].map((v) => ({ v, context: true })), ...fresh.map((v) => ({ v, context: false }))]
    .sort((a, b) => a.v.at - b.v.at)
    .map(({ v, context }) => lineOf(v, context ? { context: true } : {}));
  return { since, lines, new_says: fresh.length, context_says: parents.size, ...(broken.length ? { broken } : {}) };
}

/**
 * WHERE SOMEONE IS TALKING: `say { with: "<handle>" }` (call 3). Their says in this room, each with the say it answers as
 * `context`, newest kept while the budget allows (the rest counted in `folded_says`), and a stub for every circle they spoke in.
 */
export function withRead(voices, handle, { budget = CIRCLE_BUDGET_BYTES, decorate = null, measure = mcpBytes } = {}) {
  const index = circleIndex(voices);
  const lineOf = (v, extra = {}) => ({ ...sayLine(v, index.rootOf(v)), ...extra, ...(decorate ? decorate(v) : {}) });
  const theirs = voices.filter((v) => v.handle === handle).sort((a, b) => a.at - b.at);
  const roots = [...new Set(theirs.map((v) => index.rootOf(v)).filter((r) => r != null))];
  const out = { with: handle, says: theirs.length, circles: roots.map((r) => ({ ...circleStub(index, r), theirs: theirs.filter((v) => index.rootOf(v) === r).length })), lines: [] };
  const kept = [];
  let folded = 0;
  for (let i = theirs.length - 1; i >= 0; i--) {
    const v = theirs[i];
    const parent = index.byId.get(sayIdOf(v.reply_to));
    const pair = [...(parent && parent.handle !== handle ? [lineOf(parent, { context: true })] : []), lineOf(v)];
    const next = [...pair, ...kept];
    if (kept.length && measure({ ...out, lines: next }) > budget) { folded = i + 1; break; }
    kept.splice(0, 0, ...pair);
  }
  const seen = new Set();
  out.lines = kept.filter((l) => { const k = `${l.id ?? ""} ${l.at_ms} ${l.handle}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (folded) out.folded_says = folded;
  out.budget = budgetBlock(out, budget, measure, "their newest say (with what it answers) and the circle stubs are larger than the budget, and are served whole");
  return out;
}

const nameRe = (handle) => new RegExp(`(^|[^a-z0-9_.-])${handle.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9_-])`);

/**
 * RESOLVING `reply_to` WHEN A SAY IS SPOKEN (calls 3, 21, 25). `roomVoices` are the says the speaker can answer: every say of the
 * open conversations within earshot of where they stand (call 21: "yes to room, no to settlement"; POS-1185: rooms no longer fuse,
 * so that can be more than one room, and the reply joins the room of the say it answers). A say outside them is refused, never
 * linked. `replyTo` is:
 *   · an act number (or its digits) — that say, if it is among them;
 *   · `{ handle, at }` — that resident's say at EXACTLY that instant (ISO or ms, normalized to ms): none, or more than one, is
 *     refused by name — a nearby say is never chosen;
 *   · absent — NAME-LINKING: if the words name someone who has spoken in this room (their handle, as a word), the say links to
 *     that person's latest say here, and the receipt discloses it (`how: "name"`). The first name in the words wins.
 * Returns `{ id, how, handle, at_ms }`, `{ refused: { defect, hint } }`, or null (a top-circle say).
 */
export function resolveReplyTo(roomVoices, { replyTo = null, speaker = null, text = "" } = {}) {
  const threaded = roomVoices.filter((v) => sayIdOf(v.id) != null);
  const found = (v, how) => ({ id: sayIdOf(v.id), how, handle: v.handle, at_ms: v.at });
  const refuse = (defect, hint) => ({ refused: { defect, hint } });
  const asked = replyTo == null || replyTo === "" ? null : replyTo;
  if (asked == null) {
    const lower = String(text ?? "").toLowerCase();
    let best = null;
    for (const h of new Set(threaded.map((v) => v.handle))) {
      if (h === speaker) continue;
      const m = nameRe(h).exec(lower);
      if (!m) continue;
      const pos = m.index + m[1].length;
      if (!best || pos < best.pos) best = { handle: h, pos };
    }
    if (!best) return null;
    const latest = threaded.filter((v) => v.handle === best.handle).at(-1);
    return found(latest, "name");
  }
  if (typeof asked === "object" && !Array.isArray(asked)) {
    const handle = String(asked.handle ?? "").trim();
    const t = typeof asked.at === "number" ? asked.at : /^\d{10,15}$/.test(String(asked.at ?? "")) ? Number(asked.at) : Date.parse(String(asked.at ?? ""));
    if (!handle || !Number.isFinite(t))
      return refuse("reply_to by handle needs both `handle` and `at`", "reply_to: { handle: \"<who>\", at: \"<the instant they spoke, ISO or at_ms>\" } — or pass the say's id");
    const theirs = threaded.filter((v) => v.handle === handle);
    if (!theirs.length)
      return refuse(`${handle} has not spoken in a conversation you can hear from where you stand`, "a reply answers a say in an open conversation within earshot of you, and joins that conversation (call 21); listen with say {} to see who is talking here");
    // THE EXACT INSTANT, never a nearby one (CORE-82 read, Rivet 18:18Z): the rulings say handle plus time, and the say read gives
    // every line its `at` and `at_ms` — the same instant, normalized to ms here. No say at it, or two, is refused; none is guessed.
    const exact = theirs.filter((v) => v.at === t);
    if (exact.length === 1) return found(exact[0], "handle_time");
    if (exact.length > 1)
      return refuse(`${handle} has ${exact.length} says at exactly ${iso(t)} (${exact.map((v) => sayIdOf(v.id)).join(", ")})`, "pass the id of the one you mean");
    return refuse(`${handle} said nothing within your hearing at exactly ${iso(t)}`, "pass the say's `at` or `at_ms` exactly as the say read showed it, or its id");
  }
  const id = sayIdOf(asked);
  if (id == null) return refuse("reply_to is a say's id (a whole number) or { handle, at }", "the ids ride on every line of the say read as `id`");
  const hit = threaded.find((v) => sayIdOf(v.id) === id);
  if (!hit)
    return refuse(`say ${id} is not in a conversation you can hear from where you stand`, "a reply answers a say in an open conversation within earshot of you, and joins that conversation (call 21): walk back within earshot of it, or read it with say { circle: " + id + " }");
  return found(hit, "id");
}

/**
 * THE SAY A `reply_to` NAMES among `voices` — an id, or `{ handle, at }` at exactly that instant, and only when it names ONE say — or
 * null. It decides nothing about whether that say may be answered (`resolveReplyTo` does, over the says in reach): the say door asks
 * this only AFTER a refusal, to tell a say whose conversation has closed from one that is merely out of reach (POS-1185), so each
 * refusal can say what the caller can do about it.
 */
export function replyTargetIn(voices, replyTo) {
  const threaded = voices.filter((v) => sayIdOf(v.id) != null);
  if (replyTo != null && typeof replyTo === "object" && !Array.isArray(replyTo)) {
    const handle = String(replyTo.handle ?? "").trim();
    const t = typeof replyTo.at === "number" ? replyTo.at : /^\d{10,15}$/.test(String(replyTo.at ?? "")) ? Number(replyTo.at) : Date.parse(String(replyTo.at ?? ""));
    if (!handle || !Number.isFinite(t)) return null;
    const exact = threaded.filter((v) => v.handle === handle && v.at === t);
    return exact.length === 1 ? exact[0] : null;
  }
  const id = sayIdOf(replyTo);
  return id == null ? null : threaded.find((v) => sayIdOf(v.id) === id) ?? null;
}

/** The refusal for a reply to a say whose conversation has closed (WLD-242: "A reply to a say whose room has closed is refused"). */
export const closedRoomRefusal = (id) => ({
  defect: `say ${id} is in a conversation that has closed`,
  hint: `that conversation has closed, and a reply cannot reopen it. Say it fresh, with no reply_to, and it starts or joins a conversation where you are. The closed one is still there to read: say { circle: ${id} }`,
});

/** `?circle=<say id>[&after=<id>]` or `?room=<thread id>` on a conversations read — a named conversation; null for a page read. */
export function findOf(searchParams) {
  const get = (k) => { const v = searchParams?.get(k); return v == null || v === "" ? null : v; };
  if (get("circle") != null) return { circle: get("circle"), after: get("after"), ...(roomVoicesAsked(searchParams) ? { room_voices: true } : {}) };
  // POS-1232: `?room_voices=1` is the OPT-IN to the room's public voice lines (below); without it the read is the one it always was
  if (get("room") != null) return { room: get("room"), ...(roomVoicesAsked(searchParams) ? { room_voices: true } : {}) };
  return null;
}

/** Did the request opt in to a room's public voice lines? Only `room_voices=1` (or `true`) does; any other value, or none, is the read it always was. */
export const roomVoicesAsked = (searchParams) => ["1", "true"].includes(String(searchParams?.get("room_voices") ?? ""));

/** The most voice lines one opt-in page serves, whatever `voices=` asks: a room's page is bounded, never the whole archive in one answer (POS-1232). */
export const ROOM_VOICES_MAX = 400;

/**
 * POS-1232: THE ROOM'S PUBLIC VOICES, as one page. `paged` is the same `pagedThread` the conversations LIST serves (its `voices` are the public say lines: full
 * `said`, `id` and `reply_to` where recorded, the producer's `circle` resolved over the WHOLE room, and nothing invented for an old line without ids), and its tie-safe
 * `voices_earlier`. This states what the page IS: the room's total, how many lines this page serves, whether earlier lines wait behind it (and the cursor that opens
 * them), and whether later lines were left out by the caller's own cursor. A partial page never reads as the whole room. PURE.
 */
export function roomVoicesPage(paged, { cap, source }) {
  const total = Number(paged.voice_count ?? 0);
  const served = paged.voices.length;
  const earlier = paged.voices_earlier?.remaining ?? 0;
  const later = Math.max(0, total - earlier - served);
  return {
    voices: paged.voices,
    voices_page: {
      source, order: "oldest first", total, served, cap,
      complete: earlier === 0 && later === 0,
      ...(earlier > 0 ? { earlier: { remaining: earlier, before_ms: paged.voices_earlier.before_ms, before: paged.voices_earlier.before,
        next: `repeat this read with voices_before=${paged.voices_earlier.before_ms} for the lines before these` } } : {}),
      ...(later > 0 ? { later_not_served: later, note: "voices_before cut this page off from the room's newer lines; they are not on it" } : {}),
    },
  };
}

/**
 * NAMED HISTORY, PAST THE FIRST PAGE (POS-1035 → CORE-82): `/api/world/conversations?circle=<say id>` or `?room=<thread id>` finds
 * that conversation among ALL the clusters a read holds, not only the page it would fall on. `thread(cluster)` is the caller's own
 * `threadOf` (the room's header and flat lines). A circle answers its room's header and the circle itself, whole or paged
 * (`after`), never the room's transcript beside it; a room answers its thread. `history` is said plainly: `complete` (all of it),
 * `folded` (a page of it; the rest is named), or `unavailable` (this read does not hold it — `source` says which read that was).
 */
export function findConversation(clusters, { circle = null, room = null, after = null, room_voices = false } = {}, { thread, roomLines = null, budget = CIRCLE_BUDGET_BYTES, source, measure = mcpBytes } = {}) {
  const id = sayIdOf(circle);
  if (circle != null && id == null) return { refused: { defect: `"${circle}" is not a say id`, hint: "?circle=<the id on a say line> — or ?room=<a thread's id>" } };
  // a room's id is the page's: its recorded root (CORE-97, memory: the room keeps its name when its front leaves memory or it
  // carries across a settlement), else its first say (the record, which holds the room whole)
  const roomOf = (c) => c.root ?? `t${c.voices[0].at}-${c.voices[0].handle}`;
  // POS-1183: the record rounds a say's `at` to the second, while the page's live room id carries milliseconds
  // (t1795343232206-wren-porter vs the record's t1795343232000-wren-porter). An exact id wins; failing that, the same handle
  // starting in the same second is the same room. No id the office hands out changes, and ?circle= is not loosened.
  const roomKey = (rid) => { const m = /^t(\d+)-(.+)$/.exec(String(rid)); return m ? `${Math.floor(Number(m[1]) / 1000)}-${m[2]}` : null; };
  const askedKey = id == null ? roomKey(room) : null;
  const hit = id != null ? clusters.find((c) => c.voices.some((v) => sayIdOf(v.id) === id))
    : clusters.find((c) => roomOf(c) === String(room)) ?? (askedKey == null ? undefined : clusters.find((c) => roomKey(roomOf(c)) === askedKey));
  const asked = id != null ? { circle: id } : { room: String(room) };
  if (!hit)
    return { ...asked, history: "unavailable", source,
      note: source === "memory"
        ? "not in this office's memory of the town's talk (it keeps the last voices it heard); the record, where this office reads it, may hold it"
        : "no conversation in the record holds it" };
  const t = thread(hit);
  const { voices: _lines, ...header } = t;
  if (id == null) {
    // THE KEYLESS ROOM (CORE-82 read, Rivet 18:18Z): a spectator's view of the room from the same producer as `say {}` — no own
    // path (nobody is reading as a speaker), every top circle a stub in the order it started, old talk as its timeline, broken
    // parents named, and every circle opened by ?circle=<id> (paged by &after=). The browser never rebuilds a tree from a flat feed.
    const circles = circleView(hit.voices, { caller: null, budget, measure: (v) => measure({ ...asked, source, room: header, circles: v }) });
    const folded = Boolean(circles.more_circles?.length || circles.timeline_folded);
    // POS-1232: the OPT-IN public voice page of this one room, beside (never instead of) the circles; omitted, the answer is byte-for-byte what it was
    const lines = room_voices && typeof roomLines === "function" ? (({ paged, cap }) => roomVoicesPage(paged, { cap, source }))(roomLines(hit)) : null;
    return { ...asked, history: circles.broken ? "unavailable" : folded ? "folded" : "complete", source, room: header, circles, ...(lines ?? {}),
      ...(circles.broken ? { note: "some replies here answer says this read does not hold (named in circles.broken); everything else is served" } : {}),
      ...(folded && !circles.broken ? { note: "more circles than fit: each id in circles.more_circles opens with ?circle=<id>" } : {}) };
  }
  const page = circleRead(hit.voices, id, { after, budget, measure: (p) => measure({ ...asked, source, room: header, circle_read: p }) });
  if (page.refused) return { ...asked, history: "unavailable", source, refused: page.refused };
  return { ...asked, history: page.broken ? "unavailable" : page.complete ? "complete" : "folded", source, room: header, circle_read: page };
}
