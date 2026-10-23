// parcel-room.mjs — PARCELS FROM 11-01: THE FACTS THE WORLD'S FOLD ASKS FOR (POS-762).
//
// Darko, 2026-10-22 (settled 20:35–20:42 EDT): a household settled by
// 2026-11-01 04:00Z keeps a cap of three parcels, one per resident, for good.
// A household settled after that holds one, and each further parcel costs
// 50 stamps × the parcels it already holds, paid to the town and never
// returned, up to the same cap of three.
//
// THE RULE IS THE WORLD'S, THE FACTS ARE OURS. The world's fold
// (postmark-world tools/marks-fold.mjs § parcels from 11-01) decides a
// household's room from two facts it cannot see itself, handed in as
// `houseFacts`, per household key:
//
//   since    the day the household settled, as the registry wrote it at its
//            mint (households.since, a US-Eastern date string that nothing
//            rewrites; 019 and ceremony.mjs § joinHousehold)
//   bought   how many parcels it bought: its `→ BURN · n · for: parcel:<nth>/
//            <household>` lines on the town's ledger, read by the town's own
//            classifyEntry (postmark tools/stamp-mint.mjs)
//
// Every declared house gets its facts; the fold keeps three for any house
// settled by 10-31. A solo handle has no house row and gets none, so it keeps
// three as well (every solo handle predates November: since 11-01 every join
// mints a house).
//
// ONE DERIVATION, THREE READERS. The settlement's snapshot and the clearing both
// fold through world-snapshot.mjs § foldHouseholds, which calls `houseFactsAt`
// with the register rows and the town checkout they already read, so the facts
// come from the snapshot's own sources and a --verify reads the same ones. The
// leave-mark door's warning (`houseFactsNow`) reads the store's registry and
// stamp_lines, the same record, now.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * A key → the house's canonical `hh:<slug>`, by the registry: a slug the house
 * once carried (`formerly`) and an account id the house holds (`gh:<id>`) are
 * the same house. Any other key is itself. PURE.
 */
export function houseKeyCanon(registry) {
  const byKey = new Map();
  for (const [slug, rec] of Object.entries(registry?.households ?? {})) {
    const key = `hh:${slug}`;
    byKey.set(key, key);
    for (const f of rec?.formerly ?? []) if (f) byKey.set(`hh:${f}`, key);
    for (const a of rec?.accounts ?? []) if (a?.id != null) byKey.set(`gh:${a.id}`, key);
  }
  return (k) => byKey.get(String(k)) ?? String(k);
}

/**
 * The town's parcel purchases among `canonicals` (ledger lines without their
 * signatures), classified by the town's own `classifyEntry`. A checkout too old
 * to know the kind finds none, which is the truth before the first purchase.
 * PURE. → `[{ date, handle, n, nth, household }]`
 */
export function parcelBurnsOf(canonicals, classifyEntry) {
  if (typeof classifyEntry !== "function") return [];
  const out = [];
  for (const c of canonicals ?? []) {
    if (!String(c).includes("for: parcel:")) continue; // narrows only: the town's grammar decides
    const k = classifyEntry(String(c));
    if (k?.kind === "parcel-burn") out.push({ date: k.date, handle: k.handle, n: k.n, nth: k.nth, household: k.household });
  }
  return out;
}

/**
 * `{ "hh:<slug>": { since, bought } }` for every declared house that states a
 * settling day. PURE. `registry` is `{ households: { slug: rec } }`
 * (registry-rows.mjs § registryFromRows); `burns` is parcelBurnsOf's answer.
 */
export function houseFactsOf({ registry, burns = [] }) {
  const canon = houseKeyCanon(registry);
  const bought = new Map();
  for (const b of burns) {
    const k = canon(b.household);
    bought.set(k, (bought.get(k) ?? 0) + 1);
  }
  const facts = {};
  for (const [slug, rec] of Object.entries(registry?.households ?? {})) {
    if (typeof rec?.since !== "string" || !rec.since) continue;
    const key = `hh:${slug}`;
    facts[key] = { since: rec.since.slice(0, 10), bought: bought.get(key) ?? 0 };
  }
  return facts;
}

/** The town's engine at a checkout, or null when it has none. */
async function townEngineAt(townRepo) {
  const p = join(townRepo, "tools", "stamp-mint.mjs");
  if (!existsSync(p)) return null;
  return import(pathToFileURL(p).href);
}

/**
 * The facts at a snapshot's sources: the register rows at the seal (the houses
 * and their days) and the town checkout at the ledger position (the purchases).
 * The same pair `householdsAt` reads, so nothing about today's store moves it.
 */
export async function houseFactsAt(registerRows, townRepo) {
  const { registerOfVersions } = await import("./world-snapshot.mjs");
  const { registry } = await registerOfVersions(registerRows);
  const engine = await townEngineAt(townRepo);
  const ledger = join(townRepo, "WHITE_PAGES", "stamp-ledger.md");
  const entries = engine && existsSync(ledger) ? engine.parseStampLedger(readFileSync(ledger, "utf8")) : [];
  return houseFactsOf({ registry, burns: parcelBurnsOf(entries.map((e) => e.canonical), engine?.classifyEntry) });
}

/**
 * The facts now, from the store: the registry's rows and the stamp_lines rows
 * that could be purchases, classified by the town clone's engine. Null when the
 * store cannot be asked or no town engine is at hand: the door's warning is a
 * courtesy, and it says nothing it cannot read.
 */
export async function houseFactsNow({ env = process.env, townClone = null } = {}) {
  const { loadRegistryRows } = await import("./registry-store.mjs");
  const { registryFromRows } = await import("./registry-rows.mjs");
  const { actsQuery } = await import("./world2-acts.mjs");
  const rows = await loadRegistryRows(env);
  if (rows === null) return null;
  const engine = townClone ? await townEngineAt(townClone).catch(() => null) : null;
  if (!engine) return null;
  const lines = await actsQuery("SELECT canonical FROM stamp_lines WHERE canonical LIKE '% → BURN · % · for: parcel:%' ORDER BY seq", [], env);
  if (lines === null) return null;
  return houseFactsOf({ registry: registryFromRows(rows), burns: parcelBurnsOf(lines.map((r) => r.canonical), engine.classifyEntry) });
}

/**
 * THE WARNING AT THE DOOR (R11: the office accepts every legal act; the
 * settlement applies the limit). A parcel claim that takes its household past
 * its room is written, and the answer says at once, in the fold's own words,
 * that the crossing will oppose it. PURE.
 *
 * `held` is how many parcels the household already holds or has claimed, this
 * one aside. `engine` is the world's fold module; an engine without the room
 * (before the world's law lands) says nothing. → `{ held, room, note }` or null.
 */
export function parcelRoomNoteOf({ kind, amending = false, held, fact, engine }) {
  if (kind !== "parcel" || amending) return null;            // an amend moves a parcel, it adds none
  if (typeof engine?.parcelRoomOf !== "function" || typeof engine?.parcelCapRefusal !== "function") return null;
  const room = engine.parcelRoomOf(fact ?? undefined);
  if (!Number.isInteger(held) || held < room) return null;   // it fits
  return {
    held, room,
    note: `${engine.parcelCapRefusal(held, room)}. Your claim is written, and the next crossing opposes it unless the household has room by then.`,
  };
}
