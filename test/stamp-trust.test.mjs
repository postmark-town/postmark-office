// stamp-trust.test.mjs — UAT'S STAMP TRUST: one policy, the four verification paths, and prod's control (POS-1214).
//
// LAW (Wright, 2026-11-24 14:32:35Z on POS-1213): "with no UAT file bound, every path behaves exactly as today,
// byte for byte. That needs a test that proves it on prod's configuration, and no prod signing key anywhere on UAT."
// The shape (the same call): "the copied prefix verifies with prod's public key up to its trusted seal, then UAT's
// key only after it." The office's side (the paired contract): "operator-set STAMP_UAT_TRUST names a UAT-only
// read-only trust file with JSON fields pubkeyPem … and afterSeal …. Map these to Town's handoff … Explicitly
// requested but unusable UAT trust fails closed."
//
// Every key here is invented in the test. Nothing reads a deployment's keys.
//
// What this file holds, path by path, each with the production control beside its UAT arm:
//   · the loader (src/stamp-trust.mjs): unset is null and reads nothing; every way a trust can't be used refuses;
//   · src/stamp-lines.mjs: the office's own signature walk keeps the town's boundary (the writer and the verifier);
//   · src/stamp-verify-pinned.mjs: the runner hands the town verifier `handoff`, and in prod exactly what it did;
//   · world2/tools/stamp-mint-run.mjs § pinnedVerifier: the mint pass's verifier, the same;
//   · src/house-key.mjs § replayHolds: the admission replay's child, the same.
// The town's own handoff (POS-1213) isn't in the pins yet: the arms that need the town's verifier to honour it run
// only with OFFICE_HANDOFF_TOWN naming a town checkout that has it, and say so in their titles.
//
// THE CAN-FAIL FLIPS (each run on a copy of the lane's head, each redding the named test):
//   · stamp-lines § stampRowsPast: verify every line under `key` (drop the `i > anchor` choice), or every new line
//     under UAT's key → "the writer keeps the town's boundary";
//   · stamp-lines § verifyStampLinesVia: never set pastAnchor → "the verifier keeps the same boundary";
//   · stamp-verify-pinned: always add `handoff` (even undefined) → "PROD CONTROL: the runner"; never add it → "the
//     runner hands the town verifier UAT's handoff";
//   · stamp-trust § uatHandoff: take any PEM createPublicKey accepts (a private PEM derives a public key), drop the
//     equal-key refusal, or drop the clone refusal → the verdict map;
//   · stamp-mint-run § pinnedVerifier: drop withHandoff → "the mint pass's verifier hands over UAT's handoff";
//   · house-key § replayHolds: never hand the child the handoff → its UAT arm; always hand one → its PROD CONTROL.

import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { UAT_TRUST_ENV, uatHandoff, withHandoff, anchorIndex } from "../src/stamp-trust.mjs";
import { stampRowsPast, verifyStampLinesVia } from "../src/stamp-lines.mjs";
import { replayHolds } from "../src/house-key.mjs";
import { pinnedVerifier } from "../world2/tools/stamp-mint-run.mjs";
import { copyTownModule, pinnedTown, pinRootNow, pinTown } from "./helpers/pinned-town.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = join(OFFICE, "src", "stamp-verify-pinned.mjs");
const scratch = tempDir("stamp-trust-");
const ENGINE = await import(pathToFileURL(join(pinRootNow(), "tools", "stamp-mint.mjs")).href);

const keyPair = () => {
  const k = generateKeyPairSync("ed25519");
  return { pub: k.publicKey.export({ type: "spki", format: "pem" }), priv: k.privateKey.export({ type: "pkcs8", format: "pem" }) };
};
const BASE = keyPair(), UAT = keyPair(), FORGER = keyPair();

let n = 0;
const fresh = (what) => { const d = join(scratch, `${what}-${++n}`); mkdirSync(d, { recursive: true }); return d; };

/** A trust file outside any town, read-only to all but its owner; `doc` is written as given (an object is JSON). */
function trustFile(doc, { dir = fresh("trust"), mode = 0o644 } = {}) {
  const p = join(dir, "stamp-trust.json");
  writeFileSync(p, typeof doc === "string" ? doc : JSON.stringify(doc));
  if (process.platform !== "win32") chmodSync(p, mode);
  return p;
}

