#!/usr/bin/env node
// dev-ledger-resign.mjs — the dev town clone's stamp ledger, signed with DEV's
// own key (POS-354; Darko 2026-10-07: "yes" to a dev key).
//
// ── WHY ─────────────────────────────────────────────────────────────────────
//
// On 2026-10-07 the dev root's stamp key (/srv/postmark-office-dev/stamp-key.pem)
// was measured byte-identical to PROD's, and the dev office set no STAMP_KEY, so
// its pens defaulted to prod's key path anyway. A fresh dev key cannot simply be
// set: dev's town clone carries prod's tools/stamp-pubkey.pem and a ledger prod
// signed, so every line dev's pens append would fail the town's own verifier.
// This tool moves the dev clone onto dev's key, the stamp sandbox's way
// (tools/stamp-sandbox.mjs § resignTown): every signed line re-signed (the seals
// do not move: a seal is a hash of the text, the key only signs it), dev's public
// key installed, and the ruled exceptions the town names by signature carried to
// their new signatures. postmark-dev-freshen runs it every night, right after it
// stands the clone back on sandbox/seed.
//
// ── WHAT IT RUNS ────────────────────────────────────────────────────────────
//
//   node tools/dev-ledger-resign.mjs --town <dev town clone> --key <dev key pem>
//                                    --not-key <prod's key> [--verify]
//
//   --town     a dev clone only: every remote's push URL disabled, its real
//              path under /srv/postmark-office-dev or the temp dir (§ WHICH CLONE)
//
//   --not-key  (required) a key, public is enough (the freshen passes prod's
//              clone's tools/stamp-pubkey.pem): refuse when the key's public half
//              is this one's. Unreadable is a refusal. Independently, a key whose
//              public half is the seed's tools/stamp-pubkey.pem (prod's) is
//              refused with no prod path at all (§ NOT PROD'S KEY)
//   --verify   run the town's own verifier (tools/stamp-verify.mjs) on the result
//
// ONE COMMIT, THE SAME EVERY NIGHT. The re-sign is committed on the clone (never
// pushed) with a fixed author, committer and date (the seed commit's), and
// ed25519 signatures are deterministic, so the same seed under the same key is
// the same commit: anything keyed on the clone's sha, like the store's town-index
// head, still finds it after the next freshen. A clone already on the key (its
// public key is the key's, and every signed line verifies under it) is left alone.
//
// Exit 0 done (or already done) · 1 refused or red · 2 bad usage.
// Prints no secrets: the key is read into memory and never printed.

import { execFileSync, spawnSync } from "node:child_process";
import { createPublicKey, verify as edVerify } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resignTown } from "./stamp-sandbox.mjs";

// posix spellings: they are git pathspecs as well as paths
const LEDGER_REL = "WHITE_PAGES/stamp-ledger.md";
const PUBKEY_REL = "tools/stamp-pubkey.pem";
const WHO = { name: "dev freshen", email: "dev-freshen@postmark.invalid" };
const git = (repo, args, env = {}) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 }).trim();

/** The public half of a PEM key (private or public), as SPKI PEM. */
export const publicOf = (pem) => createPublicKey(pem).export({ type: "spki", format: "pem" });

/** Every signed line of the clone's ledger that does NOT verify under `pubPem` (line numbers). */
export function unsignedUnder(town, pubPem, engine) {
  const entries = engine.parseStampLedger(readFileSync(join(town, LEDGER_REL), "utf8"));
  const seals = engine.sealChain(entries.map((e) => e.canonical));
  const pub = createPublicKey(pubPem);
  const bad = [];
  entries.forEach((e, i) => { if (e.sig && !edVerify(null, Buffer.from(seals[i], "utf8"), pub, Buffer.from(e.sig, "base64url"))) bad.push(i + 1); });
  return { bad, lines: entries.length };
}

// ── WHICH CLONE (the #453 review, F1) ────────────────────────────────────────
//
// Dev and prod share the box, and from the w42 ship this tool sits in prod's
// tree too. Pointed at PROD's town clone by one mistyped --town, it would re-sign
// the real ledger and swap the town's public key, and prod's next push would
// carry that to GitHub. So the clone must be one that cannot push and that lives
// where a dev clone lives:
//   · every remote's push URL is the disabled value the dev clones carry (the
//     freshen's header: "the push URL is DISABLED by design"); a clone with no
//     remote at all has nowhere to push;
//   · its real path is under the dev root or the temp dir (the tests' and the
//     stand-in's clones); `allowedRoots` is the test seam.

