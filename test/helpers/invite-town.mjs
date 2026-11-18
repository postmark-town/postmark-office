// invite-town.mjs — an invented town carrying postmark#4424's invite grammar, for POS-816's tests.
//
// Built from a town checkout that carries --invite-mint (INVITE_TOWN_CLONE): its
// three mint files only, an invented roll (The Keep, invited by Castle on
// 2026-10-27; dora, carl and cleo, every one invented), two delivered letters, a
// signed ledger founded by --append, and The Keep's welcome. The caller removes
// `repo` when done. Shared by test/invite-pass.test.mjs and test/invite-hold.test.mjs.

import { generateKeyPairSync } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const INVITE_TOWN = process.env.INVITE_TOWN_CLONE || null;
export const INVITE_TOWN_SKIP = INVITE_TOWN ? false : "needs postmark#4424's --invite-mint (unshipped): set INVITE_TOWN_CLONE to a town checkout carrying it";

export const INVITED_AT = "2026-10-27T20:39:04.552Z";
export const HOUSEHOLDS = Object.freeze({
  keep: { residents: ["dora"], accounts: [{ id: 4 }], invited_by: { by: "castle", named: "cleo", at: INVITED_AT } },
  castle: { residents: ["carl", "cleo"], accounts: [{ id: 5 }] },
});
export const PINS = Object.freeze({ dora: { id: 4 }, carl: { id: 5 }, cleo: { id: 5 } });
export const REGISTRY = Object.freeze({ households: HOUSEHOLDS, pins: PINS });

/**
 * The town, founded and with The Keep welcomed. `{ repo, keyFile, pub }`.
 *
 * `households`, `pins`, `welcomes` ([[handle, "gh:<id>"], ...]) and `meeps` (handles the town's
 * law names, declared on the ledger) default to The Keep's town, so a caller that names none gets
 * exactly the town it always did. The founders' arm names its own (POS-816/d): a Starforge
 * household that lists a meep, which the town's meep law must keep from being paid.
 */
export function invitedTown(src = INVITE_TOWN, { households = HOUSEHOLDS, pins = PINS, welcomes = [["dora", "gh:4"]], meeps = [] } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "invite-town-"));
  mkdirSync(join(repo, "tools"), { recursive: true });
  for (const f of ["stamp-mint.mjs", "stamp-verify.mjs", "registry-source.mjs"]) copyFileSync(join(src, "tools", f), join(repo, "tools", f));
  writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify(pins));
  writeFileSync(join(repo, "tools", "households.json"), JSON.stringify({ households }));
  for (const h of Object.keys(pins)) {
    mkdirSync(join(repo, "WHITE_PAGES", h), { recursive: true });
    writeFileSync(join(repo, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\n---\n`);
  }
  writeFileSync(join(repo, "WHITE_PAGES", "mail-ledger.md"),
    "# ledger\n\n- 2026-10-27 · a-1 · dora → carl · thread: new\n- 2026-10-27 · b-1 · carl → dora · thread: new\n");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "pem" });
  writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), pub);
  const keyFile = join(repo, "stamp-key.pem");
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  const mint = (args) => execFileSync(process.execPath, [join(repo, "tools", "stamp-mint.mjs"), ...args, "--repo", repo], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  mint(["--append", "--key", keyFile]);
  // a law is forward-dated, never retroactive: the day after the last delivery (2026-10-27), the day the welcomes are paid
  if (meeps.length) mint(["--declare-rules", "stamps-v2", "--meeps", meeps.join(","), "--date", "2026-10-28", "--key", keyFile]);
  for (const [handle, household] of welcomes) mint(["--welcome", handle, "--household", household, "--date", "2026-10-28", "--key", keyFile]);
  return { repo, keyFile, pub, mint };
}