const CANON = (i) => (i === 0 ? "- 2026-06-12 · rules: stamps-v1" : `- 2026-06-${String(12 + (i % 15)).padStart(2, "0")} · MINT → ada · 1 · for: letter-${i} (sent)`);

/**
 * A town whose ledger has `count` lines, the first `k` signed by BASE and the rest by UAT (or `signer(i)` when
 * given), its tools/stamp-pubkey.pem BASE's public half. Returns `{ town, seals, canonicals, sigs, afterSeal }`,
 * `afterSeal` being line k's seal: the trusted seal of a prefix of k lines.
 */
function mixedTown(count, k, { signer = null, town = fresh("town") } = {}) {
  const canonicals = Array.from({ length: count }, (_, i) => CANON(i));
  const seals = ENGINE.sealChain(canonicals);
  const sigs = seals.map((s, i) => ENGINE.signSeal(s, (signer?.(i) ?? (i < k ? BASE : UAT)).priv));
  mkdirSync(join(town, "WHITE_PAGES"), { recursive: true });
  mkdirSync(join(town, "tools"), { recursive: true });
  writeFileSync(join(town, "WHITE_PAGES", "stamp-ledger.md"), `# the stamp ledger\n\n${canonicals.map((c, i) => `${c} · sig: ${sigs[i]}`).join("\n")}\n`);
  if (!existsSync(join(town, "tools", "stamp-pubkey.pem"))) writeFileSync(join(town, "tools", "stamp-pubkey.pem"), BASE.pub);
  return { town, seals, canonicals, sigs, afterSeal: seals[k - 1] };
}
const uatEnv = (afterSeal, pubkeyPem = UAT.pub) => ({ [UAT_TRUST_ENV]: trustFile({ pubkeyPem, afterSeal }) });
// Decoys: names that are not the one switch. None of them asks for UAT's trust. (No lower-case spelling: Windows
// folds a child's environment names, so there it IS the switch.)
const DECOYS = (p) => ({ STAMP_UAT_TRUST_PATH: p, STAMP_UAT_TRUST_FILE: p, STAMP_TRUST: p, UAT_TRUST: p });

// ── the loader ───────────────────────────────────────────────────────────────

test("the loader: unset is production, null, and nothing is read (the base key's getter never runs)", () => {
  const never = () => { throw new Error("the base key was read in production"); };
  assert.equal(uatHandoff({ env: {}, base: never }), null);
  assert.equal(uatHandoff({ env: DECOYS("/etc/postmark-uat/stamp-trust.json"), base: never }), null, "only STAMP_UAT_TRUST asks");
  const opts = { pubkeyPem: BASE.pub, registry: null };
  assert.equal(withHandoff(opts, null), opts, "production's options are the very same object");
});

test("the loader: a usable trust is exactly its two fields, frozen", () => {
  const seal = "a".repeat(64);
  const h = uatHandoff({ env: { [UAT_TRUST_ENV]: trustFile({ pubkeyPem: UAT.pub, afterSeal: seal }) }, base: BASE.pub });
  assert.deepEqual(h, { pubkeyPem: UAT.pub, afterSeal: seal });
  assert.ok(Object.isFrozen(h));
  assert.deepEqual(withHandoff({ pubkeyPem: BASE.pub }, h), { pubkeyPem: BASE.pub, handoff: h });
});

