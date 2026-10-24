// creature-endings.mjs — A NAMED CREATURE'S ENDING, AT THE SETTLEMENT (WLD-25).
//
// RULED (Darko, 2026-10-20 22:47 and 22:56 EDT): a named creature stays until
// it is finished, by whatever road; what it carries drops AT THE SETTLEMENT, not
// live, so others can still take part in the window; it goes to the FIRST
// resident to finish, by record order, on either road; EVERYONE WHO TOOK PART is
// named; and that settlement retires the creature for the whole town.
//
// ENGINEERING SETTLED (Wright, 2026-10-20, from the gap read, W1–W11):
//
//   · W1  WHERE: here, on the office tick (settlements-backfill.mjs --apply, as
//         `office_api`, the pen that already writes `acts`), after the settlement
//         LANDED. Not the clearing, whose pen would need a trigger arm (a box
//         migration), and not the creature clock, which knows the time but not
//         whether a blessing was refused. No migration.
//   · W2  THE CUTOFF: a finish counts when the resident's own act that earned it
//         is before the nominal instant (06:00/18:00Z, world-forecast.mjs § the
//         one clock) of the newest settlement that landed. A refused blessing
//         leaves the finishes waiting for the next one that lands.
//   · W3  FIRST = the lowest act id among the finishers' own acts (the record's
//         order), never when a finish row happened to be written.
//   · W8  FAIL CLOSED: the world's folds honour a withdraw only for a reason in
//         DESPAWN_REASONS at the blessed ref. Until that law carries "ended", an
//         ending written here would leave the creature alive to every fold, so
//         nothing is written and the line says so.
//   · ONCE: one transaction per creature, under an advisory lock, that looks for
//         its withdraw first. A replay, a retry or two ticks racing end it once.
//
// WHAT AN ENDING WRITES (one transaction; nothing when any part cannot be written):
//   · when the creature carries a thing: the town's `give` of it into the first
//     finisher's hands (class holding; the hold record's last row wins, as for
//     POS-688's returns), so it is theirs to give and trade (the owner's own act,
//     the town's, passes ownership). A thing that is not standing holds the
//     whole ending back, said by name, and it is tried again next tick.
//   · the town's `withdraw` of the creature, reason `ended`, naming the finisher,
//     their act, everyone who took part, what it carried and the settlement.
//
// SETTLED (WLD-25 D1–D6, by Wright under Darko's delegation, 2026-10-21; each one
// constant here): D1 who "took part" (TOOK_PART: every act it answered, since
// every act in an encounter's ring costs nerve), D2 over its whole life (the
// reads have no lower bound), D4 the thing goes to full hands too (no capacity
// check), D5 the words (NAMES_SHOWN and the lines below).
//
// THE OFFICE'S CODE NAMES NO PLACE, NO THING AND NO ROLE: what a creature
// carries is whatever its declaration names, and the world's kind may write its
// own ending line (`ending:`, with {finisher}, {names} and {carried}).

import { settlementAtOrBefore } from "../../src/world-forecast.mjs";
import { currentCrossing } from "../../src/crossings.mjs";

export const CREATURE = "creature";
export const TOWN = "the-town";
export const ENDED = "ended";
/** The town's act that turns a class back on at a fight's ending (a fight in set pieces' restore step). */
export const RESTORE = "restore";
/** The anchor every creature row stands on (src/world-journal.mjs § WORLD_ANCHOR, not imported: that module opens the pens). */
export const WORLD_ANCHOR = "the-town/let-there-be-light";

/** A dial that is settled: its value, and the call that settled it. */
const ruled = (value, call) => Object.freeze({ value, ruled: call });

/**
 * D1, WHO TOOK PART (one function, so either answer is a one-line change):
 *   "aimed"     an act of theirs aimed at the creature (its object is the creature,
 *               or a walk toward it) that it answered
 *   "answered"  any act of theirs it answered, aimed or only inside its ring: SETTLED
 *               (every act in an encounter's ring costs nerve, so every one it answered took part)
 * Finishers always took part.
 */
