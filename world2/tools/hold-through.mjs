// hold-through.mjs — THE SETTLEMENT PRINTS WHERE A THING IS AND WHOSE IT IS
// (POS-688, ruled by Darko 2026-10-18 20:58; W1 (a), settled by Wright the same
// night; maker and owner, 2026-10-19 16:39–16:45 and 17:14).
//
// "A held thing is published but unplaced": the same mark (maker, words, id), no
// ground position while held, shown as its holder's contents. The settlement
// prints a held thing's mark with `held_by: <its holder>` and no `at`/`extent`,
// and a drop prints a fresh `at` where the dropper stood. And the owner, when the
// owner is not the maker, prints as `owned_by: <owner>` (D-O1).
//
// ── HOW: THE CLEARING WRITES THE HOLD RECORD THROUGH ────────────────────────
//
// The hold record lives in `acts` (class holding: take, give, drop; and the frozen
// era's attachments). The clearing already writes store-held facts through into
// the record it locks (the carry's riders, POS-441, step 6.1), so this is that
// move once more, as step 6.2: for every thing whose standing row disagrees with
// the hold record, one locked claim of its own superseding the row, filed by
// materialize.mjs, so the write-down prints it and the sweep lets it land
// (settlement-sweep.mjs § hold-only change). Rejected (W1 b): an author's amend
// filed at the take or drop door, which on the commons at ✦0 is a private draft
// that never publishes (POS-451), and would write in the author's name for a
// stranger's hand.
//
// A DIFF, NOT A DELTA. The printout is the hold record's answer for every thing
// it names, compared with the standing row, so an act committed late (an id taken
// before a neighbour's and committed after it) is printed at the next clearing,
// never lost behind a cutoff. The cutoff (`hold_through`, the last hold act this
// clearing read, on the window's receipts) says only which DROPS are the
// printout's: those after the first clearing that printed. A drop from before it
// is the POS-138 era's, and D2 leaves those alone (canon stays the author's).
//
// WHAT A PRINTOUT IS:
//   held      geometry null (no at, no extent), `held_by: <holder>` in data, and
//             `_placed`: where it last stood (held.mjs § PLACED; never printed),
//             which is the extent a drop prints again and the centre an act
//             anchored on it before it was taken still composes against (W4).
//   set down  geometry { at: where the dropper stood, extent: the one it had },
//             no `held_by`, no `_placed`.
//   owned     `owned_by: <owner>` when the owner is not the maker, and none when
//             the maker owns it, whatever else changed or did not.
//
// OPPOSED BRINGS IT BACK (Darko 2026-10-19 16:39–16:45: "Opposed returns it at
// the next settlement: to the owner's hands if they have room, otherwise onto the
// owner's parcel, which is free"). The owner's word is read from the one fold
// (src/ownership.mjs) at EVERY clearing, with no window: a thing out of its
// owner's house whose owner's latest word is opposed comes back in this same
// transaction, before anything prints, as one act by the town:
//   · a `give` into the owner's hands, when their carry has room (the take
//     door's own count: things held whole and units, against the resident's
//     capacity; and one holder in a resident's hands);
//   · otherwise a `drop` onto the owner's household's parcel nearest where the
//     thing is (D-O5), anchored at its centre: free, no stamp moves;
//   · otherwise it waits, said on the receipt, and is tried again next time.
// The act names what it answers: `returned: { act, stance_act }`. 078 lets
// `clearing_job` write exactly that act and no other. The printout below then
// prints the thing where the return put it.
//
// WHAT IS NEVER PRINTED (each a note on the window's receipts, by name):
//   · a thing the store holds no standing row for (an unpublished draft, a
//     retired mark): there is no mark to print;
//   · a thing that frames marks filed inside it (their numbers are written against
//     its centre: unplacing it would move them; the sweep holds the same back);
//   · a drop whose place cannot be composed, or a thing with no extent to print;
//   · a drop the standing row has been amended past: the author's word stands. ONE
//     clock, act ids (POS-688 acceptance F1, Wright 2026-10-21): the row's own act
//     (`data._act_id`, the author's last leave-mark, which a hold printout keeps) is
//     later than the drop's. The window and the crossing were two clocks: window W
//     clears at 17:45Z while crossing W runs to 24:00Z, so a thing locked at the
//     clearing and dropped before midnight read as amended past its drop, forever.
//
// PURE planners (`holdPrintout`, `returnPlan`), plus the one function that reads
// and writes (`writeHoldThrough`), which the clearing job calls inside its
// transaction.