test("the loader: asked for and unusable fails closed, by name, every way (the whole verdict map)", () => {
  const seal = "b".repeat(64);
  const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "pem" });
  const town = fresh("town-holding-trust");
  const cases = {
    "an empty value": [""],
    "a relative path": ["stamp-trust.json"],
    "a missing file": [join(scratch, "no-such-trust.json")],
    "a directory": [fresh("a-dir")],
    "not JSON": [trustFile("{ not json")],
    "an array": [trustFile([UAT.pub, seal])],
    "a third field": [trustFile({ pubkeyPem: UAT.pub, afterSeal: seal, privateKeyPem: "x" })],
    "no afterSeal": [trustFile({ pubkeyPem: UAT.pub })],
    "a short seal": [trustFile({ pubkeyPem: UAT.pub, afterSeal: "abc" })],
    "an uppercase seal": [trustFile({ pubkeyPem: UAT.pub, afterSeal: "B".repeat(64) })],
    "a private key": [trustFile({ pubkeyPem: UAT.priv, afterSeal: seal })],
    "not a key": [trustFile({ pubkeyPem: "-----BEGIN PUBLIC KEY-----\nnope\n-----END PUBLIC KEY-----\n", afterSeal: seal })],
    "not ed25519": [trustFile({ pubkeyPem: ec, afterSeal: seal })],
    "the base key": [trustFile({ pubkeyPem: BASE.pub, afterSeal: seal })],
    "inside the town clone": [trustFile({ pubkeyPem: UAT.pub, afterSeal: seal }, { dir: town }), town],
    ...(process.platform === "win32" ? {} : { "group-writable": [trustFile({ pubkeyPem: UAT.pub, afterSeal: seal }, { mode: 0o664 })] }),
  };
  const why = {
    "an empty value": /not an absolute path/, "a relative path": /not an absolute path/, "a missing file": /can't be read \(ENOENT\)/,
    "a directory": /not a regular file/, "not JSON": /not JSON/, "an array": /not a JSON object/,
    "a third field": /exactly pubkeyPem and afterSeal, and holds afterSeal, privateKeyPem, pubkeyPem/,
    "no afterSeal": /exactly pubkeyPem and afterSeal, and holds pubkeyPem\. /,
    "a short seal": /afterSeal is not a seal/, "an uppercase seal": /afterSeal is not a seal/,
    "a private key": /not a public key PEM \(a private key is never trust\)/, "not a key": /pubkeyPem is not a readable public key/,
    "not ed25519": /pubkeyPem is a ec key, not ed25519/, "the base key": /its key is the base key/,
    "inside the town clone": /inside the town clone/, "group-writable": /writable by its group or by anyone/,
  };
  const verdicts = {}, expected = {};
  for (const [name, [path, clone = null]] of Object.entries(cases)) {
    expected[name] = "refused";
    try { uatHandoff({ env: { [UAT_TRUST_ENV]: path }, clone, base: BASE.pub }); verdicts[name] = "accepted"; }
    catch (e) {
      verdicts[name] = e?.code === "STAMP_UAT_TRUST_UNUSABLE" ? "refused" : `threw ${e?.message}`;
      assert.match(e.message, why[name], name);
      assert.match(e.message, /nothing is verified without it/, `${name}: the refusal says what it costs`);
      assert.doesNotMatch(e.message, /BEGIN|PRIVATE/, `${name}: no key's bytes in the words`);
    }
  }
  assert.deepEqual(verdicts, expected);
});

test("the anchor: the line carrying the trusted seal is the prefix's last; a seal no line carries is refused", () => {
  const { seals, afterSeal } = mixedTown(6, 3);
  assert.equal(anchorIndex(seals, { afterSeal }), 2);
  assert.throws(() => anchorIndex(seals, { afterSeal: "c".repeat(64) }), (e) => e.code === "STAMP_UAT_TRUST_UNUSABLE" && /is not a seal in the stamp ledger/.test(e.message));
});

// ── src/stamp-lines.mjs: the writer (stampRowsPast) and the verifier (verifyStampLinesVia) ────────────────────────

test("PROD CONTROL: the writer, with no STAMP_UAT_TRUST, records what it recorded and refuses what it refused, word for word", () => {
  const plain = mixedTown(6, 6);
  const rows = stampRowsPast(plain.town, null, { engine: ENGINE, env: {} });
  assert.deepEqual(rows, plain.canonicals.map((c, i) => [i + 1, c, plain.sigs[i], plain.seals[i]]));
  assert.deepEqual(stampRowsPast(plain.town, null, { engine: ENGINE, env: DECOYS(trustFile({ pubkeyPem: UAT.pub, afterSeal: plain.seals[2] })) }), rows,
    "a decoy name changes nothing");
  // a UAT suffix under prod's configuration: the line the base key didn't sign, in the words it always had
  const mixed = mixedTown(6, 3);
  assert.throws(() => stampRowsPast(mixed.town, null, { engine: ENGINE, env: {} }),
    { message: "the stamp ledger's line 4: its signature does not verify over its seal. Nothing was written." });
});

