// town-return.test.mjs — THE SETTLEMENT RETURNS EACH STAKER'S STAMPS ON A MARK
// THE TOWN REMOVES, AND NO SUCH MARK LEAVES BEFORE THEY ARE HOME (POS-1138).
//
//   node --test test/town-return.test.mjs
//
// Darko, 2026-11-18 15:0x EST: stamps on a town-opposed mark go "Back to each
// staker" when it leaves, the owner included. 16:3x: "Town-authored return",
// recorded as the town's act. The Town's half is POS-1139 (worldTownReturnApply,
// `for: town-return:S<n>`); this is the settlement's.
//
// THE RIG, for the seam. A real Postgres with S10 and S11 sealed
// (test/helpers/settlement-seed.mjs); the town's opposed word on bo/shed spoken
// before S11's seal; a stand-in World engine at a law sha of its own that
// returns whatever the town opposes WITH its subtree and WHATEVER ITS ESCROW,
// which is the shape WLD-203 gives the town's return (the pinned world clone's
// engine still keeps the escrow guard for the town, so a staked mark would only
// stand there); and a scratch town whose tools are the office's OWN pins, the
// POS-1139 candidate, with a test key. The writer is the real one: runTownReturn
// spawns src/town-return-exec.mjs under the flock, which runs the pinned engine
// and lands the ledger with the pen's ceremony. Nothing is pushed.
//
// Synthetic handles and marks.

// The office's own pins, not the suite clone's (town-pins-env.mjs): "" names them.
process.env.TOWN_PINS_DIR = "";

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tempDir } from "./helpers/temp-dir.mjs";
import { pinnedTown } from "./helpers/pinned-town.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { settlementRig, MARKS, git } from "./helpers/settlement-seed.mjs";
import { PIN_ROOT } from "../src/town-tool.mjs";
import {
  townReturnTargets, heldTownReturns, openFromStakes, lateTownReturns, settleTownReturns,
  runTownReturn, removalOf, TOWN_AUTHORITY,
} from "../src/town-return.mjs";
import { settlementTakesAway, servedSettlement, resetSettlementCaches } from "../src/world-settlement.mjs";

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

test("a late stake: a mark the town returned, that the settlement no longer holds and that carries stamps again, is returned under its own removal", () => {
  const open = new Map([["a/one", 2], ["b/two", 1], ["c/three", 5], ["d/four", 3]]);
  const returnedBy = new Map([["a/one", "S11"], ["b/two", "S9"], ["c/three", "S11"], ["e/five", "S11"], ["d/four", "S10"]]);
  assert.deepEqual(lateTownReturns({ open, returnedBy }, new Set(["d/four"])), [
    { removal: "S9", marks: ["b/two"] },
    { removal: "S11", marks: ["a/one", "c/three"] },
  ], "held marks and marks with nothing open are not returned; S9 sorts before S11");
});

test("a removal is named S<n> by its settlement, and nothing else names one", () => {
  assert.equal(removalOf(11), "S11");
  assert.equal(removalOf("172"), "S172");
  for (const bad of [0, -1, 1.5, null, "S11", "x"]) assert.throws(() => removalOf(bad), /settlement number/);
});

