#!/usr/bin/env node
// pos-943-finch-set-down.mjs — set finch down at the Snug Jetty, the deposit his exit never made (POS-943).
//
//   node tools/pos-943-finch-set-down.mjs --boarded <act id> [--expect-newest <act id>] [--json]          a DRY RUN (the default)
//   node tools/pos-943-finch-set-down.mjs --boarded <act id> --expect-newest <act id> --apply --expect-last <act id> [--json]
//
// A ONE-OFF, FOR EXACTLY ONE AUTHORISED HAND REPAIR (Wright, 2026-11-07 21:41Z, on POS-943; Rivet's plan,
// 16:41 EST). finch entered the-town/the-post-office through current-the-reader/the-snug-jetty, declared no
// ride, and exited with no deposit: no `set_down_at`, no land after it, so his next walk started from a point
// about 100 km out (acts 46971, 46978, 46979 when filed: pointers, read again here, never assumed). The repair
// is the land his exit owed, and nothing else: actor finch, `declared_by: "the-town"`, at, from and toward
// (-415, 4905), pace null, via current-the-reader/the-snug-jetty, why "deposit" (what the exit owed; the town's
// hand is what marks it a repair). Every act already written stays, the bad walk included.
//
// THE NORMAL LANDING, WITH THE TOWN'S HAND. It is world.mjs § landAt's write, step for step: landEntry, the
// engine's fractional crossing, one clock read, the witness stamp, the walk lane's pen (flipped or not), and the
// position projection in the same step. landAt itself can't write it, because it files every landing as
// declared by the one it sets down (`declaredBy: who`), and this landing is the town's. landEntry already takes
// `declaredBy`, so no shared source changes. The live office hears the act through its departure head read
// (POS-691), as it hears tools/set-down-ashore.mjs's. No exit is made: the guards below require finch within
// nothing.
//
// THE GUARDS. Each refuses by name and writes nothing:
//   · THE BOARDING, BY ITS OWN ACT (--boarded, Wright 17:01 EST): that act is finch's `enter` of the Post Office
//     (its object, or its summary "enters the-town/the-post-office via current-the-reader/the-snug-jetty"), and
//     its raw payload's `via` is the Snug Jetty. No fold reads the history: world-ride § rideStateFrom found no
//     stop in the store's own rows (the 1a212ee9 dry run), and that is the class fix's to explain;
//   · the stranded exit: finch's first exit from the Post Office after that act carries no `set_down_at`, and no
//     ride (which would owe its own destination) and no land stands between the two;
//   · ALREADY REPAIRED: any land of finch's after that exit (this repair, or any other set-down) refuses, so a
//     second --apply is a no-op that says so;
//   · nothing has moved him into anything: no enter or exit of finch's after that exit; and each thing his
//     occupancy now (DEC-5's read) holds him within must contain the landing point, by the clone's own
//     containment (pointWithinMark: the mark's polygon, else its extent). Unknown or outside refuses; no exit is
//     made (Wright, 22:11Z, "(b), narrowed": finch is within spar/the-doubled-coast, and the jetty lies in it);
//   · the point: the deposit rule's own point for the Snug Jetty (world-ride § depositPointFor) is the
//     authorised (-415, 4905);
//   · STALE: --apply needs --expect-last, the id of finch's newest movement act (walk, land, enter, exit, ride)
//     as the dry run printed it. Any later move invalidates the reviewed dry run: run it again;
//   · NEWEST: --expect-newest names finch's newest act of ANY kind (Wright's go, 22:11Z, condition 1: "finds
//     finch's newest act is still 47026"). A dry run given it refuses unless it still is, and --apply needs it.
// On --apply the act-reading guards run again INSIDE the pen's own transaction (penWrite's `guard`), under an
// advisory lock on this repair, so two applies can't both write.
//
// Needs the store and the world: the office's own environment (on the box: the office's env file, as meepo).
//
// EXIT: 0 a dry run whose guards pass, or written · 1 refused (nothing written) · 2 cannot run (usage, no store)

import { realpathSync } from "node:fs";

export const REPAIR = Object.freeze({
  actor: "finch",
  vessel: "the-town/the-post-office",
  stop: "current-the-reader/the-snug-jetty",
  at: Object.freeze({ x: -415, y: 4905 }),
  declaredBy: "the-town",
  why: "deposit",
});
/** The acts that place or carry a resident: what the stale guard pins. */
export const MOVE_ACTIONS = Object.freeze(["legacy:departure", "walk", "land", "enter", "exit", "ride"]);
export const REPAIR_LOCK = "pos-943:finch-set-down";
export const ACTS_SQL = "SELECT id, at, actor, action, object, payload, household FROM acts WHERE actor = $1 ORDER BY id";