test("the writer keeps the town's boundary: the base key through the trusted seal, UAT's key only after it", () => {
  const m = mixedTown(7, 3);
  const env = uatEnv(m.afterSeal);
  const all = m.canonicals.map((c, i) => [i + 1, c, m.sigs[i], m.seals[i]]);
  assert.deepEqual(stampRowsPast(m.town, null, { engine: ENGINE, env }), all, "valid mixed history records whole");
  for (const h of [1, 3, 5]) {
    const head = { seq: h, canonical: m.canonicals[h - 1], sig: m.sigs[h - 1], seal: m.seals[h - 1] };
    assert.deepEqual(stampRowsPast(m.town, head, { engine: ENGINE, env }), all.slice(h), `past a head at line ${h}`);
  }
  // never either key on any line
  const baseSuffix = mixedTown(7, 3, { signer: (i) => (i < 4 ? BASE : UAT) });
  assert.throws(() => stampRowsPast(baseSuffix.town, null, { engine: ENGINE, env: uatEnv(baseSuffix.afterSeal) }),
    { message: "the stamp ledger's line 4: its signature does not verify over its seal under UAT's key (it is past the trusted seal). Nothing was written." });
  const uatPrefix = mixedTown(7, 3, { signer: (i) => (i < 2 ? BASE : UAT) });
  assert.throws(() => stampRowsPast(uatPrefix.town, null, { engine: ENGINE, env: uatEnv(uatPrefix.afterSeal) }),
    { message: "the stamp ledger's line 3: its signature does not verify over its seal under the base key (it is not past the trusted seal). Nothing was written." });
  const forged = mixedTown(7, 3, { signer: (i) => (i === 5 ? FORGER : i < 3 ? BASE : UAT) });
  assert.throws(() => stampRowsPast(forged.town, null, { engine: ENGINE, env: uatEnv(forged.afterSeal) }), /line 6: its signature does not verify/);
});

