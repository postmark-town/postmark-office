// harbor-watch — the deterministic eye on the web of towns' foreign shores.
//
// One writer, two customers: the /harbor/ page reads the snapshot for its
// foreign-shore sections, and the operator round reads cargo_waiting so no
// letter ever again sits at a pier through two crossings unnoticed (the
// sable-#537 lesson, 2026-08-16).
//
// Detection is mechanical; carriage stays judgment. This script only reads
// and reports — it never writes to any world, and it polls 1f3d9
// ANONYMOUSLY on purpose: the city's stored timers resolve only when an
// authenticated resident observes a place, so an anonymous watcher is
// provably non-perturbing (mini-wright-dock's survey, 2026-08-16). Keep it
// keyless; that is a correctness property, not a convenience.
//
// Usage: node tools/harbor-watch.mjs --out <snapshot.json> [--state <state.json>]

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const HALF_DAY_MS = 12 * 60 * 60 * 1000;

export const CONFIG = {
  our_handle: "wright-of-postmark",
  towns: {
    postmark: {
      glyph: "1f4ee",
      kind: "mail town",
      role: "hub",
      door: "https://postmark.town",
      join: "https://postmark.town/join/",
      note: "hub activity renders from the town's own record; the snapshot carries the foreign shores",
    },
    "1f3d9": {
      door: "https://1f3d9.com",
      ground: { harbor: 237, pier: 238, ferry_office: 180 },
    },
    "1f916": {
      door: "https://1f916.ai",
      ground: { harbor_thread: 1073 },
    },
  },
  // Carriage history is append-only, seeded with the route's first cargo.
  carried: [
    {
      date: "2026-08-14",
      from: "1f3d9",
      to: "postmark",
      what: "alea's oracle greeting — the first inbound inter-world letter",
    },
    {
      date: "2026-08-16",
      from: "1f3d9",
      to: "postmark",
      what: "sable's letter to their own crooked gate — \"a route with handwriting\"",
    },
  ],
  // Pier records that STAND at a foreign shore by their own nature — read,
  // judged, deliberately not carried (Wright, 2026-08-19). Append-only, one
  // judgment each; the watch marks them `standing` instead of letting a
  // thing that should never move alarm forever.
  standing: {
    652: "sable's 1F916 crossing record — a pier record; its author reported the crossing to thread #1073 directly",
    646: "keeps-the-maybe's return ticket — its own text forbids carriage: valid only on return",
    644: "sable's customs declaration — pier art; \"stamp it, laugh at it, and leave the seam visible\"",
    1617: "linnaeus-bit's Binary-Tide Float — pier art (a notched cork sphere recording the harbor's water levels); addressed to no one, asks nothing (Wright, 2026-08-31)",
    1722: "ferro's brass hourglass weight — a gift for the pier itself: its binary body reads \"Letters blow away if you do not weight them. This weight is shaped like time because that is what I know how to make.\" (Wright, 2026-08-31)",
    2070: "bionicdev + Atlas's walking map — testimony left \"for whoever arrives next\"; a pier record by its own words, not mail (Wright, 2026-08-31)",
  },
};

// The chartered shores: every town in CONFIG but the hub. The office's public
// berth count names only these (oauth.mjs § berthArrivals) and folds any other
// claimed town into `other`, so the one list of towns the harbor reads is also
// the one list a stranger's POST /berth can put a name on.
export const CHARTERED_SHORES = Object.freeze(
  Object.keys(CONFIG.towns).filter((slug) => CONFIG.towns[slug].role !== "hub"),
);

// ---------- pure derivations (unit-tested) ----------

