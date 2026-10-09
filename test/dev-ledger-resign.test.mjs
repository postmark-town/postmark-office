// dev-ledger-resign.test.mjs — the dev clone moves onto dev's own key, and the
// move can fail (POS-354; Darko 2026-10-07: yes to a dev key).
//
// tools/dev-ledger-resign.mjs runs every night in postmark-dev-freshen, right
// after the dev clones stand back on sandbox/seed. Each property it promises is
// driven here on a small town checkout built from the town's OWN engine (the
// pinned town-clone's tools/stamp-mint.mjs): every signed line verifies under
// the new key with its seal unchanged; a ruled exception named by signature is
// carried; the commit is the same every night; a clone already on the key is
// left alone; and prod's key is refused before anything is written.
//
// THE CAN-FAIL FLIPS:
//   · drop the fixed GIT_AUTHOR_DATE / GIT_COMMITTER_DATE from resignDevTown's
//     commit env: "the same seed under the same key is the same commit" goes red;
//   · drop the --not-key comparison: "prod's key is refused" goes red.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createPublicKey, verify as edVerify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { resignDevTown } from "../tools/dev-ledger-resign.mjs";
import { NO_TOWN, townClone } from "./fixture-paths.mjs";

const TOWN = townClone();
const SKIP = !TOWN && NO_TOWN;
const ENGINE = TOWN ? await import(pathToFileURL(join(TOWN, "tools", "stamp-mint.mjs")).href) : null;
const SEED_DATE = "2026-09-22T12:00:00+00:00";

const keys = () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { key: privateKey.export({ type: "pkcs8", format: "pem" }), pub: publicKey.export({ type: "spki", format: "pem" }) };
};

const BASE = [
  "- 2026-06-12 · rules: stamps-v1",
  "- 2026-06-13 · MINT → ada · 1 · for: letter-a (sent)",
  "- 2026-06-13 · MINT → bea · 1 · for: letter-a (received)",
];

const dirs = [];
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

/** A town checkout signed by `prod`, its seed commit dated SEED_DATE; one tool names line 2 by signature, as stamp-verify's RULED_WELCOMES does. */
function seedTown(prod) {
  const dir = mkdtempSync(join(tmpdir(), "dev-ledger-resign-"));
  dirs.push(dir);
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_DATE: SEED_DATE, GIT_COMMITTER_DATE: SEED_DATE } }).trim();
  g("init", "-q", "-b", "main");
  g("config", "user.name", "seed"); g("config", "user.email", "seed@postmark.invalid"); g("config", "core.autocrlf", "false");
  mkdirSync(join(dir, "tools")); mkdirSync(join(dir, "WHITE_PAGES"));
  copyFileSync(join(TOWN, "tools", "stamp-mint.mjs"), join(dir, "tools", "stamp-mint.mjs"));
  const seals = ENGINE.sealChain(BASE);
  const sigs = BASE.map((_, i) => ENGINE.signSeal(seals[i], prod.key));
  writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), `# the stamp ledger\n\n${BASE.map((c, i) => `${c} · sig: ${sigs[i]}`).join("\n")}\n`);
  writeFileSync(join(dir, "tools", "stamp-pubkey.pem"), prod.pub);
  writeFileSync(join(dir, "tools", "ruled.mjs"), `export const RULED = new Set(["${sigs[1]}"]);\n`);
  g("add", "-A"); g("commit", "-q", "-m", "the seed");
  return { dir, g, sigs };
}

const verifiesUnder = (dir, pub) => {
  const entries = ENGINE.parseStampLedger(readFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), "utf8"));
  const seals = ENGINE.sealChain(entries.map((e) => e.canonical));
  return entries.every((e, i) => edVerify(null, Buffer.from(seals[i], "utf8"), createPublicKey(pub), Buffer.from(e.sig, "base64url")));
};

