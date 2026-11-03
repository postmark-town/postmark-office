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
//   /g "Room past residents" (a house buying room for a parcel no resident can
//      hold yet): "Refuse it" (10-23), then "Warn and allow" (10-27), then
//      "let's just let 757 through and then hotfix to warn and allow during the
//      week" (10-31 22:31 EDT; POS-849). The quote carries a `heads_up` and the
//      burn goes through (roomPastResidentsHeadsUp).
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
 * THE HEADS-UP FOR ROOM NO RESIDENT CAN HOLD YET (POS-849; Darko 2026-10-27
 * "Warn and allow", 2026-10-31 22:31 EDT "hotfix to warn and allow during the
 * week"). A parcel is one per resident, so a house with fewer residents than
 * the parcel it buys room for can hold no parcel in that room until more join.
 * The purchase is allowed and the answer says so, with how far past the
 * residents the room goes. PURE. → the sentence, or null when a resident can
 * hold the room (or the counts are not a house's).
 */
export function roomPastResidentsHeadsUp({ slug, residents, nth }) {
  if (!Number.isInteger(residents) || !Number.isInteger(nth) || residents < 1 || nth <= residents) return null;
  const past = nth - residents;
  const until = past === 1 ? `a ${ordinal(nth)} resident joins` : `${past} more residents join`;
  return `${slug} has ${residents} resident${residents === 1 ? "" : "s"}, and a parcel is one per resident, so it can hold ${residents} parcel${residents === 1 ? "" : "s"} now. `
    + `Room for a ${ordinal(nth)} parcel is ${past} parcel${past === 1 ? "" : "s"} past that: it stands empty until ${until} (household { do: "add-resident" }). `
    + "Stamps paid for room are never returned.";
}

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
  // ROOM PAST THE RESIDENTS WARNS AND IS ALLOWED (POS-762/g; POS-849). Before
  // POS-849 this refused the purchase ("Refuse it", Darko 2026-10-23 11:03
  // EDT, shipped in w45 by office #757). He then ruled "Warn and allow"
  // (2026-10-27 11:00 EDT) and, with #757 let through, "hotfix to warn and
  // allow during the week" (2026-10-31 22:31 EDT). So the room is sold, the
  // answer carries a heads_up (roomPastResidentsHeadsUp), and the house's next
  // resident is what makes the room hold a parcel. The world's law is untouched:
  // its room never counted residents, and the town's verifier checks none.
  const headsUp = roomPastResidentsHeadsUp({ slug, residents: (houses[slug].residents ?? []).length, nth: room + 1 });
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
      ...(headsUp ? { heads_up: headsUp } : {}),
    },
  };
}

// ── ONE CALL, ONE ROOM: THE RETRY GUARD (the 10-26 review's F1) ─────────────
//
// F1: "a three-resident house that retries, or double-clicks, burns 50 and then
// 100: the exec re-quotes inside the lock and sells the next room." A call sells
// only the room it saw. The door quotes at entry and hands the exec the
// household and the nth it would buy (`expect`); inside the lock, a purchase of
// that nth already on the ledger IS that purchase (by this click or the one
// before it), so the call answers its receipt and burns nothing. The ledger is
// the record: no new field on the act and no new row. A call made after the
// first one answered sees the new room at entry, and buys the next room.

/**
 * The purchase of `nth` room for `household` (a slug) already on the ledger, by
 * any spelling of the house, or null. PURE. → `{ handle, household, date,
 * room, price, line }`, the first purchase's own facts.
 */
export function parcelRoomBought({ registry, entries, engine, household, nth }) {
  if (!household || !PARCEL_NTHS.includes(nth)) return null;
  const canon = houseKeyCanon(registry);
  const house = `hh:${household}`;
  const b = parcelBurnsOf((entries ?? []).map((e) => e.canonical), engine?.classifyEntry)
    .find((x) => x.nth === nth && canon(x.household) === house);
  if (!b) return null;
  // The click that answers the receipt may be the only answer the agent reads,
  // so the heads-up the purchase carried rides it too (POS-849), counted on the
  // residents the house has now.
  const headsUp = roomPastResidentsHeadsUp({ slug: household, residents: (registry?.households?.[household]?.residents ?? []).length, nth });
  return { handle: b.handle, household, date: b.date, room: { now: nth - 1, after: nth }, price: b.n,
    ...(typeof engine?.parcelBurnLine === "function" ? { line: engine.parcelBurnLine({ date: b.date, handle: b.handle, n: b.n, nth, household: b.household }) } : {}),
    ...(headsUp ? { heads_up: headsUp } : {}) };
}