const payloadOf = (a) => (typeof a?.payload === "string" ? JSON.parse(a.payload) : (a?.payload ?? {}));
const idOf = (a) => Number(a.id);

/**
 * Judge the repair against finch's acts as the store returns them (`{ id, at, action, object, payload,
 * household }`; ids may be text, payloads text or objects). PURE. `boarded` is the boarding act's id, named by
 * the operator (--boarded): THE ACT ITSELF is read, never a fold over the history (Wright, 17:01 EST: "the
 * instance repair shouldn't use the same fold that's broken"; world-ride § rideStateFrom found no stop in these
 * rows, which is POS-943's class question, not this one's). Returns `{ ok: true, enter, exit, between, after,
 * newestMove, household }`, or `{ ok: false, why, already? }`.
 */
export function judgeRepair(acts, { boarded, expectLast = null, expectNewest = null } = {}) {
  const rows = (acts ?? []).map((a) => ({ ...a, id: idOf(a), payload: payloadOf(a) })).sort((a, b) => a.id - b.id);
  const enter = rows.find((a) => a.id === Number(boarded)) ?? null;
  if (!enter) return { ok: false, why: `act ${boarded} is not one of ${REPAIR.actor}'s acts` };
  const boardsHere = `enters ${REPAIR.vessel} via ${REPAIR.stop}`;
  if (enter.actor != null && enter.actor !== REPAIR.actor) return { ok: false, why: `act ${enter.id} is ${enter.actor}'s, not ${REPAIR.actor}'s` };
  if (enter.action !== "enter") return { ok: false, why: `act ${enter.id} is ${REPAIR.actor}'s ${enter.action}, not an enter` };
  // the Post Office, by the act's object, or, failing that, by its own summary's words
  if (enter.object !== REPAIR.vessel && enter.payload.summary !== boardsHere)
    return { ok: false, why: `act ${enter.id} enters ${enter.object ?? "nothing"} (its summary: ${JSON.stringify(enter.payload.summary ?? null)}), not ${REPAIR.vessel}` };
  if (enter.payload.via !== REPAIR.stop)
    return { ok: false, why: `act ${enter.id}'s payload boards via ${JSON.stringify(enter.payload.via ?? null)}, not ${REPAIR.stop}` };
  const exit = rows.find((a) => a.id > enter.id && a.action === "exit" && a.object === REPAIR.vessel) ?? null;
  if (!exit) return { ok: false, why: `${REPAIR.actor} has no exit from ${REPAIR.vessel} after act ${enter.id}` };
  if (exit.payload.set_down_at)
    return { ok: false, why: `${REPAIR.actor}'s exit after the boarding (act ${exit.id}) set them down at ${exit.payload.set_down_at}: not the stranded exit` };
  const between = rows.filter((a) => a.id > enter.id && a.id < exit.id);
  const owed = between.find((a) => a.action === "ride" || a.action === "land");
  if (owed)
    return { ok: false, why: `act ${owed.id}, a ${owed.action}, stands between the boarding (act ${enter.id}) and the exit (act ${exit.id}): ${owed.action === "ride" ? "a ride owes its own deposit" : "something set them down aboard"}, which this repair does not judge` };
  const after = rows.filter((a) => a.id > exit.id);
  const landed = after.find((a) => a.action === "land");
  if (landed) {
    const ours = landed.payload.declared_by === REPAIR.declaredBy && landed.object === REPAIR.stop;
    return { ok: false, already: ours, why: ours
      ? `ALREADY REPAIRED: act ${landed.id} set ${REPAIR.actor} down at ${REPAIR.stop}, declared by ${REPAIR.declaredBy}`
      : `${REPAIR.actor} has been set down since the exit (act ${landed.id}, via ${landed.object ?? "nothing"}): nothing is stranded to repair` };
  }
  const crossed = after.find((a) => a.action === "enter" || a.action === "exit");
  if (crossed)
    return { ok: false, why: `${REPAIR.actor} has ${crossed.action === "enter" ? "entered" : "exited"} ${crossed.object ?? "?"} since the exit (act ${crossed.id}): the state moved, a person reads it first` };
  const newestMove = rows.filter((a) => MOVE_ACTIONS.includes(a.action)).at(-1) ?? null;
  if (expectLast != null && Number(expectLast) !== newestMove?.id)
    return { ok: false, why: `STALE: ${REPAIR.actor}'s newest movement act is ${newestMove?.id ?? "none"}, not the ${expectLast} the reviewed dry run named: run the dry run again` };
  // WRIGHT'S CONDITION (1), 22:11Z: the newest act of ANY kind is the one his go named (47026, a say)
  const newest = rows.at(-1) ?? null;
  if (expectNewest != null && Number(expectNewest) !== newest?.id)
    return { ok: false, why: `STALE: ${REPAIR.actor}'s newest act is ${newest?.id ?? "none"}${newest ? ` (${newest.action})` : ""}, not the ${expectNewest} Wright's go named: stop and post it` };
  return { ok: true, enter, exit, between, after, newestMove, newest, household: exit.household ?? enter.household ?? null };
}

