// household-stakes.mjs — EVERYTHING THE HOUSE HAS STAMPS BEHIND, from the ledger (POS-1100).
//
// Darko, 2026-11-16 22:30 EST (POS-844 call 7): "I think the idea is right that we should have a household list of
// everything the house has stamps behind, but we do need to keep in mind that aggregates will likely be necessary, and
// we should use the same kind of just leave an aggregate and account type of logic. … we shouldn't allow households to
// bloat their own household apex read beyond readability just by staking on lots of different things, keeping in mind
// that some households have like 2K plus stamps at this point."
//
// WHAT IT IS. One fold over the stamp ledger, by (family, target, handle): a stake is a position, and a position is
// what the ledger's own stake lines minus its own ways out leave open. Four families stand in the grammar:
//
//   mark    stake:world-mark/<id>        world-stake − world-unstake      (a mark's class makes it an idea or a bounty)
//   post    stake:post/<author>/<slug>   post-stake − post-unstake − post-return   (an idea post today)
//   pot     stake:pot/<pot>              pot-stake − pot-return − pot-unstake − keeping-burn
//   ballot  stake:<topic>/<candidate>    stake − return (the close)
//
// ── THE MONEY IS THE LEDGER'S, AND THIS FILE PROVES IT EVERY TIME ──────────────────────────────────────────────
//
// The house's staked total is `foldStaked` over the same entries, summed across the house's handles (the stamps
// tense `staked`: stamp-mint.mjs § foldStaked). This fold walks the same lines by the same rules, one position at a
// time, so its rows add up to that number by construction. They are also CHECKED against it on every read: a fold
// whose total differs from `foldStaked`'s is not returned as numbers. It is returned as `unavailable`, naming both
// totals, because a money read that cannot agree with the ledger says so and never approximates.
//
// ── WHERE EACH PLACE READS IT ────────────────────────────────────────────────────────────────────────────────────
//
//   household { read: "stakes" }   the list (`allocation`), paged: limit (default 20), offset, next_offset, more_note
//   the v2 glance, stamps.stakes   the AGGREGATE only (`aggregateOf`): the total, the count, a count per kind, what is
//                                  at risk. Its size is flat however many things a house stakes on.
//   the doorstep's stakes item     the same aggregate, beside the marks it already lists
//   the Hearth's `went` rows       household-read-v2.mjs § wentKind: a stake on a post is an idea's
//
// NOTHING HERE WRITES, and nothing here guesses a kind: a mark whose class cannot be read is `mark`, a post whose
// class cannot be read is `post`, and the answer says so in `kind_note`.

import { statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { importTownTool } from "./town-tool.mjs";
import { ledgerEntriesOf } from "./post-stake-engine.mjs";
import { wholeNumber } from "./whole-number.mjs";
import { PAGE_BYTES, textBytes } from "./household-read-page.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOWN_CLONE = () => process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");

/** The kinds a row is, in the order the glance counts them. `post` is a post whose class could not be read. */
export const STAKE_KINDS = Object.freeze(["idea", "bounty", "mark", "pot", "ballot", "post"]);

/** The page: the ruled paging pattern (POS-844 22:58; src/page-rows.mjs of POS-732 when it lands, which this matches). */
export const PAGE_DEFAULT = 20;
export const PAGE_MAX = 200;

/**
 * Every open position in the ledger, as `Map<`${family}|${target}|${handle}`, { family, target, handle, n, side }>`,
 * walking the entries by foldStaked's own rules (a position that nets to zero is not one).
 */
export function openPositions(M, entries) {
  const pos = new Map();
  const move = (family, target, handle, delta, side = null) => {
    const k = `${family}|${target}|${handle}`;
    const open = pos.get(k) ?? { family, target, handle, n: 0, side: null };
    pos.set(k, { ...open, n: open.n + delta, side: side ?? open.side });
  };
  for (const e of entries) {
    const c = M.classifyEntry(e.canonical);
    switch (c.kind) {
      case "stake": move("ballot", `${c.topic}/${c.candidate}`, c.handle, c.n); break;
      case "return": move("ballot", `${c.topic}/${c.candidate}`, c.handle, -c.n); break;
      case "world-stake": move("mark", c.mark, c.handle, c.n); break;
      case "world-unstake": move("mark", c.mark, c.handle, -c.n); break;
      case "pot-stake": move("pot", c.pot, c.handle, c.n); break;
      case "pot-return": case "pot-unstake": case "keeping-burn": move("pot", c.pot, c.handle, -c.n); break;
      case "post-stake": move("post", c.post, c.handle, c.n, c.side); break;
      case "post-unstake": case "post-return": move("post", c.post, c.handle, -c.n); break;
      default: break;
    }
  }
  for (const [k, v] of pos) if (v.n === 0) pos.delete(k);
  return pos;
}

