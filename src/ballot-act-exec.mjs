// ballot-act-exec.mjs — one hand's act on a ballot, atomically, under the caller's flock (POS-983).
//
// Invoked by ballot-acts.mjs as a subprocess (on the box: wrapped in
// `flock -w 30 town.lock`, the lock stake-exec.mjs and the ferry chain hold),
// because the act writes the town clone: it pulls the clone, then runs
// src/ballots-store.mjs § ballotActInStore, which writes the ballot file and
// takes it in as the post in one store transaction, the pen's commit and push
// inside it. Prints exactly one JSON line.
//
// Env: TOWN_CLONE, TOWN_PUSH=1, BOT_NAME/BOT_EMAIL (penCommit's), TOWN_TZ, and
//      the office's store (WORLD2_PG / WORLD2_PG_URL, the pen's own).
// argv[2]: JSON { verb, args, hand, today }.
//
// Exit 0 with the answer or {error:{code,defect,hint,field?}} (a refusal is an
// answer); exit 1 only when the machinery itself trips.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { penTransaction } from "./write.mjs";
import { ballotActInStore } from "./ballots-store.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLONE = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");

async function main() {
  const { verb, args, hand, today } = JSON.parse(process.argv[2] ?? "{}");
  // WHOLE OR NOTHING (POS-296): an act the pen cannot land leaves no file, no
  // commit and (the store's transaction rolling back with it) no post act.
  const result = await penTransaction(CLONE, async () => {
    if (process.env.TOWN_PUSH === "1")
      execFileSync("git", ["-C", CLONE, "pull", "--rebase", "-q"], { encoding: "utf8" });
    const commit = { message: (a) => `ballot: ${a.topic} · ${a.did.join(" + ")} (by ${hand}'s hand, via postmark-office)` };
    try {
      return await ballotActInStore({ clone: CLONE, verb, args, hand, today, commit });
    } catch (e) {
      if (e.code && e.defect) return { error: { code: e.code, defect: e.defect, hint: e.hint, ...(e.field ? { field: e.field } : {}) } };
      throw e;
    }
  });
  // The store pool would hold the process open: the answer is written, then the exit.
  process.stdout.write(JSON.stringify(result) + "\n", () => process.exit(0));
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
