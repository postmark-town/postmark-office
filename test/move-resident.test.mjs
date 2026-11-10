// move-resident.test.mjs — one resident moves house; the empty house they leave is retired (POS-788).
//
// Darko, 2026-10-25 09:53 EDT (town #4159): "we need to move Corrie into
// Olivia's household as well." Wright's shape, confirmed 2026-11-09 11:10Z: the
// pin is kept; planHouseKey first; one store transaction for the two houses,
// the retirement through the owner; then the drain, the ADDRESS and the signed
// key line in one pen commit, resumable; --dry-run prints every row and file
// and writes nothing.
//
// Every house, handle, login and id here is INVENTED. The store is a real
// embedded Postgres with every migration applied (the owner and office_api
// roles are the store's own); the clone holds the town's own engine, its key
// predicate and its stamp-verify, over a ledger signed with a key this test
// holds.
//
//   M1  the dry run names every row and file, and reaches no writer
//   M2  refusals come before any write: either house missing, no pin, no house,
//       a house that would not be left empty, an invitation credit, a key line
//       the dating rule refuses
//   M3  THE MOVE: the pin, handle, home and stamps kept; membership, accounts,
//       former keys and the home picture moved; only the empty source retired;
//       the registry, the card and the signed key line in one commit, green
//   M4  only the owner writes: office_api is refused, and nothing moves
//   M5  RESUMABLE: a push that cannot land leaves the store moved; the same
//       command publishes the rest without moving the store again or writing a
//       second key line; then there is nothing to do
//   M5b RESUMED FROM DURABLE FACTS (the review of #985): a failed publication,
//       then another ceremony's drain prints the move; the rerun still corrects
//       the card and berth and writes the key line once, never moving the store
//   M5c the same for a resident with no sealed line naming the source
//   M5d a rekey is not a move: a renamed target's former key refuses by name
//   M5e no history, no guess: a shallow clone refuses by name, writing nothing
//   M5f a resumed card naming neither house refuses before any write
//   M6  the transaction re-reads under its lock: a house that changed since the
//       plan refuses, and rolls back
//   M6b an invitation credit that appears after the plan refuses under the lock
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/move-resident.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createPrivateKey, sign as edSign } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { fixtureTown } from "./fixture.mjs";
import { indexStore, seedRegistry, recordInProcess } from "./helpers/office-under-test.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";
import { loadRegistryRows, moveResidentInStore, likenessStateHeld, MOVE_ROW_REFUSALS } from "../src/registry-store.mjs";
import { renderPublicRegistry } from "../src/registry-rows.mjs";
import { notLandedError, penTransaction, penCommit } from "../src/write.mjs";
import { collectingDrain } from "../src/ceremony.mjs";
import { REGISTRY_PATH, PINS_PATH } from "../src/residency.mjs";
import { moveResident, planMove, describe, main, MOVE_REFUSALS } from "../tools/move-resident.mjs";
import { rekeyHousehold } from "../tools/rekey-household.mjs";

const TOWN = townClone();
const HAS_ENGINE = Boolean(TOWN) && existsSync(join(TOWN, "tools", "household-keys.mjs"));
const SKIP = !TOWN ? NO_TOWN : (!HAS_ENGINE && "the town clone predates tools/household-keys.mjs (town d95e81c1c)");
const ENGINE = HAS_ENGINE ? await import(townModuleUrl("tools", "stamp-mint.mjs")) : null;
const VERIFY = HAS_ENGINE ? await import(townModuleUrl("tools", "stamp-verify.mjs")) : null;
const KEYS = HAS_ENGINE ? await import(townModuleUrl("tools", "household-keys.mjs")) : null;

delete process.env.TOWN_PUSH;
const D = "2026-11-10";

const IX = await indexStore(fixtureTown());
const RECORD_RESTORE = await recordInProcess(IX.store);
after(async () => { await RECORD_RESTORE(); await IX.stop(); });

const git = (dir, ...a) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" }).trim();
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });

// THE TOWN: lamp keeps Harbor Lights; moss joined later from another account and
// founded New Nook, which it alone keeps; zed is next door. moss is the one who moves.
const HOUSES = () => ({
  "harbor-lights": { name: "Harbor Lights", accounts: [{ login: "lamp-gh", id: 501 }], residents: ["lamp"], since: "2026-07-16",
    declared_by: "fixture", home_images: { lamp: "https://media.postmark.town/harbor-lights/aa.png" } },
  zeds: { name: "Zeds", accounts: [{ login: "zed-gh", id: 999 }], residents: ["zed"], since: "2026-06-12", declared_by: "fixture" },
  "new-nook": { name: "New Nook", accounts: [{ login: "moss-gh", id: 502 }], residents: ["moss"], since: "2026-10-24",
    declared_by: "fixture", formerly: ["moss-first-try"], home_images: { moss: "https://media.postmark.town/new-nook/bb.png" } },
});
const PINS = () => ({
  lamp: { login: "lamp-gh", id: 501, pinned: "2026-07-16" },
  moss: { login: "moss-gh", id: 502, pinned: "2026-10-24" },
  zed: { login: "zed-gh", id: 999, pinned: "2026-06-12" },
});
const KEYED = ["- 2026-09-02 · registry: lamp = hh:harbor-lights", "- 2026-10-25 · registry: moss = hh:new-nook"];

