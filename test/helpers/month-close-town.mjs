// month-close-town.mjs — a scratch town for the monthly close's tests (POS-851). Synthetic handles and pots throughout.
//
// A real signed ledger the town's own engine wrote, a git clone with a bare origin beside it, the town's own tools/ (its
// pinned copies, as the box runs them: pinTown), pot files and a provisional record of the public record's shape. The
// scratch is ORDER-SENSITIVE ON PURPOSE: ana's holo from ec2 uses up part of the room her cap leaves for meeps-fund, so
// the meeps-fund close derived on today's ledger and on the ledger after ec2's close are different rows.
//
//   · darko-fund   elastic, floor $5; dee gives $20, cy stakes 12.
//   · keeping-ec2  posted need $150; ana gives $150 (a full month), bo stakes 40.
//   · meeps-fund   posted need $200; ana gives $200, bo stakes 40, wright stakes 10 (Starforge's own, excluded).
//   · meeps-home   once, closes at fill: never this command's.
//   · a draft pot: never this command's.

import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { copyTownTools } from "./town-tools.mjs";
import { pinTown } from "./pinned-town.mjs";
import { importTownTool } from "../../src/town-tool.mjs";

export const MONTH = "2026-10";
export const CLOSE_DATE = "2026-11-02";
/** 11:00 on 2 November, New York: the month has ended, the date is today. */
export const NOW = new Date("2026-11-02T16:00:00Z");
export const HANDLES = ["ana", "bo", "cy", "dee", "keeper", "wright"];
export const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const ident = ["-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid"];

const pot = (id, extra) => ({ pot: id, subtype: "bounty", status: "open", beneficiary: "keeper", epoch_cadence: "monthly", received_usd: 0, ...extra });

/** The provisional record as the public one is shaped: 1-space indent, `what`, `credited_to`, `entries`, `total_holo_would_mint`. */
export const provisionalFile = (entries = []) => `${JSON.stringify({
  what: "a synthetic provisional record for a test town", credited_to: "wright", _credited_to: "a test household",
  entries, total_holo_would_mint: entries.reduce((a, e) => a + (Number.isInteger(e.holo_would_mint) ? e.holo_would_mint : 0), 0),
}, null, 1)}\n`;

let n = 0;
/**
 * @param {{ tmp: string, townSource: string, ledger?: (M: object) => string[] }} o
 *   `ledger(M)` may replace the canonical lines the town is founded with.
 */
export async function makeTown({ tmp, townSource, ledger = null, provisional = provisionalFile(), pots = null }) {
  const dir = join(tmp, `month-town-${++n}`);
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  copyTownTools(townSource, dir);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(join(dir, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const keyFile = join(`${dir}-keys`, "stamp-key.pem");
  mkdirSync(`${dir}-keys`, { recursive: true });
  writeFileSync(keyFile, pem);
  for (const h of HANDLES) { mkdirSync(join(dir, "WHITE_PAGES", h), { recursive: true }); writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\n---\n`); }
  writeFileSync(join(dir, "ECONOMY-DIALS.json"), JSON.stringify({ law_side: { town_issuance: { treasury_handle: "the-town", once_purposes: [] }, keeping: { sigma: 0.5, rho: 0.5, rho_constitutional_ceiling: 0.5 } } }));
  const potFiles = pots ?? {
    "darko-fund": pot("darko-fund", { close: "elastic", min_close_usd: 5, target_usd_per_epoch: null, uncapped: true }),
    "keeping-ec2": pot("keeping-ec2", { target_usd_per_epoch: 150, uncapped: false }),
    "meeps-fund": pot("meeps-fund", { target_usd_per_epoch: 200, uncapped: false }),
    "meeps-home": pot("meeps-home", { target_usd_per_epoch: 859, epoch_cadence: "once", closes_at_fill: true }),
    "next-thing": pot("next-thing", { status: "draft", target_usd_per_epoch: 10 }),
  };
  for (const [id, meta] of Object.entries(potFiles)) writeFileSync(join(dir, "WHITE_PAGES", `pot-${id}.json`), `${JSON.stringify(meta, null, 2)}\n`);
  if (provisional !== null) writeFileSync(join(dir, "WHITE_PAGES", "starforge-provisional.json"), provisional);

  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  git(dir, "config", "core.autocrlf", "false");
  process.env.TOWN_PINS_DIR = pinTown(dir);
  const M = await importTownTool(dir, "stamp-mint.mjs");
  const day = "2026-10-05", rday = "2026-10-12";
  const gift = (handle, k) => M.giftLine({ date: "2026-09-01", handle, n: k, slug: `seed-${handle}`, by: "the-town" });
  const stake = (handle, p, k) => M.potStakeLine({ date: day, handle, pot: p, n: k, via: "api" });
  const receipt = (p, from, usd, ref) => M.potReceiptLine({ date: rday, pot: p, rail: "stripe", usd, from, ref });
  const lines = ledger ? ledger(M, { gift, stake, receipt }) : [
    M.rulesLine("2026-06-12"),
    gift("ana", 20), gift("bo", 100), gift("cy", 100), gift("dee", 10), gift("wright", 100),
    stake("cy", "darko-fund", 12),
    stake("bo", "keeping-ec2", 40),
    stake("bo", "meeps-fund", 40), stake("wright", "meeps-fund", 10),
    receipt("darko-fund", "dee", 20, "t-dee-1"),
    receipt("keeping-ec2", "ana", 150, "t-ana-ec2"),
    receipt("meeps-fund", "ana", 200, "t-ana-meeps"),
  ];
  M.appendSigned(dir, lines, pem);
  git(dir, "add", "-A"); git(dir, ...ident, "commit", "-q", "-m", "seed");
  const origin = `${dir}.git`;
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  git(dir, "remote", "add", "origin", origin); git(dir, "push", "-q", "-u", "origin", "main");
  return { dir, origin, keyFile, pem, M, ledgerText: () => readFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), "utf8") };
}