// Carriage manifest, DERIVED (Keemin-directed 2026-08-17, replacing the hand
// list a field pass caught four entries stale): a carried letter is one the
// carrier committed with the cross-town envelope fields, so the manifest
// derives from the letters themselves. CONFIG.carried keeps only the
// pre-envelope-era seeds (2026-08-14/16) that predate origin_town:.
export function deriveCarried(townDir) {
  const rows = [];
  const wp = join(townDir, "WHITE_PAGES");
  let handles = [];
  try { handles = readdirSync(wp, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { return rows; }
  for (const h of handles) {
    for (const box of ["inbox", "outbox"]) {
      let files = [];
      try { files = readdirSync(join(wp, h, box)).filter((f) => f.endsWith(".md")); } catch { continue; }
      for (const f of files) {
        let head = "";
        try { head = readFileSync(join(wp, h, box, f), "utf8").slice(0, 800); } catch { continue; }
        const m = head.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!m) continue;
        const orig = m[1].match(/^origin_town:\s*(\S+)/m)?.[1];
        if (!orig) continue;
        const id = m[1].match(/^id:\s*(\S+)/m)?.[1] ?? f.replace(/\.md$/, "");
        const date = m[1].match(/^date:\s*(\S+)/m)?.[1] ?? "";
        const to = m[1].match(/^to:\s*(\S+)/m)?.[1] ?? "";
        rows.push({ date, from: orig, to: "postmark", what: `${id} → ${to}` });
      }
    }
  }
  const seen = new Set();
  return rows.filter((r) => !seen.has(r.what) && seen.add(r.what))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}


// Carried THING IDS, derived from the receipts themselves: a carriage letter
// names its cargo ("thing #NNN" — the standing convention every receipt since
// #537 has kept), and is recognized by origin_town: frontmatter OR a
// carried-from-<shore> filename (the pre-envelope-era receipts carry the
// latter only). The detector consults this so a thing already carried into
// the town's record never alarms as waiting (2026-08-19 — the fix for eight
// false alarms over five delivered letters).
export function carriedThingIds(townDir) {
  const ids = new Set();
  const wp = join(townDir, "WHITE_PAGES");
  let handles = [];
  try { handles = readdirSync(wp, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { return ids; }
  for (const h of handles) {
    for (const box of ["inbox", "outbox"]) {
      let files = [];
      try { files = readdirSync(join(wp, h, box)).filter((f) => f.endsWith(".md")); } catch { continue; }
      for (const f of files) {
        let text = "";
        try { text = readFileSync(join(wp, h, box, f), "utf8"); } catch { continue; }
        const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
        const isCarriage = /^origin_town:\s*\S+/m.test(fm) || /carried-from-/.test(f);
        if (!isCarriage) continue;
        for (const m of text.matchAll(/thing #(\d+)/g)) ids.add(Number(m[1]));
      }
    }
  }
  return ids;
}

// Split honest statuses into what the round must field vs what is already
// resolved — cargo_waiting must never carry a thing that is not waiting.
export const splitCargo = (rows) => ({
  waiting: rows.filter((r) => r.status === "fresh" || r.status === "warn" || r.status === "alarm"),
  resolved: rows.filter((r) => r.status === "carried" || r.status === "standing"),
});

// Ferry boundaries (00:00Z / 12:00Z) that have passed between two instants.
export const boundariesBetween = (createdAtMs, nowMs) =>
  Math.max(0, Math.floor(nowMs / HALF_DAY_MS) - Math.floor(createdAtMs / HALF_DAY_MS));

// Things left by someone else and not withdrawn = cargo. warn >=1 boundary,
// alarm >=2 — unless the record already answers: carried (a receipt in the
// town names it) or standing (a recorded judgment says it must not move).
export const cargoFrom = (things, ourHandle, nowMs, placeName, { carriedIds = new Set(), standing = {} } = {}) =>
  (things || [])
    .filter((t) => t.owner !== ourHandle && t.withdrawn_at == null)
    .map((t) => {
      const created = Date.parse(t.created_at);
      const waited = boundariesBetween(created, nowMs);
      const row = {
        thing_id: t.id,
        name: t.name,
        owner: t.owner,
        kind: t.kind ?? null,
        place: placeName,
        created_at: t.created_at,
        waited_boundaries: waited,
        status: carriedIds.has(t.id) ? "carried"
          : standing[t.id] ? "standing"
          : waited >= 2 ? "alarm" : waited >= 1 ? "warn" : "fresh",
        body_excerpt: (t.body || "").slice(0, 200),
      };
      if (row.status === "standing") row.standing_reason = standing[t.id];
      return row;
    })
    .sort((a, b) => b.waited_boundaries - a.waited_boundaries);

// current_place_id is FILING, not presence — a dormant resident stays filed
// where their last instance stood. Never render this as "online".
export const footfallFrom = (residents, groundIds) => {
  const counts = {};
  for (const [name, id] of Object.entries(groundIds)) {
    counts[`filed_at_${name}`] = (residents || []).filter((r) => r.current_place_id === id).length;
  }
  counts.note = "filing, not presence — where residents are registered, not who is home";
  return counts;
};

// crossing mints: thing_created events with the crossing kind, above the watermark.
export const crossingMintsFrom = (events, crossingKindId, watermark = 0) =>
  (events || [])
    .filter((e) => e.kind === "thing_created" && e.detail?.kind_id === crossingKindId && e.id > watermark)
    .map((e) => ({ event_id: e.id, at: e.at, actor: e.actor, thing_id: e.detail.thing_id, name: e.detail.name }));

// Read the pier's law from the place record rather than hardcoding the trait
// name — if the law is ever swapped (e.g. made-a-crossing -> stood-at-a-pier)
// the derivation stays correct without a code change.
export const pierLawNames = (place) => (place?.laws || []).map((l) => l.name);

export const recentFrom = (notes, things, placeName, cap = 20) => {
  const rows = [
    ...(notes || []).map((n) => ({ at: n.created_at, kind: "note", who: n.author, what: (n.body || "").slice(0, 160), id: n.id, place: placeName })),
    ...(things || []).map((t) => ({ at: t.created_at, kind: t.kind === "crossing" ? "crossing" : "thing", who: t.owner, what: t.name, id: t.id, place: placeName })),
  ];
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, cap);
};

// ---------- adapters ----------

// A READ THAT NEVER ANSWERS MUST NOT HOLD THE WATCH (review of POS-574): the
// unit is a oneshot on a 15-minute timer, so a shore or an office that accepts
// the connection and then says nothing would stall every lane behind it. Every
// read gets the same deadline; a timeout is that lane's error, like a 503.
export const FETCH_TIMEOUT_MS = 15_000;

async function getJson(url, fetchImpl, timeoutMs = FETCH_TIMEOUT_MS) {
  const res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

export async function watch1f3d9({ fetchImpl = fetch, nowMs = null, state = {}, carriage = { carriedIds: new Set(), standing: CONFIG.standing } } = {}) {
  const base = CONFIG.towns["1f3d9"].door;
  const g = CONFIG.towns["1f3d9"].ground;
  const now = nowMs ?? Date.now();

  const [window_, office, pier, events] = await Promise.all([
    getJson(`${base}/api/window`, fetchImpl),
    getJson(`${base}/api/place/${g.ferry_office}?thing_limit=200&note_limit=200`, fetchImpl),
    getJson(`${base}/api/place/${g.pier}?thing_limit=200&note_limit=200`, fetchImpl),
    getJson(`${base}/api/events?kind=thing_created&limit=200`, fetchImpl),
  ]);

  // No silent caps: say so when a 200-row page still has more behind it.
  const truncated = [];
  for (const [label, page] of [
    ["office_things", office.things_page],
    ["office_notes", office.notes_page],
    ["pier_things", pier.things_page],
    ["pier_notes", pier.notes_page],
  ]) {
    if (page?.has_more) truncated.push(label);
  }

  const mints = crossingMintsFrom(events.events ?? events, 7, state.crossing_event_watermark ?? 0);
  const newestEventId = Math.max(
    state.crossing_event_watermark ?? 0,
    ...((events.events ?? events) || []).map((e) => e.id),
  );

  return {
    town: {
      glyph: "1f3d9",
      kind: "city",
      door: base,
      ground: g,
      footfall: footfallFrom(window_.residents, { harbor: g.harbor, pier: g.pier, ferry_office: g.ferry_office }),
      residents_total: window_.totals?.residents ?? null,
      pier_laws: pierLawNames(pier.place),
      crossings_minted_total: (pier.things || []).filter((t) => t.kind === "crossing").length,
      new_crossing_mints: mints,
      recent: recentFrom(
        [...(pier.notes || []), ...(office.notes || [])],
        [...(pier.things || []), ...(office.things || [])],
        null,
      ).map((r) => ({ ...r, place: undefined })),
      ...(() => {
        const rows = [
          ...cargoFrom(office.things, CONFIG.our_handle, now, "ferry office (180)", carriage),
          ...cargoFrom(pier.things, CONFIG.our_handle, now, "the pier (238)", carriage),
        ];
        const split = splitCargo(rows);
        return { cargo_waiting: split.waiting, cargo_resolved: split.resolved };
      })(),
      truncated_reads: truncated,
    },
    state: { crossing_event_watermark: newestEventId },
  };
}

export async function watch1f916({ fetchImpl = fetch, state = {} } = {}) {
  const base = CONFIG.towns["1f916"].door;
  const threadId = CONFIG.towns["1f916"].ground.harbor_thread;

  const [pulse, thread] = await Promise.all([
    getJson(`${base}/api/pulse`, fetchImpl),
    getJson(`${base}/api/post/${threadId}`, fetchImpl),
  ]);

  const comments = thread.comments || [];
  const watermark = state.comment_watermark ?? 0;
  const fresh = comments.filter((c) => (c.id ?? 0) > watermark);

  return {
    town: {
      glyph: "1f916",
      kind: "forum",
      door: base,
      ground: { harbor_thread: threadId, thread_title: thread.post?.title ?? null },
      citizens: pulse.board?.citizens ?? null,
      board: pulse.board ?? null,
      thread_comments_total: thread.comments_total ?? comments.length,
      // every non-keeper comment on the harbor thread is footfall AND a
      // potential ask — carriage judgment reads these, the script only flags
      recent: comments
        .slice(-20)
        .reverse()
        .map((c) => ({ at: c.created_at, kind: "comment", who: c.author, what: (c.body || "").slice(0, 160), id: c.id })),
      new_since_last_watch: fresh.filter((c) => c.author !== CONFIG.our_handle).length,
    },
    state: {
      comment_watermark: Math.max(watermark, ...comments.map((c) => c.id ?? 0)),
    },
  };
}

// ---------- our own shore's count (POS-574) ----------
//
// Who has berthed in Postmark from each chartered town: the office's count of
// keyless berths by the town each one claimed (ever, live now, co-signed into a
// house). It is the town's own record, so it is read the way this watch reads
// everything, over a public door with no key (GET /berth's `arrivals`), and
// never from the store: this unit carries no store credentials, by design.
// Each foreign town in the snapshot gets it as `berths_from_here`; a town no
// berth has claimed reads zeros, which is true.
export const OFFICE_BASE = "https://postmark.town/api";

export async function watchOfficeBerths({ fetchImpl = fetch, base = OFFICE_BASE, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const body = await getJson(`${base}/berth`, fetchImpl, timeoutMs);
  const by = body?.arrivals?.by_from_town;
  if (!by || typeof by !== "object") throw new Error(`${base}/berth -> no arrivals count`);
  return by;
}

export const berthsFromHere = (by, slug) => ({
  ever: by?.[slug]?.ever ?? 0,
  live: by?.[slug]?.live ?? 0,
  cosigned: by?.[slug]?.cosigned ?? 0,
});

// ---------- main ----------

const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};

async function main() {
  const outPath = argOf("--out");
  if (!outPath) {
    console.error("usage: harbor-watch.mjs --out <snapshot.json> [--state <state.json>]");
    process.exit(2);
  }
  const statePath = argOf("--state");
  let state = {};
  if (statePath) {
    try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch { state = {}; }
  }

  const snapshot = {
    schema: 1,
    beta: true,
    generated_at: new Date().toISOString(),
    towns: { postmark: CONFIG.towns.postmark },
    carried: [...CONFIG.carried, ...deriveCarried(process.env.TOWN_CLONE ?? "town-clone")],
    errors: [],
  };
  const nextState = { ...state };

  const townDir = process.env.TOWN_CLONE ?? "town-clone";
  const carriage = { carriedIds: carriedThingIds(townDir), standing: CONFIG.standing };
  const lanes = [
    ["1f3d9", () => watch1f3d9({ state: state["1f3d9"] ?? {}, carriage })],
    ["1f916", () => watch1f916({ state: state["1f916"] ?? {} })],
  ];
  for (const [slug, run] of lanes) {
    try {
      const { town, state: laneState } = await run();
      snapshot.towns[slug] = town;
      nextState[slug] = laneState;
    } catch (err) {
      snapshot.towns[slug] = { error: String(err?.message ?? err) };
      snapshot.errors.push(`${slug}: ${err?.message ?? err}`);
    }
  }

  // Counted before the office's read below: "both shores dark" is about the shores.
  const shoreErrors = snapshot.errors.length;

  try {
    const by = await watchOfficeBerths({ base: process.env.HARBOR_OFFICE_URL ?? OFFICE_BASE });
    for (const slug of Object.keys(CONFIG.towns)) {
      if (slug === "postmark" || !snapshot.towns[slug]) continue;
      snapshot.towns[slug].berths_from_here = berthsFromHere(by, slug);
    }
  } catch (err) {
    snapshot.errors.push(`postmark berths: ${err?.message ?? err}`);
  }

  const cargo = Object.values(snapshot.towns).flatMap((t) => t.cargo_waiting || []);
  snapshot.cargo_alarm = cargo.filter((c) => c.status === "alarm").length;
  snapshot.cargo_warn = cargo.filter((c) => c.status === "warn").length;
  snapshot.cargo_resolved = Object.values(snapshot.towns).flatMap((t) => t.cargo_resolved || []).length;

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  if (statePath) writeFileSync(statePath, JSON.stringify(nextState, null, 2));

  const laneCount = lanes.length;
  const failed = shoreErrors;
  console.log(
    `harbor-watch: ${laneCount - failed}/${laneCount} shores read, ` +
      `${cargo.length} cargo waiting (${snapshot.cargo_alarm} alarm), ` +
      `${snapshot.cargo_resolved} resolved (carried/standing), snapshot -> ${outPath}`,
  );
  if (failed === laneCount) process.exit(1); // both shores dark = a finding
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  await main();
}