/** The store seeded, and a sealed clone whose printouts are the store's own print. */
async function town({ houses = HOUSES(), pins = PINS(), ledger = KEYED, berth = false } = {}) {
  await seedRegistry(IX.store, { schema_version: 1, note: "invented for POS-788", households: houses }, pins);
  const printed = renderPublicRegistry(await loadRegistryRows());
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const dir = mkdtempSync(join(tmpdir(), "pm-move-resident-"));
  dirs.push(dir);
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), printed.households);
  writeFileSync(join(dir, PINS_PATH), printed.pins);
  for (const [h, gh, house] of [["lamp", "lamp-gh", "Harbor Lights"], ["moss", "moss-gh", "New Nook"], ["zed", "zed-gh", "Zeds"]]) {
    mkdirSync(join(dir, "WHITE_PAGES", h), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\ngithub: ${gh}\nhousehold: ${house}\n---\n\n# ${h}\n`);
  }
  if (berth) {
    mkdirSync(join(dir, "HARBOR", "berths"), { recursive: true });
    writeFileSync(join(dir, "HARBOR", "berths", "moss.md"), "---\nhandle: moss\nhousehold: new-nook\n---\n");
  }
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), "# mail\n\n- 2026-06-12 · zed-2026-06-12-to-zed2-genesis · zed → zed2\n");
  // the mints the mail earns, derived by the town's engine over this town, so the ledger verifies green before the move
  const bare = ["- 2026-06-12 · rules: stamps-v1", ...ledger];
  writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), `# the ledger\n\n${bare.join("\n")}\n`);
  const { laws, revisions } = ENGINE.parseLaws(ENGINE.parseStampLedger(bare.join("\n") + "\n"));
  const mints = ENGINE.deriveMints(ENGINE.parseDeliveries(dir), ENGINE.householdKeys(dir), { laws, revisions }).map(ENGINE.mintLine);
  const lines = [...bare, ...mints];
  const seals = ENGINE.sealChain(lines);
  const key = createPrivateKey(pem);
  const signed = lines.map((l, i) => `${l} · sig: ${edSign(null, Buffer.from(seals[i], "utf8"), key).toString("base64url")}`);
  writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), `# the ledger\n\n${signed.join("\n")}\n`);
  writeFileSync(join(dir, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const keyDir = mkdtempSync(join(tmpdir(), "pm-move-resident-pen-"));
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
  const over = { STAMP_KEY: t.keyFile, STAMP_ENGINE_DIR: join(TOWN, "tools") };
  const prev = {};
  for (const [k, v] of Object.entries(over)) { prev[k] = process.env[k]; process.env[k] = v; }
  try { return await fn(); }
  finally { for (const [k, v] of Object.entries(prev)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
};

async function storeRows() {
  const c = await IX.store.connect("world2_owner");
  try {
    const h = (await c.query("SELECT slug, residents, accounts, formerly, home_images, invited_by FROM households ORDER BY slug")).rows;
    const p = (await c.query("SELECT handle, login, gh_id::text AS gh_id, pinned FROM household_pins ORDER BY handle")).rows;
    return { households: h, pins: p };
  } finally { await c.end(); }
}
const asOwner = () => IX.store.connect("world2_owner");
const ledgerOf = (dir) => readFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
const registryLines = (dir) => ledgerOf(dir).split("\n").filter((l) => / · registry: /.test(l)).map((l) => l.replace(/ · sig: \S+$/, ""));
const head = (dir) => git(dir, "rev-parse", "HEAD");
const clean = (dir) => git(dir, "status", "--porcelain") === "";

// A writer that must never be reached.
const NEVER = (what) => async () => { throw new Error(`the dry run reached ${what}`); };
const NO_WRITERS = { owner: NEVER("the owner's connection"), move: NEVER("the store transaction"),
  drainWith: () => { throw new Error("the dry run reached the drain"); }, commit: () => { throw new Error("the dry run reached the pen"); } };

// ── M1 the dry run ──────────────────────────────────────────────────────────

test("M1 · the dry run names every row and file the move would touch, and reaches no store, file or Git writer", { skip: SKIP }, async (tc) => {
  const t = await town({ berth: true });
  const before = await storeRows();
  const h0 = head(t.dir);
  const out = await withPen(t, () => moveResident({ handle: "moss", to: "harbor-lights", clone: t.dir, date: D, dryRun: true, ...NO_WRITERS }));
  assert.equal(out.dryRun, true);
  const { plan } = out;
  assert.equal(plan.from, "new-nook");
  assert.equal(plan.resuming, false);
  assert.deepEqual(plan.pin, { handle: "moss", untouched: true });
  assert.deepEqual(plan.store.update.after.residents, ["lamp", "moss"]);
  assert.deepEqual(plan.store.update.after.accounts, [{ login: "lamp-gh", id: 501 }, { login: "moss-gh", id: 502 }]);
  assert.deepEqual(plan.store.update.after.formerly, ["new-nook", "moss-first-try"], "the source's key and its own former keys");
  assert.deepEqual(Object.keys(plan.store.update.after.home_images).sort(), ["lamp", "moss"], "the resident's home picture moves with them");
  assert.equal(plan.store.retire.slug, "new-nook");
  assert.deepEqual(plan.store.retire.row.residents, ["moss"]);
  assert.equal(plan.registry.retired, "new-nook");
  assert.deepEqual(plan.registry.after.residents, ["lamp", "moss"]);
  assert.deepEqual(plan.cards.map((c) => [c.path, c.before, c.after]), [
    ["WHITE_PAGES/moss/ADDRESS.md", "New Nook", "Harbor Lights"],
    ["HARBOR/berths/moss.md", "new-nook", "Harbor Lights"],
  ]);
  assert.deepEqual(plan.ledger.lines, [`- ${D} · registry: moss = hh:harbor-lights`]);
  assert.equal(plan.ledger.checked, "quiet");

  // NOTHING WRITTEN: the store, the clone, its HEAD, its ledger
  assert.deepEqual(await storeRows(), before);
  assert.equal(head(t.dir), h0);
  assert.ok(clean(t.dir), "no file in the clone changed");

  // the printed dry run names each of them; the synthetic example for the tool look is this text
  const text = describe(plan, { dryRun: true });
  for (const line of text.split("\n")) tc.diagnostic(`dry-run | ${line}`);
  for (const s of ["DRY RUN — nothing written.", "pin: household_pins moss — unchanged", "UPDATE households harbor-lights:",
    'residents   ["lamp"] -> ["lamp","moss"]', "DELETE households new-nook (its only resident is moss)", "tools/households.json: new-nook leaves the printout",
    "tools/github-ids.json: unchanged", "WHITE_PAGES/moss/ADDRESS.md: household: New Nook -> Harbor Lights", "HARBOR/berths/moss.md: household: new-nook -> Harbor Lights",
    `- ${D} · registry: moss = hh:harbor-lights · sig: <the office pen>`])
    assert.ok(text.includes(s), `the dry run says: ${s}\n${text}`);
  // the human's own name is never printed (the public registry keeps it out too)
  const withHuman = describe({ ...plan, store: { ...plan.store, retire: { ...plan.store.retire, row: { ...plan.store.retire.row, human: "Some Private Name" } } } }, { dryRun: true });
  assert.doesNotMatch(withHuman, /Some Private Name/);
  assert.match(withHuman, /"human":"\(set; private, not printed\)"/);
});

test("M1b · the command's --dry-run, as the operator runs it, prints the plan and writes nothing", { skip: SKIP }, async () => {
  const t = await town();
  const before = await storeRows();
  const log = [], err = [];
  const code = await withPen(t, () => main(["--handle", "moss", "--to", "harbor-lights", "--dry-run"],
    { env: { ...process.env, TOWN_CLONE: t.dir }, log: (s) => log.push(s), err: (s) => err.push(s),
      act: (a) => moveResident({ ...a, date: D, ...NO_WRITERS }) }));
  assert.equal(code, 0, err.join("\n"));
  assert.match(log.join("\n"), /^DRY RUN — nothing written\./);
  assert.deepEqual(await storeRows(), before);
  assert.ok(clean(t.dir));
  assert.equal(await main(["--handle", "moss"], { err: () => {} }), 2, "both arguments are required");
});

// ── M2 the refusals ─────────────────────────────────────────────────────────

test("M2 · refused before any write: either house missing, no pin, no house, a house not left empty, an invitation credit", { skip: SKIP }, async () => {
  const cases = [
    ["the target is missing", {}, { handle: "moss", to: "no-such-house" }, MOVE_REFUSALS.NO_TARGET],
    ["the target is only a former key", {}, { handle: "moss", to: "moss-first-try" }, MOVE_REFUSALS.NO_TARGET],
    ["the handle has no pin", {}, { handle: "ghost", to: "harbor-lights" }, MOVE_REFUSALS.NO_PIN],
    ["the handle's own house is missing", { houses: (() => { const h = HOUSES(); delete h["new-nook"]; return h; })() },
      { handle: "moss", to: "harbor-lights" }, MOVE_REFUSALS.NOT_HOUSED],
    ["the house left would not be empty", { houses: (() => { const h = HOUSES(); h["new-nook"].residents = ["moss", "zed2"]; return h; })(),
      pins: { ...PINS(), zed2: { login: "moss-gh", id: 502, pinned: "2026-10-24" } } },
      { handle: "moss", to: "harbor-lights" }, MOVE_REFUSALS.NOT_EMPTY],
    ["the house left carries an invitation credit", { houses: (() => { const h = HOUSES(); h["new-nook"].invited_by = { by: "zeds", named: "zed", at: "2026-10-24T12:00:00.000Z" }; return h; })() },
      { handle: "moss", to: "harbor-lights" }, MOVE_REFUSALS.CREDIT],
    ["the resident already lives in the target", {}, { handle: "lamp", to: "harbor-lights" }, MOVE_REFUSALS.SAME_HOUSE],
  ];
  for (const [why, shape, args, refusal] of cases) {
    const t = await town(shape);
    const before = await storeRows();
    const h0 = head(t.dir);
    await assert.rejects(withPen(t, () => moveResident({ ...args, clone: t.dir, date: D, ...NO_WRITERS })),
      (e) => e.code === refusal.code && e.defect === refusal.defect, why);
    // a dry run refuses the same way
    await assert.rejects(withPen(t, () => moveResident({ ...args, clone: t.dir, date: D, dryRun: true, ...NO_WRITERS })),
      (e) => e.defect === refusal.defect, `${why} (dry run)`);
    assert.deepEqual(await storeRows(), before, `${why}: the store is untouched`);
    assert.equal(head(t.dir), h0);
    assert.ok(clean(t.dir), `${why}: the clone is untouched`);
  }
});

test("M2b · the key is judged first: a line the ledger's tail would precede, or a refusal from planHouseKey, refuses before any write", { skip: SKIP }, async () => {
  const t = await town();
  const before = await storeRows();
  await assert.rejects(withPen(t, () => moveResident({ handle: "moss", to: "harbor-lights", clone: t.dir, date: "2026-10-01", ...NO_WRITERS })),
    (e) => e.defect === MOVE_REFUSALS.HOUSE_KEY.defect && /ledger's newest line is dated ahead/.test(e.detail), "the real planHouseKey: the tail is after the date");
  const today = { refusal: { defect: "this house's residents have already earned stamps today" }, detail: "moss already has stamps on 2026-11-10" };
  await assert.rejects(withPen(t, () => moveResident({ handle: "moss", to: "harbor-lights", clone: t.dir, date: D, keyPlan: () => today, ...NO_WRITERS })),
    (e) => e.defect === MOVE_REFUSALS.HOUSE_KEY.defect && /already has stamps/.test(e.detail));
  assert.deepEqual(await storeRows(), before);
  assert.ok(clean(t.dir));
});

test("M2c · a printout behind the store for ANOTHER house refuses (rekey-household's collateral rule): the move never carries a change unasked", { skip: SKIP }, async () => {
  const t = await town();
  const c = await asOwner();
  try { await c.query("UPDATE households SET name = 'Zeds Renamed' WHERE slug = 'zeds'"); } finally { await c.end(); }
  const before = await storeRows();
  await assert.rejects(withPen(t, () => moveResident({ handle: "moss", to: "harbor-lights", clone: t.dir, date: D, ...NO_WRITERS })),
    (e) => e.defect === MOVE_REFUSALS.COLLATERAL.defect && e.detail === "zeds");
  assert.deepEqual(await storeRows(), before);
  assert.ok(clean(t.dir));
});

// ── M3 the move ─────────────────────────────────────────────────────────────

test("M3 · THE MOVE: pin kept, membership and accounts moved, only the empty source retired; registry, card and signed key line in one commit, green", { skip: SKIP }, async () => {
  const t = await town();
  const before = await storeRows();
  const h0 = head(t.dir);
  const out = await withPen(t, () => moveResident({ handle: "moss", to: "harbor-lights", clone: t.dir, date: D, owner: asOwner }));
  assert.match(out.commit, /^[0-9a-f]{40}$/);
  assert.equal(git(t.dir, "rev-parse", `${out.commit}^`), h0, "one commit");

  const s = await storeRows();
  assert.deepEqual(s.pins, before.pins, "THE PIN IS KEPT: every pin, moss's included, exactly as it was");
  assert.deepEqual(s.households.map((h) => h.slug), ["harbor-lights", "zeds"], "new-nook is retired; nothing else is");
  const hl = s.households.find((h) => h.slug === "harbor-lights");
  assert.deepEqual(hl.residents, ["lamp", "moss"]);
  assert.deepEqual(hl.accounts, [{ login: "lamp-gh", id: 501 }, { login: "moss-gh", id: 502 }]);
  assert.deepEqual(hl.formerly, ["new-nook", "moss-first-try"]);
  assert.deepEqual(hl.home_images, { lamp: "https://media.postmark.town/harbor-lights/aa.png", moss: "https://media.postmark.town/new-nook/bb.png" });
  assert.deepEqual(s.households.find((h) => h.slug === "zeds"), before.households.find((h) => h.slug === "zeds"), "the house next door is untouched");

  // the commit: the printed registry, the card, the ledger, and nothing else
  assert.deepEqual(git(t.dir, "show", "--name-only", "--format=", out.commit).split("\n").filter(Boolean).sort(),
    [REGISTRY_PATH, "WHITE_PAGES/moss/ADDRESS.md", "WHITE_PAGES/stamp-ledger.md"].sort());
  const printed = JSON.parse(readFileSync(join(t.dir, REGISTRY_PATH), "utf8")).households;
  assert.equal(printed["new-nook"], undefined);
  assert.deepEqual(printed["harbor-lights"].residents, ["lamp", "moss"]);
  assert.match(readFileSync(join(t.dir, "WHITE_PAGES", "moss", "ADDRESS.md"), "utf8"), /^household: Harbor Lights$/m);
  assert.match(readFileSync(join(t.dir, "WHITE_PAGES", "moss", "ADDRESS.md"), "utf8"), /^handle: moss$/m, "the handle stays");
  assert.deepEqual(registryLines(t.dir), [...KEYED, `- ${D} · registry: moss = hh:harbor-lights`], "one signed key line, appended");
  assert.deepEqual(VERIFY.verifyStampLedger(t.dir).problems ?? [], [], "the town's stamp-verify reads it green");
  assert.deepEqual(KEYS.describe(KEYS.householdKeySplits({ roll: ENGINE.currentHouseholds(t.dir), houses: printed })), [], "one household, one key");
  assert.equal(ENGINE.currentHouseholds(t.dir).get("moss").key, "hh:harbor-lights");
  assert.ok(clean(t.dir));
});

// ── M4 only the owner ───────────────────────────────────────────────────────

test("M4 · only the owner writes the move: as office_api it is refused, and nothing moves or is published", { skip: SKIP }, async () => {
  const t = await town();
  const before = await storeRows();
  const h0 = head(t.dir);
  await assert.rejects(withPen(t, () => moveResident({ handle: "moss", to: "harbor-lights", clone: t.dir, date: D, owner: () => IX.store.connect("office_api") })),
    (e) => e.defect === MOVE_ROW_REFUSALS.NOT_OWNER.defect && /office_api/.test(e.detail));
  assert.deepEqual(await storeRows(), before);
  assert.equal(head(t.dir), h0);
});

// ── M5 resumable ────────────────────────────────────────────────────────────

test("M5 · RESUMABLE: a push that cannot land leaves the store moved; the same command publishes the rest, once; then nothing is left", { skip: SKIP }, async () => {
  const t = await town();
  const h0 = head(t.dir);
  // as the command runs it: inside the pen's transaction, which puts back every file a failed act wrote
  await assert.rejects(withPen(t, () => penTransaction(t.dir, () => moveResident({ handle: "moss", to: "harbor-lights", clone: t.dir, date: D, owner: asOwner,
    commit: () => { throw notLandedError("a fixture race"); } }))), (e) => e.code === 503 && /run the same command again/.test(e.detail));
  const moved = await storeRows();
  assert.deepEqual(moved.households.map((h) => h.slug), ["harbor-lights", "zeds"], "the store moved");
  assert.equal(head(t.dir), h0, "the clone did not");
  assert.ok(clean(t.dir), "and holds nothing half-written");

  const again = await withPen(t, () => moveResident({ handle: "moss", to: "harbor-lights", clone: t.dir, date: D,
    owner: NEVER("the owner's connection"), move: NEVER("the store transaction") }));
  assert.equal(again.plan.resuming, true);
  assert.equal(again.plan.from, "new-nook", "the source, found in the town's printout and the target's formerly");
  assert.equal(again.plan.store, null);
  assert.match(again.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(await storeRows(), moved, "the store did not move again");
  assert.deepEqual(registryLines(t.dir), [...KEYED, `- ${D} · registry: moss = hh:harbor-lights`], "one key line, never two");
  assert.match(readFileSync(join(t.dir, "WHITE_PAGES", "moss", "ADDRESS.md"), "utf8"), /^household: Harbor Lights$/m);
  assert.deepEqual(VERIFY.verifyStampLedger(t.dir).problems ?? [], []);

  await assert.rejects(withPen(t, () => moveResident({ handle: "moss", to: "harbor-lights", clone: t.dir, date: D, ...NO_WRITERS })),
    (e) => e.defect === MOVE_REFUSALS.SAME_HOUSE.defect, "published whole: nothing left to do");
  assert.equal(registryLines(t.dir).length, KEYED.length + 1);
});

// THE INTERLEAVING the review of #985 ran (finding 1): the act's publication fails, then ANOTHER
// ceremony's ordinary drain lands first and prints the move, erasing the source's printed row.
const otherDrainLands = async (dir) => {
  const { drain, paths } = collectingDrain({ clone: dir });
  await drain({ note: "an unrelated ceremony's drain" });
  return penCommit(dir, paths, "registry: an unrelated ceremony's drain (fixture)");
};
const stall = (t) => withPen(t, () => penTransaction(t.dir, () => moveResident({ handle: "moss", to: "harbor-lights", clone: t.dir, date: D, owner: asOwner,
  commit: () => { throw notLandedError("a fixture race"); } })));

test("M5b · RESUMED FROM THE STORE AND THE SEALED LEDGER: publication fails, another drain prints the move, the rerun still finishes it", { skip: SKIP }, async () => {
  const t = await town({ berth: true });
  await assert.rejects(stall(t), (e) => e.code === 503);
  const moved = await storeRows();
  assert.match(await otherDrainLands(t.dir), /^[0-9a-f]{40}$/, "another ceremony's drain landed in between");
  const printed = readFileSync(join(t.dir, REGISTRY_PATH), "utf8");
  assert.equal(JSON.parse(printed).households["new-nook"], undefined, "the source's printed row is gone");
  assert.doesNotMatch(printed, /"New Nook"/, "and so is its display name");
  assert.match(readFileSync(join(t.dir, "WHITE_PAGES", "moss", "ADDRESS.md"), "utf8"), /^household: New Nook$/m, "the card is still unpublished");

  const again = await withPen(t, () => moveResident({ handle: "moss", to: "harbor-lights", clone: t.dir, date: D,
    owner: NEVER("the owner's connection"), move: NEVER("the store transaction") }));
  assert.equal(again.plan.resuming, true);
  assert.equal(again.plan.from, "new-nook", "named by the sealed ledger: moss = hh:new-nook, a former key the store no longer has");
  assert.deepEqual(await storeRows(), moved, "the store did not move again");
  assert.match(readFileSync(join(t.dir, "WHITE_PAGES", "moss", "ADDRESS.md"), "utf8"), /^household: Harbor Lights$/m,
    "the card is corrected, though the source's name is no longer in the printed registry");
  assert.match(readFileSync(join(t.dir, "HARBOR", "berths", "moss.md"), "utf8"), /^household: Harbor Lights$/m, "and the berth");
  assert.deepEqual(registryLines(t.dir), [...KEYED, `- ${D} · registry: moss = hh:harbor-lights`], "the signed key line, exactly once");
  assert.deepEqual(VERIFY.verifyStampLedger(t.dir).problems ?? [], []);
  assert.ok(clean(t.dir));

  await assert.rejects(withPen(t, () => moveResident({ handle: "moss", to: "harbor-lights", clone: t.dir, date: D, ...NO_WRITERS })),
    (e) => e.defect === MOVE_REFUSALS.SAME_HOUSE.defect && /the ledger keys them there/.test(e.detail), "SAME_HOUSE only once the ledger keys moss to the target");
  assert.equal(registryLines(t.dir).length, KEYED.length + 1);
});

test("M5c · the same, for a resident who still mints under their human's gh:<id> (no sealed line names the source): the printout's history names it", { skip: SKIP }, async () => {
  const t = await town({ ledger: [KEYED[0]] });
  await assert.rejects(stall(t), (e) => e.code === 503);
  await otherDrainLands(t.dir);
  const again = await withPen(t, () => moveResident({ handle: "moss", to: "harbor-lights", clone: t.dir, date: D,
    owner: NEVER("the owner's connection"), move: NEVER("the store transaction") }));
  assert.equal(again.plan.from, "new-nook");
  assert.match(readFileSync(join(t.dir, "WHITE_PAGES", "moss", "ADDRESS.md"), "utf8"), /^household: Harbor Lights$/m);
  assert.deepEqual(registryLines(t.dir), [KEYED[0], `- ${D} · registry: moss = hh:harbor-lights`], "one key line");
  assert.deepEqual(VERIFY.verifyStampLedger(t.dir).problems ?? [], []);
  // lamp, keyed hh:harbor-lights by a sealed line, is simply a resident there (a gh:-keyed one is M5d's)
  await assert.rejects(withPen(t, () => moveResident({ handle: "lamp", to: "harbor-lights", clone: t.dir, date: D, ...NO_WRITERS })),
    (e) => e.defect === MOVE_REFUSALS.SAME_HOUSE.defect);
});

test("M5d · A REKEY IS NOT A MOVE (second review, finding 1): a gh:-keyed resident of a renamed target refuses by name, signing nothing", { skip: SKIP }, async () => {
  const houses = { "harbor-old": { ...HOUSES()["harbor-lights"], name: "Harbor Old" }, zeds: HOUSES().zeds };
  const t = await town({ houses, ledger: [] });
  // the target is re-keyed by the real tool: harbor-old -> harbor-lights, formerly ["harbor-old"]; lamp has no sealed line
  const rekeyed = await withPen(t, () => rekeyHousehold({ from: "harbor-old", to: "harbor-lights", name: "Harbor Lights", clone: t.dir, date: D }));
  assert.match(rekeyed.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(rekeyed.ledger, [], "lamp has no sealed line, so the rekey signed none");
  const before = await storeRows();
  const h0 = head(t.dir);
  const lines = registryLines(t.dir);
  for (const dryRun of [true, false])
    await assert.rejects(withPen(t, () => moveResident({ handle: "lamp", to: "harbor-lights", clone: t.dir, date: D, dryRun, ...NO_WRITERS })),
      (e) => e.defect === MOVE_REFUSALS.NO_MOVE_EVIDENCE.defect && /harbor-old beside harbor-lights/.test(e.detail), `dry run ${dryRun}`);
  assert.deepEqual(registryLines(t.dir), lines, "no signed line");
  assert.deepEqual(await storeRows(), before);
  assert.equal(head(t.dir), h0);
  assert.ok(clean(t.dir));
});

test("M5e · NO HISTORY, NO GUESS (second review, finding 2): a shallow clone after another drain refuses by name, with no stranded card and no signed line", { skip: SKIP }, async () => {
  const t = await town({ berth: true });
  await assert.rejects(stall(t), (e) => e.code === 503);
  await otherDrainLands(t.dir);
  const shallowDir = mkdtempSync(join(tmpdir(), "pm-move-resident-shallow-"));
  dirs.push(shallowDir);
  execFileSync("git", ["clone", "-q", "--depth", "1", `file://${t.dir}`, join(shallowDir, "town")], { encoding: "utf8" });
  const shallow = join(shallowDir, "town");
  const before = await storeRows();
  const h0 = head(shallow);
  const lines = registryLines(shallow);
  await assert.rejects(withPen(t, () => moveResident({ handle: "moss", to: "harbor-lights", clone: shallow, date: D, ...NO_WRITERS })),
    (e) => e.defect === MOVE_REFUSALS.NO_MOVE_EVIDENCE.defect && /a shallow clone may not reach it/.test(e.detail));
  assert.deepEqual(registryLines(shallow), lines, "no signed completion");
  assert.equal(head(shallow), h0);
  assert.ok(clean(shallow), "no file written");
  assert.deepEqual(await storeRows(), before);
  // the full clone, which holds the history, still resumes: the genuine interrupted move is not lost
  const full = await withPen(t, () => moveResident({ handle: "moss", to: "harbor-lights", clone: t.dir, date: D, dryRun: true, ...NO_WRITERS }));
  assert.equal(full.plan.from, "new-nook");
});

test("M5f · A RESUMED CARD MUST MATCH (second review, finding 2): a household line naming neither house refuses, naming the card, before any write", { skip: SKIP }, async () => {
  const t = await town();
  await assert.rejects(stall(t), (e) => e.code === 503);
  await otherDrainLands(t.dir);
  const card = join(t.dir, "WHITE_PAGES", "moss", "ADDRESS.md");
  writeFileSync(card, readFileSync(card, "utf8").replace("household: New Nook", "household: Our Little Cottage"));
  git(t.dir, "commit", "-qam", "moss's own words");
  const before = await storeRows();
  const h0 = head(t.dir);
  const lines = registryLines(t.dir);
  await assert.rejects(withPen(t, () => moveResident({ handle: "moss", to: "harbor-lights", clone: t.dir, date: D, ...NO_WRITERS })),
    (e) => e.defect === MOVE_REFUSALS.CARD_UNMATCHED.defect && e.detail === "WHITE_PAGES/moss/ADDRESS.md: household: Our Little Cottage");
  assert.deepEqual(registryLines(t.dir), lines, "the key line is not written, so nothing marks the act complete");
  assert.equal(head(t.dir), h0);
  assert.ok(clean(t.dir));
  assert.deepEqual(await storeRows(), before);
});

// ── M6 the lock ─────────────────────────────────────────────────────────────

test("M6b · AN INVITATION CREDIT THAT APPEARS AFTER THE PLAN refuses under the lock and rolls back: the credit is never dropped unruled", { skip: SKIP }, async () => {
  const t = await town();
  const plan = await withPen(t, async () => planMove({ handle: "moss", to: "harbor-lights", rows: await loadRegistryRows(), clone: t.dir, date: D }));
  const c = await asOwner();
  try { await c.query(`UPDATE households SET invited_by = '{"by":"zeds","named":"zed","at":"2026-11-09T12:00:00.000Z"}'::jsonb WHERE slug = 'new-nook'`); } finally { await c.end(); }
  const before = await storeRows();
  const owner = await asOwner();
  try {
    await assert.rejects(moveResidentInStore(owner, { handle: "moss", from: plan.from, to: "harbor-lights" }),
      (e) => e.defect === MOVE_ROW_REFUSALS.MOVED.defect && /now carries an invitation credit \(invited by zeds\)/.test(e.detail));
  } finally { await owner.end(); }
  assert.deepEqual(await storeRows(), before, "nothing moved, and the credit stands on its own row");
});

test("M6 · the transaction re-reads under its lock: a house changed since the plan refuses, and the transaction rolls back", { skip: SKIP }, async () => {
  const t = await town();
  const plan = await withPen(t, async () => planMove({ handle: "moss", to: "harbor-lights", rows: await loadRegistryRows(), clone: t.dir, date: D }));
  // between the plan and the write, a second resident joins the source
  const c = await asOwner();
  try { await c.query("UPDATE households SET residents = array_append(residents, 'late') WHERE slug = 'new-nook'"); } finally { await c.end(); }
  const before = await storeRows();
  const owner = await asOwner();
  try {
    await assert.rejects(moveResidentInStore(owner, { handle: "moss", from: plan.from, to: "harbor-lights" }),
      (e) => e.defect === MOVE_ROW_REFUSALS.MOVED.defect && /new-nook: \[moss, late\]/.test(e.detail));
    const { rows: [tx] } = await owner.query("SELECT now() = statement_timestamp() AS fresh");
    assert.equal(tx.fresh, true, "no transaction is left open on the client");
  } finally { await owner.end(); }
  assert.deepEqual(await storeRows(), before, "nothing moved");
});

// ── M7 likeness state (092, POS-726) ────────────────────────────────────────
//
// Wright, 2026-11-09 12:43Z, on #985: "If the source household has any likeness state, refuse by name,
// rechecked under the lock, before any write or output, and never print it in the dump. No transfer or
// discard policy is invented." This branch's schema predates 092, so these legs add the column to the test
// store as its owner (exactly 092's one statement), and drop it after: every leg above runs pre-092.
// The state is SYNTHETIC, carrying a marker no output may ever contain.
const MARK = "SYNTHETIC-PRIVATE-PROOF-7f3a";
const STATE = {
  request: { at: "2026-11-09T12:00:00.000Z", by: "moss-gh", gh_id: 502, depicts: ["moss"] },
  selected: { proof: `https://media.postmark.town/new-nook/${MARK}.png`, at: "2026-11-09T12:05:00.000Z", by: "moss-gh", gh_id: 502 },
};
const ownerQuery = async (sql, params = []) => { const c = await asOwner(); try { return (await c.query(sql, params)).rows; } finally { await c.end(); } };
const with092 = async (fn) => {
  await ownerQuery("ALTER TABLE households ADD COLUMN IF NOT EXISTS likeness_state jsonb");
  try { return await fn(); }
  finally { await ownerQuery("ALTER TABLE households DROP COLUMN IF EXISTS likeness_state"); }
};
const setState = (slug, state) => ownerQuery("UPDATE households SET likeness_state = $2::jsonb WHERE slug = $1", [slug, state == null ? null : JSON.stringify(state)]);
const stateOf = async (slug) => (await ownerQuery("SELECT likeness_state FROM households WHERE slug = $1", [slug]))[0]?.likeness_state ?? null;
const discloses = (x) => JSON.stringify(x, Object.getOwnPropertyNames(x ?? {})).includes(MARK) || String(x?.message ?? "").includes(MARK) || String(x?.detail ?? "").includes(MARK);

test("M7 · A SOURCE HOLDING LIKENESS STATE refuses by name before any output or write, dry run and real, and never discloses it", { skip: SKIP }, async () => {
  await with092(async () => {
    const t = await town();
    await setState("new-nook", STATE);
    const before = await storeRows();
    const h0 = head(t.dir);
    for (const dryRun of [true, false])
      await assert.rejects(withPen(t, () => moveResident({ handle: "moss", to: "harbor-lights", clone: t.dir, date: D, dryRun, ...NO_WRITERS })),
        (e) => e.defect === MOVE_REFUSALS.LIKENESS_STATE.defect && e.detail === "new-nook" && !discloses(e), `dry run ${dryRun}`);
    // the command as the operator runs it: the refusal, and no plan printed at all
    const log = [], err = [];
    const code = await withPen(t, () => main(["--handle", "moss", "--to", "harbor-lights", "--dry-run"],
      { env: { ...process.env, TOWN_CLONE: t.dir }, log: (s) => log.push(s), err: (s) => err.push(s),
        act: (a) => moveResident({ ...a, date: D, ...NO_WRITERS }) }));
    assert.equal(code, 1);
    assert.deepEqual(log, [], "no row or file printed");
    assert.match(err.join("\n"), /REFUSED — the household the resident leaves holds likeness state .*\(new-nook\)/);
    assert.ok(!err.join("\n").includes(MARK) && !err.join("\n").includes("SYNTHETIC"), "the state's contents are never printed");
    assert.deepEqual(await storeRows(), before);
    assert.deepEqual(await stateOf("new-nook"), STATE, "the state stands, untouched");
    assert.equal(head(t.dir), h0);
    assert.ok(clean(t.dir));
  });
});

test("M7b · LIKENESS STATE THAT ARRIVES AFTER THE PLAN refuses under the same row lock and rolls back, naming only the house", { skip: SKIP }, async () => {
  await with092(async () => {
    const t = await town();
    const plan = await withPen(t, async () => planMove({ handle: "moss", to: "harbor-lights", rows: await loadRegistryRows(), clone: t.dir, date: D }));
    await setState("new-nook", STATE);
    const before = await storeRows();
    const owner = await asOwner();
    try {
      await assert.rejects(moveResidentInStore(owner, { handle: "moss", from: plan.from, to: "harbor-lights" }),
        (e) => e.defect === MOVE_ROW_REFUSALS.LIKENESS_STATE.defect && e.detail === "new-nook" && !discloses(e));
      const { rows: [tx] } = await owner.query("SELECT now() = statement_timestamp() AS fresh");
      assert.equal(tx.fresh, true, "rolled back: no transaction left open");
    } finally { await owner.end(); }
    assert.deepEqual(await storeRows(), before, "nothing moved");
    assert.deepEqual(await stateOf("new-nook"), STATE, "and the state stands on its own row");
  });
});

test("M7e · on a train whose row parser reads 092, a source row carrying likeness state refuses in the plan itself", { skip: SKIP }, async () => {
  const t = await town();
  const rows = await loadRegistryRows();
  const carried = { ...rows, households: rows.households.map((r) => (r.slug === "new-nook" ? { ...r, likeness_state: STATE } : r)) };
  assert.throws(() => planMove({ handle: "moss", to: "harbor-lights", rows: carried, clone: t.dir, date: D, keyPlan: () => { throw new Error("planned past the guard"); } }),
    (e) => e.defect === MOVE_REFUSALS.LIKENESS_STATE.defect && e.detail === "new-nook" && !discloses(e));
});

test("M7c · the dry run's formatter never prints likeness state, even handed a plan that carries it", { skip: SKIP }, async () => {
  const t = await town();
  const { plan } = await withPen(t, () => moveResident({ handle: "moss", to: "harbor-lights", clone: t.dir, date: D, dryRun: true, ...NO_WRITERS }));
  assert.equal("likeness_state" in plan.store.retire.row, false, "the plan never carries it");
  const handed = { ...plan, store: { ...plan.store, retire: { ...plan.store.retire,
    row: { ...plan.store.retire.row, likeness_state: STATE, likeness_official: { version: 1, proof: `https://media.postmark.town/x/${MARK}.png` } } } } };
  const text = describe(handed, { dryRun: true });
  assert.ok(!text.includes(MARK), "no proof, request or pointer in the dump");
  assert.doesNotMatch(text, /likeness_state|likeness_official/);
  assert.match(text, /DELETE households new-nook/, "the dump is otherwise whole");
});

test("M7d · COMPATIBLE: without 092 the check answers none; with 092 a state-free source moves, and the target's own state is untouched", { skip: SKIP }, async () => {
  const pre = await town();
  assert.equal(await likenessStateHeld("new-nook"), false, "a store without the column holds no state, and the read does not fail");
  assert.deepEqual(await storeRows(), await storeRows());
  void pre;
  await with092(async () => {
    const t = await town();
    await setState("harbor-lights", { official: { version: 1, proof: "https://media.postmark.town/harbor-lights/cc.png", since: "2026-11-01", depicts: ["lamp"] } });
    const targetState = await stateOf("harbor-lights");
    assert.equal(await likenessStateHeld("new-nook"), false, "the source holds none (SQL NULL)");
    await setState("new-nook", null);
    const out = await withPen(t, () => moveResident({ handle: "moss", to: "harbor-lights", clone: t.dir, date: D, owner: asOwner }));
    assert.match(out.commit, /^[0-9a-f]{40}$/);
    const s = await storeRows();
    assert.deepEqual(s.households.map((h) => h.slug), ["harbor-lights", "zeds"], "the state-free source moved and retired");
    assert.deepEqual(await stateOf("harbor-lights"), targetState, "the target's own likeness state is not touched");
    assert.deepEqual(VERIFY.verifyStampLedger(t.dir).problems ?? [], []);
  });
});
