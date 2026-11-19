// town-return.test.mjs — THE REAL CROSSING RETURNS EACH STAKER'S STAMPS ON A
// MARK THE TOWN REMOVES, AND DOES NOT TAKE IT AWAY BEFORE THEY ARE HOME (POS-1138).
//
//   node --test test/town-return.test.mjs
//
// Darko, 2026-11-18 15:0x EST: stamps on a town-opposed mark go "Back to each
// staker" when it leaves, the owner included. 16:3x: "Town-authored return",
// recorded as the town's act. Wright, 2026-11-19 00:35Z (A): written "only on a
// real, non-dry crossing: it checks that SETTLEMENT_DRY is unset and passes an
// explicit write flag from the real path". The Town's half is POS-1139
// (worldTownReturnApply, `for: town-return:S<n>`); this is the crossing's.
//
// THE RIG, for the seam. A real Postgres with S10 and S11 sealed
// (test/helpers/settlement-seed.mjs); the town's opposed word on bo/shed spoken
// before S11's seal; a stand-in World engine at a law sha of its own that
// returns whatever the town opposes WITH its subtree and WHATEVER ITS ESCROW,
// which is the shape WLD-203 gives the town's return (the pinned world clone's
// engine still keeps the escrow guard for the town, so a staked mark would only
// stand there); and a scratch town whose tools are the office's OWN pins, the
// POS-1139 code, with a test key. The caller is the real one: fold-input-cli's
// § townReturnsOf decides from an argv and an environment, § settlementWithhold
// runs the crossing's block, and the writer spawns src/town-return-exec.mjs
// under the flock, which runs the pinned engine and lands the ledger with the
// pen's ceremony. Nothing is pushed.
//
// Synthetic handles and marks.

// The office's own pins, not the suite clone's (town-pins-env.mjs): "" names them.
process.env.TOWN_PINS_DIR = "";

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tempDir } from "./helpers/temp-dir.mjs";
import { pinnedTown } from "./helpers/pinned-town.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { settlementRig, MARKS, git } from "./helpers/settlement-seed.mjs";
import { PIN_ROOT } from "../src/town-tool.mjs";
import {
  townReturnTargets, heldTownReturns, openFromStakes, settleTownReturns, townReturnWrite, removalOf, TOWN_AUTHORITY,
} from "../src/town-return.mjs";
import { settlementTakesAway } from "../src/world-settlement.mjs";
import { settlementWithhold, townReturnsOf } from "../world2/tools/fold-input-cli.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ─────────────────────────── the pure half ──────────────────────────────────

const ret = (mark, o = {}) => ({ mark, authority: TOWN_AUTHORITY, state: "returned", subtree: [], ...o });

test("a town return is the town's stance return only: not a limit, not a holder's or the commons', not one still pending", () => {
  const state = { returned: [
    ret("bo/shed", { subtree: ["bo/shed-name"] }),
    ret("cy/yard", { law: "the-town/claim-cap" }),                       // a limit: cites its law, leaves by its own rule
    ret("ann/porch", { authority: "parcel (absolute)" }),                // a holder's word
    ret("dee/wall", { authority: "commons edge (earned)" }),
    ret("eve/hut", { state: "pending-escrow", open_escrow_on: ["eve/hut"] }), // an engine that keeps the town's guard: it stands
    ret("al/arch"),
  ] };
  assert.deepEqual(townReturnTargets(state), [
    { mark: "al/arch", leaving: ["al/arch"] },
    { mark: "bo/shed", leaving: ["bo/shed", "bo/shed-name"] },
  ]);
  assert.deepEqual(townReturnTargets({}), []);
});