/** The point the deposit rule gives the stop, against the authorised one. PURE. */
export function judgePoint(point) {
  const x = Number(point?.x), y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, why: `the deposit rule gives ${REPAIR.stop} no point` };
  if (x !== REPAIR.at.x || y !== REPAIR.at.y)
    return { ok: false, why: `the deposit rule sets a rider down at ${REPAIR.stop} at (${x}, ${y}), not the authorised (${REPAIR.at.x}, ${REPAIR.at.y})` };
  return { ok: true };
}

/**
 * What finch is within now, against the landing point (Wright, 22:11Z: "(b), narrowed. The guard accepts a
 * 'within' when the landing point lies inside that same thing. No exits, and nothing else loosened"). PURE.
 * `within` is DEC-5's occupancy read; `marksById` the world's marks; `pointWithinMark` the clone's own
 * containment (a mark's polygon when it has one, else its extent). Each held thing must be a mark this world
 * holds and must contain the point, by an answer of true: unknown or outside refuses.
 */
export function judgeWithin(within, marksById, pointWithinMark) {
  const seen = [];
  for (const id of within ?? []) {
    const m = marksById.get(id);
    let inside = null;
    try { inside = m ? pointWithinMark(REPAIR.at, m) : null; } catch { inside = null; }
    seen.push({ id, inside: inside === true });
    if (!m) return { ok: false, seen, why: `${REPAIR.actor} is within ${id} now, which this world holds no mark for: whether the landing lies inside it is unknown` };
    if (inside !== true)
      return { ok: false, seen, why: `${REPAIR.actor} is within ${id} now, and the landing point (${REPAIR.at.x}, ${REPAIR.at.y}) is ${inside === false ? "outside it" : "not provably inside it"}: a landing there would need exits this repair doesn't make` };
  }
  return { ok: true, seen };
}

/** The land act the repair writes, as landAt builds one but with the town's hand. PURE over its inputs. */
export function repairEntry(landEntry, { crossing, writtenAt, household }) {
  return landEntry({ crossing, who: REPAIR.actor, at: REPAIR.at, via: REPAIR.stop, why: REPAIR.why, household, writtenAt, declaredBy: REPAIR.declaredBy });
}

/**
 * The pen's in-transaction guard: the lock, then finch's acts read on the pen's own client and judged again.
 * A refusal carries `defect`, so penWrite rolls back and hands it on as the guard's answer.
 */
export const repairGuard = ({ boarded, expectLast, expectNewest = null }) => async (client) => {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [REPAIR_LOCK]);
  const { rows } = await client.query(ACTS_SQL, [REPAIR.actor]);
  const j = judgeRepair(rows, { boarded, expectLast, expectNewest });
  if (!j.ok) throw Object.assign(new Error(j.why), { code: 409, defect: j.why, already: j.already === true });
};

const isMain = process.argv[1] && realpathSync(process.argv[1]).replace(/\\/g, "/").endsWith("/pos-943-finch-set-down.mjs");

