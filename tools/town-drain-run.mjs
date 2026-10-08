#!/usr/bin/env node
// town-drain-run.mjs — the ferry's call into the town-log drain.
//
//   node tools/town-drain-run.mjs [--clone PATH] [--oauth-db PATH]
//                                 [--date YYYY-MM-DD] [--dry-run] [--unlocked]
//                                 [--json]
//
// THE ENTRYPOINT AND NOTHING ELSE. Every decision lives in src/town-bridge.mjs;
// this file resolves paths, opens the log's paper, calls once, prints, and exits.
// The split is the same one crossing-save.mjs and world-drain.mjs keep — a tool
// that also held policy would be a second place to read the drain's law.
//
// WHERE THIS IS CALLED FROM: postmark-ferry.service, as the FIRST step of the
// crossing chain, inside the flock the unit already holds and after its
// reset/clean crash recovery. See src/town-bridge.mjs § where it runs for why
// all three of those are load-bearing rather than convenient.
//
// EXIT CODES, because the ferry chain is `&&`-joined and this runs before the
// mail sweep:
//
//   0  drained, or nothing to drain, or the flag is off (the no-op case)
//   1  REFUSED — the lock was not held, or the log holds a class this drain
//      cannot settle. Nothing was written and the cursor did not move. Exiting
//      non-zero holds the rest of the crossing on purpose: a refusal means the
//      office does not understand its own log, and delivering mail on top of
//      that would be building on a floor nobody has checked.
//   2  a bad argument, --db among them (office.db is retired, POS-268 5b)
//
// A THROW IS NOT AN EXIT CODE HERE. It propagates, systemd records it, and the
// chain stops — same outcome as 1, louder. The drain has no failure it should
// absorb: the town log's whole promise is that a row is either settled or still
// pending, and a swallowed error is the one state that is neither.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { oauthSchema } from "../src/oauth.mjs";
import { openPaper } from "../src/paperwork.mjs";
import { runTownDrain } from "../src/town-bridge.mjs";
import { indexSwitched, UNREACHABLE_DEFECT } from "../src/index-probe.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argOf = (n, d = null) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(n);

const CLONE = resolve(argOf("--clone", process.env.TOWN_CLONE ?? join(ROOT, "town-clone")));
const ODB_PATH = resolve(argOf("--oauth-db", join(ROOT, "oauth.db")));
const DATE = argOf("--date", null);

// --db IS RETIRED (POS-268 part 5b). It named office.db, the read index the
// doors took, and nothing builds office.db any more: the rehydrate unit that
// rebuilt it is gone. A caller still passing it is told so and nothing runs, so
// a hand-run from an old note never replays the log against a frozen file.
if (flag("--db")) {
  console.error("[town-drain] --db is retired (POS-268 part 5b): office.db is no longer built, and the drain reads the town index from the store. Drop --db; nothing replaces it.");
  process.exit(2);
}

if (DATE && !/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
  console.error(`unparseable --date: ${DATE} (want YYYY-MM-DD)`);
  process.exit(2);
}

// THE DOORS' INDEX IS THE STORE'S, ALWAYS (POS-268 part 5b): its resident
// handles and letter ids, loaded once here. office.db is not built any more, so
// this process takes the switch itself rather than inheriting it: a ferry unit
// whose environment lost TOWN_INDEX_READS=store would otherwise replay the log
// against a file frozen on the day the rehydrate stopped. A store that cannot
// answer stops the run before a row is replayed, cursor unmoved: replaying
// against no index would bounce every letter past it.
if (!indexSwitched()) {
  console.error(`[town-drain] TOWN_INDEX_READS is ${JSON.stringify(process.env.TOWN_INDEX_READS ?? null)} here; the drain reads the store's town index regardless (office.db is retired, POS-268 5b)`);
  process.env.TOWN_INDEX_READS = "store";
}
const { refreshStoreProbe } = await import("../src/town-index-store.mjs");
if (!(await refreshStoreProbe({ logins: false }))) { console.error(`[town-drain] ${UNREACHABLE_DEFECT}`); process.exit(1); }
// THE TOWN LOG'S PAPER (POS-271), opened the way the office opens its own:
// oauth.db by default, the store's office_town_journal + office_meta with
// OFFICE_PAPERWORK_STORE=1. The drain must read the log the office writes and
// advance the cursor the office reads, so this unit takes the SAME switch as
// the office's own — a drain on the file behind a switched office would settle
// the mirror and leave the store's cursor where it was.
const odb = await openPaper(ODB_PATH, { schema: oauthSchema });

// ── AWAITED, AND THE EXIT MOVED OUT OF THE `try` (POS-158) ─────────────────
//
// `runTownDrain` became async when the registry became store-of-record: the
// planner reads the record and the writer writes rows to it. This call did not
// follow, and the failure was silent in the worst way a crossing can be —
// `report` was a PROMISE, `report.refused` was `undefined`, and the process
// exited 0 having written nothing. Measured A/B on a seeded db: before the
// async change a foreign-class crossing wrote four files and exited 1; after
// it, and before this line, it wrote nothing, printed `{}` and exited 0. A
// ferry chain is `&&`-joined, so that reads as a clean crossing and the mail
// goes out on top of a record nobody settled.
//
// THE EXIT ALSO MOVED. `process.exit()` does not unwind, so the `finally` below
// never ran and both handles were closed by process teardown instead of by this
// file. That was invisible while the call was synchronous and would have been a
// held sqlite lock on Windows the moment anything awaited between them.
let code = 0;
try {
  const report = await runTownDrain(odb, {
    clone: CLONE, date: DATE,
    dryRun: flag("--dry-run"),
    requireLock: !flag("--unlocked"),
  });
  if (flag("--json")) console.log(JSON.stringify(report, null, 2));
  code = report.refused ? 1 : 0;
} finally {
  try { odb.close(); } catch { /* already gone */ }
}
process.exit(code);