test("the gate holds a return while any mark it takes carries open stamps, and names them", () => {
  const targets = [{ mark: "al/arch", leaving: ["al/arch"] }, { mark: "bo/shed", leaving: ["bo/shed", "bo/shed-name"] }];
  const open = openFromStakes([{ mark: "bo/shed-name", n: 2 }, { mark: "bo/shed-name", n: 1 }, { mark: "zz/x", n: 4 }, { mark: "al/arch", n: 0 }]);
  assert.deepEqual([...open], [["bo/shed-name", 3], ["zz/x", 4]]);
  assert.deepEqual(heldTownReturns(targets, open), [{ mark: "bo/shed", leaving: ["bo/shed", "bo/shed-name"], open: { "bo/shed-name": 3 } }]);
  assert.deepEqual(heldTownReturns(targets, new Map()), []);
});

test("a removal is named S<n> by its settlement, and nothing else names one", () => {
  assert.equal(removalOf(11), "S11");
  assert.equal(removalOf("172"), "S172");
  for (const bad of [0, -1, 1.5, null, "S11", "x"]) assert.throws(() => removalOf(bad), /settlement number/);
});

test("ONLY A REAL CROSSING WRITES: the explicit flag AND SETTLEMENT_DRY unset, literally; any value of it refuses", async () => {
  assert.deepEqual(townReturnWrite({ flag: true, env: {} }), { write: true });
  assert.match(townReturnWrite({ flag: false, env: {} }).why, /no --town-returns/);
  for (const v of ["1", "0", "", "no"])
    assert.match(townReturnWrite({ flag: true, env: { SETTLEMENT_DRY: v } }).why, /SETTLEMENT_DRY is set/, `SETTLEMENT_DRY=${JSON.stringify(v)}`);
  // the CLI's own decision, from its argv and environment
  const runs = [];
  const run = async (a) => { runs.push(a); return { appended: false }; };
  assert.equal((await townReturnsOf({ argv: ["node", "fold-input-cli.mjs"], env: {}, run })).write, null);
  assert.equal((await townReturnsOf({ argv: ["node", "fold-input-cli.mjs", "--town-returns"], env: { SETTLEMENT_DRY: "0" }, run })).write, null);
  const real = await townReturnsOf({ argv: ["node", "fold-input-cli.mjs", "--town-returns"], env: {}, townClone: "/t", run });
  assert.equal(typeof real.write, "function");
  assert.equal(real.why, null);
});