import { HELD_BY, PLACED, heldBy, latestRows, actIdOf, placedCentreOfRow } from "../../src/held.mjs";
import { HOLD_TOP_SQL, OWNER_WORDS_SQL } from "../../src/hold-record.mjs";
import { OWNED_BY, foldOwners, ownershipEvents, opposedNow, makerOf } from "../../src/ownership.mjs";
import { foldUnits, isUnitRow, totalOf } from "../../src/world-stacks.mjs";
import { LAW_AT_BLESSING_SQL, lawSnapshotFromRows, snapProperty } from "../../src/law-classes.mjs";
import { holdingOf } from "../../src/holding-law.mjs";
import { composeAnchor } from "./conversations.mjs";
import { pgAttachmentsFor, pgHoldingRows } from "./guard-reads.mjs";

/** The cutoff the first clearing that printed sealed: drops at or before it are the POS-138 era's. */
export const FIRST_THROUGH_SQL = `SELECT min((receipts->>'hold_through')::bigint) AS "from" FROM windows WHERE id < $1 AND receipts ? 'hold_through'`;
/** The standing rows the printout is compared with (the carry reads the same columns). */
export const STANDING_ROWS_SQL = `SELECT id::text, slug, kind, owner, household, geometry, parent::text, data, body, locked_window
                                   FROM marks WHERE status = 'standing'`;

const asObj = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const point = (p) => (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)) ? { x: Number(p.x), y: Number(p.y) } : null);
const sameAt = (a, b) => !!a && !!b && Number(a.x) === Number(b.x) && Number(a.y) === Number(b.y);
/** An act id as a BigInt, or null: the one clock a drop and an amend are ordered by. */
const actOrder = (v) => (v != null && /^\d+$/.test(String(v)) ? BigInt(String(v)) : null);
const isMarkId = (v) => typeof v === "string" && v.includes("/");

/**
 * What the settlement prints this clearing. PURE.
 *
 * @param attachments  the hold rows up to the cutoff, in replay order (last wins)
 * @param drops        `Map(thing → its latest drop row)`, as guard-reads § pgHoldingRows gives it
 *                     (`seq` the act id, `at` the witnessed line `{ anchor, dx, dy }`)
 * @param rows         the standing `marks` rows
 * @param from         the first printing clearing's cutoff, or null when none has printed yet
 * @param owners       `Map(thing → owner handle)`, the ownership fold's answer (absent: its maker)
 * @param setDowns     the act ids of `set-down` hold rows (POS-766/e): a thing made in hand set down as its
 *                     maker's draft. Its place is its draft's, which the settlement publishes like any draft,
 *                     so the printout never places it from a drop (it has none) and never notes it
 * @returns `{ prints: [{ slug, row, geometry, data, why }], notes: [string] }`
 */
