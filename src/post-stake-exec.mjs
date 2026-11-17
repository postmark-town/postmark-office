// post-stake-exec.mjs — one stake, unstake or conversion carry on an idea post, atomically, under the
// caller's flock (POS-854). The shape of world-stake-exec.mjs, copied on purpose: pull the clone, run the
// engine over the office's PINNED town grammar, commit the signed ledger with the pen's ceremony, print
// exactly one JSON line.
//
// Env: TOWN_CLONE, STAMP_KEY (path to the pen's ed25519 pem), TOWN_PUSH=1, BOT_NAME/BOT_EMAIL, TOWN_TZ.
// argv[2]: JSON one of
//   { verb: "stake" | "unstake", handle, post, n, via?, date }
//   { verb: "carry", items: [{ mark, post }], expect?: { "<mark>|<handle>": n }, date }
//
// Exit 0 with the engine's answer or {error:{code,defect,hint}} (a bounce is an answer); exit 1 only when
// the machinery itself trips.

import { freshenExec } from "./clone-fresh.mjs";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importTownTool, isPinStop, pinStopHint } from "./town-tool.mjs";
import { penTransaction } from "./write.mjs";
import { landStamped } from "./stamp-lines.mjs";
import { postStakeApply, postUnstakeApply, carryApply, DOOR_VIA, CONVERSION_VIA } from "./post-stake-engine.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLONE = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");
const KEY_PATH = process.env.STAMP_KEY ?? "/srv/postmark-office/stamp-key.pem";

async function main() {
  const payload = JSON.parse(process.argv[2] ?? "{}");
  const verb = ["stake", "unstake", "carry"].includes(payload.verb) ? payload.verb : "stake";
  if (!existsSync(KEY_PATH)) {
    console.log(JSON.stringify({ error: { code: 409, defect: "not-yet-open", hint: "the office has no pen key configured for the stamp-ledger" } }));
    return;
  }
  const keyPem = readFileSync(KEY_PATH, "utf8");
  let M;
  try { M = await importTownTool(CLONE, "stamp-mint.mjs"); }
  catch (e) {
    if (!isPinStop(e)) throw e;
    console.log(JSON.stringify({ error: { code: 503, defect: "town-pin-mismatch", hint: pinStopHint(e) } }));
    return;
  }
  const ledgerRel = join(CLONE, "WHITE_PAGES", "stamp-ledger.md");
  const result = await penTransaction(CLONE, async () => {
    freshenExec(CLONE);   // a dirty copy is answered by name (503) and exits, before anything is written
    let out;
    try {
      if (verb === "carry") out = carryApply(M, CLONE, payload.items ?? [], { date: payload.date, via: CONVERSION_VIA, expect: payload.expect ? new Map(Object.entries(payload.expect)) : null }, keyPem);
      else if (verb === "unstake") out = postUnstakeApply(M, CLONE, { handle: payload.handle, post: payload.post, n: payload.n, via: payload.via ?? DOOR_VIA, date: payload.date }, keyPem);
      else out = postStakeApply(M, CLONE, { handle: payload.handle, post: payload.post, n: payload.n, via: payload.via ?? DOOR_VIA, date: payload.date }, keyPem);
    } catch (e) {
      if (e.code) return { error: { code: e.code, defect: e.defect, hint: e.hint } };
      throw e;
    }
    const moved = verb === "carry" ? out.appended > 0 : out.applied > 0;
    if (moved) {
      const what = verb === "carry"
        ? `convert: ${out.moves.length} stake(s) carried from marks to posts · ${out.proof.carried}`
        : verb === "unstake" ? `unstake: ${payload.handle} <- post/${payload.post} · ${out.applied}`
          : `stake: ${payload.handle} -> post/${payload.post} · ${out.applied} (via ${payload.via ?? DOOR_VIA})`;
      const commit = await landStamped(CLONE, [ledgerRel], what);
      if (commit?.error) return commit;
      if (!commit) return { error: { code: 503, defect: "the stake's line did not reach the ledger", hint: "nothing moved and every stamp stands where it was — try again" } };
      out.commit = commit;
    }
    out.verb = verb;
    return out;
  });
  console.log(JSON.stringify(result));
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