/**
 * The quote at a town checkout: its engine, its households.json and its ledger,
 * read now. With `expect` (the room the call saw at the door), a purchase of
 * that room already made answers `{ repeat }`, and a room that moved past it
 * any other way is refused: a call never buys a room it did not see.
 */
export async function quoteAt(clone, handle, date, { expect = null } = {}) {
  const engine = await townEngineAt(clone);
  if (!engine) return refuse(503, "not-yet-open", "the office has no town clone to read the ledger from");
  const registry = JSON.parse(readFileSync(join(clone, "tools", "households.json"), "utf8"));
  const ledger = join(clone, "WHITE_PAGES", "stamp-ledger.md");
  const entries = existsSync(ledger) ? engine.parseStampLedger(readFileSync(ledger, "utf8")) : [];
  if (expect) {
    const made = parcelRoomBought({ registry, entries, engine, household: expect.household, nth: expect.nth });
    if (made) return { repeat: made };
  }
  const townKey = typeof engine.householdKeys === "function" ? townKeyAt(engine, clone, entries, handle, date) : `solo:${handle}`;
  const q = parcelRoomQuote({ handle, date, registry, entries, engine, townKey });
  if (expect && q.quote && (q.quote.household !== expect.household || q.quote.room.after !== expect.nth))
    return refuse(409, `${expect.household}'s room changed while this call waited for the pen`,
      `this call would have bought room for parcel ${expect.nth}, and the next room is now parcel ${q.quote.room.after}${q.quote.household !== expect.household ? ` of ${q.quote.household}` : ""}. Nothing was burned: quote again with preview: true`);
  return q;
}

/** The answer to a repeat: the first purchase's receipt, and that nothing was burned again. */
function repeatReceipt(made) {
  return {
    did: BUY_ROOM_ACT, duplicate: true, ...made,
    note: `this room was already bought: ${made.handle} bought room for ${made.household}'s parcel ${made.room.after} (${made.price} stamps), and this is that purchase's receipt. NOTHING WAS BURNED A SECOND TIME. To buy the next room, quote it first: household { do: "${BUY_ROOM_ACT}", args: { from, preview: true } }`,
  };
}

// ── NOT BEFORE THE LAW IS BLESSED (Truey's review of d97cfa2, F2) ───────────
//
// "world#300 merging to main does not make it law. The settlement folds with
// the engine at header.law_sha … the blessed ref." Room bought while the
// blessed engine has no parcel room buys nothing: every house keeps three. So
// the purchase, and its preview, open only when the engine at the newest
// blessing carries `parcelRoomOf`. Darko, 2026-10-31 22:56 EDT: "build the fix
// for this overnight (so land world 300 it seems like)".
//
// IT FAILS CLOSED (Truey's re-review of 62a707c, N1). The read seam's two
// fallbacks are right for reads and wrong for a money gate: `blessed()` answers
// main when the clone has no settlement tag (world-branches.mjs § blessedUncached),
// and `engineDirAt` answers the working tree when the blessing can't be
// materialised. With the law on main, either would sell room before the bless.
// So the gate asks for a settlement tag by name and materialises it directly
// (`materializeAtRef`, which throws rather than falling back), and anything
// else — no tag, no git, a failed read — refuses.

/** Does the engine at the newest blessing size a household's parcel room? → `{ live, at }`. */
export async function parcelLawBlessed(worldClone) {
  const { blessed, materializeAtRef } = await import("./world-branches.mjs");
  let b;
  try { b = blessed(worldClone); } catch { return { live: false, at: "the newest blessing (the world clone could not be read)" }; }
  if (b?.source !== "settlement" || !b.tag) return { live: false, at: `${b?.ref ?? "main"} (no settlement tag)` };
  try {
    const dir = materializeAtRef(worldClone, b.ref, "tools");
    const fold = await import(pathToFileURL(join(dir, "tools", "marks-fold.mjs")).href);
    return { live: typeof fold.parcelRoomOf === "function", at: b.tag };
  } catch { return { live: false, at: `${b.tag} (its engine could not be read)` }; }
}