export const TOOK_PART = ruled("answered", "WLD-25 D1, settled by Wright under Darko's delegation, 2026-10-21");
/** D5: how many names the ending's line says before "and N more"; the row lists every one. */
export const NAMES_SHOWN = ruled(12, "WLD-25 D5, settled by Wright under Darko's delegation, 2026-10-21");

const isNum = (v) => /^[0-9]+$/.test(String(v ?? ""));
const asObj = (v) => (typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return {}; } })() : (v ?? {}));
const idCmp = (a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);

// ── the reads ───────────────────────────────────────────────────────────────

/** The newest settlement that landed: { number, published_at }. */
export const NEWEST_SETTLEMENT_SQL = `SELECT number, published_at FROM settlements ORDER BY number DESC LIMIT 1`;
/** Every creature that stays and has not been withdrawn: its spawn row. */
export const STAYING_SPAWNS_SQL = `SELECT s.id::text AS id, s.object, s.payload FROM acts s
  WHERE s.class = '${CREATURE}' AND s.action = 'spawn' AND s.actor = '${TOWN}' AND s.payload->>'stays' = 'true'
    AND NOT EXISTS (SELECT 1 FROM acts w WHERE w.class = '${CREATURE}' AND w.action = 'withdraw' AND w.object = s.object)
  ORDER BY s.id`;
/** Its finishes whose earning act is before the cutoff ($2): who, and their act. */
export const FINISHES_SQL = `SELECT f.payload->>'by' AS by, t.id::text AS act_id, t.actor AS act_actor FROM acts f
  JOIN acts t ON t.id = CASE WHEN f.payload->>'act' ~ '^[0-9]+$' THEN (f.payload->>'act')::bigint END
  WHERE f.class = '${CREATURE}' AND f.action = 'finish' AND f.actor = $1 AND t.at < $2
  ORDER BY t.id`;
/** The acts it answered before the cutoff ($2): whose, and what each was aimed at. */
export const ANSWERED_SQL = `SELECT t.id::text AS act_id, t.actor, t.object, t.payload->>'approach' AS approach FROM acts r
  JOIN acts t ON t.id = CASE WHEN r.object ~ '^[0-9]+$' THEN r.object::bigint END
  WHERE r.class = '${CREATURE}' AND r.action = 'react' AND r.actor = $1 AND t.at < $2
  ORDER BY t.id`;
/**
 * A CREATURE THAT TEMPTS ends by its two tallies over the window the settlement
 * closed (src/temptation.mjs): its strikes' damage and its tally rows, in [$2, $3).
 */
export const TALLY_ROWS_SQL = `SELECT action, actor, object, payload FROM acts
  WHERE class = '${CREATURE}' AND at >= $2::timestamptz AND at < $3::timestamptz
    AND ((action = 'strike' AND object = $1) OR (action = 'tally' AND actor = $1))`;

/** Its tallies from those rows: { damage, persuasion }, damage never below 0. */
export function talliesFrom(rows = []) {
  let damage = 0, persuasion = 0;
  for (const r of rows) {
    const p = asObj(r.payload), by = Number(p.by), dmg = Number(p.damage);
    if (r.action === "strike" && Number.isFinite(dmg)) damage += dmg;
    else if (r.action === "tally" && Number.isFinite(by)) { if (p.road === "damage") damage += by; else if (p.road === "persuasion") persuasion += by; }
  }
  return { damage: Math.max(0, damage), persuasion: Math.max(0, persuasion) };
}

/** The road its tallies pick: the larger, a tie to persuasion (settled); null when both are 0 (it stays, and the window rolls). */
export function roadFrom({ damage, persuasion }) {
  if (!(damage > 0) && !(persuasion > 0)) return null;
  return persuasion >= damage ? "persuasion" : "damage";
}

/**
 * A tempting creature's ending at this settlement, or null while both tallies
 * are 0. Everyone it answered took part (D1), and everyone a tally names. The
 * line is its menu's ending for the road, then who took part.
 */
