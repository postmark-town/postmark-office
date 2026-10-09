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
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { DEV_ROOT, DISABLED_PUSH_URL, prodKeyRefusal, publicOf, resignDevTown } from "../tools/dev-ledger-resign.mjs";
import { NO_TOWN, OFFICE_ROOT, townClone } from "./fixture-paths.mjs";

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
  g("tag", "sandbox/seed"); // the box's seed tag: its tools/stamp-pubkey.pem is prod's public key
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

// ── WHICH CLONE (the #453 review, F1) ────────────────────────────────────────
//
// THE CAN-FAIL FLIP: make cloneRefusal answer null; the live-push-URL and the
// outside-the-roots tests go red (the clone is re-signed).

test("a clone whose origin can push is refused before anything is written (prod's clone pushes)", { skip: SKIP }, async () => {
  const prod = keys(), dev = keys();
  const t = seedTown(prod);
  t.g("remote", "add", "origin", "https://github.com/postmark-town/postmark.git");
  const head = t.g("rev-parse", "HEAD");
  const r = await resignDevTown({ town: t.dir, keyPem: dev.key, notKeyPem: prod.key });
  assert.equal(r.status, "refused");
  assert.match(r.why, /remote origin can push \(https:\/\/github\.com\/postmark-town\/postmark\.git\)/);
  assert.equal(t.g("rev-parse", "HEAD"), head);
  assert.equal(t.g("status", "--porcelain"), "");
  assert.equal(readFileSync(join(t.dir, "tools", "stamp-pubkey.pem"), "utf8"), prod.pub, "prod's public key still stands");
});

test("a clone whose every push URL is the disabled value is re-signed (the dev clones' shape)", { skip: SKIP }, async () => {
  const prod = keys(), dev = keys();
  const t = seedTown(prod);
  t.g("remote", "add", "origin", "https://github.com/postmark-town/postmark.git");
  t.g("remote", "set-url", "--push", "origin", DISABLED_PUSH_URL);
  assert.equal((await resignDevTown({ town: t.dir, keyPem: dev.key, notKeyPem: prod.key })).status, "resigned");
});

test("a clone outside the dev root and the temp dir is refused (the roots are the test seam)", { skip: SKIP }, async () => {
  const prod = keys(), dev = keys();
  const t = seedTown(prod);
  const head = t.g("rev-parse", "HEAD");
  const r = await resignDevTown({ town: t.dir, keyPem: dev.key, notKeyPem: prod.key, allowedRoots: [DEV_ROOT] });
  assert.equal(r.status, "refused");
  assert.match(r.why, /is not under \/srv\/postmark-office-dev: only a dev clone is re-signed, never prod's/);
  assert.equal(t.g("rev-parse", "HEAD"), head);
});

test("the CLI will not run without --not-key", () => {
  const r = spawnSync(process.execPath, [join(OFFICE_ROOT, "tools", "dev-ledger-resign.mjs"), "--town", tmpdir(), "--key", join(tmpdir(), "no-such.pem")], { encoding: "utf8" });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /usage: .*--not-key <prod's key, public or private>/);
});

// ── NOT PROD'S KEY, WITHOUT READING PROD'S KEY (the #453 review, F2) ─────────
//
// THE CAN-FAIL FLIP: drop the seed comparison from prodKeyRefusal; "prod's key is
// refused by the seed's public key alone" goes red. tools/dev-rehearsal.mjs §
// keyProblems asks the same function, so its preflight carries the same rule.

test("prod's key is refused by the seed's public key alone: no --not-key, no prod private key read", { skip: SKIP }, async () => {
  const prod = keys();
  const t = seedTown(prod);
  const head = t.g("rev-parse", "HEAD");
  const r = await resignDevTown({ town: t.dir, keyPem: prod.key });
  assert.equal(r.status, "refused");
  assert.match(r.why, /the key's public half is the seed's tools\/stamp-pubkey\.pem, prod's: dev would sign with PROD's key/);
  assert.equal(t.g("rev-parse", "HEAD"), head);
});

test("a --not-key that is given but cannot be read is a refusal, never a skip", { skip: SKIP }, async () => {
  const prod = keys(), dev = keys();
  const t = seedTown(prod);
  const head = t.g("rev-parse", "HEAD");
  const r = await resignDevTown({ town: t.dir, keyPem: dev.key, notKeyPath: join(t.dir, "no-such-prod-pubkey.pem") });
  assert.equal(r.status, "refused");
  assert.match(r.why, /--not-key .*no-such-prod-pubkey\.pem cannot be read \(ENOENT\): a --not-key that is given and unreadable is a refusal, never a skip/);
  assert.equal(t.g("rev-parse", "HEAD"), head);
  // and a public key is enough for --not-key
  // a key the seed does not name, refused by its --not-key public half alone
  const other = keys();
  writeFileSync(join(t.dir, "other.pub"), other.pub);
  assert.match(prodKeyRefusal(publicOf(other.key), { town: t.dir, notKey: { path: join(t.dir, "other.pub") } }), /the key's public half is the --not-key's/);
});

test("a clone with no seed tag is refused: the key cannot be shown not to be prod's", { skip: SKIP }, async () => {
  const prod = keys(), dev = keys();
  const t = seedTown(prod);
  t.g("tag", "-d", "sandbox/seed");
  const r = await resignDevTown({ town: t.dir, keyPem: dev.key, notKeyPem: prod.key });
  assert.equal(r.status, "refused");
  assert.match(r.why, /no refs\/tags\/sandbox\/seed:tools\/stamp-pubkey\.pem/);
});
