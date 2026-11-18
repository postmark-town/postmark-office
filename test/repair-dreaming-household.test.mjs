// repair-dreaming-household.test.mjs — POS-1055: Fen joins The Dreaming, the house reads "not given", history stays.
//
// Darko, 2026-11-15: "Re-key, after they say". Both residents said (their letters of 11-16 and 11-17): the move is
// welcome, the likeness answer is "not given". tools/repair-dreaming-household.mjs is tools/move-resident.mjs (the
// existing road) pinned to that one resident and those two houses, and settling the joined house's answer in the same
// owner transaction as the move.
//
// Every house, handle, login and id here is INVENTED, shaped like the case. The store is a real embedded Postgres with
// every migration applied; the clone holds the town's own engine, over a ledger signed with a key this test holds.
//
//   R1  the dry run says what it would do (the answer "given" -> "not given", never a record) and reaches no writer
//   R2  THE CORRECTION: Fen is in the-dreaming, the house reads not given for BOTH residents, the emptied house is
//       retired into the spelling set, the pin, accounts, home picture, welcome, and every earlier ledger line stay,
//       one key for the two, the ledger verifies, one commit
//   R3  NO INTERMEDIATE YES: the answer and the move are one row write: a source that is not "no" under the lock
//       refuses and rolls back with the target still as it was
//   R4  the refusals: no recorded no, private likeness state on either house, an invitation credit, another house,
//       arguments the repair does not take; the generic move still leaves a target's own answer alone
//   R5  REPLAY: a push that cannot land leaves the store moved; the same command publishes the rest once, the house
//       still reads not given, and then there is nothing to do
//   R6  a house that already says no keeps its own record
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/repair-dreaming-household.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { pinTown, stageTownTools } from "./helpers/pinned-town.mjs"; // POS-994: the clone carries the town's modules, pinned
import { generateKeyPairSync, createPrivateKey, sign as edSign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers/temp-dir.mjs";
import { execFileSync } from "node:child_process";

import { fixtureTown } from "./fixture.mjs";
import { indexStore, seedRegistry, recordInProcess } from "./helpers/office-under-test.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";
import { loadRegistryRows, moveResidentInStore, MOVE_ROW_REFUSALS } from "../src/registry-store.mjs";
import { renderPublicRegistry } from "../src/registry-rows.mjs";
import { likenessOfHouse, likenessGiven } from "../src/likeness.mjs";
import { notLandedError, penTransaction } from "../src/write.mjs";
import { REGISTRY_PATH, PINS_PATH } from "../src/residency.mjs";
import { moveResident, MOVE_REFUSALS } from "../tools/move-resident.mjs";
import { repairDreaming, main as repairMain, DREAMING } from "../tools/repair-dreaming-household.mjs";

const TOWN = townClone();
const HAS_ENGINE = Boolean(TOWN) && existsSync(join(TOWN, "tools", "household-keys.mjs"));
const SKIP = !TOWN ? NO_TOWN : (!HAS_ENGINE && "the town clone predates tools/household-keys.mjs (town d95e81c1c)");
const ENGINE = HAS_ENGINE ? await import(townModuleUrl("tools", "stamp-mint.mjs")) : null;
const VERIFY = HAS_ENGINE ? await import(townModuleUrl("tools", "stamp-verify.mjs")) : null;
const KEYS = HAS_ENGINE ? await import(townModuleUrl("tools", "household-keys.mjs")) : null;

delete process.env.TOWN_PUSH;
const D = "2026-11-18";

const IX = await indexStore(fixtureTown());
const RECORD_RESTORE = await recordInProcess(IX.store);
after(async () => { await RECORD_RESTORE(); await IX.stop(); });

const git = (dir, ...a) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" }).trim();
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });

// THE TOWN, shaped like the case: Q keeps hh:the-dreaming and said yes; Fen joined later from another account, keeps
// hh:the-dreaming-fenofthedreaming alone, and said no. zeds is next door.
const MARK = "SYNTHETIC-PRIVATE-PROOF-9c1d";
const Q_YES = { answer: "yes", at: "2026-10-20T01:00:00.000Z", by: "q-gh", gh_id: 701, words: "2026-10-21" };
const FEN_NO = { answer: "no", at: "2026-10-26T01:00:00.000Z", by: "fen-gh", gh_id: 702, words: "2026-10-21" };
const HOUSES = ({ q = Q_YES, fen = FEN_NO } = {}) => ({
  "the-dreaming": { name: "The Dreaming", accounts: [{ login: "q-gh", id: 701 }], residents: ["qthedreaming"], since: "2026-07-17",
    declared_by: "fixture", ...(q ? { likeness: q } : {}), home_images: { qthedreaming: "https://media.postmark.town/the-dreaming/aa.png" } },
  "the-dreaming-fenofthedreaming": { name: "The Dreaming", accounts: [{ login: "fen-gh", id: 702 }], residents: ["the-fen"], since: "2026-07-28",
    declared_by: "fixture", ...(fen ? { likeness: fen } : {}), formerly: ["fen-first-try"], home_images: { "the-fen": "https://media.postmark.town/fen/bb.png" } },
  zeds: { name: "Zeds", accounts: [{ login: "zed-gh", id: 999 }], residents: ["zed"], since: "2026-06-12", declared_by: "fixture" },
});
const PINS = () => ({
  qthedreaming: { login: "q-gh", id: 701, pinned: "2026-07-17" },
  "the-fen": { login: "fen-gh", id: 702, pinned: "2026-07-28" },
  zed: { login: "zed-gh", id: 999, pinned: "2026-06-12" },
});
const KEYED = ["- 2026-07-17 · registry: qthedreaming = hh:the-dreaming", "- 2026-07-28 · registry: the-fen = hh:the-dreaming-fenofthedreaming"];

async function town({ houses = HOUSES() } = {}) {
  await seedRegistry(IX.store, { schema_version: 1, note: "invented for POS-1055", households: houses }, PINS());
  const printed = renderPublicRegistry(await loadRegistryRows());
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const dir = tempDir("pm-repair-dreaming-");
  dirs.push(dir);
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), printed.households);
  writeFileSync(join(dir, PINS_PATH), printed.pins);
  for (const [h, gh] of [["qthedreaming", "q-gh"], ["the-fen", "fen-gh"], ["zed", "zed-gh"]]) {
    mkdirSync(join(dir, "WHITE_PAGES", h), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\ngithub: ${gh}\nhousehold: ${h === "zed" ? "Zeds" : "The Dreaming"}\n---\n\n# ${h}\n`);
  }
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), "# mail\n\n- 2026-06-12 · zed-2026-06-12-to-zed2-genesis · zed → zed2\n");
  const bare = ["- 2026-06-12 · rules: stamps-v1", ...KEYED];
  writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), `# the ledger\n\n${bare.join("\n")}\n`);
  const { laws, revisions } = ENGINE.parseLaws(ENGINE.parseStampLedger(bare.join("\n") + "\n"));
  const mints = ENGINE.deriveMints(ENGINE.parseDeliveries(dir), ENGINE.householdKeys(dir), { laws, revisions }).map(ENGINE.mintLine);
  const lines = [...bare, ...mints];
  const seals = ENGINE.sealChain(lines);
  const key = createPrivateKey(pem);
  const signed = lines.map((l, i) => `${l} · sig: ${edSign(null, Buffer.from(seals[i], "utf8"), key).toString("base64url")}`);
  writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), `# the ledger\n\n${signed.join("\n")}\n`);
  writeFileSync(join(dir, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const keyDir = tempDir("pm-repair-dreaming-pen-");
  dirs.push(keyDir);
  const keyFile = join(keyDir, "stamp-key.pem");
  writeFileSync(keyFile, pem);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "seed");
  return { dir, keyFile };
}