/** The fold, once per ledger state (its file's mtime and size), for every house that asks. */
let cache = null;
export async function ledgerPositions(townClone = TOWN_CLONE()) {
  const ledger = join(townClone, "WHITE_PAGES", "stamp-ledger.md");
  let stamp = "absent";
  try { const st = statSync(ledger); stamp = `${st.mtimeMs}:${st.size}`; } catch { /* an absent ledger reads as empty */ }
  const key = `${townClone}|${stamp}`;
  if (cache?.key === key) return cache.value;
  const M = await importTownTool(townClone, "stamp-mint.mjs");
  const entries = ledgerEntriesOf(M, townClone);
  const value = { positions: openPositions(M, entries), staked: M.foldStaked(entries) };
  cache = { key, value };
  return value;
}

/** A mark's class, from the world record: `idea`, `bounty`, or null (a plain mark, or unread). Synchronous, one store open. */
async function defaultMarkClass(id) {
  const { markClass } = await import("./world-classes.mjs");
  const seen = markClass(id);
  return seen.known && seen.found ? (seen.class ?? null) : undefined;   // undefined = unread, null = a mark with no class
}

/** A post's class, from the office's posts table, for a set of ids: `Map<id, class>`. A store that cannot be read throws. */
async function defaultPostClasses(ids) {
  if (!ids.length) return new Map();
  const { officeRead } = await import("./world2-pen.mjs");
  const rows = await officeRead(async (client) => (await client.query("SELECT id, class FROM posts WHERE id = ANY($1)", [ids])).rows, { by: "houseStakes" });
  return new Map(rows.map((r) => [String(r.id), String(r.class)]));
}

const authorOf = (id) => String(id).split("/")[0];

/**
 * THE HOUSE'S STAKES: every row the handles stand behind, with the totals, or `{ unavailable }`.
 *
 * `handles`   the house's residents (the scope every other stakes read takes: who the key holds, ashore)
 * `atRisk`    a Set of mark ids the next settlement would take (the stakes read's own at-risk rows); null = not measured
 * Readers (each replaceable by a suite): `townClone`, `markClass(id)`, `postClasses(ids)`, `fold(townClone)` (the ledger's positions).
 *
 * A row: `{ kind, id, stamps, at_risk, own?, side?, by: [{ handle, stamps }] }`. `stamps` is the HOUSE's, never the
 * thing's whole escrow. `at_risk` is the sweep's verdict for a mark (true / false), false for anything the sweep
 * never takes (a post, a pot, a ballot), and null for a mark when no verdict was measured.
 */