export function planTallyEnding({ spawn, rows, answered, settlement, cutoff, menu = null }) {
  const t = talliesFrom(rows);
  const road = roadFrom(t);
  if (!road) return null;
  const p = asObj(spawn.payload);
  const id = spawn.object, kind = String(p.kind ?? CREATURE);
  const tallied = rows.map((r) => (r.action === "strike" ? r.actor : r.object)).filter(resident);
  const took = [...new Set([...tookPart(id, answered, [], { mode: "answered" }), ...tallied])];
  const ending = menu?.endings?.[road] ?? null;
  const names = namesSaid(took);
  return {
    id, kind, x: Number(p.x), y: Number(p.y), road, damage: t.damage, persuasion: t.persuasion, took_part: took, carries: null,
    finisher: null, act: null, settlement: Number(settlement), cutoff,
    line: `${ending?.text ?? `The ${kind}'s fight is over: ${road} won it.`}${names ? ` ${names} took part.` : ""}`,
  };
}

/**
 * A FIGHT IN SET PIECES ends by its sanity (src/set-pieces.mjs): the set pieces it
 * reached (every phase row before the cutoff, $3) and its sanity rows over the
 * window the settlement closed, [$2, $3).
 */
export const FIGHT_ROWS_SQL = `SELECT id::text AS id, at, action, object, payload FROM acts
  WHERE class = '${CREATURE}' AND actor = $1 AND at < $3::timestamptz
    AND (action = 'phase' OR (action = 'sanity' AND at >= $2::timestamptz))
  ORDER BY acts.id`;

/**
 * Its sanity at the settlement and whether that ends it: { full, sanity, of }.
 * Only in its last set piece, counted from when that piece began when it began in
 * this window (sanity is 0 there), and never above the most.
 */
export function fightSanity(rows = [], fight, { from }) {
  const phases = rows.filter((r) => r.action === "phase");
  const top = phases.reduce((a, b) => (Number(asObj(b.payload).index) >= Number(asObj(a?.payload ?? { index: -1 }).index) ? b : a), null);
  const index = top ? Number(asObj(top.payload).index) : 0;
  const last = index >= fight.pieces.length - 1;
  const entry = top && Date.parse(top.at instanceof Date ? top.at.toISOString() : top.at) >= Date.parse(from) ? top : null;
  let sum = 0;
  for (const r of rows) if (r.action === "sanity" && (!entry || idCmp(r.id, entry.id) > 0)) sum += Number(asObj(r.payload).by) || 0;
  const sanity = Math.max(0, Math.min(fight.sanity_max, sum));
  return { full: last && sanity >= fight.sanity_max, sanity, of: fight.sanity_max };
}

/**
 * A fight's ending at this settlement, or null while its sanity is not full in
 * its last set piece. Everyone it answered took part (D1), and everyone a sanity
 * row names. Its kind's own ending line, or the town's plain words; and the class
 * its fight file says the ending turns back on.
 */
export function planFightEnding({ spawn, rows, answered, settlement, cutoff, from, fight, kindFile = null }) {
  const f = fightSanity(rows, fight, { from });
  if (!f.full) return null;
  const p = asObj(spawn.payload);
  const id = spawn.object, kind = String(p.kind ?? CREATURE);
  const raised = rows.filter((r) => r.action === "sanity").map((r) => r.object).filter(resident);
  const took = [...new Set([...tookPart(id, answered, [], { mode: "answered" }), ...raised])];
  const names = namesSaid(took);
  const line = typeof kindFile?.ending === "string" && kindFile.ending.trim()
    ? kindFile.ending.replaceAll("{names}", () => names || "no one").replaceAll("{finisher}", () => took[0] ?? "no one").replaceAll("{carried}", () => "nothing")
    : `The ${kind}'s fight is over: its sanity is whole again.${names ? ` ${names} took part.` : ""}`;
  return {
    id, kind, x: Number(p.x), y: Number(p.y), sanity: f.sanity, of: f.of, took_part: took, carries: null,
    finisher: null, act: null, settlement: Number(settlement), cutoff, line,
    ...(fight.restores ? { restores: fight.restores } : {}),
  };
}

