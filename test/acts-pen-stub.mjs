// acts-pen-stub.mjs — the RECORD's write side, in memory, for suites that used
// to write a sqlite journal row.
//
// NOT A TEST FILE. The suite glob is `test/*.test.mjs`, so this is a helper and
// not a roster entry.
//
// ── WHY EVERY ACT-WRITING SUITE SUDDENLY NEEDS ONE (G1 / POS-156) ───────────
//
// `appendJournal` used to INSERT a sqlite row and queue a fire-and-forget copy
// into Postgres. G1 deleted the INSERT, and RULING 3 made what is left AWAITED
// and REFUSABLE — so a suite with no store no longer writes a row nobody reads,
// it gets `PenUnreachableError` and the door under test refuses.
//
// That is the correct behaviour and it is exactly what these suites must now be
// written against: the store IS the write, so a test that writes an act must
// point the office at a record. This is that record.
//
// ── IT IS A PEN, NOT A POSTGRES ────────────────────────────────────────────
//
// It answers the queries the WRITE path actually makes and nothing else:
// `officeWrite`'s transaction frame, `insertAct`'s one INSERT, and the three
// registry SELECTs `householdKeyFor` reaches through. A suite that also needs
// the docket (`claims`, `windows` — only mark-class rows go there,
// `claimEligible`) passes its own handlers in `also`.
//
// ⚑ AN UNKNOWN QUERY THROWS rather than answering `{ rows: [] }`. This is
// `test/stands-store-fixture.mjs`'s rule and it is the whole value of the
// thing: an empty answer to a question the stub does not understand is
// indistinguishable from "the record holds none", so a stub that shrugged
// would let a suite pass while the path under test asked for something nobody
// implemented. The throw names the SQL.
//
// ⚑ IT KEEPS WHAT IT WAS WRITTEN. `rows()` is the acts the suite's own door
// actually filed, in order, in the columns `insertAct` names — so an assertion
// can read back the thing that was written instead of trusting that a call
// returning no error wrote anything. `asked` counts every query, which is the
// leg an equality cannot supply: a door that quietly went back to sqlite would
// answer the same words and ask this pen NOTHING.

import { __setPoolForTest as __setActsPool } from "../src/world2-acts.mjs";
import { __setPoolForTest as __setPenPool } from "../src/world2-pen.mjs";
import { __clearHouseCache } from "../src/household-deriver.mjs";

/** The env that says "this office IS pointed at the record". */
export const RECORD_ON = Object.freeze({ WORLD2_PG: "1", WORLD2_PG_URL: "postgres://acts-pen-stub/none" });

/** And the env of an office pointed at none — the refusal's own control. */
export const RECORD_OFF = Object.freeze({ WORLD2_PG: undefined, WORLD2_PG_URL: undefined });

const norm = (sql) => String(sql).replace(/\s+/g, " ").trim();

/**
 * The pen itself.
 *
 * `households` / `pins` / `meta` seed the registry the household resolver folds
 * — empty by default, which resolves every handle to `solo:<handle>`, the same
 * answer an office with no registry gives. A suite that cares about house keys
 * seeds them; a suite that does not gets the honest default rather than a
 * fabricated house.
 *
 * `also` is `[[matcher, handler], …]`. `matcher` is a RegExp or a predicate over
 * the normalized SQL; `handler(sql, params, state)` returns a `pg` result. It is
 * consulted BEFORE the throw and AFTER the built-ins, so a suite can add the
 * docket without forking this file.
 */
