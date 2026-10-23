// parcel-room-exec.mjs — one parcel of room bought ahead, atomically, under the caller's flock (POS-762).
//
// Darko, 2026-10-23 09:51 EDT: /e "Buy room ahead" ("a household act burns the
// stamps and adds one parcel of room for good; a claim then costs nothing")
// and /f "Room bought" ("50 x room already bought: room 1->2 costs 50, 2->3
// costs 100, whatever is held").
//
// pot-stake-exec's twin: same subprocess shape, same flock, same pen, same
// one-JSON-line contract. ONE PEN, ONE LAW: the line is built by the TOWN's own
// builder (parcelBurnLine) and signed by the TOWN's own appendSigned, imported
// live from the checkout. What this process decides is parcel-room.mjs §
// parcelRoomQuote, asked INSIDE the lock against the ledger as it stands, the
// same function the door's preview asks: the household, its declaration day,
// the room it has, the price, and the payer's liquid stamps. No partial burn:
// short of the price, nothing is written.
//
// Env: TOWN_CLONE, STAMP_KEY, TOWN_PUSH, BOT_NAME/BOT_EMAIL, TOWN_TZ.
// argv[2]: JSON { handle, date, via }.

import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { penTransaction } from "./write.mjs";
import { landStamped } from "./stamp-lines.mjs"; // POS-341: the ledger's lines are recorded in the store in the commit's transaction
import { quoteAt } from "./parcel-room.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLONE = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");
const KEY_PATH = process.env.STAMP_KEY ?? "/srv/postmark-office/stamp-key.pem";

const err = (code, defect, hint) => ({ error: { code, defect, hint } });

async function main() {
  const payload = JSON.parse(process.argv[2] ?? "{}");
  if (!existsSync(KEY_PATH)) {
    console.log(JSON.stringify(err(409, "not-yet-open", "the office has no pen key configured for the stamp-ledger")));
    return;
  }
  if (!payload.handle || !payload.date) {
    console.log(JSON.stringify(err(422, "incomplete purchase", "required: handle, date")));
    return;
  }
  const keyPem = readFileSync(KEY_PATH, "utf8");
  const { appendSigned } = await import(pathToFileURL(join(CLONE, "tools", "stamp-mint.mjs")));

  // WHOLE OR NOTHING (POS-296): a purchase the pen cannot land leaves no line and no commit.
  const result = await penTransaction(CLONE, async () => {
    if (process.env.TOWN_PUSH === "1")
      execFileSync("git", ["-C", CLONE, "pull", "--rebase", "-q"], { encoding: "utf8" });
    const q = await quoteAt(CLONE, payload.handle, payload.date);
    if (q.error) return q;
    const { quote } = q;
    appendSigned(CLONE, [quote.line], keyPem);
    const commit = await landStamped(CLONE, [join(CLONE, "WHITE_PAGES", "stamp-ledger.md")],
      `parcel room: ${quote.handle} buys room for ${quote.household}'s parcel ${quote.room.after} · ${quote.price} (via ${payload.via ?? "api"})`);
    if (commit?.error) return commit;
    return { ...quote, commit };
  });
  console.log(JSON.stringify(result));
}

// ── entry guard ──────────────────────────────────────────────────────────────
// Real paths, not URLs: a junction makes argv[1] and import.meta.url disagree
// (pot-stake-exec.mjs § entry guard; test/cli-guard.test.mjs spawns it through one).
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
}