export function holdPrintout({ attachments = [], drops = new Map(), rows = [], from = null, owners = new Map(), setDowns = new Set() }) {
  const bySlug = new Map(rows.map((r) => [String(r.slug), { ...r, geometry: asObj(r.geometry), data: asObj(r.data) ?? {} }]));
  const centreOf = (id) => placedCentreOfRow(bySlug.get(String(id)) ?? null);
  const framedBy = new Map();   // slug -> marks filed inside it that carry their own place
  for (const r of bySlug.values()) {
    const up = r.data?._parentMarkId;
    if (up && point(r.geometry?.at) && r.data?._fileAt) framedBy.set(String(up), [...(framedBy.get(String(up)) ?? []), r.slug]);
  }
  const prints = new Map(), notes = [];
  for (const [slug, hold] of latestRows(attachments)) {
    const row = bySlug.get(slug);
    if (!row) continue; // no mark to print (a draft, or retired)
    const { _fileAt, _origin, [HELD_BY]: wasHeldBy, [PLACED]: placed, ...rest } = row.data ?? {};
    if (hold.policy === "cascade" && hold.entity != null) {
      const holder = String(hold.entity);
      if (heldBy(row.data) === holder && !point(row.geometry?.at)) continue; // printed so already
      const framed = framedBy.get(slug) ?? [];
      if (framed.length) { notes.push(`${slug} stays placed: ${framed.length} mark(s) filed inside it write their place against it (${framed.slice(0, 4).join(", ")})`); continue; }
      const lastPlace = point(row.geometry?.at) ? row.geometry : (placed ?? null);
      prints.set(slug, { slug, row, geometry: null, why: `held by ${holder}`,
        data: { ...rest, [HELD_BY]: holder, ...(lastPlace ? { [PLACED]: lastPlace } : {}) } });
      continue;
    }
    if (hold.policy !== "detach") continue;
    if (setDowns.has(String(hold.act_id))) continue; // set down as its maker's draft (POS-766/e): its draft places it
    const legacy = from == null || actIdOf(hold) <= from;
    if (legacy) continue; // the POS-138 era: D2 leaves it alone
    const drop = drops.get(slug) ?? null;
    const at = drop ? composeAnchor(drop.at ?? {}, centreOf) : null;
    if (!at) { notes.push(`${slug}: its set-down could not be placed (the drop's witnessed line does not compose)`); continue; }
    if (!heldBy(row.data) && sameAt(row.geometry?.at, at)) continue; // canon has it there already
    // an amend the author made after the drop: act ids, one clock. A row with no `_act_id` was written before
    // the act-id era and has not been amended since (an amend writes one), so nothing supersedes the drop.
    const amendAct = actOrder(row.data?._act_id), dropAct = actOrder(drop?.seq ?? actIdOf(hold));
    if (!heldBy(row.data) && amendAct != null && dropAct != null && amendAct > dropAct) {
      notes.push(`${slug}: amended by act ${amendAct}, after its set-down (act ${dropAct}): the author's word stands`);
      continue;
    }
    const extent = row.geometry?.extent ?? placed?.extent ?? null;
    if (!extent) { notes.push(`${slug}: set down, but no extent is on record to print`); continue; }
    prints.set(slug, { slug, row, geometry: { at: { x: at.x, y: at.y }, extent }, why: `set down by ${drop?.actor ?? "somebody"}`, data: rest });
  }
  // WHOSE IT IS (D-O1): `owned_by` when the owner is not the maker, and none when the maker owns it
  for (const [slug, owner] of owners) {
    const row = bySlug.get(String(slug));
    if (!row) continue;
    const want = owner != null && String(owner) !== String(row.owner) ? String(owner) : null;
    const p = prints.get(slug);
    const has = (p ? p.data : row.data)?.[OWNED_BY] ?? null;
    if ((has ?? null) === want) continue;
    if (p) {
      const { [OWNED_BY]: _was, ...data } = p.data;
      p.data = want ? { ...data, [OWNED_BY]: want } : data;
      p.why = `${p.why}; ${want ? `owned by ${want}` : `its maker's again`}`;
      continue;
    }
    const { _fileAt, _origin, [OWNED_BY]: _was, ...data } = row.data ?? {};
    prints.set(slug, { slug, row, geometry: row.geometry ?? null, why: want ? `owned by ${want}` : `its maker's again`,
      data: want ? { ...data, [OWNED_BY]: want } : data });
  }
  return { prints: [...prints.values()], notes };
}

/**
 * Where an opposed thing comes back to. PURE.
 *
 * @param owner     the owner's handle
 * @param room      does the owner's carry have room for it (true / false / null unread)
 * @param parcels   the owner's household's standing parcels `[{ slug, at }]`
 * @param near      where the thing is now, or null
 * @returns `{ to: "hands", holder }` · `{ to: "parcel", parcel, at }` · `{ to: null, why }`
 */
export function returnPlan({ owner, room, parcels = [], near = null }) {
  if (room === true) return { to: "hands", holder: String(owner) };
  const placed = parcels.filter((p) => point(p.at));
  if (placed.length) {
    const d = (p) => (near ? Math.hypot(p.at.x - near.x, p.at.y - near.y) : 0);
    const best = [...placed].sort((a, b) => d(a) - d(b) || String(a.slug).localeCompare(String(b.slug)))[0];
    return { to: "parcel", parcel: best.slug, at: point(best.at) };
  }
  return { to: null, why: room === false
    ? `${owner}'s hands are full and ${owner}'s house holds no parcel to set it on`
    : `whether ${owner}'s hands have room could not be read, and ${owner}'s house holds no parcel to set it on` };
}