export const DEV_ROOT = "/srv/postmark-office-dev";
export const DISABLED_PUSH_URL = "DISABLED-dev-channel-never-pushes";

/** Why `town` is not a clone this tool may rewrite, or null. */
export function cloneRefusal(town, { allowedRoots = [DEV_ROOT, tmpdir()] } = {}) {
  let real;
  try { real = realpathSync(town); } catch (e) { return `--town ${town} cannot be resolved (${e.code ?? e.message})`; }
  const under = (root) => { let r; try { r = realpathSync(root); } catch { return false; } const rel = relative(r, real); return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel); };
  if (!allowedRoots.some(under)) return `--town ${real} is not under ${allowedRoots.join(" or ")}: only a dev clone is re-signed, never prod's`;
  const remotes = git(town, ["remote"]).split("\n").filter(Boolean);
  for (const r of remotes) {
    const url = spawnSync("git", ["-C", town, "remote", "get-url", "--push", r], { encoding: "utf8" });
    const push = (url.stdout ?? "").trim();
    if (url.status !== 0 || push !== DISABLED_PUSH_URL)
      return `the clone's remote ${r} can push (${push || "its push URL cannot be read"}): only a clone whose push URL is ${DISABLED_PUSH_URL} is re-signed, so nothing it commits can reach GitHub`;
  }
  return null;
}

// ── NOT PROD'S KEY, WITHOUT READING PROD'S KEY (the #453 review, F2) ─────────
//
// The seed is prod-signed, so `sandbox/seed:tools/stamp-pubkey.pem` IS prod's
// public half. A key whose public half equals it is refused with no prod path
// and no private key read: prod's private key never enters a process that then
// imports and runs the clone's own engine. --not-key is a second, explicit
// comparison (a public key is enough); a --not-key that is given but cannot be
// read is a refusal, never a skip. Dev and prod both run as meepo, so this
// guards against signing with prod's key by MISTAKE, not against a compromise.

export const SEED_REF = "refs/tags/sandbox/seed";

