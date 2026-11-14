// town-feed-sources.mjs — the six public records the feed reads (POS-1027), each through the read that already answers it.
//
//   letter    the public letter index's delivered letters (town-index-store.mjs § lettersDeliveredFeed): who wrote to whom, never what it said
//   idea      town { read: "posts", args: { class: "idea" } }: the idea posts, and the net backing the stakes on them make
//   bug       town { read: "posts", args: { class: "bug" } }
//   event     town { read: "posts", args: { class: "event" } } for when it was put up, and the calendar for where it is (its place's absolute x, y)
//   mark      the marks a crossing DECIDED (locked or refused): world2-claims.mjs § claimRowsDecidedSince, which is public and unscoped, with the published
//             marks' own stamps and position (town-marks.mjs § publishedMarksTownwide) for backing and distance
//   arrival   the roster's `joined` dates (the doorstep's own latest-arrivals source), a resident's arrival, date-only
//
// Each source answers `{ rows, cut }` newest first, bounded by `cap`; `since` and `before` (inclusive) narrow it. Nothing is merged, ranked or paged here:
// that is town-feed.mjs, and its tests, which do not need a store.

import { apiUrl } from "./public-base.mjs";
import { instantOf, afterResume } from "./town-feed.mjs";

const byNewest = (x, y) => (x.at === y.at ? 0 : x.at == null ? 1 : y.at == null ? -1 : x.at < y.at ? 1 : -1) || (String(x.id) < String(y.id) ? -1 : String(x.id) > String(y.id) ? 1 : 0);   // the feed's order: time newest first, then id ascending
/** Bound a source's rows by `since` / `before` (inclusive) and `cap`; newest first. */
function bound(rows, { since, before, resume = null, cap }) {
  const kept = rows.filter((r) => (!since || (r.at != null && r.at >= since)) && (!before || r.at == null || r.at <= before) && afterResume(r, resume)).sort(byNewest);
  return { rows: kept.slice(0, cap), cut: kept.length > cap };
}

/** Every post of a class, paging the posts read until it is whole (the bug class is paged by the read). */
async function allPosts(cls, { postsAtOffice, nowMs }) {
  const out = [];
  let offset = 0;
  for (let guard = 0; guard < 50; guard++) {
    const r = await postsAtOffice({ class: cls, limit: 200, offset }, { now: nowMs, pointer: false });
    out.push(...(r?.posts ?? []));
    if (r?.complete !== false || r?.next_offset == null) break;
    offset = r.next_offset;
  }
  return out;
}

/** A post's own time: the first act in its history (the post act), else its latest act; never the clock. */
const postAt = (p) => instantOf(p.history?.[0]?.at ?? p.latest?.at ?? null);

/**
 * The real sources, over the door's pooled index `ix` and the office's readers. Every reader is injectable so a suite can run the whole read without a store.
 * `clone` is the town clone the house resolver reads the registry through.
 */
