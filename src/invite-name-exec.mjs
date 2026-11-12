// invite-name-exec.mjs — the town-writing half of naming an inviter after
// joining (POS-947).
//
// Invoked by `nameInviterViaOffice` (src/invite-name.mjs) as a subprocess under
// the town lock (on the box: `flock -w 30 town.lock`, the lock the join, the
// declaration and the keep tick's invite pass take), so a naming never races a
// join, a crossing or a payout. It pulls the clone and runs
// `nameInviterUnderLock`. Prints exactly one JSON line.
//
// Env: TOWN_CLONE, TOWN_PUSH=1, BOT_NAME/BOT_EMAIL (penCommit's).
// argv[2]: JSON { args: { invited_by, handle? }, key: { handles } }.
//
// Exit 0 with the answer or { error: { code, field, defect, hint } } (a refusal
// is an answer); exit 1 only when the machinery itself trips.

import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { nameInviterUnderLock } from "./invite-name.mjs";
import { penTransaction } from "./write.mjs";
import { faultLogged, isHttpStatus } from "./fault-words.mjs"; // the office's own words for its own fault (POS-578)

const HERE = dirname(fileURLToPath(import.meta.url));
const CLONE = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");

const answer = (obj) => { console.log(JSON.stringify(obj)); process.exit(0); };

async function main() {
  const { args, key } = JSON.parse(process.argv[2] ?? "{}");
  if (!existsSync(CLONE))
    return answer({ error: { code: 409, field: null, defect: "not-yet-open", hint: "the office has no town clone to record into" } });

  // WHOLE OR NOTHING (POS-296): a naming refused inside the lock, or one whose
  // push cannot land, leaves none of its printed files behind, and
  // nameInviterUnderLock takes its row back.
  answer(await penTransaction(CLONE, async () => {
    if (process.env.TOWN_PUSH === "1")
      execFileSync("git", ["-C", CLONE, "pull", "--rebase", "-q"], { encoding: "utf8" });
    // No index probe, unlike the join: nothing here reads the town index, only
    // the registry, which nameInviterUnderLock reads from the record itself.
    try {
      return await nameInviterUnderLock({ args, key, clone: CLONE });
    } catch (e) {
      // a foreign error (pg's SQLSTATE, none at all) is the office's own fault: its message goes to the log (POS-578)
      if (!isHttpStatus(e?.code)) return { error: { code: 500, field: null, defect: "the naming tripped", hint: faultLogged("the naming tripped", e) } };
      return { error: { code: e.code, field: e.field ?? null, defect: e.defect ?? String(e.message), hint: e.hint ?? null } };
    }
  }));
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