/** Is the thing it carries a standing mark? */
export const THING_STANDING_SQL = `SELECT 1 AS here FROM marks WHERE slug = $1 AND status = 'standing' LIMIT 1`;
/** The thing's latest hold row: who holds it now, for the give's `previous_holder`. */
export const THING_HOLDER_SQL = `SELECT payload->>'holder' AS holder, payload->>'policy' AS policy FROM acts
  WHERE class = 'holding' AND object = $1 ORDER BY id DESC LIMIT 1`;
export const PRIOR_WITHDRAW_SQL = `SELECT id::text AS id FROM acts WHERE class = '${CREATURE}' AND action = 'withdraw' AND object = $1 LIMIT 1`;

// ── the pure half ───────────────────────────────────────────────────────────

/** A resident's handle, never a creature or the town. */
const resident = (h) => typeof h === "string" && h !== "" && h !== TOWN && !h.startsWith(`${CREATURE}:`);

/**
 * D1: who took part, by their first act, earliest first. `answered` are
 * ANSWERED_SQL's rows, `finishers` FINISHES_SQL's. Every finisher took part.
 */
export function tookPart(creatureId, answered = [], finishers = [], { mode = TOOK_PART.value } = {}) {
  const first = new Map(); // handle → their first act id
  const note = (h, id) => { if (resident(h) && isNum(id) && (!first.has(h) || idCmp(id, first.get(h)) < 0)) first.set(h, String(id)); };
  for (const r of answered) {
    const aimed = r.object === creatureId || r.approach === creatureId;
    if (mode === "answered" || aimed) note(r.actor, r.act_id);
  }
  for (const f of finishers) note(f.by, f.act_id);
  return [...first.entries()].sort((a, b) => idCmp(a[1], b[1])).map(([h]) => h);
}

/** The first finisher, by record order: { by, act_id }, or null when none counts yet. */
export function firstFinisher(finishers = []) {
  const ok = finishers.filter((f) => resident(f.by) && isNum(f.act_id) && f.by === f.act_actor);
  return ok.sort((a, b) => idCmp(a.act_id, b.act_id))[0] ?? null;
}