const withPen = async (t, fn) => {
  const over = { STAMP_KEY: t.keyFile, TOWN_PINS_DIR: pinTown(stageTownTools(t.dir, TOWN)) };
  const prev = {};
  for (const [k, v] of Object.entries(over)) { prev[k] = process.env[k]; process.env[k] = v; }
  try { return await fn(); }
  finally { for (const [k, v] of Object.entries(prev)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
};

const ownerQuery = async (sql, params = []) => { const c = await asOwner(); try { return (await c.query(sql, params)).rows; } finally { await c.end(); } };
async function storeRows() {
  const h = await ownerQuery("SELECT slug, residents, accounts, formerly, home_images, invited_by, likeness FROM households ORDER BY slug");
  const p = await ownerQuery("SELECT handle, login, gh_id::text AS gh_id, pinned FROM household_pins ORDER BY handle");
  return { households: h, pins: p };
}
const asOwner = () => IX.store.connect("world2_owner");
const ledgerOf = (dir) => readFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
const registryLines = (dir) => ledgerOf(dir).split("\n").filter((l) => / · registry: /.test(l)).map((l) => l.replace(/ · sig: \S+$/, ""));
const head = (dir) => git(dir, "rev-parse", "HEAD");
const clean = (dir) => git(dir, "status", "--porcelain") === "";
const NEVER = (what) => async () => { throw new Error(`the dry run reached ${what}`); };
const NO_WRITERS = { owner: NEVER("the owner's connection"), move: NEVER("the store transaction"),
  drainWith: () => { throw new Error("the dry run reached the drain"); }, commit: () => { throw new Error("the dry run reached the pen"); } };
const run = (t, extra = {}) => withPen(t, () => repairDreaming({ clone: t.dir, date: D, owner: asOwner, ...extra }));
const reads = async () => ({ q: await likenessGiven("qthedreaming"), fen: await likenessGiven("the-fen") });
const stateColumn = async () => (await ownerQuery(
  "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'households' AND column_name = 'likeness_state'")).length > 0;
const with092 = async (fn) => {
  const added = !(await stateColumn());
  if (added) await ownerQuery("ALTER TABLE households ADD COLUMN likeness_state jsonb");
  try { return await fn(); }
  finally { if (added) await ownerQuery("ALTER TABLE households DROP COLUMN IF EXISTS likeness_state"); }
};
const setState = (slug, state) => ownerQuery("UPDATE households SET likeness_state = $2::jsonb WHERE slug = $1", [slug, JSON.stringify(state)]);
const STATE = { request: { at: "2026-11-09T12:00:00.000Z", by: "q-gh", gh_id: 701, depicts: ["qthedreaming"], note: MARK } };

// ── R1 the dry run ──────────────────────────────────────────────────────────

test("R1 · the dry run names the move and the answer's change as words, never a record, and reaches no writer", { skip: SKIP }, async () => {
  const t = await town();
  const before = await storeRows();
  const h0 = head(t.dir);
  const out = await withPen(t, () => repairDreaming({ clone: t.dir, date: D, dryRun: true, ...NO_WRITERS }));
  assert.equal(out.dryRun, true);
  assert.equal(out.plan.handle, "the-fen");
  assert.equal(out.plan.from, "the-dreaming-fenofthedreaming");
  assert.equal(out.plan.to, "the-dreaming");
  assert.deepEqual(out.plan.likeness, { house: "the-dreaming", before: "given", after: "not given" });
  assert.deepEqual(out.plan.ledger.lines, [`- ${D} · registry: the-fen = hh:the-dreaming`]);
  const log = [], err = [];
  const code = await withPen(t, () => repairMain(["--dry-run"], { env: { ...process.env, TOWN_CLONE: t.dir }, log: (s) => log.push(s), err: (s) => err.push(s),
    act: (a) => repairDreaming({ ...a, date: D, ...NO_WRITERS }) }));
  assert.equal(code, 0, err.join("\n"));
  assert.match(log.join("\n"), /likeness: the-dreaming reads given -> not given, in the same row write as the move/);
  const line = log.join("\n").split("\n").find((l) => l.startsWith("likeness:"));
  assert.ok(line && !/"answer"|"words"|gh_id|by/.test(line.replace("by the", "")), "the answer's change is said in words, with no record in the line");
  assert.deepEqual(await storeRows(), before);
  assert.equal(head(t.dir), h0);
  assert.ok(clean(t.dir));
});

// ── R2 the correction ───────────────────────────────────────────────────────

test("R2 · THE CORRECTION: Fen is in the-dreaming, the house reads not given for both, history and money untouched, one key, one commit", { skip: SKIP }, async () => {
  const t = await town();
  const before = await storeRows();
  const ledger0 = ledgerOf(t.dir).trimEnd().split("\n");
  assert.deepEqual(await withPen(t, reads), { q: true, fen: false }, "before: Q's house says given, Fen's says not given");
  const h0 = head(t.dir);
  const out = await run(t);
  assert.match(out.commit, /^[0-9a-f]{40}$/);
  assert.equal(git(t.dir, "rev-parse", `${out.commit}^`), h0, "one commit");

  const s = await storeRows();
  assert.deepEqual(s.pins, before.pins, "THE PINS ARE KEPT: Fen's handle, login and GitHub id stay bound");
  assert.deepEqual(s.households.map((h) => h.slug), ["the-dreaming", "zeds"], "the emptied house is retired; nothing else is");
  const dr = s.households.find((h) => h.slug === "the-dreaming");
  assert.deepEqual(dr.residents, ["qthedreaming", "the-fen"], "the target keeps Q and gains Fen");
  assert.deepEqual(dr.accounts, [{ login: "q-gh", id: 701 }, { login: "fen-gh", id: 702 }], "both accounts still bind the house, so both reach their own identities");
  assert.deepEqual(dr.formerly, ["the-dreaming-fenofthedreaming", "fen-first-try"], "the old spelling stays this house's, through the normal retirement");
  assert.deepEqual(dr.home_images, { qthedreaming: "https://media.postmark.town/the-dreaming/aa.png", "the-fen": "https://media.postmark.town/fen/bb.png" });
  assert.deepEqual(dr.likeness, FEN_NO, "the house's answer is the no Fen recorded: carried, not made up");
  assert.deepEqual(s.households.find((h) => h.slug === "zeds"), before.households.find((h) => h.slug === "zeds"), "the house next door is untouched");

  assert.deepEqual(await withPen(t, reads), { q: false, fen: false }, "after: neither resident is given, and there was no moment either was");
  const printed = JSON.parse(readFileSync(join(t.dir, REGISTRY_PATH), "utf8")).households;
  assert.equal(printed["the-dreaming-fenofthedreaming"], undefined);
  assert.equal(likenessOfHouse(printed["the-dreaming"]), "not given", "the town's own printed registry says so too");
  assert.deepEqual(git(t.dir, "show", "--name-only", "--format=", out.commit).split("\n").filter(Boolean).sort(),
    [REGISTRY_PATH, "WHITE_PAGES/stamp-ledger.md"].sort(), "the registry and the ledger; the cards already said The Dreaming");

  // HISTORY STAYS: every earlier ledger line is byte-for-byte as it was; one signed key line is appended
  const ledger1 = ledgerOf(t.dir).trimEnd().split("\n");
  assert.deepEqual(ledger1.slice(0, ledger0.length), ledger0, "no earlier line is rewritten");
  assert.deepEqual(registryLines(t.dir), [...KEYED, `- ${D} · registry: the-fen = hh:the-dreaming`], "one signed key line, appended");
  assert.equal(ledger1.length, ledger0.length + 1, "no fresh payment of any kind is written");
  assert.deepEqual(VERIFY.verifyStampLedger(t.dir).problems ?? [], [], "the town's stamp-verify reads it green");
  // ONE HOUSEHOLD CAP: both residents key to the one house
  const roll = ENGINE.currentHouseholds(t.dir);
  assert.equal(roll.get("the-fen").key, "hh:the-dreaming");
  assert.equal(roll.get("qthedreaming").key, "hh:the-dreaming");
  assert.deepEqual(KEYS.describe(KEYS.householdKeySplits({ roll, houses: printed })), [], "one household, one key");
  assert.ok(clean(t.dir));
});

// ── R3 no intermediate yes ──────────────────────────────────────────────────

test("R3 · THE ANSWER AND THE MOVE ARE ONE WRITE: a source that is not 'no' under the lock refuses, and the target is exactly as it was", { skip: SKIP }, async () => {
  const t = await town();
  const plan = await withPen(t, () => repairDreaming({ clone: t.dir, date: D, dryRun: true, ...NO_WRITERS }));
  // between the plan and the write, the leaving house's answer stops being a no
  await ownerQuery("UPDATE households SET likeness = $2::jsonb WHERE slug = $1", ["the-dreaming-fenofthedreaming", JSON.stringify({ ...FEN_NO, answer: "yes" })]);
  const before = await storeRows();
  const owner = await asOwner();
  try {
    await assert.rejects(moveResidentInStore(owner, { handle: "the-fen", from: plan.plan.from, to: "the-dreaming", settleLikeness: true }),
      (e) => e.defect === MOVE_ROW_REFUSALS.NO_SOURCE_NO.defect && e.detail === "the-dreaming-fenofthedreaming");
    const { rows: [tx] } = await owner.query("SELECT now() = statement_timestamp() AS fresh");
    assert.equal(tx.fresh, true, "no transaction is left open");
  } finally { await owner.end(); }
  assert.deepEqual(await storeRows(), before, "nothing moved, and the house still says what it said");
  // the plain road, asked for no answer, moves the resident and leaves the target's own answer alone (it is not this repair's business)
  const owner2 = await asOwner();
  try { await moveResidentInStore(owner2, { handle: "the-fen", from: plan.plan.from, to: "the-dreaming" }); } finally { await owner2.end(); }
  const row = (await storeRows()).households.find((h) => h.slug === "the-dreaming");
  assert.deepEqual(row.likeness, Q_YES, "the generic move never writes an answer");
});

// ── R4 the refusals ─────────────────────────────────────────────────────────

test("R4 · REFUSED BY NAME, writing nothing: no recorded no, private likeness state on either house, an invitation credit, another house, other arguments", { skip: SKIP }, async () => {
  const refused = async (t, ex, defect, detail) => {
    const before = await storeRows(), h0 = head(t.dir);
    for (const dryRun of [true, false])
      await assert.rejects(withPen(t, () => repairDreaming({ clone: t.dir, date: D, dryRun, ...NO_WRITERS })),
        (e) => e.defect === defect.defect && (detail === undefined || e.detail === detail) && !JSON.stringify(e, Object.getOwnPropertyNames(e)).includes(MARK), `dryRun ${dryRun}`);
    assert.deepEqual(await storeRows(), before);
    assert.equal(head(t.dir), h0);
    assert.ok(clean(t.dir));
  };
  // Fen's house never answered no (a yes, or nothing): there is no recorded no to carry
  for (const fen of [{ ...FEN_NO, answer: "yes" }, null])
    await refused(await town({ houses: HOUSES({ fen }) }), null, MOVE_REFUSALS.NO_SOURCE_NO, "the-dreaming-fenofthedreaming");
  // an invitation credit on the leaving house is a payout ruling
  {
    const t = await town();
    await ownerQuery("UPDATE households SET invited_by = $2::jsonb WHERE slug = $1", ["the-dreaming-fenofthedreaming", JSON.stringify({ by: "someone", at: "2026-07-28", paid: false })]);
    await refused(t, null, MOVE_REFUSALS.CREDIT);
  }
  // private likeness state: neither moved nor discarded, on the leaving house or the joined one; the contents are never printed
  await with092(async () => {
    const a = await town();
    await setState("the-dreaming-fenofthedreaming", STATE);
    await refused(a, null, MOVE_REFUSALS.LIKENESS_STATE, "the-dreaming-fenofthedreaming");
    const b = await town();
    await setState("the-dreaming", STATE);
    await refused(b, null, MOVE_REFUSALS.TARGET_LIKENESS_STATE, "the-dreaming");
    assert.deepEqual((await ownerQuery("SELECT likeness_state FROM households WHERE slug = 'the-dreaming'"))[0].likeness_state, STATE, "the state stands, untouched");
  });
  // the resident lives somewhere else: this correction is for one house only
  {
    const t = await town({ houses: { ...HOUSES(), "elsewhere": { name: "Elsewhere", accounts: [{ login: "fen-gh", id: 702 }], residents: ["the-fen"], since: "2026-08-01", declared_by: "fixture", likeness: FEN_NO } } });
    const h = HOUSES(); delete h["the-dreaming-fenofthedreaming"];
    await seedRegistry(IX.store, { schema_version: 1, note: "invented", households: { ...h, elsewhere: { name: "Elsewhere", accounts: [{ login: "fen-gh", id: 702 }], residents: ["the-fen"], since: "2026-08-01", declared_by: "fixture", likeness: FEN_NO } } }, PINS());
    await refused(t, null, MOVE_REFUSALS.WRONG_HOUSE, "elsewhere");
  }
  // the command takes no arguments but --dry-run: it names its own household
  const err = [];
  assert.equal(await repairMain(["--handle", "zed", "--to", "the-dreaming"], { err: (s) => err.push(s) }), 2);
  assert.match(err.join("\n"), /no arguments but --dry-run/);
  assert.deepEqual(DREAMING, { handle: "the-fen", from: "the-dreaming-fenofthedreaming", to: "the-dreaming" });
});

// ── R5 replay ───────────────────────────────────────────────────────────────

test("R5 · REPLAY: a push that cannot land leaves the store moved and the house already 'not given'; the same command publishes the rest once", { skip: SKIP }, async () => {
  const t = await town();
  const h0 = head(t.dir);
  await assert.rejects(withPen(t, () => penTransaction(t.dir, () => repairDreaming({ clone: t.dir, date: D, owner: asOwner,
    commit: () => { throw notLandedError("a fixture race"); } }))), (e) => e.code === 503 && /run the same command again/.test(e.detail));
  const moved = await storeRows();
  assert.deepEqual(moved.households.map((h) => h.slug), ["the-dreaming", "zeds"], "the store moved");
  assert.deepEqual(moved.households.find((h) => h.slug === "the-dreaming").likeness, FEN_NO, "and the answer moved with it: no moment of 'given' for the combined house");
  assert.deepEqual(await withPen(t, reads), { q: false, fen: false });
  assert.equal(head(t.dir), h0, "the clone did not");
  assert.ok(clean(t.dir));

  const again = await withPen(t, () => repairDreaming({ clone: t.dir, date: D, owner: NEVER("the owner's connection"), move: NEVER("the store transaction") }));
  assert.equal(again.plan.resuming, true);
  assert.equal(again.plan.from, "the-dreaming-fenofthedreaming");
  assert.equal(again.plan.likeness, null, "a resumed run writes no answer");
  assert.deepEqual(await storeRows(), moved, "the store did not move again");
  assert.deepEqual(registryLines(t.dir), [...KEYED, `- ${D} · registry: the-fen = hh:the-dreaming`], "one key line, never two");
  assert.deepEqual(VERIFY.verifyStampLedger(t.dir).problems ?? [], []);
  assert.equal(likenessOfHouse(JSON.parse(readFileSync(join(t.dir, REGISTRY_PATH), "utf8")).households["the-dreaming"]), "not given");

  await assert.rejects(withPen(t, () => repairDreaming({ clone: t.dir, date: D, ...NO_WRITERS })),
    (e) => e.defect === MOVE_REFUSALS.SAME_HOUSE.defect, "published whole: nothing left to do, and a rerun never earns or answers again");
  assert.equal(registryLines(t.dir).length, KEYED.length + 1);
});

// ── R6 a house that already says no ─────────────────────────────────────────

test("R6 · a joined house that already answers no keeps its own record", { skip: SKIP }, async () => {
  const qno = { ...Q_YES, answer: "no", at: "2026-11-17T12:00:00.000Z" };
  const t = await town({ houses: HOUSES({ q: qno }) });
  const out = await run(t);
  assert.deepEqual(out.plan.likeness, { house: "the-dreaming", before: "not given", after: "not given" });
  assert.deepEqual((await storeRows()).households.find((h) => h.slug === "the-dreaming").likeness, qno, "not overwritten");
  assert.deepEqual(await withPen(t, reads), { q: false, fen: false });
});
