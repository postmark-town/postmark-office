// gangway-door.mjs — the founder raises or lowers the gangway through the office
// (POS-353).
//
//   household { do: "gangway", args: { state: "open" | "frozen", reason } }
//
// The gangway was the founder's file HARBOR/GANGWAY.md; the store is the record
// now (062, src/gangway.mjs), so the lever is an office act. It is the
// FOUNDER'S: the caller's verified GitHub id must hold the `principal` role
// (src/ops.mjs, POS-352) — the same wall the ops desk stands behind. An
// operator act (household-apex.mjs § OPERATOR_ACTS), so to anyone else it
// answers as a name the door has never heard of.
//
// Under the town lock it adopts the file's own state first (a founder commit
// is still honoured), appends the row, and renders the file from the store in
// one pen commit. Asking for the state the gangway is already in is refused
// and writes nothing: a no-op row would read as a real raise later.

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GANGWAY_STATES, gangwayState, insertGangwayAct, GANGWAY_PATH } from "./gangway.mjs";
import { principalNow } from "./ops.mjs";
import { refuse } from "./fault-words.mjs"; // a refusal from GANGWAY_REFUSALS, as the error the door sends

export async function callerMayGangway(key, ctx = {}) {
  return key?.ghId != null && (await principalNow(ctx?.rdb ?? null, key));
}

export const GANGWAY_REFUSALS = Object.freeze({
  STATE: { code: 422, defect: "`state` must be open or frozen", hint: "household { do: \"gangway\", args: { state: \"frozen\", reason: \"…\" } }" },
  REASON: { code: 422, defect: "raising or lowering the gangway needs a `reason`", hint: "it is written on the row, in the words chosen, for every arrival it holds to read" },
  ALREADY: { code: 409, defect: "the gangway is already in that state", hint: "nothing was written; a no-op row would read as a real change later" },
  NO_RECORD: { code: 503, defect: "the office cannot reach the town's record", hint: "nothing was written; the gangway is a row in the record" },
});

export const townDate = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(now);

/** Judge the fields before the lock: `{ state, reason, since }` or a throw. */
export function judgeGangwayFields(fields, { date = townDate() } = {}) {
  const state = String(fields?.state ?? "").trim().toLowerCase();
  if (!GANGWAY_STATES.includes(state)) throw refuse(GANGWAY_REFUSALS.STATE);
  const reason = String(fields?.reason ?? "").replace(/[\r\n]+/g, " ").trim();
  if (!reason) throw refuse(GANGWAY_REFUSALS.REASON);
  return { state, reason, since: date };
}

/** The critical section, under the town lock. `drain`/`adopt` injected in tests. */
export async function gangwayUnderLock({ act, actorGhId = null, clone, env = process.env, drain = null, adopt = null }) {
  const tools = (!drain || !adopt) ? await import("../tools/gangway-drain.mjs") : null;
  adopt ??= tools.adoptFromGit;
  drain ??= tools.drainGangway;
  const a = await adopt({ clone, env });
  if (a.skipped) throw refuse(GANGWAY_REFUSALS.NO_RECORD);
  const now = await gangwayState(env);
  if (now === act.state) throw refuse(GANGWAY_REFUSALS.ALREADY, `it is ${now}`);
  const row = await insertGangwayAct({ state: act.state, since: act.since, reason: act.reason, by: "founder", actorGhId, source: "door" }, env);
  if (!row) throw refuse(GANGWAY_REFUSALS.NO_RECORD);
  const d = await drain({ clone, env, note: `the founder's door (household { do: "gangway" }): ${act.reason}` });
  return {
    ok: true, state: row.state, since: row.since, previous: now, reason: row.reason,
    file: GANGWAY_PATH, commit: d.commit ?? null,
    note: "the store is the record (gangway_acts); every arrival road reads it on its next call, and the file is its export",
  };
}

const EXEC = join(dirname(fileURLToPath(import.meta.url)), "gangway-exec.mjs");

async function runUnderTownLock(payload, { clone }) {
  const { runLockedExec } = await import("./town-lock.mjs");
  return runLockedExec(EXEC, payload, { clone, tripped: "the gangway act tripped" });
}

/** The door. `run` is the locked critical section, injected in tests. */
export async function gangwayAtOffice(fields, key, { clone, rdb = null, run = runUnderTownLock } = {}) {
  if (!(await callerMayGangway(key, { rdb }))) throw new Error("gangway reached without its caller gate");
  const act = judgeGangwayFields(fields);
  return run({ act, actorGhId: key.ghId }, { clone });
}