/** "a, b and c", the first `most` names, then "and N more". */
export function namesSaid(names, most = NAMES_SHOWN.value) {
  const shown = names.slice(0, most), rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  return shown.length <= 1 ? shown.join("") : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

/** D5: the ending's line. The kind's own `ending:` template when it writes one, else the town's plain words. */
export function endingLine({ kind, kindFile = null, finisher, others, carried = null }) {
  const names = namesSaid(others);
  if (typeof kindFile?.ending === "string" && kindFile.ending.trim())
    return kindFile.ending.replaceAll("{finisher}", () => finisher).replaceAll("{names}", () => names || "no one else")
      .replaceAll("{carried}", () => carried ?? "nothing");
  return `The ${kind} is finished. ${finisher} finished it first${names ? `; ${names} took part` : ""}.`;
}

/**
 * One creature's ending at this settlement, or null when no finish counts yet.
 *   spawn      STAYING_SPAWNS_SQL's row
 *   finishers  FINISHES_SQL's rows, answered ANSWERED_SQL's (both before the cutoff)
 */
export function planEnding({ spawn, finishers, answered, settlement, cutoff, kindFile = null, mode = TOOK_PART.value }) {
  const first = firstFinisher(finishers);
  if (!first) return null;
  const p = asObj(spawn.payload);
  const id = spawn.object, kind = String(p.kind ?? CREATURE), carried = typeof p.carries === "string" ? p.carries : null;
  const took = tookPart(id, answered, finishers, { mode });
  const others = took.filter((h) => h !== first.by);
  return {
    id, kind, x: Number(p.x), y: Number(p.y), finisher: first.by, act: first.act_id, took_part: took, carries: carried,
    settlement: Number(settlement), cutoff,
    line: endingLine({ kind, kindFile, finisher: first.by, others, carried }),
    give_line: carried ? `at the settlement, the town puts ${carried} in ${first.by}'s hands` : null,
  };
}

// ── the write ───────────────────────────────────────────────────────────────

/**
 * Every named creature whose finish counts at the newest landed settlement,
 * ended. `client` is a pg client outside any transaction; `law` is
 * src/creatures.mjs § loadCreatureLaw's answer at the blessed ref (its
 * DESPAWN_REASONS and kinds). Answers { ended: [plan], waits: [why], failed: [why], line }.
 */
export async function endCreatures(client, { law, now = Date.now(), mode = TOOK_PART.value } = {}) {
  const say = (rest) => `endings: ${rest}`;
  if (!law || law.unavailable || !Array.isArray(law.creaturesMod?.DESPAWN_REASONS))
    return { ended: [], waits: [], line: say(`none ended — the creature law cannot be read at the blessed ref${law?.unavailable ? ` (${law.unavailable})` : ""}`) };
  const { rows: staying } = await client.query(STAYING_SPAWNS_SQL);
  if (!staying.length) return { ended: [], waits: [], line: say("none ended — no creature stays") };
  if (!law.creaturesMod.DESPAWN_REASONS.includes(ENDED))
    return { ended: [], waits: [], line: say(`none ended — the blessed law has no "${ENDED}" reason yet, so an ending would not hold (${staying.length} staying)`) };
  const { rows: [s] } = await client.query(NEWEST_SETTLEMENT_SQL);
  if (!s) return { ended: [], waits: [], line: say("none ended — no settlement has landed") };
  const cutoff = settlementAtOrBefore(new Date(s.published_at));
  const ended = [], waits = [], failed = [];
  for (const spawn of staying) {
    const kindName0 = asObj(spawn.payload).kind;
    let kindFile0 = null;
    try { kindFile0 = law.kindOf?.(kindName0) ?? null; } catch { kindFile0 = null; }
    // A FIGHT IN SET PIECES: its sanity full in its last set piece, over the window this settlement closed, ends it
    if (typeof kindFile0?.fight === "string") {
      let fight = null;
      try { fight = law.fightOf?.(kindName0) ?? null; } catch { fight = null; }
      if (!fight) { waits.push(`${spawn.object}: its fight file cannot be read at the blessed ref, so nothing ends it`); continue; }
      const from = settlementAtOrBefore(new Date(Date.parse(cutoff) - 1));
      const { rows } = await client.query(FIGHT_ROWS_SQL, [spawn.object, from, cutoff]);
      const { rows: answered } = await client.query(ANSWERED_SQL, [spawn.object, cutoff]);
      const plan = planFightEnding({ spawn, rows, answered, settlement: s.number, cutoff, from, fight, kindFile: kindFile0 });
      if (!plan) continue;
      try {
        const r = await writeEnding(client, plan, { now });
        if (r.wrote) ended.push(plan);
        else if (r.why) waits.push(`${plan.id}: ${r.why}`);
      } catch (e) { failed.push(`${plan.id}: ${String(e?.message ?? e).slice(0, 160)}`); }
      continue;
    }
    // A CREATURE THAT TEMPTS: its tallies over the window this settlement closed pick its road
    if (typeof kindFile0?.tempts === "string") {
      const from = settlementAtOrBefore(new Date(Date.parse(cutoff) - 1));
      const { rows } = await client.query(TALLY_ROWS_SQL, [spawn.object, from, cutoff]);
      const { rows: answered } = await client.query(ANSWERED_SQL, [spawn.object, cutoff]);
      let menu = null;
      try { menu = law.menuOf?.(kindName0) ?? null; } catch { menu = null; }
      const plan = planTallyEnding({ spawn, rows, answered, settlement: s.number, cutoff, menu });
      if (!plan) continue;
      try {
        const r = await writeEnding(client, plan, { now });
        if (r.wrote) ended.push(plan);
        else if (r.why) waits.push(`${plan.id}: ${r.why}`);
      } catch (e) { failed.push(`${plan.id}: ${String(e?.message ?? e).slice(0, 160)}`); }
      continue;
    }
    const { rows: finishers } = await client.query(FINISHES_SQL, [spawn.object, cutoff]);
    if (!finishers.length) continue;
    const { rows: answered } = await client.query(ANSWERED_SQL, [spawn.object, cutoff]);
    const kindName = asObj(spawn.payload).kind;
    let kindFile = null;
    try { kindFile = law.kindOf?.(kindName) ?? null; } catch { kindFile = null; }
    const plan = planEnding({ spawn, finishers, answered, settlement: s.number, cutoff, kindFile, mode });
    if (!plan) continue;
    try {
      const r = await writeEnding(client, plan, { now });
      if (r.wrote) ended.push(plan);
      else if (r.why) waits.push(`${plan.id}: ${r.why}`);
    } catch (e) {
      failed.push(`${plan.id}: ${String(e?.message ?? e).slice(0, 160)}`);
    }
  }
  // a wait is the design (it is tried again next tick); a failure fails again every tick, so it is its own segment and alarms
  const line = say([
    `ended ${ended.length}${ended.length ? ` (${ended.map((p) => `${p.id} → ${p.road ?? p.finisher}`).join(", ")})` : ""} at S${s.number}, cutoff ${cutoff}`,
    ...(waits.length ? [`${waits.length} waiting (${waits.join("; ")})`] : []),
    ...(failed.length ? [`${failed.length} failed (${failed.join("; ")})`] : []),
  ].join(" · "));
  return { ended, waits, failed, line };
}

/** One ending, one transaction: { wrote: true }, or { wrote: false, why } (already ended, or what it carries is not standing). */
export async function writeEnding(client, plan, { now = Date.now() } = {}) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`creature-ending:${plan.id}`]);
    const { rows: before } = await client.query(PRIOR_WITHDRAW_SQL, [plan.id]);
    if (before.length) { await client.query("ROLLBACK"); return { wrote: false, why: null }; }
    const crossing = currentCrossing(now);
    if (plan.carries) {
      const { rows: here } = await client.query(THING_STANDING_SQL, [plan.carries]);
      if (!here.length) { await client.query("ROLLBACK"); return { wrote: false, why: `what it carries, ${plan.carries}, is not standing, so it waits` }; }
      const { rows: [last] } = await client.query(THING_HOLDER_SQL, [plan.carries]);
      const previous = last?.policy === "cascade" && last.holder ? last.holder : null;
      await client.query(
        `INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect)
         VALUES (now(), $1, '${TOWN}', 'give', $2, 'holding', $3::jsonb, $4)`,
        [crossing, plan.carries, JSON.stringify({ thing: plan.carries, holder: plan.finisher, policy: "cascade", previous_holder: previous,
          ended: { creature: plan.id, act: plan.act, settlement: plan.settlement } }), plan.give_line]);
    }
    await client.query(
      `INSERT INTO acts (at, crossing, actor, action, object, at_anchor, at_dx, at_dy, class, payload, effect)
       VALUES (now(), $1, '${TOWN}', 'withdraw', $2, $3, $4, $5, '${CREATURE}', $6::jsonb, $7)`,
      [crossing, plan.id, Number.isFinite(plan.x) ? WORLD_ANCHOR : null, Number.isFinite(plan.x) ? plan.x : null, Number.isFinite(plan.y) ? plan.y : null,
        JSON.stringify({ reason: ENDED, ...(plan.road ? { road: plan.road, damage: plan.damage, persuasion: plan.persuasion }
          : plan.sanity != null ? { sanity: plan.sanity, of: plan.of, ...(plan.restores ? { restores: plan.restores } : {}) } : { finished_by: plan.finisher, act: plan.act }), took_part: plan.took_part,
          ...(plan.carries ? { carried: plan.carries } : {}), settlement: plan.settlement, cutoff: plan.cutoff }), plan.line]);
    // THE CLASS ITS FIGHT TURNS BACK ON (a fight in set pieces' restore step): the town's own act, in the same transaction
    if (plan.restores) await client.query(
      `INSERT INTO acts (at, crossing, actor, action, object, class, payload, effect)
       VALUES (now(), $1, '${TOWN}', '${RESTORE}', $2, '${CREATURE}', $3::jsonb, $4)`,
      [crossing, plan.restores, JSON.stringify({ class: plan.restores, by: plan.id, settlement: plan.settlement, cutoff: plan.cutoff }), `the ${plan.restores} class is restored`]);
    await client.query("COMMIT");
    return { wrote: true };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  }
}
