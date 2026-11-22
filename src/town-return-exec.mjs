// town-return-exec.mjs — ONE REMOVAL'S RETURN, atomically, under the caller's
// flock (POS-1138). The shape of world-stake-exec.mjs, copied on purpose: pull
// the clone, run the TOWN's own engine through the office's pins, land the
// sealed ledger with the pen's ceremony, print exactly one JSON line. The act
// is the town's (POS-1139, `for: town-return:S<n>`), never an unstake in a
// staker's name, and the caller names marks and the removal only: who is owed
// what is the engine's read of the ledger at this moment.
//
// Env: TOWN_CLONE, STAMP_KEY (path to the pen's ed25519 pem), TOWN_PUSH=1,
//      BOT_NAME/BOT_EMAIL (penCommit's), TOWN_TZ.
// argv[2]: JSON { marks: [<mark id>], removal: "S<n>", date: "YYYY-MM-DD" }.
//
// Exit 0 with the engine's receipt `{ removal, date, marks, returned,
// nothing_open, total, proof, appended }` plus `commit` (when something was
// returned) and `open_after` (stamps still open per named mark, read under the
// same locks), or `{ error: { code, defect, hint } }`; exit 1 only when the
// machinery itself trips.

import { freshenExec } from "./clone-fresh.mjs";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { importTownTool, isPinStop, pinStopHint } from "./town-tool.mjs"; // POS-994: the town's engine is the office's pinned copy
import { penTransaction } from "./write.mjs";
import { landStamped } from "./stamp-lines.mjs"; // POS-341: the ledger's lines are recorded in the store in the commit's transaction
import { withMarkHeld } from "./mark-stake-lock.mjs"; // WLD-27 A: no reader sees a change on these marks half-landed

const HERE = dirname(fileURLToPath(import.meta.url));
const CLONE = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");
const KEY_PATH = process.env.STAMP_KEY ?? "/srv/postmark-office/stamp-key.pem";

const refusal = "nothing was returned and every stake stands";

// Every named mark's lock, taken in one order (sorted), held across the whole
// change. A stake or unstake holds one mark's lock under the same flock this
// exec runs under, so no two holders can wait on each other in reverse.
async function withMarksHeld(marks, fn, i = 0) {
  if (i >= marks.length) return fn();
  return withMarkHeld(marks[i], () => withMarksHeld(marks, fn, i + 1), { refusal });
}

async function main() {
  const payload = JSON.parse(process.argv[2] ?? "{}");
  const marks = [...new Set((Array.isArray(payload.marks) ? payload.marks : []).map(String))].sort();
  if (!existsSync(KEY_PATH)) {
    console.log(JSON.stringify({ error: { code: 409, defect: "not-yet-open", hint: "the office has no pen key configured for the stamp-ledger" } }));
    return;
  }
  const keyPem = readFileSync(KEY_PATH, "utf8");
  let worldTownReturnApply, worldStakeState;
  try { ({ worldTownReturnApply, worldStakeState } = await importTownTool(CLONE, "world-stake.mjs")); }
  catch (e) {
    if (!isPinStop(e)) throw e;
    console.log(JSON.stringify({ error: { code: 503, defect: "town-pin-mismatch", hint: pinStopHint(e) } }));
    return;
  }
  if (typeof worldTownReturnApply !== "function") {
    console.log(JSON.stringify({ error: { code: 503, defect: "not-yet-open", hint: "the town's engine carries no town return (POS-1139)" } }));
    return;
  }

  let result;
  try {
    result = await withMarksHeld(marks, () => penTransaction(CLONE, async () => {
      freshenExec(CLONE);   // POS-382: a dirty copy is answered by name (503) and exits, before anything is written
      let receipt;
      try { receipt = worldTownReturnApply(CLONE, { marks, removal: payload.removal, date: payload.date }, keyPem); }
      catch (e) {
        if (e.code) return { error: { code: e.code, defect: e.defect, hint: e.hint } };
        throw e;
      }
      if (receipt.appended) {
        const commit = await landStamped(CLONE, [join(CLONE, "WHITE_PAGES", "stamp-ledger.md")],
          `town return: ${receipt.removal} · ${receipt.returned.length} position(s) · ${receipt.total} on ${receipt.marks.join(", ")}`);
        if (commit?.error) return commit;
        // No commit means the lines are not in the clone any more (another
        // writer reset it before the pen staged them); the answer refuses.
        if (!commit) return { error: { code: 503, defect: "the town's return did not reach the ledger", hint: `${refusal} — the next settlement asks again` } };
        receipt.commit = commit;
      }
      const positions = worldStakeState(CLONE).positions;
      receipt.open_after = Object.fromEntries(marks.map((m) => [m,
        [...positions].filter(([k]) => k.slice(0, k.lastIndexOf("|")) === m).reduce((a, [, n]) => a + n, 0)]));
      return receipt;
    }));
  } catch (e) {
    if (!e?.code || !e?.defect) throw e;
    result = { error: { code: e.code, defect: e.defect, hint: e.hint } };
  }
  console.log(JSON.stringify(result));
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