test("settleTownReturns: written first, then read; a failed write leaves the return waiting; no writer writes nothing", async () => {
  const targets = [{ mark: "bo/shed", leaving: ["bo/shed", "bo/shed-name"] }];
  let ledger = new Map([["bo/shed", 4], ["bo/shed-name", 1], ["x/late", 2]]);
  const read = async () => ({ open: new Map(ledger), returnedBy: new Map([["x/late", "S9"]]) });
  const calls = [];
  const write = async (a) => { calls.push(a); for (const m of a.marks) ledger.delete(m); return { appended: true, returned: a.marks.map((mark) => ({ mark })) }; };
  const ok = await settleTownReturns({ targets, removal: "S11", date: "2026-10-05", holds: new Set(["bo/shed", "bo/shed-name"]), read, write });
  assert.deepEqual(calls, [
    { marks: ["bo/shed", "bo/shed-name"], removal: "S11", date: "2026-10-05" },
    { marks: ["x/late"], removal: "S9", date: "2026-10-05" },
  ], "this settlement's return, then the late one under its own removal");
  assert.deepEqual(ok.held, []);
  assert.equal(ok.receipts.length, 2);
  assert.equal(ok.receipts[1].late, true);

  ledger = new Map([["bo/shed", 4]]);
  const failed = await settleTownReturns({ targets, removal: "S11", date: "2026-10-05", read, write: async () => ({ error: { code: 503, defect: "the office pen is busy" } }) });
  assert.deepEqual(failed.held, [{ ...targets[0], open: { "bo/shed": 4 } }], "a return that did not land holds its mark");
  assert.equal(failed.receipts[0].error.code, 503);

  const none = await settleTownReturns({ targets, removal: "S11", date: "2026-10-05", read });
  assert.deepEqual(none.receipts, []);
  assert.deepEqual(none.held.map((h) => h.mark), ["bo/shed"]);
});

test("settleTownReturns: a ledger that cannot be read falls back to the fold's own stakes, and writes no late return", async () => {
  const targets = [{ mark: "bo/shed", leaving: ["bo/shed"] }, { mark: "al/arch", leaving: ["al/arch"] }];
  const calls = [];
  const r = await settleTownReturns({
    targets, removal: "S11", date: "2026-10-05", stakes: [{ mark: "bo/shed", n: 2 }],
    read: async () => { throw new Error("the town lock was not free"); },
    write: async (a) => { calls.push(a); return { error: { code: 503, defect: "busy" } }; },
  });
  assert.equal(r.source, "snapshot");
  assert.equal(r.unread, "the live ledger could not be read (the office's log says why)", "a fault's own text goes to the log, never into the answer");
  assert.deepEqual(r.held.map((h) => h.mark), ["bo/shed"], "staked at the snapshot: waits; unstaked: leaves, as before");
  assert.deepEqual(calls.map((c) => c.removal), ["S11"], "only this settlement's own return; a late pass needs the live ledger");
});

// ─────────────────────────── the seam ───────────────────────────────────────

const store = await startStore({ db: "town_return_test" });
after(() => store.stop());
const skip = store.skip ?? false;
const { owner, asOffice, seal, seed } = settlementRig(store);

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

// The scratch town: the office's pinned tools (the POS-1139 candidate), a test key.
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
setEnv("TOWN_PUSH", undefined); setEnv("STAMP_LINES", undefined);
if (!skip) { setEnv("WORLD2_PG", "1"); setEnv("WORLD2_PG_URL", store.url("office_api")); } // the exec holds each mark's lock in the store
after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

