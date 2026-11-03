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

/** The town, founded and with The Keep welcomed. `{ repo, keyFile, pub }`. */
export function invitedTown(src = INVITE_TOWN) {
  const repo = mkdtempSync(join(tmpdir(), "invite-town-"));
  mkdirSync(join(repo, "tools"), { recursive: true });
  for (const f of ["stamp-mint.mjs", "stamp-verify.mjs", "registry-source.mjs"]) copyFileSync(join(src, "tools", f), join(repo, "tools", f));
  writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify(PINS));
  writeFileSync(join(repo, "tools", "households.json"), JSON.stringify({ households: HOUSEHOLDS }));
  for (const h of Object.keys(PINS)) {
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
  mint(["--welcome", "dora", "--household", "gh:4", "--date", "2026-10-28", "--key", keyFile]);
  return { repo, keyFile, pub, mint };
}
