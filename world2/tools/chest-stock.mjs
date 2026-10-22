// chest-stock.mjs — THE FIRST STOCK OF A CHEST, at the settlement that admits it
// (WLD-27; Wright, 2026-10-12T23:59Z, 2026-10-13T00:01Z and 00:09Z).
//
// "A resident's chest mark is born at settlement. At the settlement admitting
// it, town stocking adds min(30, capacity) of that resident's label, once.
// Admission/replay must not repeatedly stock the same chest." And: "If the
// placer has NO candy label, ADMIT the chest UNSTOCKED … the receipt names
// `chest-unstocked: <handle> has no candy label` … When that resident registers
// later, stock at the NEXT settlement that finds the label, exactly once with
// the SAME replay guard."
//
// ── WHO RUNS IT ─────────────────────────────────────────────────────────────
//
// `settlements-backfill.mjs --apply` on the office tick, right after the
// settlement rows and the carried rows (`stockedOnTick`, beside
// `carriedOnTick`), as `office_api` — the pen that writes `acts`. The clearing
// itself cannot: `clearing_job` holds no INSERT on `acts` (002_grants.sql). So a
// chest is stocked by the tick that first sees the settlement which admitted
// it, and the act names that settlement.
//
// ── WHY IT IS ONCE ──────────────────────────────────────────────────────────
//
// Two walls, either alone sufficient:
//   1. the plan skips every chest the record already shows a `units:stock` act
//      for (world-stacks.mjs § planChestStock), and
//   2. the act carries the nonce `stock:<chest id>` under the town's own pen
//      (actor postmark-pen, household the-town), and `acts_world_nonce_once`
//      (052) is UNIQUE on (household, actor, action, nonce): a second insert —
//      a replay, a retry, two ticks racing — is `ON CONFLICT DO NOTHING`.
// An unstocked admission writes NO act, so it never counts as the first stock.
//
// ── WHAT IT READS ───────────────────────────────────────────────────────────
//
// The labels and the chest dials from the CLASS LAYER AT THE PIN (law-classes
// § LAW_AT_BLESSING_SQL: the newest settlement whose law is ingested) — the
// candy class's `labels: [{label, name, creator}]` is the one source; the
// standing chests from `marks` (data->>'class' = 'chest'); the unit acts from
// `acts`. It writes nothing but the stock acts, and never a ledger line.

import { LAW_AT_BLESSING_SQL, lawSnapshotFromRows } from "../../src/law-classes.mjs";
import { UNIT_ACTION, foldUnits, stockedChests, candyLabels, planChestStock, chestDials } from "../../src/world-stacks.mjs";
import { stolenRefusal } from "../../src/world-stacks.mjs"; // a class taken by the town's own act (WLD-7)
import { lockedChestUse } from "../../src/chest-lock.mjs";
import { pgAttachmentsFor } from "./guard-reads.mjs";

/** Whole things each chest holds now: the latest holding row per thing, held (cascade) by a chest id. */
export function thingsInChests(rows) {
  const last = new Map();
  for (const r of rows) last.set(String(r.target), r);
  const out = new Map();
  for (const r of last.values()) if (r.policy === "cascade" && String(r.entity).includes("/")) out.set(String(r.entity), (out.get(String(r.entity)) ?? 0) + 1);
  return out;
}

export const TOWN_PEN = "postmark-pen";
export const TOWN_HOUSEHOLD = "the-town";
export const stockNonce = (chest) => `${UNIT_ACTION.stock}:${chest}`; // act-nonce.mjs § keptNonce's spelling

// ── ADMITTED, NOT MERELY STANDING (Bevel's review, finding 7) ──────────────
//
// A store row standing is not a chest the settlement admitted: fold-delta.mjs
// documents standing rows with no canon file. The proof of admission is
// `mark_carried` (049): the settlement that first CARRIED the mark into the
// blessed world, written from git by the carried step of this same tick. So a
// chest is stocked only when that row exists, and the stock is attributed to
// THAT settlement — never to whichever settlement happens to be newest.
const CHESTS_SQL = `
  SELECT m.slug, m.owner, m.data, c.settlement
    FROM marks m JOIN mark_carried c ON c.mark = m.slug
   WHERE m.status = 'standing' AND m.data->>'class' = 'chest'
   ORDER BY m.slug`;
const UNITS_SQL = `SELECT id, class, action, object, payload FROM acts WHERE class = 'holding' AND action LIKE 'units:%' ORDER BY at, id`;
const INSERT_SQL = `
  INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect, household, nonce)
  VALUES (now(), $1, $2, $3, $4, 'holding', $5::jsonb, $6, $7, $8)
  ON CONFLICT DO NOTHING
  RETURNING id`;