const ledger = () => readFileSync(join(TOWN, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
const entries = () => MINT.parseStampLedger(ledger());
const balances = () => MINT.foldBalances(entries());
const openOn = (mark) => [...MINT.foldWorldMarkPositions(entries())].filter(([k]) => k.startsWith(`${mark}|`)).reduce((a, [, n]) => a + n, 0);
const write = (a) => runTownReturn(a, { townClone: TOWN });
const header = (id = 2) => asOffice(async (p) => (await p.query("SELECT * FROM world_snapshots WHERE id = $1", [id])).rows[0]);
const takesAway = async (o = {}) => asOffice(async (p) => settlementTakesAway(p, await header(o.id), { worldRepo: ENGINE, townRepo: TOWN, ...o.opts }));
const TOWN_WORD = async () => ({ actor: (await import("../src/town-stance.mjs")).TOWN_SPEAKER, on: SHED, stance: "opposed", as: "town" });
const seedOpposed = async () => seed({ lawSha: LAW, cutover: "S10", sealWords: [await TOWN_WORD()] });
const verify = async () => {
  const { verifyStampLedger } = await import(pathToFileURL(join(PIN_ROOT, "tools", "stamp-verify.mjs")).href);
  return verifyStampLedger(TOWN, { pubkeyPem: PUB });
};

test("THE GATE ALONE: no writer, so nothing is written, and the town-opposed shed and its name stand in git while their stamps are open", { skip }, async () => {
  await seedOpposed();
  const before = ledger();
  const away = await takesAway();
  assert.ok(!away.slugs.has(SHED) && !away.slugs.has(NAME), "neither leaves git");
  assert.equal(away.town_returns.removal, "S11");
  assert.deepEqual(away.town_returns.receipts, []);
  assert.equal(away.town_returns.source, "live");
  assert.deepEqual(away.town_returns.held, [{ mark: SHED, leaving: [SHED, NAME], open: { [SHED]: 12, [NAME]: 2 } }]);
  assert.equal(ledger(), before, "the ledger is untouched");
});

test("THE FALSIFIER: the writer returns the owner and every other staker exactly their remaining deposits, once, as the town's act; then the shed and its name leave", { skip }, async () => {
  await seedOpposed();
  const away = await takesAway({ opts: { townReturns: { write, date: "2026-10-05" } } });
  const [r] = away.town_returns.receipts;
  assert.equal(r.removal, "S11");
  assert.equal(r.appended, true);
  assert.deepEqual(r.returned, [
    { mark: SHED, handle: "ann", n: 3 },
    { mark: SHED, handle: "bo", n: 4 },       // the owner: 6 staked, 2 taken back by his own hand
    { mark: SHED, handle: "cy", n: 5 },
    { mark: NAME, handle: "cy", n: 2 },
  ]);
  assert.deepEqual(r.open_after, { [SHED]: 0, [NAME]: 0 });
  assert.match(r.commit ?? "", /^[0-9a-f]{40}$/, "the landing's own commit");
  assert.deepEqual(away.town_returns.held, []);
  assert.ok(away.slugs.has(SHED) && away.slugs.has(NAME), "with the stamps home, the shed and its name leave git");
  const bal = balances();
  for (const h of ["bo", "ann", "cy"]) assert.equal(bal.get(h), FUNDED[h], `${h} is whole`);
  assert.equal(bal.get("dot"), FUNDED.dot - 4, "a stake on a mark nobody opposed is untouched");
  assert.equal((ledger().match(/ · for: town-return:S11 · sig: /g) ?? []).length, 4, "recorded as the town's act");
  assert.equal((ledger().match(/ · for: unstake · sig: /g) ?? []).length, 1, "the owner's own unstake is the only unstake");
  const v = await verify();
  assert.equal(v.ok, true, (v.problems ?? []).join("; "));
});

test("REPLAY: the crossing run again finds every position closed, writes nothing, and the marks still leave", { skip }, async () => {
  await seedOpposed();
  const before = ledger();
  const again = await takesAway({ opts: { townReturns: { write, date: "2026-10-06" } } });
  const [r] = again.town_returns.receipts;
  assert.equal(r.appended, false);
  assert.deepEqual(r.returned, []);
  assert.deepEqual(r.nothing_open, [SHED, NAME]);
  assert.equal(ledger(), before, "byte for byte");
  assert.ok(again.slugs.has(SHED) && again.slugs.has(NAME));
});

test("SERVED: the shed is not served as gone while its stamps are open, and is once they are home", { skip }, async () => {
  await seedOpposed();
  // a stake lands after the town's word; the served World must hold the shed for it
  STAKE.worldStakeApply(TOWN, { handle: "ann", mark: SHED, n: 1, via: "api", date: "2026-10-07" }, PEM);
  commitTown("ann stakes again");
  resetSettlementCaches();
  const waiting = await asOffice((p) => servedSettlement(p, { worldRepo: ENGINE, townRepo: TOWN }));
  assert.ok(waiting.marks.some((m) => m.id === SHED), "the shed stands while ann's stamp is on it");
  assert.deepEqual(waiting.meta.town_returns_waiting, [{ mark: SHED, open: { [SHED]: 1 } }]);
  assert.match(waiting.meta.town_returns_note, /stands until the stamps staked on it are returned to each staker/);
  assert.deepEqual(waiting.meta.opposed.town, [SHED], "the town's word still stands on it");

  const done = await takesAway({ opts: { townReturns: { write, date: "2026-10-07" } } });
  assert.deepEqual(done.town_returns.receipts[0].returned, [{ mark: SHED, handle: "ann", n: 1 }], "the late stake is returned at the crossing");
  resetSettlementCaches();
  const gone = await asOffice((p) => servedSettlement(p, { worldRepo: ENGINE, townRepo: TOWN }));
  assert.ok(!gone.marks.some((m) => m.id === SHED || m.id === NAME), "home, so served as gone");
  assert.equal(gone.meta.town_returns_waiting, undefined);
});

test("LATE, AFTER IT LEFT: a stake landing after the World dropped the shed goes home at the next settlement, under S11", { skip }, async () => {
  await seedOpposed();
  STAKE.worldStakeApply(TOWN, { handle: "dot", mark: SHED, n: 2, via: "api", date: "2026-10-08" }, PEM);
  commitTown("dot stakes on a mark that has left");
  // S12 no longer holds the shed or its name
  await owner(async (c) => {
    await c.query("INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES (502, '2026-10-02T06:00:00Z', '2026-10-02T18:00:00Z', 'closed', '2026-10-02T06:00:00Z')");
    await seal(c, { id: 3, window: 502, number: 12, marks: [MARKS.plot, MARKS.bench, MARKS.yard], lawSha: LAW,
      stances: { counted: true, cutover: "S10", settlement_inferred: 12, how: "row" } });
  });
  const next = await takesAway({ id: 3, opts: { townReturns: { write, date: "2026-10-09" } } });
  const late = next.town_returns.receipts.find((x) => x.late);
  assert.equal(late.removal, "S11", "returned under the removal that took the shed");
  assert.deepEqual(late.returned, [{ mark: SHED, handle: "dot", n: 2 }]);
  assert.equal(openOn(SHED), 0);
  const v = await verify();
  assert.equal(v.ok, true, (v.problems ?? []).join("; "));
});

test("WRITER FAILURE: a pen with no key returns nothing, so the staked return waits and nothing leaves", { skip }, async () => {
  await seedOpposed();
  STAKE.worldStakeApply(TOWN, { handle: "cy", mark: NAME, n: 1, via: "api", date: "2026-10-10" }, PEM);
  commitTown("cy backs the name again");
  const before = ledger();
  setEnv("STAMP_KEY", join(tempDir("town-return-nokey-"), "absent.pem"));
  try {
    const away = await takesAway({ opts: { townReturns: { write, date: "2026-10-10" } } });
    assert.equal(away.town_returns.receipts[0].error.code, 409);
    assert.deepEqual(away.town_returns.held.map((h) => h.mark), [SHED]);
    assert.ok(!away.slugs.has(SHED) && !away.slugs.has(NAME), "the removal waits for its return");
    assert.equal(ledger(), before);
  } finally { process.env.STAMP_KEY = KEY; }
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
  await seed({ lawSha: LAW, cutover: "S10", sealWords: [{ ...(await TOWN_WORD()), stance: "neutral" }] });
  const before = ledger();
  const away = await takesAway({ opts: { townReturns: { write, date: "2026-10-11" } } });
  assert.ok(!away.slugs.has(SHED));
  assert.deepEqual(away.town_returns?.held ?? [], []);
  assert.ok((away.town_returns?.receipts ?? []).every((r) => r.late), "only a late pass could write, and none is owed");
  assert.equal(ledger(), before);
});