test("the writer fails closed on a trust it can't use: an unknown anchor, a past that isn't the store's, an unusable file", () => {
  const m = mixedTown(6, 3);
  assert.throws(() => stampRowsPast(m.town, null, { engine: ENGINE, env: uatEnv("d".repeat(64)) }),
    (e) => e.code === "STAMP_UAT_TRUST_UNUSABLE" && /is not a seal in the stamp ledger's export/.test(e.message));
  const wrongSeal = { seq: 2, canonical: m.canonicals[1], sig: m.sigs[1], seal: "e".repeat(64) };
  assert.throws(() => stampRowsPast(m.town, wrongSeal, { engine: ENGINE, env: uatEnv(m.afterSeal) }), /line 2 does not seal to the store's row 2/);
  assert.throws(() => stampRowsPast(m.town, null, { engine: ENGINE, env: { [UAT_TRUST_ENV]: join(scratch, "gone.json") } }),
    (e) => e.code === "STAMP_UAT_TRUST_UNUSABLE");
});

/** A read-only store holding `rows` (stamp_lines' columns), for verifyStampLinesVia. */
const storeOf = (m, count = m.canonicals.length) => ({
  query: async () => ({ rows: m.canonicals.slice(0, count).map((c, i) => ({ seq: i + 1, canonical: c, sig: m.sigs[i], seal: m.seals[i] })) }),
});

test("PROD CONTROL: the verifier, with no STAMP_UAT_TRUST, answers what it answered", async () => {
  const plain = mixedTown(5, 5);
  assert.deepEqual(await verifyStampLinesVia(storeOf(plain), plain.town, { engine: ENGINE, env: {} }), { ok: true, problems: [], held: 5, exported: 5 });
  const mixed = mixedTown(5, 2);
  assert.deepEqual(await verifyStampLinesVia(storeOf(mixed), mixed.town, { engine: ENGINE, env: DECOYS(trustFile({ pubkeyPem: UAT.pub, afterSeal: mixed.afterSeal })) }),
    { ok: false, problems: ["store: line 3's signature does not verify"], held: 5, exported: 5 });
});

test("the verifier keeps the same boundary, and fails visibly on a trust it can't use", async () => {
  const m = mixedTown(6, 2);
  assert.deepEqual(await verifyStampLinesVia(storeOf(m), m.town, { engine: ENGINE, env: uatEnv(m.afterSeal) }), { ok: true, problems: [], held: 6, exported: 6 });
  const baseSuffix = mixedTown(6, 2, { signer: (i) => (i < 3 ? BASE : UAT) });
  assert.deepEqual((await verifyStampLinesVia(storeOf(baseSuffix), baseSuffix.town, { engine: ENGINE, env: uatEnv(baseSuffix.afterSeal) })).problems,
    ["store: line 3's signature does not verify under UAT's key (it is past the trusted seal)"]);
  const unknown = await verifyStampLinesVia(storeOf(m), m.town, { engine: ENGINE, env: uatEnv("f".repeat(64)) });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.problems.length, 2, JSON.stringify(unknown.problems));
  assert.match(unknown.problems[0], /^store: the trust STAMP_UAT_TRUST names can't be used: its afterSeal ffffffffffff… is not a seal in the store's chain/, "the unknown anchor is named first");
  assert.match(unknown.problems[1], /^store: line 3's signature does not verify under the base key/, "and with no anchor every line is the prefix's");
  const short = await verifyStampLinesVia(storeOf(m, 1), m.town, { engine: ENGINE, env: uatEnv(m.afterSeal) });
  assert.ok(short.problems.some((p) => /is not a seal in the store's chain/.test(p)), JSON.stringify(short.problems));
  const unusable = await verifyStampLinesVia(storeOf(m), m.town, { engine: ENGINE, env: { [UAT_TRUST_ENV]: "" } });
  assert.equal(unusable.ok, false);
  assert.match(unusable.problems[0], /^store: STAMP_UAT_TRUST names "", and it can't be used/);
});

// ── src/stamp-verify-pinned.mjs: the runner every stamp-verify door goes through ────────────────────────────────

/** A pinned folder whose verifier is a stub that answers with the options it was handed. */
function stubPinned() {
  const dir = fresh("pinned");
  writeFileSync(join(dir, "stamp-pubkey.pem"), BASE.pub);
  writeFileSync(join(dir, "stamp-verify.mjs"),
    "export function verifyStampLedger(repo, opts) { return { ok: true, lines: 0, minted: 0, notes: [JSON.stringify({ keys: Object.keys(opts), opts })] }; }\n");
  return dir;
}
const childEnv = (extra = {}) => { const e = { ...process.env, ...extra }; if (!(UAT_TRUST_ENV in extra)) delete e[UAT_TRUST_ENV]; return e; };
const runRunner = (pinned, repo, env) => spawnSync(process.execPath, [RUNNER, "--pinned", pinned, "--repo", repo], { encoding: "utf8", env });
const GREEN = "✓ stamp-ledger verifies — 0 line(s), 0 minted, chain + signatures + replay + conservation + lawful all green";

test("PROD CONTROL: the runner, with no STAMP_UAT_TRUST, hands the town verifier exactly { pubkeyPem, registry } and says what it said", () => {
  const pinned = stubPinned(), repo = fresh("repo");
  for (const env of [childEnv(), childEnv(DECOYS(trustFile({ pubkeyPem: UAT.pub, afterSeal: "1".repeat(64) })))]) {
    const r = runRunner(pinned, repo, env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
    assert.equal(r.stdout, `${GREEN}\n  ! ${JSON.stringify({ keys: ["pubkeyPem", "registry"], opts: { pubkeyPem: BASE.pub, registry: null } })}\n`,
      "the same call, the same words: no handoff key at all");
  }
});

test("the runner hands the town verifier UAT's handoff from the trust file, mapped field for field", () => {
  const pinned = stubPinned(), repo = fresh("repo"), afterSeal = "2".repeat(64);
  const r = runRunner(pinned, repo, childEnv({ [UAT_TRUST_ENV]: trustFile({ pubkeyPem: UAT.pub, afterSeal }) }));
  assert.equal(r.status, 0, r.stderr);
  const said = JSON.parse(r.stdout.split("\n")[1].replace(/^ {2}! /, ""));
  assert.deepEqual(said, { keys: ["pubkeyPem", "registry", "handoff"], opts: { pubkeyPem: BASE.pub, registry: null, handoff: { pubkeyPem: UAT.pub, afterSeal } } });
});

test("the runner refuses an unusable trust before the verifier is so much as imported: exit 2, NOT verified", () => {
  const pinned = stubPinned(), repo = fresh("repo"), seal = "3".repeat(64);
  for (const path of ["", join(scratch, "missing.json"), trustFile({ pubkeyPem: UAT.priv, afterSeal: seal }), trustFile({ pubkeyPem: BASE.pub, afterSeal: seal }),
    trustFile({ pubkeyPem: UAT.pub, afterSeal: seal }, { dir: repo })]) {
    const r = runRunner(pinned, repo, childEnv({ [UAT_TRUST_ENV]: path }));
    assert.equal(r.status, 2, `${path}: ${r.stdout}${r.stderr}`);
    assert.equal(r.stdout, "", "the stub verifier never answered");
    assert.match(r.stderr, /^✗ stamp-ledger NOT verified: STAMP_UAT_TRUST names /);
  }
});

// The real town verifier, pinned from a fixture town that carries BASE's public half as its key.
function realVerifierTown(m, fromTown) {
  copyTownModule(fromTown, m.town, "stamp-verify.mjs");
  return join(pinTown(m.town), "tools");
}
const HANDOFF_TOWN = process.env.OFFICE_HANDOFF_TOWN || null;
const needsHandoff = HANDOFF_TOWN ? false
  : "needs POS-1213's town head (verifyStampLedger's handoff), which the office hasn't pinned yet; set OFFICE_HANDOFF_TOWN=<a town checkout with it>";

test("PROD CONTROL with the town's real verifier: no trust, and a UAT suffix fails at its first line, visibly", () => {
  const m = mixedTown(6, 3);
  const pinned = realVerifierTown(m, HANDOFF_TOWN ?? pinnedTown());
  const r = runRunner(pinned, m.town, childEnv());
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /line 4: SIGNATURE FAILS/);
  assert.doesNotMatch(r.stderr, /line [1-3]: SIGNATURE FAILS/, "the base-signed prefix verifies");
});

test("WITH THE TOWN'S HANDOFF (POS-1213): valid mixed history verifies; a suffix line signed by the base key fails", { skip: needsHandoff }, () => {
  const m = mixedTown(6, 3);
  const ok = runRunner(realVerifierTown(m, HANDOFF_TOWN), m.town, childEnv(uatEnv(m.afterSeal)));
  assert.match(ok.stdout + ok.stderr, /stamp-ledger/, "the town's verifier ran");
  assert.doesNotMatch(ok.stdout + ok.stderr, /SIGNATURE FAILS|UNSIGNED|handoff: /, "no signature problem and no handoff problem (what replay finds in this mail-less town is not this test's)");
  const bad = mixedTown(6, 3, { signer: (i) => (i < 4 ? BASE : UAT) });
  const r = runRunner(realVerifierTown(bad, HANDOFF_TOWN), bad.town, childEnv(uatEnv(bad.afterSeal)));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /line 4: SIGNATURE FAILS/);
});

// ── the mint pass (stamp-mint-run § pinnedVerifier) and the admission replay (house-key § replayHolds) ───────────

/**
 * A town of stubs, pinned: its verifier writes the options it was handed (JSON, one line per call) to the file
 * HANDOFF_PROBE names and finds nothing wrong; its engine reads the ledger's lines and no mail. Returns the town,
 * its pins and the probe's path.
 */
function stubTown() {
  const town = fresh("stub-town"), probe = join(fresh("probe"), "calls.jsonl");
  mkdirSync(join(town, "tools"), { recursive: true });
  mkdirSync(join(town, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(town, "tools", "stamp-pubkey.pem"), BASE.pub);
  writeFileSync(join(town, "tools", "stamp-verify.mjs"), [
    "import { appendFileSync } from 'node:fs';",
    "export function verifyStampLedger(repo, opts) {",
    "  appendFileSync(process.env.HANDOFF_PROBE, JSON.stringify({ keys: Object.keys(opts), opts }) + '\\n');",
    "  return { ok: true, problems: [], opts };",
    "}",
  ].join("\n"));
  writeFileSync(join(town, "tools", "stamp-mint.mjs"), [
    "export const parseStampLedger = (t) => t.split('\\n').filter((l) => l.startsWith('- ')).map((canonical) => ({ canonical }));",
    "export const parseDeliveries = () => [];",
  ].join("\n"));
  writeFileSync(join(town, "WHITE_PAGES", "stamp-ledger.md"), "- 2026-11-24 · MINT → ada · 1 · for: letter-x (sent)\n");
  return { town, pins: pinTown(town), probe };
}
const calls = (probe) => (existsSync(probe) ? readFileSync(probe, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
/** Runs `fn` with this process's loader reading `pins` and the stub verifier writing to `probe`. */
async function withPins({ pins, probe }, fn) {
  const before = { pins: process.env.TOWN_PINS_DIR, probe: process.env.HANDOFF_PROBE };
  Object.assign(process.env, { TOWN_PINS_DIR: pins, HANDOFF_PROBE: probe });
  try { return await fn(); }
  finally {
    for (const [k, v] of [["TOWN_PINS_DIR", before.pins], ["HANDOFF_PROBE", before.probe]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test("PROD CONTROL: the mint pass's verifier, with no STAMP_UAT_TRUST, calls the town verifier exactly as before", async () => {
  const s = stubTown();
  await withPins(s, async () => {
    for (const env of [{}, DECOYS(trustFile({ pubkeyPem: UAT.pub, afterSeal: "4".repeat(64) }))]) {
      const v = await pinnedVerifier(s.town, { env });
      assert.deepEqual(v(s.town).opts, { pubkeyPem: BASE.pub });
      assert.deepEqual(v(s.town, { registry: { households: {} } }).opts, { registry: { households: {} }, pubkeyPem: BASE.pub });
    }
  });
  assert.deepEqual(calls(s.probe).map((c) => c.keys), [["pubkeyPem"], ["registry", "pubkeyPem"], ["pubkeyPem"], ["registry", "pubkeyPem"]]);
});

test("the mint pass's verifier hands over UAT's handoff, and refuses an unusable trust before any line is signed", async () => {
  const s = stubTown(), afterSeal = "5".repeat(64);
  await withPins(s, async () => {
    const v = await pinnedVerifier(s.town, { env: { [UAT_TRUST_ENV]: trustFile({ pubkeyPem: UAT.pub, afterSeal }) } });
    assert.deepEqual(v(s.town).opts, { pubkeyPem: BASE.pub, handoff: { pubkeyPem: UAT.pub, afterSeal } });
    await assert.rejects(pinnedVerifier(s.town, { env: { [UAT_TRUST_ENV]: trustFile({ pubkeyPem: BASE.pub, afterSeal }) } }),
      (e) => e.code === "STAMP_UAT_TRUST_UNUSABLE" && /its key is the base key/.test(e.message));
  });
});

const REPLAY = { signed: ["- 2026-11-24 · registry: ada = hh:ada-house · sig: x"], handles: ["ada"], date: "2026-11-24" };

test("PROD CONTROL: the admission replay, with no STAMP_UAT_TRUST, hands its child's verifier exactly { pubkeyPem }", async () => {
  const s = stubTown();
  await withPins(s, () => {
    for (const env of [{}, DECOYS(trustFile({ pubkeyPem: UAT.pub, afterSeal: "6".repeat(64) }))]) {
      assert.deepEqual(replayHolds(s.town, { ...REPLAY, env }), { holds: true, checked: "verified", active: ["ada"], fresh: [] });
    }
  });
  assert.deepEqual(calls(s.probe), [{ keys: ["pubkeyPem"], opts: { pubkeyPem: BASE.pub } }, { keys: ["pubkeyPem"], opts: { pubkeyPem: BASE.pub } }]);
});

test("the admission replay hands its child's verifier UAT's handoff, and refuses an unusable trust before the child runs", async () => {
  const s = stubTown(), afterSeal = "7".repeat(64);
  await withPins(s, () => {
    replayHolds(s.town, { ...REPLAY, env: { [UAT_TRUST_ENV]: trustFile({ pubkeyPem: UAT.pub, afterSeal }) } });
    assert.throws(() => replayHolds(s.town, { ...REPLAY, env: { [UAT_TRUST_ENV]: trustFile({ pubkeyPem: UAT.priv, afterSeal }) } }),
      (e) => e.code === "STAMP_UAT_TRUST_UNUSABLE");
  });
  assert.deepEqual(calls(s.probe), [{ keys: ["pubkeyPem", "handoff"], opts: { pubkeyPem: BASE.pub, handoff: { pubkeyPem: UAT.pub, afterSeal } } }],
    "one call, the UAT one: the refused trust never reached a child");
});