export async function houseStakes(handles, { townClone = TOWN_CLONE(), atRisk = null, markClass = defaultMarkClass, postClasses = defaultPostClasses, fold = ledgerPositions } = {}) {
  const scope = [...new Set((handles ?? []).filter(Boolean))];
  let folded;
  try { folded = await fold(townClone); }
  catch {
    return { unavailable: "the stamp ledger could not be read, so what your house has stamps behind is unknown here, not nothing" };
  }
  const mine = new Set(scope);
  const grouped = new Map();   // `${family}|${target}` -> { family, target, by: [], side }
  for (const p of folded.positions.values()) {
    if (!mine.has(p.handle)) continue;
    const k = `${p.family}|${p.target}`;
    const g = grouped.get(k) ?? { family: p.family, target: p.target, by: [], side: null };
    g.by.push({ handle: p.handle, stamps: p.n });
    if (p.side === "against") g.side = "against";
    grouped.set(k, g);
  }

  // The kinds. A mark's class and a post's class are the world's and the office's to say; an unread one is `mark` / `post`, said.
  let kindNote = null;
  const postIds = [...grouped.values()].filter((g) => g.family === "post").map((g) => g.target);
  let postClassOf = new Map();
  if (postIds.length) {
    try { postClassOf = await postClasses(postIds); }
    catch { kindNote = "the posts' classes could not be read, so a stake behind a post is shown as kind: post here, not as its class"; }
  }
  const rows = [];
  for (const g of grouped.values()) {
    g.by.sort((a, b) => b.stamps - a.stamps || a.handle.localeCompare(b.handle));
    const stamps = g.by.reduce((n, b) => n + b.stamps, 0);
    let kind;
    if (g.family === "mark") {
      let cls;
      try { cls = await markClass(g.target); } catch { cls = undefined; }
      if (cls === undefined) kindNote ??= "a mark's class could not be read from the world record, so it is shown as kind: mark here, not as an idea or a bounty";
      kind = cls === "idea" || cls === "bounty" ? cls : "mark";
    } else if (g.family === "post") {
      const cls = postClassOf.get(g.target);
      kind = cls === "idea" || cls === "bounty" ? cls : "post";
    } else kind = g.family;   // pot, ballot
    const own = (g.family === "mark" || g.family === "post") && mine.has(authorOf(g.target));
    rows.push({
      kind, id: g.target, stamps,
      at_risk: g.family === "mark" ? (atRisk instanceof Set ? atRisk.has(g.target) : null) : false,
      ...(own ? { own: true } : {}),
      ...(g.side ? { side: g.side } : {}),
      by: g.by,
    });
  }
  // at risk first, then the biggest, then the id: the one order a reader acts on
  rows.sort((a, b) => (Number(b.at_risk === true) - Number(a.at_risk === true)) || b.stamps - a.stamps || a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind));

  const total = rows.reduce((n, r) => n + r.stamps, 0);
  const ledgerStaked = scope.reduce((n, h) => n + (folded.staked.get(h) ?? 0), 0);
  if (total !== ledgerStaked)
    return { unavailable: `the stakes read ${total} stamps behind this house and the ledger's own fold says ${ledgerStaked}; the two must agree, so no number is shown (report this)`, ledger_staked: ledgerStaked };
  return { total, ledger_staked: ledgerStaked, count: rows.length, rows, ...(kindNote ? { kind_note: kindNote } : {}) };
}

/** The aggregate, and only the aggregate: what the v2 glance and the doorstep carry. Flat in size however many rows there are. */
export function aggregateOf(stakes) {
  if (!stakes || stakes.unavailable) return { unavailable: stakes?.unavailable ?? "what your house has stamps behind could not be read" };
  const by_kind = {};
  for (const k of STAKE_KINDS) { const n = stakes.rows.filter((r) => r.kind === k).length; if (n) by_kind[k] = n; }
  const risky = stakes.rows.filter((r) => r.at_risk === true);
  return {
    at_risk: risky.length,
    total: stakes.total, count: stakes.count, by_kind,
    ...(stakes.kind_note ? { kind_note: stakes.kind_note } : {}),
  };
}

/**
 * The list read, paged as every list read is: `limit` (default 20, held under the 10K ceiling), `offset`, and
 * `next_offset` with `more_note` while there is more. The aggregate rides with the page.
 */
export function pageStakes(stakes, asked = {}, { around = {} } = {}) {
  if (!stakes || stakes.unavailable) return { ...around, unavailable: stakes?.unavailable ?? "what your house has stamps behind could not be read" };
  const all = stakes.rows;
  const n = Math.min(Math.max(wholeNumber(asked.limit) || PAGE_DEFAULT, 1), PAGE_MAX);
  const start = Math.max(wholeNumber(asked.offset) || 0, 0);
  let said = n;
  const stampsByKind = {};
  for (const r of all) stampsByKind[r.kind] = (stampsByKind[r.kind] ?? 0) + r.stamps;
  const head = { ...around, ...aggregateOf(stakes), ledger_staked: stakes.ledger_staked, stamps_by_kind: stampsByKind };
  const answer = (page) => {
    const next = start + page.length;
    const complete = next >= all.length;
    const left = all.length - next;
    return {
      ...head, shown: page.length, limit: said, offset: start, complete,
      ...(complete ? {} : { next_offset: next, more_note: `${left} further stake${left === 1 ? "" : "s"} — call again with offset: ${next}` }),
      rows: page,
    };
  };
  let page = all.slice(start, start + n);
  while (page.length > 1 && textBytes(answer(page)) > PAGE_BYTES) { page = page.slice(0, -1); said = page.length; }
  return answer(page);
}

/** What each part of a row means, said once beside the list. */
export const STAKES_KEY = "rows: everything your house has stamps behind, at-risk first then biggest · stamps: the house's own, not the thing's whole escrow · kind: idea, bounty, mark (another's or yours), pot, ballot · at_risk: the next settlement would take that mark · own: you wrote it · by: which resident";