// ── THE PURCHASES IN FLIGHT (Truey's review of d97cfa2, F1) ─────────────────
//
// "A second click whose entry quote lands after A's appendSigned and before A
// answers reads A's line, sees room 2, sets expect.nth = 3, and in the lock buys
// room 3 at 100." Taking the entry quote under the lock would not close it: a
// click that waits for the lock sees the room AFTER the first purchase, and buys
// the next one. So the room a call saw excludes purchases still in flight: while
// one is, a new call expects the lowest room in flight, and inside the lock that
// room already on the ledger is answered with its receipt (§ ONE CALL, ONE ROOM).
// In flight means from the entry quote to the answer, in this process: the
// office's one writer (src/server.mjs; its read workers take only GET reads and
// the MCP's bare world reads, read-workers.mjs § workerTakes, § mcpWorkerTakes).
const roomInFlight = new Map(); // household slug -> Map(token -> nth)

/**
 * THE DOOR: `household { do: "buy-parcel-room", args: { from, preview } }`.
 * Preview quotes and writes nothing; the act runs the exec under the town lock,
 * which asks the same quote inside the lock and appends the town's line.
 * `worldClone` (a test names one) is the world whose blessing says the law is live.
 */
export async function buyParcelRoomViaOffice(clone, { from, preview } = {}, key, { channel, date = null, worldClone = null } = {}) {
  const bounce = (code, defect, hint) => ({ error: "bounce", code, defect, hint });
  if (!from) return bounce(422, "which resident pays?", `required: from, one of your residents — household { do: "${BUY_ROOM_ACT}", args: { from: "…" } }`);
  if (!key?.handles?.has(from))
    return bounce(403, `"${from}" is not one of your residents`, `this key acts for: ${[...(key?.handles ?? [])].join(", ") || "nobody"}`);
  const law = await parcelLawBlessed(worldClone ?? (await import("./world.mjs")).WORLD_CLONE);
  if (!law.live)
    return bounce(409, "not-yet-open", `room is sold once the world's parcel law is blessed: the engine at ${law.at} does not size a household's parcel room yet, so room bought now would change nothing until it is blessed. Nothing was burned`);
  const { townDay } = await import("./votes.mjs");
  const today = date ?? townDay(); // the town day; a caller (a test) may name one
  const { toConfirm, NOTHING_MOVED } = await import("./stamps-preview.mjs");
  const call = `household { do: "${BUY_ROOM_ACT}", args: { from: "${from}" } }`;
  // The quote at entry, for the preview AND the act: the act's is the room its
  // call saw, which the exec sells and no other (§ ONE CALL, ONE ROOM).
  let q;
  try { q = await quoteAt(clone, from, today); }
  catch (e) {
    const { faultLogged } = await import("./fault-words.mjs");
    return bounce(503, "not-yet-open", `the office could not read the town's ledger, so the room could not be quoted; ${faultLogged("the parcel room quote could not read the town", e)}`);
  }
  if (q.error) return bounce(q.error.code, q.error.defect, q.error.hint);
  if (preview === true)
    return { preview: true, did: BUY_ROOM_ACT, ...q.quote, to_confirm: toConfirm(call), nothing_written: NOTHING_MOVED };
  // The room this call saw, less any purchase still in flight (§ THE PURCHASES
  // IN FLIGHT), registered before the next await so a later call sees it.
  const slug = q.quote.household;
  const flying = roomInFlight.get(slug) ?? new Map();
  roomInFlight.set(slug, flying);
  const expect = { household: slug, nth: Math.min(q.quote.room.after, ...flying.values()) };
  const token = Symbol(from);
  flying.set(token, expect.nth);
  try {
    const { execUnderTownLock, lockTimedOut, LOCK_BUSY } = await import("./town-lock.mjs");
    const { viaFor } = await import("./channel.mjs");
    const exec = join(dirname(fileURLToPath(import.meta.url)), "parcel-room-exec.mjs");
    let out;
    try {
      out = await execUnderTownLock(exec, JSON.stringify({ handle: from, date: today, via: viaFor(channel), expect }), { ...process.env, TOWN_CLONE: clone });
    } catch (e) {
      if (lockTimedOut(e)) return bounce(LOCK_BUSY.code, LOCK_BUSY.defect, LOCK_BUSY.hint);
      const { faultLogged } = await import("./fault-words.mjs");
      return bounce(500, "the parcel room purchase tripped", faultLogged("the parcel room purchase tripped", e));
    }
    const result = JSON.parse(out.trim().split("\n").at(-1));
    if (result.error) return bounce(result.error.code ?? 500, result.error.defect, result.error.hint);
    if (result.repeat) { const { repeat: _r, ...made } = result; return repeatReceipt(made); }
    return { did: BUY_ROOM_ACT, ...result };
  } finally {
    flying.delete(token);
    if (!flying.size && roomInFlight.get(slug) === flying) roomInFlight.delete(slug);
  }
}