// The candy class at every settlement whose law is ingested, oldest first: the
// law AT settlement N is the newest of these at or before N.
const CANDY_LAWS_SQL = `
  SELECT s.number, l.data FROM settlements s
    JOIN law_projection l ON l.law_sha = s.tag_sha AND l.kind = 'class' AND l.key = 'candy'
   ORDER BY s.number`;

/**
 * The settlement a stock is DECIDED at: the first settlement, from the one
 * that admitted the chest on, whose law carries the creator's label — the
 * admission itself when the label was there already, a later one when it was
 * registered after. `candyLaws` is CANDY_LAWS_SQL's rows. Falls back to the
 * pin (whose law found the label for this plan) when no older law says so.
 */
export function decidedAt({ admitted, label, creator, candyLaws = [], pin = null }) {
  const has = (data) => candyLabels(typeof data === "string" ? JSON.parse(data) : data)
    .some((l) => String(l.label) === String(label) && String(l.creator) === String(creator));
  const laws = candyLaws.map((r) => ({ n: Number(r.number), has: has(r.data) })).sort((a, b) => a.n - b.n);
  const atAdmission = laws.filter((l) => l.n <= admitted).at(-1);
  if (atAdmission?.has) return admitted;
  const later = laws.find((l) => l.n > admitted && l.has);
  if (later) return later.n;
  return Number.isInteger(Number(pin)) && pin != null && Number(pin) > admitted ? Number(pin) : admitted;
}
const admittedNote = (admitted, decided) => (decided === admitted ? "" : `, admitted at S${admitted}`);

/** The plan, from the store, without writing. Counts here are a preview; the stock is decided under each chest's lock. */
export async function planFromStore(client) {
  const law = lawSnapshotFromRows((await client.query(LAW_AT_BLESSING_SQL)).rows);
  if (!law) return { unreadable: "the store holds no settlement whose law is ingested — the candy labels cannot be read, so nothing is stocked" };
  const candy = law.classes.get("candy") ?? null;
  // A CLASS TAKEN BY THE TOWN'S OWN ACT (WLD-7; making refuses too, 2026-10-17 ruling (2)):
  // the first stock MAKES units of the class this chest stocks (the class whose record
  // registers the labels, read above), so it waits while that class (or an ancestor) is
  // taken, and the next tick after the return stocks it, once, by the same plan and nonce.
  // Asked of the law at the pin, the law the plan reads.
  const stockedClass = [...law.classes.entries()].find(([, r]) => r === candy)?.[0] ?? null;
  const recOf = (n) => { const r = law.classes.get(String(n)) ?? null; if (!r) return null; const d = typeof r.dials === "string" ? (() => { try { return JSON.parse(r.dials); } catch { return {}; } })() : r.dials; return { ...r, dials: d ?? {} }; };
  const taken = stockedClass ? stolenRefusal(stockedClass, recOf, (n) => (law.classes.get(String(n))?.extends ? String(law.classes.get(String(n)).extends) : null)) : null;
  if (taken) return { waits: `a class is taken by the town's own act (${taken.stolen}) — the first stock makes units of the class this chest stocks, so each chest is stocked at the first settlement after it is returned` };
  const chestRec = law.classes.get("chest") ?? null;
  // A STALLED INGEST IS NOT AN EMPTY LAW (POS-627, review-612 F1): with no chest
  // class AND a newer blessing whose law is not ingested, the class may be in
  // that law, so the line names the stall (the keep tick reads it refused
  // prereq:law) instead of the honest empty (read ok prereq:chest_class).
  if (!chestRec) return { unreadable: law.pin.newest > law.pin.settlement
    ? `the law at S${law.pin.settlement} declares no chest class, and S${law.pin.newest}'s law is not ingested yet — nothing is stocked until it is`
    : `the law at S${law.pin.settlement} declares no chest class — nothing to stock` };
  const dials = typeof chestRec.dials === "string" ? JSON.parse(chestRec.dials) : (chestRec.dials ?? {});
  const admitted = (await client.query(CHESTS_SQL)).rows
    // a row that names no admitting settlement is not admitted, whatever read it
    .filter((r) => Number.isInteger(Number(r.settlement)) && r.settlement != null)
    .map((r) => {
      const d = typeof r.data === "string" ? JSON.parse(r.data) : (r.data ?? {});
      return { id: String(r.slug), by: String(d.by ?? r.owner ?? String(r.slug).split("/")[0]), capacity: d.capacity ?? null, settlement: Number(r.settlement) };
    });
  const units = (await client.query(UNITS_SQL)).rows;
  const { rows: held } = await pgAttachmentsFor(client);
  const plan = planChestStock({ chests: admitted, labels: candyLabels(candy), stocked: stockedChests(units), fold: foldUnits(units), dials, thingsIn: thingsInChests(held) });
  const settlementOf = new Map(admitted.map((c) => [c.id, c.settlement]));
  const candyLaws = plan.stock.length ? (await client.query(CANDY_LAWS_SQL)).rows : [];
  return { ...plan, stock: plan.stock.map((s) => {
    const settlement = settlementOf.get(s.chest);
    return { ...s, settlement, decided: decidedAt({ admitted: settlement, label: s.label, creator: s.handle, candyLaws, pin: law.pin.settlement }) };
  }), dials: chestDials(dials), law: law.pin };
}