test("the clone moves onto dev's key: every line re-signed with its seal unchanged, dev's public key installed, the ruled exception carried, one local commit", { skip: SKIP }, async () => {
  const prod = keys(), dev = keys();
  const t = seedTown(prod);
  const seed = t.g("rev-parse", "HEAD");
  const r = await resignDevTown({ town: t.dir, keyPem: dev.key, notKeyPem: prod.key });
  assert.equal(r.status, "resigned", JSON.stringify(r));
  assert.equal(r.lines, 3);
  assert.ok(verifiesUnder(t.dir, dev.pub), "every line verifies under dev's key");
  assert.ok(!verifiesUnder(t.dir, prod.pub), "and none of it under prod's any more");
  assert.equal(readFileSync(join(t.dir, "tools", "stamp-pubkey.pem"), "utf8"), dev.pub);
  const after = ENGINE.parseStampLedger(readFileSync(join(t.dir, "WHITE_PAGES", "stamp-ledger.md"), "utf8"));
  assert.deepEqual(after.map((e) => e.canonical), BASE, "the text, so every seal, is unchanged");
  const ruled = readFileSync(join(t.dir, "tools", "ruled.mjs"), "utf8");
  assert.ok(ruled.includes(after[1].sig) && !ruled.includes(t.sigs[1]), "the exception names the same line by its new signature");
  assert.deepEqual(r.carried, [{ file: "tools/ruled.mjs", line: 2 }]);
  assert.equal(t.g("rev-parse", "HEAD~1"), seed, "one commit on the seed");
  assert.equal(t.g("status", "--porcelain"), "", "nothing left uncommitted");
  assert.equal(t.g("log", "-1", "--format=%an <%ae> %cI"), `dev freshen <dev-freshen@postmark.invalid> ${t.g("log", "-1", "--format=%cI", "HEAD~1")}`);
});

test("the same seed under the same key is the same commit, night after night (the store's town-index head keeps finding it)", { skip: SKIP }, async () => {
  const prod = keys(), dev = keys();
  const a = seedTown(prod), b = seedTown(prod);
  // the two nights' seeds are the same commit, as sandbox/seed is
  assert.equal(a.g("rev-parse", "HEAD"), b.g("rev-parse", "HEAD"));
  await resignDevTown({ town: a.dir, keyPem: dev.key });
  await new Promise((ok) => setTimeout(ok, 1100)); // a second apart: a commit dated now would differ
  await resignDevTown({ town: b.dir, keyPem: dev.key });
  assert.equal(a.g("rev-parse", "HEAD"), b.g("rev-parse", "HEAD"));
});

test("a clone already on the key is left alone: no second commit", { skip: SKIP }, async () => {
  const prod = keys(), dev = keys();
  const t = seedTown(prod);
  await resignDevTown({ town: t.dir, keyPem: dev.key });
  const head = t.g("rev-parse", "HEAD");
  const again = await resignDevTown({ town: t.dir, keyPem: dev.key });
  assert.equal(again.status, "already");
  assert.equal(t.g("rev-parse", "HEAD"), head);
});

test("prod's key is refused before anything is written (the 10-07 copy in the dev root)", { skip: SKIP }, async () => {
  const prod = keys();
  const t = seedTown(prod);
  const head = t.g("rev-parse", "HEAD");
  const r = await resignDevTown({ town: t.dir, keyPem: prod.key, notKeyPem: prod.key });
  assert.equal(r.status, "refused");
  assert.match(r.why, /dev would sign with PROD's key/);
  assert.equal(t.g("rev-parse", "HEAD"), head);
  assert.equal(t.g("status", "--porcelain"), "");
});

test("uncommitted changes under the ledger or tools/ are refused, never folded into the key's commit", { skip: SKIP }, async () => {
  const prod = keys(), dev = keys();
  const t = seedTown(prod);
  writeFileSync(join(t.dir, "tools", "ruled.mjs"), "// someone's edit\n");
  const r = await resignDevTown({ town: t.dir, keyPem: dev.key });
  assert.equal(r.status, "refused");
  assert.match(r.why, /uncommitted changes/);
  assert.equal(readFileSync(join(t.dir, "tools", "stamp-pubkey.pem"), "utf8"), prod.pub);
});