export function makeActsPen({ households = [], pins = [], meta = [], also = [] } = {}) {
  const state = {
    acts: [],
    asked: [],
    nextId: 1,
    committed: 0,
    rolledBack: 0,
    household: null,   // the last `app.household` declared, so a suite can assert the scoping happened
  };

  const answer = async (sql, params = []) => {
    const q = norm(sql);
    state.asked.push(q);

    if (/^BEGIN/i.test(q)) return { rows: [], rowCount: 0 };
    if (/^COMMIT/i.test(q)) { state.committed += 1; return { rows: [], rowCount: 0 }; }
    if (/^ROLLBACK/i.test(q)) { state.rolledBack += 1; return { rows: [], rowCount: 0 }; }
    if (/set_config\('app\.household'/i.test(q)) { state.household = params[0] ?? null; return { rows: [], rowCount: 0 }; }

    // THE ONE INSERT THIS PEN EXISTS FOR. The column list is `insertAct`'s and
    // `mirrorAct`'s, in their order, and the id is assigned here because that is
    // what the sequence does — a caller reads it back as the act's receipt.
    if (/^INSERT INTO acts/i.test(q)) {
      const [at, crossing, actor, action, object,
        at_anchor, at_dx, at_dy, witnesses, cls,
        payload, effect, household, journal_seq] = params;
      const id = state.nextId++;
      state.acts.push({
        id, at, crossing, actor, action, object,
        at_anchor, at_dx, at_dy, witnesses, class: cls,
        payload, effect, household,
        // ⚑ CARRIED SO ITS ABSENCE IS ASSERTABLE. G1 drops `acts.journal_seq`;
        // a suite proving the column is gone reads this and expects undefined,
        // which it cannot do if the stub silently omitted the field.
        ...(journal_seq === undefined ? {} : { journal_seq }),
      });
      return { rows: [{ id }], rowCount: 1 };
    }

    // The registry, as `registry-store.mjs`'s three fixed SELECTs ask for it.
    if (/FROM households/i.test(q)) return { rows: households.map((r) => ({ ...r })), rowCount: households.length };
    if (/FROM household_pins/i.test(q)) return { rows: pins.map((r) => ({ ...r })), rowCount: pins.length };
    if (/FROM registry_meta/i.test(q)) return { rows: meta.map((r) => ({ ...r })), rowCount: meta.length };

    for (const [matcher, handler] of also) {
      const hit = typeof matcher === "function" ? matcher(q, params) : matcher.test(q);
      if (hit) return handler(q, params, state);
    }

    throw new Error(
      `acts-pen-stub was asked a query it does not implement, and answering [] would be a lie: ${q.slice(0, 200)}`);
  };

  const client = { query: answer, release() { /* pooled in name only */ } };

  return {
    state,
    /** The acts this pen actually received, in write order. */
    rows: () => state.acts.map((r) => ({ ...r })),
    /** Every query asked of it, normalized — assert the count, not only the answer. */
    asked: () => [...state.asked],
    query: answer,
    connect: async () => client,
    end: async () => {},
  };
}

/**
 * Point the office at a fresh pen for the length of one test, and hand it back.
 *
 * ⚑ THE HOUSE CACHE IS CLEARED BOTH WAYS. `houseOfVia` memoizes per queryable
 * AND `houseOf` memoizes per process; a suite that installs a second pen in the
 * same process would otherwise resolve handles against the first one's
 * registry. `household-deriver.mjs` exports the drop for exactly this.
 */
export function installActsPen(opts = {}) {
  const pen = makeActsPen(opts);
  __clearHouseCache();
  // BOTH POOLS, and the two are not the same object in the office either:
  // `world2-acts.mjs` holds the mirror's (the arena's path, `mirrorAct`) and
  // `world2-pen.mjs` holds the awaited pen's (`penWrite`, which is every other
  // door since G1). A suite that set only one would write through whichever
  // path it did not stub and reach a real socket.
  __setActsPool(pen);
  __setPenPool(pen);
  return pen;
}

/** Drop the pen and the caches with it. A suite's `after` calls this. */
export function uninstallActsPen() {
  __setActsPool(null);
  __setPenPool(null);
  __clearHouseCache();
}

/**
 * Set the record env for a block and put it back — the two-line shape every
 * suite here was writing by hand.
 */
export async function withRecordOn(fn) {
  const was = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
  process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
  try { return await fn(); }
  finally {
    if (was.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = was.pg;
    if (was.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = was.url;
  }
}