/**
 * Stock what the plan says, EACH CHEST IN ITS OWN TRANSACTION UNDER ITS OWN
 * LOCK (finding 6): the chest's advisory lock (chest-lock.mjs, the same one an
 * office give, refill or thing-put takes inside its write), then its count
 * re-read there, then the stock decided — `min(first_stock, capacity)` less
 * everything already in it — and written. A give racing the tick either lands
 * before the lock (and is counted) or waits for this commit (and is judged
 * against the stocked chest). Answers `{ stocked, skipped, unstocked, refused, line }`.
 */
export async function stockChests(client, { crossing = null } = {}) {
  const plan = await planFromStore(client);
  if (plan.unreadable) return { stocked: [], skipped: [], unstocked: [], refused: [], line: `chests: not stocked — ${plan.unreadable}` };
  if (plan.waits) return { stocked: [], skipped: [], unstocked: [], refused: [], waits: true, line: `chests: not stocked — ${plan.waits}` };
  const stocked = [], skipped = [];
  for (const s of plan.stock) {
    await client.query("BEGIN");
    try {
      const used = await lockedChestUse(client, s.chest);
      // a chest whose maker withdrew it takes no stock, even one planned before (F1)
      if (used.withdrawn) { await client.query("ROLLBACK"); skipped.push({ chest: s.chest, why: "withdrawn before its stock" }); continue; }
      // min(first_stock, capacity), never past what is already inside (units and things, a holder counting 1 and all it holds)
      const room = Math.min(Math.min(plan.dials.first_stock, s.capacity), s.capacity - used.load);
      // ZERO ROOM COMPLETES THE FIRST STOCK (Wright, 2026-10-13T01:19Z): a
      // labelled, admitted chest that is already full is stocked ZERO — the act
      // is written with no move (so the fold mints no zero edge and names no
      // anomaly), the nonce is spent, and the line says so. The gift is never
      // deferred to a later tick that finds room; refill is the creator's after.
      const n = Math.max(0, room);
      // TWO SETTLEMENTS, BOTH NAMED (Bevel's revised review, C): `settlement`
      // is the one that ADMITTED the chest (mark_carried) and stays so; the
      // stock is DECIDED at the settlement whose law found the creator's label —
      // the same as admission when the label was there, a later one when it
      // was registered after. The receipt names the decision, and the
      // admission beside it when they differ; never a decision before the label.
      const decided = s.decided;
      const payload = { units: true, moves: n > 0 ? [{ from: null, to: s.chest, label: s.label, n }] : [], label: s.label, stocked: n,
        capacity: s.capacity, creator: s.handle, settlement: s.settlement, label_found_at: plan.law?.settlement ?? null, decided_at: decided, first_stock: true };
      const effect = n > 0
        ? (decided === s.settlement
          ? `the town stocked ${s.chest} with ${n} ${s.label} at the settlement that admitted it (S${s.settlement})`
          : `the town stocked ${s.chest} with ${n} ${s.label} at S${decided}, the settlement that found its creator's candy label (the chest was admitted at S${s.settlement})`)
        : `chest-stock: 0, chest full at S${decided}${admittedNote(s.settlement, decided)} — the first stock of ${s.chest} is complete; refill is its creator's`;
      const { rows } = await client.query(INSERT_SQL, [crossing, TOWN_PEN, UNIT_ACTION.stock, s.chest, JSON.stringify(payload), effect, TOWN_HOUSEHOLD, stockNonce(s.chest)]);
      await client.query("COMMIT");
      if (rows.length) stocked.push({ ...s, n, act: Number(rows[0].id) }); else skipped.push({ chest: s.chest, why: "already stocked (the nonce was spent)" });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    }
  }
  const parts = [
    `chests: stocked ${stocked.filter((s) => s.n > 0).length}${stocked.some((s) => s.n > 0) ? ` (${stocked.filter((s) => s.n > 0).map((s) => `${s.chest} +${s.n} ${s.label} at S${s.decided}${admittedNote(s.settlement, s.decided)}`).join(", ")})` : ""}`,
    ...stocked.filter((s) => s.n === 0).map((s) => `chest-stock: 0, chest full at S${s.decided}${admittedNote(s.settlement, s.decided)} (${s.chest})`),
    ...plan.unstocked.map((u) => u.line),
    ...plan.refused.map((r) => r.line),
  ];
  return { stocked, skipped, unstocked: plan.unstocked, refused: plan.refused, line: parts.join(" · ") };
}