export function realSources({ ix, clone, nowMs = Date.now(), readers = {} } = {}) {
  const lazy = async (name, spec) => readers[name] ?? (await import(spec))[name];
  const sources = {
    async letter({ since, before, resume, cap }) {
      const r = await ix.lettersDeliveredFeed({ sinceIso: since, beforeIso: before, resume, limit: cap });
      const rows = r.rows.map((l) => ({
        id: l.id, kind: "letter", ...instantOf(l.delivered_at ?? l.date), href: apiUrl(`/letters/${l.id}`),
        title: `${l.from_h} wrote to ${l.to_h}`, by: l.from_h,
      }));
      return { rows: rows.filter((x) => (!before || x.at == null || x.at <= before)), cut: r.cut };
    },
    async idea({ since, before, resume, cap }) {
      const postsAtOffice = await lazy("postsAtOffice", "./town-posts.mjs");
      const posts = await allPosts("idea", { postsAtOffice, nowMs });
      return bound(posts.map((p) => ({
        id: p.id, kind: "idea", ...postAt(p), href: apiUrl(`/posts/${p.id}?class=idea`), title: p.title ?? p.id, by: p.author ?? null, state: p.state ?? null,
        ...(Number.isFinite(Number(p.backing?.net)) ? { backed: Number(p.backing.net) } : {}),
      })), { since, before, resume, cap });
    },
    async bug({ since, before, resume, cap }) {
      const postsAtOffice = await lazy("postsAtOffice", "./town-posts.mjs");
      const posts = await allPosts("bug", { postsAtOffice, nowMs });
      return bound(posts.map((p) => ({
        id: p.id, kind: "bug", ...postAt(p), href: apiUrl(`/posts/${p.id}?class=bug`), title: p.title ?? p.id, by: p.author ?? null, state: p.state ?? null,
      })), { since, before, resume, cap });
    },
    async event({ since, before, resume, cap }) {
      const postsAtOffice = await lazy("postsAtOffice", "./town-posts.mjs");
      const posts = await allPosts("event", { postsAtOffice, nowMs });
      // where each event is stands in the calendar read, not the posts row; a calendar that cannot be read leaves the places out (no distance), said by the row having none
      const calendarAtOffice = await lazy("calendarAtOffice", "./events-store.mjs");
      const places = new Map();
      try {
        const cal = await calendarAtOffice({}, { now: nowMs });
        for (const e of [...(cal?.now ?? []), ...(cal?.coming ?? []), ...(cal?.ended ?? [])]) places.set(e.id, e);
      } catch { /* no places: near ranks these rows last */ }
      return bound(posts.map((p) => {
        const e = places.get(p.id);
        const pl = e?.place;
        return { id: p.id, kind: "event", ...postAt(p), href: apiUrl(`/calendar/${p.id}`), title: p.title ?? p.id, by: p.author ?? null, state: p.state ?? null,
          ...(e?.starts ? { starts: e.starts } : {}),
          ...(pl && Number.isFinite(Number(pl.x)) && pl.x !== null && pl.y !== null ? { place: { x: Number(pl.x), y: Number(pl.y), ...(pl.mark ? { mark: pl.mark } : {}) } } : {}) };
      }), { since, before, resume, cap });
    },
    async mark({ since, before, resume, cap }) {
      const claimRowsDecidedSince = await lazy("claimRowsDecidedSince", "./world2-claims.mjs");
      const decided = await claimRowsDecidedSince(since ?? "1970-01-01T00:00:00.000Z", resume?.at ? { until: resume.at, afterSlug: resume.afterId, exclusive: resume.exclusive } : {});   // from the cursor's own position: the store's newest 500 are counted from THERE
      const publishedMarksTownwide = await lazy("publishedMarksTownwide", "./town-marks.mjs");
      let published = new Map();
      try { published = new Map(publishedMarksTownwide().map((m) => [m.id, m])); } catch { /* no backing or place: the rows say neither */ }
      const rows = decided.map((c) => {
        const m = published.get(c.slug);
        const at = m?.at;
        return {
          id: c.slug, kind: "mark", ...instantOf(c.decided_at), href: apiUrl(`/marks/${c.slug}`),
          title: `${c.slug}: ${c.status === "locked" ? "decided, it stands" : "decided, refused"}`, state: c.status, ...(m?.by ? { by: m.by } : {}),
          ...(Number.isFinite(Number(m?.stamps)) ? { backed: Number(m.stamps) } : {}),
          ...(at && Number.isFinite(Number(at.x)) && Number.isFinite(Number(at.y)) ? { place: { x: Number(at.x), y: Number(at.y) } } : {}),
        };
      });
      const r = bound(rows, { since, before, resume, cap });
      return { rows: r.rows, cut: r.cut || decided.length >= 500 };   // the store's own read stops at 500
    },
    async arrival({ since, before, resume, cap }) {
      const roster = await ix.roster();
      return bound(roster.filter((e) => e.joined && !e.is_office).map((e) => ({
        id: e.handle, kind: "arrival", ...instantOf(e.joined), href: apiUrl(`/residents/${e.handle}`), title: `${e.display ?? e.handle} arrived`, by: e.handle,
      })), { since, before, resume, cap });
    },
    // the near origin: where the house's residents stand on the walkers roll (house-bundle.mjs § standsOf), their centre; none placed, none guessed
    async origin(household) {
      const hb = await import("./house-bundle.mjs");
      const house = await hb.houseMembers({ household, clone });
      if (house.refused) return { unavailable: `no house "${household}" is known here (${house.refused[1]}), so near cannot be ranked from it` };
      const ashore = await hb.ashoreVia(ix, house.members);
      const stands = await hb.standsOf(ashore, readers.walkers ? { walkers: readers.walkers } : {});
      const placed = ashore.map((h) => stands.byHandle?.[h]).filter((s) => s && Number.isFinite(s.x) && Number.isFinite(s.y));
      if (!placed.length) return { unavailable: stands.unavailable ?? `the walkers roll places none of ${house.slug}'s residents, so near cannot be ranked from it: unknown, not at the origin` };
      const x = placed.reduce((n, s) => n + s.x, 0) / placed.length;
      const y = placed.reduce((n, s) => n + s.y, 0) / placed.length;
      return { x, y, from: `the centre of where ${placed.length} of ${house.slug}'s ${ashore.length} resident${ashore.length === 1 ? "" : "s"} stand (the walkers roll)` };
    },
    asOf: () => ix.asOf(),
  };
  return sources;
}