/**
 * STEP 6.2 · THE HOLD WRITE-THROUGH, inside the clearing's transaction. `q` is
 * the clearing's query function, `materialize` its filer (materialize.mjs §
 * materializeClaims, bound), `houseOrRefusal` its owner-house resolver and
 * `liveHouseOf` its stored-spelling-to-live-house map. Returns the receipt the
 * window keeps: `{ hold_through, printed, returned, notes }`.
 */
export async function writeHoldThrough(q, { windowId, materialize, houseOrRefusal, boxOf, liveHouseOf = async () => (k) => k }) {
  const client = { query: (text, params) => q(text, params) };
  if (!Number.isFinite(Number((await q(HOLD_TOP_SQL, [])).rows?.[0]?.top ?? NaN)))
    return { hold_through: null, printed: [], returned: [], notes: ["no hold act on record"] };
  const fromRow = (await q(FIRST_THROUGH_SQL, [windowId])).rows?.[0];
  const from = fromRow?.from == null ? null : Number(fromRow.from);
  const { rows } = await q(STANDING_ROWS_SQL, []);
  const bySlug = new Map(rows.map((r) => [String(r.slug), r]));
  const words = (await q(OWNER_WORDS_SQL, [null])).rows ?? [];

  // ONE HOUSEHOLD MAP for the fold, resolved once per handle the record names
  const houses = new Map();
  const houseKey = async (h) => {
    if (h == null) return null;
    if (!houses.has(h)) houses.set(h, (await houseOrRefusal(q, h)).household ?? `solo:${h}`);
    return houses.get(h);
  };
  const ownersFrom = async (holding) => {
    const events = ownershipEvents(holding, words);
    for (const e of events) {
      await houseKey(e.actor);
      await houseKey(makerOf(e.thing));
      const into = e.payload?.holder;
      if (into != null && !isMarkId(String(into))) await houseKey(String(into));
    }
    return foldOwners(events, { houseOf: (h) => houses.get(h) ?? `solo:${h}` });
  };

  // ── OPPOSED BRINGS IT BACK, before anything prints ──
  const returned = [], notes = [];
  {
    const holding = await pgHoldingRows(client, {});
    const owners = await ownersFrom(holding);
    const out = [...owners].filter(([slug, st]) => opposedNow(st) && bySlug.has(slug));
    if (out.length) {
      const atts = (await pgAttachmentsFor(client, {})).rows;
      const last = latestRows(atts);
      const units = foldUnits(holding.filter(isUnitRow));
      const law = await (async () => { try { return lawSnapshotFromRows((await q(LAW_AT_BLESSING_SQL, [])).rows); } catch { return null; } })();
      const prop = (cls, p) => (law ? snapProperty(law, cls, p) : null);
      const cap = law ? holdingOf({ className: "resident", classProperty: prop }).capacity : null;
      const isHolderRow = (r) => {
        const data = asObj(r?.data) ?? {};
        const cls = data.class ?? (r?.kind === "thing" ? "thing" : null);
        return !!(cls && law && holdingOf({ mark: data, className: cls, classProperty: prop }).holder === true);
      };
      const live = await liveHouseOf();
      for (const [slug, st] of out) {
        const row = bySlug.get(slug);
        const ownerHouse = await houseKey(st.owner);
        const heldThings = [...last.values()].filter((a) => a.policy === "cascade" && String(a.entity) === String(st.owner)).map((a) => String(a.target));
        const room = !Number.isInteger(cap) ? null
          : totalOf(units, st.owner) + heldThings.length + 1 <= cap
            && !(isHolderRow(row) && heldThings.some((t) => isHolderRow(bySlug.get(t))));
        const parcels = rows.filter((r) => r.kind === "parcel" && live(String(r.household)) === live(String(ownerHouse)))
          .map((r) => ({ slug: String(r.slug), at: asObj(r.geometry)?.at ?? null }));
        const g = asObj(row.geometry) ?? null, d = asObj(row.data) ?? {};
        const near = point(g?.at) ?? point(d[PLACED]?.at);
        const plan = returnPlan({ owner: st.owner, room, parcels, near });
        if (!plan.to) { notes.push(`${slug}: its owner ${st.owner} asked for it back, and it waits — ${plan.why}; it is tried again at the next settlement`); continue; }
        const word = st.outing.word;
        const holderNow = last.get(slug);
        const previous = holderNow?.policy === "cascade" && holderNow.entity != null ? String(holderNow.entity) : null;
        // ONE RETURN, ONE ACT, under its own savepoint: one the store refuses is a note, never the window
        await q("SAVEPOINT return_one_thing");
        try {
          const hands = plan.to === "hands";
          await q(
            `INSERT INTO acts (at, crossing, actor, action, object, at_anchor, at_dx, at_dy, class, payload, effect)
             VALUES (now(), $1, 'the-town', $2, $3, $4, $5, $6, 'holding', $7, $8)`,
            [windowId, hands ? "give" : "drop", slug, hands ? null : plan.parcel, hands ? null : 0, hands ? null : 0,
              JSON.stringify({ thing: slug, holder: hands ? plan.holder : null, policy: hands ? "cascade" : "detach",
                made_by: makerOf(slug), previous_holder: previous, returned: { act: word.act_id, stance_act: word.stance_act } }),
              hands ? `its owner ${st.owner} asked for it back: the settlement returns it to ${st.owner}'s hands`
                    : `its owner ${st.owner} asked for it back, and ${st.owner}'s hands were full: the settlement sets it on ${plan.parcel}`]);
          await q("RELEASE SAVEPOINT return_one_thing");
          returned.push({ slug, owner: st.owner, act: word.act_id, stance_act: word.stance_act, from: previous,
            to: hands ? { [HELD_BY]: plan.holder } : { parcel: plan.parcel, at: plan.at } });
        } catch (e) {
          await q("ROLLBACK TO SAVEPOINT return_one_thing");
          await q("RELEASE SAVEPOINT return_one_thing");
          notes.push(`${slug}: its owner asked for it back, and the return could not be written (${String(e?.message ?? e).slice(0, 200)})`);
        }
      }
    }
  }

  // ── THE PRINTOUT, of the record as the returns left it ──
  const through = Number((await q(HOLD_TOP_SQL, [])).rows?.[0]?.top ?? NaN);
  const atts = (await pgAttachmentsFor(client, {})).rows.filter((r) => actIdOf(r) <= through);
  const holding = await pgHoldingRows(client, {});
  const drops = new Map();
  for (const r of holding) if (r.action === "drop" && Number(r.seq) <= through) drops.set(String(r.object ?? r.payload?.thing), r);
  const setDowns = new Set(holding.filter((r) => r.action === "set-down").map((r) => String(r.seq)));
  const owners = new Map([...(await ownersFrom(holding))].map(([slug, st]) => [slug, st.owner]));
  const plan = holdPrintout({ attachments: atts, drops, rows, from, owners, setDowns });
  plan.notes.unshift(...notes);
  const printed = [];
  for (const p of plan.prints) {
    const house = await houseOrRefusal(q, p.row.owner);
    if (house.check) { plan.notes.push(`${p.slug}: ${house.check}`); continue; }
    // ONE PRINTOUT, ONE UNIT: its claim row and its filing, or neither (a claim
    // written locked with no mark is a lock that never landed)
    await q("SAVEPOINT print_one_hold");
    const g = asObj(p.geometry);
    const { rows: [claim] } = await q(
      `INSERT INTO claims (window_id, slug, class, claimant, household, status, decided_at, body, geometry, bbox, stake, data, parent, supersedes)
       VALUES ($1, $2, $3, $4, $5, 'locked', now(), $6, $7, $8, 0, $9, $10, $11)
       RETURNING *`,
      [windowId, p.slug, p.row.kind, p.row.owner, house.household, p.row.body ?? null,
        g ? JSON.stringify(g) : null, g?.at ? boxOf(g) : null,
        JSON.stringify({ ...p.data, _held_through: through }), p.row.parent ?? null, p.row.id]);
    let failed = null;
    await materialize({ claims: [claim], amends: new Map([[String(claim.id), { id: p.row.id }]]), refuseEach: (_c, check) => { failed = check; } });
    if (failed) {
      await q("ROLLBACK TO SAVEPOINT print_one_hold");
      await q("RELEASE SAVEPOINT print_one_hold");
      plan.notes.push(`${p.slug}: ${failed}`);
      continue;
    }
    await q("RELEASE SAVEPOINT print_one_hold");
    printed.push({ slug: p.slug, claim: String(claim.id), why: p.why });
  }
  return { hold_through: through, printed, returned, notes: plan.notes };
}
