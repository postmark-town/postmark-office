// join-bind-exec.mjs — the town-writing half of a bound admission.
//
// Invoked by `requestResidency` (src/residency.mjs) as a subprocess under the
// town lock (on the box: `flock -w 30 town.lock`, the lane `declare-exec.mjs`
// and `settle-join-exec.mjs` take), so an admission never races a crossing or
// a declaration. It pulls the clone and runs `bindUnderLock`
// (src/join-bind.mjs). Prints exactly one JSON line.
//
// Env: TOWN_CLONE, TOWN_PUSH=1, BOT_NAME/BOT_EMAIL (penCommit's), TOWN_TZ.
// argv[2]: JSON { args, key: { ghId, ghLogin, handles } }.
//
// Exit 0 with the answer or { error: { code, field, defect, hint } } (a refusal
// is an answer); exit 1 only when the machinery itself trips.

import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { UNREACHABLE_DEFECT, UNREACHABLE_HINT } from "./index-probe.mjs";
import { bindUnderLock } from "./join-bind.mjs";
import { penTransaction } from "./write.mjs";
import { faultLogged, isHttpStatus } from "./fault-words.mjs"; // the office's own words for its own fault (POS-578)

const HERE = dirname(fileURLToPath(import.meta.url));
const CLONE = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");

const answer = (obj) => { console.log(JSON.stringify(obj)); process.exit(0); };

const townDate = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(new Date());

async function main() {
  const { args, key } = JSON.parse(process.argv[2] ?? "{}");
  if (!existsSync(CLONE))
    return answer({ error: { code: 409, field: null, defect: "not-yet-open", hint: "the office has no town clone to admit into" } });

  // WHOLE OR NOTHING (POS-296): an admission refused inside the lock, or one
  // whose push cannot land, leaves none of its card, mailbox or register files
  // behind. Store rows the ceremony already wrote are outside the clone and
  // stay; the next registry drain prints them.
  answer(await penTransaction(CLONE, async () => {
    if (process.env.TOWN_PUSH === "1")
      execFileSync("git", ["-C", CLONE, "pull", "--rebase", "-q"], { encoding: "utf8" });
    // the handle check reads the store's residents, loaded now under the lock (POS-268)
    const { refreshStoreProbe } = await import("./town-index-store.mjs");
    if (!(await refreshStoreProbe({ letters: false, logins: false })))
      return { error: { code: 503, field: null, defect: UNREACHABLE_DEFECT, hint: UNREACHABLE_HINT } };
    try {
      return await bindUnderLock({ args, key, clone: CLONE, date: townDate() });
    } catch (e) {
      if (typeof e?.code !== "number") throw e;
      // a refusal (an HTTP status) speaks its own words; any other coded error (pg's SQLSTATE) is the
      // office's own fault: its message goes to this child's stderr, the office's log (POS-578)
      if (!isHttpStatus(e.code)) return { error: { code: 500, field: null, defect: "the join pass tripped", hint: faultLogged("the join pass tripped", e) } };
      return { error: { code: e.code, field: e.field ?? null, defect: e.defect ?? String(e.message), hint: e.hint ?? null } };
    }
  }));
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
