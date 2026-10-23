// parcel-room.mjs — PARCELS FROM 11-01: THE FACTS THE WORLD'S FOLD ASKS FOR (POS-762).
//
// Darko, 2026-10-22 (ruled 20:35–20:42 EDT, "settled by Halloween's end"): a
// household whose declaration is dated on or before 2026-10-31 (town time; the
// cutoff is 2026-11-01 04:00Z) keeps a cap of three parcels, one per resident,
// for good. The fact is the declaration day, never the day it came ashore. A
// household declared after that holds one, and each further parcel costs
// 50 stamps × the parcels it already holds, paid to the town and never
// returned, up to the same cap of three.
//
// THE RULE IS THE WORLD'S, THE FACTS ARE OURS. The world's fold
// (postmark-world tools/marks-fold.mjs § parcels from 11-01) decides a
// household's room from two facts it cannot see itself, handed in as
// `houseFacts`, per household key:
//
//   since    the household's declaration day, as the registry wrote it at its
//            mint (households.since, a town-time date string that nothing
//            rewrites; 019 and ceremony.mjs § joinHousehold)
//   bought   how many parcels it bought: the highest <nth> of its `→ BURN · n ·
//            for: parcel:<nth>/<household>` lines on the town's ledger, less
//            one, read by the town's own classifyEntry (postmark
//            tools/stamp-mint.mjs)
//
// Every declared house gets its facts; the fold keeps three for any house
// declared by 10-31. A solo handle has no house row and gets none, so it keeps
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
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

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
 * declaration day. PURE. `registry` is `{ households: { slug: rec } }`
 * (registry-rows.mjs § registryFromRows); `burns` is parcelBurnsOf's answer.
 *
 * `bought` IS THE HIGHEST PARCEL BOUGHT, LESS ONE, never a count of lines
 * (Wright's review): a purchase names the parcel it makes room for (2 or 3), so
 * a house that bought its 3rd has bought two, and a duplicate or stray line can
 * never raise the room past what the highest purchase says.
 */
export const PARCEL_NTHS = Object.freeze([2, 3]);
export function houseFactsOf({ registry, burns = [] }) {
  const canon = houseKeyCanon(registry);
  const bought = new Map();
  for (const b of burns) {
    if (!PARCEL_NTHS.includes(b.nth)) continue;
    const k = canon(b.household);
    bought.set(k, Math.max(bought.get(k) ?? 0, b.nth - 1));
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
export function parcelRoomNoteOf({ kind, amending = false, held, fact, engine, by = null }) {
  if (kind !== "parcel" || amending) return null;            // an amend moves a parcel, it adds none
  if (typeof engine?.parcelRoomOf !== "function" || typeof engine?.parcelCapRefusal !== "function") return null;
  const room = engine.parcelRoomOf(fact ?? undefined);
  if (!Number.isInteger(held) || held < room) return null;   // it fits
  // Room below the cap can be bought ahead (POS-762/e): the call, quoted first.
  const cap = Number.isInteger(engine.PARCEL_CLAIM_CAP) ? engine.PARCEL_CLAIM_CAP : 3;
  return {
    held, room,
    note: `${engine.parcelCapRefusal(held, room)}. Your claim is written, and the next crossing opposes it unless the household has room by then.`,
    ...(room < cap && by ? { buy_room: { do: BUY_ROOM_ACT, args: { from: by, preview: true } } } : {}),
  };
}

// ── BUYING ROOM AHEAD (Darko, 2026-10-23 09:51 EDT; POS-762/e and /f) ────────
//
//   /e "Buy room ahead": "a household act burns the stamps and adds one parcel
//      of room for good; a claim then costs nothing, so a claim opposed for
//      overlap never loses stamps; the quote shows price, room and cutoff"
//   /f "Room bought": "50 x room already bought: room 1->2 costs 50, 2->3 costs
//      100, whatever is held; simpler, never cheaper by withdrawing a parcel
//      first"
//
// The act is `household { do: "buy-parcel-room", args: { from } }`. It writes
// one line, the town's own, by the town's own builder and signer
// (parcel-room-exec.mjs): `<from> → BURN · <price> · for: parcel:<nth>/hh:<slug>`.
// The town's verifier holds the same terms the quote below checks first.
export const BUY_ROOM_ACT = "buy-parcel-room";

/**
 * The town's household key for `handle` at `date`, as the town's verifier
 * reads it (stamp-verify § hh): the ledger's own `registry:` lines first, then
 * the checkout's pins (householdKeys), else the handle alone.
 */
export function townKeyAt(engine, clone, entries, handle, date) {
  let key = null;
  for (const r of engine.parseLaws(entries).revisions) if (r.handle === handle && r.date <= date) key = r.key;
  return key ?? engine.householdKeys(clone).get(handle)?.key ?? `solo:${handle}`;
}

const refuse = (code, defect, hint) => ({ error: { code, defect, hint } });
const ordinal = (n) => ({ 2: "second", 3: "third" })[n] ?? `${n}th`;

/**
 * THE QUOTE: what buying one more parcel of room would cost `handle`'s
 * household today, or the refusal, in plain words that name the price and the
 * cutoff. PURE over its inputs: `engine` is the town's stamp-mint module,
 * `registry` its tools/households.json, `entries` its parsed ledger, `townKey`
 * townKeyAt's answer. The act and its preview both ask this, so they cannot
 * disagree. → `{ quote }` or `{ error }`.
 */
export function parcelRoomQuote({ handle, date, registry, entries, engine, townKey }) {
  const { PARCEL_PRICE: price1, PARCEL_SETTLED_BY_DAY: lastDay, PARCEL_ROOM_FROM: firstDay } = engine ?? {};
  if (typeof engine?.parcelBurnLine !== "function" || !price1 || !lastDay || !firstDay)
    return refuse(409, "not-yet-open", "the town's ledger does not know a parcel purchase yet, so no room can be bought");
  const cutoff = `households declared on or before ${lastDay} (town time) keep room for three parcels, one per resident; a household declared later holds one and buys room ahead`;
  if (engine.meepChecker(engine.parseLaws(entries).laws)(handle, date))
    return refuse(403, `meep accounts cannot buy room (${handle})`, "meeps stay outside the currency: a housemate who is not a meep can buy it");
  const houses = registry?.households ?? {};
  const slug = Object.keys(houses).find((s) => (houses[s]?.residents ?? []).includes(handle)) ?? null;
  if (!slug) return refuse(409, `${handle} is in no declared household`, `parcel room belongs to a household; ${cutoff}`);
  const since = typeof houses[slug].since === "string" ? houses[slug].since.slice(0, 10) : null;
  if (!since) return refuse(409, `${slug} has no declaration day in the registry`, `without one it keeps room for three, and there is none to buy; ${cutoff}`);
  if (since <= lastDay)
    return refuse(409, `${slug} was declared on ${since}, on or before ${lastDay} (town time)`, "it keeps room for three parcels, one per resident, for good, and has none to buy");
  if (date < firstDay) return refuse(409, `room is bought from ${firstDay} (town time)`, cutoff);
  const house = `hh:${slug}`;
  if (houseKeyCanon(registry)(townKey) !== house)
    return refuse(409, `the town's ledger files ${handle} under ${townKey}, not ${house}`,
      `its verifier would refuse the line, so nothing is burned: a housemate the ledger files under ${house} can buy the room`);
  const bought = houseFactsOf({ registry, burns: parcelBurnsOf(entries.map((e) => e.canonical), engine.classifyEntry) })[house]?.bought ?? 0;
  const room = 1 + bought;
  if (room >= 3) return refuse(409, `${slug} already has room for three parcels`, "three is the cap, one per resident; there is no more room to buy");
  // NO ROOM PAST THE RESIDENTS (Darko 2026-10-23 11:04 EDT, POS-762/g "Refuse it"):
  // a parcel is one per resident, so room no resident can hold is refused,
  // never sold; the house adds the resident first, then buys the room.
  const residents = (houses[slug].residents ?? []).length;
  if (room + 1 > residents)
    return refuse(409, `${slug} has ${residents} resident${residents === 1 ? "" : "s"}, and room for a ${ordinal(room + 1)} parcel needs a ${ordinal(room + 1)} resident to hold it`,
      `a parcel is one per resident: add the resident first (household { do: "add-resident" }), then buy the room. Nothing was burned`);
  const price = price1 * room;
  const liquid = engine.foldBalances(entries).get(handle) ?? 0;
  if (liquid < price)
    return refuse(409, `room for a ${ordinal(room + 1)} parcel costs ${price} stamps, and ${handle} holds ${liquid} liquid`,
      `the price is ${price1} × the room ${slug} already has (${room}), whatever it holds: room 1 to 2 costs ${price1}, 2 to 3 costs ${price1 * 2}, paid to the town and never returned`);
  return {
    quote: {
      handle, household: slug, declared: since,
      cutoff: { last_day_keeping_three: lastDay, says: cutoff },
      room: { now: room, after: room + 1 }, price,
      price_says: `${price1} stamps × the room ${slug} already has (${room}), whatever it holds; paid to the town, burned and never returned; a claim then costs nothing`,
      stamps: { liquid_now: liquid, liquid_after: liquid - price },
      line: engine.parcelBurnLine({ date, handle, n: price, nth: room + 1, household: house }),
    },
  };
}

/** The quote at a town checkout: its engine, its households.json and its ledger, read now. */
export async function quoteAt(clone, handle, date) {
  const engine = await townEngineAt(clone);
  if (!engine) return refuse(503, "not-yet-open", "the office has no town clone to read the ledger from");
  const registry = JSON.parse(readFileSync(join(clone, "tools", "households.json"), "utf8"));
  const ledger = join(clone, "WHITE_PAGES", "stamp-ledger.md");
  const entries = existsSync(ledger) ? engine.parseStampLedger(readFileSync(ledger, "utf8")) : [];
  const townKey = typeof engine.householdKeys === "function" ? townKeyAt(engine, clone, entries, handle, date) : `solo:${handle}`;
  return parcelRoomQuote({ handle, date, registry, entries, engine, townKey });
}

/**
 * THE DOOR: `household { do: "buy-parcel-room", args: { from, preview } }`.
 * Preview quotes and writes nothing; the act runs the exec under the town lock,
 * which asks the same quote inside the lock and appends the town's line.
 */
export async function buyParcelRoomViaOffice(clone, { from, preview } = {}, key, { channel, date = null } = {}) {
  const bounce = (code, defect, hint) => ({ error: "bounce", code, defect, hint });
  if (!from) return bounce(422, "which resident pays?", `required: from, one of your residents — household { do: "${BUY_ROOM_ACT}", args: { from: "…" } }`);
  if (!key?.handles?.has(from))
    return bounce(403, `"${from}" is not one of your residents`, `this key acts for: ${[...(key?.handles ?? [])].join(", ") || "nobody"}`);
  const { townDay } = await import("./votes.mjs");
  const today = date ?? townDay(); // the town day; a caller (a test) may name one
  const { toConfirm, NOTHING_MOVED } = await import("./stamps-preview.mjs");
  const call = `household { do: "${BUY_ROOM_ACT}", args: { from: "${from}" } }`;
  if (preview === true) {
    let q;
    try { q = await quoteAt(clone, from, today); }
    catch (e) {
      const { faultLogged } = await import("./fault-words.mjs");
      return bounce(503, "not-yet-open", `the office could not read the town's ledger, so the room could not be quoted; ${faultLogged("the parcel room quote could not read the town", e)}`);
    }
    if (q.error) return bounce(q.error.code, q.error.defect, q.error.hint);
    return { preview: true, did: BUY_ROOM_ACT, ...q.quote, to_confirm: toConfirm(call), nothing_written: NOTHING_MOVED };
  }
  const { execUnderTownLock, lockTimedOut, LOCK_BUSY } = await import("./town-lock.mjs");
  const { viaFor } = await import("./channel.mjs");
  const exec = join(dirname(fileURLToPath(import.meta.url)), "parcel-room-exec.mjs");
  let out;
  try {
    out = await execUnderTownLock(exec, JSON.stringify({ handle: from, date: today, via: viaFor(channel) }), { ...process.env, TOWN_CLONE: clone });
  } catch (e) {
    if (lockTimedOut(e)) return bounce(LOCK_BUSY.code, LOCK_BUSY.defect, LOCK_BUSY.hint);
    const { faultLogged } = await import("./fault-words.mjs");
    return bounce(500, "the parcel room purchase tripped", faultLogged("the parcel room purchase tripped", e));
  }
  const result = JSON.parse(out.trim().split("\n").at(-1));
  if (result.error) return bounce(result.error.code ?? 500, result.error.defect, result.error.hint);
  return { did: BUY_ROOM_ACT, ...result };
}
