// world-stake-exec.mjs — one world-mark stake or unstake, atomically, under the
// caller's flock. The exact shape of stake-exec.mjs (the vote lane), because the
// ceremony is the same one and copying it deliberately is safer than inventing a
// second one: pull the clone, run the TOWN's own engine, commit the sealed ledger
// with the pen's ceremony, print exactly one JSON line.
//
// Env: TOWN_CLONE, STAMP_KEY (path to the pen's ed25519 pem), TOWN_PUSH=1,
//      BOT_NAME/BOT_EMAIL (penCommit's), TOWN_TZ.
// argv[2]: JSON { verb: "stake"|"unstake", handle, mark, n, via?, date }.
//
// Exit 0 with {applied,...} or {error:{code,defect,hint}} (a bounce is an answer);
// exit 1 only when the machinery itself trips.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { penTransaction } from "./write.mjs";
import { landStamped } from "./stamp-lines.mjs"; // POS-341: the ledger's lines are recorded in the store in the commit's transaction
import { withMarkHeld, stakeRefusalUnderLock } from "./mark-stake-lock.mjs"; // WLD-27 A: no stake lands behind a mark that has left, and no change is read half-landed

const HERE = dirname(fileURLToPath(import.meta.url));
const CLONE = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");
const KEY_PATH = process.env.STAMP_KEY ?? "/srv/postmark-office/stamp-key.pem";

async function main() {
  const payload = JSON.parse(process.argv[2] ?? "{}");
  const verb = payload.verb === "unstake" ? "unstake" : "stake";
  if (!existsSync(KEY_PATH)) {
    console.log(JSON.stringify({ error: { code: 409, defect: "not-yet-open", hint: "the office has no pen key configured for the stamp-ledger" } }));
    return;
  }
  const enginePath = join(CLONE, "tools", "world-stake.mjs");
  if (!existsSync(enginePath)) {
    console.log(JSON.stringify({ error: { code: 503, defect: "not-yet-open", hint: "this town clone carries no world-stake engine — the P3 grammar is not merged there yet" } }));
    return;
  }
  const keyPem = readFileSync(KEY_PATH, "utf8");
  const { worldStakeApply, worldUnstakeApply } = await import(pathToFileURL(enginePath));

  // THE WHOLE CHANGE UNDER THE MARK'S LOCK (mark-stake-lock.mjs, WLD-27 A and
  // Bevel's first review R1): taken before the append, let go only after the
  // landing or the rollback below is finished, so no reader of this mark's
  // escrow sees a line that may yet un-happen. A stake asks the record first
  // and is refused, with no line written, when the mark has left.
  let result;
  try {
    result = await withMarkHeld(payload.mark, async (client) => {
      if (verb === "stake") {
        const refused = await stakeRefusalUnderLock(client, payload.mark);
        if (refused) return { error: { code: refused.code, defect: refused.defect, hint: refused.hint } };
      }
      // WHOLE OR NOTHING (POS-296), stake-exec's shape: a stake or unstake the pen
      // cannot land leaves no line and no commit behind.
      return penTransaction(CLONE, async () => {
        if (process.env.TOWN_PUSH === "1")
          execFileSync("git", ["-C", CLONE, "pull", "--rebase", "-q"], { encoding: "utf8" });

        let result;
        try {
          result = verb === "unstake"
            ? worldUnstakeApply(CLONE, { handle: payload.handle, mark: payload.mark, n: payload.n, date: payload.date }, keyPem)
            : worldStakeApply(CLONE, { handle: payload.handle, mark: payload.mark, n: payload.n, via: payload.via ?? "api", date: payload.date }, keyPem);
        } catch (e) {
          if (e.code) return { error: { code: e.code, defect: e.defect, hint: e.hint } };
          throw e;
        }

        if (result.applied > 0) {
          const commit = await landStamped(CLONE, [join(CLONE, "WHITE_PAGES", "stamp-ledger.md")],
            verb === "unstake"
              ? `unstake: ${payload.handle} <- world-mark/${payload.mark} · ${result.applied}`
              : `stake: ${payload.handle} -> world-mark/${payload.mark} · ${result.applied} (via ${payload.via ?? "api"})`);
          if (commit?.error) return commit;
          result.commit = commit;
        }
        result.verb = verb;
        return result;
      });
    }, { refusal: verb === "unstake" ? "nothing was returned and your stake stands" : "nothing was staked and your stamps are untouched" });
  } catch (e) {
    if (!e?.code || !e?.defect) throw e;
    result = { error: { code: e.code, defect: e.defect, hint: e.hint } };
  }
  console.log(JSON.stringify(result));
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