if (isMain) {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const apply = argv.includes("--apply");
  const valueOf = (flag) => { const k = argv.indexOf(flag); return k === -1 ? null : argv[k + 1] ?? ""; };
  const expectLast = valueOf("--expect-last");
  const boarded = valueOf("--boarded");
  const expectNewest = valueOf("--expect-newest");
  const ID = /^[1-9][0-9]*$/;
  const VALUED = ["--expect-last", "--boarded", "--expect-newest"];
  const known = new Set(["--json", "--apply", ...VALUED]);
  const stray = argv.filter((a, k) => !known.has(a) && !VALUED.includes(argv[k - 1]));
  if (stray.length || !ID.test(String(boarded ?? "")) || [expectLast, expectNewest].some((v) => v != null && !ID.test(v))
    || (apply && (expectLast == null || expectNewest == null))) {
    console.error("usage: node tools/pos-943-finch-set-down.mjs --boarded <act id> [--expect-newest <act id>] [--json]   (a dry run)\n" +
      "       node tools/pos-943-finch-set-down.mjs --boarded <act id> --expect-newest <act id> --apply --expect-last <act id> [--json]\n" +
      "--boarded is finch's boarding act (his enter of the Post Office via the Snug Jetty), and is always needed;\n" +
      "--expect-newest is finch's newest act of any kind, which the run refuses unless it still is;\n" +
      "--apply needs --expect-last: finch's newest movement act id, as the reviewed dry run printed it, and --expect-newest too");
    process.exit(2);
  }
  const out = (o, lines) => { console.log(json ? JSON.stringify(o) : lines.join("\n")); };
  const refuse = (why, extra = {}) => { out({ written: false, refused: why, ...extra }, [`REFUSED: ${why}`, "Nothing written."]); process.exit(1); };

  const { actsQuery } = await import("../src/world2-acts.mjs");
  const { depositPointFor, vesselIdOf } = await import("../src/world-ride.mjs");
  let acts;
  try { acts = await actsQuery(ACTS_SQL, [REPAIR.actor]); }
  catch (e) { console.error(`cannot read the store: ${String(e?.message ?? e).split("\n")[0]}`); process.exit(2); }
  if (!Array.isArray(acts)) { console.error("no store configured (WORLD2_PG / WORLD2_PG_URL): this runs with the office's own environment"); process.exit(2); }

  const j = judgeRepair(acts, { boarded, expectLast, expectNewest });
  if (!j.ok) refuse(j.why, j.already ? { already: true } : {});

  // the world's reads: the deposit point, and that nothing holds him now
  const w = await import("../src/world.mjs");
  const { crossingLaw } = await import("../src/world-crossings.mjs");
  const { crossingDeps } = await import("../src/world-apex.mjs");
  const { vesselServiceFrom } = await import("../src/world-movement.mjs");
  const deps = crossingDeps();
  let point, within, law;
  try {
    const { service } = await vesselServiceFrom(await deps.world(), { repo: w.WORLD_CLONE });
    if (vesselIdOf(service) !== REPAIR.vessel) refuse(`the Post Office's vessel reads as ${vesselIdOf(service) ?? "nothing"}, not ${REPAIR.vessel}`);
    point = depositPointFor(REPAIR.stop, service);
  } catch (e) { refuse(`the Post Office's service could not be read, so the deposit point is unproven: ${String(e?.message ?? e).split("\n")[0]}`); }
  const p = judgePoint(point);
  if (!p.ok) refuse(p.why);
  let held;
  try {
    law = await crossingLaw(w.WORLD_CLONE);
    if (!law?.thresholds || typeof law.verbs?.pointWithinMark !== "function") throw new Error("the clone carries no enter/exit law or containment");
    within = await w.occupiedNowBy(REPAIR.actor, law.thresholds, deps);
    held = within.length ? judgeWithin(within, new Map(((await deps.world())?.marks ?? []).map((m) => [m.id, m])), law.verbs.pointWithinMark) : { ok: true, seen: [] };
  } catch (e) { refuse(`${REPAIR.actor}'s occupancy could not be read: ${String(e?.message ?? e).split("\n")[0]}`); }
  if (!held.ok) refuse(held.why);

  const fmt = (a) => a ? `act ${a.id} · ${new Date(a.at).toISOString()} · ${a.action} ${a.object ?? ""}`.trim() : "none";
  const nm = j.newestMove;
  const seen = {
    enter: fmt(j.enter), exit: fmt(j.exit),
    boarding: { object: j.enter.object ?? null, via: j.enter.payload.via ?? null, summary: j.enter.payload.summary ?? null },
    between: j.between.map(fmt),
    since_exit: j.after.map(fmt),
    newest_move: nm ? { ...nm, payload: nm.payload } : null,
    newest_act: j.newest ? { id: j.newest.id, action: j.newest.action, at: j.newest.at } : null,
    within: held.seen, deposit_point: REPAIR.at,
  };
  const { importEngineAt } = await import("../src/world-branches.mjs");
  const { fractionalCrossing } = await importEngineAt(w.WORLD_CLONE, "walk.mjs");
  const crossing = fractionalCrossing();
  const writtenAt = new Date().toISOString();   // ONE clock read, into the act and the projection, as landAt
  const entry = repairEntry(w.landEntry, { crossing, writtenAt, household: j.household });
  const read = [
    `${REPAIR.actor}, read from the store now:`,
    `  boarded:   ${seen.enter} (--boarded ${boarded}; payload via ${JSON.stringify(seen.boarding.via)}, summary ${JSON.stringify(seen.boarding.summary)})`,
    `  between:   ${seen.between.length ? seen.between.join("\n             ") : "nothing"} (no ride, no land)`,
    `  exited:    ${seen.exit} (no set_down_at)`,
    `  since:     ${seen.since_exit.length ? seen.since_exit.join("\n             ") : "nothing"}`,
    `  newest movement act: ${nm ? `${nm.id} (${nm.action}${nm.payload?.toward ? `, toward (${nm.payload.toward.x}, ${nm.payload.toward.y})` : ""})` : "none"}`,
    `  newest act: ${j.newest ? `${j.newest.id} (${j.newest.action}, ${new Date(j.newest.at).toISOString()})` : "none"}${expectNewest != null ? ` — the ${expectNewest} expected` : ""}`,
    `  within now: ${held.seen.length ? held.seen.map((s) => `${s.id} (the landing point lies inside it)`).join(", ") : "nothing"}`,
    `  the deposit rule's point for ${REPAIR.stop}: (${REPAIR.at.x}, ${REPAIR.at.y})`,
  ];

  if (!apply) {
    out({ dry: true, would: { actor: entry.actor, action: entry.action, object: entry.object, exit_household: entry.household ?? null, crossing, payload: entry.payload }, seen },
      ["DRY RUN (POS-943): nothing written.", ...read, "",
        "It would append ONE land act:",
        `  actor ${entry.actor} · action ${entry.action} · object ${entry.object} · class ${entry.cls}`,
        `  household: ${entry.household == null ? "none (his exit carried none)" : `the pen files it under ${entry.actor}'s own house, as it filed his exit (${entry.household})`}`,
        `  payload ${JSON.stringify(entry.payload)}`,
        "  (the crossing, the instant and the witness stamp are taken again at --apply)",
        "",
        `The guards pass. To write it, on Wright's word: --boarded ${boarded} --expect-newest ${j.newest?.id} --apply --expect-last ${nm?.id}`]);
    process.exit(0);
  }

  const { appendActFlipped, appendJournal } = await import("../src/world-journal.mjs");
  const { laneFlipped } = await import("../src/world2-pen.mjs");
  const { at: stampAt, witnesses } = await w.witnessStampAt(REPAIR.actor, REPAIR.at);
  entry.at = stampAt; entry.witnesses = witnesses;
  const guard = repairGuard({ boarded, expectLast, expectNewest });
  let row;
  try { row = laneFlipped("walk") ? await appendActFlipped(null, entry, { guard }) : await appendJournal(null, entry, { guard }); }
  catch (e) {
    if (e?.defect) refuse(e.defect, e.already ? { already: true } : {});
    console.error(`the land was not written: ${String(e?.message ?? e).split("\n")[0]}`);
    process.exit(1);
  }
  // THE PROJECTION, IN THE SAME STEP, as landAt: this process's copy; the live office hears the act by its head read (POS-691)
  try {
    w.recordMoved({ actor: REPAIR.actor, from: REPAIR.at, toward: REPAIR.at, crossing, at: writtenAt, within: null, toMark: null,
      declaredBy: REPAIR.declaredBy, pace: null, landed: { via: REPAIR.stop, why: REPAIR.why } }, row?.actId ?? null);
  } catch { /* the act is written; the office's head read hears it */ }
  out({ written: true, actId: row?.actId ?? null, payload: entry.payload, seen },
    [`WRITTEN (POS-943): act ${row?.actId ?? "(no id)"} sets ${REPAIR.actor} down at ${REPAIR.stop} (${REPAIR.at.x}, ${REPAIR.at.y}), declared by ${REPAIR.declaredBy}.`, ...read]);
  process.exit(0);
}