/** The seed's tools/stamp-pubkey.pem (prod's public key), or null when the clone has none. */
export function seedPubkeyOf(town) {
  const r = spawnSync("git", ["-C", town, "show", `${SEED_REF}:${PUBKEY_REL}`], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() ? r.stdout : null;
}

/**
 * Why the key whose public half is `pub` must not sign dev's ledger, or null.
 * `notKey` is `{ path }` (read here; unreadable is a refusal) or `{ pem }`.
 */
export function prodKeyRefusal(pub, { town, notKey = null }) {
  const PROD = "dev would sign with PROD's key (the 10-07 finding). Generate dev's own key first (deploy/DEPLOY.md § The dev rehearsal).";
  const seed = seedPubkeyOf(town);
  if (!seed) return `the clone has no ${SEED_REF}:${PUBKEY_REL} (prod's public key) to compare the key with, so it cannot be shown not to be prod's`;
  let seedPub;
  try { seedPub = publicOf(seed); } catch (e) { return `the seed's ${PUBKEY_REL} is not a key (${e.message})`; }
  if (seedPub === pub) return `the key's public half is the seed's ${PUBKEY_REL}, prod's: ${PROD}`;
  if (notKey) {
    let pem = notKey.pem;
    if (pem == null) {
      try { pem = readFileSync(notKey.path, "utf8"); }
      catch (e) { return `--not-key ${notKey.path} cannot be read (${e.code ?? e.message}): a --not-key that is given and unreadable is a refusal, never a skip`; }
    }
    let notPub;
    try { notPub = publicOf(pem); } catch (e) { return `--not-key${notKey.path ? ` ${notKey.path}` : ""} is not a key (${e.message})`; }
    if (notPub === pub) return `the key's public half is the --not-key's: ${PROD}`;
  }
  return null;
}

/**
 * Move `town` onto `keyPem`. Answers `{ status, ... }`: `already` (nothing to
 * do), `resigned` (committed; `sha`, `lines`, `carried`), or `refused` (`why`).
 */
export async function resignDevTown({ town, keyPem, notKeyPem = null, notKeyPath = null, verify = false, allowedRoots }) {
  const wrongClone = cloneRefusal(town, allowedRoots ? { allowedRoots } : {});
  if (wrongClone) return { status: "refused", why: wrongClone };
  if (!existsSync(join(town, LEDGER_REL))) return { status: "refused", why: `no ${LEDGER_REL} under ${town}: --town must be a town checkout` };
  const pub = publicOf(keyPem);
  const prodKey = prodKeyRefusal(pub, { town, notKey: notKeyPath ? { path: notKeyPath } : notKeyPem ? { pem: notKeyPem } : null });
  if (prodKey) return { status: "refused", why: prodKey };
  if (git(town, ["status", "--porcelain", "--", LEDGER_REL, "tools"])) return { status: "refused", why: `the clone has uncommitted changes under ${LEDGER_REL} or tools/: re-signing over them would mix them into the dev key's commit` };
  const engine = await import(pathToFileURL(join(town, "tools", "stamp-mint.mjs")).href);
  const installed = existsSync(join(town, PUBKEY_REL)) ? readFileSync(join(town, PUBKEY_REL), "utf8") : null;
  if (installed && installed.replace(/\r\n/g, "\n") === pub && !unsignedUnder(town, pub, engine).bad.length) return { status: "already" };

  const { lines, carried } = resignTown(town, keyPem, engine);
  const left = unsignedUnder(town, pub, engine);
  if (left.bad.length) {
    git(town, ["checkout", "HEAD", "--", LEDGER_REL, "tools"]);
    return { status: "refused", why: `after the re-sign, ${left.bad.length} line(s) still do not verify under the key (first: line ${left.bad[0]}); the clone is put back` };
  }
  if (verify) {
    const r = spawnSync(process.execPath, [join(town, "tools", "stamp-verify.mjs")], { cwd: town, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) {
      git(town, ["checkout", "HEAD", "--", LEDGER_REL, "tools"]);
      return { status: "refused", why: `the town's verifier is red on the re-signed ledger (exit ${r.status}): ${`${r.stdout}${r.stderr}`.trim().split("\n").slice(-3).join(" | ")}; the clone is put back` };
    }
  }
  // the seed commit's date, so the same seed under the same key is the same commit
  const when = git(town, ["log", "-1", "--format=%cI", "HEAD"]);
  const env = { GIT_AUTHOR_NAME: WHO.name, GIT_AUTHOR_EMAIL: WHO.email, GIT_COMMITTER_NAME: WHO.name, GIT_COMMITTER_EMAIL: WHO.email, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when };
  git(town, ["add", "--", LEDGER_REL, "tools"]);
  git(town, ["-c", "commit.gpgsign=false", "commit", "-q", "-m",
    `dev: the stamp ledger re-signed under dev's own key (POS-354)\n\n${lines} ledger lines re-signed, seals unchanged; tools/stamp-pubkey.pem is dev's.` +
    (carried.length ? ` Ruled exceptions carried to their new signatures: ${carried.map((c) => `${c.file} (line ${c.line})`).join(", ")}.` : "") +
    `\nWritten by tools/dev-ledger-resign.mjs on the dev clone only. Never pushed: the dev clone's push URL is disabled.`], env);
  return { status: "resigned", sha: git(town, ["rev-parse", "HEAD"]), lines, carried };
}

const USAGE = "usage: node tools/dev-ledger-resign.mjs --town <dev town clone> --key <dev key pem> --not-key <prod's key, public or private> [--verify]";

async function main(argv = process.argv.slice(2)) {
  const arg = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
  const known = new Set(["--town", "--key", "--not-key", "--verify"]);
  for (const a of argv) if (a.startsWith("--") && !known.has(a)) { console.error(`unknown flag ${a}\n${USAGE}`); return 2; }
  const town = arg("--town"), keyPath = arg("--key"), notKey = arg("--not-key");
  // --not-key is mandatory (the #453 review, F1): the CLI never runs without the key it must refuse
  if (!town || !keyPath || !notKey) { console.error(USAGE); return 2; }
  if (!existsSync(keyPath)) { console.error(`dev-ledger-resign: REFUSED, no key at ${keyPath}: generate dev's own key first (deploy/DEPLOY.md § The dev rehearsal)`); return 1; }
  // --not-key is read inside, where a path that cannot be read is a refusal (never a skip)
  const r = await resignDevTown({ town, keyPem: readFileSync(keyPath, "utf8"), notKeyPath: notKey, verify: argv.includes("--verify") });
  if (r.status === "refused") { console.error(`dev-ledger-resign: REFUSED, ${r.why}`); return 1; }
  if (r.status === "already") { console.log(`dev-ledger-resign: ${town} is already on the key (its public key is the key's and every signed line verifies)`); return 0; }
  console.log(`dev-ledger-resign: ${r.lines} ledger lines re-signed under dev's key, committed ${r.sha.slice(0, 9)} (never pushed)` +
    (r.carried.length ? `; ${r.carried.length} ruled exception(s) carried` : ""));
  return 0;
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) main().then((code) => process.exit(code), (e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