test("THE BOX'S CALLERS: settlement-auto.sh passes the flag only with SETTLEMENT_DRY unset; the shadow never passes it", () => {
  const auto = readFileSync(join(ROOT, "deploy", "settlement-auto.sh"), "utf8");
  const guard = auto.split("\n").find((l) => l.includes('TOWN_RETURNS="--town-returns"'));
  assert.equal(guard?.trim(), 'if [ -z "${SETTLEMENT_DRY+set}" ]; then TOWN_RETURNS="--town-returns"; fi');
  assert.match(auto, /fold-input-cli\.mjs" \\\n[^\n]*\n[^\n]*--world-repo "\$SWEEP" \$TOWN_RETURNS\)/, "the real call carries it");
  // the guard as the script runs it, under each environment
  const said = (env) => execFileSync("/bin/sh", ["-c", `set -eu\nTOWN_RETURNS=""\n${guard.trim()}\nprintf %s "$TOWN_RETURNS"`], { encoding: "utf8", env });
  const base = { PATH: process.env.PATH };
  assert.equal(said(base), "--town-returns");
  for (const v of ["1", "0", ""]) assert.equal(said({ ...base, SETTLEMENT_DRY: v }), "", `SETTLEMENT_DRY=${JSON.stringify(v)}`);
  const shadow = readFileSync(join(ROOT, "deploy", "settlement-shadow.sh"), "utf8");
  assert.match(shadow, /fold-input-cli\.mjs/);
  assert.doesNotMatch(shadow, /--town-returns|TOWN_RETURNS/, "a rehearsal never pays");
});

test("settleTownReturns: written first, then read; a failed write leaves the return waiting; no writer writes nothing", async () => {
  const targets = [{ mark: "bo/shed", leaving: ["bo/shed", "bo/shed-name"] }];
  let ledger = new Map([["bo/shed", 4], ["bo/shed-name", 1]]);
  const read = async () => ({ open: new Map(ledger) });
  const calls = [];
  const write = async (a) => { calls.push(a); for (const m of a.marks) ledger.delete(m); return { appended: true }; };
  const ok = await settleTownReturns({ targets, removal: "S11", date: "2026-10-02", read, write });
  assert.deepEqual(calls, [{ marks: ["bo/shed", "bo/shed-name"], removal: "S11", date: "2026-10-02" }], "one batch, the seal's removal and day");
  assert.deepEqual(ok.held, []);
  assert.deepEqual(ok.receipt, { appended: true });

  ledger = new Map([["bo/shed", 4]]);
  const failed = await settleTownReturns({ targets, removal: "S11", date: "2026-10-02", read, write: async () => ({ error: { code: 503, defect: "the office pen is busy" } }) });
  assert.deepEqual(failed.held, [{ ...targets[0], open: { "bo/shed": 4 } }], "a return that did not land holds its mark");
  assert.equal(failed.receipt.error.code, 503);

  const none = await settleTownReturns({ targets, removal: "S11", date: "2026-10-02", read });
  assert.equal(none.receipt, undefined);
  assert.deepEqual(none.held.map((h) => h.mark), ["bo/shed"]);
});

test("settleTownReturns: a ledger that cannot be read falls back to the fold's own stakes, in the office's own words", async () => {
  const targets = [{ mark: "bo/shed", leaving: ["bo/shed"] }, { mark: "al/arch", leaving: ["al/arch"] }];
  const r = await settleTownReturns({
    targets, removal: "S11", date: "2026-10-02", stakes: [{ mark: "bo/shed", n: 2 }],
    read: async () => { throw new Error("the town lock was not free"); },
  });
  assert.equal(r.source, "snapshot");
  assert.equal(r.unread, "the live ledger could not be read (the office's log says why)", "a fault's own text goes to the log, never into the answer");
  assert.deepEqual(r.held.map((h) => h.mark), ["bo/shed"], "staked at the snapshot: waits; unstaked: leaves, as before");
});

// ─────────────────────────── the seam ───────────────────────────────────────

const store = await startStore({ db: "town_return_test" });
after(() => store.stop());
const skip = store.skip ?? false;
const { asOffice, seed } = settlementRig(store);

// The stand-in engine: the town's word returns the mark with its declared
// children, whatever is staked on them (WLD-203's town return).
const ENGINE = tempDir("town-return-engine-");
mkdirSync(join(ENGINE, "tools"));
writeFileSync(join(ENGINE, "tools", "consent.mjs"), 'export const TOWN_WORDS = new Set(["neutral", "opposed"]);\nexport const STANCE_RETURNS_ALONE = true;\n');
writeFileSync(join(ENGINE, "tools", "marks-fold.mjs"), [
  "export function fold({ marks, townWords = null }) {",
  "  const opposed = new Set([...(townWords ?? new Map())].filter(([, w]) => w === 'opposed').map(([id]) => id));",
  "  const kids = (id) => marks.filter((m) => m.parent === id).map((m) => m.id);",
  "  const returned = [...opposed].sort().map((mark) => ({ mark, authority: 'the town (absolute)', returned_from: 'the-town', subtree: kids(mark), state: 'returned' }));",
  "  const away = new Set(returned.flatMap((r) => [r.mark, ...r.subtree]));",
  "  return { marks: marks.filter((m) => !away.has(m.id)).map((m) => ({ id: m.id, parent: m.parent ?? null })), parcels: [], returned };",
  "}", ""].join("\n"));
git(ENGINE, "init", "-q");
git(ENGINE, "-c", "user.name=t", "-c", "user.email=t@t", "add", ".");
git(ENGINE, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "stand-in engine: the town's return, WLD-203's shape");
const LAW = git(ENGINE, "rev-parse", "HEAD");

// The scratch town: the office's pinned tools (the POS-1139 code), a test key.
const SHED = "bo/shed", NAME = "bo/shed-name";
const TOWN = tempDir("town-return-town-");
pinnedTown(TOWN);
mkdirSync(join(TOWN, "WHITE_PAGES"), { recursive: true });
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = publicKey.export({ type: "spki", format: "pem" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const KEY = join(tempDir("town-return-key-"), "stamp-key.pem");
writeFileSync(KEY, PEM);
execFileSync("git", ["init", "-q", "-b", "main", TOWN]);
const MINT = await import(pathToFileURL(join(TOWN, "tools", "stamp-mint.mjs")).href);
const STAKE = await import(pathToFileURL(join(TOWN, "tools", "world-stake.mjs")).href);
const commitTown = (m) => { git(TOWN, "add", "-A"); git(TOWN, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", m); };
MINT.appendSigned(TOWN, ["- 2026-06-12 · rules: stamps-v1"], PEM); // the ledger's first line, as the verifier holds it
MINT.appendSigned(TOWN, ["bo", "ann", "cy", "dot"].map((handle) => MINT.giftLine({ date: "2026-09-01", handle, n: 20, slug: "seed", by: "the-town" })), PEM);
// bo owns the shed; ann and cy back it too; cy backs its name; bo took 2 of his own back.
STAKE.worldStakeApply(TOWN, { handle: "bo", mark: SHED, n: 6, via: "api", date: "2026-10-02" }, PEM);
STAKE.worldStakeApply(TOWN, { handle: "ann", mark: SHED, n: 3, via: "api", date: "2026-10-02" }, PEM);
STAKE.worldStakeApply(TOWN, { handle: "cy", mark: SHED, n: 5, via: "api", date: "2026-10-02" }, PEM);
STAKE.worldStakeApply(TOWN, { handle: "cy", mark: NAME, n: 2, via: "api", date: "2026-10-02" }, PEM);
STAKE.worldStakeApply(TOWN, { handle: "dot", mark: MARKS.bench.slug, n: 4, via: "api", date: "2026-10-02" }, PEM); // a mark nobody opposed
STAKE.worldUnstakeApply(TOWN, { handle: "bo", mark: SHED, n: 2, date: "2026-10-03" }, PEM);
commitTown("fixture town");
const FUNDED = Object.fromEntries(["bo", "ann", "cy", "dot"].map((h) => [h, 20]));

const saved = {};
const setEnv = (k, v) => { if (!(k in saved)) saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
setEnv("TOWN_CLONE", TOWN);
setEnv("STAMP_KEY", KEY);
setEnv("TOWN_LOCK", join(tempDir("town-return-lock-"), "town.lock"));
setEnv("BOT_NAME", "fixture"); setEnv("BOT_EMAIL", "fixture@test.invalid");
setEnv("TOWN_PUSH", undefined); setEnv("STAMP_LINES", undefined); setEnv("SETTLEMENT_DRY", undefined);
if (!skip) { setEnv("WORLD2_PG", "1"); setEnv("WORLD2_PG_URL", store.url("office_api")); } // the exec holds each mark's lock in the store
after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

const ledger = () => readFileSync(join(TOWN, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
const entries = () => MINT.parseStampLedger(ledger());
const balances = () => MINT.foldBalances(entries());
const header = () => asOffice(async (p) => (await p.query("SELECT * FROM world_snapshots WHERE id = 2")).rows[0]);
const TOWN_WORD = async (stance = "opposed") => ({ actor: (await import("../src/town-stance.mjs")).TOWN_SPEAKER, on: SHED, stance, as: "town" });
const seedWord = async (stance = "opposed") => seed({ lawSha: LAW, cutover: "S10", sealWords: [await TOWN_WORD(stance)] });
const verify = async () => {
  const { verifyStampLedger } = await import(pathToFileURL(join(PIN_ROOT, "tools", "stamp-verify.mjs")).href);
  return verifyStampLedger(TOWN, { pubkeyPem: PUB });
};

// THE CROSSING'S BLOCK as fold-input-cli runs it: its docket, its selection,
// and the writer its argv and environment decide (§ townReturnsOf).
const DOCKET = [MARKS.plot, MARKS.bench, MARKS.yard, MARKS.shed, MARKS.name].map((m) => ({ slug: m.slug }));
const SELECTION = { entry: "fold-delta.mjs § foldDelta", docket_claims: DOCKET.length, carried_absent: { checked: true, count: 0, slugs: [] } };
const NOT_DRY = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "SETTLEMENT_DRY"));
const cross = async ({ argv = ["node", "fold-input-cli.mjs", "--town-returns"], env = NOT_DRY } = {}) => {
  const townReturns = await townReturnsOf({ argv, env, townClone: TOWN });
  return asOffice((p) => settlementWithhold(p, {
    window: 501, worldRepo: ENGINE, townClone: TOWN, out: { marks: DOCKET, as_of: { window: 501 } }, selection: SELECTION, townReturns,
  }));
};
const written = (r) => r.out.marks.map((m) => m.slug);

test("NO FLAG, OR ANY SETTLEMENT_DRY: nothing is paid, and the town-opposed shed and its name stay in this crossing's write-down", { skip }, async () => {
  await seedWord();
  const before = ledger();
  for (const run of [{ argv: ["node", "fold-input-cli.mjs"] }, { env: { ...NOT_DRY, SETTLEMENT_DRY: "0" } }, { env: { ...NOT_DRY, SETTLEMENT_DRY: "1" } }, { env: { ...NOT_DRY, SETTLEMENT_DRY: "" } }]) {
    const r = await cross(run);
    const t = r.selection.settlement.town_returns;
    assert.ok(written(r).includes(SHED) && written(r).includes(NAME), "neither leaves this crossing");
    assert.equal(t.receipt, undefined, "no write was made");
    assert.match(t.not_written, /no --town-returns|SETTLEMENT_DRY is set/);
    assert.deepEqual(t.held, [{ mark: SHED, leaving: [SHED, NAME], open: { [SHED]: 12, [NAME]: 2 } }]);
    assert.equal(ledger(), before, "the ledger is untouched");
  }
});

test("THE FALSIFIER: the real crossing returns the owner and every other staker exactly their remaining deposits, once, as the town's act, under the seal's S11 and day; then the shed and its name leave", { skip }, async () => {
  await seedWord();
  const r = await cross();
  const t = r.selection.settlement.town_returns;
  assert.equal(t.removal, "S11");
  assert.equal(t.date, "2026-10-02", "S11 was sealed at 2026-10-03T00:00Z, the 2nd in town time");
  assert.equal(t.receipt.removal, "S11");
  assert.equal(t.receipt.appended, true);
  assert.deepEqual(t.receipt.returned, [
    { mark: SHED, handle: "ann", n: 3 },
    { mark: SHED, handle: "bo", n: 4 },       // the owner: 6 staked, 2 taken back by his own hand
    { mark: SHED, handle: "cy", n: 5 },
    { mark: NAME, handle: "cy", n: 2 },
  ]);
  assert.deepEqual(t.receipt.open_after, { [SHED]: 0, [NAME]: 0 });
  assert.match(t.receipt.commit ?? "", /^[0-9a-f]{40}$/, "the landing's own commit");
  assert.deepEqual(t.held, []);
  assert.ok(!written(r).includes(SHED) && !written(r).includes(NAME), "with the stamps home, the shed and its name leave this crossing");
  assert.ok(r.selection.settlement.taken_away.includes(SHED));
  const bal = balances();
  for (const h of ["bo", "ann", "cy"]) assert.equal(bal.get(h), FUNDED[h], `${h} is whole`);
  assert.equal(bal.get("dot"), FUNDED.dot - 4, "a stake on a mark nobody opposed is untouched");
  assert.equal((ledger().match(/ · for: town-return:S11 · sig: /g) ?? []).length, 4, "recorded as the town's act");
  assert.equal((ledger().match(/ · for: unstake · sig: /g) ?? []).length, 1, "the owner's own unstake is the only unstake");
  assert.match(ledger(), /\n- 2026-10-02 · stake:world-mark\/bo\/shed → ann · 3 · for: town-return:S11 · sig: /);
  const v = await verify();
  assert.equal(v.ok, true, (v.problems ?? []).join("; "));
});

test("REPLAY: the crossing run again finds every position closed, writes nothing, and the marks still leave", { skip }, async () => {
  await seedWord();
  const before = ledger();
  const r = await cross();
  const t = r.selection.settlement.town_returns;
  assert.equal(t.receipt.appended, false);
  assert.deepEqual(t.receipt.returned, []);
  assert.deepEqual(t.receipt.nothing_open, [SHED, NAME]);
  assert.equal(ledger(), before, "byte for byte");
  assert.ok(!written(r).includes(SHED) && !written(r).includes(NAME));
});

test("WRITER FAILURE: a pen with no key returns nothing and says so; the staked return waits, and nothing leaves", { skip }, async () => {
  await seedWord();
  STAKE.worldStakeApply(TOWN, { handle: "cy", mark: NAME, n: 1, via: "api", date: "2026-10-02" }, PEM);
  commitTown("cy backs the name again");
  const before = ledger();
  const env = { ...NOT_DRY, STAMP_KEY: join(tempDir("town-return-nokey-"), "absent.pem") };
  const r = await cross({ env });
  const t = r.selection.settlement.town_returns;
  assert.equal(t.receipt.error.code, 409, "never a success");
  assert.equal(t.receipt.appended, undefined);
  assert.deepEqual(t.held.map((h) => h.mark), [SHED]);
  assert.ok(written(r).includes(SHED) && written(r).includes(NAME), "the removal waits for its return");
  assert.equal(ledger(), before);
});

test("PIN MISMATCH: a town clone the office did not pin returns nothing and says so; the return waits", { skip }, async () => {
  await seedWord();
  const before = ledger();
  const env = { ...NOT_DRY, TOWN_PINS_DIR: join(tempDir("town-return-otherpins-")) };
  writeFileSync(join(env.TOWN_PINS_DIR, "PINS.json"), JSON.stringify({ town_commit: "0".repeat(40), files: {} }));
  const r = await cross({ env });
  const t = r.selection.settlement.town_returns;
  assert.equal(t.receipt.error.defect, "town-pin-mismatch");
  assert.deepEqual(t.held.map((h) => h.mark), [SHED]);
  assert.ok(written(r).includes(SHED));
  assert.equal(ledger(), before);
});

test("NO LIVE LEDGER: the stakes at the settlement's own ledger position decide, as before POS-1138", { skip }, async () => {
  await seed({ lawSha: LAW, cutover: "S10", sealWords: [await TOWN_WORD()],
    before: (c) => c.query("INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k) VALUES ($1, $2, 'cy', 'cy', 'cy', 3, 1)", ["a".repeat(40), NAME]) });
  const away = await asOffice(async (p) => settlementTakesAway(p, await header(), { worldRepo: ENGINE, townRepo: null }));
  assert.equal(away.town_returns.source, "snapshot");
  assert.deepEqual(away.town_returns.held.map((h) => h.mark), [SHED], "staked at the snapshot: it waits");
  assert.ok(!away.slugs.has(SHED));
});

test("SILENCE AND NEUTRAL: no town opposition is no town return, and nothing is written", { skip }, async () => {
  await seedWord("neutral");
  const before = ledger();
  const r = await cross();
  assert.ok(written(r).includes(SHED));
  assert.equal(r.selection.settlement.town_returns, undefined);
  assert.equal(ledger(), before);
});
